<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useCashBoxesStore, type CashBoxSummary } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { formatCurrency, formatCurrencyShort, formatDate } from '@/utils/formatters'
import CashflowJournal from '@/components/CashflowJournal.vue'
import CashBoxEditDialog from '@/components/CashBoxEditDialog.vue'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { isDark } = useIsDark()
const store = useCashBoxesStore()

// Reactive mobile flag для fullscreen-диалогов на телефонах.
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
function updateMobile() { isMobile.value = window.innerWidth < 768 }
onMounted(() => window.addEventListener('resize', updateMobile))
onUnmounted(() => window.removeEventListener('resize', updateMobile))

const id = computed(() => route.params.id as string)

// ─── Type definitions (mirror finance.vue) ───────────────────────────────
interface CapitalOperation {
  type: 'EXPENSE' | 'INCOME' | 'PAYOUT'
  amount: number
  date: string
  description: string
  dealId: string | null
  productName: string | null
  transactionId?: string
  category?: { id: string; name: string; icon?: string; color?: string }
  isManual?: boolean
}
interface CapitalDealPayment {
  id: string
  number: number
  amount: number
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CLOSED_EARLY'
  dueDate: string
  paidAt: string | null
}
interface CapitalDeal {
  id: string
  productName: string
  client: string | null
  purchasePrice: number
  wholesalePrice?: number | null
  profitSplitBase?: 'MARKUP_ONLY' | 'FULL_MARGIN'
  totalPrice: number
  markup: number
  downPayment: number
  received: number
  status: string
  progress: number
  payments: CapitalDealPayment[]
}
interface CapitalDetails {
  initialCapital: number
  // Phase 2: real CI capital sitting in this cashbox (sum of CI.capital)
  coInvestorCapital: number
  totalCapital: number
  deployed: number
  received: number
  netProfit: number
  inProgress: number
  // Phase 2 cash-basis: obligation owed to CIs (accrued profit minus paid
  // dividends). Reported but NOT subtracted from availableCapital — the
  // money is still in the cashbox until DIVIDEND_OUT moves it out.
  pendingCIPayout: number
  // Legacy alias for clients still reading the old field name.
  coInvestorPayout: number
  manualBalance: number
  availableCapital: number
  deals: CapitalDeal[]
  operations: CapitalOperation[]
}

interface CashBoxCoInvestor {
  id: string
  name: string
  capital: number
  currentCapital: number
  realizedProfit: number
  totalPayout: number
  // Phase 3: nullable. Set (1..99) = fixed share; null = weight-based.
  profitPercent: number | null
}

// ─── State ────────────────────────────────────────────────────────────────
const box = ref<CashBoxSummary | null>(null)
const capitalDetails = ref<CapitalDetails | null>(null)
// Phase 2: co-investors living in this cashbox. Loaded from /co-investors and
// filtered client-side by cashBoxId. Drives the "Со-инвесторы кассы" panel.
const cashBoxCoInvestors = ref<CashBoxCoInvestor[]>([])
const loading = ref(true)

const showEdit = ref(false)

// Detail panel state (waterfall right column)
const wfExpanded = ref<string | null>(null)
const expandedInProfit = ref<Set<string>>(new Set())
const expandedInProgress = ref<Set<string>>(new Set())

// Bottom tabs
const detailsTab = ref<'journal' | 'operations' | 'deals'>('journal')
const showAllOps = ref(false)

// ─── Loaders ──────────────────────────────────────────────────────────────
async function loadAll() {
  loading.value = true
  try {
    const [b] = await Promise.all([
      store.findById(id.value),
      store.items.length === 0 ? store.fetchAll() : Promise.resolve(),
      loadDetails(),
      loadCategories(),
      loadCashBoxCoInvestors(),
    ])
    box.value = b
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить кассу')
    router.push('/cashboxes')
  } finally {
    loading.value = false
  }
}

async function loadDetails() {
  try {
    capitalDetails.value = await api.get<CapitalDetails>(`/cashboxes/${id.value}/capital/details`)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить детали кассы')
  }
}

// Phase 2: fetch all CIs of this investor and keep only those living in
// the current cashbox. Reused on every mutation that can affect membership
// (move CI, archive, etc.) — currently called only on initial load.
async function loadCashBoxCoInvestors() {
  try {
    const all = await api.get<any[]>('/co-investors')
    cashBoxCoInvestors.value = all
      .filter((ci) => ci.cashBoxId === id.value)
      .map((ci) => ({
        id: ci.id,
        name: ci.name,
        capital: ci.capital,
        currentCapital: ci.currentCapital,
        realizedProfit: ci.realizedProfit,
        totalPayout: ci.totalPayout,
        profitPercent: ci.profitPercent,
      }))
  } catch {
    // silent — CI section just won't render
  }
}

// After mutating manual operations the cashbox balance (manualBalance) and
// per-box summary cards on /cashboxes both change. Refresh both: details
// (waterfall + operations tab) and the store-cached summaries (cashbox list).
async function refreshAfterMutation() {
  await Promise.all([
    loadDetails(),
    store.fetchAll(),
  ])
  // Re-sync local `box` with the refreshed store data so the header values
  // (balance, dealsCount, activeDealsCount) stay in sync without remounting.
  const fresh = store.items.find((b) => b.id === id.value)
  if (fresh) box.value = fresh
}

watch(() => id.value, () => loadAll())
onMounted(loadAll)

// ─── Helpers (mirror finance.vue) ─────────────────────────────────────────
const PAYMENT_STATUS_LABEL: Record<CapitalDealPayment['status'], string> = {
  PENDING: 'Ожидается',
  PAID: 'Оплачено',
  OVERDUE: 'Просрочено',
  CLOSED_EARLY: 'Закрыто досрочно',
}

function dealRealCost(d: CapitalDeal): number {
  return d.wholesalePrice != null && d.wholesalePrice > 0 ? d.wholesalePrice : d.purchasePrice
}
function dealTotalMargin(d: CapitalDeal): number {
  const retailMargin = d.wholesalePrice != null && d.wholesalePrice > 0
    ? Math.max(0, d.purchasePrice - d.wholesalePrice)
    : 0
  return retailMargin + d.markup
}
function dealCostRatio(d: CapitalDeal): number {
  return d.totalPrice > 0 ? dealRealCost(d) / d.totalPrice : 0
}
function dealCostRecovered(d: CapitalDeal): number {
  return Math.round(d.received * dealCostRatio(d))
}
function dealProfitEarned(d: CapitalDeal): number {
  if (d.totalPrice <= 0) return 0
  return Math.round(d.received * (dealTotalMargin(d) / d.totalPrice))
}
function dealInProgress(d: CapitalDeal): number {
  return Math.max(dealRealCost(d) - dealCostRecovered(d), 0)
}
function dealProfitRemaining(d: CapitalDeal): number {
  return Math.max(dealTotalMargin(d) - dealProfitEarned(d), 0)
}
function paymentProfit(d: CapitalDeal, p: CapitalDealPayment): number {
  if (d.totalPrice <= 0) return 0
  return Math.round(p.amount * (dealTotalMargin(d) / d.totalPrice))
}

function toggleProfitDeal(id: string) {
  const next = new Set(expandedInProfit.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  expandedInProfit.value = next
}
function toggleProgressDeal(id: string) {
  const next = new Set(expandedInProgress.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  expandedInProgress.value = next
}

// ─── Derived ─────────────────────────────────────────────────────────────
const capitalUtilization = computed(() => {
  if (!capitalDetails.value || capitalDetails.value.totalCapital <= 0) return 0
  return Math.min(Math.round((capitalDetails.value.inProgress / capitalDetails.value.totalCapital) * 100), 100)
})

const activeDealsPurchaseTotal = computed(() => {
  if (!capitalDetails.value) return 0
  return capitalDetails.value.deals.filter(d => d.status === 'ACTIVE').reduce((s, d) => s + dealRealCost(d), 0)
})
const activeDealsCostRecovered = computed(() => {
  if (!capitalDetails.value) return 0
  return capitalDetails.value.deals.filter(d => d.status === 'ACTIVE').reduce((s, d) => s + dealCostRecovered(d), 0)
})

// ─── Categories (shared across all cashboxes for this investor) ───────────
interface Category {
  id: string
  name: string
  type: 'INCOME' | 'EXPENSE'
  icon?: string
  color?: string
  _count: { transactions: number }
}
const CATEGORY_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#3b82f6', '#0ea5e9',
  '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#047857',
]
const INCOME_COLOR = '#10b981'
const EXPENSE_COLOR = '#ef4444'

const categories = ref<Category[]>([])

async function loadCategories() {
  try {
    categories.value = await api.get<Category[]>('/finance/categories')
  } catch {
    // silent — categories are optional
  }
}

// ─── Manual operations CRUD (in "Все операции" tab) ───────────────────────
const showTxDialog = ref(false)
const txEditingId = ref<string | null>(null)
const txForm = ref({
  type: 'EXPENSE' as 'INCOME' | 'EXPENSE',
  amount: 0,
  description: '',
  categoryId: '',
  date: new Date().toISOString().slice(0, 10),
})
const txSaving = ref(false)
const txDeleteDialog = ref(false)
const txDeletingId = ref<string | null>(null)
const txDeleteLoading = ref(false)

const filteredCategories = computed(() =>
  categories.value.filter((c) => c.type === txForm.value.type),
)
const txSelectedCategory = computed(() =>
  txForm.value.categoryId ? categories.value.find((c) => c.id === txForm.value.categoryId) ?? null : null,
)

function openCreateTransaction() {
  txEditingId.value = null
  txForm.value = {
    type: 'EXPENSE',
    amount: 0,
    description: '',
    categoryId: '',
    date: new Date().toISOString().slice(0, 10),
  }
  showTxDialog.value = true
}

function openEditTransaction(op: CapitalOperation) {
  if (!op.transactionId) return
  txEditingId.value = op.transactionId
  txForm.value = {
    type: op.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
    amount: op.amount,
    description: op.description || '',
    categoryId: op.category?.id || '',
    date: op.date ? op.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
  }
  showTxDialog.value = true
}

async function saveTransaction() {
  if (!txForm.value.amount || txForm.value.amount <= 0) {
    toast.error('Укажите сумму больше 0')
    return
  }
  txSaving.value = true
  try {
    const body: any = {
      type: txForm.value.type,
      amount: Number(txForm.value.amount),
      description: txForm.value.description.trim() || undefined,
      categoryId: txForm.value.categoryId || undefined,
      date: txForm.value.date || undefined,
      cashBoxId: id.value,
    }
    if (txEditingId.value) {
      await api.patch(`/finance/transactions/${txEditingId.value}`, body)
      toast.success('Операция обновлена')
    } else {
      await api.post('/finance/transactions', body)
      toast.success('Операция добавлена')
    }
    showTxDialog.value = false
    await refreshAfterMutation()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  } finally {
    txSaving.value = false
  }
}

function confirmDeleteTransaction(id: string) {
  txDeletingId.value = id
  txDeleteDialog.value = true
}

async function deleteTransaction() {
  if (!txDeletingId.value) return
  txDeleteLoading.value = true
  try {
    await api.delete(`/finance/transactions/${txDeletingId.value}`)
    toast.success('Операция удалена')
    txDeleteDialog.value = false
    await refreshAfterMutation()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  } finally {
    txDeleteLoading.value = false
  }
}

// ─── Category CRUD ────────────────────────────────────────────────────────
const showCategoryDialog = ref(false)
const categoryEditingId = ref<string | null>(null)
const categoryForm = ref({ name: '', type: 'EXPENSE' as 'INCOME' | 'EXPENSE', color: CATEGORY_COLORS[0] })
const categoryLoading = ref(false)
const showCategoriesManager = ref(false)
const deleteCategoryDialog = ref(false)
const deletingCategoryId = ref<string | null>(null)
const deleteCategoryLoading = ref(false)

function openCreateCategory() {
  categoryEditingId.value = null
  categoryForm.value = { name: '', type: txForm.value.type, color: CATEGORY_COLORS[0] }
  showCategoryDialog.value = true
}

function openCreateCategoryFromManager(type: 'INCOME' | 'EXPENSE') {
  categoryEditingId.value = null
  categoryForm.value = { name: '', type, color: CATEGORY_COLORS[0] }
  showCategoryDialog.value = true
}

function openEditCategory(cat: Category) {
  categoryEditingId.value = cat.id
  categoryForm.value = {
    name: cat.name,
    type: cat.type,
    color: cat.color || CATEGORY_COLORS[0],
  }
  showCategoryDialog.value = true
}

async function saveCategory() {
  if (!categoryForm.value.name.trim()) {
    toast.error('Укажите название категории')
    return
  }
  categoryLoading.value = true
  try {
    const body = {
      name: categoryForm.value.name.trim(),
      // Type isn't editable on existing categories (would invalidate linked
      // transactions). Backend ignores type on PATCH; we omit it explicitly.
      ...(categoryEditingId.value ? {} : { type: categoryForm.value.type }),
      color: categoryForm.value.color || undefined,
    }
    if (categoryEditingId.value) {
      const updated = await api.patch<Category>(`/finance/categories/${categoryEditingId.value}`, body)
      const idx = categories.value.findIndex((c) => c.id === categoryEditingId.value)
      if (idx >= 0) categories.value[idx] = { ...categories.value[idx], ...updated }
      showCategoryDialog.value = false
      toast.success('Категория обновлена')
    } else {
      const created = await api.post<Category>('/finance/categories', body)
      categories.value.push(created)
      // Auto-select the new category if the transaction dialog is open
      if (showTxDialog.value) txForm.value.categoryId = created.id
      showCategoryDialog.value = false
      toast.success('Категория создана')
    }
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения категории')
  } finally {
    categoryLoading.value = false
  }
}

function confirmDeleteCategory(catId: string) {
  deletingCategoryId.value = catId
  deleteCategoryDialog.value = true
}

async function deleteCategory() {
  if (!deletingCategoryId.value) return
  deleteCategoryLoading.value = true
  try {
    await api.delete(`/finance/categories/${deletingCategoryId.value}`)
    categories.value = categories.value.filter((c) => c.id !== deletingCategoryId.value)
    deleteCategoryDialog.value = false
    toast.success('Категория удалена')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления категории')
  } finally {
    deleteCategoryLoading.value = false
  }
}

// ─── Filters for "Все операции" tab ───────────────────────────────────────
type OpKind = 'INCOME' | 'EXPENSE' | 'PAYOUT' | 'MANUAL'
const opSearch = ref('')
const opPeriod = ref<'all' | 'today' | 'week' | 'month' | 'year'>('all')
const opKinds = ref<OpKind[]>([])

const OP_PERIODS = [
  { key: 'all' as const, label: 'Всё время' },
  { key: 'today' as const, label: 'Сегодня' },
  { key: 'week' as const, label: 'Неделя' },
  { key: 'month' as const, label: 'Месяц' },
  { key: 'year' as const, label: 'Год' },
]
const OP_KIND_CHIPS: { key: OpKind; label: string; color: string }[] = [
  { key: 'INCOME', label: 'Поступления', color: '#10b981' },
  { key: 'EXPENSE', label: 'Закупки', color: '#ef4444' },
  { key: 'PAYOUT', label: 'Со-инвесторам', color: '#f59e0b' },
  { key: 'MANUAL', label: 'Ручные', color: '#3b82f6' },
]

function opPeriodFromDate(): Date | null {
  if (opPeriod.value === 'all') return null
  const from = new Date()
  if (opPeriod.value === 'today') from.setHours(0, 0, 0, 0)
  else if (opPeriod.value === 'week') from.setDate(from.getDate() - 7)
  else if (opPeriod.value === 'month') from.setMonth(from.getMonth() - 1)
  else if (opPeriod.value === 'year') from.setFullYear(from.getFullYear() - 1)
  return from
}

const opPeriodLabel = computed(() => OP_PERIODS.find(p => p.key === opPeriod.value)?.label ?? 'Всё время')

function toggleOpKind(k: OpKind) {
  const idx = opKinds.value.indexOf(k)
  if (idx >= 0) opKinds.value.splice(idx, 1)
  else opKinds.value.push(k)
}

const filteredOperations = computed<CapitalOperation[]>(() => {
  if (!capitalDetails.value) return []
  const from = opPeriodFromDate()
  const search = opSearch.value.trim().toLowerCase()
  return capitalDetails.value.operations.filter((op) => {
    // Period
    if (from && new Date(op.date) < from) return false
    // Kind filter — match either MANUAL (isManual) or by type
    if (opKinds.value.length > 0) {
      const matchesManual = opKinds.value.includes('MANUAL') && op.isManual
      const matchesType = (opKinds.value as string[]).includes(op.type)
      if (!matchesManual && !matchesType) return false
    }
    // Search in description and product
    if (search) {
      const hay = `${op.description} ${op.productName ?? ''} ${op.category?.name ?? ''}`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })
})

// Manual operations list (for the "Ручные операции" waterfall panel)
const manualOperations = computed<CapitalOperation[]>(() => {
  if (!capitalDetails.value) return []
  return capitalDetails.value.operations.filter((op) => op.isManual)
})

// Phase 3: per-CI share labels. fixed-% CIs take their slice first; weight
// CIs split (100 − Σ fixedPct) pro-rata by currentCapital. Mirrors backend
// accrueProfit so partner sees the same numbers the engine uses.
const ciShareLabels = computed(() => {
  const cis = cashBoxCoInvestors.value
  const fixedTotal = cis.reduce(
    (s, ci) => s + (ci.profitPercent != null && ci.profitPercent > 0 ? ci.profitPercent : 0),
    0,
  )
  const remainderPct = Math.max(100 - fixedTotal, 0)
  const weightSum = cis
    .filter((ci) => ci.profitPercent == null)
    .reduce((s, ci) => s + (ci.currentCapital || 0), 0)

  const labels: Record<string, { label: string; kind: 'fixed' | 'weight'; icon: string }> = {}
  for (const ci of cis) {
    if (ci.profitPercent != null && ci.profitPercent > 0) {
      labels[ci.id] = {
        label: `Фикс ${ci.profitPercent}%`,
        kind: 'fixed',
        icon: 'mdi-handshake-outline',
      }
    } else if (weightSum > 0) {
      const pct = ((ci.currentCapital || 0) / weightSum) * remainderPct
      labels[ci.id] = {
        label: `По капиталу ${pct.toFixed(1)}%`,
        kind: 'weight',
        icon: 'mdi-scale-balance',
      }
    } else {
      labels[ci.id] = { label: 'По капиталу', kind: 'weight', icon: 'mdi-scale-balance' }
    }
  }
  return labels
})

// Phase 2: CIs in this cashbox with a pending dividend balance (realized
// profit not yet paid out). Drives the "Резерв для инвесторов" breakdown
// panel — clicking the reserve row opens this per-CI list with amounts owed.
const pendingCiList = computed(() =>
  cashBoxCoInvestors.value
    .map((ci) => ({
      ...ci,
      pendingPayout: Math.max(0, (ci.realizedProfit ?? 0) - (ci.totalPayout ?? 0)),
    }))
    .filter((ci) => ci.pendingPayout > 0)
    .sort((a, b) => b.pendingPayout - a.pendingPayout),
)

// ─── Delete ──────────────────────────────────────────────────────────────
async function handleDelete() {
  if (!box.value || box.value.isDefault) {
    toast.error('Нельзя удалить основную кассу')
    return
  }
  if (box.value.dealsCount > 0) {
    toast.error(`В кассе ${box.value.dealsCount} сделок. Перенесите их в другую кассу или удалите.`)
    return
  }
  if (!confirm(`Удалить кассу «${box.value.name}»? Действие необратимо.`)) return
  try {
    await store.remove(box.value.id)
    toast.success('Касса удалена')
    router.push('/cashboxes')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить')
  }
}
</script>

<template>
  <div class="cb-page" :class="{ dark: isDark }">
    <div v-if="loading || !box" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
      <!-- Back link -->
      <button class="cb-back" @click="router.push('/cashboxes')">
        <v-icon icon="mdi-arrow-left" size="16" />
        Все кассы
      </button>

      <!-- Header -->
      <div class="cb-header mb-4">
        <div class="cb-header-left">
          <div class="cb-header-icon" :style="{ background: box.color + '20', color: box.color }">
            <v-icon :icon="box.icon" size="28" />
          </div>
          <div>
            <h1 class="cb-header-title">
              {{ box.name }}
              <span v-if="box.isDefault" class="cb-header-badge">основная</span>
            </h1>
            <div class="cb-header-meta">
              {{ box.dealsCount }} {{ box.dealsCount === 1 ? 'сделка' : 'сделок' }} · из них {{ box.activeDealsCount }} активны
            </div>
          </div>
        </div>
        <div class="cb-header-actions">
          <button class="cb-action-btn" @click="showEdit = true" title="Изменить кассу">
            <v-icon icon="mdi-pencil-outline" size="17" />
            Изменить
          </button>
          <button
            v-if="!box.isDefault"
            class="cb-action-btn cb-action-btn--danger"
            @click="handleDelete"
            title="Удалить кассу"
          >
            <v-icon icon="mdi-delete-outline" size="17" />
          </button>
        </div>
      </div>

      <!-- ============================ -->
      <!-- Capital waterfall (left + details right). Mirrors finance.vue. -->
      <!-- ============================ -->
      <div v-if="capitalDetails" class="wf mb-6">
        <div class="wf-title-row">
          <div class="wf-title">Капитал кассы</div>
        </div>

        <div class="wf-split">
          <!-- Left: vertical list -->
          <div class="wf-left">
            <button
              class="wf-item"
              :class="{ 'wf-item--active': wfExpanded === 'capital' }"
              @click="wfExpanded = wfExpanded === 'capital' ? null : 'capital'"
            >
              <div class="wf-item-value">{{ formatCurrency(capitalDetails.totalCapital) }}</div>
              <div class="wf-item-label">Общий капитал</div>
            </button>
            <button
              class="wf-item"
              :class="{ 'wf-item--active': wfExpanded === 'profit' }"
              @click="wfExpanded = wfExpanded === 'profit' ? null : 'profit'"
            >
              <div class="wf-item-value" style="color: #10b981;">+{{ formatCurrency(capitalDetails.netProfit) }}</div>
              <div class="wf-item-label">Чистая прибыль</div>
            </button>
            <button
              class="wf-item"
              :class="{ 'wf-item--active': wfExpanded === 'deployed' }"
              @click="wfExpanded = wfExpanded === 'deployed' ? null : 'deployed'"
            >
              <div class="wf-item-value" style="color: #f59e0b;">-{{ formatCurrency(capitalDetails.inProgress) }}</div>
              <div class="wf-item-label">В работе · {{ capitalDetails.deals?.filter(d => d.status === 'ACTIVE').length || 0 }}</div>
            </button>
            <button
              v-if="capitalDetails.manualBalance !== 0 || manualOperations.length > 0"
              class="wf-item"
              :class="{ 'wf-item--active': wfExpanded === 'manual' }"
              @click="wfExpanded = wfExpanded === 'manual' ? null : 'manual'"
            >
              <div class="wf-item-value" :style="{ color: capitalDetails.manualBalance > 0 ? '#3b82f6' : '#ef4444' }">
                {{ capitalDetails.manualBalance > 0 ? '+' : '' }}{{ formatCurrency(capitalDetails.manualBalance) }}
              </div>
              <div class="wf-item-label">Ручные операции · {{ manualOperations.length }}</div>
            </button>

            <div class="wf-item wf-item--result">
              <div class="wf-item-value wf-item-value--big" :style="{ color: box.color }">
                {{ formatCurrency(capitalDetails.availableCapital) }}
              </div>
              <div class="wf-item-label">Доступный капитал</div>
            </div>

            <!-- Phase 2 cash-basis: obligation owed to CIs. Reported as a
                 separate liability, NOT subtracted from availableCapital.
                 Clickable — opens a per-CI breakdown on the right.
                 Red warning chip appears if balance < pendingCIPayout
                 (partner has spent CI money and must replenish before payout). -->
            <button
              v-if="capitalDetails.pendingCIPayout > 0"
              class="wf-item wf-item--reserve"
              :class="{
                'wf-item--active': wfExpanded === 'pendingCI',
                'wf-item--reserve-danger': capitalDetails.availableCapital < capitalDetails.pendingCIPayout,
              }"
              @click="wfExpanded = wfExpanded === 'pendingCI' ? null : 'pendingCI'"
            >
              <div class="wf-item-value" style="color: #f59e0b;">
                {{ formatCurrency(capitalDetails.pendingCIPayout) }}
              </div>
              <div class="wf-item-label">
                Резерв для инвесторов · {{ pendingCiList.length }}
                <span
                  v-if="capitalDetails.availableCapital < capitalDetails.pendingCIPayout"
                  class="wf-reserve-warning"
                >
                  <v-icon icon="mdi-alert-circle" size="11" />
                  Выплатите дивиденды
                </span>
              </div>
            </button>
          </div>

          <!-- Right: details panel -->
          <div class="wf-right">
            <template v-if="wfExpanded === 'capital'">
              <div class="wf-panel-title">Состав капитала</div>
              <div class="wf-expand-row">
                <span>Собственный капитал кассы</span>
                <span class="wf-expand-val">{{ formatCurrency(capitalDetails.initialCapital) }}</span>
              </div>
              <!-- Phase 2: CI capital is part of the cashbox's total capital.
                   Show it inline (sum) plus the per-CI breakdown below — same
                   visual approach as the legacy finance.vue. -->
              <div v-if="capitalDetails.coInvestorCapital > 0" class="wf-expand-row">
                <span>Капитал со-инвесторов</span>
                <span class="wf-expand-val">{{ formatCurrency(capitalDetails.coInvestorCapital) }}</span>
              </div>
              <div v-if="cashBoxCoInvestors.length > 0" class="wf-ci-breakdown">
                <div class="wf-ci-breakdown-head">
                  <span>Со-инвесторы кассы</span>
                  <router-link to="/co-investors" class="wf-panel-link">
                    <v-icon icon="mdi-arrow-top-right" size="13" />
                    Управление
                  </router-link>
                </div>
                <div class="wf-ci-list">
                  <router-link
                    v-for="ci in cashBoxCoInvestors"
                    :key="ci.id"
                    :to="`/co-investors/${ci.id}`"
                    class="wf-ci-row"
                  >
                    <div class="wf-ci-info">
                      <div class="wf-ci-head">
                        <div class="wf-ci-name">{{ ci.name }}</div>
                        <div class="wf-ci-mode" :class="`wf-ci-mode--${ciShareLabels[ci.id]?.kind}`">
                          <v-icon :icon="ciShareLabels[ci.id]?.icon || 'mdi-scale-balance'" size="11" />
                          {{ ciShareLabels[ci.id]?.label }}
                        </div>
                      </div>
                      <div class="wf-ci-meta">
                        Капитал {{ formatCurrencyShort(ci.currentCapital || ci.capital) }}
                        <span v-if="(ci.realizedProfit - ci.totalPayout) > 0">
                          · к выплате <strong style="color: #f59e0b;">{{ formatCurrencyShort(ci.realizedProfit - ci.totalPayout) }}</strong>
                        </span>
                      </div>
                    </div>
                    <v-icon icon="mdi-arrow-right" size="14" class="wf-ci-arrow" />
                  </router-link>
                </div>
              </div>
            </template>

            <template v-else-if="wfExpanded === 'profit' && capitalDetails.deals">
              <div class="wf-panel-title">Прибыль по сделкам</div>
              <div
                v-for="d in capitalDetails.deals.filter(x => dealTotalMargin(x) > 0)"
                :key="d.id"
                class="wf-acc"
              >
                <button class="wf-acc-head" @click="toggleProfitDeal(d.id)">
                  <v-icon
                    :icon="expandedInProfit.has(d.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                    size="16"
                    class="wf-acc-chevron"
                  />
                  <div class="wf-acc-title">
                    <router-link :to="`/deals/${d.id}`" class="wf-expand-link" @click.stop>
                      {{ d.productName }}
                      <span v-if="d.client" class="wf-expand-dim"> · {{ d.client }}</span>
                      <span
                        v-if="d.wholesalePrice != null && d.wholesalePrice > 0"
                        class="wf-pill-wholesale"
                        :title="`Оптовая ${formatCurrencyShort(d.wholesalePrice)} · Розничная ${formatCurrencyShort(d.purchasePrice)}`"
                      >опт</span>
                    </router-link>
                    <span class="wf-acc-sub">из ожидаемой {{ formatCurrencyShort(dealTotalMargin(d)) }}</span>
                  </div>
                  <span class="wf-expand-val" style="color: #10b981;">+{{ formatCurrency(dealProfitEarned(d)) }}</span>
                </button>

                <div v-if="expandedInProfit.has(d.id)" class="wf-acc-body">
                  <div v-if="d.downPayment > 0" class="wf-pay-row">
                    <span class="wf-pay-status wf-pay-status--paid">✓</span>
                    <span class="wf-pay-name">Первоначальный взнос</span>
                    <span class="wf-pay-amount-dim">({{ formatCurrencyShort(d.downPayment) }})</span>
                    <span class="wf-pay-flex" />
                    <span class="wf-pay-profit">+{{ formatCurrency(Math.round(d.downPayment * (dealTotalMargin(d) / Math.max(d.totalPrice, 1)))) }}</span>
                  </div>
                  <div v-for="p in d.payments" :key="p.id" class="wf-pay-row">
                    <span class="wf-pay-status" :class="`wf-pay-status--${p.status.toLowerCase()}`">
                      <v-icon
                        :icon="p.status === 'PAID' ? 'mdi-check' : (p.status === 'OVERDUE' ? 'mdi-alert' : 'mdi-clock-outline')"
                        size="11"
                      />
                    </span>
                    <span class="wf-pay-name">Платёж #{{ p.number }}</span>
                    <span class="wf-pay-amount-dim">({{ formatCurrencyShort(p.amount) }})</span>
                    <span class="wf-pay-status-text">{{ PAYMENT_STATUS_LABEL[p.status] }}</span>
                    <span class="wf-pay-flex" />
                    <span v-if="p.status === 'PAID'" class="wf-pay-profit">+{{ formatCurrency(paymentProfit(d, p)) }}</span>
                    <span v-else class="wf-pay-profit-future">— ожидается {{ formatCurrencyShort(paymentProfit(d, p)) }}</span>
                  </div>
                </div>
              </div>
              <div v-if="capitalDetails.deals.every(x => x.markup === 0)" class="wf-expand-empty">Прибыли пока нет</div>
            </template>

            <template v-else-if="wfExpanded === 'deployed' && capitalDetails.deals">
              <div class="wf-panel-title">Капитал в активных сделках</div>
              <div class="wf-formula">
                <div class="wf-formula-row">
                  <span>Закупка по активным сделкам</span>
                  <span class="wf-formula-val">{{ formatCurrency(activeDealsPurchaseTotal) }}</span>
                </div>
                <div class="wf-formula-row wf-formula-row--minus">
                  <span>− Возврат закупки клиентами</span>
                  <span class="wf-formula-val">{{ formatCurrency(activeDealsCostRecovered) }}</span>
                </div>
                <div class="wf-formula-row wf-formula-row--total">
                  <span>В работе</span>
                  <span class="wf-formula-val">{{ formatCurrency(capitalDetails.inProgress) }}</span>
                </div>
                <div class="wf-formula-hint">
                  <v-icon icon="mdi-information-outline" size="13" />
                  <span>Каждый платёж клиента делится на возврат закупки и прибыль в пропорции <b>наценка / итоговая цена</b>. Прибыль учитывается отдельно.</span>
                </div>
              </div>
              <div class="wf-expand-subtitle">По сделкам</div>
              <div v-for="d in capitalDetails.deals.filter(x => x.status === 'ACTIVE')" :key="d.id" class="wf-acc">
                <button class="wf-acc-head" @click="toggleProgressDeal(d.id)">
                  <v-icon
                    :icon="expandedInProgress.has(d.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                    size="16"
                    class="wf-acc-chevron"
                  />
                  <div class="wf-acc-title">
                    <router-link :to="`/deals/${d.id}`" class="wf-expand-link" @click.stop>
                      {{ d.productName }}
                      <span v-if="d.client" class="wf-expand-dim"> · {{ d.client }}</span>
                    </router-link>
                    <span class="wf-acc-sub">{{ d.progress }}% оплачено</span>
                  </div>
                  <span class="wf-expand-val" style="color: #f59e0b;">{{ formatCurrency(dealInProgress(d)) }}</span>
                </button>
                <div v-if="expandedInProgress.has(d.id)" class="wf-acc-body">
                  <table class="wf-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th class="wf-table-num">Получено</th>
                        <th class="wf-table-num">Ожидается</th>
                        <th class="wf-table-num">Всего</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td class="wf-table-row-label">Возврат закупки</td>
                        <td class="wf-table-num">{{ formatCurrency(dealCostRecovered(d)) }}</td>
                        <td class="wf-table-num wf-table-num--dim">{{ formatCurrency(dealInProgress(d)) }}</td>
                        <td class="wf-table-num wf-table-num--dim">{{ formatCurrency(dealRealCost(d)) }}</td>
                      </tr>
                      <tr>
                        <td class="wf-table-row-label">
                          {{ d.wholesalePrice != null && d.wholesalePrice > 0 ? 'Прибыль' : 'Прибыль (наценка)' }}
                        </td>
                        <td class="wf-table-num" style="color: #10b981;">{{ formatCurrency(dealProfitEarned(d)) }}</td>
                        <td class="wf-table-num wf-table-num--dim">{{ formatCurrency(dealProfitRemaining(d)) }}</td>
                        <td class="wf-table-num wf-table-num--dim">{{ formatCurrency(dealTotalMargin(d)) }}</td>
                      </tr>
                      <tr class="wf-table-total">
                        <td class="wf-table-row-label">Поступления</td>
                        <td class="wf-table-num">{{ formatCurrency(d.received) }}</td>
                        <td class="wf-table-num">{{ formatCurrency(Math.max(d.totalPrice - d.received, 0)) }}</td>
                        <td class="wf-table-num">{{ formatCurrency(d.totalPrice) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div v-if="capitalDetails.deals.every(x => x.status !== 'ACTIVE')" class="wf-expand-empty">Нет активных сделок</div>
            </template>

            <template v-else-if="wfExpanded === 'manual'">
              <div class="wf-panel-title">
                Ручные операции
                <button class="wf-panel-add" @click="openCreateTransaction">
                  <v-icon icon="mdi-plus" size="14" />
                  Добавить
                </button>
              </div>
              <div v-if="manualOperations.length === 0" class="wf-expand-empty">
                Здесь будут ручные доходы и расходы по этой кассе
              </div>
              <div v-else class="wf-manual-list">
                <div v-for="op in manualOperations" :key="op.transactionId" class="wf-manual-row">
                  <div class="wf-manual-dot" :style="{
                    background: op.category?.color || (op.type === 'INCOME' ? '#10b981' : '#ef4444')
                  }" />
                  <div class="wf-manual-info">
                    <div class="wf-manual-title">{{ op.description }}</div>
                    <div class="wf-manual-meta">
                      <span v-if="op.category">{{ op.category.name }} · </span>
                      <span>{{ formatDate(op.date) }}</span>
                    </div>
                  </div>
                  <div class="wf-manual-amount" :style="{ color: op.type === 'INCOME' ? '#10b981' : '#ef4444' }">
                    {{ op.type === 'INCOME' ? '+' : '-' }}{{ formatCurrency(op.amount) }}
                  </div>
                  <button class="wf-manual-icon-btn" @click="openEditTransaction(op)" title="Редактировать">
                    <v-icon icon="mdi-pencil-outline" size="15" />
                  </button>
                  <button class="wf-manual-icon-btn wf-manual-icon-btn--danger" @click="confirmDeleteTransaction(op.transactionId!)" title="Удалить">
                    <v-icon icon="mdi-delete-outline" size="15" />
                  </button>
                </div>
              </div>
            </template>

            <template v-else-if="wfExpanded === 'pendingCI'">
              <div class="wf-panel-title">Резерв для инвесторов</div>
              <div class="wf-formula">
                <div class="wf-formula-row wf-formula-row--total">
                  <span>Итого к выплате</span>
                  <span class="wf-formula-val">{{ formatCurrency(capitalDetails.pendingCIPayout) }}</span>
                </div>
                <div class="wf-formula-hint">
                  <v-icon icon="mdi-information-outline" size="13" />
                  <span>
                    Это деньги, причитающиеся инвесторам, но ещё физически находящиеся в кассе.
                    Из доступного капитала они НЕ вычитаются — уйдут только при фактической выплате дивидендов.
                  </span>
                </div>
              </div>
              <div class="wf-expand-subtitle">По инвесторам</div>
              <div class="wf-ci-list">
                <router-link
                  v-for="ci in pendingCiList"
                  :key="ci.id"
                  :to="`/co-investors/${ci.id}`"
                  class="wf-ci-row"
                >
                  <div class="wf-ci-info">
                    <div class="wf-ci-head">
                      <div class="wf-ci-name">{{ ci.name }}</div>
                      <div class="wf-ci-mode" :class="`wf-ci-mode--${ciShareLabels[ci.id]?.kind}`">
                        <v-icon :icon="ciShareLabels[ci.id]?.icon || 'mdi-scale-balance'" size="11" />
                        {{ ciShareLabels[ci.id]?.label }}
                      </div>
                    </div>
                    <div class="wf-ci-meta">
                      Начислено {{ formatCurrencyShort(ci.realizedProfit) }} ·
                      выплачено {{ formatCurrencyShort(ci.totalPayout) }}
                    </div>
                  </div>
                  <div class="wf-ci-pending">
                    <div class="wf-ci-pending-val">{{ formatCurrency(ci.pendingPayout) }}</div>
                    <div class="wf-ci-pending-label">к выплате</div>
                  </div>
                </router-link>
              </div>
            </template>

            <template v-else>
              <div class="wf-panel-empty">
                <v-icon icon="mdi-cursor-default-click-outline" size="28" color="grey-lighten-2" />
                <div>Нажмите на строку слева для просмотра деталей</div>
              </div>
            </template>
          </div>
        </div>

        <!-- Utilization bar -->
        <div class="wf-utilization">
          <div class="wf-utilization-header">
            <span class="wf-utilization-label">Капитал в работе</span>
            <span class="wf-utilization-percent">{{ capitalUtilization }}%</span>
          </div>
          <div class="wf-utilization-bar">
            <div class="wf-utilization-fill" :style="{ width: capitalUtilization + '%', background: box.color }" />
          </div>
        </div>
      </div>

      <!-- ============================ -->
      <!-- Operations / Deals / Journal tabs -->
      <!-- ============================ -->
      <v-card v-if="capitalDetails" rounded="lg" elevation="0" border class="mb-6">
        <div class="pa-4">
          <div class="d-flex align-center ga-3 mb-4 flex-wrap">
            <div class="fn-tabs">
              <button class="fn-tab" :class="{ 'fn-tab--active': detailsTab === 'journal' }" @click="detailsTab = 'journal'">
                Касса
              </button>
              <button class="fn-tab" :class="{ 'fn-tab--active': detailsTab === 'operations' }" @click="detailsTab = 'operations'">
                Все операции
              </button>
              <button class="fn-tab" :class="{ 'fn-tab--active': detailsTab === 'deals' }" @click="detailsTab = 'deals'">
                По сделкам
              </button>
            </div>
          </div>

          <!-- Journal: scoped via prop -->
          <template v-if="detailsTab === 'journal'">
            <CashflowJournal :cash-box-id="id" />
          </template>

          <!-- Operations list -->
          <template v-else-if="detailsTab === 'operations'">
            <!-- Filter toolbar — matches the Касса tab (CashflowJournal) -->
            <div class="cfj-filters mb-3">
              <!-- Type filter (multi) -->
              <v-menu :close-on-content-click="false">
                <template #activator="{ props: act }">
                  <button v-bind="act" class="cfj-filter-btn" :class="{ 'cfj-filter-btn--active': opKinds.length }">
                    <v-icon icon="mdi-filter-variant" size="14" />
                    <span>{{ opKinds.length ? `${opKinds.length} типа` : 'Все типы' }}</span>
                    <v-icon icon="mdi-chevron-down" size="14" class="cfj-filter-caret" />
                  </button>
                </template>
                <v-card rounded="lg" elevation="4" class="cfj-menu">
                  <div class="cfj-menu-head">Тип операции</div>
                  <button
                    v-for="k in OP_KIND_CHIPS"
                    :key="k.key"
                    class="cfj-menu-item"
                    :class="{ 'cfj-menu-item--active': opKinds.includes(k.key) }"
                    @click="toggleOpKind(k.key)"
                  >
                    <span class="cfj-menu-item-dot" :style="{ background: k.color }" />
                    <span class="cfj-menu-item-name">{{ k.label }}</span>
                    <v-icon
                      v-if="opKinds.includes(k.key)"
                      icon="mdi-check"
                      size="14"
                      class="cfj-menu-item-check"
                    />
                  </button>
                  <div class="cfj-menu-divider" />
                  <button class="cfj-menu-clear" @click="opKinds = []">Сбросить</button>
                </v-card>
              </v-menu>

              <!-- Period filter -->
              <v-menu :close-on-content-click="false">
                <template #activator="{ props: act }">
                  <button v-bind="act" class="cfj-filter-btn" :class="{ 'cfj-filter-btn--active': opPeriod !== 'all' }">
                    <v-icon icon="mdi-calendar-outline" size="14" />
                    <span>{{ opPeriodLabel }}</span>
                    <v-icon icon="mdi-chevron-down" size="14" class="cfj-filter-caret" />
                  </button>
                </template>
                <v-card rounded="lg" elevation="4" class="cfj-menu">
                  <div class="cfj-menu-head">Период</div>
                  <button
                    v-for="p in OP_PERIODS"
                    :key="p.key"
                    class="cfj-menu-item"
                    :class="{ 'cfj-menu-item--active': opPeriod === p.key }"
                    @click="opPeriod = p.key"
                  >
                    <v-icon icon="mdi-calendar-blank-outline" size="14" />
                    <span class="cfj-menu-item-name">{{ p.label }}</span>
                    <v-icon v-if="opPeriod === p.key" icon="mdi-check" size="14" class="cfj-menu-item-check" />
                  </button>
                </v-card>
              </v-menu>

              <!-- Search -->
              <div class="cfj-search-wrap">
                <v-icon icon="mdi-magnify" size="14" class="cfj-search-icon" />
                <input
                  v-model="opSearch"
                  type="text"
                  placeholder="Поиск..."
                  class="cfj-search"
                />
              </div>

              <button class="cfj-filter-btn" @click="showCategoriesManager = true" title="Управление категориями" style="margin-left: auto;">
                <v-icon icon="mdi-tag-multiple-outline" size="14" />
                Категории
              </button>
              <button class="cfj-add-btn" @click="openCreateTransaction">
                <v-icon icon="mdi-plus" size="14" />
                Добавить
              </button>
            </div>

            <div v-if="filteredOperations.length === 0" class="fn-empty">
              <div class="fn-empty-icon"><v-icon icon="mdi-wallet-outline" size="48" color="grey" /></div>
              <div class="fn-empty-title">
                {{ capitalDetails.operations.length === 0 ? 'Нет операций' : 'Ничего не найдено' }}
              </div>
              <div class="fn-empty-subtitle">
                {{ capitalDetails.operations.length === 0
                  ? 'Создайте сделку для этой кассы или добавьте операцию вручную'
                  : 'Попробуйте изменить фильтры' }}
              </div>
            </div>
            <div v-else class="fn-transactions-list">
              <div
                v-for="(op, i) in filteredOperations.slice(0, showAllOps ? undefined : 30)"
                :key="op.transactionId || `auto-${i}`"
                class="fn-transaction-row"
              >
                <div class="fn-transaction-dot" :style="{
                  background: op.isManual
                    ? (op.category?.color || (op.type === 'INCOME' ? '#10b981' : '#ef4444'))
                    : op.type === 'INCOME' ? '#10b981' : op.type === 'PAYOUT' ? '#f59e0b' : '#ef4444'
                }" />
                <div class="fn-transaction-info">
                  <div class="fn-transaction-title">
                    {{ op.description }}
                    <span v-if="op.isManual" class="fn-op-badge fn-op-badge--manual">Вручную</span>
                  </div>
                  <div class="fn-transaction-meta">
                    <span v-if="op.isManual && op.category">{{ op.category.name }} · </span>
                    <span>{{ formatDate(op.date) }}</span>
                  </div>
                </div>
                <div class="fn-transaction-amount" :class="{
                  'fn-transaction-amount--income': op.type === 'INCOME',
                  'fn-transaction-amount--expense': op.type !== 'INCOME',
                }">
                  {{ op.type === 'INCOME' ? '+' : '-' }}{{ formatCurrency(op.amount) }}
                </div>

                <!-- Actions: edit/delete for manual, open for deal-linked -->
                <template v-if="op.isManual && op.transactionId">
                  <button class="fn-icon-btn" @click="openEditTransaction(op)" title="Редактировать">
                    <v-icon icon="mdi-pencil-outline" size="16" />
                  </button>
                  <button class="fn-icon-btn fn-icon-btn--danger" @click="confirmDeleteTransaction(op.transactionId)" title="Удалить">
                    <v-icon icon="mdi-delete-outline" size="16" />
                  </button>
                </template>
                <router-link v-else-if="op.dealId" :to="`/deals/${op.dealId}`" class="fn-op-link">
                  <v-icon icon="mdi-open-in-new" size="14" />
                </router-link>
              </div>
            </div>
            <div v-if="!showAllOps && filteredOperations.length > 30" class="fn-load-more">
              <button class="fn-load-more-btn" @click="showAllOps = true">
                Показать все ({{ filteredOperations.length }})
              </button>
            </div>
          </template>

          <!-- Deals breakdown -->
          <template v-if="detailsTab === 'deals'">
            <div v-if="capitalDetails.deals.length === 0" class="fn-empty">
              <div class="fn-empty-icon"><v-icon icon="mdi-handshake-outline" size="48" color="grey" /></div>
              <div class="fn-empty-title">В этой кассе пока нет сделок</div>
            </div>
            <div v-else class="cap-deals-list">
              <div v-for="deal in capitalDetails.deals" :key="deal.id" class="cap-deal-row">
                <div class="cap-deal-info">
                  <div class="cap-deal-name">
                    <router-link :to="`/deals/${deal.id}`" class="cap-deal-link">{{ deal.productName }}</router-link>
                  </div>
                  <div class="cap-deal-meta">
                    <span v-if="deal.client">{{ deal.client }}</span>
                    <span>{{ deal.progress }}% оплачено</span>
                  </div>
                </div>
                <div class="cap-deal-numbers">
                  <div class="cap-deal-num">
                    <div class="cap-deal-num-label">Закупка</div>
                    <div class="cap-deal-num-value" style="color: #ef4444;">{{ formatCurrency(dealRealCost(deal)) }}</div>
                  </div>
                  <div class="cap-deal-num">
                    <div class="cap-deal-num-label">Получено</div>
                    <div class="cap-deal-num-value" style="color: #10b981;">{{ formatCurrency(deal.received) }}</div>
                  </div>
                  <div class="cap-deal-num">
                    <div class="cap-deal-num-label">Прибыль</div>
                    <div class="cap-deal-num-value">{{ formatCurrency(dealTotalMargin(deal)) }}</div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </v-card>
    </template>

    <!-- Edit dialog -->
    <CashBoxEditDialog v-model="showEdit" :cashbox="box" @saved="(b) => { box = b; loadDetails() }" />

    <!-- ── Create/Edit Transaction Dialog (matches old finance.vue) ── -->
    <v-dialog v-model="showTxDialog" max-width="520" persistent :fullscreen="isMobile">
      <v-card rounded="lg" elevation="0">
        <div class="fn-dialog-header">
          <div class="fn-dialog-title">
            {{ txEditingId ? 'Редактировать операцию' : 'Новая операция' }}
          </div>
          <button class="fn-dialog-close" @click="showTxDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <!-- Type toggle -->
          <div class="fn-type-toggle mb-5">
            <button
              class="fn-type-btn"
              :class="{ 'fn-type-btn--active fn-type-btn--income': txForm.type === 'INCOME' }"
              @click="txForm.type = 'INCOME'; txForm.categoryId = ''"
            >
              <v-icon icon="mdi-arrow-down" size="16" class="mr-1" />
              Доход
            </button>
            <button
              class="fn-type-btn"
              :class="{ 'fn-type-btn--active fn-type-btn--expense': txForm.type === 'EXPENSE' }"
              @click="txForm.type = 'EXPENSE'; txForm.categoryId = ''"
            >
              <v-icon icon="mdi-arrow-up" size="16" class="mr-1" />
              Расход
            </button>
          </div>

          <!-- Amount -->
          <div class="mb-4">
            <label class="fn-field-label">Сумма *</label>
            <div class="fn-field-input-wrap">
              <input
                :value="txForm.amount || ''"
                @input="(e: any) => txForm.amount = parseInt(String(e.target.value).replace(/\D/g, ''), 10) || 0"
                type="text"
                inputmode="numeric"
                placeholder="0"
                class="fn-field-input"
              />
              <span class="fn-field-suffix">₽</span>
            </div>
          </div>

          <!-- Description -->
          <div class="mb-4">
            <label class="fn-field-label">Описание</label>
            <input
              v-model="txForm.description"
              type="text"
              placeholder="Краткое описание операции"
              class="fn-field-input"
            />
          </div>

          <!-- Category -->
          <div class="mb-4">
            <label class="fn-field-label">Категория</label>
            <div class="d-flex ga-2 align-center">
              <v-menu :close-on-content-click="true">
                <template #activator="{ props: act }">
                  <button v-bind="act" type="button" class="fn-field-select-btn">
                    <template v-if="txSelectedCategory">
                      <span class="fn-field-select-dot" :style="{ background: txSelectedCategory.color || (txForm.type === 'INCOME' ? INCOME_COLOR : EXPENSE_COLOR) }" />
                      <span class="fn-field-select-value">{{ txSelectedCategory.name }}</span>
                    </template>
                    <span v-else class="fn-field-select-value fn-field-select-value--placeholder">
                      Без категории
                    </span>
                    <v-icon icon="mdi-chevron-down" size="16" class="fn-field-select-chevron" />
                  </button>
                </template>
                <v-card rounded="lg" elevation="4" class="cfj-menu fn-select-menu">
                  <button
                    class="cfj-menu-item"
                    :class="{ 'cfj-menu-item--active': !txForm.categoryId }"
                    @click="txForm.categoryId = ''"
                  >
                    <span class="cfj-menu-item-dot" style="background: rgba(var(--v-theme-on-surface), 0.15);" />
                    <span class="cfj-menu-item-name">Без категории</span>
                    <v-icon v-if="!txForm.categoryId" icon="mdi-check" size="14" class="cfj-menu-item-check" />
                  </button>
                  <div v-if="filteredCategories.length" class="cfj-menu-divider" />
                  <button
                    v-for="cat in filteredCategories"
                    :key="cat.id"
                    class="cfj-menu-item"
                    :class="{ 'cfj-menu-item--active': txForm.categoryId === cat.id }"
                    @click="txForm.categoryId = cat.id"
                  >
                    <span class="cfj-menu-item-dot" :style="{ background: cat.color || (txForm.type === 'INCOME' ? INCOME_COLOR : EXPENSE_COLOR) }" />
                    <span class="cfj-menu-item-name">{{ cat.name }}</span>
                    <v-icon v-if="txForm.categoryId === cat.id" icon="mdi-check" size="14" class="cfj-menu-item-check" />
                  </button>
                  <div v-if="!filteredCategories.length" class="cfj-menu-empty">
                    Нет категорий — создайте новую
                  </div>
                </v-card>
              </v-menu>
              <button class="fn-icon-btn fn-icon-btn--add" @click="openCreateCategory" title="Новая категория">
                <v-icon icon="mdi-plus" size="18" />
              </button>
            </div>
          </div>

          <!-- Date -->
          <div class="mb-2">
            <label class="fn-field-label">Дата</label>
            <input
              v-model="txForm.date"
              type="date"
              class="fn-field-input"
            />
          </div>
        </div>

        <div class="fn-dialog-actions">
          <button class="fn-btn fn-btn--ghost" @click="showTxDialog = false">Отмена</button>
          <button
            class="fn-btn fn-btn--primary"
            :disabled="txSaving"
            @click="saveTransaction"
          >
            <v-progress-circular v-if="txSaving" indeterminate size="16" width="2" class="mr-2" color="white" />
            {{ txEditingId ? 'Сохранить' : 'Добавить' }}
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- ── Create / Edit Category Dialog ── -->
    <v-dialog v-model="showCategoryDialog" max-width="420" persistent :fullscreen="isMobile">
      <v-card rounded="lg" elevation="0">
        <div class="fn-dialog-header">
          <div class="fn-dialog-title">
            {{ categoryEditingId ? 'Редактировать категорию' : 'Новая категория' }}
          </div>
          <button class="fn-dialog-close" @click="showCategoryDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <!-- Type toggle: disabled in edit mode (would invalidate linked transactions) -->
          <div class="fn-type-toggle mb-4" :class="{ 'fn-type-toggle--locked': categoryEditingId }">
            <button
              class="fn-type-btn"
              :class="{ 'fn-type-btn--active fn-type-btn--income': categoryForm.type === 'INCOME' }"
              :disabled="!!categoryEditingId"
              @click="categoryForm.type = 'INCOME'"
            >
              Доход
            </button>
            <button
              class="fn-type-btn"
              :class="{ 'fn-type-btn--active fn-type-btn--expense': categoryForm.type === 'EXPENSE' }"
              :disabled="!!categoryEditingId"
              @click="categoryForm.type = 'EXPENSE'"
            >
              Расход
            </button>
          </div>

          <div class="mb-4">
            <label class="fn-field-label">Название *</label>
            <input
              v-model="categoryForm.name"
              type="text"
              placeholder="Например: Аренда"
              class="fn-field-input"
            />
          </div>

          <div class="mb-2">
            <label class="fn-field-label">Цвет</label>
            <div class="fn-color-picker">
              <button
                v-for="color in CATEGORY_COLORS"
                :key="color"
                class="fn-color-dot"
                :class="{ 'fn-color-dot--active': categoryForm.color === color }"
                :style="{ background: color }"
                @click="categoryForm.color = color"
              ></button>
            </div>
          </div>
        </div>

        <div class="fn-dialog-actions">
          <button class="fn-btn fn-btn--ghost" @click="showCategoryDialog = false">Отмена</button>
          <button
            class="fn-btn fn-btn--primary"
            :disabled="categoryLoading"
            @click="saveCategory"
          >
            <v-progress-circular v-if="categoryLoading" indeterminate size="16" width="2" class="mr-2" color="white" />
            {{ categoryEditingId ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- ── Categories Manager Dialog ── -->
    <v-dialog v-model="showCategoriesManager" max-width="520" :fullscreen="isMobile">
      <v-card rounded="lg" elevation="0">
        <div class="fn-dialog-header">
          <div class="fn-dialog-title">Категории</div>
          <button class="fn-dialog-close" @click="showCategoriesManager = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <div class="mb-5">
            <div class="fn-cat-section-header">
              <div class="fn-cat-section-title" style="color: #10b981;">
                <v-icon icon="mdi-arrow-down" size="16" class="mr-1" />
                Доходы
              </div>
              <button class="fn-cat-add-btn" @click="openCreateCategoryFromManager('INCOME')">
                <v-icon icon="mdi-plus" size="14" />
                Добавить
              </button>
            </div>
            <div class="fn-cat-list">
              <div
                v-for="cat in categories.filter((c) => c.type === 'INCOME')"
                :key="cat.id"
                class="fn-cat-row"
              >
                <div class="fn-cat-dot" :style="{ background: cat.color || INCOME_COLOR }"></div>
                <div class="fn-cat-name">{{ cat.name }}</div>
                <div class="fn-cat-count">{{ cat._count.transactions }} оп.</div>
                <button class="fn-icon-btn" @click="openEditCategory(cat)" title="Редактировать">
                  <v-icon icon="mdi-pencil-outline" size="15" />
                </button>
                <button class="fn-icon-btn fn-icon-btn--danger" @click="confirmDeleteCategory(cat.id)" title="Удалить">
                  <v-icon icon="mdi-delete-outline" size="15" />
                </button>
              </div>
              <div v-if="!categories.filter((c) => c.type === 'INCOME').length" class="fn-cat-empty">
                Нет категорий доходов
              </div>
            </div>
          </div>

          <div>
            <div class="fn-cat-section-header">
              <div class="fn-cat-section-title" style="color: #ef4444;">
                <v-icon icon="mdi-arrow-up" size="16" class="mr-1" />
                Расходы
              </div>
              <button class="fn-cat-add-btn" @click="openCreateCategoryFromManager('EXPENSE')">
                <v-icon icon="mdi-plus" size="14" />
                Добавить
              </button>
            </div>
            <div class="fn-cat-list">
              <div
                v-for="cat in categories.filter((c) => c.type === 'EXPENSE')"
                :key="cat.id"
                class="fn-cat-row"
              >
                <div class="fn-cat-dot" :style="{ background: cat.color || EXPENSE_COLOR }"></div>
                <div class="fn-cat-name">{{ cat.name }}</div>
                <div class="fn-cat-count">{{ cat._count.transactions }} оп.</div>
                <button class="fn-icon-btn" @click="openEditCategory(cat)" title="Редактировать">
                  <v-icon icon="mdi-pencil-outline" size="15" />
                </button>
                <button class="fn-icon-btn fn-icon-btn--danger" @click="confirmDeleteCategory(cat.id)" title="Удалить">
                  <v-icon icon="mdi-delete-outline" size="15" />
                </button>
              </div>
              <div v-if="!categories.filter((c) => c.type === 'EXPENSE').length" class="fn-cat-empty">
                Нет категорий расходов
              </div>
            </div>
          </div>
        </div>

        <div class="fn-dialog-actions">
          <button class="fn-btn fn-btn--ghost" @click="showCategoriesManager = false">Закрыть</button>
        </div>
      </v-card>
    </v-dialog>

    <!-- ── Delete Transaction Dialog ── -->
    <v-dialog v-model="txDeleteDialog" max-width="400" persistent>
      <v-card rounded="lg" elevation="0" class="pa-5 text-center">
        <div class="fn-delete-icon mb-4">
          <v-icon icon="mdi-delete-outline" size="32" color="error" />
        </div>
        <div class="fn-delete-title mb-2">Удалить операцию?</div>
        <div class="fn-delete-subtitle mb-5">Это действие нельзя отменить</div>
        <div class="d-flex justify-center ga-3">
          <button class="fn-btn fn-btn--ghost" @click="txDeleteDialog = false">Отмена</button>
          <button class="fn-btn fn-btn--danger" :disabled="txDeleteLoading" @click="deleteTransaction">
            <v-progress-circular v-if="txDeleteLoading" indeterminate size="16" width="2" class="mr-2" color="white" />
            Удалить
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- ── Delete Category Dialog ── -->
    <v-dialog v-model="deleteCategoryDialog" max-width="400" persistent>
      <v-card rounded="lg" elevation="0" class="pa-5 text-center">
        <div class="fn-delete-icon mb-4">
          <v-icon icon="mdi-tag-off-outline" size="32" color="error" />
        </div>
        <div class="fn-delete-title mb-2">Удалить категорию?</div>
        <div class="fn-delete-subtitle mb-5">Операции останутся, но без категории</div>
        <div class="d-flex justify-center ga-3">
          <button class="fn-btn fn-btn--ghost" @click="deleteCategoryDialog = false">Отмена</button>
          <button class="fn-btn fn-btn--danger" :disabled="deleteCategoryLoading" @click="deleteCategory">
            <v-progress-circular v-if="deleteCategoryLoading" indeterminate size="16" width="2" class="mr-2" color="white" />
            Удалить
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.cb-page { max-width: 1440px; margin: 0 auto; padding: 24px; }

.cb-back {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: none; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.6); font-size: 13px; font-weight: 600;
  margin-bottom: 18px; padding: 6px 0;
  transition: color 0.15s;
}
.cb-back:hover { color: rgb(var(--v-theme-on-surface)); }

/* Header */
.cb-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.cb-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; }
.cb-header-icon {
  width: 54px; height: 54px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.cb-header-title {
  font-size: 22px; font-weight: 800; color: rgb(var(--v-theme-on-surface));
  letter-spacing: -0.3px; display: flex; align-items: center; gap: 10px;
}
.cb-header-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 3px 8px; border-radius: 6px;
}
.cb-header-meta { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; }
.cb-header-actions { display: flex; gap: 8px; flex-shrink: 0; }
.cb-action-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 14px; border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.cb-action-btn:hover { border-color: #047857; color: #047857; }
.cb-action-btn--danger { color: #ef4444; }
.cb-action-btn--danger:hover { border-color: #ef4444; color: #ef4444; }

/* ─── Waterfall ─────────────────────────────────────────────────────── */
.wf {
  background: rgb(var(--v-theme-surface));
  border-radius: 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  padding: 20px 24px;
}
.wf-title-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
}
.wf-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-transform: uppercase; letter-spacing: 0.5px;
}

.wf-split {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 20px;
}
@media (max-width: 960px) {
  .wf-split { grid-template-columns: 1fr; }
}

.wf-left { display: flex; flex-direction: column; gap: 8px; }
.wf-item {
  display: block; width: 100%;
  text-align: left; padding: 12px 14px;
  border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
  cursor: pointer; transition: all 0.15s;
}
.wf-item:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.18);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.wf-item--active {
  border-color: #047857; background: rgba(4, 120, 87, 0.06);
}
.wf-item--result {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.2);
  cursor: default;
}
.wf-item-value { font-size: 17px; font-weight: 800; line-height: 1.2; }
.wf-item-value--big { font-size: 22px; }
.wf-item-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 3px; font-weight: 500;
}

.wf-right {
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgba(var(--v-theme-on-surface), 0.02);
  padding: 16px;
  min-height: 220px;
}
.wf-panel-title {
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
  text-transform: uppercase; letter-spacing: 0.4px;
  margin-bottom: 12px;
}
.wf-panel-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 32px 16px; text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.4); font-size: 13px;
  min-height: 200px;
}

.wf-expand-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px;
}
.wf-expand-row:last-child { border-bottom: none; }
.wf-expand-row--sub { padding-left: 16px; opacity: 0.75; font-size: 12px; }
.wf-expand-val { font-weight: 700; }
.wf-expand-empty {
  padding: 24px; text-align: center;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.wf-expand-subtitle {
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.4px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin: 14px 0 8px;
}

.wf-formula {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 10px; padding: 12px;
  font-size: 13px;
}
.wf-formula-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 0;
}
.wf-formula-row--minus { color: rgba(var(--v-theme-on-surface), 0.65); }
.wf-formula-row--total {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  padding-top: 8px; margin-top: 4px; font-weight: 700;
}
.wf-formula-val { font-weight: 700; }
.wf-formula-hint {
  display: flex; align-items: flex-start; gap: 6px;
  margin-top: 10px; padding-top: 10px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.1);
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55);
  line-height: 1.4;
}

.wf-acc {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.wf-acc:last-child { border-bottom: none; }
.wf-acc-head {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 10px 0;
  background: transparent; border: none; cursor: pointer;
  font-size: 13px;
}
.wf-acc-chevron { color: rgba(var(--v-theme-on-surface), 0.4); flex-shrink: 0; }
.wf-acc-title { flex: 1; min-width: 0; text-align: left; }
.wf-acc-sub {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5);
  font-weight: 500; display: block; margin-top: 1px;
}
.wf-expand-link {
  color: rgb(var(--v-theme-on-surface)); font-weight: 600;
  text-decoration: none;
}
.wf-expand-link:hover { color: #047857; }
.wf-expand-dim { color: rgba(var(--v-theme-on-surface), 0.5); font-weight: 500; }
.wf-pill-wholesale {
  display: inline-block;
  font-size: 9px; font-weight: 700;
  background: rgba(124, 58, 237, 0.12); color: #7c3aed;
  padding: 1px 5px; border-radius: 5px; margin-left: 6px;
  text-transform: uppercase; letter-spacing: 0.3px;
}
.wf-acc-body {
  padding: 8px 0 14px 24px;
}

.wf-pay-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0; font-size: 12px;
}
.wf-pay-status {
  width: 18px; height: 18px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; flex-shrink: 0;
}
.wf-pay-status--paid { background: rgba(16,185,129,0.15); color: #10b981; }
.wf-pay-status--overdue { background: rgba(239,68,68,0.15); color: #ef4444; }
.wf-pay-status--pending { background: rgba(245,158,11,0.15); color: #f59e0b; }
.wf-pay-status--closed_early { background: rgba(124,58,237,0.15); color: #7c3aed; }
.wf-pay-name { font-weight: 600; }
.wf-pay-amount-dim { color: rgba(var(--v-theme-on-surface), 0.5); }
.wf-pay-status-text {
  font-size: 10px; color: rgba(var(--v-theme-on-surface), 0.5);
  padding: 1px 6px; border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.wf-pay-flex { flex: 1; }
.wf-pay-profit { color: #10b981; font-weight: 700; }
.wf-pay-profit-future {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
  font-style: italic;
}

.wf-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  margin-top: 6px;
}
.wf-table th, .wf-table td {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  text-align: left;
}
.wf-table th {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
  font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.5);
}
.wf-table-num { text-align: right; font-weight: 600; }
.wf-table-num--dim { color: rgba(var(--v-theme-on-surface), 0.5); }
.wf-table-row-label { font-weight: 600; }
.wf-table-row-hint {
  display: block; font-size: 10px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.wf-table-total td { font-weight: 800; border-bottom: none; padding-top: 12px; }

.wf-utilization { margin-top: 18px; }
.wf-utilization-header {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}
.wf-utilization-percent { font-weight: 700; }
.wf-utilization-bar {
  height: 6px; border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.06); overflow: hidden;
}
.wf-utilization-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

/* ─── Tabs row ──────────────────────────────────────────────────────── */
.fn-tabs {
  display: inline-flex; padding: 4px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.fn-tab {
  height: 32px; padding: 0 14px; border-radius: 7px;
  border: none; background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 13px; font-weight: 600;
  transition: all 0.15s;
}
.fn-tab:hover { color: rgb(var(--v-theme-on-surface)); }
.fn-tab--active {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

/* Operations list */
.fn-empty {
  text-align: center; padding: 48px 20px;
}
.fn-empty-icon { margin-bottom: 12px; }
.fn-empty-title {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.fn-empty-subtitle {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 4px;
}

.fn-transactions-list {
  display: flex; flex-direction: column;
}
.fn-transaction-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.fn-transaction-row:last-child { border-bottom: none; }
.fn-transaction-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
}
.fn-transaction-info { flex: 1; min-width: 0; }
.fn-transaction-title {
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}
.fn-op-badge {
  display: inline-block; font-size: 9px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.4px;
  padding: 1px 6px; border-radius: 4px; margin-left: 6px;
}
.fn-op-badge--manual { background: rgba(59,130,246,0.12); color: #3b82f6; }
.fn-transaction-meta {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}
.fn-transaction-amount {
  font-size: 14px; font-weight: 700;
  flex-shrink: 0;
}
.fn-transaction-amount--income { color: #10b981; }
.fn-transaction-amount--expense { color: #ef4444; }
.fn-op-link {
  width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-decoration: none;
  transition: all 0.15s;
}
.fn-op-link:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-on-surface));
}
.fn-load-more { text-align: center; margin-top: 12px; }
.fn-load-more-btn {
  background: transparent; border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  padding: 8px 16px; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.fn-load-more-btn:hover { border-color: #047857; color: #047857; }

/* Deals tab */
.cap-deals-list { display: flex; flex-direction: column; }
.cap-deal-row {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.cap-deal-row:last-child { border-bottom: none; }
.cap-deal-info { flex: 1; min-width: 0; }
.cap-deal-name { font-size: 14px; font-weight: 700; }
.cap-deal-link {
  color: rgb(var(--v-theme-on-surface));
  text-decoration: none;
}
.cap-deal-link:hover { color: #047857; }
.cap-deal-meta {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
  display: flex; gap: 8px;
}
.cap-deal-meta span:not(:last-child)::after {
  content: '·'; margin-left: 8px;
  color: rgba(var(--v-theme-on-surface), 0.3);
}
.cap-deal-numbers {
  display: flex; gap: 24px; flex-shrink: 0;
}
.cap-deal-num { text-align: right; }
.cap-deal-num-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
  color: rgba(var(--v-theme-on-surface), 0.5); font-weight: 600;
}
.cap-deal-num-value { font-size: 13px; font-weight: 700; margin-top: 2px; }


/* ─── Waterfall "Ручные операции" panel ──────────────────────────── */
.wf-panel-title {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
}
.wf-panel-add {
  display: inline-flex; align-items: center; gap: 4px;
  height: 26px; padding: 0 10px;
  border-radius: 7px;
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
  border: 1px solid rgba(59, 130, 246, 0.25);
  font-size: 11px; font-weight: 700;
  text-transform: none; letter-spacing: 0.2px;
  cursor: pointer;
  transition: all 0.15s;
}
.wf-panel-add:hover {
  background: rgba(59, 130, 246, 0.18);
  border-color: #3b82f6;
}

.wf-manual-list { display: flex; flex-direction: column; }
.wf-manual-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.wf-manual-row:last-child { border-bottom: none; }
.wf-manual-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
}
.wf-manual-info { flex: 1; min-width: 0; }
.wf-manual-title {
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wf-manual-meta {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}
.wf-manual-amount {
  font-size: 13px; font-weight: 700;
  flex-shrink: 0;
}
.wf-manual-icon-btn {
  width: 28px; height: 28px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}
.wf-manual-icon-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-on-surface));
}
.wf-manual-icon-btn--danger:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* ─── Operations tab toolbar (filters) ───────────────────────────── */
/* Mirrors the Касса tab (CashflowJournal.vue) for visual consistency. */
.cfj-filters {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.cfj-filter-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.cfj-filter-btn:hover {
  border-color: rgba(var(--v-theme-primary), 0.30);
  color: rgb(var(--v-theme-primary));
}
.cfj-filter-btn--active {
  border-color: rgba(4, 120, 87, 0.30);
  color: #047857;
}
.cfj-filter-caret { opacity: 0.4; }

.cfj-search-wrap { position: relative; display: inline-flex; align-items: center; }
.cfj-search-icon { position: absolute; left: 9px; color: rgba(var(--v-theme-on-surface), 0.35); pointer-events: none; }
.cfj-search {
  width: 180px;
  height: 30px;
  padding: 0 12px 0 28px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  outline: none; font-family: inherit;
}
.cfj-search:focus { border-color: rgb(var(--v-theme-primary)); }

.cfj-menu { min-width: 220px; padding: 4px; }
.cfj-menu-head {
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase; letter-spacing: 0.04em;
  padding: 8px 10px 4px;
}
.cfj-menu-item {
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
.cfj-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.cfj-menu-item--active { background: rgba(4, 120, 87, 0.06); color: #047857; font-weight: 600; }
.cfj-menu-item-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.cfj-menu-item-name { flex: 1; min-width: 0; }
.cfj-menu-item-check { color: currentColor; }
.cfj-menu-divider { height: 1px; background: rgba(var(--v-theme-on-surface), 0.06); margin: 4px 0; }
.cfj-menu-clear {
  width: 100%; padding: 8px 10px; border: none; background: transparent;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer; font-family: inherit; border-radius: 6px;
  text-align: center;
}
.cfj-menu-clear:hover { background: rgba(var(--v-theme-on-surface), 0.04); }

/* "Add" button uses the same compact pill style as filter-btn, but filled */
.cfj-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #047857;
  background: #047857;
  color: #fff;
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.cfj-add-btn:hover { background: #065f46; border-color: #065f46; }

/* ─── Dialogs (mirrors old finance.vue look) ─────────────────────── */
.fn-dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.fn-dialog-title {
  font-size: 17px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.fn-dialog-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.fn-dialog-close:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.fn-dialog-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

/* ── Type toggle (Доход/Расход pill) ── */
.fn-type-toggle {
  display: flex; gap: 0;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 10px; padding: 3px;
}
.fn-type-btn {
  flex: 1; padding: 10px 16px;
  border-radius: 8px; border: none;
  background: transparent; font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
  display: inline-flex; align-items: center; justify-content: center;
}
.fn-type-btn:hover { color: rgba(var(--v-theme-on-surface), 0.75); }
.fn-type-btn--active {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  font-weight: 600;
}
.fn-type-btn--income.fn-type-btn--active { background: #10b981; color: #fff; }
.fn-type-btn--expense.fn-type-btn--active { background: #ef4444; color: #fff; }

/* ── Form fields ── */
.fn-field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}
.fn-field-input {
  width: 100%; padding: 10px 14px;
  border-radius: 10px; border: 1px solid #e5e7eb;
  background: #f9fafb; font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: all 0.15s;
  font-family: inherit;
}
.fn-field-input:focus {
  border-color: #6366f1; background: #fff;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);
}
.fn-field-input-wrap { position: relative; }
.fn-field-input-wrap .fn-field-input { padding-right: 36px; }
.fn-field-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.fn-field-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='%239ca3af' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
  cursor: pointer;
}

/* Form-styled dropdown trigger (looks like fn-field-input, opens v-menu) */
.fn-field-select-btn {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 10px 12px 10px 14px;
  border-radius: 10px; border: 1px solid #e5e7eb;
  background: #f9fafb; font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit; text-align: left;
}
.fn-field-select-btn:hover {
  border-color: rgba(99, 102, 241, 0.4);
}
.fn-field-select-btn:focus-visible,
.fn-field-select-btn[aria-expanded="true"] {
  border-color: #6366f1; background: #fff;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);
}
.fn-field-select-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  flex-shrink: 0;
}
.fn-field-select-dot {
  width: 10px; height: 10px; border-radius: 50%;
  flex-shrink: 0;
}
.fn-field-select-value {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: 500;
}
.fn-field-select-value--placeholder {
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-weight: 400;
}
.fn-field-select-chevron {
  opacity: 0.5;
  flex-shrink: 0;
}

/* Menu shown by fn-field-select-btn — width matches the activator field.
   Vuetify's connected location-strategy already sets the overlay's min-width
   to the activator width by default; we override .cfj-menu's own min-width
   and stretch the inner v-card to fill that overlay width. */
.fn-select-menu {
  min-width: 0;
  width: 100%;
}
.cfj-menu-item-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px;
  flex-shrink: 0;
}
.cfj-menu-empty {
  padding: 12px 14px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4);
  text-align: center;
}

.fn-static-value {
  padding: 10px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

/* ── Color picker (category) ── */
.fn-color-picker { display: flex; gap: 8px; flex-wrap: wrap; }
.fn-color-dot {
  width: 28px; height: 28px; border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer; transition: all 0.15s;
  position: relative;
}
.fn-color-dot:hover { transform: scale(1.15); }
.fn-color-dot--active {
  border-color: rgba(var(--v-theme-on-surface), 0.3);
  box-shadow: 0 0 0 3px rgba(var(--v-theme-on-surface), 0.08);
}

/* ── Categories manager ── */
.fn-cat-section-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.fn-cat-section-title {
  font-size: 13px; font-weight: 600;
  display: flex; align-items: center;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.fn-cat-add-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px; border-radius: 7px;
  border: 1px solid #e5e7eb; background: transparent;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.fn-cat-add-btn:hover {
  border-color: #047857; color: #047857;
  background: rgba(4, 120, 87, 0.04);
}
.fn-cat-list { display: flex; flex-direction: column; gap: 6px; }
.fn-cat-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  transition: all 0.15s;
}
.fn-cat-row:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.18);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.fn-cat-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.fn-cat-name {
  flex: 1; font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.fn-cat-count {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  flex-shrink: 0;
  margin-right: 4px;
}
.fn-cat-empty {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.35);
  padding: 12px 14px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  text-align: center;
}

/* Locked type toggle in edit mode (existing categories can't change type) */
.fn-type-toggle--locked { opacity: 0.6; }
.fn-type-toggle--locked .fn-type-btn { cursor: not-allowed; }

/* ── Buttons ── */
.fn-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 9px 20px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.fn-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.fn-btn--primary { background: #047857; color: #fff; }
.fn-btn--primary:hover:not(:disabled) {
  background: #065f46;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}
.fn-btn--ghost {
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.5);
  border: 1px solid #e5e7eb;
}
.fn-btn--ghost:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.04); }
.fn-btn--danger { background: #ef4444; color: #fff; }
.fn-btn--danger:hover:not(:disabled) {
  background: #dc2626;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
}

/* ── Delete confirmation ── */
.fn-delete-icon {
  width: 72px; height: 72px; margin: 0 auto;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: rgba(239, 68, 68, 0.08);
}
.fn-delete-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.fn-delete-subtitle {
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.5);
}

/* ── Icon buttons (inline edit/delete in operations list, also +Category) ── */
.fn-icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; min-width: 32px;
  border-radius: 8px; border: none;
  background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.35);
  transition: all 0.15s;
  flex-shrink: 0;
}
.fn-icon-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.fn-icon-btn--danger:hover {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}
.fn-icon-btn--add {
  border: 1px solid #e5e7eb;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.fn-icon-btn--add:hover {
  border-color: #047857; color: #047857;
  background: rgba(4, 120, 87, 0.06);
}

/* ── Phase 2: waterfall CI section ── */
.wf-item--reserve {
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.2);
  cursor: default;
  padding: 10px 14px;
  border-radius: 10px;
}
.wf-item--reserve-danger {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}
.wf-item--reserve-danger .wf-item-value {
  color: #ef4444 !important;
}
.wf-reserve-warning {
  display: inline-flex; align-items: center; gap: 3px;
  margin-left: 6px;
  font-size: 10px; font-weight: 700;
  color: #ef4444;
  text-transform: uppercase; letter-spacing: 0.3px;
}

.wf-panel-link {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-decoration: none;
  text-transform: none;
  letter-spacing: 0;
}
.wf-panel-link:hover { color: #047857; }

.wf-ci-breakdown {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.1);
}
.wf-ci-breakdown-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase; letter-spacing: 0.4px;
}
.wf-ci-list { display: flex; flex-direction: column; gap: 6px; }
.wf-ci-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  transition: all 0.15s;
  text-decoration: none;
  color: inherit;
}
.wf-ci-row:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.18);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.wf-ci-arrow {
  opacity: 0.35;
  flex-shrink: 0;
}
.wf-ci-row:hover .wf-ci-arrow { opacity: 0.7; }
.wf-ci-pending {
  text-align: right;
  flex-shrink: 0;
}
.wf-ci-pending-val {
  font-size: 13px; font-weight: 700;
  color: #f59e0b;
  font-variant-numeric: tabular-nums;
}
.wf-ci-pending-label {
  font-size: 10px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 1px;
}
.wf-ci-mode {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 7px;
  border-radius: 5px;
  font-size: 10px; font-weight: 700;
  flex-shrink: 0;
  white-space: nowrap;
}
.wf-ci-mode--weight {
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
}
.wf-ci-mode--fixed {
  background: rgba(124, 58, 237, 0.1);
  color: #7c3aed;
}
.wf-ci-info { flex: 1; min-width: 0; }
.wf-ci-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wf-ci-name {
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}
.wf-ci-meta {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}

/* ───── Mobile ───── */
@media (max-width: 599px) {
  .cb-page { padding: 16px 12px; }

  /* Заголовок кассы — стекаем actions под именем. */
  .cb-header {
    flex-direction: column;
    align-items: stretch;
  }
  .cb-header-left { gap: 12px; }
  .cb-header-icon {
    width: 44px; height: 44px;
    border-radius: 12px;
  }
  .cb-header-title {
    font-size: 20px;
    word-break: break-word;
  }
  .cb-header-actions {
    flex-wrap: wrap;
  }
  .cb-action-btn {
    flex: 1 1 calc(50% - 4px);
    justify-content: center;
  }

  /* Waterfall — отступы и шрифты помельче. */
  .wf-title { font-size: 16px; }
  .wf-item { padding: 10px 12px; }
  .wf-item-value { font-size: 15px; }
  .wf-item-label { font-size: 11px; }
}
</style>
