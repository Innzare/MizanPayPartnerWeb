<template>
  <v-card variant="outlined" class="text-center pa-8" rounded="xl">
    <v-icon icon="mdi-lock-outline" size="48" color="grey" class="mb-4" />
    <div class="text-h6 mb-2">{{ title || 'Функция недоступна' }}</div>
    <div class="text-body-2 text-medium-emphasis mb-6">
      {{ message || `Доступно с плана ${requiredPlanLabel}` }}
    </div>
    <v-btn
      color="primary"
      variant="flat"
      rounded="lg"
      @click="goToSubscription"
    >
      Перейти на план
    </v-btn>
  </v-card>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const props = defineProps<{
  title?: string
  message?: string
  requiredPlan?: string
}>()

const PLAN_NAMES: Record<string, string> = {
  PRO: 'Стандарт',
  BUSINESS: 'Бизнес',
  PREMIUM: 'Премиум',
}

const requiredPlanLabel = props.requiredPlan ? PLAN_NAMES[props.requiredPlan] || props.requiredPlan : 'Стандарт'

const router = useRouter()

function goToSubscription() {
  router.push({ path: '/settings', query: { tab: 'subscription' } })
}
</script>
