<script setup lang="ts">
import { computed } from 'vue'
import { formatCurrency } from '@/utils/formatters'
import type { ReportsSnapshot } from '@/types/reports'

const props = defineProps<{ data: ReportsSnapshot }>()

/**
 * «Свободно в кассе» может быть отрицательным: партнёр вложил в товар больше
 * собственного капитала (работает с чужими деньгами или в минус по кассе).
 * Это реальное состояние, а не ошибка — но пользователя надо предупредить,
 * иначе минус выглядит как баг.
 */
const isNegative = computed(() => props.data.freeCash < 0)

const rows = computed(() => [
  {
    key: 'free',
    label: 'Свободные деньги',
    hint: isNegative.value
      ? 'в товар вложено больше, чем собственного капитала'
      : 'лежат в кассе, готовы к новым сделкам',
    value: props.data.freeCash,
    color: isNegative.value ? '#ef4444' : '#10b981',
  },
  {
    key: 'goods',
    label: 'В товаре у клиентов',
    hint: 'закупки по активным сделкам за вычетом уже вернувшегося',
    value: props.data.inGoods,
    color: '#3b82f6',
  },
  ...(props.data.owedToCoInvestors > 0
    ? [{
        key: 'owed',
        label: 'Должны со-инвесторам',
        hint: 'начислено им, но ещё не выплачено',
        value: props.data.owedToCoInvestors,
        color: '#8b5cf6',
      }]
    : []),
])
</script>

<template>
  <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
    <div class="rp-block-title">Где деньги сейчас</div>
    <div class="rp-block-sub">Снимок на сегодня — не зависит от выбранного периода</div>

    <div class="mn-rows">
      <div v-for="r in rows" :key="r.key" class="mn-row">
        <div class="mn-left">
          <span class="mn-label">{{ r.label }}</span>
          <span class="mn-hint">{{ r.hint }}</span>
        </div>
        <span class="mn-value" :style="{ color: r.color }">{{ formatCurrency(r.value) }}</span>
      </div>
      <div class="mn-row mn-row--total">
        <div class="mn-left">
          <span class="mn-label">Реально ваше</span>
          <span class="mn-hint">свободные деньги за вычетом долга инвесторам</span>
        </div>
        <span class="mn-value">{{ formatCurrency(data.reallyMine) }}</span>
      </div>
    </div>

    <div v-if="isNegative" class="mn-note">
      <v-icon icon="mdi-information-outline" size="15" />
      Минус означает, что в товар вложено больше собственного капитала —
      деньги вернутся по мере оплат клиентами.
    </div>

    <!-- Разбивка по кассам показывается, только когда касс несколько -->
    <div v-if="data.byCashBox.length > 1" class="mn-boxes">
      <div class="mn-boxes-title">По кассам</div>
      <div v-for="b in data.byCashBox" :key="b.cashBoxId" class="mn-box">
        <div class="mn-box-name">
          <v-icon :icon="b.icon" size="15" :style="{ color: b.color }" />
          {{ b.name }}
        </div>
        <div class="mn-box-nums">
          <span>свободно <b :style="{ color: b.freeCash < 0 ? '#ef4444' : 'inherit' }">{{ formatCurrency(b.freeCash) }}</b></span>
          <span>в товаре <b>{{ formatCurrency(b.inGoods) }}</b></span>
        </div>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.rp-block-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.rp-block-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }

.mn-rows { margin-top: 14px; }
.mn-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 12px 10px;
}
.mn-row + .mn-row { box-shadow: inset 0 1px 0 rgba(var(--v-theme-on-surface), 0.06); }
.mn-row--total {
  box-shadow: inset 0 2px 0 rgba(var(--v-theme-on-surface), 0.14);
  margin-top: 2px;
}
.mn-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mn-label { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.8); }
.mn-row--total .mn-label { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.mn-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.42); line-height: 1.35; }
.mn-value {
  font-size: 20px; font-weight: 800; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.88);
  letter-spacing: -0.01em;
}
.mn-row--total .mn-value { font-size: 22px; }

.mn-note {
  display: flex; align-items: flex-start; gap: 7px;
  margin-top: 12px; padding: 10px 12px;
  border-radius: 9px;
  background: rgba(239, 68, 68, 0.07);
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 12px; line-height: 1.45;
}

.mn-boxes {
  margin-top: 16px; padding-top: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.09);
}
.mn-boxes-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: rgba(var(--v-theme-on-surface), 0.42);
  margin-bottom: 6px;
}
.mn-box {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px; padding: 8px 10px;
}
.mn-box + .mn-box { box-shadow: inset 0 1px 0 rgba(var(--v-theme-on-surface), 0.05); }
.mn-box-name {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.mn-box-nums {
  display: flex; gap: 16px; flex-wrap: wrap;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
}
.mn-box-nums b { color: rgba(var(--v-theme-on-surface), 0.85); font-weight: 700; }

@media (max-width: 600px) {
  .mn-value { font-size: 17px; }
  .mn-row--total .mn-value { font-size: 19px; }
}
</style>
