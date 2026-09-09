import { ref, readonly } from 'vue'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

/** Кнопка в уведомлении — например «Отменить» сразу после отметки оплаты. */
export interface ToastAction {
  label: string
  handler: () => void | Promise<void>
}

export interface Toast {
  id: number
  message: string
  type: ToastType
  timeout: number
  action?: ToastAction
}

const toasts = ref<Toast[]>([])
let nextId = 0

function show(message: string, type: ToastType = 'info', timeout = 4000, action?: ToastAction) {
  const id = nextId++
  toasts.value.push({ id, message, type, timeout, action })

  setTimeout(() => {
    remove(id)
  }, timeout)
  return id
}

/**
 * Уведомление с кнопкой отмены. Живёт дольше обычного: человеку нужно
 * заметить ошибку и успеть нажать.
 */
function showWithAction(message: string, action: ToastAction, type: ToastType = 'success', timeout = 7000) {
  return show(message, type, timeout, action)
}

function remove(id: number) {
  const idx = toasts.value.findIndex((t) => t.id === id)
  if (idx !== -1) toasts.value.splice(idx, 1)
}

export function useToast() {
  return {
    toasts: readonly(toasts),
    show,
    showWithAction,
    remove,
    success: (msg: string) => show(msg, 'success', 3000),
    error: (msg: string) => show(msg, 'error', 5000),
    warning: (msg: string) => show(msg, 'warning', 4000),
    info: (msg: string) => show(msg, 'info', 4000),
  }
}