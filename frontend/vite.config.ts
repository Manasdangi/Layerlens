import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend: API on :4000, preview pages on :4001 (a different origin from this app).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
})
