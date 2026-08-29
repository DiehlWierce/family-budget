import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * В dev-режиме приложение сохраняет данные прямо в public/data —
 * тот же код, что в проде уходит в GitHub Contents API.
 */
function localSave(): Plugin {
  return {
    name: 'local-save',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end() }
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', async () => {
          try {
            const files: Record<string, string> = JSON.parse(body)
            for (const [name, content] of Object.entries(files)) {
              if (!/^[a-z-]+\.json$/.test(name)) throw new Error('плохое имя файла: ' + name)
              await writeFile(resolve(process.cwd(), 'public/data', name), content, 'utf8')
            }
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: true, written: Object.keys(files) }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: String(e) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  base: process.env.VITE_BASE ?? '/family-budget/',
  plugins: [react(), localSave()],
})
