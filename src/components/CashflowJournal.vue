<template>
  <div class="cfj">
    <!-- Header with filters -->
    <div class="cfj-toolbar">
      <h3 class="cfj-title">Касса</h3>

      <div class="cfj-filters">
        <!-- Type filter (multi) -->
        <v-menu :close-on-content-click="false">
          <template #activator="{ props: act }">
            <button v-bind="act" class="cfj-filter-btn" :class="{ 'cfj-filter-btn--active': activeTypes.length }">
              <v-icon icon="mdi-filter-variant" size="14" />
              <span>{{ activeTypes.length ? `${activeTypes.length} типа` : 'Все типы' }}</span>
              <v-icon icon="mdi-chevron-down" size="14" class="cfj-filter-caret" />
            </button>
          </template>
          <v-card rounded="lg" elevation="4" class="cfj-menu">
            <div class="cfj-menu-head">Тип операции</div>
            <button
              v-for="t in TYPE_GROUPS"
              :key="t.key"
              class="cfj-menu-item"
              :class="{ 'cfj-menu-item--active': activeTypes.includes(t.key) }"
              @click="toggleType(t.key)"
            >
              <span class="cfj-menu-item-dot" :style="{ background: t.color }" />
              <span class="cfj-menu-item-name">{{ t.label }}</span>
              <v-icon
                v-if="activeTypes.includes(t.key)"
                icon="mdi-check"
                size="14"
                class="cfj-menu-item-check"
              />
            </button>
            <div class="cfj-menu-divider" />
            <button class="cfj-menu-clear" @click="activeTypes = []">Сбросить</button>
          </v-card>
        </v-menu>

        <!-- Period filter -->
        <v-menu :close-on-content-click="false">
          <template #activator="{ props: act }">
            <button v-bind="act" class="cfj-filter-btn" :class="{ 'cfj-filter-btn--active': periodKey !== 'all' }">
              <v-icon icon="mdi-calendar-outline" size="14" />
              <span>{{ periodLabel }}</span>
              <v-icon icon="mdi-chevron-down" size="14" class="cfj-filter-caret" />
            </button>
          </template>
          <v-card rounded="lg" elevation="4" class="cfj-menu">
            <div class="cfj-menu-head">Период</div>
            <button
              v-for="p in PERIODS"
              :key="p.key"
              class="cfj-menu-item"
              :class="{ 'cfj-menu-item--active': periodKey === p.key }"
              @click="setPeriod(p.key)"
            >
              <v-icon icon="mdi-calendar-blank-outline" size="14" />
              <span class="cfj-menu-item-name">{{ p.label }}</span>
              <v-icon v-if="periodKey === p.key" icon="mdi-check" size="14" class="cfj-menu-item-check" />
            </button>
          </v-card>
        </v-menu>

        <!-- Search -->
        <div class="cfj-search-wrap">
          <v-icon icon="mdi-magnify" size="14" class="cfj-search-icon" />
          <input
            v-model="searchInput"
            type="text"
            placeholder="Поиск..."
            class="cfj-search"
            @input="onSearchInput"
          >
        </div>
      </div>
    </div>

    <!-- Period summary chips -->
    <div v-if="hasFilteredEntries" class="cfj-summary">
      <div class="cfj-summary-item cfj-summary-item--in">
        <v-icon icon="mdi-arrow-bottom-left" size="14" />
        <span class="cfj-summary-label">Поступления</span>
        <span class="cfj-summary-value">{{ formatCurrencyShort(totals.in) }}</span>
      </div>
      <div class="cfj-summary-item cfj-summary-item--out">
        <v-icon icon="mdi-arrow-top-right" size="14" />
        <span class="cfj-summary-label">Расходы</span>
        <span class="cfj-summary-value">{{ formatCurrencyShort(totals.out) }}</span>
      </div>
      <div class="cfj-summary-item cfj-summary-item--net" :class="{ 'cfj-summary-item--net-neg': totals.net < 0 }">
        <v-icon :icon="totals.net >= 0 ? 'mdi-trending-up' : 'mdi-trending-down'" size="14" />
        <span class="cfj-summary-label">Итого</span>
        <span class="cfj-summary-value">{{ formatCurrencyShort(totals.net) }}</span>
      </div>
      <span class="cfj-summary-count">{{ total }} операций</span>
    </div>

    <!-- Loading -->
    <div v-if="loading && entries.length === 0" class="cfj-loading">
      <v-progress-circular indeterminate color="primary" size="32" />
    </div>

    <!-- Empty -->
    <div v-else-if="!loading && entries.length === 0" class="cfj-empty">
      <v-icon icon="mdi-cash-remove" size="32" class="cfj-empty-icon" />
      <div class="cfj-empty-title">Операций нет</div>
      <div class="cfj-empty-text">
        За выбранный период ничего не найдено. Попробуйте изменить фильтры или период.
      </div>
    </div>

    <!-- Entries list -->
    <div v-else class="cfj-list">
      <div
        v-for="(group, i) in groupedByDate"
        :key="i"
        class="cfj-group"
      >
        <div class="cfj-group-date">{{ group.dateLabel }}</div>
        <button
          v-for="e in group.entries"
          :key="e.id"
          class="cfj-row"
          :class="{ 'cfj-row--clickable': e.dealId }"
          @click="onRowClick(e)"
        >
          <div class="cfj-row-icon" :style="{ background: typeStyle(e.type).bg, color: typeStyle(e.type).fg }">
            <v-icon :icon="typeStyle(e.type).icon" size="16" />
          </div>
          <div class="cfj-row-main">
            <div class="cfj-row-title">{{ e.note || typeStyle(e.type).label }}</div>
            <div class="cfj-row-meta">
              <span class="cfj-row-type">{{ typeStyle(e.type).label }}</span>
              <template v-if="e.dealNumber !== null">
                <span class="cfj-row-dot">·</span>
                <span class="cfj-row-deal">#{{ e.dealNumber }}</span>
              </template>
              <template v-if="e.coInvestorName">
                <span class="cfj-row-dot">·</span>
                <span>{{ e.coInvestorName }}</span>
              </template>
              <span class="cfj-row-dot">·</span>
              <span class="cfj-row-time">{{ formatTime(e.date) }}</span>
            </div>
          </div>
          <div class="cfj-row-amount" :class="{ 'cfj-row-amount--in': e.amount > 0, 'cfj-row-amount--out': e.amount < 0 }">
            {{ e.amount > 0 ? '+' : '' }}{{ formatCurrency(e.amount) }}
          </div>
        </button>
      </div>

      <!-- Load more -->
      <button
        v-if="entries.length < total"
        class="cfj-load-more"
        :disabled="loading"
        @click="loadMore"
      >
        <v-progress-circular v-if="loading" indeterminate size="14" width="2" />
        <v-icon v-else icon="mdi-chevron-down" size="16" />
        {{ loading ? 'Загрузка...' : `Показать ещё (осталось ${total - entries.length})` }}
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCashflow, type CashFlowEntry, type CashFlowEntryType } from '@/composables/useCashflow'
import { formatCurrency, formatCurrencyShort } from '@/utils/formatters'

const router = useRouter()
const { entries, total, loading, fetchJournal } = useCashflow()

// ─── Type metadata ─────────────────────────────────────────────────────
// Single source of truth for icons/colors/labels across the journal UI.
const TYPE_META: Record<CashFlowEntryType, { label: string; icon: string; bg: string; fg: string }> = {
  DEAL_DEPLOY:        { label: 'Закупка',       icon: 'mdi-cart-arrow-down', bg: 'rgba(239, 68, 68, 0.10)',  fg: '#dc2626' },
  PAYMENT_IN:         { label: 'Платёж',        icon: 'mdi-cash-plus',       bg: 'rgba(4, 120, 87, 0.10)',   fg: '#047857' },
  DIVIDEND_OUT:       { label: 'Дивиденд',      icon: 'mdi-account-cash',    bg: 'rgba(124, 58, 237, 0.10)', fg: '#7c3aed' },
  CAPITAL_TOPUP_OWN:  { label: 'Пополнение',    icon: 'mdi-wallet-plus',     bg: 'rgba(59, 130, 246, 0.10)', fg: '#3b82f6' },
  MANUAL_INCOME:      { label: 'Ручной доход',  icon: 'mdi-cash-plus',       bg: 'rgba(16, 185, 129, 0.10)', fg: '#059669' },
  MANUAL_EXPENSE:     { label: 'Ручной расход', icon: 'mdi-cash-minus',      bg: 'rgba(245, 158, 11, 0.10)', fg: '#d97706' },
  CAPITAL_IN:         { label: 'Капитал +',     icon: 'mdi-bank-plus',       bg: 'rgba(59, 130, 246, 0.10)', fg: '#3b82f6' },
  CAPITAL_OUT:        { label: 'Капитал −',     icon: 'mdi-bank-minus',      bg: 'rgba(245, 158, 11, 0.10)', fg: '#d97706' },
  PROFIT_ACCRUED:     { label: 'Доля прибыли',  icon: 'mdi-percent',         bg: 'rgba(124, 58, 237, 0.10)', fg: '#7c3aed' },
  DIVIDEND_PAID:      { label: 'Получил выплату', icon: 'mdi-account-cash',  bg: 'rgba(4, 120, 87, 0.10)',   fg: '#047857' },
}
function typeStyle(t: CashFlowEntryType) {
  return TYPE_META[t]
}

// User-facing list of type filter chips (only the ones that appear in partner's journal)
const TYPE_GROUPS: { key: CashFlowEntryType; label: string; color: string }[] = [
  { key: 'PAYMENT_IN',        label: 'Поступления',    color: '#047857' },
  { key: 'DEAL_DEPLOY',       label: 'Закупки',        color: '#dc2626' },
  { key: 'DIVIDEND_OUT',      label: 'Дивиденды',      color: '#7c3aed' },
  { key: 'CAPITAL_TOPUP_OWN', label: 'Пополнение капитала', color: '#3b82f6' },
  { key: 'MANUAL_INCOME',     label: 'Ручные доходы',  color: '#059669' },
  { key: 'MANUAL_EXPENSE',    label: 'Ручные расходы', color: '#d97706' },
]

// ─── Filters state ─────────────────────────────────────────────────────
const activeTypes = ref<CashFlowEntryType[]>([])
const searchInput = ref('')
const periodKey = ref<'all' | 'today' | 'week' | 'month' | 'year'>('all')

const PERIODS = [
  { key: 'all'   as const, label: 'Всё время' },
  { key: 'today' as const, label: 'Сегодня' },
  { key: 'week'  as const, label: 'Неделя' },
  { key: 'month' as const, label: 'Месяц' },
  { key: 'year'  as const, label: 'Год' },
]
const periodLabel = computed(() => PERIODS.find(p => p.key === periodKey.value)?.label ?? 'Всё время')

function periodRange(): { from?: string; to?: string } {
  if (periodKey.value === 'all') return {}
  const now = new Date()
  const from = new Date(now)
  if (periodKey.value === 'today') from.setHours(0, 0, 0, 0)
  else if (periodKey.value === 'week') from.setDate(now.getDate() - 7)
  else if (periodKey.value === 'month') from.setMonth(now.getMonth() - 1)
  else if (periodKey.value === 'year') from.setFullYear(now.getFullYear() - 1)
  return { from: from.toISOString() }
}

function toggleType(t: CashFlowEntryType) {
  const idx = activeTypes.value.indexOf(t)
  if (idx >= 0) activeTypes.value.splice(idx, 1)
  else activeTypes.value.push(t)
}

function setPeriod(p: typeof periodKey.value) {
  periodKey.value = p
}

// Debounced search reload
let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => reload(), 300)
}

// ─── Reload on filter change ───────────────────────────────────────────
const PAGE_SIZE = 50

watch([activeTypes, periodKey], () => reload(), { deep: true })

function currentFilters() {
  return {
    types: activeTypes.value.length ? activeTypes.value : undefined,
    search: searchInput.value || undefined,
    ...periodRange(),
  }
}

async function reload() {
  await fetchJournal({ ...currentFilters(), limit: PAGE_SIZE, offset: 0 }, 'replace')
}

async function loadMore() {
  await fetchJournal(
    { ...currentFilters(), limit: PAGE_SIZE, offset: entries.value.length },
    'append',
  )
}

// ─── Computed display data ─────────────────────────────────────────────
const hasFilteredEntries = computed(() => entries.value.length > 0)

const totals = computed(() => {
  let inSum = 0, outSum = 0
  for (const e of entries.value) {
    if (e.amount > 0) inSum += e.amount
    else outSum += -e.amount
  }
  return { in: inSum, out: outSum, net: inSum - outSum }
})

interface DateGroup { dateLabel: string; entries: CashFlowEntry[] }
const groupedByDate = computed<DateGroup[]>(() => {
  const groups: Map<string, CashFlowEntry[]> = new Map()
  for (const e of entries.value) {
    const key = formatDateKey(e.date)
    const arr = groups.get(key) ?? []
    arr.push(e)
    groups.set(key, arr)
  }
  return Array.from(groups.entries()).map(([dateLabel, list]) => ({ dateLabel, entries: list }))
})

function formatDateKey(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const dDay = new Date(d); dDay.setHours(0, 0, 0, 0)
  if (dDay.getTime() === today.getTime()) return 'Сегодня'
  if (dDay.getTime() === yesterday.getTime()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: dDay.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function onRowClick(e: CashFlowEntry) {
  if (e.dealId) router.push(`/deals/${e.dealId}`)
}

// ─── Init ──────────────────────────────────────────────────────────────
onMounted(() => reload())
</script>

<style scoped>
.cfj { display: flex; flex-direction: column; gap: 14px; }

/* Header */
.cfj-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
}
.cfj-title {
  font-size: 16px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.cfj-filters {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}

/* Filter chips */
.cfj-filter-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.cfj-filter-btn:hover {
  border-color: rgba(var(--v-theme-primary), 0.30);
  color: rgb(var(--v-theme-primary));
}
.cfj-filter-btn--active {
  border-color: rgba(4, 120, 87, 0.30);
  color: #047857;
}
.cfj-filter-caret { opacity: 0.4; }

/* Search */
.cfj-search-wrap { position: relative; display: inline-flex; align-items: center; }
.cfj-search-icon { position: absolute; left: 9px; color: rgba(var(--v-theme-on-surface), 0.35); pointer-events: none; }
.cfj-search {
  width: 180px;
  height: 30px;
  padding: 0 12px 0 28px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  outline: none; font-family: inherit;
}
.cfj-search:focus {
  border-color: rgb(var(--v-theme-primary));
}

/* Menu */
.cfj-menu { min-width: 220px; padding: 4px; }
.cfj-menu-head {
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase; letter-spacing: 0.04em;
  padding: 8px 10px 4px;
}
.cfj-menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  border: none; background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  cursor: pointer; text-align: left;
  font-family: inherit;
  width: 100%;
  transition: background 0.1s;
}
.cfj-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.cfj-menu-item--active { background: rgba(4, 120, 87, 0.06); color: #047857; font-weight: 600; }
.cfj-menu-item-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.cfj-menu-item-name { flex: 1; min-width: 0; }
.cfj-menu-item-check { color: currentColor; }
.cfj-menu-divider { height: 1px; background: rgba(var(--v-theme-on-surface), 0.06); margin: 4px 0; }
.cfj-menu-clear {
  width: 100%; padding: 8px 10px; border: none; background: transparent;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer; font-family: inherit; border-radius: 6px;
  text-align: center;
}
.cfj-menu-clear:hover { background: rgba(var(--v-theme-on-surface), 0.04); }

/* Period summary */
.cfj-summary {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.cfj-summary-item {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px;
}
.cfj-summary-item--in { color: #047857; }
.cfj-summary-item--out { color: #dc2626; }
.cfj-summary-item--net { color: rgba(var(--v-theme-on-surface), 0.85); font-weight: 700; }
.cfj-summary-item--net-neg { color: #dc2626; }
.cfj-summary-label { color: rgba(var(--v-theme-on-surface), 0.55); font-weight: 500; }
.cfj-summary-value { font-weight: 700; font-variant-numeric: tabular-nums; }
.cfj-summary-count {
  margin-left: auto;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
}

/* States */
.cfj-loading { display: flex; justify-content: center; padding: 32px 0; }
.cfj-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 40px 20px; text-align: center;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border-radius: 10px;
}
.cfj-empty-icon { color: rgba(var(--v-theme-on-surface), 0.3); margin-bottom: 10px; }
.cfj-empty-title { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); margin-bottom: 4px; }
.cfj-empty-text { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); max-width: 320px; line-height: 1.5; }

/* List */
.cfj-list { display: flex; flex-direction: column; gap: 6px; }
.cfj-group { display: flex; flex-direction: column; }
.cfj-group-date {
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase; letter-spacing: 0.04em;
  padding: 14px 4px 6px;
}

/* Row */
.cfj-row {
  display: flex; align-items: center; gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: rgb(var(--v-theme-surface));
  cursor: default;
  transition: all 0.15s;
  font-family: inherit;
  text-align: left;
}
.cfj-row--clickable { cursor: pointer; }
.cfj-row--clickable:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.10);
  background: rgba(var(--v-theme-on-surface), 0.02);
  transform: translateX(2px);
}
.cfj-row-icon {
  width: 36px; height: 36px; min-width: 36px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.cfj-row-main { flex: 1; min-width: 0; }
.cfj-row-title {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.95);
  line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cfj-row-meta {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.cfj-row-type { font-weight: 600; }
.cfj-row-deal { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.65); }
.cfj-row-dot { opacity: 0.5; }

.cfj-row-amount {
  font-size: 14px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}
.cfj-row-amount--in { color: #047857; }
.cfj-row-amount--out { color: #dc2626; }

/* Load more */
.cfj-load-more {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px;
  margin: 14px auto 0;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.cfj-load-more:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.30);
  color: rgb(var(--v-theme-primary));
}
.cfj-load-more:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
