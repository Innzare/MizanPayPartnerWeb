<script lang="ts" setup>
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePointStore } from '@/stores/point'
import GlobalToast from '@/components/GlobalToast.vue'
import { formatCurrency } from '@/utils/formatters'

/**
 * Кабинет пункта приёма.
 *
 * Отдельный каркас, а не урезанное партнёрское меню: оператор — сотрудник
 * чужого магазина, он не должен видеть даже структуру разделов партнёра.
 * Расчёт на телефон: оператор стоит за прилавком, а не за компьютером.
 */

const auth = useAuthStore()
const point = usePointStore()
const route = useRoute()
const router = useRouter()

const TABS = [
  { to: '/point', icon: 'mdi-cash-plus', label: 'Приём' },
  { to: '/point/cash', icon: 'mdi-safe', label: 'Касса' },
  { to: '/point/history', icon: 'mdi-history', label: 'Операции' },
  { to: '/point/handover', icon: 'mdi-truck-outline', label: 'Передать' },
]

const activePoint = computed(
  () => point.context?.points.find((p) => p.id === point.activePointId) ?? null,
)
const menu = ref(false)

onMounted(() => {
  if (!point.context) point.loadContext()
})

async function logout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <v-app>
    <v-app-bar flat height="64" class="pt-bar">
      <div class="d-flex align-center px-4 w-100 ga-3">
        <div class="flex-grow-1 min-w-0">
          <div class="pt-company text-truncate">{{ point.context?.companyName || 'Пункт приёма' }}</div>
          <!-- Пунктов у оператора обычно один; выбор появляется только когда их больше -->
          <v-menu v-if="(point.context?.points.length ?? 0) > 1" v-model="menu" location="bottom start">
            <template #activator="{ props }">
              <button v-bind="props" class="pt-point-btn text-truncate">
                {{ activePoint?.name || 'Выберите пункт' }}
                <v-icon size="14" icon="mdi-chevron-down" />
              </button>
            </template>
            <v-list density="compact">
              <v-list-item
                v-for="p in point.context?.points"
                :key="p.id"
                :active="p.id === point.activePointId"
                @click="point.setActivePoint(p.id)"
              >
                <v-list-item-title>{{ p.name }}</v-list-item-title>
                <v-list-item-subtitle>{{ formatCurrency(p.balance) }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-menu>
          <div v-else class="pt-point text-truncate">{{ activePoint?.name || '—' }}</div>
        </div>

        <div class="text-right">
          <div class="pt-balance">{{ formatCurrency(activePoint?.balance ?? 0) }}</div>
          <div class="pt-balance-label">в кассе</div>
        </div>

        <v-btn icon="mdi-logout" variant="text" size="small" :title="'Выйти'" @click="logout" />
      </div>
    </v-app-bar>

    <v-main class="pt-main">
      <div class="pt-wrap">
        <router-view />
      </div>
    </v-main>

    <v-bottom-navigation grow height="64" class="pt-nav">
      <v-btn v-for="t in TABS" :key="t.to" :active="route.path === t.to" @click="router.push(t.to)">
        <v-icon :icon="t.icon" />
        <span>{{ t.label }}</span>
      </v-btn>
    </v-bottom-navigation>

    <GlobalToast />
  </v-app>
</template>

<style scoped>
.pt-bar {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.pt-company {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  line-height: 1.2;
}
.pt-point,
.pt-point-btn {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.pt-balance {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}
.pt-balance-label {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.pt-wrap {
  max-width: 640px;
  margin: 0 auto;
  padding: 16px 16px 24px;
}
.pt-nav {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
</style>
