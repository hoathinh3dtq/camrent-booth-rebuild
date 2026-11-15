// Local share — HTTP server trong LAN + QR code, trang xem/tải ảnh phiên chụp.
import http from 'node:http'
import os from 'node:os'
import QRCode from 'qrcode'
import { getSession } from './sessions'
import { getSetting } from '../db'

let server: http.Server | null = null
let currentSessionId: string | null = null

function lanAddress(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return null
}

export function startShare(sessionId: string): { url: string | null } {
  stopShare()
  const port = getSetting<number>('sharesPort', 8787)
  const s = getSession(sessionId)
  if (!s) throw new Error('Phiên không tồn tại')
  currentSessionId = sessionId

  server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      if (url.pathname === '/' || url.pathname === `/s/${sessionId}`) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(renderSharePage(s))
        return
      }
      const m = url.pathname.match(/^\/s\/([^/]+)\/(\d+)$/)
      if (m) {
        const idx = Number(m[2])
        const photo = s.photos[idx]
        if (photo) {
          const mm = photo.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
          if (mm) {
            res.setHeader('Content-Type', mm[1])
            res.end(Buffer.from(mm[2], 'base64'))
            return
          }
        }
        res.statusCode = 404
        res.end('Not found')
        return
      }
      res.statusCode = 404
      res.end('Not found')
    } catch (err) {
      res.statusCode = 500
      res.end('Server error')
    }
  })
  server.listen(port, '0.0.0.0')

  const ip = lanAddress()
  return { url: ip ? `http://${ip}:${port}/s/${sessionId}` : null }
}

export function stopShare(): void {
  if (server) server.close()
  server = null
  currentSessionId = null
}

export function shareStatus(): { running: boolean; sessionId: string | null; baseUrl: string | null } {
  const ip = lanAddress()
  const port = getSetting<number>('sharesPort', 8787)
  return {
    running: !!server,
    sessionId: currentSessionId,
    baseUrl: server && ip ? `http://${ip}:${port}/s/${currentSessionId}` : null,
  }
}

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 320 })
}

function renderSharePage(s: { id: string; photos: { id: string }[] }): string {
  const items = s.photos
    .map((_, i) => `<a class="card" href="/s/${s.id}/${i}" download="photo-${i + 1}.svg"><img src="/s/${s.id}/${i}" alt="Ảnh ${i + 1}"><span>Tải ảnh ${i + 1}</span></a>`)
    .join('\n')
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CamRent Booth — Ảnh của bạn</title><style>
  body{font-family:system-ui,sans-serif;background:#141414;color:#eee;margin:0;padding:24px}
  h1{font-size:20px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-top:16px}
  .card{background:#1f1f1f;border-radius:12px;padding:10px;text-decoration:none;color:inherit;text-align:center}
  .card img{width:100%;border-radius:8px}.card span{display:block;margin-top:8px;font-size:14px;color:#ffd479}
</style></head><body><h1>Ảnh phiên chụp của bạn</h1><p>Chạm vào ảnh để tải về.</p><div class="grid">${items}</div></body></html>`
}
