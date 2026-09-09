<script setup lang="ts">
/**
 * Старый адрес карточки пункта приёма.
 *
 * У пункта было две карточки: своя и «как у счёта» с «Баланса» — разные
 * экраны про одни и те же деньги. Осталась одна, общая для всех счетов
 * (/accounting/accounts/:id), а пунктовые платежи и инкассации живут там
 * вкладками. Этот адрес оставлен редиректом ради старых ссылок.
 */
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
onMounted(() => {
  const id = String((route.params as Record<string, string>).id)
  router.replace(`/accounting/accounts/${id}`)
})
</script>

<template>
  <div class="d-flex justify-center align-center" style="min-height: 240px;">
    <v-progress-circular indeterminate color="primary" size="32" />
  </div>
</template>
