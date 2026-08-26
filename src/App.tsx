import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { IconAlertTriangle, IconBell, IconChevronDown, IconGlobe, IconHome, IconKey, IconLoader2, IconRefresh, IconTrash } from '@tabler/icons-react'
import { activate, applyCodexConfig, deleteCustomerSession, diagnoseCodexConfig, getNotifications, getUsage, getUsageDetails, markNotificationsRead, restoreOfficialCodexConfig, ApiError } from './api'
import type { CodexConfigStatus } from './api'
import type { Account, Notification } from './model'
import { deviceId, loadAccounts, saveAccounts } from './storage'

const baseUrl = import.meta.env.VITE_SUB2API_URL ?? 'http://8.136.139.105:8080'
const relayUrl = `${baseUrl.replace(/\/+$/, '')}/v1`
const desktop = isTauri()
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value)
const percent = (value: number, total: number) => total ? Math.min(100, Math.round(value / total * 100)) : 0
const parseCodes = (value: string) => [...new Set(value.split(/[\s,，;；]+/).map((code) => code.trim()).filter(Boolean))]
const activationId = async (code: string, deviceId: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${deviceId}\0${code.trim()}`))), (byte) => byte.toString(16).padStart(2, '0')).join('')

const accountFromActivation = (id: string, fingerprint: string, expiresAt?: string): Account => ({
  id, activationId: fingerprint, name: '客户账号', plan: '已激活', status: '可用', relayUrl, defaultModel: 'gpt-5.5', expiresAt,
  usage: { quota: 0, used: 0, requests: 0, updatedAt: '' }, details: [],
  trace: { ip: '--', location: '--', tls: baseUrl.startsWith('https:') ? 'TLS' : 'HTTP' },
})

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [view, setView] = useState<'home' | 'workspace'>('home')
  const [storageReady, setStorageReady] = useState(false)
  const [storageWritable, setStorageWritable] = useState(true)

  useEffect(() => { void loadAccounts().then(setAccounts).catch(() => setStorageWritable(false)).finally(() => setStorageReady(true)) }, [])
  useEffect(() => { if (storageReady && storageWritable) void saveAccounts(accounts).catch(() => setStorageWritable(false)) }, [accounts, storageReady, storageWritable])
  const addAccounts = (next: Account[]) => setAccounts((current) => [...current, ...next])
  const updateAccount = (id: string, patch: Partial<Account>) => setAccounts((current) => current.map((account) => account.id === id ? { ...account, ...patch } : account))
  const removeAccount = async (id: string) => {
    await deleteCustomerSession(id)
    setAccounts((current) => {
      const next = current.filter((account) => account.id !== id)
      setActiveIndex((index) => Math.min(index, Math.max(0, next.length - 1)))
      if (!next.length) setView('home')
      return next
    })
  }

  if (!storageReady) return <main className="activation-shell"><section className="activation-panel loading-panel"><IconLoader2 className="spin" /></section></main>
  return view === 'workspace' && accounts.length
    ? <Workspace accounts={accounts} activeIndex={activeIndex} onSelect={setActiveIndex} onUpdate={updateAccount} onHome={() => setView('home')} onDelete={removeAccount} />
    : <ActivationForm accounts={accounts} storageWritable={storageWritable} onSuccess={addAccounts} onOpen={() => setView('workspace')} />
}

function ActivationForm({ accounts, storageWritable, onSuccess, onOpen }: { accounts: Account[]; storageWritable: boolean; onSuccess: (accounts: Account[]) => void; onOpen: () => void }) {
  const [codes, setCodes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [diagnostic, setDiagnostic] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const codesToActivate = parseCodes(codes)
    setBusy(true); setError(''); setDiagnostic('')
    try {
      const id = await deviceId()
      const activated: Account[] = []
      const knownAccountIds = accounts.map((account) => account.id)
      const knownActivationIds = new Set(accounts.flatMap((account) => account.activationId ? [account.activationId] : []))
      for (const code of codesToActivate) {
        const fingerprint = await activationId(code, id)
        if (knownActivationIds.has(fingerprint)) throw new ApiError('这个账号已经添加，无需重复激活。', 409, 'ACCOUNT_ALREADY_ADDED', undefined, 409)
        const accountId = crypto.randomUUID()
        const result = await activate(baseUrl, code, id, accountId, knownAccountIds)
        activated.push(accountFromActivation(accountId, fingerprint, result.expiresAt))
        knownAccountIds.push(accountId)
        knownActivationIds.add(fingerprint)
      }
      onSuccess(activated); setCodes('')
    } catch (reason) {
      if (reason instanceof ApiError) {
        const status = reason.status && reason.status >= 100 && reason.status <= 599 ? `HTTP ${reason.status}` : ''
        const code = typeof reason.code === 'number' ? `业务码 ${reason.code}` : ''
        const safeReason = reason.reason && /^[A-Z0-9_:-]{1,128}$/.test(reason.reason) ? reason.reason : ''
        setDiagnostic([status, code, safeReason].filter(Boolean).join(' · '))
      }
      setError(reason instanceof Error ? reason.message : '激活失败，请稍后重试。')
    } finally { setBusy(false) }
  }
  return <main className="activation-shell"><section className="activation-panel"><header className="brand">ChatGPT 账号切换器</header><h1>添加账号</h1><p className="intro">输入兑换码以绑定当前设备。</p>
    <form onSubmit={submit}><label>卡密<textarea value={codes} onChange={(event) => setCodes(event.target.value)} placeholder="每行输入一个卡密" rows={4} required /></label>{error && <p className="form-error" role="alert">{error}</p>}{diagnostic && <p className="diagnostic" aria-live="polite">{diagnostic}</p>}<button className="primary" disabled={!desktop || busy || !codes.trim()}>{busy && <IconLoader2 className="spin" />}{busy ? '正在验证' : '添加账号'}</button></form>
    {accounts.length > 0 && <button className="open-workspace" onClick={onOpen}>查看账号 <span>{accounts.length}</span></button>}{!desktop && <p className="form-error" role="alert">请使用 npm run tauri dev 启动桌面端。</p>}{!storageWritable && <p className="form-error" role="alert">本地保存不可用。</p>}
  </section></main>
}

function Workspace({ accounts, activeIndex, onSelect, onUpdate, onHome, onDelete }: { accounts: Account[]; activeIndex: number; onSelect: (index: number) => void; onUpdate: (id: string, patch: Partial<Account>) => void; onHome: () => void; onDelete: (id: string) => Promise<void> }) {
  const account = accounts[activeIndex]
  const [usageOpen, setUsageOpen] = useState(false)
  const [noticesOpen, setNoticesOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [workspaceError, setWorkspaceError] = useState('')
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null)
  const remainingPercent = 100 - percent(account.usage.used, account.usage.quota)
  const quotaTone = remainingPercent <= 15 ? 'is-low' : remainingPercent <= 50 ? 'is-medium' : 'is-healthy'
  const unread = notifications.filter((item) => !item.read).length
  useEffect(() => {
    let cancelled = false
    setUsageOpen(false); setWorkspaceError(''); setRefreshing(true)
    void getUsage(account.id).then((usage) => { if (!cancelled) onUpdate(account.id, { usage }) }).catch((reason) => { if (!cancelled) setWorkspaceError(reason instanceof Error ? reason.message : '无法获取用量。') }).finally(() => { if (!cancelled) setRefreshing(false) })
    void getNotifications(account.id).then((items) => { if (!cancelled) setNotifications(items.map((item) => ({ ...item, time: item.time || '' }))) }).catch((reason) => { if (!cancelled) setWorkspaceError(reason instanceof Error ? reason.message : '无法获取通知。') })
    return () => { cancelled = true }
  }, [account.id])
  useEffect(() => { if (!accountToDelete) return; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountToDelete(null) }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape) }, [accountToDelete])
  const refresh = async () => {
    setRefreshing(true); setWorkspaceError('')
    try { onUpdate(account.id, { usage: await getUsage(account.id) }) } catch (reason) { setWorkspaceError(reason instanceof Error ? reason.message : '无法获取用量。') } finally { setRefreshing(false) }
  }
  const toggleUsage = async () => {
    const open = !usageOpen; setUsageOpen(open)
    if (!open) return
    setDetailsLoading(true); setWorkspaceError('')
    try {
      const items = await getUsageDetails(account.id)
      onUpdate(account.id, { details: items.map((item) => ({ id: item.id, model: item.model, time: item.createdAt || new Date().toISOString(), inputTokens: item.inputTokens, outputTokens: item.outputTokens, status: '成功' as const })) })
    } catch (reason) { setWorkspaceError(reason instanceof Error ? reason.message : '无法获取用量明细。') } finally { setDetailsLoading(false) }
  }
  const markRead = async () => {
    const ids = notifications.filter((item) => !item.read).map((item) => item.id)
    if (!ids.length) return
    setWorkspaceError('')
    try { await markNotificationsRead(account.id, ids); setNotifications((current) => current.map((item) => ({ ...item, read: true }))) } catch (reason) { setWorkspaceError(reason instanceof Error ? reason.message : '无法标记通知。') }
  }

  return <><main className="workspace"><header className="app-header"><div className="brand">ChatGPT 账号切换器</div><div className="header-actions"><button className="icon-button notification-button" onClick={() => setNoticesOpen((value) => !value)} aria-label="通知" aria-expanded={noticesOpen}><IconBell size={18} />{unread > 0 && <i>{unread}</i>}</button><button className="icon-button" onClick={onHome} aria-label="返回首页"><IconHome size={18} /></button></div></header>
    {workspaceError && <p className="form-error" role="alert">{workspaceError}</p>}
    {noticesOpen && <section className="notification-panel"><div className="panel-heading"><strong>通知</strong>{unread > 0 && <button onClick={() => void markRead()}>全部已读</button>}</div>{notifications.length ? notifications.map((item) => <article key={item.id} className={item.read ? '' : 'is-unread'}><div><strong>{item.title}</strong><time>{item.time ? new Date(item.time).toLocaleString('zh-CN') : ''}</time></div><p>{item.content}</p></article>) : <p className="empty">暂无通知</p>}</section>}
    <nav className="account-switcher" aria-label="账号切换">{accounts.map((item, index) => <button key={item.id} className={index === activeIndex ? 'is-active' : ''} onClick={() => onSelect(index)}><span>{item.name}</span><code>{item.plan} · {item.status}</code></button>)}</nav>
    <section className="usage-summary"><div className="section-heading"><div><span className="section-label">剩余额度</span><h1>{number(account.usage.quota - account.usage.used)}</h1></div><button className="icon-button" onClick={() => void refresh()} aria-label="刷新用量" disabled={refreshing}><IconRefresh size={18} className={refreshing ? 'spin' : ''} /></button></div><div className={`usage-meter ${quotaTone}`} role="progressbar" aria-label="剩余额度" aria-valuenow={remainingPercent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${remainingPercent}%` }} /></div><div className="usage-meta"><span>剩余 {remainingPercent}% · 已用 {number(account.usage.used)} / {number(account.usage.quota)}</span><span>{account.usage.updatedAt ? `已同步 ${new Date(account.usage.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '尚未同步'} · 刷新 {account.usage.requests} 次</span></div></section>
    <section className="config-section"><div className="section-heading"><h2>账号配置</h2><div className="config-actions"><span className={`status ${account.status === '可用' ? 'is-ok' : ''}`}>{account.status}</span><button className="delete-button" onClick={() => setAccountToDelete(account)}><IconTrash size={15} />删除</button></div></div><div className="config-row"><span>API 密钥</span><code>已安全保存</code></div><div className="config-row"><span>转发地址</span><code>{account.relayUrl}</code></div><dl className="account-facts"><div><dt>默认模型</dt><dd>{account.defaultModel}</dd></div><div><dt>有效期</dt><dd>{account.expiresAt ? new Date(account.expiresAt).toLocaleDateString('zh-CN') : '长期有效'}</dd></div></dl><CodexConfigActions accountId={account.id} /></section>
    <section className={`usage-disclosure${usageOpen ? ' is-open' : ''}`}><button className="usage-toggle" onClick={() => void toggleUsage()} aria-expanded={usageOpen} aria-controls="usage-details" disabled={detailsLoading}><span className="usage-toggle-icon"><IconKey size={19} /></span><strong>{detailsLoading ? '正在加载' : '用量明细'}</strong><IconChevronDown className="chevron" size={19} /></button>{usageOpen && <div id="usage-details" className="usage-content">{account.details.length ? account.details.map((item) => <article className="usage-row" key={item.id}><div><strong>{item.model}</strong><time>{new Date(item.time).toLocaleString('zh-CN')}</time></div><span>{number(item.inputTokens)} 输入<br />{number(item.outputTokens)} 输出</span></article>) : <p className="empty">{detailsLoading ? '正在加载…' : '暂无用量记录'}</p>}</div>}</section>
    <details className="network-details"><summary><span><IconGlobe size={19} />网络信息</span><IconChevronDown size={19} /></summary><dl><div><dt>IP</dt><dd>{account.trace.ip}</dd></div><div><dt>地区</dt><dd>{account.trace.location}</dd></div><div><dt>TLS</dt><dd>{account.trace.tls}</dd></div></dl></details>
  </main>{accountToDelete && <DeleteDialog account={accountToDelete} onCancel={() => setAccountToDelete(null)} onConfirm={async () => { await onDelete(accountToDelete.id); setAccountToDelete(null) }} />}</>
}

function CodexConfigActions({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<CodexConfigStatus | null>(null)
  const [busy, setBusy] = useState<'apply' | 'restore' | ''>('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    setError(''); setMessage(''); setStatus(null)
    void diagnoseCodexConfig(accountId)
      .then((result) => { if (!cancelled) setStatus(result) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '无法检查 Codex 配置。') })
    return () => { cancelled = true }
  }, [accountId])

  const apply = async () => {
    if (!window.confirm('将备份当前官方配置，并修改 Codex 的 auth.json、config.toml 和历史任务 Provider。是否继续？')) return
    setBusy('apply'); setError(''); setMessage('')
    try {
      const result = await applyCodexConfig(accountId)
      setStatus(result); setMessage(`已应用 sub2api / gpt-5.5${result.repairedSessions ? `，迁移 ${result.repairedSessions} 个历史任务` : ''}。请重启 Codex。`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法修改 Codex 配置。') } finally { setBusy('') }
  }

  const restore = async () => {
    if (!window.confirm('将恢复本工具第一次修改前的官方 Codex 配置，并迁移历史任务。账号记录不会删除。是否继续？')) return
    setBusy('restore'); setError(''); setMessage('')
    try {
      const result = await restoreOfficialCodexConfig()
      setStatus(result); setMessage('已恢复首次官方配置基线。请重启 Codex。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法还原 Codex 配置。') } finally { setBusy('') }
  }

  const activeHere = status?.configured && status.currentAccountId === accountId
  const stateLabel = !status ? '正在检查' : activeHere && status.healthy ? '当前账号已应用' : status.configured ? '其他账号已应用' : '官方配置'
  return <div className="codex-actions"><div className="codex-state"><div><strong>Codex 一键配置</strong><span className={activeHere ? 'is-active' : ''}>{stateLabel}</span></div><p>{status?.configured ? `${status.provider ?? 'sub2api'} · ${status.model ?? 'gpt-5.5'}` : '修改前自动保存首次官方基线'}</p></div>{message && <p className="form-success" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="codex-buttons"><button className="codex-apply" onClick={() => void apply()} disabled={!!busy}>{busy === 'apply' && <IconLoader2 size={15} className="spin" />}{busy === 'apply' ? '正在修改' : activeHere ? '重新应用' : '一键修改'}</button><button className="codex-restore" onClick={() => void restore()} disabled={!!busy || !status?.backupAvailable}>{busy === 'restore' && <IconLoader2 size={15} className="spin" />}{busy === 'restore' ? '正在还原' : '还原官方配置'}</button></div></div>
}

function DeleteDialog({ account, onCancel, onConfirm }: { account: Account; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const confirm = async () => { setBusy(true); setError(''); try { await onConfirm() } catch (reason) { setError(reason instanceof Error ? reason.message : '无法删除账号。') } finally { setBusy(false) } }
  return <div className="delete-dialog-backdrop" role="presentation" onMouseDown={busy ? undefined : onCancel}><section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" onMouseDown={(event) => event.stopPropagation()}><span className="delete-dialog-icon"><IconAlertTriangle size={22} /></span><div><p className="delete-dialog-kicker">危险操作</p><h2 id="delete-dialog-title">删除这个账号？</h2></div><p id="delete-dialog-description">将移除“{account.name}”的本地记录和系统安全凭据。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="delete-dialog-actions"><button className="dialog-cancel" onClick={onCancel} disabled={busy} autoFocus>保留账号</button><button className="dialog-confirm" onClick={() => void confirm()} disabled={busy}><IconTrash size={16} />{busy ? '正在删除' : '确认删除'}</button></div></section></div>
}
