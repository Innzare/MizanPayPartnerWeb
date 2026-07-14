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
  <div class="ci-detail" :class="{ dark: isDark }">
    <div class="topbar mb-4">
      <button class="back-btn" @click="router.back()">
        <v-icon icon="mdi-arrow-left" size="18" />
        Назад
      </button>
    </div>

    <CoInvestorCashier :key="id" :id="id" />
  </div>
</template>

<style scoped>
.ci-detail { padding: 8px; }

.topbar { display: flex; align-items: center; gap: 8px; }
.back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px; border: 1px solid #e5e7eb;
  background: #fff; color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.back-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: #d1d5db;
}
.dark .back-btn {
  background: #1e1e2e; border-color: #2e2e42; color: #d4d4d8;
}
</style>
