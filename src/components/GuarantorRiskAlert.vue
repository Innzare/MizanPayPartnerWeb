<script setup lang="ts">
/**
 * Предупреждение о перегруженном поручителе.
 *
 * Показывается в момент выбора — после подписания договора знать, что человек
 * уже отвечает за четыре чужих рассрочки, поздно. Это именно предупреждение:
 * решение остаётся за партнёром, кнопок «нельзя» здесь нет.
 */
import { formatCurrency } from '@/utils/formatters'

export interface GuarantorBrief {
  guaranteeCount: number
  activeCount: number
  guaranteeRemaining: number
  overdueAmount: number
  overdueDealCount: number
  ownDebt: number
  ownOverdue: boolean
  totalExposure: number
  blacklisted: boolean
  warnings: Array<{ code: string; text: string }>
}

const props = defineProps<{ brief: GuarantorBrief | null; loading?: boolean }>()

/** В чёрном списке — это уже не «обратите внимание», а красный сигнал. */
const severe = computed(
  () => !!props.brief?.blacklisted || !!props.brief?.warnings.some((w) => w.code === 'blacklist'),
)
</script>

<template>
  <div v-if="loading" class="gr-alert gr-alert--muted">
    <v-progress-circular indeterminate size="14" width="2" />
    Проверяем поручителя…
  </div>

  <div v-else-if="brief && brief.warnings.length" class="gr-alert" :class="{ 'gr-alert--severe': severe }">
    <v-icon :icon="severe ? 'mdi-alert-octagon-outline' : 'mdi-alert-outline'" size="16" class="gr-alert__icon" />
    <div class="gr-alert__body">
      <div v-for="w in brief.warnings" :key="w.code" class="gr-alert__line">{{ w.text }}</div>
      <div class="gr-alert__foot">
        Общая ответственность с учётом собственного долга — {{ formatCurrency(brief.totalExposure) }}
      </div>
    </div>
  </div>

  <!-- Человек уже поручался, но в пределах ваших порогов: не тревожим, просто
       показываем, чтобы решение принималось со знанием дела. -->
  <div v-else-if="brief && brief.guaranteeCount > 0" class="gr-alert gr-alert--muted">
    <v-icon icon="mdi-information-outline" size="15" class="gr-alert__icon" />
    <div class="gr-alert__body">
      Поручитель по {{ brief.guaranteeCount }} сделк{{ brief.guaranteeCount === 1 ? 'е' : 'ам' }}, из них
      действующих {{ brief.activeCount }} на {{ formatCurrency(brief.guaranteeRemaining) }}
    </div>
  </div>
</template>

<style scoped>
.gr-alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 6px 0 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(245, 158, 11, 0.45);
  background: rgba(245, 158, 11, 0.07);
  font-size: 13px;
  line-height: 1.45;
  color: #92400e;
}
.gr-alert--severe {
  border-color: rgba(220, 38, 38, 0.45);
  background: rgba(220, 38, 38, 0.06);
  color: #991b1b;
}
.gr-alert--muted {
  border-color: rgba(var(--v-theme-on-surface), 0.14);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.gr-alert__icon {
  margin-top: 1px;
  flex-shrink: 0;
}
.gr-alert__line + .gr-alert__line {
  margin-top: 2px;
}
.gr-alert__foot {
  margin-top: 4px;
  opacity: 0.8;
  font-size: 12px;
}
</style>
