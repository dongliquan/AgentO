import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/main/index.ts'),
          daemon: resolve(__dirname, 'src/daemon/index.ts')
        },
        output: { entryFileNames: '[name]/index.js' }
      },
      outDir: 'out'
    },
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  },
  renderer: {
    plugins: [react()],
    // Dedicated dev-server port (5173 is usually taken by other Vite apps). Falls back to the next free port.
    // Kept below the daemon's 47831+ range.
    server: { port: 47820, strictPort: false },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
