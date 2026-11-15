// Camera service — driver mock (mặc định) hoặc gphoto2 thật (camera Fuji/Canon không qua EDSDK).
// Cơ chế bám bản gốc (đã phân tích từ app.asar):
//   gphoto2 --capture-image-and-download --filename <tmp> --force-overwrite  (timeout 30s)
//   gphoto2 --capture-preview                                            (live view)
//   --set-config /main/settings/...                                      (settings, Phase 2 đầy đủ)
// gphoto2 trên Windows cần bundle libgphoto2 (bản gốc ship camera-runtime/win32-x64).
// Binary tìm theo thứ tự: setting gphoto2Path → biến môi trường CAMRENT_GPHOTO2_PATH
//   → <resources>/camera-runtime/win32-x64/bin/gphoto2.exe → cạnh app → PATH.

import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { app } from 'electron'
import { getSetting, setSetting } from '../db'

const execFileAsync = promisify(execFile)

export type CameraDriver = 'mock' | 'gphoto2'

export interface CameraStatus {
  driver: CameraDriver
  connected: boolean
  detail: string
  gphoto2Path?: string | null
}

export function findGphoto2(): string | null {
  const candidates: string[] = []
  const configured = getSetting<string>('gphoto2Path', '')
  if (configured) candidates.push(configured)
  if (process.env.CAMRENT_GPHOTO2_PATH) candidates.push(process.env.CAMRENT_GPHOTO2_PATH)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'camera-runtime', 'win32-x64', 'bin', 'gphoto2.exe'))
    candidates.push(path.join(process.resourcesPath, 'camera-runtime', 'win32-x64', 'bin', 'gphoto2'))
  }
  candidates.push(path.join(path.dirname(app.getPath('exe')), 'camera-runtime', 'win32-x64', 'bin', 'gphoto2.exe'))
  // PATH lookup (không spawn shell)
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

  constructor() {
    super()
    this.bin = findGphoto2()
  }

  getBin(): string | null {
    this.bin = this.bin ?? findGphoto2()
    return this.bin
  }

  async status(): Promise<CameraStatus> {
    const bin = this.getBin()
    if (!bin) {
      return { driver: 'gphoto2', connected: false, detail: 'Không tìm thấy gphoto2.exe — cài bundle camera-runtime hoặc đặt gphoto2Path trong Admin', gphoto2Path: null }
    }
    try {
      const { stdout } = await execFileAsync(bin, ['--auto-detect'], { timeout: 10000 })
      const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean)
      const cameras = lines.slice(2).filter(l => !/^-+$/.test(l))
      if (cameras.length === 0) {
        return { driver: 'gphoto2', connected: false, detail: 'gphoto2 chạy được nhưng chưa thấy máy ảnh qua USB', gphoto2Path: bin }
      }
      return { driver: 'gphoto2', connected: true, detail: `Đã kết nối: ${cameras[0]}`, gphoto2Path: bin }
    } catch (err: any) {
      return { driver: 'gphoto2', connected: false, detail: `gphoto2 lỗi: ${String(err?.message ?? err).slice(0, 300)}`, gphoto2Path: bin }
    }
  }

  startLiveView(): void {
    if (this.previewTimer) return
    this.previewTimer = setInterval(() => {
      if (this.capturing) return // bỏ frame khi đang chụp
      this.grabPreview().catch(() => { /* bỏ qua frame lỗi */ })
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
      await execFileAsync(bin, ['--capture-preview', '--filename', tmp, '--force-overwrite'], { timeout: 8000, env: gphotoEnv(), cwd: os.tmpdir() })
      const buf = fs.readFileSync(tmp)
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      if (buf.length > 0) {
        const mime = sniffImageMime(buf)
        if (mime) {
          this.emit('frame', `data:${mime};base64,` + buf.toString('base64'))
        } else {
          // PPM preview — chưa decode; bỏ frame (Phase 2: decode PPM bằng nativeImage/sharp)
        }
      }
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
      await execFileAsync(bin, ['--capture-image-and-download', '--filename', tmp, '--force-overwrite'], { timeout: 30000, env: gphotoEnv(), cwd: os.tmpdir(), maxBuffer: 4 * 1024 * 1024 })
      const buf = fs.readFileSync(tmp)
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      const mime = sniffImageMime(buf)
      if (!mime) throw new Error('gphoto2 tải ảnh về nhưng không nhận diện được định dạng (PPM?). Phase 2 sẽ decode PPM.')
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
  return null // PPM (P6/P3) & others — chưa hỗ trợ
}

function gphotoEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CAMLIBS: path.join(path.dirname(findGphoto2() ?? ''), '..', 'camlibs'), IOLIBS: path.join(path.dirname(findGphoto2() ?? ''), '..', 'iolibs') }
}

export class CameraService extends EventEmitter {
  private mock = new MockCamera()
  private gphoto = new Gphoto2Camera()

  constructor() {
    super()
    this.mock.on('frame', (f: string) => this.emit('frame', f))
    this.gphoto.on('frame', (f: string) => this.emit('frame', f))
  }

  getDriver(): CameraDriver {
    return (getSetting<string>('cameraDriver', 'mock') as CameraDriver) || 'mock'
  }

  setDriver(d: CameraDriver): void {
    this.stopLiveView()
    setSetting('cameraDriver', d)
  }

  async getStatus(): Promise<CameraStatus> {
    if (this.getDriver() === 'gphoto2') return this.gphoto.status()
    return { driver: 'mock', connected: true, detail: 'Mock camera — ảnh giả lập (chưa có máy thật)' }
  }

  startLiveView(): void {
    if (this.getDriver() === 'gphoto2') this.gphoto.startLiveView()
    else this.mock.startLiveView()
  }

  stopLiveView(): void {
    this.mock.stopLiveView()
    this.gphoto.stopLiveView()
  }

  async capture(): Promise<{ dataUrl: string; ext: string }> {
    if (this.getDriver() === 'gphoto2') return this.gphoto.capture()
    return this.mock.capture()
  }
}
