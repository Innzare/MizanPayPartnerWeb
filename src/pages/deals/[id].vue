<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { useClientsStore } from '@/stores/clients'
import { formatCurrency, formatDate, formatDateShort, formatMonths, formatPercent, formatPhone, timeAgo } from '@/utils/formatters'
import { DEAL_STATUS_CONFIG, PAYMENT_STATUS_CONFIG } from '@/constants/statuses'
import { userName, type Deal } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { generateContract } from '@/utils/contractPdf'
import { useRoute, useRouter } from 'vue-router'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler)

const route = useRoute()
const router = useRouter()
const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()
const clientsStore = useClientsStore()

const authStore = useAuthStore()
const dealId = computed(() => route.params.id as string)

onMounted(async () => {
  await Promise.all([
    dealsStore.fetchDeal(dealId.value),
    paymentsStore.fetchPaymentsForDeal(dealId.value),
  ])
})

const deal = computed(() => dealsStore.getDeal(dealId.value))
const payments = computed(() => paymentsStore.getPaymentsForDeal(dealId.value))

// Client info from deal's nested client object
const client = computed(() => deal.value?.client || null)

const clientInfo = computed(() => {
  if (!deal.value) return null
  return clientsStore.clientsInfo.find(c => c.user.id === deal.value!.clientId) || null
})

// Financial calculations
const paidTotal = computed(() =>
  payments.value.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0)
)
const totalPaid = computed(() => paidTotal.value)
const progress = computed(() =>
  deal.value && deal.value.numberOfPayments > 0
    ? (deal.value.paidPayments / deal.value.numberOfPayments) * 100 : 0
)

// Payment timeline chart
const paymentChartData = computed(() => {
  if (!payments.value.length) return { labels: [], datasets: [] }

  return {
    labels: payments.value.map(p => formatDateShort(p.dueDate)),
    datasets: [{
      label: 'Остаток',
      data: payments.value.map(p => p.remainingAfter),
      borderColor: '#047857',
      backgroundColor: 'rgba(4, 120, 87, 0.06)',
      borderWidth: 2.5,
      pointBackgroundColor: payments.value.map(p =>
        p.status === 'PAID' ? '#047857' : p.status === 'OVERDUE' ? '#ef4444' : '#f59e0b'
      ),
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 7,
      fill: true,
      tension: 0.3,
    }]
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `Остаток: ${(ctx.parsed.y ?? 0).toLocaleString('ru-RU')} ₽`
      }
    }
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    y: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: {
        font: { size: 11 },
        callback: (v: any) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v),
      },
    }
  }
}

// Next payment
const nextPayment = computed(() =>
  payments.value.find(p => p.status === 'PENDING' || p.status === 'OVERDUE')
)

// Reschedule dialog
const rescheduleDialog = ref(false)
const rescheduleTarget = ref<typeof payments.value[0] | null>(null)
const rescheduleDate = ref('')
const rescheduleReason = ref('')

const rescheduleReasonOptions = [
  'Клиент попросил отсрочку',
  'Задержка зарплаты клиента',
  'По договорённости сторон',
  'Другая причина',
]

const minRescheduleDate = computed(() => {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.toISOString().slice(0, 10)
})

function openReschedule(p: typeof payments.value[0]) {
  rescheduleTarget.value = p
  const d = new Date(p.dueDate)
  d.setDate(d.getDate() + 7)
  rescheduleDate.value = d.toISOString().slice(0, 10)
  rescheduleReason.value = ''
  rescheduleDialog.value = true
}

function confirmReschedule() {
  if (!rescheduleTarget.value || !rescheduleDate.value) return
  paymentsStore.reschedulePayment(
    rescheduleTarget.value.id,
    rescheduleTarget.value.dealId,
    new Date(rescheduleDate.value).toISOString(),
    rescheduleReason.value || undefined,
  )
  rescheduleDialog.value = false
  rescheduleTarget.value = null
}

function markPaid(p: typeof payments.value[0]) {
  paymentsStore.markAsPaid(p.id, p.dealId)
}

// Status progression for investor — only ACTIVE deals can transition
const STATUS_ACTIONS: Record<string, { nextStatus: Deal['status']; label: string; icon: string; color: string }> = {
  ACTIVE: { nextStatus: 'COMPLETED', label: 'Завершить сделку', icon: 'mdi-check-decagram', color: '#047857' },
}

const statusAction = computed(() => deal.value ? STATUS_ACTIONS[deal.value.status] : null)
const statusDialog = ref(false)
const statusUpdating = ref(false)

function openStatusDialog() {
  statusDialog.value = true
}

async function confirmStatusChange() {
  if (!deal.value || !statusAction.value) return
  statusUpdating.value = true
  try {
    await dealsStore.updateDealStatus(deal.value.id, statusAction.value.nextStatus)
    statusDialog.value = false
  } catch (e: any) {
    console.error('Status update failed:', e)
  } finally {
    statusUpdating.value = false
  }
}

function downloadContract() {
  console.log('downloadContract called', { deal: !!deal.value, user: !!authStore.user })
  if (!deal.value) return
  const investor = authStore.user || {} as Partial<import('@/types').User>
  generateContract(deal.value, payments.value, investor)
}

// Deal timeline events
const timeline = computed(() => {
  if (!deal.value) return []
  const events = [
    { date: deal.value.createdAt, label: 'Сделка создана', icon: 'mdi-plus-circle', color: '#64748b' },
  ]
  payments.value.filter(p => p.status === 'PAID' && p.paidAt).forEach(p => {
    events.push({ date: p.paidAt!, label: `Платёж #${p.number} — ${formatCurrency(p.amount)}`, icon: 'mdi-check-circle', color: '#047857' })
  })

  if (deal.value.completedAt) events.push({ date: deal.value.completedAt, label: 'Сделка завершена', icon: 'mdi-flag-checkered', color: '#047857' })

  return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
})
</script>

<template>
  <div class="at-page">
    <!-- Back button -->
    <button class="back-btn mb-4" @click="router.push('/deals')">
      <v-icon icon="mdi-arrow-left" size="18" />
      Назад к портфелю
    </button>

    <div v-if="deal">
      <!-- Hero -->
      <div class="detail-hero mb-6">
        <v-img :src="deal.productPhotos[0]" height="220" cover class="detail-hero-img" />
        <div class="detail-hero-overlay" />
        <div class="detail-hero-content">
          <div
            class="detail-hero-status"
            :style="{ background: DEAL_STATUS_CONFIG[deal.status]?.color }"
          >
            {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
          </div>
          <h1 class="detail-hero-title">{{ deal.productName }}</h1>
          <div class="detail-hero-meta">
            <v-icon icon="mdi-account" size="16" /> {{ userName(deal.client) }}
            <span class="mx-2">·</span>
            Создано {{ formatDate(deal.createdAt) }}
          </div>
        </div>
      </div>

      <!-- Status action banner -->
      <div v-if="statusAction" class="status-action-banner mb-6" :style="{ borderColor: statusAction.color + '40' }">
        <div class="status-action-info">
          <v-icon :icon="statusAction.icon" size="22" :color="statusAction.color" />
          <div>
            <div class="status-action-title">Следующий шаг</div>
            <div class="status-action-label">{{ statusAction.label }}</div>
          </div>
        </div>
        <button class="status-action-btn" :style="{ background: statusAction.color }" @click="openStatusDialog">
          {{ statusAction.label }}
          <v-icon icon="mdi-arrow-right" size="16" />
        </button>
      </div>

      <v-row>
        <!-- Left column -->
        <v-col cols="12" lg="8">
          <!-- Finance cards -->
          <div class="finance-grid mb-6">
            <div class="finance-card">
              <div class="finance-label">Закупочная цена</div>
              <div class="finance-value">{{ formatCurrency(deal.purchasePrice) }}</div>
            </div>
            <div class="finance-card">
              <div class="finance-label">Итоговая цена</div>
              <div class="finance-value finance-value--lg">{{ formatCurrency(deal.totalPrice) }}</div>
            </div>
            <div class="finance-card">
              <div class="finance-label">Наценка</div>
              <div class="finance-value" style="color: #047857;">+{{ formatCurrency(deal.markup) }} ({{ formatPercent(deal.markupPercent) }})</div>
            </div>
            <div class="finance-card">
              <div class="finance-label">Оплачено</div>
              <div class="finance-value" style="color: #047857;">{{ formatCurrency(totalPaid) }}</div>
            </div>
            <div class="finance-card">
              <div class="finance-label">Остаток</div>
              <div class="finance-value" style="color: #f59e0b;">{{ formatCurrency(deal.remainingAmount) }}</div>
            </div>
          </div>

          <!-- Progress -->
          <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="d-flex justify-space-between align-center mb-3">
              <div>
                <div class="section-title">Прогресс</div>
                <div class="section-subtitle">{{ deal.paidPayments }} из {{ deal.numberOfPayments }} платежей · {{ formatMonths(deal.numberOfPayments) }}</div>
              </div>
              <div class="progress-percent">{{ Math.round(progress) }}%</div>
            </div>
            <v-progress-linear :model-value="progress" color="primary" rounded height="10" />
          </v-card>

          <!-- Payment chart -->
          <v-card v-if="payments.length" rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="d-flex align-center justify-space-between mb-2">
              <div>
                <div class="section-title">Динамика остатка</div>
                <div class="section-subtitle">Изменение остатка по платежам</div>
              </div>
              <div class="d-flex align-center ga-3">
                <div class="d-flex align-center ga-1">
                  <div style="width: 8px; height: 8px; border-radius: 50%; background: #047857;" />
                  <span class="section-subtitle">Оплачено</span>
                </div>
                <div class="d-flex align-center ga-1">
                  <div style="width: 8px; height: 8px; border-radius: 50%; background: #f59e0b;" />
                  <span class="section-subtitle">Ожидается</span>
                </div>
              </div>
            </div>
            <div style="height: 220px;">
              <Line :data="paymentChartData" :options="chartOptions" />
            </div>
          </v-card>

          <!-- Payment schedule -->
          <v-card v-if="payments.length" rounded="lg" elevation="0" border class="mb-6">
            <div class="pa-5 pb-0">
              <div class="section-title">График платежей</div>
              <div class="section-subtitle mb-4">Полный список по сделке</div>
            </div>

            <v-table density="default" class="schedule-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Дата</th>
                  <th class="text-end">Сумма</th>
                  <th class="text-end">Остаток после</th>
                  <th>Оплачено</th>
                  <th>Статус</th>
                  <th class="text-center">Действия</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in payments"
                  :key="p.id"
                  :class="{ 'row-paid': p.status === 'PAID', 'row-overdue': p.status === 'OVERDUE' }"
                >
                  <td class="font-weight-medium">{{ p.number }}</td>
                  <td>
                    {{ formatDate(p.dueDate) }}
                    <div v-if="p.rescheduledFrom" class="rescheduled-hint">
                      <v-icon icon="mdi-calendar-arrow-right" size="12" />
                      было {{ formatDate(p.rescheduledFrom) }}
                    </div>
                  </td>
                  <td class="text-end font-weight-bold text-no-wrap">{{ formatCurrency(p.amount) }}</td>
                  <td class="text-end text-medium-emphasis text-no-wrap">{{ formatCurrency(p.remainingAfter) }}</td>
                  <td class="text-medium-emphasis">{{ p.paidAt ? formatDate(p.paidAt) : '—' }}</td>
                  <td>
                    <div
                      class="pay-status"
                      :style="{ background: PAYMENT_STATUS_CONFIG[p.status]?.bgLight, color: PAYMENT_STATUS_CONFIG[p.status]?.color }"
                    >
                      {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                    </div>
                  </td>
                  <td class="text-center">
                    <div v-if="p.status !== 'PAID'" class="d-flex align-center justify-center ga-1">
                      <button class="action-btn action-btn--success" title="Отметить оплаченным" @click="markPaid(p)">
                        <v-icon icon="mdi-check" size="16" />
                      </button>
                      <button class="action-btn action-btn--warning" title="Перенести дату" @click="openReschedule(p)">
                        <v-icon icon="mdi-calendar-clock" size="16" />
                      </button>
                    </div>
                    <span v-else class="text-medium-emphasis">—</span>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card>
        </v-col>

        <!-- Right column -->
        <v-col cols="12" lg="4">
          <!-- Client card -->
          <v-card v-if="client" rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="section-title mb-4">Клиент</div>

            <div class="d-flex align-center ga-3 mb-4">
              <div class="client-avatar">{{ (client.firstName || '')[0] || '' }}{{ (client.lastName || '')[0] || '' }}</div>
              <div>
                <div class="font-weight-bold">{{ userName(client) }}</div>
                <div class="text-caption text-medium-emphasis">{{ client.city || '' }}</div>
              </div>
            </div>

            <div class="client-info-grid">
              <div class="client-info-item">
                <v-icon icon="mdi-star" size="16" color="warning" />
                <div>
                  <div class="client-info-label">Рейтинг</div>
                  <div class="client-info-value">{{ client.rating ?? 0 }}</div>
                </div>
              </div>
              <div class="client-info-item">
                <v-icon icon="mdi-check-decagram" size="16" color="primary" />
                <div>
                  <div class="client-info-label">Завершено</div>
                  <div class="client-info-value">{{ client.completedDeals ?? 0 }} сделок</div>
                </div>
              </div>
              <div v-if="client.phone" class="client-info-item">
                <v-icon icon="mdi-phone" size="16" color="info" />
                <div>
                  <div class="client-info-label">Телефон</div>
                  <div class="client-info-value">{{ formatPhone(client.phone) }}</div>
                </div>
              </div>
            </div>

            <div v-if="clientInfo" class="mt-4">
              <div class="client-info-label mb-1">Своевременность платежей</div>
              <div class="d-flex align-center ga-2">
                <v-progress-linear
                  :model-value="clientInfo.onTimeRate"
                  :color="clientInfo.onTimeRate >= 90 ? 'success' : clientInfo.onTimeRate >= 70 ? 'warning' : 'error'"
                  rounded height="6" class="flex-grow-1"
                />
                <span class="text-caption font-weight-bold">{{ clientInfo.onTimeRate }}%</span>
              </div>
            </div>
          </v-card>

          <!-- Contract download -->
          <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="d-flex align-center justify-space-between">
              <div class="d-flex align-center ga-3">
                <div class="contract-icon">
                  <v-icon icon="mdi-file-document-outline" size="22" color="#3b82f6" />
                </div>
                <div>
                  <div class="font-weight-bold" style="font-size: 14px;">Договор мурабаха</div>
                  <div class="text-caption text-medium-emphasis">PDF с условиями и графиком</div>
                </div>
              </div>
              <button class="contract-download-btn" @click="downloadContract">
                <v-icon icon="mdi-download" size="18" />
                Скачать
              </button>
            </div>
          </v-card>

          <!-- Deal info card -->
          <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="section-title mb-4">Условия сделки</div>

            <div class="deal-detail-list">
              <div class="deal-detail-row">
                <span class="deal-detail-label">Интервал</span>
                <span class="deal-detail-val">{{ deal.paymentInterval === 'MONTHLY' ? 'Ежемесячно' : deal.paymentInterval === 'BIWEEKLY' ? 'Раз в 2 недели' : 'Еженедельно' }}</span>
              </div>
              <div class="deal-detail-row">
                <span class="deal-detail-label">Тип платежей</span>
                <span class="deal-detail-val">{{ deal.paymentType === 'EQUAL' ? 'Равные' : deal.paymentType === 'DECREASING' ? 'Убывающие' : 'Произвольные' }}</span>
              </div>
              <div class="deal-detail-row">
                <span class="deal-detail-label">Первый платёж</span>
                <span class="deal-detail-val">{{ formatDate(deal.firstPaymentDate) }}</span>
              </div>
              <div v-if="deal.completedAt" class="deal-detail-row">
                <span class="deal-detail-label">Завершена</span>
                <span class="deal-detail-val">{{ formatDate(deal.completedAt) }}</span>
              </div>
              <div class="deal-detail-row">
                <span class="deal-detail-label">Последнее обновление</span>
                <span class="deal-detail-val">{{ timeAgo(deal.updatedAt) }}</span>
              </div>
            </div>
          </v-card>

          <!-- Timeline -->
          <v-card rounded="lg" elevation="0" border class="pa-5">
            <div class="section-title mb-4">История</div>

            <div class="timeline">
              <div v-for="(event, i) in timeline" :key="i" class="timeline-item">
                <div class="timeline-dot" :style="{ background: event.color }" />
                <div class="timeline-line" v-if="i < timeline.length - 1" />
                <div class="timeline-content">
                  <div class="timeline-label">{{ event.label }}</div>
                  <div class="timeline-date">{{ formatDate(event.date) }}</div>
                </div>
              </div>
            </div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Reschedule dialog -->
      <v-dialog v-model="rescheduleDialog" max-width="480" content-class="reschedule-dialog">
        <v-card rounded="lg" class="pa-6">
          <button class="dialog-close-sm" @click="rescheduleDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>

          <div class="text-h6 font-weight-bold mb-1">Перенос платежа</div>
          <div class="text-caption text-medium-emphasis mb-5">Выберите новую дату и укажите причину</div>

          <div v-if="rescheduleTarget" class="reschedule-info mb-5">
            <div class="d-flex justify-space-between mb-1">
              <span class="text-caption text-medium-emphasis">Платёж #{{ rescheduleTarget.number }}</span>
              <span class="font-weight-bold">{{ formatCurrency(rescheduleTarget.amount) }}</span>
            </div>
            <div class="d-flex justify-space-between">
              <span class="text-caption text-medium-emphasis">Текущая дата</span>
              <span>{{ formatDate(rescheduleTarget.dueDate) }}</span>
            </div>
          </div>

          <div class="mb-4">
            <label class="field-label">Новая дата</label>
            <input type="date" v-model="rescheduleDate" :min="minRescheduleDate" class="field-input" />
          </div>

          <div class="mb-5">
            <label class="field-label">Причина</label>
            <div class="d-flex flex-wrap ga-2 mb-3">
              <button
                v-for="opt in rescheduleReasonOptions"
                :key="opt"
                class="reason-chip"
                :class="{ active: rescheduleReason === opt }"
                @click="rescheduleReason = rescheduleReason === opt ? '' : opt"
              >
                {{ opt }}
              </button>
            </div>
            <textarea
              v-if="rescheduleReason === 'Другая причина'"
              v-model="rescheduleReason"
              placeholder="Опишите причину..."
              class="field-input"
              rows="2"
            />
          </div>

          <div class="d-flex ga-3">
            <button class="btn-secondary flex-grow-1" @click="rescheduleDialog = false">Отмена</button>
            <button class="btn-primary flex-grow-1" :disabled="!rescheduleDate" @click="confirmReschedule">
              Перенести
            </button>
          </div>
        </v-card>
      </v-dialog>

      <!-- Status change dialog -->
      <v-dialog v-model="statusDialog" max-width="420">
        <v-card rounded="lg" class="pa-6 text-center">
          <div v-if="statusAction" class="status-dialog-icon mb-4" :style="{ background: statusAction.color + '18' }">
            <v-icon :icon="statusAction.icon" size="28" :color="statusAction.color" />
          </div>
          <h3 class="text-h6 font-weight-bold mb-2">Подтвердите действие</h3>
          <p class="text-body-2 text-medium-emphasis mb-6">
            {{ statusAction?.label }}? Статус сделки изменится на
            <strong>{{ statusAction ? DEAL_STATUS_CONFIG[statusAction.nextStatus]?.label : '' }}</strong>.
          </p>
          <div class="d-flex ga-3">
            <button class="btn-secondary flex-grow-1" @click="statusDialog = false">Отмена</button>
            <button
              class="btn-primary flex-grow-1"
              :style="statusAction ? { background: statusAction.color } : {}"
              :disabled="statusUpdating"
              @click="confirmStatusChange"
            >
              <v-progress-circular v-if="statusUpdating" indeterminate size="16" width="2" color="white" class="mr-2" />
              Подтвердить
            </button>
          </div>
        </v-card>
      </v-dialog>
    </div>

    <!-- Not found -->
    <div v-else class="text-center pa-12">
      <v-icon icon="mdi-alert-circle-outline" size="56" color="grey-lighten-1" class="mb-3" />
      <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Сделка не найдена</p>
      <v-btn variant="tonal" color="primary" class="mt-4" @click="router.push('/deals')">
        Вернуться к портфелю
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.back-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Hero */
.detail-hero {
  position: relative; border-radius: 16px; overflow: hidden;
}
.detail-hero-img { display: block; }
.detail-hero-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.1) 50%, transparent 100%);
}
.detail-hero-content {
  position: absolute; bottom: 24px; left: 28px; right: 28px; z-index: 2; color: #fff;
}
.detail-hero-status {
  display: inline-block; font-size: 12px; font-weight: 600;
  padding: 4px 12px; border-radius: 6px; color: #fff; margin-bottom: 8px;
}
.detail-hero-title {
  font-size: 28px; font-weight: 700; line-height: 1.2; margin-bottom: 6px;
}
.detail-hero-meta {
  font-size: 14px; opacity: 0.8;
  display: flex; align-items: center; gap: 4px;
}

/* Finance grid */
.finance-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 768px) { .finance-grid { grid-template-columns: repeat(2, 1fr); } }

.finance-card {
  padding: 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.finance-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 4px;
}
.finance-value {
  font-size: 17px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.finance-value--lg { font-size: 20px; }

/* Section titles */
.section-title {
  font-size: 16px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.section-subtitle {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.progress-percent {
  font-size: 24px; font-weight: 700; color: rgb(var(--v-theme-primary));
}

/* Schedule table */
.schedule-table :deep(td) { font-size: 14px; }
.schedule-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}
.row-paid { opacity: 0.55; }
.row-overdue { background: rgba(239, 68, 68, 0.04); }
.pay-status {
  display: inline-block; font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px; white-space: nowrap;
}

/* Client card */
.client-avatar {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  background: #3b82f6; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 15px;
}
.client-info-grid {
  display: flex; flex-direction: column; gap: 12px;
}
.client-info-item {
  display: flex; align-items: center; gap: 10px;
}
.client-info-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.client-info-value {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Deal details list */
.deal-detail-list {
  display: flex; flex-direction: column; gap: 10px;
}
.deal-detail-row {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.deal-detail-row:last-child { border-bottom: none; padding-bottom: 0; }
.deal-detail-label {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.deal-detail-val {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Timeline */
.timeline { position: relative; }
.timeline-item {
  display: flex; gap: 12px; position: relative;
  padding-bottom: 20px;
}
.timeline-item:last-child { padding-bottom: 0; }
.timeline-dot {
  width: 10px; height: 10px; min-width: 10px; border-radius: 50%;
  margin-top: 4px; z-index: 1;
}
.timeline-line {
  position: absolute; left: 4px; top: 18px; bottom: 0;
  width: 2px; background: rgba(var(--v-theme-on-surface), 0.08);
}
.timeline-label {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.timeline-date {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Action buttons */
.action-btn {
  width: 30px; height: 30px; border-radius: 8px; border: none;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.action-btn--success {
  background: rgba(4, 120, 87, 0.08); color: #047857;
}
.action-btn--success:hover {
  background: rgba(4, 120, 87, 0.18);
}
.action-btn--warning {
  background: rgba(245, 158, 11, 0.08); color: #f59e0b;
}
.action-btn--warning:hover {
  background: rgba(245, 158, 11, 0.18);
}

/* Rescheduled hint */
.rescheduled-hint {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: #f59e0b; margin-top: 2px;
  text-decoration: line-through;
  text-decoration-color: rgba(245, 158, 11, 0.4);
}

/* Reschedule dialog */
.dialog-close-sm {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.dialog-close-sm:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
}
.reschedule-info {
  padding: 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.field-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none; resize: vertical;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: border-color 0.15s;
}
.field-input:focus {
  border-color: #047857;
}
.reason-chip {
  padding: 6px 14px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 13px; cursor: pointer; transition: all 0.15s;
}
.reason-chip:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
}
.reason-chip.active {
  background: rgba(4, 120, 87, 0.1); color: #047857; font-weight: 500;
}
.btn-primary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #065f46; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

/* Contract download */
.contract-icon {
  width: 40px; height: 40px; border-radius: 10px;
  background: rgba(59, 130, 246, 0.08);
  display: flex; align-items: center; justify-content: center;
}
.contract-download-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 8px; border: none;
  background: #3b82f6; color: #fff;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.contract-download-btn:hover { background: #2563eb; }

/* Status action banner */
.status-action-banner {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-radius: 12px;
  border: 1px solid; gap: 16px;
  background: rgba(var(--v-theme-surface), 1);
}
.status-action-info {
  display: flex; align-items: center; gap: 12px;
}
.status-action-title {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.status-action-label {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.status-action-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 20px; border-radius: 10px; border: none;
  color: #fff; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.status-action-btn:hover { opacity: 0.9; }

/* Status dialog */
.status-dialog-icon {
  width: 56px; height: 56px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto;
}

@media (max-width: 600px) {
  .status-action-banner { flex-direction: column; align-items: stretch; }
  .status-action-btn { justify-content: center; }
}

/* Dark mode */
:global(.dark) .status-action-banner {
  background: #1e1e2e;
}
:global(.dark) .finance-card {
  background: #1e1e2e; border-color: #2e2e42;
}
:global(.dark) .reschedule-info {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
}
:global(.dark) .field-input {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
}

@media (max-width: 960px) {
  .detail-hero-title { font-size: 22px; }
  .detail-hero-content { bottom: 16px; left: 20px; right: 20px; }
}
</style>
