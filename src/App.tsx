import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Boxes, CalendarDays, CircleDollarSign, Languages, LayoutDashboard, Menu, PackageMinus, PackagePlus, RefreshCw, Shirt, Truck, Users, X } from 'lucide-react'
import { AuthScreen, Empty } from './components'
import { InboundModal, IssueModal, ProductModal, RateModal, ReceiveModal, RollbackModal, TransportModal } from './action-modals'
import { translations } from './i18n'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { HistoryPage, InboundPage, InventoryPage, IssuePage, OverviewPage, ProductsPage, RatesPage, TransportPage, UsersPage } from './pages'
import type { AdminTask, AppData, CostRow, ExchangeRate, InventoryRow, Locale, OperationRow, Page, Product, Role, Translator, TransportRow, UserAccess, Warehouse } from './types'

const emptyData: AppData = { warehouses: [], products: [], inventory: [], costs: [], transports: [], operations: [], rates: [], users: [], tasks: [] }
const errorText = (error: unknown) => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)

const navFor = (role: Role): Array<{ id: Page; icon: typeof LayoutDashboard; key: string }> => {
  const base: Array<{ id: Page; icon: typeof LayoutDashboard; key: string }> = [
    { id: 'overview', icon: LayoutDashboard, key: 'overview' }, { id: 'inventory', icon: Boxes, key: 'inventory' }, { id: 'transport', icon: Truck, key: 'transport' }, { id: 'issue', icon: PackageMinus, key: 'issue' }, { id: 'history', icon: CalendarDays, key: 'history' },
  ]
  if (role === 'admin') base.push({ id: 'inbound', icon: PackagePlus, key: 'inbound' }, { id: 'products', icon: Shirt, key: 'products' }, { id: 'rates', icon: CircleDollarSign, key: 'rates' }, { id: 'users', icon: Users, key: 'users' })
  return base
}

function App() {
  const [locale, setLocale] = useState<Locale>('zh-CN')
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [page, setPage] = useState<Page>('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [role, setRole] = useState<Role | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [data, setData] = useState<AppData>(emptyData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [modal, setModal] = useState<'product' | 'rate' | 'inbound' | 'transport' | 'issue' | 'receive' | 'rollback' | null>(null)
  const [selectedTransport, setSelectedTransport] = useState<TransportRow | null>(null)
  const [selectedOperation, setSelectedOperation] = useState<OperationRow | null>(null)
  const [warehouseFilter, setWarehouseFilter] = useState('all')
  const t: Translator = (key) => translations[locale][key] ?? translations['zh-CN'][key] ?? key

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    let mounted = true
    supabase.auth.getSession().then(({ data: auth }) => { if (mounted) { setSession(auth.session); setAuthReady(true) } })
    const listener = supabase.auth.onAuthStateChange((_event, auth) => { if (mounted) setSession(auth) })
    return () => { mounted = false; listener.data.subscription.unsubscribe() }
  }, [])

  async function loadData() {
    if (!supabase || !session) return
    setLoading(true); setError('')
    try {
      const boot = await supabase.rpc('bootstrap_current_user', { p_display_name: session.user.user_metadata?.display_name ?? null })
      if (boot.error) throw boot.error
      const profileResult = await supabase.from('warehouse_profiles').select('display_name, locale').eq('id', session.user.id).single()
      if (profileResult.error) throw profileResult.error
      const roleResult = await supabase.from('user_roles').select('role').eq('user_id', session.user.id).single()
      if (roleResult.error) throw roleResult.error
      const currentRole = roleResult.data.role as Role
      setRole(currentRole); setDisplayName(profileResult.data.display_name)
      const storedLocale = profileResult.data.locale as Locale
      if (storedLocale && ['zh-CN', 'ru', 'kk'].includes(storedLocale)) setLocale(storedLocale)

      const warehouseResult = await supabase.from('warehouses').select('id, code, name, warehouse_type, is_active').eq('is_active', true).order('code')
      if (warehouseResult.error) throw warehouseResult.error
      const productResult = await supabase.from('warehouse_products').select('id, sku, name, archived_at').is('archived_at', null).order('sku')
      if (productResult.error) throw productResult.error
      const inventoryResult = await supabase.from('v_inventory_stock').select('*').order('sku')
      if (inventoryResult.error) throw inventoryResult.error
      const transportResult = await supabase.from('v_transport_progress').select('*').order('expected_arrival_at', { ascending: true, nullsFirst: false })
      if (transportResult.error) throw transportResult.error
      const operationResult = await supabase.from('v_operation_history').select('*').order('occurred_at', { ascending: false }).limit(200)
      if (operationResult.error) throw operationResult.error
      const imageResult = await supabase.from('product_images').select('product_id, storage_path').eq('is_primary', true)
      if (imageResult.error) throw imageResult.error
      const imageUrls = new Map<string, string>()
      await Promise.all((imageResult.data ?? []).map(async (image) => { const signed = await supabase!.storage.from('product-images').createSignedUrl(image.storage_path, 3600); if (signed.data?.signedUrl) imageUrls.set(image.product_id, signed.data.signedUrl) }))
      const products = (productResult.data ?? []).map((product) => ({ ...product, image_url: imageUrls.get(product.id) ?? null })) as Product[]

      let rates: ExchangeRate[] = []; let costs: CostRow[] = []; let users: UserAccess[] = []; let tasks: AdminTask[] = []
      if (currentRole === 'admin') {
        const ratesResult = await supabase.from('exchange_rates').select('*').order('effective_date', { ascending: false }).order('created_at', { ascending: false })
        if (ratesResult.error) throw ratesResult.error
        rates = ratesResult.data as ExchangeRate[]
        const costsResult = await supabase.from('v_admin_inventory_costs').select('*').order('sku')
        if (costsResult.error) throw costsResult.error
        costs = costsResult.data as CostRow[]
        const [profilesResult, rolesResult, membersResult] = await Promise.all([
          supabase.from('warehouse_profiles').select('id, display_name, locale, is_active').order('display_name'),
          supabase.from('user_roles').select('user_id, role'),
          supabase.from('warehouse_members').select('user_id, warehouse_id'),
        ])
        if (profilesResult.error) throw profilesResult.error
        if (rolesResult.error) throw rolesResult.error
        if (membersResult.error) throw membersResult.error
        const roles = new Map(rolesResult.data.map((item) => [item.user_id, item.role as Role]))
        const memberMap = new Map<string, string[]>()
        membersResult.data.forEach((item) => memberMap.set(item.user_id, [...(memberMap.get(item.user_id) ?? []), item.warehouse_id]))
        users = profilesResult.data.map((profile) => ({ ...profile, role: roles.get(profile.id) ?? 'warehouse_operator', warehouse_ids: memberMap.get(profile.id) ?? [] })) as UserAccess[]
        const tasksResult = await supabase.from('v_admin_tasks').select('*').eq('status', 'open').order('created_at', { ascending: false })
        if (tasksResult.error) throw tasksResult.error
        tasks = tasksResult.data as AdminTask[]
      }
      setData({ warehouses: warehouseResult.data as Warehouse[], products, inventory: inventoryResult.data as InventoryRow[], costs, transports: transportResult.data as TransportRow[], operations: operationResult.data as OperationRow[], rates, users, tasks })
    } catch (caught) { setError(errorText(caught)) } finally { setLoading(false) }
  }

  useEffect(() => { if (session) void loadData(); else { setRole(null); setData(emptyData) } }, [session?.user.id])

  const announce = async (message: string) => { setModal(null); setFlash(message); await loadData(); window.setTimeout(() => setFlash(''), 3500) }
  const changeLocale = async (nextLocale: Locale) => { setLocale(nextLocale); if (supabase && session) { const result = await supabase.rpc('update_my_locale', { p_locale: nextLocale }); if (result.error) setError(result.error.message) } }
  const signOut = async () => { if (supabase) await supabase.auth.signOut() }
  const nav = role ? navFor(role) : []
  const canIssue = role === 'admin' || role === 'warehouse_operator'
  const pageTitle = t(page)

  if (!isSupabaseConfigured) return <><div className="config-screen"><div className="config-card"><Boxes size={28} /><h1>{t('configurationError')}</h1><p>{t('configurationHint')}</p></div></div></>
  if (!authReady) return <div className="loading-screen"><span className="loading-orbit" />{t('loading')}</div>
  if (!session) return <AuthScreen locale={locale} setLocale={setLocale} t={t} />
  if (!role || loading && !data.warehouses.length) return <div className="loading-screen"><span className="loading-orbit" />{t('loadingData')}</div>

  function openPage(next: Page) { setPage(next); setMenuOpen(false) }
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}><div className="brand-lockup"><div className="brand-mark"><Boxes size={20} /></div><div><strong>{t('appName')}</strong><span>{t('appSub')}</span></div></div><div className="sidebar-section-label">{t('today')}</div><nav className="nav-list">{nav.map((item) => { const Icon = item.icon; return <button className={`nav-item ${page === item.id ? 'active' : ''}`} key={item.id} onClick={() => openPage(item.id)}><Icon size={17} /><span>{t(item.key)}</span></button> })}</nav><div className="sidebar-footer"><div className="sync-status"><span className="status-dot online" />Supabase · {role === 'admin' ? t('admin') : role === 'finance' ? t('finance') : t('operator')}</div><small className="muted-caption">{role === 'admin' ? t('adminOnly') : t('financeNoCost')}</small></div></aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">{menuOpen ? <X size={19} /> : <Menu size={19} />}</button><strong>{t('appName')}</strong><span className="slash">/</span><span>{pageTitle}</span></div><div className="topbar-actions"><label className="warehouse-select"><span className="select-label">{t('warehouse')}</span><select value={warehouseFilter} onChange={(e) => { setWarehouseFilter(e.target.value); openPage('inventory') }}><option value="all">{t('allWarehouses')}</option>{data.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label className="language-select"><Languages size={15} /><select value={locale} onChange={(e) => void changeLocale(e.target.value as Locale)}><option value="zh-CN">中文</option><option value="ru">Русский</option><option value="kk">Қазақша</option></select></label><button className="icon-button" onClick={() => void loadData()} aria-label={t('refresh')}><RefreshCw size={17} /></button><div className="user-chip"><span className="avatar">{displayName.slice(0, 1).toUpperCase()}</span><span className="user-copy"><strong>{displayName}</strong><small>{t(role === 'warehouse_operator' ? 'operator' : role)}</small></span><button className="text-button compact" onClick={() => void signOut()}>{t('signOut')}</button></div></div></header>
      <div className="content-wrap"><section className="page-intro"><div><p className="eyebrow">{new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Almaty' }).format(new Date())}</p><h1>{pageTitle}</h1></div></section>{error && <div className="inline-alert error database-alert"><span>{t('databaseError')}: {error}</span><button className="icon-button" onClick={() => setError('')}><X size={15} /></button></div>}{flash && <div className="inline-alert success database-alert">{flash}</div>}{loading && <div className="loading-strip"><RefreshCw size={14} />{t('loadingData')}</div>}
        {page === 'overview' && <OverviewPage data={data} role={role} locale={locale} t={t} navigate={openPage} onTaskSaved={announce} />}
        {page === 'inventory' && <InventoryPage data={data} role={role} locale={locale} t={t} warehouseFilter={warehouseFilter} setWarehouseFilter={setWarehouseFilter} />}
        {page === 'inbound' && role === 'admin' && <InboundPage data={data} locale={locale} t={t} onOpen={() => setModal('inbound')} />}
        {page === 'transport' && <TransportPage data={data} role={role} locale={locale} t={t} onCreate={() => setModal('transport')} onReceive={(row) => { setSelectedTransport(row); setModal('receive') }} />}
        {page === 'issue' && <IssuePage data={data} locale={locale} t={t} canIssue={canIssue} onOpen={() => setModal('issue')} />}
        {page === 'history' && <HistoryPage data={data} role={role} locale={locale} t={t} onRollback={(row) => { setSelectedOperation(row); setModal('rollback') }} />}
        {page === 'products' && role === 'admin' && <ProductsPage data={data} t={t} onOpen={() => setModal('product')} />}
        {page === 'rates' && role === 'admin' && <RatesPage data={data} locale={locale} t={t} onOpen={() => setModal('rate')} />}
        {page === 'users' && role === 'admin' && <UsersPage data={data} t={t} onSaved={announce} />}
        {!['overview', 'inventory', 'inbound', 'transport', 'issue', 'history', 'products', 'rates', 'users'].includes(page) && <Empty text={t('noPermission')} />}
      </div></main>
    {modal === 'product' && <ProductModal t={t} onClose={() => setModal(null)} onSaved={announce} userId={session.user.id} />}
    {modal === 'rate' && <RateModal t={t} onClose={() => setModal(null)} onSaved={announce} userId={session.user.id} />}
    {modal === 'inbound' && <InboundModal t={t} onClose={() => setModal(null)} onSaved={announce} warehouses={data.warehouses} products={data.products} rates={data.rates} />}
    {modal === 'transport' && <TransportModal t={t} onClose={() => setModal(null)} onSaved={announce} warehouses={data.warehouses} products={data.products} inventory={data.inventory} />}
    {modal === 'issue' && <IssueModal t={t} onClose={() => setModal(null)} onSaved={announce} inventory={data.inventory} />}
    {modal === 'receive' && selectedTransport && <ReceiveModal t={t} onClose={() => { setModal(null); setSelectedTransport(null) }} onSaved={announce} row={selectedTransport} />}
    {modal === 'rollback' && selectedOperation && <RollbackModal t={t} locale={locale} onClose={() => { setModal(null); setSelectedOperation(null) }} onSaved={announce} row={selectedOperation} user={session.user} />}
  </div>
}

export default App
