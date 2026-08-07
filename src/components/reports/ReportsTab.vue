<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatCurrency } from '@/utils/formatters'
import { useReports, rangeForPreset, customLabel } from '@/composables/useReports'
import type { PeriodPreset, PeriodRange } from '@/types/reports'
import ReportsDealsTable from './ReportsDealsTable.vue'
import MetricDetailDialog from '@/components/MetricDetailDialog.vue'
import type { MetricDetailItem } from '@/components/MetricDetailDialog.vue'
import { generateReportPdf } from '@/utils/reportPdf'
import { useAuthStore } from '@/stores/auth'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  cashBoxId: string | null
  isDark: boolean
}>()

// ── Период ───────────────────────────────────────────────────────────────
/** Пункты выпадающего списка периода. */
const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'all', label: 'За всё время' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'half', label: 'Полугодие' },
  { key: 'year', label: 'Год' },
]

const period = ref<PeriodRange>(rangeForPreset('all'))
const customOpen = ref(false)
// Поля «своего периода» стартуют с текущего месяца: у пресета «за всё время»
// нижняя граница техническая (2000 год) и в пикере смотрелась бы странно.
const thisMonth = rangeForPreset('month')
const customFrom = ref(thisMonth.from)
const customTo = ref(thisMonth.to)

function pickPreset(p: PeriodPreset) {
  // 'custom' в списке — только отображение текущего своего периода,
  // выбирать его пунктом меню нечего: для этого есть отдельная кнопка.
  if (p === 'custom') return
  period.value = rangeForPreset(p)
}

/** Список для селекта: свой период добавляется пунктом, только когда активен. */
const periodItems = computed(() => {
  const items = PRESETS.map((p) => ({ title: p.label, value: p.key as string }))
  if (period.value.preset === 'custom') {
    items.push({ title: period.value.label, value: 'custom' })
  }
  return items
})
function applyCustom() {
  if (!customFrom.value || !customTo.value) return
  const [from, to] = customFrom.value <= customTo.value
    ? [customFrom.value, customTo.value]
    : [customTo.value, customFrom.value]
  period.value = { from, to, preset: 'custom', label: customLabel(from, to) }
  customOpen.value = false
}

/**
 * Фильтр по статусу сделок — ГЛОБАЛЬНЫЙ для всей вкладки: показатели, график
 * и таблица считаются по одному набору сделок. По завершённым видно реальный
 * итог, по активным — то, что ещё в работе.
 */
const dealStatus = ref<string | null>(null)

const authStore = useAuthStore()
const cashboxesStore = useCashBoxesStore()
const toast = useToast()

/** Выгрузка PDF доступна по отдельному праву — как и прочий экспорт. */
const canExport = computed(() => authStore.can('analytics.export'))
const exporting = ref(false)

/**
 * Excel собирает СЕРВЕР: библиотека xlsx уже используется в разделе экспорта,
 * тянуть вторую во фронтенд ради того же самого незачем.
 */
async function exportExcel() {
  if (!ready.value) return
  exporting.value = true
  try {
    const box = props.cashBoxId
      ? cashboxesStore.items.find((b) => b.id === props.cashBoxId)
      : null
    const q = new URLSearchParams({
      from: period.value.from,
      to: period.value.to,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow',
      periodLabel: period.value.label,
    })
    if (props.cashBoxId) q.set('cashBoxId', props.cashBoxId)
    if (dealStatus.value) q.set('status', dealStatus.value)
    if (box?.name) q.set('cashBoxName', box.name)

    const token = localStorage.getItem('access_token')
    const res = await fetch(`${import.meta.env.VITE_API_URL}/reports/excel?${q}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('Не удалось сформировать файл')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Отчёт ${period.value.label}.xlsx`.replace(/[/\\?%*:|"<>]/g, '-')
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось выгрузить Excel')
  } finally {
    exporting.value = false
  }
}

/** Данные загружены — кнопку выгрузки можно показывать. */
const ready = computed(() => !!summary.value && !!dealsTable.value)

async function exportPdf() {
  if (!summary.value || !dealsTable.value) return
  exporting.value = true
  try {
    const box = props.cashBoxId
      ? cashboxesStore.items.find((b) => b.id === props.cashBoxId)
      : null
    generateReportPdf({
      period: period.value,
      summary: summary.value,
      deals: dealsTable.value,
      // В шапке отчёта уместнее название компании, если оно заполнено —
      // документ уходит инвестору или партнёру, а не остаётся внутри.
      partnerName: authStore.user?.companyName?.trim() || authStore.userName,
      cashBoxName: box?.name ?? null,
      statusLabel: dealStatus.value ? STATUS_LABELS[dealStatus.value] ?? null : null,
    })
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сформировать PDF')
  } finally {
    exporting.value = false
  }
}

const { summary, dealsTable, loading, error } = useReports(
  () => period.value,
  () => props.cashBoxId,
  () => dealStatus.value,
)

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Активные',
  COMPLETED: 'Завершённые',
  OVERDUE: 'Просроченные',
  DISPUTED: 'Спорные',
}
const STATUS_ORDER = ['ACTIVE', 'COMPLETED', 'OVERDUE', 'DISPUTED']

const statusTabs = computed(() => {
  const s = summary.value
  if (!s?.statusCounts) return []
  const keys = Object.keys(s.statusCounts).sort(
    (a, b) => (STATUS_ORDER.indexOf(a) + 1 || 99) - (STATUS_ORDER.indexOf(b) + 1 || 99),
  )
  // Один статус — выбирать не из чего, прячем переключатель.
  if (keys.length < 2) return []
  return [
    { key: null as string | null, label: 'Все сделки', count: s.allCount },
    ...keys.map((k) => ({ key: k, label: STATUS_LABELS[k] || k, count: s.statusCounts[k] })),
  ]
})

// ── Дельта к прошлому периоду ────────────────────────────────────────────
function delta(cur: number, prev: number): { pct: number | null; up: boolean } {
  if (!prev) return { pct: null, up: cur > 0 }
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100)
  return { pct, up: cur >= prev }
}

// «За всё время» не с чем сравнивать: предыдущего периода такой длины не бывает.
const showCompare = computed(() => period.value.preset !== 'all')

/**
 * Итоги сгруппированы в СЕКЦИИ по смыслу — иначе семь-девять строк подряд
 * читаются как каша. Порядок повторяет ход денег:
 *   что за сделки → сколько денег от клиентов → какой с этого доход.
 * Формулировки бытовые: пользователи не финансисты.
 */
interface SummaryRow {
  key: string
  label: string
  hint: string
  value: string
  color: string
  accent: boolean
  /** Подытог секции: «получено + ожидается». Оформляется отдельно. */
  total: boolean
  d: { pct: number | null; up: boolean }
}
interface SummarySection {
  key: string
  title: string
  rows: SummaryRow[]
}

const sections = computed((): SummarySection[] => {
  const s = summary.value
  if (!s) return []
  const c = s.current
  const p = s.previous

  const row = (
    key: string,
    label: string,
    hint: string,
    value: number,
    prev: number,
    opts: { color?: string; accent?: boolean; total?: boolean } = {},
  ): SummaryRow => ({
    key, label, hint,
    value: formatCurrency(Math.max(0, value)),
    color: opts.color ?? '',
    accent: !!opts.accent,
    total: !!opts.total,
    d: delta(value, prev),
  })

  // Со-инвесторы показываются, только если им уже начислено или начислится.
  // Иначе лишние строки только запутывают.
  const hasCoInvestors = c.ciProfitFact > 0 || c.ciProfitProjected > 0

  const out: SummarySection[] = [
    {
      key: 'deals',
      title: `Сделки${c.dealsCount ? ` · ${c.dealsCount}` : ''}`,
      rows: [
        row('contract', 'Сумма всех сделок',
          'сколько клиенты должны заплатить: закупка вместе с наценкой',
          c.contractTotal, p.contractTotal),
        row('purchase', 'Вложено в товар',
          'живые деньги, потраченные на закупку',
          c.purchaseTotal, p.purchaseTotal),
        row('margin', 'Наценка по сделкам',
          'весь доход, который эти сделки принесут',
          c.marginTotal, p.marginTotal),
      ],
    },
    {
      key: 'money',
      title: 'Деньги от клиентов',
      rows: [
        row('returned', 'Уже вернулось',
          'первоначальные взносы и оплаченные платежи',
          c.returned, p.returned, { color: '#10b981' }),
        row('remaining', 'Осталось получить',
          'клиенты ещё должны по графику',
          c.remaining, p.remaining, { color: '#3b82f6' }),
      ],
    },
  ]

  if (!hasCoInvestors) {
    out.push({
      key: 'profit',
      title: 'Ваш доход',
      rows: [
        row('earned', 'Заработано',
          'прибыль с вернувшихся денег',
          c.earnedNet, p.earnedNet, { color: '#059669', accent: true }),
        row('left', 'Ожидается дохода',
          'заработаете, когда клиенты доплатят',
          c.profitLeft, p.profitLeft, { color: '#0ea5e9' }),
        row('totalProfit', 'Всего дохода по сделкам',
          'уже заработано плюс то, что ещё придёт',
          c.projectedNetTotal, p.projectedNetTotal, { total: true }),
      ],
    })
    return out
  }

  out.push(
    {
      key: 'gross',
      title: 'Доход по сделкам — до раздела с инвесторами',
      rows: [
        row('grossEarned', 'Доход получен',
          'наценка с вернувшихся денег',
          c.grossEarned, p.grossEarned),
        row('grossLeft', 'Доход впереди',
          'наценка с того, что клиенты ещё не заплатили',
          c.grossLeft, p.grossLeft, { color: '#0ea5e9' }),
        row('grossTotal', 'Всего дохода по сделкам',
          'получено плюс то, что ещё придёт',
          c.grossEarned + c.grossLeft, p.grossEarned + p.grossLeft, { total: true }),
      ],
    },
    // Отдельная секция между «всем доходом» и «вашим доходом»: видно, какая
    // именно часть уходит инвесторам. Структура та же — получено / впереди /
    // всего, поэтому три секции складываются построчно.
    {
      key: 'ci',
      title: 'Доля инвесторов',
      rows: [
        row('ciFact', 'Уже начислено',
          'из дохода с вернувшихся денег',
          c.ciProfitFact, p.ciProfitFact, { color: '#8b5cf6' }),
        row('ciLeft', 'Начислится впереди',
          'когда клиенты доплатят',
          c.ciProfitProjected, p.ciProfitProjected, { color: '#8b5cf6' }),
        row('ciTotal', 'Всего инвесторам',
          'вся их доля по этим сделкам',
          c.ciProfitFact + c.ciProfitProjected,
          p.ciProfitFact + p.ciProfitProjected, { total: true }),
      ],
    },
    {
      key: 'profit',
      title: 'Ваш доход — после вычета доли инвесторов',
      rows: [
        row('earned', 'Ваш чистый доход',
          'заработано за вычетом доли со-инвесторов',
          c.earnedNet, p.earnedNet, { color: '#059669', accent: true }),
        row('left', 'Ваш доход впереди',
          'останется вам, когда клиенты доплатят',
          c.profitLeft, p.profitLeft, { color: '#0ea5e9' }),
        row('netTotal', 'Всего ваш доход',
          'заработано плюс то, что ещё придёт — за вычетом доли инвесторов',
          c.projectedNetTotal, p.projectedNetTotal, { total: true }),
      ],
    },
  )
  return out
})


/**
 * Расшифровка показателя: из каких сделок он складывается.
 *
 * Всё считаем из УЖЕ загруженной таблицы сделок — данные те же, что в итогах,
 * поэтому суммы в модалке всегда сходятся со строкой, по которой её открыли.
 */
const detailKey = ref<string | null>(null)
const detailOpen = computed({
  get: () => detailKey.value !== null,
  set: (v: boolean) => { if (!v) detailKey.value = null },
})

const dealSub = (r: any) =>
  `${r.clientName} · ${new Date(r.dealDate).toLocaleDateString('ru-RU')}`

/** Доля со-инвесторов, которая начислится с ещё не полученной части сделки. */
function ciProjectedOf(r: any): number {
  return Math.max(0, r.margin - r.ciProfitFact - r.projectedNetProfitTotal)
}

const DETAILS: Record<string, {
  title: string
  hint: string
  color: string
  value: (r: any) => number
  parts?: (r: any) => Array<{ label: string; value: string }>
}> = {
  contract: {
    title: 'Сумма всех сделок',
    hint: 'Сколько клиенты должны заплатить по каждой сделке — закупка вместе с наценкой.',
    color: '#0ea5e9',
    value: (r) => r.totalPrice,
    parts: (r) => [
      { label: 'закупка', value: formatCurrency(r.cost) },
      { label: 'наценка', value: formatCurrency(r.margin) },
      { label: 'оплачено', value: `${r.paidCount} из ${r.totalCount}` },
    ],
  },
  purchase: {
    title: 'Вложено в товар',
    hint: 'Живые деньги, потраченные на закупку товара по каждой сделке.',
    color: '#3b82f6',
    value: (r) => r.cost,
    parts: (r) => [
      { label: 'продано за', value: formatCurrency(r.totalPrice) },
      { label: 'наценка', value: formatCurrency(r.margin) },
      { label: 'уже вернулось', value: formatCurrency(r.received) },
    ],
  },
  margin: {
    title: 'Наценка по сделкам',
    hint: 'Весь доход, который принесёт каждая сделка: цена продажи минус закупка.',
    color: '#059669',
    value: (r) => r.margin,
    parts: (r) => [
      { label: 'закупка', value: formatCurrency(r.cost) },
      { label: 'цена продажи', value: formatCurrency(r.totalPrice) },
      { label: 'дохода получено', value: formatCurrency(r.grossProfitReceived) },
    ],
  },
  returned: {
    title: 'Уже вернулось',
    hint: 'Деньги, которые клиенты уже отдали: первоначальный взнос и оплаченные платежи.',
    color: '#10b981',
    value: (r) => r.received,
    parts: (r) => [
      { label: 'всего по сделке', value: formatCurrency(r.totalPrice) },
      { label: 'осталось', value: formatCurrency(r.remaining) },
      { label: 'взнос', value: formatCurrency(r.downPayment) },
      { label: 'платежей', value: `${r.paidCount} из ${r.totalCount}` },
    ],
  },
  remaining: {
    title: 'Осталось получить',
    hint: 'Сколько клиенты ещё должны по графику платежей.',
    color: '#3b82f6',
    value: (r) => r.remaining,
    parts: (r) => [
      { label: 'всего по сделке', value: formatCurrency(r.totalPrice) },
      { label: 'уже получено', value: formatCurrency(r.received) },
      { label: 'платежей', value: `${r.paidCount} из ${r.totalCount}` },
      ...(r.overdueAmount > 0
        ? [{ label: 'просрочено', value: formatCurrency(r.overdueAmount) }]
        : []),
    ],
  },
  grossEarned: {
    title: 'Доход получен',
    hint: 'Наценка с уже вернувшихся денег — до раздела с инвесторами.',
    color: '#059669',
    value: (r) => r.grossProfitReceived,
    parts: (r) => [
      { label: 'всего дохода по сделке', value: formatCurrency(r.margin) },
      { label: 'пришло денег', value: formatCurrency(r.received) },
      { label: 'доля прибыли', value: `${r.marginSharePct}%` },
    ],
  },
  grossLeft: {
    title: 'Доход впереди',
    hint: 'Наценка с той части, которую клиенты ещё не заплатили.',
    color: '#0ea5e9',
    value: (r) => Math.max(0, r.margin - r.grossProfitReceived),
    parts: (r) => [
      { label: 'всего дохода по сделке', value: formatCurrency(r.margin) },
      { label: 'уже получено', value: formatCurrency(r.grossProfitReceived) },
      { label: 'осталось получить', value: formatCurrency(r.remaining) },
    ],
  },
  grossTotal: {
    title: 'Всего дохода по сделкам',
    hint: 'Вся наценка по каждой сделке: полученная часть плюс та, что ещё придёт.',
    color: '#059669',
    value: (r) => r.margin,
    parts: (r) => [
      { label: 'получено', value: formatCurrency(r.grossProfitReceived) },
      { label: 'впереди', value: formatCurrency(Math.max(0, r.margin - r.grossProfitReceived)) },
      { label: 'закупка', value: formatCurrency(r.cost) },
      { label: 'цена продажи', value: formatCurrency(r.totalPrice) },
    ],
  },
  ciFact: {
    title: 'Доля инвесторов — уже начислено',
    hint: 'Сколько из полученного дохода начислено со-инвесторам по каждой сделке.',
    color: '#8b5cf6',
    value: (r) => r.ciProfitFact,
    parts: (r) => [
      { label: 'всего им по сделке', value: formatCurrency(r.ciProfitFact + ciProjectedOf(r)) },
      { label: 'дохода получено', value: formatCurrency(r.grossProfitReceived) },
      { label: 'инвесторы', value: r.coInvestorNames.join(', ') || '—' },
    ],
  },
  ciLeft: {
    title: 'Доля инвесторов — начислится впереди',
    hint: 'Сколько получат со-инвесторы, когда клиенты доплатят.',
    color: '#8b5cf6',
    value: ciProjectedOf,
    parts: (r) => [
      { label: 'всего им по сделке', value: formatCurrency(r.ciProfitFact + ciProjectedOf(r)) },
      { label: 'уже начислено', value: formatCurrency(r.ciProfitFact) },
      { label: 'инвесторы', value: r.coInvestorNames.join(', ') || '—' },
    ],
  },
  ciTotal: {
    title: 'Всего инвесторам',
    hint: 'Вся доля со-инвесторов по каждой сделке: начисленная и будущая.',
    color: '#8b5cf6',
    value: (r) => r.ciProfitFact + ciProjectedOf(r),
    parts: (r) => [
      { label: 'начислено', value: formatCurrency(r.ciProfitFact) },
      { label: 'впереди', value: formatCurrency(ciProjectedOf(r)) },
      { label: 'дохода по сделке', value: formatCurrency(r.margin) },
      { label: 'инвесторы', value: r.coInvestorNames.join(', ') || '—' },
    ],
  },
  earned: {
    title: 'Заработано',
    hint: 'Ваша прибыль с уже вернувшихся денег — за вычетом доли со-инвесторов.',
    color: '#059669',
    value: (r) => Math.max(0, r.netProfitReceived),
    parts: (r) => [
      { label: 'всего по сделке', value: formatCurrency(r.projectedNetProfitTotal) },
      { label: 'закупка', value: formatCurrency(r.cost) },
      { label: 'цена продажи', value: formatCurrency(r.totalPrice) },
      { label: 'платежей', value: `${r.paidCount} из ${r.totalCount}` },
      ...(r.ciProfitFact > 0
        ? [{ label: 'инвесторам', value: formatCurrency(r.ciProfitFact) }]
        : []),
    ],
  },
  left: {
    title: 'Ожидается дохода',
    hint: 'Сколько вы ещё заработаете по каждой сделке, когда клиенты доплатят.',
    color: '#0ea5e9',
    value: (r) => r.profitLeft,
    parts: (r) => [
      { label: 'всего по сделке', value: formatCurrency(r.projectedNetProfitTotal) },
      { label: 'уже заработано', value: formatCurrency(Math.max(0, r.netProfitReceived)) },
      { label: 'осталось получить', value: formatCurrency(r.remaining) },
      { label: 'платежей', value: `${r.paidCount} из ${r.totalCount}` },
    ],
  },
  totalProfit: {
    title: 'Всего дохода по сделкам',
    hint: 'Сколько принесёт каждая сделка целиком: уже заработанное плюс будущее.',
    color: '#059669',
    value: (r) => r.projectedNetProfitTotal,
    parts: (r) => [
      { label: 'заработано', value: formatCurrency(Math.max(0, r.netProfitReceived)) },
      { label: 'впереди', value: formatCurrency(r.profitLeft) },
      { label: 'закупка', value: formatCurrency(r.cost) },
      { label: 'цена продажи', value: formatCurrency(r.totalPrice) },
    ],
  },
}

// «Ваш чистый доход» и «Всего ваш доход» показывают то же, что earned/totalProfit.
DETAILS.netTotal = { ...DETAILS.totalProfit, title: 'Всего ваш доход' }

const detailConfig = computed(() => {
  const key = detailKey.value
  if (!key || !DETAILS[key] || !dealsTable.value) return null
  const cfg = DETAILS[key]
  const items: MetricDetailItem[] = dealsTable.value.rows
    .map((r: any) => ({
      id: r.id,
      title: r.productName,
      subtitle: dealSub(r),
      value: Math.round(cfg.value(r)),
      parts: cfg.parts?.(r),
    }))
    // Сделки с нулевым вкладом только зашумляют список.
    .filter((i) => i.value !== 0)
  return {
    ...cfg,
    items,
    total: items.reduce((s, i) => s + i.value, 0),
  }
})

/** Есть ли расшифровка для строки — кнопку показываем только тогда. */
const hasDetail = (key: string) => !!DETAILS[key]

// Кнопка PDF живёт в строке вкладок «Обзор | Отчёты» — она в родительской
// странице, поэтому отдаём наружу и действие, и признаки доступности.
defineExpose({ exportPdf, exportExcel, canExport, ready, exporting })
</script>

<template>
  <div class="rp">
    <!-- Период + итоги — одним блоком на фоне поверхности, чтобы панель
         не сливалась с фоном страницы. -->
    <v-card rounded="lg" elevation="0" border class="rp-head mb-6">
      <!-- Одна строка управления: слева статус сделок, справа период. -->
      <div class="rp-controls">
        <div v-if="statusTabs.length" class="rp-status">
          <button
            v-for="t in statusTabs"
            :key="t.key ?? 'all'"
            class="rp-status-btn"
            :class="{ 'rp-status-btn--active': dealStatus === t.key }"
            type="button"
            @click="dealStatus = t.key"
          >
            {{ t.label }}
            <span class="rp-status-count">{{ t.count }}</span>
          </button>
        </div>
        <div v-else />

        <div class="rp-period-ctl">
          <v-select
            :model-value="period.preset"
            :items="periodItems"
            density="compact"
            variant="outlined"
            hide-details
            class="rp-select"
            @update:model-value="pickPreset"
          />
          <v-menu v-model="customOpen" :close-on-content-click="false" location="bottom end">
            <template #activator="{ props: menuProps }">
              <button
                v-bind="menuProps"
                class="rp-custom-btn"
                :class="{ 'rp-custom-btn--active': period.preset === 'custom' }"
                type="button"
              >
                <v-icon icon="mdi-calendar-range" size="16" />
                Свой период
              </button>
            </template>
            <v-card min-width="280" class="pa-4">
              <div class="text-caption text-medium-emphasis mb-2">С какой даты</div>
              <input v-model="customFrom" type="date" class="rp-date" >
              <div class="text-caption text-medium-emphasis mt-3 mb-2">По какую</div>
              <input v-model="customTo" type="date" class="rp-date" >
              <v-btn color="primary" block class="mt-4" @click="applyCustom">Показать</v-btn>
            </v-card>
          </v-menu>
        </div>
      </div>

      <div class="rp-head-divider" />

      <div v-if="error" class="rp-error">
        <v-icon icon="mdi-alert-circle-outline" size="18" />
        {{ error }}
      </div>

      <div v-if="loading && !summary" class="d-flex justify-center py-8">
        <v-progress-circular indeterminate color="primary" size="32" />
      </div>

      <template v-else-if="summary">
      <!-- Итоги: строки сгруппированы в смысловые секции — сделки, деньги,
           доход. Так девять показателей подряд не сливаются в кашу. -->
      <div class="rp-sections">
        <section v-for="sec in sections" :key="sec.key" class="rp-sec">
          <h4 class="rp-sec-title">{{ sec.title }}</h4>
          <div
            v-for="c in sec.rows"
            :key="c.key"
            class="rp-row"
            :class="{ 'rp-row--accent': c.accent, 'rp-row--total': c.total }"
          >
            <div class="rp-row-left">
              <span class="rp-row-label">{{ c.label }}</span>
              <span class="rp-row-hint">{{ c.hint }}</span>
            </div>
            <div class="rp-row-right">
              <span
                v-if="showCompare && c.d.pct !== null"
                class="rp-delta"
                :class="c.d.up ? 'rp-delta--up' : 'rp-delta--down'"
              >
                <v-icon :icon="c.d.up ? 'mdi-arrow-up' : 'mdi-arrow-down'" size="11" />
                {{ Math.abs(c.d.pct) }}%
              </span>
              <span class="rp-row-value" :style="c.color ? { color: c.color } : {}">{{ c.value }}</span>
              <button
                v-if="hasDetail(c.key)"
                class="rp-more"
                type="button"
                title="Показать, из каких сделок складывается"
                @click="detailKey = c.key"
              >
                Подробнее
                <v-icon icon="mdi-chevron-right" size="14" />
              </button>
              <span v-else class="rp-more-gap" />
            </div>
          </div>
        </section>
      </div>
      <div v-if="showCompare" class="rp-compare">
        Сравнение с периодом {{ customLabel(summary.previousRange.from, summary.previousRange.to) }}
      </div>
      <div v-else class="rp-compare">
        Все сделки и платежи за всю историю
      </div>
      </template>
    </v-card>

    <template v-if="summary">
      <!-- Таблица сделок -->
      <ReportsDealsTable v-if="dealsTable" :data="dealsTable" :loading="loading" />
    </template>

    <!-- Расшифровка показателя: из каких сделок он складывается -->
    <MetricDetailDialog
      v-if="detailConfig"
      v-model="detailOpen"
      :title="detailConfig.title"
      :hint="detailConfig.hint"
      :total="detailConfig.total"
      :color="detailConfig.color"
      :items="detailConfig.items"
    />
  </div>
</template>

<style scoped>
/* Статус сделок — общий фильтр вкладки */
.rp-status {
  display: flex; flex-wrap: wrap; gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.rp-status-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 13px; border: none; border-radius: 8px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.rp-status-btn:hover { color: rgba(var(--v-theme-on-surface), 0.8); }
.rp-status-btn--active {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.07);
}
.rp-status-count {
  font-size: 11px; font-weight: 700;
  padding: 0 5px; border-radius: 20px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.rp-status-btn--active .rp-status-count {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

/* ── Общий блок: период + итоги ── */
.rp-head { padding: 18px 20px 20px; }
.rp-head-divider {
  height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  margin: 16px -20px 18px;
}

/* Строка управления: статусы слева, период справа */
.rp-controls {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 12px;
}
.rp-period-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rp-select { min-width: 172px; }
.rp-select :deep(.v-field) { border-radius: 9px; font-size: 13px; font-weight: 600; }
.rp-custom-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.rp-custom-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.25); }
.rp-custom-btn--active {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.32);
  color: #10b981;
}
.rp-date {
  width: 100%;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
}

/* ── Итоги: секции и строки ── */
.rp-sections { display: flex; flex-direction: column; }
.rp-sec + .rp-sec {
  margin-top: 22px;
  padding-top: 18px;
  /* Разделитель секций заметно плотнее внутристрочного: смысловые блоки
     должны читаться как отдельные, а не как продолжение списка. */
  border-top: 2px solid rgba(var(--v-theme-on-surface), 0.16);
}
.rp-sec-title {
  font-size: 11px; font-weight: 800;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: rgb(var(--v-theme-primary));
  margin: 0 0 8px 2px;
}
.rp-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding: 12px 10px;
}
/* Разделитель между строками ВНУТРИ секции — секции отделяет своя линия. */
.rp-row + .rp-row {
  box-shadow: inset 0 1px 0 rgba(var(--v-theme-on-surface), 0.06);
}
.rp-row--accent {
  background: rgba(16, 185, 129, 0.07);
  box-shadow: none;
}
.rp-row--accent + .rp-row { box-shadow: none; }
/* Подытог секции: отделён линией потолще и набран жирнее — глаз сразу
   находит «сколько всего», не складывая строки выше вручную. */
.rp-row--total {
  box-shadow: inset 0 2px 0 rgba(var(--v-theme-on-surface), 0.14);
  margin-top: 2px;
}
.rp-row--total .rp-row-label {
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.rp-row--total .rp-row-value {
  font-size: 21px;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.rp-row-left {
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0;
}
.rp-row-label {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.rp-row-hint {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.42);
  line-height: 1.35;
}
.rp-row-right {
  display: flex; align-items: center; gap: 10px;
  flex-shrink: 0;
}
.rp-more {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 5px 9px; border: none; border-radius: 8px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.38);
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.rp-row:hover .rp-more {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
.rp-more:hover {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.16);
}
/* Держим место, чтобы строки без расшифровки не «прыгали» по ширине. */
.rp-more-gap { display: inline-block; width: 96px; }

.rp-row-value {
  font-size: 20px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.88);
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.rp-row--accent .rp-row-value { font-size: 23px; }
.rp-delta {
  display: inline-flex; align-items: center; gap: 2px;
  font-size: 11px; font-weight: 700;
  padding: 1px 6px; border-radius: 5px;
}
.rp-delta--up { color: #10b981; background: rgba(16, 185, 129, 0.12); }
.rp-delta--down { color: #ef4444; background: rgba(239, 68, 68, 0.12); }
.rp-compare {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin: 12px 2px 0;
}

/* Переключатель режима графика */
.rp-seg {
  display: inline-flex; gap: 2px; padding: 3px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.rp-seg-btn {
  padding: 6px 13px; border: none; border-radius: 8px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.rp-seg-btn:hover { color: rgba(var(--v-theme-on-surface), 0.8); }
.rp-seg-btn--active {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.07);
}

/* ── Блоки ── */
.rp-block-title {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.rp-block-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.rp-empty {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.rp-error {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; margin-bottom: 4px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  font-size: 13px; font-weight: 600;
}

@media (max-width: 600px) {
  .rp-head { padding: 14px 14px 16px; }
  .rp-head-divider { margin: 14px -14px 16px; }
  .rp-row { padding: 11px 8px; gap: 10px; }
  .rp-row-value { font-size: 17px; }
  .rp-row--accent .rp-row-value { font-size: 19px; }
  .rp-row-label { font-size: 13px; }
  .rp-row-hint { font-size: 11px; }
  .rp-controls { gap: 10px; }
  .rp-select { min-width: 150px; }
}
</style>