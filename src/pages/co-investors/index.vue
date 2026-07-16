<script lang="ts" setup>
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useDealsStore } from '@/stores/deals'
import { useCashBoxesStore, type CashBoxSummary } from '@/stores/cashboxes'
import { formatCurrency, formatCurrencyShort, formatPhone, PHONE_MASK, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useCapital } from '@/composables/useCapital'
import { useCoInvestors } from '@/composables/useCoInvestors'
import CoInvestorRemoveDialog from '@/components/CoInvestorRemoveDialog.vue'
import CoInvestorEditDialog from '@/components/CoInvestorEditDialog.vue'
import type { InvestorPerson, PersonStake } from '@/types'

// Способ деления прибыли инвестора В ЭТОЙ кассе — для бейджиков колонки «Кассы».
function stakeModeShort(s: PersonStake): string {
  if (s.costFeeMode) return s.costFeeDefaultRatePct != null ? `Закупка ${s.costFeeDefaultRatePct}%` : 'От закупки'
  if (s.profitPercent != null && s.profitPercent > 0) return `Фикс ${s.profitPercent}%`
  return (s.managementFeePct ?? 0) > 0 ? `Вклад · ${s.managementFeePct}%` : 'По вкладу'
}
function stakeModeIcon(s: PersonStake): string {
  if (s.costFeeMode) return 'mdi-tag-outline'
  if (s.profitPercent != null && s.profitPercent > 0) return 'mdi-percent-outline'
  return 'mdi-scale-balance'
}
// Распределение прибыли ПО КОНКРЕТНОЙ КАССЕ (стейку) — для полосы под кассой.
function stakeTotalProfit(s: PersonStake): number {
  return (s.coInvestorShare ?? 0) + (s.myShare ?? 0)
}
function stakeInvestorPct(s: PersonStake): number {
  const t = stakeTotalProfit(s)
  return t > 0 ? Math.round(((s.coInvestorShare ?? 0) / t) * 100) : Math.round(s.effectivePct ?? 0)
}
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const router = useRouter()
const { isDark } = useIsDark()

// Mobile flag для fullscreen-диалогов на телефонах.
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
function updateMobile() { isMobile.value = window.innerWidth < 768 }
onMounted(() => window.addEventListener('resize', updateMobile))
onUnmounted(() => window.removeEventListener('resize', updateMobile))

// Инлайн-раскрытие строки инвестора: краткая сводка по кассам + метрики,
// без ухода на отдельную страницу (переход остаётся ссылкой внутри).
const expandedPersons = ref<Set<string>>(new Set())
function togglePersonExpand(id: string) {
  const n = new Set(expandedPersons.value)
  n.has(id) ? n.delete(id) : n.add(id)
  expandedPersons.value = n
}
const toast = useToast()
const dealsStore = useDealsStore()
const cashboxesStore = useCashBoxesStore()
const { fetchPersons, deletePerson, addStake } = useCoInvestors()
const { capital, isCapitalSet, fetchCapital } = useCapital()

const poolContribution = computed(() => {
  if (!capital.value || capital.value.totalCapital <= 0) return 0
  return Math.round((capital.value.coInvestorCapital / capital.value.totalCapital) * 100)
})

// ── State ──

const pageLoading = ref(true)
// Unified investor persons — each groups several per-cashbox stakes.
const persons = ref<InvestorPerson[]>([])
const search = ref('')
// Phase 2: filter chips by cashbox. null = "Все кассы" — same UX as analytics.
const selectedCashBoxId = ref<string | null>(null)

// Create dialog (new person OR new stake for an existing person)
const showDialog = ref(false)
const dialogLoading = ref(false)
// Phase 3: one CI model. `shareType` is the UI toggle backing the optional
// `profitPercent` field — 'FIXED' means use the entered % off the top of
// each deal's profit; 'WEIGHT' means split remaining profit by capital ratio.
const form = ref<{
  name: string
  phone: string
  capital: number
  shareType: 'FIXED' | 'WEIGHT' | 'COST_FEE'
  profitPercent: number
  // Phase 4: partner's commission on this CI's by-capital share (WEIGHT only).
  managementFeePct: number
  // Phase 5: default cost-fee rate (% of purchase) — COST_FEE only.
  costFeeDefaultRatePct: number | null
  payoutSchedule: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL'
  nextPayoutDate: string  // YYYY-MM-DD or ''
  cashBoxId: string | null
}>({
  name: '',
  phone: '',
  capital: 0,
  // New investors default to «по вкладу» with 0% commission (mudaraba default).
  shareType: 'WEIGHT',
  profitPercent: 30,
  managementFeePct: 0,
  costFeeDefaultRatePct: null,
  payoutSchedule: 'MONTHLY',
  nextPayoutDate: '',
  cashBoxId: null,
})

const PAYOUT_OPTIONS = [
  { value: 'MONTHLY' as const, label: 'Ежемесячно', icon: 'mdi-calendar-month' },
  { value: 'QUARTERLY' as const, label: 'Раз в квартал', icon: 'mdi-calendar-multiple' },
  { value: 'SEMIANNUAL' as const, label: 'Раз в полгода', icon: 'mdi-calendar-range' },
  { value: 'ANNUAL' as const, label: 'Раз в год', icon: 'mdi-calendar-clock' },
]

// Percent quick buttons
const PERCENT_PRESETS = [10, 20, 25, 30, 40, 50]
const FEE_PRESETS = [0, 20, 30, 50]
const COST_FEE_PRESETS = [5, 7.5, 10, 12.5]

// Share-mode options for the dropdown (cost-fee first, as everywhere).
const SHARE_TYPE_OPTIONS = [
  { value: 'COST_FEE' as const, label: 'Комиссия от закупки', icon: 'mdi-tag-outline' },
  { value: 'FIXED' as const, label: 'Фиксированный %', icon: 'mdi-percent-outline' },
  { value: 'WEIGHT' as const, label: 'По вкладу', icon: 'mdi-scale-balance' },
]
function shareTypeOption(v: 'FIXED' | 'WEIGHT' | 'COST_FEE') {
  return SHARE_TYPE_OPTIONS.find((o) => o.value === v) ?? SHARE_TYPE_OPTIONS[0]
}

// Avatar colors
const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#047857', '#3b82f6', '#0ea5e9', '#ec4899', '#f59e0b']

function getAvatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}

// ── Fetch ──

async function fetchData() {
  try {
    const [people] = await Promise.all([
      fetchPersons(),
      dealsStore.fetchDeals(),
      // Cashboxes are needed for filter chips, badges, and dialog pickers.
      // Skip if already loaded — store caches across pages.
      cashboxesStore.items.length === 0 ? cashboxesStore.fetchAll() : Promise.resolve(),
    ])
    persons.value = people
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки данных')
  } finally {
    pageLoading.value = false
  }
}

// Phase 4: the old partner-level pool contract (PARTICIPATING vs MANAGING) is
// gone — the model is now per-cashbox (partnerParticipatesByCapital, set in the
// cashbox editor) and per-CI (managementFeePct, set on each co-investor). No
// global pool dialog anymore.
const showHelpDialog = ref(false)

onMounted(() => { fetchData(); fetchCapital() })

// ── Computed ──

// Persons filtered by search + (optional) cashbox scope. A person matches a
// cashbox filter if ANY of their stakes lives in that cashbox.
const filteredPersons = computed(() => {
  let list = persons.value
  if (selectedCashBoxId.value) {
    list = list.filter((p) => p.stakes.some((s) => s.cashBox.id === selectedCashBoxId.value))
  }
  if (search.value) {
    const s = search.value.toLowerCase()
    list = list.filter(
      (p) => p.name.toLowerCase().includes(s) || (p.phone && p.phone.includes(s))
    )
  }
  return list
})

// Silent refresh of just the persons list — no full-page spinner, so the
// desktop table doesn't flash. Used after create/attach.
async function refreshList() {
  try {
    persons.value = await fetchPersons()
  } catch { /* silent — keep the current list on transient errors */ }
}

// ── Row helpers ──
const SIDEBAR_AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#047857', '#3b82f6', '#0ea5e9', '#ec4899', '#f59e0b']
function ciAvatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return SIDEBAR_AVATAR_COLORS[Math.abs(hash) % SIDEBAR_AVATAR_COLORS.length]
}
function ciInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}

// Lookup helper used by the dialog picker.
function getCashBox(id: string | null | undefined): CashBoxSummary | undefined {
  if (!id) return undefined
  return cashboxesStore.items.find((b) => b.id === id)
}

const summaryStats = computed(() => {
  const all = persons.value
  return {
    totalCapital: all.reduce((s, p) => s + p.totals.currentCapital, 0),
    totalShared: all.reduce((s, p) => s + p.totals.realizedProfit, 0),
    balanceOwed: all.reduce((s, p) => s + p.totals.balanceOwed, 0),
    count: all.length,
  }
})

// ── Chart data (per person, by aggregated totals) ──

const CHART_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#7c3aed', '#4f46e5']

const capitalChartData = computed(() => {
  const items = persons.value.filter((p) => p.totals.currentCapital > 0)
  return {
    labels: items.map((p) => p.name.split(' ')[0] || p.name),
    datasets: [{
      label: 'Капитал',
      data: items.map((p) => p.totals.currentCapital),
      backgroundColor: items.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + '40'),
      borderColor: items.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
      borderWidth: 2,
      borderRadius: 8,
    }],
  }
})

const profitChartData = computed(() => {
  const items = persons.value.filter((p) => p.totals.realizedProfit > 0 || p.totals.balanceOwed > 0)
  return {
    labels: items.map((p) => p.name.split(' ')[0] || p.name),
    datasets: [
      {
        label: 'Начислено',
        data: items.map((p) => p.totals.realizedProfit),
        backgroundColor: '#6366f1' + '60',
        borderColor: '#6366f1',
        borderWidth: 2,
        borderRadius: 8,
      },
      {
        label: 'К выплате',
        data: items.map((p) => p.totals.balanceOwed),
        backgroundColor: '#f59e0b' + '40',
        borderColor: '#f59e0b',
        borderWidth: 2,
        borderRadius: 8,
      },
    ],
  }
})

const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1a1a2e',
      titleColor: '#fff',
      bodyColor: '#fff',
      padding: 12,
      cornerRadius: 8,
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: '#9ca3af', font: { size: 12 } },
      border: { display: false },
    },
    y: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: {
        color: '#9ca3af',
        font: { size: 12 },
        callback: (v: any) => formatCurrencyShort(v),
      },
      border: { display: false },
    },
  },
}

const profitBarOptions = {
  ...barOptions,
  plugins: {
    ...barOptions.plugins,
    legend: {
      display: true,
      position: 'top' as const,
      labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 12 } },
    },
  },
}

// ── Create ──

function openCreate() {
  const preselectedCashBoxId =
    selectedCashBoxId.value ?? cashboxesStore.getDefault()?.id ?? null
  // Default the planned payout to one month from today so the form ships
  // with a sensible value the partner can override.
  const defaultNext = new Date()
  defaultNext.setMonth(defaultNext.getMonth() + 1)
  form.value = {
    name: '',
    phone: '',
    capital: 0,
    shareType: 'WEIGHT',
    profitPercent: 30,
    managementFeePct: 0,
    costFeeDefaultRatePct: null,
    payoutSchedule: 'MONTHLY',
    nextPayoutDate: defaultNext.toISOString().slice(0, 10),
    cashBoxId: preselectedCashBoxId,
  }
  // Preselect the scoped/default cashbox as the first block (Task 3).
  cashBoxBlocks.value = preselectedCashBoxId
    ? [{ cashBoxId: preselectedCashBoxId, capital: 0, shareType: 'WEIGHT', profitPercent: 30, managementFeePct: 0, costFeeDefaultRatePct: null }]
    : []
  showDialog.value = true
}

async function saveCoInvestor() {
  if (!form.value.name.trim()) return toast.error('Укажите имя')

  try {
    // Multi-cashbox: the first selected cashbox goes through POST /co-investors
    // (creates the person), the rest via addStake.
    const blocks = cashBoxBlocks.value
    if (blocks.length === 0) return toast.error('Выберите хотя бы одну кассу')
    // Validate each block up front.
    for (const b of blocks) {
      if (b.capital <= 0) return toast.error('Укажите капитал для каждой кассы')
      if (b.shareType === 'FIXED' && (b.profitPercent <= 0 || b.profitPercent >= 100)) {
        return toast.error('Процент от 1 до 99')
      }
      if (b.shareType === 'COST_FEE' && b.costFeeDefaultRatePct != null && (b.costFeeDefaultRatePct < 0 || b.costFeeDefaultRatePct > 100)) {
        return toast.error('Ставка от 0 до 100')
      }
    }

    dialogLoading.value = true
    {
      // The first selected cashbox creates the person; the rest attach as stakes.
      const first = blocks[0]
      const created = await api.post<{ id: string; personId?: string }>('/co-investors', {
        name: form.value.name.trim(),
        phone: form.value.phone.trim() || undefined,
        capital: Number(first.capital),
        profitPercent: first.shareType === 'FIXED' ? Number(first.profitPercent) : null,
        managementFeePct: first.shareType === 'WEIGHT' ? Number(first.managementFeePct || 0) : 0,
        costFeeMode: first.shareType === 'COST_FEE',
        costFeeDefaultRatePct:
          first.shareType === 'COST_FEE' && first.costFeeDefaultRatePct != null
            ? Number(first.costFeeDefaultRatePct)
            : null,
        payoutSchedule: form.value.payoutSchedule,
        nextPayoutDate: form.value.nextPayoutDate ? new Date(form.value.nextPayoutDate).toISOString() : null,
        cashBoxId: first.cashBoxId,
      })
      let personId = created.personId ?? null

      // Remaining blocks: attach to the freshly-created person via addStake.
      const rest = blocks.slice(1)
      if (rest.length) {
        if (!personId) {
          // Fallback: find the freshly created person by matching name/phone.
          const people = await fetchPersons()
          const match = people.find((p) =>
            p.name === form.value.name.trim() &&
            (form.value.phone.trim() ? p.phone === form.value.phone.trim() : true))
          personId = match?.id ?? null
        }
        if (!personId) throw new Error('Не удалось определить инвестора для добавления касс')
        await Promise.all(
          rest.map((b) =>
            addStake(personId!, {
              cashBoxId: b.cashBoxId,
              capital: Number(b.capital),
              profitPercent: b.shareType === 'FIXED' ? Number(b.profitPercent) : null,
              managementFeePct: b.shareType === 'WEIGHT' ? Number(b.managementFeePct || 0) : 0,
              costFeeMode: b.shareType === 'COST_FEE',
              costFeeDefaultRatePct:
                b.shareType === 'COST_FEE' && b.costFeeDefaultRatePct != null
                  ? Number(b.costFeeDefaultRatePct)
                  : null,
              payoutSchedule: form.value.payoutSchedule,
            }),
          ),
        )
      }

      toast.success('Со-инвестор создан')
      showDialog.value = false
      await refreshList()
    }
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  } finally {
    dialogLoading.value = false
  }
}

// ── Task 3: multi-cashbox blocks in the CREATE dialog ──
// User picks several cashboxes; each gets its own capital + share-mode params.
type CashBoxBlock = {
  cashBoxId: string
  capital: number
  shareType: 'FIXED' | 'WEIGHT' | 'COST_FEE'
  profitPercent: number
  managementFeePct: number
  costFeeDefaultRatePct: number | null
}
const cashBoxBlocks = ref<CashBoxBlock[]>([])

// Cashboxes the create dialog can offer (all non-archived — a brand-new
// investor participates nowhere yet).
const createAvailableCashBoxes = computed(() =>
  cashboxesStore.items.filter((x) => !x.archivedAt),
)

function isCashBoxSelected(id: string) {
  return cashBoxBlocks.value.some((b) => b.cashBoxId === id)
}

function toggleCashBox(id: string) {
  const idx = cashBoxBlocks.value.findIndex((b) => b.cashBoxId === id)
  if (idx >= 0) {
    cashBoxBlocks.value.splice(idx, 1)
  } else {
    cashBoxBlocks.value.push({
      cashBoxId: id,
      capital: 0,
      shareType: 'WEIGHT',
      profitPercent: 30,
      managementFeePct: 0,
      costFeeDefaultRatePct: null,
    })
  }
}

// ── Task 1: per-row ⋮ menu (edit person / delete person) ──
const editDialog = ref(false)
const editPerson = ref<InvestorPerson | null>(null)
function openEditPerson(p: InvestorPerson) {
  editPerson.value = p
  editDialog.value = true
}

const rowDeleteDialog = ref(false)
const rowDeletePerson = ref<InvestorPerson | null>(null)
const rowDeleting = ref(false)
function openDeletePerson(p: InvestorPerson) {
  rowDeletePerson.value = p
  rowDeleteDialog.value = true
}
async function confirmRowDeletePerson(opts: { mode: 'full' | 'exclude'; unpaid?: 'keep' | 'writeoff' }) {
  if (!rowDeletePerson.value) return
  rowDeleting.value = true
  try {
    await deletePerson(rowDeletePerson.value.id, opts)
    toast.success(opts.mode === 'full' ? 'Инвестор удалён' : 'Инвестор исключён')
    rowDeleteDialog.value = false
    await refreshList()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить инвестора')
  } finally {
    rowDeleting.value = false
  }
}

</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
      <!-- Summary Cards -->
      <div class="stats-row mb-6">
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(99, 102, 241, 0.1); color: #6366f1;">
            <v-icon icon="mdi-safe" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ formatCurrency(summaryStats.totalCapital) }}</div>
            <div class="stat-label">Общий капитал</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
            <v-icon icon="mdi-arrow-top-right" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ formatCurrency(summaryStats.totalShared) }}</div>
            <div class="stat-label">Доля со-инвесторов (начислено)</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
            <v-icon icon="mdi-cash-clock" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ formatCurrency(summaryStats.balanceOwed) }}</div>
            <div class="stat-label">К выплате</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(99, 102, 241, 0.1); color: #6366f1;">
            <v-icon icon="mdi-account-group-outline" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ summaryStats.count }}</div>
            <div class="stat-label">Со-инвесторов</div>
          </div>
        </div>
        <div v-if="isCapitalSet && capital" class="stat-card" @click="router.push('/cashboxes')" style="cursor: pointer;">
          <div class="stat-icon" style="background: rgba(124, 58, 237, 0.1); color: #7c3aed;">
            <v-icon icon="mdi-chart-pie" size="20" />
          </div>
          <div>
            <div class="stat-value" style="color: #7c3aed;">{{ poolContribution }}%</div>
            <div class="stat-label">Вклад в пул капитала</div>
          </div>
        </div>
      </div>

      <!-- Cashbox scope chips — same pattern as analytics. Tap to filter the
           list by a single cashbox. Always visible (even with one cashbox) so
           the scope is explicit and consistent across the app. -->
      <div v-if="cashboxesStore.items.length > 0" class="cb-scope mb-4">
        <div class="cb-scope-label">Касса:</div>
        <div class="cb-scope-chips">
          <button
            class="cb-scope-chip"
            :class="{ 'cb-scope-chip--active': selectedCashBoxId === null }"
            type="button"
            @click="selectedCashBoxId = null"
          >
            <v-icon icon="mdi-view-grid-outline" size="14" />
            Все кассы
          </button>
          <button
            v-for="b in cashboxesStore.items.filter((x) => !x.archivedAt)"
            :key="b.id"
            class="cb-scope-chip"
            :class="{ 'cb-scope-chip--active': selectedCashBoxId === b.id }"
            :style="selectedCashBoxId === b.id ? {
              borderColor: b.color,
              color: b.color,
              background: b.color + '14',
            } : {}"
            type="button"
            @click="selectedCashBoxId = b.id"
          >
            <v-icon :icon="b.icon" size="14" :style="{ color: b.color }" />
            {{ b.name }}
          </button>
        </div>
        <button
          type="button"
          class="cb-scope-info"
          @click="showHelpDialog = true"
        >
          <v-icon icon="mdi-help-circle-outline" size="16" />
          <span>Как работают кассы и инвесторы</span>
        </button>
      </div>

      <!-- Main Card — MOBILE: person cards (tap → the person's profile card). -->
      <v-card v-if="isMobile" rounded="lg" elevation="0" border>
        <div class="pa-4">
          <!-- Header row -->
          <div class="d-flex align-center ga-3 mb-4 flex-wrap ci-toolbar">
            <div class="filter-input-wrap ci-toolbar-search" style="max-width: 360px;">
              <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
              <input
                v-model="search"
                type="text"
                placeholder="Поиск по имени или телефону..."
                class="filter-input"
              />
            </div>
            <v-spacer />
            <div class="text-caption text-medium-emphasis mr-2">
              {{ filteredPersons.length }} из {{ persons.length }}
            </div>
            <button class="ci-add-btn" @click="openCreate">
              <v-icon icon="mdi-plus" size="18" />
              <span class="d-none d-sm-inline">Добавить со-инвестора</span>
              <span class="d-sm-none">Добавить</span>
            </button>
          </div>

          <!-- Empty state -->
          <div v-if="!filteredPersons.length" class="ci-empty">
            <div class="ci-empty-icon">
              <v-icon icon="mdi-account-group-outline" size="48" color="grey" />
            </div>
            <div class="ci-empty-title">Нет со-инвесторов</div>
            <div class="ci-empty-subtitle">
              Добавьте партнёра, чтобы распределять прибыль по сделкам
            </div>
            <button class="ci-add-btn mt-4" @click="openCreate">
              <v-icon icon="mdi-plus" size="18" />
              Добавить первого со-инвестора
            </button>
          </div>

          <!-- Persons list -->
          <div v-else class="ci-list">
            <div
              v-for="p in filteredPersons"
              :key="p.id"
              class="ci-card"
              :class="{ 'ci-card--expanded': expandedPersons.has(p.id) }"
              @click="togglePersonExpand(p.id)"
            >
              <div class="ci-header">
                <button class="ci-td-chevron" :class="{ 'ci-td-chevron--open': expandedPersons.has(p.id) }" @click.stop="togglePersonExpand(p.id)">
                  <v-icon icon="mdi-chevron-down" size="20" />
                </button>
                <div class="ci-avatar" :style="{ background: getAvatarColor(p.name) }">
                  {{ getInitials(p.name) }}
                </div>

                <div class="ci-main">
                  <span class="ci-name">{{ p.name }}</span>
                </div>

                <div class="ci-card-menu" @click.stop>
                  <button class="ci-row-act" title="Открыть карточку инвестора" @click="router.push(`/co-investors/person/${p.id}`)">
                    <v-icon icon="mdi-open-in-new" size="19" />
                  </button>
                  <v-menu :close-on-content-click="true" offset="4" location="bottom end">
                    <template #activator="{ props: menuProps }">
                      <button class="ci-row-act" title="Действия" v-bind="menuProps">
                        <v-icon icon="mdi-dots-vertical" size="20" />
                      </button>
                    </template>
                    <div class="ci-row-menu">
                      <button class="ci-menu-item" @click="router.push(`/co-investors/person/${p.id}`)">
                        <v-icon icon="mdi-open-in-new" size="18" />
                        <span>Открыть</span>
                      </button>
                      <button class="ci-menu-item" @click="openEditPerson(p)">
                        <v-icon icon="mdi-pencil-outline" size="18" />
                        <span>Редактировать</span>
                      </button>
                      <div class="ci-menu-divider" />
                      <button class="ci-menu-item ci-menu-item--danger" @click="openDeletePerson(p)">
                        <v-icon icon="mdi-trash-can-outline" size="18" />
                        <span>Удалить инвестора</span>
                      </button>
                    </div>
                  </v-menu>
                </div>
              </div>

              <!-- Раскрытая часть: контакт + сводка + доли + кассы + переход -->
              <div v-if="expandedPersons.has(p.id)" class="ci-card-expand" @click.stop>
                <!-- Контакт + участие -->
                <div v-if="p.phone || p.cashBoxCount" class="ci-exp-meta">
                  <a v-if="p.phone" :href="`tel:+7${p.phone}`" class="ci-exp-meta-item" @click.stop>
                    <v-icon icon="mdi-phone-outline" size="14" />
                    {{ formatPhone(p.phone) }}
                  </a>
                  <span class="ci-exp-meta-item">
                    <v-icon icon="mdi-wallet-outline" size="14" />
                    {{ p.cashBoxCount }} касс{{ p.cashBoxCount === 1 ? 'а' : (p.cashBoxCount < 5 ? 'ы' : '') }}
                  </span>
                </div>

                <!-- Сводка: капитал / начислено / выплачено / к выплате -->
                <div class="ci-exp-stats">
                  <div class="ci-stat-m">
                    <div class="ci-stat-m-label">Капитал</div>
                    <div class="ci-stat-m-value">{{ formatCurrency(p.totals.currentCapital) }}</div>
                  </div>
                  <div class="ci-stat-m">
                    <div class="ci-stat-m-label">Начислено</div>
                    <div class="ci-stat-m-value" style="color: #047857;">{{ formatCurrency(p.totals.realizedProfit) }}</div>
                  </div>
                  <div class="ci-stat-m">
                    <div class="ci-stat-m-label">Выплачено</div>
                    <div class="ci-stat-m-value" style="color: #7c3aed;">{{ formatCurrency(p.totals.totalPayout) }}</div>
                  </div>
                  <div class="ci-stat-m">
                    <div class="ci-stat-m-label">К выплате</div>
                    <div class="ci-stat-m-value" style="color: #f59e0b;">{{ formatCurrency(p.totals.balanceOwed) }}</div>
                  </div>
                </div>

                <!-- KPI: доля инвестора / моя доля -->
                <div class="ci-kpi-row">
                  <div class="ci-kpi">
                    <div class="ci-kpi-label">Доля инвестора</div>
                    <div class="ci-kpi-val" style="color: #6366f1;">{{ formatCurrency(p.distribution?.coInvestorShare ?? 0) }}</div>
                  </div>
                  <div class="ci-kpi">
                    <div class="ci-kpi-label">Моя доля</div>
                    <div class="ci-kpi-val" style="color: #047857;">{{ formatCurrency(p.distribution?.myShare ?? 0) }}</div>
                  </div>
                </div>

                <!-- Кассы: сверху вниз, под каждой — распределение прибыли -->
                <div class="ci-section-title">Кассы</div>
                <div class="ci-stakes-list">
                  <div v-for="s in p.stakes" :key="s.id" class="ci-stake-card">
                    <div class="ci-stake-card-head ci-stake-card-head--static">
                      <div class="ci-stake-chip-icon" :style="{ background: s.cashBox.color, color: '#fff' }">
                        <v-icon :icon="s.cashBox.icon || 'mdi-wallet-outline'" size="16" />
                      </div>
                      <div class="ci-stake-chip-body">
                        <div class="ci-stake-chip-name">{{ s.cashBox.name }}</div>
                        <div class="ci-stake-chip-mode">{{ stakeModeShort(s) }} · капитал {{ formatCurrency(s.currentCapital) }}</div>
                      </div>
                      <div class="ci-stake-chip-owed" v-if="s.balanceOwed > 0">
                        <span class="ci-stake-chip-owed-val">{{ formatCurrencyShort(s.balanceOwed) }}</span>
                        <span class="ci-stake-chip-owed-label">к выплате</span>
                      </div>
                    </div>
                    <div v-if="stakeTotalProfit(s) > 0" class="ci-stake-dist">
                      <div class="ci-stake-dist-head">
                        <span class="ci-stake-dist-title">Распределение прибыли</span>
                        <span class="ci-stake-dist-right">
                          <v-tooltip location="left" open-on-click max-width="300">
                            <template #activator="{ props }">
                              <button type="button" v-bind="props" class="ci-dist-help" @click.stop aria-label="Что это за число">
                                <v-icon icon="mdi-help-circle" size="15" />
                              </button>
                            </template>
                            <div style="font-size: 12.5px; line-height: 1.55;">
                              Это <b>вся прибыль (наценка)</b> по всем сделкам инвестора в этой кассе — и по активным, и по завершённым, за всё время.<br /><br />
                              <span style="color: #a5b4fc;">■</span> синим — сколько получает <b>инвестор</b>;<br />
                              <span style="color: #6ee7b7;">■</span> зелёным — сколько остаётся <b>вам</b>.<br /><br />
                              Это накопительный итог, а не «деньги в работе».
                            </div>
                          </v-tooltip>
                          <span class="ci-stake-dist-total">{{ formatCurrency(stakeTotalProfit(s)) }}</span>
                        </span>
                      </div>
                      <div class="ci-dist-bar">
                        <div class="ci-dist-fill" :style="{ width: stakeInvestorPct(s) + '%' }" />
                      </div>
                      <div class="ci-dist-legend">
                        <div class="ci-dist-leg">
                          <span class="ci-dist-leg-pct" style="color: #6366f1;">Инвестору · {{ stakeInvestorPct(s) }}%</span>
                          <span class="ci-dist-leg-amt" style="color: #6366f1;">{{ formatCurrency(s.coInvestorShare ?? 0) }}</span>
                        </div>
                        <div class="ci-dist-leg ci-dist-leg--right">
                          <span class="ci-dist-leg-pct" style="color: #047857;">Моя доля · {{ 100 - stakeInvestorPct(s) }}%</span>
                          <span class="ci-dist-leg-amt" style="color: #047857;">{{ formatCurrency(s.myShare ?? 0) }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-if="!p.stakes.length" class="ci-stake-none">Инвестор не участвует ни в одной кассе</div>
                </div>

                <div class="ci-expanded-actions">
                  <router-link :to="`/co-investors/person/${p.id}`" class="ci-expanded-btn">
                    Открыть карточку инвестора
                    <v-icon icon="mdi-arrow-right" size="16" />
                  </router-link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </v-card>

      <!-- DESKTOP: full-width table. Row = a PERSON; click → their profile card. -->
      <v-card v-else rounded="lg" elevation="0" border>
        <div class="pa-4">
          <div class="d-flex align-center ga-3 mb-4 flex-wrap ci-toolbar">
            <div class="filter-input-wrap" style="max-width: 360px;">
              <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
              <input v-model="search" type="text" placeholder="Поиск по имени или телефону..." class="filter-input" />
            </div>
            <v-spacer />
            <div class="text-caption text-medium-emphasis mr-2">
              {{ filteredPersons.length }} из {{ persons.length }}
            </div>
            <button class="ci-add-btn" @click="openCreate">
              <v-icon icon="mdi-plus" size="18" />
              <span>Добавить со-инвестора</span>
            </button>
          </div>

          <!-- Empty state -->
          <div v-if="!filteredPersons.length" class="ci-empty">
            <div class="ci-empty-icon">
              <v-icon icon="mdi-account-group-outline" size="48" color="grey" />
            </div>
            <div class="ci-empty-title">Нет со-инвесторов</div>
            <div class="ci-empty-subtitle">
              {{ search || selectedCashBoxId ? 'Ничего не найдено по фильтру' : 'Добавьте партнёра, чтобы распределять прибыль по сделкам' }}
            </div>
            <button v-if="!search && !selectedCashBoxId" class="ci-add-btn mt-4" @click="openCreate">
              <v-icon icon="mdi-plus" size="18" />
              Добавить первого со-инвестора
            </button>
          </div>

          <table v-else class="ci-table">
            <thead>
              <tr>
                <th>Инвестор</th>
                <th class="ci-th-num">Капитал</th>
                <th class="ci-th-num">Кассы</th>
                <th class="ci-th-num">Начислено</th>
                <th class="ci-th-num">К выплате</th>
                <th class="ci-th-act"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="p in filteredPersons" :key="p.id">
              <tr
                class="ci-trow"
                :class="{ 'ci-trow--expanded': expandedPersons.has(p.id) }"
                @click="togglePersonExpand(p.id)"
              >
                <td>
                  <div class="ci-td-investor">
                    <button class="ci-td-chevron" :class="{ 'ci-td-chevron--open': expandedPersons.has(p.id) }" @click.stop="togglePersonExpand(p.id)">
                      <v-icon icon="mdi-chevron-down" size="20" />
                    </button>
                    <div class="ci-row-avatar" :style="{ background: ciAvatarColor(p.name) }">
                      {{ ciInitials(p.name) }}
                    </div>
                    <div class="ci-td-idn">
                      <div class="ci-td-name">{{ p.name }}</div>
                      <div v-if="p.phone" class="ci-td-phone">{{ formatPhone(p.phone) }}</div>
                    </div>
                  </div>
                </td>
                <td class="ci-td-num">{{ formatCurrency(p.totals.currentCapital) }}</td>
                <td class="ci-td-right">
                  <div class="ci-cb-chips">
                    <span
                      v-for="s in p.stakes"
                      :key="s.id"
                      class="ci-cb-mini"
                      :style="{ color: s.cashBox.color, background: s.cashBox.color + '14', borderColor: s.cashBox.color + '40' }"
                      :title="s.cashBox.name + ' · ' + stakeModeShort(s)"
                    >
                      <v-icon :icon="stakeModeIcon(s)" size="12" />
                      <span class="ci-cb-mini-name">{{ s.cashBox.name }}</span>
                      <span class="ci-cb-mini-mode">{{ stakeModeShort(s) }}</span>
                    </span>
                    <span v-if="p.stakes.length === 0" class="ci-cb-none">Нет касс</span>
                  </div>
                </td>
                <td class="ci-td-num" style="color: #047857;">{{ formatCurrency(p.totals.realizedProfit) }}</td>
                <td class="ci-td-num" style="color: #f59e0b;">{{ formatCurrency(p.totals.balanceOwed) }}</td>
                <td class="ci-td-actions" @click.stop>
                  <div class="ci-td-actions-row">
                    <button class="ci-row-act" title="Открыть карточку инвестора" @click="router.push(`/co-investors/person/${p.id}`)">
                      <v-icon icon="mdi-open-in-new" size="18" />
                    </button>
                    <v-menu :close-on-content-click="true" offset="4" location="bottom end">
                      <template #activator="{ props: menuProps }">
                        <button class="ci-row-act" title="Действия" v-bind="menuProps">
                          <v-icon icon="mdi-dots-vertical" size="18" />
                        </button>
                      </template>
                      <div class="ci-row-menu">
                        <button class="ci-menu-item" @click="router.push(`/co-investors/person/${p.id}`)">
                          <v-icon icon="mdi-open-in-new" size="18" />
                          <span>Открыть</span>
                        </button>
                        <button class="ci-menu-item" @click="openEditPerson(p)">
                          <v-icon icon="mdi-pencil-outline" size="18" />
                          <span>Редактировать</span>
                        </button>
                        <div class="ci-menu-divider" />
                        <button class="ci-menu-item ci-menu-item--danger" @click="openDeletePerson(p)">
                          <v-icon icon="mdi-trash-can-outline" size="18" />
                          <span>Удалить инвестора</span>
                        </button>
                      </div>
                    </v-menu>
                  </div>
                </td>
              </tr>
              <!-- Раскрытая строка: краткая сводка по кассам + метрики -->
              <tr v-if="expandedPersons.has(p.id)" class="ci-trow-expand">
                <td colspan="6">
                  <div class="ci-expanded" @click.stop>
                    <!-- Метрики -->
                    <div class="ci-extra-stats">
                      <div class="ci-stat-m">
                        <div class="ci-stat-m-label">Начислено</div>
                        <div class="ci-stat-m-value" style="color: #047857;">{{ formatCurrency(p.totals.realizedProfit) }}</div>
                      </div>
                      <div class="ci-stat-m">
                        <div class="ci-stat-m-label">Выплачено</div>
                        <div class="ci-stat-m-value" style="color: #7c3aed;">{{ formatCurrency(p.totals.totalPayout) }}</div>
                      </div>
                      <div class="ci-stat-m">
                        <div class="ci-stat-m-label">К выплате</div>
                        <div class="ci-stat-m-value" style="color: #f59e0b;">{{ formatCurrency(p.totals.balanceOwed) }}</div>
                      </div>
                    </div>

                    <!-- KPI: капитал / доля инвестора / моя доля -->
                    <div class="ci-kpi-row">
                      <div class="ci-kpi">
                        <div class="ci-kpi-label">Капитал</div>
                        <div class="ci-kpi-val">{{ formatCurrency(p.totals.currentCapital) }}</div>
                      </div>
                      <div class="ci-kpi">
                        <div class="ci-kpi-label">Доля инвестора</div>
                        <div class="ci-kpi-val" style="color: #6366f1;">{{ formatCurrency(p.distribution?.coInvestorShare ?? 0) }}</div>
                      </div>
                      <div class="ci-kpi">
                        <div class="ci-kpi-label">Моя доля</div>
                        <div class="ci-kpi-val" style="color: #047857;">{{ formatCurrency(p.distribution?.myShare ?? 0) }}</div>
                      </div>
                    </div>

                    <!-- Кассы: перечисление сверху вниз, под каждой — распределение прибыли -->
                    <div class="ci-section-title">Кассы</div>
                    <div class="ci-stakes-list">
                      <div v-for="s in p.stakes" :key="s.id" class="ci-stake-card">
                        <div class="ci-stake-card-head ci-stake-card-head--static">
                          <div class="ci-stake-chip-icon" :style="{ background: s.cashBox.color, color: '#fff' }">
                            <v-icon :icon="s.cashBox.icon || 'mdi-wallet-outline'" size="16" />
                          </div>
                          <div class="ci-stake-chip-body">
                            <div class="ci-stake-chip-name">{{ s.cashBox.name }}</div>
                            <div class="ci-stake-chip-mode">{{ stakeModeShort(s) }} · капитал {{ formatCurrency(s.currentCapital) }}</div>
                          </div>
                          <div class="ci-stake-chip-owed" v-if="s.balanceOwed > 0">
                            <span class="ci-stake-chip-owed-val">{{ formatCurrencyShort(s.balanceOwed) }}</span>
                            <span class="ci-stake-chip-owed-label">к выплате</span>
                          </div>
                        </div>
                        <div v-if="stakeTotalProfit(s) > 0" class="ci-stake-dist">
                          <div class="ci-stake-dist-head">
                            <span class="ci-stake-dist-title">Распределение прибыли</span>
                            <span class="ci-stake-dist-right">
                              <v-tooltip location="left" open-on-click max-width="300">
                                <template #activator="{ props }">
                                  <button type="button" v-bind="props" class="ci-dist-help" @click.stop aria-label="Что это за число">
                                    <v-icon icon="mdi-help-circle" size="15" />
                                  </button>
                                </template>
                                <div style="font-size: 12.5px; line-height: 1.55;">
                                  Это <b>вся прибыль (наценка)</b> по всем сделкам инвестора в этой кассе — и по активным, и по завершённым, за всё время.<br /><br />
                                  <span style="color: #a5b4fc;">■</span> синим — сколько получает <b>инвестор</b>;<br />
                                  <span style="color: #6ee7b7;">■</span> зелёным — сколько остаётся <b>вам</b>.<br /><br />
                                  Это накопительный итог, а не «деньги в работе».
                                </div>
                              </v-tooltip>
                              <span class="ci-stake-dist-total">{{ formatCurrency(stakeTotalProfit(s)) }}</span>
                            </span>
                          </div>
                          <div class="ci-dist-bar">
                            <div class="ci-dist-fill" :style="{ width: stakeInvestorPct(s) + '%' }" />
                          </div>
                          <div class="ci-dist-legend">
                            <div class="ci-dist-leg">
                              <span class="ci-dist-leg-pct" style="color: #6366f1;">Инвестору · {{ stakeInvestorPct(s) }}%</span>
                              <span class="ci-dist-leg-amt" style="color: #6366f1;">{{ formatCurrency(s.coInvestorShare ?? 0) }}</span>
                            </div>
                            <div class="ci-dist-leg ci-dist-leg--right">
                              <span class="ci-dist-leg-pct" style="color: #047857;">Моя доля · {{ 100 - stakeInvestorPct(s) }}%</span>
                              <span class="ci-dist-leg-amt" style="color: #047857;">{{ formatCurrency(s.myShare ?? 0) }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div v-if="!p.stakes.length" class="ci-stake-none">Инвестор не участвует ни в одной кассе</div>
                    </div>

                    <div class="ci-expanded-actions">
                      <router-link :to="`/co-investors/person/${p.id}`" class="ci-expanded-btn" @click.stop>
                        Открыть карточку инвестора
                        <v-icon icon="mdi-arrow-right" size="16" />
                      </router-link>
                    </div>
                  </div>
                </td>
              </tr>
              </template>
            </tbody>
          </table>
        </div>
      </v-card>


      <!-- Charts (moved below the list) -->
      <v-row v-if="persons.length > 0" class="mt-5">
        <v-col cols="12" lg="6">
          <v-card rounded="lg" elevation="0" border class="pa-5">
            <div class="d-flex align-center justify-space-between mb-4">
              <div>
                <div class="chart-title">Капитал по партнёрам</div>
                <div class="chart-subtitle">Вложенные средства</div>
              </div>
              <div class="chart-total">{{ formatCurrency(summaryStats.totalCapital) }}</div>
            </div>
            <div style="height: 240px;">
              <Bar :data="capitalChartData" :options="barOptions" />
            </div>
          </v-card>
        </v-col>
        <v-col cols="12" lg="6">
          <v-card rounded="lg" elevation="0" border class="pa-5">
            <div class="d-flex align-center justify-space-between mb-4">
              <div>
                <div class="chart-title">Доходность по партнёрам</div>
                <div class="chart-subtitle">Распределение прибыли</div>
              </div>
            </div>
            <div style="height: 240px;">
              <Bar :data="profitChartData" :options="profitBarOptions" />
            </div>
          </v-card>
        </v-col>
      </v-row>
    </template>

    <!-- Create Dialog (new person OR new stake for an existing person). -->
    <v-dialog v-model="showDialog" max-width="480" persistent :fullscreen="isMobile">
      <v-card rounded="lg" class="ci-form-card">
        <div class="ci-dialog-header">
          <span class="ci-dialog-title">Новый инвестор</span>
          <button class="ci-dialog-close" @click="showDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="ci-dialog-scroll">
          <!-- Name -->
          <div class="ci-field mb-4 mt-5">
            <label class="ci-field-label">Имя <span style="color: #ef4444;">*</span></label>
            <input
              v-model="form.name"
              type="text"
              class="ci-field-input"
              placeholder="Фамилия Имя"
            />
          </div>

          <!-- Phone -->
          <div class="ci-field mb-4">
            <label class="ci-field-label">Телефон</label>
            <input
              v-model="form.phone"
              v-maska="PHONE_MASK"
              type="tel"
              class="ci-field-input"
              placeholder="+7 (___) ___-__-__"
            />
          </div>

          <!-- Task 3: multi-cashbox picker. Pinned to the top of the scroll area
               so it stays reachable while the per-cashbox blocks scroll below. -->
          <div class="ci-field mb-4 ci-cb-sticky">
            <label class="ci-field-label">
              Добавить кассы <span style="color: #ef4444;">*</span>
            </label>
            <div v-if="createAvailableCashBoxes.length === 0" class="ci-field-hint">
              Инвестор уже участвует во всех кассах.
            </div>
            <div v-else class="ci-cb-multi">
              <button
                v-for="b in createAvailableCashBoxes"
                :key="b.id"
                type="button"
                class="ci-cb-tag"
                :class="{ 'ci-cb-tag--active': isCashBoxSelected(b.id) }"
                :style="isCashBoxSelected(b.id) ? { borderColor: b.color, color: b.color, background: b.color + '14' } : {}"
                @click="toggleCashBox(b.id)"
              >
                <v-icon :icon="isCashBoxSelected(b.id) ? 'mdi-check-circle' : b.icon" size="15" :style="{ color: b.color }" />
                {{ b.name }}
              </button>
            </div>
            <div class="ci-field-hint">Параметры (капитал, доля) задаются отдельно на каждую выбранную кассу — ниже.</div>
          </div>

          <!-- Per-cashbox parameter blocks -->
          <div
            v-for="block in cashBoxBlocks"
            :key="block.cashBoxId"
            class="ci-cb-block mb-4"
          >
            <div class="ci-cb-block-head">
              <span class="ci-cb-block-icon" :style="{ color: getCashBox(block.cashBoxId)?.color }">
                <v-icon :icon="getCashBox(block.cashBoxId)?.icon || 'mdi-wallet-outline'" size="16" />
              </span>
              <span class="ci-cb-block-name">{{ getCashBox(block.cashBoxId)?.name }}</span>
              <button type="button" class="ci-cb-block-remove" title="Убрать кассу" @click="toggleCashBox(block.cashBoxId)">
                <v-icon icon="mdi-close" size="16" />
              </button>
            </div>

            <!-- Capital -->
            <div class="ci-field mb-3">
              <label class="ci-field-label">Капитал <span style="color: #ef4444;">*</span></label>
              <div class="ci-field-input-wrap">
                <input
                  :value="block.capital || ''"
                  v-maska="CURRENCY_MASK"
                  @maska="(e: any) => block.capital = parseMasked(e)"
                  type="text"
                  inputmode="numeric"
                  class="ci-field-input"
                  placeholder="0"
                />
                <span class="ci-field-suffix">₽</span>
              </div>
            </div>

            <!-- Share mode (cost-fee first, as everywhere) -->
            <div class="ci-field mb-3">
              <label class="ci-field-label">Способ деления прибыли</label>
              <v-menu :close-on-content-click="true" offset="4">
                <template #activator="{ props: menuProps }">
                  <button type="button" class="ci-mode-picker" v-bind="menuProps">
                    <v-icon :icon="shareTypeOption(block.shareType).icon" size="18" />
                    <span class="ci-mode-picker-name">{{ shareTypeOption(block.shareType).label }}</span>
                    <v-icon icon="mdi-chevron-down" size="18" />
                  </button>
                </template>
                <div class="ci-mode-menu">
                  <button
                    v-for="opt in SHARE_TYPE_OPTIONS"
                    :key="opt.value"
                    type="button"
                    class="ci-mode-menu-item"
                    :class="{ 'ci-mode-menu-item--active': block.shareType === opt.value }"
                    @click="block.shareType = opt.value"
                  >
                    <v-icon :icon="opt.icon" size="18" />
                    <span class="ci-mode-picker-name">{{ opt.label }}</span>
                    <v-icon v-if="block.shareType === opt.value" icon="mdi-check" size="16" />
                  </button>
                </div>
              </v-menu>
            </div>

            <!-- Cost-fee rate -->
            <div v-if="block.shareType === 'COST_FEE'" class="ci-field mb-1">
              <label class="ci-field-label">Ставка по умолчанию, % от закупки</label>
              <div class="ci-percent-presets mb-2">
                <button
                  v-for="p in COST_FEE_PRESETS"
                  :key="p"
                  class="ci-percent-chip"
                  :class="{ 'ci-percent-chip--active': block.costFeeDefaultRatePct === p }"
                  @click="block.costFeeDefaultRatePct = p"
                >{{ p }}%</button>
              </div>
              <div class="ci-field-input-wrap">
                <input v-model.number="block.costFeeDefaultRatePct" type="number" class="ci-field-input" placeholder="напр. 5" min="0" max="100" />
                <span class="ci-field-suffix">%</span>
              </div>
            </div>

            <!-- Fixed percent -->
            <div v-if="block.shareType === 'FIXED'" class="ci-field mb-1">
              <label class="ci-field-label">Процент от прибыли <span style="color: #ef4444;">*</span></label>
              <div class="ci-percent-presets mb-2">
                <button
                  v-for="p in PERCENT_PRESETS"
                  :key="p"
                  class="ci-percent-chip"
                  :class="{ 'ci-percent-chip--active': block.profitPercent === p }"
                  @click="block.profitPercent = p"
                >{{ p }}%</button>
              </div>
              <div class="ci-field-input-wrap">
                <input v-model.number="block.profitPercent" type="number" class="ci-field-input" placeholder="30" min="1" max="99" />
                <span class="ci-field-suffix">%</span>
              </div>
            </div>

            <!-- Partner commission -->
            <div v-if="block.shareType === 'WEIGHT'" class="ci-field mb-1">
              <label class="ci-field-label">Комиссия партнёра</label>
              <div class="ci-percent-presets mb-2">
                <button
                  v-for="p in FEE_PRESETS"
                  :key="p"
                  class="ci-percent-chip"
                  :class="{ 'ci-percent-chip--active': block.managementFeePct === p }"
                  @click="block.managementFeePct = p"
                >{{ p }}%</button>
              </div>
              <div class="ci-field-input-wrap">
                <input v-model.number="block.managementFeePct" type="number" class="ci-field-input" placeholder="0" min="0" max="100" />
                <span class="ci-field-suffix">%</span>
              </div>
            </div>
          </div>

          <!-- Payout schedule -->
          <div class="ci-field mt-4">
            <label class="ci-field-label">Периодичность выплат</label>
            <div class="payout-schedule-grid">
              <button
                v-for="opt in PAYOUT_OPTIONS"
                :key="opt.value"
                type="button"
                class="payout-option"
                :class="{ 'payout-option--active': form.payoutSchedule === opt.value }"
                @click="form.payoutSchedule = opt.value"
              >
                <v-icon :icon="opt.icon" size="16" />
                <span>{{ opt.label }}</span>
              </button>
            </div>
            <div class="ci-field-hint">Как часто вы планируете выплачивать дивиденды</div>
          </div>

          <!-- Next planned payout date -->
          <div class="ci-field mt-4">
            <label class="ci-field-label">Первая выплата</label>
            <input
              v-model="form.nextPayoutDate"
              type="date"
              class="ci-field-input"
            />
            <div class="ci-field-hint">
              Конкретная дата ближайшей выплаты. После каждой выплаты автоматически
              сдвинется вперёд на выбранную периодичность.
            </div>
          </div>
        </div>

        <div class="ci-dialog-actions">
          <button class="ci-btn ci-btn--ghost" @click="showDialog = false" :disabled="dialogLoading">
            Отмена
          </button>
          <button class="ci-btn ci-btn--primary" @click="saveCoInvestor" :disabled="dialogLoading">
            <v-progress-circular v-if="dialogLoading" indeterminate size="16" width="2" color="white" class="mr-2" />
            Создать
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Task 1: full person editor (identity + all cashbox stakes + add cashbox) -->
    <CoInvestorEditDialog
      v-if="editPerson"
      v-model="editDialog"
      :person-id="editPerson.id"
      @saved="refreshList"
    />

    <!-- Task 1: delete-person dialog (across all cashboxes) -->
    <CoInvestorRemoveDialog
      v-if="rowDeletePerson"
      v-model="rowDeleteDialog"
      scope="person"
      :name="rowDeletePerson.name"
      :cash-box-count="rowDeletePerson.cashBoxCount"
      :balance-owed="rowDeletePerson.totals.balanceOwed"
      :loading="rowDeleting"
      @confirm="confirmRowDeletePerson"
    />

    <!-- Help dialog: explains cashboxes, CI types, and profit distribution -->
    <v-dialog v-model="showHelpDialog" max-width="720" scrollable :fullscreen="isMobile">
      <v-card rounded="lg" class="help-card">
        <div class="help-head">
          <span class="help-title">Кассы, инвесторы и распределение прибыли</span>
          <button class="help-close" @click="showHelpDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
        <div class="help-body pa-5">
          <!-- ───── Касса ───── -->
          <section class="help-section">
            <div class="help-section-title">
              <v-icon icon="mdi-wallet-outline" size="20" color="primary" />
              Что такое касса
            </div>
            <p class="help-p">
              <strong>Касса</strong> — это отдельный «кошелёк» с собственным учётом капитала, сделок и инвесторов.
              У каждой кассы свой начальный капитал (ваш вклад), своя прибыль, свой список сделок и свой набор со-инвесторов.
            </p>
            <p class="help-p">
              Каждая сделка обязательно принадлежит одной кассе. Деньги клиента приходят в эту кассу,
              закупка делается из её капитала. По умолчанию все сделки попадают в «Основную» кассу, но вы можете
              создавать дополнительные — например, под конкретного инвестора, направление товара или совместный проект.
            </p>
          </section>

          <!-- ───── Co-investor ───── -->
          <section class="help-section">
            <div class="help-section-title">
              <v-icon icon="mdi-account-group-outline" size="20" color="primary" />
              Что такое со-инвестор
            </div>
            <p class="help-p">
              <strong>Со-инвестор</strong> — это человек, который вложил свои деньги в одну из ваших касс и делит с вами прибыль с её сделок.
              Один инвестор привязан к одной кассе. По умолчанию новая сделка кассы включает всех её со-инвесторов —
              подключать к каждой сделке вручную не нужно.
            </p>
            <p class="help-p">
              Но участие можно настраивать по сделке: при создании сделки уберите лишних инвесторов или
              переопределите их процент именно для этой сделки. А со-инвестора, добавленного в кассу
              <strong>после</strong> создания сделки, нужно привязать к ней вручную — старые сделки его не подхватывают.
            </p>
          </section>

          <!-- ───── Типы доли ───── -->
          <section class="help-section">
            <div class="help-section-title">
              <v-icon icon="mdi-handshake-outline" size="20" color="primary" />
              Три типа доли в прибыли
            </div>
            <div class="help-types">
              <div class="help-type">
                <div class="help-type-head">
                  <v-icon icon="mdi-handshake-outline" size="18" color="#7c3aed" />
                  <span>Фиксированный процент</span>
                </div>
                <p class="help-p">
                  Инвестор получает заранее оговорённый процент с каждой сделки кассы — независимо от суммы вложенного капитала.
                  Этот процент забирается <strong>первым</strong>, с «верха» прибыли. Подходит для премиальных контрактов и
                  гарантированных условий — например: «Возьму 30% с прибыли, независимо от того, кто ещё вложился».
                </p>
              </div>
              <div class="help-type">
                <div class="help-type-head">
                  <v-icon icon="mdi-scale-balance" size="18" color="#6366f1" />
                  <span>По вкладу капитала</span>
                </div>
                <p class="help-p">
                  Доля считается пропорционально вложенному капиталу — относительно других инвесторов «по вкладу»
                  и вашего собственного вклада. Это стандартный паттерн «мудараба» — кто больше вложил, тот больше получит.
                  Доля плавает: при вводе/выводе капитала пересчитывается автоматически.
                </p>
              </div>
            </div>
            <div class="help-callout help-callout--info">
              <v-icon icon="mdi-information-outline" size="16" />
              <div>
                В одной кассе могут быть оба типа одновременно. Сумма фиксированных процентов не может превышать <strong>99%</strong>
                — иначе инвесторам «по вкладу» и партнёру нечего будет делить.
              </div>
            </div>

            <!-- Третий тип: комиссия от закупки -->
            <div class="help-type mt-4">
              <div class="help-type-head">
                <v-icon icon="mdi-tag-outline" size="18" color="#047857" />
                <span>Комиссия от закупки (по сроку)</span>
              </div>
              <p class="help-p">
                Партнёр вкладывает деньги инвестора и управляет; его доля = <strong>ставка % × закупочная цена</strong>
                (ставку задаёте на каждой сделке под её срок — 3/6/9/12 мес). Инвестору достаётся вся наценка
                минус эта комиссия. Пример: закупка 100 000, наценка 15 000, ставка 5% → партнёру 5 000, инвестору 10 000.
                Такой инвестор — единственный участник своей сделки, а комиссия не может превысить наценку.
              </p>
            </div>
          </section>

          <!-- ───── Модель пула (per-cashbox + per-CI) ───── -->
          <section class="help-section">
            <div class="help-section-title">
              <v-icon icon="mdi-tune-vertical" size="20" color="primary" />
              Как делите остаток с инвесторами «по вкладу»
            </div>
            <p class="help-p">
              Остаток прибыли (после фикс-инвесторов) делится между вами и инвесторами «по вкладу»
              с помощью двух настроек — на кассе и на инвесторе.
            </p>
            <div class="help-types">
              <div class="help-type">
                <div class="help-type-head">
                  <v-icon icon="mdi-handshake" size="18" />
                  <span>Партнёр вкладывает капитал — настройка кассы</span>
                </div>
                <p class="help-p">
                  Включено (по умолчанию): ваш начальный капитал кассы считается как ещё один «вклад» в пуле,
                  и остаток делится пропорционально всем вкладам, включая ваш. Выключено: вы только управляете,
                  а весь капитал — внешний. Переключается в настройках кассы.
                </p>
              </div>
              <div class="help-type">
                <div class="help-type-head">
                  <v-icon icon="mdi-briefcase-outline" size="18" />
                  <span>Комиссия партнёра — настройка инвестора</span>
                </div>
                <p class="help-p">
                  У каждого инвестора «по вкладу» можно задать вашу комиссию (0–100%). Вы забираете этот процент
                  <strong>с его расчётной доли</strong>, остальное получает он. Например, при комиссии 50%
                  инвестор получит половину того, что причиталось бы ему по капиталу, — вторую половину берёте вы.
                </p>
              </div>
            </div>
            <div class="help-callout help-callout--info">
              <v-icon icon="mdi-information-outline" size="16" />
              <div>
                Обе настройки — на уровне кассы и инвестора, поэтому в разных кассах у вас могут быть разные условия,
                а у разных инвесторов в одной кассе — разная комиссия.
              </div>
            </div>
          </section>

          <!-- ───── Алгоритм ───── -->
          <section class="help-section">
            <div class="help-section-title">
              <v-icon icon="mdi-function-variant" size="20" color="primary" />
              Как именно делится прибыль (пошагово)
            </div>
            <ol class="help-steps">
              <li>
                <strong>Фиксированные инвесторы забирают свою долю первыми.</strong>
                Сумма их процентов вычитается с прибыли по сделке.
              </li>
              <li>
                <strong>Остаток уходит в «пул по вкладам»</strong> — между вами и инвесторами «по вкладу»
                (только среди участников этой сделки).
              </li>
              <li>
                <strong>Расчётная доля каждого инвестора</strong> = остаток × <em>(вклад инвестора ÷ сумма вкладов)</em>.
                Если у кассы включено «партнёр вкладывает капитал», в сумму вкладов входит и ваш капитал —
                значит часть остатка сразу остаётся вам.
              </li>
              <li>
                <strong>Комиссия инвестора.</strong> С расчётной доли инвестора вы забираете его комиссию (0–100%),
                остальное получает он. Всё, что не досталось инвесторам, — ваше.
              </li>
            </ol>
          </section>

          <!-- ───── Пример ───── -->
          <section class="help-section">
            <div class="help-section-title">
              <v-icon icon="mdi-calculator-variant-outline" size="20" color="primary" />
              Живой пример
            </div>
            <p class="help-p">
              Касса с вашим капиталом 9 360 000 ₽, включено «партнёр вкладывает капитал».
              Два инвестора: Изнаур с фиксированной долей 30% и капиталом 1 000 000 ₽,
              Ислам — «по вкладу» с капиталом 2 000 000 ₽.
              Допустим, прибыль со сделки составила <strong>100 000 ₽</strong>.
            </p>
            <div class="help-example">
              <div class="help-example-row">
                <span class="help-example-step">1</span>
                <span>Изнаур забирает первым: 100 000 × 30% = <strong>30 000 ₽</strong>.</span>
              </div>
              <div class="help-example-row">
                <span class="help-example-step">2</span>
                <span>Остаётся <strong>70 000 ₽</strong>. Делятся между вами (вклад 9.36М) и Исламом (вклад 2М).</span>
              </div>
              <div class="help-example-row">
                <span class="help-example-step">3</span>
                <span>Доля Ислама: 70 000 × (2М ÷ 11.36М) = <strong>12 324 ₽</strong>.</span>
              </div>
              <div class="help-example-row">
                <span class="help-example-step">4</span>
                <span>Ваша доля: 70 000 − 12 324 = <strong>57 676 ₽</strong>.</span>
              </div>
            </div>
            <div class="help-example-summary">
              Итого со 100 000 ₽ прибыли: <strong>Изнаур 30 000 ₽ (30%)</strong> · <strong>Ислам 12 324 ₽ (12.32%)</strong> · <strong>вам 57 676 ₽ (57.68%)</strong>.
              Обратите внимание — Ислам и вы получаете одинаковую <em>доходность на капитал</em> (≈6.16 копеек с каждого вложенного рубля),
              просто у вас больше капитала в пуле, поэтому в абсолютной сумме доля больше.
            </div>
          </section>

          <!-- ───── Капитал и выплаты ───── -->
          <section class="help-section">
            <div class="help-section-title">
              <v-icon icon="mdi-cash-multiple" size="20" color="primary" />
              Капитал и дивиденды
            </div>
            <p class="help-p">
              При создании инвестора фиксируется его <strong>начальный капитал</strong>. По мере получения дивидендных выплат
              и пополнений/снятий он становится <strong>текущим капиталом</strong> (`currentCapital`) — именно эта цифра
              используется для расчёта доли «по вкладу».
            </p>
            <p class="help-p">
              Прибыль от сделок <strong>начисляется</strong> на инвестора по мере поступления платежей — это запись «Начисление прибыли»
              в журнале. <strong>Выплата</strong> происходит когда вы фактически переводите деньги — нажимаете «Выплатить дивиденды»
              на карточке инвестора. Между «начислено» и «выплачено» — задолженность партнёра перед инвестором («Остаток к выплате»).
            </p>
            <p class="help-p">
              «Резерв инвесторам» в сводке по кассе — это сумма таких задолженностей по всем инвесторам кассы.
              Эти деньги ещё физически в кассе, но обязательны к выплате.
            </p>
          </section>
        </div>
        <div class="help-foot">
          <button class="md-btn md-btn--primary" @click="showHelpDialog = false">Понятно</button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* ── Stats row (same pattern as other pages) ── */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
@media (max-width: 960px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
/* На мобиле каждая KPI карточка отдельной строкой — крупные суммы
   («Общий капитал», «Моя доля») не помещались в 2-col на узких экранах. */
@media (max-width: 500px) { .stats-row { grid-template-columns: 1fr; gap: 8px; } }

.stat-card {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 20px; border-radius: 14px;
  background: #fff; border: 1px solid #e5e7eb;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.stat-card:hover {
  border-color: #d1d5db;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.stat-icon {
  width: 40px; height: 40px; min-width: 40px;
  border-radius: 10px; display: flex; align-items: center; justify-content: center;
}
.stat-value {
  font-size: 18px; font-weight: 700; line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.stat-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}

/* ── Search / Filter input ── */
.filter-input-wrap {
  position: relative; flex: 1;
}
.filter-input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.filter-input {
  width: 100%; padding: 9px 12px 9px 36px;
  border-radius: 10px; border: 1px solid #e5e7eb;
  background: #f9fafb; font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: all 0.15s;
}
.filter-input:focus {
  border-color: #047857; background: #fff;
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.08);
}
.filter-input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.35);
}

/* ── Add button ── */
.ci-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 18px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.ci-add-btn:hover {
  background: #065f46;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}

/* ── Pool settings button (next to Add) ── */
.ci-pool-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.ci-pool-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-color: rgba(var(--v-theme-on-surface), 0.2);
}

/* ── CI mode selector in create/edit dialog ── */
.ci-mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.ci-mode-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.ci-mode-card:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.ci-mode-card--active {
  border-color: rgba(99, 102, 241, 0.45);
  background: rgba(99, 102, 241, 0.05);
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.ci-mode-name { font-size: 13px; font-weight: 600; }
.ci-mode-sub { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45); line-height: 1.35; }

/* ── CI mode dropdown (v-menu picker, matches other dialog fields) ── */
.ci-mode-picker {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface)); font-size: 14px; font-family: inherit;
  color: rgba(var(--v-theme-on-surface), 0.95); text-align: left;
}
.ci-mode-picker:hover { border-color: rgba(99, 102, 241, 0.4); }
.ci-mode-picker-name { flex: 1; }
.ci-mode-menu {
  padding: 6px; min-width: 240px; border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
}
.ci-mode-menu-item {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 9px 10px; border-radius: 8px; cursor: pointer; border: none;
  background: transparent; font-size: 14px; font-family: inherit;
  color: rgba(var(--v-theme-on-surface), 0.9); text-align: left;
}
.ci-mode-menu-item + .ci-mode-menu-item { margin-top: 6px; }
.ci-mode-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.ci-mode-menu-item--active { background: rgba(99, 102, 241, 0.1); color: #6366f1; }

/* ── CI mode badge on card ── */
.ci-mode-badge {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 600;
  padding: 2px 8px; border-radius: 6px;
}
.ci-mode-badge--per_deal {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}
.ci-mode-badge--pool {
  background: rgba(124, 58, 237, 0.1);
  color: #7c3aed;
}
.ci-mode-badge--fee {
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
}

/* ── Pool dialog section hint ── */
.md-section-hint {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.06);
  font-size: 12px;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* ── Empty state ── */
.ci-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 48px 24px; text-align: center;
}
.ci-empty-icon {
  width: 80px; height: 80px; border-radius: 20px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 16px;
}
.ci-empty-title {
  font-size: 18px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 6px;
}
.ci-empty-subtitle {
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.4);
  max-width: 360px;
}

/* ── Co-investor list ── */
.ci-list { display: flex; flex-direction: column; gap: 8px; }

.ci-card {
  border: 1px solid #e5e7eb; border-radius: 14px;
  background: #fff; overflow: hidden;
  transition: all 0.2s;
}
.ci-card:hover { border-color: #d1d5db; }
.ci-card--expanded {
  border-color: rgba(99, 102, 241, 0.35);
  box-shadow: 0 2px 12px rgba(99, 102, 241, 0.08);
}

/* ── Card header (mobile) — свёрнуто: только аватар + имя + действия ── */
.ci-header {
  display: flex; align-items: center; gap: 11px;
  padding: 12px 12px; cursor: pointer;
  transition: background 0.15s;
}
.ci-header:hover { background: rgba(var(--v-theme-on-surface), 0.02); }

.ci-avatar {
  width: 42px; height: 42px; min-width: 42px;
  border-radius: 12px; display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 15px;
  letter-spacing: 0.5px;
}

.ci-main { flex: 1; min-width: 0; }
.ci-name-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.ci-name {
  display: block; min-width: 0;
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ci-percent-badge {
  font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 6px;
  background: rgba(99, 102, 241, 0.1); color: #6366f1;
}
.ci-meta {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}

/* Desktop stats */
.ci-stats {
  display: flex; align-items: center; gap: 24px;
  margin-right: 8px;
}
.ci-stat { text-align: right; }
.ci-stat-value {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
}
.ci-stat-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Action buttons */
.ci-actions {
  display: flex; align-items: center; gap: 4px;
}
.ci-action-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 8px; border-radius: 8px; border: none;
  background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 12px; transition: all 0.15s;
}
.ci-action-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.ci-action-btn--danger:hover {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}
.ci-action-btn--accent {
  color: #6366f1;
}
.ci-action-btn--accent:hover {
  background: rgba(99, 102, 241, 0.10);
  color: #6366f1;
}

.expand-icon {
  color: rgba(var(--v-theme-on-surface), 0.25);
  flex-shrink: 0;
}

/* ── Expanded content ── */
.ci-expanded {
  padding: 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

/* Шеврон-индикатор раскрытия слева от инициалов */
.ci-td-chevron {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex-shrink: 0;
  border-radius: 7px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  transition: transform 0.18s, background 0.15s, color 0.15s;
}
.ci-td-chevron:hover { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.7); }
.ci-td-chevron--open { transform: rotate(180deg); color: rgb(var(--v-theme-primary)); }

/* Раскрытая строка таблицы */
.ci-trow--expanded { background: rgba(var(--v-theme-on-surface), 0.05); }
.ci-trow--expanded:hover { background: rgba(var(--v-theme-on-surface), 0.06) !important; }
.ci-trow-expand > td { padding: 0 !important; background: rgba(var(--v-theme-on-surface), 0.05); }
.dark .ci-trow--expanded { background: rgba(255, 255, 255, 0.05); }
.dark .ci-trow-expand > td { background: rgba(255, 255, 255, 0.05); }
.ci-trow-expand .ci-expanded { border-top: 0; }

/* Раскрытая часть мобильной карточки */
.ci-card-expand {
  padding: 14px 12px 12px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
/* Контакт + участие в раскрытии */
.ci-exp-meta {
  display: flex; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 14px;
}
.ci-exp-meta-item {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6);
  text-decoration: none;
}
a.ci-exp-meta-item { color: rgb(var(--v-theme-primary)); }
/* Сводка 2×2 */
.ci-exp-stats {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 8px; margin-bottom: 14px;
}
.ci-exp-stats .ci-stat-m {
  padding: 10px 12px; border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
/* В карточке (мобиле) — доли всегда в 2 колонки, компактнее */
.ci-card-expand .ci-kpi-row { grid-template-columns: repeat(2, 1fr); margin-top: 0; }
.ci-card-expand .ci-section-title { margin: 16px 0 8px; }
.ci-card-expand .ci-stakes-list { margin-top: 0; }

/* Список касс-стейков в раскрытии */
.ci-stakes { display: flex; flex-direction: column; gap: 8px; margin: 14px 0; }
.ci-stake-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
  text-decoration: none; transition: background 0.15s, border-color 0.15s;
}
.ci-stake-row:hover { background: rgba(var(--v-theme-on-surface), 0.05); border-color: rgba(var(--v-theme-on-surface), 0.16); }
.ci-stake-icon {
  width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.ci-stake-body { flex: 1; min-width: 0; }
.ci-stake-name {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ci-stake-mode { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }
.ci-stake-owed { text-align: right; flex-shrink: 0; }
.ci-stake-owed-val { font-size: 14px; font-weight: 700; color: #f59e0b; font-variant-numeric: tabular-nums; }
.ci-stake-owed-label { font-size: 10.5px; color: rgba(var(--v-theme-on-surface), 0.45); }
.ci-stake-arrow { color: rgba(var(--v-theme-on-surface), 0.3); flex-shrink: 0; }
.ci-stake-none {
  padding: 12px; text-align: center; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.03);
}

/* Ссылка на карточку инвестора внизу раскрытия */
.ci-expanded-link {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.ci-expanded-link:hover { text-decoration: underline; }

/* KPI-карточки: капитал / доля инвестора / моя доля */
.ci-kpi-row {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 8px; margin-top: 12px;
}
.ci-kpi {
  padding: 10px 14px; border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.ci-kpi-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); }
.ci-kpi-val {
  font-size: 16px; font-weight: 800; margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 600px) { .ci-kpi-row { grid-template-columns: repeat(2, 1fr); } }

/* Все карточки-метрики в раскрытии — на белом (surface), а не серые:
   иначе теряются на затемнённом фоне раскрытого блока. */
.ci-expanded .ci-stat-m,
.ci-card-expand .ci-stat-m {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}

/* Кассы: вертикальный список карточек, под каждой — полоса распределения */
.ci-stakes-list { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.ci-stake-card {
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.ci-stake-card-head {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 12px; text-decoration: none;
  transition: background 0.15s;
}
.ci-stake-card-head:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
/* Статичная (некликабельная) шапка кассы — без hover/курсора */
.ci-stake-card-head--static { cursor: default; }
.ci-stake-card-head--static:hover { background: transparent; }
.ci-stake-dist { padding: 2px 12px 11px; }
.ci-stake-dist-head {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
}
.ci-stake-dist-title { font-size: 12px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.6); }
.ci-stake-dist-right { display: inline-flex; align-items: center; gap: 7px; }
.ci-stake-dist-total { font-size: 14px; font-weight: 800; color: rgba(var(--v-theme-on-surface), 0.9); font-variant-numeric: tabular-nums; }
.ci-dist-help {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  cursor: pointer; transition: background 0.15s;
}
.ci-dist-help:hover { background: rgba(var(--v-theme-primary), 0.22); }
/* Заголовок секции в раскрытии */
.ci-section-title {
  font-size: 11px; font-weight: 700; letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin: 16px 0 4px;
}
/* Кнопка «Открыть карточку инвестора» справа */
.ci-expanded-actions { display: flex; justify-content: flex-start; margin-top: 16px; }
.ci-expanded-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px; border-radius: 10px;
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.28);
  text-decoration: none; transition: background 0.15s, border-color 0.15s;
}
.ci-expanded-btn:hover { background: rgba(var(--v-theme-primary), 0.18); border-color: rgba(var(--v-theme-primary), 0.5); }
.ci-stake-chip-icon {
  width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.ci-stake-chip-body { flex: 1; min-width: 0; }
.ci-stake-chip-name {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ci-stake-chip-mode {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ci-stake-chip-owed { text-align: right; flex-shrink: 0; line-height: 1.15; }
.ci-stake-chip-owed-val { display: block; font-size: 13px; font-weight: 700; color: #f59e0b; font-variant-numeric: tabular-nums; }
.ci-stake-chip-owed-label { display: block; font-size: 9.5px; color: rgba(var(--v-theme-on-surface), 0.45); }

/* Полоса «Распределение прибыли» */
.ci-dist { margin-top: 16px; }
.ci-dist-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.ci-dist-title { font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.75); }
.ci-dist-total { font-size: 15px; font-weight: 800; color: rgba(var(--v-theme-on-surface), 0.9); font-variant-numeric: tabular-nums; }
.ci-dist-bar {
  height: 9px; border-radius: 5px; overflow: hidden;
  background: #047857;
}
.ci-dist-fill { height: 100%; background: #6366f1; border-radius: 5px 0 0 5px; }
.ci-dist-legend {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 10px; margin-top: 8px;
}
.ci-dist-leg { display: flex; flex-direction: column; min-width: 0; }
.ci-dist-leg--right { text-align: right; }
.ci-dist-leg-pct { font-size: 11px; font-weight: 600; }
.ci-dist-leg-amt { font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 1px; }

/* Mobile stats */
.ci-stats-mobile {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 8px; margin: 16px 0;
}
.ci-stat-m {
  padding: 10px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.ci-stat-m-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.ci-stat-m-value {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Mobile actions */
.ci-mobile-actions {
  display: flex; gap: 8px; padding-top: 12px;
}

/* Quick links in expand: cashbox + CI profile */
.ci-quicklinks {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
@media (max-width: 600px) {
  .ci-quicklinks { grid-template-columns: 1fr; }
}
.ci-quicklink {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  text-decoration: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: filter 0.15s, transform 0.15s;
}
.ci-quicklink:hover {
  filter: brightness(0.96);
  transform: translateY(-1px);
}
.ci-quicklink-icon {
  width: 40px; height: 40px; min-width: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.ci-quicklink-body { flex: 1; min-width: 0; }
.ci-quicklink-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ci-quicklink-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.ci-quicklink-arrow {
  color: rgba(var(--v-theme-on-surface), 0.4);
  flex-shrink: 0;
}
.ci-quicklink:hover .ci-quicklink-arrow {
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* Extra metrics row in expand (realized / paid out / pending) */
.ci-extra-stats {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
@media (max-width: 600px) {
  /* Стек: каждая метрика отдельной строкой, label слева / значение справа,
     чтобы крупные суммы не сжимались. */
  .ci-extra-stats { grid-template-columns: 1fr; }
  .ci-extra-stats .ci-stat-m {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px;
  }
}

/* ───── Mobile: ci-card header компактнее ───── */
@media (max-width: 599px) {
  .ci-header {
    padding: 12px 14px;
    gap: 10px;
  }
  .ci-avatar {
    width: 40px; height: 40px; min-width: 40px;
    border-radius: 10px;
    font-size: 14px;
  }
  .ci-name {
    font-size: 14px;
    line-height: 1.3;
  }
  .ci-name-row {
    gap: 6px;
  }
  /* На узком экране бейдж кассы под именем съедает место — скрываем,
     касса видна в expand-блоке как большая клик-карточка. */
  .ci-name-row .ci-cashbox-badge {
    display: none;
  }
  .ci-percent-badge,
  .ci-mode-badge {
    font-size: 10px;
    padding: 2px 6px;
  }
  .ci-meta {
    font-size: 12px;
    line-height: 1.35;
  }
  /* Schedule в мета-строке убираем — занимает место, видно в expand. */
  .ci-meta-schedule { display: none; }
}

/* Profit bar */
.ci-profit-bar { padding-top: 16px; }
.ci-profit-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ci-profit-total {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.ci-profit-track {
  display: flex; height: 8px; border-radius: 4px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.ci-profit-fill--partner {
  background: #6366f1; border-radius: 4px 0 0 4px;
  transition: width 0.3s;
}
.ci-profit-fill--my {
  background: #047857; border-radius: 0 4px 4px 0;
  transition: width 0.3s;
}
.ci-profit-legend {
  font-size: 11px; font-weight: 500;
}
.ci-costfee-note {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(4, 120, 87, 0.06);
  border: 1px solid rgba(4, 120, 87, 0.18);
  font-size: 12px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.72);
}
.ci-costfee-note .v-icon { color: #047857; flex-shrink: 0; margin-top: 1px; }

/* ── Deals section ── */
.ci-section-title {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.ci-link-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 12px; border-radius: 8px; border: none;
  background: rgba(99, 102, 241, 0.08); color: #6366f1;
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.ci-link-btn:hover {
  background: rgba(99, 102, 241, 0.15);
}

.ci-no-deals {
  display: flex; align-items: center; justify-content: center;
  padding: 24px; color: rgba(var(--v-theme-on-surface), 0.35);
  font-size: 14px;
}

.ci-deals-list {
  display: flex; flex-direction: column; gap: 6px;
}
.ci-deal-row {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  transition: all 0.15s;
}
.ci-deal-row--clickable {
  cursor: pointer;
}
.ci-deal-row--clickable:hover {
  background: rgba(var(--v-theme-primary), 0.04);
}
.ci-deal-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.ci-deal-info { flex: 1; min-width: 0; }
.ci-deal-name {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ci-deal-meta {
  display: flex; align-items: center; gap: 8px;
  margin-top: 4px; font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ci-deal-status {
  font-size: 10px; font-weight: 600;
  padding: 2px 8px; border-radius: 5px;
  white-space: nowrap;
}
.ci-deal-total {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
}

.ci-deal-profit {
  display: flex; flex-direction: column; gap: 2px;
  flex-shrink: 0; text-align: right;
}
.ci-deal-profit-row {
  display: flex; align-items: center; gap: 6px; justify-content: flex-end;
}
.ci-deal-profit-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.ci-deal-profit-value {
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.ci-unlink-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; min-width: 32px;
  border-radius: 8px; border: none;
  background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.3);
  transition: all 0.15s;
}
.ci-unlink-btn:hover {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

@media (max-width: 600px) {
  .ci-deal-row { flex-wrap: wrap; }
  .ci-deal-profit {
    flex-direction: row; gap: 12px;
    width: 100%; padding-top: 6px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  }
  .ci-deal-profit-row { justify-content: flex-start; }
  .ci-unlink-btn { position: absolute; right: 14px; top: 12px; }
  .ci-deal-row { position: relative; padding-right: 48px; }
}

/* ── Dialog ── */
.ci-dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.ci-dialog-title {
  font-size: 17px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.ci-dialog-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.ci-dialog-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.ci-dialog-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 20px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

/* Scrollable dialog body with a pinned cashbox picker. Header + footer stay
   put; only the body between them scrolls, and the «Добавить кассы» section
   sticks to its top so it's always reachable while the blocks scroll below. */
.ci-form-card { display: flex; flex-direction: column; max-height: 90vh; }
.ci-dialog-scroll {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  padding: 0 20px 20px;
}
.ci-cb-sticky {
  position: sticky; top: 0; z-index: 3;
  background: rgb(var(--v-theme-surface));
  margin: 0 -20px 16px; padding: 16px 20px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
@media (max-width: 599px) {
  .ci-form-card { max-height: 100%; height: 100%; }
}

/* ── Form fields ── */
.ci-field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}
.ci-field-input {
  width: 100%; padding: 10px 14px;
  border-radius: 10px; border: 1px solid #e5e7eb;
  background: #fff; font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: all 0.15s;
}
.ci-field-input:focus {
  border-color: #6366f1; background: #fff;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);
}
.ci-field-input-wrap {
  position: relative;
}
.ci-field-input-wrap .ci-field-input {
  padding-right: 36px;
}
.ci-field-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.ci-field-hint {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 6px;
}

/* Percent chips */
.ci-percent-presets {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.ci-percent-chip {
  padding: 6px 14px; border-radius: 8px;
  border: 1px solid #e5e7eb; background: #fff;
  font-size: 13px; font-weight: 500; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition: all 0.15s;
}
.ci-percent-chip:hover {
  border-color: #6366f1; color: #6366f1;
}
.ci-percent-chip--active {
  border-color: #6366f1; background: rgba(99, 102, 241, 0.08);
  color: #6366f1; font-weight: 600;
}

/* Payout schedule selector (4 options grid) */
.payout-schedule-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
  margin-bottom: 6px;
}
.payout-option {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 12px; border-radius: 9px;
  border: 1px solid #e5e7eb;
  background: #fff;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.payout-option:hover {
  border-color: #6366f1; color: #6366f1;
}
.payout-option--active {
  border-color: #6366f1; background: rgba(99, 102, 241, 0.08);
  color: #6366f1; font-weight: 600;
}

/* Subtle inline schedule chip in card meta */
.ci-meta-schedule {
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ci-meta-schedule .v-icon {
  vertical-align: -2px;
  margin-right: 1px;
}

/* ── Buttons ── */
.ci-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 9px 20px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.ci-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.ci-btn--primary {
  background: #047857; color: #fff;
}
.ci-btn--primary:hover:not(:disabled) {
  background: #065f46;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}
.ci-btn--ghost {
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.5);
  border: 1px solid #e5e7eb;
}
.ci-btn--ghost:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.ci-btn--danger {
  background: #ef4444; color: #fff;
}
.ci-btn--danger:hover:not(:disabled) {
  background: #dc2626;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
}

/* ── Delete dialog ── */
.ci-delete-icon {
  width: 72px; height: 72px; margin: 0 auto;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: rgba(239, 68, 68, 0.08);
}
.ci-delete-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.ci-delete-subtitle {
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.5);
  text-align: left;
}
.ci-delete-info-block {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ci-delete-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.ci-delete-info-row strong {
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.ci-delete-hint {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  line-height: 1.4;
}

/* ── Deal selector ── */
.ci-deal-selector-list {
  display: flex; flex-direction: column; gap: 4px;
  max-height: 400px; overflow-y: auto;
}
.ci-deal-selector-item {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 14px; border-radius: 10px;
  cursor: pointer; transition: background 0.15s;
}
.ci-deal-selector-item:hover {
  background: rgba(99, 102, 241, 0.06);
}
.ci-deal-selector-info { flex: 1; min-width: 0; }

/* ── Dark mode ── */
.dark .stat-card {
  background: #1e1e2e; border-color: #2e2e42;
}
.dark .ci-card {
  background: #1e1e2e; border-color: #2e2e42;
}
.dark .ci-card:hover {
  border-color: #3e3e52;
}
.dark .ci-card--expanded {
  border-color: rgba(99, 102, 241, 0.35);
}
.dark .filter-input {
  background: #252538; border-color: #2e2e42; color: #e4e4e7;
}
.dark .filter-input::placeholder { color: #71717a; }
.dark .filter-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .ci-field-input {
  background: #252538; border-color: #2e2e42; color: #e4e4e7;
}
.dark .ci-field-input:focus {
  border-color: #6366f1; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #6366f1 15%, transparent);
}
.dark .ci-percent-chip {
  background: #252538; border-color: #2e2e42; color: #a1a1aa;
}
.dark .ci-percent-chip:hover {
  border-color: #6366f1; color: #6366f1;
}
.dark .ci-percent-chip--active {
  border-color: #6366f1; background: rgba(99, 102, 241, 0.12); color: #6366f1;
}
.dark .payout-option {
  background: #252538; border-color: #2e2e42; color: #a1a1aa;
}
.dark .payout-option:hover {
  border-color: #6366f1; color: #6366f1;
}
.dark .payout-option--active {
  border-color: #6366f1; background: rgba(99, 102, 241, 0.12); color: #6366f1;
}
.dark .ci-btn--ghost {
  border-color: #2e2e42; color: #a1a1aa;
}
.dark .ci-btn--ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.04);
}
.dark .ci-stat-m {
  background: rgba(255, 255, 255, 0.04);
}
.dark .ci-deal-row {
  background: rgba(255, 255, 255, 0.02);
}
.dark .ci-deal-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
.dark .ci-deal-selector-item:hover {
  background: rgba(99, 102, 241, 0.1);
}
.dark .ci-dialog-header {
  border-bottom-color: #2e2e42;
}
.dark .ci-dialog-actions {
  border-top-color: #2e2e42;
}

/* Charts */
.chart-title {
  font-size: 16px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.chart-subtitle {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.chart-total {
  font-size: 20px; font-weight: 700;
  color: #6366f1;
}

/* ─── Pool settings dialog (PARTICIPATING/MANAGING) ─── */
.md-card { overflow: hidden; }
.md-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.md-title { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.md-close {
  width: 30px; height: 30px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.md-close:hover { background: rgba(var(--v-theme-on-surface), 0.10); }

.md-modes {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.md-mode {
  display: flex; flex-direction: column; align-items: center;
  gap: 6px;
  padding: 18px 14px;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  text-align: center;
}
.md-mode:hover {
  border-color: rgba(124, 58, 237, 0.30);
}
.md-mode--active {
  border-color: #7c3aed;
  background: rgba(124, 58, 237, 0.04);
  color: #7c3aed;
}
.md-mode .v-icon {
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.md-mode--active .v-icon { color: #7c3aed; }
.md-mode-name {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.md-mode--active .md-mode-name { color: #7c3aed; }
.md-mode-sub {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  line-height: 1.3;
}

.md-field { }
.md-label {
  display: block;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}
.md-input-wrap { position: relative; }
.md-input {
  width: 100%; padding: 10px 36px 10px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  border-radius: 10px;
  font-size: 14px; outline: none; font-family: inherit;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.md-input:focus { border-color: #7c3aed; }
.md-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.4);
  pointer-events: none;
}
.md-hint {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 6px;
  line-height: 1.5;
}

.md-warn {
  display: flex; gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.20);
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  line-height: 1.5;
}
.md-warn .v-icon { color: #d97706; flex-shrink: 0; margin-top: 1px; }
.md-warn b { font-weight: 700; }

.md-actions {
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 12px 20px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.md-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 18px;
  border-radius: 10px;
  border: none;
  font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.md-btn--ghost {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.md-btn--ghost:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.10); }
.md-btn--primary {
  background: #7c3aed;
  color: #fff;
}
.md-btn--primary:hover:not(:disabled) { background: #6d28d9; }
.md-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Help info button next to cashbox chips ── */
.cb-scope-info {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-primary), 0.30);
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
  flex-shrink: 0; margin-left: auto;
  white-space: nowrap;
}
.cb-scope-info:hover {
  background: rgba(var(--v-theme-primary), 0.12);
  border-color: rgb(var(--v-theme-primary));
}
@media (max-width: 600px) {
  .cb-scope-info span { display: none; }
  .cb-scope-info { padding: 7px 10px; }
}

/* Help dialog: explainer for cashboxes, CI types, profit distribution */
.help-card { overflow: hidden; }
.help-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgb(var(--v-theme-surface));
  position: sticky; top: 0; z-index: 1;
}
.help-title { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.help-close {
  width: 30px; height: 30px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.help-close:hover { background: rgba(var(--v-theme-on-surface), 0.10); }
.help-body {
  max-height: calc(85vh - 130px);
  overflow-y: auto;
}
/* В fullscreen-режиме (на мобиле) v-card занимает 100vh — фиксированный
   max-height создавал пустое место под контентом до footer'а. Растягиваем
   body на доступное место через flex, footer прижимается к низу. */
@media (max-width: 599px) {
  .help-card {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .help-body {
    flex: 1 1 auto;
    max-height: none;
    min-height: 0;
  }
  .help-foot {
    padding: 12px 16px;
  }
}
.help-section { margin-bottom: 28px; }
.help-section:last-child { margin-bottom: 0; }
.help-section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.92);
  margin-bottom: 10px;
}
.help-p {
  font-size: 14px;
  line-height: 1.55;
  color: rgba(var(--v-theme-on-surface), 0.72);
  margin: 0 0 10px 0;
}
.help-p:last-child { margin-bottom: 0; }
.help-p strong { color: rgba(var(--v-theme-on-surface), 0.95); font-weight: 600; }
.help-p em { font-style: normal; color: rgba(var(--v-theme-on-surface), 0.85); }
.help-types {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  margin-bottom: 12px;
}
@media (max-width: 600px) { .help-types { grid-template-columns: 1fr; } }
.help-type {
  padding: 14px 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.help-type-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
  margin-bottom: 6px;
}
.help-callout {
  display: flex; gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px; line-height: 1.5;
}
.help-callout .v-icon { flex-shrink: 0; margin-top: 1px; }
.help-callout--info {
  background: rgba(14, 165, 233, 0.08);
  border: 1px solid rgba(14, 165, 233, 0.22);
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.help-callout--info .v-icon { color: #0ea5e9; }
.help-steps {
  margin: 0; padding-left: 22px;
  font-size: 14px; line-height: 1.6;
  color: rgba(var(--v-theme-on-surface), 0.72);
}
.help-steps li { margin-bottom: 8px; }
.help-steps li strong { color: rgba(var(--v-theme-on-surface), 0.95); font-weight: 600; }
.help-example {
  margin-top: 8px; margin-bottom: 10px;
  padding: 12px 14px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 10px;
}
.help-example-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 6px 0;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.help-example-step {
  width: 22px; height: 22px; min-width: 22px; border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  color: #fff;
  font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
}
.help-example-summary {
  padding: 10px 14px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.22);
  border-radius: 10px;
  font-size: 13px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.help-foot {
  display: flex; justify-content: flex-end;
  padding: 12px 20px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgb(var(--v-theme-surface));
}

/* ── Phase 2: cashbox scope chips ── */
.cb-scope {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.cb-scope-label {
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  text-transform: uppercase; letter-spacing: 0.4px;
  flex-shrink: 0;
}
.cb-scope-chips { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
.cb-scope-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px; padding: 0 12px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border: 1px solid transparent;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.cb-scope-chip:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.cb-scope-chip--active {
  background: rgb(var(--v-theme-primary));
  color: #fff;
  border-color: rgb(var(--v-theme-primary));
}
.cb-scope-chip--active:hover {
  background: rgb(var(--v-theme-primary));
  color: #fff;
}

/* ── Mobile: тулбар над списком — поиск во вторую строку ── */
@media (max-width: 599px) {
  /* Кнопки (Настройки пула, Добавить, счётчик) остаются в первой строке.
     Поиск через order: 99 уходит вниз на отдельную строку во всю ширину. */
  .ci-toolbar-search {
    order: 99;
    flex: 1 1 100% !important;
    max-width: 100% !important;
  }
}

/* ── Mobile: cb-scope = 2 строки: «Касса: ... [Info]» сверху, чипы снизу ── */
@media (max-width: 599px) {
  .cb-scope {
    flex-wrap: wrap;
    align-items: center;
    padding: 10px 12px;
    row-gap: 10px;
  }
  /* Info-кнопка прижимается направо в первой строке, рядом с лейблом «Касса:». */
  .cb-scope-info {
    margin-left: auto;
    padding: 6px 12px;
    font-size: 12px;
  }
  /* Чипы — отдельной строкой во всю ширину под лейблом и info-кнопкой. */
  .cb-scope-chips {
    flex: 1 1 100%;
    order: 99;
  }

  /* Stat-карточки чуть компактнее. */
  .stat-card { padding: 12px; }
  .stat-value { font-size: 16px; }
  .stat-label { font-size: 11px; }
  .stat-icon { width: 32px; height: 32px; }
}

/* ── Cashbox badge on CI card ── */
.ci-cashbox-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 700;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid;
  letter-spacing: 0.2px;
  white-space: nowrap;
}

/* ── Cashbox picker (dropdown trigger + menu) ── */
.ci-cb-picker {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer; transition: all 0.15s;
  font-family: inherit; text-align: left;
}
.ci-cb-picker:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
}
.ci-cb-picker:focus-visible,
.ci-cb-picker[aria-expanded="true"] {
  border-color: rgb(var(--v-theme-primary));
}
.ci-cb-picker-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  flex-shrink: 0;
}
.ci-cb-picker-name {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ci-cb-picker-placeholder {
  flex: 1;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.ci-cb-picker-chevron { opacity: 0.5; flex-shrink: 0; }
.ci-cb-locked {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.ci-cb-menu { min-width: 0; width: 100%; padding: 4px; }
.ci-cb-menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  border: none; background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  cursor: pointer; text-align: left;
  font-family: inherit;
  width: 100%;
  transition: background 0.1s;
}
.ci-cb-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.ci-cb-menu-item--active {
  background: rgba(4, 120, 87, 0.06);
  color: #047857;
  font-weight: 600;
}
.ci-cb-menu-item-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px;
  flex-shrink: 0;
}
.ci-cb-menu-item-name { flex: 1; min-width: 0; }
.ci-cb-menu-empty {
  padding: 12px 14px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4);
  text-align: center;
}

/* ── Move dialog context block ── */
.ci-move-context {
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  display: flex; flex-direction: column; gap: 6px;
  font-size: 13px;
}
.ci-move-context-row {
  display: flex; align-items: center; gap: 8px;
}
.ci-move-context-label {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 12px;
}

/* ───── Desktop master-detail split ───── */
.ci-shell {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 0;
  height: calc(100vh - 300px);
  min-height: 560px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 14px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.dark .ci-shell { border-color: rgba(255,255,255,0.06); background: #1a1a26; }

/* LEFT — investor list */
.ci-sidebar {
  display: flex; flex-direction: column; min-height: 0;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.dark .ci-sidebar { border-right-color: rgba(255,255,255,0.06); background: #16161f; }
.ci-sidebar-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.dark .ci-sidebar-header { border-bottom-color: rgba(255,255,255,0.06); }
.ci-sidebar-search { flex: 1; min-width: 0; }
.ci-sidebar-add {
  width: 34px; height: 34px; min-width: 34px; border-radius: 9px; border: none;
  background: rgba(4, 120, 87, 0.10); color: #047857;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background 0.15s;
}
.ci-sidebar-add:hover { background: rgba(4, 120, 87, 0.18); }
.dark .ci-sidebar-add { background: rgba(4, 120, 87, 0.18); color: #34d399; }

.ci-sidebar-list { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }

.ci-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 10px; cursor: pointer;
  border: 1px solid transparent; transition: background 0.12s, border-color 0.12s;
}
.ci-row:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.ci-row--active {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.25);
}
.dark .ci-row--active { background: rgba(4, 120, 87, 0.14); }
.ci-row-avatar {
  width: 38px; height: 38px; min-width: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 13px; letter-spacing: 0.5px;
}
.ci-row-main { flex: 1; min-width: 0; }
.ci-row-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ci-row-name {
  font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ci-row-sub { margin-top: 3px; gap: 6px; }
.ci-row-badge {
  font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 5px; white-space: nowrap;
}
.ci-row-badge--fixed { background: rgba(124, 58, 237, 0.1); color: #7c3aed; }
.ci-row-badge--pool { background: rgba(99, 102, 241, 0.1); color: #6366f1; }
.ci-row-badge--costfee { background: rgba(4, 120, 87, 0.1); color: #047857; }
.ci-row-right { text-align: right; flex-shrink: 0; }
.ci-row-capital { font-size: 13px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); white-space: nowrap; }
.ci-row-actions {
  display: none; align-items: center; gap: 2px; flex-shrink: 0;
}
.ci-row:hover .ci-row-actions, .ci-row--active .ci-row-actions { display: flex; }
.ci-row-act {
  width: 26px; height: 26px; border-radius: 7px; border: none;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: all 0.12s;
}
.ci-row-act:hover { background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.9); }
.ci-row-act--danger:hover { background: rgba(239, 68, 68, 0.12); color: #ef4444; }

.ci-sidebar-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 24px 16px; gap: 4px;
}
.ci-sidebar-empty-title { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.7); margin-top: 6px; }
.ci-sidebar-empty-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); }

/* RIGHT — detail pane */
.ci-main-panel { min-height: 0; overflow-y: auto; padding: 20px; }
.ci-panel-empty {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; gap: 6px; padding: 40px;
}
.ci-panel-empty-title { font-size: 16px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.7); margin-top: 8px; }
.ci-panel-empty-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45); max-width: 320px; }

/* Compact summary in the right pane */
.ci-detail-card { display: flex; flex-direction: column; min-height: 100%; }
.ci-detail-head { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
.ci-detail-avatar {
  width: 56px; height: 56px; min-width: 56px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 19px; letter-spacing: 0.5px;
}
.ci-detail-identity { min-width: 0; }
.ci-detail-name {
  font-size: 20px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ci-detail-meta {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; gap: 6px; margin-top: 2px; flex-wrap: wrap;
}
.ci-detail-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;
  margin-bottom: 14px;
}
.ci-detail-cell {
  padding: 14px 16px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.ci-detail-cell--accent {
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.18);
}
.dark .ci-detail-cell { background: rgba(255, 255, 255, 0.04); }
.ci-detail-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600;
}
.ci-detail-value { font-size: 17px; font-weight: 700; margin-top: 4px; color: rgba(var(--v-theme-on-surface), 0.95); }
.ci-detail-sub { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }

.ci-detail-rows { display: flex; flex-direction: column; gap: 8px; }
.ci-detail-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.ci-detail-row-icon {
  width: 38px; height: 38px; min-width: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.ci-detail-row-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ci-detail-row-value { font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); margin-top: 2px; }

.ci-detail-open {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  width: 100%; margin-top: 20px;
  padding: 12px 18px; border-radius: 11px; border: none;
  background: #047857; color: #fff; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: background 0.15s;
}
.ci-detail-open:hover { background: #065f46; }

/* ───── Desktop table ───── */
.ci-table { width: 100%; border-collapse: collapse; }
.ci-table thead th {
  text-align: left; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.3px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  padding: 8px 14px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  white-space: nowrap;
}
.ci-table thead th.ci-th-num { text-align: right; }
.ci-th-act { width: 1%; }
.ci-table tbody td {
  padding: 10px 14px; vertical-align: middle;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.ci-table tbody tr:last-child td { border-bottom: none; }
.ci-trow { cursor: pointer; transition: background 0.12s; }
.ci-trow:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.dark .ci-trow:hover { background: rgba(255, 255, 255, 0.03); }

.ci-td-investor { display: flex; align-items: center; gap: 12px; }
.ci-td-idn { min-width: 0; }
.ci-td-name {
  font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ci-td-phone { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }
.ci-td-num {
  text-align: right; font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85); white-space: nowrap;
}
.ci-td-right { text-align: right; }
.ci-td-cb {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.75);
  white-space: nowrap;
}
.ci-td-cb-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ci-td-actions { text-align: right; white-space: nowrap; }
.ci-td-actions .ci-row-act { display: inline-flex; vertical-align: middle; }
.ci-td-actions .ci-row-act + .ci-row-act { margin-left: 2px; }
.ci-td-actions-row { display: inline-flex; align-items: center; gap: 2px; }

/* Cashbox mini-chips (per-person list rows) */
.ci-cb-chips {
  display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;
}
.ci-main .ci-cb-chips { justify-content: flex-start; }
.ci-cb-mini {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 999px;
  font-size: 12px; font-weight: 600; white-space: nowrap;
  border: 1px solid transparent;
}
.ci-cb-mini-name { font-weight: 600; }
.ci-cb-mini-mode {
  font-weight: 500; opacity: 0.75;
  padding-left: 6px; margin-left: 1px;
  border-left: 1px solid currentColor;
}
.ci-cb-none {
  display: inline-flex; align-items: center;
  padding: 3px 9px; border-radius: 999px;
  font-size: 12px; font-weight: 600; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.05);
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
}

/* ── Task 1: per-row ⋮ menu ── */
.ci-card-menu { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.ci-row-menu {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
  min-width: 200px;
  padding: 4px;
}
.dark .ci-row-menu {
  background: #1e1e2e; border-color: #2e2e42;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
}
.ci-menu-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 10px 12px;
  border-radius: 8px; border: none; background: none;
  font-size: 13px; font-weight: 500; color: #374151;
  cursor: pointer; transition: all 0.12s ease; text-align: left;
}
.ci-menu-item:hover { background: #f9f4f0; }
.ci-menu-item--danger { color: #ef4444; }
.ci-menu-item--danger :deep(.v-icon) { color: #ef4444; }
.ci-menu-item--danger:hover { background: #fef2f2; }
.ci-menu-divider { height: 1px; background: rgba(0, 0, 0, 0.06); margin: 4px 0; }
.dark .ci-menu-item { color: #a1a1aa; }
.dark .ci-menu-item:hover { background: #252538; }
.dark .ci-menu-item--danger { color: #f87171; }
.dark .ci-menu-item--danger:hover { background: rgba(239, 68, 68, 0.12); }
.dark .ci-menu-divider { background: #2e2e42; }

/* ── Task 3: multi-cashbox picker + per-cashbox blocks ── */
.ci-cb-multi { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.ci-cb-tag {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 999px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.ci-cb-tag:hover { border-color: rgba(var(--v-theme-primary), 0.4); }
.ci-cb-tag--active { font-weight: 700; }

.ci-cb-block {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px; padding: 14px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.ci-cb-block-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
}
.ci-cb-block-icon { display: inline-flex; align-items: center; justify-content: center; }
.ci-cb-block-name { flex: 1; font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.ci-cb-block-remove {
  width: 28px; height: 28px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.ci-cb-block-remove:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
</style>
