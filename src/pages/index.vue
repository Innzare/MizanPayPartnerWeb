<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { useRequestsStore } from '@/stores/requests'
import { useNotificationsStore } from '@/stores/notifications'
import { formatCurrency, formatCurrencyShort, formatPercent, formatDateShort } from '@/utils/formatters'
import { userName } from '@/types'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { Bar, Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Tooltip, Legend, Filler
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend, Filler)

const router = useRouter()
const { isDark, statusStyle } = useIsDark()
const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()
const requestsStore = useRequestsStore()
const notificationsStore = useNotificationsStore()

// Payment health
const paymentHealth = computed(() => {
  const paid = paymentsStore.paidPayments
  if (!paid.length) return 100
  const onTime = paid.filter(p => p.paidAt && new Date(p.paidAt) <= new Date(p.dueDate)).length
  return Math.round((onTime / paid.length) * 100)
})

// Upcoming payments with deal info
const upcomingPayments = computed(() => {
  const now = Date.now()
  return paymentsStore.allUpcoming.slice(0, 5).map((item) => {
    const deal = dealsStore.getDeal(item.dealId)
    const dueTime = new Date(item.payment.dueDate).getTime()
    const daysRemaining = Math.ceil((dueTime - now) / 86_400_000)
    return { ...item, deal, daysRemaining }
  })
})

const topActiveDeals = computed(() => dealsStore.activeDeals.slice(0, 4))

// --- Chart Data ---

// Revenue by month (last 6 months from paid payments)
const revenueChartData = computed(() => {
  const months: Record<string, number> = {}
  const now = new Date()

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
    months[key] = 0
  }

  paymentsStore.allPaymentsFlat.filter(p => p.status === 'PAID' && p.paidAt).forEach(p => {
    const d = new Date(p.paidAt!)
    const key = d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
    if (key in months) months[key] += p.amount
  })

  return {
    labels: Object.keys(months),
    datasets: [{
      label: 'Поступления',
      data: Object.values(months),
      backgroundColor: 'rgba(4, 120, 87, 0.15)',
      borderColor: '#047857',
      borderWidth: 2,
      borderRadius: 6,
      hoverBackgroundColor: 'rgba(4, 120, 87, 0.3)',
    }]
  }
})

// Payment forecast (next 6 months)
const forecastChartData = computed(() => {
  const months: Record<string, number> = {}
  const now = new Date()

  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const key = d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
    months[key] = 0
  }

  paymentsStore.allPaymentsFlat.filter(p => p.status === 'PENDING' || p.status === 'OVERDUE').forEach(p => {
    const d = new Date(p.dueDate)
    const key = d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
    if (key in months) months[key] += p.amount
  })

  return {
    labels: Object.keys(months),
    datasets: [{
      label: 'Ожидаемые платежи',
      data: Object.values(months),
      borderColor: '#047857',
      backgroundColor: 'rgba(4, 120, 87, 0.06)',
      borderWidth: 2.5,
      pointBackgroundColor: '#047857',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      fill: true,
      tension: 0.4,
    }]
  }
})

// Chart options
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
        label: (ctx: any) => formatCurrency(ctx.raw)
      }
    }
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
    }
  }
}

const lineOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toLocaleString('ru-RU')} ₽`
      }
    }
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 11 } },
    },
    y: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: {
        font: { size: 11 },
        callback: (v: any) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v),
      },
    }
  }
}

onMounted(() => {
  dealsStore.fetchDeals()
  paymentsStore.fetchPayments()
  requestsStore.fetchRequests()
  notificationsStore.fetchNotifications()
})

const AVATAR_COLORS = ['#047857', '#3b82f6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ef4444']
function getInitial(name?: string) { return name ? name.charAt(0).toUpperCase() : '?' }
function getAvatarColor(name?: string) {
  if (!name) return AVATAR_COLORS[0]
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Hero Card -->
    <div class="hero-card mb-6">
      <div class="hero-main">
        <div class="hero-label">Ожидается к получению</div>
        <div class="hero-amount">{{ formatCurrency(dealsStore.totalRemaining) }}</div>
      </div>
      <div class="hero-metrics">
        <div class="hero-metric">
          <span class="hero-metric-value">{{ formatCurrencyShort(dealsStore.totalRevenue) }}</span>
          <span class="hero-metric-label">Оборот</span>
        </div>
        <div class="hero-metric-divider" />
        <div class="hero-metric">
          <span class="hero-metric-value">{{ formatCurrencyShort(dealsStore.totalProfit) }}</span>
          <span class="hero-metric-label">Прибыль</span>
        </div>
        <div class="hero-metric-divider" />
        <div class="hero-metric">
          <span class="hero-metric-value">{{ formatPercent(dealsStore.roi) }}</span>
          <span class="hero-metric-label">ROI</span>
        </div>
      </div>
    </div>

    <!-- Quick Actions + KPI Cards Row -->
    <v-row class="mb-6">
      <!-- Quick Actions -->
      <v-col cols="12" lg="6">
        <v-card rounded="lg" elevation="0" border class="pa-5 h-100">
          <div class="chart-title mb-4">Быстрые действия</div>

          <div class="quick-actions">
            <button class="qa-btn" @click="router.push('/create-deal')">
              <div class="qa-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
                <v-icon icon="mdi-handshake" size="20" />
              </div>
              <div class="qa-text">
                <div class="qa-title">Новая сделка</div>
                <div class="qa-desc">Создать договор</div>
              </div>
              <v-icon icon="mdi-chevron-right" size="18" color="grey" />
            </button>

            <button class="qa-btn" @click="router.push('/create-product')">
              <div class="qa-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
                <v-icon icon="mdi-package-variant-plus" size="20" />
              </div>
              <div class="qa-text">
                <div class="qa-title">Добавить товар</div>
                <div class="qa-desc">В каталог</div>
              </div>
              <v-icon icon="mdi-chevron-right" size="18" color="grey" />
            </button>

            <button class="qa-btn" @click="router.push('/requests')">
              <div class="qa-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
                <v-icon icon="mdi-file-document-outline" size="20" />
              </div>
              <div class="qa-text">
                <div class="qa-title">Заявки</div>
                <div class="qa-desc">{{ requestsStore.activeRequests.length }} активных</div>
              </div>
              <v-icon icon="mdi-chevron-right" size="18" color="grey" />
            </button>

            <button class="qa-btn" @click="router.push('/calculator')">
              <div class="qa-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
                <v-icon icon="mdi-calculator" size="20" />
              </div>
              <div class="qa-text">
                <div class="qa-title">Калькулятор</div>
                <div class="qa-desc">Расчёт условий</div>
              </div>
              <v-icon icon="mdi-chevron-right" size="18" color="grey" />
            </button>

            <button class="qa-btn" @click="router.push('/notifications')">
              <div class="qa-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
                <v-icon icon="mdi-bell-outline" size="20" />
              </div>
              <div class="qa-text">
                <div class="qa-title">Уведомления</div>
                <div class="qa-desc">{{ notificationsStore.unreadCount }} непрочитанных</div>
              </div>
              <v-icon icon="mdi-chevron-right" size="18" color="grey" />
            </button>
          </div>
        </v-card>
      </v-col>

      <!-- KPI Cards -->
      <v-col cols="12" lg="6">
        <div class="kpi-grid-2x3">
          <div class="kpi-card">
            <div class="kpi-icon-wrap" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
              <v-icon icon="mdi-cash-multiple" size="20" />
            </div>
            <div class="kpi-info">
              <div class="kpi-value">{{ formatCurrencyShort(dealsStore.totalInvested) }}</div>
              <div class="kpi-label">Инвестировано</div>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-icon-wrap" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
              <v-icon icon="mdi-calendar-month" size="20" />
            </div>
            <div class="kpi-info">
              <div class="kpi-value">{{ formatCurrencyShort(dealsStore.monthlyIncome) }}</div>
              <div class="kpi-label">Доход / мес</div>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-icon-wrap" style="background: rgba(14, 165, 233, 0.1); color: #0ea5e9;">
              <v-icon icon="mdi-briefcase-check" size="20" />
            </div>
            <div class="kpi-info">
              <div class="kpi-value">{{ dealsStore.activeDeals.length }}</div>
              <div class="kpi-label">Активных сделок</div>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-icon-wrap" style="background: rgba(22, 163, 74, 0.1); color: #16a34a;">
              <v-icon icon="mdi-check-circle" size="20" />
            </div>
            <div class="kpi-info">
              <div class="kpi-value">{{ dealsStore.completedDeals.length }}</div>
              <div class="kpi-label">Завершённых</div>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-icon-wrap" :style="{ background: paymentHealth >= 90 ? 'rgba(4, 120, 87, 0.1)' : 'rgba(245, 158, 11, 0.1)', color: paymentHealth >= 90 ? '#047857' : '#f59e0b' }">
              <v-icon icon="mdi-heart-pulse" size="20" />
            </div>
            <div class="kpi-info">
              <div class="kpi-value">{{ paymentHealth }}%</div>
              <div class="kpi-label">Своевременность</div>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-icon-wrap" :style="{ background: requestsStore.activeRequests.length > 0 ? 'rgba(139, 92, 246, 0.1)' : 'rgba(148, 163, 184, 0.1)', color: requestsStore.activeRequests.length > 0 ? '#8b5cf6' : '#94a3b8' }">
              <v-icon icon="mdi-file-document-outline" size="20" />
            </div>
            <div class="kpi-info">
              <div class="kpi-value">{{ requestsStore.activeRequests.length }}</div>
              <div class="kpi-label">Новых заявок</div>
            </div>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- Charts Row: Revenue + Forecast side by side -->
    <v-row class="mb-2">
      <!-- Revenue Chart -->
      <v-col cols="12" lg="6">
        <v-card rounded="lg" elevation="0" border class="pa-5">
          <div class="d-flex align-center justify-space-between mb-4">
            <div>
              <div class="chart-title">Поступления</div>
              <div class="chart-subtitle">За последние 6 месяцев</div>
            </div>
            <div class="chart-total">
              {{ formatCurrency(paymentsStore.paidPayments.reduce((s, p) => s + p.amount, 0)) }}
            </div>
          </div>
          <div style="height: 240px;">
            <Bar :data="revenueChartData" :options="barOptions" />
          </div>
        </v-card>
      </v-col>

      <!-- Payment Forecast -->
      <v-col cols="12" lg="6">
        <v-card rounded="lg" elevation="0" border class="pa-5">
          <div class="d-flex align-center justify-space-between mb-2">
            <div>
              <div class="chart-title">Прогноз поступлений</div>
              <div class="chart-subtitle">На 6 месяцев вперёд</div>
            </div>
            <div class="d-flex align-center ga-1">
              <div style="width: 8px; height: 8px; border-radius: 50%; background: #047857;" />
              <span class="chart-subtitle">Поступления</span>
            </div>
          </div>

          <div class="forecast-summary mb-4">
            <div class="forecast-summary-item">
              <div class="forecast-summary-label">Всего ожидается</div>
              <div class="forecast-summary-value" style="color: #047857;">
                {{ formatCurrency(paymentsStore.pendingPayments.reduce((s, p) => s + p.amount, 0)) }}
              </div>
            </div>
            <div class="forecast-summary-item">
              <div class="forecast-summary-label">Платежей</div>
              <div class="forecast-summary-value" style="color: #f59e0b;">
                {{ paymentsStore.pendingPayments.length }}
              </div>
            </div>
            <div class="forecast-summary-item">
              <div class="forecast-summary-label">Средний платёж</div>
              <div class="forecast-summary-value" style="color: #8b5cf6;">
                {{ formatCurrency(paymentsStore.pendingPayments.length > 0 ? paymentsStore.pendingPayments.reduce((s, p) => s + p.amount, 0) / paymentsStore.pendingPayments.length : 0) }}
              </div>
            </div>
          </div>

          <div style="height: 180px;">
            <Line :data="forecastChartData" :options="lineOptions" />
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Upcoming Payments + Active Deals side by side -->
    <v-row>
      <!-- Upcoming Payments -->
      <v-col cols="12" lg="6">
        <v-card rounded="lg" elevation="0" border>
          <div class="d-flex align-center justify-space-between pa-5 pb-0">
            <div>
              <div class="chart-title">Ближайшие платежи</div>
              <div class="chart-subtitle">{{ upcomingPayments.length }} ожидаемых</div>
            </div>
            <button class="dash-link-btn" @click="router.push('/payments')">
              Все платежи
              <v-icon icon="mdi-arrow-right" size="16" />
            </button>
          </div>

          <div v-if="upcomingPayments.length" class="pa-4">
            <div
              v-for="item in upcomingPayments"
              :key="item.payment.id"
              class="payment-row"
            >
              <div class="payment-avatar" :style="{ background: getAvatarColor(userName(item.deal?.client)) }">
                {{ getInitial(userName(item.deal?.client)) }}
              </div>
              <div class="payment-info">
                <div class="payment-product">{{ item.deal?.productName || 'Товар' }}</div>
                <div class="payment-meta">{{ userName(item.deal?.client) }} · {{ formatDateShort(item.payment.dueDate) }}</div>
              </div>
              <div class="payment-right">
                <div class="payment-amount">{{ formatCurrency(item.payment.amount) }}</div>
                <div
                  class="payment-badge"
                  :class="item.daysRemaining >= 0 ? 'payment-badge--ok' : 'payment-badge--overdue'"
                >
                  {{ item.daysRemaining >= 0 ? `через ${item.daysRemaining} дн` : `просрочен ${Math.abs(item.daysRemaining)} дн` }}
                </div>
              </div>
            </div>
          </div>

          <div v-else class="pa-8 text-center text-medium-emphasis text-body-2">
            Нет предстоящих платежей
          </div>
        </v-card>
      </v-col>

      <!-- Active Deals -->
      <v-col cols="12" lg="6">
        <v-card rounded="lg" elevation="0" border>
          <div class="d-flex align-center justify-space-between pa-5 pb-0">
            <div>
              <div class="chart-title">Активные сделки</div>
              <div class="chart-subtitle">{{ dealsStore.activeDeals.length }} сделок в работе</div>
            </div>
            <button class="dash-link-btn" @click="router.push('/deals')">
              Все сделки
              <v-icon icon="mdi-arrow-right" size="16" />
            </button>
          </div>

          <div v-if="topActiveDeals.length" class="pa-4">
            <div
              v-for="deal in topActiveDeals"
              :key="deal.id"
              class="deal-row"
            >
              <v-avatar size="44" rounded="lg" class="deal-photo">
                <v-img :src="deal.productPhotos?.[0]" cover />
              </v-avatar>
              <div class="deal-info">
                <div class="deal-product">{{ deal.productName }}</div>
                <div class="deal-meta">{{ userName(deal.client) }}</div>
              </div>
              <div class="deal-progress-col">
                <div class="deal-progress-label">{{ deal.paidPayments }} / {{ deal.numberOfPayments }}</div>
                <v-progress-linear
                  :model-value="deal.numberOfPayments > 0 ? (deal.paidPayments / deal.numberOfPayments) * 100 : 0"
                  color="primary"
                  rounded
                  height="4"
                  style="width: 100px;"
                />
              </div>
              <div class="deal-amount">{{ formatCurrency(deal.remainingAmount) }}</div>
              <div
                class="deal-status-badge"
                :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])"
              >
                {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
              </div>
            </div>
          </div>

          <div v-else class="pa-8 text-center text-medium-emphasis text-body-2">
            Нет активных сделок
          </div>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<style scoped>
/* Hero Card */
.hero-card {
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  border-radius: 16px;
  padding: 28px 32px;
  color: #fff;
}

.hero-main {
  margin-bottom: 24px;
}

.hero-label {
  font-size: 13px;
  font-weight: 500;
  opacity: 0.7;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.hero-amount {
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.hero-metrics {
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 16px 0;
}

.hero-metric {
  flex: 1;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hero-metric-value {
  font-size: 18px;
  font-weight: 700;
}

.hero-metric-label {
  font-size: 12px;
  opacity: 0.6;
}

.hero-metric-divider {
  width: 1px;
  height: 32px;
  background: rgba(255, 255, 255, 0.15);
}

/* KPI Grid 2x3 */
.kpi-grid-2x3 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  height: 100%;
  align-content: center;
}

@media (max-width: 960px) {
  .kpi-grid-2x3 { grid-template-columns: repeat(2, 1fr); }
}

.h-100 { height: 100%; }

.kpi-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}

.kpi-icon-wrap {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kpi-info {
  min-width: 0;
}

.kpi-value {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.kpi-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
}

/* Chart cards */
.chart-title {
  font-size: 16px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.chart-subtitle {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.chart-total {
  font-size: 20px;
  font-weight: 700;
  color: #047857;
}

/* Forecast summary */
.forecast-summary {
  display: flex;
  gap: 24px;
}

.forecast-summary-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.forecast-summary-value {
  font-size: 15px;
  font-weight: 700;
}

/* Link button */
.dash-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  border: none;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.dash-link-btn:hover {
  background: rgba(var(--v-theme-primary), 0.15);
}

/* Payment rows */
.payment-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  transition: background 0.15s;
}

.payment-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.payment-avatar {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  font-size: 14px;
}

.payment-info {
  flex: 1;
  min-width: 0;
}

.payment-product {
  font-size: 14px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.payment-meta {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.payment-right {
  text-align: right;
  flex-shrink: 0;
}

.payment-amount {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.payment-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  margin-top: 2px;
}

.payment-badge--ok {
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
}

.payment-badge--overdue {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* Deal rows */
.deal-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  transition: background 0.15s;
}

.deal-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.deal-photo {
  flex-shrink: 0;
}

.deal-info {
  flex: 1;
  min-width: 0;
}

.deal-product {
  font-size: 14px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deal-meta {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.deal-progress-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.deal-progress-label {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.deal-amount {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  flex-shrink: 0;
  white-space: nowrap;
}

.deal-status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Quick Actions */
.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.qa-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s;
  text-align: left;
  width: 100%;
}

.qa-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.qa-icon {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qa-text {
  flex: 1;
  min-width: 0;
}

.qa-title {
  font-size: 14px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.qa-desc {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Dark mode */
.dark .hero-card {
  background: linear-gradient(135deg, #047857 0%, #064e3b 50%, #022c22 100%);
}

.dark .kpi-card {
  background: #1e1e2e;
  border-color: #2e2e42;
}
.dark .payment-badge--ok {
  background: rgba(4, 120, 87, 0.15); color: #34d399;
}
.dark .payment-badge--overdue {
  background: rgba(239, 68, 68, 0.15); color: #f87171;
}

@media (max-width: 960px) {
  .hero-amount { font-size: 28px; }
  .hero-card { padding: 20px 24px; }
  .deal-progress-col, .deal-amount { display: none; }
}
</style>
