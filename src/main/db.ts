// SQLite qua node:sqlite (Node 24 built-in, Electron 45 nhúng Node 24.22.2).
// Không cần rebuild native — chạy ổn định trên kiosk mà không cần Visual Studio.
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  const dbPath = path.join(userData, 'booth.db')
  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  seed(db)
  return db
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      photo_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      price_minor INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      template_id TEXT
    );
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      data_url TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      config_json TEXT NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      session_id TEXT,
      template_id TEXT,
      copies INTEGER NOT NULL DEFAULT 1,
      printer_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_print_jobs_created ON print_jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_photos_session ON photos(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
  `)
}

const DEFAULT_SETTINGS: Record<string, unknown> = {
  boothName: 'CamRent Booth',
  currency: 'VND',
  sharesPort: 8787,
  defaultPrinter: null,
  pricing: { classic4: 30000, strip4: 25000, single: 15000 },
  staffPin: '1234',
  cameraDriver: 'auto',
  gphoto2Path: '',
  templatePrinters: { classic4: null, strip4: null }, // queue Windows riêng cho từng template (vd khổ 4×6 và strip 2×6)
}

function seed(d: DatabaseSync): void {
  const row = d.prepare('SELECT COUNT(*) AS c FROM settings').get() as { c: number | bigint }
  if (Number(row.c) === 0) {
    const ins = d.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)')
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, JSON.stringify(v))
  }
  const t = d.prepare('SELECT COUNT(*) AS c FROM templates').get() as { c: number | bigint }
  if (Number(t.c) === 0) {
    const ins = d.prepare('INSERT INTO templates (id, name, kind, config_json, builtin) VALUES (?, ?, ?, ?, 1)')
    ins.run('classic4', 'Cổ điển 2x2', 'grid2x2', JSON.stringify({ cols: 2, rows: 2, width: 1800, height: 1200, caption: 'CamRent Booth' }))
    ins.run('strip4', 'Photo strip 4', 'strip', JSON.stringify({ cols: 1, rows: 4, width: 600, height: 1800, caption: 'CamRent Booth' }))
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
    .run(key, JSON.stringify(value))
}
