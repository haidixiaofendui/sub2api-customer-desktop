import { useEffect, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { IconCircleCheck, IconLoader2 } from '@tabler/icons-react'
import { activate, ApiError } from './api'
import { deviceId } from './storage'

const baseUrl = import.meta.env.DEV ? 'http://8.136.139.105:8080' : (import.meta.env.VITE_SUB2API_URL ?? '')
const desktop = isTauri()

export default function App() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [savedSession, setSavedSession] = useState(false)
  const [activated, setActivated] = useState(false)
  const [error, setError] = useState('')
  const [diagnostic, setDiagnostic] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!desktop) {
      setError('当前运行在网页开发模式，无法使用系统安全凭据库。请使用 npm run tauri dev 启动桌面端。')
      setReady(true)
      return
    }
    void invoke<boolean>('has_customer_session').then(setSavedSession).catch(() => setError('无法访问系统安全凭据库，请检查应用权限。')).finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!cooldown) return
    const timer = window.setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (cooldown) return
    setBusy(true)
    setError('')
    setDiagnostic('')
    setActivated(false)
    try {
      const id = await deviceId()
      await activate(baseUrl, code, id)
      setSavedSession(true)
      setActivated(true)
      setCode('')
    } catch (reason) {
      if (reason instanceof ApiError) {
        if (reason.status === 429) setCooldown(Math.max(1, reason.retryAfter ?? 60))
        const status = reason.status && reason.status >= 100 && reason.status <= 599 ? `HTTP ${reason.status}` : ''
        const code = reason.code !== undefined ? `业务码 ${reason.code}` : ''
        const safeReason = reason.reason && /^[A-Z0-9_:-]{1,128}$/.test(reason.reason) ? reason.reason : ''
        setDiagnostic([status, code, safeReason].filter(Boolean).join(' · '))
      }
      setError(reason instanceof Error ? reason.message : '激活失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  if (!ready) return <main className="activation-shell"><section className="activation-panel loading-panel"><IconLoader2 className="spin" /></section></main>

  return <main className="activation-shell">
    <section className="activation-panel">
      <header className="brand">Sub2API 客户端</header>
      <h1>激活兑换码</h1>
      <p className="intro">输入兑换码以绑定当前安装设备。凭据仅保存到系统安全凭据库，不会写入普通配置文件或剪贴板。</p>
      {savedSession && <p className="form-success"><IconCircleCheck size={17} />{activated ? '激活完成，凭据已安全保存。' : '此设备已有安全保存的激活凭据；再次激活可恢复当前设备的凭据。'}</p>}
      <form onSubmit={submit}>
        <label>
          兑换码
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="请输入兑换码" maxLength={64} autoComplete="off" autoCapitalize="none" spellCheck={false} required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {diagnostic && <p className="diagnostic" aria-live="polite">{diagnostic}</p>}
        <button className="primary" disabled={!desktop || busy || !!cooldown || !code.trim()}>
          {busy && <IconLoader2 className="spin" />}
          {cooldown ? `${cooldown} 秒后可重试` : busy ? '正在激活' : '激活'}
        </button>
      </form>
      <p className="server">服务地址：{baseUrl}</p>
    </section>
  </main>
}
