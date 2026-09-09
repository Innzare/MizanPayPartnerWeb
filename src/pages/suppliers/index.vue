<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSuppliersStore } from '@/stores/suppliers'
import { useAuthStore } from '@/stores/auth'
import { useIsDark } from '@/composables/useIsDark'
import SuppliersListPanel from '@/components/suppliers/SuppliersListPanel.vue'
import SupplierRequestsPanel from '@/components/suppliers/SupplierRequestsPanel.vue'
import RouteSheetsPanel from '@/components/suppliers/RouteSheetsPanel.vue'
import SupplierActivityPanel from '@/components/suppliers/SupplierActivityPanel.vue'

const store = useSuppliersStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { isDark } = useIsDark()

const canRequests = computed(() => auth.can('suppliers.requests'))
const canRouteSheets = computed(() => auth.can('suppliers.routesheet'))

type Tab = 'partners' | 'requests' | 'routesheets' | 'activity'
function normalizeTab(v: unknown): Tab {
  if (v === 'requests' && canRequests.value) return 'requests'
  if ((v === 'routesheets' || v === 'route-sheets') && canRouteSheets.value) return 'routesheets'
  if (v === 'activity') return 'activity'
  return 'partners'
}
const tab = ref<Tab>(normalizeTab(route.query.tab))

watch(tab, (t) => {
  const q = t === 'partners' ? undefined : t
  if (route.query.tab !== q) router.replace({ query: { ...route.query, tab: q } })
})

onMounted(() => {
  if (canRequests.value) store.fetchRequestsCount()
})
</script>

<template>
  <div class="at-page sup-page" :class="{ dark: isDark }">
    <div class="page-tabs">
      <button class="page-tab" :class="{ active: tab === 'partners' }" @click="tab = 'partners'">
        <v-icon icon="mdi-handshake-outline" size="18" />
        <span>Партнёры</span>
      </button>
      <button v-if="canRequests" class="page-tab" :class="{ active: tab === 'requests' }" @click="tab = 'requests'">
        <v-icon icon="mdi-clipboard-text-outline" size="18" />
        <span>Заявки</span>
        <span v-if="store.requestsNewCount" class="page-tab-count">{{ store.requestsNewCount }}</span>
      </button>
      <button v-if="canRouteSheets" class="page-tab" :class="{ active: tab === 'routesheets' }" @click="tab = 'routesheets'">
        <v-icon icon="mdi-clipboard-list-outline" size="18" />
        <span>Путевые листы</span>
      </button>
      <button class="page-tab" :class="{ active: tab === 'activity' }" @click="tab = 'activity'">
        <v-icon icon="mdi-history" size="18" />
        <span>История операций</span>
      </button>
    </div>

    <SuppliersListPanel v-show="tab === 'partners'" />
    <SupplierRequestsPanel v-if="canRequests && tab === 'requests'" />
    <RouteSheetsPanel v-if="canRouteSheets && tab === 'routesheets'" />
    <SupplierActivityPanel v-if="tab === 'activity'" />
  </div>
</template>

<style scoped>
.sup-page { padding-bottom: 72px; }

/* Табы раздела — общий стиль, см. styles/page-tabs.css */
</style>
