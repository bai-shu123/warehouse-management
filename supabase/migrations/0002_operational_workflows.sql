begin;

-- Completes the stock-changing workflows. Writes remain transactional and
-- idempotent on the database side instead of trusting browser state.

alter table public.transport_receipts
  add column if not exists operation_id uuid unique references public.stock_operations(id),
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by_operation_id uuid unique references public.stock_operations(id);

create or replace function public.bootstrap_current_user(p_display_name text default null)
returns public.app_role
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_name text;
  v_own_warehouse uuid;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;

  -- Prevent two simultaneous first sign-ups from both becoming administrators.
  perform pg_advisory_xact_lock(hashtextextended('warehouse-bootstrap-admin', 0));

  v_name := coalesce(
    nullif(trim(p_display_name), ''),
    nullif(auth.jwt()->'user_metadata'->>'display_name', ''),
    split_part(coalesce(auth.jwt()->>'email', 'User'), '@', 1)
  );

  insert into public.warehouse_profiles(id, display_name)
  values (v_user_id, v_name)
  on conflict (id) do nothing;

  select role into v_role from public.user_roles where user_id = v_user_id;
  if v_role is null then
    if not exists (select 1 from public.user_roles where role = 'admin') then
      v_role := 'admin';
    else
      v_role := 'warehouse_operator';
    end if;
    insert into public.user_roles(user_id, role) values (v_user_id, v_role);

    if v_role = 'warehouse_operator' then
      select id into v_own_warehouse from public.warehouses where code = 'OWN';
      if v_own_warehouse is not null then
        insert into public.warehouse_members(user_id, warehouse_id)
        values (v_user_id, v_own_warehouse)
        on conflict do nothing;
      end if;
    end if;
  end if;
  return v_role;
end;
$$;

revoke all on function public.bootstrap_current_user(text) from public;
grant execute on function public.bootstrap_current_user(text) to authenticated;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select r.role
  from public.user_roles r
  join public.warehouse_profiles p on p.id = r.user_id
  where r.user_id = auth.uid() and p.is_active;
$$;

create or replace function public.update_my_locale(p_locale text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_locale not in ('zh-CN', 'ru', 'kk') then raise exception 'unsupported locale'; end if;
  update public.warehouse_profiles set locale = p_locale, updated_at = now() where id = auth.uid();
end;
$$;

revoke all on function public.update_my_locale(text) from public;
grant execute on function public.update_my_locale(text) to authenticated;

create or replace function public.create_inbound(
  p_warehouse_id uuid,
  p_product_id uuid,
  p_received_date date,
  p_packages numeric,
  p_pieces integer,
  p_unit_cost_rmb_per_piece numeric,
  p_fx_snapshot_id uuid,
  p_note text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_id uuid;
  v_batch_id uuid;
  v_line_id uuid;
begin
  if not public.is_admin() then raise exception 'administrator required'; end if;
  if p_packages <= 0 or p_pieces <= 0 then raise exception 'quantities must be positive'; end if;
  if p_unit_cost_rmb_per_piece < 0 then raise exception 'unit cost cannot be negative'; end if;
  if p_received_date is null then raise exception 'received date is required'; end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and is_active) then
    raise exception 'warehouse not found';
  end if;
  if not exists (select 1 from public.warehouse_products where id = p_product_id and archived_at is null) then
    raise exception 'product not found';
  end if;
  if not exists (select 1 from public.exchange_rates where id = p_fx_snapshot_id) then
    raise exception 'exchange rate is required';
  end if;

  select id into v_operation_id from public.stock_operations where idempotency_key = p_idempotency_key;
  if v_operation_id is not null then return v_operation_id; end if;

  insert into public.inventory_batches(
    product_id, received_date, unit_cost_rmb_per_piece, fx_snapshot_id,
    total_received_packages, total_received_pieces, note, created_by
  ) values (
    p_product_id, p_received_date, p_unit_cost_rmb_per_piece, p_fx_snapshot_id,
    p_packages, p_pieces, nullif(trim(p_note), ''), auth.uid()
  ) returning id into v_batch_id;

  insert into public.stock_operations(
    operation_type, warehouse_id, product_id, occurred_at, created_by, note, idempotency_key
  ) values (
    'inbound', p_warehouse_id, p_product_id,
    (p_received_date::timestamp at time zone 'Asia/Almaty'),
    auth.uid(), nullif(trim(p_note), ''), p_idempotency_key
  ) returning id into v_operation_id;

  insert into public.stock_operation_lines(operation_id, batch_id, package_delta, piece_delta)
  values (v_operation_id, v_batch_id, p_packages, p_pieces)
  returning id into v_line_id;

  insert into public.stock_movements(operation_line_id, warehouse_id, batch_id, package_delta, piece_delta)
  values (v_line_id, p_warehouse_id, v_batch_id, p_packages, p_pieces);

  insert into public.audit_log(actor_id, action, entity_type, entity_id, after_json)
  values (
    auth.uid(), 'create_inbound', 'stock_operation', v_operation_id,
    jsonb_build_object('warehouse_id', p_warehouse_id, 'product_id', p_product_id,
      'packages', p_packages, 'pieces', p_pieces, 'received_date', p_received_date)
  );
  return v_operation_id;
end;
$$;

revoke all on function public.create_inbound(uuid, uuid, date, numeric, integer, numeric, uuid, text, uuid) from public;
grant execute on function public.create_inbound(uuid, uuid, date, numeric, integer, numeric, uuid, text, uuid) to authenticated;

create or replace function public.create_transport(
  p_transport_id uuid,
  p_transport_no text,
  p_transport_type public.transport_type,
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_shipped_at timestamptz,
  p_expected_arrival_at timestamptz,
  p_note text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_balance record;
  v_order_id uuid;
  v_operation_id uuid;
  v_operation_line_id uuid;
  v_batch_id uuid;
  v_product_id uuid;
  v_packages numeric;
  v_pieces integer;
  v_unit_cost numeric;
begin
  if not public.is_admin() then raise exception 'administrator required'; end if;
  if nullif(trim(p_transport_no), '') is null then raise exception 'transport number is required'; end if;
  if p_destination_warehouse_id is null then raise exception 'destination warehouse is required'; end if;
  if jsonb_array_length(p_lines) = 0 then raise exception 'at least one transport line is required'; end if;

  select id into v_order_id from public.transport_orders where id = p_transport_id;
  if v_order_id is not null then return v_order_id; end if;

  if p_transport_type = 'domestic_to_external' then
    if p_source_warehouse_id is not null then raise exception 'domestic transport cannot have a source warehouse'; end if;
  elsif p_transport_type = 'warehouse_transfer' then
    if p_source_warehouse_id is null or p_source_warehouse_id = p_destination_warehouse_id then
      raise exception 'valid source and destination warehouses are required';
    end if;
  end if;

  insert into public.transport_orders(
    id, transport_no, transport_type, source_warehouse_id, destination_warehouse_id,
    status, shipped_at, expected_arrival_at, note, created_by
  ) values (
    p_transport_id, trim(p_transport_no), p_transport_type, p_source_warehouse_id,
    p_destination_warehouse_id, 'in_transit', coalesce(p_shipped_at, now()),
    p_expected_arrival_at, nullif(trim(p_note), ''), auth.uid()
  ) returning id into v_order_id;

  if p_transport_type = 'warehouse_transfer' then
    insert into public.stock_operations(
      operation_type, warehouse_id, transport_id, occurred_at, created_by, note
    ) values (
      'transfer_dispatch', p_source_warehouse_id, v_order_id,
      coalesce(p_shipped_at, now()), auth.uid(), nullif(trim(p_note), '')
    ) returning id into v_operation_id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_batch_id := nullif(v_line->>'source_batch_id', '')::uuid;
    v_packages := (v_line->>'packages')::numeric;
    v_pieces := (v_line->>'pieces')::integer;
    v_unit_cost := nullif(v_line->>'unit_cost_rmb_per_piece', '')::numeric;
    if v_packages <= 0 or v_pieces <= 0 then raise exception 'quantities must be positive'; end if;

    if p_transport_type = 'domestic_to_external' then
      if v_unit_cost is null or v_unit_cost < 0 then raise exception 'unit cost is required'; end if;
      v_batch_id := null;
    else
      if v_batch_id is null then raise exception 'source batch is required'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_batch_id::text, 0));
      select * into v_balance from public.v_batch_balances
      where warehouse_id = p_source_warehouse_id and batch_id = v_batch_id;
      if v_balance.batch_id is null then raise exception 'source batch not found'; end if;
      if v_balance.product_id <> v_product_id then raise exception 'batch does not match product'; end if;
      if v_packages > v_balance.available_packages or v_pieces > v_balance.available_pieces then
        raise exception 'quantity exceeds source batch balance';
      end if;
      select unit_cost_rmb_per_piece into v_unit_cost from public.inventory_batches where id = v_batch_id;
    end if;

    insert into public.transport_lines(
      transport_id, product_id, source_batch_id, planned_packages, planned_pieces, unit_cost_rmb_per_piece
    ) values (v_order_id, v_product_id, v_batch_id, v_packages, v_pieces, v_unit_cost);

    if p_transport_type = 'warehouse_transfer' then
      insert into public.stock_operation_lines(operation_id, batch_id, package_delta, piece_delta)
      values (v_operation_id, v_batch_id, -v_packages, -v_pieces)
      returning id into v_operation_line_id;
      insert into public.stock_movements(operation_line_id, warehouse_id, batch_id, package_delta, piece_delta)
      values (v_operation_line_id, p_source_warehouse_id, v_batch_id, -v_packages, -v_pieces);
    end if;
  end loop;

  insert into public.audit_log(actor_id, action, entity_type, entity_id, after_json)
  values (
    auth.uid(), 'create_transport', 'transport_order', v_order_id,
    jsonb_build_object('transport_no', trim(p_transport_no), 'type', p_transport_type, 'lines', p_lines)
  );
  return v_order_id;
end;
$$;

revoke all on function public.create_transport(uuid, text, public.transport_type, uuid, uuid, timestamptz, timestamptz, text, jsonb) from public;
grant execute on function public.create_transport(uuid, text, public.transport_type, uuid, uuid, timestamptz, timestamptz, text, jsonb) to authenticated;

create or replace view public.v_transport_progress as
select
  o.id, o.transport_no, o.transport_type, o.source_warehouse_id,
  sw.name as source_warehouse_name, o.destination_warehouse_id,
  dw.name as destination_warehouse_name, o.status, o.shipped_at,
  o.expected_arrival_at, o.note, l.id as line_id, l.product_id,
  p.sku, p.name as product_name, l.source_batch_id,
  l.planned_packages, l.planned_pieces,
  coalesce(sum(r.received_packages) filter (where r.reversed_at is null), 0) as received_packages,
  coalesce(sum(r.received_pieces) filter (where r.reversed_at is null), 0) as received_pieces,
  l.planned_packages - coalesce(sum(r.received_packages) filter (where r.reversed_at is null), 0) as remaining_packages,
  l.planned_pieces - coalesce(sum(r.received_pieces) filter (where r.reversed_at is null), 0) as remaining_pieces,
  case when public.is_admin() then l.unit_cost_rmb_per_piece else null end as unit_cost_rmb_per_piece
from public.transport_orders o
join public.transport_lines l on l.transport_id = o.id
join public.warehouse_products p on p.id = l.product_id
left join public.warehouses sw on sw.id = o.source_warehouse_id
join public.warehouses dw on dw.id = o.destination_warehouse_id
left join public.transport_receipts r on r.transport_line_id = l.id
where public.current_user_role() in ('admin', 'warehouse_operator', 'finance')
  and (public.current_user_role() in ('admin', 'finance') or public.can_access_warehouse(o.destination_warehouse_id))
group by o.id, sw.name, dw.name, l.id, p.sku, p.name;

create or replace view public.v_admin_tasks as
select
  t.id,
  t.operation_id,
  t.status,
  t.created_at,
  w.name as warehouse_name,
  p.sku,
  p.name as product_name,
  sum(l.package_delta) as package_delta,
  sum(l.piece_delta) as piece_delta,
  max(l.recipient_name) as recipient_name,
  o.occurred_at,
  prof.display_name as created_by_name
from public.admin_tasks t
join public.stock_operations o on o.id = t.operation_id
join public.stock_operation_lines l on l.operation_id = o.id
left join public.warehouses w on w.id = o.warehouse_id
left join public.inventory_batches b on b.id = l.batch_id
left join public.warehouse_products p on p.id = coalesce(o.product_id, b.product_id)
left join public.warehouse_profiles prof on prof.id = o.created_by
where public.is_admin() and t.task_type = 'review_operation'
group by t.id, w.name, p.sku, p.name, o.occurred_at, prof.display_name;

create or replace function public.resolve_admin_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'administrator required'; end if;

  update public.admin_tasks
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where id = p_task_id and status = 'open';

  if not found then raise exception 'open task not found'; end if;

  insert into public.audit_log(actor_id, action, entity_type, entity_id)
  values (auth.uid(), 'resolve_admin_task', 'admin_task', p_task_id);
end;
$$;

revoke all on function public.resolve_admin_task(uuid) from public;
grant execute on function public.resolve_admin_task(uuid) to authenticated;

create or replace view public.v_inventory_stock as
select
  balances.warehouse_id,
  w.name as warehouse_name,
  balances.batch_id,
  balances.product_id,
  balances.sku,
  balances.name,
  balances.received_date,
  balances.available_packages,
  balances.available_pieces
from public.v_batch_balances balances
join public.warehouses w on w.id = balances.warehouse_id
where public.current_user_role() in ('admin', 'warehouse_operator', 'finance')
  and (public.current_user_role() in ('admin', 'finance') or public.can_access_warehouse(balances.warehouse_id));

create or replace view public.v_operation_history as
select
  o.id, o.operation_type, o.warehouse_id, w.name as warehouse_name,
  p.sku, p.name as product_name, sum(l.package_delta) as package_delta,
  sum(l.piece_delta) as piece_delta, max(l.recipient_name) as recipient_name,
  o.occurred_at, o.note, o.created_by, prof.display_name as created_by_name,
  o.reversal_of_operation_id,
  exists(select 1 from public.reversal_links rl where rl.original_operation_id = o.id) as is_reversed
from public.stock_operations o
join public.stock_operation_lines l on l.operation_id = o.id
left join public.warehouses w on w.id = o.warehouse_id
left join public.inventory_batches b on b.id = l.batch_id
left join public.warehouse_products p on p.id = coalesce(o.product_id, b.product_id)
left join public.warehouse_profiles prof on prof.id = o.created_by
where public.current_user_role() in ('admin', 'warehouse_operator', 'finance')
  and (public.current_user_role() in ('admin', 'finance') or public.can_access_warehouse(o.warehouse_id))
group by o.id, w.name, p.sku, p.name, prof.display_name;

create or replace view public.v_admin_inventory_costs as
select
  balances.warehouse_id,
  w.name as warehouse_name,
  balances.batch_id,
  balances.product_id,
  balances.sku,
  balances.name,
  balances.received_date,
  balances.available_packages,
  balances.available_pieces,
  b.unit_cost_rmb_per_piece,
  balances.available_pieces * b.unit_cost_rmb_per_piece as value_rmb,
  snapshot.cny_per_usd as snapshot_cny_per_usd,
  snapshot.kzt_per_usd as snapshot_kzt_per_usd,
  balances.available_pieces * b.unit_cost_rmb_per_piece
    / snapshot.cny_per_usd * snapshot.kzt_per_usd as historical_value_kzt,
  current_rate.id as current_rate_id,
  current_rate.effective_date as current_rate_date,
  current_rate.cny_per_usd as current_cny_per_usd,
  current_rate.kzt_per_usd as current_kzt_per_usd,
  balances.available_pieces * b.unit_cost_rmb_per_piece
    / current_rate.cny_per_usd * current_rate.kzt_per_usd as current_value_kzt
from public.v_batch_balances balances
join public.warehouses w on w.id = balances.warehouse_id
join public.inventory_batches b on b.id = balances.batch_id
join public.exchange_rates snapshot on snapshot.id = b.fx_snapshot_id
cross join lateral (
  select r.id, r.effective_date, r.cny_per_usd, r.kzt_per_usd
  from public.exchange_rates r
  order by r.effective_date desc, r.created_at desc
  limit 1
) current_rate
where public.is_admin();

create or replace function public.update_user_access(
  p_user_id uuid,
  p_role public.app_role,
  p_is_active boolean,
  p_warehouse_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'administrator required'; end if;
  if not exists (select 1 from public.warehouse_profiles where id = p_user_id) then
    raise exception 'user profile not found';
  end if;

  update public.warehouse_profiles
  set is_active = p_is_active, updated_at = now()
  where id = p_user_id;

  insert into public.user_roles(user_id, role)
  values (p_user_id, p_role)
  on conflict (user_id) do update set role = excluded.role;

  delete from public.warehouse_members where user_id = p_user_id;
  if p_role = 'warehouse_operator' then
    insert into public.warehouse_members(user_id, warehouse_id)
    select p_user_id, w.id
    from public.warehouses w
    where w.id = any(coalesce(p_warehouse_ids, '{}'::uuid[])) and w.is_active
    on conflict do nothing;
  end if;

  insert into public.audit_log(actor_id, action, entity_type, entity_id, after_json)
  values (
    auth.uid(), 'update_user_access', 'warehouse_profile', p_user_id,
    jsonb_build_object('role', p_role, 'is_active', p_is_active, 'warehouse_ids', p_warehouse_ids)
  );
end;
$$;

revoke all on function public.update_user_access(uuid, public.app_role, boolean, uuid[]) from public;
grant execute on function public.update_user_access(uuid, public.app_role, boolean, uuid[]) to authenticated;

create or replace function public.refresh_transport_status(p_transport_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_active_receipts boolean;
  v_has_remaining boolean;
begin
  select exists (
    select 1
    from public.transport_receipts r
    join public.transport_lines l on l.id = r.transport_line_id
    where l.transport_id = p_transport_id and r.reversed_at is null
  ) into v_has_active_receipts;

  select exists (
    select 1
    from public.transport_lines l
    where l.transport_id = p_transport_id
      and (
        l.planned_packages > coalesce((
          select sum(r.received_packages)
          from public.transport_receipts r
          where r.transport_line_id = l.id and r.reversed_at is null
        ), 0)
        or l.planned_pieces > coalesce((
          select sum(r.received_pieces)
          from public.transport_receipts r
          where r.transport_line_id = l.id and r.reversed_at is null
        ), 0)
      )
  ) into v_has_remaining;

  update public.transport_orders
  set status = case
      when not v_has_remaining then 'completed'::public.transport_status
      when v_has_active_receipts then 'partial_received'::public.transport_status
      else 'in_transit'::public.transport_status
    end,
    completed_at = case when not v_has_remaining then now() else null end,
    updated_at = now()
  where id = p_transport_id;
end;
$$;

revoke all on function public.refresh_transport_status(uuid) from public;

create or replace function public.receive_transport(
  p_transport_line_id uuid,
  p_received_packages numeric,
  p_received_pieces integer,
  p_received_at timestamptz,
  p_note text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt_id uuid;
  v_line public.transport_lines%rowtype;
  v_order public.transport_orders%rowtype;
  v_remaining_packages numeric;
  v_remaining_pieces integer;
  v_batch_id uuid;
  v_fx_id uuid;
  v_operation_id uuid;
  v_operation_line_id uuid;
begin
  if public.current_user_role() not in ('admin', 'warehouse_operator') then
    raise exception 'not allowed';
  end if;
  if p_received_packages <= 0 or p_received_pieces <= 0 then
    raise exception 'received quantities must be positive';
  end if;

  select id into v_receipt_id from public.transport_receipts where id = p_idempotency_key;
  if v_receipt_id is not null then return v_receipt_id; end if;

  select * into v_line from public.transport_lines where id = p_transport_line_id for update;
  if v_line.id is null then raise exception 'transport line not found'; end if;
  select * into v_order from public.transport_orders where id = v_line.transport_id for update;
  if v_order.status not in ('in_transit', 'partial_received') then raise exception 'transport is not receivable'; end if;
  if not public.can_access_warehouse(v_order.destination_warehouse_id) then raise exception 'destination warehouse not allowed'; end if;

  select
    v_line.planned_packages - coalesce(sum(received_packages) filter (where reversed_at is null), 0),
    v_line.planned_pieces - coalesce(sum(received_pieces) filter (where reversed_at is null), 0)
  into v_remaining_packages, v_remaining_pieces
  from public.transport_receipts
  where transport_line_id = v_line.id;

  if p_received_packages > v_remaining_packages or p_received_pieces > v_remaining_pieces then
    raise exception 'received quantity exceeds transport balance';
  end if;

  insert into public.transport_receipts(
    id, transport_line_id, received_packages, received_pieces, received_at, received_by, note
  ) values (
    p_idempotency_key, p_transport_line_id, p_received_packages, p_received_pieces,
    p_received_at, auth.uid(), nullif(trim(p_note), '')
  ) returning id into v_receipt_id;

  if v_line.destination_batch_id is null then
    select id into v_fx_id from public.exchange_rates order by effective_date desc, created_at desc limit 1;
    if v_fx_id is null then raise exception 'an exchange rate is required before receiving'; end if;
    insert into public.inventory_batches(
      product_id, source_transport_id, received_date, unit_cost_rmb_per_piece,
      fx_snapshot_id, total_received_packages, total_received_pieces, created_by
    ) values (
      v_line.product_id, v_order.id, (p_received_at at time zone 'Asia/Almaty')::date,
      coalesce(v_line.unit_cost_rmb_per_piece, 0), v_fx_id,
      p_received_packages, p_received_pieces, auth.uid()
    ) returning id into v_batch_id;
    update public.transport_lines set destination_batch_id = v_batch_id where id = v_line.id;
  else
    v_batch_id := v_line.destination_batch_id;
    update public.inventory_batches
    set total_received_packages = total_received_packages + p_received_packages,
        total_received_pieces = total_received_pieces + p_received_pieces
    where id = v_batch_id;
  end if;

  insert into public.stock_operations(
    operation_type, warehouse_id, product_id, transport_id, occurred_at, created_by, note
  ) values (
    'transfer_receipt', v_order.destination_warehouse_id, v_line.product_id,
    v_order.id, p_received_at, auth.uid(), nullif(trim(p_note), '')
  ) returning id into v_operation_id;

  insert into public.stock_operation_lines(operation_id, batch_id, package_delta, piece_delta)
  values (v_operation_id, v_batch_id, p_received_packages, p_received_pieces)
  returning id into v_operation_line_id;

  insert into public.stock_movements(operation_line_id, warehouse_id, batch_id, package_delta, piece_delta)
  values (v_operation_line_id, v_order.destination_warehouse_id, v_batch_id, p_received_packages, p_received_pieces);

  update public.transport_receipts set operation_id = v_operation_id where id = v_receipt_id;
  perform public.refresh_transport_status(v_order.id);

  insert into public.audit_log(actor_id, action, entity_type, entity_id, after_json)
  values (
    auth.uid(), 'receive_transport', 'transport_receipt', v_receipt_id,
    jsonb_build_object('packages', p_received_packages, 'pieces', p_received_pieces)
  );
  return v_receipt_id;
end;
$$;

create or replace function public.reverse_operation(
  p_operation_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reversal_id uuid;
  v_original public.stock_operations%rowtype;
  v_line record;
  v_new_line_id uuid;
  v_kind public.operation_type;
  v_transport_root_id uuid;
  v_transport_root_type public.operation_type;
  v_transport_id uuid;
begin
  if not public.is_admin() then raise exception 'administrator required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason is required'; end if;

  select id into v_reversal_id from public.stock_operations where idempotency_key = p_idempotency_key;
  if v_reversal_id is not null then return v_reversal_id; end if;

  select * into v_original from public.stock_operations where id = p_operation_id for update;
  if v_original.id is null then raise exception 'operation not found'; end if;
  if exists (select 1 from public.reversal_links where original_operation_id = p_operation_id) then
    raise exception 'operation already reversed; reverse its latest reversal instead';
  end if;

  v_kind := case
    when v_original.operation_type = 'rollback' then 'unrollback'::public.operation_type
    else 'rollback'::public.operation_type
  end;

  insert into public.stock_operations(
    operation_type, warehouse_id, product_id, transport_id, occurred_at, created_by, note,
    reversal_of_operation_id, idempotency_key
  ) values (
    v_kind, v_original.warehouse_id, v_original.product_id, v_original.transport_id,
    now(), auth.uid(), trim(p_reason), v_original.id, p_idempotency_key
  ) returning id into v_reversal_id;

  for v_line in
    select l.*, m.warehouse_id
    from public.stock_operation_lines l
    join public.stock_movements m on m.operation_line_id = l.id
    where l.operation_id = p_operation_id
  loop
    insert into public.stock_operation_lines(operation_id, batch_id, package_delta, piece_delta, recipient_name)
    values (v_reversal_id, v_line.batch_id, -v_line.package_delta, -v_line.piece_delta, v_line.recipient_name)
    returning id into v_new_line_id;
    insert into public.stock_movements(operation_line_id, warehouse_id, batch_id, package_delta, piece_delta)
    values (v_new_line_id, v_line.warehouse_id, v_line.batch_id, -v_line.package_delta, -v_line.piece_delta);
  end loop;

  insert into public.reversal_links(original_operation_id, reversal_operation_id, reversed_by, reason)
  values (p_operation_id, v_reversal_id, auth.uid(), trim(p_reason));

  with recursive operation_chain as (
    select id, operation_type, reversal_of_operation_id, transport_id, 0 as depth
    from public.stock_operations where id = p_operation_id
    union all
    select o.id, o.operation_type, o.reversal_of_operation_id, o.transport_id, c.depth + 1
    from public.stock_operations o
    join operation_chain c on o.id = c.reversal_of_operation_id
  )
  select id, operation_type, transport_id
  into v_transport_root_id, v_transport_root_type, v_transport_id
  from operation_chain
  where operation_type in ('transfer_receipt', 'transfer_dispatch')
  order by depth desc
  limit 1;

  if v_transport_root_type = 'transfer_receipt' then
    update public.transport_receipts
    set reversed_at = case when reversed_at is null then now() else null end,
        reversed_by_operation_id = case when reversed_at is null then v_reversal_id else null end
    where operation_id = v_transport_root_id;
    select l.transport_id into v_transport_id
    from public.transport_receipts r
    join public.transport_lines l on l.id = r.transport_line_id
    where r.operation_id = v_transport_root_id;
    if v_transport_id is not null then perform public.refresh_transport_status(v_transport_id); end if;
  elsif v_transport_root_type = 'transfer_dispatch' and v_transport_id is not null then
    if exists (select 1 from public.transport_orders where id = v_transport_id and status = 'exception') then
      perform public.refresh_transport_status(v_transport_id);
    else
      update public.transport_orders
      set status = 'exception', completed_at = null, updated_at = now()
      where id = v_transport_id;
    end if;
  end if;

  update public.admin_tasks
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where operation_id = p_operation_id and status = 'open';

  insert into public.audit_log(actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), v_kind::text, 'stock_operation', p_operation_id, trim(p_reason));
  return v_reversal_id;
end;
$$;

grant select on public.v_transport_progress, public.v_inventory_stock, public.v_operation_history,
  public.v_admin_inventory_costs, public.v_admin_tasks to authenticated;

commit;
