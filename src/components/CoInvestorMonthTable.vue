<script setup lang="ts">
/**
 * Инвесторы кассы по месяцам — таблица, как у партнёров в Excel.
 *
 * Строка — инвестор кассы: капитал, доля в капитале, процент, начислено за
 * месяц, остаток с прошлых месяцев, выплачено, реинвест и остаток к выплате.
 * Сверху строка партнёра (его часть прибыли месяца), снизу — итог.
 *
 * «Расчёт за месяц» — повышение процента (не ниже базового), выплата и
 * реинвест по каждому инвестору одной операцией. Что не выплачено и не
 * реинвестировано, остаётся долгом и само переходит в следующий месяц.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api/client'
import { toUserMessage } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { rangeForPreset } from '@/composables/useReports'
import { formatCurrency, maskedMoney, parseMasked, pluralizeRu, CURRENCY_MASK } from '@/utils/formatters'
import MonthYearPicker from '@/components/MonthYearPicker.vue'
import CoInvestorMonthChart, { type SeriesMonth } from '@/components/CoInvestorMonthChart.vue'
import SelectField from '@/components/SelectField.vue'
import SearchInput from '@/components/SearchInput.vue'
import InfoTip from '@/components/InfoTip.vue'
import { useMonthLocks } from '@/composables/useMonthLocks'
import type { PeriodRange } from '@/types/reports'
import type { InvestorPerson, PersonStake } from '@/types'

const props = defineProps<{ persons: InvestorPerson[]; isMobile?: boolean }>()
const emit = defineEmits<{
  (e: 'create'): void
  (e: 'edit', p: InvestorPerson): void
  (e: 'remove', p: InvestorPerson): void
  /** Что-то записали — списку инвесторов и KPI страницы пора обновиться. */
  (e: 'changed'): void
}>()

interface PctBucket { pct: number; amount: number }
interface MonthRow {
  id: string
  personId: string | null
  name: string
  phone: string | null
  archived: boolean
  mode: 'weight' | 'fixed' | 'costFee'
  basePct: number | null
  monthPct: number | null
  buckets: PctBucket[]
  capitalStart: number
  invested: number
  reinvestedCapital: number
  withdrawn: number
  /** Возврат авто-реинвеста выплатой (с даты выплаты). */
  reinvestReturned?: number
  capitalEnd: number
  capitalSharePct: number
  accruedDeals: number
  bonus: number
  /** Расходы месяца, затрагивающие инвесторов (схема v2) — минус, уже в «Начислено». */
  expenseShare?: number
  /** Начисления месяца изменились после повышения — сумма будет пересчитана. */
  bonusStale?: boolean
  earned: number
  paid: number
  reinvested: number
  /** Из них проведено автоматически (авто-реинвест в день расчёта). */
  reinvestedAuto?: number
  owedStart: number
  owedEnd: number
  owedNow: number
  /** Авто-реинвест долга месяца (схема v2) — выплата за месяц может его вернуть (с даты выплаты). */
  autoReinvestLeft?: number
  /** Сколько авто-реинвеста месяца уже вернули выплатами. */
  autoReinvestReturned?: number
  nextPayoutDate: string | null
}
interface MonthData {
  month: string
  currentMonth: string
  isFuture: boolean
  cashBox: { id: string; name: string; initialCapital: number }
  payoutDay: number | null
  nextPayoutDate: string | null
  partner: {
    capital: number
    participatesByCapital: boolean
    capitalSharePct: number
    gross: number
    investorsTotal: number
    earned: number
  }
  rows: MonthRow[]
  totals: Record<string, number>
  /** Расходы месяца, затронувшие инвесторов: сумма, прибыль месяца, доля. */
  expense?: { total: number; monthProfit: number; factor: number } | null
  /** Пересчёт долей кассы (схема v2): ждёт или идёт — цифры ещё поменяются. */
  recalc?: { pending: boolean; pendingFrom: string | null; running: boolean; startedAt: string | null; error: string | null }
  /** Схема деления: с какого месяца новая и относится ли к ней этот. */
  /** Закрытие месяца: состояние и что с ним можно сделать сейчас. */
  close?: {
    closed: { closedAt: string; closedByName: string | null; snapshot: CloseSnapshot | null } | null
    lastClosed: string | null
    canClose: boolean
    closeBlocked: string | null
    canReopen: boolean
  }
}
/** Итоги месяца на момент закрытия. */
interface CloseSnapshot {
  partner?: { earned?: number }
  rows?: Array<{ id: string; name: string; capitalEnd: number; earned: number; paid: number; reinvested: number; owedEnd: number }>
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const cashboxes = useCashBoxesStore()
const toast = useToast()
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

// ── Касса и месяц (в адресе — чтобы ссылка открывала тот же срез) ──
const boxOptions = computed(() =>
  cashboxes.items
    .filter((b) => !b.archivedAt)
    .map((b) => ({ value: b.id, label: b.name, color: b.color, hint: b.isDefault ? 'осн.' : undefined })),
)
function lsGet(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* приватный режим */ } }

const cashBoxId = ref<string | null>(null)
function pickInitialBox() {
  const wanted = (route.query.box as string) || lsGet('ci-month:box')
  const ok = (id: string | null) => !!id && boxOptions.value.some((o) => o.value === id)
  cashBoxId.value = ok(wanted) ? wanted : (cashboxes.getDefault()?.id ?? boxOptions.value[0]?.value ?? null)
}

function periodOfMonth(m: string | undefined): PeriodRange {
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mm] = m.split('-').map(Number)
    return rangeForPreset('month', new Date(y!, mm! - 1, 1))
  }
  return rangeForPreset('month')
}
const period = ref<PeriodRange>(periodOfMonth(route.query.month as string | undefined))
const month = computed(() => period.value.from.slice(0, 7))
/** «1 октября 2026» — начало выбранного месяца. */
const monthStartLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return `1 ${MONTHS_GEN[m! - 1]} ${y}`
})
const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return `${MONTHS_NOM[m! - 1]} ${y}`
})
const monthPrep = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return `в ${MONTHS_PREP[m! - 1]} ${y}`
})

// ── Данные ──
const data = ref<MonthData | null>(null)
const loading = ref(false)
let seq = 0
/** `quiet` — фоновое обновление (пока идёт пересчёт): без мигания и ошибок. */
async function load(quiet = false, opts: { nav?: boolean } = {}) {
  if (!cashBoxId.value) { data.value = null; return }
  const my = ++seq
  // Итоги «за всё время» (раскрытые строки) и месяцы кассы (график) от
  // выбранного месяца не зависят — параллельно с таблицей и только когда
  // могли измениться: другая касса или что-то записали. Листание месяцев и
  // опрос во время пересчёта их не трогают.
  const boxChanged = loadedFor !== cashBoxId.value
  if (boxChanged || (!opts.nav && !quiet)) {
    loadedFor = cashBoxId.value
    void loadSummary()
    void loadSeries()
  }
  if (!quiet) loading.value = true
  try {
    const q = new URLSearchParams({ cashBoxId: cashBoxId.value, month: month.value, tz: TZ })
    const res = await api.get<MonthData>(`/co-investors/month?${q}`)
    if (my === seq) data.value = res
  } catch (e: any) {
    if (my === seq && !quiet) toast.error(e, 'Не удалось загрузить таблицу')
  } finally {
    if (my === seq) loading.value = false
  }
}

/**
 * Идёт загрузка другого месяца (или кассы): вместо прежних цифр — скелетон,
 * как в «Годовом обзоре», иначе прежние числа выглядели как ответ на новый
 * месяц. Тихие обновления (после операций, во время пересчёта) его не
 * показывают.
 */
const switching = computed(() =>
  loading.value && (!data.value || data.value.month !== month.value || data.value.cashBox.id !== cashBoxId.value))
/** Сколько строк-заглушек показать: как было строк, но в разумных пределах. */
const skeletonRows = computed(() => Math.min(10, Math.max(4, data.value?.rows.length ?? 6)))
const TABLE_COLS = 11

// ── Итоги инвесторов кассы за всё время (раскрытая строка) ──
interface BoxSummaryRow {
  id: string
  since: string
  /** Внесено + из прибыли (реинвест) − выведено = в работе. */
  capital: { deposited: number; fromProfit: number; withdrawn: number; current: number; payable: number }
  /** Заработано = выплачено + в капитал (реинвест) + долг. */
  profit: { earned: number; paid: number; toCapital: number; owed: number }
  /** По факту: прибыль, полученная по сделкам инвестора, и её раздел. null — сотруднику не положено. */
  split: {
    deals: number; activeDeals: number
    received: number; investor: number; others: number; partner: number
    expected: number
  } | null
}
let loadedFor: string | null = null
const summary = ref<Map<string, BoxSummaryRow> | null>(null)
const summaryFailed = ref(false)
let summarySeq = 0
async function loadSummary() {
  const box = cashBoxId.value
  if (!box) { summary.value = null; return }
  const my = ++summarySeq
  try {
    const res = await api.get<{ rows: BoxSummaryRow[] }>(`/co-investors/month/summary?${new URLSearchParams({ cashBoxId: box })}`)
    if (my === summarySeq) { summary.value = new Map(res.rows.map((x) => [x.id, x])); summaryFailed.value = false }
  } catch {
    if (my === summarySeq) summaryFailed.value = true
  }
}
watch(cashBoxId, () => { summary.value = null; summaryFailed.value = false; series.value = []; loadedFor = null })

// ── Месяцы кассы — график над таблицей ──
const series = ref<SeriesMonth[]>([])
const seriesLoading = ref(false)
let seriesSeq = 0
async function loadSeries() {
  const box = cashBoxId.value
  if (!box) { series.value = []; return }
  const my = ++seriesSeq
  seriesLoading.value = true
  try {
    const res = await api.get<{ months: SeriesMonth[] }>(`/co-investors/month/series?${new URLSearchParams({ cashBoxId: box, tz: TZ })}`)
    if (my === seriesSeq) series.value = res.months
  } catch {
    // График — подсказка к таблице: без него страница работает как прежде.
  } finally {
    if (my === seriesSeq) seriesLoading.value = false
  }
}
function selectMonth(m: string) {
  const [y, mm] = m.split('-').map(Number)
  period.value = rangeForPreset('month', new Date(y!, mm! - 1, 1))
}

// ── Пересчёт долей (схема v2): пока ждёт или идёт — раз в 5 с спрашиваем
// только его состояние (один короткий запрос), а таблицу перечитываем один
// раз, когда пересчёт закончился. Раньше раз в 5 с перечитывалась вся
// таблица — тяжёлый запрос ровно тогда, когда база занята пересчётом.
const recalcBusy = computed(() => !!(data.value?.recalc?.pending || data.value?.recalc?.running))
let recalcTimer: ReturnType<typeof setInterval> | null = null
let recalcPolling = false
async function pollRecalc() {
  const box = data.value?.cashBox.id
  if (!box || recalcPolling) return
  recalcPolling = true
  try {
    const st = await api.getSilent<{ pending: boolean; running: boolean }>(
      `/co-investors/month/recalc-state?${new URLSearchParams({ cashBoxId: box })}`,
    )
    if (st && !st.pending && !st.running) await load(true)
  } finally {
    recalcPolling = false
  }
}
watch(recalcBusy, (busy, was) => {
  if (busy && !recalcTimer) recalcTimer = setInterval(() => void pollRecalc(), 5000)
  if (!busy && recalcTimer) {
    clearInterval(recalcTimer)
    recalcTimer = null
    if (was) {
      emit('changed')
      void loadSummary()
      void loadSeries()
    }
  }
})
onBeforeUnmount(() => { if (recalcTimer) clearInterval(recalcTimer) })

const recalcRequesting = ref(false)
async function requestRecalc() {
  if (!data.value || recalcRequesting.value) return
  recalcRequesting.value = true
  try {
    await api.post('/co-investors/month/recalc', { cashBoxId: data.value.cashBox.id, month: month.value })
    toast.success('Доли пересчитываются — таблица обновится сама')
    await load(true)
  } catch (e: any) {
    toast.error(e, 'Не удалось запустить пересчёт')
  } finally {
    recalcRequesting.value = false
  }
}

/** Соседний месяц — стрелками в шапке. */
function shiftMonthBy(delta: number) {
  const [y, m] = month.value.split('-').map(Number)
  period.value = rangeForPreset('month', new Date(y!, m! - 1 + delta, 1))
}

// ── Поиск: имя, телефон, режим, состояние — всё, что видно в строке ──
const search = ref('')
function rowText(r: MonthRow): string {
  const person = props.persons.find((p) => p.id === r.personId)
  return [
    r.name, r.phone ?? '', (r.phone ?? '').replace(/\D/g, ''), person?.phone ?? '',
    modeLabel(r), r.archived ? 'исключён' : '', r.basePct != null ? `${r.basePct}%` : '',
  ].join(' ').toLowerCase()
}
const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  const digits = q.replace(/\D/g, '')
  return rows.value.filter((r) => {
    const t = rowText(r)
    return t.includes(q) || (digits.length >= 3 && t.includes(digits))
  })
})

// ── Раскрытие строки: условия и распределение прибыли ──
// Всё берётся из уже загруженного списка инвесторов — раскрытие мгновенное,
// без запроса к серверу.
const expanded = ref(new Set<string>())
function toggleRow(r: MonthRow) {
  const next = new Set(expanded.value)
  if (next.has(r.id)) next.delete(r.id)
  else next.add(r.id)
  expanded.value = next
}
watch([cashBoxId, month], () => { expanded.value = new Set() })
/** Участие инвестора в этой кассе (из списка инвесторов страницы). */
function stakeOf(r: MonthRow): PersonStake | null {
  return personOf(r)?.stakes.find((st) => st.id === r.id) ?? null
}
/** Принцип деления — заголовок и пояснение одной фразой. */
function conditionsOf(r: MonthRow): { icon: string; title: string; text: string } {
  const st = stakeOf(r)
  if (r.mode === 'costFee') {
    const rate = st?.costFeeDefaultRatePct
    return {
      icon: 'mdi-tag-outline',
      title: 'Комиссия от закупки',
      text: rate != null
        ? `Вам — ${pct(rate)} от закупки по каждой сделке, инвестору — вся остальная прибыль сделки.`
        : 'Ставку от закупки задаёте на каждой сделке; инвестору — вся остальная прибыль сделки.',
    }
  }
  if (r.mode === 'fixed') {
    return {
      icon: 'mdi-percent-outline',
      title: `Фиксированный процент — ${pct(r.basePct)}`,
      text: `Инвестор получает ${pct(r.basePct)} от прибыли каждой своей сделки, остальное — вам.`,
    }
  }
  const fee = st?.managementFeePct ?? 0
  return {
    icon: 'mdi-scale-balance',
    title: fee > 0 ? `По вкладу · ваша комиссия ${pct(fee)}` : 'По вкладу',
    text: `Прибыль каждой оплаты делится по капиталу: доля инвестора — его капитал к капиталу в работе кассы на день оплаты.${
      fee > 0 ? ` С его доли вы забираете ${pct(fee)}.` : ''}`,
  }
}
// Таблица шире экрана телефона и листается вбок — раскрытие держим в ширину
// видимой части таблицы (оно прилипает к её левому краю).
const scrollEl = ref<HTMLElement | null>(null)
const scrollWidth = ref(0)
let scrollObserver: ResizeObserver | null = null
watch(scrollEl, (el) => {
  scrollObserver?.disconnect()
  if (!el || typeof ResizeObserver === 'undefined') return
  scrollObserver = new ResizeObserver(() => { scrollWidth.value = el.clientWidth })
  scrollObserver.observe(el)
})
onBeforeUnmount(() => scrollObserver?.disconnect())
const expStyle = computed(() => (scrollWidth.value ? { width: `${scrollWidth.value}px` } : undefined))

function sumOf(r: MonthRow): BoxSummaryRow | null {
  return summary.value?.get(r.id) ?? null
}
/**
 * Раздел уже полученной прибыли по сделкам инвестора: ему, другим инвесторам
 * этих сделок и партнёру — доли от полученного (в сумме 100 %).
 */
function splitOf(r: MonthRow) {
  const x = sumOf(r)?.split
  if (!x) return null
  const of = (v: number) => (x.received > 0 ? (v / x.received) * 100 : 0)
  return { ...x, invPct: of(x.investor), othersPct: of(x.others), mePct: of(x.partner) }
}
/** Доля в процентах: мелкие — с десятой, чтобы 0,3 % не превращались в 0. */
function share(v: number) {
  if (v <= 0) return '0%'
  if (v < 10) return `${v.toFixed(1).replace('.', ',').replace(/,0$/, '')}%`
  return `${Math.round(v)}%`
}
function fullDate(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`
}
watch([cashBoxId, month], () => {
  if (cashBoxId.value) lsSet('ci-month:box', cashBoxId.value)
  router.replace({ query: { ...route.query, box: cashBoxId.value ?? undefined, month: month.value } })
  load(false, { nav: true })
})
onMounted(async () => {
  if (!cashboxes.items.length) await cashboxes.fetchAll()
  // Выбор кассы сам запускает загрузку (наблюдатель за кассой и месяцем):
  // второй вызов здесь удваивал тяжёлые запросы при каждом открытии страницы.
  pickInitialBox()
})
defineExpose({ reload: load })

// ── Вид ──
const rows = computed(() => data.value?.rows ?? [])
const activeRows = computed(() => rows.value.filter((r) => !r.archived))
const toPayEnd = computed(() => rows.value.reduce((s, r) => s + Math.max(r.owedEnd, 0), 0))
const overpaidEnd = computed(() => rows.value.reduce((s, r) => s + Math.max(-r.owedEnd, 0), 0))
// Переплата одного инвестора не гасит долг другому — итог только по долгам.
const toPayStart = computed(() => rows.value.reduce((s, r) => s + Math.max(r.owedStart, 0), 0))
const capitalTotal = computed(() =>
  (data.value?.totals.capitalEnd ?? 0) +
  (data.value?.partner.participatesByCapital ? data.value.partner.capital : 0))

function pct(v: number | null | undefined) {
  if (v == null) return '—'
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/\.?0+$/, '')}%`
}
function modeLabel(r: MonthRow) {
  if (r.mode === 'costFee') return 'От закупки'
  if (r.mode === 'fixed') return 'Фикс'
  return 'По вкладу'
}
function money(v: number) { return v ? formatCurrency(v) : '—' }
function dayMonth(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`
}

// ── Закрытие месяца ──
// После «Расчёта за месяц» месяц закрывают: его оплаты, выплаты и удаление
// сделок становятся недоступны, пока владелец его не откроет. Закрывают по
// порядку; открыть можно только последний закрытый.
const monthLocks = useMonthLocks()
const closeInfo = computed(() => data.value?.close ?? null)
const isClosed = computed(() => !!closeInfo.value?.closed)
/** Закрыть этот месяц можно и есть право. */
const canCloseHere = computed(() => auth.can('coinvestors.closeMonth') && !!closeInfo.value?.canClose)
const closeDialog = ref<'close' | 'reopen' | null>(null)
const closingBusy = ref(false)

async function confirmCloseAction() {
  if (!data.value || !closeDialog.value || closingBusy.value) return
  const action = closeDialog.value
  closingBusy.value = true
  try {
    data.value = await api.post<MonthData>(`/co-investors/month/${action === 'close' ? 'close' : 'reopen'}`, {
      cashBoxId: data.value.cashBox.id,
      month: month.value,
      tz: TZ,
    })
    closeDialog.value = null
    void monthLocks.refresh()
    toast.success(action === 'close' ? `${monthLabel.value} закрыт` : `${monthLabel.value} открыт`)
    emit('changed')
  } catch (e: any) {
    toast.error(e, 'Не получилось')
  } finally {
    closingBusy.value = false
  }
}

function closedWhen(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Что изменилось после закрытия: сравниваем итоги на момент закрытия с
 * нынешними. Деньги закрытого месяца менять нельзя, но правка цены сделки и
 * условий инвестора разрешена — и она пересчитывает прошлые месяцы.
 */
const snapshotDiff = computed(() => {
  const snap = closeInfo.value?.closed?.snapshot
  // Только владельцу: сотрудник с доступом к части сделок видит доход партнёра
  // по своим сделкам, и сравнение с полным снимком показало бы ложные изменения.
  if (!auth.isOwner || !snap?.rows || !data.value) return []
  const now = new Map(data.value.rows.map((r) => [r.id, r]))
  const out: Array<{ name: string; label: string; was: number; now: number }> = []
  const fields: Array<[keyof NonNullable<CloseSnapshot['rows']>[number], string]> = [
    ['earned', 'начислено'], ['paid', 'выплачено'], ['reinvested', 'реинвест'], ['owedEnd', 'долг на конец'],
  ]
  for (const was of snap.rows) {
    const cur = now.get(was.id)
    for (const [k, label] of fields) {
      const a = Number(was[k] ?? 0)
      const b = Number((cur as any)?.[k] ?? 0)
      if (Math.round(a) !== Math.round(b)) out.push({ name: was.name, label, was: a, now: b })
    }
  }
  const pWas = snap.partner?.earned
  if (pWas != null && Math.round(pWas) !== Math.round(data.value.partner.earned)) {
    out.push({ name: 'Вам', label: 'доход', was: pWas, now: data.value.partner.earned })
  }
  return out
})
function personOf(r: MonthRow) { return props.persons.find((p) => p.id === r.personId) ?? null }
function openRow(r: MonthRow) { if (r.personId) router.push(`/co-investors/person/${r.personId}`) }

// ── Настройки (шестерёнка): день расчёта, пересчёт долей ──
const gearOpen = ref(false)
const savingDay = ref(false)
async function setPayoutDay(day: number | null) {
  if (!cashBoxId.value) return
  savingDay.value = true
  try {
    await api.put('/co-investors/month/payout-day', { cashBoxId: cashBoxId.value, day, tz: TZ })
    toast.success(day ? `День расчёта — ${day} число` : 'День расчёта снят')
    await load()
  } catch (e: any) {
    toast.error(e, 'Не удалось сохранить')
  } finally {
    savingDay.value = false
  }
}

// ── Расчёт за месяц ──
/** Доплата до повышенного процента — зеркало bonusFor на сервере. */
function bonusFor(buckets: PctBucket[], target: number): number {
  let sum = 0
  for (const b of buckets) {
    if (b.pct > 0 && b.pct < target && b.amount > 0) sum += (b.amount * (target - b.pct)) / b.pct
  }
  return Math.round(sum)
}

interface SettleLine {
  row: MonthRow
  pct: number | null
  pay: number
  reinvest: number
}
const settleOpen = ref(false)
const settling = ref(false)
const lines = ref<SettleLine[]>([])
const allPct = ref<number | null>(null)
/** Закрыть месяц сразу после расчёта. */
const closeAfter = ref(false)
let idemKey = ''
const canReinvest = computed(() => auth.can('coinvestors.capital'))
// Повышение процента — правка условий инвестора: право «Редактировать».
const canRaise = computed(() => auth.can('coinvestors.edit'))

function lineBonus(l: SettleLine) {
  const base = l.row.basePct
  if (base == null || l.pct == null || l.pct <= base) return 0
  return bonusFor(l.row.buckets, l.pct)
}
/** Сколько можно распределить: остаток сейчас с учётом нового повышения. */
function lineAvailable(l: SettleLine) {
  return Math.max(l.row.owedNow - l.row.bonus + lineBonus(l), 0)
}
function lineLeft(l: SettleLine) { return lineAvailable(l) - l.pay - l.reinvest }
/**
 * Выплата сверх долга возвращает авто-реинвест этого месяца (схема v2): долг
 * 1-го числа ушёл в капитал, но его можно выплатить — с даты расчёта эта сумма
 * уходит из капитала, прибыль, заработанная до этого дня, остаётся инвестору.
 * Реинвестировать повторно то же самое нельзя.
 */
function lineReturn(l: SettleLine) {
  // Вместе с реинвестом возврат не проводится (сервер ответит 400) — тогда это перебор.
  if (l.reinvest > 0) return 0
  return Math.min(Math.max(0, -lineLeft(l)), l.row.autoReinvestLeft ?? 0, l.pay)
}
function lineOver(l: SettleLine) { return lineLeft(l) + lineReturn(l) < 0 }
function linePctBad(l: SettleLine) {
  const base = l.row.basePct
  return base != null && l.pct != null && (l.pct < base || l.pct > 100)
}

function openSettle() {
  lines.value = activeRows.value
    .filter((r) => r.owedNow > 0 || r.buckets.length > 0 || r.bonus > 0 || (r.autoReinvestLeft ?? 0) > 0)
    .map((r) => ({ row: r, pct: r.monthPct, pay: 0, reinvest: 0 }))
  for (const l of lines.value) l.pay = lineAvailable(l)
  // Процент «всем по вкладу» — сразу текущий: самый частый у них в этом месяце.
  const counts = new Map<number, number>()
  for (const l of lines.value) if (l.row.mode === 'weight' && l.pct != null) counts.set(l.pct, (counts.get(l.pct) ?? 0) + 1)
  allPct.value = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  closeAfter.value = false
  idemKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  settleOpen.value = true
}
/**
 * «Всем» — только инвесторам «по вкладу»: у них процент — их часть своей
 * доли (40 из 60/40). Фиксированный процент — доля всей прибыли сделки, и
 * поднять 25% до тех же 44% значило бы почти удвоить ему доход.
 */
const hasWeightLines = computed(() => lines.value.some((l) => l.row.mode === 'weight'))
/** Наименьший базовый процент среди инвесторов «по вкладу» — ниже общее поле не опускается. */
const minWeightBase = computed(() => {
  const bases = lines.value.filter((l) => l.row.mode === 'weight' && l.row.basePct != null).map((l) => l.row.basePct!)
  return bases.length ? Math.min(...bases) : null
})
function fitAllPct() {
  const v = Number(allPct.value)
  if (allPct.value == null || (allPct.value as unknown) === '' || !Number.isFinite(v)) { allPct.value = minWeightBase.value; return }
  allPct.value = Math.min(100, Math.max(minWeightBase.value ?? 0, v))
}
/** «Применить» что-то изменит — иначе кнопка неактивна. */
const allPctChanges = computed(() => allPct.value != null && lines.value.some(
  (l) => l.row.mode === 'weight' && l.row.basePct != null &&
    Math.max(l.row.basePct, Math.min(100, allPct.value!)) !== l.pct,
))
function applyAllPct() {
  if (allPct.value == null) return
  for (const l of lines.value) {
    if (l.row.basePct == null || l.row.mode !== 'weight') continue
    l.pct = Math.max(l.row.basePct, Math.min(100, allPct.value))
    fitLine(l)
  }
}
/**
 * После смены процента: ниже базового инвестора (и выше 100) опустить нельзя —
 * значение возвращается к границе; сумма к распределению меняется — подгоняем
 * выплату.
 */
function fitLine(l: SettleLine) {
  const base = l.row.basePct
  if (base != null) {
    const v = Number(l.pct)
    l.pct = l.pct == null || (l.pct as unknown) === '' || !Number.isFinite(v) ? base : Math.min(100, Math.max(base, v))
  }
  const avail = lineAvailable(l)
  if (l.pay + l.reinvest > avail) {
    l.reinvest = Math.min(l.reinvest, avail)
    l.pay = Math.max(avail - l.reinvest, 0)
  } else if (l.reinvest === 0) {
    l.pay = avail
  }
}
function fillAll(kind: 'pay' | 'reinvest' | 'leave') {
  for (const l of lines.value) {
    const avail = lineAvailable(l)
    l.pay = kind === 'pay' ? avail : 0
    l.reinvest = kind === 'reinvest' ? avail : 0
  }
}
/** Какая из кнопок «Всем инвесторам» сейчас описывает ввод. */
const fillMode = computed(() => {
  if (!lines.value.length) return null
  if (lines.value.every((l) => l.pay === lineAvailable(l) && !l.reinvest)) return 'pay'
  if (lines.value.every((l) => l.reinvest === lineAvailable(l) && !l.pay)) return 'reinvest'
  if (lines.value.every((l) => !l.pay && !l.reinvest)) return 'leave'
  return null
})
const settleTotals = computed(() => lines.value.reduce((t, l) => {
  t.available += lineAvailable(l)
  t.bonus += lineBonus(l) - l.row.bonus
  t.pay += l.pay
  t.reinvest += l.reinvest
  t.left += Math.max(lineLeft(l), 0)
  return t
}, { available: 0, bonus: 0, pay: 0, reinvest: 0, left: 0 }))
const settleInvalid = computed(() => lines.value.some((l) => linePctBad(l) || lineOver(l)))

async function submitSettle() {
  if (!data.value || settleInvalid.value) return
  const items = lines.value
    .map((l) => ({
      coInvestorId: l.row.id,
      ...(l.row.basePct != null && l.pct !== l.row.monthPct ? { pct: l.pct } : {}),
      pay: Math.round(l.pay),
      reinvest: Math.round(l.reinvest),
    }))
    .filter((i) => 'pct' in i || i.pay > 0 || i.reinvest > 0)
  const close = closeAfter.value && !!closeInfo.value?.canClose
  if (!items.length && !close) {
    settleOpen.value = false
    toast.success('Всё остаётся долгом и перейдёт в следующий месяц')
    return
  }
  settling.value = true
  const body = { cashBoxId: data.value.cashBox.id, month: month.value, tz: TZ }
  let settled = false
  try {
    if (items.length) {
      data.value = await api.post<MonthData>('/co-investors/month/settle', { ...body, idemKey, items })
      settled = true
    }
    if (close) {
      data.value = await api.post<MonthData>('/co-investors/month/close', body)
      void monthLocks.refresh()
    }
    settleOpen.value = false
    toast.success(
      settled && close ? `Расчёт проведён, ${monthLabel.value.toLowerCase()} закрыт`
        : close ? `${monthLabel.value} закрыт`
          : `Расчёт за ${monthLabel.value.toLowerCase()} проведён`,
    )
    emit('changed')
  } catch (e: any) {
    if (settled) {
      // Расчёт прошёл, не закрылся только месяц — окно больше не нужно.
      settleOpen.value = false
      toast.error(`Расчёт проведён, но месяц не закрыт: ${toUserMessage(e, 'ошибка').replace(/\.$/, '')}`)
      emit('changed')
    } else {
      toast.error(e, 'Не удалось провести расчёт')
    }
    // Часть могла пройти (или прошла в прошлый раз) — показываем то, что в базе.
    load()
  } finally {
    settling.value = false
  }
}
</script>

<template>
  <v-card rounded="lg" elevation="0" border class="cim">
    <!-- Шапка месяца: какой месяц крупно, касса, состояние и действия -->
    <div class="cim-hero">
      <div class="cim-hero-top">
        <div class="cim-hero-month">
          <button type="button" class="cim-arrow" title="Предыдущий месяц" @click="shiftMonthBy(-1)">
            <v-icon icon="mdi-chevron-left" size="22" />
          </button>
          <div class="cim-hero-title">{{ monthLabel }}</div>
          <button type="button" class="cim-arrow" title="Следующий месяц" @click="shiftMonthBy(1)">
            <v-icon icon="mdi-chevron-right" size="22" />
          </button>
          <MonthYearPicker v-model="period" month-only icon-only />
        </div>
        <!-- Справа: касса и настройки -->
        <div class="cim-box-row">
          <div class="cim-box">
            <SelectField v-model="cashBoxId" :options="boxOptions" placeholder="Касса" />
          </div>
          <v-menu v-model="gearOpen" :close-on-content-click="false" location="bottom end" offset="6">
            <template #activator="{ props: mp }">
              <button v-bind="mp" type="button" class="cim-gear" title="Настройки кассы и инвесторов">
                <v-icon icon="mdi-cog-outline" size="19" />
              </button>
            </template>
            <v-card rounded="xl" elevation="6" class="cim-set">
              <!-- День расчёта с инвесторами -->
              <div v-if="auth.can('coinvestors.edit') && data" class="cim-set-sec">
                <div class="cim-set-head">
                  <span class="cim-set-title">День расчёта</span>
                  <InfoTip>
                    Какого числа вы рассчитываетесь с инвесторами. Например, 10 — расчёт за сентябрь проводите
                    10 октября. Эта дата станет датой следующей выплаты у всех инвесторов кассы.
                  </InfoTip>
                </div>
                <div class="cim-set-select">
                  <select
                    :value="data.payoutDay ?? ''"
                    :disabled="savingDay"
                    @change="setPayoutDay(($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null)"
                  >
                    <option value="">Не задан</option>
                    <option v-for="d in 28" :key="d" :value="d">{{ d }} числа каждого месяца</option>
                  </select>
                  <v-progress-circular v-if="savingDay" indeterminate size="16" width="2" class="cim-set-spin" />
                  <v-icon v-else icon="mdi-chevron-down" size="18" class="cim-set-caret" />
                </div>
              </div>

              <!-- Настройки страницы (для новых инвесторов) -->
              <slot name="settings" />

              <div class="cim-set-sec cim-set-sec--actions">
                <button
                  v-if="auth.can('coinvestors.edit') && data && !isClosed && !data.isFuture"
                  type="button"
                  class="cim-set-item"
                  :disabled="recalcRequesting || recalcBusy"
                  @click="requestRecalc(); gearOpen = false"
                >
                  <v-icon icon="mdi-refresh" size="18" />
                  <span>Пересчитать доли с {{ monthStartLabel }}</span>
                  <InfoTip>
                    Заново разделит прибыль между инвесторами с начала этого месяца по текущему капиталу и условиям.
                    Нужно, если доли выглядят неверно — например, после правок задним числом. Закрытые месяцы не меняются.
                  </InfoTip>
                </button>
                <slot name="settings-actions" :close="() => (gearOpen = false)" />
              </div>
            </v-card>
          </v-menu>
        </div>
      </div>

      <!-- Состояние месяца — то, что меняет смысл цифр в таблице -->
      <div v-if="data" class="cim-chips">
        <span v-if="isClosed" class="cim-chip-st cim-chip-st--closed">
          <v-icon icon="mdi-lock-outline" size="14" />
          Закрыт<template v-if="closeInfo?.closed"> {{ closedWhen(closeInfo.closed.closedAt) }}</template>
        </span>
        <span v-if="recalcBusy" class="cim-chip-st cim-chip-st--recalc">
          <v-progress-circular indeterminate size="12" width="2" />
          Доли пересчитываются — цифры обновятся сами
        </span>
        <span v-else-if="data.recalc?.error" class="cim-chip-st cim-chip-st--err" :title="data.recalc.error">
          <v-icon icon="mdi-alert-outline" size="14" />
          Пересчёт не удался — нажмите «Пересчитать доли»
        </span>
        <span v-if="data.isFuture" class="cim-chip-st">
          <v-icon icon="mdi-calendar-clock" size="14" />
          Месяц ещё не наступил
        </span>
      </div>

      <!-- Месяцы кассы: весь путь кассы столбиками, нажатие — открыть месяц -->
      <CoInvestorMonthChart
        v-if="cashBoxId && (series.length || seriesLoading)"
        :months="series"
        :selected="month"
        :loading="seriesLoading"
        @select="selectMonth"
      />

      <div class="cim-toolbar">
        <div class="cim-search">
          <SearchInput v-model="search" placeholder="Поиск: имя, телефон, режим…" />
        </div>
        <v-spacer />
      <button
        v-if="auth.can('coinvestors.dividends')"
        type="button"
        class="cim-btn cim-btn--primary"
        :disabled="!data || data.isFuture || isClosed || recalcBusy || (!activeRows.length && !canCloseHere)"
        :title="isClosed ? 'Месяц закрыт — сначала откройте его' : recalcBusy ? 'Доли пересчитываются — подождите минуту' : 'Выплаты, реинвест, повышение процента и закрытие месяца'"
        @click="openSettle"
      >
        <v-icon icon="mdi-calculator-variant-outline" size="18" />
        <span>Расчёт за месяц</span>
      </button>
      <!-- Закрыть месяц без права на выплаты — отдельной кнопкой (иначе — в окне расчёта) -->
      <button
        v-if="!auth.can('coinvestors.dividends') && !isClosed && auth.can('coinvestors.closeMonth') && data && !data.isFuture && closeInfo"
        type="button"
        class="cim-btn"
        :disabled="!closeInfo.canClose"
        :title="closeInfo.closeBlocked || 'Зафиксировать месяц: его оплаты и выплаты станут недоступны'"
        @click="closeDialog = 'close'"
      >
        <v-icon icon="mdi-lock-outline" size="18" />
        <span>Закрыть месяц</span>
      </button>
      <button v-if="auth.can('coinvestors.create')" type="button" class="cim-btn" @click="emit('create')">
        <v-icon icon="mdi-plus" size="18" />
        <span class="d-none d-sm-inline">Добавить инвестора</span>
      </button>
      </div>
    </div>

    <div v-if="!cashBoxId" class="cim-empty">Нет касс — создайте кассу, чтобы вести инвесторов.</div>

    <template v-else-if="data">
      <!-- Итоги месяца — отдельными карточками, чтобы не терялись -->
      <div class="cim-kpis" :class="{ 'cim-kpis--sk': switching }">
        <div class="cim-kpi">
          <div class="cim-kpi-icon" style="--c: #0f766e"><v-icon icon="mdi-cash-multiple" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Прибыль кассы {{ monthPrep }}</div>
            <div class="cim-kpi-val">{{ formatCurrency(data.partner.gross) }}</div>
          </div>
        </div>
        <div class="cim-kpi">
          <div class="cim-kpi-icon" style="--c: #4f46e5"><v-icon icon="mdi-account-group-outline" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Инвесторам</div>
            <div class="cim-kpi-val cim-c-inv">{{ formatCurrency(data.partner.investorsTotal) }}</div>
          </div>
        </div>
        <div v-if="data.expense" class="cim-kpi" :title="`Прибыль месяца ${formatCurrency(data.expense.monthProfit)} уменьшена на расходы до деления`">
          <div class="cim-kpi-icon" style="--c: #dc2626"><v-icon icon="mdi-receipt-text-minus-outline" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Расходы, затронувшие инвесторов</div>
            <div class="cim-kpi-val cim-c-out">−{{ formatCurrency(data.expense.total) }}</div>
            <div class="cim-kpi-note">инвесторам {{ formatCurrency(data.totals.expenseShare ?? 0) }}</div>
          </div>
        </div>
        <div class="cim-kpi">
          <div class="cim-kpi-icon" style="--c: #047857"><v-icon icon="mdi-account-tie" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Вам</div>
            <div class="cim-kpi-val cim-c-me">{{ formatCurrency(data.partner.earned) }}</div>
          </div>
        </div>
        <div class="cim-kpi">
          <div class="cim-kpi-icon" style="--c: #d97706"><v-icon icon="mdi-cash-clock" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Долг на конец месяца</div>
            <div class="cim-kpi-val cim-c-owed">{{ formatCurrency(toPayEnd) }}</div>
            <div v-if="overpaidEnd" class="cim-kpi-note">ещё переплачено {{ formatCurrency(overpaidEnd) }}</div>
          </div>
        </div>
        <div v-if="data.nextPayoutDate" class="cim-kpi">
          <div class="cim-kpi-icon" style="--c: #7c3aed"><v-icon icon="mdi-calendar-check-outline" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Следующий расчёт</div>
            <div class="cim-kpi-val">{{ dayMonth(data.nextPayoutDate) }}</div>
          </div>
        </div>
      </div>

      <div v-if="data.isFuture" class="cim-note">
        <v-icon icon="mdi-information-outline" size="16" />
        Месяц ещё не наступил — показаны только записи, уже сделанные на эти даты.
      </div>

      <div v-if="closeInfo?.closed" class="cim-closed">
        <div class="cim-closed-main">
          <v-icon icon="mdi-lock-outline" size="18" />
          <div>
            <div class="cim-closed-title">
              {{ monthLabel }} закрыт {{ closedWhen(closeInfo.closed.closedAt) }}<template v-if="closeInfo.closed.closedByName"> · {{ closeInfo.closed.closedByName }}</template>
            </div>
            <div class="cim-closed-sub">Оплаты, выплаты инвесторам и удаление сделок этого месяца недоступны.</div>
          </div>
          <button
            v-if="auth.isOwner && closeInfo.canReopen"
            type="button"
            class="cim-btn cim-btn--sm"
            @click="closeDialog = 'reopen'"
          >Открыть месяц</button>
        </div>
        <div v-if="snapshotDiff.length" class="cim-closed-diff">
          <div class="cim-closed-diff-title">
            <v-icon icon="mdi-alert-outline" size="15" />
            После закрытия цифры изменились — скорее всего, поменяли цену сделки или условия инвестора:
          </div>
          <div v-for="(d, i) in snapshotDiff" :key="i" class="cim-closed-diff-row">
            {{ d.name }}, {{ d.label }}: было {{ formatCurrency(d.was) }}, стало {{ formatCurrency(d.now) }}
          </div>
        </div>
      </div>

      <div ref="scrollEl" class="cim-scroll" :class="{ 'cim-scroll--loading': loading && !switching }">
        <table class="cim-table">
          <thead>
            <tr>
              <th class="cim-n">№</th>
              <th class="cim-name">Инвестор</th>
              <th class="cim-num">Капитал</th>
              <th class="cim-num">Доля в капитале</th>
              <th class="cim-num">Процент</th>
              <th class="cim-num">Начислено</th>
              <th class="cim-num">
                <v-tooltip location="top" max-width="300">
                  <template #activator="{ props: tp }">
                    <span v-bind="tp" class="cim-th-help">Долг на начало<v-icon icon="mdi-help-circle-outline" size="13" /></span>
                  </template>
                  Сколько вы были должны инвестору к началу месяца: всё начисленное за прошлые месяцы минус всё выплаченное и реинвестированное за них.
                  Минус — переплата: инвестор получил больше, чем ему начислено.
                </v-tooltip>
              </th>
              <th class="cim-num">Выплачено</th>
              <th class="cim-num">Реинвест</th>
              <th class="cim-num">
                <v-tooltip location="top" max-width="300">
                  <template #activator="{ props: tp }">
                    <span v-bind="tp" class="cim-th-help">Долг на конец<v-icon icon="mdi-help-circle-outline" size="13" /></span>
                  </template>
                  Долг на начало + начислено за месяц − выплачено − реинвест. Эта сумма переходит в следующий месяц как его «долг на начало».
                  Минус — переплата, она уменьшит будущие выплаты.
                </v-tooltip>
              </th>
              <th class="cim-act" />
            </tr>
          </thead>
          <tbody v-if="switching">
            <tr v-for="i in skeletonRows" :key="`sk-${i}`" class="cim-sk-row">
              <td v-for="n in TABLE_COLS" :key="n" :class="n === 2 ? 'cim-name' : n === 1 ? 'cim-n' : 'cim-num'">
                <div class="cim-sk" :class="{ 'cim-sk--name': n === 2, 'cim-sk--n': n === 1 || n === TABLE_COLS }" />
              </td>
            </tr>
          </tbody>
          <tbody v-else>
            <!-- Партнёр -->
            <tr class="cim-partner">
              <td class="cim-n"><v-icon icon="mdi-account-tie" size="16" /></td>
              <td class="cim-name">
                <div class="cim-who">Вы</div>
                <div class="cim-sub">
                  {{ data.partner.participatesByCapital ? 'участвуете капиталом' : 'управляете, без капитала' }}
                </div>
              </td>
              <td class="cim-num">{{ data.partner.participatesByCapital ? money(data.partner.capital) : '—' }}</td>
              <td class="cim-num">{{ data.partner.capitalSharePct ? pct(data.partner.capitalSharePct) : '—' }}</td>
              <td class="cim-num cim-muted">остаток</td>
              <td class="cim-num cim-c-me cim-strong">{{ formatCurrency(data.partner.earned) }}</td>
              <td class="cim-num cim-muted">—</td>
              <td class="cim-num cim-muted">—</td>
              <td class="cim-num cim-muted">—</td>
              <td class="cim-num cim-muted">—</td>
              <td class="cim-act" />
            </tr>

            <tr v-if="!rows.length">
              <td colspan="11" class="cim-none">В этой кассе нет инвесторов</td>
            </tr>
            <tr v-else-if="!filteredRows.length">
              <td colspan="11" class="cim-none">Никто не подходит под «{{ search }}»</td>
            </tr>

            <template v-for="(r, i) in filteredRows" :key="r.id">
            <tr
              class="cim-row"
              :class="{ 'cim-row--archived': r.archived, 'cim-row--open': expanded.has(r.id) }"
              @click="toggleRow(r)"
            >
              <td class="cim-n">
                <v-icon :icon="expanded.has(r.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="16" class="cim-caret" />
                {{ i + 1 }}
              </td>
              <td class="cim-name">
                <div class="cim-who">{{ r.name }}</div>
                <div class="cim-sub">
                  {{ modeLabel(r) }}<template v-if="r.archived"> · исключён</template>
                </div>
              </td>
              <td class="cim-num">
                <div>{{ money(r.capitalEnd) }}</div>
                <div v-if="r.invested" class="cim-sub cim-c-in">+{{ formatCurrency(r.invested) }} внёс</div>
                <div v-if="r.reinvestedCapital" class="cim-sub cim-c-in">+{{ formatCurrency(r.reinvestedCapital) }} реинвест</div>
                <div v-if="r.withdrawn" class="cim-sub cim-c-out">−{{ formatCurrency(r.withdrawn) }} снял</div>
                <div v-if="r.reinvestReturned" class="cim-sub cim-c-out">−{{ formatCurrency(r.reinvestReturned) }} возврат реинвеста</div>
              </td>
              <td class="cim-num">{{ r.mode === 'weight' && r.capitalSharePct ? pct(r.capitalSharePct) : '—' }}</td>
              <td class="cim-num">
                <template v-if="r.basePct == null">—</template>
                <template v-else-if="r.monthPct != null && r.monthPct > r.basePct">
                  <span class="cim-muted cim-strike">{{ pct(r.basePct) }}</span>
                  <span class="cim-raise">{{ pct(r.monthPct) }}</span>
                </template>
                <template v-else>{{ pct(r.basePct) }}</template>
              </td>
              <td class="cim-num">
                <div class="cim-c-inv">{{ money(r.earned) }}</div>
                <div v-if="r.bonus" class="cim-sub cim-raise">в т.ч. повышение {{ formatCurrency(r.bonus) }}</div>
                <div v-if="r.expenseShare" class="cim-sub cim-c-out" title="Расходы месяца, затрагивающие инвесторов: уменьшили прибыль до деления">
                  {{ formatCurrency(r.expenseShare) }} расходы
                </div>
                <div v-if="r.bonusStale" class="cim-sub cim-c-owed" title="Начисления месяца изменились после повышения. «Расчёт за месяц» пересчитает его по текущим начислениям.">
                  повышение пересчитается
                </div>
              </td>
              <td class="cim-num" :class="{ 'cim-c-out': r.owedStart < 0 }">{{ money(r.owedStart) }}</td>
              <td class="cim-num">{{ money(r.paid) }}</td>
              <td class="cim-num">
                {{ money(r.reinvested) }}
                <div v-if="r.reinvestedAuto" class="cim-sub" title="Проведено автоматически в день расчёта">
                  авто {{ formatCurrency(r.reinvestedAuto) }}
                </div>
              </td>
              <td class="cim-num cim-strong">
                <template v-if="r.owedEnd < 0">
                  <div class="cim-c-out">{{ formatCurrency(r.owedEnd) }}</div>
                  <div class="cim-sub" title="Инвестор получил больше, чем ему начислено. Переплата закроется будущими начислениями.">переплата</div>
                </template>
                <span v-else :class="{ 'cim-c-owed': r.owedEnd > 0 }">{{ money(r.owedEnd) }}</span>
              </td>
              <td class="cim-act" @click.stop>
                <button v-if="r.personId" type="button" class="cim-dots" title="Открыть карточку инвестора" @click="openRow(r)">
                  <v-icon icon="mdi-open-in-new" size="17" />
                </button>
                <v-menu location="bottom end" offset="4">
                  <template #activator="{ props: mp }">
                    <button v-bind="mp" type="button" class="cim-dots" title="Действия">
                      <v-icon icon="mdi-dots-vertical" size="18" />
                    </button>
                  </template>
                  <div class="cim-menu">
                    <button type="button" class="cim-menu-item" @click="openRow(r)">
                      <v-icon icon="mdi-open-in-new" size="18" /><span>Открыть карточку</span>
                    </button>
                    <button
                      v-if="personOf(r) && auth.can('coinvestors.edit')"
                      type="button"
                      class="cim-menu-item"
                      @click="emit('edit', personOf(r)!)"
                    >
                      <v-icon icon="mdi-pencil-outline" size="18" /><span>Редактировать</span>
                    </button>
                    <button
                      v-if="personOf(r) && auth.can('coinvestors.delete')"
                      type="button"
                      class="cim-menu-item cim-menu-item--danger"
                      @click="emit('remove', personOf(r)!)"
                    >
                      <v-icon icon="mdi-trash-can-outline" size="18" /><span>Удалить инвестора</span>
                    </button>
                  </div>
                </v-menu>
              </td>
            </tr>
            <tr v-if="expanded.has(r.id)" class="cim-detail-row">
              <td colspan="11">
                <div class="cim-exp" :style="expStyle" @click.stop>
                  <!-- Условия: по какому принципу делим прибыль -->
                  <div class="cim-xhead">
                    <div class="cim-cond-icon"><v-icon :icon="conditionsOf(r).icon" size="20" /></div>
                    <div class="cim-xhead-main">
                      <div class="cim-cond-title">{{ conditionsOf(r).title }}</div>
                      <div class="cim-cond-text">{{ conditionsOf(r).text }}</div>
                    </div>
                    <button v-if="r.personId" type="button" class="cim-exp-btn cim-xhead-btn" @click="openRow(r)">
                      Карточка инвестора
                      <v-icon icon="mdi-arrow-right" size="16" />
                    </button>
                  </div>
                  <div class="cim-cond-facts">
                    <span v-if="sumOf(r)?.since" class="cim-fact">
                      <v-icon icon="mdi-calendar-start" size="14" />
                      В кассе с {{ fullDate(sumOf(r)!.since) }}
                    </span>
                    <span v-if="r.mode === 'weight' && r.capitalSharePct" class="cim-fact">
                      <v-icon icon="mdi-chart-pie" size="14" />
                      Доля в капитале кассы {{ pct(r.capitalSharePct) }}
                    </span>
                    <span class="cim-fact" :class="{ 'cim-fact--on': stakeOf(r)?.autoReinvest }">
                      <v-icon icon="mdi-autorenew" size="14" />
                      Авто-реинвест {{ stakeOf(r)?.autoReinvest ? 'включён' : 'выключен' }}
                    </span>
                    <span v-if="stakeOf(r)?.allCashboxDeals" class="cim-fact">
                      <v-icon icon="mdi-briefcase-check-outline" size="14" />
                      Во всех сделках кассы
                    </span>
                    <span v-if="r.nextPayoutDate" class="cim-fact">
                      <v-icon icon="mdi-calendar-check-outline" size="14" />
                      Следующая выплата {{ dayMonth(r.nextPayoutDate) }}
                    </span>
                  </div>

                  <div v-if="!sumOf(r) && summaryFailed" class="cim-xempty">
                    Не удалось загрузить итоги инвестора.
                    <button type="button" class="cim-xlink" @click="loadSummary()">Повторить</button>
                  </div>
                  <template v-else>
                    <!-- За всё время: капитал и прибыль -->
                    <div class="cim-xgrid">
                      <div class="cim-xcard">
                        <div class="cim-xcard-title">Капитал <span>за всё время</span></div>
                        <template v-if="sumOf(r)">
                          <div class="cim-xline"><span>Внесено</span><b>{{ money(sumOf(r)!.capital.deposited) }}</b></div>
                          <div class="cim-xline"><span>Из прибыли (реинвест)</span><b :class="{ 'cim-c-in': sumOf(r)!.capital.fromProfit > 0 }">{{ sumOf(r)!.capital.fromProfit > 0 ? '+' : '' }}{{ money(sumOf(r)!.capital.fromProfit) }}</b></div>
                          <div class="cim-xline"><span>Выведено</span><b :class="{ 'cim-c-out': sumOf(r)!.capital.withdrawn > 0 }">{{ sumOf(r)!.capital.withdrawn > 0 ? '−' : '' }}{{ money(sumOf(r)!.capital.withdrawn) }}</b></div>
                          <div class="cim-xline cim-xline--total"><span>В работе сейчас</span><b>{{ formatCurrency(sumOf(r)!.capital.current) }}</b></div>
                          <div v-if="sumOf(r)!.capital.payable" class="cim-xline cim-xline--warn">
                            <span>Вывод к выдаче</span><b>{{ formatCurrency(sumOf(r)!.capital.payable) }}</b>
                          </div>
                        </template>
                        <div v-else class="cim-xskel"><i /><i /><i /><i /></div>
                      </div>
                      <div class="cim-xcard">
                        <div class="cim-xcard-title">Прибыль инвестора <span>за всё время</span></div>
                        <template v-if="sumOf(r)">
                          <div class="cim-xline"><span>Заработано</span><b class="cim-c-inv">{{ money(sumOf(r)!.profit.earned) }}</b></div>
                          <div class="cim-xline"><span>Выплачено</span><b>{{ money(sumOf(r)!.profit.paid) }}</b></div>
                          <div class="cim-xline"><span>Ушло в капитал (реинвест)</span><b>{{ money(sumOf(r)!.profit.toCapital) }}</b></div>
                          <div v-if="sumOf(r)!.profit.owed >= 0" class="cim-xline cim-xline--total">
                            <span>Долг перед инвестором</span><b :class="{ 'cim-c-owed': sumOf(r)!.profit.owed > 0 }">{{ formatCurrency(sumOf(r)!.profit.owed) }}</b>
                          </div>
                          <div v-else class="cim-xline cim-xline--total">
                            <span>Переплата</span><b class="cim-c-out">{{ formatCurrency(-sumOf(r)!.profit.owed) }}</b>
                          </div>
                        </template>
                        <div v-else class="cim-xskel"><i /><i /><i /><i /></div>
                      </div>
                    </div>

                    <!-- Раздел прибыли по сделкам инвестора — по факту -->
                    <div v-if="!sumOf(r) || splitOf(r)" class="cim-xcard">
                      <div class="cim-xdist-head">
                        <div>
                          <div class="cim-xcard-title cim-xcard-title--flat">Прибыль по сделкам инвестора</div>
                          <div v-if="splitOf(r)" class="cim-xdist-sub">
                            {{ splitOf(r)!.deals }} {{ pluralizeRu(splitOf(r)!.deals, 'сделка', 'сделки', 'сделок') }}<template v-if="splitOf(r)!.activeDeals"> · активных {{ splitOf(r)!.activeDeals }}</template>
                          </div>
                        </div>
                        <div v-if="splitOf(r) && splitOf(r)!.received > 0" class="cim-dist2-right">
                          <v-tooltip location="left" open-on-click max-width="320">
                            <template #activator="{ props: tp }">
                              <button type="button" v-bind="tp" class="cim-dist2-help" aria-label="Как это считается" @click.stop>
                                <v-icon icon="mdi-help-circle" size="15" />
                              </button>
                            </template>
                            <div style="font-size: 12.5px; line-height: 1.55;">
                              Прибыль, которая <b>уже пришла от клиентов</b> по сделкам, где участвует инвестор
                              (по активным — с оплаченных платежей), и как она разделилась:
                              ему, другим инвесторам этих сделок и вам. Числа — из журнала начислений.<br /><br />
                              Прибыль, которую клиенты ещё заплатят, указана ниже отдельно: как она разделится,
                              зависит от долей на день оплаты.
                            </div>
                          </v-tooltip>
                          <span class="cim-xdist-total-l">получено</span>
                          <span class="cim-dist2-total">{{ formatCurrency(splitOf(r)!.received) }}</span>
                        </div>
                      </div>
                      <template v-if="splitOf(r)">
                        <template v-if="splitOf(r)!.received > 0">
                          <div class="cim-xbar">
                            <span class="cim-xbar-inv" :style="{ width: splitOf(r)!.invPct + '%' }" />
                            <span class="cim-xbar-oth" :style="{ width: splitOf(r)!.othersPct + '%' }" />
                            <span class="cim-xbar-me" :style="{ width: splitOf(r)!.mePct + '%' }" />
                          </div>
                          <div class="cim-xlegend">
                            <div class="cim-xleg">
                              <span class="cim-xleg-l"><i class="cim-xdot cim-xdot--inv" />Инвестору · {{ share(splitOf(r)!.invPct) }}</span>
                              <b class="cim-c-inv">{{ formatCurrency(splitOf(r)!.investor) }}</b>
                            </div>
                            <div v-if="splitOf(r)!.others > 0" class="cim-xleg">
                              <span class="cim-xleg-l"><i class="cim-xdot cim-xdot--oth" />Другим инвесторам · {{ share(splitOf(r)!.othersPct) }}</span>
                              <b class="cim-c-oth">{{ formatCurrency(splitOf(r)!.others) }}</b>
                            </div>
                            <div class="cim-xleg">
                              <span class="cim-xleg-l"><i class="cim-xdot cim-xdot--me" />Вам · {{ share(splitOf(r)!.mePct) }}</span>
                              <b class="cim-c-me">{{ formatCurrency(splitOf(r)!.partner) }}</b>
                            </div>
                          </div>
                        </template>
                        <div v-else class="cim-xempty">Оплат по сделкам инвестора ещё не было.</div>
                        <div v-if="splitOf(r)!.expected > 0" class="cim-xexpect">
                          <v-icon icon="mdi-timer-sand" size="15" />
                          <span>Ещё ожидается <b>{{ formatCurrency(splitOf(r)!.expected) }}</b> прибыли по активным сделкам — разделится по долям на день оплаты.</span>
                        </div>
                      </template>
                      <div v-else class="cim-xskel cim-xskel--bar"><i /><i /></div>
                    </div>
                  </template>
                </div>
              </td>
            </tr>
            </template>
          </tbody>
          <tfoot v-if="rows.length && !switching">
            <tr>
              <td class="cim-n" />
              <td class="cim-name">Итого</td>
              <td class="cim-num">{{ formatCurrency(capitalTotal) }}</td>
              <td class="cim-num" />
              <td class="cim-num" />
              <td class="cim-num cim-c-inv">{{ money(data.totals.earned ?? 0) }}</td>
              <td class="cim-num">{{ money(toPayStart) }}</td>
              <td class="cim-num">{{ money(data.totals.paid ?? 0) }}</td>
              <td class="cim-num">{{ money(data.totals.reinvested ?? 0) }}</td>
              <td class="cim-num">
                <div class="cim-c-owed">{{ money(toPayEnd) }}</div>
                <div v-if="overpaidEnd" class="cim-sub cim-c-out">переплата {{ formatCurrency(overpaidEnd) }}</div>
              </td>
              <td class="cim-act" />
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="cim-foot-note">
        <b>Долг на конец</b> = долг на начало + начислено − выплачено − реинвест, и он же — долг на начало следующего месяца.
        Минус означает переплату: инвестору выплатили больше начисленного, она закроется будущими начислениями.
        Начислено — по платежам, оплаченным {{ monthPrep }}; выплаты относятся к месяцу, за который их провели.
      </div>
    </template>

    <div v-else class="cim-loading">
      <v-progress-circular indeterminate color="primary" size="32" />
    </div>

    <!-- Закрытие / открытие месяца -->
    <v-dialog :model-value="!!closeDialog" max-width="440" :persistent="closingBusy" @update:model-value="(v) => { if (!v) closeDialog = null }">
      <v-card rounded="lg" class="cim-cd">
        <div class="cim-cd-title">
          {{ closeDialog === 'close' ? `Закрыть ${monthLabel.toLowerCase()}?` : `Открыть ${monthLabel.toLowerCase()}?` }}
        </div>
        <template v-if="closeDialog === 'close'">
          <ul class="cim-cd-list">
            <li>Оплаты с датой этого месяца нельзя будет отметить или отменить.</li>
            <li>Расчёт за месяц, выплаты и реинвест за него станут недоступны.</li>
            <li>Сделки с деньгами этого месяца нельзя будет удалить, отменить или перенести в другую кассу.</li>
            <li>Итоги месяца сохранятся — если цифры потом изменятся, это будет видно.</li>
          </ul>
          <div v-if="!closeInfo?.lastClosed" class="cim-cd-note mb-2">
            Это первое закрытие в кассе. Месяцы до него останутся открытыми — их изменения могут сдвинуть
            «долг на начало» закрытого месяца. Дальше месяцы закрываются строго по порядку.
          </div>
          <div class="cim-cd-note">Открыть месяц сможет только владелец.</div>
        </template>
        <template v-else>
          <div class="cim-cd-note">
            Оплаты и выплаты этого месяца снова можно будет менять. Сохранённые итоги закрытия удалятся.
          </div>
        </template>
        <div class="cim-cd-actions">
          <button type="button" class="cim-btn" :disabled="closingBusy" @click="closeDialog = null">Отмена</button>
          <button type="button" class="cim-btn cim-btn--primary" :disabled="closingBusy" @click="confirmCloseAction">
            <v-progress-circular v-if="closingBusy" indeterminate size="15" width="2" color="white" />
            {{ closeDialog === 'close' ? 'Закрыть месяц' : 'Открыть месяц' }}
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Расчёт за месяц -->
    <v-dialog v-model="settleOpen" max-width="1120" :fullscreen="isMobile">
      <!-- Окно — колонка: шапка, итоги и действия закреплены, прокручивается только список. -->
      <div class="cim-dlg" :class="{ 'cim-dlg--full': isMobile }">
        <div class="cim-dlg-head">
          <div class="cim-dlg-head-main">
            <div class="cim-dlg-title">Расчёт за {{ monthLabel.toLowerCase() }}</div>
            <div class="cim-dlg-sub">
              {{ data?.cashBox.name }}<template v-if="lines.length"> · {{ lines.length }} {{ pluralizeRu(lines.length, 'инвестор', 'инвестора', 'инвесторов') }}</template>
            </div>
          </div>
          <button type="button" class="cim-dlg-close" aria-label="Закрыть" @click="settleOpen = false"><v-icon icon="mdi-close" size="20" /></button>
        </div>

        <template v-if="lines.length">
          <!-- Итоги расчёта — меняются вместе с вводом -->
          <div class="cim-sum">
            <div class="cim-sum-cell">
              <div class="cim-sum-l">К распределению</div>
              <div class="cim-sum-v">{{ formatCurrency(settleTotals.available) }}</div>
              <div v-if="settleTotals.bonus" class="cim-sum-n cim-raise">в т.ч. повышение {{ settleTotals.bonus > 0 ? '+' : '' }}{{ formatCurrency(settleTotals.bonus) }}</div>
            </div>
            <div class="cim-sum-cell">
              <div class="cim-sum-l">Выплатить</div>
              <div class="cim-sum-v">{{ formatCurrency(settleTotals.pay) }}</div>
            </div>
            <div v-if="canReinvest" class="cim-sum-cell">
              <div class="cim-sum-l">В капитал</div>
              <div class="cim-sum-v">{{ formatCurrency(settleTotals.reinvest) }}</div>
            </div>
            <div class="cim-sum-cell">
              <div class="cim-sum-l">Останется долгом</div>
              <div class="cim-sum-v" :class="{ 'cim-c-owed': settleTotals.left > 0 }">{{ formatCurrency(Math.max(settleTotals.left, 0)) }}</div>
            </div>
          </div>

          <!-- Действия для всех и поиск -->
          <div class="cim-bulk">
            <div class="cim-bulk-grp">
              <span class="cim-bulk-l">Всем</span>
              <div class="cim-seg">
                <button type="button" class="cim-seg-btn" :class="{ 'cim-seg-btn--on': fillMode === 'pay' }" @click="fillAll('pay')">Выплатить всё</button>
                <button v-if="canReinvest" type="button" class="cim-seg-btn" :class="{ 'cim-seg-btn--on': fillMode === 'reinvest' }" @click="fillAll('reinvest')">Всё в капитал</button>
                <button type="button" class="cim-seg-btn" :class="{ 'cim-seg-btn--on': fillMode === 'leave' }" @click="fillAll('leave')">Оставить долгом</button>
              </div>
            </div>
            <div v-if="hasWeightLines && canRaise" class="cim-bulk-grp cim-bulk-grp--end">
              <span class="cim-bulk-l">Процент «по вкладу»</span>
              <InfoTip :max-width="320">
                Повышение отдаёт инвестору больше из вашей части прибыли этого месяца — отдельной строкой
                «Повышение доли за месяц». Начисления по сделкам не меняются, ниже базового процента опустить
                нельзя. Применится ко всем инвесторам «по вкладу», у каждого можно поправить в его строке.
              </InfoTip>
              <div class="cim-in-wrap">
                <input
                  v-model.number="allPct"
                  type="number"
                  max="100"
                  step="0.5"
                  class="cim-in cim-in--pct"
                  :min="minWeightBase ?? 0"
                  @change="fitAllPct"
                  @keydown.enter.prevent="fitAllPct(); applyAllPct()"
                />
                <span class="cim-in-suf">%</span>
              </div>
              <button type="button" class="cim-btn cim-bulk-apply" :disabled="!allPctChanges" @click="applyAllPct">Применить</button>
            </div>
          </div>

          <!-- Инвесторы — прокручиваемый список с закреплённой шапкой -->
          <div class="cim-sl-scroll">
            <div class="cim-sl">
              <div class="cim-sl-head" :class="{ 'cim-sl-row--noreinv': !canReinvest }">
                <span>Инвестор</span>
                <span class="cim-r">Процент</span>
                <span class="cim-r">К выплате</span>
                <span class="cim-r">Выплатить</span>
                <span v-if="canReinvest" class="cim-r">В капитал</span>
                <span class="cim-r">Останется</span>
              </div>
              <div v-for="l in lines" :key="l.row.id" class="cim-sl-row" :class="{ 'cim-sl-row--noreinv': !canReinvest, 'cim-sl-row--bad': lineOver(l) || linePctBad(l) }">
                <div class="cim-sl-who">
                  <div class="cim-who">{{ l.row.name }}</div>
                  <div class="cim-sub">{{ modeLabel(l.row) }}<template v-if="l.row.basePct != null"> · базовый {{ pct(l.row.basePct) }}</template></div>
                </div>
                <div class="cim-r" data-l="Процент">
                  <template v-if="!canRaise || l.row.basePct == null">
                    <span v-if="l.row.basePct == null" class="cim-muted" title="При комиссии от закупки процент не повышается">—</span>
                    <span v-else>{{ pct(l.pct) }}</span>
                  </template>
                  <div v-else class="cim-in-wrap">
                    <input
                      v-model.number="l.pct"
                      type="number"
                      :min="l.row.basePct"
                      max="100"
                      step="0.5"
                      class="cim-in cim-in--pct"
                      :class="{ 'cim-in--bad': linePctBad(l) }"
                      :title="linePctBad(l) ? `Не ниже ${pct(l.row.basePct)}` : undefined"
                      @change="fitLine(l)"
                    />
                    <span class="cim-in-suf">%</span>
                  </div>
                </div>
                <div class="cim-r" data-l="К выплате">
                  <button type="button" class="cim-sl-avail" title="Подставить всё в «Выплатить»" @click="l.pay = lineAvailable(l); l.reinvest = 0">{{ formatCurrency(lineAvailable(l)) }}</button>
                  <div v-if="linePctBad(l)" class="cim-err">процент не ниже {{ pct(l.row.basePct) }}</div>
                  <div v-else-if="lineBonus(l)" class="cim-sub cim-raise">в т.ч. повышение +{{ formatCurrency(lineBonus(l)) }}</div>
                  <div v-else-if="l.row.autoReinvestLeft" class="cim-sub" title="Долг месяца 1-го числа ушёл в капитал. Выплатить можно и его — сумма вернётся из капитала с сегодняшнего дня, прибыль до этого дня остаётся инвестору">
                    + авто-реинвест {{ formatCurrency(l.row.autoReinvestLeft) }}
                  </div>
                </div>
                <div class="cim-r" data-l="Выплатить">
                  <div class="cim-in-wrap">
                    <input
                      :value="maskedMoney(l.pay)"
                      v-maska="CURRENCY_MASK"
                      type="text"
                      inputmode="numeric"
                      class="cim-in"
                      :class="{ 'cim-in--bad': lineOver(l) }"
                      @maska="(e: any) => l.pay = parseMasked(e)"
                    />
                    <span class="cim-in-suf">₽</span>
                  </div>
                </div>
                <div v-if="canReinvest" class="cim-r" data-l="В капитал">
                  <div class="cim-in-wrap">
                    <input
                      :value="maskedMoney(l.reinvest)"
                      v-maska="CURRENCY_MASK"
                      type="text"
                      inputmode="numeric"
                      class="cim-in"
                      :class="{ 'cim-in--bad': lineOver(l) }"
                      @maska="(e: any) => l.reinvest = parseMasked(e)"
                    />
                    <span class="cim-in-suf">₽</span>
                  </div>
                </div>
                <div class="cim-r" data-l="Останется">
                  <span v-if="lineOver(l)" class="cim-err">больше, чем к выплате</span>
                  <template v-else-if="lineReturn(l) > 0">
                    <span class="cim-sub cim-raise" title="Долг месяца 1-го числа ушёл в авто-реинвест. Выплата вернёт его из капитала с сегодняшнего дня; прибыль, заработанная до этого, остаётся инвестору.">
                      вернёт реинвест {{ formatCurrency(lineReturn(l)) }}
                    </span>
                  </template>
                  <b v-else :class="{ 'cim-c-owed': lineLeft(l) > 0, 'cim-muted': !lineLeft(l) }">{{ money(lineLeft(l)) }}</b>
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="cim-dlg-empty">
          <v-icon icon="mdi-check-circle-outline" size="28" />
          <div>Распределять нечего — за {{ monthLabel.toLowerCase() }} нет ни начислений, ни долга инвесторам.</div>
        </div>

        <div class="cim-dlg-foot">
          <!-- Закрыть месяц сразу после расчёта -->
          <label v-if="auth.can('coinvestors.closeMonth') && closeInfo && !isClosed" class="cim-close-opt" :class="{ 'cim-close-opt--off': !closeInfo.canClose }">
            <v-checkbox-btn v-model="closeAfter" :disabled="!closeInfo.canClose" density="compact" color="primary" />
            <span>
              <span class="cim-close-l">Закрыть {{ monthLabel.toLowerCase() }} после расчёта</span>
              <span v-if="!closeInfo.canClose && closeInfo.closeBlocked" class="cim-close-why">{{ closeInfo.closeBlocked }}</span>
            </span>
            <InfoTip :max-width="340">
              Оплаты, выплаты и реинвест с датами этого месяца станут недоступны, сделки с его деньгами нельзя будет
              удалить или перенести. Итоги месяца сохранятся — если цифры потом изменятся, это будет видно.
              Месяцы закрываются по порядку, открыть закрытый может только владелец.
            </InfoTip>
          </label>
          <v-spacer />
          <button type="button" class="cim-btn" @click="settleOpen = false">Отмена</button>
          <button
            type="button"
            class="cim-btn cim-btn--primary"
            :disabled="settling || settleInvalid || (!lines.length && !closeAfter)"
            @click="submitSettle"
          >
            <v-progress-circular v-if="settling" indeterminate size="16" width="2" />
            <span>{{ !lines.length && closeAfter ? 'Закрыть месяц' : closeAfter ? 'Провести и закрыть месяц' : 'Провести расчёт' }}</span>
          </button>
        </div>
      </div>
    </v-dialog>
  </v-card>
</template>

<style scoped>
.cim { overflow: hidden; }

/* Шапка месяца: месяц — главное, что нужно видеть, поэтому крупно. */
.cim-hero { padding: 18px 16px 4px; }
.cim-hero-top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.cim-hero-month { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 260px; }
/* Название месяца — с воздухом от стрелок по бокам. */
.cim-hero-month .cim-hero-title { margin: 0 8px; }
@media (max-width: 600px) {
  .cim-hero-month { gap: 6px; }
  .cim-hero-month .cim-hero-title { margin: 0 4px; font-size: 24px; }
}
.cim-hero-title {
  font-size: 30px; font-weight: 800; letter-spacing: -0.5px; line-height: 1.1;
  min-width: 0; white-space: nowrap;
}
.cim-arrow {
  width: 36px; height: 36px; border-radius: 10px; flex: none;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.cim-arrow:hover { border-color: rgba(var(--v-theme-on-surface), 0.25); }
.cim-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.cim-chip-st {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 11px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.7);
}
.cim-chip-st--closed { background: rgba(100, 116, 139, 0.14); color: #475569; }
.cim-chip-st--recalc { background: rgba(217, 119, 6, 0.13); color: #b45309; }
.cim-chip-st--err { background: rgba(239, 68, 68, 0.12); color: #dc2626; }
.cim-chip-st--new { background: rgba(4, 120, 87, 0.12); color: #047857; }
.cim-search { width: 320px; max-width: 100%; }

/* Раскрытая строка инвестора */
.cim-caret { margin-right: 2px; color: rgba(var(--v-theme-on-surface), 0.4); }
.cim-row--open > td { background: rgba(4, 120, 87, 0.04); }
.cim-detail-row > td { padding: 0 !important; background: rgba(var(--v-theme-on-surface), 0.02); }
/* Раскрытие строки: условия, распределение прибыли, переход в карточку */
.cim-exp {
  padding: 18px 20px 20px; display: flex; flex-direction: column; gap: 14px;
  /* Таблица шире экрана телефона — блок держится у левого края видимой области. */
  position: sticky; left: 0; max-width: 100%; box-sizing: border-box;
  white-space: normal;
}
.cim-xhead { display: flex; gap: 12px; align-items: flex-start; }
.cim-xhead-main { min-width: 0; flex: 1; }
.cim-xhead-btn { flex: none; }
.cim-cond-icon {
  width: 38px; height: 38px; border-radius: 10px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(79, 70, 229, 0.1); color: #4f46e5;
}
.cim-cond-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.92); }
.cim-cond-text { font-size: 13px; line-height: 1.5; margin-top: 2px; color: rgba(var(--v-theme-on-surface), 0.65); max-width: 760px; }
.cim-cond-facts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: -4px; }
.cim-fact {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;
  background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.72);
}
.cim-fact--on { background: rgba(4, 120, 87, 0.1); color: #047857; }

.cim-xgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cim-xcard {
  padding: 14px 16px; border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
}
.cim-xcard-title {
  font-size: 12px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.55); margin-bottom: 8px;
}
.cim-xcard-title span { font-weight: 500; text-transform: none; letter-spacing: 0; color: rgba(var(--v-theme-on-surface), 0.4); margin-left: 4px; }
.cim-xcard-title--flat { margin-bottom: 0; }
.cim-xline {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  padding: 5px 0; font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.68);
}
.cim-xline b { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cim-xline--total { margin-top: 4px; padding-top: 9px; border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.14); font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); }
.cim-xline--total b { font-size: 15px; font-weight: 800; }
.cim-xline--warn { color: #b45309; }
.cim-xline--warn b { color: #b45309; }

.cim-xdist-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.cim-xdist-sub { font-size: 12.5px; margin-top: 3px; color: rgba(var(--v-theme-on-surface), 0.5); }
.cim-dist2-right { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.cim-xdist-total-l { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.cim-dist2-total { font-size: 16px; font-weight: 800; color: rgba(var(--v-theme-on-surface), 0.9); font-variant-numeric: tabular-nums; }
.cim-dist2-help {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary));
  cursor: pointer; transition: background 0.15s;
}
.cim-dist2-help:hover { background: rgba(var(--v-theme-primary), 0.22); }
.cim-xbar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; gap: 2px; background: rgba(var(--v-theme-on-surface), 0.06); }
.cim-xbar > span { height: 100%; min-width: 0; }
.cim-xbar > span:not([style*="width: 0%"]) { min-width: 3px; }
.cim-xbar-inv { background: #6366f1; }
.cim-xbar-oth { background: #a5b4fc; }
.cim-xbar-me { background: #10b981; }
.cim-xlegend { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-top: 10px; }
.cim-xleg { display: flex; flex-direction: column; gap: 2px; }
.cim-xleg-l { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.6); }
.cim-xleg b { font-size: 14.5px; font-weight: 800; font-variant-numeric: tabular-nums; padding-left: 14px; }
.cim-xdot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.cim-xdot--inv { background: #6366f1; }
.cim-xdot--oth { background: #a5b4fc; }
.cim-xdot--me { background: #10b981; }
.cim-c-oth { color: #6d71c9; }
.cim-xexpect {
  display: flex; align-items: flex-start; gap: 7px;
  margin-top: 12px; line-height: 1.5; padding: 9px 12px; border-radius: 10px; font-size: 12.5px;
  background: rgba(var(--v-theme-on-surface), 0.04); color: rgba(var(--v-theme-on-surface), 0.68);
}
.cim-xexpect b { color: rgba(var(--v-theme-on-surface), 0.88); font-variant-numeric: tabular-nums; }
.cim-xempty { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); }
.cim-xlink { color: rgb(var(--v-theme-primary)); font-weight: 600; margin-left: 6px; }
.cim-xskel { display: flex; flex-direction: column; gap: 10px; padding: 4px 0; }
.cim-xskel i {
  display: block; height: 14px; border-radius: 6px;
  background: linear-gradient(90deg, rgba(var(--v-theme-on-surface), 0.06), rgba(var(--v-theme-on-surface), 0.11), rgba(var(--v-theme-on-surface), 0.06));
  background-size: 200% 100%; animation: cim-shimmer 1.2s linear infinite;
}
.cim-xskel--bar i:first-child { height: 12px; }
@keyframes cim-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.cim-exp-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px; border-radius: 10px; font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.28);
  transition: background 0.15s, border-color 0.15s;
}
.cim-exp-btn:hover { background: rgba(var(--v-theme-primary), 0.18); border-color: rgba(var(--v-theme-primary), 0.5); }
@media (max-width: 760px) {
  .cim-xgrid { grid-template-columns: 1fr; }
  .cim-xhead { flex-wrap: wrap; }
  .cim-xhead-btn { width: 100%; justify-content: center; }
}
.cim-act { white-space: nowrap; }
.cim-box-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.cim-btn--danger { color: #dc2626; }

.cim-toolbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 14px 0 12px;
}
.cim-box { width: 220px; max-width: 100%; }
.cim-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 16px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.85);
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background 0.15s, box-shadow 0.15s;
}
.cim-btn:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.04); }
.cim-btn:disabled { opacity: 0.5; cursor: default; }
.cim-btn--primary { background: #047857; border-color: #047857; color: #fff; }
.cim-btn--primary:hover:not(:disabled) { background: #065f46; box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25); }
.cim-btn--sm { height: 32px; padding: 0 12px; }

/* Шестерёнка: день расчёта, настройки, пересчёт долей */
.cim-gear {
  width: 44px; height: 44px; flex: none; border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.7); transition: background 0.15s, border-color 0.15s;
}
.cim-gear:hover { background: rgba(var(--v-theme-on-surface), 0.04); border-color: rgba(var(--v-theme-on-surface), 0.22); }
.cim-set { width: 340px; max-width: calc(100vw - 24px); padding: 6px 0; }
.cim-set :deep(.cim-set-sec) { padding: 12px 16px; }
.cim-set :deep(.cim-set-sec + .cim-set-sec) { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
.cim-set :deep(.cim-set-sec--actions) { padding: 6px 8px; }
.cim-set-sec--actions:empty { display: none; }
.cim-set-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.cim-set-title { font-size: 12px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; color: rgba(var(--v-theme-on-surface), 0.55); }
.cim-set :deep(.cim-set-item) {
  width: 100%; display: flex; align-items: center; gap: 10px; text-align: left;
  padding: 10px 8px; border-radius: 10px; font-size: 13.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85); transition: background 0.15s;
}
.cim-set :deep(.cim-set-item > span) { flex: 1; }
.cim-set :deep(.cim-set-item:hover:not(:disabled)) { background: rgba(var(--v-theme-on-surface), 0.05); }
.cim-set :deep(.cim-set-item:disabled) { opacity: 0.5; cursor: default; }
.cim-set-select { position: relative; }
.cim-set-select select {
  width: 100%; height: 42px; padding: 0 38px 0 12px; border-radius: 10px; appearance: none; -webkit-appearance: none;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16); background: rgb(var(--v-theme-surface));
  font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); cursor: pointer; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.cim-set-select select:hover { border-color: rgba(var(--v-theme-on-surface), 0.28); }
.cim-set-select select:focus { border-color: #047857; box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.12); }
.cim-set-select select:disabled { opacity: 0.6; cursor: default; }
.cim-set-caret, .cim-set-spin { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; color: rgba(var(--v-theme-on-surface), 0.5); }

.cim-kpis {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px;
  padding: 0 16px 16px;
}
.cim-kpi {
  display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.cim-kpi-icon {
  flex: none; width: 38px; height: 38px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--c); background: color-mix(in srgb, var(--c) 12%, transparent);
}
.cim-kpi-body { min-width: 0; }
.cim-kpi-label { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); line-height: 1.3; }
.cim-kpi-val { font-size: 21px; font-weight: 800; margin-top: 3px; font-variant-numeric: tabular-nums; letter-spacing: -0.2px; }
.cim-kpi-note { font-size: 11.5px; color: #dc2626; margin-top: 2px; }

.cim-closed-chip {
  display: inline-flex; align-items: center; gap: 5px; height: 36px; padding: 0 12px;
  border-radius: 10px; font-size: 13px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.7);
}
.cim-closed {
  margin: 0 16px 12px; padding: 12px 14px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgba(var(--v-theme-on-surface), 0.03);
}
.cim-closed-main { display: flex; align-items: center; gap: 10px; }
.cim-closed-main > div { flex: 1; min-width: 0; }
.cim-closed-title { font-size: 13.5px; font-weight: 600; }
.cim-closed-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; }
.cim-closed-diff { margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.15); font-size: 12.5px; }
.cim-closed-diff-title { display: flex; gap: 6px; align-items: center; color: #b45309; font-weight: 600; margin-bottom: 4px; }
.cim-closed-diff-row { color: rgba(var(--v-theme-on-surface), 0.75); padding-left: 21px; }
.cim-cd { padding: 20px; }
.cim-cd-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
.cim-cd-list { margin: 0 0 10px; padding-left: 18px; font-size: 13px; line-height: 1.55; color: rgba(var(--v-theme-on-surface), 0.75); }
.cim-cd-note { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); }
.cim-cd-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
.cim-note {
  display: flex; align-items: center; gap: 6px; margin: 12px 16px 0;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.65);
}

.cim-scroll { overflow-x: auto; transition: opacity 0.15s; }
.cim-scroll--loading { opacity: 0.55; pointer-events: none; }

/* Скелетон загрузки другого месяца — как в «Годовом обзоре». */
.cim-sk {
  height: 12px; width: 70%; margin-left: auto; border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  animation: cim-sk-pulse 1.2s ease-in-out infinite;
}
.cim-sk--name { width: 55%; margin-left: 0; }
.cim-sk--n { width: 18px; margin: 0 auto; }
.cim-sk-row td { height: 46px; }
.cim-kpis--sk .cim-kpi-val,
.cim-kpis--sk .cim-kpi-note {
  color: transparent !important; border-radius: 6px; width: fit-content; min-width: 90px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  animation: cim-sk-pulse 1.2s ease-in-out infinite;
}
@keyframes cim-sk-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
.cim-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.cim-table thead th {
  text-align: left; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  padding: 12px 12px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.16); white-space: nowrap;
  vertical-align: middle;
  /* Подложка поверх фона карточки: шапка отделена от строк и при прокрутке. */
  background: linear-gradient(rgba(var(--v-theme-on-surface), 0.04), rgba(var(--v-theme-on-surface), 0.04)), rgb(var(--v-theme-surface));
}
.cim-table tbody td, .cim-table tfoot td {
  padding: 10px 12px; vertical-align: middle; font-size: 14px; font-weight: 500;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  white-space: nowrap;
}
/* Цвет значений — с нулевым весом селектора: цветные классы на самой ячейке
   (переплата, доля партнёра, «остаток») должны его перекрывать. */
:where(.cim-table) :where(tbody, tfoot) :where(td) { color: rgba(var(--v-theme-on-surface), 0.87); }
.cim-table tfoot td {
  font-weight: 700; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12); border-bottom: none;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.cim-table th.cim-num, .cim-table td.cim-num { text-align: right; }
.cim-n { width: 36px; color: rgba(var(--v-theme-on-surface), 0.45); text-align: center !important; }
.cim-name { min-width: 160px; }
.cim-act { width: 1%; }
.cim-who { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }
.cim-sub { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; font-weight: 500; }
.cim-muted { color: rgba(var(--v-theme-on-surface), 0.4); }
.cim-strong { font-weight: 700; }
.cim-strike { text-decoration: line-through; margin-right: 6px; }
.cim-raise { color: #7c3aed; font-weight: 700; }
.cim-c-inv { color: #4f46e5; }
.cim-c-me { color: #047857; }
.cim-c-owed { color: #d97706; }
.cim-c-in { color: #047857; }
.cim-c-out { color: #dc2626; }

.cim-partner td { background: rgba(4, 120, 87, 0.05); }
.cim-row { cursor: pointer; transition: background 0.12s; }
.cim-row:hover td { background: rgba(var(--v-theme-on-surface), 0.03); }
.cim-row--archived td { opacity: 0.6; }
.cim-none { text-align: center; padding: 28px 12px !important; color: rgba(var(--v-theme-on-surface), 0.5); }

/* Имя закреплено слева — на телефоне таблица листается вбок. */
@media (max-width: 960px) {
  .cim-table .cim-name {
    position: sticky; left: 0; z-index: 1;
    background: rgb(var(--v-theme-surface));
    box-shadow: 1px 0 0 rgba(var(--v-theme-on-surface), 0.06);
  }
  .cim-partner .cim-name { background: rgb(var(--v-theme-surface)); }
  .cim-n { display: none; }
}

.cim-dots {
  width: 32px; height: 32px; border-radius: 8px; border: none; background: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: rgba(var(--v-theme-on-surface), 0.55);
}
.cim-dots:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.cim-menu {
  background: rgb(var(--v-theme-surface)); border-radius: 12px; padding: 6px; min-width: 210px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.cim-menu-item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: 8px;
  border: none; background: none; cursor: pointer; font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85);
}
.cim-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.cim-menu-item--danger { color: #dc2626; }

.cim-th-help { display: inline-flex; align-items: center; gap: 3px; cursor: help; }
.cim-th-help .v-icon { opacity: 0.6; }
.cim-foot-note b { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.7); }
.cim-foot-note {
  padding: 10px 16px 14px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); line-height: 1.45;
}
.cim-empty, .cim-loading { padding: 40px 16px; text-align: center; color: rgba(var(--v-theme-on-surface), 0.55); }

/* Окно расчёта: колонка во весь доступный рост — прокручивается только список */
.cim-dlg {
  display: flex; flex-direction: column; max-height: calc(100vh - 48px); min-height: 0;
  background: rgb(var(--v-theme-surface)); border-radius: 18px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.22);
}
.cim-dlg--full { max-height: 100vh; height: 100vh; border-radius: 0; }
.cim-dlg > * { flex-shrink: 0; }
.cim-dlg-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 20px 24px 14px;
}
.cim-dlg-head-main { min-width: 0; }
.cim-dlg-title { font-size: 20px; font-weight: 800; letter-spacing: -0.01em; }
.cim-dlg-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 3px; }
.cim-dlg-close {
  width: 36px; height: 36px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cim-dlg-close:hover { background: rgba(var(--v-theme-on-surface), 0.06); }

.cim-sum {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  margin: 0 24px; border: 1px solid rgba(var(--v-theme-on-surface), 0.09); border-radius: 12px; overflow: hidden;
}
.cim-sum-cell { padding: 12px 16px; min-width: 0; }
.cim-sum-cell + .cim-sum-cell { border-left: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
.cim-sum-l { font-size: 12px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.55); }
.cim-sum-v { font-size: 19px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; color: rgba(var(--v-theme-on-surface), 0.92); white-space: nowrap; }
.cim-sum-n { font-size: 11.5px; margin-top: 1px; color: rgba(var(--v-theme-on-surface), 0.45); }

.cim-bulk { display: flex; align-items: center; gap: 10px 24px; flex-wrap: wrap; padding: 14px 24px; }
.cim-bulk-grp { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cim-bulk-l { font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.65); }
.cim-bulk-grp--end { margin-left: auto; }
/* «Применить» — ровно в рост поля процента. */
.cim-bulk-apply { height: 38px; }
.cim-seg { display: inline-flex; padding: 3px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.06); }
.cim-seg-btn {
  height: 32px; padding: 0 12px; border-radius: 8px; font-size: 13px; font-weight: 600; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.65); transition: background 0.15s, color 0.15s;
}
.cim-seg-btn:hover { color: rgba(var(--v-theme-on-surface), 0.9); }
.cim-seg-btn--on { background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.92); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }

/* Список: прокрутка внутри окна, шапка таблицы закреплена */
.cim-dlg > .cim-sl-scroll { flex: 1 1 auto; min-height: 120px; overflow-y: auto; padding: 0 24px 16px; overscroll-behavior: contain; }
.cim-sl { border: 1px solid rgba(var(--v-theme-on-surface), 0.09); border-radius: 12px; }
.cim-sl-head, .cim-sl-row {
  display: grid; align-items: center; column-gap: 16px;
  grid-template-columns: minmax(160px, 1.4fr) 104px minmax(150px, 1.1fr) 150px 150px minmax(110px, 0.9fr);
  padding: 0 16px;
}
.cim-sl-row--noreinv { grid-template-columns: minmax(160px, 1.4fr) 104px minmax(150px, 1.1fr) 150px minmax(110px, 0.9fr); }
.cim-sl-head {
  position: sticky; top: 0; z-index: 2; height: 40px;
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgb(var(--v-theme-surface));
  box-shadow: inset 0 -1px 0 rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 12px 12px 0 0;
}
.cim-sl-row { min-height: 60px; padding-top: 8px; padding-bottom: 8px; font-size: 13.5px; }
.cim-sl-row + .cim-sl-row { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06); }
.cim-sl-row:hover { background: rgba(var(--v-theme-on-surface), 0.018); }
.cim-sl-row--bad { background: rgba(220, 38, 38, 0.035); }
.cim-sl-who { min-width: 0; }
.cim-sl-who .cim-who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cim-sl-who .cim-sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cim-r { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 0; }
.cim-r .cim-sub { white-space: nowrap; }
.cim-sl-row b { font-variant-numeric: tabular-nums; }
.cim-sl-avail {
  font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; color: rgba(var(--v-theme-on-surface), 0.9);
  border-bottom: 1px dashed rgba(var(--v-theme-on-surface), 0.25); line-height: 1.3; white-space: nowrap;
}
.cim-sl-avail:hover { color: #047857; border-bottom-color: #047857; }
.cim-dlg-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
  padding: 40px 24px; font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.cim-dlg-empty .v-icon { color: #047857; }

.cim-in-wrap { position: relative; display: inline-flex; align-items: center; }
.cim-in {
  width: 150px; height: 38px; padding: 0 28px 0 12px; border-radius: 10px; text-align: right;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16); background: rgb(var(--v-theme-surface));
  font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; color: rgba(var(--v-theme-on-surface), 0.9); outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.cim-in:hover { border-color: rgba(var(--v-theme-on-surface), 0.28); }
.cim-in:focus { border-color: #047857; box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.12); }
.cim-in--pct { width: 90px; padding-right: 26px; }
.cim-in--bad, .cim-in--bad:focus { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1); }
.cim-in-suf { position: absolute; right: 11px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45); pointer-events: none; }
.cim-err { font-size: 11.5px; color: #dc2626; white-space: nowrap; }

.cim-dlg-foot {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 14px 24px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.cim-close-opt { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; min-width: 0; }
.cim-close-opt--off { cursor: default; opacity: 0.7; }
.cim-close-opt > span { display: flex; flex-direction: column; }
.cim-close-l { font-size: 13.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); }
.cim-close-why { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); }

@media (max-width: 860px) {
  .cim-dlg-head { padding: 16px 16px 10px; }
  .cim-sum { margin: 0 16px; grid-template-columns: 1fr 1fr; }
  .cim-sum-cell + .cim-sum-cell { border-left: none; }
  .cim-sum-cell:nth-child(even) { border-left: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
  .cim-sum-cell:nth-child(n + 3) { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
  .cim-bulk { padding: 12px 16px; }
  .cim-bulk-grp--end { margin-left: 0; }
  /* На телефоне прокручивается всё окно: закреплённые итоги съели бы экран. */
  .cim-dlg { overflow-y: auto; }
  .cim-dlg-head { position: sticky; top: 0; z-index: 3; background: rgb(var(--v-theme-surface)); }
  .cim-dlg-foot { position: sticky; bottom: 0; z-index: 3; background: rgb(var(--v-theme-surface)); }
  .cim-dlg > .cim-sl-scroll { flex: none; overflow: visible; min-height: 0; padding: 0 16px 12px; }
  .cim-sl-head { display: none; }
  .cim-sl-row, .cim-sl-row--noreinv { grid-template-columns: 1fr 1fr; row-gap: 10px; padding: 12px 14px; }
  .cim-sl-who { grid-column: 1 / -1; }
  .cim-r { align-items: flex-start; text-align: left; }
  .cim-r::before { content: attr(data-l); font-size: 11.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.5); }
  .cim-sl .cim-in, .cim-sl .cim-in-wrap { width: 100%; }
  .cim-dlg-foot { padding: 12px 16px; }
  .cim-dlg-foot .cim-btn { flex: 1; justify-content: center; }
}
</style>
