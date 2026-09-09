<script lang="ts" setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import CoInvestorCashier from '@/components/CoInvestorCashier.vue'

// Mobile full-page route for one co-investor. The detail itself lives in the
// shared <CoInvestorCashier> component (reused by the desktop master-detail
// pane on the co-investors list). This page only adds the back navigation.
const route = useRoute()
const router = useRouter()
const { isDark } = useIsDark()

const id = computed(() => (route.params as { id: string }).id)
</script>

<template>
  <div class="at-page ci-detail" :class="{ dark: isDark }">
    <div class="topbar mb-4">
      <button class="back-btn back-btn--inline" @click="router.back()">
        <v-icon icon="mdi-arrow-left" size="18" />
        Назад
      </button>
    </div>

    <CoInvestorCashier :key="id" :id="id" />
  </div>
</template>

<style scoped>
/* Поля страницы — общие для всего сервиса (.at-page). */
.topbar { display: flex; align-items: center; gap: 8px; }
</style>
