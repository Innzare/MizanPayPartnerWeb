<script setup lang="ts">
/**
 * Лента ручных движений денег — общая для двух вкладок бухгалтерии.
 *
 * `main` — «Пополнения и расходы»: деньги пришли или ушли насовсем (капитал,
 * прибыль, доход и расход по бизнесу).
 * `temp` — «Временные операции»: деньги не насовсем — временное пополнение
 * или снятие и возвраты по ним, неизвестный приход и выдача под отчёт (их ещё
 * разнесут); кроме ленты — кто кому сколько должен и что ждёт разбора.
 * Временные вынесены в свою вкладку по просьбе партнёра (25.10.2026): их
 * много, и в общей ленте они мешали.
 *
 * Табы потоков сверху, слева виды выбранного потока, справа лента за период
 * с пагинацией. «Прибыль к снятию сейчас» и «Снять прибыль» — на «Балансе».
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AccountingTabs from '@/components/AccountingTabs.vue'
import MonthYearPicker from '@/components/MonthYearPicker.vue'
import SelectField from '@/components/SelectField.vue'
import ServerPager from '@/components/ServerPager.vue'
import { PER_PAGE_OPTIONS, usePageSize } from '@/composables/useListPrefs'
import { useAutoLoad } from '@/composables/useAutoLoad'
import OperationDialog from '@/components/OperationDialog.vue'
import AccountOperationItems from '@/components/AccountOperationItems.vue'
import PendingResolveDialog from '@/components/PendingResolveDialog.vue'
import PendingEditDialog from '@/components/PendingEditDialog.vue'
import LiabilityCardDialog from '@/components/LiabilityCardDialog.vue'
import LiabilityMovementDialog, { type LiabilityMovementMode } from '@/components/LiabilityMovementDialog.vue'
import LiabilityEditDialog, { type LiabilityInfo } from '@/components/LiabilityEditDialog.vue'
import ManualTxEditDialog, { type ManualTx } from '@/components/ManualTxEditDialog.vue'
import CategoriesDialog from '@/components/CategoriesDialog.vue'
import {
  useAccountingStore,
  type TemporarySummary,
  type LiabilityView,
  type LiabilityCard,
  type LiabilityMovementView,
  type FlowGroup,
  type PendingOpView,
} from '@/stores/accounting'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useAuthStore } from '@/stores/auth'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useConfirmDelete } from '@/composables/useConfirmDelete'
import { api } from '@/api/client'
import { rangeForPreset } from '@/composables/useReports'
import type { PeriodRange } from '@/types/reports'
import {
  OPERATION_KINDS, INCOME_KINDS, EXPENSE_KINDS, TEMP_INCOME_KINDS, TEMP_EXPENSE_KINDS, type OperationKind,
} from '@/constants/operationKinds'
import { formatCurrency, formatDate, formatDateShort } from '@/utils/formatters'

const props = defineProps<{ mode: 'main' | 'temp' }>()
/** Вкладка «Временные операции». Режим у страницы постоянный. */
const tempMode = props.mode === 'temp'

const store = useAccountingStore()
const cashboxes = useCashBoxesStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirmDelete } = useConfirmDelete()
const { isDark } = useIsDark()

/** Погасить временный долг или принять возврат — это движение капитала. */
const canManage = computed(() => auth.can('finance.capital'))
const canEditTx = computed(() => auth.can('finance.transactions'))
const canCancelCapital = computed(() => auth.can('cashboxes.capital'))
const canCategories = computed(() => auth.can('finance.categories'))
/** Исправить и удалить временную операцию — отдельное право, по умолчанию у владельца. */
const canEditTemp = computed(() => auth.can('accounting.temporary.edit'))

// ── Касса: «Все кассы» или одна — так открывают раздел из карточки кассы ──
const cashBoxId = ref<string | null>(typeof route.query.cashBoxId === 'string' ? route.query.cashBoxId : null)
const cashBoxOptions = computed(() =>
  cashboxes.items
    .filter((b) => !b.archivedAt)
    .map((b) => ({ value: b.id, label: b.name, hint: b.isDefault ? 'основная' : undefined, color: b.color })),
)

watch(cashBoxId, (id) => {
  void router.replace({ query: { ...route.query, cashBoxId: id || undefined } })
  void load()
})

// ── Навигация: поток → вид ──
//
// Табы — пополнения или расходы (на «Временных» — временные пополнения или
// снятия), вид операции — выпадающим фильтром в шапке ленты.
type Flow = 'in' | 'out'
type Section = 'main' | 'temp'
const FLOWS: Flow[] = ['in', 'out']
const SECTION: Section = tempMode ? 'temp' : 'main'
const FLOW_TITLE: Record<Flow, string> = tempMode
  ? { in: 'Временные пополнения', out: 'Временные снятия' }
  : { in: 'Пополнения', out: 'Расходы' }

const tab = ref<Flow>(route.query.tab === 'out' ? 'out' : 'in')
/**
 * «Временные»: активные (не вернули, не разобрали) или завершённые. По
 * умолчанию активные — по ним идёт работа; завершённые вместе с ними мешали.
 */
type StatusTab = 'active' | 'done'
const statusTab = ref<StatusTab>(route.query.st === 'done' ? 'done' : 'active')
watch(statusTab, (v) => {
  void router.replace({ query: { ...route.query, st: v === 'done' ? 'done' : undefined } })
})
// Вид — из ссылки: карточка кассы ведёт сюда сразу на «Расход по бизнесу».
const kindFilter = ref<string | null>(typeof route.query.kind === 'string' ? route.query.kind : null)

function select(flow: Flow, kind: string | null = null) {
  tab.value = flow
  kindFilter.value = kind
  void router.replace({
    query: { ...route.query, tab: flow === 'out' ? 'out' : undefined, kind: kind ?? undefined },
  })
}


/**
 * Виды операций по вкладкам, в порядке частоты.
 *
 * Основные — деньги ушли или пришли насовсем: капитал, прибыль, доход и
 * расход по бизнесу.
 * Временные — деньги не насовсем: временное пополнение или снятие и возвраты
 * по ним; «Неизвестный приход» и «Выдали под отчёт» — их не возвращают, а
 * разносят в расход, доход или «вернули». Важно не только что было за
 * период, но и кто сколько должен и что ждёт разбора сейчас.
 *
 * Возвраты и переводы между кассами (наследство прежней функции кассы)
 * показываются, только если за период такие были.
 */
interface KindUi {
  key: string
  /** Показывать, только если за период были операции. */
  onlyIfUsed?: boolean
}
const TREE: Record<Flow, Record<Section, KindUi[]>> = {
  in: {
    // «Прочий доход» больше не заводится — в ленте только старые, если были.
    main: [{ key: 'capitalIn' }, { key: 'income', onlyIfUsed: true }, { key: 'transferIn', onlyIfUsed: true }],
    temp: [{ key: 'borrowed' }, { key: 'pendingIn' }, { key: 'repaidToUs', onlyIfUsed: true }],
  },
  out: {
    main: [
      { key: 'expense' },
      { key: 'otherExpense' },
      { key: 'profitOut' },
      { key: 'capitalOut' },
      { key: 'transferOut', onlyIfUsed: true },
    ],
    temp: [
      { key: 'lent' },
      { key: 'pendingOut' },
      { key: 'repaidByUs', onlyIfUsed: true },
      // Часть долга «дали», ставшая расходом или снятием партнёра.
      { key: 'convertedToMain', onlyIfUsed: true },
    ],
  },
}
function keysOf(flow: Flow): string[] {
  return TREE[flow][SECTION].map((k) => k.key)
}

/** Кнопка «+»: виды новой операции выбранного потока на этой вкладке. */
const OPS_FOR: Record<Section, Record<Flow, OperationKind[]>> = {
  main: { in: INCOME_KINDS, out: EXPENSE_KINDS },
  temp: { in: TEMP_INCOME_KINDS, out: TEMP_EXPENSE_KINDS },
}

/** Цвет смысловой группы — точка в ленте и полоска карточки вида. */
const GROUP_COLOR: Record<FlowGroup, string> = {
  capital: '#6366f1',
  regular: '#0ea5e9',
  temporary: '#f59e0b',
  pending: '#94a3b8',
  transfer: '#a855f7',
}
/** Снятие прибыли — своя, «денежная» окраска: это главный вид раздела. */
const PROFIT_COLOR = '#059669'

/** Виды новой операции для выбранной ветки — только доступные пользователю. */
const tabKinds = computed(() =>
  OPS_FOR[SECTION][tab.value].filter((k) =>
    auth.can(OPERATION_KINDS.find((x) => x.kind === k)!.permission),
  ),
)

// ── Период: месяц, год или всё время — как фильтр месяцев на «Платежах» ──
//
// В адресе: `period=2026-09` (месяц), `period=2026-03..2026-06` (диапазон
// месяцев), `period=2026` (год), `period=all`.
// Ссылка из карточки кассы ведёт сюда с `period=all`.
function periodFromQuery(q: unknown): PeriodRange {
  const v = typeof q === 'string' ? q : ''
  if (v === 'all') return rangeForPreset('all')
  const span = /^(\d{4})-(\d{2})\.\.(\d{4})-(\d{2})$/.exec(v)
  if (span) {
    const [, fy, fm, ty, tm] = span.map(Number) as number[]
    const last = new Date(ty!, tm!, 0).getDate()
    const pad = (n: number) => String(n).padStart(2, '0')
    const from = `${fy}-${pad(fm!)}-01`
    const to = `${ty}-${pad(tm!)}-${pad(last)}`
    if (from <= to) {
      const months = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
      const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
      const label = fy === ty
        ? `${cap(months[fm! - 1]!)} — ${months[tm! - 1]} ${ty}`
        : `${cap(months[fm! - 1]!)} ${fy} — ${months[tm! - 1]} ${ty}`
      return { from, to, preset: 'custom', label }
    }
  }
  const ym = /^(\d{4})-(\d{2})$/.exec(v)
  if (ym) return rangeForPreset('month', new Date(Number(ym[1]), Number(ym[2]) - 1, 1))
  if (/^\d{4}$/.test(v)) return rangeForPreset('year', new Date(Number(v), 0, 1))
  // Прежние ссылки с пресетом («year») — от текущей даты.
  if (v === 'year') return rangeForPreset('year')
  return rangeForPreset('month')
}
const period = ref<PeriodRange>(periodFromQuery(route.query.period))

function periodQuery(p: PeriodRange): string | undefined {
  if (p.preset === 'all') return 'all'
  if (p.preset === 'year') return p.from.slice(0, 4)
  if (p.preset === 'custom') return `${p.from.slice(0, 7)}..${p.to.slice(0, 7)}`
  const current = rangeForPreset('month')
  return p.from === current.from ? undefined : p.from.slice(0, 7)
}
watch(period, (p) => {
  void router.replace({ query: { ...route.query, period: periodQuery(p) } })
  void loadPeriod()
})

/** «за октябрь 2026», «за 2026 год», «за всё время» — для подписей. */
const periodPhrase = computed(() =>
  period.value.preset === 'all' ? 'за всё время' : `за ${period.value.label.toLowerCase()}`,
)

// ── Данные ──
const data = ref<TemporarySummary | null>(null)
const loading = ref(true)

async function loadPeriod() {
  loading.value = true
  try {
    data.value = await store.fetchTemporary(period.value.from, period.value.to, cashBoxId.value)
  } catch (e: any) {
    toast.error(e, tempMode ? 'Не удалось загрузить временные операции' : 'Не удалось загрузить пополнения и расходы')
  } finally {
    loading.value = false
  }
}

async function load() {
  await loadPeriod()
}

onMounted(() => {
  // Прежние ссылки на временные внутри «Пополнений и расходов» — на их вкладку.
  if (!tempMode && route.query.section === 'temp') {
    const { section: _section, ...query } = route.query
    void router.replace({ path: '/accounting/temporary-ops', query })
    return
  }
  void load()
  if (!cashboxes.items.length) void cashboxes.fetchAll().catch(() => {})
})


// ── Состояние на сегодня ──
const activePeople = computed(() =>
  (data.value?.people ?? []).filter((p) => p.status === 'ACTIVE' && p.left > 0),
)
/**
 * Незакрытые временные. В пополнениях — деньги, которые положили на время и
 * мы должны вернуть; в расходах — взятые из кассы на время, их должны вернуть
 * нам. От периода не зависят.
 */
function tempPeopleFor(flow: Flow) {
  return activePeople.value.filter((p) => p.direction === (flow === 'in' ? 'BORROWED' : 'LENT'))
}
function overdueFor(flow: Flow): boolean {
  return tempPeopleFor(flow).some((p) => p.overdue)
}

const listCard = ref<HTMLElement | null>(null)
/** Открыть долги нужного потока — из предупреждения о просрочке. */
async function openTemp(flow: Flow) {
  select(flow)
  await nextTick()
  const head = listCard.value?.querySelector<HTMLElement>('.tp-sec--debts')
  ;(head ?? listCard.value)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
/** Куда вести из предупреждения о просрочке: туда, где просрочка есть. */
const overdueFlow = computed<Flow>(() => (overdueFor('out') ? 'out' : 'in'))

/** Сколько уже вернули по расчёту — полосой, чтобы не считать в уме. */
function repaidPct(l: LiabilityView): number {
  if (!l.principal) return 0
  return Math.min(100, Math.round((l.repaid / l.principal) * 100))
}

/** «2 раза», «5 раз», «21 раз». */
function timesText(n: number): string {
  const d = n % 10, h = n % 100
  return `${n} ${d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'раза' : 'раз'}`
}

function daysOverdue(l: LiabilityView): number {
  if (!l.dueDate) return 0
  const diff = Date.now() - new Date(l.dueDate).getTime()
  return Math.max(0, Math.floor(diff / 86_400_000))
}

// ── Вкладки: итоги и карточки видов ──
type GroupRow = TemporarySummary['period']['groups'][number]
const groupsByKey = computed(() => {
  const map = new Map<string, GroupRow>()
  for (const g of data.value?.period.groups ?? []) map.set(g.key, g)
  return map
})

/**
 * Число на фильтре — сколько строк он покажет. Берём из ленты, а не из итогов:
 * разобранная выдача в итог не входит, но в ленте видна.
 */
const rowsByKind = computed(() => {
  const map = new Map<string, number>()
  for (const h of data.value?.history ?? []) map.set(h.kind, (map.get(h.kind) ?? 0) + 1)
  return map
})

/** Виды потока: число строк и сумма за период. */
function leavesOf(flow: Flow) {
  return TREE[flow][SECTION]
    .map((ui) => {
      const g = groupsByKey.value.get(ui.key)
      return {
        ...ui,
        title: g?.title ?? ui.key,
        group: (g?.group ?? 'regular') as FlowGroup,
        count: rowsByKind.value.get(ui.key) ?? 0,
        amount: g?.amount ?? 0,
      }
    })
    .filter((c) => !c.onlyIfUsed || c.count > 0)
}
/**
 * Сумма потока за период по видам этой вкладки — из итогов (разобранные в
 * неё не входят). Не period.inAmount: тот считает и основные, и временные.
 */
function flowSum(flow: Flow): number {
  return keysOf(flow).reduce((s, k) => s + (groupsByKey.value.get(k)?.amount ?? 0), 0)
}

function kindColor(key: string, group: FlowGroup): string {
  return key === 'profitOut' ? PROFIT_COLOR : GROUP_COLOR[group]
}

/** Фильтр по виду: виды выбранного потока, справа — число операций за период. */
const kindOptions = computed(() =>
  leavesOf(tab.value).map((c) => ({
    value: c.key,
    label: c.title,
    hint: c.count ? String(c.count) : undefined,
    color: kindColor(c.key, c.group),
  })),
)

type HistoryRow = TemporarySummary['history'][number]

const history = computed(() => {
  const keys = keysOf(tab.value)
  return (data.value?.history ?? []).filter(
    (h) => h.flow === tab.value && keys.includes(h.kind) && (!kindFilter.value || h.kind === kindFilter.value),
  )
})
/** Выбранный вид — для подписи пустой ленты. */
const filterTitle = computed(() =>
  kindFilter.value ? groupsByKey.value.get(kindFilter.value)?.title ?? kindFilter.value : '',
)
/** Подпись кнопки «+» по выбранному потоку. */
const addLabel = computed(() => {
  if (tempMode) return tab.value === 'in' ? 'Пополнение' : 'Снятие'
  return tab.value === 'in' ? 'Пополнение' : 'Расход'
})
/** Чем пусто: «пополнений не было», «временных снятий не было». */
const emptyWhat = computed(() => {
  if (tempMode) {
    const what = tab.value === 'in' ? 'временных пополнений' : 'временных снятий'
    return statusTab.value === 'active' ? `активных ${what} нет` : `завершённых ${what} не было`
  }
  return tab.value === 'in' ? 'пополнений не было' : 'расходов не было'
})
/** Итог того, что сейчас в ленте: разобранные в итог не входят. */
const historySum = computed(() => history.value.filter((h) => !h.resolvedAs && !h.neutral).reduce((s, h) => s + h.amount, 0))

// ── «Временные»: одна таблица, секциями ──
//
// Строка — операция с её состоянием на сегодня: у временного пополнения или
// снятия — сколько вернули и осталось, у денег без назначения — разобраны
// ли. Незакрытое показываем всегда (долг сентября никуда не делся), закрытое
// и разобранное — только за выбранный период; возвраты — за период.
interface TempRow {
  key: string
  date: string | null
  title: string
  who: string
  note: string | null
  cashBoxName: string | null
  amount: number
  /** Долг этой строки — у временного пополнения или снятия. */
  debt: LiabilityView | null
  /** Долг, к которому относится строка (и у возврата) — клик открывает его карточку. */
  liabilityId: string | null
  /** Движение долга этой строки — у возврата: его правят и удаляют из таблицы. */
  movementId: string | null
  /** Справочная строка (перенос в основные): без знака и цвета, в итоги не входит. */
  neutral?: boolean
  /** Название временной операции — колонка «Название». */
  name?: string | null
  /** Разобранная без назначения: чем стала (сделка, долг) и можно ли отменить разбор. */
  link: { kind: 'deal'; dealId: string } | { kind: 'liability'; liabilityId: string } | null
  undoable: boolean
  /** Деньги без назначения: id операции и ещё ли ждёт разбора. */
  pendingId: string | null
  open: boolean
  resolvedAs: string | null
}
type TempSectionKey = 'debts' | 'pending' | 'returns' | 'converted'
interface TempSection {
  key: TempSectionKey
  title: string
  note: string
  summary: string
  alert: boolean
  rows: TempRow[]
}
/** Виды потока на «Временных»: выдача, деньги без назначения, возврат. */
const TEMP_FLOW: Record<Flow, { issue: string; pending: string; ret: string; conv: string | null; dir: 'BORROWED' | 'LENT'; pdir: 'IN' | 'OUT' }> = {
  in: { issue: 'borrowed', pending: 'pendingIn', ret: 'repaidToUs', conv: null, dir: 'BORROWED', pdir: 'IN' },
  out: { issue: 'lent', pending: 'pendingOut', ret: 'repaidByUs', conv: 'convertedToMain', dir: 'LENT', pdir: 'OUT' },
}
const SECTION_OF_KIND = (flow: Flow, kind: string): TempSectionKey | null => {
  const f = TEMP_FLOW[flow]
  return kind === f.issue ? 'debts' : kind === f.pending ? 'pending' : kind === f.ret ? 'returns' : kind === f.conv ? 'converted' : null
}
const byDateDesc = (a: TempRow, b: TempRow) => (b.date ?? '').localeCompare(a.date ?? '')

const tempSections = computed<TempSection[]>(() => {
  if (!tempMode || !data.value) return []
  const f = TEMP_FLOW[tab.value]
  const rows = data.value.history.filter((h) => h.flow === tab.value)
  const people = new Map(data.value.people.map((p) => [p.id, p]))
  const title = (kind: string) => groupsByKey.value.get(kind)?.title ?? kind
  const fromHistory = (h: HistoryRow): TempRow => ({
    key: h.id, date: h.date, title: h.title, who: h.who, note: h.note, cashBoxName: h.cashBoxName, name: h.name ?? null,
    amount: h.amount, debt: h.ref.type === 'liability' ? people.get(h.ref.id) ?? null : null,
    liabilityId: h.ref.type === 'liability' ? h.ref.id : null,
    movementId: h.ref.type === 'liability' ? h.ref.movementId ?? null : null,
    link: h.ref.type === 'pending' ? h.ref.link ?? null : null,
    undoable: h.ref.type === 'pending' && !!h.ref.undoable,
    pendingId: h.ref.type === 'pending' ? h.ref.id : null, open: h.openItem && !h.resolvedAs, resolvedAs: h.resolvedAs,
  })

  // Долги: выданные за период и все незакрытые — открытые сверху. Одна строка
  // на долг: «взяли ещё» у того же человека — тот же долг. Сумма строки —
  // выдано за период (как итог в шапке), всего — в «вернули X из Y», каждая
  // выдача — в карточке долга.
  const debts: TempRow[] = []
  const debtRow = new Map<string, TempRow>()
  for (const h of rows) {
    if (h.kind !== f.issue) continue
    const r = fromHistory(h)
    const same = r.liabilityId ? debtRow.get(r.liabilityId) : null
    if (same) {
      same.amount += r.amount
      continue
    }
    if (r.liabilityId) debtRow.set(r.liabilityId, r)
    debts.push(r)
  }
  const seenDebt = new Set(debtRow.keys())
  for (const l of data.value.people) {
    if (l.direction !== f.dir || l.status !== 'ACTIVE' || l.left <= 0 || seenDebt.has(l.id)) continue
    debts.push({
      key: `l-${l.id}`, date: l.createdAt ?? null, title: title(f.issue), who: l.personName, note: l.note, name: l.title ?? null,
      cashBoxName: l.cashBoxName ?? null, amount: l.principal, debt: l, liabilityId: l.id, movementId: null, link: null, undoable: false, pendingId: null,
      open: true, resolvedAs: null,
    })
  }
  for (const r of debts) r.open = !!r.debt && r.debt.status === 'ACTIVE' && r.debt.left > 0
  debts.sort((a, b) => Number(b.open) - Number(a.open) || byDateDesc(a, b))
  const left = debts.reduce((s, r) => s + (r.open ? r.debt!.left : 0), 0)

  // Деньги без назначения: за период и все неразобранные.
  const pending = rows.filter((h) => h.kind === f.pending).map(fromHistory)
  const seenPending = new Set(pending.map((r) => r.pendingId))
  for (const p of data.value.pending) {
    if (p.direction !== f.pdir || seenPending.has(p.id)) continue
    pending.push({
      key: `p-${p.id}`, name: p.title ?? null, date: p.date, title: title(f.pending), who: p.personName || p.accountName || '',
      note: p.note, cashBoxName: null, amount: p.amount, debt: null, liabilityId: null, movementId: null, link: null, undoable: false, pendingId: p.id,
      open: true, resolvedAs: null,
    })
  }
  pending.sort((a, b) => Number(b.open) - Number(a.open) || byDateDesc(a, b))
  const waiting = pending.filter((r) => r.open).length

  // Возврат — движение по долгу, а не сам долг: состояние долга у него не показываем.
  const returns = rows.filter((h) => h.kind === f.ret).map((h) => ({ ...fromHistory(h), debt: null })).sort(byDateDesc)
  // Перенесено в основные — стало расходом или снятием; деньгами не вернулось.
  const converted = f.conv
    ? rows.filter((h) => h.kind === f.conv).map((h) => ({ ...fromHistory(h), debt: null, neutral: true })).sort(byDateDesc)
    : []

  const all: TempSection[] = [
    {
      key: 'debts',
      title: tab.value === 'in' ? 'Должны вернуть мы' : 'Должны вернуть нам',
      note: tab.value === 'in' ? 'временные пополнения' : 'временные снятия',
      summary: left > 0 ? `осталось ${formatCurrency(left)}` : '',
      alert: overdueFor(tab.value),
      rows: debts,
    },
    {
      key: 'pending',
      title: tab.value === 'in' ? 'Поступления без назначения' : 'Выдачи без назначения',
      note: 'расход, доход или деньги вернули',
      summary: waiting ? `ждут разбора: ${waiting}` : '',
      alert: false,
      rows: pending,
    },
    {
      key: 'returns',
      title: tab.value === 'in' ? 'Нам вернули' : 'Мы вернули',
      note: tab.value === 'in' ? 'возвраты временных снятий' : 'возвраты временных пополнений',
      summary: returns.length ? formatCurrency(returns.reduce((s, r) => s + r.amount, 0)) : '',
      alert: false,
      rows: returns,
    },
    {
      key: 'converted',
      title: 'Перенесено в основные',
      note: 'стало расходом или снятием — деньгами не возвращалось',
      summary: converted.length ? formatCurrency(converted.reduce((s, r) => s + r.amount, 0)) : '',
      alert: false,
      rows: converted,
    },
  ]
  // Активные / Завершённые: долг ещё не вернули или операцию не разобрали —
  // в активных; вернули полностью, разобрали — в завершённых. Возвраты и
  // переносы — там же, где их долг.
  const debtOpen = (id: string | null) => {
    const l = id ? people.get(id) : null
    return !!l && l.status === 'ACTIVE' && l.left > 0
  }
  const isActive = (sec: TempSectionKey, r: TempRow) =>
    sec === 'returns' || sec === 'converted' ? debtOpen(r.liabilityId) : r.open
  const wantActive = statusTab.value === 'active'
  for (const sec of all) sec.rows = sec.rows.filter((r) => isActive(sec.key, r) === wantActive)
  // Во «Завершённых» нечего ждать: долги возвращены, операции разобраны —
  // свои заголовки, без остатков и тревоги о просрочке.
  if (!wantActive) {
    for (const sec of all) {
      sec.alert = false
      if (sec.key === 'debts') {
        sec.title = 'Возвращены полностью'
        sec.summary = ''
      } else if (sec.key === 'pending') {
        sec.note = 'разобраны'
        sec.summary = ''
      }
    }
  }
  const only = kindFilter.value ? SECTION_OF_KIND(tab.value, kindFilter.value) : null
  return all.filter((sec) => sec.rows.length && (!only || sec.key === only))
})
/** Строки таблицы по порядку секций — для страниц. */
const tempItems = computed(() => tempSections.value.flatMap((sec) => sec.rows.map((row) => ({ sec, row }))))

/**
 * Строку денег без назначения разбирают и правят в окне — нужна полная запись
 * со счётом. Неразобранные приходят с лентой все, без предела строк.
 */
const resolveOp = ref<PendingOpView | null>(null)
const canResolve = computed(() => auth.can('accounting.pending.resolve'))
function pendingOp(id: string | null): PendingOpView | null {
  const p = id ? data.value?.pending.find((x) => x.id === id) : null
  if (!p?.account) return null
  return {
    id: p.id, direction: p.direction, amount: p.amount, date: p.date, note: p.note,
    personName: p.personName, title: p.title ?? null, status: 'PENDING', account: p.account,
  }
}

/** Карточка долга: история, «взять ещё», возвраты, правка и удаление. */
const cardId = ref<string | null>(null)
/** Правка денег без назначения — пока не разобраны. */
const editPending = ref<PendingOpView | null>(null)

/**
 * Клик по строке долга или возврата — карточка долга со всей историей;
 * по разобранному поступлению — то, чем оно стало: сделка или долг.
 */
function tempRowClick(row: TempRow): (() => void) | null {
  if (row.liabilityId) return () => { cardId.value = row.liabilityId }
  const link = row.link
  if (link?.kind === 'deal') return () => { void router.push(`/deals/${link.dealId}`) }
  if (link?.kind === 'liability') return () => { cardId.value = link.liabilityId }
  return null
}

/**
 * Отменить разбор: «перевели по ошибке — вернули», а также оплату или возврат
 * долга, которых уже нет (сделку удалили из корзины). Поступление снова ждёт
 * разбора.
 */
async function undoResolve(row: TempRow) {
  if (!row.pendingId) return
  const ok = await confirmDelete({
    title: 'Отменить разбор?',
    text:
      `Поступление ${formatCurrency(row.amount)}${row.resolvedAs ? ` (сейчас: ${row.resolvedAs})` : ''} снова станет неразобранным, ` +
      'деньги на счетах вернутся к состоянию до разбора.',
    action: 'Отменить разбор',
  })
  if (!ok) return
  try {
    await store.unresolvePending(row.pendingId)
    toast.success('Разбор отменён — поступление снова ждёт разбора')
    await load()
  } catch (e: any) {
    toast.error(e, 'Не удалось отменить разбор')
  }
}

// ── Действия строки «Временных» — кнопками последней колонкой ──
// Удаление — отдельной кнопкой со своим окном, не внутри окна правки.
const editLiability = ref<LiabilityInfo | null>(null)

async function deleteDebt(l: LiabilityView) {
  const ok = await confirmDelete({
    title: 'Удалить долг?',
    warning: l.repaid > 0 ? `По нему уже вернули ${formatCurrency(l.repaid)} — эти возвраты тоже удалятся.` : undefined,
    text:
      `Долг ${l.personName} на ${formatCurrency(l.principal)} удалится вместе со всей историей, ` +
      'деньги на счетах вернутся к состоянию до долга.\nЗаписи останутся в истории счёта и в журнале действий.',
  })
  if (!ok) return
  try {
    await store.deleteLiability(l.id)
    toast.success('Долг удалён')
    await load()
  } catch (e: any) {
    toast.error(e, 'Не удалось удалить долг')
  }
}

async function deletePendingOp(op: PendingOpView) {
  const ok = await confirmDelete({
    title: 'Удалить операцию?',
    text:
      `${op.direction === 'IN' ? 'Поступление' : 'Выдача'} ${formatCurrency(op.amount)} · ${op.account.name} удалится, ` +
      'остаток счёта вернётся к состоянию до неё.\nЗапись останется в истории счёта и в журнале действий.',
  })
  if (!ok) return
  try {
    await store.deletePending(op.id)
    toast.success('Операция удалена')
    await load()
  } catch (e: any) {
    toast.error(e, 'Не удалось удалить')
  }
}

async function editReturn(row: TempRow) {
  if (!row.liabilityId || !row.movementId) return
  try {
    const card = await store.fetchLiability(row.liabilityId)
    const m = card.movements.find((x) => x.id === row.movementId)
    if (!m) return toast.error('Возврат не найден — обновите страницу')
    if (m.locked) return toast.error('Месяц кассы закрыт — этот возврат не изменить')
    openMovement(card, 'edit', m)
  } catch (e: any) {
    toast.error(e, 'Не удалось открыть возврат')
  }
}

/** Удалить перенос в основные — вместе с расходом или снятием, которым он стал. */
async function deleteConverted(row: TempRow) {
  if (!row.liabilityId || !row.movementId) return
  const ok = await confirmDelete({
    title: 'Удалить перенос?',
    text:
      `Перенос ${formatCurrency(row.amount)}${row.date ? ` от ${formatDate(row.date)}` : ''} — ${row.who} удалится вместе с операцией ` +
      'в «Пополнениях и расходах», долг снова вырастет на эту сумму.\nЗапись останется в журнале действий.',
  })
  if (!ok) return
  try {
    await store.deleteLiabilityMovement(row.liabilityId, row.movementId)
    toast.success('Перенос удалён')
    await load()
  } catch (e: any) {
    toast.error(e, 'Не удалось удалить перенос')
  }
}

async function deleteReturn(row: TempRow) {
  if (!row.liabilityId || !row.movementId) return
  const ok = await confirmDelete({
    title: 'Удалить возврат?',
    text:
      `Возврат ${formatCurrency(row.amount)}${row.date ? ` от ${formatDate(row.date)}` : ''} — ${row.who} удалится, ` +
      'долг снова станет открытым на эту сумму.\nЗапись останется в истории счёта и в журнале действий.',
  })
  if (!ok) return
  try {
    await store.deleteLiabilityMovement(row.liabilityId, row.movementId)
    toast.success('Возврат удалён')
    await load()
  } catch (e: any) {
    toast.error(e, 'Не удалось удалить возврат')
  }
}

// ── Страницы ленты — наша обычная пагинация ──
// Лента за период приходит целиком (по ней же считаются итоги), а рисуется
// страницами: «за всё время» у крупного партнёра это сотни строк.
const page = ref(1)
const perPage = usePageSize('flows:page-size')
/** Сколько строк уже показано в режиме подгрузки при прокрутке. */
const shown = ref(perPage.value)
/** Сколько строк в ленте: на «Временных» — строки секций. */
const listLength = computed(() => (tempMode ? tempItems.value.length : history.value.length))
const hasMoreRows = computed(() => shown.value < listLength.value)
const autoLoad = useAutoLoad({
  storageKey: 'flows:auto-load',
  hasMore: hasMoreRows,
  busy: ref(false),
  loadMore: () => { shown.value += perPage.value },
})
const autoLoadSentinel = autoLoad.sentinel
function pageOf<T>(list: T[]): T[] {
  return autoLoad.enabled.value
    ? list.slice(0, shown.value)
    : list.slice((page.value - 1) * perPage.value, page.value * perPage.value)
}
const visibleHistory = computed(() => pageOf(history.value))
const visibleTemp = computed(() => pageOf(tempItems.value))
// Другая выборка (ветка, вид, период, касса) — снова с начала.
watch([history, tempSections, perPage, () => autoLoad.enabled.value], () => {
  page.value = 1
  shown.value = perPage.value
  autoLoad.reset()
})

// ── Действия из ленты ──
const editTx = ref<ManualTx | null>(null)
const showEditTx = ref(false)
const cancelCapitalRow = ref<HistoryRow | null>(null)
const cancelling = ref(false)

/** Доход или расход — правят и удаляют кнопками в строке. */
const canTxActions = (h: HistoryRow) => h.ref.type === 'transaction' && !h.ref.convertedFrom && canEditTx.value
/** Вложение или снятие капитала — отменяют своим окном. */
const canCancelRow = (h: HistoryRow) => h.ref.type === 'capital' && !h.ref.convertedFrom && canCancelCapital.value
/** Операция перенесена из временного снятия: правится и удаляется в карточке долга. */
function convertedFromOf(h: HistoryRow) {
  return h.ref.type === 'transaction' || h.ref.type === 'capital' ? h.ref.convertedFrom ?? null : null
}

function editTxRow(h: HistoryRow) {
  if (h.ref.type === 'transaction') {
    editTx.value = {
      id: h.ref.id,
      type: h.kind === 'income' ? 'INCOME' : 'EXPENSE',
      expenseKind: h.ref.expenseKind,
      amount: h.amount,
      description: h.note,
      categoryId: h.ref.categoryId,
      cashBoxId: h.ref.cashBoxId,
      date: h.date,
      affectsInvestors: h.ref.affectsInvestors,
      fromCapital: h.ref.fromCapital,
    }
    showEditTx.value = true
  }
}

async function deleteTxRow(h: HistoryRow) {
  if (h.ref.type !== 'transaction') return
  const income = h.kind === 'income'
  const ok = await confirmDelete({
    title: income ? 'Удалить доход?' : 'Удалить расход?',
    text: `${income ? 'Доход' : 'Расход'} на ${formatCurrency(h.amount)} от ${formatDate(h.date)} удалится, деньги кассы пересчитаются. Вернуть операцию будет нельзя.`,
  })
  if (!ok) return
  try {
    await api.delete(`/finance/transactions/${h.ref.id}`)
    toast.success('Операция удалена')
    await load()
  } catch (e: any) {
    toast.error(e, 'Не удалось удалить')
  }
}

async function confirmCancelCapital() {
  const h = cancelCapitalRow.value
  if (!h || h.ref.type !== 'capital') return
  cancelling.value = true
  try {
    await cashboxes.cancelPartnerCapital(h.ref.cashBoxId, h.ref.id)
    toast.success('Операция отменена')
    cancelCapitalRow.value = null
    await load()
  } catch (e: any) {
    toast.error(e, 'Не удалось отменить')
  } finally {
    cancelling.value = false
  }
}

const showCategories = ref(false)

// ── Возврат и правка возврата ──
// Окно то же, что в карточке долга: сумма, счёт кассы долга, дата.
const movementCard = ref<LiabilityCard | null>(null)
const movementMode = ref<LiabilityMovementMode>('repay')
const movementRow = ref<LiabilityMovementView | null>(null)
const showMovement = ref(false)

function openMovement(card: LiabilityCard, mode: LiabilityMovementMode, m: LiabilityMovementView | null = null) {
  movementCard.value = card
  movementMode.value = mode
  movementRow.value = m
  showMovement.value = true
}

async function openRepay(l: LiabilityView) {
  try {
    openMovement(await store.fetchLiability(l.id), 'repay')
  } catch (e: any) {
    toast.error(e, 'Не удалось открыть долг')
  }
}

// ── Новая операция ──
const showOperation = ref(false)
const operationKind = ref<OperationKind>('EXPENSE')
const operationCashBox = ref<string | null>(null)
function newOperation(kind: OperationKind, boxId?: string | null) {
  operationKind.value = kind
  operationCashBox.value = boxId ?? cashBoxId.value
  showOperation.value = true
}

</script>

<template>
  <div class="tp-page" :class="{ dark: isDark }">
    <AccountingTabs />

    <div v-if="tempMode && data?.open.overdueCount" class="tp-alert">
      <v-icon icon="mdi-alert-circle-outline" size="18" />
      <span>
        Просрочено временных расчётов: {{ data.open.overdueCount }} — срок возврата прошёл,
        а деньги не вернулись.
      </span>
      <button class="tp-alert-link" @click="openTemp(overdueFlow)">Показать</button>
    </div>


    <!-- ── Лента за период ── -->
    <div ref="listCard" class="tp-card">
      <div class="tp-toolbar">
        <!-- Два потока табами; вид операции — фильтром справа. -->
        <div class="tp-flowtabs">
          <button
            v-for="f in FLOWS"
            :key="f"
            class="tp-flowtab"
            :class="{ 'tp-flowtab--on': tab === f }"
            @click="select(f)"
          >
            <span class="tp-flowtab-ico" :class="f === 'in' ? 'tp-bg-in' : 'tp-bg-out'">
              <v-icon :icon="f === 'in' ? 'mdi-arrow-down-left' : 'mdi-arrow-up-right'" size="15" />
            </span>
            {{ FLOW_TITLE[f] }}
            <span class="tp-flowtab-sum" :class="f === 'in' ? 'tp-in' : 'tp-out'">
              {{ f === 'in' ? '+' : '−' }}{{ formatCurrency(flowSum(f)) }}
            </span>
          </button>
        </div>
        <div class="tp-toolbar-ctl">
          <button v-if="canCategories && !tempMode" class="tp-btn" type="button" title="Статьи доходов и расходов" @click="showCategories = true">
            <v-icon icon="mdi-tag-multiple-outline" size="16" />
            <span class="tp-btn-text">Статьи</span>
          </button>
          <!-- Новая операция: один вид — сразу форма, несколько — меню, как
               кнопка «Операции» на «Балансе». -->
          <button v-if="tabKinds.length === 1" class="tp-btn tp-btn--main" @click="newOperation(tabKinds[0]!)">
            <v-icon icon="mdi-plus" size="16" />
            {{ addLabel }}
          </button>
          <v-menu v-else-if="tabKinds.length" location="bottom end" offset="6">
            <template #activator="{ props: menuProps }">
              <button class="tp-btn tp-btn--main" v-bind="menuProps">
                <v-icon icon="mdi-plus" size="16" />
                {{ addLabel }}
                <v-icon icon="mdi-chevron-down" size="15" />
              </button>
            </template>
            <v-card rounded="lg" elevation="6" class="tp-opmenu">
              <AccountOperationItems
                :kinds="tabKinds"
                :titles="tempMode ? { out: 'Снятие' } : undefined"
                @pick="newOperation($event)"
              />
            </v-card>
          </v-menu>
        </div>
      </div>

      <!-- Фильтры ленты: касса, вид операции, период. -->
      <div class="tp-filters">
        <!-- Касса меняет всю ленту: её операции и итоги. -->
        <div v-if="cashBoxOptions.length > 1" class="tp-box">
          <SelectField v-model="cashBoxId" :options="cashBoxOptions" empty-label="Все кассы" placeholder="Все кассы" />
        </div>
        <!-- «Временные»: активные или завершённые — по умолчанию активные. -->
        <div v-if="tempMode" class="tp-status">
          <button type="button" class="tp-status-btn" :class="{ 'tp-status-btn--on': statusTab === 'active' }" @click="statusTab = 'active'">
            Активные
          </button>
          <button type="button" class="tp-status-btn" :class="{ 'tp-status-btn--on': statusTab === 'done' }" @click="statusTab = 'done'">
            Завершённые
          </button>
        </div>
        <!-- Вид операции выбранного потока — с числом операций за период. -->
        <div class="tp-kind">
          <SelectField
            :model-value="kindFilter"
            :options="kindOptions"
            empty-label="Все виды"
            placeholder="Все виды"
            @update:model-value="select(tab, $event)"
          />
        </div>
        <MonthYearPicker v-model="period" class="tp-period" />
      </div>

      <div class="tp-body">
        <div class="tp-main">
          <!-- Заголовок ленты крупно — в каком периоде работаем (просьба владельца). -->
          <div class="tp-list-head">
            <span class="tp-list-title">
              Операции {{ periodPhrase }}
              <span v-if="tempMode && statusTab === 'active'" class="tp-temp-note"> · незакрытое — за всё время</span>
            </span>
            <span v-if="history.length" class="tp-list-sum" :class="tab === 'in' ? 'tp-in' : 'tp-out'">
              {{ tab === 'in' ? '+' : '−' }}{{ formatCurrency(historySum) }}
            </span>
          </div>

          <div v-if="loading && !data" class="tp-loading">
            <v-progress-circular indeterminate color="primary" />
          </div>

          <div v-else-if="!listLength" class="tp-empty">
            <v-icon icon="mdi-timeline-text-outline" size="26" />
            <div class="tp-empty-title">Операций нет</div>
            <div class="tp-empty-text">
              {{ periodPhrase.charAt(0).toUpperCase() + periodPhrase.slice(1) }}
              {{ filterTitle ? `«${filterTitle.toLowerCase()}» не было` : emptyWhat }}.
              Смените период или добавьте операцию кнопкой «{{ addLabel }}».
            </div>
          </div>

          <!-- Временные: секции одной таблицы, в строке — состояние на сегодня. -->
          <div v-else-if="tempMode" class="tp-table">
            <div class="tp-tr tp-tr--head tp-tr--temp">
              <div>Дата</div>
              <div>Операция</div>
              <div>Название</div>
              <div>С кем, состояние</div>
              <div class="tp-td--right">Сумма</div>
              <div />
            </div>
            <template v-for="(it, i) in visibleTemp" :key="it.row.key">
              <div
                v-if="i === 0 || visibleTemp[i - 1]!.sec.key !== it.sec.key"
                class="tp-sec"
                :class="`tp-sec--${it.sec.key}`"
              >
                <span class="tp-sec-title">{{ it.sec.title }}</span>
                <span class="tp-temp-note">{{ it.sec.note }}</span>
                <span v-if="it.sec.summary" class="tp-sec-sum" :class="{ 'tp-alert-sum': it.sec.alert }">
                  {{ it.sec.summary }}
                </span>
              </div>
              <div
                class="tp-tr tp-tr--temp"
                :class="{
                  'tp-tr--overdue': it.row.open && it.row.debt?.overdue,
                  'tp-tr--resolved': !!it.row.resolvedAs,
                  'tp-tr--click': !!tempRowClick(it.row),
                }"
                @click="tempRowClick(it.row)?.()"
              >
                <div class="tp-td-date" :title="it.row.date ? formatDate(it.row.date) : ''">
                  {{ it.row.date ? formatDateShort(it.row.date) : '—' }}
                </div>
                <div class="tp-td-op">
                  <span class="tp-dot" :style="{ background: GROUP_COLOR.temporary }" />
                  <span>{{ it.row.title }}</span>
                </div>
                <div class="tp-td-name" :class="{ 'tp-td-name--empty': !it.row.name }" :title="it.row.name ?? ''">
                  {{ it.row.name || '—' }}
                </div>
                <div class="tp-td-state">
                  <div class="tp-td-who">
                    {{ it.row.who || '—' }}<span v-if="it.row.note" class="tp-td-note"> · {{ it.row.note }}</span>
                    <span v-if="it.row.cashBoxName && !cashBoxId" class="tp-td-note"> · {{ it.row.cashBoxName }}</span>
                  </div>
                  <!-- Долг: сколько вернули, срок, просрочка — полосой. -->
                  <template v-if="it.row.debt">
                    <div class="tp-state-line">
                      <template v-if="it.row.open">
                        вернули {{ formatCurrency(it.row.debt.repaid) }} из {{ formatCurrency(it.row.debt.principal) }}
                        <span v-if="(it.row.debt.issueCount ?? 0) > 1" class="tp-badge tp-badge--wait">
                          {{ it.row.debt.direction === 'BORROWED' ? 'брали' : 'давали' }} {{ timesText(it.row.debt.issueCount ?? 0) }}
                        </span>
                        <template v-if="it.row.debt.dueDate"> · до {{ formatDate(it.row.debt.dueDate) }}</template>
                        <span v-if="it.row.debt.overdue" class="tp-badge">просрочено {{ daysOverdue(it.row.debt) }} дн.</span>
                      </template>
                      <span v-else class="tp-badge tp-badge--done">возвращено полностью</span>
                    </div>
                    <div v-if="it.row.open" class="tp-progress" :title="`Вернули ${formatCurrency(it.row.debt.repaid)} из ${formatCurrency(it.row.debt.principal)}`">
                      <div class="tp-progress-fill" :style="{ width: repaidPct(it.row.debt) + '%' }" />
                    </div>
                  </template>
                  <!-- Деньги без назначения: ждут разбора или чем оказались. -->
                  <div v-else-if="it.row.pendingId" class="tp-state-line">
                    <span v-if="it.row.open" class="tp-badge tp-badge--wait-blue">ждёт разбора</span>
                    <span v-else-if="it.row.resolvedAs" class="tp-badge tp-badge--wait">разобрано: {{ it.row.resolvedAs }}</span>
                  </div>
                </div>
                <div class="tp-td--right">
                  <!-- Перенос в основные деньгами не двигался — без знака и цвета. -->
                  <div v-if="it.row.neutral" class="tp-num">{{ formatCurrency(it.row.amount) }}</div>
                  <div v-else class="tp-num" :class="it.row.resolvedAs ? '' : tab === 'in' ? 'tp-in' : 'tp-out'">
                    {{ tab === 'in' ? '+' : '−' }}{{ formatCurrency(it.row.amount) }}
                  </div>
                  <div v-if="it.row.open && it.row.debt" class="tp-num-sub">осталось {{ formatCurrency(it.row.debt.left) }}</div>
                </div>
                <!-- Действия — последней колонкой: основное словом, правка и
                     удаление значками; удаление — своим окном. -->
                <div class="tp-td-act tp-td-act--btn" @click.stop>
                  <button
                    v-if="it.row.open && it.row.debt && canManage"
                    class="tp-btn tp-btn--sm"
                    @click="openRepay(it.row.debt)"
                  >
                    {{ it.row.debt.direction === 'BORROWED' ? 'Вернуть' : 'Принять' }}
                  </button>
                  <button
                    v-else-if="it.row.open && it.row.pendingId && canResolve && pendingOp(it.row.pendingId)"
                    class="tp-btn tp-btn--sm"
                    @click="resolveOp = pendingOp(it.row.pendingId)"
                  >
                    Разобрать
                  </button>
                  <div v-if="canEditTemp" class="row-actions">
                    <!-- Долг: с кем, срок, комментарий; удалить целиком. -->
                    <template v-if="it.sec.key === 'debts' && it.row.debt">
                      <button class="row-action-btn" title="Изменить" @click="editLiability = it.row.debt">
                        <v-icon icon="mdi-pencil-outline" size="16" />
                      </button>
                      <button class="row-action-btn row-action-btn--delete" title="Удалить долг" @click="deleteDebt(it.row.debt)">
                        <v-icon icon="mdi-trash-can-outline" size="16" />
                      </button>
                    </template>
                    <!-- Без назначения — пока не разобрана. -->
                    <template v-else-if="it.sec.key === 'pending' && it.row.open && pendingOp(it.row.pendingId)">
                      <button class="row-action-btn" title="Изменить" @click="editPending = pendingOp(it.row.pendingId)">
                        <v-icon icon="mdi-pencil-outline" size="16" />
                      </button>
                      <button class="row-action-btn row-action-btn--delete" title="Удалить" @click="deletePendingOp(pendingOp(it.row.pendingId)!)">
                        <v-icon icon="mdi-trash-can-outline" size="16" />
                      </button>
                    </template>
                    <!-- Разбор можно отменить: ошибочный перевод или оплата/возврат, которых уже нет. -->
                    <template v-else-if="it.sec.key === 'pending' && it.row.undoable">
                      <button class="row-action-btn row-action-btn--warning" title="Отменить разбор" @click="undoResolve(it.row)">
                        <v-icon icon="mdi-undo-variant" size="16" />
                      </button>
                    </template>
                    <!-- Перенос в основные — только удалить (вместе с его операцией). -->
                    <template v-else-if="it.sec.key === 'converted' && it.row.movementId && canManage">
                      <button class="row-action-btn row-action-btn--delete" title="Удалить перенос" @click="deleteConverted(it.row)">
                        <v-icon icon="mdi-trash-can-outline" size="16" />
                      </button>
                    </template>
                    <!-- Возврат по долгу. -->
                    <template v-else-if="it.sec.key === 'returns' && it.row.movementId">
                      <button class="row-action-btn" title="Изменить" @click="editReturn(it.row)">
                        <v-icon icon="mdi-pencil-outline" size="16" />
                      </button>
                      <button class="row-action-btn row-action-btn--delete" title="Удалить" @click="deleteReturn(it.row)">
                        <v-icon icon="mdi-trash-can-outline" size="16" />
                      </button>
                    </template>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div v-else class="tp-table">
            <div class="tp-tr tp-tr--head">
              <div>Дата</div>
              <div>Операция</div>
              <div>Статья, с кем, касса</div>
              <div class="tp-td--right">Сумма</div>
              <div />
            </div>
            <div
              v-for="h in visibleHistory"
              :key="h.id"
              class="tp-tr"
              :class="{ 'tp-tr--resolved': !!h.resolvedAs }"
            >
              <div class="tp-td-date" :title="formatDate(h.date)">{{ formatDateShort(h.date) }}</div>
              <div class="tp-td-op">
                <span class="tp-dot" :style="{ background: kindColor(h.kind, h.group) }" />
                <span>{{ h.title }}</span>
              </div>
              <div class="tp-td-who">
                {{ h.who || '—' }}<span v-if="h.note" class="tp-td-note"> · {{ h.note }}</span>
                <span v-if="h.cashBoxName && !cashBoxId" class="tp-td-note"> · {{ h.cashBoxName }}</span>
                <!-- Перенесено из временного снятия — клик открывает карточку долга. -->
                <button
                  v-if="convertedFromOf(h)"
                  type="button"
                  class="tp-badge tp-badge--wait tp-badge--link"
                  title="Правится и удаляется в карточке долга"
                  @click.stop="cardId = convertedFromOf(h)!.liabilityId"
                >
                  перенесено из временного снятия: {{ convertedFromOf(h)!.personName }}
                </button>
                <span v-if="h.split" class="tp-badge tp-badge--wait" :title="`Одно снятие на ${formatCurrency(h.split.total)}: прибыль ${formatCurrency(h.split.profit)} + капитал ${formatCurrency(h.split.capital)}`">
                  часть снятия {{ formatCurrency(h.split.total) }}
                </span>
                <span v-if="h.openItem" class="tp-badge tp-badge--wait">ждёт разбора</span>
                <span v-if="h.resolvedAs" class="tp-badge tp-badge--wait" title="Учтено в итоге той операцией, в которую разнесли">
                  разобрано: {{ h.resolvedAs }}
                </span>
              </div>
              <div class="tp-td--right tp-num" :class="h.resolvedAs ? '' : h.flow === 'in' ? 'tp-in' : 'tp-out'">
                {{ h.flow === 'in' ? '+' : '−' }}{{ formatCurrency(h.amount) }}
              </div>
              <!-- Действия — последней колонкой; удаление — своим окном. -->
              <div class="tp-td-act">
                <div v-if="canTxActions(h)" class="row-actions">
                  <button class="row-action-btn" title="Изменить" @click="editTxRow(h)">
                    <v-icon icon="mdi-pencil-outline" size="16" />
                  </button>
                  <button class="row-action-btn row-action-btn--delete" title="Удалить" @click="deleteTxRow(h)">
                    <v-icon icon="mdi-trash-can-outline" size="16" />
                  </button>
                </div>
                <div v-else-if="canCancelRow(h)" class="row-actions">
                  <button class="row-action-btn row-action-btn--warning" title="Отменить операцию" @click="cancelCapitalRow = h">
                    <v-icon icon="mdi-undo-variant" size="16" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Пагинация как в остальных разделах: прилипает к низу экрана,
               номера страниц, размер страницы и подгрузка при прокрутке. -->
          <div v-if="autoLoad.enabled.value" ref="autoLoadSentinel" class="tp-sentinel" />
          <ServerPager
            v-if="listLength > 0"
            class="tp-pager"
            :page="page"
            :total="listLength"
            :per-page="perPage"
            :per-page-options="PER_PAGE_OPTIONS"
            :auto-load="autoLoad.enabled.value"
            :loaded="tempMode ? visibleTemp.length : visibleHistory.length"
            :has-more="hasMoreRows"
            @update:page="page = $event"
            @update:per-page="perPage = $event"
            @update:auto-load="autoLoad.enabled.value = $event"
            @load-more="autoLoad.loadMoreManually()"
          />
        </div>
      </div>
    </div>

    <!-- Возврат: сумма, счёт кассы долга, дата -->
    <LiabilityMovementDialog
      v-model="showMovement"
      :card="movementCard"
      :mode="movementMode"
      :movement="movementRow"
      @done="load"
    />
    <LiabilityEditDialog v-model:liability="editLiability" @done="load" />

    <!-- Отмена вложения или снятия — по ошибке внесённое -->
    <v-dialog :model-value="!!cancelCapitalRow" max-width="440" @update:model-value="cancelCapitalRow = null">
      <v-card rounded="lg" class="pa-5">
        <div class="tp-dlg-title">Отменить операцию?</div>
        <div class="tp-dlg-sub">
          <template v-if="cancelCapitalRow?.split">
            Снятие на {{ formatCurrency(cancelCapitalRow.split.total) }} отменится целиком:
            прибыль {{ formatCurrency(cancelCapitalRow.split.profit) }} и капитал
            {{ formatCurrency(cancelCapitalRow.split.capital) }}
          </template>
          <template v-else>
            {{ cancelCapitalRow?.title }} на {{ formatCurrency(cancelCapitalRow?.amount ?? 0) }}
          </template>
          <template v-if="cancelCapitalRow?.cashBoxName"> · {{ cancelCapitalRow.cashBoxName }}</template>.
          Капитал, прибыль к снятию и остаток кассы пересчитаются, как будто операции не было.
        </div>
        <div class="d-flex justify-end ga-2 mt-4">
          <button class="tp-btn" @click="cancelCapitalRow = null">Не отменять</button>
          <button class="tp-btn tp-btn--danger" :disabled="cancelling" @click="confirmCancelCapital">Отменить операцию</button>
        </div>
      </v-card>
    </v-dialog>

    <PendingResolveDialog v-model:op="resolveOp" @changed="load" />
    <PendingEditDialog v-model:op="editPending" @changed="load" />
    <LiabilityCardDialog v-model:liability-id="cardId" @changed="load" />
    <ManualTxEditDialog v-model="showEditTx" :tx="editTx" @done="load" />
    <CategoriesDialog v-model="showCategories" />
    <OperationDialog v-model="showOperation" :kind="operationKind" :cash-box-id="operationCashBox" @done="load" />
  </div>
</template>


<style scoped>
.tp-page { padding: 24px 28px 40px; }
.tp-loading { display: flex; justify-content: center; align-items: center; min-height: 160px; }
.tp-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; }

/* «Снять прибыль» — главная кнопка раздела: белая на зелёном, заметнее всего. */





.tp-alert {
  display: flex; align-items: center; gap: 9px;
  padding: 12px 15px; border-radius: 12px; margin-bottom: 14px;
  font-size: 13px; font-weight: 600;
  background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); color: #b45309;
}
.tp-alert-link {
  margin-left: auto; padding: 0; border: none; background: none; cursor: pointer;
  font-size: 13px; font-weight: 700; color: inherit; text-decoration: underline;
}

/* ── Лента за период ── */
/* overflow: visible — иначе пагинация не прилипает к низу экрана (sticky не
   работает внутри контейнера с обрезкой); углы держит border-radius у шапки. */
.tp-card {
  border-radius: 14px; margin-bottom: 18px; overflow: visible;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.tp-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; padding: 14px 16px 10px;
}
.tp-toolbar-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tp-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 0 16px 12px; }
/* Вид (и касса) — слева, период — справа. */
.tp-filters .tp-period { margin-left: auto; }
.tp-box { min-width: 190px; }
.tp-kind { min-width: 210px; }

/* Табы потоков — «Пополнения / Расходы» с суммами за период. */
.tp-flowtabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; background: rgba(var(--v-theme-on-surface), 0.05); }
.tp-flowtab {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 14px 7px 8px; border-radius: 10px; border: none; cursor: pointer; background: none;
  font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.55);
}
.tp-flowtab--on { background: rgb(var(--v-theme-surface)); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); color: rgba(var(--v-theme-on-surface), 0.92); }
.tp-flowtab-ico { width: 26px; height: 26px; border-radius: 8px; flex: none; display: inline-flex; align-items: center; justify-content: center; }
.tp-flowtab-sum { font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tp-flowtab:not(.tp-flowtab--on) .tp-flowtab-sum { opacity: 0.6; }

/* ── Лента ── */
.tp-body { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
.tp-main { min-width: 0; display: flex; flex-direction: column; }
/* Пагинация — во всю ширину ленты: у неё отрицательные поля под padding
   карточки, а у ленты своего padding нет. margin-top: auto — прижать к низу. */
.tp-pager { margin: auto 0 0 !important; border-radius: 0 0 14px 14px !important; }
.tp-sentinel { height: 1px; }
.tp-main > :first-child { border-top: none; }

.tp-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 14px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.tp-btn:hover:not(:disabled) { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.tp-btn:disabled { opacity: 0.6; cursor: default; }
.tp-btn--main { background: #047857; border-color: #047857; color: #fff; }
.tp-btn--main:hover:not(:disabled) { background: #036b4e; border-color: #036b4e; color: #fff; }
.tp-btn--sm { height: 34px; padding: 0 12px; font-size: 12.5px; }
.tp-btn--danger { background: #dc2626; border-color: #dc2626; color: #fff; }
.tp-btn--danger:hover:not(:disabled) { background: #b91c1c; border-color: #b91c1c; color: #fff; }
.tp-opmenu { padding: 6px; min-width: 300px; max-width: 340px; }

.tp-temp-note { font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.42); }
.tp-alert-sum { color: #dc2626 !important; }

/* Секции «Временных» — заголовки внутри таблицы, своим цветом каждая. */
.tp-sec {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; scroll-margin-top: 90px;
  padding: 9px 18px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.7);
}
.tp-sec-title { font-weight: 700; }
.tp-sec-sum { margin-left: auto; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tp-sec--debts { background: rgba(245, 158, 11, 0.06); }
.tp-sec--pending { background: rgba(99, 102, 241, 0.05); }
.tp-sec--pending .tp-sec-sum { color: #4f46e5; }
.tp-sec--returns { background: rgba(var(--v-theme-on-surface), 0.025); }

.tp-list-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 18px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  font-size: 12.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.5);
}
.tp-list-title { font-size: 20px; font-weight: 800; letter-spacing: -0.2px; color: rgba(var(--v-theme-on-surface), 0.9); }
.tp-list-title .tp-temp-note { font-size: 13px; font-weight: 500; letter-spacing: 0; }
.tp-list-sum { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }

/* Отступ под последней строкой: панель страниц прилипает к низу и тенью
   накрывала строку, стоявшую вплотную к ней. */
.tp-table { width: 100%; padding-bottom: 18px; }
.tp-table > .tp-tr:last-child { border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06); }
.tp-tr {
  display: grid; grid-template-columns: 92px minmax(170px, 1fr) minmax(160px, 1.4fr) 130px 76px;
  align-items: center; gap: 12px; padding: 11px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.tp-tr--head {
  padding: 10px 18px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4); background: rgba(var(--v-theme-on-surface), 0.02);
}
.tp-tr:not(.tp-tr--head):hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.tp-tr--click { cursor: pointer; }
/* Разобранная выдача — для истории: её деньги уже учтены той операцией, в
   которую её разнесли, поэтому сумма не цветная и в итог не входит. */
.tp-tr--resolved { opacity: 0.6; }
.tp-td-act { display: flex; justify-content: flex-end; color: rgba(var(--v-theme-on-surface), 0.4); }
.tp-td-date { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); font-variant-numeric: tabular-nums; }
.tp-td-op { display: flex; align-items: center; gap: 9px; font-size: 13.5px; font-weight: 600; }
.tp-td-who { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-td-note { color: rgba(var(--v-theme-on-surface), 0.4); }
.tp-td--right { text-align: right; }
.tp-num { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tp-in { color: #047857; }
.tp-out { color: #b45309; }

.tp-badge {
  padding: 1px 7px; border-radius: 6px; font-size: 10.5px; font-weight: 700;
  background: rgba(245, 158, 11, 0.16); color: #b45309; margin-left: 4px;
}
.tp-badge--wait { background: rgba(var(--v-theme-on-surface), 0.07); color: rgba(var(--v-theme-on-surface), 0.5); }

.tp-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 40px 24px; text-align: center; color: rgba(var(--v-theme-on-surface), 0.45);
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.tp-empty--sm { padding: 22px 24px; flex-direction: row; justify-content: center; border-top: none; }
.tp-empty-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.tp-empty-text { font-size: 13px; max-width: 420px; line-height: 1.5; }

.tp-bg-in { background: rgba(4, 120, 87, 0.12); color: #047857; }
.tp-bg-out { background: rgba(180, 83, 9, 0.12); color: #b45309; }

/* Строка «Временных»: кроме ленты — состояние на сегодня и кнопка действия. */
.tp-tr--temp { grid-template-columns: 92px minmax(150px, 0.9fr) minmax(140px, 1fr) minmax(200px, 1.4fr) 140px 184px; }
.tp-td-name { min-width: 0; font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-td-name--empty { font-weight: 400; color: rgba(var(--v-theme-on-surface), 0.3); }
/* Активные / Завершённые — компактный переключатель рядом с видом. */
/* Высота — как у селекта видов рядом (42px), чтобы ряд фильтров был ровным. */
.tp-status {
  display: inline-flex; align-items: stretch; gap: 2px; box-sizing: border-box; height: 42px; padding: 3px;
  border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.05);
}
.tp-status-btn {
  display: inline-flex; align-items: center; padding: 0 14px; border: none; border-radius: 8px; background: none; cursor: pointer;
  font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.55);
}
.tp-status-btn--on { background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.92); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }
.tp-tr--overdue { background: rgba(245, 158, 11, 0.05); }
.tp-td-state { min-width: 0; }
.tp-state-line { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-top: 3px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.tp-state-line .tp-badge { margin-left: 0; }
.tp-progress { height: 3px; border-radius: 2px; margin-top: 6px; max-width: 280px; background: rgba(var(--v-theme-on-surface), 0.08); }
.tp-progress-fill { height: 100%; border-radius: 2px; background: #047857; opacity: 0.7; }
.tp-num-sub { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; font-variant-numeric: tabular-nums; }
.tp-td-act--btn { color: inherit; align-items: center; gap: 6px; }
.tp-badge--done { background: rgba(4, 120, 87, 0.1); color: #047857; }
.tp-badge--link { border: none; cursor: pointer; }
.tp-badge--link:hover { text-decoration: underline; }
.tp-sec--converted { background: rgba(var(--v-theme-on-surface), 0.025); }
.tp-badge--wait-blue { background: rgba(99, 102, 241, 0.12); color: #4f46e5; }

.tp-dlg-title { font-size: 17px; font-weight: 700; }
.tp-dlg-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 4px; line-height: 1.5; }

@media (max-width: 760px) {
  .tp-page { padding: 16px 16px 40px; }
  .tp-toolbar { padding: 12px 12px 8px; }

  .tp-flowtabs { width: 100%; }
  .tp-flowtab { flex: 1; justify-content: center; padding: 7px 8px; flex-wrap: wrap; gap: 4px 8px; }
  .tp-toolbar-ctl { width: 100%; }
  .tp-filters { padding: 0 12px 12px; }
  .tp-box, .tp-kind { flex: 1 1 100%; min-width: 0; }
  .tp-period { flex: 1 1 100%; justify-content: space-between; }
  .tp-toolbar-ctl .tp-btn--main { flex: 1; justify-content: center; }
  .tp-btn-text { display: none; }
  /* Таблица на телефоне — карточками: четыре колонки в 360 px не помещаются. */
  .tp-tr { grid-template-columns: 1fr auto; row-gap: 4px; padding: 12px 14px; }
  .tp-tr--head { display: none; }
  .tp-td-date { grid-column: 1; order: 1; }
  .tp-td--right { grid-column: 2; grid-row: 1 / span 2; order: 2; align-self: center; }
  .tp-td-op { grid-column: 1; order: 3; }
  /* Название — отдельной строкой под видом операции; пустое не показываем. */
  .tp-tr--temp .tp-td-name { grid-column: 1 / -1; order: 3; }
  .tp-tr--temp .tp-td-name--empty { display: none; }
  .tp-status { flex: 1 1 100%; }
  .tp-status-btn { flex: 1; }
  .tp-td-who { grid-column: 1 / -1; order: 4; white-space: normal; }
  /* Действия — во всю ширину под строкой. */
  .tp-td-act { grid-column: 1 / -1; order: 5; justify-content: flex-start; }
  .tp-td-act:empty { display: none; }
  .tp-list-head { padding: 12px 14px; }
  .tp-list-title, .tp-list-sum { font-size: 17px; }
  /* «Временные» на телефоне: кнопка действия — во всю ширину под строкой. */
  .tp-tr--temp .tp-td-state { grid-column: 1 / -1; order: 4; }
  .tp-tr--temp .tp-td-act--btn { display: flex; grid-column: 1 / -1; order: 5; }
  .tp-tr--temp .tp-td-act--btn:empty { display: none; }
  .tp-tr--temp .tp-td-act--btn .tp-btn { flex: 1; justify-content: center; }
  .tp-sec { padding: 9px 14px; }
}

.dark .tp-in { color: #34d399; }
.dark .tp-out { color: #fbbf24; }
.dark .tp-bg-in { background: rgba(52, 211, 153, 0.14); color: #34d399; }
.dark .tp-bg-out { background: rgba(251, 191, 36, 0.14); color: #fbbf24; }
.dark .tp-alert { background: rgba(251, 191, 36, 0.1); border-color: rgba(251, 191, 36, 0.32); color: #fbbf24; }
.dark .tp-badge { background: rgba(251, 191, 36, 0.16); color: #fbbf24; }
.dark .tp-badge--wait { background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.55); }
.dark .tp-btn--main { background: #059669; border-color: #059669; }
.dark .tp-progress-fill { background: #34d399; }
</style>
