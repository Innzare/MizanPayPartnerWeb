<script setup lang="ts">
import { formatCurrency, formatCurrencyShort } from '@/utils/formatters'

/**
 * Показывает сокращённое число (напр. «45K ₽»), а по наведению —
 * точную полную сумму в тултипе. Визуальная подсказка — пунктирное
 * подчёркивание. Видимый текст можно переопределить слотом (для префиксов
 * вроде «+» / «~»), а `value` всегда задаёт точную сумму для тултипа.
 */
const props = withDefaults(
  defineProps<{
    value: number
    /** Показать пунктирное подчёркивание как подсказку о наведении */
    hint?: boolean
  }>(),
  { hint: true },
)
</script>

<template>
  <span class="exv" :class="{ 'exv--hint': props.hint }">
    <slot>{{ formatCurrencyShort(props.value) }}</slot>
    <v-tooltip activator="parent" location="top" open-delay="60" content-class="exv-tip">
      <span class="exv-tip-label">Точная сумма</span>
      <span class="exv-tip-value">{{ formatCurrency(props.value) }}</span>
    </v-tooltip>
  </span>
</template>

<style scoped>
.exv {
  cursor: help;
  white-space: nowrap;
}
.exv--hint {
  text-decoration: underline dotted currentColor;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  text-decoration-skip-ink: none;
}
.exv-tip-label {
  display: block;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}
.exv-tip-value {
  display: block;
  font-size: 15px;
  font-weight: 700;
}
</style>
