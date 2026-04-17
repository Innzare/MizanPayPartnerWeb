<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { useRequestsStore } from '@/stores/requests'
import { useNotificationsStore } from '@/stores/notifications'
import { formatCurrency, formatCurrencyShort, formatDateShort } from '@/utils/formatters'
import { userName, clientProfileName } from '@/types'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { api } from '@/api/client'
import HeroSummary from '@/components/HeroSummary.vue'
import { useCapital } from '@/composables/useCapital'

const router = useRouter()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const { capital, isCapitalSet, fetchCapital } = useCapital()


const sendingBulk = ref(false)

async function sendBulkReminders() {
  if (!confirm('Отправить напоминания всем клиентам с просроченными или приближающимися платежами?')) return
  sendingBulk.value = true
  try {
    const result = await api.post<{ sent: number; failed: number; total: number }>('/whatsapp/remind-all')
    toast.success(`Отправлено ${result.sent} из ${result.total} напоминаний`)
    if (result.failed > 0) {
      toast.error(`${result.failed} не удалось отправить`)
    }
  } catch (e: any) {
    toast.error(e.message || 'Ошибка рассылки')
  } finally {
    sendingBulk.value = false
  }
}

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

const pageLoading = ref(true)

onMounted(async () => {
  try {
    await Promise.all([
      dealsStore.fetchDeals(),
      paymentsStore.fetchPayments(),
      requestsStore.fetchRequests(),
      notificationsStore.fetchNotifications(),
      fetchCapital(),
    ])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки данных')
  } finally {
    pageLoading.value = false
  }
})

// Overdue amount
const overdueAmount = computed(() =>
  paymentsStore.overduePayments.reduce((s, p) => s + p.amount, 0)
)

// ── Metric breakdown dialog ──
type MetricKey = 'invested' | 'revenue' | 'profit' | 'remaining' | 'monthly' | 'roi' | 'overdue'
const breakdownOpen = ref(false)
const breakdownTitle = ref('')
const breakdownDeals = ref<{ deal: any; value: number; label?: string }[]>([])
const breakdownTotal = ref(0)
const breakdownSuffix = ref('')

function openBreakdown(metric: MetricKey) {
  let deals: { deal: any; value: number; label?: string }[] = []
  let title = ''
  let suffix = ''

  switch (metric) {
    case 'invested':
      title = 'Инвестировано'
      deals = dealsStore.investorDeals.map(d => ({ deal: d, value: d.purchasePrice }))
      break
    case 'revenue':
      title = 'Общий оборот'
      deals = dealsStore.investorDeals.map(d => ({ deal: d, value: d.totalPrice }))
      break
    case 'profit':
      title = 'Прибыль'
      deals = dealsStore.investorDeals.map(d => ({ deal: d, value: d.markup, label: `${d.markupPercent}%` }))
      break
    case 'remaining':
      title = 'Ожидается к получению'
      deals = dealsStore.activeDeals.map(d => ({ deal: d, value: d.remainingAmount }))
      break
    case 'monthly':
      title = 'Доход / мес'
      deals = dealsStore.activeDeals
        .filter(d => d.numberOfPayments > 0)
        .map(d => ({ deal: d, value: Math.round(d.totalPrice / d.numberOfPayments), label: `${d.numberOfPayments} мес` }))
      break
    case 'roi':
      title = 'ROI'
      suffix = '%'
      deals = dealsStore.investorDeals
        .filter(d => d.purchasePrice > 0)
        .map(d => ({ deal: d, value: Math.round((d.markup / d.purchasePrice) * 1000) / 10, label: `${formatCurrency(d.markup)} / ${formatCurrency(d.purchasePrice)}` }))
      break
    case 'overdue':
      title = 'Просроченные платежи'
      const byDeal = new Map<string, { deal: any; value: number }>()
      for (const p of paymentsStore.overduePayments) {
        const deal = dealsStore.getDeal(p.dealId)
        const existing = byDeal.get(p.dealId)
        if (existing) {
          existing.value += p.amount
        } else {
          byDeal.set(p.dealId, { deal, value: p.amount })
        }
      }
      deals = [...byDeal.values()]
      break
  }

  breakdownDeals.value = deals.sort((a, b) => b.value - a.value)
  breakdownTotal.value = deals.reduce((s, d) => s + d.value, 0)
  breakdownTitle.value = title
  breakdownSuffix.value = suffix
  breakdownOpen.value = true
}

const AVATAR_COLORS = ['#047857', '#3b82f6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ef4444']
function dealClientName(deal?: any): string {
  if (!deal) return '—'
  if (deal.client) return userName(deal.client)
  if (deal.clientProfile) return clientProfileName(deal.clientProfile)
  return deal.externalClientName || '—'
}
function getInitial(name?: string) { return name ? name.charAt(0).toUpperCase() : '?' }
function getAvatarColor(name?: string) {
  if (!name) return AVATAR_COLORS[0]
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Page loader -->
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
    <!-- Capital banner -->
    <div v-if="!isCapitalSet" class="dash-capital-banner mb-4" @click="router.push('/finance')">
      <div class="dash-capital-banner-icon">
        <v-icon icon="mdi-wallet-outline" size="20" />
      </div>
      <div class="dash-capital-banner-content">
        <div class="dash-capital-banner-title">Настройте учёт капитала</div>
        <div class="dash-capital-banner-text">Укажите начальный капитал для контроля доступных средств</div>
      </div>
      <v-icon icon="mdi-chevron-right" size="20" style="color: rgba(var(--v-theme-on-surface), 0.3);" />
    </div>

    <!-- Hero + Quick Actions -->
    <div class="hero-row mb-6">
      <div class="qa-sidebar">
        <button class="qa-mini" @click="router.push('/create-deal')">
          <v-icon icon="mdi-handshake" size="18" style="color: #047857;" />
          <span>Сделка</span>
        </button>
        <button class="qa-mini" @click="router.push('/create-product')">
          <v-icon icon="mdi-package-variant-plus" size="18" style="color: #3b82f6;" />
          <span>Товар</span>
        </button>
        <button class="qa-mini" @click="router.push('/requests')" style="position: relative;">
          <v-icon icon="mdi-file-document-outline" size="18" style="color: #8b5cf6;" />
          <span>Заявки</span>
          <div v-if="requestsStore.activeRequests.length" class="qa-badge">{{ requestsStore.activeRequests.length }}</div>
        </button>
        <button class="qa-mini" @click="router.push('/calculator')">
          <v-icon icon="mdi-calculator" size="18" style="color: #f59e0b;" />
          <span>Расчёт</span>
        </button>
        <button class="qa-mini" @click="router.push('/notifications')" style="position: relative;">
          <v-icon icon="mdi-bell-outline" size="18" style="color: #ef4444;" />
          <span>Уведомл.</span>
          <div v-if="notificationsStore.unreadCount" class="qa-badge">{{ notificationsStore.unreadCount }}</div>
        </button>
        <button class="qa-mini" @click="sendBulkReminders" :disabled="sendingBulk" title="Напомнить всем">
          <v-icon icon="mdi-whatsapp" size="18" style="color: #25d366;" />
          <span>WhatsApp</span>
        </button>
      </div>

      <HeroSummary
        show-analytics-link
        show-locked-overlay
        class="hero-card"
        @metric="openBreakdown($event as MetricKey)"
      />

    </div>

    <!-- KPI Cards (horizontal) -->
    <div class="dash-section-title">Ключевые показатели</div>
    <div class="kpi-row mb-6">
      <div class="kpi-card kpi-clickable" @click="openBreakdown('invested')">
        <div class="kpi-icon-wrap" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-cash-multiple" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ formatCurrencyShort(dealsStore.totalInvested) }}</div>
          <div class="kpi-label">Инвестировано</div>
        </div>
      </div>

      <div class="kpi-card kpi-clickable" @click="openBreakdown('monthly')">
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
          <div class="kpi-label">Активных</div>
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

      <div class="kpi-card kpi-clickable" v-if="overdueAmount > 0" @click="openBreakdown('overdue')">
        <div class="kpi-icon-wrap" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
          <v-icon icon="mdi-alert-circle" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value" style="color: #ef4444;">{{ formatCurrencyShort(overdueAmount) }}</div>
          <div class="kpi-label">Просрочено</div>
        </div>
      </div>

      <div v-if="isCapitalSet && capital" class="kpi-card kpi-clickable" @click="router.push('/finance')">
        <div class="kpi-icon-wrap" style="background: rgba(124, 58, 237, 0.1); color: #7c3aed;">
          <v-icon icon="mdi-wallet-outline" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value" style="color: #7c3aed;">{{ formatCurrencyShort(capital.availableCapital) }}</div>
          <div class="kpi-label">Доступный капитал</div>
        </div>
      </div>
    </div>

    <!-- Upcoming Payments + Active Deals side by side -->
    <div class="dash-section-title">Активность</div>
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
              class="payment-row payment-row--clickable"
              @click="item.deal && router.push(`/deals/${item.deal.id}`)"
            >
              <div class="payment-avatar" :style="{ background: getAvatarColor(dealClientName(item.deal)) }">
                {{ getInitial(dealClientName(item.deal)) }}
              </div>
              <div class="payment-info">
                <div class="payment-product">{{ item.deal?.productName || 'Товар' }}</div>
                <div class="payment-meta">{{ dealClientName(item.deal) }} · {{ formatDateShort(item.payment.dueDate) }}</div>
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
              class="deal-row deal-row--clickable"
              @click="router.push(`/deals/${deal.id}`)"
            >
              <v-avatar size="44" rounded="lg" class="deal-photo">
                <v-img v-if="deal.productPhotos?.length" :src="deal.productPhotos[0]" cover />
                <v-icon v-else icon="mdi-package-variant-closed" size="22" color="grey" />
              </v-avatar>
              <div class="deal-info">
                <div class="deal-product">{{ deal.productName }}</div>
                <div class="deal-meta">{{ dealClientName(deal) }}</div>
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
    </template>

    <!-- Metric Breakdown Dialog -->
    <v-dialog v-model="breakdownOpen" max-width="560" scrollable>
      <v-card rounded="lg">
        <v-card-title class="d-flex align-center justify-space-between pa-5 pb-3">
          <span class="text-h6">{{ breakdownTitle }}</span>
          <v-btn icon variant="text" size="small" @click="breakdownOpen = false">
            <v-icon icon="mdi-close" />
          </v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text class="pa-0" style="max-height: 400px;">
          <div v-if="!breakdownDeals.length" class="pa-8 text-center text-medium-emphasis">
            Нет данных
          </div>

          <div v-for="(item, i) in breakdownDeals" :key="i" class="breakdown-row">
            <div class="breakdown-avatar" :style="{ background: getAvatarColor(item.deal?.productName) }">
              {{ getInitial(item.deal?.productName) }}
            </div>
            <div class="breakdown-info">
              <div class="breakdown-product">{{ item.deal?.productName || 'Товар' }}</div>
              <div class="breakdown-meta">{{ userName(item.deal?.client) || item.deal?.externalClientName || '—' }}</div>
            </div>
            <div class="breakdown-right">
              <div class="breakdown-value">
                {{ breakdownSuffix ? item.value + breakdownSuffix : formatCurrency(item.value) }}
              </div>
              <div v-if="item.label" class="breakdown-label">{{ item.label }}</div>
            </div>
          </div>
        </v-card-text>

        <v-divider />

        <div class="breakdown-footer">
          <span class="text-body-2 text-medium-emphasis">Итого ({{ breakdownDeals.length }} {{ breakdownDeals.length === 1 ? 'сделка' : breakdownDeals.length < 5 ? 'сделки' : 'сделок' }})</span>
          <span class="text-h6 font-weight-bold">
            {{ breakdownSuffix ? (Math.round(breakdownTotal * 10) / 10) + breakdownSuffix : formatCurrency(breakdownTotal) }}
          </span>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Section titles */
.dash-section-title {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.35);
  margin-bottom: 12px;
  padding-left: 2px;
}

/* Hero Row */
.hero-row {
  display: flex;
  gap: 12px;
  align-items: stretch;
}

.hero-card {
  flex: 1;
}

/* Quick Actions Sidebar */
.qa-sidebar {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qa-mini {
  width: 72px;
  padding: 10px 4px;
  border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
}

.qa-mini span {
  font-size: 10px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap;
}

.qa-mini:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.04);
}

.qa-mini:hover span {
  color: rgb(var(--v-theme-primary));
}

@media (max-width: 960px) {
  .hero-row { flex-direction: column; }
  .qa-sidebar { flex-direction: row; justify-content: center; }
}

/* KPI Row (horizontal) */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.kpi-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
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

/* Chart title (used in activity section) */
.chart-title {
  font-size: 16px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.chart-subtitle {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.45);
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

.payment-row--clickable { cursor: pointer; }
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

.deal-row--clickable { cursor: pointer; }
.deal-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.deal-photo {
  flex-shrink: 0;
  background: rgba(var(--v-theme-on-surface), 0.04);
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

/* (quick actions styles moved to .qa-sidebar / .qa-mini above) */

.qa-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}


.kpi-clickable {
  cursor: pointer;
  transition: all 0.15s;
}
.kpi-clickable:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.04);
}

/* Breakdown dialog */
.breakdown-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  transition: background 0.15s;
}
.breakdown-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.breakdown-avatar {
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
.breakdown-info {
  flex: 1;
  min-width: 0;
}
.breakdown-product {
  font-size: 14px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.breakdown-meta {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.breakdown-right {
  text-align: right;
  flex-shrink: 0;
}
.breakdown-value {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.breakdown-label {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.breakdown-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
}

/* Dark mode */

.dark .kpi-card {
  background: #1e1e2e;
  border-color: #2e2e42;
}
.dark .qa-mini {
  background: #1e1e2e;
  border-color: #2e2e42;
}
.dark .payment-summary-card {
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
  .hero-card { min-width: 0; }
  .deal-progress-col, .deal-amount { display: none; }
}

/* Capital banner */
.dash-capital-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; border-radius: 12px;
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.06) 0%, rgba(124, 58, 237, 0.02) 100%);
  border: 1px solid rgba(124, 58, 237, 0.12);
  cursor: pointer; transition: all 0.15s;
}
.dash-capital-banner:hover {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.1) 0%, rgba(124, 58, 237, 0.04) 100%);
  border-color: rgba(124, 58, 237, 0.2);
}
.dash-capital-banner-icon {
  width: 40px; height: 40px; min-width: 40px; border-radius: 10px;
  background: rgba(124, 58, 237, 0.1); color: #7c3aed;
  display: flex; align-items: center; justify-content: center;
}
.dash-capital-banner-content { flex: 1; }
.dash-capital-banner-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.dash-capital-banner-text {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 1px;
}
.dark .dash-capital-banner {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.1) 0%, rgba(124, 58, 237, 0.04) 100%);
  border-color: rgba(124, 58, 237, 0.2);
}
</style>
