// Printing — compose SVG template; in thật qua pipeline GDI (xem print-gdi.ts).
import { getDb, getSetting } from '../db'

export interface TemplateDef {
  id: string
  name: string
  kind: string
  cols: number
  rows: number
  width: number
  height: number
  caption: string
}

export function listTemplates(): TemplateDef[] {
  const rows = getDb().prepare('SELECT * FROM templates ORDER BY builtin DESC, name ASC').all() as any[]
  return rows.map(r => ({ id: r.id, name: r.name, kind: r.kind, ...JSON.parse(r.config_json) }))
}

export function getTemplate(id: string): TemplateDef | null {
  const row = getDb().prepare('SELECT * FROM templates WHERE id = ?').get(id) as any
  if (!row) return null
  return { id: row.id, name: row.name, kind: row.kind, ...JSON.parse(row.config_json) }
}

export function composeLayout(templateId: string, photos: string[]): string {
  const t = getTemplate(templateId)
  if (!t) throw new Error(`Template không tồn tại: ${templateId}`)
  const slots = t.cols * t.rows
  const used = photos.slice(0, slots)
  while (used.length < slots) used.push('')

  const pad = Math.round(t.width * 0.04)
  const captionH = Math.round(t.height * 0.09)
  const areaH = t.height - captionH - pad * 2
  const slotW = Math.floor((t.width - pad * (t.cols + 1)) / t.cols)
  const slotH = Math.floor((areaH - pad * (t.rows - 1)) / t.rows)

  const cells: string[] = []
  used.forEach((src, i) => {
    const col = i % t.cols
    const row = Math.floor(i / t.cols)
    const x = pad + col * (slotW + pad)
    const y = pad + row * (slotH + pad)
    cells.push(`<rect x="${x}" y="${y}" width="${slotW}" height="${slotH}" rx="18" fill="#111" stroke="#333"/>`)
    if (src) {
      cells.push(`<image href="${src}" x="${x}" y="${y}" width="${slotW}" height="${slotH}" preserveAspectRatio="xMidYMid slice" clip-path="inset(0 round 18px)"/>`)
    } else {
      cells.push(`<text x="${x + slotW / 2}" y="${y + slotH / 2}" fill="#555" font-size="28" text-anchor="middle" font-family="sans-serif">Trống</text>`)
    }
  })

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t.width} ${t.height}" width="${t.width}" height="${t.height}">
  <rect width="${t.width}" height="${t.height}" fill="#f7f3ea"/>
  ${cells.join('\n  ')}
  <text x="${t.width / 2}" y="${t.height - Math.round(captionH / 2.6)}" font-family="sans-serif" font-size="${Math.round(captionH / 2.6)}" fill="#2b2b2b" text-anchor="middle" font-weight="700">${escapeXml(t.caption)}</text>
</svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

// --- DNP DS-RX1HS / DS-RX1 / DS620 detection ---
// Bám danh sách match pattern từ bản gốc (DNP_DS620/RX1HS profiles trong app.asar).
const DNP_PATTERNS = [
  'ds-rx1hs', 'dsrx1hs', 'ds rx1hs', 'ds_rx1hs', 'rx1hs', 'rx1 hs',
  'ds-rx1', 'dsrx1', 'ds rx1', 'ds_rx1', 'ds-620a', 'ds620a', 'ds620', 'ds-620',
]

export function isDnpPrinter(name: string, displayName?: string): boolean {
  const hay = `${name} ${displayName ?? ''}`.toLowerCase()
  return DNP_PATTERNS.some(p => hay.includes(p))
}

export function detectDnpPrinters(printers: { name: string; displayName?: string }[]): { name: string; displayName: string }[] {
  return printers.filter(p => isDnpPrinter(p.name, p.displayName)).map(p => ({ name: p.name, displayName: p.displayName ?? p.name }))
}

// Queue Windows riêng cho từng template (vd "CamRent Booth 4x6" / "CamRent Strip 2x6") —
// bản Electron không chỉnh được PageSize driver qua API, nên chọn queue đã cấu hình sẵn là cách đúng với RX1HS.
export function resolvePrinterForTemplate(templateId: string, override?: string | null): string | null {
  if (override) return override
  const map = getSetting<Record<string, string | null>>('templatePrinters', {})
  const mapped = map?.[templateId]
  if (mapped) return mapped
  return getSetting<string | null>('defaultPrinter', null)
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!))
}

// composeLayout giữ nguyên; in thật đi qua pipeline GDI (print-gdi.ts) — webContents.print() không đặt được DEVMODE/paper cho DNP.

