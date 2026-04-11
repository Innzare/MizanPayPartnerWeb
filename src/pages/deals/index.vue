<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { formatCurrency, formatDate, formatDateShort, formatPercent, timeAgo } from '@/utils/formatters'
import { DEAL_STATUS_CONFIG, PAYMENT_STATUS_CONFIG } from '@/constants/statuses'
import { type Deal, userName } from '@/types'
import { useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { api } from '@/api/client'

const router = useRouter()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
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
    toast.error(e.message || 'Ошибка загрузки сделок')
  } finally {
    pageLoading.value = false
  }
})

const tab = ref(0)
const viewMode = ref<'grid' | 'table'>('table')
const search = ref('')
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const deleting = ref(false)

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
  selectedIds.value = new Set(selectedIds.value) // trigger reactivity
}

function selectAll() {
  if (selectedIds.value.size === displayedDeals.value.length) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(displayedDeals.value.map(d => d.id))
  }
}

function cancelSelect() {
  selectMode.value = false
  selectedIds.value = new Set()
}

async function deleteSelected() {
  if (!selectedIds.value.size) return
  if (!confirm(`Переместить ${selectedIds.value.size} сделок в корзину?`)) return

  deleting.value = true
  try {
    const result = await api.post<{ deleted: number; total: number }>('/deals/delete-batch', {
      ids: Array.from(selectedIds.value),
    })
    toast.success(`${result.deleted} сделок перемещено в корзину`)
    await dealsStore.fetchDeals()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }

  cancelSelect()
  deleting.value = false
}

async function restoreSelected() {
  if (!selectedIds.value.size) return
  deleting.value = true
  try {
    await dealsStore.restoreBatch(Array.from(selectedIds.value))
    toast.success(`${selectedIds.value.size} сделок восстановлено`)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка восстановления')
  }
  cancelSelect()
  deleting.value = false
}

async function emptyTrash() {
  if (!confirm('Удалить все сделки из корзины навсегда? Это действие необратимо.')) return
  deleting.value = true
  try {
    await dealsStore.emptyTrash()
    toast.success('Корзина очищена')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка очистки')
  }
  deleting.value = false
}

async function restoreOne(id: string) {
  try {
    await dealsStore.restoreDeal(id)
    toast.success('Сделка восстановлена')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка восстановления')
  }
}

async function permanentDeleteOne(id: string) {
  if (!confirm('Удалить сделку навсегда? Это действие необратимо.')) return
  try {
    await dealsStore.permanentDelete(id)
    toast.success('Сделка удалена навсегда')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
}

async function permanentDeleteSelected() {
  if (!selectedIds.value.size) return
  if (!confirm(`Удалить ${selectedIds.value.size} сделок навсегда? Это действие необратимо.`)) return
  deleting.value = true
  try {
    for (const id of selectedIds.value) {
      await dealsStore.permanentDelete(id)
    }
    toast.success(`Удалено навсегда`)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
  cancelSelect()
  deleting.value = false
}
const selectedDeal = ref<Deal | null>(null)
const showDialog = ref(false)
const sortBy = ref<'newest' | 'amount_desc' | 'amount_asc' | 'progress'>('newest')

const tabFilters = [
  { label: 'Активные', key: 'active' },
  { label: 'Завершённые', key: 'completed' },
  { label: 'Все', key: 'all' },
  { label: 'Корзина', key: 'trash' },
]

const sortOptions = [
  { title: 'Новые', value: 'newest' },
  { title: 'Сумма ↓', value: 'amount_desc' },
  { title: 'Сумма ↑', value: 'amount_asc' },
  { title: 'По прогрессу', value: 'progress' },
]

const isTrashTab = computed(() => tab.value === 3)

const baseDeals = computed(() => {
  switch (tab.value) {
    case 0: return dealsStore.activeDeals
    case 1: return dealsStore.completedDeals
    case 2: return dealsStore.investorDeals
    case 3: return dealsStore.trash
    default: return dealsStore.investorDeals
  }
})

watch(tab, (v) => {
  if (v === 3 && !dealsStore.trash.length) {
    dealsStore.fetchTrash()
  }
})

const displayedDeals = computed(() => {
  let result = [...baseDeals.value]

  if (search.value) {
    const s = search.value.toLowerCase()
    result = result.filter(d =>
      d.productName.toLowerCase().includes(s) ||
      dealClientName(d).toLowerCase().includes(s)
    )
  }

  switch (sortBy.value) {
    case 'newest': result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); break
    case 'amount_desc': result.sort((a, b) => b.totalPrice - a.totalPrice); break
    case 'amount_asc': result.sort((a, b) => a.totalPrice - b.totalPrice); break
    case 'progress': result.sort((a, b) => {
      const pa = a.numberOfPayments > 0 ? a.paidPayments / a.numberOfPayments : 0
      const pb = b.numberOfPayments > 0 ? b.paidPayments / b.numberOfPayments : 0
      return pb - pa
    }); break
  }

  return result
})

// Summary stats for current tab
const tabStats = computed(() => {
  const deals = baseDeals.value
  const totalVolume = deals.reduce((s, d) => s + d.totalPrice, 0)
  const totalProfit = deals.reduce((s, d) => s + d.markup, 0)
  const totalRemaining = deals.reduce((s, d) => s + d.remainingAmount, 0)
  return { count: deals.length, totalVolume, totalProfit, totalRemaining }
})

function getDealProgress(deal: Deal) {
  return deal.numberOfPayments > 0 ? (deal.paidPayments / deal.numberOfPayments) * 100 : 0
}

function dealClientName(deal: Deal) {
  if (deal.client) return userName(deal.client)
  return deal.externalClientName || '—'
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
    <!-- Page loader -->
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
    <!-- Summary Cards -->
    <div class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-briefcase" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ tabStats.count }}</div>
          <div class="stat-label">Сделок</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
          <v-icon icon="mdi-cash-multiple" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(tabStats.totalVolume) }}</div>
          <div class="stat-label">Общий объём</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
          <v-icon icon="mdi-trending-up" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(tabStats.totalProfit) }}</div>
          <div class="stat-label">Прибыль</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
          <v-icon icon="mdi-clock-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(tabStats.totalRemaining) }}</div>
          <div class="stat-label">Остаток к получению</div>
        </div>
      </div>
    </div>

    <!-- Main card -->
    <v-card rounded="lg" elevation="0" border>
      <div class="pa-4">
        <!-- Tabs + toolbar -->
        <div class="d-flex flex-wrap ga-2 align-center mb-4">
          <div class="d-flex ga-2">
            <button
              v-for="(f, i) in tabFilters"
              :key="f.key"
              class="tab-btn"
              :class="{ active: tab === i }"
              @click="tab = i"
            >
              {{ f.label }}
              <span class="tab-count">{{ i === 0 ? dealsStore.activeDeals.length : i === 1 ? dealsStore.completedDeals.length : i === 2 ? dealsStore.investorDeals.length : dealsStore.trash.length }}</span>
            </button>
          </div>

          <v-spacer class="d-none d-md-block" />

          <div class="d-flex flex-wrap ga-2 align-center">
            <div class="filter-input-wrap" style="max-width: 240px; min-width: 160px;">
              <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
              <input
                v-model="search"
                type="text"
                placeholder="Поиск..."
                class="filter-input"
              />
            </div>

            <v-select
              v-model="sortBy"
              :items="sortOptions"
              item-title="title"
              item-value="value"
              variant="solo-filled"
              flat
              density="compact"
              hide-details
              prepend-inner-icon="mdi-sort"
              class="filter-select"
              style="max-width: 180px; min-width: 140px"
            />

            <div class="view-toggle">
              <button class="view-toggle-btn" :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">
                <v-icon icon="mdi-table" size="18" />
              </button>
              <button class="view-toggle-btn" :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">
                <v-icon icon="mdi-view-grid-outline" size="18" />
              </button>
            </div>

            <button v-if="!selectMode" class="view-toggle-btn" @click="selectMode = true" title="Выбрать">
              <v-icon icon="mdi-checkbox-multiple-outline" size="18" />
            </button>
          </div>
        </div>

        <!-- Selection bar -->
        <Transition name="slide-down">
          <div v-if="selectMode" class="select-bar">
            <div class="select-bar-left">
              <v-checkbox-btn
                :model-value="selectedIds.size === displayedDeals.length && displayedDeals.length > 0"
                :indeterminate="selectedIds.size > 0 && selectedIds.size < displayedDeals.length"
                density="compact"
                hide-details
                @update:model-value="selectAll"
              />
              <span class="select-bar-count">
                {{ selectedIds.size > 0 ? `Выбрано ${selectedIds.size} из ${displayedDeals.length}` : 'Выберите сделки' }}
              </span>
            </div>
            <div class="select-bar-right">
              <template v-if="isTrashTab">
                <button
                  v-if="selectedIds.size > 0"
                  class="select-bar-restore"
                  :disabled="deleting"
                  @click="restoreSelected"
                >
                  <v-icon icon="mdi-restore" size="18" />
                  <span>Восстановить ({{ selectedIds.size }})</span>
                </button>
                <button
                  v-if="selectedIds.size > 0"
                  class="select-bar-delete"
                  :disabled="deleting"
                  @click="permanentDeleteSelected"
                >
                  <v-icon icon="mdi-delete-forever" size="18" />
                  <span>Удалить навсегда</span>
                </button>
              </template>
              <button
                v-else-if="selectedIds.size > 0"
                class="select-bar-delete"
                :disabled="deleting"
                @click="deleteSelected"
              >
                <v-progress-circular v-if="deleting" indeterminate size="16" width="2" color="white" />
                <v-icon v-else icon="mdi-delete-outline" size="18" />
                <span>{{ deleting ? 'Удаление...' : `В корзину (${selectedIds.size})` }}</span>
              </button>
              <button class="select-bar-cancel" @click="cancelSelect">
                <v-icon icon="mdi-close" size="18" />
                <span>Отмена</span>
              </button>
            </div>
          </div>
        </Transition>

        <!-- Trash actions bar -->
        <div v-if="isTrashTab && displayedDeals.length" class="trash-bar">
          <div class="trash-bar-left">
            <div class="trash-bar-icon">
              <v-icon icon="mdi-delete-clock-outline" size="18" />
            </div>
            <div class="trash-bar-text">
              <div class="trash-bar-title">{{ dealsStore.trash.length }} {{ dealsStore.trash.length === 1 ? 'сделка' : dealsStore.trash.length < 5 ? 'сделки' : 'сделок' }} в корзине</div>
              <div class="trash-bar-sub">Автоматически удалятся навсегда через 30 дней</div>
            </div>
          </div>
          <button
            class="trash-bar-btn"
            :disabled="deleting"
            @click="emptyTrash"
          >
            <v-progress-circular v-if="deleting" indeterminate size="14" width="2" />
            <v-icon v-else icon="mdi-delete-sweep-outline" size="17" />
            <span>Очистить корзину</span>
          </button>
        </div>

        <!-- GRID VIEW -->
        <v-row v-if="viewMode === 'grid' && displayedDeals.length">
          <v-col v-for="deal in displayedDeals" :key="deal.id" cols="12" sm="6" lg="4" xl="3">
            <div class="deal-card" @click="openDeal(deal)">
              <div class="deal-card-photo">
                <v-img v-if="deal.productPhotos?.[0]" :src="deal.productPhotos[0]" height="140" cover />
                <div v-else class="deal-card-placeholder" style="height: 140px;">
                  <v-icon icon="mdi-package-variant-closed" size="36" />
                </div>
                <div
                  class="deal-card-status"
                  :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])"
                >
                  {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                </div>
              </div>

              <div class="deal-card-body">
                <div class="deal-card-title">{{ deal.productName }}</div>
                <div class="deal-card-client">
                  <v-icon icon="mdi-account" size="14" /> {{ dealClientName(deal) }}
                  <span v-if="!deal.client && deal.externalClientName" class="external-badge">Внешний</span>
                </div>

                <div class="deal-card-prices">
                  <div class="deal-card-total">{{ formatCurrency(deal.totalPrice) }}</div>
                  <div class="deal-card-markup">+{{ formatCurrency(deal.markup) }} ({{ formatPercent(deal.markupPercent) }})</div>
                </div>

                <div class="deal-card-progress-row">
                  <v-progress-linear
                    :model-value="getDealProgress(deal)"
                    color="primary"
                    rounded
                    height="4"
                    class="flex-grow-1"
                  />
                  <span class="deal-card-progress-text">{{ deal.paidPayments }}/{{ deal.numberOfPayments }}</span>
                </div>
              </div>
            </div>
          </v-col>
        </v-row>

        <!-- TABLE VIEW -->
        <v-table v-if="viewMode === 'table' && displayedDeals.length" density="default" hover class="deals-table">
          <thead>
            <tr>
              <th v-if="selectMode" style="width: 40px;">
                <v-checkbox-btn
                  :model-value="selectedIds.size === displayedDeals.length && displayedDeals.length > 0"
                  :indeterminate="selectedIds.size > 0 && selectedIds.size < displayedDeals.length"
                  density="compact"
                  hide-details
                  @update:model-value="selectAll"
                />
              </th>
              <th>Товар</th>
              <th>Клиент</th>
              <th class="text-end">Итого</th>
              <th class="text-end">Наценка</th>
              <th class="text-end">Остаток</th>
              <th class="text-center">Прогресс</th>
              <th>Статус</th>
              <th>Дата</th>
              <th v-if="isTrashTab" class="text-end">Действия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="deal in displayedDeals" :key="deal.id" class="cursor-pointer" @click="selectMode ? toggleSelect(deal.id) : openDeal(deal)">
              <td v-if="selectMode" @click.stop>
                <v-checkbox-btn
                  :model-value="selectedIds.has(deal.id)"
                  density="compact"
                  hide-details
                  @update:model-value="toggleSelect(deal.id)"
                />
              </td>
              <td>
                <div class="d-flex align-center ga-3 py-3">
                  <v-avatar size="44" rounded="lg" :color="deal.productPhotos?.[0] ? undefined : 'grey-lighten-3'">
                    <v-img v-if="deal.productPhotos?.[0]" :src="deal.productPhotos[0]" cover />
                    <v-icon v-else icon="mdi-package-variant-closed" size="22" color="grey" />
                  </v-avatar>
                  <span class="font-weight-medium table-product-name">{{ deal.productName }}</span>
                </div>
              </td>
              <td>
                <div class="d-flex align-center ga-2">
                  <span>{{ dealClientName(deal) }}</span>
                  <span v-if="!deal.client && deal.externalClientName" class="external-badge">Внешний</span>
                  <v-chip size="x-small" variant="tonal" color="warning">
                    <v-icon icon="mdi-star" size="10" start /> {{ deal.client?.rating ?? 0 }}
                  </v-chip>
                </div>
              </td>
              <td class="text-end font-weight-bold text-no-wrap">{{ formatCurrency(deal.totalPrice) }}</td>
              <td class="text-end text-no-wrap" style="color: #047857;">+{{ formatCurrency(deal.markup) }}</td>
              <td class="text-end text-no-wrap text-medium-emphasis">{{ formatCurrency(deal.remainingAmount) }}</td>
              <td class="text-center" style="min-width: 140px;">
                <div class="d-flex align-center ga-2">
                  <v-progress-linear
                    :model-value="getDealProgress(deal)"
                    color="primary"
                    rounded
                    height="4"
                    style="width: 80px;"
                  />
                  <span class="text-caption text-medium-emphasis">{{ deal.paidPayments }}/{{ deal.numberOfPayments }}</span>
                </div>
              </td>
              <td>
                <div
                  class="deal-status-chip"
                  :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])"
                >
                  {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                </div>
              </td>
              <td class="text-medium-emphasis text-no-wrap">{{ timeAgo(deal.createdAt) }}</td>
              <td v-if="isTrashTab" class="text-end text-no-wrap" @click.stop>
                <div class="row-actions">
                  <button class="row-action-btn row-action-btn--restore" title="Восстановить" @click="restoreOne(deal.id)">
                    <v-icon icon="mdi-restore" size="17" />
                  </button>
                  <button class="row-action-btn row-action-btn--delete" title="Удалить навсегда" @click="permanentDeleteOne(deal.id)">
                    <v-icon icon="mdi-delete-forever-outline" size="17" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>

        <!-- Empty state -->
        <div v-if="!displayedDeals.length" class="text-center pa-12">
          <v-icon :icon="isTrashTab ? 'mdi-delete-empty' : 'mdi-briefcase-search-outline'" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">
            {{ isTrashTab ? 'Корзина пуста' : 'Нет сделок' }}
          </p>
          <p class="text-body-2 text-medium-emphasis">
            {{ isTrashTab ? 'Удалённые сделки будут отображаться здесь' : search ? 'Попробуйте изменить параметры поиска' : 'Создайте первую сделку' }}
          </p>
          <v-btn
            v-if="!search && !isTrashTab"
            variant="tonal"
            color="primary"
            class="mt-4"
            prepend-icon="mdi-plus"
            @click="router.push('/create-deal')"
          >
            Новая сделка
          </v-btn>
        </div>
      </div>
    </v-card>

    <!-- Deal Detail Dialog -->
    <v-dialog v-model="showDialog" max-width="680" scrollable>
      <v-card v-if="selectedDeal" rounded="lg">
        <!-- Header with photo -->
        <div class="dialog-hero">
          <v-img v-if="selectedDeal.productPhotos?.[0]" :src="selectedDeal.productPhotos[0]" height="180" cover class="dialog-hero-img" />
          <div v-else class="deal-card-placeholder dialog-hero-img" style="height: 180px;">
            <v-icon icon="mdi-package-variant-closed" size="48" />
          </div>
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
              {{ dealClientName(selectedDeal).charAt(0) }}
            </div>
            <div>
              <div class="font-weight-medium">{{ dealClientName(selectedDeal) }}</div>
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
              <div class="dialog-finance-value" style="color: #047857;">+{{ formatCurrency(selectedDeal.markup) }} ({{ formatPercent(selectedDeal.markupPercent) }})</div>
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
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
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

/* Tab buttons */
.tab-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 20px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}

.tab-btn:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

.tab-btn.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}

.tab-count {
  font-size: 11px; font-weight: 600;
  padding: 0 6px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  line-height: 18px; min-width: 20px; text-align: center;
}

.tab-btn.active .tab-count {
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
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

:deep(.filter-select .v-field) {
  border-radius: 10px; height: 40px; min-height: 40px !important;
  background: #f4f4f5 !important; border: 1px solid #e4e4e7;
  box-shadow: none !important; padding: 0 8px 0 12px;
  font-size: 14px; transition: all 0.15s ease;
}
:deep(.filter-select .v-field .v-field__input) {
  padding: 0 0 0 4px; min-height: unset !important;
  height: 40px; display: flex; align-items: center; font-size: 14px;
}
:deep(.filter-select .v-field .v-field__prepend-inner),
:deep(.filter-select .v-field .v-field__append-inner) {
  padding-top: 0 !important; align-self: center;
}
:deep(.filter-select .v-field .v-field__prepend-inner .v-icon),
:deep(.filter-select .v-field .v-field__append-inner .v-icon) { color: #9ca3af; }
:deep(.filter-select .v-field--focused) {
  border-color: #047857 !important; background: #fff !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent) !important;
}

/* View toggle */
.view-toggle {
  display: flex; border-radius: 10px; overflow: hidden;
  border: 1px solid #e4e4e7; background: #f4f4f5;
}
.view-toggle-btn {
  width: 40px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.45); transition: all 0.15s;
}
.view-toggle-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.view-toggle-btn.active {
  background: #fff; color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* Grid cards */
.deal-card {
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden; cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  background: rgba(var(--v-theme-surface), 1);
}
.deal-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.deal-card-photo { position: relative; }
.external-badge {
  display: inline-flex; padding: 2px 6px; border-radius: 5px;
  background: rgba(99, 102, 241, 0.1); color: #6366f1;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  margin-left: 4px; vertical-align: middle;
}
.deal-card-placeholder {
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.15);
}
.deal-card-status {
  position: absolute; top: 10px; right: 10px;
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px;
}

.deal-card-body { padding: 16px; }
.deal-card-title {
  font-size: 15px; font-weight: 600; line-height: 1.3; margin-bottom: 4px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.deal-card-client {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; gap: 4px; margin-bottom: 12px;
}
.deal-card-prices { margin-bottom: 12px; }
.deal-card-total {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.deal-card-markup {
  font-size: 13px; color: #047857; font-weight: 500;
}
.deal-card-progress-row {
  display: flex; align-items: center; gap: 8px;
}
.deal-card-progress-text {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
}

/* Table */
/* Selection bar */
.select-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.select-bar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-bar-count {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.select-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-bar-delete {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  background: #ef4444;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.select-bar-delete:hover { background: #dc2626; }
.select-bar-delete:disabled { opacity: 0.6; cursor: not-allowed; }

.select-bar-restore {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  background: #047857;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.select-bar-restore:hover { background: #065f46; }
.select-bar-restore:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── Trash bar ── */
.trash-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.04) 0%, rgba(239, 68, 68, 0.01) 100%);
  border: 1px solid rgba(239, 68, 68, 0.14);
}

.trash-bar-left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.trash-bar-icon {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
}

.trash-bar-text { min-width: 0; line-height: 1.3; }

.trash-bar-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.trash-bar-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}

.trash-bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  border: 1px solid rgba(239, 68, 68, 0.25);
  background: rgba(var(--v-theme-surface), 1);
  color: #ef4444;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.trash-bar-btn:hover:not(:disabled) {
  background: #ef4444;
  color: #fff;
  border-color: #ef4444;
}

.trash-bar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dark .trash-bar {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(239, 68, 68, 0.02) 100%);
  border-color: rgba(239, 68, 68, 0.2);
}

.dark .trash-bar-btn {
  background: #1e1e2e;
}

/* ── Row action buttons ── */
.row-actions {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.row-action-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.row-action-btn:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.1);
}

.row-action-btn--restore:hover {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.2);
  color: #047857;
}

.row-action-btn--delete:hover {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.select-bar-cancel {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.select-bar-cancel:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* Slide transition */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Dark mode */
.dark .select-bar {
  background: #1e1e2e;
  border-color: #2e2e42;
}

.deals-table :deep(td) { font-size: 14px; }
.deals-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}
.table-product-name {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
}
.deal-status-chip {
  display: inline-block; font-size: 11px; font-weight: 600;
  padding: 4px 10px; border-radius: 6px; white-space: nowrap;
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
.dark .deal-card {
  background: #1e1e2e; border-color: #2e2e42;
}
.dark .filter-input {
  background: #252538; border-color: #2e2e42; color: #e4e4e7;
}
.dark .filter-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark :deep(.filter-select .v-field) {
  background: #252538 !important; border-color: #2e2e42; color: #e4e4e7;
}
.dark :deep(.filter-select .v-field--focused) {
  border-color: #047857 !important; background: #1e1e2e !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent) !important;
}
.dark .view-toggle { background: #252538; border-color: #2e2e42; }
.dark .view-toggle-btn.active { background: #2e2e42; box-shadow: none; }
.dark .filter-input::placeholder { color: #71717a; }
.dark :deep(.filter-select .v-field .v-field__prepend-inner),
.dark :deep(.filter-select .v-field .v-field__append-inner) { color: #71717a; }
.dark .dialog-finance-item { background: rgba(255, 255, 255, 0.04); }
</style>
