// Camera service — 'auto' tự dò gphoto2, 'mock' ảnh giả, 'gphoto2' bắt buộc máy thật.
// HDMI (Canon R50 style): giữ USB live view = HDMI luôn sáng khi output = TFT + PC.
// Lúc startLiveView (gphoto2) app tự dò và set cấu hình output, y cơ chế bản gốc.

import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { app } from 'electron'
import { getSetting, setSetting } from '../db'
import { ensureHdmiOutput, type HdmiSetupResult } from './hdmi'

const execFileAsync = promisify(execFile)

export type CameraDriverSetting = 'auto' | 'mock' | 'gphoto2'

export interface CameraStatus {
  driver: CameraDriverSetting
  effective: 'mock' | 'gphoto2'
  connected: boolean
  detail: string
  gphoto2Path?: string | null
  hdmi?: HdmiSetupResult | null
}

export function findGphoto2(): string | null {
  const candidates: string[] = []
  const configured = getSetting<string>('gphoto2Path', '')
  if (configured) candidates.push(configured)
  if (process.env.CAMRENT_GPHOTO2_PATH) candidates.push(process.env.CAMRENT_GPHOTO2_PATH)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'camera-runtime', 'win32-x64', 'bin', 'gphoto2.exe'))
  }
  candidates.push(path.join(path.dirname(app.getPath('exe')), 'camera-runtime', 'win32-x64', 'bin', 'gphoto2.exe'))
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    candidates.push(path.join(dir, 'gphoto2.exe'), path.join(dir, 'gphoto2'))
  }
  for (const c of candidates) if (c && fs.existsSync(c)) return c
  return null
}

function makeMockFrame(seed: number): string {
  const hue = seed % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,35%)"/>
  </linearGradient></defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <circle cx="${200 + (seed * 37) % 400}" cy="${180 + (seed * 53) % 240}" r="90" fill="rgba(255,255,255,0.75)"/>
  <rect x="0" y="470" width="800" height="130" fill="rgba(0,0,0,0.35)"/>
  <text x="400" y="548" font-family="sans-serif" font-size="44" fill="#fff" text-anchor="middle">CamRent Booth · #${seed}</text>
</svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

class MockCamera extends EventEmitter {
  private frame = 0
  private timer: NodeJS.Timeout | null = null
  startLiveView(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.frame++
      this.emit('frame', makeMockFrame(this.frame))
    }, 700)
  }
  stopLiveView(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
  async capture(): Promise<{ dataUrl: string; ext: string }> {
    return { dataUrl: makeMockFrame(Date.now() % 100000), ext: 'svg' }
  }
}

class Gphoto2Camera extends EventEmitter {
  private bin: string | null = null
  private previewTimer: NodeJS.Timeout | null = null
  private capturing = false
  private detected: boolean | null = null
  private hdmi: HdmiSetupResult | null = null

  constructor() {
    super()
  }

  getBin(): string | null {
    if (!this.bin) this.bin = findGphoto2()
    return this.bin
  }

  invalidateCache(): void {
    this.detected = null
    this.hdmi = null
  }

  getHdmi(): HdmiSetupResult | null {
    return this.hdmi
  }

  async status(): Promise<{ connected: boolean; detail: string; bin: string | null; hdmi: HdmiSetupResult | null }> {
    const bin = this.getBin()
    if (!bin) {
      this.detected = false
      return { connected: false, detail: 'Không tìm thấy gphoto2.exe trong app (resources/camera-runtime) hoặc PATH', bin: null, hdmi: null }
    }
    try {
      const { stdout } = await execFileAsync(bin, ['--auto-detect'], { timeout: 10000, maxBuffer: 1024 * 1024 })
      const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean)
      const cameras = lines.slice(2).filter(l => !/^-+$/.test(l))
      this.detected = cameras.length > 0
      return {
        connected: cameras.length > 0,
        detail: cameras.length > 0 ? `Đã kết nối: ${cameras[0]}` : 'gphoto2 chạy nhưng chưa thấy máy ảnh qua USB',
        bin,
        hdmi: this.hdmi,
      }
    } catch (err: any) {
      this.detected = false
      return { connected: false, detail: `gphoto2 lỗi: ${String(err?.message ?? err).slice(0, 300)}`, bin, hdmi: null }
    }
  }

  async startLiveView(): Promise<void> {
    if (this.previewTimer) return
    // Dò & đặt output = TFT + PC (giống bản gốc) — không được thì cảnh báo, app vẫn chạy
    try {
      this.hdmi = await ensureHdmiOutput(this.getBin())
      console.info('[hdmi]', this.hdmi.detail)
    } catch (err) {
      this.hdmi = { supported: false, applied: false, detail: String(err) }
      console.warn('[hdmi] ensure failed:', this.hdmi.detail)
    }
    this.previewTimer = setInterval(() => {
      if (this.capturing) return
      this.grabPreview().catch(() => { /* bỏ frame lỗi */ })
    }, 700)
  }

  stopLiveView(): void {
    if (this.previewTimer) clearInterval(this.previewTimer)
    this.previewTimer = null
  }

  private async grabPreview(): Promise<void> {
    const bin = this.getBin()
    if (!bin) return
    const tmp = path.join(os.tmpdir(), `camrent-preview-${process.pid}.jpg`)
    try {
      await execFileAsync(bin, ['--capture-preview', '--filename', tmp, '--force-overwrite'], { timeout: 8000, env: gphotoEnv(), cwd: os.tmpdir(), maxBuffer: 8 * 1024 * 1024 })
      const buf = fs.readFileSync(tmp)
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      const mime = sniffImageMime(buf)
      if (mime) this.emit('frame', `data:${mime};base64,` + buf.toString('base64'))
    } catch {
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    }
  }

  async capture(): Promise<{ dataUrl: string; ext: string }> {
    const bin = this.getBin()
    if (!bin) throw new Error('Không tìm thấy gphoto2.exe')
    this.capturing = true
    this.stopLiveView()
    const tmp = path.join(os.tmpdir(), `camrent-capture-${process.pid}-${Date.now()}.jpg`)
    try {
      await execFileAsync(bin, ['--capture-image-and-download', '--filename', tmp, '--force-overwrite'], { timeout: 30000, env: gphotoEnv(), cwd: os.tmpdir(), maxBuffer: 8 * 1024 * 1024 })
      const buf = fs.readFileSync(tmp)
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      const mime = sniffImageMime(buf)
      if (!mime) throw new Error('Chụp xong nhưng file không phải JPEG/PNG (có thể là PPM — sẽ decode ở Phase 2). Thử lại.')
      const ext = mime === 'image/png' ? 'png' : 'jpg'
      return { dataUrl: `data:${mime};base64,` + buf.toString('base64'), ext }
    } finally {
      this.capturing = false
    }
  }
}

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (buf.length >= 6 && buf.slice(0, 6).toString('ascii') === 'GIF87a') return 'image/gif'
  return null
}

function gphotoEnv(): NodeJS.ProcessEnv {
  const bin = findGphoto2()
  const camlibs = bin ? path.join(path.dirname(bin), '..', 'camlibs') : undefined
  const iolibs = bin ? path.join(path.dirname(bin), '..', 'iolibs') : undefined
  return { ...process.env, CAMLIBS: camlibs ?? process.env.CAMLIBS, IOLIBS: iolibs ?? process.env.IOLIBS }
}

export class CameraService extends EventEmitter {
  private mock = new MockCamera()
  private gphoto = new Gphoto2Camera()
  private effectiveCache: 'mock' | 'gphoto2' | null = null
  private resolving: Promise<'mock' | 'gphoto2'> | null = null

  constructor() {
    super()
    this.mock.on('frame', (f: string) => this.emit('frame', f))
    this.gphoto.on('frame', (f: string) => this.emit('frame', f))
  }

  getDriverSetting(): CameraDriverSetting {
    const v = (getSetting<string>('cameraDriver', 'auto') as CameraDriverSetting) || 'auto'
    return v === 'mock' || v === 'gphoto2' ? v : 'auto'
  }

  setDriver(d: CameraDriverSetting): void {
    this.stopLiveView()
    this.effectiveCache = null
    this.gphoto.invalidateCache()
    setSetting('cameraDriver', d)
  }

  private async resolveEffective(): Promise<'mock' | 'gphoto2'> {
    const setting = this.getDriverSetting()
    if (setting === 'mock') return 'mock'
    if (setting === 'gphoto2') return 'gphoto2'
    if (this.effectiveCache) return this.effectiveCache
    if (!this.resolving) {
      this.resolving = (async () => {
        const s = await this.gphoto.status()
        this.effectiveCache = s.connected ? 'gphoto2' : 'mock'
        return this.effectiveCache
      })().finally(() => { this.resolving = null })
    }
    return this.resolving
  }

  async getStatus(): Promise<CameraStatus> {
    const setting = this.getDriverSetting()
    if (setting === 'mock') {
      return { driver: setting, effective: 'mock', connected: true, detail: 'Mock camera — ảnh giả lập', hdmi: null }
    }
    if (setting === 'gphoto2') {
      const s = await this.gphoto.status()
      if (!s.connected) throw new Error(`gphoto2 chưa sẵn sàng: ${s.detail}`)
      return { driver: setting, effective: 'gphoto2', connected: true, detail: s.detail, gphoto2Path: s.bin, hdmi: s.hdmi }
    }
    // auto — dò lại mỗi lần hỏi
    this.effectiveCache = null
    this.gphoto.invalidateCache()
    const s = await this.gphoto.status()
    this.effectiveCache = s.connected ? 'gphoto2' : 'mock'
    return {
      driver: 'auto',
      effective: this.effectiveCache,
      connected: true,
      detail: s.connected
        ? s.detail + ' (tự nhận theo USB)' + (s.hdmi ? ` · HDMI: ${s.hdmi.detail}` : '')
        : 'Không thấy camera — đang dùng mock. Cắm máy, bật nguồn, rồi bấm "Kiểm tra camera".',
      gphoto2Path: s.bin,
      hdmi: s.hdmi,
    }
  }

  async startLiveView(): Promise<void> {
    const effective = await this.resolveEffective()
    if (effective === 'gphoto2') await this.gphoto.startLiveView()
    else this.mock.startLiveView()
  }

  stopLiveView(): void {
    this.mock.stopLiveView()
    this.gphoto.stopLiveView()
  }

  async capture(): Promise<{ dataUrl: string; ext: string }> {
    const effective = await this.resolveEffective()
    if (effective === 'gphoto2') return this.gphoto.capture()
    if (this.getDriverSetting() === 'gphoto2') {
      const s = await this.gphoto.status()
      throw new Error(`Không chụp được: ${s.detail}`)
    }
    return this.mock.capture()
  }
}
