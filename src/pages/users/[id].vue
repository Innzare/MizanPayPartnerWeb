<script lang="ts" setup>
import { api } from '@/api/client'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { type Deal } from '@/types'
import { useRoute, useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const router = useRouter()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()

const userId = computed(() => (route.params as { id: string }).id)

interface PublicProfile {
  id: string
  phone: string | null
  firstName: string
  lastName: string
  city: string
  avatar: string | null
  rating: number
  completedDeals: number
  activeDeals: number
  verificationLevel: string
  subscriptionPlan?: string
  userType: 'USER' | 'INVESTOR'
  createdAt: string
}

function cleanPhone(phone: string) {
  return phone.replace(/\D/g, '')
}

const profile = ref<PublicProfile | null>(null)
const pageLoading = ref(true)

onMounted(async () => {
  try {
    const [profileData] = await Promise.all([
      api.get<PublicProfile>(`/auth/users/${userId.value}/public-profile`),
      dealsStore.fetchDeals(),
      paymentsStore.fetchPayments(),
    ])
    profile.value = profileData
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки профиля')
  } finally {
    pageLoading.value = false
  }
})

const fullName = computed(() =>
  profile.value ? `${profile.value.firstName} ${profile.value.lastName}` : ''
)

const initials = computed(() =>
  profile.value ? `${profile.value.firstName[0] || ''}${profile.value.lastName[0] || ''}` : ''
)

const verificationLabels: Record<string, string> = {
  NONE: 'Новый',
  BASIC: 'Базовый',
  VERIFIED: 'Проверенный',
  FULL: 'VIP',
}

const clientDeals = computed(() =>
  dealsStore.investorDeals.filter(d => d.clientId === userId.value)
)

const stats = computed(() => {
  const deals = clientDeals.value
  const totalVolume = deals.reduce((s, d) => s + d.totalPrice, 0)
  const totalProfit = deals.reduce((s, d) => s + d.markup, 0)
  const remaining = deals.filter(d => d.status === 'ACTIVE').reduce((s, d) => s + d.remainingAmount, 0)

  // On-time rate
  const allPayments = deals.flatMap(d => paymentsStore.getPaymentsForDeal(d.id))
  const paid = allPayments.filter(p => p.status === 'PAID')
  const onTime = paid.filter(p => p.paidAt && new Date(p.paidAt) <= new Date(p.dueDate)).length
  const onTimeRate = paid.length > 0 ? Math.round((onTime / paid.length) * 100) : 100

  return { totalVolume, totalProfit, remaining, onTimeRate, dealCount: deals.length }
})

function getDealProgress(deal: Deal) {
  return deal.numberOfPayments > 0 ? (deal.paidPayments / deal.numberOfPayments) * 100 : 0
}

function getScoreColor(rate: number) {
  if (rate >= 90) return '#047857'
  if (rate >= 70) return '#f59e0b'
  return '#ef4444'
}

const AVATAR_COLORS = ['#047857', '#3b82f6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ef4444']
function getAvatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else-if="profile">
      <!-- Back button -->
      <div class="mb-4">
        <v-btn variant="text" prepend-icon="mdi-arrow-left" @click="router.back()">
          Назад
        </v-btn>
      </div>

      <v-row>
        <!-- Left: Profile card -->
        <v-col cols="12" lg="4">
          <v-card rounded="lg" elevation="0" border class="pa-6 text-center">
            <div
              class="profile-avatar mx-auto mb-4"
              :style="{ background: getAvatarColor(profile.firstName) }"
            >
              {{ initials }}
              <div v-if="profile.verificationLevel === 'VERIFIED' || profile.verificationLevel === 'FULL'" class="profile-verified">
                <v-icon icon="mdi-check-bold" size="12" color="white" />
              </div>
            </div>

            <div class="text-h6 font-weight-bold mb-1">{{ fullName }}</div>

            <div class="d-flex align-center justify-center ga-1 mb-3">
              <v-icon icon="mdi-star" size="16" color="amber" />
              <span class="text-body-2 font-weight-bold">{{ profile.rating.toFixed(1) }}</span>
            </div>

            <v-chip
              size="small"
              :color="profile.userType === 'INVESTOR' ? 'primary' : 'secondary'"
              variant="tonal"
              class="mb-4"
            >
              <v-icon start :icon="profile.userType === 'INVESTOR' ? 'mdi-wallet-outline' : 'mdi-account-outline'" size="14" />
              {{ profile.userType === 'INVESTOR' ? 'Инвестор' : 'Клиент' }}
            </v-chip>

            <!-- Contact buttons -->
            <div v-if="profile.phone" class="d-flex ga-2 mb-4" style="width: 100%;">
              <a
                :href="`https://wa.me/${cleanPhone(profile.phone)}`"
                target="_blank"
                class="contact-btn contact-btn--wa"
              >
                <v-icon icon="mdi-whatsapp" size="18" />
                WhatsApp
              </a>
              <a
                :href="`https://t.me/${cleanPhone(profile.phone)}`"
                target="_blank"
                class="contact-btn contact-btn--tg"
              >
                <v-icon icon="mdi-send" size="18" />
                Telegram
              </a>
            </div>

            <v-divider class="mb-4" />

            <!-- Info rows -->
            <div class="profile-info-list">
              <div class="profile-info-row">
                <v-icon icon="mdi-map-marker-outline" size="18" class="text-medium-emphasis" />
                <span class="text-body-2 text-medium-emphasis">Город</span>
                <span class="text-body-2 font-weight-medium ml-auto">{{ profile.city || 'Не указан' }}</span>
              </div>
              <div class="profile-info-row">
                <v-icon icon="mdi-shield-check-outline" size="18" class="text-medium-emphasis" />
                <span class="text-body-2 text-medium-emphasis">Верификация</span>
                <span class="text-body-2 font-weight-medium ml-auto">{{ verificationLabels[profile.verificationLevel] || 'Новый' }}</span>
              </div>
              <div class="profile-info-row">
                <v-icon icon="mdi-calendar-outline" size="18" class="text-medium-emphasis" />
                <span class="text-body-2 text-medium-emphasis">На платформе с</span>
                <span class="text-body-2 font-weight-medium ml-auto">{{ formatDate(profile.createdAt) }}</span>
              </div>
              <div v-if="profile.subscriptionPlan && profile.userType === 'INVESTOR'" class="profile-info-row">
                <v-icon icon="mdi-diamond-outline" size="18" class="text-medium-emphasis" />
                <span class="text-body-2 text-medium-emphasis">Подписка</span>
                <span class="text-body-2 font-weight-medium ml-auto">{{ profile.subscriptionPlan }}</span>
              </div>
            </div>
          </v-card>
        </v-col>

        <!-- Right: Stats + Deals -->
        <v-col cols="12" lg="8">
          <!-- Stats -->
          <div class="stats-row mb-6">
            <div class="stat-card">
              <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
                <v-icon icon="mdi-check-decagram" size="20" />
              </div>
              <div>
                <div class="stat-value">{{ profile.completedDeals }}</div>
                <div class="stat-label">Завершено сделок</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
                <v-icon icon="mdi-flash-outline" size="20" />
              </div>
              <div>
                <div class="stat-value">{{ profile.activeDeals }}</div>
                <div class="stat-label">Активных сделок</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
                <v-icon icon="mdi-star-outline" size="20" />
              </div>
              <div>
                <div class="stat-value">{{ profile.rating.toFixed(1) }}</div>
                <div class="stat-label">Рейтинг</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" :style="{ background: getScoreColor(stats.onTimeRate) + '1a', color: getScoreColor(stats.onTimeRate) }">
                <v-icon icon="mdi-heart-pulse" size="20" />
              </div>
              <div>
                <div class="stat-value">{{ stats.onTimeRate }}%</div>
                <div class="stat-label">Своевременность</div>
              </div>
            </div>
          </div>

          <!-- Financial overview (only if has deals with this investor) -->
          <v-card v-if="stats.dealCount > 0" rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="text-subtitle-2 font-weight-bold mb-4">Финансовый обзор</div>
            <div class="finance-grid">
              <div class="finance-item">
                <div class="finance-label">Общий объём</div>
                <div class="finance-value">{{ formatCurrency(stats.totalVolume) }}</div>
              </div>
              <div class="finance-item">
                <div class="finance-label">Прибыль</div>
                <div class="finance-value" style="color: #047857;">{{ formatCurrency(stats.totalProfit) }}</div>
              </div>
              <div class="finance-item">
                <div class="finance-label">Остаток</div>
                <div class="finance-value" style="color: #f59e0b;">{{ formatCurrency(stats.remaining) }}</div>
              </div>
              <div class="finance-item">
                <div class="finance-label">Сделок вместе</div>
                <div class="finance-value">{{ stats.dealCount }}</div>
              </div>
            </div>
          </v-card>

          <!-- Deals list -->
          <v-card v-if="clientDeals.length" rounded="lg" elevation="0" border class="pa-5">
            <div class="text-subtitle-2 font-weight-bold mb-4">Сделки</div>
            <div class="deals-list">
              <div
                v-for="deal in clientDeals"
                :key="deal.id"
                class="deal-row"
                @click="router.push(`/deals/${deal.id}`)"
              >
                <v-avatar size="44" rounded="lg" class="mr-3">
                  <v-img :src="deal.productPhotos?.[0]" cover />
                </v-avatar>
                <div class="deal-main">
                  <div class="deal-name">{{ deal.productName }}</div>
                  <div class="deal-meta">{{ formatCurrency(deal.totalPrice) }} · {{ deal.paidPayments }}/{{ deal.numberOfPayments }} платежей</div>
                </div>
                <div
                  class="deal-status"
                  :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])"
                >
                  {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                </div>
                <v-progress-linear
                  :model-value="getDealProgress(deal)"
                  color="primary"
                  rounded
                  height="4"
                  style="width: 60px;"
                  class="ml-3 d-none d-md-flex"
                />
                <v-icon icon="mdi-chevron-right" size="18" class="ml-2 text-medium-emphasis" />
              </div>
            </div>
          </v-card>

          <!-- No deals -->
          <v-card v-else rounded="lg" elevation="0" border class="pa-8 text-center">
            <v-icon icon="mdi-handshake-outline" size="48" class="text-medium-emphasis mb-3" />
            <div class="text-body-1 font-weight-medium text-medium-emphasis">Нет совместных сделок</div>
          </v-card>
        </v-col>
      </v-row>
    </template>

    <!-- Not found -->
    <div v-else class="text-center pa-12">
      <v-icon icon="mdi-account-off-outline" size="56" color="grey-lighten-1" class="mb-3" />
      <p class="text-body-1 font-weight-medium text-medium-emphasis">Пользователь не найден</p>
    </div>
  </div>
</template>

<style scoped>
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .stats-row { grid-template-columns: 1fr; } }

.stat-card {
  display: flex; align-items: center; gap: 12px;
  padding: 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.stat-icon {
  width: 40px; height: 40px; min-width: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.stat-value {
  font-size: 18px; font-weight: 700; line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.stat-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Profile avatar */
.profile-avatar {
  width: 80px; height: 80px; border-radius: 20px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 28px; font-weight: 700;
  position: relative;
}
.profile-verified {
  position: absolute; bottom: -4px; right: -4px;
  width: 24px; height: 24px; border-radius: 50%;
  background: #047857;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid rgba(var(--v-theme-surface), 1);
}

/* Info list */
.profile-info-list {
  display: flex; flex-direction: column; gap: 4px;
}
.profile-info-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.profile-info-row:last-child { border-bottom: none; }

/* Finance grid */
.finance-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
}
@media (max-width: 768px) { .finance-grid { grid-template-columns: repeat(2, 1fr); } }

.finance-item {
  padding: 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.finance-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 4px;
}
.finance-value {
  font-size: 16px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Deals list */
.deals-list {
  display: flex; flex-direction: column; gap: 4px;
}
.deal-row {
  display: flex; align-items: center;
  padding: 12px 14px; border-radius: 10px;
  cursor: pointer; transition: background 0.15s;
}
.deal-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.deal-main { flex: 1; min-width: 0; }
.deal-name {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.deal-meta {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px;
}
.deal-status {
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px;
  white-space: nowrap; flex-shrink: 0;
}

/* Contact buttons */
.contact-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px; border-radius: 10px;
  font-size: 13px; font-weight: 600;
  text-decoration: none;
  transition: all 0.15s;
}
.contact-btn--wa {
  background: rgba(37, 211, 102, 0.08);
  color: #25D366;
  border: 1px solid rgba(37, 211, 102, 0.2);
}
.contact-btn--wa:hover {
  background: rgba(37, 211, 102, 0.15);
}
.contact-btn--tg {
  background: rgba(34, 158, 217, 0.08);
  color: #229ED9;
  border: 1px solid rgba(34, 158, 217, 0.2);
}
.contact-btn--tg:hover {
  background: rgba(34, 158, 217, 0.15);
}

/* Dark mode */
.dark .stat-card { background: #1e1e2e; border-color: #2e2e42; }
.dark .finance-item { background: rgba(255, 255, 255, 0.04); }
.dark .deal-row:hover { background: rgba(255, 255, 255, 0.04); }
</style>