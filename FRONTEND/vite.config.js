import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

// Resolve root node_modules for npm workspace hoisting
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // In npm workspaces, packages are hoisted to the root node_modules.
    // Tell Vite to also look there when resolving bare imports.
    modules: [path.resolve(rootDir, 'node_modules'), 'node_modules'],
  },
  server: {
    fs: {
      // Allow Vite to serve files from the root workspace directory
      allow: [rootDir],
    },
  },
})
