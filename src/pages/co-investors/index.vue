<script lang="ts" setup>
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useDealsStore } from '@/stores/deals'
import { useCashBoxesStore, type CashBoxSummary } from '@/stores/cashboxes'
import { formatCurrency, formatCurrencyShort, formatPhone, PHONE_MASK, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useCapital } from '@/composables/useCapital'
import type { Deal } from '@/types'
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
const toast = useToast()
const dealsStore = useDealsStore()
const cashboxesStore = useCashBoxesStore()
const { capital, isCapitalSet, fetchCapital } = useCapital()

const poolContribution = computed(() => {
  if (!capital.value || capital.value.totalCapital <= 0) return 0
  return Math.round((capital.value.coInvestorCapital / capital.value.totalCapital) * 100)
})

// ── Types ──

interface CoInvestorStats {
  totalDeals: number
  activeDeals: number
  completedDeals: number
  totalProfit: number
  coInvestorShare: number
  myShare: number
}

interface DealInfo {
  id: string
  productName: string
  markup: number
  status: string
  totalPrice: number
  productPhotos?: string[]
  purchasePrice?: number
  // Optional wholesale-related fields. When profitSplitBase=FULL_MARGIN
  // and wholesalePrice is set, CI share is computed from
  // (totalPrice − wholesalePrice) instead of plain markup. Otherwise
  // (default for legacy deals) CI splits markup as before.
  wholesalePrice?: number | null
  profitSplitBase?: 'MARKUP_ONLY' | 'FULL_MARGIN'
  remainingAmount?: number
  client?: { id: string; firstName: string; lastName: string }
  externalClientName?: string
  externalClientPhone?: string
}

interface CoInvestor {
  id: string
  name: string
  phone: string | null
  capital: number
  // Phase 3: nullable. set (1..99) = fixed %; null = weight-based.
  profitPercent: number | null
  createdAt: string
  // Phase 2: every CI lives in exactly one cashbox. Drives the filter chips,
  // the badge on each card, and the create/move dialogs.
  cashBoxId: string
  stats: CoInvestorStats
  dealsList: DealInfo[]
}

// ── State ──

const pageLoading = ref(true)
const coInvestors = ref<CoInvestor[]>([])
const expandedIds = ref<string[]>([])
const search = ref('')
// Phase 2: filter chips by cashbox. null = "Все кассы" — same UX as analytics.
const selectedCashBoxId = ref<string | null>(null)

// Create/Edit dialog
const showDialog = ref(false)
const dialogLoading = ref(false)
const editingId = ref<string | null>(null)
// Phase 3: one CI model. `shareType` is the UI toggle backing the optional
// `profitPercent` field — 'FIXED' means use the entered % off the top of
// each deal's profit; 'WEIGHT' means split remaining profit by capital ratio.
const form = ref<{
  name: string
  phone: string
  capital: number
  shareType: 'FIXED' | 'WEIGHT'
  profitPercent: number
  payoutSchedule: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL'
  nextPayoutDate: string  // YYYY-MM-DD or ''
  cashBoxId: string | null
}>({
  name: '',
  phone: '',
  capital: 0,
  shareType: 'FIXED',
  profitPercent: 30,
  payoutSchedule: 'MONTHLY',
  nextPayoutDate: '',
  cashBoxId: null,
})

// Move-cashbox dialog
const showMoveDialog = ref(false)
const moveLoading = ref(false)
const movingCi = ref<CoInvestor | null>(null)
const moveTargetCashBoxId = ref<string | null>(null)

const PAYOUT_OPTIONS = [
  { value: 'MONTHLY' as const, label: 'Ежемесячно', icon: 'mdi-calendar-month' },
  { value: 'QUARTERLY' as const, label: 'Раз в квартал', icon: 'mdi-calendar-multiple' },
  { value: 'SEMIANNUAL' as const, label: 'Раз в полгода', icon: 'mdi-calendar-range' },
  { value: 'ANNUAL' as const, label: 'Раз в год', icon: 'mdi-calendar-clock' },
]

// Delete dialog
const deleteDialog = ref(false)
const deletingId = ref<string | null>(null)
const deleteLoading = ref(false)

// Percent quick buttons
const PERCENT_PRESETS = [10, 20, 25, 30, 40, 50]

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
    const [investors] = await Promise.all([
      api.get<CoInvestor[]>('/co-investors'),
      dealsStore.fetchDeals(),
      // Cashboxes are needed for filter chips, badges, and dialog pickers.
      // Skip if already loaded — store caches across pages.
      cashboxesStore.items.length === 0 ? cashboxesStore.fetchAll() : Promise.resolve(),
    ])
    coInvestors.value = investors
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки данных')
  } finally {
    pageLoading.value = false
  }
}

// ── Pool contract settings (PARTICIPATING vs MANAGING) ──
// Phase 3: every CI participates in all deals of their cashbox. The partner-
// level poolModel controls how the partner shares profit with weight-based
// CIs — either via partner's own capital stake (PARTICIPATING) or via a flat
// management fee on the weight-pool (MANAGING). Fixed-% CIs are unaffected.
import type { PoolModel } from '@/types'

interface PoolSettings {
  poolModel: PoolModel
  poolManagementFeePct: number
}
const poolSettings = ref<PoolSettings>({ poolModel: 'PARTICIPATING', poolManagementFeePct: 30 })
const showPoolDialog = ref(false)
const showHelpDialog = ref(false)
const poolForm = ref<PoolSettings>({ poolModel: 'PARTICIPATING', poolManagementFeePct: 30 })
const poolSaving = ref(false)

async function fetchPoolSettings() {
  try {
    poolSettings.value = await api.get<PoolSettings>('/finance/pool-settings')
  } catch { /* silent */ }
}

function openPoolDialog() {
  poolForm.value = { ...poolSettings.value }
  showPoolDialog.value = true
}

async function savePoolSettings() {
  poolSaving.value = true
  try {
    poolSettings.value = await api.patch<PoolSettings>('/finance/pool-settings', poolForm.value)
    showPoolDialog.value = false
    toast.success('Настройки пула обновлены')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось сохранить')
  } finally {
    poolSaving.value = false
  }
}

onMounted(() => { fetchData(); fetchCapital(); fetchPoolSettings() })

// ── Computed ──

const filteredCoInvestors = computed(() => {
  let list = coInvestors.value
  if (selectedCashBoxId.value) {
    list = list.filter((ci) => ci.cashBoxId === selectedCashBoxId.value)
  }
  if (search.value) {
    const s = search.value.toLowerCase()
    list = list.filter(
      (ci) => ci.name.toLowerCase().includes(s) || (ci.phone && ci.phone.includes(s))
    )
  }
  return list
})

// Lookup helper used by the card badge and dialog summaries.
function getCashBox(id: string | null | undefined): CashBoxSummary | undefined {
  if (!id) return undefined
  return cashboxesStore.items.find((b) => b.id === id)
}

const summaryStats = computed(() => {
  const all = coInvestors.value
  return {
    totalCapital: all.reduce((s, ci) => s + ci.capital, 0),
    totalShared: all.reduce((s, ci) => s + ci.stats.coInvestorShare, 0),
    myShare: all.reduce((s, ci) => s + ci.stats.myShare, 0),
    count: all.length,
  }
})

// ── Chart data ──

const CHART_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#7c3aed', '#4f46e5']

const capitalChartData = computed(() => {
  const items = coInvestors.value.filter((ci) => ci.capital > 0)
  return {
    labels: items.map((ci) => ci.name.split(' ')[0] || ci.name),
    datasets: [{
      label: 'Капитал',
      data: items.map((ci) => ci.capital),
      backgroundColor: items.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + '40'),
      borderColor: items.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
      borderWidth: 2,
      borderRadius: 8,
    }],
  }
})

const profitChartData = computed(() => {
  const items = coInvestors.value.filter((ci) => ci.stats.coInvestorShare > 0 || ci.stats.myShare > 0)
  return {
    labels: items.map((ci) => ci.name.split(' ')[0] || ci.name),
    datasets: [
      {
        label: 'Доля партнёра',
        data: items.map((ci) => ci.stats.coInvestorShare),
        backgroundColor: '#6366f1' + '60',
        borderColor: '#6366f1',
        borderWidth: 2,
        borderRadius: 8,
      },
      {
        label: 'Моя доля',
        data: items.map((ci) => ci.stats.myShare),
        backgroundColor: '#047857' + '40',
        borderColor: '#047857',
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

// ── Expand ──

function toggleExpand(id: string) {
  const idx = expandedIds.value.indexOf(id)
  if (idx >= 0) expandedIds.value.splice(idx, 1)
  else expandedIds.value.push(id)
}

function isExpanded(id: string) {
  return expandedIds.value.includes(id)
}

// ── Create / Edit ──

function openCreate() {
  editingId.value = null
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
    shareType: 'FIXED',
    profitPercent: 30,
    payoutSchedule: 'MONTHLY',
    nextPayoutDate: defaultNext.toISOString().slice(0, 10),
    cashBoxId: preselectedCashBoxId,
  }
  showDialog.value = true
}

function openEdit(ci: CoInvestor) {
  editingId.value = ci.id
  const hasFixed = ci.profitPercent != null && ci.profitPercent > 0
  form.value = {
    name: ci.name,
    phone: ci.phone || '',
    capital: ci.capital,
    shareType: hasFixed ? 'FIXED' : 'WEIGHT',
    profitPercent: hasFixed ? ci.profitPercent! : 30,
    payoutSchedule: ((ci as any).payoutSchedule as 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL') ?? 'MONTHLY',
    nextPayoutDate: ci.nextPayoutDate ? ci.nextPayoutDate.slice(0, 10) : '',
    cashBoxId: ci.cashBoxId,
  }
  showDialog.value = true
}

async function saveCoInvestor() {
  if (!form.value.name.trim()) return toast.error('Укажите имя')
  if (form.value.capital <= 0) return toast.error('Укажите капитал')
  if (form.value.shareType === 'FIXED' && (form.value.profitPercent <= 0 || form.value.profitPercent >= 100)) {
    return toast.error('Процент от 1 до 99')
  }
  if (!editingId.value && !form.value.cashBoxId) {
    return toast.error('Выберите кассу для инвестора')
  }

  dialogLoading.value = true
  try {
    const body: any = {
      name: form.value.name.trim(),
      phone: form.value.phone.trim() || undefined,
      capital: Number(form.value.capital),
      // null sends a JSON `null`, which backend reads as «по вкладу».
      profitPercent: form.value.shareType === 'FIXED' ? Number(form.value.profitPercent) : null,
      payoutSchedule: form.value.payoutSchedule,
      // Empty input → null clears the planned date on edit. ISO date string
      // otherwise. Backend stores as Date.
      nextPayoutDate: form.value.nextPayoutDate
        ? new Date(form.value.nextPayoutDate).toISOString()
        : null,
    }
    if (!editingId.value && form.value.cashBoxId) {
      body.cashBoxId = form.value.cashBoxId
    }

    if (editingId.value) {
      await api.patch(`/co-investors/${editingId.value}`, body)
      toast.success('Со-инвестор обновлён')
    } else {
      await api.post('/co-investors', body)
      toast.success('Со-инвестор создан')
    }
    showDialog.value = false
    pageLoading.value = true
    await fetchData()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  } finally {
    dialogLoading.value = false
  }
}

// ── Move CI to another cashbox ──
// Separate flow from edit() because moving requires migrating all journal
// entries server-side and may be refused (CI tied to deals in other boxes).
function openMoveDialog(ci: CoInvestor) {
  movingCi.value = ci
  moveTargetCashBoxId.value = null
  showMoveDialog.value = true
}

const moveTargets = computed(() => {
  if (!movingCi.value) return []
  return cashboxesStore.items.filter(
    (b) => !b.archivedAt && b.id !== movingCi.value!.cashBoxId,
  )
})

async function moveCoInvestor() {
  if (!movingCi.value || !moveTargetCashBoxId.value) {
    return toast.error('Выберите кассу-получатель')
  }
  moveLoading.value = true
  try {
    await api.post(`/co-investors/${movingCi.value.id}/move-cashbox`, {
      toCashBoxId: moveTargetCashBoxId.value,
    })
    toast.success('Со-инвестор перенесён в другую кассу')
    showMoveDialog.value = false
    pageLoading.value = true
    await fetchData()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось перенести')
  } finally {
    moveLoading.value = false
  }
}

// ── Delete ──

// Info about what auto-settle will record on delete. Backend treats deletion
// as "partner returned the capital and paid out remaining dividends in cash"
// — show the partner those amounts up-front so they don't get a silent swing
// in availableCapital.
const deletingInfo = computed(() => {
  const ci = coInvestors.value.find((c) => c.id === deletingId.value)
  if (!ci) return null
  const currentCapital = ci.currentCapital ?? 0
  const owedDividends = (ci.realizedProfit ?? 0) - (ci.totalPayout ?? 0)
  return {
    name: ci.name,
    currentCapital,
    owedDividends: Math.max(0, owedDividends),
    hasObligations: currentCapital > 0 || owedDividends > 0,
  }
})

function confirmDelete(id: string) {
  deletingId.value = id
  deleteDialog.value = true
}

async function deleteCoInvestor() {
  if (!deletingId.value) return
  deleteLoading.value = true
  try {
    await api.delete(`/co-investors/${deletingId.value}`)
    toast.success('Со-инвестор удалён')
    deleteDialog.value = false
    pageLoading.value = true
    await fetchData()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  } finally {
    deleteLoading.value = false
  }
}


function payoutLabel(s: string | undefined): string {
  switch (s) {
    case 'QUARTERLY': return 'квартал'
    case 'SEMIANNUAL': return 'полгода'
    case 'ANNUAL': return 'год'
    case 'MONTHLY':
    default: return 'месяц'
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
            <div class="stat-label">Выплачено партнёрам</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
            <v-icon icon="mdi-trending-up" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ formatCurrency(summaryStats.myShare) }}</div>
            <div class="stat-label">Моя доля</div>
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

      <!-- Main Card -->
      <v-card rounded="lg" elevation="0" border>
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
              {{ filteredCoInvestors.length }} из {{ coInvestors.length }}
            </div>
            <button class="ci-pool-btn" @click="openPoolDialog" title="Настройки общего пула">
              <v-icon icon="mdi-cog-outline" size="16" />
              <span class="d-none d-sm-inline">Настройки пула</span>
            </button>
            <button class="ci-add-btn" @click="openCreate">
              <v-icon icon="mdi-plus" size="18" />
              <span class="d-none d-sm-inline">Добавить со-инвестора</span>
              <span class="d-sm-none">Добавить</span>
            </button>
          </div>

          <!-- Empty state -->
          <div v-if="!filteredCoInvestors.length" class="ci-empty">
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

          <!-- Co-investors list -->
          <div v-else class="ci-list">
            <div
              v-for="ci in filteredCoInvestors"
              :key="ci.id"
              class="ci-card"
              :class="{ 'ci-card--expanded': isExpanded(ci.id) }"
            >
              <!-- Card Header -->
              <div class="ci-header" @click="toggleExpand(ci.id)">
                <div class="ci-avatar" :style="{ background: getAvatarColor(ci.name) }">
                  {{ getInitials(ci.name) }}
                </div>

                <div class="ci-main">
                  <div class="ci-name-row">
                    <span class="ci-name">{{ ci.name }}</span>
                    <!-- Phase 3: fixed-percent CIs show their %; weight-based
                         CIs get a different badge ("по вкладу"). -->
                    <span v-if="ci.profitPercent != null && ci.profitPercent > 0" class="ci-percent-badge">
                      {{ ci.profitPercent }}%
                    </span>
                    <span v-else class="ci-mode-badge ci-mode-badge--pool">
                      <v-icon icon="mdi-scale-balance" size="11" />
                      По вкладу
                    </span>
                    <span
                      v-if="getCashBox(ci.cashBoxId)"
                      class="ci-cashbox-badge"
                      :style="{
                        color: getCashBox(ci.cashBoxId)!.color,
                        background: getCashBox(ci.cashBoxId)!.color + '14',
                        borderColor: getCashBox(ci.cashBoxId)!.color + '40',
                      }"
                    >
                      <v-icon :icon="getCashBox(ci.cashBoxId)!.icon" size="11" />
                      {{ getCashBox(ci.cashBoxId)!.name }}
                    </span>
                  </div>
                  <div class="ci-meta">
                    <span v-if="ci.phone">{{ formatPhone(ci.phone) }} · </span>
                    {{ formatCurrency(ci.capital) }}
                    <span class="ci-meta-schedule">
                      · <v-icon icon="mdi-calendar-clock" size="11" /> {{ payoutLabel((ci as any).payoutSchedule) }}
                    </span>
                  </div>
                </div>

                <!-- Desktop stats -->
                <div class="ci-stats d-none d-md-flex">
                  <div class="ci-stat">
                    <div class="ci-stat-value" style="color: #6366f1;">{{ formatCurrency(ci.stats.coInvestorShare) }}</div>
                    <div class="ci-stat-label">Доля инвестора</div>
                  </div>
                  <div class="ci-stat">
                    <div class="ci-stat-value" style="color: #047857;">{{ formatCurrency(ci.stats.myShare) }}</div>
                    <div class="ci-stat-label">Моя доля</div>
                  </div>
                </div>

                <div class="ci-actions d-none d-sm-flex">
                  <button class="ci-action-btn ci-action-btn--accent" title="Касса со-инвестора" @click.stop="router.push(`/co-investors/${ci.id}`)">
                    <v-icon icon="mdi-wallet-outline" size="16" />
                  </button>
                  <button class="ci-action-btn" title="Редактировать" @click.stop="openEdit(ci)">
                    <v-icon icon="mdi-pencil-outline" size="16" />
                  </button>
                  <button
                    v-if="cashboxesStore.items.filter((x) => !x.archivedAt).length > 1"
                    class="ci-action-btn"
                    title="Перенести в другую кассу"
                    @click.stop="openMoveDialog(ci)"
                  >
                    <v-icon icon="mdi-swap-horizontal" size="16" />
                  </button>
                  <button class="ci-action-btn ci-action-btn--danger" title="Удалить" @click.stop="confirmDelete(ci.id)">
                    <v-icon icon="mdi-delete-outline" size="16" />
                  </button>
                </div>

                <div class="expand-icon">
                  <v-icon :icon="isExpanded(ci.id) ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="20" />
                </div>
              </div>

              <!-- Expanded content -->
              <v-expand-transition>
                <div v-if="isExpanded(ci.id)" class="ci-expanded">
                  <!-- Prominent quick links: cashbox + CI profile -->
                  <div class="ci-quicklinks mb-4">
                    <router-link
                      v-if="getCashBox(ci.cashBoxId)"
                      :to="`/cashboxes/${ci.cashBoxId}`"
                      class="ci-quicklink ci-quicklink--cashbox"
                      :style="{
                        background: getCashBox(ci.cashBoxId)!.color + '14',
                        borderColor: getCashBox(ci.cashBoxId)!.color + '40',
                      }"
                      @click.stop
                    >
                      <div class="ci-quicklink-icon" :style="{ background: getCashBox(ci.cashBoxId)!.color, color: '#fff' }">
                        <v-icon :icon="getCashBox(ci.cashBoxId)!.icon" size="22" />
                      </div>
                      <div class="ci-quicklink-body">
                        <div class="ci-quicklink-title">{{ getCashBox(ci.cashBoxId)!.name }}</div>
                        <div class="ci-quicklink-sub">Открыть кассу</div>
                      </div>
                      <v-icon icon="mdi-arrow-top-right" size="18" class="ci-quicklink-arrow" />
                    </router-link>

                    <router-link
                      :to="`/co-investors/${ci.id}`"
                      class="ci-quicklink"
                      @click.stop
                    >
                      <div class="ci-quicklink-icon" style="background: rgba(99,102,241,0.12); color: #6366f1;">
                        <v-icon icon="mdi-account-circle-outline" size="22" />
                      </div>
                      <div class="ci-quicklink-body">
                        <div class="ci-quicklink-title">Карточка инвестора</div>
                        <div class="ci-quicklink-sub">Касса, журнал, выплаты</div>
                      </div>
                      <v-icon icon="mdi-arrow-top-right" size="18" class="ci-quicklink-arrow" />
                    </router-link>
                  </div>

                  <!-- Additional metrics: realized / paid out / pending -->
                  <div class="ci-extra-stats mb-4">
                    <div class="ci-stat-m">
                      <div class="ci-stat-m-label">Реализовано</div>
                      <div class="ci-stat-m-value">{{ formatCurrency(ci.realizedProfit ?? 0) }}</div>
                    </div>
                    <div class="ci-stat-m">
                      <div class="ci-stat-m-label">Выплачено</div>
                      <div class="ci-stat-m-value">{{ formatCurrency(ci.totalPayout ?? 0) }}</div>
                    </div>
                    <div class="ci-stat-m">
                      <div class="ci-stat-m-label">К выплате</div>
                      <div class="ci-stat-m-value" style="color: #f59e0b;">{{ formatCurrency(Math.max((ci.realizedProfit ?? 0) - (ci.totalPayout ?? 0), 0)) }}</div>
                    </div>
                  </div>

                  <!-- Mobile-only stats from header (hidden on desktop) -->
                  <div class="ci-stats-mobile d-md-none">
                    <div class="ci-stat-m">
                      <div class="ci-stat-m-label">Капитал</div>
                      <div class="ci-stat-m-value">{{ formatCurrency(ci.capital) }}</div>
                    </div>
                    <div class="ci-stat-m">
                      <div class="ci-stat-m-label">Доля инвестора</div>
                      <div class="ci-stat-m-value" style="color: #6366f1;">{{ formatCurrency(ci.stats.coInvestorShare) }}</div>
                    </div>
                    <div class="ci-stat-m">
                      <div class="ci-stat-m-label">Моя доля</div>
                      <div class="ci-stat-m-value" style="color: #047857;">{{ formatCurrency(ci.stats.myShare) }}</div>
                    </div>
                  </div>

                  <!-- Mobile actions -->
                  <div class="ci-mobile-actions d-sm-none mb-3">
                    <button class="ci-action-btn" @click="openEdit(ci)">
                      <v-icon icon="mdi-pencil-outline" size="16" />
                      Редактировать
                    </button>
                    <button
                      v-if="cashboxesStore.items.filter((x) => !x.archivedAt).length > 1"
                      class="ci-action-btn"
                      @click="openMoveDialog(ci)"
                    >
                      <v-icon icon="mdi-swap-horizontal" size="16" />
                      Перенести
                    </button>
                    <button class="ci-action-btn ci-action-btn--danger" @click="confirmDelete(ci.id)">
                      <v-icon icon="mdi-delete-outline" size="16" />
                      Удалить
                    </button>
                  </div>

                  <!-- Profit distribution bar — only meaningful for fixed-% CIs.
                       Weight-based CIs depend on capital ratios that change over
                       time, so the per-deal split isn't a stable percentage. -->
                  <div
                    class="ci-profit-bar mb-4"
                    v-if="ci.stats.totalProfit > 0 && ci.profitPercent != null && ci.profitPercent > 0"
                  >
                    <div class="d-flex justify-space-between align-center mb-2">
                      <span class="ci-profit-label">Распределение прибыли</span>
                      <span class="ci-profit-total">{{ formatCurrency(ci.stats.totalProfit) }}</span>
                    </div>
                    <div class="ci-profit-track">
                      <div
                        class="ci-profit-fill ci-profit-fill--partner"
                        :style="{ width: ci.profitPercent + '%' }"
                      />
                      <div
                        class="ci-profit-fill ci-profit-fill--my"
                        :style="{ width: (100 - ci.profitPercent) + '%' }"
                      />
                    </div>
                    <div class="d-flex justify-space-between mt-1">
                      <span class="ci-profit-legend" style="color: #6366f1;">Инвестору: {{ ci.profitPercent }}%</span>
                      <span class="ci-profit-legend" style="color: #047857;">Моя доля: {{ 100 - ci.profitPercent }}%</span>
                    </div>
                  </div>

                </div>
              </v-expand-transition>
            </div>
          </div>
        </div>
      </v-card>

      <!-- Charts (moved below the list) -->
      <v-row v-if="coInvestors.length > 0" class="mt-5">
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

    <!-- Create/Edit Dialog -->
    <v-dialog v-model="showDialog" max-width="480" persistent :fullscreen="isMobile">
      <v-card rounded="lg">
        <div class="ci-dialog-header">
          <span class="ci-dialog-title">{{ editingId ? 'Редактировать' : 'Новый инвестор' }}</span>
          <button class="ci-dialog-close" @click="showDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <!-- Name -->
          <div class="ci-field mb-4">
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

          <!-- Capital -->
          <div class="ci-field mb-4">
            <label class="ci-field-label">Капитал <span style="color: #ef4444;">*</span></label>
            <div class="ci-field-input-wrap">
              <input
                :value="form.capital || ''"
                v-maska="CURRENCY_MASK"
                @maska="(e: any) => form.capital = parseMasked(e)"
                type="text"
                inputmode="numeric"
                class="ci-field-input"
                placeholder="0"
              />
              <span class="ci-field-suffix">₽</span>
            </div>
          </div>

          <!-- Cashbox picker. Required on create, locked on edit (a CI's
               cashbox can only change through the dedicated Move flow). -->
          <div class="ci-field mb-4">
            <label class="ci-field-label">
              Касса <span v-if="!editingId" style="color: #ef4444;">*</span>
            </label>
            <v-menu v-if="!editingId" :close-on-content-click="true">
              <template #activator="{ props: act }">
                <button v-bind="act" type="button" class="ci-cb-picker">
                  <template v-if="getCashBox(form.cashBoxId)">
                    <span class="ci-cb-picker-icon" :style="{ color: getCashBox(form.cashBoxId)!.color }">
                      <v-icon :icon="getCashBox(form.cashBoxId)!.icon" size="16" />
                    </span>
                    <span class="ci-cb-picker-name">{{ getCashBox(form.cashBoxId)!.name }}</span>
                  </template>
                  <span v-else class="ci-cb-picker-placeholder">Выберите кассу</span>
                  <v-icon icon="mdi-chevron-down" size="16" class="ci-cb-picker-chevron" />
                </button>
              </template>
              <v-card rounded="lg" elevation="4" class="ci-cb-menu">
                <button
                  v-for="b in cashboxesStore.items.filter((x) => !x.archivedAt)"
                  :key="b.id"
                  class="ci-cb-menu-item"
                  :class="{ 'ci-cb-menu-item--active': form.cashBoxId === b.id }"
                  @click="form.cashBoxId = b.id"
                >
                  <span class="ci-cb-menu-item-icon" :style="{ color: b.color }">
                    <v-icon :icon="b.icon" size="14" />
                  </span>
                  <span class="ci-cb-menu-item-name">{{ b.name }}</span>
                  <v-icon v-if="form.cashBoxId === b.id" icon="mdi-check" size="14" />
                </button>
              </v-card>
            </v-menu>
            <div v-else class="ci-cb-locked">
              <template v-if="getCashBox(form.cashBoxId)">
                <span class="ci-cb-picker-icon" :style="{ color: getCashBox(form.cashBoxId)!.color }">
                  <v-icon :icon="getCashBox(form.cashBoxId)!.icon" size="16" />
                </span>
                <span class="ci-cb-picker-name">{{ getCashBox(form.cashBoxId)!.name }}</span>
              </template>
              <v-icon icon="mdi-lock-outline" size="14" class="ml-auto" style="opacity: 0.5;" />
            </div>
            <div v-if="editingId" class="ci-field-hint">
              Чтобы перенести в другую кассу — закройте окно и нажмите <v-icon icon="mdi-swap-horizontal" size="12" />
            </div>
          </div>

          <!-- Phase 3: how this investor's share is computed for every deal
               in their cashbox. FIXED = % off the top, WEIGHT = capital ratio. -->
          <div class="ci-field mb-4">
            <label class="ci-field-label">Способ деления прибыли</label>
            <div class="ci-mode-grid">
              <button
                type="button"
                class="ci-mode-card"
                :class="{ 'ci-mode-card--active': form.shareType === 'FIXED' }"
                @click="form.shareType = 'FIXED'"
              >
                <v-icon icon="mdi-percent-outline" size="18" />
                <div class="ci-mode-name">Фиксированный %</div>
                <div class="ci-mode-sub">Получает заданный процент с каждой сделки кассы</div>
              </button>
              <button
                type="button"
                class="ci-mode-card"
                :class="{ 'ci-mode-card--active': form.shareType === 'WEIGHT' }"
                @click="form.shareType = 'WEIGHT'"
              >
                <v-icon icon="mdi-scale-balance" size="18" />
                <div class="ci-mode-name">По вкладу</div>
                <div class="ci-mode-sub">Доля пропорциональна вкладу капитала в кассу</div>
              </button>
            </div>
          </div>

          <!-- Profit percent (only when shareType=FIXED) -->
          <div v-if="form.shareType === 'FIXED'" class="ci-field mb-2">
            <label class="ci-field-label">Процент от прибыли <span style="color: #ef4444;">*</span></label>
            <div class="ci-percent-presets mb-2">
              <button
                v-for="p in PERCENT_PRESETS"
                :key="p"
                class="ci-percent-chip"
                :class="{ 'ci-percent-chip--active': form.profitPercent === p }"
                @click="form.profitPercent = p"
              >
                {{ p }}%
              </button>
            </div>
            <div class="ci-field-input-wrap">
              <input
                v-model.number="form.profitPercent"
                type="number"
                class="ci-field-input"
                placeholder="30"
                min="1"
                max="99"
              />
              <span class="ci-field-suffix">%</span>
            </div>
            <div class="ci-field-hint">От 1% до 99%. Ваша доля: {{ 100 - (form.profitPercent || 0) }}%</div>
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
            <label class="ci-field-label">
              {{ editingId ? 'Следующая выплата' : 'Первая выплата' }}
            </label>
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
            {{ editingId ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card rounded="lg">
        <div class="pa-5 text-center">
          <div class="ci-delete-icon mb-3">
            <v-icon icon="mdi-alert-circle-outline" size="48" color="error" />
          </div>
          <div class="ci-delete-title mb-2">Удалить со-инвестора?</div>
          <div v-if="deletingInfo?.hasObligations" class="ci-delete-subtitle mb-4">
            <div class="mb-2">При удалении будут записаны следующие операции:</div>
            <div class="ci-delete-info-block">
              <div v-if="deletingInfo.currentCapital > 0" class="ci-delete-info-row">
                <span>Возврат капитала:</span>
                <strong>{{ formatCurrency(deletingInfo.currentCapital) }}</strong>
              </div>
              <div v-if="deletingInfo.owedDividends > 0" class="ci-delete-info-row">
                <span>Выплата остатка дивидендов:</span>
                <strong>{{ formatCurrency(deletingInfo.owedDividends) }}</strong>
              </div>
            </div>
            <div class="ci-delete-hint mt-3">
              Это означает, что вы фактически вернули капитал и выплатили дивиденды со-инвестору. Если это не так — закройте окно и проведите расчёт через журнал.
            </div>
          </div>
          <div v-else class="ci-delete-subtitle mb-4">
            Все привязки к сделкам будут удалены. Это действие нельзя отменить.
          </div>
          <div class="d-flex ga-3 justify-center">
            <button class="ci-btn ci-btn--ghost" @click="deleteDialog = false" :disabled="deleteLoading">
              Отмена
            </button>
            <button class="ci-btn ci-btn--danger" @click="deleteCoInvestor" :disabled="deleteLoading">
              <v-progress-circular v-if="deleteLoading" indeterminate size="16" width="2" color="white" class="mr-2" />
              Удалить
            </button>
          </div>
        </div>
      </v-card>
    </v-dialog>

    <!-- Move to Cashbox Dialog -->
    <v-dialog v-model="showMoveDialog" max-width="460" persistent :fullscreen="isMobile">
      <v-card rounded="lg">
        <div class="ci-dialog-header">
          <span class="ci-dialog-title">Перенести в другую кассу</span>
          <button class="ci-dialog-close" @click="showMoveDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <!-- Context: which CI and where it is now -->
          <div class="ci-move-context mb-4">
            <div class="ci-move-context-row">
              <span class="ci-move-context-label">Со-инвестор:</span>
              <strong>{{ movingCi?.name }}</strong>
            </div>
            <div v-if="getCashBox(movingCi?.cashBoxId)" class="ci-move-context-row">
              <span class="ci-move-context-label">Сейчас в кассе:</span>
              <span class="ci-cashbox-badge"
                :style="{
                  color: getCashBox(movingCi!.cashBoxId)!.color,
                  background: getCashBox(movingCi!.cashBoxId)!.color + '14',
                  borderColor: getCashBox(movingCi!.cashBoxId)!.color + '40',
                }"
              >
                <v-icon :icon="getCashBox(movingCi!.cashBoxId)!.icon" size="11" />
                {{ getCashBox(movingCi!.cashBoxId)!.name }}
              </span>
            </div>
          </div>

          <div class="ci-field mb-2">
            <label class="ci-field-label">Касса-получатель <span style="color: #ef4444;">*</span></label>
            <v-menu :close-on-content-click="true">
              <template #activator="{ props: act }">
                <button v-bind="act" type="button" class="ci-cb-picker">
                  <template v-if="getCashBox(moveTargetCashBoxId)">
                    <span class="ci-cb-picker-icon" :style="{ color: getCashBox(moveTargetCashBoxId)!.color }">
                      <v-icon :icon="getCashBox(moveTargetCashBoxId)!.icon" size="16" />
                    </span>
                    <span class="ci-cb-picker-name">{{ getCashBox(moveTargetCashBoxId)!.name }}</span>
                  </template>
                  <span v-else class="ci-cb-picker-placeholder">Выберите кассу</span>
                  <v-icon icon="mdi-chevron-down" size="16" class="ci-cb-picker-chevron" />
                </button>
              </template>
              <v-card rounded="lg" elevation="4" class="ci-cb-menu">
                <button
                  v-for="b in moveTargets"
                  :key="b.id"
                  class="ci-cb-menu-item"
                  :class="{ 'ci-cb-menu-item--active': moveTargetCashBoxId === b.id }"
                  @click="moveTargetCashBoxId = b.id"
                >
                  <span class="ci-cb-menu-item-icon" :style="{ color: b.color }">
                    <v-icon :icon="b.icon" size="14" />
                  </span>
                  <span class="ci-cb-menu-item-name">{{ b.name }}</span>
                  <v-icon v-if="moveTargetCashBoxId === b.id" icon="mdi-check" size="14" />
                </button>
                <div v-if="moveTargets.length === 0" class="ci-cb-menu-empty">
                  Нет других касс для переноса
                </div>
              </v-card>
            </v-menu>
            <div class="ci-field-hint">
              Капитал, доли прибыли и дивиденды со-инвестора переедут вместе с ним.
              Перенос невозможен, если у со-инвестора есть привязанные сделки в других кассах.
            </div>
          </div>
        </div>

        <div class="ci-dialog-actions">
          <button class="ci-btn ci-btn--ghost" @click="showMoveDialog = false" :disabled="moveLoading">
            Отмена
          </button>
          <button class="ci-btn ci-btn--primary" @click="moveCoInvestor" :disabled="moveLoading || !moveTargetCashBoxId">
            <v-progress-circular v-if="moveLoading" indeterminate size="16" width="2" color="white" class="mr-2" />
            Перенести
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Pool settings dialog (PARTICIPATING vs MANAGING) -->
    <v-dialog v-model="showPoolDialog" max-width="540" :fullscreen="isMobile">
      <v-card rounded="lg" class="md-card">
        <div class="md-head">
          <span class="md-title">Настройки общего пула</span>
          <button class="md-close" @click="showPoolDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <div class="md-section-hint mb-4">
            Действует на инвесторов с долей <b>«По вкладу капитала»</b>.
            Инвесторов с фиксированным процентом эти настройки не затрагивают
            — они получают свою долю первыми с любой сделки кассы.
          </div>

          <!-- PoolModel toggle -->
          <div class="md-modes mb-5">
            <button
              class="md-mode"
              :class="{ 'md-mode--active': poolForm.poolModel === 'PARTICIPATING' }"
              @click="poolForm.poolModel = 'PARTICIPATING'"
            >
              <v-icon icon="mdi-handshake" size="22" />
              <div class="md-mode-name">Совместная мудараба</div>
              <div class="md-mode-sub">Партнёр сам вкладывает капитал; доля считается по соотношению вкладов</div>
            </button>
            <button
              class="md-mode"
              :class="{ 'md-mode--active': poolForm.poolModel === 'MANAGING' }"
              @click="poolForm.poolModel = 'MANAGING'"
            >
              <v-icon icon="mdi-briefcase-outline" size="22" />
              <div class="md-mode-name">Управление с комиссией</div>
              <div class="md-mode-sub">Партнёр только управляет; берёт фиксированный процент от прибыли</div>
            </button>
          </div>

          <!-- Management fee (only for MANAGING) -->
          <div v-if="poolForm.poolModel === 'MANAGING'" class="md-field mb-3">
            <label class="md-label">Комиссия партнёра</label>
            <div class="md-input-wrap">
              <input
                v-model.number="poolForm.poolManagementFeePct"
                type="number"
                min="0"
                max="99"
                class="md-input"
              >
              <span class="md-suffix">%</span>
            </div>
            <div class="md-hint">
              Сколько процентов от прибыли каждой сделки забирает партнёр за управление.
              Остаток ({{ 100 - (poolForm.poolManagementFeePct || 0) }}%) делится между со-инвесторами по их доле в пуле.
            </div>
          </div>
        </div>

        <div class="md-actions">
          <button class="md-btn md-btn--ghost" @click="showPoolDialog = false" :disabled="poolSaving">Отмена</button>
          <button
            class="md-btn md-btn--primary"
            :disabled="poolSaving"
            @click="savePoolSettings"
          >
            <v-progress-circular v-if="poolSaving" indeterminate size="14" width="2" color="white" />
            Сохранить
          </button>
        </div>
      </v-card>
    </v-dialog>

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
              Один инвестор привязан к одной кассе и автоматически участвует во всех её сделках —
              не нужно подключать его к каждой сделке вручную.
            </p>
            <p class="help-p">
              Если инвестору нужен другой режим участия — заведите ему отдельную кассу.
            </p>
          </section>

          <!-- ───── Типы доли ───── -->
          <section class="help-section">
            <div class="help-section-title">
              <v-icon icon="mdi-handshake-outline" size="20" color="primary" />
              Два типа доли в прибыли
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
          </section>

          <!-- ───── PoolModel ───── -->
          <section class="help-section">
            <div class="help-section-title">
              <v-icon icon="mdi-tune-vertical" size="20" color="primary" />
              Модель пула: как делите остаток с инвесторами «по вкладу»
            </div>
            <p class="help-p">
              Это партнёрская настройка (одна на весь профиль). Определяет, как остаток прибыли (после фикс-инвесторов)
              делится между вами и инвесторами «по вкладу».
            </p>
            <div class="help-types">
              <div class="help-type">
                <div class="help-type-head">
                  <v-icon icon="mdi-handshake" size="18" />
                  <span>Совместная мудараба (PARTICIPATING)</span>
                </div>
                <p class="help-p">
                  Ваш собственный начальный капитал (поле «Начальный капитал» у кассы) считается как ещё один «вклад» в пуле.
                  Остаток прибыли делится пропорционально всем вкладам, включая ваш. Чем больше вы вкладываете —
                  тем больше ваша доля от прибыли.
                </p>
              </div>
              <div class="help-type">
                <div class="help-type-head">
                  <v-icon icon="mdi-briefcase-outline" size="18" />
                  <span>Управление с комиссией (MANAGING)</span>
                </div>
                <p class="help-p">
                  Вы берёте фиксированную комиссию за управление (например 30%) с остатка прибыли.
                  То, что осталось после комиссии, целиком уходит инвесторам «по вкладу» пропорционально их вкладам.
                  Подходит когда вы только управляете, а капитал — внешний.
                </p>
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
                <strong>Остаток уходит в «пул по вкладам»</strong> — между вами и инвесторами «по вкладу».
              </li>
              <li>
                <strong>В режиме «PARTICIPATING»</strong>: остаток делится пропорционально <em>(ваш капитал ÷ общий капитал пула)</em> vs <em>(вклад каждого инвестора ÷ общий капитал пула)</em>.
              </li>
              <li>
                <strong>В режиме «MANAGING»</strong>: вы сразу забираете комиссию (% от остатка), оставшееся делится между инвесторами пропорционально вкладам.
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
              Касса с вашим капиталом 9 360 000 ₽, режим «PARTICIPATING».
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

/* ── Card header ── */
.ci-header {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 18px; cursor: pointer;
  transition: background 0.15s;
}
.ci-header:hover { background: rgba(var(--v-theme-on-surface), 0.02); }

.ci-avatar {
  width: 44px; height: 44px; min-width: 44px;
  border-radius: 12px; display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 15px;
  letter-spacing: 0.5px;
}

.ci-main { flex: 1; min-width: 0; }
.ci-name-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.ci-name {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
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

/* ── Form fields ── */
.ci-field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}
.ci-field-input {
  width: 100%; padding: 10px 14px;
  border-radius: 10px; border: 1px solid #e5e7eb;
  background: #f9fafb; font-size: 14px; outline: none;
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
</style>
