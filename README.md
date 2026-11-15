# CamRent Booth — bản rebuild độc lập (MVP)

Rebuild của `CamRent Photobooth Kiosk App` v1.0.71 (Electron + React + TS). Xem `../PRD-camrent-booth-rebuild.md`.

## Chạy dev
```powershell
cd C:\Users\Admin\Music\camrent-booth-clone\app
npm install
npm run dev
```

## Camera (gphoto2 hoặc mock)
- Mặc định driver `mock`. Trong Admin → Camera chọn "gphoto2 (máy thật)" + "Kiểm tra camera".
- gphoto2 tìm theo thứ tự: setting `gphoto2Path` → `CAMRENT_GPHOTO2_PATH` → `<cạnh app>\camera-runtime\win32-x64\bin\gphoto2.exe` → `resources/camera-runtime/...` → PATH.
- Cần bundle `libgphoto2` (camlibs/iolibs) cạnh gphoto2.exe — cách dễ nhất là copy nguyên `camera-runtime\win32-x64` từ bản gốc vào resources của app (đó là bundle công ty bạn đang ship) hoặc cài gphoto2 cho Windows và trỏ `gphoto2Path`.
- Live view: `--capture-preview` mỗi 700ms. Chụp: `--capture-image-and-download --force-overwrite` (timeout 30s) — bám đúng cơ chế bản gốc. Settings máy ảnh (`/main/...`) chưa implement — Phase 2. PPM preview chưa decode (máy trả JPEG cho hầu hết DSLR) — Phase 2.
- Driver Canon EDSDK riêng (như bản gốc `canonEdsdkRuntime.js`) là Phase 2, cần SDK Canon.

## Máy in DNP DS-RX1HS / DS620
- Compose layout trong app đã đúng khổ 300dpi: `classic4` = 1800×1200 (4×6), `strip4` = 600×1800 (strip 2×6).
- Printer detection: Admin → **Tìm máy DNP** (match ds-rx1hs/rx1hs/ds620 … như bản gốc). Chọn "Dùng máy này" → tự set mặc định + gán cả 2 template.
- **Cách in chuẩn RX1HS trên Windows**: tạo 2 queue riêng — `CamRent Booth 4×6` (PageSize=w288h432, cắt nguyên tấm) và `CamRent Booth Strip 2×6` (PageSize="w288h432-div2" **hoặc** Cutter=2Inch trên giấy 4×6 — KHÔNG cắt 2 inch trên giấy 6×8). Rồi gán từng queue cho `classic4`/`strip4` trong Admin. App in `silent:true` vào queue đã chọn — không hiện dialog.
- Stats "Bản in hôm nay" = tổng `copies` trong bảng `print_jobs` (SQLite local).
- Driver DNP Windows (bản gốc trỏ tới `DRIVER_RX1HS_WIN_10-3.zip` tại dnp-newprod-wp-content.cellar-c2.services.clever-cloud.com) — app KHÔNG tự tải; cài từ trang chính thức/nhà phân phối hoặc dùng bundle gốc.
- Màu: để driver DNP tự áp ICC mặc định ("AdjustmentsEnabled=False" như bản gốc); app không chỉnh R/G/B tay.

## Ghi chú chung
- Thanh toán: offline, bảng giá trong settings (`config:saveBoothConfig`), xác nhận tiền mặt.
- Chia sẻ: LAN server + QR (`localShare:*`), không có cloud sync.
- Licensing: offline config, không gọi activation server.
- In: `webContents.print()` với `silent:true` khi có máy in (theo queue đã gán template). Compose SVG (vector, nét ở mọi khổ).
- SQLite: `node:sqlite` (built-in Node 24, không cần Visual Studio/native build). Ảnh lưu file tại `%APPDATA%/camrent-booth-app/media/` (không nhét vào DB).
