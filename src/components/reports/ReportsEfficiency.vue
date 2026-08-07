<script setup lang="ts">
import { computed } from 'vue'
import { formatCurrency } from '@/utils/formatters'
import type { ReportsEfficiency } from '@/types/reports'

const props = defineProps<{ data: ReportsEfficiency }>()

/**
 * Показатели эффективности объясняются простыми словами: «оборотов в год» и
 * «доходность» — не самые очевидные понятия для обычного пользователя, поэтому
 * у каждого есть расшифровка на бытовом языке.
 */
const metrics = computed(() => {
  const d = props.data
  return [
    {
      key: 'turnover',
      label: 'Оборотов капитала в год',
      value: d.turnoverAnnualized != null ? `${d.turnoverAnnualized}` : '—',
      hint: d.turnoverAnnualized != null
        ? 'сколько раз за год деньги успевают вернуться и снова уйти в товар'
        : 'пока нечего считать — в товар ничего не вложено',
      accent: true,
    },
    {
      key: 'roi',
      label: 'Доходность вложений',
      value: d.returnOnDeployedPct != null ? `${d.returnOnDeployedPct}% годовых` : '—',
      hint: 'сколько прибыли приносит каждый вложенный рубль за год',
      accent: true,
    },
    {
      key: 'back',
      label: 'Срок возврата рубля',
      value: d.moneyWeightedReturnDays != null ? `${d.moneyWeightedReturnDays} дн.` : '—',
      hint: 'в среднем столько проходит от сделки до прихода денег',
    },
    {
      key: 'life',
      label: 'Срок жизни сделки',
      value: d.avgDealLifetimeDays != null ? `${d.avgDealLifetimeDays} дн.` : '—',
      hint: 'от выдачи до полного закрытия — по завершённым за период',
    },
    {
      key: 'deployed',
      label: 'Средний капитал в работе',
      value: formatCurrency(d.avgDeployed),
      hint: 'столько денег в среднем было вложено в товар',
    },
  ]
})

/** Мини-график капитала в работе по месяцам — нормируем к максимуму. */
const spark = computed(() => {
  const s = props.data.deployedSeries
  const max = Math.max(...s.map((r) => r.deployed), 1)
  return s.map((r) => ({ ...r, pct: Math.round((r.deployed / max) * 100) }))
})
</script>

<template>
  <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
    <div class="rp-block-title">Эффективность</div>
    <div class="rp-block-sub">
      Считается по деньгам, прошедшим за период — по всем сделкам, независимо от даты выдачи
    </div>

    <div class="ef-grid">
      <div
        v-for="m in metrics"
        :key="m.key"
        class="ef-item"
        :class="{ 'ef-item--accent': m.accent }"
      >
        <div class="ef-value">{{ m.value }}</div>
        <div class="ef-label">{{ m.label }}</div>
        <div class="ef-hint">{{ m.hint }}</div>
      </div>
    </div>

    <div v-if="spark.length > 1" class="ef-spark">
      <div class="ef-spark-title">Капитал в работе по месяцам</div>
      <div class="ef-spark-bars">
        <div
          v-for="p in spark"
          :key="p.month"
          class="ef-spark-col"
          :title="`${p.month}: ${formatCurrency(p.deployed)}`"
        >
          <div class="ef-spark-bar" :style="{ height: Math.max(p.pct, 2) + '%' }" />
          <span class="ef-spark-label">{{ p.month.slice(5) }}</span>
        </div>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.rp-block-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.rp-block-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }

.ef-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.ef-item {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.ef-item--accent {
  background: rgba(4, 120, 87, 0.06);
  border-color: rgba(4, 120, 87, 0.18);
}
.ef-value {
  font-size: 22px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.9);
  letter-spacing: -0.01em;
  line-height: 1.15;
}
.ef-item--accent .ef-value { color: #047857; }
.ef-label {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-top: 5px;
}
.ef-hint {
  font-size: 11px; line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.42);
  margin-top: 3px;
}

.ef-spark {
  margin-top: 18px; padding-top: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.09);
}
.ef-spark-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: rgba(var(--v-theme-on-surface), 0.42);
  margin-bottom: 10px;
}
.ef-spark-bars {
  display: flex; align-items: flex-end; gap: 6px;
  height: 90px;
}
.ef-spark-col {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: center;
  height: 100%; justify-content: flex-end;
  cursor: help;
}
.ef-spark-bar {
  width: 100%;
  background: rgba(59, 130, 246, 0.55);
  border-radius: 4px 4px 0 0;
  transition: background 0.15s;
}
.ef-spark-col:hover .ef-spark-bar { background: rgba(59, 130, 246, 0.85); }
.ef-spark-label {
  font-size: 10px; margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

@media (max-width: 600px) {
  .ef-value { font-size: 19px; }
}
</style>
