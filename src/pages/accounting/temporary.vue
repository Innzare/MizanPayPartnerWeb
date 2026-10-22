<script setup lang="ts">
/**
 * Бухгалтерия → Пополнения и расходы.
 *
 * Все ручные движения денег — не через сделки — в одном месте: табы
 * «Пополнения» и «Расходы», слева дерево выбранного потока (основные и
 * временные с видами), справа лента за период с пагинацией.
 *
 * «Прибыль к снятию сейчас» и кнопка «Снять прибыль» живут на «Балансе», на
 * табе «Доступно сейчас»: это одна и та же цифра свободных денег, и два места
 * с ней дублировали друг друга (решение владельца 03.10.2026).
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
import PendingOpsCard from '@/components/PendingOpsCard.vue'
import ManualTxEditDialog, { type ManualTx } from '@/components/ManualTxEditDialog.vue'
import CategoriesDialog from '@/components/CategoriesDialog.vue'
import {
  useAccountingStore,
  type TemporarySummary,
  type LiabilityView,
  type FlowGroup,
} from '@/stores/accounting'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useAuthStore } from '@/stores/auth'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { rangeForPreset } from '@/composables/useReports'
import type { PeriodRange } from '@/types/reports'
import { OPERATION_KINDS, INCOME_KINDS, EXPENSE_KINDS, type OperationKind } from '@/constants/operationKinds'
import { CURRENCY_MASK, parseMasked, formatCurrency, formatDate, formatDateShort } from '@/utils/formatters'

const store = useAccountingStore()
const cashboxes = useCashBoxesStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { isDark } = useIsDark()

/** Погасить временный долг или принять возврат — это движение капитала. */
const canManage = computed(() => auth.can('finance.capital'))
const canEditTx = computed(() => auth.can('finance.transactions'))
const canCancelCapital = computed(() => auth.can('cashboxes.capital'))
const canCategories = computed(() => auth.can('finance.categories'))

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

// ── Навигация: поток → раздел → вид ──
//
// Лестница из трёх ступеней: пополнения или расходы → основные или временные
// → конкретный вид. На компьютере это дерево слева от ленты (все ступени и их
// суммы видны сразу), на телефоне — три строки переключателей.
type Flow = 'in' | 'out'
type Section = 'all' | 'main' | 'temp'
const FLOWS: Flow[] = ['in', 'out']
const SECTIONS: Array<Exclude<Section, 'all'>> = ['main', 'temp']
const FLOW_TITLE: Record<Flow, string> = { in: 'Пополнения', out: 'Расходы' }
const SECTION_TITLE: Record<Exclude<Section, 'all'>, string> = { main: 'Основные', temp: 'Временные' }

const tab = ref<Flow>(route.query.tab === 'out' ? 'out' : 'in')
const section = ref<Section>(
  route.query.section === 'temp' ? 'temp' : route.query.section === 'main' ? 'main' : 'all',
)
// Вид — из ссылки: карточка кассы ведёт сюда сразу на «Расход по бизнесу».
const kindFilter = ref<string | null>(typeof route.query.kind === 'string' ? route.query.kind : null)

function select(flow: Flow, sec: Section = 'all', kind: string | null = null) {
  tab.value = flow
  section.value = sec
  kindFilter.value = kind
  void router.replace({
    query: {
      ...route.query,
      tab: flow === 'out' ? 'out' : undefined,
      section: sec === 'all' ? undefined : sec,
      kind: kind ?? undefined,
    },
  })
}

/**
 * Виды операций по разделам, в порядке частоты.
 *
 * Основные — деньги ушли или пришли насовсем: капитал, прибыль, доход и
 * расход по бизнесу. Сюда же «Неизвестный приход» и «Выдали под отчёт»: их
 * не возвращают, а разносят в расход, доход или «вернули».
 * Временные — деньги вернутся: временное пополнение или снятие и возвраты по
 * ним. Важно не только что было за период, но и кто сколько должен сейчас.
 *
 * Возвраты и переводы между кассами (наследство прежней функции кассы)
 * показываются, только если за период такие были.
 */
interface KindUi {
  key: string
  /** Показывать, только если за период были операции. */
  onlyIfUsed?: boolean
}
const TREE: Record<Flow, Record<Exclude<Section, 'all'>, KindUi[]>> = {
  in: {
    main: [{ key: 'capitalIn' }, { key: 'income' }, { key: 'pendingIn' }, { key: 'transferIn', onlyIfUsed: true }],
    temp: [{ key: 'borrowed' }, { key: 'repaidToUs', onlyIfUsed: true }],
  },
  out: {
    main: [
      { key: 'expense' },
      { key: 'profitOut' },
      { key: 'capitalOut' },
      { key: 'pendingOut' },
      { key: 'transferOut', onlyIfUsed: true },
    ],
    temp: [{ key: 'lent' }, { key: 'repaidByUs', onlyIfUsed: true }],
  },
}
function keysOf(flow: Flow, sec: Exclude<Section, 'all'>): string[] {
  return TREE[flow][sec].map((k) => k.key)
}

/** Кнопка «+»: виды операции для выбранной ветки — только доступные. */
const OPS_FOR: Record<Flow, Record<Section, OperationKind[]>> = {
  in: {
    all: INCOME_KINDS,
    main: ['DEPOSIT', 'INCOME', 'PENDING_IN'],
    temp: ['BORROW'],
  },
  out: {
    all: EXPENSE_KINDS,
    main: ['EXPENSE', 'WITHDRAW_PROFIT', 'WITHDRAW_OWNER', 'PENDING_OUT'],
    temp: ['LEND'],
  },
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
  OPS_FOR[tab.value][section.value].filter((k) =>
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
    toast.error(e, 'Не удалось загрузить пополнения и расходы')
  } finally {
    loading.value = false
  }
}

async function load() {
  // Неразобранные для блока разбора — тот же список, что на «Балансе».
  void store.fetchPending().catch(() => {})
  await loadPeriod()
}

onMounted(() => {
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
function tempLeftFor(flow: Flow): number {
  return tempPeopleFor(flow).reduce((s, p) => s + p.left, 0)
}
function overdueFor(flow: Flow): boolean {
  return tempPeopleFor(flow).some((p) => p.overdue)
}
const tempPeople = computed(() => tempPeopleFor(tab.value))
const tempLeft = computed(() => tempLeftFor(tab.value))

const listCard = ref<HTMLElement | null>(null)
/** Открыть временные нужного потока — из шапки и из предупреждения. */
async function openTemp(flow: Flow) {
  select(flow, 'temp')
  await nextTick()
  listCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
/** Куда вести из предупреждения о просрочке: туда, где просрочка есть. */
const overdueFlow = computed<Flow>(() => (overdueFor('out') ? 'out' : 'in'))

/** Сколько уже вернули по расчёту — полосой, чтобы не считать в уме. */
function repaidPct(l: LiabilityView): number {
  if (!l.principal) return 0
  return Math.min(100, Math.round((l.repaid / l.principal) * 100))
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

/** Листья дерева: вид, число строк и сумма за период. */
function leavesOf(flow: Flow, sec: Exclude<Section, 'all'>) {
  return TREE[flow][sec]
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
/** Сумма ветки за период — из итогов: разобранные в неё не входят. */
function sumOf(flow: Flow, sec: Exclude<Section, 'all'>): number {
  return keysOf(flow, sec).reduce((s, k) => s + (groupsByKey.value.get(k)?.amount ?? 0), 0)
}
function flowSum(flow: Flow): number {
  return flow === 'in' ? data.value?.period.inAmount ?? 0 : data.value?.period.outAmount ?? 0
}

function kindColor(key: string, group: FlowGroup): string {
  return key === 'profitOut' ? PROFIT_COLOR : GROUP_COLOR[group]
}

type HistoryRow = TemporarySummary['history'][number]
const isTemp = computed(() => section.value === 'temp')

const history = computed(() => {
  const sec = section.value
  const keys = sec === 'all' ? null : keysOf(tab.value, sec)
  return (data.value?.history ?? []).filter(
    (h) =>
      h.flow === tab.value &&
      (!keys || keys.includes(h.kind)) &&
      (!kindFilter.value || h.kind === kindFilter.value),
  )
})
/** Путь выбранной ветки — «Расходы › Временные › Временное снятие». */
const crumbs = computed(() => {
  const list = [FLOW_TITLE[tab.value]]
  if (section.value !== 'all') list.push(SECTION_TITLE[section.value])
  if (kindFilter.value) list.push(groupsByKey.value.get(kindFilter.value)?.title ?? kindFilter.value)
  return list
})
const filterTitle = computed(() => crumbs.value.slice(1).join(' · '))
/** Подпись кнопки «+» по выбранной ветке. */
const addLabel = computed(() => {
  if (section.value === 'temp') return tab.value === 'in' ? 'Временное пополнение' : 'Временное снятие'
  return tab.value === 'in' ? 'Пополнение' : 'Расход'
})
/** Итог того, что сейчас в ленте: разобранные в итог не входят. */
const historySum = computed(() => history.value.filter((h) => !h.resolvedAs).reduce((s, h) => s + h.amount, 0))

// ── Страницы ленты — наша обычная пагинация ──
// Лента за период приходит целиком (по ней же считаются итоги), а рисуется
// страницами: «за всё время» у крупного партнёра это сотни строк.
const page = ref(1)
const perPage = usePageSize('flows:page-size')
/** Сколько строк уже показано в режиме подгрузки при прокрутке. */
const shown = ref(perPage.value)
const hasMoreRows = computed(() => shown.value < history.value.length)
const autoLoad = useAutoLoad({
  storageKey: 'flows:auto-load',
  hasMore: hasMoreRows,
  busy: ref(false),
  loadMore: () => { shown.value += perPage.value },
})
const autoLoadSentinel = autoLoad.sentinel
const visibleHistory = computed(() =>
  autoLoad.enabled.value
    ? history.value.slice(0, shown.value)
    : history.value.slice((page.value - 1) * perPage.value, page.value * perPage.value),
)
// Другая выборка (ветка, вид, период, касса) — снова с начала.
watch([history, perPage, () => autoLoad.enabled.value], () => {
  page.value = 1
  shown.value = perPage.value
  autoLoad.reset()
})

// ── Действия из ленты ──
const editTx = ref<ManualTx | null>(null)
const showEditTx = ref(false)
const cancelCapitalRow = ref<HistoryRow | null>(null)
const cancelling = ref(false)

function activeDebt(h: HistoryRow): LiabilityView | null {
  if (h.ref.type !== 'liability') return null
  const id = h.ref.id
  return activePeople.value.find((p) => p.id === id) ?? null
}

/** Что можно сделать со строкой этому пользователю. */
function rowAction(h: HistoryRow): 'edit' | 'cancel' | 'repay' | null {
  if (h.ref.type === 'transaction' && canEditTx.value) return 'edit'
  if (h.ref.type === 'capital' && canCancelCapital.value) return 'cancel'
  if (h.ref.type === 'liability' && canManage.value && activeDebt(h)) return 'repay'
  return null
}

const ACTION_TITLE = {
  edit: 'Изменить или удалить',
  cancel: 'Отменить операцию',
  repay: 'Записать возврат',
} as const
const ACTION_ICON = {
  edit: 'mdi-pencil-outline',
  cancel: 'mdi-undo-variant',
  repay: 'mdi-keyboard-return',
} as const

function onRow(h: HistoryRow) {
  const action = rowAction(h)
  if (action === 'edit' && h.ref.type === 'transaction') {
    editTx.value = {
      id: h.ref.id,
      type: h.kind === 'income' ? 'INCOME' : 'EXPENSE',
      amount: h.amount,
      description: h.note,
      categoryId: h.ref.categoryId,
      cashBoxId: h.ref.cashBoxId,
      date: h.date,
      affectsInvestors: h.ref.affectsInvestors,
      fromCapital: h.ref.fromCapital,
    }
    showEditTx.value = true
  } else if (action === 'cancel') {
    cancelCapitalRow.value = h
  } else if (action === 'repay') {
    const debt = activeDebt(h)
    if (debt) openRepay(debt)
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

// ── Возврат временных денег ──
const repayTarget = ref<LiabilityView | null>(null)
const repayAmount = ref<number | null>(null)
const repaying = ref(false)

function openRepay(l: LiabilityView) {
  repayTarget.value = l
  repayAmount.value = l.left
}

/** Вернуть больше, чем брали, нельзя: излишек — это уже другая операция. */
const tooMuch = computed(
  () => !!repayTarget.value && (repayAmount.value ?? 0) > repayTarget.value.left,
)

async function confirmRepay() {
  if (!repayTarget.value || !repayAmount.value || tooMuch.value) return
  repaying.value = true
  try {
    await store.repayLiability(repayTarget.value.id, { amount: repayAmount.value })
    toast.success('Возврат записан')
    repayTarget.value = null
    await load()
  } catch (e: any) {
    toast.error(e, 'Не удалось записать возврат')
  } finally {
    repaying.value = false
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

    <div v-if="data?.open.overdueCount" class="tp-alert">
      <v-icon icon="mdi-alert-circle-outline" size="18" />
      <span>
        Просрочено временных расчётов: {{ data.open.overdueCount }} — срок возврата прошёл,
        а деньги не вернулись.
      </span>
      <button class="tp-alert-link" @click="openTemp(overdueFlow)">Показать</button>
    </div>

    <!-- Неразобранные: деньги двигались, а куда отнести — ещё не решили. -->
    <PendingOpsCard v-if="data?.open.pendingCount" class="tp-pending" @changed="load" />

    <!-- ── Лента за период ── -->
    <div ref="listCard" class="tp-card">
      <div class="tp-toolbar">
        <!-- Пополнения и расходы — двумя табами; ниже в дереве — разделы
             выбранного потока. -->
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
          <!-- Касса меняет всю ленту: её операции, итоги и временные. -->
          <div v-if="cashBoxOptions.length > 1" class="tp-box">
            <SelectField v-model="cashBoxId" :options="cashBoxOptions" empty-label="Все кассы" placeholder="Все кассы" />
          </div>
          <MonthYearPicker v-model="period" class="tp-period" />
          <button v-if="canCategories" class="tp-btn" type="button" title="Статьи доходов и расходов" @click="showCategories = true">
            <v-icon icon="mdi-tag-multiple-outline" size="16" />
            <span class="tp-btn-text">Статьи</span>
          </button>
          <!-- Новая операция — виды текущей вкладки, как кнопка «Операции» на «Балансе». -->
          <v-menu v-if="tabKinds.length" location="bottom end" offset="6">
            <template #activator="{ props: menuProps }">
              <button class="tp-btn tp-btn--main" v-bind="menuProps">
                <v-icon icon="mdi-plus" size="16" />
                {{ addLabel }}
                <v-icon icon="mdi-chevron-down" size="15" />
              </button>
            </template>
            <v-card rounded="lg" elevation="6" class="tp-opmenu">
              <AccountOperationItems :kinds="tabKinds" @pick="newOperation($event)" />
            </v-card>
          </v-menu>
        </div>
      </div>

      <!-- Телефон: дерево строками — раздел, затем вид. -->
      <div class="tp-ladder">
        <div class="tp-seg tp-seg--sm">
          <button class="tp-seg-btn" :class="{ 'tp-seg-btn--on': section === 'all' }" @click="select(tab)">Все</button>
          <button
            v-for="sec in SECTIONS"
            :key="sec"
            class="tp-seg-btn"
            :class="{ 'tp-seg-btn--on': section === sec, 'tp-seg-btn--temp': sec === 'temp' }"
            @click="select(tab, sec)"
          >
            {{ SECTION_TITLE[sec] }}
            <span v-if="sec === 'temp' && overdueFor(tab)" class="tp-alert-dot" />
          </button>
        </div>
        <div v-if="section !== 'all'" class="tp-ladder-kinds">
          <button
            v-for="c in leavesOf(tab, section)"
            :key="c.key"
            class="tp-chip"
            :class="{ 'tp-chip--on': kindFilter === c.key }"
            @click="select(tab, section, kindFilter === c.key ? null : c.key)"
          >
            <span class="tp-dot" :style="{ background: kindColor(c.key, c.group) }" />
            {{ c.title }}
            <span class="tp-chip-count">{{ c.count }}</span>
          </button>
        </div>
      </div>

      <div class="tp-body">
        <!-- Дерево выбранного потока: все его операции, основные и временные
             с видами и суммами за период. -->
        <nav class="tp-tree">
          <button
            class="tp-node tp-node--flow"
            :class="{ 'tp-node--on': section === 'all' && !kindFilter }"
            @click="select(tab)"
          >
            <span class="tp-node-title">{{ tab === 'in' ? 'Все пополнения' : 'Все расходы' }}</span>
            <span class="tp-node-sum" :class="tab === 'in' ? 'tp-in' : 'tp-out'">
              {{ tab === 'in' ? '+' : '−' }}{{ formatCurrency(flowSum(tab)) }}
            </span>
          </button>

          <div class="tp-branch">
            <div v-for="sec in SECTIONS" :key="sec" class="tp-branch-item">
              <button
                class="tp-node tp-node--sec"
                :class="{ 'tp-node--on': section === sec && !kindFilter, 'tp-node--temp': sec === 'temp' }"
                @click="select(tab, sec)"
              >
                <span class="tp-node-title">{{ SECTION_TITLE[sec] }}</span>
                <span class="tp-node-sum">{{ formatCurrency(sumOf(tab, sec)) }}</span>
              </button>
              <!-- У временных — сколько ещё должны вернуть, на сегодня. -->
              <button
                v-if="sec === 'temp' && tempLeftFor(tab) > 0"
                class="tp-node-owed"
                :class="{ 'tp-node-owed--alert': overdueFor(tab) }"
                :title="overdueFor(tab) ? 'Есть просроченный возврат' : 'Ещё не вернули — на сегодня'"
                @click="select(tab, 'temp')"
              >
                <v-icon v-if="overdueFor(tab)" icon="mdi-alert-circle" size="12" />
                {{ tab === 'in' ? 'вернуть' : 'вернут' }} {{ formatCurrency(tempLeftFor(tab)) }}
              </button>

              <div class="tp-leaves">
                <button
                  v-for="c in leavesOf(tab, sec)"
                  :key="c.key"
                  class="tp-node tp-node--leaf"
                  :class="{ 'tp-node--on': kindFilter === c.key, 'tp-node--empty': !c.count }"
                  @click="select(tab, sec, kindFilter === c.key ? null : c.key)"
                >
                  <span class="tp-dot" :style="{ background: kindColor(c.key, c.group) }" />
                  <span class="tp-node-title">{{ c.title }}</span>
                  <span class="tp-node-count">{{ c.count || '' }}</span>
                </button>
              </div>
            </div>
          </div>
        </nav>

        <div class="tp-main">
          <!-- Временные: кто сколько должен — на сегодня, не по периоду. -->
          <template v-if="isTemp">
            <div class="tp-temp-head">
              <span>{{ tab === 'in' ? 'Должны вернуть мы' : 'Должны вернуть нам' }}</span>
              <span class="tp-temp-note">на сегодня, не зависит от периода</span>
              <span v-if="tempLeft > 0" class="tp-list-sum">{{ formatCurrency(tempLeft) }}</span>
            </div>
            <div v-if="!tempPeople.length" class="tp-empty tp-empty--sm">
              <v-icon icon="mdi-check-circle-outline" size="22" />
              <div class="tp-empty-text">
                {{ tab === 'in' ? 'Всё, что брали на время, вернули.' : 'Всё, что выдавали на время, вернули.' }}
              </div>
            </div>
            <div v-else class="tp-people">
              <div
                v-for="l in tempPeople"
                :key="l.id"
                class="tp-person"
                :class="{ 'tp-person--overdue': l.overdue }"
              >
                <div class="tp-person-body">
                  <div class="tp-person-name">
                    {{ l.personName }}
                    <span v-if="l.overdue" class="tp-badge">просрочено {{ daysOverdue(l) }} дн.</span>
                  </div>
                  <div class="tp-person-sub">
                    {{ l.direction === 'BORROWED' ? 'внесли' : 'выдали' }} {{ formatCurrency(l.principal) }}
                    <template v-if="l.repaid > 0"> · вернули {{ formatCurrency(l.repaid) }}</template>
                    <template v-if="l.dueDate"> · до {{ formatDate(l.dueDate) }}</template>
                    <template v-if="l.note"> · {{ l.note }}</template>
                  </div>
                  <div class="tp-progress" :title="`Вернули ${formatCurrency(l.repaid)} из ${formatCurrency(l.principal)}`">
                    <div class="tp-progress-fill" :style="{ width: repaidPct(l) + '%' }" />
                  </div>
                </div>

                <div class="tp-person-num">
                  <div class="tp-person-left">{{ formatCurrency(l.left) }}</div>
                  <div class="tp-person-left-label">осталось</div>
                </div>

                <button v-if="canManage" class="tp-btn tp-btn--sm" @click="openRepay(l)">
                  {{ l.direction === 'BORROWED' ? 'Вернуть' : 'Принять' }}
                </button>
              </div>
            </div>

          </template>

          <div class="tp-list-head">
            <span>Операции {{ periodPhrase }}</span>
            <span v-if="history.length" class="tp-list-sum" :class="tab === 'in' ? 'tp-in' : 'tp-out'">
              {{ tab === 'in' ? '+' : '−' }}{{ formatCurrency(historySum) }}
            </span>
          </div>

          <div v-if="loading && !data" class="tp-loading">
            <v-progress-circular indeterminate color="primary" />
          </div>

          <div v-else-if="!history.length" class="tp-empty">
            <v-icon icon="mdi-timeline-text-outline" size="26" />
            <div class="tp-empty-title">Операций нет</div>
            <div class="tp-empty-text">
              {{ periodPhrase.charAt(0).toUpperCase() + periodPhrase.slice(1) }}
              {{ filterTitle ? `«${filterTitle.toLowerCase()}» не было` : tab === 'in' ? 'пополнений не было' : 'расходов не было' }}.
              Смените период или добавьте операцию кнопкой «{{ addLabel }}».
            </div>
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
              :class="{ 'tp-tr--click': !!rowAction(h), 'tp-tr--resolved': !!h.resolvedAs }"
              @click="onRow(h)"
            >
              <div class="tp-td-date" :title="formatDate(h.date)">{{ formatDateShort(h.date) }}</div>
              <div class="tp-td-op">
                <span class="tp-dot" :style="{ background: kindColor(h.kind, h.group) }" />
                <span>{{ h.title }}</span>
              </div>
              <div class="tp-td-who">
                {{ h.who || '—' }}<span v-if="h.note" class="tp-td-note"> · {{ h.note }}</span>
                <span v-if="h.cashBoxName && !cashBoxId" class="tp-td-note"> · {{ h.cashBoxName }}</span>
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
              <div class="tp-td-act">
                <v-icon
                  v-if="rowAction(h)"
                  :icon="ACTION_ICON[rowAction(h)!]"
                  :title="ACTION_TITLE[rowAction(h)!]"
                  size="16"
                />
              </div>
            </div>
          </div>

          <!-- Пагинация как в остальных разделах: прилипает к низу экрана,
               номера страниц, размер страницы и подгрузка при прокрутке. -->
          <div v-if="autoLoad.enabled.value" ref="autoLoadSentinel" class="tp-sentinel" />
          <ServerPager
            v-if="history.length > 0"
            class="tp-pager"
            :page="page"
            :total="history.length"
            :per-page="perPage"
            :per-page-options="PER_PAGE_OPTIONS"
            :auto-load="autoLoad.enabled.value"
            :loaded="visibleHistory.length"
            :has-more="hasMoreRows"
            @update:page="page = $event"
            @update:per-page="perPage = $event"
            @update:auto-load="autoLoad.enabled.value = $event"
            @load-more="autoLoad.loadMoreManually()"
          />
        </div>
      </div>
    </div>

    <!-- Возврат -->
    <v-dialog :model-value="!!repayTarget" max-width="420" @update:model-value="repayTarget = null">
      <v-card rounded="lg" class="pa-5">
        <div class="tp-dlg-title">
          {{ repayTarget?.direction === 'BORROWED' ? 'Вернуть деньги' : 'Принять возврат' }}
        </div>
        <div class="tp-dlg-sub">
          {{ repayTarget?.personName }} · осталось {{ formatCurrency(repayTarget?.left ?? 0) }}
        </div>
        <v-text-field
          v-model="repayAmount"
          v-maska:[CURRENCY_MASK]
          label="Сумма"
          variant="outlined"
          density="comfortable"
          rounded="lg"
          class="mt-4"
          :error="tooMuch"
          :error-messages="tooMuch ? 'Больше остатка вернуть нельзя' : ''"
          @update:model-value="repayAmount = parseMasked($event)"
        />
        <div class="d-flex justify-end ga-2 mt-2">
          <button class="tp-btn" @click="repayTarget = null">Отмена</button>
          <button
            class="tp-btn tp-btn--main"
            :disabled="repaying || tooMuch || !repayAmount"
            @click="confirmRepay"
          >
            Записать
          </button>
        </div>
      </v-card>
    </v-dialog>

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

    <ManualTxEditDialog v-model="showEditTx" :tx="editTx" :can-delete="canEditTx" @done="load" />
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
.tp-pending { margin-bottom: 18px; }

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
.tp-box { min-width: 190px; }

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

/* ── Дерево слева и лента справа ── */
.tp-body { display: grid; grid-template-columns: 272px minmax(0, 1fr); border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
/* Лента — колонкой во всю высоту дерева слева: когда строк мало, пагинация
   прижимается к низу карточки, а не висит сразу под строками. На длинном
   списке она по-прежнему прилипает к низу экрана. */
.tp-main { min-width: 0; display: flex; flex-direction: column; }
/* Пагинация — во всю ширину ленты: у неё отрицательные поля под padding
   карточки, а у ленты своего padding нет. margin-top: auto — прижать к низу. */
.tp-pager { margin: auto 0 0 !important; border-radius: 0 0 14px 0 !important; }
.tp-sentinel { height: 1px; }
.tp-main > :first-child { border-top: none; }
.tp-tree {
  border-bottom-left-radius: 14px;
  padding: 10px 10px 14px; border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.tp-node {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 10px; border: none; border-radius: 9px; background: none; cursor: pointer; text-align: left;
  color: rgba(var(--v-theme-on-surface), 0.72); transition: background 0.12s, color 0.12s;
}
.tp-node:hover { background: rgba(var(--v-theme-on-surface), 0.045); }
.tp-node--on, .tp-node--on:hover { background: rgba(var(--v-theme-primary), 0.11); color: rgb(var(--v-theme-primary)); }
.tp-node-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-node-sum { font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; color: rgba(var(--v-theme-on-surface), 0.6); }
.tp-node--on .tp-node-sum { color: inherit; }
.tp-node-count { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.4); font-variant-numeric: tabular-nums; }
.tp-node--flow { padding: 8px 10px; font-size: 14.5px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.88); }
.tp-node--flow .tp-node-sum { font-size: 13px; }
.tp-node-ico { width: 26px; height: 26px; border-radius: 8px; flex: none; display: inline-flex; align-items: center; justify-content: center; }
/* Ветки — с линией слева, как в дереве папок: видно, что чему подчинено. */
.tp-branch { margin: 2px 0 0 22px; padding-left: 10px; border-left: 1.5px solid rgba(var(--v-theme-on-surface), 0.1); }
.tp-node--sec { font-size: 13.5px; font-weight: 600; }
.tp-node--temp:not(.tp-node--on) .tp-node-title { color: #b45309; }
.tp-node-owed {
  display: block; margin: -2px 0 2px 10px; padding: 1px 0; border: none; background: none; cursor: pointer;
  font-size: 11.5px; font-weight: 600; color: #b45309; text-align: left;
}
.tp-node-owed--alert { color: #dc2626; }
.tp-leaves { margin: 0 0 4px 10px; padding-left: 8px; border-left: 1.5px dotted rgba(var(--v-theme-on-surface), 0.12); }
.tp-node--leaf { padding: 5px 8px; font-size: 12.5px; font-weight: 500; }
.tp-node--empty:not(.tp-node--on) { color: rgba(var(--v-theme-on-surface), 0.42); }

/* Телефон: лестница строками вместо дерева. */
.tp-ladder { display: none; }
.tp-seg { display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: rgba(var(--v-theme-on-surface), 0.05); }
.tp-seg-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0;
  padding: 7px 8px; border: none; border-radius: 9px; background: none; cursor: pointer;
  font-size: 13.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.55); position: relative;
}
.tp-seg-btn--on { background: rgb(var(--v-theme-surface)); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); color: rgba(var(--v-theme-on-surface), 0.92); }
.tp-seg-btn--temp:not(.tp-seg-btn--on) { color: #b45309; }
.tp-seg-sum { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tp-seg--sm .tp-seg-btn { flex-direction: row; justify-content: center; gap: 6px; padding: 6px 8px; font-size: 13px; }
.tp-alert-dot { width: 7px; height: 7px; border-radius: 50%; background: #dc2626; }
.tp-ladder-kinds { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
.tp-ladder-kinds::-webkit-scrollbar { display: none; }

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

/* Фильтры по виду — те же «пилюли», что «Активные / Завершённые / Все» в сделках. */
.tp-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 20px; border: none; cursor: pointer; white-space: nowrap;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.6);
  transition: all 0.15s;
}
.tp-chip:hover { background: rgba(var(--v-theme-primary), 0.08); color: rgb(var(--v-theme-primary)); }
.tp-chip--on { background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); font-weight: 600; }
.tp-chip-count {
  font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.07); line-height: 18px; min-width: 20px; text-align: center;
}
.tp-chip--on .tp-chip-count { background: rgba(var(--v-theme-primary), 0.15); color: rgb(var(--v-theme-primary)); }
/* «Временные» — отдельно справа и своим цветом: это другая суть денег. */
.tp-temp-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 18px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(245, 158, 11, 0.05);
  font-size: 12.5px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.7);
}
.tp-temp-note { font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.42); }
.tp-temp-head .tp-list-sum { margin-left: auto; }

.tp-list-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 18px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  font-size: 12.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.5);
}
.tp-list-sum { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }

.tp-table { width: 100%; }
.tp-tr {
  display: grid; grid-template-columns: 92px minmax(170px, 1fr) minmax(160px, 1.4fr) 130px 24px;
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

/* ── Временные ── */
.tp-block {
  border-radius: 14px; margin-bottom: 18px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface)); scroll-margin-top: 80px;
}
.tp-block-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 14px 18px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.tp-block-title { font-size: 15px; font-weight: 700; }
.tp-block-count {
  font-size: 11.5px; font-weight: 700; padding: 1px 7px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.5);
}
.tp-block-note { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4); }
.tp-card-ico { width: 24px; height: 24px; border-radius: 7px; flex: none; display: inline-flex; align-items: center; justify-content: center; }
.tp-bg-in { background: rgba(4, 120, 87, 0.12); color: #047857; }
.tp-bg-out { background: rgba(180, 83, 9, 0.12); color: #b45309; }
.tp-people { padding: 6px 8px 8px; }
.tp-person { display: flex; align-items: center; gap: 12px; padding: 11px 10px; border-radius: 10px; }
.tp-person:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.tp-person--overdue { background: rgba(245, 158, 11, 0.06); }
.tp-person-body { flex: 1; min-width: 0; }
.tp-person-name { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.tp-person-dir { font-size: 11.5px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.45); }
.tp-person-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-progress { height: 3px; border-radius: 2px; margin-top: 7px; max-width: 320px; background: rgba(var(--v-theme-on-surface), 0.08); }
.tp-progress-fill { height: 100%; border-radius: 2px; background: #047857; opacity: 0.7; }
.tp-person-num { text-align: right; }
.tp-person-left { font-size: 14.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tp-person-left-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45); }

.tp-dlg-title { font-size: 17px; font-weight: 700; }
.tp-dlg-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 4px; line-height: 1.5; }

/* Дерево рядом с таблицей нужно ≥ 980 px; уже — та же лестница строками. */
@media (max-width: 980px) {
  .tp-ladder { display: flex; flex-direction: column; gap: 8px; padding: 2px 16px 14px; }
  .tp-body { display: block; }
  .tp-tree { display: none; }
}
@media (max-width: 760px) {
  .tp-page { padding: 16px 16px 40px; }
  .tp-toolbar { padding: 12px 12px 8px; }
  .tp-flowtabs { width: 100%; }
  .tp-flowtab { flex: 1; justify-content: center; padding: 7px 8px; flex-wrap: wrap; gap: 4px 8px; }
  .tp-ladder { padding: 2px 12px 12px; }
  .tp-toolbar-ctl { width: 100%; }
  .tp-period { flex: 1 1 100%; justify-content: space-between; }
  .tp-toolbar-ctl .tp-btn--main { flex: 1; justify-content: center; }
  .tp-btn-text { display: none; }
  /* Таблица на телефоне — карточками: четыре колонки в 360 px не помещаются. */
  .tp-tr { grid-template-columns: 1fr auto; row-gap: 4px; padding: 12px 14px; }
  .tp-tr--head { display: none; }
  .tp-td-date { grid-column: 1; order: 1; }
  .tp-td--right { grid-column: 2; grid-row: 1 / span 2; order: 2; align-self: center; }
  .tp-td-op { grid-column: 1; order: 3; }
  .tp-td-who { grid-column: 1 / -1; order: 4; white-space: normal; }
  .tp-td-act { display: none; }
  .tp-list-head { padding: 10px 14px; }
  .tp-person { flex-wrap: wrap; }
  .tp-person-num { margin-left: auto; }
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
