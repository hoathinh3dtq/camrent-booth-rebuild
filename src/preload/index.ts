import { contextBridge, ipcRenderer } from 'electron'

const api = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const sub = (_e: unknown, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
}

contextBridge.exposeInMainWorld('booth', api)
contextBridge.exposeInMainWorld('electron', api) // tương thích tên gọi kiểu bản gốc
