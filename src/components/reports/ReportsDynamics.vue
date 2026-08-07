<script setup lang="ts">
import { ref, computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS, BarController, BarElement, LineController, LineElement,
  PointElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import { formatCurrency } from '@/utils/formatters'
import type { ReportsMonthlyRow } from '@/types/reports'

// График смешанный (столбцы + линия). Регистрируем контроллеры явно.
ChartJS.register(
  BarController, BarElement, LineController, LineElement,
  PointElement, CategoryScale, LinearScale, Tooltip, Legend,
)

const props = defineProps<{ monthly: ReportsMonthlyRow[]; isDark: boolean }>()
const monthly = computed(() => props.monthly)

// ── График динамики ──────────────────────────────────────────────────────
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
function monthLabel(m: string) {
  const [y, mm] = m.split('-')
  return `${MONTH_SHORT[Number(mm) - 1]} ${y.slice(2)}`
}

/**
 * Режим графика:
 *   «за месяц»     — сколько вложили и получили в каждом месяце;
 *   «накопительно» — нарастающим итогом: видно, когда вложения окупились.
 */
const chartMode = ref<'monthly' | 'cumulative'>('monthly')

/** Нарастающий итог по массиву значений. */
function runningTotal(values: number[]): number[] {
  let acc = 0
  return values.map((v) => (acc += v))
}

const chartRows = computed(() => {
  const rows = monthly.value
  const invested = rows.map((r) => r.issuedCost)
  const income = rows.map((r) => r.moneyIn)
  const profit = rows.map((r) => Math.max(0, r.netProfit))
  return chartMode.value === 'cumulative'
    ? { invested: runningTotal(invested), income: runningTotal(income), profit: runningTotal(profit) }
    : { invested, income, profit }
})

const chartData = computed(() => ({
  labels: monthly.value.map((r) => monthLabel(r.month)),
  datasets: [
    {
      type: 'bar' as const,
      label: 'Вложено в товар',
      data: chartRows.value.invested,
      backgroundColor: 'rgba(59, 130, 246, 0.65)',
      borderRadius: 5,
      order: 2,
      yAxisID: 'y',
    },
    {
      type: 'bar' as const,
      label: 'Пришло денег',
      data: chartRows.value.income,
      backgroundColor: 'rgba(16, 185, 129, 0.6)',
      borderRadius: 5,
      order: 2,
      yAxisID: 'y',
    },
    {
      // Прибыль на порядок меньше оборота — на общей шкале она была бы
      // невидимой полоской. Выносим на отдельную ось справа и рисуем линией.
      type: 'line' as const,
      label: 'Чистый доход',
      data: chartRows.value.profit,
      borderColor: '#047857',
      backgroundColor: '#047857',
      borderWidth: 2.5,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.3,
      order: 1,
      yAxisID: 'y1',
    },
  ],
}))

const chartOptions = computed(() => {
  const grid = props.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
  const short = (v: number) =>
    Math.abs(v) >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1).replace('.0', '')}M`
      : Math.abs(v) >= 1000
        ? `${Math.round(v / 1000)}K`
        : `${v}`
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { position: 'bottom' as const, labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
      tooltip: {
        callbacks: {
          label: (ctx: any) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
          // Доходность месяца: сколько прибыли на рубль вложений.
          afterBody: (items: any[]) => {
            const i = items[0]?.dataIndex
            if (i == null) return ''
            const inv = chartRows.value.invested[i] || 0
            const pr = chartRows.value.profit[i] || 0
            if (!inv) return ''
            return `\nДоходность: ${Math.round((pr / inv) * 100)}% от вложений`
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: grid },
        title: { display: true, text: 'Оборот', color: 'rgba(120,120,140,0.8)', font: { size: 11 } },
        ticks: { callback: (v: any) => short(Number(v)) },
      },
      y1: {
        beginAtZero: true,
        position: 'right' as const,
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'Чистый доход', color: '#047857', font: { size: 11 } },
        ticks: { color: '#047857', callback: (v: any) => short(Number(v)) },
      },
      x: { grid: { display: false } },
    },
  }
})

const hasMonthlyData = computed(() => monthly.value.some((r) => r.moneyIn > 0 || r.issuedCost > 0))
</script>

<template>
  <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
    <div class="d-flex align-start justify-space-between flex-wrap ga-3">
      <div>
        <div class="rp-block-title">Динамика</div>
        <div class="rp-block-sub">
          {{ chartMode === 'monthly'
            ? 'Сколько вкладывали и получали в каждом месяце'
            : 'Нарастающим итогом — видно, когда вложения окупились' }}
        </div>
      </div>
      <div class="rp-seg">
        <button class="rp-seg-btn" :class="{ 'rp-seg-btn--active': chartMode === 'monthly' }"
          type="button" @click="chartMode = 'monthly'">За месяц</button>
        <button class="rp-seg-btn" :class="{ 'rp-seg-btn--active': chartMode === 'cumulative' }"
          type="button" @click="chartMode = 'cumulative'">Накопительно</button>
      </div>
    </div>
    <div v-if="hasMonthlyData" style="height: 320px;" class="mt-4">
      <Bar :data="chartData" :options="chartOptions" />
    </div>
    <div v-else class="rp-empty">За выбранный период движений не было</div>
  </v-card>
</template>

<style scoped>
.rp-block-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.rp-block-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }
.rp-empty { padding: 40px 0; text-align: center; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.4); }
.rp-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.05); }
.rp-seg-btn {
  padding: 6px 13px; border: none; border-radius: 8px; background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.rp-seg-btn--active {
  background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.07);
}
</style>
