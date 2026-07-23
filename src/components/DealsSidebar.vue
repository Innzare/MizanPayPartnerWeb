<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDealsStore } from '@/stores/deals'
import { useAuthStore } from '@/stores/auth'
import { useRecentDeals } from '@/composables/useRecentDeals'
import { useIsMobile } from '@/composables/useIsMobile'
import { useDealLock } from '@/composables/useDealLock'
import { formatCurrency, formatPhone } from '@/utils/formatters'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import type { Deal } from '@/types'

/**
 * Side-drawer with quick access to every partner deal. Lives mounted in
 * the default layout; the layout flips `open` via the header burger. Two
 * tabs:
 *   • Все — every non-deleted deal, filterable by status and search
 *   • Недавние — last 20 deals the partner opened, MRU order
 * Search is a single text box that matches against productName, client
 * name, and dealNumber so the partner can type whatever's on hand.
 */

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const router = useRouter()
const authStore = useAuthStore()
const dealsStore = useDealsStore()
const { isMobile } = useIsMobile()
const { isDealLocked } = useDealLock()
const recentDeals = useRecentDeals(authStore.user?.id ?? null)

const tab = ref<'all' | 'recent'>('all')
const search = ref('')
const statusFilter = ref<'active' | 'completed' | 'all'>('active')

// Closed state is the steady-state; only fetch when actually opened so
// the sidebar doesn't pay for itself on every page load.
const triedLoad = ref(false)
async function ensureLoaded() {
  if (triedLoad.value) return
  triedLoad.value = true
  try {
    if (dealsStore.deals.length === 0) {
      await dealsStore.fetchDeals()
    }
  } catch {
    triedLoad.value = false  // allow retry on next open
  }
}

watch(
  () => props.open,
  (isOpen) => { if (isOpen) ensureLoaded() },
)
onMounted(() => { if (props.open) ensureLoaded() })

// "Все" tab. Searches across product / client / dealNumber so partners
// can paste a contract number or type a fragment of a name.
const baseDeals = computed<Deal[]>(() => {
  let list = dealsStore.deals.filter((d) => !d.deletedAt)
  if (statusFilter.value === 'active') {
    list = list.filter((d) => d.status === 'ACTIVE' || d.status === 'DISPUTED')
  } else if (statusFilter.value === 'completed') {
    list = list.filter((d) => d.status === 'COMPLETED')
  }
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter((d) => {
      if (d.productName?.toLowerCase().includes(q)) return true
      if (String(d.dealNumber).includes(q)) return true
      // Client name lives in a couple of shapes depending on the deal
      // (legacy clientId-User, ClientProfile, external string).
      const cp = (d as any).clientProfile
      if (cp) {
        const fullName = [cp.firstName, cp.lastName, cp.patronymic]
          .filter(Boolean).join(' ').toLowerCase()
        if (fullName.includes(q)) return true
        if (cp.phone?.toLowerCase().includes(q)) return true
      }
      const ext = (d as any).externalClientName
      if (ext?.toLowerCase().includes(q)) return true
      const phone = (d as any).externalClientPhone
      if (phone?.toLowerCase().includes(q)) return true
      return false
    })
  }
  // Most recent first — by createdAt fallback dealNumber.
  return [...list].sort((a, b) => {
    const aT = new Date(a.createdAt ?? 0).getTime()
    const bT = new Date(b.createdAt ?? 0).getTime()
    if (aT !== bT) return bT - aT
    return b.dealNumber - a.dealNumber
  })
})

// "Недавние" tab — resolve full deal rows from the store, in MRU order.
// Drop entries whose deal has been deleted/cancelled meanwhile so the
// list doesn't show broken cards.
const recentDealsList = computed<Deal[]>(() => {
  const dealsById = new Map(dealsStore.deals.map((d) => [d.id, d]))
  return recentDeals.recent.value
    .map((r) => dealsById.get(r.id))
    .filter((d): d is Deal => !!d && !d.deletedAt)
})

const displayed = computed<Deal[]>(() => {
  return tab.value === 'recent' ? recentDealsList.value : baseDeals.value
})

const counts = computed(() => ({
  all: dealsStore.deals.filter((d) => !d.deletedAt).length,
  recent: recentDealsList.value.length,
}))

function close() {
  emit('update:open', false)
}

function goToDeal(d: Deal) {
  close()
  // Navigate after a microtask so the drawer close animation gets a
  // head start; otherwise it can stutter when the destination page does
  // a heavy mount.
  setTimeout(() => router.push(`/deals/${d.id}`), 0)
}

function clientName(d: Deal): string {
  const cp = (d as any).clientProfile
  if (cp) {
    return [cp.lastName, cp.firstName].filter(Boolean).join(' ') || cp.phone || 'Клиент'
  }
  const ext = (d as any).externalClientName
  if (ext) return ext
  return 'Без клиента'
}

function clientPhone(d: Deal): string {
  const cp = (d as any).clientProfile
  if (cp?.phone) return formatPhone(cp.phone)
  const ext = (d as any).externalClientPhone
  if (ext) return formatPhone(ext)
  return ''
}

// Two-letter avatar initials for the client. Falls back to a generic
// «?» so deals without a client still render a coloured circle.
function clientInitials(d: Deal): string {
  const cp = (d as any).clientProfile
  if (cp) {
    const first = (cp.firstName?.[0] ?? '').toUpperCase()
    const last = (cp.lastName?.[0] ?? '').toUpperCase()
    const v = (last + first).slice(0, 2)
    if (v) return v
  }
  const ext = (d as any).externalClientName as string | undefined
  if (ext) {
    const parts = ext.trim().split(/\s+/)
    const a = parts[0]?.[0] ?? ''
    const b = parts[1]?.[0] ?? ''
    return (a + b).toUpperCase() || '?'
  }
  return '?'
}

// Deterministic colour for the avatar so a given client always gets
// the same shade. Pulls from a small palette tuned for both light and
// dark themes.
const AVATAR_COLORS = [
  '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#a855f7', '#ec4899', '#06b6d4', '#84cc16',
]
function avatarColor(d: Deal): string {
  const seed = clientName(d) || d.id
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function statusChipColor(status: string): string {
  return (DEAL_STATUS_CONFIG as any)[status]?.color ?? '#94a3b8'
}
function statusChipLabel(status: string): string {
  return (DEAL_STATUS_CONFIG as any)[status]?.label ?? status
}
</script>

<template>
  <v-navigation-drawer
    :model-value="open"
    location="right"
    temporary
    :width="isMobile ? 290 : 520"
    @update:model-value="(v) => emit('update:open', v)"
  >
    <div class="ds-shell">
      <!-- Header block — title + tabs + search + filters, visually
           grouped together with a soft tinted background and a divider
           shadow that separates it from the scrollable list below. -->
      <div class="ds-toolbar">
        <div class="ds-header">
          <div class="ds-title">Быстрый доступ к сделкам</div>
          <button class="ds-close" @click="close" title="Закрыть">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <!-- Tabs -->
        <div class="ds-tabs">
          <button
            class="ds-tab"
            :class="{ 'ds-tab--active': tab === 'all' }"
            @click="tab = 'all'"
          >
            Все сделки
            <span class="ds-tab-count">{{ counts.all }}</span>
          </button>
          <button
            class="ds-tab"
            :class="{ 'ds-tab--active': tab === 'recent' }"
            @click="tab = 'recent'"
          >
            Недавние
            <span class="ds-tab-count">{{ counts.recent }}</span>
          </button>
        </div>

        <!-- Search -->
        <div class="ds-search-wrap">
          <v-icon icon="mdi-magnify" size="16" class="ds-search-icon" />
          <input
            v-model="search"
            type="text"
            placeholder="Поиск по товару, клиенту, номеру…"
            class="ds-search-input"
          />
          <button v-if="search" class="ds-search-clear" @click="search = ''" title="Очистить">
            <v-icon icon="mdi-close" size="14" />
          </button>
        </div>

        <!-- Status chips — applies to the "Все" tab. In the recent tab the
             list is small and already sorted by MRU, filtering further
             usually isn't useful, so hide. -->
        <div v-if="tab === 'all'" class="ds-status-chips">
          <button
            class="ds-status-chip"
            :class="{ 'ds-status-chip--active': statusFilter === 'active' }"
            @click="statusFilter = 'active'"
          >Активные</button>
          <button
            class="ds-status-chip"
            :class="{ 'ds-status-chip--active': statusFilter === 'completed' }"
            @click="statusFilter = 'completed'"
          >Завершённые</button>
          <button
            class="ds-status-chip"
            :class="{ 'ds-status-chip--active': statusFilter === 'all' }"
            @click="statusFilter = 'all'"
          >Все</button>
        </div>
      </div>

      <!-- List -->
      <div class="ds-list">
        <div v-if="displayed.length === 0" class="ds-empty">
          <v-icon icon="mdi-package-variant" size="40" />
          <div class="ds-empty-text">
            <template v-if="tab === 'recent'">
              Здесь появятся сделки, которые вы недавно открывали.
            </template>
            <template v-else-if="search">
              По вашему запросу ничего не найдено.
            </template>
            <template v-else>
              Сделок пока нет.
            </template>
          </div>
        </div>

        <button
          v-for="d in displayed"
          :key="d.id"
          class="ds-item"
          :class="{ 'deal-locked-dim': isDealLocked(d) }"
          @click="goToDeal(d)"
        >
          <div class="ds-item-avatar" :style="{ background: avatarColor(d) }">
            {{ clientInitials(d) }}
          </div>
          <div class="ds-item-body">
            <div class="ds-item-headline">
              <span class="ds-item-title">{{ d.productName || 'Без названия' }}</span>
              <span v-if="isDealLocked(d)" class="deal-locked-chip"><v-icon icon="mdi-lock-outline" />Недоступно</span>
              <span class="ds-item-num">#{{ d.dealNumber }}</span>
            </div>
            <div class="ds-item-client">{{ clientName(d) }}</div>
            <div v-if="clientPhone(d)" class="ds-item-phone">
              <v-icon icon="mdi-phone-outline" size="11" />
              {{ clientPhone(d) }}
            </div>
            <div class="ds-item-footer">
              <span
                class="ds-item-status"
                :style="{ color: statusChipColor(d.status), background: statusChipColor(d.status) + '18' }"
              >
                {{ statusChipLabel(d.status) }}
              </span>
              <span class="ds-item-price">{{ formatCurrency(d.totalPrice) }}</span>
            </div>
          </div>
        </button>
      </div>
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.ds-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Combined header band — title, tabs, search, status chips all share a
   soft tinted background and a single dividing shadow, so it reads as
   one toolbar above the scrolling list. */
.ds-toolbar {
  flex-shrink: 0;
  background: rgba(var(--v-theme-on-surface), 0.025);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
  padding-bottom: 10px;
}

.ds-header {
  padding: 14px 16px 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ds-title { font-size: 14px; font-weight: 700; }
.ds-close {
  width: 28px; height: 28px;
  border: none; background: transparent; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ds-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.ds-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 12px 0;
}
.ds-tab {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 10px; border: none; border-radius: 8px;
  background: transparent;
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer;
  transition: all 0.12s;
}
.ds-tab:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.ds-tab--active {
  background: rgba(4, 120, 87, 0.08);
  color: #047857;
}
.ds-tab-count {
  font-size: 11px;
  font-weight: 700;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 1px 6px;
  border-radius: 8px;
  min-width: 20px;
  text-align: center;
}
.ds-tab--active .ds-tab-count {
  background: rgba(4, 120, 87, 0.15);
  color: #047857;
}

.ds-search-wrap {
  position: relative;
  margin: 10px 12px 0;
}
.ds-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(var(--v-theme-on-surface), 0.4);
  pointer-events: none;
}
.ds-search-input {
  width: 100%;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  padding: 8px 30px 8px 32px;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  background: rgb(var(--v-theme-surface));
  outline: none;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.ds-search-input:focus {
  border-color: rgba(4, 120, 87, 0.5);
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.08);
}
.ds-search-clear {
  position: absolute;
  right: 8px; top: 50%; transform: translateY(-50%);
  border: none; background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.4);
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px;
}
.ds-search-clear:hover { color: rgba(var(--v-theme-on-surface), 0.8); background: rgba(var(--v-theme-on-surface), 0.06); }

.ds-status-chips {
  display: flex;
  gap: 6px;
  padding: 10px 12px 0;
  flex-wrap: wrap;
}
.ds-status-chip {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  border-radius: 7px;
  padding: 4px 10px;
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.65);
  cursor: pointer;
  transition: all 0.12s;
}
.ds-status-chip:hover { border-color: rgba(var(--v-theme-on-surface), 0.25); }
.ds-status-chip--active {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.25);
  color: #047857;
  font-weight: 600;
}

.ds-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Tinted background so the white deal cards visually pop on top of
     it. Slightly darker than the toolbar above for contrast. */
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.ds-empty {
  margin: 80px auto 0;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.35);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  max-width: 240px;
}
.ds-empty-text {
  font-size: 13px;
  line-height: 1.5;
}

.ds-item {
  text-align: left;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.04);
  /* Solid surface bg lifts the card above the tinted list backdrop. */
  background: rgb(var(--v-theme-surface));
  border-radius: 12px;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.15s;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.ds-item:hover {
  border-color: rgba(4, 120, 87, 0.3);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
}

.ds-item-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

.ds-item-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ds-item-headline {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 1px;
}
.ds-item-title {
  font-size: 14px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.92);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.ds-item-num {
  font-size: 11px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.35);
  flex-shrink: 0;
}

.ds-item-client {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.75);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ds-item-phone {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 1px;
}

.ds-item-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.06);
}
.ds-item-status {
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.ds-item-price {
  font-size: 13px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
  flex-shrink: 0;
}
</style>
