begin;

-- An inbound record can be started with only the warehouse, product and
-- package count.  Missing supporting details are intentionally kept as
-- neutral values so the record remains visible and can be reviewed later.
alter table public.inventory_batches
  alter column fx_snapshot_id drop not null;

-- Package-only inbound records are valid.  Other stock-changing RPCs still
-- reject zero piece quantities before they reach this table.
alter table public.stock_operation_lines
  drop constraint if exists stock_operation_lines_check;

alter table public.stock_operation_lines
  add constraint stock_operation_lines_package_nonzero_check
  check (package_delta <> 0);

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
  v_received_date date := coalesce(p_received_date, current_date);
  v_pieces integer := coalesce(p_pieces, 0);
  v_unit_cost numeric := coalesce(p_unit_cost_rmb_per_piece, 0);
begin
  if not public.is_admin() then raise exception 'administrator required'; end if;
  if p_packages is null or p_packages <= 0 then raise exception 'package quantity must be positive'; end if;
  if v_pieces < 0 then raise exception 'piece quantity cannot be negative'; end if;
  if v_unit_cost < 0 then raise exception 'unit cost cannot be negative'; end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and is_active) then
    raise exception 'warehouse not found';
  end if;
  if not exists (select 1 from public.warehouse_products where id = p_product_id and archived_at is null) then
    raise exception 'product not found';
  end if;
  if p_fx_snapshot_id is not null
    and not exists (select 1 from public.exchange_rates where id = p_fx_snapshot_id) then
    raise exception 'exchange rate not found';
  end if;

  select id into v_operation_id from public.stock_operations where idempotency_key = p_idempotency_key;
  if v_operation_id is not null then return v_operation_id; end if;

  insert into public.inventory_batches(
    product_id, received_date, unit_cost_rmb_per_piece, fx_snapshot_id,
    total_received_packages, total_received_pieces, note, created_by
  ) values (
    p_product_id, v_received_date, v_unit_cost, p_fx_snapshot_id,
    p_packages, v_pieces, nullif(trim(p_note), ''), auth.uid()
  ) returning id into v_batch_id;

  insert into public.stock_operations(
    operation_type, warehouse_id, product_id, occurred_at, created_by, note, idempotency_key
  ) values (
    'inbound', p_warehouse_id, p_product_id,
    (v_received_date::timestamp at time zone 'Asia/Almaty'),
    auth.uid(), nullif(trim(p_note), ''), p_idempotency_key
  ) returning id into v_operation_id;

  insert into public.stock_operation_lines(operation_id, batch_id, package_delta, piece_delta)
  values (v_operation_id, v_batch_id, p_packages, v_pieces)
  returning id into v_line_id;

  insert into public.stock_movements(operation_line_id, warehouse_id, batch_id, package_delta, piece_delta)
  values (v_line_id, p_warehouse_id, v_batch_id, p_packages, v_pieces);

  insert into public.audit_log(actor_id, action, entity_type, entity_id, after_json)
  values (
    auth.uid(), 'create_inbound', 'stock_operation', v_operation_id,
    jsonb_build_object(
      'warehouse_id', p_warehouse_id,
      'product_id', p_product_id,
      'packages', p_packages,
      'pieces', v_pieces,
      'received_date', v_received_date,
      'fx_snapshot_id', p_fx_snapshot_id
    )
  );
  return v_operation_id;
end;
$$;

revoke all on function public.create_inbound(uuid, uuid, date, numeric, integer, numeric, uuid, text, uuid) from public;
grant execute on function public.create_inbound(uuid, uuid, date, numeric, integer, numeric, uuid, text, uuid) to authenticated;

create or replace view public.v_admin_batch_costs as
select
  balances.*,
  b.unit_cost_rmb_per_piece,
  balances.available_pieces * b.unit_cost_rmb_per_piece as historical_value_rmb,
  rates.cny_per_usd,
  rates.kzt_per_usd,
  case when rates.cny_per_usd is null then null
    else balances.available_pieces * b.unit_cost_rmb_per_piece / rates.cny_per_usd * rates.kzt_per_usd
  end as historical_value_kzt
from public.v_batch_balances balances
join public.inventory_batches b on b.id = balances.batch_id
left join public.exchange_rates rates on rates.id = b.fx_snapshot_id
where public.is_admin();

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
  case when snapshot.cny_per_usd is null then null
    else balances.available_pieces * b.unit_cost_rmb_per_piece
      / snapshot.cny_per_usd * snapshot.kzt_per_usd
  end as historical_value_kzt,
  current_rate.id as current_rate_id,
  current_rate.effective_date as current_rate_date,
  current_rate.cny_per_usd as current_cny_per_usd,
  current_rate.kzt_per_usd as current_kzt_per_usd,
  case when current_rate.cny_per_usd is null then null
    else balances.available_pieces * b.unit_cost_rmb_per_piece
      / current_rate.cny_per_usd * current_rate.kzt_per_usd
  end as current_value_kzt
from public.v_batch_balances balances
join public.warehouses w on w.id = balances.warehouse_id
join public.inventory_batches b on b.id = balances.batch_id
left join public.exchange_rates snapshot on snapshot.id = b.fx_snapshot_id
left join lateral (
  select r.id, r.effective_date, r.cny_per_usd, r.kzt_per_usd
  from public.exchange_rates r
  order by r.effective_date desc, r.created_at desc
  limit 1
) current_rate on true
where public.is_admin();

commit;
