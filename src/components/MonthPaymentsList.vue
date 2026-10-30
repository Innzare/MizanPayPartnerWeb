<script setup lang="ts">
/**
 * Платежи кассы за месяц: что пришло и что ещё ожидается, с доходом по
 * каждому. Тот же источник, что разбор месяца в «Аналитике»
 * (GET /analytics/month-deals) — цифры совпадают с лентой месяцев.
 */
import { computed, ref, watch } from 'vue'
import { fetchMonthDeals } from '@/composables/useAnalyticsOverview'
import type { MonthDealsResponse } from '@/types/analytics'
import { formatCurrency, formatDateShort } from '@/utils/formatters'
import ServerPager from '@/components/ServerPager.vue'

type Filter = 'all' | 'paid' | 'pending'
const props = defineProps<{
  cashBoxId: string
  month: string
  /** С чего открыть: у будущего месяца оплаченных нет — сразу «Ожидается». */
  initialFilter?: Filter
  /** Что выделять в строке: доход целиком или ваш чистый. */
  accent?: 'gross' | 'net'
  /** Только один вид платежей — без вкладок. */
  only?: Filter
}>()

const filter = ref<Filter>(props.only ?? props.initialFilter ?? 'all')
const page = ref(1)
const perPage = ref(25)
const data = ref<MonthDealsResponse | null>(null)
const loading = ref(false)
let seq = 0

async function load() {
  const my = ++seq
  loading.value = true
  try {
    const r = await fetchMonthDeals({
      month: props.month,
      cashBoxId: props.cashBoxId,
      filter: filter.value,
      limit: perPage.value,
      offset: (page.value - 1) * perPage.value,
    })
    if (my === seq) data.value = r
  } catch (e) {
    if (my === seq) data.value = null
    console.error('Не удалось загрузить платежи месяца:', e)
  } finally {
    if (my === seq) loading.value = false
  }
}
watch(() => [props.month, props.cashBoxId], () => {
  filter.value = props.only ?? props.initialFilter ?? 'all'
  page.value = 1
  void load()
})
watch(() => props.initialFilter, (f) => { if (f) filter.value = f })
watch(filter, () => { page.value = 1; void load() })
watch([page, perPage], () => load())
void load()

const TABS = computed(() => [
  { key: 'all' as const, label: 'Все', count: data.value?.filterCounts.all },
  { key: 'paid' as const, label: 'Оплачено', count: data.value?.filterCounts.paid },
  { key: 'pending' as const, label: 'Ожидается', count: data.value?.filterCounts.pending },
])
const STATUS: Record<string, { label: string; cls: string }> = {
  PAID: { label: 'оплачено', cls: 'mpl-st--paid' },
  PENDING: { label: 'ожидается', cls: 'mpl-st--pending' },
  OVERDUE: { label: 'просрочено', cls: 'mpl-st--overdue' },
}
</script>

<template>
  <div class="mpl">
    <div v-if="!only" class="mpl-tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        role="tab"
        class="mpl-tab"
        :class="{ 'mpl-tab--on': filter === t.key }"
        :aria-selected="filter === t.key"
        @click="filter = t.key"
      >
        {{ t.label }}<span v-if="t.count != null" class="mpl-tab-n">{{ t.count }}</span>
      </button>
    </div>

    <div v-if="loading && !data" class="mpl-empty">Загрузка…</div>
    <div v-else-if="!data?.items.length" class="mpl-empty">
      {{ filter === 'pending' ? 'Ожидаемых платежей нет' : filter === 'paid' ? 'Оплат в этом месяце нет' : 'Платежей в этом месяце нет' }}
    </div>
    <div v-else class="mpl-list" :class="{ 'mpl-list--busy': loading }">
      <div v-for="r in data.items" :key="(r.paymentId ?? 'down') + r.dealId" class="mpl-row">
        <div class="mpl-main">
          <div class="mpl-title">
            {{ r.productName }}
            <span class="mpl-num">{{ r.isDown ? 'взнос' : `платёж №${r.paymentNumber}` }}</span>
          </div>
          <div class="mpl-sub">
            {{ r.clientName }} · {{ formatDateShort(r.date) }}
            <span class="mpl-st" :class="STATUS[r.status]?.cls">{{ STATUS[r.status]?.label ?? r.status }}</span>
          </div>
        </div>
        <div class="mpl-money">
          <div class="mpl-amount">{{ formatCurrency(r.amount) }}</div>
          <div class="mpl-profit" :class="{ 'mpl-profit--accent': accent === 'net' }">
            <template v-if="accent === 'net'">вам {{ formatCurrency(r.net) }}</template>
            <template v-else>прибыль {{ formatCurrency(r.gross) }}</template>
          </div>
        </div>
      </div>
    </div>

    <ServerPager
      v-if="data && data.count > perPage"
      :page="page"
      :total="data.count"
      :per-page="perPage"
      :busy="loading"
      @update:page="page = $event"
      @update:per-page="perPage = $event"
    />
  </div>
</template>

<style scoped>
.mpl-tabs { display: inline-flex; padding: 3px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.07); margin-bottom: 10px; }
.mpl-tab {
  padding: 6px 12px; border-radius: 8px; font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65); display: inline-flex; align-items: center; gap: 6px;
}
.mpl-tab--on { background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.92); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.mpl-tab-n { font-size: 11.5px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.45); }
.mpl-empty { padding: 18px 2px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }
.mpl-list--busy { opacity: 0.6; }
.mpl-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 2px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.mpl-main { min-width: 0; }
.mpl-title { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mpl-num { margin-left: 6px; font-size: 12px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.45); }
.mpl-sub { margin-top: 2px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.mpl-st { margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.mpl-st--paid { background: rgba(16, 185, 129, 0.12); color: #059669; }
.mpl-st--pending { background: rgba(99, 102, 241, 0.12); color: #4f46e5; }
.mpl-st--overdue { background: rgba(239, 68, 68, 0.12); color: #dc2626; }
.mpl-money { flex: none; text-align: right; }
.mpl-amount { font-size: 13.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mpl-profit { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); font-variant-numeric: tabular-nums; }
.mpl-profit--accent { color: #059669; font-weight: 600; }
</style>
