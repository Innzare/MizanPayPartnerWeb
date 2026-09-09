<script setup lang="ts">
/**
 * Бухгалтерские отчёты — про деньги и взаиморасчёты.
 *
 * Это не то же самое, что отчёты в «Аналитике»: там про эффективность
 * бизнеса, здесь про движение денег. Общие величины отсюда не считаются
 * вовсе — для них есть проверенный код в аналитике, и вторая ветка расчёта
 * одной суммы разошлась бы с первой.
 */
import { computed, onMounted, ref } from 'vue'
import BankLogo from '@/components/BankLogo.vue'
import { useAccountingStore } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { rangeForPreset, customLabel } from '@/composables/useReports'
import type { PeriodPreset, PeriodRange } from '@/types/reports'
import { formatCurrency } from '@/utils/formatters'
import AccountingTabs from '@/components/AccountingTabs.vue'
import DateField from '@/components/DateField.vue'

const store = useAccountingStore()
const toast = useToast()
const { isDark } = useIsDark()

type Tab = 'turnover' | 'flow' | 'aging'
const tab = ref<Tab>('turnover')

const TABS: Array<{ key: Tab; title: string; hint: string }> = [
  { key: 'turnover', title: 'Обороты по счетам', hint: 'Сколько было, пришло, ушло и стало — для сверки с выпиской' },
  { key: 'flow', title: 'Движение денег', hint: 'Откуда деньги пришли и куда ушли' },
  { key: 'aging', title: 'Старение долга', hint: 'Насколько просрочены платежи клиентов' },
]

// Период — тем же механизмом, что в остальных отчётах сервиса.
const PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'half', label: 'Полугодие' },
  { key: 'year', label: 'Год' },
  { key: 'all', label: 'За всё время' },
]
const period = ref<PeriodRange>(rangeForPreset('month'))
const customOpen = ref(false)
const thisMonth = rangeForPreset('month')
const customFrom = ref(thisMonth.from)
const customTo = ref(thisMonth.to)

const periodItems = computed(() => {
  const list = PRESETS.map((p) => ({ title: p.label, value: p.key as string }))
  if (period.value.preset === 'custom') list.push({ title: period.value.label, value: 'custom' })
  return list
})

function pickPreset(p: PeriodPreset) {
  if (p === 'custom') return
  period.value = rangeForPreset(p)
  void load()
}

function applyCustom() {
  if (!customFrom.value || !customTo.value) return
  const [f, t] =
    customFrom.value <= customTo.value
      ? [customFrom.value, customTo.value]
      : [customTo.value, customFrom.value]
  period.value = { from: f, to: t, preset: 'custom', label: customLabel(f, t) }
  customOpen.value = false
  void load()
}

// ── Данные ──
const loading = ref(false)
const turnover = ref<Awaited<ReturnType<typeof store.fetchTurnover>> | null>(null)
const flow = ref<Awaited<ReturnType<typeof store.fetchCashFlowReport>> | null>(null)
const aging = ref<Awaited<ReturnType<typeof store.fetchAging>> | null>(null)

onMounted(() => void load())

async function load() {
  loading.value = true
  try {
    const [t, f, a] = await Promise.all([
      store.fetchTurnover(period.value.from, period.value.to),
      store.fetchCashFlowReport(period.value.from, period.value.to),
      store.fetchAging(),
    ])
    turnover.value = t
    flow.value = f
    aging.value = a
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить отчёты')
  } finally {
    loading.value = false
  }
}

/** Доля бакета для полоски: самый крупный задаёт масштаб. */
const agingMax = computed(() => Math.max(1, ...(aging.value?.buckets.map((b) => b.amount) ?? [1])))

function switchTab(t: Tab) {
  tab.value = t
}
</script>

<template>
  <div class="rp-page" :class="{ dark: isDark }">
    <AccountingTabs />

    <div class="rp-head">
      <div>
        <div class="rp-title">Бухгалтерские отчёты</div>
        <div class="rp-hint">
          Про деньги и взаиморасчёты. Отчёты про эффективность бизнеса — в «Аналитике».
        </div>
      </div>

      <div class="rp-period-ctl">
        <v-select
          :model-value="period.preset"
          :items="periodItems"
          density="compact"
          variant="outlined"
          hide-details
          class="rp-vselect"
          @update:model-value="pickPreset"
        />
        <v-menu v-model="customOpen" :close-on-content-click="false" location="bottom end">
          <template #activator="{ props: menuProps }">
            <button
              v-bind="menuProps"
              class="rp-custom-btn"
              :class="{ 'rp-custom-btn--active': period.preset === 'custom' }"
              type="button"
            >
              <v-icon icon="mdi-calendar-range" size="16" />
              Свой период
            </button>
          </template>
          <v-card min-width="280" class="pa-4">
            <div class="text-caption text-medium-emphasis mb-2">С какой даты</div>
            <DateField v-model="customFrom" :max="customTo || undefined" />
            <div class="text-caption text-medium-emphasis mt-3 mb-2">По какую</div>
            <DateField v-model="customTo" :min="customFrom || undefined" />
            <v-btn color="primary" block class="mt-4" @click="applyCustom">Показать</v-btn>
          </v-card>
        </v-menu>
      </div>
    </div>

    <div class="page-tabs rp-tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="page-tab"
        :class="{ active: tab === t.key }"
        @click="switchTab(t.key)"
      >{{ t.title }}</button>
    </div>

    <div class="rp-tab-hint">{{ TABS.find((t) => t.key === tab)?.hint }}</div>

    <div v-if="loading" class="rp-loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Обороты по счетам -->
      <template v-if="tab === 'turnover'">
        <div v-if="!turnover?.rows.length" class="rp-empty">
          <v-icon icon="mdi-bank-outline" size="34" />
          <div class="rp-empty-title">Счетов пока нет</div>
          <div class="rp-empty-text">Заведите счета — и здесь появятся обороты по каждому.</div>
        </div>

        <template v-else>
          <!-- Если приход и расход не объясняют разницу остатков, значит
               движения писались мимо счёта. Молчать об этом нельзя. -->
          <div v-if="!turnover.consistent" class="rp-alert">
            <v-icon icon="mdi-alert-circle-outline" size="18" />
            Обороты не сходятся с остатками — проверьте самопроверку на «Балансе»
          </div>

          <div class="rp-table-wrap">
            <div class="rp-table">
              <div class="rp-tr rp-tr--head">
                <div>Счёт</div>
                <div class="rp-td--right">Было</div>
                <div class="rp-td--right">Пришло</div>
                <div class="rp-td--right">Ушло</div>
                <div class="rp-td--right">Стало</div>
                <div class="rp-td--right">Операций</div>
              </div>

              <div v-for="r in turnover.rows" :key="r.id" class="rp-tr">
                <div class="rp-acc">
                  <BankLogo
                    :bank-name="r.bank?.name"
                    :color="r.bank?.color || r.color"
                    :fallback="r.code"
                    :size="18"
                  />
                  <span class="rp-acc-code">{{ r.code }}</span>
                  <span class="rp-acc-name">{{ r.name }}</span>
                </div>
                <div class="rp-td--right rp-num">{{ formatCurrency(r.opening) }}</div>
                <div class="rp-td--right rp-num rp-num--in">{{ r.income ? '+' + formatCurrency(r.income) : '—' }}</div>
                <div class="rp-td--right rp-num rp-num--out">{{ r.expense ? formatCurrency(r.expense) : '—' }}</div>
                <div class="rp-td--right rp-num rp-num--bold">{{ formatCurrency(r.closing) }}</div>
                <div class="rp-td--right rp-num rp-num--muted">{{ r.count }}</div>
              </div>

              <div v-if="turnover.totals" class="rp-tr rp-tr--total">
                <div>Итого</div>
                <div class="rp-td--right rp-num">{{ formatCurrency(turnover.totals.opening) }}</div>
                <div class="rp-td--right rp-num rp-num--in">+{{ formatCurrency(turnover.totals.income) }}</div>
                <div class="rp-td--right rp-num rp-num--out">{{ formatCurrency(turnover.totals.expense) }}</div>
                <div class="rp-td--right rp-num rp-num--bold">{{ formatCurrency(turnover.totals.closing) }}</div>
                <div class="rp-td--right rp-num rp-num--muted">{{ turnover.totals.count }}</div>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- Движение денег -->
      <template v-else-if="tab === 'flow'">
        <div class="rp-flow-head">
          <div class="rp-flow-cell">
            <div class="rp-flow-label">Было на начало</div>
            <div class="rp-flow-value">{{ formatCurrency(flow?.opening ?? 0) }}</div>
          </div>
          <div class="rp-flow-cell">
            <div class="rp-flow-label">Пришло</div>
            <div class="rp-flow-value rp-num--in">+{{ formatCurrency(flow?.incomeTotal ?? 0) }}</div>
          </div>
          <div class="rp-flow-cell">
            <div class="rp-flow-label">Ушло</div>
            <div class="rp-flow-value rp-num--out">{{ formatCurrency(flow?.expenseTotal ?? 0) }}</div>
          </div>
          <div class="rp-flow-cell">
            <div class="rp-flow-label">Стало на конец</div>
            <div class="rp-flow-value rp-num--bold">{{ formatCurrency(flow?.closing ?? 0) }}</div>
          </div>
        </div>

        <div class="rp-flow-cols">
          <div class="rp-flow-col">
            <div class="rp-flow-col-title">Откуда пришли</div>
            <div v-if="!flow?.income.length" class="rp-flow-none">Поступлений за период нет</div>
            <div v-for="i in flow?.income ?? []" :key="i.kind" class="rp-flow-row">
              <span class="rp-flow-row-label">{{ i.label }}</span>
              <span class="rp-flow-row-count">{{ i.count }}</span>
              <span class="rp-flow-row-amount rp-num--in">+{{ formatCurrency(i.amount) }}</span>
            </div>
          </div>

          <div class="rp-flow-col">
            <div class="rp-flow-col-title">Куда ушли</div>
            <div v-if="!flow?.expense.length" class="rp-flow-none">Расходов за период нет</div>
            <div v-for="i in flow?.expense ?? []" :key="i.kind" class="rp-flow-row">
              <span class="rp-flow-row-label">{{ i.label }}</span>
              <span class="rp-flow-row-count">{{ i.count }}</span>
              <span class="rp-flow-row-amount rp-num--out">{{ formatCurrency(i.amount) }}</span>
            </div>
          </div>
        </div>
      </template>

      <!-- Старение долга -->
      <template v-else>
        <div class="rp-aging-total">
          <div class="rp-flow-label">Просрочено всего</div>
          <div class="rp-aging-sum">{{ formatCurrency(aging?.total ?? 0) }}</div>
          <div class="rp-flow-label">{{ aging?.count ?? 0 }} платежей</div>
        </div>

        <div class="rp-aging">
          <div v-for="b in aging?.buckets ?? []" :key="b.key" class="rp-aging-row">
            <div class="rp-aging-label">{{ b.label }}</div>
            <div class="rp-aging-bar">
              <div
                class="rp-aging-fill"
                :class="`rp-aging-fill--${b.key.replace('+', 'plus')}`"
                :style="{ width: Math.round((b.amount / agingMax) * 100) + '%' }"
              />
            </div>
            <div class="rp-aging-count">{{ b.count }} шт</div>
            <div class="rp-aging-amount">{{ formatCurrency(b.amount) }}</div>
          </div>
        </div>

        <div class="rp-note">
          <v-icon icon="mdi-information-outline" size="16" />
          Считаются платежи действующих сделок, не оплаченные в срок. Прощённые долги сюда
          не входят — требовать эти деньги никто уже не будет.
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.rp-page { padding: 24px 28px 40px; }
.rp-loading { display: flex; justify-content: center; align-items: center; min-height: 260px; }

.rp-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; margin-bottom: 16px;
}
.rp-title { font-size: 20px; font-weight: 700; }
.rp-hint { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 3px; max-width: 620px; }

.rp-period-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rp-vselect { min-width: 172px; }
.rp-vselect :deep(.v-field) {
  border-radius: 9px; font-size: 13px; font-weight: 600;
  background: rgb(var(--v-theme-surface));
}
.rp-vselect :deep(.v-field__input) { min-height: 40px; padding-top: 0; padding-bottom: 0; }
.rp-custom-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 14px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.rp-custom-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.25); }
.rp-custom-btn--active {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.32);
  color: #10b981;
}

.rp-tabs { margin-bottom: 8px; }
.rp-tab-hint {
  font-size: 12.5px; margin-bottom: 16px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.rp-alert {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 15px; border-radius: 12px; margin-bottom: 14px;
  font-size: 13px; font-weight: 600;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #b91c1c;
}

/* ── Обороты ── */
.rp-table-wrap {
  border-radius: 14px; overflow-x: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.rp-table { min-width: 820px; }
.rp-tr {
  display: grid; grid-template-columns: minmax(220px, 2fr) repeat(5, minmax(110px, 1fr));
  align-items: center; gap: 12px; padding: 12px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.rp-tr:first-child { border-top: none; }
.rp-tr--head {
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.rp-tr--total {
  font-weight: 700;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-top: 2px solid rgba(var(--v-theme-on-surface), 0.1);
}
.rp-td--right { text-align: right; }
.rp-num { font-variant-numeric: tabular-nums; font-size: 13.5px; }
.rp-num--in { color: #047857; }
.rp-num--out { color: #b45309; }
.rp-num--bold { font-weight: 700; }
.rp-num--muted { color: rgba(var(--v-theme-on-surface), 0.45); }
.dark .rp-num--in { color: #34d399; }
.dark .rp-num--out { color: #fbbf24; }

.rp-acc { display: flex; align-items: center; gap: 8px; min-width: 0; }
.rp-acc-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.rp-acc-code { font-size: 12px; font-weight: 800; opacity: 0.7; }
.rp-acc-name {
  font-size: 13.5px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── Движение денег ── */
.rp-flow-head {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
  border-radius: 14px; overflow: hidden; margin-bottom: 18px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.rp-flow-cell { padding: 14px 18px; background: rgb(var(--v-theme-surface)); }
.rp-flow-label {
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.rp-flow-value {
  font-size: 19px; font-weight: 700; margin-top: 5px;
  font-variant-numeric: tabular-nums; letter-spacing: -0.3px;
}

.rp-flow-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.rp-flow-col {
  border-radius: 14px; padding: 14px 18px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.rp-flow-col-title { font-size: 14px; font-weight: 700; margin-bottom: 10px; }
.rp-flow-none { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.4); }
.rp-flow-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 0; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.rp-flow-row:first-of-type { border-top: none; }
.rp-flow-row-label { flex: 1; min-width: 0; font-size: 13.5px; }
.rp-flow-row-count {
  font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.rp-flow-row-amount { font-size: 13.5px; font-weight: 700; font-variant-numeric: tabular-nums; }

/* ── Старение долга ── */
.rp-aging-total {
  padding: 16px 20px; border-radius: 14px; margin-bottom: 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.rp-aging-sum { font-size: 26px; font-weight: 800; margin: 4px 0 2px; letter-spacing: -0.5px; }
.rp-aging {
  border-radius: 14px; padding: 6px 18px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.rp-aging-row {
  display: grid; grid-template-columns: 150px 1fr 80px 140px;
  align-items: center; gap: 14px; padding: 12px 0;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.rp-aging-row:first-child { border-top: none; }
.rp-aging-label { font-size: 13.5px; font-weight: 500; }
.rp-aging-bar {
  height: 8px; border-radius: 4px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.07);
}
.rp-aging-fill { height: 100%; border-radius: 4px; }
/* Чем дольше просрочка, тем тревожнее цвет: свежая — ещё рабочая ситуация. */
.rp-aging-fill--0-30 { background: #10b981; }
.rp-aging-fill--31-60 { background: #f59e0b; }
.rp-aging-fill--61-90 { background: #f97316; }
.rp-aging-fill--90plus { background: #dc2626; }
.rp-aging-count { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.45); text-align: right; }
.rp-aging-amount {
  font-size: 14px; font-weight: 700; text-align: right;
  font-variant-numeric: tabular-nums;
}

.rp-note {
  display: flex; gap: 8px; align-items: flex-start;
  margin-top: 14px; padding: 12px 14px; border-radius: 10px;
  font-size: 12.5px; line-height: 1.5;
  background: rgba(var(--v-theme-on-surface), 0.03);
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.rp-empty {
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  padding: 52px 24px; border-radius: 14px; text-align: center;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.rp-empty-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.rp-empty-text { font-size: 13px; max-width: 380px; line-height: 1.5; }

@media (max-width: 900px) {
  .rp-flow-head { grid-template-columns: repeat(2, 1fr); }
  .rp-flow-cols { grid-template-columns: 1fr; }
  .rp-aging-row { grid-template-columns: 120px 1fr 110px; }
  .rp-aging-count { display: none; }
}
</style>
