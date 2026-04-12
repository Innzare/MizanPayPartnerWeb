<script lang="ts" setup>
import { useActivityStore } from '@/stores/activity'
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useRouter } from 'vue-router'
import { formatCurrency, timeAgo } from '@/utils/formatters'
import { userName, clientProfileName } from '@/types'
import type { ActivityType, ActivityLog, Deal, Payment } from '@/types'

const { isDark } = useIsDark()
const toast = useToast()
const router = useRouter()
const store = useActivityStore()
const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()

const pageLoading = ref(true)

onMounted(async () => {
  try {
    // Load activity + deals + payments in parallel for enriched details
    await Promise.all([
      store.fetch(true),
      dealsStore.deals.length ? Promise.resolve() : dealsStore.fetchDeals(),
      paymentsStore.allPaymentsFlat.length ? Promise.resolve() : paymentsStore.fetchPayments(),
    ])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки истории')
  } finally {
    pageLoading.value = false
  }
})

// Type configuration: icon + color + group
interface TypeMeta {
  icon: string
  color: string
  group: 'deal' | 'payment' | 'client' | 'finance' | 'staff' | 'other'
}

const typeConfig: Record<ActivityType, TypeMeta> = {
  DEAL_CREATED: { icon: 'mdi-handshake', color: '#047857', group: 'deal' },
  DEAL_DELETED: { icon: 'mdi-delete-outline', color: '#f59e0b', group: 'deal' },
  DEAL_RESTORED: { icon: 'mdi-restore', color: '#3b82f6', group: 'deal' },
  DEAL_PERMANENTLY_DELETED: { icon: 'mdi-delete-forever', color: '#ef4444', group: 'deal' },
  DEAL_STATUS_CHANGED: { icon: 'mdi-swap-horizontal', color: '#8b5cf6', group: 'deal' },
  PAYMENT_PAID: { icon: 'mdi-cash-check', color: '#047857', group: 'payment' },
  PAYMENT_UNPAID: { icon: 'mdi-cash-remove', color: '#f59e0b', group: 'payment' },
  PAYMENT_RESCHEDULED: { icon: 'mdi-calendar-refresh', color: '#3b82f6', group: 'payment' },
  CLIENT_BLACKLISTED: { icon: 'mdi-account-cancel', color: '#ef4444', group: 'client' },
  CLIENT_UNBLACKLISTED: { icon: 'mdi-account-check', color: '#047857', group: 'client' },
  CLIENT_REVIEW_ADDED: { icon: 'mdi-star-outline', color: '#f59e0b', group: 'client' },
  TRANSACTION_CREATED: { icon: 'mdi-wallet-plus-outline', color: '#047857', group: 'finance' },
  TRANSACTION_DELETED: { icon: 'mdi-wallet-minus-outline', color: '#ef4444', group: 'finance' },
  STAFF_INVITED: { icon: 'mdi-account-plus-outline', color: '#3b82f6', group: 'staff' },
  STAFF_REMOVED: { icon: 'mdi-account-remove-outline', color: '#ef4444', group: 'staff' },
  STAFF_ROLE_CHANGED: { icon: 'mdi-account-key-outline', color: '#8b5cf6', group: 'staff' },
  PROFILE_UPDATED: { icon: 'mdi-account-edit-outline', color: '#64748b', group: 'other' },
  REQUEST_OFFER_SENT: { icon: 'mdi-send-outline', color: '#8b5cf6', group: 'other' },
  PRODUCT_CREATED: { icon: 'mdi-package-variant-plus', color: '#047857', group: 'other' },
  PRODUCT_DELETED: { icon: 'mdi-package-variant-remove', color: '#ef4444', group: 'other' },
}

const fallbackConfig: TypeMeta = { icon: 'mdi-information-outline', color: '#64748b', group: 'other' }
const getTypeMeta = (type: string) => typeConfig[type as ActivityType] ?? fallbackConfig

// ── Filters ──
const search = ref('')
const groupFilter = ref<'all' | TypeMeta['group']>('all')
const actorFilter = ref<'all' | 'owner' | 'staff'>('all')

const filtered = computed(() => {
  let items = store.items

  if (groupFilter.value !== 'all') {
    items = items.filter((i) => getTypeMeta(i.type).group === groupFilter.value)
  }

  if (actorFilter.value === 'owner') {
    items = items.filter((i) => i.actorType === 'OWNER')
  } else if (actorFilter.value === 'staff') {
    items = items.filter((i) => i.actorType === 'STAFF')
  }

  if (search.value.trim()) {
    const q = search.value.toLowerCase().trim()
    items = items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.description?.toLowerCase().includes(q)) ||
        i.actorName.toLowerCase().includes(q),
    )
  }

  return items
})

const tabs = [
  { key: 'all', label: 'Все', icon: 'mdi-format-list-bulleted' },
  { key: 'deal', label: 'Сделки', icon: 'mdi-briefcase' },
  { key: 'payment', label: 'Платежи', icon: 'mdi-cash-multiple' },
  { key: 'client', label: 'Клиенты', icon: 'mdi-account-group' },
  { key: 'finance', label: 'Финансы', icon: 'mdi-wallet-outline' },
  { key: 'staff', label: 'Сотрудники', icon: 'mdi-account-key' },
  { key: 'other', label: 'Прочее', icon: 'mdi-dots-horizontal' },
] as const

// Group by date
const grouped = computed(() => {
  const groups: { label: string; items: ActivityLog[] }[] = []
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7)

  const todayItems: ActivityLog[] = []
  const yesterdayItems: ActivityLog[] = []
  const weekItems: ActivityLog[] = []
  const olderItems: ActivityLog[] = []

  for (const item of filtered.value) {
    const d = new Date(item.createdAt)
    d.setHours(0, 0, 0, 0)
    if (d.getTime() === today.getTime()) todayItems.push(item)
    else if (d.getTime() === yesterday.getTime()) yesterdayItems.push(item)
    else if (d.getTime() >= weekAgo.getTime()) weekItems.push(item)
    else olderItems.push(item)
  }

  if (todayItems.length) groups.push({ label: 'Сегодня', items: todayItems })
  if (yesterdayItems.length) groups.push({ label: 'Вчера', items: yesterdayItems })
  if (weekItems.length) groups.push({ label: 'На этой неделе', items: weekItems })
  if (olderItems.length) groups.push({ label: 'Ранее', items: olderItems })

  return groups
})

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatFullDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ── Safe meta accessors (defensive — meta is Json? on backend) ──
function metaString(meta: Record<string, any> | undefined, key: string): string | undefined {
  const v = meta?.[key]
  return typeof v === 'string' ? v : undefined
}
function metaNumber(meta: Record<string, any> | undefined, key: string): number | undefined {
  const v = meta?.[key]
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string') {
    const parsed = Number(v)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

// ── Detail modal ──
const detailsOpen = ref(false)
const selected = ref<ActivityLog | null>(null)
const loadingDetails = ref(false)
const entityMissing = ref(false)

async function openDetails(item: ActivityLog) {
  selected.value = item
  detailsOpen.value = true
  entityMissing.value = false

  // Lazy-load related deal if needed (for deal-related events the deal might be in trash/not cached)
  const dealId = item.entityType === 'DEAL'
    ? item.entityId
    : metaString(item.meta, 'dealId')

  if (dealId && !dealsStore.getDeal(dealId)) {
    loadingDetails.value = true
    try {
      await dealsStore.fetchDeal(dealId)
      // Mark entity as missing if still not found after fetch attempt
      if (!dealsStore.getDeal(dealId)) {
        entityMissing.value = true
      }
    } catch {
      // Deal was permanently deleted — show fallback UI
      entityMissing.value = true
    } finally {
      loadingDetails.value = false
    }
  }
}

// Resolve related deal for the currently selected log
const selectedDeal = computed<Deal | null>(() => {
  if (!selected.value) return null
  const dealId = selected.value.entityType === 'DEAL'
    ? selected.value.entityId
    : metaString(selected.value.meta, 'dealId')
  if (!dealId) return null
  return dealsStore.getDeal(dealId) || null
})

// Resolve related payment
const selectedPayment = computed<Payment | null>(() => {
  if (!selected.value) return null
  if (selected.value.entityType !== 'PAYMENT' || !selected.value.entityId) return null
  return paymentsStore.allPaymentsFlat.find((p: Payment) => p.id === selected.value!.entityId) || null
})

function clientDisplayName(deal: Deal | null): string {
  if (!deal) return '—'
  if (deal.client) return userName(deal.client)
  if (deal.clientProfile) return clientProfileName(deal.clientProfile)
  return deal.externalClientName || '—'
}

function clientDisplayPhone(deal: Deal | null): string {
  if (!deal) return ''
  return deal.client?.phone || deal.clientProfile?.phone || deal.externalClientPhone || ''
}

function formatDateLong(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const paymentIntervalLabels: Record<string, string> = {
  WEEKLY: 'Еженедельно',
  BIWEEKLY: 'Раз в 2 недели',
  MONTHLY: 'Ежемесячно',
}

const dealStatusLabels: Record<string, string> = {
  ACTIVE: 'Активна',
  COMPLETED: 'Завершена',
  DISPUTED: 'Спор',
  CANCELLED: 'Отменена',
}

function navigateToEntity(item: ActivityLog) {
  detailsOpen.value = false
  if (item.entityType === 'DEAL' && item.entityId) {
    router.push(`/deals/${item.entityId}`)
  } else if (item.entityType === 'PAYMENT') {
    router.push('/payments')
  } else if (item.entityType === 'TRANSACTION') {
    router.push('/finance')
  } else if (item.entityType === 'CLIENT') {
    router.push('/registry')
  } else if (item.entityType === 'PRODUCT') {
    router.push('/products')
  } else if (item.entityType === 'REQUEST') {
    router.push('/requests')
  } else if (item.entityType === 'STAFF') {
    router.push('/staff')
  }
}

</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
      <!-- Header card -->
      <v-card rounded="lg" elevation="0" border class="mb-4">
        <div class="pa-4">
          <!-- Group tabs -->
          <div class="tabs-row">
            <button
              v-for="t in tabs"
              :key="t.key"
              class="tab-btn"
              :class="{ active: groupFilter === t.key }"
              @click="groupFilter = t.key"
            >
              <v-icon :icon="t.icon" size="16" />
              <span>{{ t.label }}</span>
            </button>
          </div>

          <!-- Search + actor filter -->
          <div class="toolbar">
            <div class="filter-input-wrap" style="flex: 1; max-width: 360px;">
              <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
              <input
                v-model="search"
                type="text"
                class="filter-input"
                placeholder="Поиск по истории..."
              />
            </div>

            <v-select
              v-model="actorFilter"
              :items="[
                { title: 'Все авторы', value: 'all' },
                { title: 'Я (владелец)', value: 'owner' },
                { title: 'Сотрудники', value: 'staff' },
              ]"
              item-title="title"
              item-value="value"
              variant="solo-filled"
              flat
              density="compact"
              hide-details
              prepend-inner-icon="mdi-account-circle-outline"
              class="filter-select"
              style="max-width: 200px"
            />
          </div>
        </div>
      </v-card>

      <!-- Timeline -->
      <v-card rounded="lg" elevation="0" border>
        <div v-if="!filtered.length" class="text-center pa-12">
          <v-icon icon="mdi-history" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Нет записей</p>
          <p class="text-body-2 text-medium-emphasis">
            {{ search || groupFilter !== 'all' ? 'Попробуйте изменить фильтры' : 'Здесь будет отображаться история ваших действий' }}
          </p>
        </div>

        <div v-else class="timeline">
          <div v-for="group in grouped" :key="group.label" class="timeline-group">
            <div class="timeline-group-label">{{ group.label }}</div>
            <div class="timeline-items">
              <div
                v-for="item in group.items"
                :key="item.id"
                class="activity-row activity-row--clickable"
                @click="openDetails(item)"
              >
                <div class="activity-icon" :style="{ background: getTypeMeta(item.type).color + '18', color: getTypeMeta(item.type).color }">
                  <v-icon :icon="getTypeMeta(item.type).icon" size="18" />
                </div>
                <div class="activity-body">
                  <div class="activity-title">{{ item.title }}</div>
                  <div v-if="item.description" class="activity-description">{{ item.description }}</div>
                  <div class="activity-footer">
                    <span class="activity-actor">
                      <v-icon :icon="item.actorType === 'OWNER' ? 'mdi-shield-crown-outline' : 'mdi-account-outline'" size="12" />
                      {{ item.actorName }}
                      <span v-if="item.actorType === 'STAFF'" class="actor-badge">сотрудник</span>
                    </span>
                    <span class="activity-time">{{ timeAgo(item.createdAt) }} · {{ formatTime(item.createdAt) }}</span>
                  </div>
                </div>
                <v-icon v-if="item.entityType" icon="mdi-chevron-right" size="18" class="activity-arrow" />
              </div>
            </div>
          </div>

          <!-- Load more -->
          <div v-if="store.hasMore" class="pa-4 text-center">
            <v-btn
              variant="tonal"
              :loading="store.isLoading"
              @click="store.loadMore()"
            >
              Загрузить ещё
            </v-btn>
          </div>
        </div>
      </v-card>
    </template>

    <!-- ── Details modal ── -->
    <v-dialog v-model="detailsOpen" max-width="560" scrollable>
      <v-card v-if="selected" rounded="lg" class="details-card">
        <!-- Header -->
        <div class="details-header" :style="{ background: getTypeMeta(selected.type).color + '10', borderBottomColor: getTypeMeta(selected.type).color + '20' }">
          <div class="details-header-icon" :style="{ background: getTypeMeta(selected.type).color + '1f', color: getTypeMeta(selected.type).color }">
            <v-icon :icon="getTypeMeta(selected.type).icon" size="22" />
          </div>
          <div class="details-header-text">
            <div class="details-header-title">{{ selected.title }}</div>
            <div class="details-header-meta">
              {{ formatFullDate(selected.createdAt) }} в {{ formatTime(selected.createdAt) }}
            </div>
          </div>
          <v-btn icon variant="text" size="small" @click="detailsOpen = false">
            <v-icon icon="mdi-close" />
          </v-btn>
        </div>

        <v-card-text class="pa-0" style="max-height: 520px;">
          <!-- Loading state -->
          <div v-if="loadingDetails" class="pa-8 text-center">
            <v-progress-circular indeterminate size="32" color="primary" />
          </div>

          <template v-else>
            <!-- ═══ DEAL EVENTS ═══ -->
            <template v-if="selected.type === 'DEAL_CREATED' || selected.type === 'DEAL_DELETED' || selected.type === 'DEAL_RESTORED' || selected.type === 'DEAL_PERMANENTLY_DELETED' || selected.type === 'DEAL_STATUS_CHANGED'">
              <div v-if="selectedDeal" class="details-section">
                <div class="deal-card-preview">
                  <v-avatar size="56" rounded="lg" :color="selectedDeal.productPhotos?.[0] ? undefined : 'grey-lighten-3'">
                    <v-img v-if="selectedDeal.productPhotos?.[0]" :src="selectedDeal.productPhotos[0]" cover />
                    <v-icon v-else icon="mdi-package-variant-closed" size="28" color="grey" />
                  </v-avatar>
                  <div class="deal-card-info">
                    <div class="deal-card-product">{{ selectedDeal.productName }}</div>
                    <div class="deal-card-client">
                      <v-icon icon="mdi-account-outline" size="14" />
                      {{ clientDisplayName(selectedDeal) }}
                      <span v-if="clientDisplayPhone(selectedDeal)" class="deal-card-phone">· {{ clientDisplayPhone(selectedDeal) }}</span>
                    </div>
                  </div>
                </div>

                <div class="details-kv mt-4">
                  <div class="details-kv-row">
                    <span class="details-kv-key">Итоговая цена</span>
                    <span class="details-kv-value font-weight-bold">{{ formatCurrency(selectedDeal.totalPrice) }}</span>
                  </div>
                  <div class="details-kv-row">
                    <span class="details-kv-key">Закупка</span>
                    <span class="details-kv-value">{{ formatCurrency(selectedDeal.purchasePrice) }}</span>
                  </div>
                  <div class="details-kv-row">
                    <span class="details-kv-key">Наценка</span>
                    <span class="details-kv-value" style="color: #047857;">+{{ formatCurrency(selectedDeal.markup) }} ({{ selectedDeal.markupPercent }}%)</span>
                  </div>
                  <div v-if="selectedDeal.downPayment" class="details-kv-row">
                    <span class="details-kv-key">Первый взнос</span>
                    <span class="details-kv-value">{{ formatCurrency(selectedDeal.downPayment) }}</span>
                  </div>
                  <div class="details-kv-row">
                    <span class="details-kv-key">Осталось</span>
                    <span class="details-kv-value">{{ formatCurrency(selectedDeal.remainingAmount) }}</span>
                  </div>
                  <div class="details-kv-row">
                    <span class="details-kv-key">Платежей</span>
                    <span class="details-kv-value">{{ selectedDeal.paidPayments }} / {{ selectedDeal.numberOfPayments }} · {{ paymentIntervalLabels[selectedDeal.paymentInterval] }}</span>
                  </div>
                  <div v-if="selectedDeal.firstPaymentDate" class="details-kv-row">
                    <span class="details-kv-key">Первый платёж</span>
                    <span class="details-kv-value">{{ formatDateLong(selectedDeal.firstPaymentDate) }}</span>
                  </div>
                </div>

                <!-- Status change specific -->
                <div v-if="selected.type === 'DEAL_STATUS_CHANGED' && metaString(selected.meta, 'from') && metaString(selected.meta, 'to')" class="status-change-banner">
                  <span class="status-pill status-pill--from">{{ dealStatusLabels[metaString(selected.meta, 'from')!] || metaString(selected.meta, 'from') }}</span>
                  <v-icon icon="mdi-arrow-right" size="16" />
                  <span class="status-pill status-pill--to">{{ dealStatusLabels[metaString(selected.meta, 'to')!] || metaString(selected.meta, 'to') }}</span>
                </div>
              </div>

              <div v-else class="details-section details-missing">
                <v-icon icon="mdi-package-variant-closed" size="40" color="grey-lighten-1" class="mb-2" />
                <div class="text-body-2 font-weight-medium">
                  {{ entityMissing ? 'Сделка удалена навсегда' : 'Данные о сделке недоступны' }}
                </div>
                <div v-if="selected.description" class="text-caption mt-1 text-medium-emphasis">{{ selected.description }}</div>
              </div>
            </template>

            <!-- ═══ PAYMENT EVENTS ═══ -->
            <template v-else-if="selected.type === 'PAYMENT_PAID' || selected.type === 'PAYMENT_UNPAID' || selected.type === 'PAYMENT_RESCHEDULED'">
              <div class="details-section">
                <!-- Orphaned warning -->
                <div v-if="!selectedDeal && !selectedPayment" class="orphan-warning mb-4">
                  <v-icon icon="mdi-information-outline" size="16" />
                  <span>Связанная сделка недоступна (возможно удалена). Показана информация из лога.</span>
                </div>

                <!-- Deal context -->
                <div v-if="selectedDeal" class="deal-card-preview mb-4">
                  <v-avatar size="48" rounded="lg" :color="selectedDeal.productPhotos?.[0] ? undefined : 'grey-lighten-3'">
                    <v-img v-if="selectedDeal.productPhotos?.[0]" :src="selectedDeal.productPhotos[0]" cover />
                    <v-icon v-else icon="mdi-package-variant-closed" size="24" color="grey" />
                  </v-avatar>
                  <div class="deal-card-info">
                    <div class="deal-card-product">{{ selectedDeal.productName }}</div>
                    <div class="deal-card-client">
                      <v-icon icon="mdi-account-outline" size="14" />
                      {{ clientDisplayName(selectedDeal) }}
                    </div>
                  </div>
                </div>

                <div class="details-kv">
                  <div class="details-kv-row">
                    <span class="details-kv-key">Номер платежа</span>
                    <span class="details-kv-value font-weight-bold">
                      {{ selectedPayment?.number || metaNumber(selected.meta, 'number') || '—' }}
                      <span v-if="selectedDeal">из {{ selectedDeal.numberOfPayments }}</span>
                    </span>
                  </div>
                  <div class="details-kv-row">
                    <span class="details-kv-key">Сумма</span>
                    <span class="details-kv-value font-weight-bold" style="color: #047857;">
                      {{ formatCurrency(selectedPayment?.amount || metaNumber(selected.meta, 'amount') || 0) }}
                    </span>
                  </div>
                  <div v-if="selectedPayment?.dueDate" class="details-kv-row">
                    <span class="details-kv-key">Дата платежа</span>
                    <span class="details-kv-value">{{ formatDateLong(selectedPayment.dueDate) }}</span>
                  </div>
                  <div v-if="selected.type === 'PAYMENT_PAID' && selectedPayment?.paidAt" class="details-kv-row">
                    <span class="details-kv-key">Оплачен</span>
                    <span class="details-kv-value">{{ formatDateLong(selectedPayment.paidAt) }}</span>
                  </div>
                  <div v-if="selected.type === 'PAYMENT_RESCHEDULED' && metaString(selected.meta, 'newDueDate')" class="details-kv-row">
                    <span class="details-kv-key">Новая дата</span>
                    <span class="details-kv-value">{{ formatDateLong(metaString(selected.meta, 'newDueDate')) }}</span>
                  </div>
                  <div v-if="selected.type === 'PAYMENT_RESCHEDULED' && metaString(selected.meta, 'reason')" class="details-kv-row">
                    <span class="details-kv-key">Причина</span>
                    <span class="details-kv-value">{{ metaString(selected.meta, 'reason') }}</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- ═══ TRANSACTION EVENTS ═══ -->
            <template v-else-if="selected.type === 'TRANSACTION_CREATED' || selected.type === 'TRANSACTION_DELETED'">
              <div class="details-section">
                <div class="details-kv">
                  <div v-if="metaString(selected.meta, 'type')" class="details-kv-row">
                    <span class="details-kv-key">Тип</span>
                    <span class="details-kv-value font-weight-bold" :style="{ color: metaString(selected.meta, 'type') === 'INCOME' ? '#047857' : '#ef4444' }">
                      {{ metaString(selected.meta, 'type') === 'INCOME' ? 'Доход' : 'Расход' }}
                    </span>
                  </div>
                  <div v-if="metaNumber(selected.meta, 'amount')" class="details-kv-row">
                    <span class="details-kv-key">Сумма</span>
                    <span class="details-kv-value font-weight-bold">{{ formatCurrency(metaNumber(selected.meta, 'amount') || 0) }}</span>
                  </div>
                  <div v-if="selected.description" class="details-kv-row">
                    <span class="details-kv-key">Описание</span>
                    <span class="details-kv-value">{{ selected.description }}</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- ═══ CLIENT EVENTS ═══ -->
            <template v-else-if="selected.type === 'CLIENT_BLACKLISTED' || selected.type === 'CLIENT_UNBLACKLISTED' || selected.type === 'CLIENT_REVIEW_ADDED'">
              <div class="details-section">
                <div class="details-kv">
                  <div v-if="metaString(selected.meta, 'name')" class="details-kv-row">
                    <span class="details-kv-key">Клиент</span>
                    <span class="details-kv-value font-weight-bold">{{ metaString(selected.meta, 'name') }}</span>
                  </div>
                  <div v-if="metaString(selected.meta, 'phone')" class="details-kv-row">
                    <span class="details-kv-key">Телефон</span>
                    <span class="details-kv-value">{{ metaString(selected.meta, 'phone') }}</span>
                  </div>
                  <div v-if="metaNumber(selected.meta, 'rating')" class="details-kv-row">
                    <span class="details-kv-key">Оценка</span>
                    <span class="details-kv-value font-weight-bold" style="color: #f59e0b;">
                      {{ metaNumber(selected.meta, 'rating') }} / 5
                    </span>
                  </div>
                  <div v-if="metaString(selected.meta, 'reason')" class="details-kv-row">
                    <span class="details-kv-key">Причина</span>
                    <span class="details-kv-value">{{ metaString(selected.meta, 'reason') }}</span>
                  </div>
                  <div v-if="metaString(selected.meta, 'comment')" class="details-kv-row">
                    <span class="details-kv-key">Комментарий</span>
                    <span class="details-kv-value">{{ metaString(selected.meta, 'comment') }}</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- ═══ STAFF EVENTS ═══ -->
            <template v-else-if="selected.type === 'STAFF_INVITED' || selected.type === 'STAFF_REMOVED' || selected.type === 'STAFF_ROLE_CHANGED'">
              <div class="details-section">
                <div v-if="selected.description" class="details-description-block">
                  {{ selected.description }}
                </div>
              </div>
            </template>

            <!-- ═══ FALLBACK ═══ -->
            <template v-else>
              <div v-if="selected.description" class="details-section">
                <div class="details-description-block">{{ selected.description }}</div>
              </div>
            </template>

            <!-- ── Actor (always visible) ── -->
            <div class="details-section details-section--muted">
              <div class="details-actor-row">
                <v-icon :icon="selected.actorType === 'OWNER' ? 'mdi-shield-crown-outline' : 'mdi-account-outline'" size="16" />
                <span>Выполнил: <strong>{{ selected.actorName }}</strong></span>
                <span class="actor-badge">{{ selected.actorType === 'OWNER' ? 'Владелец' : 'Сотрудник' }}</span>
              </div>
            </div>
          </template>
        </v-card-text>

        <v-divider />

        <div class="details-footer">
          <v-btn variant="text" @click="detailsOpen = false">Закрыть</v-btn>
          <v-btn
            v-if="(selected.entityType === 'DEAL' && selectedDeal) || (selected.type.startsWith('PAYMENT_') && selectedDeal)"
            color="primary"
            variant="flat"
            prepend-icon="mdi-arrow-top-right"
            @click="selectedDeal && router.push(`/deals/${selectedDeal.id}`); detailsOpen = false"
          >
            Открыть сделку
          </v-btn>
          <v-btn
            v-else-if="selected.entityType"
            color="primary"
            variant="flat"
            prepend-icon="mdi-arrow-top-right"
            @click="navigateToEntity(selected)"
          >
            Перейти
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Tabs */
.tabs-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.tab-btn:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  color: rgb(var(--v-theme-primary));
}

.tab-btn.active {
  background: rgba(var(--v-theme-primary), 0.1);
  border-color: rgba(var(--v-theme-primary), 0.25);
  color: rgb(var(--v-theme-primary));
}

/* Toolbar */
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.filter-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.filter-input-icon {
  position: absolute;
  left: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  pointer-events: none;
}

.filter-input {
  width: 100%;
  height: 40px;
  padding: 0 14px 0 38px;
  border-radius: 10px;
  border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 13px;
  outline: none;
}

.filter-input:focus {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

/* Timeline */
.timeline {
  padding: 8px 0;
}

.timeline-group {
  padding: 8px 0;
}

.timeline-group-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.4);
  padding: 12px 20px 8px;
}

.activity-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 12px 20px;
  transition: background 0.15s;
  border-left: 2px solid transparent;
}

.activity-row--clickable {
  cursor: pointer;
}

.activity-row--clickable:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-left-color: rgba(var(--v-theme-primary), 0.4);
}

.activity-icon {
  width: 38px;
  height: 38px;
  min-width: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.activity-body {
  flex: 1;
  min-width: 0;
}

.activity-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.92);
  line-height: 1.35;
}

.activity-description {
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-top: 2px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.activity-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.activity-actor {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.actor-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(139, 92, 246, 0.1);
  color: #8b5cf6;
  margin-left: 2px;
}

.activity-time {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

.activity-arrow {
  color: rgba(var(--v-theme-on-surface), 0.3);
  align-self: center;
  flex-shrink: 0;
}

.timeline-items {
  position: relative;
}

/* Dark mode */
.dark .tab-btn {
  background: #1e1e2e;
  border-color: #2e2e42;
}

.dark .filter-input {
  background: rgba(255, 255, 255, 0.04);
}

@media (max-width: 600px) {
  .activity-description { display: none; }
  .activity-footer { gap: 8px; }
}

/* ── Details modal ── */
.details-card { overflow: hidden; }

.details-header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 24px;
  border-bottom: 1px solid;
}

.details-header-icon {
  width: 44px;
  height: 44px;
  min-width: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.details-header-text {
  flex: 1;
  min-width: 0;
}

.details-header-title {
  font-size: 16px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.92);
  line-height: 1.3;
}

.details-header-desc {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-top: 3px;
  line-height: 1.4;
}

.details-section {
  padding: 16px 24px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}

.details-section:last-child { border-bottom: none; }

.details-section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 10px;
}

.details-kv {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.details-kv-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  font-size: 13px;
}

.details-kv-key {
  color: rgba(var(--v-theme-on-surface), 0.55);
  flex-shrink: 0;
}

.details-kv-value {
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-weight: 500;
  text-align: right;
  word-break: break-word;
  min-width: 0;
}

.details-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.details-actor {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.details-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
}

.details-header-meta {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 4px;
}

/* Deal preview card */
.deal-card-preview {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

.deal-card-info {
  flex: 1;
  min-width: 0;
}

.deal-card-product {
  font-size: 15px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.92);
  line-height: 1.3;
}

.deal-card-client {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 3px;
}

.deal-card-phone {
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Status change banner */
.status-change-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
  padding: 14px;
  border-radius: 10px;
  background: rgba(139, 92, 246, 0.06);
  border: 1px solid rgba(139, 92, 246, 0.15);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.status-pill--from {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.status-pill--to {
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
}

/* Description block */
.details-description-block {
  padding: 14px 16px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-size: 13px;
  line-height: 1.5;
}

/* Actor row (footer-style) */
.details-section--muted {
  background: rgba(var(--v-theme-on-surface), 0.02);
}

.details-actor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.details-actor-row strong {
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-weight: 600;
}

/* Fallback for missing entities */
.details-missing {
  text-align: center;
  padding: 32px 24px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.orphan-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.18);
  color: #d97706;
  font-size: 12px;
  line-height: 1.4;
}
</style>