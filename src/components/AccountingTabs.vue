<script setup lang="ts">
/**
 * Подразделы «Бухгалтерии»: Баланс · Пункты · Временные · История · Отчёты · Аудит.
 *
 * Один общий переключатель на все три страницы — чтобы вкладки не разъехались
 * при правке одной из них.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSections } from '@/composables/useSections'

const route = useRoute()
const auth = useAuthStore()
const sections = useSections()

const TABS = [
  { path: '/accounting/balance', title: 'Баланс', icon: 'mdi-wallet-outline', permission: 'accounting.view' },
  // Инкассация живёт на этой же вкладке, поэтому её видно и по своему праву.
  { path: '/accounting/points', title: 'Пункты приёма', icon: 'mdi-storefront-outline', permission: 'accounting.view|collections.view' },
  // Возвратные деньги: положил своё до зарплаты, дал в долг, взял в долг.
  // Их за месяц набегает много, и партнёр подводит по ним итог отдельно.
  { path: '/accounting/temporary', title: 'Временные', icon: 'mdi-swap-vertical-circle-outline', permission: 'accounting.view' },
  { path: '/accounting/history', title: 'История', icon: 'mdi-timeline-text-outline', permission: 'accounting.view' },
  { path: '/accounting/reports', title: 'Отчёты', icon: 'mdi-file-chart-outline', permission: 'accounting.reports' },
  { path: '/accounting/audit', title: 'Аудит', icon: 'mdi-shield-check-outline', permission: 'accounting.audit' },
]

const tabs = computed(() =>
  TABS.filter((t) => t.permission.split('|').some((key) => auth.can(key)))
    // Владелец мог скрыть пункты приёма: тогда вкладки быть не должно вовсе.
    .filter((t) => t.path !== '/accounting/points' || sections.visible('paymentPoints')),
)
const isActive = (path: string) => route.path === path || route.path.startsWith(path + '/')
</script>

<template>
  <div v-if="tabs.length > 1" class="page-tabs">
    <router-link
      v-for="t in tabs"
      :key="t.path"
      :to="t.path"
      class="page-tab"
      :class="{ active: isActive(t.path) }"
    >
      <v-icon :icon="t.icon" size="16" />
      {{ t.title }}
    </router-link>
  </div>
</template>

<style scoped>
/* Табы раздела — общий стиль, см. styles/page-tabs.css */
</style>
