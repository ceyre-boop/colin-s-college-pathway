import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works under any path.
  base: './',
  plugins: [react()],
  server: {
    // In dev, proxy the essay API to the local Bun server (`bun run start`).
    proxy: { '/api': 'http://localhost:3000' },
  },
})
