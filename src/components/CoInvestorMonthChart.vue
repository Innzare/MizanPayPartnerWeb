<script setup lang="ts">
/**
 * Месяцы кассы — столбики над таблицей инвесторов (как «график цен» у
 * Aviasales, только столбик — месяц). Видно сразу весь путь кассы: прибыль,
 * её раздел с инвесторами, долг инвесторам; будущие месяцы — прогноз по
 * графикам платежей. Наведение — подробности месяца, нажатие — открыть его
 * в таблице.
 *
 * Цифры приходят с сервера (GET /co-investors/month/series) и совпадают с
 * карточками и таблицей выбранного месяца. Лента — общий движок
 * MonthRibbonChart, здесь — что и каким цветом в столбике.
 */
import { computed, ref } from 'vue'
import { formatCurrency } from '@/utils/formatters'
import MonthRibbonChart, { type RibbonMonth, type RibbonSegment } from '@/components/MonthRibbonChart.vue'

export interface SeriesMonth {
  month: string
  future: boolean
  current: boolean
  closed: boolean
  gross: number
  investors: number
  partner: number
  expectedGross: number
  expectedInvestors: number
  paid: number
  reinvested: number
  owedEnd: number | null
  capitalEnd: number | null
}

const props = defineProps<{ months: SeriesMonth[]; selected: string; loading?: boolean }>()
const emit = defineEmits<{ (e: 'select', month: string): void }>()

type Mode = 'profit' | 'debt'
const mode = ref<Mode>('profit')

/* Цвета — насыщенные, но спокойные: инвесторы — индиго, вы — изумрудный. */
const C_INV = 'linear-gradient(180deg, #6a6ff0 0%, #5157dc 100%)'
const C_ME = 'linear-gradient(180deg, #19b88a 0%, #0b9a70 100%)'
const C_EXP = 'repeating-linear-gradient(135deg, rgba(99, 102, 241, 0.16) 0 4px, rgba(99, 102, 241, 0.07) 4px 8px)'
const C_EXP_LINE = 'inset 0 0 0 1px rgba(99, 102, 241, 0.35)'
const C_DEBT = 'linear-gradient(180deg, #f2a93b 0%, #dd8a14 100%)'

const byMonth = computed(() => new Map(props.months.map((x) => [x.month, x])))

const ribbon = computed<RibbonMonth[]>(() => props.months.map((x) => {
  if (mode.value === 'debt') {
    return {
      month: x.month, future: x.future, current: x.current, closed: x.closed,
      segments: x.owedEnd != null ? [{ value: x.owedEnd, background: C_DEBT }] : [],
      headline: x.owedEnd == null ? '—' : formatCurrency(x.owedEnd),
      unknown: x.owedEnd == null,
    }
  }
  const inv = Math.max(Math.min(x.investors, x.gross), 0)
  const me = Math.max(x.gross - inv, 0)
  const segments: RibbonSegment[] = [
    { value: inv, background: C_INV },
    { value: me, background: C_ME },
  ]
  if (x.future || x.current) segments.push({ value: x.expectedGross, background: C_EXP, outline: C_EXP_LINE })
  return {
    month: x.month, future: x.future, current: x.current, closed: x.closed,
    segments,
    headline: x.future ? `≈ ${formatCurrency(x.expectedGross)}` : formatCurrency(x.gross),
  }
}))

const hasData = computed(() => props.months.some((x) => x.gross || x.expectedGross || x.owedEnd))
const subtitle = computed(() => mode.value === 'profit'
  ? 'Прибыль кассы по месяцам и её раздел. Нажмите на месяц, чтобы открыть его.'
  : 'Сколько вы должны инвесторам на конец каждого месяца.')
</script>

<template>
  <MonthRibbonChart
    :months="ribbon"
    :selected="selected"
    :loading="loading"
    title="Месяцы кассы"
    :subtitle="subtitle"
    empty-text="По этой кассе пока нет ни прибыли, ни долгов инвесторам."
    :has-data="hasData"
    @select="emit('select', $event)"
  >
    <template #controls>
      <div class="cmc-seg" role="tablist">
        <button type="button" class="cmc-seg-btn" :class="{ 'cmc-seg-btn--on': mode === 'profit' }" @click="mode = 'profit'">Прибыль</button>
        <button type="button" class="cmc-seg-btn" :class="{ 'cmc-seg-btn--on': mode === 'debt' }" @click="mode = 'debt'">Долг инвесторам</button>
      </div>
    </template>

    <template #tip="{ month, title }">
      <template v-if="byMonth.get(month)">
        <template v-for="t in [byMonth.get(month)!]" :key="t.month">
          <div class="rc-tip-head">
            <b>{{ title }}</b>
            <span v-if="t.closed" class="rc-tag">закрыт</span>
            <span v-else-if="t.current" class="rc-tag rc-tag--now">идёт сейчас</span>
            <span v-else-if="t.future" class="rc-tag rc-tag--future">прогноз</span>
          </div>
          <template v-if="!t.future">
            <div class="rc-tip-line"><span>Прибыль кассы</span><b>{{ formatCurrency(t.gross) }}</b></div>
            <div class="rc-tip-line rc-tip-sub"><span><i class="rc-dot cmc-tip-inv" />Инвесторам</span><b>{{ formatCurrency(t.investors) }}</b></div>
            <div class="rc-tip-line rc-tip-sub"><span><i class="rc-dot cmc-tip-me" />Вам</span><b>{{ formatCurrency(t.partner) }}</b></div>
            <div class="rc-tip-sep" />
            <div class="rc-tip-line"><span>Выплачено инвесторам</span><b>{{ formatCurrency(t.paid) }}</b></div>
            <div v-if="t.reinvested" class="rc-tip-line"><span>Реинвест</span><b>{{ formatCurrency(t.reinvested) }}</b></div>
            <div class="rc-tip-line"><span>Долг на конец месяца</span><b class="cmc-c-debt">{{ formatCurrency(t.owedEnd ?? 0) }}</b></div>
            <div v-if="t.capitalEnd != null" class="rc-tip-line"><span>Капитал инвесторов</span><b>{{ formatCurrency(t.capitalEnd) }}</b></div>
          </template>
          <template v-if="(t.future || t.current) && t.expectedGross > 0">
            <div v-if="t.current" class="rc-tip-sep" />
            <div class="rc-tip-line"><span>Ещё ожидается прибыли</span><b>{{ formatCurrency(t.expectedGross) }}</b></div>
            <div class="rc-tip-line rc-tip-sub"><span>из неё инвесторам ≈</span><b>{{ formatCurrency(t.expectedInvestors) }}</b></div>
          </template>
          <div v-if="t.future && !(t.expectedGross > 0)" class="rc-tip-line"><span>Платежей по графику нет</span></div>
          <div class="rc-tip-foot">Нажмите, чтобы открыть месяц</div>
        </template>
      </template>
    </template>

    <template #legend>
      <template v-if="mode === 'profit'">
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_INV }" />Инвесторам</span>
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_ME }" />Вам</span>
        <span class="rc-legend-item"><i class="rc-dot" :style="{ background: C_EXP, boxShadow: C_EXP_LINE }" />Ожидается</span>
      </template>
      <span v-else class="rc-legend-item"><i class="rc-dot" :style="{ background: C_DEBT }" />Долг инвесторам на конец месяца</span>
      <span class="rc-legend-item"><v-icon icon="mdi-lock" size="11" /> закрыт</span>
    </template>
  </MonthRibbonChart>
</template>

<style scoped>
.cmc-seg { display: inline-flex; padding: 3px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.07); }
.cmc-seg-btn {
  padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65); transition: background 0.15s, color 0.15s;
}
.cmc-seg-btn--on { background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.92); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.cmc-tip-inv { background: #8b8ff5; }
.cmc-tip-me { background: #2fd3a0; }
.cmc-c-debt { color: #f5b14c !important; }
</style>
