<script setup lang="ts">
/**
 * «Бухгалтерия» без подраздела — открываем «Баланс»: это стартовый экран
 * раздела, всё остальное строится вокруг него.
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
onMounted(() => router.replace('/accounting/balance'))
</script>

<template>
  <div class="d-flex justify-center align-center" style="min-height: 300px;">
    <v-progress-circular indeterminate color="primary" />
  </div>
</template>
