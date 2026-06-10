import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the static build works under any path (Render static site, etc.).
  base: './',
  plugins: [react()],
})
