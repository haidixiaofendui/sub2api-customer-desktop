import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { IconCircleCheck, IconLoader2 } from '@tabler/icons-react'
import { activate, ApiError, type Session } from './api'
import { hasSavedSession, saveSession } from './secure-storage'
import { deviceId } from './storage'

const baseUrl = import.meta.env.VITE_SUB2API_URL ?? 'http://localhost:8080'
const desktop = isTauri()

export default function App() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [savedSession, setSavedSession] = useState(false)
  const [session, setSession] = useState<Session>()
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!desktop) {
      setError('当前运行在网页开发模式，无法使用系统安全凭据库。请使用 npm run tauri dev 启动桌面端。')
      setReady(true)
      return
    }
    void hasSavedSession().then(setSavedSession).catch(() => setError('无法访问系统安全凭据库，请检查应用权限。')).finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!cooldown) return
    const timer = window.setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  const persist = async (next: Session) => {
    setSaveError('')
    try {
      await saveSession(next)
      setSavedSession(true)
      setSession(undefined)
    } catch {
      setSaveError('激活已完成，但凭据未能保存到系统安全凭据库。请保持应用打开后重试。')
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (cooldown) return
    setBusy(true)
    setError('')
    setSaveError('')
    try {
      const id = await deviceId()
      const next = await activate(baseUrl, code, id)
      setSession(next)
      await persist(next)
      setCode('')
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 429) setCooldown(Math.max(1, reason.retryAfter ?? 60))
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
      {savedSession && <p className="form-success"><IconCircleCheck size={17} />此设备已有安全保存的激活凭据；再次激活可恢复当前设备的凭据。</p>}
      <form onSubmit={submit}>
        <label>
          兑换码
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="请输入兑换码" maxLength={64} autoComplete="off" autoCapitalize="none" spellCheck={false} required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {saveError && <p className="form-error" role="alert">{saveError}{session && <button type="button" onClick={() => void persist(session)}>重新安全保存</button>}</p>}
        <button className="primary" disabled={!desktop || busy || !!cooldown || !code.trim()}>
          {busy && <IconLoader2 className="spin" />}
          {cooldown ? `${cooldown} 秒后可重试` : busy ? '正在激活' : '激活'}
        </button>
      </form>
      <p className="server">服务地址：{baseUrl}</p>
    </section>
  </main>
}
