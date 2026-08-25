import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { IconAlertTriangle, IconBell, IconChevronDown, IconGlobe, IconHome, IconKey, IconLoader2, IconRefresh, IconTrash } from '@tabler/icons-react'
import { activate, ApiError } from './api'
import type { Account, Notification } from './model'
import { deviceId, loadAccounts, saveAccounts } from './storage'

const baseUrl = import.meta.env.DEV ? 'http://8.136.139.105:8080' : (import.meta.env.VITE_SUB2API_URL ?? '')
const desktop = isTauri()
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value)
const percent = (value: number, total: number) => total ? Math.min(100, Math.round(value / total * 100)) : 0
const parseCodes = (value: string) => [...new Set(value.split(/[\s,，;；]+/).map((code) => code.trim()).filter(Boolean))]

const accountFromActivation = (expiresAt?: string): Account => ({
  id: crypto.randomUUID(),
  name: '客户账号',
  plan: '已激活',
  status: '可用',
  relayUrl: baseUrl,
  defaultModel: '未获取',
  expiresAt,
  usage: { quota: 0, used: 0, requests: 0, updatedAt: new Date().toISOString() },
  details: [],
  trace: { ip: '--', location: '--', tls: baseUrl.startsWith('https:') ? 'TLS' : 'HTTP' },
})

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [view, setView] = useState<'home' | 'workspace'>('home')
  const [storageReady, setStorageReady] = useState(false)
  const [storageWritable, setStorageWritable] = useState(true)

  useEffect(() => {
    void loadAccounts().then(setAccounts).catch(() => setStorageWritable(false)).finally(() => setStorageReady(true))
  }, [])

  useEffect(() => {
    if (storageReady && storageWritable) void saveAccounts(accounts).catch(() => setStorageWritable(false))
  }, [accounts, storageReady, storageWritable])

  const addAccounts = (next: Account[]) => setAccounts((current) => [...current, ...next])
  const removeAccount = (id: string) => {
    const next = accounts.filter((account) => account.id !== id)
    setAccounts(next)
    setActiveIndex(Math.min(activeIndex, Math.max(0, next.length - 1)))
    if (!next.length) setView('home')
  }

  if (!storageReady) return <main className="activation-shell"><section className="activation-panel loading-panel"><IconLoader2 className="spin" /></section></main>
  return view === 'workspace' && accounts.length
    ? <Workspace accounts={accounts} activeIndex={activeIndex} notifications={notifications} onSelect={setActiveIndex} onNotificationsChange={setNotifications} onHome={() => setView('home')} onDelete={removeAccount} />
    : <ActivationForm accountCount={accounts.length} storageWritable={storageWritable} onSuccess={addAccounts} onOpen={() => setView('workspace')} />
}

function ActivationForm({ accountCount, storageWritable, onSuccess, onOpen }: { accountCount: number; storageWritable: boolean; onSuccess: (accounts: Account[]) => void; onOpen: () => void }) {
  const [codes, setCodes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [diagnostic, setDiagnostic] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const codesToActivate = parseCodes(codes)
    setBusy(true)
    setError('')
    setDiagnostic('')
    try {
      const id = await deviceId()
      const activated: Account[] = []
      for (const code of codesToActivate) activated.push(accountFromActivation((await activate(baseUrl, code, id)).expiresAt))
      onSuccess(activated)
      setCodes('')
    } catch (reason) {
      if (reason instanceof ApiError) {
        const status = reason.status && reason.status >= 100 && reason.status <= 599 ? `HTTP ${reason.status}` : ''
        const code = typeof reason.code === 'number' ? `业务码 ${reason.code}` : ''
        const safeReason = reason.reason && /^[A-Z0-9_:-]{1,128}$/.test(reason.reason) ? reason.reason : ''
        setDiagnostic([status, code, safeReason].filter(Boolean).join(' · '))
      }
      setError(reason instanceof Error ? reason.message : '激活失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return <main className="activation-shell">
    <section className="activation-panel">
      <header className="brand">ChatGPT 账号切换器</header>
      <form onSubmit={submit}>
        <label>
          卡密
          <textarea value={codes} onChange={(event) => setCodes(event.target.value)} placeholder="每行输入一个卡密" rows={4} required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {diagnostic && <p className="diagnostic" aria-live="polite">{diagnostic}</p>}
        <button className="primary" disabled={!desktop || busy || !codes.trim()}>
          {busy && <IconLoader2 className="spin" />}{busy ? '正在验证' : '添加账号'}
        </button>
      </form>
      {accountCount > 0 && <button className="open-workspace" onClick={onOpen}>查看账号 <span>{accountCount}</span></button>}
      {!desktop && <p className="form-error" role="alert">请使用 npm run tauri dev 启动桌面端。</p>}
      {!storageWritable && <p className="form-error" role="alert">本地保存不可用。</p>}
    </section>
  </main>
}

function Workspace({ accounts, activeIndex, notifications, onSelect, onNotificationsChange, onHome, onDelete }: {
  accounts: Account[]; activeIndex: number; notifications: Notification[]; onSelect: (index: number) => void; onNotificationsChange: (notifications: Notification[]) => void; onHome: () => void; onDelete: (id: string) => void
}) {
  const account = accounts[activeIndex]
  const [usageOpen, setUsageOpen] = useState(false)
  const [noticesOpen, setNoticesOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null)
  const remainingPercent = 100 - percent(account.usage.used, account.usage.quota)
  const quotaTone = remainingPercent <= 15 ? 'is-low' : remainingPercent <= 50 ? 'is-medium' : 'is-healthy'
  const unread = notifications.filter((item) => !item.read).length

  useEffect(() => { setUsageOpen(false) }, [activeIndex])
  useEffect(() => {
    if (!accountToDelete) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountToDelete(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [accountToDelete])
  const refresh = () => { setRefreshing(true); window.setTimeout(() => setRefreshing(false), 650) }
  const markNotificationsRead = () => onNotificationsChange(notifications.map((item) => ({ ...item, read: true })))

  return <><main className="workspace">
    <header className="app-header"><div className="brand">ChatGPT 账号切换器</div><div className="header-actions">
      <button className="icon-button notification-button" onClick={() => setNoticesOpen((value) => !value)} aria-label="通知" aria-expanded={noticesOpen}><IconBell size={18} />{unread > 0 && <i>{unread}</i>}</button>
      <button className="icon-button" onClick={onHome} aria-label="返回首页"><IconHome size={18} /></button>
    </div></header>
    {noticesOpen && <section className="notification-panel"><div className="panel-heading"><strong>通知</strong>{unread > 0 && <button onClick={markNotificationsRead}>全部已读</button>}</div>{notifications.length ? notifications.map((item) => <article key={item.id} className={item.read ? '' : 'is-unread'}><div><strong>{item.title}</strong><time>{item.time}</time></div><p>{item.content}</p></article>) : <p className="empty">暂无通知</p>}</section>}
    <nav className="account-switcher" aria-label="账号切换">{accounts.map((item, index) => <button key={item.id} className={index === activeIndex ? 'is-active' : ''} onClick={() => onSelect(index)}><span>{item.name}</span><code>{item.plan} · {item.status}</code></button>)}</nav>
    <section className="usage-summary"><div className="section-heading"><div><span className="section-label">剩余额度</span><h1>{number(account.usage.quota - account.usage.used)}</h1></div><button className="icon-button" onClick={refresh} aria-label="刷新用量" disabled={refreshing}><IconRefresh size={18} className={refreshing ? 'spin' : ''} /></button></div><div className={`usage-meter ${quotaTone}`} role="progressbar" aria-label="剩余额度" aria-valuenow={remainingPercent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${remainingPercent}%` }} /></div><div className="usage-meta"><span>剩余 {remainingPercent}% · 已用 {number(account.usage.used)} / {number(account.usage.quota)}</span><span>{account.usage.requests} 次请求</span></div></section>
    <section className="config-section"><div className="section-heading"><h2>账号配置</h2><div className="config-actions"><span className={`status ${account.status === '可用' ? 'is-ok' : ''}`}>{account.status}</span><button className="delete-button" onClick={() => setAccountToDelete(account)}><IconTrash size={15} />删除</button></div></div><div className="config-row"><span>API 密钥</span><code>已安全保存</code></div><div className="config-row"><span>转发地址</span><code>{account.relayUrl}</code></div><dl className="account-facts"><div><dt>默认模型</dt><dd>{account.defaultModel}</dd></div><div><dt>有效期</dt><dd>{account.expiresAt ? new Date(account.expiresAt).toLocaleDateString('zh-CN') : '长期有效'}</dd></div></dl></section>
    <section className={`usage-disclosure${usageOpen ? ' is-open' : ''}`}><button className="usage-toggle" onClick={() => setUsageOpen((value) => !value)} aria-expanded={usageOpen} aria-controls="usage-details"><span className="usage-toggle-icon"><IconKey size={19} /></span><strong>用量明细</strong><IconChevronDown className="chevron" size={19} /></button>{usageOpen && <div id="usage-details" className="usage-content">{account.details.length ? account.details.map((item) => <article className="usage-row" key={item.id}><div><strong>{item.model}</strong><time>{new Date(item.time).toLocaleString('zh-CN')}</time></div><span>{number(item.inputTokens)} 输入<br />{number(item.outputTokens)} 输出</span></article>) : <p className="empty">暂无用量记录</p>}</div>}</section>
    <details className="network-details"><summary><span><IconGlobe size={19} />网络信息</span><IconChevronDown size={19} /></summary><dl><div><dt>IP</dt><dd>{account.trace.ip}</dd></div><div><dt>地区</dt><dd>{account.trace.location}</dd></div><div><dt>TLS</dt><dd>{account.trace.tls}</dd></div></dl></details>
  </main>{accountToDelete && <DeleteDialog account={accountToDelete} onCancel={() => setAccountToDelete(null)} onConfirm={() => { onDelete(accountToDelete.id); setAccountToDelete(null) }} />}</>
}

function DeleteDialog({ account, onCancel, onConfirm }: { account: Account; onCancel: () => void; onConfirm: () => void }) {
  return <div className="delete-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
    <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" onMouseDown={(event) => event.stopPropagation()}>
      <span className="delete-dialog-icon"><IconAlertTriangle size={22} /></span>
      <div><p className="delete-dialog-kicker">危险操作</p><h2 id="delete-dialog-title">删除这个账号？</h2></div>
      <p id="delete-dialog-description">将移除“{account.name}”的本地记录。系统安全凭据不会被展示或复制。</p>
      <div className="delete-dialog-actions"><button className="dialog-cancel" onClick={onCancel} autoFocus>保留账号</button><button className="dialog-confirm" onClick={onConfirm}><IconTrash size={16} />确认删除</button></div>
    </section>
  </div>
}
