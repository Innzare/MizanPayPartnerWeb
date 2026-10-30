<script setup lang="ts">
/**
 * Месяцы кассы на её странице. Лента показывает по месяцам то, что выбрано в
 * навигации слева:
 *   • журнал и «Пришло от клиентов» — пришло (возврат закупки + прибыль),
 *     переключатель «Продажи» — на сколько оформили договоров;
 *   • «Чистая прибыль» — прибыль и её раздел с инвесторами;
 *   • «Расходы» — расходы месяца;
 *   • «Осталось получить» и «Прогноз» — неоплаченные платежи по сроку (у
 *     прошлых месяцев это просрочка);
 *   • остатки (деньги в кассе, в работе, капитал, резерв) — на конец месяца.
 * Прошлые месяцы — факт, текущий и будущие — ожидаемое по графикам платежей;
 * у остатков будущих месяцев значения нет.
 *
 * Цифры — GET /analytics/cashbox-months: те же, что в плитках, «Аналитике» и на
 * «Инвесторах». Лента — общий движок MonthRibbonChart.
 */
import { computed, ref } from 'vue'
import { formatCurrency, pluralizeRu } from '@/utils/formatters'
import MonthRibbonChart, { type RibbonMonth, type RibbonSegment } from '@/components/MonthRibbonChart.vue'
import type { CashBoxMonthRow } from '@/types/analytics'

const props = defineProps<{
  months: CashBoxMonthRow[]
  selected: string
  loading?: boolean
  canSeeCost: boolean
  /** Пункт навигации кассы — что показать по месяцам. */
  metric?: string | null
}>()
const emit = defineEmits<{ (e: 'select', month: string): void }>()

type View = 'money' | 'sales' | 'profit' | 'expenses' | 'unpaid' | 'cash' | 'inWork' | 'capital' | 'owed'
/** У «Пришло» есть второй взгляд — продажи по дате договора. */
const salesView = ref(false)
const view = computed<View>(() => {
  switch (props.metric) {
    case 'profit': return 'profit'
    case 'manual': return 'expenses'
    case 'remaining':
    case 'forecast': return 'unpaid'
    case 'available': return 'cash'
    case 'deployed': return 'inWork'
    case 'capital': return 'capital'
    case 'pendingCI': return 'owed'
    default: return salesView.value ? 'sales' : 'money'
  }
})
const hasSalesToggle = computed(() => view.value === 'money' || view.value === 'sales')

// Палитра кассы — спокойная и плоская, без градиентов: деньги «сверху» —
// фирменный зелёный, возврат закупки и закупка — синий, как в «Аналитике»,
// инвесторы и «в работе» — приглушённый песочный, расходы и просрочка —
// мягкий красный, ожидаемое — зелёная штриховка.
const C_PROFIT = '#2a9d78'
const C_INV = '#e6b46c'
const C_BACK = '#3b82f6'
const C_SALES = C_BACK
const C_COST = '#e0887c'
const C_COST_OTHER = '#efbcb4'
const C_CASH = C_PROFIT
const C_WORK = C_INV
const C_OWED = '#e29f5e'
const C_EXP = 'repeating-linear-gradient(135deg, rgba(42, 157, 120, 0.24) 0 4px, rgba(42, 157, 120, 0.07) 4px 8px)'
const C_EXP_LINE = 'inset 0 0 0 1px rgba(42, 157, 120, 0.45)'
const C_DUE = C_EXP
const C_DUE_LINE = C_EXP_LINE
const C_LATE = C_COST

const byMonth = computed(() => new Map(props.months.map((x) => [x.month, x])))
const ahead = (x: CashBoxMonthRow) => x.future || x.current
const money = formatCurrency
type Bar = Pick<RibbonMonth, 'segments' | 'headline' | 'unknown'>

function bar(x: CashBoxMonthRow): Bar {
  const v = view.value
  const seg = (value: number, background: string): RibbonSegment => ({ value, background })
  const exp = (value: number): RibbonSegment => ({ value, background: C_EXP, outline: C_EXP_LINE })
  if (v === 'money') {
    const profit = Math.max(Math.min(x.gross, x.received), 0)
    const s = [seg(Math.max(x.received - profit, 0), C_BACK), seg(profit, C_PROFIT)]
    if (ahead(x)) s.push(exp(x.pending))
    return { segments: s, headline: x.future ? `≈ ${money(x.pending)}` : money(x.received) }
  }
  if (v === 'profit') {
    const inv = Math.max(Math.min(x.investors, x.gross), 0)
    const s = [seg(inv, C_INV), seg(Math.max(x.gross - inv, 0), C_PROFIT)]
    if (ahead(x)) s.push(exp(x.expectedGross))
    return { segments: s, headline: x.future ? `≈ ${money(x.expectedGross)}` : money(x.gross) }
  }
  if (v === 'sales') {
    // Продаж в будущем ещё нет — без «нулевой» черты, чтобы не читалось как провал.
    if (x.future) return { segments: [], headline: '—', unknown: true }
    const s = x.sales
    return {
      segments: props.canSeeCost && s.cost != null && s.markup != null
        ? [seg(s.cost, C_BACK), seg(s.markup, C_PROFIT)]
        : [seg(s.total, C_SALES)],
      headline: money(s.total),
    }
  }
  if (v === 'expenses') {
    const business = -x.flows.expenses
    const other = -x.flows.otherExpenses
    if (x.future && !business && !other) return { segments: [], headline: '—', unknown: true }
    return { segments: [seg(business, C_COST), seg(other, C_COST_OTHER)], headline: money(business + other) }
  }
  if (v === 'unpaid') {
    // Прошлый месяц — просрочка, текущий и будущие — ожидается по графику.
    const s = ahead(x) ? [{ value: x.unpaid, background: C_DUE, outline: C_DUE_LINE }] : [seg(x.unpaid, C_LATE)]
    return { segments: s, headline: money(x.unpaid) }
  }
  // Остатки — на конец месяца; у будущих их нет.
  const b = x.balances
  if (!b) return { segments: [], headline: '—', unknown: true }
  if (v === 'cash') return { segments: [seg(b.cashEnd, C_CASH)], headline: money(b.cashEnd) }
  if (v === 'inWork') return { segments: [seg(b.inWorkEnd, C_WORK)], headline: money(b.inWorkEnd) }
  if (v === 'capital') {
    return { segments: [seg(b.investedEnd, C_PROFIT), seg(b.ciCapitalEnd, C_INV)], headline: money(b.totalCapitalEnd) }
  }
  return { segments: [seg(b.owedEnd, C_OWED)], headline: money(b.owedEnd) }
}

const ribbon = computed<RibbonMonth[]>(() => props.months.map((x) => ({
  month: x.month,
  future: x.future,
  current: x.current,
  ...bar(x),
})))

const hasData = computed(() => ribbon.value.some((m) => m.segments.some((s) => s.value > 0)))
const HINT = 'Нажмите на месяц — показатели кассы переключатся на него.'
const TEXT: Record<View, { title: string; sub: string; empty: string }> = {
  money: { title: 'Пришло от клиентов', sub: `Сколько денег пришло и какая часть из них — прибыль. ${HINT}`, empty: 'По этой кассе пока нет оплат.' },
  sales: { title: 'Продажи', sub: `На какую сумму оформили договоров — по дате сделки. ${HINT}`, empty: 'По этой кассе пока нет продаж.' },
  profit: { title: 'Прибыль', sub: `Прибыль кассы по месяцам и её раздел с инвесторами. ${HINT}`, empty: 'По этой кассе пока нет прибыли.' },
  unpaid: { title: 'Ожидается от клиентов', sub: `Неоплаченные платежи по сроку: впереди — по графикам, в прошлых месяцах — просрочка. ${HINT}`, empty: 'Неоплаченных платежей нет.' },
  expenses: { title: 'Расходы', sub: `Расходы по бизнесу и иные расходы по месяцам. ${HINT}`, empty: 'Расходов по этой кассе нет.' },
  cash: { title: 'Деньги в кассе', sub: `Сколько денег было в кассе на конец каждого месяца. ${HINT}`, empty: 'Денег в кассе по месяцам пока нет.' },
  inWork: { title: 'В работе', sub: `Сколько денег было вложено в товар на конец месяца. ${HINT}`, empty: 'В работе пока ничего нет.' },
  capital: { title: 'Общий капитал', sub: `Ваш капитал и капитал инвесторов на конец месяца. ${HINT}`, empty: 'Капитала по месяцам пока нет.' },
  owed: { title: 'Резерв для инвесторов', sub: `Сколько вы должны инвесторам на конец месяца. ${HINT}`, empty: 'Долгов инвесторам нет.' },
}
const text = computed(() => TEXT[view.value])
const payments = (n: number) => `${n} ${pluralizeRu(n, 'платёж', 'платежа', 'платежей')}`
const isStock = computed(() => ['cash', 'inWork', 'capital', 'owed'].includes(view.value))
</script>

<template>
  <MonthRibbonChart
    :months="ribbon"
    :selected="selected"
    :loading="loading"
    :title="text.title"
    :subtitle="text.sub"
    :empty-text="text.empty"
    :has-data="hasData"
    @select="emit('select', $event)"
  >
    <template #controls>
      <div class="cbm-controls">
        <!-- «За всё время» — снять выбор месяца: показатели вернутся к итогам. -->
        <button
          type="button"
          class="cbm-all"
          :class="{ 'cbm-all--on': !selected }"
          :aria-pressed="!selected"
          @click="emit('select', '')"
        >
          <v-icon icon="mdi-infinity" size="15" />
          За всё время
        </button>
        <div v-if="hasSalesToggle" class="cbm-seg" role="tablist" aria-label="Что показать">
          <button
            type="button"
            role="tab"
            class="cbm-seg-btn"
            :class="{ 'cbm-seg-btn--on': !salesView }"
            :aria-selected="!salesView"
            @click="salesView = false"
          >Пришло</button>
          <button
            type="button"
            role="tab"
            class="cbm-seg-btn"
            :class="{ 'cbm-seg-btn--on': salesView }"
            :aria-selected="salesView"
            @click="salesView = true"
          >Продажи</button>
        </div>
      </div>
    </template>

    <template #tip="{ month, title }">
      <template v-for="t in [byMonth.get(month)].filter(Boolean) as CashBoxMonthRow[]" :key="t.month">
        <div class="rc-tip-head">
          <b>{{ title }}</b>
          <span v-if="t.current" class="rc-tag rc-tag--now">идёт сейчас</span>
          <span v-else-if="t.future" class="rc-tag rc-tag--future">прогноз</span>
        </div>

        <template v-if="view === 'sales'">
          <template v-if="!t.future">
            <div class="rc-tip-line"><span>Сделок</span><b>{{ t.sales.count }}<template v-if="t.sales.clients"> · клиентов {{ t.sales.clients }}</template></b></div>
            <div class="rc-tip-line"><span>На сумму</span><b>{{ money(t.sales.total) }}</b></div>
            <div v-if="t.sales.downPayment" class="rc-tip-line rc-tip-sub"><span>первые взносы</span><b>{{ money(t.sales.downPayment) }}</b></div>
            <template v-if="t.sales.cost != null && t.sales.markup != null">
              <div class="rc-tip-sep" />
              <div class="rc-tip-line rc-tip-sub"><span><i class="rc-dot cbm-tip-back" />Закупка</span><b>{{ money(t.sales.cost) }}</b></div>
              <div class="rc-tip-line rc-tip-sub"><span><i class="rc-dot cbm-tip-profit" />Наценка</span><b>{{ money(t.sales.markup) }}</b></div>
            </template>
          </template>
          <div v-else class="rc-tip-line"><span>Месяц ещё не наступил</span></div>
        </template>

        <template v-else-if="view === 'profit'">
          <template v-if="!t.future">
            <div class="rc-tip-line"><span>Прибыль кассы</span><b>{{ money(t.gross) }}</b></div>
            <div class="rc-tip-line rc-tip-sub"><span><i class="rc-dot cbm-tip-inv" />Инвесторам</span><b>{{ money(t.investors) }}</b></div>
            <div class="rc-tip-line rc-tip-sub"><span><i class="rc-dot cbm-tip-profit" />Вам</span><b>{{ money(t.partner) }}</b></div>
          </template>
          <template v-if="ahead(t) && t.expectedGross > 0">
            <div v-if="t.current" class="rc-tip-sep" />
            <div class="rc-tip-line"><span>Ещё ожидается прибыли</span><b>{{ money(t.expectedGross) }}</b></div>
            <div class="rc-tip-line rc-tip-sub"><span>из неё инвесторам ≈</span><b>{{ money(t.expectedInvestors) }}</b></div>
          </template>
          <div v-if="t.future && !(t.expectedGross > 0)" class="rc-tip-line"><span>Платежей по графику нет</span></div>
        </template>

        <template v-else-if="view === 'unpaid'">
          <div class="rc-tip-line">
            <span><i class="rc-dot" :class="ahead(t) ? 'cbm-tip-due' : 'cbm-tip-late'" />{{ ahead(t) ? 'Осталось получить' : 'Не оплачено в срок' }}</span>
            <b>{{ money(t.unpaid) }}</b>
          </div>
          <div class="rc-tip-line rc-tip-sub"><span>{{ payments(t.unpaidCount) }}, прибыль ≈</span><b>{{ money(t.unpaidGross) }}</b></div>
          <template v-if="!t.future && t.received">
            <div class="rc-tip-sep" />
            <div class="rc-tip-line rc-tip-sub"><span>уже пришло за месяц</span><b>{{ money(t.received) }}</b></div>
          </template>
        </template>

        <template v-else-if="view === 'expenses'">
          <div class="rc-tip-line"><span><i class="rc-dot cbm-tip-cost" />Расходы по бизнесу</span><b>{{ money(-t.flows.expenses) }}</b></div>
          <div class="rc-tip-line rc-tip-sub"><span>операций</span><b>{{ t.flows.expenseCount }}</b></div>
          <div v-if="t.flows.otherExpenses" class="rc-tip-line"><span><i class="rc-dot cbm-tip-cost2" />Иные расходы</span><b>{{ money(-t.flows.otherExpenses) }}</b></div>
          <div v-if="t.flows.otherIncome" class="rc-tip-line"><span>Прочие доходы</span><b>+{{ money(t.flows.otherIncome) }}</b></div>
        </template>

        <template v-else-if="isStock">
          <template v-if="t.balances">
            <div class="rc-tip-line">
              <span>{{ t.current ? 'На сегодня' : 'На конец месяца' }}</span>
              <b>{{ money(view === 'cash' ? t.balances.cashEnd : view === 'inWork' ? t.balances.inWorkEnd : view === 'capital' ? t.balances.totalCapitalEnd : t.balances.owedEnd) }}</b>
            </div>
            <template v-if="view === 'cash'">
              <div class="rc-tip-line rc-tip-sub"><span>на начало месяца</span><b>{{ money(t.balances.cashStart) }}</b></div>
              <div class="rc-tip-line rc-tip-sub"><span>пришло · ушло</span><b>+{{ money(t.flows.in) }} · −{{ money(t.flows.out) }}</b></div>
            </template>
            <div v-else-if="view === 'inWork'" class="rc-tip-line rc-tip-sub"><span>активных сделок</span><b>{{ t.balances.activeDealsEnd }}</b></div>
            <template v-else-if="view === 'capital'">
              <div class="rc-tip-line rc-tip-sub"><span><i class="rc-dot cbm-tip-profit" />ваш</span><b>{{ money(t.balances.investedEnd) }}</b></div>
              <div class="rc-tip-line rc-tip-sub"><span><i class="rc-dot cbm-tip-inv" />инвесторов</span><b>{{ money(t.balances.ciCapitalEnd) }}</b></div>
            </template>
            <template v-else>
              <div v-if="t.investors" class="rc-tip-line rc-tip-sub"><span>начислено за месяц</span><b>{{ money(t.investors) }}</b></div>
              <div v-if="t.flows.investorsPaid" class="rc-tip-line rc-tip-sub"><span>выплачено</span><b>{{ money(t.flows.investorsPaid) }}</b></div>
            </template>
          </template>
          <div v-else class="rc-tip-line"><span>Месяц ещё не наступил</span></div>
        </template>

        <template v-else>
          <template v-if="!t.future">
            <div class="rc-tip-line"><span>Пришло от клиентов</span><b>{{ money(t.received) }}</b></div>
            <div v-if="t.paidCount" class="rc-tip-line rc-tip-sub"><span>оплат</span><b>{{ t.paidCount.toLocaleString('ru-RU') }}</b></div>
            <div class="rc-tip-sep" />
            <div class="rc-tip-line"><span><i class="rc-dot cbm-tip-profit" />Из них прибыль</span><b>{{ money(t.gross) }}</b></div>
            <div v-if="t.investors" class="rc-tip-line rc-tip-sub"><span>инвесторам</span><b>{{ money(t.investors) }}</b></div>
            <div v-if="t.investors" class="rc-tip-line rc-tip-sub"><span>вам</span><b>{{ money(t.partner) }}</b></div>
          </template>
          <template v-if="ahead(t) && t.pending > 0">
            <div v-if="t.current" class="rc-tip-sep" />
            <div class="rc-tip-line"><span>Ещё ожидается</span><b>{{ money(t.pending) }}</b></div>
            <div class="rc-tip-line rc-tip-sub"><span>{{ payments(t.pendingCount) }}, прибыль ≈</span><b>{{ money(t.expectedGross) }}</b></div>
          </template>
          <div v-if="t.future && !(t.pending > 0)" class="rc-tip-line"><span>Платежей по графику нет</span></div>
        </template>

        <div class="rc-tip-foot">Нажмите, чтобы открыть месяц</div>
      </template>
    </template>

    <template #legend>
      <template v-if="view === 'money'">
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_BACK }" />Возврат закупки</span>
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_PROFIT }" />Прибыль</span>
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_EXP, boxShadow: C_EXP_LINE }" />Ожидается</span>
      </template>
      <template v-else-if="view === 'profit'">
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_INV }" />Инвесторам</span>
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_PROFIT }" />Вам</span>
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_EXP, boxShadow: C_EXP_LINE }" />Ожидается</span>
      </template>
      <template v-else-if="view === 'sales'">
        <template v-if="canSeeCost">
          <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_BACK }" />Закупка</span>
          <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_PROFIT }" />Наценка</span>
        </template>
        <span v-else class="rc-legend-item"><i class="rc-dot" :style="{ background: C_SALES }" />Сумма договоров</span>
      </template>
      <template v-else-if="view === 'unpaid'">
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_DUE, boxShadow: C_DUE_LINE }" />Ожидается</span>
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_LATE }" />Просрочено</span>
      </template>
      <template v-else-if="view === 'expenses'">
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_COST }" />Расходы по бизнесу</span>
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_COST_OTHER }" />Иные расходы</span>
      </template>
      <template v-else-if="view === 'capital'">
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_PROFIT }" />Ваш капитал</span>
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_INV }" />Капитал инвесторов</span>
      </template>
      <span v-else class="rc-legend-item">На конец месяца · у текущего — на сегодня</span>
    </template>
  </MonthRibbonChart>
</template>

<style scoped>
.cbm-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cbm-all {
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 8px;
  font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.7);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgb(var(--v-theme-surface));
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.cbm-all:hover { border-color: rgba(var(--v-theme-on-surface), 0.25); }
.cbm-all--on { background: rgba(15, 118, 110, 0.1); border-color: rgba(15, 118, 110, 0.45); color: #0f766e; }
.cbm-seg { display: inline-flex; padding: 3px; border-radius: 8px; background: rgba(var(--v-theme-on-surface), 0.07); }
.cbm-seg-btn {
  padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65); transition: background 0.15s, color 0.15s;
}
.cbm-seg-btn--on { background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.92); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.cbm-tip-inv { background: #e6b46c; }
.cbm-tip-profit { background: #2a9d78; }
.cbm-tip-back { background: #3b82f6; }
.cbm-tip-cost { background: #e0887c; }
.cbm-tip-cost2 { background: #efbcb4; }
.cbm-tip-due { background: rgba(42, 157, 120, 0.35); }
.cbm-tip-late { background: #e0887c; }
@media (max-width: 600px) {
  .cbm-controls { width: 100%; }
  .cbm-all { flex: 1; justify-content: center; }
  .cbm-seg { flex: 1; display: flex; }
  .cbm-seg-btn { flex: 1; padding: 7px 6px; }
}
</style>
