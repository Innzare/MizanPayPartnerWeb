import { ref, readonly } from 'vue'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  message: string
  type: ToastType
  timeout: number
}

const toasts = ref<Toast[]>([])
let nextId = 0

function show(message: string, type: ToastType = 'info', timeout = 4000) {
  const id = nextId++
  toasts.value.push({ id, message, type, timeout })

  setTimeout(() => {
    remove(id)
  }, timeout)
}

function remove(id: number) {
  const idx = toasts.value.findIndex((t) => t.id === id)
  if (idx !== -1) toasts.value.splice(idx, 1)
}

export function useToast() {
  return {
    toasts: readonly(toasts),
    show,
    remove,
    success: (msg: string) => show(msg, 'success', 3000),
    error: (msg: string) => show(msg, 'error', 5000),
    warning: (msg: string) => show(msg, 'warning', 4000),
    info: (msg: string) => show(msg, 'info', 4000),
  }
}