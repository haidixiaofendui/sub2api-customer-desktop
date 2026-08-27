import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { IconBell, IconChevronDown, IconGlobe, IconHome, IconKey, IconLoader2, IconPlus, IconRefresh } from '@tabler/icons-react'
import { activate, applyCodexConfig, diagnoseCodexConfig, getCustomerApiKey, getCustomerGroups, getNotifications, getUsage, getUsageDetails, markNotificationsRead, restoreOfficialCodexConfig, switchCustomerApiKeyGroup, ApiError } from './api'
import type { CodexConfigStatus, CustomerApiKey, CustomerGroup } from './api'
import type { Account, Notification } from './model'
import { deviceId, loadAccounts, saveAccounts } from './storage'

const baseUrl = import.meta.env.VITE_SUB2API_URL ?? 'http://8.136.139.105:8080'
const relayUrl = `${baseUrl.replace(/\/+$/, '')}/v1`
const desktop = isTauri()
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value)
const percent = (value: number, total: number) => total ? Math.min(100, Math.round(value / total * 100)) : 0
const amount = (value: number, unit = 'USD') => unit === 'USD' ? `$${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)}` : `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)} ${unit}`
const activationId = async (code: string, deviceId: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${deviceId}\0${code.trim()}`))), (byte) => byte.toString(16).padStart(2, '0')).join('')

const accountFromActivation = (id: string, fingerprint: string, expiresAt?: string): Account => ({
  id, activationId: fingerprint, name: '客户账号', plan: '已激活', status: '可用', relayUrl, expiresAt,
  usage: { quota: 0, used: 0, remaining: undefined, unit: 'USD', updatedAt: '' }, details: [],
  trace: { ip: '--', location: '--', tls: baseUrl.startsWith('https:') ? 'TLS' : 'HTTP' },
})

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [view, setView] = useState<'home' | 'workspace'>('home')
  const [storageReady, setStorageReady] = useState(false)
  const [storageWritable, setStorageWritable] = useState(true)

  useEffect(() => {
    void loadAccounts().then(async (stored) => {
      if (stored.length <= 1) return setAccounts(stored)
      const status = await diagnoseCodexConfig().catch(() => null)
      setAccounts([stored.find((account) => account.id === status?.currentAccountId) ?? stored[0]])
    }).catch(() => setStorageWritable(false)).finally(() => setStorageReady(true))
  }, [])
  useEffect(() => { if (storageReady && storageWritable) void saveAccounts(accounts).catch(() => setStorageWritable(false)) }, [accounts, storageReady, storageWritable])
  const setAccount = (account: Account) => setAccounts([account])
  const updateAccount = (id: string, patch: Partial<Account>) => setAccounts((current) => current.map((account) => account.id === id ? { ...account, ...patch } : account))
  if (!storageReady) return <main className="activation-shell"><section className="activation-panel loading-panel"><IconLoader2 className="spin" /></section></main>
  return view === 'workspace' && accounts.length
    ? <Workspace account={accounts[0]} onUpdate={updateAccount} onHome={() => setView('home')} />
    : <ActivationForm account={accounts[0]} storageWritable={storageWritable} onSuccess={setAccount} onOpen={() => setView('workspace')} />
}

function ActivationForm({ account, storageWritable, onSuccess, onOpen }: { account?: Account; storageWritable: boolean; onSuccess: (account: Account) => void; onOpen: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [diagnostic, setDiagnostic] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setError(''); setDiagnostic('')
    try {
      const id = await deviceId()
      const accountId = account?.id ?? crypto.randomUUID()
      const result = await activate(baseUrl, code, id, accountId, account ? [account.id] : [])
      const fingerprint = await activationId(code, id)
      onSuccess(account ? { ...account, activationId: fingerprint, expiresAt: result.expiresAt } : accountFromActivation(accountId, fingerprint, result.expiresAt))
      setCode('')
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
  return <main className="activation-shell"><section className="activation-panel"><header className="brand">Sub2API 客户端</header><h1>{account ? '为当前设备续充' : '激活当前设备'}</h1><p className="intro">输入一张卡密，系统将按当前设备创建账号或增加额度。</p>
    <form onSubmit={submit}><label>卡密<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="输入卡密" autoComplete="off" required /></label>{error && <p className="form-error" role="alert">{error}</p>}{diagnostic && <p className="diagnostic" aria-live="polite">{diagnostic}</p>}<button className="primary" disabled={!desktop || busy || !code.trim()}>{busy && <IconLoader2 className="spin" />}{busy ? '正在验证' : account ? '增加额度' : '激活设备'}</button></form>
    {account && <button className="open-workspace" onClick={onOpen}>进入工作区</button>}{!desktop && <p className="form-error" role="alert">请使用 npm run tauri dev 启动桌面端。</p>}{!storageWritable && <p className="form-error" role="alert">本地保存不可用。</p>}
  </section></main>
}

function Workspace({ account, onUpdate, onHome }: { account: Account; onUpdate: (id: string, patch: Partial<Account>) => void; onHome: () => void }) {
  const [usageOpen, setUsageOpen] = useState(false)
  const [noticesOpen, setNoticesOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [workspaceError, setWorkspaceError] = useState('')
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [apiKey, setApiKey] = useState<CustomerApiKey | null>(null)
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [switchingGroup, setSwitchingGroup] = useState<number | null>(null)
  const [rechargeCode, setRechargeCode] = useState('')
  const [recharging, setRecharging] = useState(false)
  const [rechargeMessage, setRechargeMessage] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const usageReady = !!account.usage.updatedAt && Number.isFinite(account.usage.remaining)
  const remaining = usageReady ? Math.max(0, account.usage.remaining ?? 0) : 0
  const remainingPercent = usageReady ? (account.usage.quota > 0 ? percent(remaining, account.usage.quota) : remaining > 0 ? 100 : 0) : 0
  const quotaTone = remainingPercent <= 15 ? 'is-low' : remainingPercent <= 50 ? 'is-medium' : 'is-healthy'
  const unread = notifications.filter((item) => !item.read).length
  useEffect(() => {
    let cancelled = false
    setUsageOpen(false); setWorkspaceError(''); setRefreshing(true); setGroupsLoading(true)
    void getUsage(account.id).then((usage) => { if (!cancelled) onUpdate(account.id, { usage }) }).catch((reason) => { if (!cancelled) setWorkspaceError(reason instanceof Error ? reason.message : '无法获取用量。') }).finally(() => { if (!cancelled) setRefreshing(false) })
    void getNotifications(account.id).then((items) => { if (!cancelled) setNotifications(items.map((item) => ({ ...item, time: item.time || '' }))) }).catch((reason) => { if (!cancelled) setWorkspaceError(reason instanceof Error ? reason.message : '无法获取通知。') })
    void Promise.all([getCustomerApiKey(account.id), getCustomerGroups(account.id)]).then(([key, availableGroups]) => { if (!cancelled) { setApiKey(key); setGroups(availableGroups) } }).catch((reason) => { if (!cancelled) { setApiKey(null); setGroups([]); setWorkspaceError(reason instanceof Error ? reason.message : '无法获取可用分组。') } }).finally(() => { if (!cancelled) setGroupsLoading(false) })
    return () => { cancelled = true }
  }, [account.id, reloadVersion])
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
  const switchGroup = async (group: CustomerGroup) => {
    if (!apiKey || apiKey.group?.id === group.id || switchingGroup !== null) return
    setSwitchingGroup(group.id); setWorkspaceError('')
    try {
      const selected = await switchCustomerApiKeyGroup(account.id, apiKey.id, group.id)
      setApiKey({ ...apiKey, group: selected })
    } catch (reason) { setWorkspaceError(reason instanceof Error ? reason.message : '无法切换分组。') } finally { setSwitchingGroup(null) }
  }
  const recharge = async (event: React.FormEvent) => {
    event.preventDefault(); setRecharging(true); setWorkspaceError(''); setRechargeMessage('')
    try {
      const id = await deviceId()
      const result = await activate(baseUrl, rechargeCode, id, account.id, [account.id])
      onUpdate(account.id, { activationId: await activationId(rechargeCode, id), expiresAt: result.expiresAt })
      setRechargeCode(''); setRechargeMessage('额度已增加，正在同步服务端数据。'); setReloadVersion((value) => value + 1)
    } catch (reason) { setWorkspaceError(reason instanceof Error ? reason.message : '增加额度失败。') } finally { setRecharging(false) }
  }

  return <><main className="workspace"><header className="app-header"><div className="brand">Sub2API 客户端</div><div className="header-actions"><button className="icon-button notification-button" onClick={() => setNoticesOpen((value) => !value)} aria-label="通知" aria-expanded={noticesOpen}><IconBell size={18} />{unread > 0 && <i>{unread}</i>}</button><button className="icon-button" onClick={onHome} aria-label="返回首页"><IconHome size={18} /></button></div></header>
    {workspaceError && <p className="form-error" role="alert">{workspaceError}</p>}
    {noticesOpen && <section className="notification-panel"><div className="panel-heading"><strong>通知</strong>{unread > 0 && <button onClick={() => void markRead()}>全部已读</button>}</div>{notifications.length ? notifications.map((item) => <article key={item.id} className={item.read ? '' : 'is-unread'}><div><strong>{item.title}</strong><time>{item.time ? new Date(item.time).toLocaleString('zh-CN') : ''}</time></div><p>{item.content}</p></article>) : <p className="empty">暂无通知</p>}</section>}
    <section className="group-section"><div className="group-heading"><span className="section-label">API 密钥分组</span>{!groupsLoading && !apiKey?.group && <strong>请选择分组</strong>}</div><nav className="group-switcher" aria-label="API 密钥分组">{groupsLoading ? <span className="group-loading"><IconLoader2 size={15} className="spin" />正在获取分组</span> : groups.length ? groups.map((group) => <button key={group.id} className={apiKey?.group?.id === group.id ? 'is-active' : ''} onClick={() => void switchGroup(group)} disabled={!apiKey || switchingGroup !== null}><span>{group.name}</span><code>{group.platform} · {group.rateMultiplier}x</code>{switchingGroup === group.id && <IconLoader2 size={13} className="spin" />}</button>) : <span className="group-loading">暂无可用分组</span>}</nav></section>
    <section className="usage-summary"><div className="section-heading"><div><span className="section-label">{account.usage.planName || '剩余额度'}</span><h1>{usageReady ? amount(remaining, account.usage.unit) : '—'}</h1></div><button className="icon-button" onClick={() => void refresh()} aria-label="刷新用量" disabled={refreshing}><IconRefresh size={18} className={refreshing ? 'spin' : ''} /></button></div><div className={`usage-meter ${quotaTone}`} role="progressbar" aria-label="剩余额度" aria-valuenow={remainingPercent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${remainingPercent}%` }} /></div><div className="usage-meta"><span>{usageReady ? `剩余 ${remainingPercent}% · 已用 ${amount(account.usage.used, account.usage.unit)} / ${amount(account.usage.quota, account.usage.unit)}` : '正在同步额度'}</span><span>{account.usage.updatedAt ? `已同步 ${new Date(account.usage.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '尚未同步'}</span></div></section>
    <section className="recharge-section"><div><span className="recharge-icon"><IconPlus size={18} /></span><div><strong>增加额度</strong><p>新卡密将充值到当前设备账号</p></div></div><form onSubmit={recharge}><input value={rechargeCode} onChange={(event) => setRechargeCode(event.target.value)} placeholder="输入新卡密" autoComplete="off" aria-label="新卡密" required /><button disabled={recharging || !rechargeCode.trim()}>{recharging && <IconLoader2 size={14} className="spin" />}{recharging ? '正在增加' : '增加额度'}</button></form>{rechargeMessage && <p className="form-success" role="status">{rechargeMessage}</p>}</section>
    <section className="config-section"><div className="section-heading"><h2>账号配置</h2><span className={`status ${account.status === '可用' ? 'is-ok' : ''}`}>{account.status}</span></div><div className="config-row"><span>API 密钥</span><code>{apiKey?.group ? `已绑定 ${apiKey.group.name}` : '尚未分组'}</code></div><dl className="account-facts"><div><dt>有效期</dt><dd>{account.expiresAt ? new Date(account.expiresAt).toLocaleDateString('zh-CN') : '长期有效'}</dd></div></dl><CodexConfigActions accountId={account.id} groupAssigned={!!apiKey?.group} /></section>
    <section className={`usage-disclosure${usageOpen ? ' is-open' : ''}`}><button className="usage-toggle" onClick={() => void toggleUsage()} aria-expanded={usageOpen} aria-controls="usage-details" disabled={detailsLoading}><span className="usage-toggle-icon"><IconKey size={19} /></span><strong>{detailsLoading ? '正在加载' : '用量明细'}</strong><IconChevronDown className="chevron" size={19} /></button>{usageOpen && <div id="usage-details" className="usage-content">{account.details.length ? account.details.map((item) => <article className="usage-row" key={item.id}><div><strong>{item.model}</strong><time>{new Date(item.time).toLocaleString('zh-CN')}</time></div><span>{number(item.inputTokens)} 输入<br />{number(item.outputTokens)} 输出</span></article>) : <p className="empty">{detailsLoading ? '正在加载…' : '暂无用量记录'}</p>}</div>}</section>
    <details className="network-details"><summary><span><IconGlobe size={19} />网络信息</span><IconChevronDown size={19} /></summary><dl><div><dt>IP</dt><dd>{account.trace.ip}</dd></div><div><dt>地区</dt><dd>{account.trace.location}</dd></div><div><dt>TLS</dt><dd>{account.trace.tls}</dd></div></dl></details>
  </main></>
}

function CodexConfigActions({ accountId, groupAssigned }: { accountId: string; groupAssigned: boolean }) {
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
  return <div className="codex-actions"><div className="codex-state"><div><strong>Codex 一键配置</strong><span className={activeHere ? 'is-active' : ''}>{stateLabel}</span></div><p>{groupAssigned ? status?.configured ? `${status.provider ?? 'sub2api'} · ${status.model ?? 'gpt-5.5'}` : '修改前自动保存首次官方基线' : '请先为 API 密钥选择分组'}</p></div>{message && <p className="form-success" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="codex-buttons"><button className="codex-apply" onClick={() => void apply()} disabled={!!busy || !groupAssigned}>{busy === 'apply' && <IconLoader2 size={15} className="spin" />}{busy === 'apply' ? '正在修改' : activeHere ? '重新应用' : '一键修改'}</button><button className="codex-restore" onClick={() => void restore()} disabled={!!busy || !status?.backupAvailable}>{busy === 'restore' && <IconLoader2 size={15} className="spin" />}{busy === 'restore' ? '正在还原' : '还原官方配置'}</button></div></div>
}
