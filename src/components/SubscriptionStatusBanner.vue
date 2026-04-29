<template>
  <div v-if="banner" class="subscription-banner" :class="`subscription-banner--${banner.severity}`">
    <div class="subscription-banner__icon">
      <v-icon :icon="banner.icon" size="20" />
    </div>
    <div class="subscription-banner__content">
      <div class="subscription-banner__title">{{ banner.title }}</div>
      <div class="subscription-banner__message">{{ banner.message }}</div>
    </div>
    <button
      v-if="banner.actionLabel && authStore.isOwner"
      class="subscription-banner__action"
      @click="goToSubscription"
    >
      {{ banner.actionLabel }}
    </button>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const router = useRouter()

type BannerSeverity = 'critical' | 'warning' | 'info'
interface BannerData {
  severity: BannerSeverity
  icon: string
  title: string
  message: string
  actionLabel?: string
}

// Banner priority (highest first):
// 1. Staff blocked (partner has no `staff` feature) — staff sees this
// 2. Owner overflow (active deals > FREE limit after expiry) — read-only freeze
// 3. Owner expired (plan downgraded to FREE) — generic expiry
// 4. Owner expiring soon (<= 7 days) — proactive nudge
const banner = computed<BannerData | null>(() => {
  const user = authStore.user
  if (!user) return null

  // Staff with FREE-plan partner: SubscriptionFeatureGuard blocks any mutation.
  // Show a permanent banner so they understand why actions fail.
  if (user.staffId && user.planFeatures?.staff === false) {
    return {
      severity: 'critical',
      icon: 'mdi-lock-alert-outline',
      title: 'Подписка партнёра не активна',
      message:
        'Доступ только на чтение. Обратитесь к владельцу аккаунта для продления подписки.',
    }
  }

  if (user.staffId) return null

  // Owner: detect "overflow" — active deals exceed current plan's limit.
  // Most realistic case: was PREMIUM with 200 deals, plan expired to FREE (3 limit).
  const limit = user.planLimits?.maxActiveDeals ?? -1
  const active = user.activeDeals ?? 0
  const isOverflow = limit > 0 && active > limit && user.subscriptionPlan === 'FREE'
  if (isOverflow) {
    return {
      severity: 'critical',
      icon: 'mdi-alert-circle-outline',
      title: 'Подписка истекла',
      message:
        `Активных сделок: ${active}/${limit}. Существующие сделки можно вести как обычно, но создавать новые нельзя — продлите подписку.`,
      actionLabel: 'Продлить',
    }
  }

  // Owner with FREE but no overflow — they're below limit, nothing critical
  if (user.subscriptionPlan === 'FREE') return null

  // Days until expiry
  const days = user.daysUntilExpiry
  if (days === null || days === undefined) return null

  if (days <= 0) {
    // Edge case: paid plan but expiry already past. Cron normally downgrades
    // hourly; this banner appears in the gap.
    return {
      severity: 'critical',
      icon: 'mdi-alert-circle-outline',
      title: 'Подписка истекла',
      message: 'Доступ к платным функциям ограничен. Продлите подписку, чтобы продолжить работу.',
      actionLabel: 'Продлить',
    }
  }

  if (days <= 1) {
    return {
      severity: 'warning',
      icon: 'mdi-clock-alert-outline',
      title: 'Подписка истекает завтра',
      message: 'Продлите подписку, чтобы не потерять доступ к платным функциям.',
      actionLabel: 'Продлить',
    }
  }

  if (days <= 7) {
    return {
      severity: 'info',
      icon: 'mdi-clock-outline',
      title: `Подписка истекает через ${days} ${pluralizeDays(days)}`,
      message: 'Продлите заранее, чтобы избежать перерывов в работе.',
      actionLabel: 'Продлить',
    }
  }

  return null
})

function pluralizeDays(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня'
  return 'дней'
}

function goToSubscription() {
  router.push({ path: '/settings', query: { tab: 'subscription' } })
}
</script>

<style lang="scss" scoped>
.subscription-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  margin-bottom: 16px;
  border: 1px solid transparent;

  &--critical {
    background: rgba(244, 67, 54, 0.08);
    border-color: rgba(244, 67, 54, 0.24);
    color: #c62828;

    .subscription-banner__action {
      background: #c62828;
      color: #fff;
    }
  }

  &--warning {
    background: rgba(255, 152, 0, 0.08);
    border-color: rgba(255, 152, 0, 0.24);
    color: #e65100;

    .subscription-banner__action {
      background: #e65100;
      color: #fff;
    }
  }

  &--info {
    background: rgba(33, 150, 243, 0.06);
    border-color: rgba(33, 150, 243, 0.2);
    color: #1565c0;

    .subscription-banner__action {
      background: #1565c0;
      color: #fff;
    }
  }

  &__icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.6);
  }

  &__content {
    flex: 1;
    min-width: 0;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    margin-bottom: 2px;
  }

  &__message {
    font-size: 13px;
    font-weight: 400;
    line-height: 1.4;
    opacity: 0.9;
  }

  &__action {
    flex-shrink: 0;
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;

    &:hover {
      opacity: 0.9;
    }
  }
}
</style>
