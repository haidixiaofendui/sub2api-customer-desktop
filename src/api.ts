import { invoke } from '@tauri-apps/api/core'

type ActivationResult = { success: boolean; status: number; code?: number; reason?: string; retryAfter?: number; expiresAt?: string }
type ServiceResult = { success: boolean; status: number; code?: number; reason?: string }
type UsageResult = ServiceResult & { usage?: { quota: number; used: number; requests: number } }
type UsageDetailsResult = ServiceResult & { items?: RemoteUsageDetail[] }
type NotificationsResult = ServiceResult & { items?: RemoteNotification[] }

export type RemoteUsageDetail = { id: string; model: string; createdAt?: string; inputTokens: number; outputTokens: number }
export type RemoteNotification = { id: string; title: string; content: string; time?: string; read: boolean }

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly reason?: string, readonly retryAfter?: number, readonly code?: number) { super(message) }
}

const errorMessage = (status: number, reason?: string) => {
  if (reason === 'CONFIG_ERROR') return '服务地址配置无效。'
  if (reason === 'NETWORK_ERROR') return '无法连接服务器，请检查地址和网络。'
  if (reason === 'SECURE_STORAGE_FAILED') return '激活已完成，但无法保存到系统安全凭据库。请稍后使用相同兑换码重新激活。'
  if (reason === 'INVALID_RESPONSE') return '服务器没有返回可用的授权信息。'
  if (reason === 'INVALID_TOKEN' || status === 401) return '账号授权已失效，请重新添加账号。'
  if (reason === 'ACCOUNT_ALREADY_ADDED') return '这个账号已经添加，无需重复激活。'
  if (status === 400) return '兑换码或设备标识格式不正确，请检查后重试。'
  if (status === 403) return reason === 'DEVICE_MISMATCH' ? '该兑换码已绑定其他设备，请联系客服处理换机。' : '该兑换码已绑定其他设备或当前服务禁止自助激活，请联系部署方。'
  if (status === 404 && reason === 'REDEEM_CODE_NOT_FOUND') return '兑换码不存在，请检查输入。'
  if (status === 409 && reason === 'REDEEM_CODE_USED') return '兑换码已使用，请更换兑换码或联系客服。'
  if (status === 409 && reason === 'REDEEM_CODE_EXPIRED') return '兑换码已过期，请更换兑换码。'
  if (status === 409 && reason === 'REDEEM_CODE_LOCKED') return '兑换码正在处理中，请稍后重试。'
  if (status === 429) return '请求过于频繁，请等待后再试。'
  if (status >= 500) return '服务暂时无法完成激活，请稍后重试。'
  return '服务器未能完成激活。'
}

const ensureService = <T extends ServiceResult>(result: T) => {
  if (!result.success) throw new ApiError(errorMessage(result.status, result.reason), result.status, result.reason, undefined, result.code)
  return result
}

export async function activate(baseUrl: string, code: string, deviceId: string, accountId: string, existingAccountIds: string[]) {
  const redemptionCode = code.trim()
  if (!redemptionCode || redemptionCode.length > 64) throw new ApiError('兑换码长度应为 1～64 个字符。')
  if (deviceId.trim().length < 16 || deviceId.trim().length > 256) throw new ApiError('设备标识无效，请重新安装应用后再试。')
  const result = await invoke<ActivationResult>('activate_customer', { request: { baseUrl, code: redemptionCode, deviceId: deviceId.trim(), accountId, existingAccountIds } })
  if (!result.success) throw new ApiError(errorMessage(result.status, result.reason), result.status, result.reason, result.retryAfter, result.code)
  return result
}

export async function deleteCustomerSession(accountId: string) {
  await invoke('delete_customer_session', { request: { accountId } })
}

export async function getUsage(accountId: string) {
  const result = ensureService(await invoke<UsageResult>('get_usage', { request: { accountId } }))
  if (!result.usage) throw new ApiError('服务器没有返回可用的用量信息。', result.status, 'INVALID_RESPONSE')
  return { ...result.usage, updatedAt: new Date().toISOString() }
}

export async function getUsageDetails(accountId: string) {
  return ensureService(await invoke<UsageDetailsResult>('get_usage_details', { request: { accountId } })).items ?? []
}

export async function getNotifications(accountId: string) {
  return ensureService(await invoke<NotificationsResult>('get_notifications', { request: { accountId } })).items ?? []
}

export async function markNotificationsRead(accountId: string, notificationIds: string[]) {
  ensureService(await invoke<ServiceResult>('mark_notifications_read', { request: { accountId, notificationIds } }))
}
