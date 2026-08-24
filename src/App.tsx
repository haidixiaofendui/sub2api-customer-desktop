import { useEffect, useState } from 'react'
import {
  IconBell,
  IconChevronDown,
  IconCopy,
  IconGlobe,
  IconHome,
  IconKey,
  IconLoader2,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import type { Account, Notification } from './model'
import { loadAccounts, saveAccounts } from './storage'

const demoMode = __DEMO_MODE__
const demoCodes = 'DEMO-PLUS-001\nDEMO-TEAM-002\nDEMO-LOW-003'
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value)
const percent = (value: number, total: number) => total ? Math.min(100, Math.round(value / total * 100)) : 0
const parseCodes = (value: string) => [...new Set(value.toUpperCase().split(/[\s,，;；]+/).filter(Boolean))]

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [view, setView] = useState<'home' | 'workspace'>('home')
  const [storageReady, setStorageReady] = useState(false)
  const [storageWritable, setStorageWritable] = useState(true)

  useEffect(() => {
    if (demoMode) void import('./demo').then(({ demoNotifications }) => setNotifications(demoNotifications))
    void loadAccounts()
      .then(setAccounts)
      .catch(() => setStorageWritable(false))
      .finally(() => setStorageReady(true))
  }, [])

  useEffect(() => {
    if (storageReady && storageWritable) void saveAccounts(accounts).catch(() => setStorageWritable(false))
  }, [accounts, storageReady, storageWritable])

  const addAccounts = (next: Account[]) => {
    setAccounts((current) => [...current, ...next.filter((item) => !current.some((saved) => saved.id === item.id))])
  }

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

function KeyForm({ onSuccess, submitLabel }: { onSuccess: (accounts: Account[]) => void; submitLabel: string }) {
  const [codes, setCodes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const values = parseCodes(codes)
    setBusy(true)
    setError('')
    try {
      if (!demoMode) throw new Error('接口尚未接入。')
      const { createDemoAccounts } = await import('./demo')
      onSuccess(createDemoAccounts(values))
      setCodes('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '添加失败。')
    } finally {
      setBusy(false)
    }
  }

  return <form onSubmit={submit}>
    <label>
      卡密
      <textarea value={codes} onChange={(event) => setCodes(event.target.value.toUpperCase())} placeholder="每行输入一个卡密" rows={4} required />
    </label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary" disabled={busy || !codes.trim()}>
      {busy && <IconLoader2 className="spin" />}
      {busy ? '正在验证' : submitLabel}
    </button>
    {demoMode && <button type="button" className="demo-button" onClick={() => { setCodes(demoCodes); setError('') }}>填入演示卡密</button>}
  </form>
}

function ActivationForm({ accountCount, storageWritable, onSuccess, onOpen }: { accountCount: number; storageWritable: boolean; onSuccess: (accounts: Account[]) => void; onOpen: () => void }) {
  return <main className="activation-shell">
    <section className="activation-panel">
      <header className="brand">ChatGPT 账号切换器</header>
      <KeyForm onSuccess={onSuccess} submitLabel="添加账号" />
      {accountCount > 0 && <button className="open-workspace" onClick={onOpen}>查看账号 <span>{accountCount}</span></button>}
      {!storageWritable && <p className="form-error" role="alert">本地保存不可用。</p>}
    </section>
  </main>
}

function Workspace({ accounts, activeIndex, notifications, onSelect, onNotificationsChange, onHome, onDelete }: {
  accounts: Account[]
  activeIndex: number
  notifications: Notification[]
  onSelect: (index: number) => void
  onNotificationsChange: (notifications: Notification[]) => void
  onHome: () => void
  onDelete: (id: string) => void
}) {
  const account = accounts[activeIndex]
  const [usageOpen, setUsageOpen] = useState(false)
  const [noticesOpen, setNoticesOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState('')
  const remainingPercent = 100 - percent(account.usage.used, account.usage.quota)
  const quotaTone = remainingPercent <= 15 ? 'is-low' : remainingPercent <= 50 ? 'is-medium' : 'is-healthy'
  const unread = notifications.filter((item) => !item.read).length

  useEffect(() => { setUsageOpen(false) }, [activeIndex])

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(label)
    window.setTimeout(() => setCopied(''), 1400)
  }

  const refresh = () => {
    setRefreshing(true)
    window.setTimeout(() => setRefreshing(false), 650)
  }

  const markNotificationsRead = () => {
    onNotificationsChange(notifications.map((item) => ({ ...item, read: true })))
  }

  return <main className="workspace">
    <header className="app-header">
      <div className="brand">ChatGPT 账号切换器</div>
      <div className="header-actions">
        <button className="icon-button notification-button" onClick={() => setNoticesOpen((value) => !value)} aria-label="通知" aria-expanded={noticesOpen}>
          <IconBell size={18} />{unread > 0 && <i>{unread}</i>}
        </button>
        <button className="icon-button" onClick={onHome} aria-label="返回首页"><IconHome size={18} /></button>
      </div>
    </header>

    {noticesOpen && <section className="notification-panel">
      <div className="panel-heading"><strong>通知</strong>{unread > 0 && <button onClick={markNotificationsRead}>全部已读</button>}</div>
      {notifications.length ? notifications.map((item) => <article key={item.id} className={item.read ? '' : 'is-unread'}>
        <div><strong>{item.title}</strong><time>{item.time}</time></div><p>{item.content}</p>
      </article>) : <p className="empty">暂无通知</p>}
    </section>}

    <nav className="account-switcher" aria-label="账号切换">
      {accounts.map((item, index) => <button key={item.id} className={index === activeIndex ? 'is-active' : ''} onClick={() => onSelect(index)}>
        <span>{item.name}</span><code>{item.plan} · {item.status}</code>
      </button>)}
    </nav>

    <section className="usage-summary">
      <div className="section-heading">
        <div><span className="section-label">剩余额度</span><h1>{number(account.usage.quota - account.usage.used)}</h1></div>
        <button className="icon-button" onClick={refresh} aria-label="刷新用量" disabled={refreshing}><IconRefresh size={18} className={refreshing ? 'spin' : ''} /></button>
      </div>
      <div className={`usage-meter ${quotaTone}`} role="progressbar" aria-label="剩余额度" aria-valuenow={remainingPercent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${remainingPercent}%` }} /></div>
      <div className="usage-meta"><span>剩余 {remainingPercent}% · 已用 {number(account.usage.used)} / {number(account.usage.quota)}</span><span>{account.usage.requests} 次请求</span></div>
    </section>

    <section className="config-section">
      <div className="section-heading"><h2>账号配置</h2><div className="config-actions"><span className={`status ${account.status === '可用' ? 'is-ok' : ''}`}>{account.status}</span><button className="delete-button" onClick={() => { if (window.confirm(`删除 ${account.name}？`)) onDelete(account.id) }}><IconTrash size={15} />删除</button></div></div>
      <div className="config-row"><span>API 密钥</span><code>{account.apiKey}</code><button onClick={() => void copy('key', account.apiKey)} aria-label="复制 API 密钥"><IconCopy size={16} />{copied === 'key' && <em>已复制</em>}</button></div>
      <div className="config-row"><span>转发地址</span><code>{account.relayUrl}</code><button onClick={() => void copy('relay', account.relayUrl)} aria-label="复制转发地址"><IconCopy size={16} />{copied === 'relay' && <em>已复制</em>}</button></div>
      <dl className="account-facts">
        <div><dt>默认模型</dt><dd>{account.defaultModel}</dd></div>
        <div><dt>有效期</dt><dd>{account.expiresAt ? new Date(account.expiresAt).toLocaleDateString('zh-CN') : '长期有效'}</dd></div>
      </dl>
    </section>

    <section className={`usage-disclosure${usageOpen ? ' is-open' : ''}`}>
      <button className="usage-toggle" onClick={() => setUsageOpen((value) => !value)} aria-expanded={usageOpen} aria-controls="usage-details">
        <span className="usage-toggle-icon"><IconKey size={19} /></span><strong>用量明细</strong><IconChevronDown className="chevron" size={19} />
      </button>
      {usageOpen && <div id="usage-details" className="usage-content">
        {account.details.map((item) => <article className="usage-row" key={item.id}>
          <div><strong>{item.model}</strong><time>{new Date(item.time).toLocaleString('zh-CN')}</time></div>
          <span>{number(item.inputTokens)} 输入<br />{number(item.outputTokens)} 输出</span>
        </article>)}
      </div>}
    </section>

    <details className="network-details">
      <summary><span><IconGlobe size={19} />网络信息</span><IconChevronDown size={19} /></summary>
      <dl><div><dt>IP</dt><dd>{account.trace.ip}</dd></div><div><dt>地区</dt><dd>{account.trace.location}</dd></div><div><dt>TLS</dt><dd>{account.trace.tls}</dd></div></dl>
    </details>
  </main>
}
