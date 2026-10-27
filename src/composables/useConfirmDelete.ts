import { ref, readonly } from 'vue'

/**
 * Подтверждение удаления — одно окно на весь кабинет.
 *
 * Правило владельца (25.10.2026): удаление — отдельная кнопка со своим окном.
 * Не кнопка внутри окна правки и не системное окошко браузера: системное
 * выглядит чужим, и в нём не объяснить, что именно исчезнет.
 *
 * `if (!(await confirmDelete({ title, text }))) return` — вместо
 * `if (!confirm(...)) return`. Само окно — ConfirmDeleteHost в корне
 * приложения.
 */
export interface ConfirmDeleteOptions {
  /** «Удалить счёт?» */
  title: string
  /** Что исчезнет и что останется. */
  text?: string
  /** Дополнительное предупреждение — выделяется цветом. */
  warning?: string
  /** Надпись на кнопке. По умолчанию — «Удалить». */
  action?: string
}

interface State extends ConfirmDeleteOptions {
  open: boolean
}

const state = ref<State>({ open: false, title: '' })
let resolver: ((ok: boolean) => void) | null = null

function confirmDelete(opts: ConfirmDeleteOptions): Promise<boolean> {
  // Новое окно поверх незакрытого — прежнее считаем отменённым.
  resolver?.(false)
  state.value = { ...opts, open: true }
  return new Promise((resolve) => {
    resolver = resolve
  })
}

function answer(ok: boolean) {
  state.value = { ...state.value, open: false }
  resolver?.(ok)
  resolver = null
}

export function useConfirmDelete() {
  return { state: readonly(state), confirmDelete, answer }
}
