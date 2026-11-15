# CamRent Booth — Rebuild PRD (draft v1)

Target: rebuild `CamRent Photobooth Kiosk App` v1.0.71 (Electron, `com.camrent.booth`) as an independent MVP.
Source analyzed: `C:\Users\Admin\AppData\Local\Programs\CamRent Booth\resources\app.asar` (349 MB, 7,372 files).
Analysis date: 2026-11-15. Evidence: `evidence-camrent-core.json` (REA, 5 core files, shipped-artifact). Full application graph of the 6,490-file asar was not completed (server restarts killed two 12-minute runs); file inventory and static feature map are complete (`asar-file-list.txt`).

## 1. What shipped (feature map from static analysis)

**Stack**: Electron 29 · electron-vite · React 18 · TypeScript · Tailwind 4 · Zustand · TanStack Query · better-sqlite3 · sharp · three.js · @mediapipe/tasks-vision · onnxruntime-web · qrcode · gifenc · electron-updater · ssh2.

**Domain areas** (169 IPC channels, extracted from `out/main/index.js`):

| Area | Channels (examples) | Native deps |
|---|---|---|
| Camera capture | `camera:capture`, `camera:session:*`, `camera:startLiveView`, `camera:autoLight:*`, `camera:meterPhoto`, `camera:listSettings`, `camera:setSetting` | Canon EDSDK runtime (`canonEdsdkRuntime.js`), gphoto2 runtime (`camera-runtime/win32-x64`), `camrent-gphoto-bridge` (macOS), digiCamControl |
| Photo pipeline | `photo:processFx`, `photo:listLuts`, `photo:previewFx`, `background:*`, `photo:toDataUrl` | sharp, LUT packs, MediaPipe selfie segmenter / face landmarker, ONNX beauty models |
| Sessions & gallery | `session:save*`, `session:recapImage`, `gallery:*` (list/reprint/export/share) | better-sqlite3 (`templates_local` table seen), filesystem |
| Printing | `printer:print`, `printer:composeLayout`, `printer:listPrinters`, `printer:getOptions/openPreferences`, `printer:listIccProfiles`, `printer:softProof*`, `printer:preview*`, `printer:getPrintProfile`, `printer:dryRun` | OS print system, ICC profiles, Hiti/DNP/Mitsubishi/Sinfonia/Citizen drivers (catalog auto-install) |
| Payment / print debt | `payment:quotePrint`, `payment:createOrder`, `payment:startOrder`, `payment:confirmCash`, `booth:printDebt*` | cash flow on kiosk, pricing config |
| Sharing | `localShare:*` (QR + Wi-Fi SSID/password), `cloudShare:*`, `sync:*` (session upload), `gallery:prepareShare` | `photobooth.camerarent.vn` backend |
| Templates & marketplace | `templates:*` (list/upsert/delete/backup), `editor:*` (login/market/clone/sync) | SQLite local cache, `packages/booth-editor` model, `camera-runtime` |
| Admin / ops / license | `auth:login`, `activation:*`, `driver:*` (catalog/install/autoSetup), `staffPin:*`, `support:*`, `remote:maintenance*` (SSH), `booth:opsSnapshot`, `stats:today`, `update:*`, `booth-event:*` | electron-updater → `camerarent.vn/booth/internal`, ssh2 support agent (`out/main/support-agent.js`, 750 KB) |

**Data**: SQLite local (`templates_local` confirmed; more tables likely in unread segments). Photo media on disk. Cloud sync to company backend `photobooth.camerarent.vn/v1` and `cdn.camerarent.vn`. Telemetry/activation against `camerarent.vn`.

**Installers**: NSIS (win x64), AppImage/deb (linux), dmg/zip (mac arm64+x64). Kiosk with desktop shortcut, frameless window, auto-update from company URL.

## 2. Rebuild proposal — MVP scope (decision needed)

### In scope for MVP v1 (proposed)
1. Electron + React + TS + Vite + Tailwind 4 + Zustand scaffold (electron-vite), frameless kiosk window, Windows target.
2. Camera subsystem abstraction: `CameraService` interface → **gphoto2** (Windows, bundled runtime pattern as shipped) for DSLR live view + capture; mock driver for development/CI.
3. Capture session flow: open session → live view → capture → retake → finish.
4. Gallery: list finished sessions, reprint placeholder (no print yet), export photos to folder/share sheet.
5. Printing: `printer:listPrinters`, `printer:composeLayout` (basic 2/4/6-cut template), `printer:print` via OS print, print quotes from local pricing JSON (`payment:quotePrint`), cash confirm flow without server (`payment:confirmCash` local).
6. Local share: `localShare:getUrl/status` — LAN HTTP server + QR code (in-kiosk share page, listing session photos via streaming).
7. Local templates: 2 built-in templates, local SQLite, `templates:list/get/upsert/delete`.
8. Settings/Admin screen: staff PIN, camera settings, printer prefs, booth pricing config.

### Out of scope for MVP v1 (phase 2+)
- Cloud sync / cloud share / uploads to `photobooth.camerarent.vn` (needs company backend; Phase 2 with authenticated API).
- Template marketplace (`editor:*`) and booth-event unlock codes.
- Activation/licensing service (`activation:*`) — replaced by build-time config for MVP; real licensing in Phase 2 against company endpoint.
- Remote SSH maintenance agent (`remote:*`, `support-agent`).
- Driver auto-installer (`driver:*`) — documented manual install for MVP.
- AI beauty retouch (ONNX) and background replacement (MediaPipe) — Phase 2; MVP ships FX/LUT basics only if at all.
- Auto-updater wiring (electron-updater) — Phase 2.
- macOS support (MVP: Windows x64 only; gphoto2 path mirrors shipped bundle).

### Key dependencies & risks
- **Camera**: requires a DSLR supported by libgphoto2 (e.g., Canon/Nikon bodies) or Canon EDSDK adapter (Phase 2; EDSDK requires Canon SDK license acceptance). MVP: gphoto2 only.
- **Printers**: real print requires the shop's driver (DNP/HiTi ISSs) installed on the kiosk; code paths are OS-driver-based, so MVP prints through any installed driver.
- **Media storage** path conventions; gallery DB schema designed fresh (no reuse of their DB).
- **Legality**: Your app, your rebuild — fine. Do not reuse their assets (fonts/images/luts packs) unless your company owns them; rebuild uses own assets.

## 3. Proposed architecture (independent)

```
src/
  main/           Electron main: window, IPC registration, services
  preload/        contextBridge (same minimal surface as shipped: invoke/on/send)
  renderer/       React UI (screens: attract → PIN → camera → review → print/share → done)
  services/
    camera/       CameraService (gphoto2 subprocess bridge), mock driver
    sessions/     session lifecycle + SQLite
    printing/     composeLayout (sharp), print queue, quotes
    sharing/      LAN server + QR (qrcode), share page
    templates/    built-in templates + SQLite
  shared/         IPC channel enum, types, pricing logic
```

Storage: `%APPDATA%/CamRentBooth/booth.db` (better-sqlite3) + `media/` folder.
IPC surface: same channel names as shipped app where a feature exists (`camera:*`, `printer:*`, `session:*`, `gallery:*`, `localShare:*`, `payment:*`, `staffPin:*`, `templates:*`, `config:*`, `system:*`) so the renderer ports cleanly later.

## 4. Rebuild phases

- **Phase 0 (this doc)** — PRD approved by you.
- **Phase 1** — Scaffold + window + camera service (mock → gphoto2) + session list.
- **Phase 2** — Capture UI + review/retake + gallery + local share (QR).
- **Phase 3** — Print pipeline (compose + print) + cash payment quote/confirm.
- **Phase 4** — Templates, PIN admin, packaging (NSIS), kiosk polish.

Estimate for MVP v1: 2–4 focused sessions of iterative build; print/camera need real hardware to verify.

## 5. Open questions for you

1. MVP v1 scope as proposed (in/out) — OK, or add/remove?
2. Camera hardware present on this machine (DSLR model)? If none, dev against mock driver.
3. Printer type for later print testing?
4. Project location: `C:\Users\Admin\Music\camrent-booth-clone` — OK (already used for analysis artifacts) or separate `...\camrent-booth`?
5. On licensing: do we wire MVP to your company activation endpoint later, or keep it offline/config-based permanently?
