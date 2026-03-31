<script lang="ts" setup>
import { useClientsStore } from '@/stores/clients'
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { formatCurrency, formatDate, formatDateShort, formatPhone, timeAgo } from '@/utils/formatters'
import { DEAL_STATUS_CONFIG, PAYMENT_STATUS_CONFIG } from '@/constants/statuses'
import { type Deal, userName } from '@/types'
import { useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const clientsStore = useClientsStore()
const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()

const pageLoading = ref(true)

onMounted(async () => {
  try {
    await Promise.all([
      dealsStore.fetchDeals(),
      paymentsStore.fetchPayments(),
    ])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки данных')
  } finally {
    pageLoading.value = false
  }
})

const search = ref('')
const expandedClients = ref<string[]>([])

// Deal dialog
const selectedDeal = ref<Deal | null>(null)
const showDialog = ref(false)

const filteredClients = computed(() => {
  if (!search.value) return clientsStore.clientsInfo
  const s = search.value.toLowerCase()
  return clientsStore.clientsInfo.filter(
    (c) =>
      (c.user.firstName + ' ' + c.user.lastName).toLowerCase().includes(s) ||
      c.user.city.toLowerCase().includes(s) ||
      c.user.phone.includes(s)
  )
})

// Summary stats
const stats = computed(() => {
  const clients = clientsStore.clientsInfo
  const totalVolume = clients.reduce((s, c) => s + c.totalVolume, 0)
  const totalProfit = clients.reduce((s, c) => s + c.totalProfit, 0)
  const totalRemaining = clients.reduce((s, c) => s + c.remaining, 0)
  const avgOnTime = clients.length > 0
    ? Math.round(clients.reduce((s, c) => s + c.onTimeRate, 0) / clients.length)
    : 0
  return { count: clients.length, totalVolume, totalProfit, totalRemaining, avgOnTime }
})

function toggleClient(clientId: string) {
  const idx = expandedClients.value.indexOf(clientId)
  if (idx >= 0) expandedClients.value.splice(idx, 1)
  else expandedClients.value.push(clientId)
}

function isExpanded(clientId: string) {
  return expandedClients.value.includes(clientId)
}

function getClientDeals(clientId: string) {
  return dealsStore.investorDeals.filter((d) => d.clientId === clientId)
}

function getScoreColor(rate: number) {
  if (rate >= 90) return '#047857'
  if (rate >= 70) return '#f59e0b'
  return '#ef4444'
}

function getScoreBg(rate: number) {
  if (rate >= 90) return 'rgba(4, 120, 87, 0.1)'
  if (rate >= 70) return 'rgba(245, 158, 11, 0.1)'
  return 'rgba(239, 68, 68, 0.1)'
}

const AVATAR_COLORS = ['#047857', '#3b82f6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ef4444']
function getAvatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}

function getDealProgress(deal: Deal) {
  return deal.numberOfPayments > 0 ? (deal.paidPayments / deal.numberOfPayments) * 100 : 0
}

function openDeal(deal: Deal) {
  selectedDeal.value = deal
  showDialog.value = true
}

function goToDeal(deal: Deal) {
  router.push(`/deals/${deal.id}`)
}

const selectedDealPayments = computed(() => {
  if (!selectedDeal.value) return []
  return paymentsStore.getPaymentsForDeal(selectedDeal.value.id)
})

const selectedDealPaidTotal = computed(() =>
  selectedDealPayments.value.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0)
)
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
    <!-- KPI Cards -->
    <div class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-account-group" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.count }}</div>
          <div class="stat-label">Клиентов</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
          <v-icon icon="mdi-cash-multiple" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(stats.totalVolume) }}</div>
          <div class="stat-label">Общий объём</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
          <v-icon icon="mdi-trending-up" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(stats.totalProfit) }}</div>
          <div class="stat-label">Прибыль</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" :style="{ background: getScoreBg(stats.avgOnTime), color: getScoreColor(stats.avgOnTime) }">
          <v-icon icon="mdi-heart-pulse" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.avgOnTime }}%</div>
          <div class="stat-label">Ср. своевременность</div>
        </div>
      </div>
    </div>

    <!-- Main card -->
    <v-card rounded="lg" elevation="0" border>
      <div class="pa-4">
        <!-- Search -->
        <div class="d-flex align-center ga-3 mb-4">
          <div class="filter-input-wrap" style="max-width: 360px;">
            <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
            <input
              v-model="search"
              type="text"
              placeholder="Поиск по имени, городу, телефону..."
              class="filter-input"
            />
          </div>
          <v-spacer />
          <div class="text-caption text-medium-emphasis">
            {{ filteredClients.length }} из {{ stats.count }}
          </div>
        </div>

        <!-- Client list -->
        <div v-if="filteredClients.length" class="clients-list">
          <div
            v-for="client in filteredClients"
            :key="client.user.id"
            class="client-card"
            :class="{ 'client-card--expanded': isExpanded(client.user.id) }"
          >
            <!-- Client Header -->
            <div class="client-header" @click="toggleClient(client.user.id)">
              <div class="client-avatar" :style="{ background: getAvatarColor(client.user.firstName) }">
                {{ client.user.firstName[0] }}{{ client.user.lastName[0] }}
              </div>

              <div class="client-main">
                <div class="client-name-row">
                  <span class="client-name">{{ client.user.firstName }} {{ client.user.lastName }}</span>
                  <div
                    class="score-badge"
                    :style="{ background: getScoreBg(client.onTimeRate), color: getScoreColor(client.onTimeRate) }"
                  >
                    {{ client.onTimeRate }}%
                  </div>
                  <div class="rating-badge">
                    <v-icon icon="mdi-star" size="12" color="amber" />
                    {{ client.user.rating }}
                  </div>
                  <div v-if="client.user.verificationLevel >= 2" class="verified-badge">
                    <v-icon icon="mdi-shield-check" size="14" color="success" />
                  </div>
                </div>
                <div class="client-meta">
                  {{ client.user.city }} · {{ client.dealCount }} {{ client.dealCount === 1 ? 'сделка' : client.dealCount <= 4 ? 'сделки' : 'сделок' }} · {{ formatPhone(client.user.phone) }}
                </div>
              </div>

              <!-- Desktop stats -->
              <div class="client-stats d-none d-md-flex">
                <div class="client-stat">
                  <div class="client-stat-value">{{ formatCurrency(client.totalVolume) }}</div>
                  <div class="client-stat-label">Объём</div>
                </div>
                <div class="client-stat">
                  <div class="client-stat-value" style="color: #047857;">{{ formatCurrency(client.totalProfit) }}</div>
                  <div class="client-stat-label">Прибыль</div>
                </div>
                <div class="client-stat">
                  <div class="client-stat-value" style="color: #f59e0b;">{{ formatCurrency(client.remaining) }}</div>
                  <div class="client-stat-label">Остаток</div>
                </div>
              </div>

              <div class="expand-icon">
                <v-icon :icon="isExpanded(client.user.id) ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="20" />
              </div>
            </div>

            <!-- Expanded content -->
            <v-expand-transition>
              <div v-if="isExpanded(client.user.id)" class="client-expanded">
                <!-- Mobile stats -->
                <div class="client-stats-mobile d-md-none">
                  <div class="client-stat-m">
                    <div class="client-stat-m-label">Объём</div>
                    <div class="client-stat-m-value">{{ formatCurrency(client.totalVolume) }}</div>
                  </div>
                  <div class="client-stat-m">
                    <div class="client-stat-m-label">Прибыль</div>
                    <div class="client-stat-m-value" style="color: #047857;">{{ formatCurrency(client.totalProfit) }}</div>
                  </div>
                  <div class="client-stat-m">
                    <div class="client-stat-m-label">Остаток</div>
                    <div class="client-stat-m-value" style="color: #f59e0b;">{{ formatCurrency(client.remaining) }}</div>
                  </div>
                </div>

                <!-- Payment timeliness bar -->
                <div class="ontime-bar mb-4">
                  <div class="d-flex justify-space-between align-center mb-2">
                    <span class="ontime-label">Своевременность платежей</span>
                    <span class="ontime-value" :style="{ color: getScoreColor(client.onTimeRate) }">{{ client.onTimeRate }}%</span>
                  </div>
                  <div class="ontime-track">
                    <div
                      class="ontime-fill"
                      :style="{
                        width: client.onTimeRate + '%',
                        background: getScoreColor(client.onTimeRate),
                      }"
                    />
                  </div>
                </div>

                <!-- Next payment -->
                <div v-if="client.nextPaymentDate" class="next-payment mb-4">
                  <v-icon icon="mdi-calendar-clock" size="16" />
                  <span>Ближайший платёж: <strong>{{ formatDate(client.nextPaymentDate) }}</strong></span>
                </div>

                <!-- Deals -->
                <div class="deals-section-title">Сделки</div>
                <div class="deal-list">
                  <div
                    v-for="deal in getClientDeals(client.user.id)"
                    :key="deal.id"
                    class="deal-item"
                    @click.stop="openDeal(deal)"
                  >
                    <v-avatar size="40" rounded="lg" class="deal-photo">
                      <v-img :src="deal.productPhotos?.[0]" cover />
                    </v-avatar>
                    <div class="deal-info">
                      <div class="deal-product">{{ deal.productName }}</div>
                      <div class="deal-price">{{ formatCurrency(deal.totalPrice) }}</div>
                    </div>
                    <div class="deal-progress-col">
                      <div class="deal-progress-text">{{ deal.paidPayments }} / {{ deal.numberOfPayments }}</div>
                      <v-progress-linear
                        :model-value="getDealProgress(deal)"
                        color="primary"
                        rounded
                        height="4"
                        style="width: 80px;"
                      />
                    </div>
                    <div
                      class="deal-status-chip"
                      :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])"
                    >
                      {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                    </div>
                    <v-icon icon="mdi-chevron-right" size="18" class="deal-chevron" />
                  </div>
                </div>
              </div>
            </v-expand-transition>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="text-center pa-12">
          <v-icon icon="mdi-account-group-outline" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Нет клиентов</p>
          <p class="text-body-2 text-medium-emphasis">
            {{ search ? 'Попробуйте изменить параметры поиска' : 'Клиенты появятся после создания сделок' }}
          </p>
        </div>
      </div>
    </v-card>

    <!-- Deal Detail Dialog -->
    <v-dialog v-model="showDialog" max-width="680" scrollable>
      <v-card v-if="selectedDeal" rounded="lg">
        <!-- Header with photo -->
        <div class="dialog-hero">
          <v-img :src="selectedDeal.productPhotos[0]" height="180" cover class="dialog-hero-img" />
          <div class="dialog-hero-overlay" />
          <button class="dialog-close" @click="showDialog = false">
            <v-icon icon="mdi-close" size="20" />
          </button>
          <div class="dialog-hero-content">
            <div
              class="dialog-status"
              :style="{ background: DEAL_STATUS_CONFIG[selectedDeal.status]?.color }"
            >
              {{ DEAL_STATUS_CONFIG[selectedDeal.status]?.label }}
            </div>
            <div class="dialog-title">{{ selectedDeal.productName }}</div>
          </div>
        </div>

        <v-card-text class="pa-5">
          <!-- Client & Date row -->
          <div class="d-flex align-center ga-3 mb-5">
            <div class="dialog-avatar" :style="{ background: '#3b82f6' }">
              {{ userName(selectedDeal.client).charAt(0) }}
            </div>
            <div>
              <div class="font-weight-medium">{{ userName(selectedDeal.client) }}</div>
              <div class="text-caption text-medium-emphasis">
                Рейтинг {{ selectedDeal.client?.rating ?? 0 }} · Создано {{ formatDate(selectedDeal.createdAt) }}
              </div>
            </div>
          </div>

          <!-- Financial grid -->
          <div class="dialog-finance-grid mb-5">
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Закупочная</div>
              <div class="dialog-finance-value">{{ formatCurrency(selectedDeal.purchasePrice) }}</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Итого</div>
              <div class="dialog-finance-value font-weight-bold">{{ formatCurrency(selectedDeal.totalPrice) }}</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Наценка</div>
              <div class="dialog-finance-value" style="color: #047857;">+{{ formatCurrency(selectedDeal.markup) }} ({{ selectedDeal.markupPercent }}%)</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Оплачено</div>
              <div class="dialog-finance-value" style="color: #047857;">{{ formatCurrency(selectedDealPaidTotal) }}</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Остаток</div>
              <div class="dialog-finance-value" style="color: #f59e0b;">{{ formatCurrency(selectedDeal.remainingAmount) }}</div>
            </div>
          </div>

          <!-- Progress -->
          <div class="mb-5">
            <div class="d-flex justify-space-between align-center mb-2">
              <span class="text-body-2 font-weight-medium">Прогресс платежей</span>
              <span class="text-caption text-medium-emphasis">{{ selectedDeal.paidPayments }} из {{ selectedDeal.numberOfPayments }}</span>
            </div>
            <v-progress-linear
              :model-value="getDealProgress(selectedDeal)"
              color="primary"
              rounded
              height="8"
            />
          </div>

          <!-- Link to full page -->
          <button class="detail-link-btn mb-5" @click="showDialog = false; goToDeal(selectedDeal!)">
            <v-icon icon="mdi-open-in-new" size="16" />
            Открыть полную страницу сделки
          </button>

          <!-- Payment schedule -->
          <div v-if="selectedDealPayments.length">
            <div class="text-body-2 font-weight-bold mb-3">График платежей</div>
            <div class="schedule-list">
              <div
                v-for="p in selectedDealPayments"
                :key="p.id"
                class="schedule-item"
                :class="{ 'schedule-item--paid': p.status === 'PAID', 'schedule-item--overdue': p.status === 'OVERDUE' }"
              >
                <div class="schedule-num">{{ p.number }}</div>
                <div class="schedule-info">
                  <div class="schedule-date">{{ formatDateShort(p.dueDate) }}</div>
                  <div v-if="p.paidAt" class="schedule-paid-at">Оплачено {{ formatDateShort(p.paidAt) }}</div>
                </div>
                <div class="schedule-amount">{{ formatCurrency(p.amount) }}</div>
                <div
                  class="schedule-status"
                  :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])"
                >
                  {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                </div>
              </div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
    </template>
  </div>
</template>

<style scoped>
/* Stats row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .stats-row { grid-template-columns: 1fr; } }

.stat-card {
  display: flex; align-items: center; gap: 12px;
  padding: 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.stat-icon {
  width: 40px; height: 40px; min-width: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.stat-value {
  font-size: 18px; font-weight: 700; line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.stat-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Filter inputs */
.filter-input-wrap { position: relative; flex: 1; }
.filter-input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #9ca3af; pointer-events: none;
}
.filter-input {
  width: 100%; height: 40px; padding: 0 16px 0 38px;
  border: 1px solid #e4e4e7; border-radius: 10px;
  background: #f4f4f5; font-size: 14px; color: inherit;
  outline: none; transition: all 0.15s ease;
}
.filter-input::placeholder { color: #9ca3af; }
.filter-input:focus {
  border-color: #047857; background: #fff;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}

/* Client list */
.clients-list {
  display: flex; flex-direction: column; gap: 8px;
}

.client-card {
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.client-card:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.14);
}
.client-card--expanded {
  border-color: rgba(4, 120, 87, 0.2);
  box-shadow: 0 2px 12px rgba(4, 120, 87, 0.06);
}

/* Client header */
.client-header {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 20px;
  cursor: pointer;
  transition: background 0.15s;
}
.client-header:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}

.client-avatar {
  width: 44px; height: 44px; min-width: 44px;
  border-radius: 12px; color: #fff;
  font-size: 15px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}

.client-main { flex: 1; min-width: 0; }

.client-name-row {
  display: flex; align-items: center; gap: 8px;
  flex-wrap: wrap;
}
.client-name {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.score-badge {
  font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 6px;
}
.rating-badge {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 2px 8px; border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.verified-badge {
  display: inline-flex; align-items: center;
}

.client-meta {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}

/* Desktop stats */
.client-stats {
  display: flex; gap: 24px; margin-right: 8px;
}
.client-stat { text-align: right; }
.client-stat-value {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
}
.client-stat-label {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

.expand-icon {
  width: 32px; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.35);
  transition: all 0.15s;
}
.client-header:hover .expand-icon {
  color: rgba(var(--v-theme-on-surface), 0.6);
  background: rgba(var(--v-theme-on-surface), 0.05);
}

/* Expanded content */
.client-expanded {
  padding: 0 20px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  padding-top: 16px;
}

/* Mobile stats */
.client-stats-mobile {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 8px; margin-bottom: 16px;
}
.client-stat-m {
  padding: 10px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  text-align: center;
}
.client-stat-m-label {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.client-stat-m-value {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* On-time bar */
.ontime-bar { }
.ontime-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ontime-value {
  font-size: 14px; font-weight: 700;
}
.ontime-track {
  width: 100%; height: 6px; border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  overflow: hidden;
}
.ontime-fill {
  height: 100%; border-radius: 3px;
  transition: width 0.3s ease;
}

/* Next payment */
.next-payment {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(4, 120, 87, 0.04);
  border: 1px solid rgba(4, 120, 87, 0.1);
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.next-payment .v-icon { color: #047857; }

/* Deals section */
.deals-section-title {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase; letter-spacing: 0.03em;
  margin-bottom: 8px;
}

.deal-list {
  display: flex; flex-direction: column; gap: 4px;
}

.deal-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.deal-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.deal-photo { flex-shrink: 0; }

.deal-info { flex: 1; min-width: 0; }
.deal-product {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.deal-price {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.deal-progress-col {
  display: flex; flex-direction: column; align-items: flex-end;
  gap: 4px; flex-shrink: 0;
}
.deal-progress-text {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.deal-status-chip {
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px;
  white-space: nowrap; flex-shrink: 0;
}

.deal-chevron {
  color: rgba(var(--v-theme-on-surface), 0.25);
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .deal-progress-col { display: none; }
}

/* Dialog */
.dialog-hero { position: relative; overflow: hidden; }
.dialog-hero-img { display: block; }
.dialog-hero-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%);
}
.dialog-close {
  position: absolute; top: 12px; right: 12px; z-index: 2;
  width: 32px; height: 32px; border-radius: 8px;
  background: rgba(0,0,0,0.4); border: none;
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.dialog-close:hover { background: rgba(0,0,0,0.6); }
.dialog-hero-content {
  position: absolute; bottom: 16px; left: 20px; right: 20px; z-index: 2;
}
.dialog-status {
  display: inline-block; font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px; color: #fff; margin-bottom: 6px;
}
.dialog-title {
  font-size: 20px; font-weight: 700; color: #fff; line-height: 1.2;
}
.dialog-avatar {
  width: 36px; height: 36px; min-width: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 14px;
}
.dialog-finance-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 600px) { .dialog-finance-grid { grid-template-columns: repeat(2, 1fr); } }
.dialog-finance-item {
  padding: 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.dialog-finance-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 2px;
}
.dialog-finance-value {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Schedule */
.schedule-list { display: flex; flex-direction: column; gap: 4px; }
.schedule-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 8px;
  transition: background 0.15s;
}
.schedule-item:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.schedule-item--paid { opacity: 0.65; }
.schedule-item--overdue { background: rgba(239, 68, 68, 0.04); }
.schedule-num {
  width: 24px; height: 24px; min-width: 24px;
  border-radius: 6px; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.schedule-info { flex: 1; min-width: 0; }
.schedule-date {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.schedule-paid-at {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.schedule-amount {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
}
.schedule-status {
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px; white-space: nowrap;
}

/* Detail link */
.detail-link-btn {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 10px 16px; border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.04);
  color: rgb(var(--v-theme-primary));
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  justify-content: center;
}
.detail-link-btn:hover {
  background: rgba(var(--v-theme-primary), 0.1);
  border-color: rgba(var(--v-theme-primary), 0.5);
}

/* Dark mode */
.dark .stat-card {
  background: #1e1e2e; border-color: #2e2e42;
}
.dark .client-card {
  background: #1e1e2e; border-color: #2e2e42;
}
.dark .client-card--expanded {
  border-color: rgba(4, 120, 87, 0.3);
}
.dark .filter-input {
  background: #252538; border-color: #2e2e42; color: #e4e4e7;
}
.dark .filter-input::placeholder { color: #71717a; }
.dark .filter-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .dialog-finance-item { background: rgba(255, 255, 255, 0.04); }
.dark .next-payment {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.18);
}
</style>
