// Windows GDI print pipeline — bám kiến trúc bản gốc:
//   compose SVG -> raster PNG (offscreen Electron) -> PowerShell System.Drawing.Printing
//   tự chọn khổ giấy theo regex PaperName (2x6 strip cần cut=2inch), có fallback 4×6 (380–425 × 580–630).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { BrowserWindow } from 'electron'

const execFileAsync = promisify(execFile)

export type DnpPaper = '2x6' | '4x6'

// Regex gốc (đơn vị: 1/100 inch)
const PLAIN_4X6 = '^\\s*\\(?\\s*(6x4|4x6)\\s*\\)?\\s*($|/)'
const DNP_STRIP = '^\\s*PR\\s*\\(4x6\\)\\s*$'

const SCRIPT = `param(
  [string]$Printer = '',
  [string]$Image,
  [string]$PaperPattern = '',
  [string]$RequireSplit = '0',
  [string]$FallbackPattern = '',
  [string]$Cut = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile($Image)
try {
  $doc = New-Object System.Drawing.Printing.PrintDocument
  if ($Printer) { $doc.PrinterSettings.PrinterName = $Printer }
  if (-not $doc.PrinterSettings.IsValid) { throw "Không tìm thấy máy in '$Printer'" }

  $cutApplied = '-'
  if ($Cut -eq '2inch') {
    try {
      Add-Type -AssemblyName ReachFramework, System.Printing
      $name = $doc.PrinterSettings.PrinterName
      $queue = (New-Object System.Printing.LocalPrintServer).GetPrintQueue($name)
      $base = if ($queue.UserPrintTicket) { $queue.UserPrintTicket } else { $queue.DefaultPrintTicket }
      $xml = New-Object System.Xml.XmlDocument
      $xml.Load($base.GetXmlStream())
      $feature = @($xml.DocumentElement.ChildNodes) | Where-Object { $_.LocalName -eq 'Feature' -and $_.GetAttribute('name') -match 'CUTTERCONTROL$' } | Select-Object -First 1
      if ($feature) {
        $prefix = $feature.GetAttribute('name').Split(':')[0]
        $option = @($feature.ChildNodes) | Where-Object { $_.LocalName -eq 'Option' } | Select-Object -First 1
        $option.SetAttribute('name', $prefix + ':CUT_2INCH')
        $stream = New-Object System.IO.MemoryStream
        $xml.Save($stream)
        $stream.Position = 0
        $ticket = New-Object System.Printing.PrintTicket($stream)
        $converter = New-Object System.Printing.Interop.PrintTicketConverter($name, 1)
        $devmode = $converter.ConvertPrintTicketToDevMode($ticket, [System.Printing.Interop.BaseDevModeType]::UserDefault)
        $tail = [BitConverter]::ToUInt32($devmode, $devmode.Length - 4)
        if ($tail -le 1) {
          [BitConverter]::GetBytes([uint32]1).CopyTo($devmode, $devmode.Length - 4)
        }
        $handle = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($devmode.Length)
        try {
          [System.Runtime.InteropServices.Marshal]::Copy($devmode, 0, $handle, $devmode.Length)
          $doc.PrinterSettings.SetHdevmode($handle)
          $doc.DefaultPageSettings.SetHdevmode($handle)
        } finally {
          [System.Runtime.InteropServices.Marshal]::FreeHGlobal($handle)
        }
        $cutApplied = 'CUT_2INCH'
      }
    } catch {
      $cutApplied = 'loi ' + $_.Exception.Message
    }
  }

  $sizes = @($doc.PrinterSettings.PaperSizes)
  $isSplit = { param($s) $s.PaperName -match 'split|combo|2up|2 prints|3 prints|x\\s*2\\b' }
  $is4x6 = { param($s) $a = [Math]::Min($s.Width, $s.Height); $b = [Math]::Max($s.Width, $s.Height); $a -ge 380 -and $a -le 425 -and $b -ge 580 -and $b -le 630 }
  $size = $null
  if ($PaperPattern) {
    $size = $sizes | Where-Object { $_.PaperName -match $PaperPattern -and ((& $isSplit $_) -eq ($RequireSplit -eq '1')) } | Select-Object -First 1
  }
  if (-not $size -and $FallbackPattern) {
    $size = $sizes | Where-Object { $_.PaperName -match $FallbackPattern -and -not (& $isSplit $_) } | Select-Object -First 1
  }
  if (-not $size) { $size = $sizes | Where-Object { (& $is4x6 $_) -and -not (& $isSplit $_) } | Select-Object -First 1 }
  if (-not $size) { throw "Máy in không có khổ 4x6 (các khổ đang có: $(($sizes | ForEach-Object { $_.PaperName }) -join ', '))" }

  $doc.DocumentName = 'CamRent Booth'
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $doc.OriginAtMargins = $false
  $doc.DefaultPageSettings.PaperSize = $size
  $doc.DefaultPageSettings.Landscape = ($img.Width -gt $img.Height) -ne ($size.Width -gt $size.Height)
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins 0, 0, 0, 0
  $doc.add_PrintPage({
    param($sender, $e)
    $g = $e.Graphics
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $b = $e.PageBounds
    $x = -[single]$e.PageSettings.HardMarginX
    $y = -[single]$e.PageSettings.HardMarginY
    $g.DrawImage($img, $x, $y, [single]$b.Width, [single]$b.Height)
    $e.HasMorePages = $false
  })
  $doc.Print()
  Write-Output ("OK paper=" + $size.PaperName + " landscape=" + $doc.DefaultPageSettings.Landscape + " cut=" + $cutApplied)
} finally {
  $img.Dispose()
}
`

const LIST_SCRIPT = `param([string]$Printer = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$doc = New-Object System.Drawing.Printing.PrintDocument
if ($Printer) { $doc.PrinterSettings.PrinterName = $Printer }
if (-not $doc.PrinterSettings.IsValid) { throw "Không tìm thấy máy in '$Printer'" }
$doc.PrinterSettings.PaperSizes | ForEach-Object { "$($_.PaperName)|$($_.Width)|$($_.Height)" }
`

export interface PaperInfo {
  name: string
  width: number
  height: number
  classify: '4x6' | '4x6-split' | 'other'
}

export interface DnpDetect {
  connected: boolean
  printer: string | null
  papers: PaperInfo[]
  willPrint4x6: string | null
  willPrint2x6: string | null
  cutSupported: boolean
  detail: string
}

export async function listPrinterPapers(printerName: string): Promise<PaperInfo[]> {
  const scriptPath = path.join(os.tmpdir(), `camrent-list-papers-${process.pid}.ps1`)
  fs.writeFileSync(scriptPath, '﻿' + LIST_SCRIPT, 'utf8')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Printer', printerName], { timeout: 30000, windowsHide: true })
    const isSplit = (n: string) => /split|combo|2up|2 prints|3 prints|x\s*2\b/i.test(n)
    const is4x6 = (w: number, h: number) => { const a = Math.min(w, h), b = Math.max(w, h); return a >= 380 && a <= 425 && b >= 580 && b <= 630 }
    return stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean).flatMap(line => {
      const [name, w, h] = line.split('|')
      if (!name || w === undefined || h === undefined) return []
      const width = Number(w), height = Number(h)
      const split = isSplit(name)
      const classify: PaperInfo['classify'] = split && is4x6(width, height) ? '4x6-split' : is4x6(width, height) && !split ? '4x6' : 'other'
      return [{ name, width, height, classify }]
    })
  } finally {
    try { fs.unlinkSync(scriptPath) } catch { /* ignore */ }
  }
}

export function classifyForPapers(papers: PaperInfo[]): { fourSix: string | null; twoSix: string | null; cutSupported: boolean } {
  const fourSix = papers.find(p => p.classify === '4x6' && new RegExp(PLAIN_4X6, 'i').test(p.name))
    ?? papers.find(p => p.classify === '4x6')
    ?? null
  const split = papers.find(p => /6x2|split|PR\s*\(4x6\)/i.test(p.name)) ?? null
  const cutSupported = papers.some(p => /PR\s*\(4x6\)/i.test(p.name))
  return { fourSix: fourSix?.name ?? null, twoSix: split?.name ?? null, cutSupported }
}

export async function printGdi(imagePath: string, printerName: string | null, paperSize: DnpPaper): Promise<string> {
  const scriptPath = path.join(os.tmpdir(), `camrent-gdi-print-${process.pid}.ps1`)
  fs.writeFileSync(scriptPath, '﻿' + SCRIPT, 'utf8')
  const paper = paperSize === '2x6'
    ? { pattern: '6x2|split', requireSplit: '1', fallbackPattern: `${DNP_STRIP}|${PLAIN_4X6}`, cut: '2inch' }
    : { pattern: PLAIN_4X6, requireSplit: '0', fallbackPattern: PLAIN_4X6, cut: 'standard' }
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Image', imagePath, '-PaperPattern', paper.pattern, '-RequireSplit', paper.requireSplit, '-FallbackPattern', paper.fallbackPattern, '-Cut', paper.cut]
  if (printerName) args.push('-Printer', printerName)
  try {
    const { stdout } = await execFileAsync('powershell.exe', args, { timeout: 60000, windowsHide: true })
    const line = stdout.split(/\r?\n/).find(l => l.startsWith('OK '))
    if (!line) throw new Error(stdout.trim() || 'PowerShell không báo đã in')
    return line
  } catch (error: any) {
    const stderr = error?.stderr ?? ''
    const message = String(stderr).split(/\r?\n/).find((l: string) => l.trim() && !/^\s*(At |\+|CategoryInfo|FullyQualifiedErrorId)/.test(l))
    throw new Error(message?.trim() || String(error?.message ?? error))
  } finally {
    try { fs.unlinkSync(scriptPath) } catch { /* ignore */ }
  }
}

export async function rasterizeToPng(dataUrl: string, width: number, height: number): Promise<string> {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false, sandbox: true } })
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}img{display:block;width:${width}px;height:${height}px}</style></head><body><img id="t" src="${dataUrl}"></body></html>`
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise<void>(resolve => {
      const img = win.webContents
      // chờ ảnh load
      let done = false
      const finish = () => { if (!done) { done = true; resolve() } }
      img.executeJavaScript('document.getElementById("t").complete && document.getElementById("t").naturalWidth > 0').then((ok: boolean) => { if (ok) finish(); else setTimeout(finish, 1500) }).catch(finish)
      setTimeout(finish, 3000)
    })
    const image = await win.webContents.capturePage()
    const png = image.toPNG()
    const tmp = path.join(os.tmpdir(), `camrent-print-${process.pid}-${Date.now()}.png`)
    fs.writeFileSync(tmp, png)
    return tmp
  } finally {
    win.close()
  }
}
