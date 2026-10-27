<script setup lang="ts">
/**
 * Подразделы «Бухгалтерии»: Баланс · Пункты · Пополнения и расходы ·
 * Временные операции · История · Отчёты · Аудит.
 *
 * Один общий переключатель на все три страницы — чтобы вкладки не разъехались
 * при правке одной из них.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
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
  // Ручные движения денег насовсем: капитал, доходы и расходы.
  // Открыт и тем, кто ведёт доходы, расходы или капитал без доступа ко всей
  // бухгалтерии — раньше они делали это в карточке кассы.
  { path: '/accounting/temporary', title: 'Пополнения и расходы', icon: 'mdi-swap-vertical-circle-outline', permission: 'accounting.view|finance.transactions|finance.capital' },
  // Деньги не насовсем: временные пополнения и снятия, кто кому должен, и
  // деньги без назначения (неизвестный приход, под отчёт). Временные ведутся
  // по праву на капитал, неразобранные — по своему.
  { path: '/accounting/temporary-ops', title: 'Временные операции', icon: 'mdi-handshake-outline', permission: 'accounting.view|finance.capital|accounting.pending.create' },
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

// На телефоне вкладки не помещаются и прокручиваются вбок: открытая не
// должна оставаться за краем.
const bar = ref<HTMLElement | null>(null)
onMounted(async () => {
  await nextTick()
  const el = bar.value?.querySelector<HTMLElement>('.page-tab.active')
  if (bar.value && el && bar.value.scrollWidth > bar.value.clientWidth) {
    const shift = el.getBoundingClientRect().left - bar.value.getBoundingClientRect().left
    bar.value.scrollLeft += shift - (bar.value.clientWidth - el.offsetWidth) / 2
  }
})
</script>

<template>
  <div v-if="tabs.length > 1" ref="bar" class="page-tabs">
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
