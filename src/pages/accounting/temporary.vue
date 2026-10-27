<script setup lang="ts">
/**
 * Бухгалтерия → Пополнения и расходы: деньги пришли или ушли насовсем —
 * капитал, прибыль, доход и расход по бизнесу.
 *
 * Адрес прежний (/accounting/temporary): на него ведут карточка кассы и
 * закладки партнёров. Временные операции — на своей вкладке
 * (/accounting/temporary-ops), лента у вкладок общая — MoneyFlowsLedger.
 */
import MoneyFlowsLedger from '@/components/MoneyFlowsLedger.vue'
</script>

<template>
  <MoneyFlowsLedger mode="main" />
</template>
