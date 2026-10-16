import { ref } from 'vue'
import { api } from '@/api/client'

/**
 * Закрытые месяцы касс — чтобы заранее гасить кнопки, которые сервер всё равно
 * отклонит («Отменить оплату» у оплаты закрытого месяца и т. п.).
 *
 * Решает сервер: здесь только подсказка. Список общий на всё приложение и
 * грузится один раз; после закрытия или открытия месяца — `refresh()`.
 */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

const byCashBox = ref<Record<string, string[]>>({})
let loading: Promise<void> | null = null
let loaded = false

function monthOf(date: string | Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date(date))
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`
}

async function refresh(): Promise<void> {
  loading = (async () => {
    try {
      byCashBox.value = await api.get<Record<string, string[]>>('/month-closes')
      loaded = true
    } catch {
      /* без списка кнопки остаются как есть — сервер всё равно проверит */
    } finally {
      loading = null
    }
  })()
  return loading
}

export function useMonthLocks() {
  if (!loaded && !loading) void refresh()

  /** Дата приходится на закрытый месяц кассы. */
  function isLocked(cashBoxId: string | null | undefined, date: string | Date | null | undefined): boolean {
    if (!cashBoxId || !date) return false
    const months = byCashBox.value[cashBoxId]
    return !!months?.length && months.includes(monthOf(date))
  }

  /** «Сентябрь 2026» — месяц даты. */
  function monthTitle(date: string | Date): string {
    const [y, m] = monthOf(date).split('-').map(Number)
    const name = MONTHS[(m ?? 1) - 1] ?? ''
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
  }

  /** «Сентябрь 2026 закрыт — …» — для подсказки на погашенной кнопке. */
  function lockReason(date: string | Date): string {
    return `${monthTitle(date)} закрыт — откройте месяц в «Инвесторы → По месяцам»`
  }

  /** Закрытые месяцы кассы, по возрастанию. */
  function monthsOf(cashBoxId: string | null | undefined): string[] {
    return (cashBoxId && byCashBox.value[cashBoxId]) || []
  }

  return { byCashBox, isLocked, lockReason, monthTitle, monthsOf, monthOf, refresh }
}
