import type { App } from 'vue'
import { ApiError, toUserMessage } from '@/api/errors'
import { useToast } from '@/composables/useToast'
import { reportClientError } from '@/api/errorReport'

/**
 * Последняя линия: ошибка, которую никто не поймал, всё равно доходит до
 * человека понятным тостом, а не тихо пропадает в консоли.
 *
 * - ApiError, которую уже показали (handled) или сессионная — молча;
 * - ApiError без показа — её текст тостом;
 * - всё остальное (ошибка в коде страницы) — шаблонный текст.
 */
const INTERFACE_ERROR = 'Произошла ошибка в интерфейсе. Обновите страницу, а если повторится — сообщите в поддержку.'

// Шум браузера, который ни о чём не говорит человеку.
const IGNORED = [/^Script error\.?$/, /ResizeObserver loop/, /Failed to fetch dynamically imported module/, /Importing a module script failed/]

function ignored(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return IGNORED.some((re) => re.test(msg))
}

// Одна и та же ошибка подряд (цикл рендера) — один тост, а не десяток.
let lastText = ''
let lastAt = 0

function report(e: unknown, fallback: string, ctx: Parameters<typeof reportClientError>[1]): void {
  if (ignored(e)) return
  // Непредвиденное (не ошибка запроса) — в журнал ошибок на сервере.
  reportClientError(e, ctx)
  if (e instanceof ApiError) {
    if (e.kind === 'session' || e.kind === 'aborted' || e.handled) return
    e.handled = true
  }
  const text = toUserMessage(e, fallback)
  const now = Date.now()
  // Без сети фоновые опросы падают раз за разом — одно напоминание в полминуты.
  const gap = e instanceof ApiError && e.kind === 'network' ? 30_000 : 3000
  if (text === lastText && now - lastAt < gap) return
  lastText = text
  lastAt = now
  useToast().error(text)
}

export function installErrorHandling(app: App): void {
  app.config.errorHandler = (err, instance, info) => {
    console.error('[vue]', info, err)
    const component = (instance?.$?.type as { __name?: string, name?: string } | undefined)
    report(err, INTERFACE_ERROR, { kind: 'vue', component: component?.__name ?? component?.name ?? info })
  }
  window.addEventListener('unhandledrejection', (ev) => {
    report(ev.reason, INTERFACE_ERROR, { kind: 'promise' })
  })
  window.addEventListener('error', (ev) => {
    // Ошибки загрузки картинок/скриптов приходят без error — их не показываем.
    if (!ev.error) return
    report(ev.error, INTERFACE_ERROR, { kind: 'unhandled' })
  })
}
