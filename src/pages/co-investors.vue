<script lang="ts" setup>
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useDealsStore } from '@/stores/deals'
import { formatCurrency, formatCurrencyShort, formatPhone } from '@/utils/formatters'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import type { Deal } from '@/types'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const router = useRouter()
const { isDark } = useIsDark()
const toast = useToast()
const dealsStore = useDealsStore()

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
  profitPercent: number
  createdAt: string
  stats: CoInvestorStats
  dealsList: DealInfo[]
}

// ── State ──

const pageLoading = ref(true)
const coInvestors = ref<CoInvestor[]>([])
const expandedIds = ref<string[]>([])
const search = ref('')

// Create/Edit dialog
const showDialog = ref(false)
const dialogLoading = ref(false)
const editingId = ref<string | null>(null)
const form = ref({ name: '', phone: '', capital: 0, profitPercent: 30 })

// Delete dialog
const deleteDialog = ref(false)
const deletingId = ref<string | null>(null)
const deleteLoading = ref(false)

// Deal selector dialog
const showDealSelector = ref(false)
const dealSelectorLoading = ref(false)
const linkingCoInvestorId = ref<string | null>(null)
const dealSearch = ref('')

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
    ])
    coInvestors.value = investors
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки данных')
  } finally {
    pageLoading.value = false
  }
}

onMounted(fetchData)

// ── Computed ──

const filteredCoInvestors = computed(() => {
  if (!search.value) return coInvestors.value
  const s = search.value.toLowerCase()
  return coInvestors.value.filter(
    (ci) => ci.name.toLowerCase().includes(s) || (ci.phone && ci.phone.includes(s))
  )
})

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

const availableDeals = computed(() => {
  if (!linkingCoInvestorId.value) return []
  const ci = coInvestors.value.find((c) => c.id === linkingCoInvestorId.value)
  const linkedIds = new Set(ci?.dealsList.map((d) => d.id) || [])
  let deals = dealsStore.investorDeals.filter((d: Deal) => !linkedIds.has(d.id))
  if (dealSearch.value) {
    const s = dealSearch.value.toLowerCase()
    deals = deals.filter((d: Deal) => d.productName.toLowerCase().includes(s))
  }
  return deals
})

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
  form.value = { name: '', phone: '', capital: 0, profitPercent: 30 }
  showDialog.value = true
}

function openEdit(ci: CoInvestor) {
  editingId.value = ci.id
  form.value = { name: ci.name, phone: ci.phone || '', capital: ci.capital, profitPercent: ci.profitPercent }
  showDialog.value = true
}

async function saveCoInvestor() {
  if (!form.value.name.trim()) return toast.error('Укажите имя')
  if (form.value.capital <= 0) return toast.error('Укажите капитал')
  if (form.value.profitPercent <= 0 || form.value.profitPercent >= 100) return toast.error('Процент от 1 до 99')

  dialogLoading.value = true
  try {
    const body = {
      name: form.value.name.trim(),
      phone: form.value.phone.trim() || undefined,
      capital: Number(form.value.capital),
      profitPercent: Number(form.value.profitPercent),
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

// ── Delete ──

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

// ── Deal linking ──

function openDealSelector(coInvestorId: string) {
  linkingCoInvestorId.value = coInvestorId
  dealSearch.value = ''
  showDealSelector.value = true
}

async function linkDeal(dealId: string) {
  if (!linkingCoInvestorId.value) return
  dealSelectorLoading.value = true
  try {
    await api.post(`/co-investors/${linkingCoInvestorId.value}/deals/${dealId}`)
    toast.success('Сделка привязана')
    showDealSelector.value = false
    pageLoading.value = true
    await fetchData()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка привязки')
  } finally {
    dealSelectorLoading.value = false
  }
}

async function unlinkDeal(coInvestorId: string, dealId: string) {
  try {
    await api.delete(`/co-investors/${coInvestorId}/deals/${dealId}`)
    toast.success('Сделка отвязана')
    pageLoading.value = true
    await fetchData()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка отвязки')
  }
}

// ── Helpers ──

function getDealShareForCi(deal: DealInfo, ci: CoInvestor) {
  const profit = deal.markup
  const ciShare = Math.round(profit * ci.profitPercent / 100)
  return { profit, ciShare, myShare: profit - ciShare }
}

const DEAL_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Активна',
  COMPLETED: 'Завершена',
  PENDING: 'Ожидание',
  OVERDUE: 'Просрочена',
  CANCELLED: 'Отменена',
}

const DEAL_STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#047857',
  COMPLETED: '#3b82f6',
  PENDING: '#f59e0b',
  OVERDUE: '#ef4444',
  CANCELLED: '#71717a',
}

function dealStatusBg(status: string) {
  const color = DEAL_STATUS_COLORS[status] || '#71717a'
  return `${color}18`
}

function pluralDeals(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'сделка'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'сделки'
  return 'сделок'
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
      </div>

      <!-- Charts -->
      <v-row v-if="coInvestors.length > 0" class="mb-5">
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

      <!-- Main Card -->
      <v-card rounded="lg" elevation="0" border>
        <div class="pa-4">
          <!-- Header row -->
          <div class="d-flex align-center ga-3 mb-4 flex-wrap">
            <div class="filter-input-wrap" style="max-width: 360px;">
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
                    <span class="ci-percent-badge">{{ ci.profitPercent }}%</span>
                  </div>
                  <div class="ci-meta">
                    <span v-if="ci.phone">{{ formatPhone(ci.phone) }} · </span>
                    {{ formatCurrency(ci.capital) }} · {{ ci.stats.totalDeals }} {{ pluralDeals(ci.stats.totalDeals) }}
                  </div>
                </div>

                <!-- Desktop stats -->
                <div class="ci-stats d-none d-md-flex">
                  <div class="ci-stat">
                    <div class="ci-stat-value" style="color: #6366f1;">{{ formatCurrency(ci.stats.coInvestorShare) }}</div>
                    <div class="ci-stat-label">Доля партнёра</div>
                  </div>
                  <div class="ci-stat">
                    <div class="ci-stat-value" style="color: #047857;">{{ formatCurrency(ci.stats.myShare) }}</div>
                    <div class="ci-stat-label">Моя доля</div>
                  </div>
                  <div class="ci-stat">
                    <div class="ci-stat-value">{{ ci.stats.activeDeals }}</div>
                    <div class="ci-stat-label">Активных</div>
                  </div>
                </div>

                <div class="ci-actions d-none d-sm-flex">
                  <button class="ci-action-btn" title="Редактировать" @click.stop="openEdit(ci)">
                    <v-icon icon="mdi-pencil-outline" size="16" />
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
                  <!-- Mobile stats -->
                  <div class="ci-stats-mobile d-md-none">
                    <div class="ci-stat-m">
                      <div class="ci-stat-m-label">Капитал</div>
                      <div class="ci-stat-m-value">{{ formatCurrency(ci.capital) }}</div>
                    </div>
                    <div class="ci-stat-m">
                      <div class="ci-stat-m-label">Доля партнёра</div>
                      <div class="ci-stat-m-value" style="color: #6366f1;">{{ formatCurrency(ci.stats.coInvestorShare) }}</div>
                    </div>
                    <div class="ci-stat-m">
                      <div class="ci-stat-m-label">Моя доля</div>
                      <div class="ci-stat-m-value" style="color: #047857;">{{ formatCurrency(ci.stats.myShare) }}</div>
                    </div>
                    <div class="ci-stat-m">
                      <div class="ci-stat-m-label">Активных</div>
                      <div class="ci-stat-m-value">{{ ci.stats.activeDeals }}</div>
                    </div>
                  </div>

                  <!-- Mobile actions -->
                  <div class="ci-mobile-actions d-sm-none mb-3">
                    <button class="ci-action-btn" @click="openEdit(ci)">
                      <v-icon icon="mdi-pencil-outline" size="16" />
                      Редактировать
                    </button>
                    <button class="ci-action-btn ci-action-btn--danger" @click="confirmDelete(ci.id)">
                      <v-icon icon="mdi-delete-outline" size="16" />
                      Удалить
                    </button>
                  </div>

                  <!-- Profit distribution bar -->
                  <div class="ci-profit-bar mb-4" v-if="ci.stats.totalProfit > 0">
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
                      <span class="ci-profit-legend" style="color: #6366f1;">Партнёр: {{ ci.profitPercent }}%</span>
                      <span class="ci-profit-legend" style="color: #047857;">Моя доля: {{ 100 - ci.profitPercent }}%</span>
                    </div>
                  </div>

                  <!-- Linked deals -->
                  <div class="ci-deals-section">
                    <div class="d-flex align-center justify-space-between mb-3">
                      <span class="ci-section-title">Привязанные сделки ({{ ci.dealsList.length }})</span>
                      <button class="ci-link-btn" @click.stop="openDealSelector(ci.id)">
                        <v-icon icon="mdi-link-plus" size="16" />
                        Привязать сделку
                      </button>
                    </div>

                    <div v-if="!ci.dealsList.length" class="ci-no-deals">
                      <v-icon icon="mdi-link-off" size="20" class="mr-2" />
                      Нет привязанных сделок
                    </div>

                    <div v-else class="ci-deals-list">
                      <div v-for="deal in ci.dealsList" :key="deal.id" class="ci-deal-row ci-deal-row--clickable" @click="router.push(`/deals/${deal.id}`)">
                        <div class="ci-deal-info">
                          <div class="ci-deal-name">{{ deal.productName }}</div>
                          <div class="ci-deal-meta">
                            <span
                              class="ci-deal-status"
                              :style="{ background: dealStatusBg(deal.status), color: DEAL_STATUS_COLORS[deal.status] || '#71717a' }"
                            >
                              {{ DEAL_STATUS_LABELS[deal.status] || deal.status }}
                            </span>
                            <span class="ci-deal-total">{{ formatCurrency(deal.totalPrice) }}</span>
                          </div>
                        </div>
                        <div class="ci-deal-profit">
                          <div class="ci-deal-profit-row">
                            <span class="ci-deal-profit-label">Прибыль:</span>
                            <span class="ci-deal-profit-value">{{ formatCurrency(getDealShareForCi(deal, ci).profit) }}</span>
                          </div>
                          <div class="ci-deal-profit-row">
                            <span class="ci-deal-profit-label" style="color: #6366f1;">Партнёру:</span>
                            <span class="ci-deal-profit-value" style="color: #6366f1;">{{ formatCurrency(getDealShareForCi(deal, ci).ciShare) }}</span>
                          </div>
                          <div class="ci-deal-profit-row">
                            <span class="ci-deal-profit-label" style="color: #047857;">Мне:</span>
                            <span class="ci-deal-profit-value" style="color: #047857;">{{ formatCurrency(getDealShareForCi(deal, ci).myShare) }}</span>
                          </div>
                        </div>
                        <button
                          class="ci-unlink-btn"
                          title="Отвязать сделку"
                          @click.stop="unlinkDeal(ci.id, deal.id)"
                        >
                          <v-icon icon="mdi-link-off" size="16" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </v-expand-transition>
            </div>
          </div>
        </div>
      </v-card>
    </template>

    <!-- Create/Edit Dialog -->
    <v-dialog v-model="showDialog" max-width="480" persistent>
      <v-card rounded="lg">
        <div class="ci-dialog-header">
          <span class="ci-dialog-title">{{ editingId ? 'Редактировать' : 'Новый со-инвестор' }}</span>
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
                v-model.number="form.capital"
                type="number"
                class="ci-field-input"
                placeholder="0"
                min="0"
              />
              <span class="ci-field-suffix">₽</span>
            </div>
          </div>

          <!-- Profit percent -->
          <div class="ci-field mb-2">
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
          <div class="ci-delete-subtitle mb-4">
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

    <!-- Deal Selector Dialog -->
    <v-dialog v-model="showDealSelector" max-width="560">
      <v-card rounded="lg">
        <div class="ci-dialog-header">
          <span class="ci-dialog-title">Привязать сделку</span>
          <button class="ci-dialog-close" @click="showDealSelector = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-4">
          <div class="filter-input-wrap mb-4">
            <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
            <input
              v-model="dealSearch"
              type="text"
              placeholder="Поиск по названию товара..."
              class="filter-input"
            />
          </div>

          <div v-if="!availableDeals.length" class="ci-no-deals pa-4">
            <v-icon icon="mdi-briefcase-off-outline" size="20" class="mr-2" />
            Нет доступных сделок
          </div>

          <div v-else class="ci-deal-selector-list">
            <div
              v-for="deal in availableDeals"
              :key="deal.id"
              class="ci-deal-selector-item"
              @click="linkDeal(deal.id)"
              :class="{ 'opacity-50': dealSelectorLoading }"
            >
              <div class="ci-deal-selector-info">
                <div class="ci-deal-name">{{ deal.productName }}</div>
                <div class="ci-deal-meta">
                  <span
                    class="ci-deal-status"
                    :style="{ background: dealStatusBg(deal.status), color: DEAL_STATUS_COLORS[deal.status] || '#71717a' }"
                  >
                    {{ DEAL_STATUS_LABELS[deal.status] || deal.status }}
                  </span>
                  <span>{{ formatCurrency(deal.totalPrice) }}</span>
                  <span style="color: #047857;">+{{ formatCurrency(deal.markup) }}</span>
                </div>
              </div>
              <v-icon icon="mdi-link-plus" size="18" color="primary" />
            </div>
          </div>
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
@media (max-width: 500px) { .stats-row { grid-template-columns: 1fr; } }

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

.expand-icon {
  color: rgba(var(--v-theme-on-surface), 0.25);
  flex-shrink: 0;
}

/* ── Expanded content ── */
.ci-expanded {
  padding: 0 18px 18px;
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
</style>
