import { useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpRight, Boxes, Check, Download, Image, PackageCheck, Truck, Undo2 } from 'lucide-react'
import { Empty } from './components'
import { supabase } from './lib/supabase'
import type { AppData, InventoryRow, Locale, OperationRow, Page, Role, Translator, TransportRow, UserAccess, Warehouse } from './types'

const num = (value: number, locale: Locale, digits = 3) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)
const money = (value: number, locale: Locale, currency: 'CNY' | 'KZT') => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: currency === 'KZT' ? 0 : 2 }).format(value)
const date = (value: string, locale: Locale, withTime = false) => new Intl.DateTimeFormat(locale, withTime ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Almaty' } : { dateStyle: 'medium', timeZone: 'Asia/Almaty' }).format(new Date(value.length === 10 ? `${value}T12:00:00+05:00` : value))

const operationLabel = (row: OperationRow, t: Translator) => ({ inbound: t('inboundType'), issue: t('issueType'), transfer_dispatch: t('transfer_dispatch'), transfer_receipt: t('transfer_receipt'), rollback: t('rollbackType'), unrollback: t('unrollbackType') }[row.operation_type])
const statusLabel = (row: TransportRow, t: Translator) => t(row.status)

function csvDownload(name: string, header: string[], rows: Array<Array<string | number | null>>) {
  const encode = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const body = [header, ...rows].map((line) => line.map(encode).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([`\ufeff${body}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url)
}

export function OverviewPage({ data, role, locale, t, navigate, onTaskSaved }: { data: AppData; role: Role; locale: Locale; t: Translator; navigate: (page: Page) => void; onTaskSaved: (message: string) => Promise<void> }) {
  const [taskBusy, setTaskBusy] = useState('')
  const [taskError, setTaskError] = useState('')
  const availablePackages = data.inventory.reduce((sum, row) => sum + Number(row.available_packages), 0)
  const availablePieces = data.inventory.reduce((sum, row) => sum + Number(row.available_pieces), 0)
  const transitPackages = data.transports.reduce((sum, row) => sum + Number(row.remaining_packages), 0)
  const transitPieces = data.transports.reduce((sum, row) => sum + Number(row.remaining_pieces), 0)
  const rmb = data.costs.reduce((sum, row) => sum + Number(row.value_rmb), 0)
  const kzt = data.costs.reduce((sum, row) => sum + (row.current_value_kzt == null ? 0 : Number(row.current_value_kzt)), 0)
  async function resolveTask(taskId: string) {
    if (!supabase) return
    setTaskBusy(taskId); setTaskError('')
    const result = await supabase.rpc('resolve_admin_task', { p_task_id: taskId })
    if (result.error) setTaskError(result.error.message); else await onTaskSaved(t('taskReviewed'))
    setTaskBusy('')
  }
  return <div className="page-stack">
    <div className="data-truth"><PackageCheck size={17} /><span>{t('overviewHint')}</span></div>
    <section className="metric-grid">
      <button className="metric metric-link" onClick={() => navigate('inventory')}><span>{t('available')}</span><strong className="metric-value">{num(availablePieces, locale, 0)}</strong><small>{num(availablePackages, locale)} {t('packages')} / {num(availablePieces, locale, 0)} {t('pieces')}</small></button>
      <button className="metric metric-link" onClick={() => navigate('transport')}><span>{t('inTransit')}</span><strong className="metric-value">{num(transitPieces, locale, 0)}</strong><small>{num(transitPackages, locale)} {t('packages')} / {num(transitPieces, locale, 0)} {t('pieces')}</small></button>
      <button className="metric metric-link" onClick={() => navigate('history')}><span>{t('recentOperations')}</span><strong className="metric-value">{data.operations.length}</strong><small>{t('inbound')} · {t('issue')} · {t('transport')}</small></button>
      {role === 'admin' && <button className="metric metric-link metric-cost" onClick={() => navigate('inventory')}><span>{t('currentValue')}</span><strong className="metric-value">{money(kzt, locale, 'KZT')}</strong><small>{money(rmb, locale, 'CNY')}</small></button>}
    </section>
    {role === 'admin' && <section className="panel table-panel"><div className="panel-heading"><div><h2>{t('pendingReview')}</h2><p>{data.tasks.length ? `${data.tasks.length} ${t('pendingCount')}` : t('noPending')}</p></div></div>
      {taskError && <div className="inline-alert error task-error">{taskError}</div>}
      {data.tasks.length ? <div className="ledger-list">{data.tasks.map((task) => <div className="ledger-row review-row" key={task.id}><span className="operation-sign negative"><ArrowUpRight size={15} /></span><span><strong>{task.sku ?? '-'} {task.product_name ?? ''}</strong><small>{task.recipient_name ?? '-'} · {task.created_by_name ?? '-'} · {task.warehouse_name ?? '-'}</small></span><span className="negative-text">{num(task.package_delta, locale)} {t('packages')} / {num(task.piece_delta, locale, 0)} {t('pieces')}</span><time>{date(task.occurred_at, locale, true)}</time><button className="button button-small" disabled={taskBusy === task.id} onClick={() => void resolveTask(task.id)}><Check size={14} />{taskBusy === task.id ? '…' : t('markReviewed')}</button></div>)}</div> : <Empty text={t('noPending')} />}
    </section>}
    <section className="panel table-panel"><div className="panel-heading"><div><h2>{t('recentOperations')}</h2><p>{role === 'finance' ? t('financeNoCost') : t('pendingReview')}</p></div></div>
      {data.operations.length ? <div className="ledger-list">{data.operations.slice(0, 7).map((row) => <button className="ledger-row ledger-row-button" key={row.id} onClick={() => navigate('history')}><span className={`operation-sign ${row.piece_delta >= 0 ? 'positive' : 'negative'}`}>{row.piece_delta >= 0 ? <ArrowDownToLine size={15} /> : <ArrowUpRight size={15} />}</span><span><strong>{operationLabel(row, t)} · {row.sku ?? '-'}</strong><small>{row.warehouse_name ?? '-'} · {row.created_by_name ?? '-'}</small></span><span className={row.piece_delta >= 0 ? 'positive-text' : 'negative-text'}>{row.piece_delta > 0 ? '+' : ''}{row.piece_delta} {t('pieces')}</span><time>{date(row.occurred_at, locale, true)}</time></button>)}</div> : <Empty text={t('noData')} />}
    </section>
  </div>
}

export function InventoryPage({ data, role, locale, t, warehouseFilter, setWarehouseFilter }: { data: AppData; role: Role; locale: Locale; t: Translator; warehouseFilter: string; setWarehouseFilter: (value: string) => void }) {
  const [search, setSearch] = useState('')
  const rows = useMemo(() => data.inventory.filter((row) => (warehouseFilter === 'all' || row.warehouse_id === warehouseFilter) && `${row.sku} ${row.name ?? ''}`.toLowerCase().includes(search.toLowerCase())), [data.inventory, search, warehouseFilter])
  const costMap = new Map(data.costs.map((row) => [`${row.warehouse_id}-${row.batch_id}`, row]))
  const exportRows = () => csvDownload(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, role === 'admin' ? ['Warehouse', 'SKU', 'Style', 'Batch', 'Received', 'Packages', 'Pieces', 'CNY/Piece', 'Value CNY', 'Current value KZT'] : ['Warehouse', 'SKU', 'Style', 'Batch', 'Received', 'Packages', 'Pieces'], rows.map((row) => {
    const cost = costMap.get(`${row.warehouse_id}-${row.batch_id}`)
    return role === 'admin' ? [row.warehouse_name, row.sku, row.name, row.batch_id, row.received_date, row.available_packages, row.available_pieces, cost?.unit_cost_rmb_per_piece ?? '', cost?.value_rmb ?? '', cost?.current_value_kzt ?? ''] : [row.warehouse_name, row.sku, row.name, row.batch_id, row.received_date, row.available_packages, row.available_pieces]
  }))
  return <section className="panel table-panel"><div className="panel-heading filter-heading"><div><h2>{t('inventory')}</h2><p>{role === 'finance' ? t('financeNoCost') : `${rows.length} ${t('batch')}`}</p></div><div className="table-tools"><input className="search-input" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} /><select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}><option value="all">{t('allWarehouses')}</option>{data.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select><button className="button button-quiet" onClick={exportRows}><Download size={15} />{t('export')}</button></div></div>
    {rows.length ? <div className="table-scroll"><table><thead><tr><th>{t('warehouse')}</th><th>{t('productNumber')}</th><th>{t('styleName')}</th><th>{t('batch')}</th><th>{t('effectiveDate')}</th><th>{t('packages')}</th><th>{t('pieces')}</th>{role === 'admin' && <><th>{t('purchasePrice')}</th><th>{t('currentValue')}</th></>}</tr></thead><tbody>{rows.map((row) => { const cost = costMap.get(`${row.warehouse_id}-${row.batch_id}`); return <tr key={`${row.warehouse_id}-${row.batch_id}`}><td>{row.warehouse_name}</td><td><strong>{row.sku}</strong></td><td>{row.name || '-'}</td><td className="mono">{row.batch_id.slice(0, 8)}</td><td>{date(row.received_date, locale)}</td><td>{num(row.available_packages, locale)}</td><td>{num(row.available_pieces, locale, 0)}</td>{role === 'admin' && <><td>{cost ? money(cost.unit_cost_rmb_per_piece, locale, 'CNY') : '-'}</td><td>{cost?.current_value_kzt == null ? '-' : money(cost.current_value_kzt, locale, 'KZT')}</td></>}</tr> })}</tbody></table></div> : <Empty text={t('noData')} />}
  </section>
}

export function InboundPage({ data, locale, t, onOpen }: { data: AppData; locale: Locale; t: Translator; onOpen: () => void }) {
  const rows = data.operations.filter((row) => row.operation_type === 'inbound')
  return <div className="page-stack"><div className="workflow-note"><Boxes size={18} /><div><strong>{t('addInbound')}</strong><span>{t('externalInboundHint')}</span></div><button className="button button-primary" onClick={onOpen}>{t('addInbound')}</button></div><OperationTable rows={rows} locale={locale} t={t} /></div>
}

export function IssuePage({ data, locale, t, canIssue, onOpen }: { data: AppData; locale: Locale; t: Translator; canIssue: boolean; onOpen: () => void }) {
  const rows = data.operations.filter((row) => row.operation_type === 'issue')
  return <div className="page-stack"><div className="workflow-note"><ArrowUpRight size={18} /><div><strong>{t('addIssue')}</strong><span>{t('issueQuantityHint')}</span></div>{canIssue && <button className="button button-primary" onClick={onOpen}>{t('addIssue')}</button>}</div><OperationTable rows={rows} locale={locale} t={t} /></div>
}

function OperationTable({ rows, locale, t }: { rows: OperationRow[]; locale: Locale; t: Translator }) {
  return <section className="panel table-panel">{rows.length ? <div className="table-scroll"><table><thead><tr><th>{t('operationType')}</th><th>{t('warehouse')}</th><th>{t('product')}</th><th>{t('packages')}</th><th>{t('pieces')}</th><th>{t('recipient')}</th><th>{t('createdBy')}</th><th>{t('effectiveDate')}</th><th>{t('note')}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{operationLabel(row, t)}</td><td>{row.warehouse_name ?? '-'}</td><td><strong>{row.sku ?? '-'}</strong> {row.product_name ?? ''}</td><td className={row.package_delta >= 0 ? 'positive-text' : 'negative-text'}>{row.package_delta > 0 ? '+' : ''}{num(row.package_delta, locale)}</td><td className={row.piece_delta >= 0 ? 'positive-text' : 'negative-text'}>{row.piece_delta > 0 ? '+' : ''}{num(row.piece_delta, locale, 0)}</td><td>{row.recipient_name ?? '-'}</td><td>{row.created_by_name ?? '-'}</td><td>{date(row.occurred_at, locale, true)}</td><td>{row.note ?? '-'}</td></tr>)}</tbody></table></div> : <Empty text={t('noData')} />}</section>
}

export function TransportPage({ data, role, locale, t, onCreate, onReceive }: { data: AppData; role: Role; locale: Locale; t: Translator; onCreate: () => void; onReceive: (row: TransportRow) => void }) {
  const canReceive = role === 'admin' || role === 'warehouse_operator'
  return <div className="page-stack">{role === 'admin' && <div className="workflow-note"><Truck size={18} /><div><strong>{t('addTransport')}</strong><span>{t('transferHint')}</span></div><button className="button button-primary" onClick={onCreate}>{t('addTransport')}</button></div>}
    <section className="panel table-panel">{data.transports.length ? <div className="table-scroll"><table><thead><tr><th>{t('transportNumber')}</th><th>{t('transportType')}</th><th>{t('product')}</th><th>{t('fromWarehouse')}</th><th>{t('toWarehouse')}</th><th>{t('status')}</th><th>{t('inTransit')}</th><th>{t('expectedArrival')}</th><th>{t('action')}</th></tr></thead><tbody>{data.transports.map((row) => <tr key={row.line_id}><td><strong>{row.transport_no}</strong></td><td>{row.transport_type === 'domestic_to_external' ? t('domestic') : t('transfer')}</td><td>{row.sku} {row.product_name ?? ''}</td><td>{row.source_warehouse_name ?? t('domestic')}</td><td>{row.destination_warehouse_name}</td><td><span className={`status-pill status-${row.status}`}>{statusLabel(row, t)}</span></td><td>{num(row.remaining_packages, locale)} {t('packages')} / {num(row.remaining_pieces, locale, 0)} {t('pieces')}</td><td>{row.expected_arrival_at ? date(row.expected_arrival_at, locale, true) : '-'}</td><td>{canReceive && ['in_transit', 'partial_received'].includes(row.status) && row.remaining_packages > 0 && row.remaining_pieces > 0 ? <button className="button button-small" onClick={() => onReceive(row)}>{t('receive')}</button> : '—'}</td></tr>)}</tbody></table></div> : <Empty text={t('noData')} />}</section>
  </div>
}

export function HistoryPage({ data, role, locale, t, onRollback }: { data: AppData; role: Role; locale: Locale; t: Translator; onRollback: (row: OperationRow) => void }) {
  const exportRows = () => csvDownload(`operations-${new Date().toISOString().slice(0, 10)}.csv`, ['Type', 'Warehouse', 'SKU', 'Style', 'Packages', 'Pieces', 'Recipient', 'Operator', 'Date', 'Note', 'Reversed'], data.operations.map((row) => [operationLabel(row, t), row.warehouse_name, row.sku, row.product_name, row.package_delta, row.piece_delta, row.recipient_name, row.created_by_name, row.occurred_at, row.note, row.is_reversed ? t('reversed') : '']))
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>{t('history')}</h2><p>{role === 'finance' ? t('financeNoCost') : t('pendingReview')}</p></div><button className="button button-quiet" onClick={exportRows}><Download size={15} />{t('export')}</button></div>{data.operations.length ? <div className="table-scroll"><table><thead><tr><th>{t('operationType')}</th><th>{t('product')}</th><th>{t('warehouse')}</th><th>{t('packages')}</th><th>{t('pieces')}</th><th>{t('createdBy')}</th><th>{t('effectiveDate')}</th><th>{t('status')}</th><th>{t('action')}</th></tr></thead><tbody>{data.operations.map((row) => <tr key={row.id}><td>{operationLabel(row, t)}</td><td>{row.sku ?? '-'} {row.product_name ?? ''}</td><td>{row.warehouse_name ?? '-'}</td><td className={row.package_delta >= 0 ? 'positive-text' : 'negative-text'}>{row.package_delta > 0 ? '+' : ''}{num(row.package_delta, locale)}</td><td className={row.piece_delta >= 0 ? 'positive-text' : 'negative-text'}>{row.piece_delta > 0 ? '+' : ''}{num(row.piece_delta, locale, 0)}</td><td>{row.created_by_name ?? '-'}</td><td>{date(row.occurred_at, locale, true)}</td><td>{row.is_reversed ? <span className="status-pill status-exception">{t('reversed')}</span> : '—'}</td><td>{role === 'admin' && !row.is_reversed ? <button className="button button-small button-outline-danger" onClick={() => onRollback(row)}><Undo2 size={14} />{row.operation_type === 'rollback' ? t('undoRollback') : t('rollback')}</button> : '—'}</td></tr>)}</tbody></table></div> : <Empty text={t('noData')} />}</section>
}

export function ProductsPage({ data, t, onOpen }: { data: AppData; t: Translator; onOpen: () => void }) {
  return <div className="page-stack"><div className="section-actions"><button className="button button-primary" onClick={onOpen}>{t('addProduct')}</button></div>{data.products.length ? <div className="product-grid-real">{data.products.map((product) => <article className="product-card-real" key={product.id}><div className="product-image-real">{product.image_url ? <img src={product.image_url} alt={product.name ?? product.sku} /> : <Image size={24} />}</div><div><strong>{product.sku}</strong><span>{product.name || '—'}</span></div></article>)}</div> : <Empty text={t('noData')} />}</div>
}

export function RatesPage({ data, locale, t, onOpen }: { data: AppData; locale: Locale; t: Translator; onOpen: () => void }) {
  return <div className="page-stack"><div className="section-actions"><button className="button button-primary" onClick={onOpen}>{t('addRate')}</button></div><section className="panel table-panel">{data.rates.length ? <div className="table-scroll"><table><thead><tr><th>{t('effectiveDate')}</th><th>{t('cnyPerUsd')}</th><th>{t('kztPerUsd')}</th><th>{t('note')}</th><th>{t('createdBy')}</th></tr></thead><tbody>{data.rates.map((rate) => <tr key={rate.id}><td>{date(rate.effective_date, locale)}</td><td>{num(rate.cny_per_usd, locale, 6)}</td><td>{num(rate.kzt_per_usd, locale, 6)}</td><td>{rate.note ?? '-'}</td><td>{date(rate.created_at, locale, true)}</td></tr>)}</tbody></table></div> : <Empty text={t('noData')} />}</section></div>
}

export function UsersPage({ data, t, onSaved }: { data: AppData; t: Translator; onSaved: (message: string) => Promise<void> }) {
  return <div className="page-stack"><div className="data-truth"><span>{t('usersHint')}</span></div><div className="user-access-list">{data.users.length ? data.users.map((user) => <UserAccessRow key={user.id} user={user} warehouses={data.warehouses} t={t} onSaved={onSaved} />) : <Empty text={t('noData')} />}</div></div>
}

function UserAccessRow({ user, warehouses, t, onSaved }: { user: UserAccess; warehouses: Warehouse[]; t: Translator; onSaved: (message: string) => Promise<void> }) {
  const [role, setRole] = useState<Role>(user.role)
  const [active, setActive] = useState(user.is_active)
  const [warehouseIds, setWarehouseIds] = useState(user.warehouse_ids)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    if (!supabase) return
    setBusy(true); setError('')
    const result = await supabase.rpc('update_user_access', { p_user_id: user.id, p_role: role, p_is_active: active, p_warehouse_ids: role === 'warehouse_operator' ? warehouseIds : [] })
    if (result.error) setError(result.error.message); else await onSaved(t('accessSaved'))
    setBusy(false)
  }
  return <article className="user-access-card"><div className="user-access-name"><span className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</span><div><strong>{user.display_name}</strong><small>{user.id.slice(0, 8)}</small></div></div><label>{t('role')}<select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="admin">{t('admin')}</option><option value="warehouse_operator">{t('operator')}</option><option value="finance">{t('finance')}</option></select></label><label className="toggle-field"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{active ? t('active') : t('inactive')}</label>{role === 'warehouse_operator' && <div className="warehouse-checks"><span>{t('assignedWarehouses')}</span>{warehouses.map((warehouse) => <label key={warehouse.id}><input type="checkbox" checked={warehouseIds.includes(warehouse.id)} onChange={(e) => setWarehouseIds(e.target.checked ? [...warehouseIds, warehouse.id] : warehouseIds.filter((id) => id !== warehouse.id))} />{warehouse.name}</label>)}</div>}<button className="button button-small" onClick={save} disabled={busy}>{busy ? '…' : t('saveAccess')}</button>{error && <div className="inline-alert error">{error}</div>}</article>
}
