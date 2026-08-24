import type { Account, Notification } from './model'

const suffix = (code: string) => code.replace(/[^A-Z0-9]/g, '').slice(-6) || 'DEMO01'

export function createDemoAccounts(codes: string[]): Account[] {
  return codes.map((code, index) => {
    const keySuffix = suffix(code)
    const quota = [1_000_000, 800_000, 500_000][index % 3]
    const used = [276_300, 518_400, 460_000][index % 3]
    return {
      id: `demo-${keySuffix}`,
      cardCode: code,
      name: `账号 ${keySuffix.slice(-3)}`,
      plan: index % 2 ? 'Team' : 'Plus',
      status: '可用',
      apiKey: `sk-demo-${keySuffix.toLowerCase()}-not-real`,
      relayUrl: 'https://api.example.com/relay',
      defaultModel: index % 2 ? 'gpt-5.5-mini' : 'gpt-5.5',
      expiresAt: '2026-12-31T23:59:59+08:00',
      usage: {
        quota,
        used,
        requests: index % 2 ? 436 : 218,
        updatedAt: new Date().toISOString(),
      },
      details: [
        { id: `${keySuffix}-1`, model: 'gpt-5.5', time: '2026-08-24T16:28:00+08:00', inputTokens: 1280, outputTokens: 846, status: '成功' },
        { id: `${keySuffix}-2`, model: 'gpt-5.5-mini', time: '2026-08-24T15:42:00+08:00', inputTokens: 620, outputTokens: 371, status: '成功' },
        { id: `${keySuffix}-3`, model: 'gpt-4.1', time: '2026-08-24T14:16:00+08:00', inputTokens: 920, outputTokens: 510, status: '成功' },
      ],
      trace: { ip: '203.0.113.24', location: index % 2 ? 'HK' : 'SG', tls: 'TLS 1.3' },
    }
  })
}

export const demoNotifications: Notification[] = [
  { id: 'notice-1', title: '服务维护', content: '今晚 02:00 将进行短时维护。', time: '今天 10:30', read: false },
  { id: 'notice-2', title: '额度已刷新', content: '本周额度已自动刷新。', time: '昨天 00:00', read: true },
]
