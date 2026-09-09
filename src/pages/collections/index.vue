<script setup lang="ts">
/**
 * Старый адрес раздела инкассации.
 *
 * Своего пункта в меню у инкассации больше нет: рейсы показываются секцией на
 * вкладке «Пункты приёма» в «Бухгалтерии» — там же, где видно, сколько денег
 * лежит в каждом пункте. Страница оставлена редиректом: ссылки из закладок и
 * старых уведомлений не должны упираться в пустоту.
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
onMounted(() => router.replace('/accounting/points'))
</script>

<template>
  <div class="d-flex justify-center align-center" style="min-height: 240px;">
    <v-progress-circular indeterminate color="primary" size="32" />
  </div>
</template>
