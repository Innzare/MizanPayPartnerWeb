<script setup lang="ts">
import { formatCurrency } from '@/utils/formatters'

/**
 * Иконка-подсказка с разбором расчёта чистой прибыли: от какой суммы,
 * какая доля прибыли, сколько ушло со-инвесторам и что осталось вам.
 * `share` (0..1) показываем только там, где доля одна на всю строку (одна сделка).
 */
const props = withDefaults(
  defineProps<{
    /** Сумма платежей, от которой считаем */
    amount: number
    /** Вся прибыль (наценка) с этой суммы, до вычета со-инвесторов */
    gross: number
    /** Доля со-инвесторов из этой прибыли */
    coInvestor?: number
    /** Ваша чистая прибыль */
    net: number
    /** Доля прибыли в платеже, 0..1 — только для одной сделки */
    share?: number | null
    /** Прогноз (платежи ещё не оплачены) */
    projected?: boolean
  }>(),
  { coInvestor: 0, share: null, projected: false },
)
</script>

<template>
  <span class="pf">
    <v-icon icon="mdi-information-outline" size="13" />
    <v-tooltip activator="parent" location="top" open-delay="60" max-width="330" content-class="pf-tip">
      <div class="pf-title">{{ props.projected ? 'Как посчитан прогноз' : 'Как посчитана прибыль' }}</div>

      <div class="pf-row">
        <span>{{ props.projected ? 'Осталось получить' : 'Сумма платежей' }}</span>
        <b>{{ formatCurrency(props.amount) }}</b>
      </div>

      <div v-if="props.share != null" class="pf-row">
        <span>Доля прибыли в сделке</span>
        <b>× {{ Math.round(props.share * 100) }}%</b>
      </div>

      <div class="pf-sep" />

      <div class="pf-row">
        <span>Прибыль (наценка)</span>
        <b>{{ formatCurrency(props.gross) }}</b>
      </div>
      <div v-if="props.coInvestor > 0" class="pf-row">
        <span>Со-инвесторам</span>
        <b>− {{ formatCurrency(props.coInvestor) }}</b>
      </div>

      <div class="pf-sep" />

      <div class="pf-row pf-row--total">
        <span>Ваша чистая прибыль</span>
        <b>{{ props.projected ? '~' : '' }}{{ formatCurrency(Math.max(0, props.net)) }}</b>
      </div>

      <div class="pf-note">
        Остальное в платеже — возврат ваших денег, вложенных в товар.
      </div>
    </v-tooltip>
  </span>
</template>

<style scoped>
.pf {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  opacity: 0.55;
  cursor: help;
  vertical-align: middle;
}
.pf:hover { opacity: 1; }
.pf-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.65;
  margin-bottom: 6px;
}
.pf-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  font-size: 12px;
  line-height: 1.7;
}
.pf-row b { font-weight: 700; white-space: nowrap; }
.pf-row--total { font-size: 13px; }
.pf-sep {
  height: 1px;
  background: currentColor;
  opacity: 0.2;
  margin: 5px 0;
}
.pf-note {
  font-size: 11px;
  opacity: 0.6;
  margin-top: 7px;
  line-height: 1.4;
}
</style>
