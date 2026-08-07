<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useSuppliersStore, type SupplierActivity, type SupplierActivityType } from '@/stores/suppliers'

const store = useSuppliersStore()

const PAGE = 50
const loading = ref(false)
const loadingMore = ref(false)
const items = ref<SupplierActivity[]>([])
const total = ref(0)

const FILTERS: { key: string; label: string; types: SupplierActivityType[] }[] = [
  { key: 'all', label: 'Все', types: [] },
  { key: 'partners', label: 'Партнёры', types: ['SUPPLIER_CREATED', 'SUPPLIER_UPDATED', 'SUPPLIER_DELETED'] },
  { key: 'requests', label: 'Заявки', types: ['SUPPLIER_REQUEST_CREATED', 'SUPPLIER_REQUEST_STATUS'] },
  { key: 'payouts', label: 'Выплаты', types: ['SUPPLIER_PAYOUT', 'SUPPLIER_PAYOUT_CANCELLED'] },
  { key: 'routesheets', label: 'Путевые листы', types: ['ROUTE_SHEET_CREATED', 'ROUTE_SHEET_LINE_PAID', 'ROUTE_SHEET_CANCELLED'] },
]
const filter = ref('all')
const activeTypes = computed(() => FILTERS.find((f) => f.key === filter.value)?.types ?? [])

const TYPE_META: Record<SupplierActivityType, { icon: string; color: string; bg: string }> = {
  SUPPLIER_CREATED: { icon: 'mdi-handshake-outline', color: '#047857', bg: 'rgba(4,120,87,0.1)' },
  SUPPLIER_UPDATED: { icon: 'mdi-pencil-outline', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  SUPPLIER_DELETED: { icon: 'mdi-delete-outline', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  SUPPLIER_PAYOUT: { icon: 'mdi-cash-check', color: '#047857', bg: 'rgba(4,120,87,0.1)' },
  SUPPLIER_PAYOUT_CANCELLED: { icon: 'mdi-cash-remove', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  SUPPLIER_REQUEST_CREATED: { icon: 'mdi-clipboard-text-outline', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  SUPPLIER_REQUEST_STATUS: { icon: 'mdi-clipboard-check-outline', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  ROUTE_SHEET_CREATED: { icon: 'mdi-clipboard-list-outline', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
  ROUTE_SHEET_LINE_PAID: { icon: 'mdi-cash-check', color: '#047857', bg: 'rgba(4,120,87,0.1)' },
  ROUTE_SHEET_CANCELLED: { icon: 'mdi-close-circle-outline', color: '#94a3b8', bg: 'rgba(148,163,184,0.14)' },
}
function meta(t: SupplierActivityType) { return TYPE_META[t] ?? { icon: 'mdi-history', color: '#94a3b8', bg: 'rgba(148,163,184,0.14)' } }

function fmt(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

async function reload() {
  loading.value = true
  try {
    const res = await store.fetchActivity({ types: activeTypes.value, limit: PAGE, offset: 0 })
    items.value = res.items
    total.value = res.total
  } finally {
    loading.value = false
  }
}
function setFilter(k: string) { filter.value = k; reload() }

async function loadMore() {
  loadingMore.value = true
  try {
    const res = await store.fetchActivity({ types: activeTypes.value, limit: PAGE, offset: items.value.length })
    items.value = [...items.value, ...res.items]
    total.value = res.total
  } finally {
    loadingMore.value = false
  }
}

onMounted(reload)
</script>

<template>
  <div class="sup-card">
    <div class="pa-4">
      <div class="d-flex align-center ga-2 mb-4 flex-wrap">
        <button
          v-for="f in FILTERS" :key="f.key"
          class="sup-chip" :class="{ active: filter === f.key }"
          @click="setFilter(f.key)"
        >{{ f.label }}</button>
      </div>

      <div v-if="loading" class="d-flex justify-center pa-12"><v-progress-circular indeterminate color="primary" size="40" /></div>

      <div v-else-if="items.length" class="act-list">
        <div v-for="a in items" :key="a.id" class="act-row">
          <div class="act-icon" :style="{ background: meta(a.type).bg, color: meta(a.type).color }">
            <v-icon :icon="meta(a.type).icon" size="18" />
          </div>
          <div class="act-main">
            <div class="act-title">{{ a.title }}</div>
            <div v-if="a.description" class="act-desc">{{ a.description }}</div>
          </div>
          <div class="act-side">
            <div class="act-actor">{{ a.actorName }}</div>
            <div class="act-date">{{ fmt(a.createdAt) }}</div>
          </div>
        </div>

        <div v-if="items.length < total" class="d-flex justify-center mt-4">
          <v-btn variant="tonal" rounded="lg" :loading="loadingMore" @click="loadMore">Показать ещё</v-btn>
        </div>
      </div>

      <div v-else class="text-center pa-12">
        <v-icon icon="mdi-history" size="56" color="grey-lighten-1" class="mb-3" />
        <div class="text-h6 mb-1">Операций пока нет</div>
        <div class="text-body-2 text-medium-emphasis">Здесь будет вся история действий раздела</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sup-card { border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-surface), 1); overflow: hidden; }
.sup-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: transparent; font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; }
.sup-chip:hover { border-color: rgba(var(--v-theme-on-surface), 0.2); }
.sup-chip.active { border-color: rgba(4,120,87,0.5); color: #047857; font-weight: 600; background: rgba(4,120,87,0.06); }

.act-list { display: flex; flex-direction: column; }
.act-row { display: flex; align-items: flex-start; gap: 14px; padding: 14px 4px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
.act-row:last-child { border-bottom: none; }
.act-icon { width: 38px; height: 38px; min-width: 38px; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
.act-main { flex: 1; min-width: 0; }
.act-title { font-size: 14px; font-weight: 600; line-height: 1.35; }
.act-desc { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; word-break: break-word; }
.act-side { text-align: right; flex-shrink: 0; white-space: nowrap; }
.act-actor { font-size: 12.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.7); }
.act-date { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }
@media (max-width: 600px) {
  .act-row { flex-wrap: wrap; }
  .act-side { text-align: left; width: 100%; padding-left: 52px; display: flex; gap: 8px; }
  .act-date { margin-top: 0; }
}
</style>
