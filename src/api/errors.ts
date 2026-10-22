/**
 * Ошибки запросов — одним понятным языком.
 *
 * Всё, что может прийти от сети и сервера, превращается в ApiError, у
 * которого `message` — готовая фраза для человека. Поэтому привычное
 * `toast.error(e)` по всему кабинету показывает понятный текст, а не
 * «Failed to fetch», «HTTP 502» или «Unexpected token <».
 *
 * Правило показа: внутри формы — только ошибки её полей (isFormError),
 * сеть и сервер — тостом.
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse' | 'aborted' | 'session'

export class ApiError extends Error {
  /** HTTP-статус; 0 — ответа не было (сеть). */
  status: number
  /** Код ошибки сервера: DEAL_LOCKED, CASHBOX_LIMIT, VALIDATION_FAILED… */
  code?: string
  /** Код запроса — по нему ошибку находят в журнале. */
  requestId?: string
  /** Ошибки по полям формы (валидация). */
  fields?: Record<string, string[]>
  kind: ApiErrorKind
  /** Уже показана пользователю — глобальный обработчик второй раз не покажет. */
  handled = false

  constructor(
    message: string,
    opts: { status?: number, code?: string, requestId?: string, fields?: Record<string, string[]>, kind?: ApiErrorKind } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = opts.status ?? 0
    this.code = opts.code
    this.requestId = opts.requestId
    this.fields = opts.fields
    this.kind = opts.kind ?? 'http'
  }
}

export const NETWORK_MESSAGE = 'Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз.'
export const DEFAULT_MESSAGE = 'Не удалось выполнить действие. Попробуйте ещё раз.'
const UPDATING_MESSAGE = 'Сервер обновляется или временно недоступен. Повторите через минуту.'
const CYRILLIC = /[А-Яа-яЁё]/

/** Короткий код для человека: «A7F3C2D1». */
export function shortRequestId(id?: string | null): string | undefined {
  return id ? id.replace(/-/g, '').slice(0, 8).toUpperCase() : undefined
}

/** Текст по статусу, когда сервер своего не прислал. */
function byStatus(status: number, requestId?: string): string {
  const code = shortRequestId(requestId)
  switch (status) {
    case 400: return 'Некорректный запрос — проверьте введённые данные'
    case 401: return 'Требуется вход в систему'
    case 403: return 'Нет доступа'
    case 404: return 'Не найдено'
    case 409: return 'Данные изменились — обновите страницу и попробуйте ещё раз'
    case 413: return 'Файл или данные слишком большие'
    case 429: return 'Слишком много запросов подряд — подождите несколько секунд'
    case 502:
    case 503:
    case 504: return UPDATING_MESSAGE
    default:
      return status >= 500
        ? `Что-то пошло не так на сервере. Попробуйте ещё раз${code ? `, а если повторится — сообщите код ошибки ${code}` : ''}`
        : DEFAULT_MESSAGE
  }
}

/** Сеть упала или запрос оборван — ответа не было вовсе. */
export function networkError(e: unknown): ApiError {
  const name = (e as { name?: string })?.name
  if (name === 'AbortError') return new ApiError('Запрос прерван', { kind: 'aborted' })
  if (name === 'TimeoutError') return new ApiError('Сервер долго не отвечает — попробуйте ещё раз', { kind: 'timeout' })
  return new ApiError(NETWORK_MESSAGE, { kind: 'network' })
}

/**
 * Неуспешный ответ → ApiError. Тело читается как текст: при деплое прокси
 * отдаёт HTML-страницу 502/503, и `response.json()` упал бы с «Unexpected token <».
 */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  const headerId = response.headers.get('X-Request-Id') ?? undefined
  let data: any = null
  try {
    const text = await response.text()
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  const requestId: string | undefined = data?.requestId ?? headerId
  const raw = Array.isArray(data?.message) ? data.message[0] : data?.message
  const status = response.status
  let message: string
  if (status === 429) message = byStatus(429)
  else if (typeof raw === 'string' && raw && (CYRILLIC.test(raw) || status < 500)) {
    // Свой русский текст сервера; английский 4xx (старый сервер) — по статусу.
    message = CYRILLIC.test(raw) ? raw : byStatus(status, requestId)
  } else message = byStatus(status, requestId)
  return new ApiError(message, { status, code: data?.code, requestId, fields: data?.fields, kind: 'http' })
}

/**
 * Текст для человека из любой ошибки. Для ApiError — её готовый текст; для
 * всего остального (ошибка в коде страницы, TypeError) — шаблон: сырой
 * технический текст пользователю не показываем.
 */
export function toUserMessage(e: unknown, fallback = DEFAULT_MESSAGE): string {
  if (e instanceof ApiError) return e.message || fallback
  // Сетевой сбой из прямого fetch (скачивания) — та же фраза, что у клиента.
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) return NETWORK_MESSAGE
  // Своя ошибка с русским текстом (throw new Error('Выберите кассу')) — как есть.
  if (e instanceof Error && CYRILLIC.test(e.message) && !/^[A-Za-z]+Error:/.test(e.message)) return e.message
  return fallback
}

/** Ошибка, которую уместно показать внутри формы: неверные данные, а не сеть/сервер. */
export function isFormError(e: unknown): boolean {
  return e instanceof ApiError && e.kind === 'http' && e.status >= 400 && e.status < 500
    && ![401, 403, 404, 429].includes(e.status)
}

/**
 * На страницах входа неверный пароль (401) — тоже ошибка формы: её место в
 * форме. Сеть и сервер — тостом.
 */
export function isAuthFormError(e: unknown): boolean {
  return isFormError(e) || (e instanceof ApiError && e.kind === 'http' && e.status === 401)
}
