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
    <div class="settings-tabs">
      <button class="settings-tab" :class="{ active: tab === 'partners' }" @click="tab = 'partners'">
        <v-icon icon="mdi-handshake-outline" size="18" />
        <span>Партнёры</span>
      </button>
      <button v-if="canRequests" class="settings-tab" :class="{ active: tab === 'requests' }" @click="tab = 'requests'">
        <v-icon icon="mdi-clipboard-text-outline" size="18" />
        <span>Заявки</span>
        <span v-if="store.requestsNewCount" class="sup-tabcount" :class="{ 'sup-tabcount--on': tab === 'requests' }">{{ store.requestsNewCount }}</span>
      </button>
      <button v-if="canRouteSheets" class="settings-tab" :class="{ active: tab === 'routesheets' }" @click="tab = 'routesheets'">
        <v-icon icon="mdi-clipboard-list-outline" size="18" />
        <span>Путевые листы</span>
      </button>
      <button class="settings-tab" :class="{ active: tab === 'activity' }" @click="tab = 'activity'">
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

.settings-tabs {
  display: flex; gap: 4px; margin-bottom: 24px;
  padding: 4px; border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.settings-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 18px; border-radius: 8px; border: none;
  background: transparent;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
}
.settings-tab:hover { color: rgba(var(--v-theme-on-surface), 0.7); background: rgba(var(--v-theme-on-surface), 0.04); }
.settings-tab.active:hover { background: #047857; color: #fff; }
.settings-tab.active {
  background: #047857; color: #fff; font-weight: 600;
  box-shadow: 0 2px 6px rgba(4, 120, 87, 0.25);
}
.sup-page.dark .settings-tabs { background: rgb(var(--v-theme-surface-deep)); border-color: rgb(var(--v-theme-border)); box-shadow: none; }
.sup-tabcount {
  font-size: 11px; font-weight: 700; padding: 0 6px; border-radius: 10px;
  background: #fff; color: #047857; line-height: 18px; min-width: 20px; text-align: center;
  border: 1px solid rgba(4, 120, 87, 0.2);
}
.settings-tab.active .sup-tabcount { border-color: transparent; }
@media (max-width: 600px) {
  .settings-tabs { overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .settings-tabs::-webkit-scrollbar { display: none; }
}
</style>
