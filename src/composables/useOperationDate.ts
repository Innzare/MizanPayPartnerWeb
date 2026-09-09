/**
 * Границы даты денежной операции — одни и те же во всех окнах.
 *
 * Правило партнёра: сотрудник не может датировать операцию глубже, чем на
 * несколько дней назад (срок задаётся в настройках), иначе оплата уходит в
 * закрытый месяц и отчётность за него меняется задним числом. Владельцу
 * прошлое доступно, но при сильном отклонении мы переспрашиваем.
 *
 * Будущее недоступно никому: платежа, которого ещё не было, не бывает.
 *
 * Здесь только границы для календаря и текст вопроса — решает всё равно
 * сервер, эти же правила проверяются там.
 */
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

/** Значение по умолчанию, если партнёр ничего не настраивал. */
const DEFAULT_WINDOW_DAYS = 7
/** Насколько глубоко владелец может уйти в прошлое без вопроса. */
const OWNER_CONFIRM_DAYS = 30

function toYmd(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function shiftDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return toYmd(d)
}

export function useOperationDate() {
  const auth = useAuthStore()

  /** Сегодня — верхняя граница для всех. */
  const maxDate = computed(() => toYmd(new Date()))

  const windowDays = computed(() => {
    const v = auth.user?.backdateWindowDays
    return typeof v === 'number' && v >= 0 ? v : DEFAULT_WINDOW_DAYS
  })

  /** Нижняя граница: у сотрудника — окно партнёра, у владельца её нет. */
  const minDate = computed(() => (auth.isStaff ? shiftDays(-windowDays.value) : null))

  /** Сколько дней назад выбранная дата. */
  function daysBack(ymd: string): number {
    if (!ymd) return 0
    const chosen = new Date(`${ymd}T12:00:00`)
    const today = new Date(`${maxDate.value}T12:00:00`)
    return Math.round((today.getTime() - chosen.getTime()) / 86_400_000)
  }

  /**
   * Владелец ставит дату сильно в прошлом — переспрашиваем.
   * Возвращает текст вопроса или null, если спрашивать не о чем.
   */
  function confirmMessage(ymd: string): string | null {
    if (auth.isStaff) return null
    const back = daysBack(ymd)
    if (back <= OWNER_CONFIRM_DAYS) return null
    return (
      `Дата операции — ${back} дн. назад. ` +
      'Доход и остаток кассы за тот период изменятся задним числом. Продолжить?'
    )
  }

  return { minDate, maxDate, windowDays, daysBack, confirmMessage }
}
