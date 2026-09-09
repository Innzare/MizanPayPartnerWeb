<script setup lang="ts">
/**
 * Значок счёта: логотип банка, а при его отсутствии — прежняя буквенная плашка.
 *
 * Один компонент на все списки счетов, чтобы карточка, таблица и окно оплаты
 * показывали счёт одинаково: если где-то останется старый вид, партнёр решит,
 * что перед ним другой счёт.
 */
import { computed } from 'vue'
import { bankLogo } from '@/constants/bankLogos'

const props = withDefaults(
  defineProps<{
    /** Название банка из справочника. Пусто — банка нет (касса, пункт приёма). */
    bankName?: string | null
    /** Фирменный цвет банка — фон буквенной плашки. */
    color?: string | null
    /** Что писать на плашке без логотипа: код счёта или короткое имя банка. */
    fallback?: string | null
    size?: number
  }>(),
  { size: 40 },
)

const logo = computed(() => bankLogo(props.bankName))
const accent = computed(() => props.color || '#047857')
</script>

<template>
  <!-- Логотипы приходят квадратными и с собственным фоном, поэтому им нужна
       только скруглённая рамка — подкрашивать их фирменным цветом нельзя. -->
  <img
    v-if="logo"
    :src="logo"
    :alt="bankName || ''"
    class="bank-logo"
    :style="{ width: size + 'px', height: size + 'px' }"
  />
  <div
    v-else
    class="bank-logo bank-logo--letters"
    :style="{
      width: size + 'px',
      height: size + 'px',
      background: accent + '18',
      color: accent,
      fontSize: Math.round(size * 0.34) + 'px',
    }"
  >
    {{ fallback || (bankName || '').slice(0, 2) }}
  </div>
</template>

<style scoped>
.bank-logo {
  flex: none;
  border-radius: 10px;
  object-fit: contain;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.bank-logo--letters {
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  border: none;
  background-clip: padding-box;
}
</style>
