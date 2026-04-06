<script lang="ts" setup>
import { api } from '@/api/client'
import { formatCurrency, formatCurrencyShort, formatDate } from '@/utils/formatters'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const { isDark } = useIsDark()
const toast = useToast()

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

onMounted(fetchAll)

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
    pageLoading.value = true
    await fetchAll()
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
    pageLoading.value = true
    await fetchAll()
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
      <!-- Balance Hero Card -->
      <div
        class="fn-balance-hero mb-6"
        :class="balanceIsPositive ? 'fn-balance-hero--positive' : 'fn-balance-hero--negative'"
      >
        <div class="fn-balance-hero-inner">
          <div class="fn-balance-label">Текущий баланс</div>
          <div
            class="fn-balance-amount"
            :style="{ color: balanceIsPositive ? INCOME_COLOR : EXPENSE_COLOR }"
          >
            {{ formatCurrency(balanceData.balance) }}
          </div>
          <div class="fn-balance-stats">
            <div class="fn-balance-stat">
              <div class="fn-balance-stat-value" style="color: #10b981;">
                {{ formatCurrency(balanceData.totalIncome) }}
              </div>
              <div class="fn-balance-stat-label">Всего доходов</div>
            </div>
            <div class="fn-balance-stat-divider"></div>
            <div class="fn-balance-stat">
              <div class="fn-balance-stat-value" style="color: #ef4444;">
                {{ formatCurrency(balanceData.totalExpense) }}
              </div>
              <div class="fn-balance-stat-label">Всего расходов</div>
            </div>
            <div class="fn-balance-stat-divider"></div>
            <div class="fn-balance-stat">
              <div class="fn-balance-stat-value" style="color: #10b981;">
                {{ formatCurrency(balanceData.monthIncome) }}
              </div>
              <div class="fn-balance-stat-label">Доход за месяц</div>
            </div>
            <div class="fn-balance-stat-divider"></div>
            <div class="fn-balance-stat">
              <div class="fn-balance-stat-value" style="color: #ef4444;">
                {{ formatCurrency(balanceData.monthExpense) }}
              </div>
              <div class="fn-balance-stat-label">Расход за месяц</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Chart -->
      <v-card v-if="chartData.length > 0" rounded="lg" elevation="0" border class="pa-5 mb-6">
        <div class="d-flex align-center justify-space-between mb-4">
          <div>
            <div class="chart-title">Доходы и расходы</div>
            <div class="chart-subtitle">За последние 6 месяцев</div>
          </div>
        </div>
        <div style="height: 280px;">
          <Bar :data="barChartData" :options="barOptions" />
        </div>
      </v-card>

      <!-- Transactions Card -->
      <v-card rounded="lg" elevation="0" border>
        <div class="pa-4">
          <!-- Header -->
          <div class="d-flex align-center ga-3 mb-4 flex-wrap">
            <!-- Filter tabs -->
            <div class="fn-tabs">
              <button
                class="fn-tab"
                :class="{ 'fn-tab--active': activeTab === 'ALL' }"
                @click="activeTab = 'ALL'"
              >
                Все
              </button>
              <button
                class="fn-tab"
                :class="{ 'fn-tab--active': activeTab === 'INCOME', 'fn-tab--income': activeTab === 'INCOME' }"
                @click="activeTab = 'INCOME'"
              >
                Доходы
              </button>
              <button
                class="fn-tab"
                :class="{ 'fn-tab--active': activeTab === 'EXPENSE', 'fn-tab--expense': activeTab === 'EXPENSE' }"
                @click="activeTab = 'EXPENSE'"
              >
                Расходы
              </button>
            </div>

            <div class="filter-input-wrap" style="max-width: 300px;">
              <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
              <input
                v-model="searchQuery"
                type="text"
                placeholder="Поиск по описанию..."
                class="filter-input"
              />
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

          <!-- Transactions list -->
          <div v-if="!filteredTransactions.length" class="fn-empty">
            <div class="fn-empty-icon">
              <v-icon icon="mdi-wallet-outline" size="48" color="grey" />
            </div>
            <div class="fn-empty-title">Нет операций</div>
            <div class="fn-empty-subtitle">
              Добавьте первую операцию для учёта доходов и расходов
            </div>
            <button class="fn-add-btn mt-4" @click="openCreateTransaction">
              <v-icon icon="mdi-plus" size="18" />
              Добавить первую операцию
            </button>
          </div>

          <div v-else class="fn-transactions-list">
            <div
              v-for="t in filteredTransactions"
              :key="t.id"
              class="fn-transaction-row"
            >
              <!-- Color dot -->
              <div
                class="fn-transaction-dot"
                :style="{ background: getCategoryColor(t) }"
              ></div>

              <!-- Info -->
              <div class="fn-transaction-info">
                <div class="fn-transaction-title">
                  {{ t.description || (t.type === 'INCOME' ? 'Доход' : 'Расход') }}
                </div>
                <div class="fn-transaction-meta">
                  <span v-if="t.category" class="fn-transaction-category">
                    {{ t.category.name }}
                  </span>
                  <span v-if="t.category"> &middot; </span>
                  <span>{{ formatDate(t.date || t.createdAt) }}</span>
                </div>
              </div>

              <!-- Amount -->
              <div
                class="fn-transaction-amount"
                :class="t.type === 'INCOME' ? 'fn-transaction-amount--income' : 'fn-transaction-amount--expense'"
              >
                {{ formatTransactionAmount(t) }}
              </div>

              <!-- Actions -->
              <div class="fn-transaction-actions">
                <button class="fn-icon-btn" @click="openEditTransaction(t)">
                  <v-icon icon="mdi-pencil-outline" size="16" />
                </button>
                <button class="fn-icon-btn fn-icon-btn--danger" @click="confirmDelete(t.id)">
                  <v-icon icon="mdi-delete-outline" size="16" />
                </button>
              </div>
            </div>
          </div>

          <!-- Load more -->
          <div v-if="hasMore && filteredTransactions.length" class="fn-load-more">
            <button
              class="fn-load-more-btn"
              :disabled="loadingMore"
              @click="loadMore"
            >
              <v-progress-circular v-if="loadingMore" indeterminate size="16" width="2" class="mr-2" />
              {{ loadingMore ? 'Загрузка...' : 'Показать ещё' }}
            </button>
          </div>
        </div>
      </v-card>
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
                v-model.number="form.amount"
                type="number"
                min="0"
                step="100"
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
</style>
