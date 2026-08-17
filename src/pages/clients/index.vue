<script lang="ts" setup>
import { useAuthStore } from '@/stores/auth'
import { useClientProfilesStore } from '@/stores/clientProfiles'
import { usePaymentsStore } from '@/stores/payments'
import { formatCurrency, formatDate, formatDateShort, formatPercent, formatPhone, timeAgo } from '@/utils/formatters'
import { DEAL_STATUS_CONFIG, PAYMENT_STATUS_CONFIG } from '@/constants/statuses'
import { type Deal, type ClientProfile, type Payment, userName, clientProfileName } from '@/types'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import ServerPager from '@/components/ServerPager.vue'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useDealLock } from '@/composables/useDealLock'

const router = useRouter()
const authStore = useAuthStore()
const paymentsStore = usePaymentsStore()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()

// Reactive mobile flag для fullscreen-диалога деталей сделки.
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
function updateMobile() { isMobile.value = window.innerWidth < 768 }
onMounted(() => window.addEventListener('resize', updateMobile))
onUnmounted(() => window.removeEventListener('resize', updateMobile))

// ══════════════════════════════════════════════════════════════════
// Серверный список клиентов
//
// Раньше страница выкачивала весь портфель, все платежи и все профили и
// группировала клиентов в браузере. Теперь группирует сервер — тем же ключом,
// что фильтрует сделки клиента, поэтому счётчик в карточке всегда совпадает с
// её содержимым.
// ══════════════════════════════════════════════════════════════════

/** Строка списка в том же виде, что раньше собирал стор. */
interface ClientRow {
  key: string
  clientProfileId: string | null
  userId: string | null
  firstName: string
  lastName: string
  phone: string | null
  city: string | null
  rating: number
  hasPassport: boolean
  isExternal: boolean
  dealCount: number
  activeDealCount: number
  totalVolume: number
  totalProfit: number
  remaining: number
  onTimeRate: number
  nextPaymentDate: string | null
}

const PAGE_SIZE = 25
const rows = ref<ClientRow[]>([])
const total = ref(0)
const totalsAgg = ref<{ count: number; totalVolume: number; totalProfit: number; totalRemaining: number } | null>(null)
const listLoading = ref(false)
const page = ref(1)
const search = ref('')
const debouncedSearch = ref('')
// Защита от гонок: партнёр печатает быстрее, чем отвечает сеть.
let listReq = 0

const pageLoading = ref(true)

async function loadClients() {
  const cur = ++listReq
  listLoading.value = true
  try {
    const qs = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page.value - 1) * PAGE_SIZE),
    })
    if (debouncedSearch.value.trim()) qs.set('q', debouncedSearch.value.trim())

    const res = await api.get<{
      items: any[]
      total: number
      totals: { count: number; totalVolume: number; totalProfit: number; totalRemaining: number }
    }>(`/client-profiles/summary?${qs.toString()}`)
    if (cur !== listReq) return

    rows.value = res.items.map((r) => ({
      key: r.key,
      clientProfileId: r.clientProfileId ?? null,
      userId: r.userId ?? null,
      // Имя: платформенное → реестровое → внешнее из импорта.
      //
      // Внешнее имя НЕ разбираем на части: это произвольная строка из файла
      // импорта. Разбор по пробелу переставлял «Магомедов Магомед
      // Магомедович» в «Магомед Магомедов» (отчество терялось), а
      // односложное имя оставляло аватар без первой буквы.
      firstName: r.firstName ?? (r.externalName ? String(r.externalName).trim() : ''),
      lastName: r.lastName ?? '',
      phone: r.phone ?? null,
      city: r.city ?? null,
      rating: r.rating ?? 0,
      hasPassport: !!r.hasPassport,
      // Внешний — тот, кого нет на платформе.
      isExternal: !r.userId,
      dealCount: r.dealCount,
      activeDealCount: r.activeDealCount,
      totalVolume: r.totalVolume,
      totalProfit: r.totalProfit,
      remaining: r.remaining,
      onTimeRate: r.onTimeRate,
      nextPaymentDate: r.nextPaymentDate ?? null,
    }))
    total.value = res.total
    totalsAgg.value = res.totals
  } catch (e: any) {
    if (cur !== listReq) return
    toast.error(e?.message || 'Не удалось загрузить клиентов')
  } finally {
    if (cur === listReq) listLoading.value = false
  }
}

// Поиск с задержкой: без неё каждый символ уходил бы запросом.
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedSearch.value = v
    page.value = 1
  }, 350)
})

watch([page, debouncedSearch], () => { loadClients() })

onMounted(async () => {
  try {
    await loadClients()
  } finally {
    pageLoading.value = false
  }
})

function goToClientProfile(client: ClientRow) {
  if (client.clientProfileId) router.push(`/clients/${client.clientProfileId}`)
}

function hasClientProfile(client: ClientRow): boolean {
  return !!client.clientProfileId
}

const expandedClients = ref<string[]>([])

// Deal dialog
const selectedDeal = ref<Deal | null>(null)
const showDialog = ref(false)

/** Поиск серверный — список уже отфильтрован. */
const filteredClients = computed(() => rows.value)

// Итоги по ВСЕЙ выборке, а не по странице.
const stats = computed(() => ({
  count: totalsAgg.value?.count ?? 0,
  totalVolume: totalsAgg.value?.totalVolume ?? 0,
  totalProfit: totalsAgg.value?.totalProfit ?? 0,
  totalRemaining: totalsAgg.value?.totalRemaining ?? 0,
  avgOnTime: rows.value.length
    ? Math.round(rows.value.reduce((s, c) => s + c.onTimeRate, 0) / rows.value.length)
    : 0,
}))

// ── Сделки клиента в раскрытой карточке ──
// Показываем несколько последних; за полным списком — на страницу клиента.
const CARD_DEALS = 5
const dealsByClient = ref<Record<string, Deal[]>>({})
const dealsLoadingKey = ref<string | null>(null)

async function loadClientDeals(key: string) {
  if (dealsByClient.value[key]) return
  dealsLoadingKey.value = key
  try {
    const res = await api.get<{ items: Deal[] }>(
      `/deals?role=investor&clientKey=${encodeURIComponent(key)}&limit=${CARD_DEALS}&sort=createdAt&dir=desc`,
    )
    dealsByClient.value = { ...dealsByClient.value, [key]: res.items ?? [] }
  } catch (e) {
    console.error('Failed to load client deals:', e)
  } finally {
    if (dealsLoadingKey.value === key) dealsLoadingKey.value = null
  }
}

function getClientDeals(clientKey: string): Deal[] {
  return dealsByClient.value[clientKey] ?? []
}

function toggleClient(clientId: string) {
  const idx = expandedClients.value.indexOf(clientId)
  if (idx >= 0) {
    expandedClients.value.splice(idx, 1)
    return
  }
  expandedClients.value.push(clientId)
  // Сделки клиента грузим только при раскрытии — и лишь несколько последних.
  loadClientDeals(clientId)
}

function isExpanded(clientId: string) {
  return expandedClients.value.includes(clientId)
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

const { isDealLocked } = useDealLock()

function openDeal(deal: Deal) {
  // Залоченная сделка: ведём на страницу (там экран блокировки), без превью.
  if (isDealLocked(deal)) { router.push(`/deals/${deal.id}`); return }
  selectedDeal.value = deal
  showDialog.value = true
  // График сделки больше не приходит вместе с портфелем — тянем точечно.
  paymentsStore.fetchPaymentsForDeal(deal.id).catch(() => {})
}

function goToDeal(deal: Deal) {
  router.push(`/deals/${deal.id}`)
}

const selectedDealPayments = computed<Payment[]>(() => {
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
    <!-- KPI Cards — скрываются у ролей без права clients.kpi -->
    <div v-if="authStore.can('clients.kpi')" class="stats-row mb-6">
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

    <!-- Hint -->
    <div class="clients-hint">
      <v-icon icon="mdi-information-outline" size="18" />
      <div>
        Здесь отображаются только клиенты с активными или завершёнными сделками.
        Для полного списка перейдите в
        <router-link to="/registry" class="clients-hint-link">реестр клиентов</router-link>.
      </div>
    </div>

    <!-- Main card -->
    <v-card rounded="lg" elevation="0" border class="clients-card">
      <div class="pa-4">
        <!-- Search -->
        <div class="clients-search-row">
          <div class="filter-input-wrap clients-search-input">
            <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
            <input
              v-model="search"
              type="text"
              placeholder="Поиск по имени, городу, телефону..."
              class="filter-input"
            />
          </div>
          <div class="text-caption text-medium-emphasis clients-search-count">
            {{ filteredClients.length }} из {{ stats.count }}
          </div>
        </div>

        <!-- Client list -->
        <div v-if="filteredClients.length" class="clients-list">
          <div
            v-for="client in filteredClients"
            :key="client.key"
            class="client-card"
            :class="{ 'client-card--expanded': isExpanded(client.key) }"
          >
            <!-- Client Header -->
            <div class="client-header" @click="toggleClient(client.key)">
              <div
                class="client-avatar"
                :style="{ background: client.isExternal ? '#6366f1' : getAvatarColor(client.firstName), cursor: hasClientProfile(client) ? 'pointer' : 'default' }"
                @click.stop="goToClientProfile(client)"
              >
                {{ (client.firstName || '?')[0] }}{{ (client.lastName || '')[0] }}
              </div>

              <div class="client-main">
                <div class="client-name-row">
                  <span
                    class="client-name"
                    :class="{ 'client-name--link': hasClientProfile(client) }"
                    @click.stop="goToClientProfile(client)"
                  >{{ client.firstName }} {{ client.lastName }}</span>
                  <span v-if="hasClientProfile(client)" class="passport-badge" :class="client.hasPassport ? 'passport-badge--ok' : 'passport-badge--warn'">
                    <v-icon :icon="client.hasPassport ? 'mdi-card-account-details-outline' : 'mdi-alert-circle-outline'" size="11" />
                    {{ client.hasPassport ? 'Паспорт' : 'Нет паспорта' }}
                  </span>
                </div>
                <div class="client-meta">
                  <template v-if="client.city">{{ client.city }} · </template>{{ client.dealCount }} {{ client.dealCount === 1 ? 'сделка' : client.dealCount <= 4 ? 'сделки' : 'сделок' }}<template v-if="client.phone"> · {{ formatPhone(client.phone) }}</template>
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
                <v-icon :icon="isExpanded(client.key) ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="20" />
              </div>
            </div>

            <!-- Expanded content -->
            <v-expand-transition>
              <div v-if="isExpanded(client.key)" class="client-expanded">
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

                <div v-if="dealsLoadingKey === client.key" class="d-flex justify-center py-4">
                  <v-progress-circular indeterminate size="22" width="2" color="primary" />
                </div>

                <div class="deal-list">
                  <div
                    v-for="deal in getClientDeals(client.key)"
                    :key="deal.id"
                    class="deal-item"
                    :class="{ 'deal-locked-dim': isDealLocked(deal) }"
                    @click.stop="openDeal(deal)"
                  >
                    <v-avatar size="40" rounded="lg" class="deal-photo" :color="deal.productPhotos?.[0] ? undefined : 'grey-lighten-3'">
                      <v-img v-if="deal.productPhotos?.[0]" :src="deal.productPhotos[0]" cover />
                      <v-icon v-else icon="mdi-package-variant-closed" size="20" color="grey" />
                    </v-avatar>
                    <div class="deal-info">
                      <div class="deal-product">{{ deal.productName }}<span v-if="isDealLocked(deal)" class="deal-locked-chip ml-2"><v-icon icon="mdi-lock-outline" />Недоступно</span></div>
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

                  <!-- Показываем несколько последних; за полным списком —
                       на страницу клиента, там сделки грузятся порциями. -->
                  <button
                    v-if="client.dealCount > getClientDeals(client.key).length && hasClientProfile(client)"
                    class="client-all-deals"
                    @click.stop="goToClientProfile(client)"
                  >
                    Показать все {{ client.dealCount }}
                    {{ client.dealCount === 1 ? 'сделку' : client.dealCount < 5 ? 'сделки' : 'сделок' }}
                    <v-icon icon="mdi-arrow-right" size="14" />
                  </button>
                </div>
              </div>
            </v-expand-transition>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else-if="!listLoading" class="text-center pa-12">
          <v-icon icon="mdi-account-group-outline" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Нет клиентов</p>
          <p class="text-body-2 text-medium-emphasis">
            {{ search ? 'Попробуйте изменить параметры поиска' : 'Клиенты появятся после создания сделок' }}
          </p>
        </div>

        <!-- Пагинация серверного списка. -->
        <ServerPager
          :page="page"
          :total="total"
          :per-page="25"
          :busy="listLoading"
          :per-page-options="[25]"
          @update:page="page = $event"
        />

      </div>
    </v-card>

    <!-- Deal Detail Dialog -->
    <v-dialog v-model="showDialog" max-width="680" scrollable :fullscreen="isMobile">
      <v-card v-if="selectedDeal" rounded="lg">
        <!-- Header with photo on the left -->
        <div class="dialog-hero">
          <button class="dialog-close" @click="showDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
          <div class="dialog-hero-photo" :class="{ 'dialog-hero-photo--empty': !selectedDeal.productPhotos?.length }">
            <img v-if="selectedDeal.productPhotos?.[0]" :src="selectedDeal.productPhotos[0]" alt="" />
            <div v-else class="dialog-hero-photo-placeholder">
              <v-icon icon="mdi-image-off-outline" size="28" />
              <span>Нет фото</span>
            </div>
          </div>
          <div class="dialog-hero-content">
            <div
              class="dialog-status"
              :style="{ color: DEAL_STATUS_CONFIG[selectedDeal.status]?.color }"
            >
              <span class="dialog-status-dot" :style="{ background: DEAL_STATUS_CONFIG[selectedDeal.status]?.color }" />
              {{ DEAL_STATUS_CONFIG[selectedDeal.status]?.label }}
            </div>
            <div class="dialog-title">{{ selectedDeal.productName }}</div>
            <div class="dialog-hero-meta">
              <v-icon icon="mdi-account" size="14" />
              {{ selectedDeal.client ? userName(selectedDeal.client) : selectedDeal.clientProfile ? clientProfileName(selectedDeal.clientProfile) : selectedDeal.externalClientName || '—' }}
              <span class="mx-1">·</span>
              Создано {{ formatDate(selectedDeal.createdAt) }}
            </div>
          </div>
        </div>

        <v-card-text class="pa-5">

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
/* Прилипающая пагинация (ServerPager) требует, чтобы карточка не обрезала
   содержимое — у v-card overflow: hidden по умолчанию. */
.clients-card { overflow: visible; }

/* Stats row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
/* На мобиле каждая KPI карточка отдельной строкой — крупные суммы
   (например «Остаток к получению» с 7-значной цифрой) не помещались
   в 2-col layout и переносились или обрезались. */
@media (max-width: 600px) { .stats-row { grid-template-columns: 1fr; gap: 8px; } }

.clients-hint {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(59, 130, 246, 0.06);
  border: 1px solid rgba(59, 130, 246, 0.15);
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 16px;
}
.clients-hint .v-icon {
  color: #3b82f6;
  flex-shrink: 0;
  margin-top: 1px;
}
.clients-hint-link {
  color: #3b82f6;
  text-decoration: none;
  font-weight: 600;
}
.clients-hint-link:hover {
  text-decoration: underline;
}

/* Строка поиска: на десктопе input ограничен 360px и слева, счётчик справа.
   На мобиле input — на всю ширину, счётчик уходит под него. */
.clients-search-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.clients-search-input {
  flex: 1;
  max-width: 360px;
}
.clients-search-count {
  margin-left: auto;
  flex-shrink: 0;
}
@media (max-width: 599px) {
  .clients-search-row {
    flex-wrap: wrap;
    gap: 8px;
  }
  .clients-search-input {
    flex: 1 1 100%;
    max-width: 100%;
  }
  .clients-search-count {
    margin-left: 0;
  }
}

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
.client-name--link {
  cursor: pointer;
  transition: color 0.15s;
}
.client-name--link:hover {
  color: rgb(var(--v-theme-primary));
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

/* ───── Mobile (client cards) ───── */
@media (max-width: 599px) {
  /* Сжимаем padding header'а — на 360px каждый пиксель критичен. */
  .client-header {
    padding: 12px 14px;
    gap: 10px;
  }
  .client-avatar {
    width: 40px; height: 40px; min-width: 40px;
    border-radius: 10px;
    font-size: 14px;
  }

  /* Бэйджи в строке имени — компактнее, gap меньше. */
  .client-name-row {
    gap: 6px;
  }
  .client-name {
    font-size: 14px;
    line-height: 1.3;
  }
  /* Паспортный бейдж на узком экране лишний — имя важнее. */
  .client-name-row .passport-badge {
    display: none;
  }

  .client-meta {
    font-size: 12px;
    line-height: 1.35;
  }

  /* Шеврон поближе и поменьше отступы. */
  .expand-icon {
    margin-left: 4px;
  }
}

/* Mobile stats */
.client-stats-mobile {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 8px; margin-bottom: 16px;
}
@media (max-width: 599px) {
  /* На очень узких экранах stats в один столбец — иначе суммы сжимаются. */
  .client-stats-mobile {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .client-stat-m {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px;
    text-align: left;
  }
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
.dialog-hero {
  position: relative;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  display: flex; gap: 16px; align-items: stretch;
  padding: 20px 24px;
  min-height: 160px;
}
.dialog-close {
  position: absolute; top: 12px; right: 12px; z-index: 3;
  width: 30px; height: 30px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
  backdrop-filter: blur(8px);
}
.dialog-close:hover { background: rgba(255, 255, 255, 0.3); }
.dialog-hero-photo {
  flex-shrink: 0;
  width: 120px; height: 120px;
  border-radius: 12px; overflow: hidden;
  align-self: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.dialog-hero-photo img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.dialog-hero-photo--empty {
  display: flex; align-items: center; justify-content: center;
}
.dialog-hero-photo-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  color: rgba(255, 255, 255, 0.55); font-size: 10px;
}
.dialog-hero-content {
  flex: 1; min-width: 0; color: #fff;
  display: flex; flex-direction: column; justify-content: flex-start;
  padding-right: 44px;
}
.dialog-status {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  font-size: 11px; font-weight: 600;
  padding: 4px 10px; border-radius: 999px;
  background: #fff; margin-bottom: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.dialog-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.dialog-title {
  font-size: 20px; font-weight: 700; color: #fff; line-height: 1.25;
  margin-bottom: 6px; word-break: break-word;
}
.dialog-hero-meta {
  font-size: 12px; opacity: 0.85;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  margin-top: auto;
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
  background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border));
}
.dark .client-card {
  background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border));
}
.dark .client-card--expanded {
  border-color: rgba(4, 120, 87, 0.3);
}
.dark .filter-input {
  background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); color: rgba(var(--v-theme-on-surface), 0.92);
}
.dark .filter-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.5); }
.dark .filter-input:focus {
  border-color: #047857; background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .dialog-finance-item { background: rgba(255, 255, 255, 0.04); }
.dark .next-payment {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.18);
}

/* Passport badge */
.passport-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}
.passport-badge--ok {
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
}
.passport-badge--warn {
  background: rgba(245, 158, 11, 0.1);
  color: #d97706;
}
/* Переход к полному списку сделок клиента: в карточке показываем только
   несколько последних. */
.client-all-deals {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-primary), 0.35);
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  transition: background-color 0.15s;
}
.client-all-deals:hover { background: rgba(var(--v-theme-primary), 0.06); }
</style>
