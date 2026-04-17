<script lang="ts" setup>
import { api } from '@/api/client'
import { formatCurrency, formatCurrencyShort, formatDate, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useCapital } from '@/composables/useCapital'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const { isDark } = useIsDark()
const toast = useToast()
const { capital, isCapitalSet, fetchCapital, setInitialCapital } = useCapital()

// Capital setup
const showCapitalDialog = ref(false)
const capitalInput = ref(0)

function openCapitalDialog() {
  capitalInput.value = capital.value?.initialCapital || 0
  showCapitalDialog.value = true
}

async function saveCapital() {
  try {
    await setInitialCapital(capitalInput.value)
    showCapitalDialog.value = false
    toast.success('Капитал установлен')
    fetchCapitalDetails()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  }
}

const capitalUtilization = computed(() => {
  if (!capital.value || capital.value.totalCapital <= 0) return 0
  return Math.min(Math.round((capital.value.deployed / capital.value.totalCapital) * 100), 100)
})

// Capital details (operations, deals breakdown)
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
interface CapitalDeal {
  id: string
  productName: string
  client: string | null
  purchasePrice: number
  totalPrice: number
  markup: number
  received: number
  status: string
  progress: number
}

const capitalDetails = ref<{ deals: CapitalDeal[]; operations: CapitalOperation[]; coInvestors: any[] } | null>(null)
const detailsTab = ref<'operations' | 'deals'>('operations')
const showAllOps = ref(false)

async function fetchCapitalDetails() {
  try {
    const data = await api.get<any>('/finance/capital/details')
    capitalDetails.value = data
  } catch { /* silent */ }
}

const operationsIncome = computed(() => {
  if (!capitalDetails.value) return 0
  return capitalDetails.value.operations
    .filter(o => o.type === 'INCOME')
    .reduce((s, o) => s + o.amount, 0)
})

const operationsExpense = computed(() => {
  if (!capitalDetails.value) return 0
  return capitalDetails.value.operations
    .filter(o => o.type === 'EXPENSE')
    .reduce((s, o) => s + o.amount, 0)
})

const operationsPayout = computed(() => {
  if (!capitalDetails.value) return 0
  return capitalDetails.value.operations
    .filter(o => o.type === 'PAYOUT')
    .reduce((s, o) => s + o.amount, 0)
})

// ── Types ──

interface BalanceData {
  balance: number
  totalIncome: number
  totalExpense: number
  monthIncome: number
  monthExpense: number
}

interface ChartPoint {
  month: string
  income: number
  expense: number
}

interface Category {
  id: string
  name: string
  type: 'INCOME' | 'EXPENSE'
  icon?: string
  color?: string
  _count: { transactions: number }
}

interface Transaction {
  id: string
  type: 'INCOME' | 'EXPENSE'
  amount: number
  description?: string
  date: string
  category?: Category
  categoryId?: string
  createdAt: string
}

// ── State ──

const pageLoading = ref(true)
const balanceData = ref<BalanceData>({ balance: 0, totalIncome: 0, totalExpense: 0, monthIncome: 0, monthExpense: 0 })
const chartData = ref<ChartPoint[]>([])
const transactions = ref<Transaction[]>([])
const transactionsTotal = ref(0)
const categories = ref<Category[]>([])
const loadingMore = ref(false)

// Filters
const activeTab = ref<'ALL' | 'INCOME' | 'EXPENSE'>('ALL')
const searchQuery = ref('')
const transactionsLimit = 20
const transactionsOffset = ref(0)

// Transaction dialog
const showDialog = ref(false)
const dialogLoading = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  type: 'INCOME' as 'INCOME' | 'EXPENSE',
  amount: 0,
  description: '',
  categoryId: '',
  date: new Date().toISOString().slice(0, 10),
})

// Delete dialog
const deleteDialog = ref(false)
const deletingId = ref<string | null>(null)
const deleteLoading = ref(false)

// Category dialog
const showCategoryDialog = ref(false)
const categoryForm = ref({ name: '', type: 'INCOME' as 'INCOME' | 'EXPENSE', icon: '', color: '#6366f1' })
const categoryLoading = ref(false)

// Categories management
const showCategoriesManager = ref(false)
const deleteCategoryDialog = ref(false)
const deletingCategoryId = ref<string | null>(null)
const deleteCategoryLoading = ref(false)

// ── Colors ──

const INCOME_COLOR = '#10b981'
const EXPENSE_COLOR = '#ef4444'

const CATEGORY_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#3b82f6', '#0ea5e9',
  '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#047857',
]

// ── Fetch ──

async function fetchAll() {
  try {
    const [bal, chart, cats] = await Promise.all([
      api.get<BalanceData>('/finance/balance'),
      api.get<ChartPoint[]>('/finance/chart?months=6'),
      api.get<Category[]>('/finance/categories'),
    ])
    balanceData.value = bal
    chartData.value = chart
    categories.value = cats
    await fetchTransactions(true)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки данных')
  } finally {
    pageLoading.value = false
  }
}

async function fetchTransactions(reset = false) {
  if (reset) {
    transactionsOffset.value = 0
    transactions.value = []
  }
  try {
    const params = new URLSearchParams()
    if (activeTab.value !== 'ALL') params.set('type', activeTab.value)
    params.set('limit', String(transactionsLimit))
    params.set('offset', String(transactionsOffset.value))
    const result = await api.get<{ transactions: Transaction[]; total: number }>(
      `/finance/transactions?${params.toString()}`
    )
    if (reset) {
      transactions.value = result.transactions
    } else {
      transactions.value.push(...result.transactions)
    }
    transactionsTotal.value = result.total
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки операций')
  }
}

async function loadMore() {
  loadingMore.value = true
  transactionsOffset.value += transactionsLimit
  await fetchTransactions(false)
  loadingMore.value = false
}

onMounted(() => { fetchAll(); fetchCapital(); fetchCapitalDetails() })

// ── Watchers ──

watch(activeTab, () => fetchTransactions(true))

// ── Computed ──

const filteredTransactions = computed(() => {
  if (!searchQuery.value) return transactions.value
  const s = searchQuery.value.toLowerCase()
  return transactions.value.filter(
    (t) =>
      (t.description && t.description.toLowerCase().includes(s)) ||
      (t.category && t.category.name.toLowerCase().includes(s))
  )
})

const hasMore = computed(() => transactions.value.length < transactionsTotal.value)

const balanceIsPositive = computed(() => balanceData.value.balance >= 0)

const filteredCategories = computed(() => {
  return categories.value.filter((c) => c.type === form.value.type)
})

// ── Chart ──

const barChartData = computed(() => {
  return {
    labels: chartData.value.map((p) => p.month),
    datasets: [
      {
        label: 'Доходы',
        data: chartData.value.map((p) => p.income),
        backgroundColor: INCOME_COLOR + '50',
        borderColor: INCOME_COLOR,
        borderWidth: 2,
        borderRadius: 8,
      },
      {
        label: 'Расходы',
        data: chartData.value.map((p) => p.expense),
        backgroundColor: EXPENSE_COLOR + '50',
        borderColor: EXPENSE_COLOR,
        borderWidth: 2,
        borderRadius: 8,
      },
    ],
  }
})

const barOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: {
        usePointStyle: true,
        pointStyle: 'circle',
        padding: 16,
        font: { size: 12 },
        color: isDark.value ? '#a1a1aa' : '#6b7280',
      },
    },
    tooltip: {
      backgroundColor: isDark.value ? '#2e2e42' : '#1a1a2e',
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
      ticks: { color: isDark.value ? '#71717a' : '#9ca3af', font: { size: 12 } },
      border: { display: false },
    },
    y: {
      grid: { color: isDark.value ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
      ticks: {
        color: isDark.value ? '#71717a' : '#9ca3af',
        font: { size: 12 },
        callback: (v: any) => formatCurrencyShort(v),
      },
      border: { display: false },
    },
  },
}))

// ── Transaction CRUD ──

function openCreateTransaction() {
  editingId.value = null
  form.value = {
    type: activeTab.value === 'EXPENSE' ? 'EXPENSE' : 'INCOME',
    amount: 0,
    description: '',
    categoryId: '',
    date: new Date().toISOString().slice(0, 10),
  }
  showDialog.value = true
}

function openEditTransaction(t: Transaction) {
  editingId.value = t.id
  form.value = {
    type: t.type,
    amount: t.amount,
    description: t.description || '',
    categoryId: t.categoryId || '',
    date: t.date ? t.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
  }
  showDialog.value = true
}

async function saveTransaction() {
  if (!form.value.amount || form.value.amount <= 0) return toast.error('Укажите сумму')
  dialogLoading.value = true
  try {
    const body: any = {
      type: form.value.type,
      amount: Number(form.value.amount),
      description: form.value.description.trim() || undefined,
      categoryId: form.value.categoryId || undefined,
      date: form.value.date || undefined,
    }
    if (editingId.value) {
      await api.patch(`/finance/transactions/${editingId.value}`, body)
      toast.success('Операция обновлена')
    } else {
      await api.post('/finance/transactions', body)
      toast.success('Операция добавлена')
    }
    showDialog.value = false
    await Promise.all([fetchAll(), fetchCapitalDetails()])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  } finally {
    dialogLoading.value = false
  }
}

function confirmDelete(id: string) {
  deletingId.value = id
  deleteDialog.value = true
}

async function deleteTransaction() {
  if (!deletingId.value) return
  deleteLoading.value = true
  try {
    await api.delete(`/finance/transactions/${deletingId.value}`)
    toast.success('Операция удалена')
    deleteDialog.value = false
    await Promise.all([fetchAll(), fetchCapitalDetails()])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  } finally {
    deleteLoading.value = false
  }
}

// ── Category CRUD ──

function openCreateCategory() {
  categoryForm.value = { name: '', type: form.value.type, icon: '', color: CATEGORY_COLORS[0] }
  showCategoryDialog.value = true
}

async function saveCategory() {
  if (!categoryForm.value.name.trim()) return toast.error('Укажите название категории')
  categoryLoading.value = true
  try {
    const body = {
      name: categoryForm.value.name.trim(),
      type: categoryForm.value.type,
      icon: categoryForm.value.icon || undefined,
      color: categoryForm.value.color || undefined,
    }
    const created = await api.post<Category>('/finance/categories', body)
    categories.value.push(created)
    form.value.categoryId = created.id
    showCategoryDialog.value = false
    toast.success('Категория создана')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка создания категории')
  } finally {
    categoryLoading.value = false
  }
}

function confirmDeleteCategory(id: string) {
  deletingCategoryId.value = id
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

// ── Helpers ──

function getCategoryColor(t: Transaction) {
  return t.category?.color || (t.type === 'INCOME' ? INCOME_COLOR : EXPENSE_COLOR)
}

function formatTransactionAmount(t: Transaction) {
  const sign = t.type === 'INCOME' ? '+' : '-'
  return `${sign} ${formatCurrency(t.amount)}`
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
      <!-- Capital Section -->
      <div v-if="!isCapitalSet" class="cap-setup mb-6">
        <div class="cap-setup-icon">
          <v-icon icon="mdi-wallet-outline" size="28" />
        </div>
        <div class="cap-setup-content">
          <div class="cap-setup-title">Укажите начальный капитал</div>
          <div class="cap-setup-text">Для контроля доступных средств и автоматической проверки при создании сделок</div>
          <div class="cap-setup-form">
            <div class="cap-setup-input-wrap">
              <input
                v-maska="CURRENCY_MASK"
                :value="capitalInput || ''"
                class="cap-setup-input"
                type="text"
                inputmode="numeric"
                placeholder="1 000 000"
                @maska="capitalInput = parseMasked($event)"
              />
              <span class="cap-setup-suffix">₽</span>
            </div>
            <button class="cap-setup-btn" :disabled="capitalInput <= 0" @click="saveCapital">
              <v-icon icon="mdi-check" size="18" />
              Установить
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="capital" class="cap-hero mb-6">
        <div class="cap-hero-header">
          <div class="cap-hero-header-left">
            <div class="cap-hero-icon">
              <v-icon icon="mdi-wallet-outline" size="22" />
            </div>
            <div>
              <div class="cap-hero-title">Капитал</div>
              <div class="cap-hero-sub">Учёт средств по сделкам</div>
            </div>
          </div>
          <button class="cap-edit-btn" @click="openCapitalDialog">
            <v-icon icon="mdi-pencil-outline" size="16" />
          </button>
        </div>

        <div class="cap-metrics">
          <div class="cap-metric">
            <div class="cap-metric-value">{{ formatCurrencyShort(capital.totalCapital) }}</div>
            <div class="cap-metric-label">Общий капитал</div>
            <div v-if="capital.coInvestorCapital > 0" class="cap-metric-hint">
              {{ formatCurrencyShort(capital.initialCapital || 0) }} свои + {{ formatCurrencyShort(capital.coInvestorCapital) }} со-инвесторов
            </div>
          </div>
          <div class="cap-metric-divider" />
          <div class="cap-metric">
            <div class="cap-metric-value" style="color: #f59e0b;">{{ formatCurrencyShort(capital.deployed) }}</div>
            <div class="cap-metric-label">В сделках</div>
          </div>
          <div class="cap-metric-divider" />
          <div class="cap-metric">
            <div class="cap-metric-value" style="color: #10b981;">{{ formatCurrencyShort(capital.received) }}</div>
            <div class="cap-metric-label">Получено</div>
          </div>
          <div class="cap-metric-divider" />
          <div class="cap-metric cap-metric--main">
            <div class="cap-metric-value cap-metric-value--big">{{ formatCurrencyShort(capital.availableCapital) }}</div>
            <div class="cap-metric-label">Доступно</div>
          </div>
        </div>

        <!-- Utilization bar -->
        <div class="cap-utilization">
          <div class="cap-utilization-header">
            <span class="cap-utilization-label">
              Капитал в работе
              <v-tooltip location="top" max-width="280">
                <template #activator="{ props: tipProps }">
                  <v-icon v-bind="tipProps" icon="mdi-information-outline" size="13" class="cap-info-icon" />
                </template>
                Процент вашего капитала, задействованный в активных сделках. Чем выше — тем больше средств работает, но меньше свободных для новых сделок.
              </v-tooltip>
            </span>
            <span class="cap-utilization-percent">{{ capitalUtilization }}%</span>
          </div>
          <div class="cap-utilization-bar">
            <div class="cap-utilization-fill" :style="{ width: capitalUtilization + '%' }" />
          </div>
          <div v-if="capital.coInvestorPayout > 0" class="cap-payout-hint">
            <v-icon icon="mdi-account-group-outline" size="13" />
            Доля со-инвесторов: {{ formatCurrency(capital.coInvestorPayout) }}
          </div>
        </div>
      </div>

      <!-- Capital Edit Dialog -->
      <v-dialog v-model="showCapitalDialog" max-width="420">
        <v-card rounded="xl" class="pa-6">
          <div class="d-flex align-center ga-3 mb-4">
            <div class="cap-hero-icon">
              <v-icon icon="mdi-wallet-outline" size="20" />
            </div>
            <div>
              <div style="font-size: 16px; font-weight: 700;">Начальный капитал</div>
              <div style="font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);">Ваши собственные средства</div>
            </div>
          </div>
          <div class="cap-setup-input-wrap mb-4">
            <input
              v-maska="CURRENCY_MASK"
              :value="capitalInput || ''"
              class="cap-setup-input"
              type="text"
              inputmode="numeric"
              placeholder="0"
              @maska="capitalInput = parseMasked($event)"
            />
            <span class="cap-setup-suffix">₽</span>
          </div>
          <div class="d-flex ga-2 justify-end">
            <v-btn variant="text" @click="showCapitalDialog = false">Отмена</v-btn>
            <v-btn color="primary" variant="flat" @click="saveCapital">Сохранить</v-btn>
          </div>
        </v-card>
      </v-dialog>

      <!-- Capital Movement Summary -->
      <div v-if="isCapitalSet && capitalDetails" class="cap-movement mb-6">
        <div class="cap-movement-header">
          <div class="cap-movement-title">Движение средств</div>
          <div class="cap-movement-sub">Автоматически из сделок и платежей</div>
        </div>
        <div class="cap-movement-cards">
          <div class="cap-movement-card">
            <v-icon icon="mdi-arrow-bottom-left" size="18" style="color: #10b981;" />
            <div class="cap-movement-card-info">
              <div class="cap-movement-card-value" style="color: #10b981;">+{{ formatCurrency(operationsIncome) }}</div>
              <div class="cap-movement-card-label">Поступления</div>
            </div>
          </div>
          <div class="cap-movement-card">
            <v-icon icon="mdi-arrow-top-right" size="18" style="color: #ef4444;" />
            <div class="cap-movement-card-info">
              <div class="cap-movement-card-value" style="color: #ef4444;">-{{ formatCurrency(operationsExpense) }}</div>
              <div class="cap-movement-card-label">Закупки</div>
            </div>
          </div>
          <div v-if="operationsPayout > 0" class="cap-movement-card">
            <v-icon icon="mdi-account-arrow-right" size="18" style="color: #f59e0b;" />
            <div class="cap-movement-card-info">
              <div class="cap-movement-card-value" style="color: #f59e0b;">-{{ formatCurrency(operationsPayout) }}</div>
              <div class="cap-movement-card-label">Со-инвесторам</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Operations & Deals -->
      <v-card v-if="isCapitalSet && capitalDetails" rounded="lg" elevation="0" border class="mb-6">
        <div class="pa-4">
          <!-- Header with tabs and actions -->
          <div class="d-flex align-center ga-3 mb-4 flex-wrap">
            <div class="fn-tabs">
              <button class="fn-tab" :class="{ 'fn-tab--active': detailsTab === 'operations' }" @click="detailsTab = 'operations'">
                Все операции
              </button>
              <button class="fn-tab" :class="{ 'fn-tab--active': detailsTab === 'deals' }" @click="detailsTab = 'deals'">
                По сделкам
              </button>
            </div>

            <v-spacer />

            <button class="fn-categories-btn" @click="showCategoriesManager = true">
              <v-icon icon="mdi-tag-multiple-outline" size="16" />
              <span class="d-none d-sm-inline">Категории</span>
            </button>

            <button class="fn-add-btn" @click="openCreateTransaction">
              <v-icon icon="mdi-plus" size="18" />
              <span class="d-none d-sm-inline">Добавить операцию</span>
              <span class="d-sm-none">Добавить</span>
            </button>
          </div>

          <!-- Operations list (unified: auto + manual) -->
          <template v-if="detailsTab === 'operations'">
            <div v-if="capitalDetails.operations.length === 0" class="fn-empty">
              <div class="fn-empty-icon"><v-icon icon="mdi-wallet-outline" size="48" color="grey" /></div>
              <div class="fn-empty-title">Нет операций</div>
              <div class="fn-empty-subtitle">Создайте сделку или добавьте операцию вручную</div>
            </div>

            <div v-else class="fn-transactions-list">
              <div v-for="(op, i) in capitalDetails.operations.slice(0, showAllOps ? undefined : 30)" :key="op.transactionId || `auto-${i}`" class="fn-transaction-row">
                <!-- Color dot -->
                <div class="fn-transaction-dot" :style="{
                  background: op.isManual
                    ? (op.category?.color || (op.type === 'INCOME' ? '#10b981' : '#ef4444'))
                    : op.type === 'INCOME' ? '#10b981' : op.type === 'PAYOUT' ? '#f59e0b' : '#ef4444'
                }" />

                <!-- Info -->
                <div class="fn-transaction-info">
                  <div class="fn-transaction-title">
                    {{ op.description }}
                    <span v-if="op.isManual" class="fn-op-badge fn-op-badge--manual">Вручную</span>
                    <span v-else-if="op.type === 'PAYOUT'" class="fn-op-badge fn-op-badge--payout">Со-инвестор</span>
                  </div>
                  <div class="fn-transaction-meta">
                    <span v-if="op.isManual && op.category">{{ op.category.name }} · </span>
                    <span>{{ formatDate(op.date) }}</span>
                  </div>
                </div>

                <!-- Amount -->
                <div class="fn-transaction-amount" :class="{
                  'fn-transaction-amount--income': op.type === 'INCOME',
                  'fn-transaction-amount--expense': op.type !== 'INCOME',
                }">
                  {{ op.type === 'INCOME' ? '+' : '-' }}{{ formatCurrency(op.amount) }}
                </div>

                <!-- Actions -->
                <template v-if="op.isManual && op.transactionId">
                  <div class="fn-transaction-actions">
                    <button class="fn-icon-btn" @click="openEditTransaction({ id: op.transactionId, type: op.type, amount: op.amount, description: op.description, date: op.date, categoryId: op.category?.id } as any)">
                      <v-icon icon="mdi-pencil-outline" size="16" />
                    </button>
                    <button class="fn-icon-btn fn-icon-btn--danger" @click="confirmDelete(op.transactionId)">
                      <v-icon icon="mdi-delete-outline" size="16" />
                    </button>
                  </div>
                </template>
                <template v-else-if="op.dealId">
                  <router-link :to="`/deals/${op.dealId}`" class="fn-op-link">
                    <v-icon icon="mdi-open-in-new" size="14" />
                  </router-link>
                </template>
              </div>
            </div>
            <div v-if="!showAllOps && capitalDetails.operations.length > 30" class="fn-load-more">
              <button class="fn-load-more-btn" @click="showAllOps = true">
                Показать все ({{ capitalDetails.operations.length }})
              </button>
            </div>
          </template>

          <!-- Deals breakdown -->
          <template v-if="detailsTab === 'deals'">
            <div v-if="capitalDetails.deals.length === 0" class="fn-empty">
              <div class="fn-empty-icon"><v-icon icon="mdi-handshake-outline" size="48" color="grey" /></div>
              <div class="fn-empty-title">Нет сделок</div>
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
                    <span class="cap-deal-num-label">Закупка</span>
                    <span class="cap-deal-num-value" style="color: #ef4444;">{{ formatCurrency(deal.purchasePrice) }}</span>
                  </div>
                  <div class="cap-deal-num">
                    <span class="cap-deal-num-label">Получено</span>
                    <span class="cap-deal-num-value" style="color: #10b981;">{{ formatCurrency(deal.received) }}</span>
                  </div>
                  <div class="cap-deal-num">
                    <span class="cap-deal-num-label">Наценка</span>
                    <span class="cap-deal-num-value">{{ formatCurrency(deal.markup) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </v-card>

      <!-- Empty state when no capital and no operations -->
      <div v-if="!isCapitalSet && !capitalDetails" /><!-- nothing -->
    </template>

    <!-- ── Create/Edit Transaction Dialog ── -->
    <v-dialog v-model="showDialog" max-width="520" persistent>
      <v-card rounded="lg" elevation="0">
        <div class="fn-dialog-header">
          <div class="fn-dialog-title">
            {{ editingId ? 'Редактировать операцию' : 'Новая операция' }}
          </div>
          <button class="fn-dialog-close" @click="showDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <!-- Type toggle -->
          <div class="fn-type-toggle mb-5">
            <button
              class="fn-type-btn"
              :class="{ 'fn-type-btn--active fn-type-btn--income': form.type === 'INCOME' }"
              @click="form.type = 'INCOME'; form.categoryId = ''"
            >
              <v-icon icon="mdi-arrow-down" size="16" class="mr-1" />
              Доход
            </button>
            <button
              class="fn-type-btn"
              :class="{ 'fn-type-btn--active fn-type-btn--expense': form.type === 'EXPENSE' }"
              @click="form.type = 'EXPENSE'; form.categoryId = ''"
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
                :value="form.amount || ''"
                v-maska="CURRENCY_MASK"
                @maska="(e: any) => form.amount = parseMasked(e)"
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
              v-model="form.description"
              type="text"
              placeholder="Краткое описание операции"
              class="fn-field-input"
            />
          </div>

          <!-- Category -->
          <div class="mb-4">
            <label class="fn-field-label">Категория</label>
            <div class="d-flex ga-2 align-center">
              <select v-model="form.categoryId" class="fn-field-input fn-field-select">
                <option value="">Без категории</option>
                <option v-for="cat in filteredCategories" :key="cat.id" :value="cat.id">
                  {{ cat.name }}
                </option>
              </select>
              <button class="fn-icon-btn fn-icon-btn--add" @click="openCreateCategory" title="Новая категория">
                <v-icon icon="mdi-plus" size="18" />
              </button>
            </div>
          </div>

          <!-- Date -->
          <div class="mb-2">
            <label class="fn-field-label">Дата</label>
            <input
              v-model="form.date"
              type="date"
              class="fn-field-input"
            />
          </div>
        </div>

        <div class="fn-dialog-actions">
          <button class="fn-btn fn-btn--ghost" @click="showDialog = false">Отмена</button>
          <button
            class="fn-btn fn-btn--primary"
            :disabled="dialogLoading"
            @click="saveTransaction"
          >
            <v-progress-circular v-if="dialogLoading" indeterminate size="16" width="2" class="mr-2" color="white" />
            {{ editingId ? 'Сохранить' : 'Добавить' }}
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- ── Create Category Dialog ── -->
    <v-dialog v-model="showCategoryDialog" max-width="420" persistent>
      <v-card rounded="lg" elevation="0">
        <div class="fn-dialog-header">
          <div class="fn-dialog-title">Новая категория</div>
          <button class="fn-dialog-close" @click="showCategoryDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <!-- Type -->
          <div class="fn-type-toggle mb-4">
            <button
              class="fn-type-btn"
              :class="{ 'fn-type-btn--active fn-type-btn--income': categoryForm.type === 'INCOME' }"
              @click="categoryForm.type = 'INCOME'"
            >
              Доход
            </button>
            <button
              class="fn-type-btn"
              :class="{ 'fn-type-btn--active fn-type-btn--expense': categoryForm.type === 'EXPENSE' }"
              @click="categoryForm.type = 'EXPENSE'"
            >
              Расход
            </button>
          </div>

          <!-- Name -->
          <div class="mb-4">
            <label class="fn-field-label">Название *</label>
            <input
              v-model="categoryForm.name"
              type="text"
              placeholder="Например: Аренда"
              class="fn-field-input"
            />
          </div>

          <!-- Color -->
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
            Создать
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- ── Categories Manager Dialog ── -->
    <v-dialog v-model="showCategoriesManager" max-width="520">
      <v-card rounded="lg" elevation="0">
        <div class="fn-dialog-header">
          <div class="fn-dialog-title">Категории</div>
          <button class="fn-dialog-close" @click="showCategoriesManager = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <!-- Income categories -->
          <div class="mb-5">
            <div class="fn-cat-section-title" style="color: #10b981;">
              <v-icon icon="mdi-arrow-down" size="16" class="mr-1" />
              Доходы
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
                <button
                  class="fn-icon-btn fn-icon-btn--danger"
                  @click="confirmDeleteCategory(cat.id)"
                >
                  <v-icon icon="mdi-delete-outline" size="15" />
                </button>
              </div>
              <div
                v-if="!categories.filter((c) => c.type === 'INCOME').length"
                class="fn-cat-empty"
              >
                Нет категорий доходов
              </div>
            </div>
          </div>

          <!-- Expense categories -->
          <div>
            <div class="fn-cat-section-title" style="color: #ef4444;">
              <v-icon icon="mdi-arrow-up" size="16" class="mr-1" />
              Расходы
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
                <button
                  class="fn-icon-btn fn-icon-btn--danger"
                  @click="confirmDeleteCategory(cat.id)"
                >
                  <v-icon icon="mdi-delete-outline" size="15" />
                </button>
              </div>
              <div
                v-if="!categories.filter((c) => c.type === 'EXPENSE').length"
                class="fn-cat-empty"
              >
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
    <v-dialog v-model="deleteDialog" max-width="400" persistent>
      <v-card rounded="lg" elevation="0" class="pa-5 text-center">
        <div class="fn-delete-icon mb-4">
          <v-icon icon="mdi-delete-outline" size="32" color="error" />
        </div>
        <div class="fn-delete-title mb-2">Удалить операцию?</div>
        <div class="fn-delete-subtitle mb-5">Это действие нельзя отменить</div>
        <div class="d-flex justify-center ga-3">
          <button class="fn-btn fn-btn--ghost" @click="deleteDialog = false">Отмена</button>
          <button
            class="fn-btn fn-btn--danger"
            :disabled="deleteLoading"
            @click="deleteTransaction"
          >
            <v-progress-circular v-if="deleteLoading" indeterminate size="16" width="2" class="mr-2" color="white" />
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
          <button
            class="fn-btn fn-btn--danger"
            :disabled="deleteCategoryLoading"
            @click="deleteCategory"
          >
            <v-progress-circular v-if="deleteCategoryLoading" indeterminate size="16" width="2" class="mr-2" color="white" />
            Удалить
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* ── Balance Hero ── */
.fn-balance-hero {
  border-radius: 16px;
  padding: 2px;
  transition: all 0.3s;
}
.fn-balance-hero--positive {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.03));
}
.fn-balance-hero--negative {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.03));
}
.fn-balance-hero-inner {
  background: #fff;
  border-radius: 15px;
  padding: 28px 32px;
  border: 1px solid #e5e7eb;
}
.fn-balance-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.fn-balance-amount {
  font-size: 36px; font-weight: 800;
  line-height: 1.2; margin-bottom: 20px;
  letter-spacing: -0.5px;
}
.fn-balance-stats {
  display: flex; align-items: center; gap: 0;
  flex-wrap: wrap;
}
.fn-balance-stat {
  flex: 1; min-width: 120px;
  padding: 0 16px;
}
.fn-balance-stat:first-child { padding-left: 0; }
.fn-balance-stat:last-child { padding-right: 0; }
.fn-balance-stat-value {
  font-size: 18px; font-weight: 700;
  line-height: 1.3;
}
.fn-balance-stat-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.fn-balance-stat-divider {
  width: 1px; height: 36px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  flex-shrink: 0;
}

@media (max-width: 700px) {
  .fn-balance-amount { font-size: 28px; }
  .fn-balance-stats { gap: 12px; }
  .fn-balance-stat { padding: 0; min-width: calc(50% - 12px); }
  .fn-balance-stat-divider { display: none; }
  .fn-balance-hero-inner { padding: 20px; }
}

/* ── Chart ── */
.chart-title {
  font-size: 16px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.chart-subtitle {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* ── Tabs ── */
.fn-tabs {
  display: flex; gap: 4px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 10px; padding: 3px;
}
.fn-tab {
  padding: 7px 16px; border-radius: 8px; border: none;
  background: transparent; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.fn-tab:hover {
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.fn-tab--active {
  background: #fff; color: rgba(var(--v-theme-on-surface), 0.85);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  font-weight: 600;
}
.fn-tab--active.fn-tab--income {
  color: #10b981;
}
.fn-tab--active.fn-tab--expense {
  color: #ef4444;
}

/* ── Filter input (reuse pattern) ── */
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

/* ── Buttons ── */
.fn-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 18px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.fn-add-btn:hover {
  background: #065f46;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}

.fn-categories-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 14px; border-radius: 10px;
  border: 1px solid #e5e7eb; background: transparent;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.fn-categories-btn:hover {
  border-color: #6366f1; color: #6366f1;
  background: rgba(99, 102, 241, 0.04);
}

.fn-icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; min-width: 32px;
  border-radius: 8px; border: none;
  background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.35);
  transition: all 0.15s;
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
  flex-shrink: 0;
}
.fn-icon-btn--add:hover {
  border-color: #047857; color: #047857;
  background: rgba(4, 120, 87, 0.06);
}

/* ── Empty state ── */
.fn-empty {
  padding: 48px 20px; text-align: center;
}
.fn-empty-icon {
  width: 80px; height: 80px; margin: 0 auto 16px;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.fn-empty-title {
  font-size: 16px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 4px;
}
.fn-empty-subtitle {
  font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* ── Transactions list ── */
.fn-transactions-list {
  display: flex; flex-direction: column; gap: 4px;
}
.fn-transaction-row {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; border-radius: 10px;
  transition: background 0.15s;
}
.fn-transaction-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.fn-transaction-dot {
  width: 10px; height: 10px; min-width: 10px;
  border-radius: 50%; flex-shrink: 0;
}
.fn-transaction-info {
  flex: 1; min-width: 0;
}
.fn-transaction-title {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fn-transaction-meta {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.fn-transaction-category {
  font-weight: 500;
}
.fn-transaction-amount {
  font-size: 15px; font-weight: 700;
  white-space: nowrap; flex-shrink: 0;
}
.fn-transaction-amount--income {
  color: #10b981;
}
.fn-transaction-amount--expense {
  color: #ef4444;
}
.fn-transaction-actions {
  display: flex; gap: 2px; flex-shrink: 0;
}

@media (max-width: 600px) {
  .fn-transaction-row { flex-wrap: wrap; gap: 8px; }
  .fn-transaction-info { min-width: calc(100% - 30px); }
  .fn-transaction-amount { margin-left: 24px; }
  .fn-transaction-actions { margin-left: auto; }
}

/* ── Load more ── */
.fn-load-more {
  display: flex; justify-content: center;
  padding: 16px 0 8px;
}
.fn-load-more-btn {
  display: inline-flex; align-items: center;
  padding: 9px 24px; border-radius: 10px;
  border: 1px solid #e5e7eb; background: transparent;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.fn-load-more-btn:hover:not(:disabled) {
  border-color: #047857; color: #047857;
  background: rgba(4, 120, 87, 0.04);
}
.fn-load-more-btn:disabled {
  opacity: 0.6; cursor: not-allowed;
}

/* ── Dialog ── */
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
.fn-dialog-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.fn-dialog-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

/* ── Type toggle ── */
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
.fn-type-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.fn-type-btn--active {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  font-weight: 600;
}
.fn-type-btn--income.fn-type-btn--active {
  background: #10b981; color: #fff;
}
.fn-type-btn--expense.fn-type-btn--active {
  background: #ef4444; color: #fff;
}

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
}
.fn-field-input:focus {
  border-color: #6366f1; background: #fff;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);
}
.fn-field-input-wrap {
  position: relative;
}
.fn-field-input-wrap .fn-field-input {
  padding-right: 36px;
}
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

/* ── Color picker ── */
.fn-color-picker {
  display: flex; gap: 8px; flex-wrap: wrap;
}
.fn-color-dot {
  width: 28px; height: 28px; border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer; transition: all 0.15s;
  position: relative;
}
.fn-color-dot:hover {
  transform: scale(1.15);
}
.fn-color-dot--active {
  border-color: rgba(var(--v-theme-on-surface), 0.3);
  box-shadow: 0 0 0 3px rgba(var(--v-theme-on-surface), 0.08);
}

/* ── Categories manager ── */
.fn-cat-section-title {
  font-size: 13px; font-weight: 600;
  display: flex; align-items: center;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.fn-cat-list {
  display: flex; flex-direction: column; gap: 4px;
}
.fn-cat-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 8px;
  transition: background 0.15s;
}
.fn-cat-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.fn-cat-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.fn-cat-name {
  flex: 1; font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.fn-cat-count {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  flex-shrink: 0;
}
.fn-cat-empty {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.35);
  padding: 12px 0;
}

/* ── Buttons ── */
.fn-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 9px 20px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.fn-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.fn-btn--primary {
  background: #047857; color: #fff;
}
.fn-btn--primary:hover:not(:disabled) {
  background: #065f46;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}
.fn-btn--ghost {
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.5);
  border: 1px solid #e5e7eb;
}
.fn-btn--ghost:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.fn-btn--danger {
  background: #ef4444; color: #fff;
}
.fn-btn--danger:hover:not(:disabled) {
  background: #dc2626;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
}

/* ── Delete dialog ── */
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

/* ── Dark mode ── */
.dark .fn-balance-hero--positive {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.02));
}
.dark .fn-balance-hero--negative {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.02));
}
.dark .fn-balance-hero-inner {
  background: #1e1e2e; border-color: #2e2e42;
}
.dark .fn-tabs {
  background: rgba(255, 255, 255, 0.04);
}
.dark .fn-tab--active {
  background: #2e2e42; color: #e4e4e7;
}
.dark .fn-tab--active.fn-tab--income { color: #10b981; }
.dark .fn-tab--active.fn-tab--expense { color: #ef4444; }

.dark .filter-input {
  background: #252538; border-color: #2e2e42; color: #e4e4e7;
}
.dark .filter-input::placeholder { color: #71717a; }
.dark .filter-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}

.dark .fn-field-input {
  background: #252538; border-color: #2e2e42; color: #e4e4e7;
}
.dark .fn-field-input:focus {
  border-color: #6366f1; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #6366f1 15%, transparent);
}
.dark .fn-field-select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='%2371717a' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
}

.dark .fn-categories-btn {
  border-color: #2e2e42; color: #a1a1aa;
}
.dark .fn-categories-btn:hover {
  border-color: #6366f1; color: #6366f1;
  background: rgba(99, 102, 241, 0.08);
}

.dark .fn-load-more-btn {
  border-color: #2e2e42; color: #a1a1aa;
}
.dark .fn-load-more-btn:hover:not(:disabled) {
  border-color: #047857; color: #10b981;
  background: rgba(4, 120, 87, 0.08);
}

.dark .fn-icon-btn--add {
  border-color: #2e2e42; color: #a1a1aa;
}
.dark .fn-icon-btn--add:hover {
  border-color: #047857; color: #10b981;
}

.dark .fn-transaction-row:hover {
  background: rgba(255, 255, 255, 0.03);
}
.dark .fn-cat-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.dark .fn-btn--ghost {
  border-color: #2e2e42; color: #a1a1aa;
}
.dark .fn-btn--ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.04);
}

.dark .fn-dialog-header {
  border-bottom-color: #2e2e42;
}
.dark .fn-dialog-actions {
  border-top-color: #2e2e42;
}

.dark .fn-type-toggle {
  background: rgba(255, 255, 255, 0.04);
}

/* ─── Capital Setup ─── */
.cap-setup {
  display: flex; gap: 20px; padding: 24px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.06) 0%, rgba(124, 58, 237, 0.02) 100%);
  border: 1px solid rgba(124, 58, 237, 0.12);
}
.cap-setup-icon {
  width: 56px; height: 56px; min-width: 56px; border-radius: 16px;
  background: rgba(124, 58, 237, 0.1); color: #7c3aed;
  display: flex; align-items: center; justify-content: center;
}
.cap-setup-content { flex: 1; }
.cap-setup-title {
  font-size: 17px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 4px;
}
.cap-setup-text {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 16px; line-height: 1.4;
}
.cap-setup-form { display: flex; gap: 10px; align-items: center; }
.cap-setup-input-wrap { position: relative; flex: 1; max-width: 280px; }
.cap-setup-input {
  width: 100%; height: 44px; padding: 0 36px 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 15px; font-weight: 600;
  color: inherit; background: rgba(var(--v-theme-on-surface), 0.03);
  outline: none; transition: all 0.15s;
}
.cap-setup-input:focus {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
}
.cap-setup-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.25); font-weight: 400; }
.cap-setup-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.3);
  pointer-events: none;
}
.cap-setup-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 44px; padding: 0 20px; border-radius: 10px; border: none;
  background: #7c3aed; color: #fff;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.cap-setup-btn:hover { background: #6d28d9; }
.cap-setup-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ─── Capital Hero ─── */
.cap-hero {
  border-radius: 16px; overflow: hidden;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.cap-hero-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.cap-hero-header-left { display: flex; align-items: center; gap: 12px; }
.cap-hero-icon {
  width: 42px; height: 42px; min-width: 42px; border-radius: 12px;
  background: rgba(124, 58, 237, 0.1); color: #7c3aed;
  display: flex; align-items: center; justify-content: center;
}
.cap-hero-title {
  font-size: 16px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.cap-hero-sub {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 1px;
}
.cap-edit-btn {
  width: 34px; height: 34px; border-radius: 9px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.4);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.cap-edit-btn:hover { background: rgba(124, 58, 237, 0.1); color: #7c3aed; }

.cap-metrics {
  display: flex; align-items: stretch;
  padding: 20px 24px;
}
.cap-metric {
  flex: 1; text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.cap-metric--main { background: rgba(124, 58, 237, 0.04); border-radius: 12px; padding: 12px; margin: -8px 0; }
.cap-metric-value {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.cap-metric-value--big { font-size: 22px; color: #7c3aed; }
.cap-metric-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.35);
  margin-top: 2px;
}
.cap-metric-hint {
  font-size: 10px; color: rgba(var(--v-theme-on-surface), 0.3);
  margin-top: 3px;
}
.cap-metric-divider {
  width: 1px; background: rgba(var(--v-theme-on-surface), 0.06);
  margin: 0 12px; align-self: stretch;
}

.cap-utilization {
  padding: 14px 24px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.cap-utilization-header {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 8px;
}
.cap-utilization-label { display: flex; align-items: center; gap: 4px; }
.cap-info-icon {
  color: rgba(var(--v-theme-on-surface), 0.25);
  cursor: help; transition: color 0.12s;
}
.cap-info-icon:hover { color: rgba(var(--v-theme-on-surface), 0.5); }
.cap-utilization-percent { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.6); }
.cap-utilization-bar {
  height: 6px; border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  overflow: hidden;
}
.cap-utilization-fill {
  height: 100%; border-radius: 3px;
  background: linear-gradient(90deg, #7c3aed, #a855f7);
  transition: width 0.5s ease;
}
.cap-payout-hint {
  display: flex; align-items: center; gap: 5px;
  margin-top: 10px; font-size: 11px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.35);
}

/* Dark overrides */
.dark .cap-setup {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.1) 0%, rgba(124, 58, 237, 0.04) 100%);
  border-color: rgba(124, 58, 237, 0.2);
}
.dark .cap-setup-input { background: #1e1e2e; border-color: #2e2e42; color: #e4e4e7; }
.dark .cap-setup-input:focus { border-color: #7c3aed; background: #252538; }
.dark .cap-hero { background: #1e1e2e; border-color: #2e2e42; }
.dark .cap-hero-header { border-color: rgba(255,255,255,0.06); }
.dark .cap-utilization { border-color: rgba(255,255,255,0.06); }
.dark .cap-utilization-bar { background: rgba(255,255,255,0.06); }
.dark .cap-metric-divider { background: rgba(255,255,255,0.06); }
.dark .cap-metric--main { background: rgba(124, 58, 237, 0.08); }

@media (max-width: 700px) {
  .cap-setup { flex-direction: column; }
  .cap-setup-form { flex-direction: column; }
  .cap-setup-input-wrap { max-width: 100%; }
  .cap-metrics { flex-wrap: wrap; gap: 12px; }
  .cap-metric-divider { display: none; }
  .cap-metric { min-width: 40%; }
}

/* ─── Capital Movement Summary ─── */
.cap-movement {
  border-radius: 14px; padding: 20px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.cap-movement-header { margin-bottom: 16px; }
.cap-movement-title {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.cap-movement-sub {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 1px;
}
.cap-movement-cards {
  display: flex; gap: 12px;
}
.cap-movement-card {
  flex: 1; display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.cap-movement-card-info { flex: 1; }
.cap-movement-card-value {
  font-size: 16px; font-weight: 700;
}
.cap-movement-card-label {
  font-size: 11px; font-weight: 500; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.35);
  margin-top: 1px;
}

/* ─── Operation badges ─── */
.fn-op-badge {
  display: inline-flex; padding: 1px 6px; border-radius: 4px;
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.03em; margin-left: 6px; vertical-align: middle;
}
.fn-op-badge--manual { background: rgba(99, 102, 241, 0.1); color: #6366f1; }
.fn-op-badge--payout { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }

/* ─── Auto Operations ─── */
.fn-op-link {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; min-width: 28px; border-radius: 7px;
  color: rgba(var(--v-theme-on-surface), 0.25);
  transition: all 0.12s;
}
.fn-op-link:hover { background: rgba(var(--v-theme-primary), 0.08); color: rgb(var(--v-theme-primary)); }

/* ─── Deals breakdown ─── */
.cap-deals-list { display: flex; flex-direction: column; gap: 0; }
.cap-deal-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
  gap: 16px;
}
.cap-deal-row:last-child { border-bottom: none; }
.cap-deal-info { flex: 1; min-width: 0; }
.cap-deal-name {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.cap-deal-link { color: inherit; text-decoration: none; }
.cap-deal-link:hover { color: rgb(var(--v-theme-primary)); }
.cap-deal-meta {
  display: flex; gap: 8px; margin-top: 2px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.cap-deal-numbers {
  display: flex; gap: 20px; flex-shrink: 0;
}
.cap-deal-num { text-align: right; }
.cap-deal-num-label {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.3);
}
.cap-deal-num-value {
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* Dark overrides */
.dark .cap-movement { background: #1e1e2e; border-color: #2e2e42; }
.dark .cap-movement-card { background: rgba(255,255,255,0.04); }
.dark .cap-deal-row { border-color: rgba(255,255,255,0.05); }

@media (max-width: 600px) {
  .cap-movement-cards { flex-direction: column; }
  .cap-deal-row { flex-direction: column; align-items: flex-start; }
  .cap-deal-numbers { width: 100%; justify-content: space-between; margin-top: 8px; }
}
</style>
