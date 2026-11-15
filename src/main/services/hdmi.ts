// Probe & cấu hình camera output qua gphoto2 — bám bản gốc (R50):
//   "TFT + PC" là lựa chọn cho phép HDMI xuất live view trong khi PC giữ USB.
//   Không có lựa chọn đó → HDMI sẽ tối (cảnh báo, app vẫn chạy).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { findGphoto2 } from './camera'

const execFileAsync = promisify(execFile)

export interface HdmiSetupResult {
  supported: boolean
  applied: boolean
  detail: string
}

const OUTPUT_MARKERS = /camera\s*output|cameraoutput|evf.*output|live\s*view.*output|display.*output|\/output\b/i
const WANT_VALUE = /^TFT\s*\+\s*PC$/i

export async function ensureHdmiOutput(bin?: string | null): Promise<HdmiSetupResult> {
  const gphoto = bin ?? findGphoto2()
  if (!gphoto) return { supported: false, applied: false, detail: 'Không tìm thấy gphoto2.exe' }
  try {
    const { stdout } = await execFileAsync(gphoto, ['--list-all-config'], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 })
    const text = stdout.toString()
    const blocks = text.split(new RegExp('\\n(?=/)')) // tách theo config path
    for (const block of blocks) {
      const pathMatch = block.match(/^(\S+)\s*$/m)
      if (!pathMatch) continue
      const cfgPath = pathMatch[1].trim()
      if (!cfgPath.startsWith('/')) continue
      const head = block.split('\n').slice(0, 2).join('\n')
      if (!OUTPUT_MARKERS.test(cfgPath) && !OUTPUT_MARKERS.test(head)) continue
      // tìm dòng kiểu "Current: TFT + PC" hoặc "Current value: ..."
      const curMatch = block.match(/Current(?:\s*value)?\s*:\s*(.+)/i)
      const choiceMatch = block.match(/Choices?\s*:\s*([^\n]+)/i)
      const choicesRaw = block.match(/Current(?:\s*value)?\s*:/i) ? block : block
      const choices = extractChoices(block)
      const want = choices.find(c => WANT_VALUE.test(c.trim()))
      if (!want) {
        if (curMatch && WANT_VALUE.test(curMatch[1].trim())) return { supported: true, applied: true, detail: `${cfgPath} đã sẵn sàng (${curMatch[1].trim()})` }
        return { supported: false, applied: false, detail: `${cfgPath}: lựa chọn "TFT + PC" không có trong [${choices.join(', ') || '?'}]. HDMI sẽ tối.` }
      }
      const cur = curMatch ? curMatch[1].trim() : ''
      if (WANT_VALUE.test(cur)) return { supported: true, applied: true, detail: `${cfgPath} đã là ${cur} — HDMI live view OK` }
      // set config
      try {
        await execFileAsync(gphoto, ['--set-config', `${cfgPath}=${want.trim()}`], { timeout: 10000 })
        return { supported: true, applied: true, detail: `Đã đặt ${cfgPath} = ${want.trim()} (HDMI live view)` }
      } catch (err: any) {
        return { supported: true, applied: false, detail: `Không đặt được ${cfgPath}=${want.trim()}: ${String(err?.message ?? err).slice(0, 200)}` }
      }
    }
    return { supported: false, applied: false, detail: 'Không tìm thấy cấu hình "Camera Output" trong máy (dòng output trống — HDMI tối)' }
  } catch (err: any) {
    return { supported: false, applied: false, detail: `gphoto2 lỗi đọc cấu hình: ${String(err?.message ?? err).slice(0, 300)}` }
  }
}

function extractChoices(block: string): string[] {
  // gphoto2 in choices dưới 1 trong các dạng:
  //   "Current: X\n" + "  Choice: N value" + driver cụ thể, hoặc liệt kê indent
  const out: string[] = []
  for (const m of block.matchAll(/^\s*(?:Choice(?:\s*:|\s*\d+\s*:)?\s*|Value:\s*)(.+?)\s*$/gim)) {
    const v = m[1].trim()
    if (v && !/^-+$/.test(v) && !/^(Current|Label|Type|Readonly|get|set)\b/i.test(v)) out.push(v)
  }
  // fallback: dòng nào cũng thử match TFT
  if (WANT_VALUE.test(block)) {
    for (const line of block.split('\n')) {
      const m = line.match(/TFT\s*\+\s*PC/i)
      if (m) out.push(m[0])
    }
  }
  return [...new Set(out)]
}
