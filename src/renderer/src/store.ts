import { create } from 'zustand'

export type Screen =
  | 'attract'
  | 'camera'
  | 'review'
  | 'pay'
  | 'done'
  | 'gallery'
  | 'pin'
  | 'admin'

export interface Photo {
  id: string
  dataUrl: string
}

export interface TemplateInfo {
  id: string
  name: string
  kind: string
  cols: number
  rows: number
  width: number
  height: number
  caption: string
}

interface BoothState {
  screen: Screen
  sessionId: string | null
  photos: Photo[]
  templates: TemplateInfo[]
  selectedTemplate: string
  copies: number
  quote: { unitVnd: number; totalVnd: number } | null
  shareUrl: string | null
  shareQr: string | null
  boothName: string
  setScreen: (s: Screen) => void
  setSession: (id: string | null) => void
  addPhoto: (p: Photo) => void
  clearSession: () => void
  setTemplates: (t: TemplateInfo[]) => void
  setSelectedTemplate: (id: string) => void
  setCopies: (n: number) => void
  setQuote: (q: { unitVnd: number; totalVnd: number } | null) => void
  setShare: (url: string | null, qr: string | null) => void
  setBoothName: (n: string) => void
}

export const useBooth = create<BoothState>((set) => ({
  screen: 'attract',
  sessionId: null,
  photos: [],
  templates: [],
  selectedTemplate: 'classic4',
  copies: 1,
  quote: null,
  shareUrl: null,
  shareQr: null,
  boothName: 'CamRent Booth',
  setScreen: (screen) => set({ screen }),
  setSession: (sessionId) => set({ sessionId }),
  addPhoto: (p) => set((s) => ({ photos: [...s.photos, p] })),
  clearSession: () => set({ sessionId: null, photos: [], quote: null, shareUrl: null, shareQr: null, copies: 1 }),
  setTemplates: (templates) => set({ templates }),
  setSelectedTemplate: (selectedTemplate) => set({ selectedTemplate }),
  setCopies: (copies) => set({ copies }),
  setQuote: (quote) => set({ quote }),
  setShare: (shareUrl, shareQr) => set({ shareUrl, shareQr }),
  setBoothName: (boothName) => set({ boothName }),
}))
