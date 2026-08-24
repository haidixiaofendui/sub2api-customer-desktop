export type Session = {
  baseUrl: string
  accessToken: string
  refreshToken?: string
  apiKey: string
  expiresAt?: string
  demo?: boolean
}


type Envelope<T> = { code?: number; message?: string; data?: T }
type Activation = { access_token: string; refresh_token?: string; api_key: string; expires_at?: string }

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

const normaliseUrl = (value: string) => {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new ApiError('服务器地址必须使用 HTTP 或 HTTPS。')
  return url.toString().replace(/\/$/, '')
}

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    })
  } catch {
    throw new ApiError('无法连接服务器，请检查地址和网络。')
  }
  const body = await response.json().catch(() => ({})) as Envelope<T>
  if (!response.ok || body.code && body.code !== 0) throw new ApiError(body.message || '服务器未能完成请求。', response.status)
  return (body.data ?? body) as T
}

export async function activate(baseUrl: string, code: string, deviceId: string): Promise<Session> {
  const normalized = normaliseUrl(baseUrl)
  const data = await request<Activation>(normalized, '/api/v1/customer/activate', { method: 'POST', body: JSON.stringify({ code, device_id: deviceId }) })
  if (!data.access_token || !data.api_key) throw new ApiError('服务器没有返回可用的授权信息。')
  return { baseUrl: normalized, accessToken: data.access_token, refreshToken: data.refresh_token, apiKey: data.api_key, expiresAt: data.expires_at }
}

export type ApiKey = { id: number; name: string; key?: string; status: string; expires_at?: string; quota?: number; quota_used?: number; group?: { name?: string } }
export type Usage = { model?: string; input_tokens?: number; output_tokens?: number; total_cost?: number; created_at?: string }


type Page<T> = { items?: T[] }

const items = <T>(page: Page<T>) => Array.isArray(page.items) ? page.items : []

export async function loadKeys(session: Session) {
  return items(await request<Page<ApiKey>>(session.baseUrl, '/api/v1/keys?page=1&page_size=100&sort_by=created_at&sort_order=desc', {}, session.accessToken))
}

export async function loadUsage(session: Session) {
  return items(await request<Page<Usage>>(session.baseUrl, '/api/v1/usage?page=1&page_size=8&sort_by=created_at&sort_order=desc', {}, session.accessToken))
}
