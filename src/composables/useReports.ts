import { ref, computed, watch } from 'vue'
import { api } from '@/api/client'
import type {
  ReportsSummary,
  ReportsMonthlyRow,
  ReportsDealsTable,
  ReportsSnapshot,
  ReportsEfficiency,
  ReportsRisks,
  PeriodPreset,
  PeriodRange,
} from '@/types/reports'

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

/** Локальная дата в YYYY-MM-DD (без сдвига часового пояса). */
function ymd(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Диапазон по пресету, привязанный к сегодняшней дате. */
export function rangeForPreset(preset: PeriodPreset, anchor = new Date()): PeriodRange {
  const y = anchor.getFullYear()
  const m = anchor.getMonth()
  switch (preset) {
    case 'month': {
      const from = new Date(y, m, 1)
      const to = new Date(y, m + 1, 0)
      return { from: ymd(from), to: ymd(to), preset, label: `${MONTHS_NOM[m]} ${y}` }
    }
    case 'quarter': {
      const q = Math.floor(m / 3)
      const from = new Date(y, q * 3, 1)
      const to = new Date(y, q * 3 + 3, 0)
      return { from: ymd(from), to: ymd(to), preset, label: `${q + 1}-й квартал ${y}` }
    }
    case 'half': {
      const h = m < 6 ? 0 : 1
      const from = new Date(y, h * 6, 1)
      const to = new Date(y, h * 6 + 6, 0)
      return { from: ymd(from), to: ymd(to), preset, label: `${h ? 'II' : 'I'} полугодие ${y}` }
    }
    case 'all': {
      // Заведомо ранняя граница: сервер сам обрежет график по первому месяцу
      // с данными, поэтому пустых столбцов не будет.
      return { from: '2000-01-01', to: ymd(anchor), preset: 'all', label: 'За всё время' }
    }
    case 'year':
    default: {
      const from = new Date(y, 0, 1)
      const to = new Date(y, 12, 0)
      return { from: ymd(from), to: ymd(to), preset: 'year', label: `${y} год` }
    }
  }
}

/** Человеческая подпись произвольного диапазона: «1 марта — 15 апреля 2026». */
export function customLabel(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00`)
  const t = new Date(`${to}T00:00:00`)
  const sameYear = f.getFullYear() === t.getFullYear()
  const left = `${f.getDate()} ${MONTHS_GEN[f.getMonth()]}${sameYear ? '' : ` ${f.getFullYear()}`}`
  const right = `${t.getDate()} ${MONTHS_GEN[t.getMonth()]} ${t.getFullYear()}`
  return `${left} — ${right}`
}

/**
 * Загрузка данных раздела «Отчёты».
 *
 * Всё считает сервер: тянуть десятки тысяч платежей в браузер ради периодов
 * и когорт нельзя. Часовой пояс передаём явно — иначе ночные платежи попали бы
 * в разные месяцы на вкладках «Обзор» (локальное время) и «Отчёты» (UTC).
 */
export function useReports(
  period: () => PeriodRange,
  cashBoxId: () => string | null,
  dealStatus: () => string | null = () => null,
) {
  const summary = ref<ReportsSummary | null>(null)
  const monthly = ref<ReportsMonthlyRow[]>([])
  const dealsTable = ref<ReportsDealsTable | null>(null)
  const snapshot = ref<ReportsSnapshot | null>(null)
  const efficiency = ref<ReportsEfficiency | null>(null)
  const risks = ref<ReportsRisks | null>(null)

  const loading = ref(false)
  const error = ref<string | null>(null)

  // ── Страница таблицы сделок ──
  // Раньше таблица приезжала целиком (4,5 МБ на профиле с 14 813 сделками), а
  // поиск, сортировка и «Итого» считались в браузере. Теперь всё это на
  // сервере, а сюда приходит одна страница.
  const TABLE_PAGE = 50
  const tablePage = ref(1)
  const tableSort = ref('dealDate')
  const tableDir = ref<'asc' | 'desc'>('desc')
  const tableSearch = ref('')
  const tableOverdueOnly = ref(false)
  const tableLoading = ref(false)
  let tableReq = 0

  /** Параметры страницы таблицы поверх общих (период, касса, статус). */
  function tableParams(withTotals: boolean): string {
    const q = new URLSearchParams(params.value)
    q.set('limit', String(TABLE_PAGE))
    q.set('offset', String((tablePage.value - 1) * TABLE_PAGE))
    q.set('sort', tableSort.value)
    q.set('dir', tableDir.value)
    if (tableSearch.value.trim()) q.set('search', tableSearch.value.trim())
    if (tableOverdueOnly.value) q.set('overdueOnly', 'true')
    // Итоги считаются по всей выборке и стоят прохода по ней — при листании
    // они не меняются.
    if (!withTotals) q.set('totals', '0')
    return q.toString()
  }

  /** Загрузить страницу таблицы. `withTotals` — при смене условий отбора. */
  async function loadTable(withTotals = true) {
    const req = ++tableReq
    tableLoading.value = true
    try {
      const d = await api.get<ReportsDealsTable>(`/reports/deals-table?${tableParams(withTotals)}`)
      if (req !== tableReq) return
      // При листании сервер итоги не считает (totals=null) — оставляем прежние,
      // они посчитаны по всей выборке и от смены страницы не меняются.
      dealsTable.value = withTotals
        ? d
        : { ...d, totals: dealsTable.value?.totals ?? d.totals }
    } catch (e: any) {
      if (req === tableReq) error.value = e?.message || 'Не удалось загрузить таблицу'
    } finally {
      if (req === tableReq) tableLoading.value = false
    }
  }

  // Смена условий возвращает на первую страницу и пересчитывает итоги.
  watch([tableSort, tableDir, tableSearch, tableOverdueOnly], () => {
    tablePage.value = 1
    loadTable(true)
  })
  watch(tablePage, () => loadTable(false))

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'

  const params = computed(() => {
    const p = period()
    const box = cashBoxId()
    const q = new URLSearchParams({ from: p.from, to: p.to, tz })
    if (box) q.set('cashBoxId', box)
    const st = dealStatus()
    if (st) q.set('status', st)
    return q.toString()
  })

  async function load() {
    loading.value = true
    error.value = null
    const qs = params.value
    try {
      // Грузим только то, что показано на вкладке. Эндпоинты snapshot /
      // efficiency / risks / monthly на бэкенде остались — соответствующие
      // блоки временно отключены, вернуть их можно без доработок сервера.
      // Смена периода сбрасывает таблицу на первую страницу.
      tablePage.value = 1
      const [s, d] = await Promise.all([
        api.get<ReportsSummary>(`/reports/summary?${qs}`),
        api.get<ReportsDealsTable>(`/reports/deals-table?${tableParams(true)}`),
      ])
      // Гонка: пока грузили, пользователь мог сменить период — не перетираем.
      if (qs !== params.value) return
      summary.value = s
      dealsTable.value = d
    } catch (e: any) {
      error.value = e?.message || 'Не удалось загрузить отчёты'
    } finally {
      if (qs === params.value) loading.value = false
    }
  }

  // immediate: без него загрузка стартовала только при СМЕНЕ периода, и при
  // первом открытии вкладки блоки оставались пустыми.
  watch(params, () => { load() }, { immediate: true })

  return {
    summary, monthly, dealsTable, snapshot, efficiency, risks, loading, error, load,
    // Управление таблицей сделок — страница, сортировка, поиск, фильтр.
    tablePage, tableSort, tableDir, tableSearch, tableOverdueOnly, tableLoading,
    TABLE_PAGE, loadTable,
  }
}
