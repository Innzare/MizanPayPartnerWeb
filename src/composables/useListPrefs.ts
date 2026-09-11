/**
 * Настройки списка, которые партнёр задал один раз: размер страницы и
 * сортировка.
 *
 * Раньше каждый раздел заводил их заново при каждом заходе: ушёл из должников
 * в сделку, вернулся — снова полсотни строк и сортировка по умолчанию. Ещё и
 * хранили по-разному — где-то с проверкой значения, где-то без, а где-то не
 * хранили вовсе.
 *
 * Живёт в браузере: настройка «как мне удобно смотреть» у каждого своя и на
 * каждом устройстве может отличаться, поэтому на сервер её не носим.
 */
import { ref, watch, type Ref } from 'vue'

/**
 * Размеры страницы.
 *
 * Крупные шаги — просьба партнёров с большими списками: листать несколько
 * тысяч строк по сотне неудобно. База на тысяче строк теряет считанные
 * миллисекунды (на профиле с 15 тысячами должников — 39 мс на 25 строк против
 * 63 мс на 1000): вся работа приходится на отбор и сортировку, а подробности
 * дочитываются только для строк страницы. Время уходит на передачу ответа и
 * отрисовку, поэтому тысяча — потолок и для сервера тоже.
 */
export const PER_PAGE_OPTIONS = [25, 100, 250, 500, 1000]

/** Сколько строк показывать, если партнёр ещё не выбирал. */
const DEFAULT_PER_PAGE = 100

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Приватный режим и «блокировать данные сайтов» — не повод падать.
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

/**
 * Ближайший допустимый размер страницы.
 *
 * Набор размеров со временем меняется, а в браузере лежит старое число.
 * Округляем вверх: партнёр, привыкший к полусотне строк, не должен вдруг
 * увидеть меньше, чем видел.
 */
export function normalizePageSize(saved: unknown): number {
  const n = Number(saved)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PER_PAGE
  if (PER_PAGE_OPTIONS.includes(n)) return n
  return PER_PAGE_OPTIONS.find((size) => size >= n) ?? PER_PAGE_OPTIONS[PER_PAGE_OPTIONS.length - 1]!
}

/** Размер страницы раздела: помнится между заходами. */
export function usePageSize(storageKey: string, fallback = DEFAULT_PER_PAGE): Ref<number> {
  const saved = read(storageKey)
  const perPage = ref(saved == null ? fallback : normalizePageSize(saved))
  watch(perPage, (v) => write(storageKey, String(v)))
  return perPage
}

export interface ListSort<T extends string = string> {
  col: Ref<T>
  dir: Ref<'asc' | 'desc'>
}

/**
 * Сортировка раздела: помнится вместе с направлением.
 *
 * `allowed` защищает от мусора в хранилище — колонки со временем исчезают, и
 * сортировка по несуществующему ключу оставляла бы партнёра с ошибкой вместо
 * списка.
 */
export function useListSort<T extends string>(
  storageKey: string,
  defaultCol: T,
  defaultDir: 'asc' | 'desc' = 'desc',
  allowed?: readonly T[],
): ListSort<T> {
  const col = ref(defaultCol) as Ref<T>
  const dir = ref(defaultDir) as Ref<'asc' | 'desc'>

  try {
    const raw = JSON.parse(read(storageKey) || 'null')
    const okCol = typeof raw?.col === 'string' && (!allowed || allowed.includes(raw.col))
    if (okCol) col.value = raw.col
    if (raw?.dir === 'asc' || raw?.dir === 'desc') dir.value = raw.dir
  } catch {
    /* ignore */
  }

  watch([col, dir], ([c, d]) => write(storageKey, JSON.stringify({ col: c, dir: d })))
  return { col, dir }
}
