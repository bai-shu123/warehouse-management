import { useMemo, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { AlertTriangle, LockKeyhole, Search } from 'lucide-react'
import { Modal } from './components'
import { supabase } from './lib/supabase'
import type { ExchangeRate, InventoryRow, Locale, OperationRow, Product, Translator, TransportRow, Warehouse } from './types'

type Saved = (message: string) => Promise<void> | void
type BaseProps = { t: Translator; onClose: () => void; onSaved: Saved }

const almatyParts = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date()).reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {})

export const almatyDate = () => {
  const p = almatyParts()
  return `${p.year}-${p.month}-${p.day}`
}

export const almatyDateTime = () => {
  const p = almatyParts()
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

const toAlmatyIso = (value: string) => new Date(`${value}:00+05:00`).toISOString()
const errorText = (error: unknown) => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)

function Footer({ t, onClose, label, busy, danger = false, disabled = false }: { t: Translator; onClose: () => void; label: string; busy: boolean; danger?: boolean; disabled?: boolean }) {
  return <footer className="modal-footer"><span /><div><button type="button" className="button button-quiet" onClick={onClose}>{t('cancel')}</button><button className={`button ${danger ? 'button-danger' : 'button-primary'}`} disabled={busy || disabled}>{busy ? '…' : label}</button></div></footer>
}

export function ProductModal({ t, onClose, onSaved, userId }: BaseProps & { userId: string }) {
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !sku.trim()) return
    setBusy(true); setError('')
    let productId = ''
    let path = ''
    try {
      const inserted = await supabase.from('warehouse_products').insert({ sku: sku.trim(), name: name.trim() || null, created_by: userId }).select('id').single()
      if (inserted.error) throw inserted.error
      productId = inserted.data.id
      if (image) {
        const safeName = image.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        path = `${userId}/${crypto.randomUUID()}-${safeName}`
        const upload = await supabase.storage.from('product-images').upload(path, image, { upsert: false })
        if (upload.error) throw upload.error
        const linked = await supabase.from('product_images').insert({ product_id: productId, storage_path: path, alt_text: name.trim() || sku.trim(), is_primary: true, created_by: userId })
        if (linked.error) throw linked.error
      }
      await onSaved(t('productSaved'))
    } catch (caught) {
      if (path) await supabase.storage.from('product-images').remove([path])
      if (productId) await supabase.from('warehouse_products').delete().eq('id', productId)
      setError(errorText(caught))
    } finally { setBusy(false) }
  }

  return <Modal title={t('addProduct')} onClose={onClose}><form onSubmit={submit}>
    <div className="form-grid">
      <label>{t('productNumber')}<input value={sku} onChange={(e) => setSku(e.target.value)} required /></label>
      <label>{t('styleName')}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="full-field file-field">{t('productImage')}<input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} /></label>
      {error && <div className="inline-alert error full-field" role="alert">{error}</div>}
    </div><Footer t={t} onClose={onClose} label={t('saveProduct')} busy={busy} /></form></Modal>
}

export function RateModal({ t, onClose, onSaved, userId }: BaseProps & { userId: string }) {
  const [date, setDate] = useState(almatyDate())
  const [cny, setCny] = useState('')
  const [kzt, setKzt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const cnyValue = Number(cny); const kztValue = Number(kzt)
    if (cnyValue <= 0 || kztValue <= 0) { setError(t('invalidRate')); return }
    setBusy(true); setError('')
    const result = await supabase.from('exchange_rates').insert({ effective_date: date, cny_per_usd: cnyValue, kzt_per_usd: kztValue, note: note.trim() || null, entered_by: userId })
    if (result.error) setError(result.error.message); else await onSaved(t('rateSaved'))
    setBusy(false)
  }
  return <Modal title={t('addRate')} onClose={onClose}><form onSubmit={submit}><div className="form-grid">
    <label>{t('effectiveDate')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
    <span />
    <label>{t('cnyPerUsd')}<input type="number" min="0.000001" step="0.000001" value={cny} onChange={(e) => setCny(e.target.value)} required /></label>
    <label>{t('kztPerUsd')}<input type="number" min="0.000001" step="0.000001" value={kzt} onChange={(e) => setKzt(e.target.value)} required /></label>
    <label className="full-field">{t('note')}<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
    {error && <div className="inline-alert error full-field" role="alert">{error}</div>}
  </div><Footer t={t} onClose={onClose} label={t('saveRate')} busy={busy} /></form></Modal>
}

export function InboundModal({ t, onClose, onSaved, warehouses, products, rates }: BaseProps & { warehouses: Warehouse[]; products: Product[]; rates: ExchangeRate[] }) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [productQuery, setProductQuery] = useState('')
  const [date, setDate] = useState(almatyDate())
  const [packages, setPackages] = useState('')
  const [pieces, setPieces] = useState('')
  const [cost, setCost] = useState('')
  const [rateId, setRateId] = useState(rates[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const filteredProducts = useMemo(() => {
    const query = productQuery.trim().toLocaleLowerCase()
    if (!query) return products
    return products.filter((product) => `${product.sku} ${product.name ?? ''}`.toLocaleLowerCase().includes(query))
  }, [productQuery, products])
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase) return
    if (!warehouseId || !productId || !packages.trim()) { setError(t('requiredFields')); return }
    if (Number(packages) <= 0 || Number(pieces || 0) < 0) { setError(t('invalidQuantity')); return }
    if (cost.trim() && Number(cost) < 0) { setError(t('invalidCost')); return }
    setBusy(true); setError('')
    const result = await supabase.rpc('create_inbound', { p_warehouse_id: warehouseId, p_product_id: productId, p_received_date: date || null, p_packages: Number(packages), p_pieces: pieces.trim() ? Number(pieces) : null, p_unit_cost_rmb_per_piece: cost.trim() ? Number(cost) : null, p_fx_snapshot_id: rateId || null, p_note: note, p_idempotency_key: crypto.randomUUID() })
    if (result.error) setError(result.error.message); else await onSaved(t('inboundSaved'))
    setBusy(false)
  }
  return <Modal title={t('addInbound')} onClose={onClose} wide><form onSubmit={submit}><div className="form-grid">
    <label>{t('warehouse')}<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    <label className="full-field">{t('product')}<div className="input-with-icon"><Search size={16} aria-hidden="true" /><input type="search" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder={t('search')} aria-label={t('search')} /></div><select value={productId} onChange={(e) => setProductId(e.target.value)} required>{filteredProducts.map((p) => <option key={p.id} value={p.id}>{p.sku} {p.name ?? ''}</option>)}</select>{products.length > 0 && filteredProducts.length === 0 && <span className="form-help">{t('noProductMatches')}</span>}</label>
    <label>{t('effectiveDate')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    <label>{t('rateHistory')}<select value={rateId} onChange={(e) => setRateId(e.target.value)}><option value="">{t('notSelected')}</option>{rates.map((r) => <option key={r.id} value={r.id}>{r.effective_date} · {r.kzt_per_usd} KZT/USD · {r.cny_per_usd} CNY/USD</option>)}</select></label>
    <label>{t('packageCount')}<input type="number" min="0.001" step="0.001" value={packages} onChange={(e) => setPackages(e.target.value)} required /></label>
    <label>{t('pieceCount')}<input type="number" min="0" step="1" value={pieces} onChange={(e) => setPieces(e.target.value)} /></label>
    <label>{t('purchasePrice')}<input type="number" min="0" step="0.0001" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
    <label>{t('note')}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <p className="form-help full-field">{t('inboundFieldsHint')}</p>{error && <div className="inline-alert error full-field" role="alert">{error}</div>}
  </div><Footer t={t} onClose={onClose} label={t('saveInbound')} busy={busy} disabled={!products.length || !warehouses.length} /></form></Modal>
}

export function IssueModal({ t, onClose, onSaved, inventory }: BaseProps & { inventory: InventoryRow[] }) {
  const usable = inventory.filter((row) => row.available_packages > 0 && row.available_pieces > 0)
  const [batchId, setBatchId] = useState(usable[0]?.batch_id ?? '')
  const selected = usable.find((row) => row.batch_id === batchId)
  const [packages, setPackages] = useState('')
  const [pieces, setPieces] = useState('')
  const [recipient, setRecipient] = useState('')
  const [dateTime, setDateTime] = useState(almatyDateTime())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase || !selected) return
    const packageValue = Number(packages); const pieceValue = Number(pieces)
    if (packageValue <= 0 || pieceValue <= 0) { setError(t('invalidQuantity')); return }
    if (packageValue > selected.available_packages || pieceValue > selected.available_pieces) { setError(t('issueQuantityHint')); return }
    setBusy(true); setError('')
    const result = await supabase.rpc('create_issue', { p_warehouse_id: selected.warehouse_id, p_occurred_at: toAlmatyIso(dateTime), p_recipient_name: recipient, p_note: note, p_lines: [{ batch_id: batchId, packages: packageValue, pieces: pieceValue }], p_idempotency_key: crypto.randomUUID() })
    if (result.error) setError(result.error.message); else await onSaved(t('issueSaved'))
    setBusy(false)
  }
  return <Modal title={t('addIssue')} onClose={onClose} wide><form onSubmit={submit}><div className="form-grid">
    <label className="full-field">{t('batch')}<select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>{usable.map((row) => <option key={`${row.warehouse_id}-${row.batch_id}`} value={row.batch_id}>{row.sku} {row.name ?? ''} · {row.warehouse_name} · {row.available_packages} {t('packages')} / {row.available_pieces} {t('pieces')} · {row.received_date}</option>)}</select></label>
    <label>{t('packageCount')}<input type="number" min="0.001" max={selected?.available_packages} step="0.001" value={packages} onChange={(e) => setPackages(e.target.value)} required /></label>
    <label>{t('pieceCount')}<input type="number" min="1" max={selected?.available_pieces} step="1" value={pieces} onChange={(e) => setPieces(e.target.value)} required /></label>
    <label>{t('recipient')}<input value={recipient} onChange={(e) => setRecipient(e.target.value)} required /></label>
    <label>{t('issueDate')}<input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} required /></label>
    <label className="full-field">{t('note')}<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <p className="form-help full-field">{t('issueQuantityHint')}</p>{error && <div className="inline-alert error full-field" role="alert">{error}</div>}
  </div><Footer t={t} onClose={onClose} label={t('saveIssue')} busy={busy} disabled={!selected} /></form></Modal>
}

export function TransportModal({ t, onClose, onSaved, warehouses, products, inventory }: BaseProps & { warehouses: Warehouse[]; products: Product[]; inventory: InventoryRow[] }) {
  const external = warehouses.find((w) => w.code === 'EXTERNAL')
  const own = warehouses.find((w) => w.code === 'OWN')
  const [type, setType] = useState<'domestic_to_external' | 'warehouse_transfer'>('domestic_to_external')
  const sourceRows = inventory.filter((row) => row.warehouse_id === (external?.id ?? '') && row.available_packages > 0 && row.available_pieces > 0)
  const [batchId, setBatchId] = useState(sourceRows[0]?.batch_id ?? '')
  const source = sourceRows.find((row) => row.batch_id === batchId)
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [number, setNumber] = useState(`TR-${almatyDate().replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`)
  const [packages, setPackages] = useState('')
  const [pieces, setPieces] = useState('')
  const [cost, setCost] = useState('')
  const [shippedAt, setShippedAt] = useState(almatyDateTime())
  const [expectedAt, setExpectedAt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canSubmit = Boolean(external && (type === 'domestic_to_external' ? productId : own && source))
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase || !external) return
    const packageValue = Number(packages); const pieceValue = Number(pieces)
    if (packageValue <= 0 || pieceValue <= 0) { setError(t('invalidQuantity')); return }
    if (type === 'warehouse_transfer' && source && (packageValue > source.available_packages || pieceValue > source.available_pieces)) { setError(t('issueQuantityHint')); return }
    const line = type === 'domestic_to_external'
      ? { product_id: productId, source_batch_id: '', packages: packageValue, pieces: pieceValue, unit_cost_rmb_per_piece: Number(cost) }
      : { product_id: source?.product_id, source_batch_id: source?.batch_id, packages: packageValue, pieces: pieceValue, unit_cost_rmb_per_piece: '' }
    setBusy(true); setError('')
    const result = await supabase.rpc('create_transport', { p_transport_id: crypto.randomUUID(), p_transport_no: number, p_transport_type: type, p_source_warehouse_id: type === 'warehouse_transfer' ? external.id : null, p_destination_warehouse_id: type === 'warehouse_transfer' ? own?.id : external.id, p_shipped_at: toAlmatyIso(shippedAt), p_expected_arrival_at: expectedAt ? toAlmatyIso(expectedAt) : null, p_note: note, p_lines: [line] })
    if (result.error) setError(result.error.message); else await onSaved(t('transportSaved'))
    setBusy(false)
  }
  return <Modal title={t('addTransport')} onClose={onClose} wide><form onSubmit={submit}><div className="form-grid">
    <label>{t('transportType')}<select value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="domestic_to_external">{t('domesticToExternal')}</option><option value="warehouse_transfer">{t('warehouseTransfer')}</option></select></label>
    <label>{t('transportNumber')}<input value={number} onChange={(e) => setNumber(e.target.value)} required /></label>
    {type === 'domestic_to_external' ? <label className="full-field">{t('product')}<select value={productId} onChange={(e) => setProductId(e.target.value)} required>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} {p.name ?? ''}</option>)}</select></label> : <label className="full-field">{t('sourceBatch')}<select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>{sourceRows.map((row) => <option key={row.batch_id} value={row.batch_id}>{row.sku} {row.name ?? ''} · {row.available_packages} {t('packages')} / {row.available_pieces} {t('pieces')}</option>)}</select></label>}
    <label>{t('packageCount')}<input type="number" min="0.001" step="0.001" value={packages} onChange={(e) => setPackages(e.target.value)} required /></label>
    <label>{t('pieceCount')}<input type="number" min="1" step="1" value={pieces} onChange={(e) => setPieces(e.target.value)} required /></label>
    {type === 'domestic_to_external' && <label>{t('purchasePrice')}<input type="number" min="0" step="0.0001" value={cost} onChange={(e) => setCost(e.target.value)} required /></label>}
    <label>{t('shippedAt')}<input type="datetime-local" value={shippedAt} onChange={(e) => setShippedAt(e.target.value)} required /></label>
    <label>{t('expectedArrival')}<input type="datetime-local" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></label>
    <label className="full-field">{t('note')}<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <p className="form-help full-field">{type === 'domestic_to_external' ? t('externalInboundHint') : t('transferHint')}</p>{error && <div className="inline-alert error full-field" role="alert">{error}</div>}
  </div><Footer t={t} onClose={onClose} label={t('createTransport')} busy={busy} disabled={!canSubmit} /></form></Modal>
}

export function ReceiveModal({ t, onClose, onSaved, row }: BaseProps & { row: TransportRow }) {
  const [packages, setPackages] = useState(String(row.remaining_packages))
  const [pieces, setPieces] = useState(String(row.remaining_pieces))
  const [dateTime, setDateTime] = useState(almatyDateTime())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase) return
    const packageValue = Number(packages); const pieceValue = Number(pieces)
    if (packageValue <= 0 || pieceValue <= 0 || packageValue > row.remaining_packages || pieceValue > row.remaining_pieces) { setError(t('invalidQuantity')); return }
    setBusy(true); setError('')
    const result = await supabase.rpc('receive_transport', { p_transport_line_id: row.line_id, p_received_packages: packageValue, p_received_pieces: pieceValue, p_received_at: toAlmatyIso(dateTime), p_note: note, p_idempotency_key: crypto.randomUUID() })
    if (result.error) setError(result.error.message); else await onSaved(t('receiptSaved'))
    setBusy(false)
  }
  return <Modal title={`${t('receivePartial')} · ${row.transport_no}`} onClose={onClose}><form onSubmit={submit}><div className="form-grid">
    <div className="impact-box full-field"><strong>{row.sku} {row.product_name ?? ''}</strong><span>{row.remaining_packages} {t('packages')} / {row.remaining_pieces} {t('pieces')} {t('inTransit')}</span></div>
    <label>{t('receivedPackages')}<input type="number" min="0.001" max={row.remaining_packages} step="0.001" value={packages} onChange={(e) => setPackages(e.target.value)} required /></label>
    <label>{t('receivedPieces')}<input type="number" min="1" max={row.remaining_pieces} step="1" value={pieces} onChange={(e) => setPieces(e.target.value)} required /></label>
    <label>{t('effectiveDate')}<input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} required /></label>
    <label>{t('note')}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    {error && <div className="inline-alert error full-field" role="alert">{error}</div>}
  </div><Footer t={t} onClose={onClose} label={t('receive')} busy={busy} /></form></Modal>
}

export function RollbackModal({ t, locale, onClose, onSaved, row, user }: BaseProps & { locale: Locale; row: OperationRow; user: User }) {
  const phrase = useMemo(() => locale === 'zh-CN' ? '撤销' : locale === 'ru' ? 'ОТМЕНА' : 'ҚАЙТАРУ', [locale])
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase || !user.email) return
    if (reason.trim().length < 3 || confirmation !== phrase || !password) { setError(t('requiredFields')); return }
    setBusy(true); setError('')
    const reauth = await supabase.auth.signInWithPassword({ email: user.email, password })
    if (reauth.error) { setError(reauth.error.message); setBusy(false); return }
    const result = await supabase.rpc('reverse_operation', { p_operation_id: row.id, p_reason: reason, p_idempotency_key: crypto.randomUUID() })
    if (result.error) setError(result.error.message); else await onSaved(t('rollbackSaved'))
    setBusy(false)
  }
  return <Modal title={row.operation_type === 'rollback' ? t('undoRollback') : t('rollback')} onClose={onClose} danger><form onSubmit={submit}><div className="form-grid">
    <div className="danger-notice full-field"><AlertTriangle size={20} /><div><strong>{row.sku ?? '-'} · {row.package_delta} {t('packages')} / {row.piece_delta} {t('pieces')}</strong><span>{new Date(row.occurred_at).toLocaleString(locale)}</span></div></div>
    <label className="full-field">{t('rollbackReason')}<textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required /></label>
    <label>{t('confirmPhrase')}<input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={phrase} required /></label>
    <label>{t('adminPassword')}<div className="input-with-icon"><LockKeyhole size={15} /><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div></label>
    {error && <div className="inline-alert error full-field" role="alert">{error}</div>}
  </div><Footer t={t} onClose={onClose} label={t('confirmRollback')} busy={busy} danger disabled={confirmation !== phrase || reason.trim().length < 3 || !password} /></form></Modal>
}
