<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDate } from '@/utils/formatters'
import type { CoInvestorJournalEntry, CoInvestorSummary } from '@/types'

// Embed of a single co-investor's cashflow inside the partner's /finance
// page. Lightweight version of /co-investors/[id]: shows the summary strip
// + journal list with type filter. The full page (with payout dialog,
// linked deals, CSV export) stays one click away via the "Открыть карточку"
// link.
const props = defineProps<{ coInvestorId: string }>()

const { fetchSummary, fetchJournal } = useCoInvestors()
const toast = useToast()

const summary = ref<CoInvestorSummary | null>(null)
const entries = ref<CoInvestorJournalEntry[]>([])
const loading = ref(false)
const journalTypes = ref<string[]>([])

async function load() {
  loading.value = true
  try {
    const [s, j] = await Promise.all([
      fetchSummary(props.coInvestorId),
      fetchJournal(props.coInvestorId, {
        types: journalTypes.value.length ? journalTypes.value : undefined,
        limit: 100,
      }),
    ])
    summary.value = s
    entries.value = j.entries
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить данные')
  } finally {
    loading.value = false
  }
}

watch(() => props.coInvestorId, load, { immediate: true })

async function applyFilter() {
  loading.value = true
  try {
    const j = await fetchJournal(props.coInvestorId, {
      types: journalTypes.value.length ? journalTypes.value : undefined,
      limit: 100,
    })
    entries.value = j.entries
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  } finally {
    loading.value = false
  }
}

function toggleType(t: string) {
  const idx = journalTypes.value.indexOf(t)
  if (idx >= 0) journalTypes.value.splice(idx, 1)
  else journalTypes.value.push(t)
  applyFilter()
}

const TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  CAPITAL_IN: { label: 'Пополнение капитала', color: '#3b82f6', icon: 'mdi-arrow-down-circle-outline' },
  CAPITAL_OUT: { label: 'Снятие капитала', color: '#ef4444', icon: 'mdi-arrow-up-circle-outline' },
  PROFIT_ACCRUED: { label: 'Начисление прибыли', color: '#047857', icon: 'mdi-trending-up' },
  DIVIDEND_PAID: { label: 'Выплата дивидендов', color: '#7c3aed', icon: 'mdi-cash-multiple' },
}
function entryMeta(t: string) {
  return TYPE_META[t] ?? { label: t, color: '#71717a', icon: 'mdi-circle' }
}
function formatSigned(n: number) {
  if (n === 0) return '0 ₽'
  return (n > 0 ? '+' : '') + formatCurrency(n)
}
const filterTypeOrder = ['CAPITAL_IN', 'PROFIT_ACCRUED', 'DIVIDEND_PAID', 'CAPITAL_OUT'] as const

const detailLink = computed(() => `/co-investors/${props.coInvestorId}`)
</script>

<template>
  <div class="cij-embed">
    <!-- Compact summary strip -->
    <div v-if="summary" class="cij-summary">
      <div class="cij-stat">
        <div class="cij-stat-label">Капитал</div>
        <div class="cij-stat-value" style="color: #3b82f6;">{{ formatCurrency(summary.currentCapital) }}</div>
      </div>
      <div class="cij-stat">
        <div class="cij-stat-label">В работе</div>
        <div class="cij-stat-value" style="color: #0ea5e9;">{{ formatCurrency(summary.activeDeployment) }}</div>
      </div>
      <div class="cij-stat">
        <div class="cij-stat-label">Прибыль</div>
        <div class="cij-stat-value" style="color: #047857;">{{ formatCurrency(summary.realizedProfit) }}</div>
      </div>
      <div class="cij-stat">
        <div class="cij-stat-label">Выплачено</div>
        <div class="cij-stat-value" style="color: #7c3aed;">{{ formatCurrency(summary.totalPayout) }}</div>
      </div>
      <div class="cij-stat cij-stat--accent">
        <div class="cij-stat-label">К выплате</div>
        <div class="cij-stat-value" style="color: #f59e0b;">{{ formatCurrency(summary.balanceOwed) }}</div>
      </div>
      <RouterLink :to="detailLink" class="cij-detail-link">
        Карточка
        <v-icon icon="mdi-chevron-right" size="14" />
      </RouterLink>
    </div>

    <!-- Filter chips -->
    <div class="cij-filter mb-3">
      <button
        class="cij-chip"
        :class="{ active: journalTypes.length === 0 }"
        @click="journalTypes = []; applyFilter()"
      >Все</button>
      <button
        v-for="t in filterTypeOrder"
        :key="t"
        class="cij-chip"
        :class="{ active: journalTypes.includes(t) }"
        @click="toggleType(t)"
      >{{ entryMeta(t).label }}</button>
    </div>

    <!-- Journal list -->
    <div v-if="loading" class="d-flex justify-center pa-6">
      <v-progress-circular indeterminate size="28" color="primary" />
    </div>
    <div v-else-if="!entries.length" class="cij-empty">
      <v-icon icon="mdi-cash-remove" size="36" color="grey" />
      <div class="cij-empty-title">Нет операций</div>
      <div class="cij-empty-sub">По выбранным фильтрам ничего не найдено</div>
    </div>
    <div v-else class="cij-list">
      <div v-for="e in entries" :key="e.id" class="cij-row">
        <div
          class="cij-icon"
          :style="{
            background: entryMeta(e.type).color + '14',
            color: entryMeta(e.type).color,
          }"
        >
          <v-icon :icon="entryMeta(e.type).icon" size="16" />
        </div>
        <div class="cij-main">
          <div class="cij-title">{{ entryMeta(e.type).label }}</div>
          <div class="cij-meta">
            <span>{{ formatDate(e.date) }}</span>
            <span v-if="e.dealNumber"> · сделка #{{ e.dealNumber }} {{ e.dealProductName }}</span>
            <span v-if="e.note"> · {{ e.note }}</span>
          </div>
        </div>
        <div class="cij-amount" :style="{ color: e.amount >= 0 ? '#047857' : '#ef4444' }">
          {{ formatSigned(e.amount) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cij-embed { padding-top: 4px; }

/* Summary strip */
.cij-summary {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.cij-stat {
  flex: 1; min-width: 100px;
}
.cij-stat--accent {
  padding: 6px 10px; border-radius: 8px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.20);
}
.cij-stat-label {
  font-size: 10px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-transform: uppercase; letter-spacing: 0.3px;
}
.cij-stat-value { font-size: 15px; font-weight: 700; margin-top: 2px; }
.cij-detail-link {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 6px 10px; border-radius: 8px;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  text-decoration: none;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  transition: all 0.15s;
}
.cij-detail-link:hover {
  border-color: rgba(99, 102, 241, 0.30);
  color: #6366f1;
}

/* Filter chips */
.cij-filter { display: flex; gap: 6px; flex-wrap: wrap; }
.cij-chip {
  padding: 5px 12px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.cij-chip:hover { border-color: rgba(99, 102, 241, 0.30); color: #6366f1; }
.cij-chip.active {
  border-color: #6366f1;
  background: rgba(99, 102, 241, 0.08);
  color: #6366f1;
}

/* Journal list */
.cij-list { display: flex; flex-direction: column; gap: 4px; }
.cij-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.cij-icon {
  width: 32px; height: 32px; min-width: 32px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.cij-main { flex: 1; min-width: 0; }
.cij-title {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.cij-meta {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.cij-amount { font-size: 13px; font-weight: 700; white-space: nowrap; }

/* Empty */
.cij-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 32px 16px; text-align: center;
}
.cij-empty-title { font-size: 14px; font-weight: 600; margin-top: 10px; color: rgba(var(--v-theme-on-surface), 0.7); }
.cij-empty-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }
</style>
