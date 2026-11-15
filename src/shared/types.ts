// Kiểu dữ liệu dùng chung main <-> renderer.
export interface BoothConfig {
  boothName: string
  pricing: Record<string, number> // templateId -> giá VND
  currency: string
  sharesPort: number
  defaultPrinter: string | null
  staffPinSet: boolean
}

export interface CapturedPhoto {
  id: string
  sessionId: string
  dataUrl: string
  createdAt: number
}

export interface SessionRow {
  id: string
  created_at: number
  photo_count: number
  status: string
  price_minor: number
  payment_status: string
  template_id: string | null
}

export type PhotoDataUrl = string
