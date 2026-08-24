import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const demoMode = loadEnv(mode, '.', 'VITE_').VITE_DEMO_MODE === 'true'
  return {
    plugins: [react()],
    define: { __DEMO_MODE__: JSON.stringify(demoMode) },
    clearScreen: false,
    server: { port: 1420, strictPort: true },
    envPrefix: ['VITE_', 'TAURI_'],
  }
})
