/**
 * Единое правило атрибуции денег по платежу к месяцу — используется И в аналитике
 * (analytics.vue), И в списке платежей (payments.vue), чтобы они считали месяц
 * ОДИНАКОВО (иначе разъедутся на платежах у границы месяца).
 *
 * Правило:
 *   PAID            → месяц ФАКТИЧЕСКОЙ оплаты (paidAt). Деньги пришли тогда, когда
 *                     клиент реально заплатил, а не когда платёж был запланирован.
 *   PAID без paidAt → фолбэк на плановый срок (dueDate). Бывает только у части
 *                     легаси-импорта; в обычном флоу paidAt проставляется всегда.
 *   PENDING/OVERDUE → это ПРОГНОЗ (ожидаемый доход) → плановый срок (dueDate).
 *   CLOSED_EARLY    → не участвует (amount=0, денег не несёт) → null.
 *
 * TZ-примечание (честно): paidAt хранится в UTC и имеет РАЗНЫЕ форматы в истории —
 * часть строк это UTC-полночь (onTime→dueDate, импорт, закрытие сделки), часть —
 * местный полдень (путь из веба), часть — реальный момент отметки. Месяц берём
 * ЛОКАЛЬНЫМИ методами Date (getFullYear/getMonth) — для аудитории MizanPay (СНГ/РФ,
 * офсеты UTC+3…+6) это корректно: UTC-полночь сдвигается в тот же день, реальные
 * моменты дают локальный месяц пользователя. Не переписывать на .slice() по ISO —
 * это UTC-срез, он разойдётся с локальным расчётом на платежах у границы месяца.
 * dueDate — календарная строка YYYY-MM-DD, её парсим строкой (без TZ-сдвига).
 */

export interface AttributablePayment {
  status: string
  paidAt?: string | null
  dueDate: string
}

/** {год, месяц(0-based)} учёта денег. null → платёж не участвует (CLOSED_EARLY / нет дат). */
export function attributionYearMonth(
  p: AttributablePayment,
): { year: number; month: number } | null {
  if (p.status === 'CLOSED_EARLY') return null
  if (p.status === 'PAID' && p.paidAt) {
    const d = new Date(p.paidAt)
    if (Number.isNaN(d.getTime())) return dueYearMonth(p.dueDate)
    return { year: d.getFullYear(), month: d.getMonth() }
  }
  // PENDING/OVERDUE или PAID-легаси без paidAt → плановый срок.
  return dueYearMonth(p.dueDate)
}

/** {год, месяц(0-based)} по плановому сроку (dueDate), строкой без TZ-сдвига. */
export function dueYearMonth(dueDate?: string | null): { year: number; month: number } | null {
  if (!dueDate) return null
  const year = parseInt(dueDate.slice(0, 4))
  const month = parseInt(dueDate.slice(5, 7)) - 1
  if (Number.isNaN(year) || Number.isNaN(month)) return null
  return { year, month }
}

/**
 * Локальная календарная дата YYYY-MM-DD из ISO-строки (по местным методам Date).
 * Для сравнения «оплачен вовремя»: paidAt может быть местным полднем, а dueDate —
 * полночью; сравнивать надо календарные даты, причём paidAt — ЛОКАЛЬНО, чтобы
 * согласоваться с локальной атрибуцией месяца (иначе на ночных оплатах метрика
 * «вовремя» и бейдж «не в свой месяц» противоречат друг другу).
 */
export function localDateStr(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Локальный ключ месяца учёта в формате YYYY-MM (для фильтров/группировки). null → не участвует. */
export function attributionMonthStr(p: AttributablePayment): string | null {
  const ym = attributionYearMonth(p)
  if (!ym) return null
  return `${ym.year}-${String(ym.month + 1).padStart(2, '0')}`
}

/**
 * «Оплачен не в свой месяц»: только для PAID с paidAt, где месяц/год фактической
 * оплаты ≠ плановому месяцу. Для бейджа-индикатора.
 *   null   — совпадает или неприменимо (не PAID / нет дат);
 *   'early' — оплачен РАНЬШЕ планового месяца (досрочно);
 *   'late'  — оплачен ПОЗЖЕ планового месяца (с задержкой через месяц).
 */
export function offMonthKind(p: AttributablePayment): 'early' | 'late' | null {
  if (p.status !== 'PAID' || !p.paidAt || !p.dueDate) return null
  const paid = new Date(p.paidAt)
  if (Number.isNaN(paid.getTime())) return null
  const py = paid.getFullYear()
  const pm = paid.getMonth()
  const due = dueYearMonth(p.dueDate)
  if (!due) return null
  if (py === due.year && pm === due.month) return null
  return py * 12 + pm < due.year * 12 + due.month ? 'early' : 'late'
}

/** Названия месяцев в предложном падеже: «в <месяце>». */
export const MONTH_PREPOSITIONAL = [
  'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
  'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре',
]

/**
 * «в июле» / «в июле 2025» — год добавляется, только если отличается от `refYear`
 * (чтобы в подписи «оплачен в июле за сентябрь» не тащить год, когда он тот же).
 */
export function monthPrepositional(year: number, month: number, refYear?: number): string {
  const name = MONTH_PREPOSITIONAL[month] ?? ''
  return refYear != null && year !== refYear ? `${name} ${year}` : name
}

/** Названия месяцев в винительном падеже: «за <месяц>». */
export const MONTH_ACCUSATIVE = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

/**
 * «за июль» / «за июль 2025» — падеж для предлога «за», в отличие от
 * `monthPrepositional`, который годится только после «в». Год добавляется
 * по тому же правилу: только когда отличается от `refYear`.
 */
export function monthAccusative(year: number, month: number, refYear?: number): string {
  const name = MONTH_ACCUSATIVE[month] ?? ''
  return refYear != null && year !== refYear ? `${name} ${year}` : name
}
