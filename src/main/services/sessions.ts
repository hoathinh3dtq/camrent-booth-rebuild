import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getDb } from '../db'

export interface SessionSummary {
  id: string
  createdAt: number
  photoCount: number
  status: string
  priceMinor: number
  paymentStatus: string
  templateId: string | null
}

export interface SessionDetail extends SessionSummary {
  photos: { id: string; dataUrl: string; createdAt: number }[]
}

function mediaDir(): string {
  const dir = path.join(app.getPath('userData'), 'media')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function createSession(): string {
  const id = randomUUID()
  getDb().prepare('INSERT INTO sessions (id, created_at) VALUES (?, ?)').run(id, Date.now())
  return id
}

export function addPhoto(sessionId: string, dataUrl: string, ext = 'svg'): { id: string; filePath: string } {
  const id = randomUUID()
  const dir = mediaDir()
  const filePath = path.join(dir, `${id}.${ext}`)
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!m) throw new Error('Dữ liệu ảnh không hợp lệ')
  fs.writeFileSync(filePath, Buffer.from(m[2], 'base64'))
  const d = getDb()
  d.prepare('INSERT INTO photos (id, session_id, data_url, created_at) VALUES (?, ?, ?, ?)').run(id, sessionId, filePath, Date.now())
  d.prepare('UPDATE sessions SET photo_count = photo_count + 1 WHERE id = ?').run(sessionId)
  return { id, filePath }
}

function readAsDataUrl(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg'
  return `data:${mime};base64,` + buf.toString('base64')
}

export function finishSession(sessionId: string, templateId: string | null, priceMinor: number): void {
  getDb().prepare("UPDATE sessions SET status = 'done', template_id = ?, price_minor = ? WHERE id = ?").run(templateId, priceMinor, sessionId)
}

export function markPaid(sessionId: string): void {
  getDb().prepare("UPDATE sessions SET payment_status = 'paid' WHERE id = ?").run(sessionId)
}

export function listSessions(limit = 50): SessionSummary[] {
  const rows = getDb().prepare("SELECT * FROM sessions WHERE status = 'done' ORDER BY created_at DESC LIMIT ?").all(limit) as any[]
  return rows.map(rowToSummary)
}

export function getSession(sessionId: string): SessionDetail | null {
  const d = getDb()
  const row = d.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any
  if (!row) return null
  const photos = d.prepare('SELECT id, data_url, created_at FROM photos WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as any[]
  return {
    ...rowToSummary(row),
    photos: photos.map(p => ({ id: p.id, dataUrl: readAsDataUrl(p.data_url), createdAt: p.created_at })),
  }
}

export function recordPrintJob(sessionId: string | null, templateId: string | null, copies: number, printerName: string | null): void {
  getDb().prepare('INSERT INTO print_jobs (id, created_at, session_id, template_id, copies, printer_name) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), Date.now(), sessionId, templateId, Math.max(1, copies | 0), printerName)
}

export function todayStats(): { sessions: number; revenueVnd: number; prints: number } {
  const d = getDb()
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const s = d.prepare("SELECT COUNT(*) AS c FROM sessions WHERE created_at >= ? AND status = 'done'").get(start.getTime()) as any
  const r = d.prepare("SELECT COALESCE(SUM(price_minor), 0) AS s FROM sessions WHERE created_at >= ? AND payment_status = 'paid'").get(start.getTime()) as any
  const p = d.prepare('SELECT COALESCE(SUM(copies), 0) AS s FROM print_jobs WHERE created_at >= ?').get(start.getTime()) as any
  return { sessions: Number(s.c), revenueVnd: Number(r.s), prints: Number(p.s) }
}

function rowToSummary(r: any): SessionSummary {
  return {
    id: r.id,
    createdAt: r.created_at,
    photoCount: r.photo_count,
    status: r.status,
    priceMinor: r.price_minor,
    paymentStatus: r.payment_status,
    templateId: r.template_id,
  }
}
