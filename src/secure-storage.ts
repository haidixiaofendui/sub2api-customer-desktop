import { invoke } from '@tauri-apps/api/core'
import type { Session } from './api'

export const saveSession = (session: Session) => invoke<void>('save_customer_session', { session })
export const hasSavedSession = () => invoke<boolean>('has_customer_session')
