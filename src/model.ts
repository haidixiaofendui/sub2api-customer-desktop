export type UsageDetail = {
  id: string
  model: string
  time: string
  inputTokens: number
  outputTokens: number
  status: '成功' | '失败'
}

export type Account = {
  id: string
  activationId?: string
  name: string
  plan: string
  status: '可用' | '受限'
  relayUrl: string
  expiresAt?: string
  usage: { quota: number; used: number; remaining?: number; unit?: string; mode?: string; planName?: string; updatedAt: string }
  details: UsageDetail[]
  trace: { ip: string; location: string; tls: string }
}

export type Notification = {
  id: string
  title: string
  content: string
  time: string
  read: boolean
}
