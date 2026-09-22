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
              v-for="t in typeGroups"
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
      <!-- Суммы считаются по показанным записям: журнал листается страницами,
           и молча выдавать их за итог всего периода нельзя. -->
      <span class="cfj-summary-count">
        {{ entries.length }} из {{ total }} операций
        <span v-if="entries.length < total" class="cfj-summary-hint">· суммы по показанным</span>
      </span>
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
    <div v-else ref="journalViewport" class="cfj-list">
      <!-- Верхняя распорка: место записей выше экрана и точка отсчёта списка. -->
      <div ref="markerRow" :style="{ height: virtual.padTop.value + 'px' }" aria-hidden="true" />

      <template v-for="(row, idx) in virtual.visibleRows.value" :key="row.key">
        <div
          v-if="row.kind === 'date'"
          :ref="virtual.rowRef(virtual.offset.value + idx)"
          data-virtual-row
          class="cfj-group-date"
        >
          {{ row.label }}
        </div>

        <button
          v-else
          :ref="virtual.rowRef(virtual.offset.value + idx)"
          data-virtual-row
          class="cfj-row"
          :class="{ 'cfj-row--clickable': row.entry.dealId, 'deal-locked-dim': isDealLocked({ dealNumber: row.entry.dealNumber }) }"
          @click="onRowClick(row.entry)"
        >
          <div class="cfj-row-icon" :style="{ background: typeStyle(row.entry.type).bg, color: typeStyle(row.entry.type).fg }">
            <v-icon :icon="typeStyle(row.entry.type).icon" size="16" />
          </div>
          <div class="cfj-row-main">
            <div class="cfj-row-title">{{ row.entry.note || typeStyle(row.entry.type).label }}</div>
            <div class="cfj-row-meta">
              <span class="cfj-row-type">{{ typeStyle(row.entry.type).label }}</span>
              <template v-if="row.entry.dealNumber !== null">
                <span class="cfj-row-dot">·</span>
                <span class="cfj-row-deal">#{{ row.entry.dealNumber }}</span>
                <v-icon v-if="isDealLocked({ dealNumber: row.entry.dealNumber })" icon="mdi-lock-outline" size="12" color="#b45309" class="ml-1" />
              </template>
              <template v-if="row.entry.coInvestorName">
                <span class="cfj-row-dot">·</span>
                <span>{{ row.entry.coInvestorName }}</span>
              </template>
              <span class="cfj-row-dot">·</span>
              <span class="cfj-row-time">{{ formatTime(row.entry.date) }}</span>
            </div>
          </div>
          <div class="cfj-row-amount" :class="{ 'cfj-row-amount--in': row.entry.amount > 0, 'cfj-row-amount--out': row.entry.amount < 0 }">
            {{ row.entry.amount > 0 ? '+' : '' }}{{ formatCurrency(row.entry.amount) }}
          </div>
          <span
            v-if="canCancelEntry(row.entry)"
            class="cfj-row-cancel"
            :class="{ 'cfj-row-cancel--busy': cancellingId === row.entry.id }"
            role="button"
            tabindex="0"
            title="Отменить операцию"
            @click.stop="cancelEntry(row.entry)"
            @keydown.enter.stop="cancelEntry(row.entry)"
          >
            <v-progress-circular v-if="cancellingId === row.entry.id" indeterminate size="13" width="2" />
            <v-icon v-else icon="mdi-undo" size="15" />
          </span>
        </button>
      </template>

      <div :style="{ height: virtual.padBottom.value + 'px' }" aria-hidden="true" />
    </div>

    <!-- Пагинация как в остальных разделах: страницы с прыжком по номеру,
         размер порции и, по желанию, подгрузка при прокрутке. Кнопка
         «Показать ещё» до нужного места в длинном журнале не доводила. -->
    <div v-if="autoLoad.enabled.value" ref="autoLoadSentinel" class="cfj-sentinel" />
    <ServerPager
      v-if="total > 0"
      :page="page"
      :total="total"
      :per-page="perPage"
      :busy="loading"
      :per-page-options="PER_PAGE_OPTIONS"
      :auto-load="autoLoad.enabled.value"
      :loaded="entries.length"
      :has-more="hasMore"
      @update:page="page = $event"
      @update:per-page="perPage = $event"
      @update:auto-load="autoLoad.enabled.value = $event"
      @load-more="autoLoad.loadMoreManually()"
    />
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCashflow, type CashFlowEntry, type CashFlowEntryType } from '@/composables/useCashflow'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { PER_PAGE_OPTIONS, useListSort, usePageSize } from '@/composables/useListPrefs'
import { useDealLock } from '@/composables/useDealLock'
import { useSections } from '@/composables/useSections'
import { formatCurrency, formatCurrencyShort } from '@/utils/formatters'
import ServerPager from '@/components/ServerPager.vue'
import { useAutoLoad } from '@/composables/useAutoLoad'
import { useVirtualRows } from '@/composables/useVirtualRows'

const router = useRouter()
const { isDealLocked } = useDealLock()
const toast = useToast()
const cashboxesStore = useCashBoxesStore()
const { entries, total, loading, fetchJournal } = useCashflow()

// Optional scope — when passed, all journal queries are limited to a single
// cashbox. Used by the cashbox detail page; unset means partner-wide ledger.
const props = defineProps<{ cashBoxId?: string }>()
// Испущен после отмены капитальной операции — родитель обновляет сводку капитала.
const emit = defineEmits<{ changed: [] }>()

// id записи, отмена которой сейчас выполняется
const cancellingId = ref<string | null>(null)

// «Отменить» показываем только в кассовом контексте (есть cashBoxId) и только
// на партнёрских капитальных записях пополнения/снятия собственного капитала.
function canCancelEntry(e: CashFlowEntry): boolean {
  if (!props.cashBoxId) return false
  return e.type === 'CAPITAL_TOPUP_OWN' || e.type === 'CAPITAL_WITHDRAW_OWN'
}

async function cancelEntry(e: CashFlowEntry) {
  if (!props.cashBoxId || cancellingId.value) return
  if (!confirm('Отменить операцию? Капитал вернётся к прежнему значению.')) return
  cancellingId.value = e.id
  try {
    await cashboxesStore.cancelPartnerCapital(props.cashBoxId, e.id)
    toast.success('Операция отменена')
    await reload()
    emit('changed')
  } catch (err: any) {
    toast.error(err.message || 'Не удалось отменить операцию')
  } finally {
    cancellingId.value = null
  }
}

// ─── Type metadata ─────────────────────────────────────────────────────
// Single source of truth for icons/colors/labels across the journal UI.
const TYPE_META: Record<CashFlowEntryType, { label: string; icon: string; bg: string; fg: string }> = {
  DEAL_DEPLOY:        { label: 'Закупка',       icon: 'mdi-cart-arrow-down', bg: 'rgba(239, 68, 68, 0.10)',  fg: '#dc2626' },
  PAYMENT_IN:         { label: 'Платёж',        icon: 'mdi-cash-plus',       bg: 'rgba(4, 120, 87, 0.10)',   fg: '#047857' },
  DIVIDEND_OUT:       { label: 'Дивиденд',      icon: 'mdi-account-cash',    bg: 'rgba(124, 58, 237, 0.10)', fg: '#7c3aed' },
  CAPITAL_TOPUP_OWN:  { label: 'Пополнение капитала', icon: 'mdi-wallet-plus',  bg: 'rgba(59, 130, 246, 0.10)', fg: '#3b82f6' },
  CAPITAL_WITHDRAW_OWN: { label: 'Снятие капитала', icon: 'mdi-wallet-minus',   bg: 'rgba(245, 158, 11, 0.10)', fg: '#d97706' },
  MANUAL_INCOME:      { label: 'Ручной доход',  icon: 'mdi-cash-plus',       bg: 'rgba(16, 185, 129, 0.10)', fg: '#059669' },
  MANUAL_EXPENSE:     { label: 'Ручной расход', icon: 'mdi-cash-minus',      bg: 'rgba(245, 158, 11, 0.10)', fg: '#d97706' },
  CAPITAL_IN:         { label: 'Капитал +',     icon: 'mdi-bank-plus',       bg: 'rgba(59, 130, 246, 0.10)', fg: '#3b82f6' },
  CAPITAL_OUT:        { label: 'Капитал −',     icon: 'mdi-bank-minus',      bg: 'rgba(245, 158, 11, 0.10)', fg: '#d97706' },
  PROFIT_ACCRUED:     { label: 'Доля прибыли',  icon: 'mdi-percent',         bg: 'rgba(124, 58, 237, 0.10)', fg: '#7c3aed' },
  DIVIDEND_PAID:      { label: 'Получил выплату', icon: 'mdi-account-cash',  bg: 'rgba(4, 120, 87, 0.10)',   fg: '#047857' },
  // Возвратные деньги — раздел «Временные операции».
  LOAN_IN:            { label: 'Взяли в долг',  icon: 'mdi-hand-coin-outline', bg: 'rgba(59, 130, 246, 0.10)', fg: '#3b82f6' },
  LOAN_REPAY_OUT:     { label: 'Вернули долг',  icon: 'mdi-cash-refund',     bg: 'rgba(245, 158, 11, 0.10)', fg: '#d97706' },
  LENT_OUT:           { label: 'Дали в долг',   icon: 'mdi-hand-extended-outline', bg: 'rgba(245, 158, 11, 0.10)', fg: '#d97706' },
  LENT_REPAY_IN:      { label: 'Нам вернули',   icon: 'mdi-cash-refund',     bg: 'rgba(4, 120, 87, 0.10)',   fg: '#047857' },
}

/**
 * Оформление строки журнала.
 *
 * Неизвестный тип не должен ронять раздел: на бэкенде появляется новый вид
 * записи, фронт про него ещё не знает — и вместо журнала партнёр видел
 * бесконечный лоадер. Лучше показать запись нейтрально, чем не показать ничего.
 */
const UNKNOWN_TYPE = {
  label: 'Операция',
  icon: 'mdi-swap-horizontal',
  bg: 'rgba(var(--v-theme-on-surface), 0.06)',
  fg: 'rgba(var(--v-theme-on-surface), 0.6)',
}
function typeStyle(t: CashFlowEntryType) {
  return TYPE_META[t] ?? UNKNOWN_TYPE
}

// User-facing list of type filter chips (only the ones that appear in partner's journal)
const TYPE_GROUPS: { key: CashFlowEntryType; label: string; color: string }[] = [
  { key: 'PAYMENT_IN',        label: 'Поступления',    color: '#047857' },
  { key: 'DEAL_DEPLOY',       label: 'Закупки',        color: '#dc2626' },
  { key: 'DIVIDEND_OUT',      label: 'Дивиденды',      color: '#7c3aed' },
  { key: 'CAPITAL_TOPUP_OWN', label: 'Пополнение капитала', color: '#3b82f6' },
  { key: 'CAPITAL_WITHDRAW_OWN', label: 'Снятие капитала', color: '#d97706' },
  { key: 'MANUAL_INCOME',     label: 'Ручные доходы',  color: '#059669' },
  { key: 'MANUAL_EXPENSE',    label: 'Ручные расходы', color: '#d97706' },
]

// Фильтр «Дивиденды» без раздела со-инвесторов всегда пустой — убираем его,
// чтобы не оставлять кнопку, которая ничего не находит.
const sections = useSections()
const typeGroups = computed(() =>
  sections.visible('coInvestors')
    ? TYPE_GROUPS
    : TYPE_GROUPS.filter((t) => t.key !== 'DIVIDEND_OUT'),
)

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

// ─── Постраничная загрузка ─────────────────────────────────────────────
const page = ref(1)
const perPage = usePageSize('cashflow:page-size')

function currentFilters() {
  return {
    types: activeTypes.value.length ? activeTypes.value : undefined,
    search: searchInput.value || undefined,
    cashBoxId: props.cashBoxId,
    ...periodRange(),
  }
}

/**
 * `append` — режим подгрузки при прокрутке: порция становится продолжением
 * списка. В обычном режиме страница показывается целиком со своего смещения.
 */
async function load(append = false) {
  await fetchJournal(
    {
      ...currentFilters(),
      limit: perPage.value,
      offset: append ? entries.value.length : (page.value - 1) * perPage.value,
    },
    append ? 'append' : 'replace',
  )
}

/** Смена фильтра возвращает к началу: на пятой странице прежней выборки делать нечего. */
async function reload() {
  autoLoad.reset()
  if (page.value !== 1) page.value = 1
  else await load()
}

watch([activeTypes, periodKey], () => reload(), { deep: true })
watch([page, perPage], () => load())

const hasMore = computed(() => entries.value.length < total.value)

// Тот же механизм, что в «Сделках» и «Должниках»: долистали до конца — следующая
// порция приходит сама. Настройка своя у раздела и живёт между заходами.
const autoLoad = useAutoLoad({
  storageKey: 'cashflow-journal:auto-load',
  hasMore,
  busy: loading,
  loadMore: () => load(true),
})
const autoLoadSentinel = autoLoad.sentinel

watch(
  () => autoLoad.enabled.value,
  () => {
    autoLoad.reset()
    if (page.value !== 1) page.value = 1
    else void load()
  },
)

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

/**
 * Плоский список для виртуализации: заголовок дня и строки идут вперемешку.
 *
 * Вложенные группы виртуализировать нечем — рисовать по одной строке из
 * группы не получится, а у крупного партнёра в журнале под тридцать тысяч
 * записей.
 */
type JournalRow =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'entry'; key: string; entry: CashFlowEntry }

const journalRows = computed<JournalRow[]>(() => {
  const out: JournalRow[] = []
  for (const group of groupedByDate.value) {
    out.push({ kind: 'date', key: `d:${group.dateLabel}`, label: group.dateLabel })
    for (const e of group.entries) out.push({ kind: 'entry', key: e.id, entry: e })
  }
  return out
})

const journalViewport = ref<HTMLElement | null>(null)
const virtual = useVirtualRows(journalRows, {
  viewport: journalViewport,
  estimatedRowHeight: 64,
})
const markerRow = virtual.markerRow

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

/* Метка конца списка для подгрузки при прокрутке: попала в поле зрения —
   грузим следующую порцию. Высота нужна, иначе метка не «видна» наблюдателю. */
.cfj-sentinel { height: 1px; }
.cfj-summary-hint { color: rgba(var(--v-theme-on-surface), 0.35); }

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

/* Cancel action (partner capital rows only) */
.cfj-row-cancel {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; min-width: 28px; flex-shrink: 0;
  border-radius: 8px; border: 1px solid transparent;
  color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: pointer; transition: all 0.15s; opacity: 0.55;
}
.cfj-row:hover .cfj-row-cancel { opacity: 1; }
.cfj-row-cancel:hover {
  border-color: rgba(220, 38, 38, 0.30);
  background: rgba(220, 38, 38, 0.08); color: #dc2626;
}
.cfj-row-cancel--busy { opacity: 0.6; cursor: default; }

</style>
