import { isFormError, toUserMessage } from './errors'
import { useToast } from '@/composables/useToast'

/**
 * Для окна с полем ошибки: ошибку формы (неверные данные) вернуть, чтобы
 * показать её прямо в окне; сеть, сервер, доступ — показать тостом и вернуть
 * пустую строку. Так «Нет соединения» не висит красной плашкой в форме.
 *
 *   error.value = inlineOrToast(e, 'Не удалось сохранить')
 */
export function inlineOrToast(e: unknown, fallback: string): string {
  if (isFormError(e)) return toUserMessage(e, fallback)
  useToast().error(e, fallback)
  return ''
}

/**
 * Для раздела, который не загрузился: причину (нет сети, сервер) — тостом, а
 * на месте раздела — нейтральная заглушка без технического текста.
 *
 *   error.value = loadFailed(e, 'Не удалось загрузить историю')
 */
export function loadFailed(e: unknown, placeholder: string): string {
  useToast().error(e, placeholder)
  return placeholder
}
