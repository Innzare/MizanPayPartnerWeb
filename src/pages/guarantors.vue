<script setup lang="ts">
/**
 * Старый адрес раздела поручителей.
 *
 * Своего пункта в меню у поручителей больше нет: они показываются вкладкой в
 * «Клиентах» и «Реестре клиентов». Страница оставлена редиректом — ссылки из
 * закладок, писем и старых уведомлений не должны упираться в пустоту.
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
onMounted(() => router.replace('/clients?tab=guarantors'))
</script>

<template>
  <div class="d-flex justify-center align-center" style="min-height: 240px;">
    <v-progress-circular indeterminate color="primary" size="32" />
  </div>
</template>
