import { defineConfig } from 'vitest/config'
import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// The dev API bridge. `vite dev` doesn't run the Vercel functions in api/*, so this plugin mounts
// the same handler files on the dev server.
//   DATABASE_URL in .env.local  -> the handlers talk to the real Neon database
//   no DATABASE_URL             -> BLHS_DEV_DB=file gives them a local JSON store
// The JSON store is .data/dev-db.json (gitignored), so every server flow can be clicked through and
// tested locally. In production, Vercel runs api/* itself and never sees the file store.
function apiDevBridge(): Plugin {
  const root = process.cwd()
  return {
    name: 'blhs-api-dev-bridge',
    configureServer(server: ViteDevServer) {
      // .env.local (gitignored) can hold DATABASE_URL for testing against the real Neon database.
      const envFile = path.resolve(root, '.env.local')
      if (fs.existsSync(envFile)) {
        for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
          if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
        }
      }
      if (!process.env.DATABASE_URL) {
        process.env.BLHS_DEV_DB = 'file'
        // Seed a dev class so the join flow works right away. Its join code is DEVDEV.
        const dbFile = path.resolve(root, '.data/dev-db.json')
        if (!fs.existsSync(dbFile)) {
          fs.mkdirSync(path.dirname(dbFile), { recursive: true })
          fs.writeFileSync(dbFile, JSON.stringify({
            classes: [{ id: 'c_dev', code: 'DEVDEV', name: "Mr. Wiseman's crew (dev)", teacher_key: 'tk_dev', study_mode: false, open: true, created_at: new Date().toISOString() }],
            participants: [], states: {}, events: [],
          }, null, 1))
        }
      }

      server.middlewares.use('/api', (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const name = (req.url ?? '/').split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '')
        const file = path.resolve(root, 'api', `${name}.ts`)
        if (!name || name.startsWith('_') || !fs.existsSync(file)) return next()
        server.ssrLoadModule(`/api/${name}.ts`)
          .then((mod: Record<string, unknown>) => (mod.default as (rq: unknown, rs: unknown) => Promise<void>)(req, res))
          .catch((err: unknown) => {
            console.error(`[api-dev] ${name}:`, err)
            if (!res.headersSent) { res.statusCode = 500; res.end('{"error":"dev_bridge"}') }
          })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), apiDevBridge()],
  // The grape worker. Vite builds workers as `iife` by default, but MicroPython's wasm loader needs
  // code-splitting, which iife can't do, so the production build would fail. (The loader
  // dynamically imports node:module, fs and path in a branch that never runs in a browser.) `es`
  // matches how the worker is already created, with type: 'module' in src/vine/py/runGrape.ts.
  worker: { format: 'es' },
  // MicroPython's loader starts with a top-level `await import('node:module')` inside a branch that
  // only runs under Node. The default browser targets (chrome87/safari14) are older than top-level
  // await, so esbuild would refuse the whole chunk over a line the browser never reaches. This
  // marks the feature as supported instead of raising the target for the whole app. That's safe
  // because every browser that can run a `type: 'module'` worker supports top-level await, and the
  // worker is the only place in the app that uses it.
  esbuild: { supported: { 'top-level-await': true } },
  // The dev dependency optimizer runs its own esbuild pass that ignores the setting above, so it
  // would fail the same way. The package is already browser-ready ESM and doesn't need
  // pre-bundling, so leave it out of the optimizer.
  optimizeDeps: { exclude: ['@micropython/micropython-webassembly-pyscript'] },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
  },
})
