begin;

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'warehouse_operator', 'finance');
create type public.warehouse_type as enum ('external', 'own');
create type public.transport_type as enum ('domestic_to_external', 'warehouse_transfer');
create type public.transport_status as enum ('draft', 'in_transit', 'partial_received', 'completed', 'exception');
create type public.operation_type as enum ('inbound', 'issue', 'transfer_dispatch', 'transfer_receipt', 'rollback', 'unrollback');
create type public.task_status as enum ('open', 'resolved');

create table public.warehouse_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  locale text not null default 'zh-CN' check (locale in ('zh-CN', 'ru', 'kk')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references public.warehouse_profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now()
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  warehouse_type public.warehouse_type not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.warehouse_members (
  user_id uuid not null references public.warehouse_profiles(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  primary key (user_id, warehouse_id)
);

create table public.warehouse_products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text,
  archived_at timestamptz,
  created_by uuid references public.warehouse_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.warehouse_products(id) on delete cascade,
  storage_path text not null unique,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_by uuid references public.warehouse_profiles(id),
  created_at timestamptz not null default now()
);

create unique index product_images_one_primary
  on public.product_images(product_id)
  where is_primary;

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  effective_date date not null,
  cny_per_usd numeric(18, 6) not null check (cny_per_usd > 0),
  kzt_per_usd numeric(18, 6) not null check (kzt_per_usd > 0),
  note text,
  entered_by uuid not null references public.warehouse_profiles(id),
  created_at timestamptz not null default now()
);

create index exchange_rates_effective_date_idx
  on public.exchange_rates(effective_date desc, created_at desc);

create table public.transport_orders (
  id uuid primary key default gen_random_uuid(),
  transport_no text not null unique,
  transport_type public.transport_type not null,
  source_warehouse_id uuid references public.warehouses(id),
  destination_warehouse_id uuid not null references public.warehouses(id),
  status public.transport_status not null default 'draft',
  shipped_at timestamptz,
  expected_arrival_at timestamptz,
  completed_at timestamptz,
  note text,
  created_by uuid not null references public.warehouse_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (transport_type = 'domestic_to_external' and source_warehouse_id is null)
    or
    (transport_type = 'warehouse_transfer' and source_warehouse_id is not null and source_warehouse_id <> destination_warehouse_id)
  )
);

create table public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.warehouse_products(id),
  source_transport_id uuid references public.transport_orders(id),
  received_date date not null,
  unit_cost_rmb_per_piece numeric(18, 4) not null check (unit_cost_rmb_per_piece >= 0),
  fx_snapshot_id uuid not null references public.exchange_rates(id),
  total_received_packages numeric(18, 3) not null default 0 check (total_received_packages >= 0),
  total_received_pieces integer not null default 0 check (total_received_pieces >= 0),
  note text,
  created_by uuid not null references public.warehouse_profiles(id),
  created_at timestamptz not null default now()
);

create table public.transport_lines (
  id uuid primary key default gen_random_uuid(),
  transport_id uuid not null references public.transport_orders(id) on delete cascade,
  product_id uuid not null references public.warehouse_products(id),
  source_batch_id uuid references public.inventory_batches(id),
  destination_batch_id uuid references public.inventory_batches(id),
  planned_packages numeric(18, 3) not null check (planned_packages > 0),
  planned_pieces integer not null check (planned_pieces > 0),
  unit_cost_rmb_per_piece numeric(18, 4) check (unit_cost_rmb_per_piece >= 0),
  created_at timestamptz not null default now()
);

create table public.transport_receipts (
  id uuid primary key default gen_random_uuid(),
  transport_line_id uuid not null references public.transport_lines(id),
  received_packages numeric(18, 3) not null check (received_packages > 0),
  received_pieces integer not null check (received_pieces > 0),
  received_at timestamptz not null,
  received_by uuid not null references public.warehouse_profiles(id),
  note text,
  created_at timestamptz not null default now()
);

create table public.transport_exceptions (
  id uuid primary key default gen_random_uuid(),
  transport_id uuid not null references public.transport_orders(id),
  kind text not null check (kind in ('shortage', 'lost', 'damaged', 'other')),
  reported_packages numeric(18, 3) not null default 0,
  reported_pieces integer not null default 0,
  reason text,
  resolved_by uuid references public.warehouse_profiles(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);

create table public.stock_operations (
  id uuid primary key default gen_random_uuid(),
  operation_type public.operation_type not null,
  warehouse_id uuid references public.warehouses(id),
  product_id uuid references public.warehouse_products(id),
  transport_id uuid references public.transport_orders(id),
  occurred_at timestamptz not null,
  created_by uuid not null references public.warehouse_profiles(id),
  note text,
  reversal_of_operation_id uuid references public.stock_operations(id),
  idempotency_key uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.stock_operation_lines (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.stock_operations(id) on delete cascade,
  batch_id uuid not null references public.inventory_batches(id),
  package_delta numeric(18, 3) not null,
  piece_delta integer not null,
  recipient_name text,
  check (package_delta <> 0 and piece_delta <> 0)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  operation_line_id uuid not null unique references public.stock_operation_lines(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id),
  batch_id uuid not null references public.inventory_batches(id),
  package_delta numeric(18, 3) not null,
  piece_delta integer not null,
  created_at timestamptz not null default now()
);

create index stock_movements_balance_idx
  on public.stock_movements(warehouse_id, batch_id);

create table public.reversal_links (
  original_operation_id uuid not null references public.stock_operations(id),
  reversal_operation_id uuid not null unique references public.stock_operations(id),
  reversed_by uuid not null references public.warehouse_profiles(id),
  reason text not null check (length(trim(reason)) >= 3),
  created_at timestamptz not null default now(),
  primary key (original_operation_id, reversal_operation_id)
);

create table public.admin_tasks (
  id uuid primary key default gen_random_uuid(),
  task_type text not null check (task_type in ('transport_exception', 'review_operation')),
  transport_id uuid references public.transport_orders(id),
  operation_id uuid references public.stock_operations(id),
  status public.task_status not null default 'open',
  assigned_to uuid references public.warehouse_profiles(id),
  resolved_by uuid references public.warehouse_profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (transport_id is not null or operation_id is not null)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.warehouse_profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles where user_id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

create or replace function public.can_access_warehouse(target_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or public.current_user_role() = 'finance'
    or exists (
      select 1 from public.warehouse_members
      where user_id = auth.uid() and warehouse_id = target_warehouse_id
    );
$$;

create view public.v_batch_balances as
select
  sm.warehouse_id,
  sm.batch_id,
  b.product_id,
  p.sku,
  p.name,
  b.received_date,
  sum(sm.package_delta) as available_packages,
  sum(sm.piece_delta) as available_pieces
from public.stock_movements sm
join public.inventory_batches b on b.id = sm.batch_id
join public.warehouse_products p on p.id = b.product_id
group by sm.warehouse_id, sm.batch_id, b.product_id, p.sku, p.name, b.received_date;

create view public.v_operator_stock as
select
  balances.warehouse_id,
  balances.batch_id,
  balances.product_id,
  balances.sku,
  balances.name,
  balances.received_date,
  balances.available_packages,
  balances.available_pieces
from public.v_batch_balances balances
where public.current_user_role() in ('admin', 'warehouse_operator')
  and public.can_access_warehouse(balances.warehouse_id);

create view public.v_finance_ledger as
select
  o.id,
  o.operation_type,
  o.warehouse_id,
  w.name as warehouse_name,
  p.sku,
  p.name as product_name,
  l.package_delta,
  l.piece_delta,
  l.recipient_name,
  o.occurred_at,
  o.note,
  o.created_by
from public.stock_operations o
join public.stock_operation_lines l on l.operation_id = o.id
join public.warehouses w on w.id = o.warehouse_id
join public.inventory_batches b on b.id = l.batch_id
join public.warehouse_products p on p.id = b.product_id
where public.current_user_role() in ('admin', 'finance');

create view public.v_admin_batch_costs as
select
  balances.*,
  b.unit_cost_rmb_per_piece,
  balances.available_pieces * b.unit_cost_rmb_per_piece as historical_value_rmb,
  rates.cny_per_usd,
  rates.kzt_per_usd,
  balances.available_pieces * b.unit_cost_rmb_per_piece / rates.cny_per_usd * rates.kzt_per_usd as historical_value_kzt
from public.v_batch_balances balances
join public.inventory_batches b on b.id = balances.batch_id
join public.exchange_rates rates on rates.id = b.fx_snapshot_id
where public.is_admin();

create or replace function public.create_issue(
  p_warehouse_id uuid,
  p_occurred_at timestamptz,
  p_recipient_name text,
  p_note text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_id uuid;
  v_product_id uuid;
  v_line jsonb;
  v_balance record;
  v_line_id uuid;
begin
  if public.current_user_role() not in ('admin', 'warehouse_operator') then
    raise exception 'not allowed';
  end if;
  if not public.can_access_warehouse(p_warehouse_id) then
    raise exception 'warehouse not allowed';
  end if;
  if nullif(trim(p_recipient_name), '') is null then
    raise exception 'recipient is required';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one batch is required';
  end if;

  select id into v_operation_id from public.stock_operations where idempotency_key = p_idempotency_key;
  if v_operation_id is not null then return v_operation_id; end if;

  select product_id into v_product_id
  from public.inventory_batches
  where id = (p_lines->0->>'batch_id')::uuid;

  insert into public.stock_operations (
    operation_type, warehouse_id, product_id, occurred_at, created_by, note, idempotency_key
  ) values (
    'issue', p_warehouse_id, v_product_id, p_occurred_at, auth.uid(), p_note, p_idempotency_key
  ) returning id into v_operation_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    perform pg_advisory_xact_lock(hashtextextended((v_line->>'batch_id')::text, 0));
    select * into v_balance
    from public.v_batch_balances
    where warehouse_id = p_warehouse_id and batch_id = (v_line->>'batch_id')::uuid;

    if v_balance.batch_id is null then raise exception 'batch not found'; end if;
    if v_balance.product_id <> v_product_id then raise exception 'all batches must share one product'; end if;
    if (v_line->>'packages')::numeric <= 0 or (v_line->>'pieces')::integer <= 0 then raise exception 'quantities must be positive'; end if;
    if (v_line->>'packages')::numeric > v_balance.available_packages
       or (v_line->>'pieces')::integer > v_balance.available_pieces then
      raise exception 'quantity exceeds batch balance';
    end if;

    insert into public.stock_operation_lines (
      operation_id, batch_id, package_delta, piece_delta, recipient_name
    ) values (
      v_operation_id,
      (v_line->>'batch_id')::uuid,
      -((v_line->>'packages')::numeric),
      -((v_line->>'pieces')::integer),
      trim(p_recipient_name)
    ) returning id into v_line_id;

    insert into public.stock_movements (
      operation_line_id, warehouse_id, batch_id, package_delta, piece_delta
    ) values (
      v_line_id,
      p_warehouse_id,
      (v_line->>'batch_id')::uuid,
      -((v_line->>'packages')::numeric),
      -((v_line->>'pieces')::integer)
    );
  end loop;

  insert into public.admin_tasks(task_type, operation_id) values ('review_operation', v_operation_id);
  insert into public.audit_log(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'create_issue', 'stock_operation', v_operation_id, jsonb_build_object('lines', p_lines));
  return v_operation_id;
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
begin
  if not public.is_admin() then raise exception 'administrator required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason is required'; end if;

  select id into v_reversal_id from public.stock_operations where idempotency_key = p_idempotency_key;
  if v_reversal_id is not null then return v_reversal_id; end if;

  select * into v_original from public.stock_operations where id = p_operation_id for update;
  if v_original.id is null then raise exception 'operation not found'; end if;

  v_kind := case when v_original.operation_type = 'rollback' then 'unrollback'::public.operation_type else 'rollback'::public.operation_type end;
  insert into public.stock_operations (
    operation_type, warehouse_id, product_id, transport_id, occurred_at, created_by, note,
    reversal_of_operation_id, idempotency_key
  ) values (
    v_kind, v_original.warehouse_id, v_original.product_id, v_original.transport_id, now(), auth.uid(), p_reason,
    v_original.id, p_idempotency_key
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
  insert into public.audit_log(actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), v_kind::text, 'stock_operation', p_operation_id, trim(p_reason));
  return v_reversal_id;
end;
$$;

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
  select * into v_order from public.transport_orders where id = v_line.transport_id;
  if not public.can_access_warehouse(v_order.destination_warehouse_id) then raise exception 'destination warehouse not allowed'; end if;

  select v_line.planned_packages - coalesce(sum(received_packages), 0),
         v_line.planned_pieces - coalesce(sum(received_pieces), 0)
    into v_remaining_packages, v_remaining_pieces
    from public.transport_receipts where transport_line_id = v_line.id;
  if p_received_packages > v_remaining_packages or p_received_pieces > v_remaining_pieces then
    raise exception 'received quantity exceeds transport balance';
  end if;

  insert into public.transport_receipts(id, transport_line_id, received_packages, received_pieces, received_at, received_by, note)
  values (p_idempotency_key, p_transport_line_id, p_received_packages, p_received_pieces, p_received_at, auth.uid(), p_note)
  returning id into v_receipt_id;

  if v_line.destination_batch_id is null then
    select id into v_fx_id from public.exchange_rates order by effective_date desc, created_at desc limit 1;
    if v_fx_id is null then raise exception 'an exchange rate is required before receiving'; end if;
    insert into public.inventory_batches(product_id, source_transport_id, received_date, unit_cost_rmb_per_piece, fx_snapshot_id, total_received_packages, total_received_pieces, created_by)
    values (v_line.product_id, v_order.id, (p_received_at at time zone 'Asia/Almaty')::date, coalesce(v_line.unit_cost_rmb_per_piece, 0), v_fx_id, p_received_packages, p_received_pieces, auth.uid())
    returning id into v_batch_id;
    update public.transport_lines set destination_batch_id = v_batch_id where id = v_line.id;
  else
    v_batch_id := v_line.destination_batch_id;
    update public.inventory_batches
    set total_received_packages = total_received_packages + p_received_packages,
        total_received_pieces = total_received_pieces + p_received_pieces
    where id = v_batch_id;
  end if;

  insert into public.stock_operations(operation_type, warehouse_id, product_id, transport_id, occurred_at, created_by, note)
  values ('transfer_receipt', v_order.destination_warehouse_id, v_line.product_id, v_order.id, p_received_at, auth.uid(), p_note)
  returning id into v_operation_id;
  insert into public.stock_operation_lines(operation_id, batch_id, package_delta, piece_delta)
  values (v_operation_id, v_batch_id, p_received_packages, p_received_pieces)
  returning id into v_operation_line_id;
  insert into public.stock_movements(operation_line_id, warehouse_id, batch_id, package_delta, piece_delta)
  values (v_operation_line_id, v_order.destination_warehouse_id, v_batch_id, p_received_packages, p_received_pieces);

  update public.transport_orders o
  set status = case when exists (
      select 1 from public.transport_lines tl
      where tl.transport_id = o.id and tl.planned_packages > (
        select coalesce(sum(tr.received_packages), 0) from public.transport_receipts tr where tr.transport_line_id = tl.id
      )
    ) then 'partial_received'::public.transport_status else 'completed'::public.transport_status end,
    completed_at = case when not exists (
      select 1 from public.transport_lines tl
      where tl.transport_id = o.id and tl.planned_packages > (
        select coalesce(sum(tr.received_packages), 0) from public.transport_receipts tr where tr.transport_line_id = tl.id
      )
    ) then now() else null end,
    updated_at = now()
  where o.id = v_order.id;
  insert into public.audit_log(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'receive_transport', 'transport_receipt', v_receipt_id, jsonb_build_object('packages', p_received_packages, 'pieces', p_received_pieces));
  return v_receipt_id;
end;
$$;

alter table public.warehouse_profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.warehouses enable row level security;
alter table public.warehouse_members enable row level security;
alter table public.warehouse_products enable row level security;
alter table public.product_images enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.transport_orders enable row level security;
alter table public.transport_lines enable row level security;
alter table public.transport_receipts enable row level security;
alter table public.transport_exceptions enable row level security;
alter table public.stock_operations enable row level security;
alter table public.stock_operation_lines enable row level security;
alter table public.stock_movements enable row level security;
alter table public.reversal_links enable row level security;
alter table public.admin_tasks enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_read_self_or_admin on public.warehouse_profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_admin_write on public.warehouse_profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy roles_read_self_or_admin on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy roles_admin_write on public.user_roles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy warehouses_read_allowed on public.warehouses
  for select to authenticated using (public.can_access_warehouse(id));
create policy warehouses_admin_write on public.warehouses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy members_read_self_or_admin on public.warehouse_members
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy members_admin_write on public.warehouse_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy products_read_authenticated on public.warehouse_products
  for select to authenticated using (true);
create policy products_admin_write on public.warehouse_products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy images_read_authenticated on public.product_images
  for select to authenticated using (true);
create policy images_admin_write on public.product_images
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy rates_admin_only on public.exchange_rates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy batches_admin_only on public.inventory_batches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy transports_read_allowed on public.transport_orders
  for select to authenticated using (
    public.is_admin() or public.current_user_role() = 'finance'
    or public.can_access_warehouse(destination_warehouse_id)
  );
create policy transports_admin_write on public.transport_orders
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy transport_lines_admin_only on public.transport_lines
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy receipts_read_allowed on public.transport_receipts
  for select to authenticated using (
    exists (
      select 1 from public.transport_lines l
      join public.transport_orders o on o.id = l.transport_id
      where l.id = transport_line_id
        and (public.is_admin() or public.current_user_role() = 'finance' or public.can_access_warehouse(o.destination_warehouse_id))
    )
  );
create policy receipts_insert_operator on public.transport_receipts
  for insert to authenticated with check (
    received_by = auth.uid()
    and exists (
      select 1 from public.transport_lines l
      join public.transport_orders o on o.id = l.transport_id
      where l.id = transport_line_id and public.can_access_warehouse(o.destination_warehouse_id)
    )
  );
create policy exceptions_admin_finance_read on public.transport_exceptions
  for select to authenticated using (public.is_admin() or public.current_user_role() = 'finance');
create policy exceptions_admin_write on public.transport_exceptions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy operations_read_allowed on public.stock_operations
  for select to authenticated using (public.can_access_warehouse(warehouse_id));
create policy operation_lines_read_allowed on public.stock_operation_lines
  for select to authenticated using (
    exists (select 1 from public.stock_operations o where o.id = operation_id and public.can_access_warehouse(o.warehouse_id))
  );
create policy movements_read_allowed on public.stock_movements
  for select to authenticated using (public.can_access_warehouse(warehouse_id));
create policy reversal_admin_only on public.reversal_links
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tasks_read_allowed on public.admin_tasks
  for select to authenticated using (public.is_admin() or assigned_to = auth.uid());
create policy tasks_admin_write on public.admin_tasks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy audit_admin_only on public.audit_log
  for select to authenticated using (public.is_admin());

revoke all on public.exchange_rates, public.inventory_batches, public.transport_lines from anon, authenticated;
grant select, insert, update, delete on public.exchange_rates, public.inventory_batches, public.transport_lines to authenticated;
revoke all on public.v_batch_balances from anon, authenticated;
grant select on public.v_operator_stock, public.v_finance_ledger, public.v_admin_batch_costs to authenticated;
grant execute on function public.create_issue(uuid, timestamptz, text, text, jsonb, uuid) to authenticated;
grant execute on function public.reverse_operation(uuid, text, uuid) to authenticated;
grant execute on function public.receive_transport(uuid, numeric, integer, timestamptz, text, uuid) to authenticated;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', false)
on conflict (id) do nothing;

create policy product_images_read on storage.objects
  for select to authenticated using (bucket_id = 'product-images');
create policy product_images_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_admin());

insert into public.warehouses(code, name, warehouse_type)
values
  ('EXTERNAL', '他人库房', 'external'),
  ('OWN', '自有库房', 'own')
on conflict (code) do nothing;

commit;
