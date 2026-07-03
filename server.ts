import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000
const tsxBin = path.resolve(__dirname, 'node_modules/.bin/tsx')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
} as const

function setCors(res: http.ServerResponse) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  setCors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const running = new Set<string>()

const server = http.createServer(async (req, res) => {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url?.startsWith('/snapshots/')) {
    const cleanUrl = req.url.split('?')[0]
    const filename = path.basename(cleanUrl)
    const filePath = path.join(__dirname, 'snapshots', filename)
    if (fs.existsSync(filePath)) {
      setCors(res)
      res.writeHead(200, { 'Content-Type': 'image/png' })
      fs.createReadStream(filePath).pipe(res)
      return
    } else {
      json(res, 404, { ok: false, error: 'Snapshot not found' })
      return
    }
  }

  if (req.method !== 'POST' || req.url !== '/change-pin') {
    json(res, 404, { ok: false, error: 'Not found' })
    return
  }

  let body: string
  try {
    body = await readBody(req)
  } catch {
    json(res, 400, { ok: false, error: 'Failed to read request body' })
    return
  }

  let payload: Record<string, string>
  try {
    payload = JSON.parse(body)
  } catch {
    json(res, 400, { ok: false, error: 'Invalid JSON body' })
    return
  }

  const { email, password, profileName, profileId, oldPin, newPin } = payload
  const missing = ['email', 'password', 'profileName', 'profileId', 'oldPin', 'newPin']
    .filter(k => !payload[k])
  if (missing.length) {
    json(res, 400, { ok: false, error: `Missing fields: ${missing.join(', ')}` })
    return
  }

  if (running.has(profileId)) {
    json(res, 409, { ok: false, error: 'Automasi sudah berjalan untuk profil ini' })
    return
  }
  running.add(profileId)

  console.log(`[change-pin] Starting for profile "${profileName}" (${profileId})`)

  // Start streaming response immediately after spawn guard passes
  res.writeHead(200, {
    ...CORS_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })

  const child = spawn(tsxBin, ['scripts/change-pin.ts'], {
    cwd: __dirname,
    env: {
      ...process.env,
      NETFLIX_EMAIL: email,
      NETFLIX_PASSWORD: password,
      NETFLIX_PROFILE: profileName,
      NETFLIX_PROFILE_ID: profileId,
      NETFLIX_PIN: oldPin,
      NETFLIX_NEW_PIN: newPin,
      HEADLESS: 'true',
    },
  })

  let stderr = ''

  child.stdout.on('data', (d: Buffer) => {
    const text = d.toString()
    process.stdout.write(`[change-pin] ${text}`)
    if (!res.writableEnded) res.write(text)
  })

  child.stderr.on('data', (d: Buffer) => {
    const text = d.toString()
    stderr += text
    process.stderr.write(`[change-pin:err] ${text}`)
    if (!res.writableEnded) res.write(`[ERR] ${text}`)
  })

  const timer = setTimeout(() => {
    console.error(`[change-pin] Timeout for profile "${profileName}" — killing process`)
    child.kill('SIGTERM')
    if (!res.writableEnded) {
      res.write('\n__DONE__:error:Timeout setelah 5 menit\n')
      res.end()
    }
    running.delete(profileId)
  }, 5 * 60 * 1000)

  child.on('error', (err: NodeJS.ErrnoException) => {
    clearTimeout(timer)
    running.delete(profileId)
    console.error(`[change-pin] Failed to start: ${err.message}`)
    if (!res.writableEnded) {
      res.write(`\n__DONE__:error:Gagal menjalankan script: ${err.message}\n`)
      res.end()
    }
  })

  child.on('close', (code: number | null) => {
    clearTimeout(timer)
    running.delete(profileId)
    if (res.writableEnded) return

    if (code === 0) {
      console.log(`[change-pin] Success for profile "${profileName}"`)
      res.write('\n__DONE__:ok\n')
    } else {
      const lastErr = stderr.trim().split('\n').at(-1) ?? 'Unknown error'
      console.error(`[change-pin] Failed (exit ${code}) for "${profileName}": ${lastErr}`)
      res.write(`\n__DONE__:error:Script gagal (exit ${code}): ${lastErr}\n`)
    }
    res.end()
  })
})

server.listen(PORT, () => {
  console.log(`Automation server running on http://localhost:${PORT}`)
})
