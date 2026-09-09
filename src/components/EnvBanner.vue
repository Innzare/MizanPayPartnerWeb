<script setup lang="ts">
/**
 * Полоса «тестовый контур».
 *
 * Тестовая копия кабинета выглядит точно так же, как боевая, и живёт в
 * соседней вкладке. Через полчаса проверок вкладки путаются — и тестовая
 * сделка на пять миллионов оказывается в настоящей базе, а несуществующий
 * баг ищут в тестовых данных.
 *
 * Полоса появляется только когда сборка помечена как тестовая
 * (`VITE_APP_ENV=staging`). На проде переменной нет — и компонент не рисует
 * вообще ничего.
 */
import { computed } from 'vue'

const env = computed(() => (import.meta.env.VITE_APP_ENV || 'production').trim())
const isStaging = computed(() => env.value !== 'production')
</script>

<template>
  <div v-if="isStaging" class="env-banner">
    <v-icon icon="mdi-flask-outline" size="15" />
    <span>
      <b>Тестовый контур</b> — данные ненастоящие, сообщения клиентам не уходят
    </span>
  </div>
</template>

<style scoped>
/* Жёлтая полоса поверх всего: её задача — попадаться на глаза, а не
   вписываться в интерфейс. */
.env-banner {
  position: sticky;
  top: 0;
  z-index: 2600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 26px;
  background: #facc15;
  color: #422006;
  font-size: 12.5px;
  letter-spacing: 0.01em;
}
.env-banner b { font-weight: 700; }
</style>
