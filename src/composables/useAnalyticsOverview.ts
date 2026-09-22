import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import type {
  AnalyticsBreakdown,
  MonthDealsResponse,
  AnalyticsMonthlyRow,
  AnalyticsSummary,
  AnalyticsTimeliness,
  BreakdownMetric,
  TimelinessDetails,
} from '@/types/analytics'

/**
 * Загрузка агрегатов главной и «Обзора» аналитики.
 *
 * Раньше обе страницы выкачивали весь портфель сделок и все платежи, а
 * показатели считали в браузере. Теперь их считает сервер — теми же формулами,
 * что и раздел «Отчёты», поэтому цифры между разделами не расходятся.
 */

/** Часовой пояс решает, в какой месяц попадёт ночной платёж. */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'

function query(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams({ tz: TZ })
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v)
  }
  return q.toString()
}

/**
 * Сводка за всё время: итоги по сделкам, разрез платежей, счётчики клиентов.
 * Перезапрашивается при смене кассы.
 */
export function useAnalyticsSummary(cashBoxId: () => string | null) {
  const summary = ref<AnalyticsSummary | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const params = computed(() => query({ cashBoxId: cashBoxId() }))

  async function load() {
    const qs = params.value
    loading.value = true
    error.value = null
    try {
      const res = await api.get<AnalyticsSummary>(`/analytics/summary?${qs}`)
      // Пока ходили, партнёр мог сменить кассу — ответ на устаревший запрос
      // применять нельзя.
      if (qs !== params.value) return
      summary.value = res
    } catch (e: any) {
      if (qs !== params.value) return
      // Тариф без аналитики отвечает 403 — это не ошибка, а закрытый раздел:
      // страница показывает заглушку, тревожить партнёра нечем.
      if (e?.status !== 403) error.value = e?.message || 'Не удалось загрузить сводку'
      console.error('Failed to load analytics summary:', e)
    } finally {
      if (qs === params.value) loading.value = false
    }
  }

  watch(params, load, { immediate: true })

  return { summary, loading, error, reload: load }
}

/**
 * Просрочка и оплаты заранее — срез «на сейчас», без периода.
 * Перезапрашивается при смене кассы, как и сводка.
 */
export function useAnalyticsTimeliness(cashBoxId: () => string | null) {
  const timeliness = ref<AnalyticsTimeliness | null>(null)
  const loading = ref(false)

  const params = computed(() => query({ cashBoxId: cashBoxId() }))

  async function load() {
    const qs = params.value
    loading.value = true
    try {
      const res = await api.get<AnalyticsTimeliness>(`/analytics/timeliness?${qs}`)
      // Касса могла смениться, пока ходили, — устаревший ответ не применяем.
      if (qs !== params.value) return
      timeliness.value = res
    } catch (e: any) {
      if (qs !== params.value) return
      // 403 — закрытый тарифом раздел, а не сбой: страница покажет заглушку.
      if (e?.status !== 403) console.error('Failed to load analytics timeliness:', e)
    } finally {
      if (qs === params.value) loading.value = false
    }
  }

  watch(params, load, { immediate: true })

  return { timeliness, loading, reload: load }
}

/**
 * Помесячный разрез за период. Используется и годовым обзором, и графиками —
 * с разными диапазонами.
 */
export function useAnalyticsMonthly(
  range: () => { from: string; to: string },
  cashBoxId: () => string | null,
) {
  const rows = ref<AnalyticsMonthlyRow[]>([])
  const loading = ref(false)

  const params = computed(() => {
    const r = range()
    return query({ from: r.from, to: r.to, cashBoxId: cashBoxId() })
  })

  async function load() {
    const qs = params.value
    loading.value = true
    try {
      const res = await api.get<AnalyticsMonthlyRow[]>(`/analytics/monthly?${qs}`)
      if (qs !== params.value) return
      rows.value = res
    } catch (e: any) {
      if (qs !== params.value) return
      console.error('Failed to load analytics monthly:', e)
    } finally {
      if (qs === params.value) loading.value = false
    }
  }

  watch(params, load, { immediate: true })

  /** Строка конкретного месяца ('YYYY-MM') — нули, если месяца нет в ответе. */
  function monthRow(month: string): AnalyticsMonthlyRow | null {
    return rows.value.find((r) => r.month === month) ?? null
  }

  return { rows, loading, monthRow, reload: load }
}

/**
 * Какие платежи стоят за цифрой своевременности — вся сторона или одна полоса
 * возраста. Зовётся по клику, поэтому обычная функция.
 */
export async function fetchTimelinessDetails(opts: {
  side: 'overdue' | 'early'
  bucket?: string | null
  cashBoxId?: string | null
  limit?: number
  offset?: number
}): Promise<TimelinessDetails> {
  const qs = query({
    side: opts.side,
    bucket: opts.bucket,
    cashBoxId: opts.cashBoxId,
    limit: opts.limit != null ? String(opts.limit) : undefined,
    offset: opts.offset ? String(opts.offset) : undefined,
  })
  return api.get<TimelinessDetails>(`/analytics/timeliness-details?${qs}`)
}

/**
 * Расшифровка показателя: какие сделки за ним стоят. Зовётся по клику, без
 * наблюдения — поэтому обычная функция, а не composable с watch.
 */
export async function fetchDealsBreakdown(
  metric: BreakdownMetric,
  opts: { cashBoxId?: string | null; limit?: number; offset?: number } = {},
): Promise<AnalyticsBreakdown> {
  const qs = query({
    metric,
    cashBoxId: opts.cashBoxId,
    limit: opts.limit != null ? String(opts.limit) : undefined,
    offset: opts.offset ? String(opts.offset) : undefined,
  })
  return api.get<AnalyticsBreakdown>(`/analytics/deals-breakdown?${qs}`)
}
/**
 * Разбор дохода по сделкам за период: месяц, год или всё время. Зовётся по
 * открытию диалога, поэтому обычная функция.
 */
export async function fetchMonthDeals(opts: {
  month?: string | null
  year?: number | null
  cashBoxId?: string | null
  limit?: number
  offset?: number
  /** Фильтр вкладок: все сделки, только с оплатами, только с ожидаемыми. */
  filter?: 'all' | 'paid' | 'pending'
}): Promise<MonthDealsResponse> {
  const qs = query({
    month: opts.month,
    year: opts.year ? String(opts.year) : undefined,
    cashBoxId: opts.cashBoxId,
    limit: opts.limit != null ? String(opts.limit) : undefined,
    offset: opts.offset ? String(opts.offset) : undefined,
    filter: opts.filter && opts.filter !== 'all' ? opts.filter : undefined,
  })
  return api.get<MonthDealsResponse>(`/analytics/month-deals?${qs}`)
}
