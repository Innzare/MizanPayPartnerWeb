<script lang="ts" setup>
import { useRequestsStore } from '@/stores/requests'
import { formatCurrency, formatMonths, timeAgo, formatDate } from '@/utils/formatters'
import { CATEGORIES, getCategoryLabel } from '@/constants/categories'
import { CITIES } from '@/constants/cities'
import type { Request } from '@/types'

const requestsStore = useRequestsStore()

const search = ref('')
const selectedCategory = ref<string | null>(null)
const selectedCity = ref<string | null>(null)
const sortBy = ref<'newest' | 'price_asc' | 'price_desc' | 'rating'>('newest')
const viewMode = ref<'grid' | 'table'>('table')
const detailDialog = ref(false)
const acceptDialog = ref(false)
const selectedRequest = ref<Request | null>(null)

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
      sorted.sort((a, b) => b.clientRating - a.clientRating)
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

// Categories with counts
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
  acceptDialog.value = true
}

function openAcceptDialog(request: Request, e?: Event) {
  e?.stopPropagation()
  selectedRequest.value = request
  acceptDialog.value = true
}

function confirmAccept() {
  if (!selectedRequest.value) return
  requestsStore.acceptRequest(selectedRequest.value.id)
  acceptDialog.value = false
  selectedRequest.value = null
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

    <!-- Main card -->
    <v-card rounded="lg" elevation="0" border>
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
              <v-img :src="req.photos[0]" height="140" cover class="rounded-t-lg">
                <div class="d-flex justify-space-between align-start pa-2">
                  <v-chip size="x-small" variant="flat" class="overlay-chip">
                    <v-icon :icon="CATEGORIES.find(c => c.id === req.category)?.icon" size="12" start />
                    {{ getCategoryLabel(req.category) }}
                  </v-chip>
                  <v-chip size="x-small" variant="flat" class="overlay-chip">
                    {{ timeAgo(req.createdAt) }}
                  </v-chip>
                </div>
              </v-img>

              <div class="pa-4 flex-grow-1 d-flex flex-column">
                <div class="text-subtitle-2 font-weight-bold mb-1" style="line-height: 1.3">{{ req.title }}</div>

                <div v-if="req.description" class="text-caption text-medium-emphasis mb-2 line-clamp-2">
                  {{ req.description }}
                </div>

                <div class="d-flex flex-wrap ga-1 mb-3">
                  <span class="detail-tag"><v-icon icon="mdi-clock-outline" size="12" /> {{ formatMonths(req.desiredTermMonths) }}</span>
                  <span class="detail-tag"><v-icon icon="mdi-map-marker-outline" size="12" /> {{ req.city }}</span>
                  <span v-if="req.downPayment" class="detail-tag"><v-icon icon="mdi-cash" size="12" /> {{ formatCurrency(req.downPayment) }}</span>
                </div>

                <v-spacer />

                <div class="d-flex align-center justify-space-between">
                  <div class="d-flex align-center ga-2">
                    <div class="avatar-sm" :class="'rating-' + getRatingColor(req.clientRating)">
                      {{ req.clientName[0] }}
                    </div>
                    <div>
                      <div class="text-caption font-weight-medium">{{ req.clientName }}</div>
                      <div class="d-flex align-center ga-1">
                        <v-icon icon="mdi-star" size="10" :color="getRatingColor(req.clientRating)" />
                        <span class="text-caption">{{ req.clientRating }}</span>
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
              <th class="text-center">Срок</th>
              <th class="text-end">Взнос</th>
              <th>Дата</th>
              <th style="width: 44px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="req in displayedRequests" :key="req.id" class="cursor-pointer" @click="openDetail(req)">
              <td>
                <div class="d-flex align-center ga-3 py-3">
                  <v-avatar size="48" rounded="lg">
                    <v-img :src="req.photos[0]" cover />
                  </v-avatar>
                  <span class="font-weight-medium table-title">{{ req.title }}</span>
                </div>
              </td>
              <td>
                <v-chip size="small" variant="tonal" :prepend-icon="CATEGORIES.find(c => c.id === req.category)?.icon">
                  {{ getCategoryLabel(req.category) }}
                </v-chip>
              </td>
              <td>{{ req.clientName }}</td>
              <td class="text-center">
                <v-chip size="small" :color="getRatingColor(req.clientRating)" variant="tonal">
                  <v-icon icon="mdi-star" size="12" start /> {{ req.clientRating }}
                </v-chip>
              </td>
              <td class="text-medium-emphasis">{{ req.city }}</td>
              <td class="text-end font-weight-bold text-primary text-no-wrap">{{ formatCurrency(req.price) }}</td>
              <td class="text-center text-no-wrap">{{ req.desiredTermMonths }} мес</td>
              <td class="text-end text-no-wrap">{{ req.downPayment ? formatCurrency(req.downPayment) : '—' }}</td>
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
        <v-img :src="selectedRequest.photos[0]" height="200" cover />

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
                <div class="text-caption text-medium-emphasis">Срок рассрочки</div>
                <div class="text-body-2 font-weight-medium">{{ formatMonths(selectedRequest.desiredTermMonths) }}</div>
              </v-col>
              <v-col cols="6">
                <div class="text-caption text-medium-emphasis">Город</div>
                <div class="text-body-2 font-weight-medium">{{ selectedRequest.city }}</div>
              </v-col>
              <v-col v-if="selectedRequest.downPayment" cols="6">
                <div class="text-caption text-medium-emphasis">Первоначальный взнос</div>
                <div class="text-body-2 font-weight-medium">{{ formatCurrency(selectedRequest.downPayment) }}</div>
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
                <div class="text-caption text-medium-emphasis">В месяц</div>
                <div class="text-body-2 font-weight-bold">{{ formatCurrency((selectedRequest.price * 1.2 - (selectedRequest.downPayment || 0)) / selectedRequest.desiredTermMonths) }}</div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="text-caption text-medium-emphasis">ROI</div>
                <div class="text-body-2 font-weight-bold text-primary">{{ (0.2 / (selectedRequest.desiredTermMonths / 12) * 100).toFixed(1) }}%/год</div>
              </v-col>
            </v-row>
          </v-card>

          <!-- Client -->
          <v-card rounded="lg" elevation="0" border class="pa-3 mb-4">
            <div class="d-flex align-center ga-3">
              <div class="avatar-md" :class="'rating-' + getRatingColor(selectedRequest.clientRating)">
                {{ selectedRequest.clientName.split(' ').map((n: string) => n[0]).join('') }}
              </div>
              <div class="flex-grow-1">
                <div class="text-body-1 font-weight-bold">{{ selectedRequest.clientName }}</div>
                <div class="d-flex align-center ga-3 mt-1">
                  <span class="d-flex align-center ga-1 text-caption">
                    <v-icon icon="mdi-star" size="14" :color="getRatingColor(selectedRequest.clientRating)" />
                    {{ selectedRequest.clientRating }}
                  </span>
                  <span class="d-flex align-center ga-1 text-caption">
                    <v-icon icon="mdi-check-decagram" size="14" color="primary" />
                    {{ selectedRequest.clientCompletedDeals }} сделок
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
        </div>

        <v-divider />
        <div class="pa-4 d-flex ga-2">
          <v-btn variant="tonal" class="flex-grow-1" @click="detailDialog = false">Закрыть</v-btn>
          <v-btn color="primary" variant="flat" class="flex-grow-1" prepend-icon="mdi-handshake-outline" @click="openAcceptFromDetail">Откликнуться</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- Accept Dialog -->
    <v-dialog v-model="acceptDialog" max-width="440">
      <v-card v-if="selectedRequest" rounded="lg">
        <div class="pa-5 text-center">
          <div class="accept-icon mx-auto mb-3">
            <v-icon icon="mdi-handshake-outline" size="32" color="primary" />
          </div>
          <div class="text-subtitle-1 font-weight-bold mb-1">Откликнуться на заявку?</div>
          <p class="text-caption text-medium-emphasis mb-4">
            Вы берёте на себя обязательство приобрести товар и оформить рассрочку
          </p>

          <v-card rounded="lg" elevation="0" border class="pa-3 mb-3 text-left">
            <div class="d-flex ga-3">
              <v-avatar size="48" rounded="lg">
                <v-img :src="selectedRequest.photos[0]" cover />
              </v-avatar>
              <div>
                <div class="text-body-2 font-weight-bold">{{ selectedRequest.title }}</div>
                <div class="text-caption text-medium-emphasis">{{ selectedRequest.clientName }} · {{ selectedRequest.city }}</div>
                <div class="text-body-2 font-weight-bold text-primary mt-1">{{ formatCurrency(selectedRequest.price) }}</div>
              </div>
            </div>
          </v-card>

          <v-alert type="info" variant="tonal" density="compact" class="mb-4 text-left text-caption" rounded="lg">
            После принятия вы сможете создать сделку с клиентом.
          </v-alert>

          <div class="d-flex ga-2">
            <v-btn variant="tonal" class="flex-grow-1" @click="acceptDialog = false">Отмена</v-btn>
            <v-btn color="primary" variant="flat" class="flex-grow-1" @click="confirmAccept">Принять</v-btn>
          </div>
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

.accept-icon {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: rgba(var(--v-theme-primary), 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
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
