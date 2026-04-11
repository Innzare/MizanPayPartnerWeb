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
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { api } from '@/api/client'
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
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const dealId = computed(() => route.params.id as string)

const pageLoading = ref(true)

onMounted(async () => {
  try {
    await Promise.all([
      dealsStore.fetchDeal(dealId.value),
      paymentsStore.fetchPaymentsForDeal(dealId.value),
    ])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки сделки')
  } finally {
    pageLoading.value = false
  }
})

const deal = computed(() => dealsStore.getDeal(dealId.value))
const payments = computed(() => paymentsStore.getPaymentsForDeal(dealId.value))

// Client info from deal's nested client object
const client = computed(() => deal.value?.client || null)

const clientInfo = computed(() => {
  if (!deal.value) return null
  return clientsStore.clientsInfo.find(c => c.user.id === deal.value!.clientId) || null
})

// Contract photos
const contractInputRef = ref<HTMLInputElement | null>(null)
const contractUploading = ref(false)

async function onContractFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !deal.value) return
  contractUploading.value = true
  try {
    const files = Array.from(input.files).filter(f => f.type.startsWith('image/'))
    const newUrls = await api.uploadMultiple(files, `contracts/${deal.value.id}`)
    const existing = deal.value.contractPhotos || []
    await api.patch(`/deals/${deal.value.id}/contract`, { contractPhotos: [...existing, ...newUrls] })
    await dealsStore.fetchDeal(dealId.value)
    toast.success('Фото договора загружены')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки')
  } finally {
    contractUploading.value = false
    if (contractInputRef.value) contractInputRef.value.value = ''
  }
}

async function removeContractPhoto(index: number) {
  if (!deal.value) return
  const updated = (deal.value.contractPhotos || []).filter((_: string, i: number) => i !== index)
  try {
    await api.patch(`/deals/${deal.value.id}/contract`, { contractPhotos: updated })
    await dealsStore.fetchDeal(dealId.value)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
}

const contractEnlargeUrl = ref('')
const contractEnlargeDialog = ref(false)

// Delete deal
const deleting = ref(false)
const isDeleted = computed(() => !!deal.value?.deletedAt)

function confirmDeleteDeal() {
  if (!confirm('Переместить сделку в корзину? Её можно будет восстановить в течение 30 дней.')) return
  deleteDeal()
}

async function deleteDeal() {
  deleting.value = true
  try {
    await api.delete(`/deals/${dealId.value}`)
    toast.success('Сделка перемещена в корзину')
    router.push('/deals')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить сделку')
  } finally {
    deleting.value = false
  }
}

async function restoreDeal() {
  deleting.value = true
  try {
    await dealsStore.restoreDeal(dealId.value)
    await dealsStore.fetchDeal(dealId.value)
    toast.success('Сделка восстановлена')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось восстановить сделку')
  } finally {
    deleting.value = false
  }
}

async function permanentDeleteDeal() {
  if (!confirm('Удалить сделку навсегда? Это действие необратимо.')) return
  deleting.value = true
  try {
    await dealsStore.permanentDelete(dealId.value)
    toast.success('Сделка удалена навсегда')
    router.push('/deals')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить сделку')
  } finally {
    deleting.value = false
  }
}

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

async function confirmReschedule() {
  if (!rescheduleTarget.value || !rescheduleDate.value) return
  try {
    await paymentsStore.reschedulePayment(
      rescheduleTarget.value.id,
      rescheduleTarget.value.dealId,
      new Date(rescheduleDate.value).toISOString(),
      rescheduleReason.value || undefined,
    )
    toast.success('Платёж перенесён')
    rescheduleDialog.value = false
    rescheduleTarget.value = null
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при переносе платежа')
  }
}

// Mark as paid dialog
const markPaidDialog = ref(false)
const markPaidTarget = ref<typeof payments.value[0] | null>(null)
const markPaidProofFile = ref<File | null>(null)
const markPaidProofPreview = ref('')
const markPaidUploading = ref(false)
const proofInputRef = ref<HTMLInputElement | null>(null)

// Proof screenshot enlarge
const proofEnlargeDialog = ref(false)
const proofEnlargeUrl = ref('')

const markPaidAmount = ref<number | null>(null)
const markPaidOnTime = ref(false)

function openMarkPaid(p: typeof payments.value[0]) {
  markPaidTarget.value = p
  markPaidAmount.value = Math.round(p.amount)
  markPaidProofFile.value = null
  markPaidProofPreview.value = ''
  markPaidOnTime.value = p.status === 'OVERDUE' ? false : false
  markPaidDialog.value = true
}

const unpaidLoading = ref<string | null>(null)

async function confirmUnmarkPaid(p: typeof payments.value[0]) {
  unpaidLoading.value = p.id
  try {
    await paymentsStore.unmarkPaid(p.id, p.dealId)
    await dealsStore.fetchDeals()
    toast.success('Оплата отменена')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при отмене оплаты')
  } finally {
    unpaidLoading.value = null
  }
}

function onProofFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (markPaidProofPreview.value) URL.revokeObjectURL(markPaidProofPreview.value)
  markPaidProofFile.value = file
  markPaidProofPreview.value = URL.createObjectURL(file)
  input.value = ''
}

function removeProofFile() {
  if (markPaidProofPreview.value) URL.revokeObjectURL(markPaidProofPreview.value)
  markPaidProofFile.value = null
  markPaidProofPreview.value = ''
}

function openProofEnlarge(url: string) {
  proofEnlargeUrl.value = url
  proofEnlargeDialog.value = true
}

async function confirmMarkPaid() {
  if (!markPaidTarget.value) return
  markPaidUploading.value = true
  try {
    let proofScreenshot: string | undefined
    if (markPaidProofFile.value) {
      proofScreenshot = await api.upload(markPaidProofFile.value, `proofs/${markPaidTarget.value.dealId}`)
    }
    const paidAmount = markPaidAmount.value && markPaidAmount.value !== markPaidTarget.value.amount
      ? markPaidAmount.value : undefined
    await paymentsStore.markAsPaid(markPaidTarget.value.id, markPaidTarget.value.dealId, {
      amount: paidAmount,
      proofScreenshot,
      onTime: markPaidOnTime.value || undefined,
    })
    await dealsStore.fetchDeals()
    toast.success('Платёж отмечен как оплаченный')
    markPaidDialog.value = false
    markPaidTarget.value = null
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при отметке оплаты')
  } finally {
    markPaidUploading.value = false
  }
}

// API reminder via WhatsApp
const sendingReminder = ref(false)

// Per-deal reminder settings
const dealReminderCustom = ref(false)
const dealReminderEnabled = ref(true)
const dealReminderDays = ref(3)

async function loadDealReminder() {
  if (!dealId.value) return
  try {
    const data = await api.get<any>(`/whatsapp/deal/${dealId.value}/settings`)
    if (data?.useCustom) {
      dealReminderCustom.value = true
      dealReminderEnabled.value = data.enabled !== false
      dealReminderDays.value = data.daysBefore || 3
    }
  } catch {}
}

async function toggleDealReminder(useCustom: boolean | null) {
  if (!useCustom) {
    await api.patch(`/whatsapp/deal/${dealId.value}/settings`, { useCustom: false })
    dealReminderCustom.value = false
  } else {
    dealReminderCustom.value = true
    await saveDealReminder()
  }
}

async function saveDealReminder() {
  try {
    await api.patch(`/whatsapp/deal/${dealId.value}/settings`, {
      useCustom: true,
      enabled: dealReminderEnabled.value,
      daysBefore: dealReminderDays.value,
    })
  } catch {}
}

onMounted(() => { loadDealReminder() })

async function sendApiReminder() {
  if (!deal.value) return
  sendingReminder.value = true
  try {
    const result = await api.post<{ sent: boolean; error?: string }>(`/whatsapp/remind/${deal.value.id}`)
    if (result.sent) {
      toast.success('Напоминание отправлено в WhatsApp')
    } else {
      toast.error(result.error || 'Не удалось отправить')
    }
  } catch (e: any) {
    toast.error(e.message || 'Ошибка отправки')
  } finally {
    sendingReminder.value = false
  }
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
    toast.success('Статус сделки обновлён')
    statusDialog.value = false
  } catch (e: any) {
    toast.error(e.message || 'Ошибка обновления статуса')
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
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Back button -->
    <button class="back-btn mb-4" @click="router.push('/deals')">
      <v-icon icon="mdi-arrow-left" size="18" />
      Назад к портфелю
    </button>

    <!-- Page loader -->
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 300px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <div v-else-if="deal">
      <!-- Deleted notice strip -->
      <div v-if="isDeleted" class="deleted-strip mb-4">
        <div class="deleted-strip-icon">
          <v-icon icon="mdi-delete-clock-outline" size="18" />
        </div>
        <div class="deleted-strip-text">
          <span class="deleted-strip-title">Эта сделка в корзине</span>
          <span class="deleted-strip-sub">Удалена {{ deal?.deletedAt ? timeAgo(deal.deletedAt) : '' }} · будет удалена навсегда через 30 дней</span>
        </div>
        <button
          class="deleted-strip-btn"
          :disabled="deleting"
          @click="restoreDeal"
        >
          <v-icon icon="mdi-restore" size="16" />
          Восстановить
        </button>
      </div>

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
                  <td class="text-medium-emphasis">
                    <div>{{ p.paidAt ? formatDate(p.paidAt) : '—' }}</div>
                    <div v-if="p.proofScreenshot" class="mt-1">
                      <img
                        :src="p.proofScreenshot"
                        class="proof-thumbnail"
                        title="Скриншот оплаты"
                        @click="openProofEnlarge(p.proofScreenshot!)"
                      />
                    </div>
                  </td>
                  <td>
                    <div
                      class="pay-status"
                      :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])"
                    >
                      {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                    </div>
                  </td>
                  <td class="text-center">
                    <div v-if="p.status !== 'PAID'" class="d-flex align-center justify-center ga-1">
                      <button class="action-btn action-btn--success" title="Отметить оплаченным" @click="openMarkPaid(p)">
                        <v-icon icon="mdi-check" size="16" />
                      </button>
                      <button class="action-btn action-btn--warning" title="Перенести дату" @click="openReschedule(p)">
                        <v-icon icon="mdi-calendar-clock" size="16" />
                      </button>
                    </div>
                    <div v-else class="d-flex align-center justify-center">
                      <button
                        class="action-btn action-btn--danger"
                        title="Отменить оплату"
                        :disabled="unpaidLoading === p.id"
                        @click="confirmUnmarkPaid(p)"
                      >
                        <v-progress-circular v-if="unpaidLoading === p.id" indeterminate size="12" width="2" />
                        <v-icon v-else icon="mdi-undo" size="16" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card>
        </v-col>

        <!-- Right column -->
        <v-col cols="12" lg="4">
          <!-- Client card -->
          <v-card v-if="client || deal.externalClientName" rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="section-title mb-4">Клиент</div>

            <!-- Platform client -->
            <div v-if="client" class="d-flex align-center ga-3 mb-4" style="cursor: pointer;" @click="router.push(`/users/${deal.clientId}`)">
              <div class="client-avatar">{{ (client.firstName || '')[0] || '' }}{{ (client.lastName || '')[0] || '' }}</div>
              <div class="flex-grow-1">
                <div class="font-weight-bold">{{ userName(client) }}</div>
                <div class="text-caption text-medium-emphasis">{{ client.city || '' }}</div>
              </div>
              <v-icon icon="mdi-chevron-right" size="18" class="text-medium-emphasis" />
            </div>

            <!-- External client -->
            <div v-else-if="deal.externalClientName" class="d-flex align-center ga-3 mb-4">
              <div class="client-avatar" style="background: #6366f1;">{{ deal.externalClientName[0] }}</div>
              <div class="flex-grow-1">
                <div class="font-weight-bold">{{ deal.externalClientName }}</div>
                <div class="text-caption text-medium-emphasis d-flex align-center ga-2">
                  <span v-if="deal.externalClientPhone">{{ deal.externalClientPhone }}</span>
                  <span class="external-client-badge">Внешний клиент</span>
                </div>
              </div>
            </div>

            <div v-if="client" class="client-info-grid">
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

            <!-- Reminder buttons -->
            <div v-if="(client?.phone || deal?.externalClientPhone) && deal?.status === 'ACTIVE'" class="d-flex ga-2 mt-4" style="flex-wrap: wrap;">
              <button class="reminder-btn reminder-btn--api" :disabled="sendingReminder" @click="sendApiReminder">
                <v-progress-circular v-if="sendingReminder" indeterminate size="14" width="2" />
                <v-icon v-else icon="mdi-whatsapp" size="16" />
                {{ sendingReminder ? 'Отправка...' : 'Напомнить в WhatsApp' }}
              </button>
            </div>

            <!-- Per-deal reminder settings -->
            <div class="deal-reminder-settings mt-4">
              <div class="d-flex align-center justify-space-between mb-2">
                <span class="text-caption font-weight-bold" style="opacity: 0.6;">Настройки напоминаний</span>
                <v-switch
                  v-model="dealReminderCustom"
                  density="compact"
                  hide-details
                  color="primary"
                  :label="dealReminderCustom ? 'Свои настройки' : 'Глобальные'"
                  style="flex: none;"
                  @update:model-value="toggleDealReminder"
                />
              </div>

              <div v-if="dealReminderCustom" class="deal-reminder-fields">
                <div class="d-flex align-center ga-3 mb-2">
                  <span class="text-caption">Вкл/выкл</span>
                  <v-switch v-model="dealReminderEnabled" density="compact" hide-details color="primary" style="flex: none;" @update:model-value="saveDealReminder" />
                </div>
                <div v-if="dealReminderEnabled" class="d-flex align-center ga-2 flex-wrap">
                  <span class="text-caption" style="opacity: 0.6;">За</span>
                  <button
                    v-for="d in [1,2,3,5,7]" :key="d"
                    class="deal-day-chip"
                    :class="{ active: dealReminderDays === d }"
                    @click="dealReminderDays = d; saveDealReminder()"
                  >{{ d }} дн</button>
                  <span class="text-caption" style="opacity: 0.6;">до платежа</span>
                </div>
              </div>
              <div v-else class="text-caption text-medium-emphasis">
                Используются глобальные настройки из раздела WhatsApp
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

          <!-- Contract photos -->
          <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="d-flex align-center justify-space-between mb-4">
              <div class="section-title">Фото договора</div>
              <button class="btn-sm btn-sm--outline" @click="contractInputRef?.click()" :disabled="contractUploading">
                <v-icon :icon="contractUploading ? 'mdi-loading' : 'mdi-plus'" size="16" :class="{ 'mdi-spin': contractUploading }" />
                {{ contractUploading ? 'Загрузка...' : 'Добавить' }}
              </button>
            </div>
            <input ref="contractInputRef" type="file" accept="image/*" multiple hidden @change="onContractFilesSelected" />

            <div v-if="deal?.contractPhotos?.length" class="contract-photo-grid">
              <div v-for="(url, i) in deal.contractPhotos" :key="i" class="contract-photo-item">
                <img
                  :src="url"
                  class="contract-photo-img"
                  @click="contractEnlargeUrl = url; contractEnlargeDialog = true"
                />
                <button class="contract-photo-remove" @click="removeContractPhoto(i)">
                  <v-icon icon="mdi-close" size="14" />
                </button>
              </div>
            </div>

            <div v-else class="text-center pa-6 text-medium-emphasis text-body-2">
              <v-icon icon="mdi-file-document-outline" size="32" class="mb-2" style="opacity: 0.3;" />
              <div>Нет фото договора</div>
            </div>
          </v-card>

          <!-- Contract enlarge dialog -->
          <v-dialog v-model="contractEnlargeDialog" max-width="800">
            <v-card rounded="lg">
              <img :src="contractEnlargeUrl" style="width: 100%; height: auto; display: block;" />
              <v-card-actions>
                <v-spacer />
                <v-btn variant="text" @click="contractEnlargeDialog = false">Закрыть</v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>

          <!-- Deal info card -->
          <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="section-title mb-4">Условия сделки</div>

            <div class="deal-detail-list">
              <div class="deal-detail-row">
                <span class="deal-detail-label">Первоначальный взнос</span>
                <span v-if="deal.downPayment" class="deal-detail-val" style="color: #047857; font-weight: 700;">{{ formatCurrency(deal.downPayment) }}</span>
                <span v-else class="deal-detail-val" style="opacity: 0.4;">Без взноса</span>
              </div>
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

      <!-- Deleted banner -->
      <div v-if="isDeleted" class="trash-banner">
        <div class="trash-banner-stripe" />
        <div class="trash-banner-content">
          <div class="trash-banner-icon">
            <v-icon icon="mdi-delete-clock-outline" size="22" />
          </div>
          <div class="trash-banner-text">
            <div class="trash-banner-title">Сделка в корзине</div>
            <div class="trash-banner-desc">
              Удалена {{ deal?.deletedAt ? timeAgo(deal.deletedAt) : '' }}
              <span class="trash-banner-dot">·</span>
              автоматически исчезнет через 30 дней
            </div>
          </div>
          <div class="trash-banner-actions">
            <button
              class="trash-btn trash-btn--restore"
              :disabled="deleting"
              @click="restoreDeal"
            >
              <v-progress-circular v-if="deleting" indeterminate size="14" width="2" color="white" />
              <v-icon v-else icon="mdi-restore" size="16" />
              <span>Восстановить</span>
            </button>
            <button
              class="trash-btn trash-btn--delete"
              :disabled="deleting"
              @click="permanentDeleteDeal"
            >
              <v-icon icon="mdi-delete-forever-outline" size="16" />
              <span>Удалить навсегда</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Delete deal -->
      <div v-else class="delete-deal-bar" :class="{ 'delete-deal-bar--hover': !deleting }">
        <div class="d-flex align-center ga-3">
          <div class="delete-deal-icon">
            <v-icon icon="mdi-delete-outline" size="18" />
          </div>
          <div>
            <div class="delete-deal-title">Удалить сделку</div>
            <div class="delete-deal-desc">Сделка будет перемещена в корзину</div>
          </div>
        </div>
        <button
          class="delete-deal-btn"
          :class="{ 'delete-deal-btn--loading': deleting }"
          :disabled="deleting"
          @click="confirmDeleteDeal"
        >
          <v-progress-circular v-if="deleting" indeterminate size="16" width="2" color="white" />
          <v-icon v-else icon="mdi-delete-outline" size="16" />
          <span>{{ deleting ? 'Удаление...' : 'В корзину' }}</span>
        </button>
      </div>

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

      <!-- Mark as paid dialog -->
      <v-dialog v-model="markPaidDialog" max-width="480">
        <v-card rounded="lg" class="pa-6">
          <button class="dialog-close-sm" @click="markPaidDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>

          <div class="text-h6 font-weight-bold mb-1">Отметить оплату</div>
          <div class="text-caption text-medium-emphasis mb-5">Подтвердите получение платежа</div>

          <div v-if="markPaidTarget" class="reschedule-info mb-5">
            <div class="d-flex justify-space-between mb-1">
              <span class="text-caption text-medium-emphasis">Платёж #{{ markPaidTarget.number }}</span>
              <span class="font-weight-bold">{{ formatCurrency(markPaidTarget.amount) }}</span>
            </div>
            <div class="d-flex justify-space-between">
              <span class="text-caption text-medium-emphasis">Дата</span>
              <span>{{ formatDate(markPaidTarget.dueDate) }}</span>
            </div>
          </div>

          <!-- Amount -->
          <div class="mb-5">
            <label class="field-label">Фактическая сумма оплаты</label>
            <div class="input-with-suffix">
              <input
                v-model.number="markPaidAmount"
                type="number"
                class="field-input"
                min="1"
              />
              <span class="input-suffix">₽</span>
            </div>
            <div v-if="markPaidTarget && markPaidAmount && markPaidAmount !== markPaidTarget.amount" class="text-caption mt-1" :style="{ color: markPaidAmount > markPaidTarget.amount ? '#10b981' : '#f59e0b' }">
              {{ markPaidAmount > markPaidTarget.amount ? `Переплата ${formatCurrency(markPaidAmount - markPaidTarget.amount)} — оставшиеся платежи будут пересчитаны` : `Недоплата ${formatCurrency(markPaidTarget.amount - markPaidAmount)}` }}
            </div>
          </div>

          <!-- Proof screenshot upload -->
          <div class="mb-5">
            <label class="field-label">Скриншот оплаты (необязательно)</label>
            <div v-if="markPaidProofPreview" class="proof-preview-wrap">
              <img :src="markPaidProofPreview" class="proof-preview-img" />
              <button class="proof-preview-remove" @click="removeProofFile">
                <v-icon icon="mdi-close" size="14" />
              </button>
            </div>
            <button v-else class="proof-upload-btn" @click="proofInputRef?.click()">
              <v-icon icon="mdi-camera-plus-outline" size="20" />
              <span>Прикрепить скриншот</span>
            </button>
            <input
              ref="proofInputRef"
              type="file"
              accept="image/*"
              style="display: none;"
              @change="onProofFileSelected"
            />
          </div>

          <!-- On-time toggle (show when payment is overdue) -->
          <div v-if="markPaidTarget && markPaidTarget.status === 'OVERDUE'" class="ontime-toggle mb-5" :class="{ 'ontime-toggle--active': markPaidOnTime }" @click="markPaidOnTime = !markPaidOnTime">
            <div class="ontime-toggle-icon">
              <v-icon :icon="markPaidOnTime ? 'mdi-check-circle' : 'mdi-clock-alert-outline'" size="18" :color="markPaidOnTime ? '#047857' : '#f59e0b'" />
            </div>
            <div class="ontime-toggle-content">
              <div class="ontime-toggle-title">Оплачено без просрочки</div>
              <div class="ontime-toggle-desc">Не повлияет на рейтинг клиента</div>
            </div>
            <div class="ontime-toggle-switch">
              <div class="ontime-switch-track" :class="{ 'ontime-switch-track--on': markPaidOnTime }">
                <div class="ontime-switch-thumb" />
              </div>
            </div>
          </div>

          <div class="d-flex ga-3">
            <button class="btn-secondary flex-grow-1" @click="markPaidDialog = false">Отмена</button>
            <button class="btn-primary flex-grow-1" :disabled="markPaidUploading" @click="confirmMarkPaid">
              <v-progress-circular v-if="markPaidUploading" indeterminate size="16" width="2" color="white" class="mr-1" />
              <v-icon v-else icon="mdi-check" size="16" />
              {{ markPaidUploading ? 'Загрузка...' : 'Подтвердить оплату' }}
            </button>
          </div>
        </v-card>
      </v-dialog>

      <!-- Proof enlarge dialog -->
      <v-dialog v-model="proofEnlargeDialog" max-width="600">
        <v-card rounded="lg" class="pa-2">
          <button class="dialog-close-sm" style="position: absolute; top: 8px; right: 8px; z-index: 1;" @click="proofEnlargeDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
          <img :src="proofEnlargeUrl" style="width: 100%; border-radius: 12px; display: block;" />
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
.external-client-badge {
  display: inline-flex; padding: 2px 8px; border-radius: 6px;
  background: rgba(99, 102, 241, 0.1); color: #6366f1;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
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
.action-btn--wa {
  background: rgba(37, 211, 102, 0.08); color: #25D366;
}
.action-btn--wa:hover {
  background: rgba(37, 211, 102, 0.18);
}
.action-btn--danger {
  background: rgba(239, 68, 68, 0.08); color: #ef4444;
}
.action-btn--danger:hover {
  background: rgba(239, 68, 68, 0.18);
}

/* On-time toggle */
.ontime-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
  user-select: none;
}
.ontime-toggle:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.ontime-toggle--active {
  border-color: rgba(4, 120, 87, 0.3);
  background: rgba(4, 120, 87, 0.04);
}
.ontime-toggle-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ontime-toggle--active .ontime-toggle-icon {
  background: rgba(4, 120, 87, 0.1);
}
.ontime-toggle-content {
  flex: 1;
  min-width: 0;
}
.ontime-toggle-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.87);
  line-height: 1.3;
}
.ontime-toggle-desc {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  line-height: 1.3;
  margin-top: 1px;
}
.ontime-switch-track {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.15);
  position: relative;
  transition: background 0.2s ease;
  flex-shrink: 0;
}
.ontime-switch-track--on {
  background: #047857;
}
.ontime-switch-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.ontime-switch-track--on .ontime-switch-thumb {
  transform: translateX(16px);
}

/* Reminder buttons */
.reminder-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px; border-radius: 10px;
  font-size: 13px; font-weight: 600;
  border: none; cursor: pointer;
  transition: all 0.15s;
}
.reminder-btn--wa {
  background: rgba(37, 211, 102, 0.08); color: #25D366;
}
.reminder-btn--wa:hover {
  background: rgba(37, 211, 102, 0.15);
}
.reminder-btn--tg {
  background: rgba(34, 158, 217, 0.08); color: #229ED9;
}
.reminder-btn--tg:hover {
  background: rgba(34, 158, 217, 0.15);
}
/* Deal reminder settings */
.deal-reminder-settings {
  padding-top: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.deal-reminder-fields {
  display: flex; flex-direction: column; gap: 8px;
  margin-top: 8px;
}
.deal-day-chip {
  padding: 4px 10px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.deal-day-chip:hover { background: rgba(var(--v-theme-primary), 0.08); color: rgb(var(--v-theme-primary)); }
.deal-day-chip.active { background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); }

.reminder-btn--api {
  background: #25d366 !important;
  color: #fff !important;
  border: none;
  flex: 1;
}
.reminder-btn--api:hover { background: #1da851 !important; }
.reminder-btn--api:disabled { opacity: 0.5; }

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
.input-with-suffix { position: relative; }
.input-with-suffix .field-input { padding-right: 36px; }
.input-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
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

/* Delete deal */
.delete-deal-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  margin-top: 24px;
  border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgba(var(--v-theme-on-surface), 0.02);
  transition: all 0.2s;
}

.delete-deal-bar--hover:hover {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.02);
}

.delete-deal-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.delete-deal-bar--hover:hover .delete-deal-icon {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

.delete-deal-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  transition: color 0.2s;
}

.delete-deal-bar--hover:hover .delete-deal-title {
  color: #ef4444;
}

.delete-deal-desc {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.3);
}

.delete-deal-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  border: none;
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.delete-deal-btn:hover {
  background: #ef4444;
  color: #fff;
}

.delete-deal-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.delete-deal-btn--loading {
  background: #ef4444;
  color: #fff;
}

.dark .delete-deal-bar {
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-color: #2e2e42;
}

/* ── Deleted strip ── */
.deleted-strip {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.14);
}

.deleted-strip-icon {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
}

.deleted-strip-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.deleted-strip-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.deleted-strip-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.deleted-strip-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-surface), 1);
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.deleted-strip-btn:hover:not(:disabled) {
  border-color: rgba(4, 120, 87, 0.4);
  color: #047857;
  background: rgba(4, 120, 87, 0.04);
}

.deleted-strip-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dark .deleted-strip {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
}

.dark .deleted-strip-btn {
  background: #1e1e2e;
  border-color: #2e2e42;
}

@media (max-width: 600px) {
  .deleted-strip-sub { display: none; }
}

/* ── Trash banner ── */
.trash-banner {
  position: relative;
  margin-top: 24px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.06) 0%, rgba(245, 158, 11, 0.02) 100%);
  border: 1px solid rgba(245, 158, 11, 0.18);
  overflow: hidden;
}

.trash-banner-stripe {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, #f59e0b 0%, #d97706 100%);
}

.trash-banner-content {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 22px 18px 26px;
}

.trash-banner-icon {
  width: 44px;
  height: 44px;
  min-width: 44px;
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
  display: flex;
  align-items: center;
  justify-content: center;
}

.trash-banner-text {
  flex: 1;
  min-width: 0;
}

.trash-banner-title {
  font-size: 15px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.92);
  letter-spacing: -0.01em;
}

.trash-banner-desc {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}

.trash-banner-dot {
  opacity: 0.4;
  margin: 0 4px;
}

.trash-banner-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.trash-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
}

.trash-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.trash-btn--restore {
  background: #047857;
  color: #fff;
  box-shadow: 0 1px 2px rgba(4, 120, 87, 0.15), 0 4px 12px rgba(4, 120, 87, 0.18);
}

.trash-btn--restore:hover:not(:disabled) {
  background: #065f46;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(4, 120, 87, 0.2), 0 8px 20px rgba(4, 120, 87, 0.25);
}

.trash-btn--delete {
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.trash-btn--delete:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

.dark .trash-banner {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.03) 100%);
  border-color: rgba(245, 158, 11, 0.25);
}

@media (max-width: 600px) {
  .trash-banner-content {
    flex-wrap: wrap;
  }
  .trash-banner-actions {
    width: 100%;
    justify-content: flex-end;
  }
}

/* Contract photos */
.contract-photo-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.contract-photo-item { position: relative; width: 100px; height: 100px; }
.contract-photo-img {
  width: 100%; height: 100%; object-fit: cover; border-radius: 10px;
  cursor: pointer; transition: opacity 0.15s;
}
.contract-photo-img:hover { opacity: 0.85; }
.contract-photo-remove {
  position: absolute; top: -6px; right: -6px;
  width: 22px; height: 22px; border-radius: 50%; border: none;
  background: #ef4444; color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0; transition: opacity 0.15s;
}
.contract-photo-item:hover .contract-photo-remove { opacity: 1; }
.btn-sm--outline {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.btn-sm--outline:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  color: rgb(var(--v-theme-primary));
}
.btn-sm--outline:disabled { opacity: 0.4; cursor: not-allowed; }

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
.dark .status-action-banner {
  background: #1e1e2e;
}
.dark .finance-card {
  background: #1e1e2e; border-color: #2e2e42;
}
.dark .field-input {
  background: #252538;
  border-color: #2e2e42;
  color: #e4e4e7;
}
.dark .field-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .reschedule-info {
  background: #1e1e2e;
  border-color: #2e2e42;
}
.dark .dialog-finance-item { background: rgba(255, 255, 255, 0.04); }

/* Proof screenshot */
.proof-thumbnail {
  width: 36px; height: 36px; border-radius: 6px;
  object-fit: cover; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  transition: all 0.15s;
}
.proof-thumbnail:hover {
  border-color: rgba(4, 120, 87, 0.3);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.proof-upload-btn {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 14px; border-radius: 10px;
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  justify-content: center;
}
.proof-upload-btn:hover {
  border-color: rgba(4, 120, 87, 0.3);
  color: #047857;
  background: rgba(4, 120, 87, 0.04);
}
.proof-preview-wrap {
  position: relative; display: inline-block;
}
.proof-preview-img {
  max-width: 100%; max-height: 160px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  display: block;
}
.proof-preview-remove {
  position: absolute; top: 6px; right: 6px;
  width: 24px; height: 24px; border-radius: 6px; border: none;
  background: rgba(0, 0, 0, 0.6); color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.proof-preview-remove:hover {
  background: rgba(239, 68, 68, 0.9);
}

@media (max-width: 960px) {
  .detail-hero-title { font-size: 22px; }
  .detail-hero-content { bottom: 16px; left: 20px; right: 20px; }
}
</style>
