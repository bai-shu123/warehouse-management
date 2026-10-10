import { useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  Languages,
  LayoutDashboard,
  Menu,
  PackageCheck,
  PackageMinus,
  Plus,
  Search,
  Settings2,
  Shirt,
  Truck,
  Undo2,
  Users,
  X,
} from 'lucide-react'
import { isSupabaseConfigured } from './lib/supabase'

type Locale = 'zh-CN' | 'ru' | 'kk'
type Page = 'overview' | 'inventory' | 'transport' | 'issue' | 'products' | 'rates' | 'users'

type InventoryRow = {
  sku: string
  name: string
  packages: number
  pieces: number
  status: '正常' | '偏低'
  received: string
  color: string
}

const translations: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    appName: '库房账本',
    appSub: '双库房服装台账',
    overview: '总览',
    inventory: '我的库房',
    transport: '运输轨道',
    issue: '取货登记',
    products: '款式管理',
    rates: '汇率与成本',
    users: '用户与权限',
    ownWarehouse: '自有库房',
    otherWarehouse: '他人库房',
    today: '今日',
    available: '可用库存',
    packages: '包',
    pieces: '件',
    inTransit: '运输中',
    exceptions: '异常待办',
    recent: '最近操作',
    transportTitle: '运输轨道',
    expected: '预计到达',
    viewAll: '查看全部',
    batchInventory: '批次库存',
    search: '搜索款号或名称',
    style: '款号 / 款式',
    received: '入库日期',
    status: '状态',
    action: '操作',
    inspect: '查看',
    issueGoods: '登记取货',
    receive: '确认收货',
    export: '导出报表',
    addStyle: '新增款式',
    history: '查看记录',
    pending: '待处理',
    late: '已超期',
    partial: '部分收货',
    normal: '正常',
    low: '库存偏低',
    admin: '管理员',
    demoMode: '演示数据模式',
    connected: 'Supabase 已连接',
    noCost: '采购成本仅管理员可见',
    close: '关闭',
    cancel: '取消',
    saveIssue: '保存取货记录',
    issueSaved: '取货记录已保存',
    recipient: '领取人',
    issueDate: '日期',
    note: '备注',
    selectedBatch: '选择批次',
    packageCount: '取出包数',
    pieceCount: '实际取出件数',
    chooseStyle: '选择款式',
    notesPlaceholder: '补充说明（选填）',
    required: '必填',
    operationPassed: '已过目',
    route: '路线',
  },
  ru: {
    appName: 'Складской журнал',
    appSub: 'Учет одежды на двух складах',
    overview: 'Обзор',
    inventory: 'Мой склад',
    transport: 'Перевозки',
    issue: 'Выдача',
    products: 'Модели',
    rates: 'Курс и себестоимость',
    users: 'Пользователи',
    ownWarehouse: 'Мой склад',
    otherWarehouse: 'Внешний склад',
    today: 'Сегодня',
    available: 'Доступно',
    packages: 'уп.',
    pieces: 'шт.',
    inTransit: 'В пути',
    exceptions: 'Задачи',
    recent: 'Последние операции',
    transportTitle: 'Маршрут перевозки',
    expected: 'Ожидается',
    viewAll: 'Все записи',
    batchInventory: 'Партии на складе',
    search: 'Поиск артикула или модели',
    style: 'Артикул / модель',
    received: 'Дата приемки',
    status: 'Статус',
    action: 'Действие',
    inspect: 'Открыть',
    issueGoods: 'Оформить выдачу',
    receive: 'Принять груз',
    export: 'Экспорт',
    addStyle: 'Новая модель',
    history: 'История',
    pending: 'Ожидает',
    late: 'Просрочено',
    partial: 'Частично принято',
    normal: 'Норма',
    low: 'Мало на складе',
    admin: 'Администратор',
    demoMode: 'Демонстрационные данные',
    connected: 'Supabase подключен',
    noCost: 'Себестоимость видна только администратору',
    close: 'Закрыть',
    cancel: 'Отмена',
    saveIssue: 'Сохранить выдачу',
    issueSaved: 'Запись сохранена',
    recipient: 'Получатель',
    issueDate: 'Дата',
    note: 'Примечание',
    selectedBatch: 'Партия',
    packageCount: 'Количество упаковок',
    pieceCount: 'Фактическое количество',
    chooseStyle: 'Выберите модель',
    notesPlaceholder: 'Примечание (необязательно)',
    required: 'Обязательно',
    operationPassed: 'Просмотрено',
    route: 'Маршрут',
  },
  kk: {
    appName: 'Қойма журналы',
    appSub: 'Екі қоймадағы киім есебі',
    overview: 'Шолу',
    inventory: 'Менің қоймам',
    transport: 'Тасымалдау',
    issue: 'Беріп шығару',
    products: 'Үлгілер',
    rates: 'Курс және өзіндік құн',
    users: 'Пайдаланушылар',
    ownWarehouse: 'Өз қоймам',
    otherWarehouse: 'Басқа қойма',
    today: 'Бүгін',
    available: 'Қолжетімді',
    packages: 'қап',
    pieces: 'дана',
    inTransit: 'Жолда',
    exceptions: 'Тапсырмалар',
    recent: 'Соңғы әрекеттер',
    transportTitle: 'Тасымалдау бағыты',
    expected: 'Күтілетін күн',
    viewAll: 'Барлығын көру',
    batchInventory: 'Партиялар',
    search: 'Артикул немесе үлгі іздеу',
    style: 'Артикул / үлгі',
    received: 'Қабылдау күні',
    status: 'Мәртебе',
    action: 'Әрекет',
    inspect: 'Ашу',
    issueGoods: 'Беріп шығару',
    receive: 'Қабылдау',
    export: 'Экспорт',
    addStyle: 'Жаңа үлгі',
    history: 'Тарих',
    pending: 'Күтілуде',
    late: 'Кешікті',
    partial: 'Ішінара қабылданды',
    normal: 'Қалыпты',
    low: 'Қор аз',
    admin: 'Әкімші',
    demoMode: 'Демо деректер',
    connected: 'Supabase қосылды',
    noCost: 'Өзіндік құнды тек әкімші көреді',
    close: 'Жабу',
    cancel: 'Бас тарту',
    saveIssue: 'Жазбаны сақтау',
    issueSaved: 'Жазба сақталды',
    recipient: 'Алушы',
    issueDate: 'Күні',
    note: 'Ескерту',
    selectedBatch: 'Партияны таңдаңыз',
    packageCount: 'Қап саны',
    pieceCount: 'Нақты дана саны',
    chooseStyle: 'Үлгіні таңдаңыз',
    notesPlaceholder: 'Ескерту (міндетті емес)',
    required: 'Міндетті',
    operationPassed: 'Қаралды',
    route: 'Бағыт',
  },
}

const inventoryRows: InventoryRow[] = [
  { sku: 'J-001', name: '男士夹克', packages: 18, pieces: 426, status: '正常', received: '2026-10-08', color: '#176B6B' },
  { sku: 'T-014', name: '基础圆领 T 恤', packages: 9, pieces: 180, status: '偏低', received: '2026-10-05', color: '#C98B2E' },
  { sku: 'K-022', name: '针织开衫', packages: 14, pieces: 212, status: '正常', received: '2026-09-29', color: '#7C628A' },
  { sku: 'P-008', name: '休闲长裤', packages: 7, pieces: 96, status: '偏低', received: '2026-09-25', color: '#C65A46' },
  { sku: 'S-031', name: '轻薄衬衫', packages: 22, pieces: 504, status: '正常', received: '2026-09-20', color: '#356A9A' },
]

const transportRows = [
  { id: 'TR-26041', from: '他人库房', to: '自有库房', packages: 30, received: 18, eta: '10月12日', status: 'partial' },
  { id: 'CN-26018', from: '国内', to: '他人库房', packages: 48, received: 0, eta: '10月15日', status: 'pending' },
  { id: 'TR-26039', from: '他人库房', to: '自有库房', packages: 12, received: 12, eta: '10月08日', status: 'normal' },
]

const activityRows = [
  { time: '09:42', label: '取货登记', detail: 'T-014 · 2 包 / 40 件', tone: 'teal' },
  { time: '昨日', label: '部分收货', detail: 'TR-26041 · +8 包 / 96 件', tone: 'ochre' },
  { time: '10月08日', label: '新批次入库', detail: 'J-001 · 18 包 / 426 件', tone: 'blue' },
]

const navItems: Array<{ id: Page; icon: typeof LayoutDashboard; key: string }> = [
  { id: 'overview', icon: LayoutDashboard, key: 'overview' },
  { id: 'inventory', icon: Boxes, key: 'inventory' },
  { id: 'transport', icon: Truck, key: 'transport' },
  { id: 'issue', icon: PackageMinus, key: 'issue' },
  { id: 'products', icon: Shirt, key: 'products' },
  { id: 'rates', icon: CircleDollarSign, key: 'rates' },
  { id: 'users', icon: Users, key: 'users' },
]

function App() {
  const [locale, setLocale] = useState<Locale>('zh-CN')
  const [page, setPage] = useState<Page>('overview')
  const [warehouse, setWarehouse] = useState<'own' | 'other'>('own')
  const [menuOpen, setMenuOpen] = useState(false)
  const [issueOpen, setIssueOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const t = (key: string) => translations[locale][key] ?? translations['zh-CN'][key] ?? key
  const filteredInventory = useMemo(
    () => inventoryRows.filter((row) => `${row.sku} ${row.name}`.toLowerCase().includes(searchTerm.toLowerCase())),
    [searchTerm],
  )

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2800)
  }

  const exportReport = () => {
    const header = ['SKU', 'Style', 'Packages', 'Pieces', 'Received']
    const rows = filteredInventory.map((row) => [row.sku, row.name, row.packages, row.pieces, row.received])
    const csv = [header, ...rows].map((row) => row.join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `warehouse-report-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    notify(t('export') + ' CSV')
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Boxes size={20} strokeWidth={2.4} /></div>
          <div>
            <strong>{t('appName')}</strong>
            <span>{t('appSub')}</span>
          </div>
        </div>
        <div className="sidebar-section-label">{t('today')}</div>
        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map(({ id, icon: Icon, key }) => (
            <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => { setPage(id); setMenuOpen(false) }}>
              <Icon size={18} />
              <span>{t(key)}</span>
              {id === 'transport' && <b className="nav-count">3</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sync-status">
            <span className={`status-dot ${isSupabaseConfigured ? 'online' : 'demo'}`} />
            <span>{isSupabaseConfigured ? t('connected') : t('demoMode')}</span>
          </div>
          <span className="muted-caption">{t('noCost')}</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Menu" onClick={() => setMenuOpen((open) => !open)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>{t(page)}</span><span className="slash">/</span><strong>{warehouse === 'own' ? t('ownWarehouse') : t('otherWarehouse')}</strong></div>
          <div className="topbar-actions">
            <div className="warehouse-select">
              <span className="select-label">{t('route')}</span>
              <select value={warehouse} onChange={(event) => setWarehouse(event.target.value as 'own' | 'other')}>
                <option value="own">{t('ownWarehouse')}</option>
                <option value="other">{t('otherWarehouse')}</option>
              </select>
              <ChevronDown size={15} />
            </div>
            <div className="language-select">
              <Languages size={16} />
              <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label="Language">
                <option value="zh-CN">中文</option>
                <option value="ru">Русский</option>
                <option value="kk">Қазақша</option>
              </select>
            </div>
            <button className="icon-button notification" aria-label="Notifications" onClick={() => notify(t('exceptions'))}><Bell size={18} /><span /></button>
            <div className="user-chip"><span className="avatar">A</span><span className="user-copy"><strong>Admin</strong><small>{t('admin')}</small></span></div>
          </div>
        </header>

        <div className="content-wrap">
          <section className="page-intro">
            <div>
              <p className="eyebrow">{new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</p>
              <h1>{t(page)}</h1>
            </div>
            <div className="intro-actions">
              {page === 'overview' && <button className="button button-quiet" onClick={exportReport}><Download size={16} />{t('export')}</button>}
              <button className="button button-primary" onClick={() => page === 'issue' ? setIssueOpen(true) : notify(page === 'products' ? t('addStyle') : t('issueGoods'))}>
                <Plus size={17} />{page === 'products' ? t('addStyle') : t('issueGoods')}
              </button>
            </div>
          </section>

          {page === 'overview' && <Overview t={t} onNavigate={setPage} onNotify={notify} />}
          {page === 'inventory' && <Inventory t={t} rows={filteredInventory} searchTerm={searchTerm} setSearchTerm={setSearchTerm} onNotify={notify} />}
          {page === 'transport' && <Transport t={t} onNotify={notify} />}
          {page === 'issue' && <IssuePage t={t} onOpen={() => setIssueOpen(true)} onNotify={notify} />}
          {page === 'products' && <Products t={t} onNotify={notify} />}
          {page === 'rates' && <Rates t={t} onNotify={notify} />}
          {page === 'users' && <UsersPage t={t} onNotify={notify} />}
        </div>
      </main>

      {issueOpen && <IssueModal t={t} onClose={() => setIssueOpen(false)} onSaved={() => { setIssueOpen(false); notify(t('issueSaved')) }} />}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>
  )
}

type T = (key: string) => string

function Overview({ t, onNavigate, onNotify }: { t: T; onNavigate: (page: Page) => void; onNotify: (message: string) => void }) {
  return (
    <>
      <section className="metric-grid">
        <Metric label={t('available')} value="70" unit={t('packages')} detail="1,418 件" icon={<Boxes size={18} />} tone="teal" />
        <Metric label={t('inTransit')} value="48" unit={t('packages')} detail="2 条运输单" icon={<Truck size={18} />} tone="ochre" />
        <Metric label={t('exceptions')} value="3" unit={t('pending')} detail="需要管理员处理" icon={<Bell size={18} />} tone="coral" />
        <Metric label="本月取出" value="126" unit={t('packages')} detail="2,304 件" icon={<ArrowUpRight size={18} />} tone="blue" />
      </section>

      <section className="workspace-grid">
        <div className="panel transport-panel">
          <div className="panel-heading"><div><span className="panel-kicker">{t('inTransit')}</span><h2>{t('transportTitle')}</h2></div><button className="text-button" onClick={() => onNavigate('transport')}>{t('viewAll')} <ArrowUpRight size={15} /></button></div>
          <div className="route-board">
            <div className="route-node"><span className="node-mark external">E</span><div><strong>{t('otherWarehouse')}</strong><small>48 {t('packages')} {t('available')}</small></div></div>
            <div className="route-line"><span className="moving-dot" /><span className="route-label">2 个运输单</span></div>
            <div className="route-node"><span className="node-mark own">O</span><div><strong>{t('ownWarehouse')}</strong><small>18 {t('packages')} {t('partial')}</small></div></div>
          </div>
          <div className="transport-list">
            {transportRows.slice(0, 2).map((row) => <TransportLine key={row.id} row={row} t={t} />)}
          </div>
        </div>
        <div className="panel task-panel">
          <div className="panel-heading"><div><span className="panel-kicker">{t('exceptions')}</span><h2>3 项待处理</h2></div><button className="icon-button" aria-label="Settings"><Settings2 size={17} /></button></div>
          <div className="task-list">
            <TaskItem title="TR-26041" detail="收货差异 · 少 2 包" tone="coral" onClick={() => onNotify('已打开 TR-26041')} />
            <TaskItem title="CN-26018" detail="预计 10 月 15 日到达" tone="ochre" onClick={() => onNotify('已打开 CN-26018')} />
            <TaskItem title="取货记录 #091" detail="等待管理员过目" tone="teal" onClick={() => onNotify('已标记为已过目')} />
          </div>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="panel-kicker">{t('available')}</span><h2>{t('batchInventory')}</h2></div><button className="text-button" onClick={() => onNavigate('inventory')}>{t('viewAll')} <ArrowUpRight size={15} /></button></div>
        <InventoryTable t={t} rows={inventoryRows.slice(0, 4)} onNotify={onNotify} />
      </section>

      <section className="panel activity-panel">
        <div className="panel-heading"><div><span className="panel-kicker">{t('recent')}</span><h2>操作流</h2></div><button className="text-button" onClick={() => onNavigate('issue')}>{t('history')} <ArrowUpRight size={15} /></button></div>
        <div className="activity-list">{activityRows.map((item) => <div className="activity-item" key={item.time + item.label}><span className={`activity-time ${item.tone}`}>{item.time}</span><div><strong>{item.label}</strong><span>{item.detail}</span></div><Check size={16} /></div>)}</div>
      </section>
    </>
  )
}

function Metric({ label, value, unit, detail, icon, tone }: { label: string; value: string; unit: string; detail: string; icon: React.ReactNode; tone: string }) {
  return <article className={`metric metric-${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value}<small>{unit}</small></div><div className="metric-detail">{detail}</div></article>
}

function TransportLine({ row, t }: { row: typeof transportRows[number]; t: T }) {
  const statusLabel = row.status === 'partial' ? t('partial') : row.status === 'pending' ? t('pending') : t('normal')
  return <div className="transport-line"><div className="transport-id"><span className={`transport-status ${row.status}`} /><strong>{row.id}</strong><span>{row.from} → {row.to}</span></div><div className="transport-quantity"><strong>{row.received}/{row.packages} {t('packages')}</strong><small>{t('expected')} {row.eta}</small></div><span className={`status-label ${row.status}`}>{statusLabel}</span></div>
}

function TaskItem({ title, detail, tone, onClick }: { title: string; detail: string; tone: string; onClick: () => void }) {
  return <button className="task-item" onClick={onClick}><span className={`task-marker ${tone}`} /><span><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={16} /></button>
}

function Inventory({ t, rows, searchTerm, setSearchTerm, onNotify }: { t: T; rows: InventoryRow[]; searchTerm: string; setSearchTerm: (value: string) => void; onNotify: (message: string) => void }) {
  return <section className="panel table-panel full-panel"><div className="toolbar"><label className="search-field"><Search size={17} /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t('search')} /></label><button className="button button-quiet" onClick={() => onNotify(t('export'))}><Download size={16} />{t('export')}</button></div><InventoryTable t={t} rows={rows} onNotify={onNotify} /></section>
}

function InventoryTable({ t, rows, onNotify }: { t: T; rows: InventoryRow[]; onNotify: (message: string) => void }) {
  return <div className="table-scroll"><table><thead><tr><th>{t('style')}</th><th>{t('received')}</th><th>{t('available')}</th><th>{t('status')}</th><th>{t('action')}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.sku}><td><div className="product-cell"><span className="product-swatch" style={{ background: row.color }} /><div><strong>{row.sku}</strong><span>{row.name}</span></div></div></td><td>{row.received}</td><td><strong>{row.packages} {t('packages')}</strong><span className="sub-number">{row.pieces} {t('pieces')}</span></td><td><span className={`stock-pill ${row.status === '偏低' ? 'low' : ''}`}><span />{row.status === '偏低' ? t('low') : t('normal')}</span></td><td><button className="small-action" onClick={() => onNotify(`${row.sku} ${t('inspect')}`)}>{t('inspect')}</button></td></tr>)}</tbody></table>{rows.length === 0 && <div className="empty-state">没有匹配的款式</div>}</div>
}

function Transport({ t, onNotify }: { t: T; onNotify: (message: string) => void }) {
  return <><section className="transport-summary"><Metric label={t('inTransit')} value="48" unit={t('packages')} detail="2,106 件" icon={<Truck size={18} />} tone="ochre" /><Metric label={t('partial')} value="18" unit={t('packages')} detail="TR-26041" icon={<PackageCheck size={18} />} tone="teal" /><Metric label={t('late')} value="1" unit="单" detail="需要查看" icon={<Clock3 size={18} />} tone="coral" /></section><section className="panel table-panel full-panel"><div className="panel-heading"><div><span className="panel-kicker">{t('transportTitle')}</span><h2>全部运输单</h2></div><button className="button button-quiet" onClick={() => onNotify(t('export'))}><Download size={16} />{t('export')}</button></div><div className="transport-table">{transportRows.map((row) => <button className="transport-card" key={row.id} onClick={() => onNotify(`${row.id} ${t('inspect')}`)}><div className="transport-card-top"><strong>{row.id}</strong><span className={`status-label ${row.status}`}>{row.status === 'partial' ? t('partial') : row.status === 'pending' ? t('pending') : t('normal')}</span></div><div className="transport-card-route"><span>{row.from}</span><Truck size={17} /><span>{row.to}</span></div><div className="progress-track"><span style={{ width: `${Math.round((row.received / row.packages) * 100)}%` }} /></div><div className="transport-card-foot"><span>{row.received}/{row.packages} {t('packages')}</span><span>{t('expected')} {row.eta}</span></div></button>)}</div></section></>
}

function IssuePage({ t, onOpen, onNotify }: { t: T; onOpen: () => void; onNotify: (message: string) => void }) {
  return <><section className="quick-actions"><button className="quick-action primary" onClick={onOpen}><PackageMinus size={20} /><span><strong>{t('issueGoods')}</strong><small>选择款式、批次和数量</small></span><ArrowUpRight size={17} /></button><button className="quick-action" onClick={() => onNotify(t('receive'))}><PackageCheck size={20} /><span><strong>{t('receive')}</strong><small>登记部分或全部收货</small></span><ArrowUpRight size={17} /></button></section><section className="panel table-panel full-panel"><div className="panel-heading"><div><span className="panel-kicker">{t('recent')}</span><h2>取货记录</h2></div><button className="text-button" onClick={() => onNotify(t('export'))}>{t('export')} <Download size={15} /></button></div><div className="ledger-list"><LedgerRow date="10月10日 09:42" title="T-014 基础圆领 T 恤" detail="领取人：阿依努尔 · 2 包 / 40 件" status={t('operationPassed')} /><LedgerRow date="10月09日 16:20" title="J-001 男士夹克" detail="领取人：Ержан · 1 包 / 24 件" status="待过目" /><LedgerRow date="10月08日 11:05" title="K-022 针织开衫" detail="领取人：Мария · 2 包 / 32 件" status={t('operationPassed')} /></div></section></>
}

function LedgerRow({ date, title, detail, status }: { date: string; title: string; detail: string; status: string }) {
  return <div className="ledger-row"><span className="ledger-date">{date}</span><div><strong>{title}</strong><span>{detail}</span></div><span className="ledger-status"><Check size={14} />{status}</span><button className="icon-button" aria-label="Open"><ArrowUpRight size={16} /></button></div>
}

function Products({ t, onNotify }: { t: T; onNotify: (message: string) => void }) {
  return <section className="panel product-catalog"><div className="catalog-intro"><div><span className="panel-kicker">{t('products')}</span><h2>款式目录</h2><p>每个款式用唯一编号管理，图片只作为识别参考。</p></div><button className="button button-primary" onClick={() => onNotify(t('addStyle'))}><Plus size={17} />{t('addStyle')}</button></div><div className="product-grid">{inventoryRows.map((row) => <button className="style-card" key={row.sku} onClick={() => onNotify(`${row.sku} ${t('inspect')}`)}><div className="style-image" style={{ background: `linear-gradient(145deg, ${row.color}, #17242A)` }}><Shirt size={34} /></div><div className="style-card-copy"><strong>{row.sku}</strong><span>{row.name}</span><small>{row.packages} {t('packages')} · {row.pieces} {t('pieces')}</small></div><ArrowUpRight size={16} /></button>)}</div></section>
}

function Rates({ t, onNotify }: { t: T; onNotify: (message: string) => void }) {
  return <section className="split-panels"><div className="panel rate-form"><div className="panel-heading"><div><span className="panel-kicker">{t('rates')}</span><h2>维护当日汇率</h2></div><CircleDollarSign size={21} /></div><label>生效日期<input type="date" defaultValue="2026-10-10" /></label><label>人民币兑美元（CNY / USD）<input type="number" defaultValue="7.12" step="0.01" /></label><label>美元兑坚戈（KZT / USD）<input type="number" defaultValue="541.5" step="0.1" /></label><label>{t('note')}<textarea placeholder={t('notesPlaceholder')} /></label><button className="button button-primary" onClick={() => onNotify('汇率已保存')}><Check size={17} />保存汇率</button></div><div className="panel rate-history"><div className="panel-heading"><div><span className="panel-kicker">历史记录</span><h2>汇率版本</h2></div><button className="text-button" onClick={() => onNotify(t('export'))}>{t('export')} <Download size={15} /></button></div><div className="rate-row"><strong>2026-10-10</strong><span>7.12 CNY/USD</span><span>541.5 KZT/USD</span><small>当前</small></div><div className="rate-row"><strong>2026-10-01</strong><span>7.08 CNY/USD</span><span>535.8 KZT/USD</span><small>历史</small></div><div className="rate-row"><strong>2026-09-18</strong><span>7.14 CNY/USD</span><span>531.2 KZT/USD</span><small>历史</small></div></div></section>
}

function UsersPage({ t, onNotify }: { t: T; onNotify: (message: string) => void }) {
  return <section className="panel table-panel full-panel"><div className="panel-heading"><div><span className="panel-kicker">{t('users')}</span><h2>账号与仓库分配</h2></div><button className="button button-primary" onClick={() => onNotify('新建用户')}><Plus size={17} />新建用户</button></div><div className="user-list"><UserRow name="Admin" role={t('admin')} warehouse="两个库房" status="启用" tone="admin" /><UserRow name="Ержан" role="仓库员工" warehouse="自有库房" status="启用" tone="warehouse" /><UserRow name="Мария" role="财务" warehouse="两个库房" status="启用" tone="finance" /></div></section>
}

function UserRow({ name, role, warehouse, status, tone }: { name: string; role: string; warehouse: string; status: string; tone: string }) {
  return <div className="user-row"><span className={`avatar avatar-${tone}`}>{name.slice(0, 1)}</span><div><strong>{name}</strong><span>{role}</span></div><span>{warehouse}</span><span className="user-status"><span />{status}</span><button className="icon-button" aria-label="Settings"><Settings2 size={16} /></button></div>
}

function IssueModal({ t, onClose, onSaved }: { t: T; onClose: () => void; onSaved: () => void }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="issue-title"><div className="modal-heading"><div><span className="panel-kicker">{t('issueGoods')}</span><h2 id="issue-title">登记一笔取货</h2></div><button className="icon-button" aria-label={t('close')} onClick={onClose}><X size={19} /></button></div><div className="form-grid"><label>{t('chooseStyle')}<select defaultValue="J-001"><option>J-001 · 男士夹克</option><option>T-014 · 基础圆领 T 恤</option><option>K-022 · 针织开衫</option></select></label><label>{t('selectedBatch')}<select defaultValue="2026-10-08"><option>2026-10-08 · 18 包 / 426 件可用</option><option>2026-09-22 · 8 包 / 192 件可用</option></select></label><label>{t('packageCount')}<input type="number" defaultValue="1" min="1" /></label><label>{t('pieceCount')}<input type="number" defaultValue="24" min="1" /></label><label>{t('recipient')}<input placeholder={t('required')} /></label><label>{t('issueDate')}<input type="date" defaultValue="2026-10-10" /></label><label className="full-field">{t('note')}<textarea placeholder={t('notesPlaceholder')} /></label></div><div className="modal-footer"><span className="modal-rule"><Check size={15} />提交后立即更新库存</span><div><button className="button button-quiet" onClick={onClose}>{t('cancel')}</button><button className="button button-primary" onClick={onSaved}><PackageMinus size={16} />{t('saveIssue')}</button></div></div></section></div>
}

export default App
