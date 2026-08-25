import { load } from '@tauri-apps/plugin-store'
const STORE_NAME = 'customer-session.json'
const DEVICE = 'device-id'

async function store() { return load(STORE_NAME, { autoSave: true }) }

export async function deviceId() {
  const file = await store()
  const existing = await file.get<string>(DEVICE)
  if (existing && existing.trim().length >= 16 && existing.trim().length <= 256) return existing
  const value = crypto.randomUUID()
  await file.set(DEVICE, value)
  return value
}
