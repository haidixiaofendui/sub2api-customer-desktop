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
  cardCode: string
  name: string
  plan: string
  status: '可用' | '受限'
  apiKey: string
  relayUrl: string
  defaultModel: string
  expiresAt?: string
  usage: {
    quota: number
    used: number
    requests: number
    updatedAt: string
  }
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
