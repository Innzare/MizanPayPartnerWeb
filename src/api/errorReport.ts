import { ApiError } from './errors'

/**
 * Непредвиденная ошибка интерфейса — в журнал ошибок на сервере.
 *
 * Ошибки запросов (сеть, ответы сервера) не шлём: сервер о них знает сам.
 * Офлайн не шлём, одинаковое — не чаще раза в 5 минут, всего — не больше
 * 5 в минуту: цикл рендера не должен завалить сервер.
 */
const API_URL = import.meta.env.VITE_API_URL as string
const recent = new Map<string, number>()
let minuteStart = 0
let minuteCount = 0

export function reportClientError(
  err: unknown,
  ctx: { kind: 'unhandled' | 'promise' | 'vue' | 'parse' | 'manual', component?: string },
): void {
  try {
    if (err instanceof ApiError && err.kind !== 'parse') return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const e = err instanceof Error ? err : new Error(String(err ?? 'unknown'))
    const key = `${e.name}|${e.message}|${ctx.component ?? ''}`
    const now = Date.now()
    if ((recent.get(key) ?? 0) > now - 5 * 60_000) return
    if (now - minuteStart > 60_000) {
      minuteStart = now
      minuteCount = 0
    }
    if (++minuteCount > 5) return
    recent.set(key, now)
    if (recent.size > 200) recent.clear()

    const token = localStorage.getItem('access_token')
    void fetch(`${API_URL}/client-errors`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        app: 'web',
        kind: ctx.kind,
        name: e.name.slice(0, 100),
        message: (e.message || '(без текста)').slice(0, 500),
        stack: e.stack?.slice(0, 4000),
        url: location.pathname.slice(0, 300),
        component: ctx.component?.slice(0, 100),
        requestId: err instanceof ApiError ? err.requestId : undefined,
      }),
    }).catch(() => undefined)
  } catch {
    /* отчёт об ошибке не должен порождать новую */
  }
}
