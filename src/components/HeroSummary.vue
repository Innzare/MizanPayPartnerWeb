<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { useSubscription } from '@/composables/useSubscription'
import { useCapital } from '@/composables/useCapital'
import { formatCurrency, formatCurrencyShort, formatPercent } from '@/utils/formatters'
import { useRouter } from 'vue-router'

const props = defineProps<{
  showAnalyticsLink?: boolean
  showLockedOverlay?: boolean
}>()

const emit = defineEmits<{
  (e: 'metric', key: string): void
}>()

const dealsStore = useDealsStore()
const subscription = useSubscription()
const { capital, isCapitalSet } = useCapital()
const router = useRouter()

const canView = computed(() => subscription.canAccess('analytics'))
const received = computed(() => dealsStore.totalRevenue - dealsStore.totalRemaining)
const progress = computed(() => dealsStore.totalRevenue > 0 ? Math.round((received.value / dealsStore.totalRevenue) * 100) : 0)
const progressWidth = computed(() => dealsStore.totalRevenue > 0 ? (received.value / dealsStore.totalRevenue * 100) + '%' : '0%')
</script>

<template>
  <div class="hero-summary" style="position: relative;">
    <!-- Capital badge top-right -->
    <router-link v-if="isCapitalSet && capital && canView" to="/finance" class="hs-capital-badge">
      <v-icon icon="mdi-wallet-outline" size="18" />
      <div class="hs-capital-info">
        <div class="hs-capital-value">{{ formatCurrencyShort(capital.availableCapital) }}</div>
        <div class="hs-capital-label">Доступный капитал</div>
      </div>
      <v-icon icon="mdi-arrow-right" size="16" class="hs-capital-arrow" />
    </router-link>

    <div :style="!canView && showLockedOverlay ? { filter: 'blur(5px)', opacity: 0.7, pointerEvents: 'none', userSelect: 'none' } : {}">
      <div class="hs-main hs-clickable" @click="emit('metric', 'remaining')">
        <div class="hs-label">Общая сводка</div>
        <div class="hs-sublabel">Ожидается к получению</div>
        <div class="hs-amount">{{ canView ? formatCurrency(dealsStore.totalRemaining) : '— ₽' }}</div>
        <div class="hs-sub" @click.stop="emit('metric', 'revenue')">
          из <span class="hs-sub-link">{{ canView ? formatCurrency(dealsStore.totalRevenue) : '— ₽' }}</span> общего оборота
        </div>
      </div>

      <div class="hs-metrics">
        <div class="hs-metric hs-clickable" @click="emit('metric', 'invested')">
          <span class="hs-metric-value">{{ canView ? formatCurrencyShort(dealsStore.totalInvested) : '—' }}</span>
          <span class="hs-metric-label">Инвестировано</span>
        </div>
        <div class="hs-metric-divider" />
        <div class="hs-metric hs-clickable" @click="emit('metric', 'profit')">
          <span class="hs-metric-value">{{ canView ? formatCurrencyShort(dealsStore.totalProfit) : '—' }}</span>
          <span class="hs-metric-label">Прибыль</span>
        </div>
        <div class="hs-metric-divider" />
        <div class="hs-metric hs-clickable" @click="emit('metric', 'monthly')">
          <span class="hs-metric-value">{{ canView ? formatCurrencyShort(dealsStore.monthlyIncome) : '—' }}</span>
          <span class="hs-metric-label">Доход / мес</span>
        </div>
      </div>

      <div class="hs-progress">
        <div class="hs-progress-header">
          <span>Получено {{ canView ? formatCurrencyShort(received) : '—' }}</span>
          <span>{{ canView ? progress : 0 }}%</span>
        </div>
        <div class="hs-progress-bar">
          <div class="hs-progress-fill" :style="{ width: canView ? progressWidth : '0%' }" />
        </div>
      </div>
    </div>

    <!-- Locked overlay -->
    <div v-if="!canView && showLockedOverlay" class="hs-locked-overlay">
      <div class="hs-locked-content">
        <v-icon icon="mdi-crown" size="28" color="#e8b931" class="mb-2" />
        <div class="hs-locked-title">Общая сводка</div>
        <div class="hs-locked-desc">Финансовые показатели вашего портфеля доступны с плана Стандарт</div>
        <button class="hs-locked-btn" @click="router.push('/settings?tab=subscription')">
          Перейти к подпискам
        </button>
      </div>
    </div>

    <!-- Analytics link -->
    <button v-if="showAnalyticsLink && canView" class="hs-analytics-btn" @click="router.push('/analytics')">
      <v-icon icon="mdi-chart-line" size="16" />
      Аналитика
      <v-icon icon="mdi-arrow-right" size="14" />
    </button>
  </div>
</template>

<style scoped>
.hero-summary {
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  border-radius: 16px; padding: 24px 28px; color: #fff;
}

/* Capital badge */
.hs-capital-badge {
  position: absolute; top: 16px; right: 16px; z-index: 3;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; border-radius: 12px;
  background: rgba(255, 255, 255, 0.12); backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff; text-decoration: none;
  transition: all 0.15s;
}
.hs-capital-badge:hover {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.2);
}
.hs-capital-info { display: flex; flex-direction: column; }
.hs-capital-value { font-size: 18px; font-weight: 800; line-height: 1.1; }
.hs-capital-label { font-size: 10px; font-weight: 500; opacity: 0.55; }
.hs-capital-arrow { opacity: 0.4; transition: transform 0.15s; }
.hs-capital-badge:hover .hs-capital-arrow { opacity: 0.8; transform: translateX(3px); }

.hs-main { cursor: default; }
.hs-clickable { cursor: pointer; }

.hs-label {
  font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.65);
  text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;
}
.hs-sublabel {
  font-size: 12px; color: rgba(255, 255, 255, 0.45); margin-bottom: 4px;
}
.hs-amount {
  font-size: 32px; font-weight: 800; letter-spacing: -0.5px;
}
.hs-sub {
  font-size: 13px; color: rgba(255, 255, 255, 0.55); margin-top: 2px;
}
.hs-sub-link {
  color: rgba(255, 255, 255, 0.75); cursor: pointer; text-decoration: underline;
  text-decoration-color: rgba(255, 255, 255, 0.25);
}
.hs-sub-link:hover { color: #fff; }

.hs-metrics {
  display: flex; align-items: center;
  margin-top: 16px; padding: 12px 16px;
  background: rgba(255, 255, 255, 0.08); border-radius: 10px;
}
.hs-metric {
  flex: 1; text-align: center;
}
.hs-metric-value {
  display: block; font-size: 16px; font-weight: 700;
}
.hs-metric-label {
  display: block; font-size: 11px; color: rgba(255, 255, 255, 0.5); margin-top: 2px;
}
.hs-metric-divider {
  width: 1px; height: 28px; background: rgba(255, 255, 255, 0.12);
}

.hs-progress { margin-top: 14px; }
.hs-progress-header {
  display: flex; justify-content: space-between;
  font-size: 12px; color: rgba(255, 255, 255, 0.55); margin-bottom: 6px;
}
.hs-progress-bar {
  height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.12); overflow: hidden;
}
.hs-progress-fill {
  height: 100%; border-radius: 3px;
  background: linear-gradient(90deg, #34d399, #6ee7b7);
  transition: width 0.5s ease;
}

/* Analytics button */
.hs-analytics-btn {
  position: absolute; bottom: 14px; right: 16px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 8px; border: none;
  background: rgba(255, 255, 255, 0.15); color: rgba(255, 255, 255, 0.85);
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all 0.15s; backdrop-filter: blur(4px);
}
.hs-analytics-btn:hover {
  background: rgba(255, 255, 255, 0.25); color: #fff;
}

/* Locked overlay */
.hs-locked-overlay {
  position: absolute; inset: 0; z-index: 2;
  display: flex; align-items: center; justify-content: center;
  border-radius: 16px;
}
.hs-locked-content {
  display: flex; flex-direction: column; align-items: center;
  text-align: center; padding: 20px;
}
.hs-locked-title {
  font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 6px;
}
.hs-locked-desc {
  font-size: 13px; color: rgba(255, 255, 255, 0.7);
  max-width: 320px; line-height: 1.4; margin-bottom: 16px;
}
.hs-locked-btn {
  display: inline-flex; align-items: center; gap: 8px;
  height: 40px; padding: 0 24px; border-radius: 10px;
  border: 1.5px solid rgba(232, 185, 49, 0.5);
  background: rgba(232, 185, 49, 0.15); color: #ffd54f;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.15s; backdrop-filter: blur(4px);
}
.hs-locked-btn:hover {
  background: rgba(232, 185, 49, 0.25); border-color: rgba(232, 185, 49, 0.7);
}

/* Dark mode */
.dark .hero-summary {
  background: linear-gradient(135deg, #047857 0%, #064e3b 50%, #022c22 100%);
}
</style>
