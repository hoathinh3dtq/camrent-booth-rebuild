import { useEffect, useState } from 'react'
import { useBooth } from './store'

const IPC = {
  CAMERA_STATUS: 'camera:status',
  CAMERA_START_LIVE_VIEW: 'camera:startLiveView',
  CAMERA_STOP_LIVE_VIEW: 'camera:stopLiveView',
  CAMERA_CAPTURE: 'camera:capture',
  CAMERA_LIVE_VIEW_FRAME: 'camera:liveViewFrame',
  SESSION_LIST: 'session:list',
  SESSION_GET_BY_ID: 'session:getById',
  GALLERY_LIST_SESSIONS: 'gallery:listSessions',
  TEMPLATES_LIST: 'templates:list',
  PRINTER_LIST_PRINTERS: 'printer:listPrinters',
  PRINTER_DETECT_DNP: 'printer:detectDnp',
  CAMERA_SET_MOCK: 'camera:setMock',
  PRINTER_DRY_RUN: 'printer:dryRun',
  PRINTER_PRINT: 'printer:print',
  PAYMENT_QUOTE_PRINT: 'payment:quotePrint',
  PAYMENT_CONFIRM_CASH: 'payment:confirmCash',
  LOCAL_SHARE_START: 'localShare:start',
  LOCAL_SHARE_QR: 'localShare:qr',
  LOCAL_SHARE_STOP: 'localShare:stop',
  STAFF_PIN_VERIFY: 'staffPin:verify',
  CONFIG_GET_BOOTH_CONFIG: 'config:getBoothConfig',
  CONFIG_SAVE_BOOTH_CONFIG: 'config:saveBoothConfig',
  STATS_TODAY: 'stats:today',
  SYSTEM_GET_VERSION: 'system:getVersion',
} as const

const fmtVnd = (n: number) => n.toLocaleString('vi-VN') + '₫'

export default function App() {
  const screen = useBooth((s) => s.screen)
  return (
    <div className="flex h-screen w-screen flex-col">
      {screen === 'attract' && <Attract />}
      {screen === 'camera' && <CameraScreen />}
      {screen === 'review' && <Review />}
      {screen === 'pay' && <Pay />}
      {screen === 'done' && <Done />}
      {screen === 'gallery' && <Gallery />}
      {screen === 'pin' && <PinGate />}
      {screen === 'admin' && <Admin />}
    </div>
  )
}

/* ---------------- Attract ---------------- */
function Attract() {
  const setScreen = useBooth((s) => s.setScreen)
  const boothName = useBooth((s) => s.boothName)
  const clearSession = useBooth((s) => s.clearSession)

  useEffect(() => {
    window.booth.invoke(IPC.CONFIG_GET_BOOTH_CONFIG).then((c: any) => {
      if (c?.boothName) useBooth.getState().setBoothName(c.boothName)
    })
  }, [])

  return (
    <button
      className="relative flex h-full w-full flex-col items-center justify-center gap-8 overflow-hidden bg-gradient-to-br from-fuchsia-900 via-purple-900 to-indigo-950"
      onClick={() => {
        clearSession()
        setScreen('camera')
      }}
    >
      <div className="absolute -left-32 h-96 w-96 rounded-full bg-pink-500/20 blur-3xl" />
      <div className="absolute -right-32 top-1/3 h-96 w-96 rounded-full bg-amber-400/20 blur-3xl" />
      <div className="text-7xl font-black tracking-tight text-white drop-shadow-lg">{boothName}</div>
      <div className="text-2xl text-amber-300">Chụp · In · Chia sẻ — lưu giữ kỷ niệm</div>
      <div className="animate-pulse rounded-full border-4 border-amber-400 px-14 py-6 text-3xl font-extrabold text-amber-300">
        CHẠM ĐỂ CHỤP
      </div>
      <div className="absolute bottom-4 right-6 flex gap-4">
        <button className="btn-ghost !px-4 !py-2 !text-sm" onClick={(e) => { e.stopPropagation(); setScreen('gallery') }}>Xem ảnh</button>
        <button className="btn-ghost !px-4 !py-2 !text-sm" onClick={(e) => { e.stopPropagation(); setScreen('pin') }}>Quản lý</button>
      </div>
    </button>
  )
}

/* ---------------- Camera ---------------- */
function CameraScreen() {
  const setScreen = useBooth((s) => s.setScreen)
  const addPhoto = useBooth((s) => s.addPhoto)
  const setSession = useBooth((s) => s.setSession)
  const photos = useBooth((s) => s.photos)
  const [liveFrame, setLiveFrame] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    window.booth.invoke(IPC.CAMERA_START_LIVE_VIEW)
    const off = window.booth.on(IPC.CAMERA_LIVE_VIEW_FRAME, (f) => setLiveFrame(f as string))
    window.booth.invoke(IPC.CAMERA_STATUS).then((s: any) => setStatus(`${s.driver}: ${s.detail}`))
    return () => {
      off()
      window.booth.invoke(IPC.CAMERA_STOP_LIVE_VIEW)
    }
  }, [])

  const shoot = async () => {
    if (busy || photos.length >= 10) return
    setBusy(true)
    setFlash(true)
    setTimeout(() => setFlash(false), 220)
    try {
      const r = await window.booth.invoke(IPC.CAMERA_CAPTURE)
      addPhoto({ id: r.photoId, dataUrl: r.dataUrl })
      setSession(r.sessionId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-black">
      <div className="flex items-center justify-between px-6 py-3">
        <button className="btn-ghost !py-2" onClick={() => setScreen('attract')}>← Thoát</button>
        <div className="text-lg text-white/70">{photos.length} ảnh đã chụp · tối đa 10</div>
        <div className="text-xs text-white/40">{status}</div>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {liveFrame && <img src={liveFrame} alt="Live view" className="h-full w-full object-cover" />}
        {flash && <div className="absolute inset-0 bg-white" />}
        <button
          aria-label="Chụp ảnh"
          className="absolute bottom-8 h-24 w-24 rounded-full border-8 border-white bg-red-600 shadow-2xl transition hover:scale-105 active:scale-95"
          onClick={shoot}
          disabled={busy}
        />
      </div>
      <div className="flex gap-3 overflow-x-auto border-t border-white/10 p-4">
        {photos.map((p) => (
          <img key={p.id} src={p.dataUrl} className="h-24 w-32 rounded-lg object-cover" alt="thumb" />
        ))}
        <div className="flex-1" />
        <button className="btn-primary self-center !text-xl" onClick={() => photos.length > 0 && setScreen('review')}>
          Xong →
        </button>
      </div>
    </div>
  )
}

/* ---------------- Review / template / copies ---------------- */
function Review() {
  const setScreen = useBooth((s) => s.setScreen)
  const photos = useBooth((s) => s.photos)
  const templates = useBooth((s) => s.templates)
  const setTemplates = useBooth((s) => s.setTemplates)
  const selectedTemplate = useBooth((s) => s.selectedTemplate)
  const setSelectedTemplate = useBooth((s) => s.setSelectedTemplate)
  const copies = useBooth((s) => s.copies)
  const setCopies = useBooth((s) => s.setCopies)
  const setQuote = useBooth((s) => s.setQuote)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    window.booth.invoke(IPC.TEMPLATES_LIST).then(setTemplates)
  }, [setTemplates])

  useEffect(() => {
    const imgs = photos.map((p) => p.dataUrl)
    if (imgs.length === 0) return
    window.booth.invoke(IPC.PRINTER_DRY_RUN, { templateId: selectedTemplate, photos: imgs }).then((r: any) => setPreview(r.previewDataUrl))
    window.booth.invoke(IPC.PAYMENT_QUOTE_PRINT, { templateId: selectedTemplate, copies }).then((q: any) => setQuote({ unitVnd: q.unitVnd, totalVnd: q.totalVnd }))
  }, [selectedTemplate, copies, photos, setQuote])

  const quote = useBooth((s) => s.quote)

  return (
    <div className="flex h-full gap-6 overflow-hidden p-6">
      <div className="flex flex-1 flex-col">
        <h2 className="mb-3 text-2xl font-bold">Chọn bố cục in</h2>
        <div className="grid grid-cols-2 gap-4">
          {templates.map((t) => (
            <button
              key={t.id}
              className={`card text-left transition ${selectedTemplate === t.id ? 'ring-4 ring-amber-400' : ''}`}
              onClick={() => setSelectedTemplate(t.id)}
            >
              <div className="text-xl font-semibold">{t.name}</div>
              <div className="text-sm text-white/60">{t.cols}×{t.rows} · {t.kind}</div>
            </button>
          ))}
        </div>
        <div className="mt-6">
          <div className="mb-2 text-lg font-semibold">Số bản in</div>
          <div className="flex items-center gap-4">
            <button className="btn-ghost h-14 w-14 !p-0 text-2xl" onClick={() => setCopies(Math.max(1, copies - 1))}>−</button>
            <div className="w-16 text-center text-4xl font-bold">{copies}</div>
            <button className="btn-ghost h-14 w-14 !p-0 text-2xl" onClick={() => setCopies(Math.min(10, copies + 1))}>+</button>
          </div>
          {quote && <div className="mt-4 text-2xl font-bold text-amber-300">{fmtVnd(quote.totalVnd)} <span className="text-base text-white/60">({copies} bản × {fmtVnd(quote.unitVnd)})</span></div>}
        </div>
        <div className="mt-auto flex gap-4 pt-6">
          <button className="btn-ghost" onClick={() => setScreen('camera')}>← Chụp lại</button>
          <button className="btn-primary" onClick={() => setScreen('pay')}>Thanh toán →</button>
        </div>
      </div>
      <div className="flex w-[42%] items-center justify-center rounded-2xl border border-white/10 bg-black/40 p-4">
        {preview ? <img src={preview} alt="Preview in" className="max-h-full max-w-full shadow-2xl" /> : <div className="text-white/40">Đang tạo preview…</div>}
      </div>
    </div>
  )
}

/* ---------------- Pay (cash) ---------------- */
function Pay() {
  const setScreen = useBooth((s) => s.setScreen)
  const sessionId = useBooth((s) => s.sessionId)
  const selectedTemplate = useBooth((s) => s.selectedTemplate)
  const copies = useBooth((s) => s.copies)
  const photos = useBooth((s) => s.photos)
  const quote = useBooth((s) => s.quote)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const confirm = async () => {
    if (!sessionId || busy) return
    setBusy(true)
    setErr(null)
    try {
      const imgs = photos.map((p) => p.dataUrl)
      await window.booth.invoke(IPC.PAYMENT_CONFIRM_CASH, { sessionId, templateId: selectedTemplate, copies })
      await window.booth.invoke(IPC.PRINTER_PRINT, { templateId: selectedTemplate, photos: imgs, copies, sessionId })
      setScreen('done')
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      <h2 className="text-4xl font-black">Thanh toán tiền mặt</h2>
      <div className="card text-center">
        <div className="text-white/60">Tổng cộng</div>
        <div className="mt-2 text-7xl font-black text-amber-300">{quote ? fmtVnd(quote.totalVnd) : '—'}</div>
        <div className="mt-2 text-white/60">Nhận tiền, thối tiền, sau đó bấm xác nhận. Máy sẽ in {copies} bản.</div>
      </div>
      {err && <div className="rounded-xl border border-red-500 bg-red-500/10 px-6 py-3 text-red-300">Lỗi: {err}</div>}
      <div className="flex gap-4">
        <button className="btn-ghost" onClick={() => setScreen('review')}>← Quay lại</button>
        <button className="btn-primary" onClick={confirm} disabled={busy}>{busy ? 'Đang in…' : '✓ Xác nhận & In'}</button>
      </div>
    </div>
  )
}

/* ---------------- Done + share ---------------- */
function Done() {
  const setScreen = useBooth((s) => s.setScreen)
  const sessionId = useBooth((s) => s.sessionId)
  const clearSession = useBooth((s) => s.clearSession)
  const shareUrl = useBooth((s) => s.shareUrl)
  const shareQr = useBooth((s) => s.shareQr)
  const setShare = useBooth((s) => s.setShare)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    window.booth.invoke(IPC.LOCAL_SHARE_START, { sessionId }).then(async (r: any) => {
      const url = r?.url ?? null
      if (!url) { setErr('Không xác định được IP LAN'); return }
      const qr = await window.booth.invoke(IPC.LOCAL_SHARE_QR, { text: url })
      setShare(url, qr)
    }).catch((e: any) => setErr(String(e?.message ?? e)))
    return () => { window.booth.invoke(IPC.LOCAL_SHARE_STOP) }
  }, [sessionId, setShare])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <h2 className="text-5xl font-black text-emerald-400">Hoàn tất!</h2>
      <p className="text-2xl text-white/80">Ảnh đã in. Quét mã để tải về điện thoại.</p>
      {shareQr && <img src={shareQr} alt="QR chia sẻ" className="h-64 w-64 rounded-2xl bg-white p-3" />}
      {shareUrl && <div className="text-lg text-white/60">{shareUrl}</div>}
      {err && <div className="text-red-400">{err}</div>}
      <button className="btn-primary" onClick={() => { clearSession(); setScreen('attract') }}>Chụp phiên mới</button>
    </div>
  )
}

/* ---------------- Gallery ---------------- */
function Gallery() {
  const setScreen = useBooth((s) => s.setScreen)
  const [sessions, setSessions] = useState<any[]>([])
  const [detail, setDetail] = useState<any | null>(null)

  useEffect(() => {
    window.booth.invoke(IPC.GALLERY_LIST_SESSIONS).then(setSessions)
  }, [])

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-3xl font-bold">Ảnh hôm nay</h2>
        <button className="btn-ghost" onClick={() => setScreen('attract')}>← Về trang chính</button>
      </div>
      {!detail ? (
        <div className="grid grid-cols-3 gap-4 overflow-y-auto">
          {sessions.map((s) => (
            <button key={s.id} className="card text-left hover:ring-2 ring-amber-400" onClick={() => window.booth.invoke(IPC.SESSION_GET_BY_ID, { id: s.id }).then(setDetail)}>
              <div className="text-sm text-white/50">{new Date(s.createdAt).toLocaleString('vi-VN')}</div>
              <div className="mt-1 text-xl font-semibold">{s.photoCount} ảnh · {s.paymentStatus === 'paid' ? 'đã thanh toán' : 'chưa thanh toán'}</div>
              <div className="text-amber-300">{fmtVnd(s.priceMinor)}</div>
            </button>
          ))}
          {sessions.length === 0 && <div className="col-span-3 text-center text-white/40">Chưa có phiên nào hôm nay</div>}
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <button className="btn-ghost mb-4 w-fit" onClick={() => setDetail(null)}>← Danh sách</button>
          <div className="grid flex-1 grid-cols-4 gap-4 overflow-y-auto">
            {detail.photos.map((p: any) => <img key={p.id} src={p.dataUrl} className="rounded-xl" alt="photo" />)}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Staff PIN gate ---------------- */
function PinGate() {
  const setScreen = useBooth((s) => s.setScreen)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)

  const submit = async () => {
    const r = await window.booth.invoke(IPC.STAFF_PIN_VERIFY, { pin })
    if (r?.ok) setScreen('admin')
    else { setErr(true); setPin('') }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <h2 className="text-3xl font-bold">Nhập mã nhân viên</h2>
      <input autoFocus type="password" inputMode="numeric" className="w-64 rounded-xl border border-white/20 bg-white/5 px-4 py-4 text-center text-3xl tracking-widest outline-none focus:ring-2 ring-amber-400" value={pin} onChange={(e) => { setErr(false); setPin(e.target.value.replace(/\D/g, '').slice(0, 8)) }} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      {err && <div className="text-red-400">Sai mã PIN</div>}
      <div className="flex gap-4">
        <button className="btn-ghost" onClick={() => setScreen('attract')}>Huỷ</button>
        <button className="btn-primary" onClick={submit}>Vào</button>
      </div>
    </div>
  )
}

/* ---------------- Admin ---------------- */
function Admin() {
  const setScreen = useBooth((s) => s.setScreen)
  const [stats, setStats] = useState<any>(null)
  const [cfg, setCfg] = useState<any>(null)
  const [printers, setPrinters] = useState<any[]>([])
  const [dnp, setDnp] = useState<{ name: string; displayName: string }[] | null>(null)
  const [camStatus, setCamStatus] = useState<string>('')
  const [saved, setSaved] = useState(false)

  const refresh = async () => {
    setStats(await window.booth.invoke(IPC.STATS_TODAY))
    setCfg(await window.booth.invoke(IPC.CONFIG_GET_BOOTH_CONFIG))
    setPrinters(await window.booth.invoke(IPC.PRINTER_LIST_PRINTERS))
  }

  useEffect(() => {
    refresh()
  }, [])

  const detectDnp = async () => {
    const found = await window.booth.invoke(IPC.PRINTER_DETECT_DNP)
    setDnp(found)
    if (found?.length) {
      setCfg({ ...cfg, defaultPrinter: cfg.defaultPrinter ?? found[0].name })
    }
  }

  const checkCamera = async () => {
    const s = await window.booth.invoke('camera:status')
    setCamStatus(`${s.driver}: ${s.connected ? '✓' : '✗'} ${s.detail}`)
  }

  const setDriver = async (driver: string) => {
    const s = await window.booth.invoke(IPC.CAMERA_SET_MOCK, { driver })
    setCfg({ ...cfg, cameraDriver: driver })
    setCamStatus(`${s.driver}: ${s.connected ? '✓' : '✗'} ${s.detail}`)
  }

  const save = async () => {
    await window.booth.invoke(IPC.CONFIG_SAVE_BOOTH_CONFIG, cfg)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  if (!cfg) return <div className="p-8 text-white/60">Đang tải…</div>

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-3xl font-bold">Quản lý booth</h2>
        <button className="btn-ghost" onClick={() => setScreen('attract')}>← Về trang chính</button>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="card">
          <h3 className="mb-2 text-xl font-semibold">Hôm nay</h3>
          <div className="text-5xl font-black text-amber-300">{stats?.sessions ?? 0} phiên</div>
          <div className="mt-2 text-2xl">Doanh thu: {fmtVnd(stats?.revenueVnd ?? 0)}</div>
          <div className="mt-1 text-2xl">Bản in: <span className="text-amber-300">{stats?.prints ?? 0}</span></div>
        </div>
        <div className="card">
          <h3 className="mb-2 text-xl font-semibold">Thông tin booth</h3>
          <label className="mb-2 block text-sm text-white/60">Tên booth<input className="mt-1 w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2" value={cfg.boothName} onChange={(e) => setCfg({ ...cfg, boothName: e.target.value })} /></label>
          <label className="mb-2 block text-sm text-white/60">Cổng chia sẻ (LAN)<input type="number" className="mt-1 w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2" value={cfg.sharesPort} onChange={(e) => setCfg({ ...cfg, sharesPort: Number(e.target.value) })} /></label>
          <label className="mb-2 block text-sm text-white/60">Máy in mặc định
            <select className="mt-1 w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2" value={cfg.defaultPrinter ?? ''} onChange={(e) => setCfg({ ...cfg, defaultPrinter: e.target.value || null })}>
              <option value="">— Chọn —</option>
              {printers.map((p) => <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' (mặc định OS)' : ''}</option>)}
            </select>
          </label>
          <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm">
            <div className="mb-2 font-semibold text-amber-300">DNP DS-RX1HS / DS620</div>
            <button className="btn-ghost !px-4 !py-2 !text-sm" onClick={detectDnp}>Tìm máy DNP trên máy này</button>
            {dnp && (dnp.length === 0 ? (
              <div className="mt-2 text-red-300">Không thấy máy DNP. Cài driver DNP DS-RX1HS (xem README) và chọn queue đã đặt khổ 4×6.</div>
            ) : (
              <div className="mt-2 space-y-1">
                {dnp.map((p) => (
                  <div key={p.name} className="flex items-center justify-between gap-2">
                    <span className="text-white/80">{p.displayName}</span>
                    <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => setCfg({ ...cfg, defaultPrinter: p.name, templatePrinters: { ...cfg.templatePrinters, classic4: p.name, strip4: p.name } })}>Dùng máy này</button>
                  </div>
                ))}
              </div>
            ))}
            <div className="mt-2 text-xs text-white/50">Khuyến nghị: tạo 2 queue Windows riêng — "CamRent 4×6" (khổ 288×432, cắt 1 tờ) và "CamRent Strip 2×6" (PageSize w288h432-div2 hoặc Cutter=2Inch trên giấy 4×6) — rồi gán bên dưới.</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['classic4', 'strip4'] as const).map((t) => (
                <label key={t} className="text-xs text-white/60">Queue cho {t}
                  <select className="mt-1 w-full rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-xs" value={cfg.templatePrinters?.[t] ?? ''} onChange={(e) => setCfg({ ...cfg, templatePrinters: { ...cfg.templatePrinters, [t]: e.target.value || null } })}>
                    <option value="">— mặc định —</option>
                    {printers.map((p) => <option key={p.name} value={p.name}>{p.displayName || p.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="card">
          <h3 className="mb-2 text-xl font-semibold">Camera</h3>
          <div className="flex gap-2">
            {(['mock', 'gphoto2'] as const).map((d) => (
              <button key={d} className={`btn-ghost !py-2 !text-base flex-1 ${cfg.cameraDriver === d ? '!border-amber-400 !text-amber-300' : ''}`} onClick={() => setDriver(d)}>
                {d === 'mock' ? 'Mock (ảnh giả)' : 'gphoto2 (máy thật)'}
              </button>
            ))}
          </div>
          <label className="mt-3 block text-sm text-white/60">Đường dẫn gphoto2 (tuỳ chọn)
            <input placeholder="C:\\...\\camera-runtime\\win32-x64\\bin\\gphoto2.exe" className="mt-1 w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs" value={cfg.gphoto2Path ?? ''} onChange={(e) => setCfg({ ...cfg, gphoto2Path: e.target.value })} />
          </label>
          <button className="btn-ghost mt-3 !px-4 !py-2 !text-sm" onClick={checkCamera}>Kiểm tra camera</button>
          {camStatus && <div className="mt-2 text-sm text-white/80">{camStatus}</div>}
          <div className="mt-2 text-xs text-white/50">gphoto2 cần thư viện libgphoto2 (giống bundle camera-runtime của bản gốc). Không có máy thì để Mock.</div>
        </div>
        <div className="card col-span-2">
          <h3 className="mb-2 text-xl font-semibold">Bảng giá (VND)</h3>
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(cfg.pricing as Record<string, number>).map(([k, v]) => (
              <label key={k} className="block text-sm text-white/60">{k}
                <input type="number" className="mt-1 w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2" value={v} onChange={(e) => setCfg({ ...cfg, pricing: { ...cfg.pricing, [k]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
          <button className="btn-primary mt-4 !text-lg" onClick={save}>{saved ? '✓ Đã lưu' : 'Lưu thay đổi'}</button>
        </div>
      </div>
    </div>
  )
}
