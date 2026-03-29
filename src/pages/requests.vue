<script lang="ts" setup>
import { useRequestsStore } from '@/stores/requests'
import { formatCurrency, formatMonths, timeAgo, formatDate } from '@/utils/formatters'
import { CATEGORIES, getCategoryLabel } from '@/constants/categories'
import { CITIES } from '@/constants/cities'
import { type Request, userName } from '@/types'
const requestsStore = useRequestsStore()

onMounted(() => {
  requestsStore.fetchRequests()
})

const activeTab = ref<'requests' | 'offers'>('requests')
const search = ref('')
const selectedCategory = ref<string | null>(null)
const selectedCity = ref<string | null>(null)
const sortBy = ref<'newest' | 'price_asc' | 'price_desc' | 'rating'>('newest')
const viewMode = ref<'grid' | 'table'>('table')
const detailDialog = ref(false)
const acceptDialog = ref(false)
const selectedRequest = ref<Request | null>(null)

// Offer tiers wizard state
const acceptStep = ref(1)
const offerTiers = ref<{ termMonths: number; markupPercent: number; enabled: boolean }[]>([])
const quickMarkup = ref(15)
const isSendingOffer = ref(false)
const TERM_OPTIONS = [3, 4, 6, 9, 12]
const MARKUP_OPTIONS = [10, 15, 20, 25, 30]

function getDefaultTiers() {
  return [
    { termMonths: 3, markupPercent: 10, enabled: true },
    { termMonths: 6, markupPercent: 15, enabled: true },
    { termMonths: 12, markupPercent: 20, enabled: true },
  ]
}

const enabledTiers = computed(() => offerTiers.value.filter((t) => t.enabled))

watch(search, (val) => {
  requestsStore.setFilters({ search: val || undefined })
})

const displayedRequests = computed(() => {
  let result = requestsStore.filteredRequests

  if (selectedCategory.value) {
    result = result.filter((r) => r.category === selectedCategory.value)
  }
  if (selectedCity.value) {
    result = result.filter((r) => r.city === selectedCity.value)
  }

  const sorted = [...result]
  switch (sortBy.value) {
    case 'newest':
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      break
    case 'price_asc':
      sorted.sort((a, b) => a.price - b.price)
      break
    case 'price_desc':
      sorted.sort((a, b) => b.price - a.price)
      break
    case 'rating':
      sorted.sort((a, b) => (b.client?.rating ?? 0) - (a.client?.rating ?? 0))
      break
  }
  return sorted
})

const totalValue = computed(() =>
  displayedRequests.value.reduce((sum, r) => sum + r.price, 0)
)

const availableCities = computed(() => {
  const cities = new Set(requestsStore.activeRequests.map((r) => r.city))
  return CITIES.filter((c) => cities.has(c))
})

const categoriesWithCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const r of requestsStore.activeRequests) {
    counts[r.category] = (counts[r.category] || 0) + 1
  }
  return CATEGORIES.filter((c) => counts[c.id]).map((c) => ({
    ...c,
    count: counts[c.id] || 0,
  }))
})

const sortOptions = [
  { title: 'Сначала новые', value: 'newest' },
  { title: 'Цена: по возрастанию', value: 'price_asc' },
  { title: 'Цена: по убыванию', value: 'price_desc' },
  { title: 'Рейтинг клиента', value: 'rating' },
]

function getRatingColor(rating: number) {
  if (rating >= 4.5) return 'success'
  if (rating >= 4.0) return 'primary'
  if (rating >= 3.5) return 'warning'
  return 'error'
}

function openDetail(request: Request) {
  selectedRequest.value = request
  detailDialog.value = true
}

function openAcceptFromDetail() {
  detailDialog.value = false
  openAcceptDialog(selectedRequest.value!)
}

function openAcceptDialog(request: Request, e?: Event) {
  e?.stopPropagation()
  selectedRequest.value = request
  // Reset wizard
  acceptStep.value = 1
  offerTiers.value = getDefaultTiers()
  quickMarkup.value = 15
  acceptDialog.value = true
}

function applyQuickMarkup() {
  for (const tier of offerTiers.value) {
    tier.markupPercent = quickMarkup.value
  }
}

function toggleTerm(months: number) {
  const idx = offerTiers.value.findIndex((t) => t.termMonths === months)
  if (idx !== -1) {
    offerTiers.value[idx].enabled = !offerTiers.value[idx].enabled
  } else {
    offerTiers.value.push({ termMonths: months, markupPercent: quickMarkup.value, enabled: true })
    offerTiers.value.sort((a, b) => a.termMonths - b.termMonths)
  }
}

function isTermEnabled(months: number) {
  return offerTiers.value.some((t) => t.termMonths === months && t.enabled)
}

function getTierMarkup(months: number) {
  return offerTiers.value.find((t) => t.termMonths === months)?.markupPercent ?? quickMarkup.value
}

function setTierMarkup(months: number, value: number) {
  const tier = offerTiers.value.find((t) => t.termMonths === months)
  if (tier) {
    tier.markupPercent = value
  }
}

function calcTierTotal(markupPercent: number) {
  if (!selectedRequest.value) return 0
  return selectedRequest.value.price * (1 + markupPercent / 100)
}

function calcTierMonthly(termMonths: number, markupPercent: number) {
  if (!selectedRequest.value) return 0
  const total = selectedRequest.value.price * (1 + markupPercent / 100)
  return total / termMonths
}

async function confirmSendOffer() {
  if (!selectedRequest.value || !enabledTiers.value.length) return
  isSendingOffer.value = true
  try {
    await requestsStore.sendOffer(selectedRequest.value.id, {
      tiers: enabledTiers.value.map((t) => ({ termMonths: t.termMonths, markupPercent: t.markupPercent })),
    })
    acceptDialog.value = false
    selectedRequest.value = null
    requestsStore.fetchRequests()
  } catch (e: any) {
    console.error('Failed to send offer:', e)
  } finally {
    isSendingOffer.value = false
  }
}

function clearAllFilters() {
  search.value = ''
  selectedCategory.value = null
  selectedCity.value = null
  sortBy.value = 'newest'
  requestsStore.clearFilters()
}

const hasActiveFilters = computed(() =>
  !!search.value || !!selectedCategory.value || !!selectedCity.value || sortBy.value !== 'newest'
)

// Timeline for detail dialog (investor perspective)
const investorTimelineSteps = computed(() => {
  if (!selectedRequest.value) return []
  const status = selectedRequest.value.status
  const allSteps = [
    { icon: 'mdi-file-document-outline', label: 'Заявка создана', key: 'created' },
    { icon: 'mdi-shield-check-outline', label: 'Модерация пройдена', key: 'moderation' },
    { icon: 'mdi-eye-outline', label: 'Заявка активна', key: 'active' },
    { icon: 'mdi-send-check', label: 'Предложение отправлено', key: 'offer' },
    { icon: 'mdi-clock-outline', label: 'Ожидание выбора клиента', key: 'waiting' },
    { icon: 'mdi-check-all', label: 'Завершена', key: 'done' },
  ]

  // Map status to step index that is currently active
  const statusToActiveIdx: Record<string, number> = {
    'MODERATION': 1,
    'ACTIVE': 2,
    'OFFER_SENT': 3,
    'COMPLETED': 5,
  }
  const activeIdx = statusToActiveIdx[status] ?? 0

  return allSteps.map((s, i) => ({
    ...s,
    done: i < activeIdx,
    active: i === activeIdx,
  }))
})
</script>

<template>
  <div class="at-page">
    <!-- Stats row -->
    <v-row class="mb-1">
      <v-col cols="6" sm="3">
        <v-card rounded="lg" elevation="0" border class="pa-3 pa-sm-4 text-center">
          <div class="text-h5 font-weight-bold">{{ requestsStore.activeRequests.length }}</div>
          <div class="text-caption text-medium-emphasis">Активных заявок</div>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card rounded="lg" elevation="0" border class="pa-3 pa-sm-4 text-center">
          <div class="text-h5 font-weight-bold text-primary">{{ formatCurrency(totalValue) }}</div>
          <div class="text-caption text-medium-emphasis">Общая сумма</div>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card rounded="lg" elevation="0" border class="pa-3 pa-sm-4 text-center">
          <div class="text-h5 font-weight-bold">{{ new Set(requestsStore.activeRequests.map(r => r.clientId)).size }}</div>
          <div class="text-caption text-medium-emphasis">Клиентов</div>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card rounded="lg" elevation="0" border class="pa-3 pa-sm-4 text-center">
          <div class="text-h5 font-weight-bold">{{ categoriesWithCounts.length }}</div>
          <div class="text-caption text-medium-emphasis">Категорий</div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Tabs -->
    <div class="d-flex ga-2 mb-3">
      <v-btn
        :variant="activeTab === 'requests' ? 'flat' : 'tonal'"
        :color="activeTab === 'requests' ? 'primary' : undefined"
        size="small"
        prepend-icon="mdi-file-document-outline"
        @click="activeTab = 'requests'"
      >
        Активные заявки
        <v-chip v-if="requestsStore.activeRequests.length" size="x-small" class="ml-1" :color="activeTab === 'requests' ? 'white' : undefined">
          {{ requestsStore.activeRequests.length }}
        </v-chip>
      </v-btn>
      <v-btn
        :variant="activeTab === 'offers' ? 'flat' : 'tonal'"
        :color="activeTab === 'offers' ? 'primary' : undefined"
        size="small"
        prepend-icon="mdi-send-check"
        @click="activeTab = 'offers'"
      >
        Мои предложения
        <v-chip v-if="requestsStore.myOffers.length" size="x-small" class="ml-1" :color="activeTab === 'offers' ? 'white' : undefined">
          {{ requestsStore.myOffers.length }}
        </v-chip>
      </v-btn>
    </div>

    <!-- My Offers section -->
    <template v-if="activeTab === 'offers'">
      <v-card v-if="requestsStore.myOffers.length" rounded="lg" elevation="0" border>
        <div class="pa-4">
          <div class="text-body-2 font-weight-medium text-medium-emphasis mb-3">
            Заявки, на которые вы отправили предложение. Ожидайте ответа клиента.
          </div>
          <v-row>
            <v-col v-for="req in requestsStore.myOffers" :key="req.id" cols="12" sm="6" lg="4">
              <v-card rounded="lg" elevation="0" border hover class="pa-4" @click="openDetail(req)">
                <div class="d-flex align-start ga-3 mb-3">
                  <v-avatar size="48" rounded="lg" :color="req.photos?.length ? undefined : 'grey-lighten-3'">
                    <v-img v-if="req.photos?.length" :src="req.photos[0]" cover />
                    <v-icon v-else icon="mdi-image-off-outline" size="22" color="grey" />
                  </v-avatar>
                  <div class="flex-grow-1" style="min-width: 0">
                    <div class="text-body-2 font-weight-bold text-truncate">{{ req.title }}</div>
                    <div class="text-caption text-medium-emphasis">{{ userName(req.client) }} · {{ req.city }}</div>
                  </div>
                </div>

                <!-- Timeline mini -->
                <div class="d-flex align-center ga-2 mb-3">
                  <v-icon icon="mdi-check-circle" size="16" color="primary" />
                  <div class="timeline-line active" />
                  <v-icon icon="mdi-send-check" size="16" color="primary" />
                  <div class="timeline-line" />
                  <v-icon icon="mdi-clock-outline" size="16" color="warning" />
                  <div class="timeline-line" />
                  <v-icon icon="mdi-handshake-outline" size="16" color="grey-lighten-1" />
                </div>

                <div class="d-flex justify-space-between align-center">
                  <v-chip size="x-small" color="warning" variant="tonal" prepend-icon="mdi-clock-outline">
                    Ожидание ответа
                  </v-chip>
                  <span class="text-body-2 font-weight-bold text-primary">{{ req.offerTiers?.length || 0 }} {{ (req.offerTiers?.length || 0) === 1 ? 'вариант' : (req.offerTiers?.length || 0) < 5 ? 'варианта' : 'вариантов' }}</span>
                </div>
              </v-card>
            </v-col>
          </v-row>
        </div>
      </v-card>
      <v-card v-else rounded="lg" elevation="0" border>
        <div class="text-center pa-12">
          <v-icon icon="mdi-send-check" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Нет отправленных предложений</p>
          <p class="text-body-2 text-medium-emphasis">Откликнитесь на заявку, чтобы отправить предложение клиенту</p>
        </div>
      </v-card>
    </template>

    <!-- Main card (Active requests) -->
    <v-card v-if="activeTab === 'requests'" rounded="lg" elevation="0" border>
      <div class="pa-4">
        <!-- Toolbar -->
        <div class="d-flex flex-wrap ga-2 align-center mb-4">
          <div class="filter-input-wrap" style="max-width: 280px; min-width: 180px">
            <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
            <input
              v-model="search"
              type="text"
              placeholder="Поиск..."
              class="filter-input"
            />
          </div>

          <v-select
            v-model="selectedCity"
            :items="availableCities"
            placeholder="Город"
            variant="solo-filled"
            flat
            density="compact"
            hide-details
            clearable
            prepend-inner-icon="mdi-map-marker-outline"
            class="filter-select"
            style="max-width: 180px; min-width: 140px"
          />

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
            style="max-width: 220px; min-width: 180px"
          />

          <v-spacer class="d-none d-md-block" />

          <div class="view-toggle">
            <button
              class="view-toggle-btn"
              :class="{ active: viewMode === 'table' }"
              @click="viewMode = 'table'"
            >
              <v-icon icon="mdi-table" size="18" />
            </button>
            <button
              class="view-toggle-btn"
              :class="{ active: viewMode === 'grid' }"
              @click="viewMode = 'grid'"
            >
              <v-icon icon="mdi-view-grid-outline" size="18" />
            </button>
          </div>
        </div>

        <!-- Categories -->
        <div class="categories-row mb-4">
          <button
            class="cat-btn"
            :class="{ active: selectedCategory === null }"
            @click="selectedCategory = null"
          >
            <v-icon icon="mdi-view-grid" size="18" />
            <span>Все</span>
            <span class="cat-count">{{ requestsStore.activeRequests.length }}</span>
          </button>
          <button
            v-for="cat in categoriesWithCounts"
            :key="cat.id"
            class="cat-btn"
            :class="{ active: selectedCategory === cat.id }"
            @click="selectedCategory = selectedCategory === cat.id ? null : cat.id"
          >
            <v-icon :icon="cat.icon" size="18" />
            <span>{{ cat.label }}</span>
            <span class="cat-count">{{ cat.count }}</span>
          </button>

          <button v-if="hasActiveFilters" class="cat-btn reset" @click="clearAllFilters">
            <v-icon icon="mdi-close" size="16" />
            <span>Сбросить</span>
          </button>
        </div>

        <!-- Results count -->
        <div v-if="displayedRequests.length" class="text-caption text-medium-emphasis mb-3">
          {{ displayedRequests.length }} {{ displayedRequests.length === 1 ? 'заявка' : displayedRequests.length < 5 ? 'заявки' : 'заявок' }}
        </div>

        <!-- GRID VIEW -->
        <v-row v-if="viewMode === 'grid' && displayedRequests.length">
          <v-col v-for="req in displayedRequests" :key="req.id" cols="12" sm="6" lg="4">
            <v-card rounded="lg" elevation="0" border class="request-card d-flex flex-column" style="height: 100%" hover @click="openDetail(req)">
              <div class="position-relative rounded-t-lg overflow-hidden" style="height: 140px">
                <v-img v-if="req.photos?.length" :src="req.photos[0]" height="140" cover />
                <div v-else class="d-flex align-center justify-center h-100" style="background: rgba(var(--v-theme-on-surface), 0.06)">
                  <v-icon icon="mdi-image-off-outline" size="40" color="grey" />
                </div>
                <div class="d-flex justify-space-between align-start pa-2 position-absolute" style="top: 0; left: 0; right: 0">
                  <v-chip size="x-small" variant="flat" class="overlay-chip">
                    <v-icon :icon="CATEGORIES.find(c => c.id === req.category)?.icon" size="12" start />
                    {{ getCategoryLabel(req.category) }}
                  </v-chip>
                  <v-chip size="x-small" variant="flat" class="overlay-chip">
                    {{ timeAgo(req.createdAt) }}
                  </v-chip>
                </div>
              </div>

              <div class="pa-4 flex-grow-1 d-flex flex-column">
                <div class="text-subtitle-2 font-weight-bold mb-1" style="line-height: 1.3">{{ req.title }}</div>

                <div v-if="req.description" class="text-caption text-medium-emphasis mb-2 line-clamp-2">
                  {{ req.description }}
                </div>

                <div class="d-flex flex-wrap ga-1 mb-3">
                  <span class="detail-tag"><v-icon icon="mdi-map-marker-outline" size="12" /> {{ req.city }}</span>
                </div>

                <v-spacer />

                <div class="d-flex align-center justify-space-between">
                  <div class="d-flex align-center ga-2">
                    <div class="avatar-sm" :class="'rating-' + getRatingColor(req.client?.rating ?? 0)">
                      {{ userName(req.client)[0] }}
                    </div>
                    <div>
                      <div class="text-caption font-weight-medium">{{ userName(req.client) }}</div>
                      <div class="d-flex align-center ga-1">
                        <v-icon icon="mdi-star" size="10" :color="getRatingColor(req.client?.rating ?? 0)" />
                        <span class="text-caption">{{ req.client?.rating ?? 0 }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="text-subtitle-1 font-weight-bold text-primary">{{ formatCurrency(req.price) }}</div>
                </div>
              </div>

              <v-divider />
              <div class="pa-2 px-3">
                <v-btn color="primary" variant="tonal" block size="small" @click.stop="openAcceptDialog(req)">
                  Откликнуться
                </v-btn>
              </div>
            </v-card>
          </v-col>
        </v-row>

        <!-- TABLE VIEW -->
        <v-table v-if="viewMode === 'table' && displayedRequests.length" density="default" hover class="requests-table">
          <thead>
            <tr>
              <th>Товар</th>
              <th>Категория</th>
              <th>Клиент</th>
              <th class="text-center">Рейтинг</th>
              <th>Город</th>
              <th class="text-end">Цена</th>
              <th>Дата</th>
              <th style="width: 44px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="req in displayedRequests" :key="req.id" class="cursor-pointer" @click="openDetail(req)">
              <td>
                <div class="d-flex align-center ga-3 py-3">
                  <v-avatar size="48" rounded="lg" :color="req.photos?.length ? undefined : 'grey-lighten-3'">
                    <v-img v-if="req.photos?.length" :src="req.photos[0]" cover />
                    <v-icon v-else icon="mdi-image-off-outline" size="22" color="grey" />
                  </v-avatar>
                  <span class="font-weight-medium table-title">{{ req.title }}</span>
                </div>
              </td>
              <td>
                <v-chip size="small" variant="tonal" :prepend-icon="CATEGORIES.find(c => c.id === req.category)?.icon">
                  {{ getCategoryLabel(req.category) }}
                </v-chip>
              </td>
              <td>{{ userName(req.client) }}</td>
              <td class="text-center">
                <v-chip size="small" :color="getRatingColor(req.client?.rating ?? 0)" variant="tonal">
                  <v-icon icon="mdi-star" size="12" start /> {{ req.client?.rating ?? 0 }}
                </v-chip>
              </td>
              <td class="text-medium-emphasis">{{ req.city }}</td>
              <td class="text-end font-weight-bold text-primary text-no-wrap">{{ formatCurrency(req.price) }}</td>
              <td class="text-medium-emphasis text-no-wrap">{{ timeAgo(req.createdAt) }}</td>
              <td>
                <v-btn icon="mdi-handshake-outline" size="small" color="primary" variant="tonal" @click.stop="openAcceptDialog(req)" />
              </td>
            </tr>
          </tbody>
        </v-table>

        <!-- Empty state -->
        <div v-if="!displayedRequests.length" class="text-center pa-12">
          <v-icon icon="mdi-file-search-outline" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Заявки не найдены</p>
          <p class="text-body-2 text-medium-emphasis mb-4">Попробуйте изменить фильтры</p>
          <v-btn v-if="hasActiveFilters" variant="tonal" size="small" @click="clearAllFilters">
            Сбросить фильтры
          </v-btn>
        </div>
      </div>
    </v-card>

    <!-- Detail Dialog -->
    <v-dialog v-model="detailDialog" max-width="600">
      <v-card v-if="selectedRequest" rounded="lg">
        <v-img v-if="selectedRequest.photos?.length" :src="selectedRequest.photos[0]" height="200" cover />
        <div v-else class="d-flex align-center justify-center" style="height: 200px; background: rgba(var(--v-theme-on-surface), 0.06)">
          <v-icon icon="mdi-image-off-outline" size="48" color="grey" />
        </div>

        <div class="pa-5">
          <div class="d-flex align-start justify-space-between ga-3 mb-3">
            <div>
              <div class="text-h6 font-weight-bold mb-1">{{ selectedRequest.title }}</div>
              <v-chip size="small" variant="tonal" :prepend-icon="CATEGORIES.find(c => c.id === selectedRequest.category)?.icon">
                {{ getCategoryLabel(selectedRequest.category) }}
              </v-chip>
            </div>
            <div class="text-h5 font-weight-bold text-primary flex-shrink-0">{{ formatCurrency(selectedRequest.price) }}</div>
          </div>

          <div v-if="selectedRequest.description" class="text-body-2 mb-4">{{ selectedRequest.description }}</div>

          <!-- Info grid -->
          <v-card rounded="lg" elevation="0" class="detail-info-card mb-4 pa-4">
            <v-row dense>
              <v-col cols="6">
                <div class="text-caption text-medium-emphasis">Город</div>
                <div class="text-body-2 font-weight-medium">{{ selectedRequest.city }}</div>
              </v-col>
              <v-col cols="6">
                <div class="text-caption text-medium-emphasis">Опубликовано</div>
                <div class="text-body-2 font-weight-medium">{{ formatDate(selectedRequest.createdAt) }}</div>
              </v-col>
            </v-row>
          </v-card>

          <!-- Quick calc -->
          <v-card rounded="lg" elevation="0" class="detail-calc-card mb-4 pa-4">
            <div class="text-caption font-weight-bold text-uppercase mb-2">
              <v-icon icon="mdi-calculator-variant-outline" size="14" class="mr-1" />
              Расчёт при наценке 20%
            </div>
            <v-row dense>
              <v-col cols="6" sm="3">
                <div class="text-caption text-medium-emphasis">Прибыль</div>
                <div class="text-body-2 font-weight-bold text-success">+{{ formatCurrency(selectedRequest.price * 0.2) }}</div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="text-caption text-medium-emphasis">Итого клиенту</div>
                <div class="text-body-2 font-weight-bold">{{ formatCurrency(selectedRequest.price * 1.2) }}</div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="text-caption text-medium-emphasis">В месяц (6 мес)</div>
                <div class="text-body-2 font-weight-bold">{{ formatCurrency(selectedRequest.price * 1.2 / 6) }}</div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="text-caption text-medium-emphasis">В месяц (12 мес)</div>
                <div class="text-body-2 font-weight-bold">{{ formatCurrency(selectedRequest.price * 1.2 / 12) }}</div>
              </v-col>
            </v-row>
          </v-card>

          <!-- Client -->
          <v-card rounded="lg" elevation="0" border class="pa-3 mb-4">
            <div class="d-flex align-center ga-3">
              <div class="avatar-md" :class="'rating-' + getRatingColor(selectedRequest.client?.rating ?? 0)">
                {{ userName(selectedRequest.client).split(' ').map((n: string) => n[0]).join('') }}
              </div>
              <div class="flex-grow-1">
                <div class="text-body-1 font-weight-bold">{{ userName(selectedRequest.client) }}</div>
                <div class="d-flex align-center ga-3 mt-1">
                  <span class="d-flex align-center ga-1 text-caption">
                    <v-icon icon="mdi-star" size="14" :color="getRatingColor(selectedRequest.client?.rating ?? 0)" />
                    {{ selectedRequest.client?.rating ?? 0 }}
                  </span>
                  <span class="d-flex align-center ga-1 text-caption">
                    <v-icon icon="mdi-check-decagram" size="14" color="primary" />
                    {{ selectedRequest.client?.completedDeals ?? 0 }} сделок
                  </span>
                  <span class="d-flex align-center ga-1 text-caption text-medium-emphasis">
                    <v-icon icon="mdi-map-marker" size="14" />
                    {{ selectedRequest.city }}
                  </span>
                </div>
              </div>
            </div>
          </v-card>

          <v-btn
            v-if="selectedRequest.productUrl"
            :href="selectedRequest.productUrl"
            target="_blank"
            variant="tonal"
            size="small"
            prepend-icon="mdi-open-in-new"
            class="mb-4"
          >
            Ссылка на товар
          </v-btn>

          <!-- Timeline (always visible) -->
          <v-card v-if="investorTimelineSteps.length" rounded="lg" elevation="0" class="timeline-card pa-4 mb-4">
            <div class="d-flex align-center ga-2 mb-3">
              <v-icon icon="mdi-timeline-clock-outline" size="18" color="primary" />
              <span class="text-body-2 font-weight-bold">Прогресс заявки</span>
            </div>

            <div class="timeline-vertical">
              <div v-for="(step, i) in investorTimelineSteps" :key="step.key" class="timeline-step">
                <div class="timeline-dot" :class="{ done: step.done, active: step.active }">
                  <v-icon :icon="step.done ? 'mdi-check' : step.icon" size="14" :color="step.done ? 'white' : step.active ? 'primary' : 'grey-lighten-1'" />
                </div>
                <div v-if="i < investorTimelineSteps.length - 1" class="timeline-connector" :class="{ done: step.done }" />
                <span class="timeline-label" :class="{ 'font-weight-bold': step.done || step.active, 'text-medium-emphasis': !step.done && !step.active }">
                  {{ step.label }}
                </span>
              </div>
            </div>
          </v-card>

          <!-- Offer tiers (when offer has been sent) -->
          <v-card v-if="selectedRequest.offerTiers?.length" rounded="lg" elevation="0" border class="pa-4 mb-4">
            <div class="text-body-2 font-weight-bold mb-3">
              <v-icon icon="mdi-file-document-check-outline" size="16" class="mr-1" />
              Ваше предложение ({{ selectedRequest.offerTiers.length }} {{ selectedRequest.offerTiers.length === 1 ? 'вариант' : selectedRequest.offerTiers.length < 5 ? 'варианта' : 'вариантов' }})
            </div>
            <v-row dense>
              <v-col v-for="(tier, i) in selectedRequest.offerTiers" :key="i" cols="12" sm="4">
                <v-card rounded="lg" elevation="0" variant="tonal" color="primary" class="pa-3 text-center">
                  <div class="text-caption text-medium-emphasis mb-1">{{ formatMonths(tier.termMonths) }}</div>
                  <div class="text-body-2 font-weight-bold">{{ tier.markupPercent }}% наценка</div>
                  <div class="text-caption mt-1">{{ formatCurrency(selectedRequest.price * (1 + tier.markupPercent / 100)) }}</div>
                  <div class="text-caption text-medium-emphasis">{{ formatCurrency(selectedRequest.price * (1 + tier.markupPercent / 100) / tier.termMonths) }}/мес</div>
                </v-card>
              </v-col>
            </v-row>
          </v-card>
        </div>

        <v-divider />
        <div class="pa-4 d-flex ga-2">
          <v-btn variant="tonal" class="flex-grow-1" @click="detailDialog = false">Закрыть</v-btn>
          <v-btn v-if="selectedRequest.status === 'ACTIVE'" color="primary" variant="flat" class="flex-grow-1" prepend-icon="mdi-handshake-outline" @click="openAcceptFromDetail">Откликнуться</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- Offer Tiers Wizard Dialog -->
    <v-dialog v-model="acceptDialog" max-width="640" persistent>
      <v-card v-if="selectedRequest" rounded="lg">
        <!-- Header -->
        <div class="pa-4 pb-0">
          <div class="d-flex align-center justify-space-between mb-3">
            <div class="text-subtitle-1 font-weight-bold">Отправка предложения</div>
            <v-btn icon="mdi-close" variant="text" size="small" @click="acceptDialog = false" />
          </div>

          <!-- Steps indicator -->
          <div class="d-flex ga-2 mb-4">
            <div v-for="s in 2" :key="s" class="step-indicator" :class="{ active: s <= acceptStep, current: s === acceptStep }">
              <span class="step-num">{{ s }}</span>
              <span class="step-label">{{ ['Настройка тарифов', 'Предпросмотр'][s - 1] }}</span>
            </div>
          </div>

          <!-- Request summary -->
          <v-card rounded="lg" elevation="0" border class="pa-3 mb-4">
            <div class="d-flex ga-3 align-center">
              <v-avatar size="44" rounded="lg" :color="selectedRequest.photos?.length ? undefined : 'grey-lighten-3'">
                <v-img v-if="selectedRequest.photos?.length" :src="selectedRequest.photos[0]" cover />
                <v-icon v-else icon="mdi-image-off-outline" size="20" color="grey" />
              </v-avatar>
              <div class="flex-grow-1">
                <div class="text-body-2 font-weight-bold">{{ selectedRequest.title }}</div>
                <div class="text-caption text-medium-emphasis">{{ userName(selectedRequest.client) }} · {{ selectedRequest.city }}</div>
              </div>
              <div class="text-subtitle-2 font-weight-bold text-primary">{{ formatCurrency(selectedRequest.price) }}</div>
            </div>
          </v-card>
        </div>

        <v-divider />

        <div class="pa-4" style="max-height: 60vh; overflow-y: auto">
          <!-- Step 1: Configure tiers -->
          <template v-if="acceptStep === 1">
            <!-- Quick markup apply -->
            <div class="text-body-2 font-weight-medium mb-2">Быстрая наценка для всех</div>
            <div class="d-flex ga-2 flex-wrap mb-2">
              <v-btn
                v-for="m in MARKUP_OPTIONS" :key="m"
                :variant="quickMarkup === m ? 'flat' : 'tonal'"
                :color="quickMarkup === m ? 'primary' : undefined"
                size="small"
                @click="quickMarkup = m"
              >{{ m }}%</v-btn>
            </div>
            <v-btn variant="tonal" size="small" class="mb-4" prepend-icon="mdi-check-all" @click="applyQuickMarkup">
              Применить {{ quickMarkup }}% ко всем
            </v-btn>

            <!-- Term cards -->
            <div class="text-body-2 font-weight-medium mb-2">Варианты сроков</div>
            <div class="d-flex flex-column ga-3">
              <v-card
                v-for="months in TERM_OPTIONS" :key="months"
                rounded="lg"
                elevation="0"
                :border="!isTermEnabled(months)"
                :color="isTermEnabled(months) ? 'primary' : undefined"
                :variant="isTermEnabled(months) ? 'tonal' : 'outlined'"
                class="pa-3"
              >
                <div class="d-flex align-center ga-3">
                  <v-checkbox
                    :model-value="isTermEnabled(months)"
                    hide-details
                    density="compact"
                    color="primary"
                    @update:model-value="toggleTerm(months)"
                  />
                  <div class="flex-grow-1">
                    <div class="text-body-2 font-weight-bold">{{ formatMonths(months) }}</div>
                    <div v-if="isTermEnabled(months)" class="text-caption text-medium-emphasis">
                      Итого: {{ formatCurrency(calcTierTotal(getTierMarkup(months))) }} · {{ formatCurrency(calcTierMonthly(months, getTierMarkup(months))) }}/мес
                    </div>
                  </div>
                  <div v-if="isTermEnabled(months)" style="width: 100px">
                    <v-text-field
                      :model-value="getTierMarkup(months)"
                      type="number"
                      variant="outlined"
                      density="compact"
                      suffix="%"
                      hide-details
                      @update:model-value="(v: any) => setTierMarkup(months, Number(v))"
                    />
                  </div>
                </div>
              </v-card>
            </div>

            <div v-if="!enabledTiers.length" class="text-caption text-error mt-2">
              Выберите хотя бы один вариант срока
            </div>
          </template>

          <!-- Step 2: Preview -->
          <template v-if="acceptStep === 2">
            <div class="text-body-2 font-weight-medium mb-3">
              Клиент увидит следующие варианты и сможет выбрать один из них:
            </div>
            <v-row dense>
              <v-col v-for="(tier, i) in enabledTiers" :key="i" cols="12" sm="4">
                <v-card rounded="lg" elevation="0" border class="pa-4 text-center tier-preview-card">
                  <div class="text-h6 font-weight-bold text-primary mb-1">{{ formatMonths(tier.termMonths) }}</div>
                  <v-divider class="my-2" />
                  <div class="text-caption text-medium-emphasis">Наценка</div>
                  <div class="text-body-2 font-weight-bold mb-2">{{ tier.markupPercent }}%</div>
                  <div class="text-caption text-medium-emphasis">Итого</div>
                  <div class="text-body-2 font-weight-bold mb-2">{{ formatCurrency(calcTierTotal(tier.markupPercent)) }}</div>
                  <div class="text-caption text-medium-emphasis">Ежемесячный платёж</div>
                  <div class="text-body-1 font-weight-bold text-primary">{{ formatCurrency(calcTierMonthly(tier.termMonths, tier.markupPercent)) }}</div>
                </v-card>
              </v-col>
            </v-row>

            <v-card rounded="lg" elevation="0" class="detail-calc-card pa-4 mt-4 mb-4">
              <div class="text-body-2 font-weight-bold mb-1 text-success">
                <v-icon icon="mdi-trending-up" size="16" class="mr-1" />
                Ваша прибыль: от {{ formatCurrency(selectedRequest.price * Math.min(...enabledTiers.map(t => t.markupPercent)) / 100) }} до {{ formatCurrency(selectedRequest.price * Math.max(...enabledTiers.map(t => t.markupPercent)) / 100) }}
              </div>
              <div class="text-caption text-medium-emphasis">
                Клиент: {{ userName(selectedRequest.client) }} · {{ enabledTiers.length }} {{ enabledTiers.length === 1 ? 'вариант' : enabledTiers.length < 5 ? 'варианта' : 'вариантов' }}
              </div>
            </v-card>

            <v-alert type="info" variant="tonal" density="compact" class="text-caption" rounded="lg">
              Клиент получит ваше предложение и сможет выбрать подходящий вариант. После выбора будет создана активная сделка.
            </v-alert>
          </template>
        </div>

        <v-divider />

        <!-- Footer actions -->
        <div class="pa-4 d-flex ga-2">
          <v-btn v-if="acceptStep > 1" variant="tonal" class="flex-grow-1" @click="acceptStep--">Назад</v-btn>
          <v-btn v-else variant="tonal" class="flex-grow-1" @click="acceptDialog = false">Отмена</v-btn>

          <v-btn
            v-if="acceptStep < 2"
            color="primary"
            variant="flat"
            class="flex-grow-1"
            :disabled="!enabledTiers.length"
            @click="acceptStep++"
          >Далее</v-btn>
          <v-btn
            v-else
            color="primary"
            variant="flat"
            class="flex-grow-1"
            :loading="isSendingOffer"
            prepend-icon="mdi-handshake-outline"
            @click="confirmSendOffer"
          >Отправить предложение</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Search input matching header style */
.filter-input-wrap {
  position: relative;
  flex: 1;
}

.filter-input-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  pointer-events: none;
}

.filter-input {
  width: 100%;
  height: 40px;
  padding: 0 16px 0 38px;
  border: 1px solid #e4e4e7;
  border-radius: 10px;
  background: #f4f4f5;
  font-size: 14px;
  color: inherit;
  outline: none;
  transition: all 0.15s ease;
}

.filter-input::placeholder {
  color: #9ca3af;
}

.filter-input:focus {
  border-color: #047857;
  background: #fff;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}

:deep(.filter-select .v-field) {
  border-radius: 10px;
  height: 40px;
  min-height: 40px !important;
  background: #f4f4f5 !important;
  border: 1px solid #e4e4e7;
  box-shadow: none !important;
  padding: 0 8px 0 12px;
  font-size: 14px;
  transition: all 0.15s ease;
}

:deep(.filter-select .v-field .v-field__input) {
  padding: 0 0 0 4px;
  min-height: unset !important;
  height: 40px;
  display: flex;
  align-items: center;
  font-size: 14px;
}

:deep(.filter-select .v-field .v-field__prepend-inner),
:deep(.filter-select .v-field .v-field__append-inner) {
  padding-top: 0 !important;
  align-self: center;
}

:deep(.v-select .v-field .v-field__input > input) {
  top: 50%;
  transform: translateY(-50%);
}

:deep(.filter-select .v-field .v-field__prepend-inner .v-icon),
:deep(.filter-select .v-field .v-field__append-inner .v-icon) {
  color: #9ca3af;
}

:deep(.filter-select .v-field--focused) {
  border-color: #047857 !important;
  background: #fff !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent) !important;
}

/* View toggle */
.view-toggle {
  display: flex;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #e4e4e7;
  background: #f4f4f5;
}

.view-toggle-btn {
  width: 40px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.45);
  transition: all 0.15s;
}

.view-toggle-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.view-toggle-btn.active {
  background: #fff;
  color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* Categories */
.categories-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.cat-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 20px;
  border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.cat-btn:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

.cat-btn.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

.cat-btn.reset {
  color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.06);
}

.cat-btn.reset:hover {
  background: rgba(var(--v-theme-error), 0.12);
}

.cat-count {
  font-size: 11px;
  font-weight: 600;
  padding: 0 6px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  line-height: 18px;
  min-width: 20px;
  text-align: center;
}

.cat-btn.active .cat-count {
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
}

/* Grid cards */
.request-card {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.request-card:hover {
  transform: translateY(-2px);
}

.overlay-chip {
  background: rgba(0, 0, 0, 0.55) !important;
  color: #fff !important;
  backdrop-filter: blur(4px);
  font-size: 11px !important;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.detail-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* Avatars */
.avatar-sm {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.avatar-md {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rating-success { background: linear-gradient(135deg, #047857, #059669); }
.rating-primary { background: linear-gradient(135deg, #047857, #10b981); }
.rating-warning { background: linear-gradient(135deg, #d97706, #f59e0b); }
.rating-error { background: linear-gradient(135deg, #dc2626, #ef4444); }

/* Table */
.cursor-pointer { cursor: pointer; }

.table-title {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Detail dialog */
.detail-info-card {
  background: rgba(var(--v-theme-primary), 0.04);
}

.detail-calc-card {
  background: rgba(var(--v-theme-success), 0.05);
  border: 1px solid rgba(var(--v-theme-success), 0.12);
}

/* Timeline mini (offers cards) */
.timeline-line {
  flex: 1;
  height: 2px;
  background: rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 1px;
}

.timeline-line.active {
  background: rgb(var(--v-theme-primary));
}

.timeline-card {
  background: rgba(var(--v-theme-primary), 0.04);
  border: 1px solid rgba(var(--v-theme-primary), 0.1);
}

/* Timeline vertical (detail dialog) */
.timeline-vertical {
  position: relative;
}

.timeline-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  position: relative;
  padding-bottom: 20px;
}

.timeline-step:last-child {
  padding-bottom: 0;
}

.timeline-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  z-index: 1;
}

.timeline-dot.done {
  background: rgb(var(--v-theme-primary));
}

.timeline-dot.active {
  background: rgba(var(--v-theme-primary), 0.12);
  border: 2px solid rgb(var(--v-theme-primary));
}

.timeline-connector {
  position: absolute;
  left: 13px;
  top: 28px;
  width: 2px;
  height: calc(100% - 28px);
  background: rgba(var(--v-theme-on-surface), 0.1);
}

.timeline-connector.done {
  background: rgb(var(--v-theme-primary));
}

.timeline-label {
  font-size: 13px;
  padding-top: 4px;
}

/* Step indicator */
.step-indicator {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  transition: all 0.2s;
}

.step-indicator.active {
  background: rgba(var(--v-theme-primary), 0.08);
}

.step-indicator.current {
  background: rgba(var(--v-theme-primary), 0.14);
}

.step-num {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.step-indicator.active .step-num {
  background: rgb(var(--v-theme-primary));
  color: #fff;
}

.step-label {
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  white-space: nowrap;
}

.step-indicator.active .step-label {
  color: rgb(var(--v-theme-primary));
}

.step-indicator.current .step-label {
  font-weight: 600;
}

/* Tier preview cards */
.tier-preview-card {
  transition: transform 0.15s ease;
}
.tier-preview-card:hover {
  transform: translateY(-2px);
}

/* Table */
.requests-table :deep(td) {
  font-size: 14px;
}

.requests-table :deep(th) {
  font-size: 12px !important;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}

/* Dark mode overrides */
:global(.dark) .filter-input {
  background: #252538;
  border-color: #2e2e42;
  color: #e4e4e7;
}

:global(.dark) .filter-input::placeholder {
  color: #71717a;
}

:global(.dark) .filter-input:focus {
  border-color: #047857;
  background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}

:global(.dark) :deep(.filter-select .v-field) {
  background: #252538 !important;
  border-color: #2e2e42;
  color: #e4e4e7;
}

:global(.dark) :deep(.filter-select .v-field .v-field__prepend-inner),
:global(.dark) :deep(.filter-select .v-field .v-field__append-inner) {
  color: #71717a;
}

:global(.dark) :deep(.filter-select .v-field--focused) {
  border-color: #047857 !important;
  background: #1e1e2e !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent) !important;
}

:global(.dark) .view-toggle {
  background: #252538;
  border-color: #2e2e42;
}

:global(.dark) .view-toggle-btn.active {
  background: #2e2e42;
  box-shadow: none;
}
</style>
