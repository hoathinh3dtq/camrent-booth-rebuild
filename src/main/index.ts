import { app, BrowserWindow, ipcMain, Menu, globalShortcut } from 'electron'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import { getDb, getSetting, setSetting } from './db'
import { CameraService } from './services/camera'
import * as sessions from './services/sessions'
import * as printing from './services/printing'
import * as sharing from './services/sharing'

const camera = new CameraService()
let mainWindow: BrowserWindow | null = null
let currentSessionId: string | null = null

const isDev = !!process.env.ELECTRON_RENDERER_URL

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    frame: true,
    backgroundColor: '#141414',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  })

  Menu.setApplicationMenu(null)

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    sharing.stopShare()
  })
}

function send(channel: string, payload?: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

camera.on('frame', (frame: string) => send(IPC.CAMERA_LIVE_VIEW_FRAME, frame))

ipcMain.handle(IPC.CAMERA_STATUS, () => camera.getStatus())
ipcMain.handle(IPC.CAMERA_GET_MOCK, () => ({ driver: camera.getDriver() }))
ipcMain.handle(IPC.CAMERA_SET_MOCK, (_e, v: { driver: string }) => {
  if (v?.driver === 'mock' || v?.driver === 'gphoto2') camera.setDriver(v.driver)
  return camera.getStatus()
})
ipcMain.handle(IPC.CAMERA_START_LIVE_VIEW, () => {
  camera.startLiveView()
  return { ok: true }
})
ipcMain.handle(IPC.CAMERA_STOP_LIVE_VIEW, () => {
  camera.stopLiveView()
  return { ok: true }
})
ipcMain.handle(IPC.CAMERA_CAPTURE, async () => {
  const { dataUrl, ext } = await camera.capture()
  if (!currentSessionId) currentSessionId = sessions.createSession()
  const { id } = sessions.addPhoto(currentSessionId, dataUrl, ext as 'svg' | 'jpg' | 'png')
  return { photoId: id, sessionId: currentSessionId, dataUrl }
})

// --- sessions / gallery ---
ipcMain.handle(IPC.SESSION_SAVE, (_e, arg?: { templateId?: string; priceMinor?: number }) => {
  if (!currentSessionId) throw new Error('Chưa có phiên chụp nào')
  sessions.finishSession(currentSessionId, arg?.templateId ?? null, arg?.priceMinor ?? 0)
  const s = sessions.getSession(currentSessionId)!
  currentSessionId = null
  return s
})
ipcMain.handle(IPC.SESSION_LIST, () => sessions.listSessions(50))
ipcMain.handle(IPC.SESSION_GET_BY_ID, (_e, arg: { id: string }) => sessions.getSession(arg.id))
ipcMain.handle(IPC.GALLERY_LIST_SESSIONS, () => sessions.listSessions(100))
ipcMain.handle(IPC.GALLERY_GET_MEDIA, (_e, arg: { sessionId: string }) => sessions.getSession(arg.sessionId))

// --- templates ---
ipcMain.handle(IPC.TEMPLATES_LIST, () => printing.listTemplates())
ipcMain.handle(IPC.TEMPLATES_GET, (_e, arg: { id: string }) => printing.getTemplate(arg.id))

// --- printing ---
ipcMain.handle(IPC.PRINTER_LIST_PRINTERS, async () => {
  const printers = (await mainWindow?.webContents.getPrintersAsync()) ?? []
  const def = getSetting<string | null>('defaultPrinter', null)
  return printers.map(p => ({ name: p.name, displayName: p.displayName, description: p.description, isDefault: p.name === def }))
})
ipcMain.handle(IPC.PRINTER_DETECT_DNP, async () => {
  const printers = (await mainWindow?.webContents.getPrintersAsync()) ?? []
  return printing.detectDnpPrinters(printers)
})
ipcMain.handle(IPC.PRINTER_COMPOSE_LAYOUT, (_e, arg: { templateId: string; photos: string[] }) =>
  printing.composeLayout(arg.templateId, arg.photos))
ipcMain.handle(IPC.PRINTER_PRINT, async (_e, arg: { templateId: string; photos: string[]; printerName?: string | null; copies?: number; sessionId?: string | null }) => {
  const composed = printing.composeLayout(arg.templateId, arg.photos)
  const resolved = printing.resolvePrinterForTemplate(arg.templateId, arg.printerName)
  await printing.printComposed(composed, resolved)
  sessions.recordPrintJob(arg.sessionId ?? null, arg.templateId, arg.copies ?? 1, resolved ?? null)
  return { ok: true, printer: resolved }
})
ipcMain.handle(IPC.PRINTER_DRY_RUN, (_e, arg: { templateId: string; photos: string[] }) => {
  const composed = printing.composeLayout(arg.templateId, arg.photos)
  return { ok: true, previewDataUrl: composed, dryRun: true }
})
ipcMain.handle(IPC.PRINTER_GET_CONFIG, () => ({
  defaultPrinter: getSetting<string | null>('defaultPrinter', null),
  templatePrinters: getSetting<Record<string, string | null>>('templatePrinters', {}),
}))
ipcMain.handle(IPC.PRINTER_SAVE_CONFIG, (_e, arg: { defaultPrinter?: string | null; templatePrinters?: Record<string, string | null> }) => {
  if (arg && 'defaultPrinter' in arg) setSetting('defaultPrinter', arg.defaultPrinter ?? null)
  if (arg && arg.templatePrinters) setSetting('templatePrinters', arg.templatePrinters)
  return { ok: true }
})

// --- payment (offline, config-based) ---
ipcMain.handle(IPC.PAYMENT_QUOTE_PRINT, (_e, arg: { templateId: string; copies: number }) => {
  const pricing = getSetting<Record<string, number>>('pricing', {})
  const unit = pricing[arg.templateId] ?? pricing['single'] ?? 0
  const copies = Math.max(1, Math.floor(arg.copies || 1))
  return { templateId: arg.templateId, unitVnd: unit, copies, totalVnd: unit * copies, currency: getSetting('currency', 'VND') }
})
ipcMain.handle(IPC.PAYMENT_CONFIRM_CASH, (_e, arg: { sessionId: string; templateId: string; copies: number }) => {
  const pricing = getSetting<Record<string, number>>('pricing', {})
  const unit = pricing[arg.templateId] ?? pricing['single'] ?? 0
  const total = unit * Math.max(1, Math.floor(arg.copies || 1))
  sessions.finishSession(arg.sessionId, arg.templateId, total)
  sessions.markPaid(arg.sessionId)
  return { ok: true, totalVnd: total }
})
ipcMain.handle(IPC.PAYMENT_GET_ACTIVE_ORDER, () => null)
ipcMain.handle(IPC.PAYMENT_SAVE_ACTIVE_ORDER, () => ({ ok: true }))

// --- sharing ---
ipcMain.handle(IPC.LOCAL_SHARE_START, (_e, arg: { sessionId: string }) => sharing.startShare(arg.sessionId))
ipcMain.handle(IPC.LOCAL_SHARE_STOP, () => {
  sharing.stopShare()
  return { ok: true }
})
ipcMain.handle(IPC.LOCAL_SHARE_GET_URL, () => sharing.shareStatus())
ipcMain.handle(IPC.LOCAL_SHARE_STATUS, () => sharing.shareStatus())

// --- staff PIN / config / stats / system ---
ipcMain.handle(IPC.STAFF_PIN_STATUS, () => ({ pinSet: !!getSetting<string>('staffPin', '') }))
ipcMain.handle(IPC.STAFF_PIN_VERIFY, (_e, arg: { pin: string }) => ({ ok: arg?.pin === getSetting<string>('staffPin', '1234') }))
ipcMain.handle(IPC.CONFIG_GET_BOOTH_CONFIG, () => ({
  boothName: getSetting('boothName', 'CamRent Booth'),
  pricing: getSetting('pricing', {}),
  currency: getSetting('currency', 'VND'),
  sharesPort: getSetting<number>('sharesPort', 8787),
  defaultPrinter: getSetting<string | null>('defaultPrinter', null),
  templatePrinters: getSetting<Record<string, string | null>>('templatePrinters', {}),
  staffPinSet: !!getSetting<string>('staffPin', ''),
  cameraDriver: getSetting<string>('cameraDriver', 'mock'),
  gphoto2Path: getSetting<string>('gphoto2Path', ''),
}))
ipcMain.handle(IPC.CONFIG_SAVE_BOOTH_CONFIG, (_e, arg: Record<string, unknown>) => {
  for (const k of ['boothName', 'pricing', 'currency', 'sharesPort', 'defaultPrinter', 'templatePrinters', 'cameraDriver', 'gphoto2Path'] as const) {
    if (arg && k in arg) setSetting(k, (arg as Record<string, unknown>)[k])
  }
  return { ok: true }
})
ipcMain.handle(IPC.STATS_TODAY, () => sessions.todayStats())
ipcMain.handle(IPC.SYSTEM_GET_VERSION, () => ({ version: app.getVersion() }))
ipcMain.handle(IPC.SYSTEM_QUIT, () => {
  app.quit()
})

ipcMain.handle('localShare:qr', async (_e, arg: { text: string }) => sharing.qrDataUrl(arg.text))

app.whenReady().then(() => {
  getDb()
  createWindow()

  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  sharing.stopShare()
})
