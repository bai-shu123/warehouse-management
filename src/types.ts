export type Locale = 'zh-CN' | 'ru' | 'kk'
export type Role = 'admin' | 'warehouse_operator' | 'finance'
export type Page = 'overview' | 'inventory' | 'inbound' | 'transport' | 'issue' | 'history' | 'products' | 'rates' | 'users'

export type Warehouse = {
  id: string
  code: string
  name: string
  warehouse_type: 'external' | 'own'
  is_active: boolean
}

export type Product = {
  id: string
  sku: string
  name: string | null
  archived_at: string | null
  image_url?: string | null
}

export type InventoryRow = {
  warehouse_id: string
  warehouse_name: string
  batch_id: string
  product_id: string
  sku: string
  name: string | null
  received_date: string
  available_packages: number
  available_pieces: number
}

export type CostRow = InventoryRow & {
  unit_cost_rmb_per_piece: number
  value_rmb: number
  historical_value_kzt: number
  current_value_kzt: number
  current_rate_date: string
}

export type TransportRow = {
  id: string
  transport_no: string
  transport_type: 'domestic_to_external' | 'warehouse_transfer'
  source_warehouse_id: string | null
  source_warehouse_name: string | null
  destination_warehouse_id: string
  destination_warehouse_name: string
  status: 'draft' | 'in_transit' | 'partial_received' | 'completed' | 'exception'
  shipped_at: string
  expected_arrival_at: string | null
  note: string | null
  line_id: string
  product_id: string
  sku: string
  product_name: string | null
  source_batch_id: string | null
  planned_packages: number
  planned_pieces: number
  received_packages: number
  received_pieces: number
  remaining_packages: number
  remaining_pieces: number
  unit_cost_rmb_per_piece: number | null
}

export type OperationRow = {
  id: string
  operation_type: 'inbound' | 'issue' | 'transfer_dispatch' | 'transfer_receipt' | 'rollback' | 'unrollback'
  warehouse_id: string | null
  warehouse_name: string | null
  sku: string | null
  product_name: string | null
  package_delta: number
  piece_delta: number
  recipient_name: string | null
  occurred_at: string
  note: string | null
  created_by: string
  created_by_name: string | null
  reversal_of_operation_id: string | null
  is_reversed: boolean
}

export type ExchangeRate = {
  id: string
  effective_date: string
  cny_per_usd: number
  kzt_per_usd: number
  note: string | null
  entered_by: string
  created_at: string
}

export type UserAccess = {
  id: string
  display_name: string
  locale: Locale
  is_active: boolean
  role: Role
  warehouse_ids: string[]
}

export type AdminTask = {
  id: string
  operation_id: string
  status: 'open' | 'resolved'
  created_at: string
  warehouse_name: string | null
  sku: string | null
  product_name: string | null
  package_delta: number
  piece_delta: number
  recipient_name: string | null
  occurred_at: string
  created_by_name: string | null
}

export type AppData = {
  warehouses: Warehouse[]
  products: Product[]
  inventory: InventoryRow[]
  costs: CostRow[]
  transports: TransportRow[]
  operations: OperationRow[]
  rates: ExchangeRate[]
  users: UserAccess[]
  tasks: AdminTask[]
}

export type Translator = (key: string) => string
