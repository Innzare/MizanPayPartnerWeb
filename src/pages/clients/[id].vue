<script setup lang="ts">
import { useClientProfilesStore } from '@/stores/clientProfiles'
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { type ClientProfile, type ClientProfileStats, clientProfileName, type Deal } from '@/types'
import { formatCurrency, formatDate, formatPhone, timeAgo } from '@/utils/formatters'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { useRoute, useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const router = useRouter()
const clientsStore = useClientProfilesStore()
const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()

const profileId = computed(() => (route.params as { id: string }).id)
const pageLoading = ref(true)
const notFound = ref(false)

const profile = ref<ClientProfile | null>(null)
const stats = ref<ClientProfileStats | null>(null)
const resolvedProfileId = ref<string | null>(null)

// Edit mode
const editing = ref(false)
const saving = ref(false)
const form = ref({
  firstName: '',
  lastName: '',
  patronymic: '',
  birthDate: '',
  passportSeries: '',
  passportNumber: '',
  passportIssuedBy: '',
  passportIssuedAt: '',
  registrationAddress: '',
  residentialAddress: '',
  inn: '',
})

onMounted(async () => {
  try {
    await (dealsStore.deals.length ? Promise.resolve() : dealsStore.fetchDeals())

    let p: ClientProfile | null = null
    try {
      p = await clientsStore.findById(profileId.value)
    } catch {
      const deal = dealsStore.deals.find(d => d.clientId === profileId.value && d.clientProfileId)
      if (deal?.clientProfileId) {
        p = await clientsStore.findById(deal.clientProfileId)
      }
    }

    if (!p) { notFound.value = true; return }

    profile.value = p
    resolvedProfileId.value = p.id
    stats.value = await clientsStore.getStats(p.id)
  } catch (e: any) {
    if (e.message?.includes('404') || e.message?.includes('не найден')) {
      notFound.value = true
    } else {
      toast.error(e.message || 'Ошибка загрузки профиля')
    }
  } finally {
    pageLoading.value = false
  }
})

const clientDeals = computed(() => {
  if (!resolvedProfileId.value) return []
  return dealsStore.deals.filter(d =>
    d.clientProfileId === resolvedProfileId.value ||
    (profile.value?.userId && d.clientId === profile.value.userId)
  )
})

const fullName = computed(() => profile.value ? clientProfileName(profile.value) : '')

const initials = computed(() => {
  if (!profile.value) return '?'
  return `${(profile.value.firstName || '?')[0]}${(profile.value.lastName || '')[0]}`.toUpperCase()
})

const hasPassport = computed(() =>
  !!(profile.value?.passportSeries && profile.value?.passportNumber)
)

// Financial stats computed from deals
const finance = computed(() => {
  const deals = clientDeals.value
  const totalVolume = deals.reduce((s, d) => s + d.totalPrice, 0)
  const totalProfit = deals.reduce((s, d) => s + d.markup, 0)
  const remaining = deals.filter(d => d.status === 'ACTIVE').reduce((s, d) => s + d.remainingAmount, 0)

  const allPayments = deals.flatMap(d => paymentsStore.getPaymentsForDeal(d.id))
  const paid = allPayments.filter(p => p.status === 'PAID')
  const onTime = paid.filter(p => p.paidAt && new Date(p.paidAt) <= new Date(p.dueDate)).length
  const onTimeRate = paid.length > 0 ? Math.round((onTime / paid.length) * 100) : 100

  return { totalVolume, totalProfit, remaining, onTimeRate }
})

function cleanPhone(phone: string) {
  return phone.replace(/\D/g, '')
}

function startEditing() {
  if (!profile.value) return
  form.value = {
    firstName: profile.value.firstName || '',
    lastName: profile.value.lastName || '',
    patronymic: profile.value.patronymic || '',
    birthDate: profile.value.birthDate || '',
    passportSeries: profile.value.passportSeries || '',
    passportNumber: profile.value.passportNumber || '',
    passportIssuedBy: profile.value.passportIssuedBy || '',
    passportIssuedAt: profile.value.passportIssuedAt || '',
    registrationAddress: profile.value.registrationAddress || '',
    residentialAddress: profile.value.residentialAddress || '',
    inn: profile.value.inn || '',
  }
  editing.value = true
}

async function saveProfile() {
  if (!form.value.firstName || !form.value.lastName) {
    toast.error('Имя и фамилия обязательны')
    return
  }
  saving.value = true
  try {
    const data: Record<string, string | undefined> = {}
    const fields = ['firstName', 'lastName', 'patronymic', 'birthDate', 'passportSeries',
      'passportNumber', 'passportIssuedBy', 'passportIssuedAt', 'registrationAddress',
      'residentialAddress', 'inn'] as const
    for (const key of fields) data[key] = form.value[key] || undefined
    profile.value = await clientsStore.update(resolvedProfileId.value!, data)
    editing.value = false
    toast.success('Профиль обновлён')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  } finally {
    saving.value = false
  }
}

function dealProgress(deal: Deal): number {
  return deal.numberOfPayments > 0 ? (deal.paidPayments / deal.numberOfPayments) * 100 : 0
}

function getScoreColor(rate: number) {
  if (rate >= 90) return '#047857'
  if (rate >= 70) return '#f59e0b'
  return '#ef4444'
}

const AVATAR_COLORS = ['#047857', '#3b82f6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ef4444']
function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}

// Active tab
const activeTab = ref<'info' | 'deals' | 'reviews'>('info')
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Back -->
    <button class="back-btn mb-5" @click="router.back()">
      <v-icon icon="mdi-arrow-left" size="18" />
      Назад
    </button>

    <!-- Loading -->
    <div v-if="pageLoading" class="text-center py-16">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <!-- Not found -->
    <div v-else-if="notFound" class="empty-state">
      <v-icon icon="mdi-account-off" size="64" color="grey-lighten-1" />
      <div class="text-h6 mt-3 mb-1">Клиент не найден</div>
      <div class="text-body-2 text-medium-emphasis mb-4">Профиль не существует или был удалён</div>
      <v-btn variant="outlined" size="small" @click="router.push('/clients')">К списку клиентов</v-btn>
    </div>

    <template v-else-if="profile">
      <v-row>
        <!-- ====== LEFT COLUMN: Profile card ====== -->
        <v-col cols="12" lg="4">
          <v-card rounded="xl" elevation="0" border class="profile-card">
            <!-- Avatar + name -->
            <div class="profile-header">
              <div class="profile-avatar" :style="{ background: avatarColor(profile.firstName) }">
                {{ initials }}
              </div>
              <div class="text-h6 font-weight-bold mt-3">{{ fullName }}</div>
              <div class="text-body-2 text-medium-emphasis">{{ formatPhone(profile.phone) }}</div>

              <!-- Badges -->
              <div class="d-flex ga-2 mt-3 flex-wrap justify-center">
                <v-chip :color="hasPassport ? 'success' : 'warning'" size="x-small" variant="tonal">
                  <v-icon start :icon="hasPassport ? 'mdi-check-circle' : 'mdi-alert-circle'" size="12" />
                  {{ hasPassport ? 'Паспорт' : 'Без паспорта' }}
                </v-chip>
                <v-chip v-if="profile.userId" color="info" size="x-small" variant="tonal">
                  <v-icon start icon="mdi-cellphone" size="12" />
                  В приложении
                </v-chip>
                <v-chip v-else color="grey" size="x-small" variant="tonal">
                  <v-icon start icon="mdi-account-plus" size="12" />
                  Внешний
                </v-chip>
              </div>
            </div>

            <!-- Contact buttons -->
            <div class="contact-row">
              <a :href="`https://wa.me/${cleanPhone(profile.phone)}`" target="_blank" class="contact-btn contact-btn--wa">
                <v-icon icon="mdi-whatsapp" size="18" /> WhatsApp
              </a>
              <a :href="`https://t.me/+${cleanPhone(profile.phone)}`" target="_blank" class="contact-btn contact-btn--tg">
                <v-icon icon="mdi-send" size="18" /> Telegram
              </a>
            </div>

            <v-divider />

            <!-- Quick info -->
            <div class="info-list">
              <div class="info-row">
                <v-icon icon="mdi-identifier" size="16" class="text-medium-emphasis" />
                <span class="text-medium-emphasis">ИНН</span>
                <span class="ml-auto font-weight-medium">{{ profile.inn || '—' }}</span>
              </div>
              <div class="info-row">
                <v-icon icon="mdi-cake-variant-outline" size="16" class="text-medium-emphasis" />
                <span class="text-medium-emphasis">Дата рождения</span>
                <span class="ml-auto font-weight-medium">{{ profile.birthDate ? formatDate(profile.birthDate) : '—' }}</span>
              </div>
              <div class="info-row">
                <v-icon icon="mdi-map-marker-outline" size="16" class="text-medium-emphasis" />
                <span class="text-medium-emphasis">Адрес</span>
                <span class="ml-auto font-weight-medium" style="text-align: right; max-width: 180px;">{{ profile.residentialAddress || profile.registrationAddress || '—' }}</span>
              </div>
            </div>

            <!-- Edit button -->
            <div class="pa-4 pt-0">
              <v-btn block variant="outlined" size="small" prepend-icon="mdi-pencil" @click="startEditing">
                Редактировать профиль
              </v-btn>
            </div>
          </v-card>

          <!-- Blacklist alert -->
          <v-alert
            v-if="stats && stats.blacklistEntries.length"
            type="error"
            variant="tonal"
            rounded="xl"
            class="mt-4"
            icon="mdi-alert-octagon"
            prominent
          >
            <div class="font-weight-bold mb-2">В чёрном списке</div>
            <div v-for="entry in stats.blacklistEntries" :key="entry.id" class="mb-2">
              <div class="text-body-2">
                <strong>{{ entry.investorName }}</strong>
                <span v-if="entry.reason"> — {{ entry.reason }}</span>
              </div>
              <div class="text-caption text-medium-emphasis">{{ formatDate(entry.createdAt) }}</div>
            </div>
          </v-alert>
        </v-col>

        <!-- ====== RIGHT COLUMN: Content ====== -->
        <v-col cols="12" lg="8">
          <!-- Stats row -->
          <div class="stats-row mb-5">
            <div class="stat-card">
              <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
                <v-icon icon="mdi-handshake" size="20" />
              </div>
              <div>
                <div class="stat-value">{{ stats?.totalDeals ?? 0 }}</div>
                <div class="stat-label">Сделок</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
                <v-icon icon="mdi-currency-rub" size="20" />
              </div>
              <div>
                <div class="stat-value">{{ formatCurrency(finance.totalVolume) }}</div>
                <div class="stat-label">Объём</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">
                <v-icon icon="mdi-trending-up" size="20" />
              </div>
              <div>
                <div class="stat-value">{{ formatCurrency(finance.totalProfit) }}</div>
                <div class="stat-label">Прибыль</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" :style="{ background: getScoreColor(finance.onTimeRate) + '1a', color: getScoreColor(finance.onTimeRate) }">
                <v-icon icon="mdi-heart-pulse" size="20" />
              </div>
              <div>
                <div class="stat-value">{{ finance.onTimeRate }}%</div>
                <div class="stat-label">Своевременность</div>
              </div>
            </div>
          </div>

          <!-- Tabs -->
          <div class="tab-bar mb-4">
            <button
              class="tab-item" :class="{ active: activeTab === 'info' }"
              @click="activeTab = 'info'"
            >
              <v-icon icon="mdi-card-account-details-outline" size="16" /> Данные
            </button>
            <button
              class="tab-item" :class="{ active: activeTab === 'deals' }"
              @click="activeTab = 'deals'"
            >
              <v-icon icon="mdi-handshake-outline" size="16" /> Сделки
              <span v-if="clientDeals.length" class="tab-badge">{{ clientDeals.length }}</span>
            </button>
            <button
              v-if="stats && stats.reviews.length"
              class="tab-item" :class="{ active: activeTab === 'reviews' }"
              @click="activeTab = 'reviews'"
            >
              <v-icon icon="mdi-star-outline" size="16" /> Отзывы
              <span class="tab-badge">{{ stats.reviews.length }}</span>
            </button>
          </div>

          <!-- ── Tab: Info ── -->
          <v-card v-if="activeTab === 'info'" rounded="xl" elevation="0" border class="pa-5">
            <template v-if="!editing">
              <!-- Personal -->
              <div class="section-label">ЛИЧНЫЕ ДАННЫЕ</div>
              <div class="data-grid">
                <div class="data-item">
                  <div class="data-label">Фамилия</div>
                  <div class="data-value">{{ profile.lastName || '—' }}</div>
                </div>
                <div class="data-item">
                  <div class="data-label">Имя</div>
                  <div class="data-value">{{ profile.firstName || '—' }}</div>
                </div>
                <div class="data-item">
                  <div class="data-label">Отчество</div>
                  <div class="data-value">{{ profile.patronymic || '—' }}</div>
                </div>
                <div class="data-item">
                  <div class="data-label">Телефон</div>
                  <div class="data-value">{{ formatPhone(profile.phone) }}</div>
                </div>
                <div class="data-item">
                  <div class="data-label">Дата рождения</div>
                  <div class="data-value">{{ profile.birthDate ? formatDate(profile.birthDate) : '—' }}</div>
                </div>
                <div class="data-item">
                  <div class="data-label">ИНН</div>
                  <div class="data-value">{{ profile.inn || '—' }}</div>
                </div>
              </div>

              <!-- Passport -->
              <div class="section-label mt-5">ПАСПОРТНЫЕ ДАННЫЕ</div>
              <div class="data-grid">
                <div class="data-item">
                  <div class="data-label">Серия и номер</div>
                  <div class="data-value">
                    {{ profile.passportSeries && profile.passportNumber
                      ? `${profile.passportSeries} ${profile.passportNumber}`
                      : '—' }}
                  </div>
                </div>
                <div class="data-item">
                  <div class="data-label">Дата выдачи</div>
                  <div class="data-value">{{ profile.passportIssuedAt ? formatDate(profile.passportIssuedAt) : '—' }}</div>
                </div>
                <div class="data-item span-2">
                  <div class="data-label">Кем выдан</div>
                  <div class="data-value">{{ profile.passportIssuedBy || '—' }}</div>
                </div>
              </div>

              <!-- Addresses -->
              <div class="section-label mt-5">АДРЕСА</div>
              <div class="data-grid">
                <div class="data-item span-2">
                  <div class="data-label">Адрес прописки</div>
                  <div class="data-value">{{ profile.registrationAddress || '—' }}</div>
                </div>
                <div class="data-item span-2">
                  <div class="data-label">Адрес проживания</div>
                  <div class="data-value">{{ profile.residentialAddress || '—' }}</div>
                </div>
              </div>
            </template>

            <!-- Edit mode -->
            <template v-else>
              <div class="d-flex align-center justify-space-between mb-4">
                <div class="text-subtitle-1 font-weight-bold">Редактирование</div>
                <div class="d-flex ga-2">
                  <v-btn size="small" variant="text" @click="editing = false">Отмена</v-btn>
                  <v-btn size="small" variant="flat" color="primary" :loading="saving" @click="saveProfile">Сохранить</v-btn>
                </div>
              </div>

              <div class="section-label">ЛИЧНЫЕ ДАННЫЕ</div>
              <v-row dense>
                <v-col cols="12" sm="4">
                  <v-text-field v-model="form.lastName" label="Фамилия *" density="compact" variant="outlined" rounded="lg" />
                </v-col>
                <v-col cols="12" sm="4">
                  <v-text-field v-model="form.firstName" label="Имя *" density="compact" variant="outlined" rounded="lg" />
                </v-col>
                <v-col cols="12" sm="4">
                  <v-text-field v-model="form.patronymic" label="Отчество" density="compact" variant="outlined" rounded="lg" />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="form.birthDate" label="Дата рождения" type="date" density="compact" variant="outlined" rounded="lg" />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="form.inn" label="ИНН" density="compact" variant="outlined" rounded="lg" />
                </v-col>
              </v-row>

              <div class="section-label mt-3">ПАСПОРТНЫЕ ДАННЫЕ</div>
              <v-row dense>
                <v-col cols="6" sm="3">
                  <v-text-field v-model="form.passportSeries" label="Серия" density="compact" variant="outlined" rounded="lg" />
                </v-col>
                <v-col cols="6" sm="3">
                  <v-text-field v-model="form.passportNumber" label="Номер" density="compact" variant="outlined" rounded="lg" />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="form.passportIssuedAt" label="Дата выдачи" type="date" density="compact" variant="outlined" rounded="lg" />
                </v-col>
                <v-col cols="12">
                  <v-text-field v-model="form.passportIssuedBy" label="Кем выдан" density="compact" variant="outlined" rounded="lg" />
                </v-col>
              </v-row>

              <div class="section-label mt-3">АДРЕСА</div>
              <v-row dense>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="form.registrationAddress" label="Адрес прописки" density="compact" variant="outlined" rounded="lg" />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="form.residentialAddress" label="Адрес проживания" density="compact" variant="outlined" rounded="lg" />
                </v-col>
              </v-row>
            </template>
          </v-card>

          <!-- ── Tab: Deals ── -->
          <v-card v-if="activeTab === 'deals'" rounded="xl" elevation="0" border class="pa-5">
            <div v-if="!clientDeals.length" class="empty-tab">
              <v-icon icon="mdi-handshake-outline" size="48" color="grey-lighten-1" />
              <div class="text-body-2 text-medium-emphasis mt-2">Нет сделок с этим клиентом</div>
            </div>

            <div v-else class="deals-list">
              <div
                v-for="deal in clientDeals"
                :key="deal.id"
                class="deal-row"
                @click="router.push(`/deals/${deal.id}`)"
              >
                <v-avatar size="44" rounded="lg" color="grey-lighten-3" class="mr-3 flex-shrink-0">
                  <v-img v-if="deal.productPhotos?.[0]" :src="deal.productPhotos[0]" cover />
                  <v-icon v-else icon="mdi-package-variant" size="20" />
                </v-avatar>
                <div class="deal-main">
                  <div class="deal-name">{{ deal.productName }}</div>
                  <div class="deal-meta">{{ formatCurrency(deal.totalPrice) }} · {{ deal.paidPayments }}/{{ deal.numberOfPayments }} платежей</div>
                </div>
                <div class="d-none d-sm-flex align-center ga-3 flex-shrink-0">
                  <v-progress-linear
                    :model-value="dealProgress(deal)"
                    color="primary"
                    rounded
                    height="4"
                    style="width: 60px;"
                  />
                  <div class="deal-status" :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])">
                    {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                  </div>
                </div>
                <v-icon icon="mdi-chevron-right" size="18" class="ml-2 text-medium-emphasis flex-shrink-0" />
              </div>
            </div>
          </v-card>

          <!-- ── Tab: Reviews ── -->
          <v-card v-if="activeTab === 'reviews' && stats" rounded="xl" elevation="0" border class="pa-5">
            <div v-if="!stats.reviews.length" class="empty-tab">
              <v-icon icon="mdi-star-outline" size="48" color="grey-lighten-1" />
              <div class="text-body-2 text-medium-emphasis mt-2">Нет отзывов</div>
            </div>

            <div v-for="(review, i) in stats.reviews" :key="review.id">
              <div class="review-card">
                <div class="d-flex align-center justify-space-between mb-2">
                  <div class="font-weight-bold text-body-2">{{ review.investorName }}</div>
                  <div class="text-caption text-medium-emphasis">{{ timeAgo(review.createdAt) }}</div>
                </div>
                <div class="d-flex ga-1 mb-2">
                  <v-icon
                    v-for="s in 5" :key="s"
                    :icon="s <= review.rating ? 'mdi-star' : 'mdi-star-outline'"
                    :color="s <= review.rating ? '#f59e0b' : 'grey-lighten-2'"
                    size="16"
                  />
                </div>
                <div v-if="review.comment" class="text-body-2 text-medium-emphasis">{{ review.comment }}</div>
              </div>
              <v-divider v-if="i < stats.reviews.length - 1" class="my-3" />
            </div>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </div>
</template>

<style scoped>
/* ── Back button ── */
.back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.back-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* ── Profile card ── */
.profile-card {
  overflow: hidden;
}

.profile-header {
  display: flex; flex-direction: column; align-items: center;
  padding: 32px 24px 20px;
}

.profile-avatar {
  width: 80px; height: 80px; border-radius: 22px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 28px; font-weight: 700;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

.contact-row {
  display: flex; gap: 8px; padding: 0 16px 16px;
}

.contact-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px; border-radius: 10px;
  font-size: 12px; font-weight: 600;
  text-decoration: none; transition: all 0.15s;
}
.contact-btn--wa {
  background: rgba(37, 211, 102, 0.08); color: #25D366;
  border: 1px solid rgba(37, 211, 102, 0.2);
}
.contact-btn--wa:hover { background: rgba(37, 211, 102, 0.15); }
.contact-btn--tg {
  background: rgba(34, 158, 217, 0.08); color: #229ED9;
  border: 1px solid rgba(34, 158, 217, 0.2);
}
.contact-btn--tg:hover { background: rgba(34, 158, 217, 0.15); }

.info-list {
  padding: 12px 16px;
}
.info-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 0; font-size: 13px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.info-row:last-child { border-bottom: none; }

/* ── Stats ── */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .stats-row { grid-template-columns: 1fr; } }

.stat-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.stat-icon {
  width: 40px; height: 40px; min-width: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.stat-value {
  font-size: 16px; font-weight: 700; line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.stat-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px;
}

/* ── Tabs ── */
.tab-bar {
  display: flex; gap: 4px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  padding: 4px; border-radius: 12px;
}
.tab-item {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 8px; border: none;
  background: transparent; cursor: pointer;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  transition: all 0.15s;
}
.tab-item:hover { color: rgba(var(--v-theme-on-surface), 0.7); }
.tab-item.active {
  background: rgba(var(--v-theme-surface), 1);
  color: rgba(var(--v-theme-on-surface), 0.9);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  font-weight: 600;
}
.tab-badge {
  font-size: 10px; font-weight: 700;
  padding: 1px 6px; border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

/* ── Data grid ── */
.section-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
  color: rgba(var(--v-theme-on-surface), 0.35);
  margin-bottom: 12px;
}

.data-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 2px;
}
@media (max-width: 600px) { .data-grid { grid-template-columns: 1fr; } }

.data-item {
  padding: 10px 14px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.data-item.span-2 { grid-column: span 2; }
@media (max-width: 600px) { .data-item.span-2 { grid-column: span 1; } }

.data-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4); margin-bottom: 2px;
}
.data-value {
  font-size: 14px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.85);
}

/* ── Deals ── */
.deals-list {
  display: flex; flex-direction: column; gap: 2px;
}
.deal-row {
  display: flex; align-items: center;
  padding: 10px 12px; border-radius: 10px;
  cursor: pointer; transition: background 0.12s;
}
.deal-row:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
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
  white-space: nowrap;
}

/* ── Reviews ── */
.review-card {
  padding: 4px 0;
}

/* ── Empty states ── */
.empty-state {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 80px 20px; text-align: center;
}
.empty-tab {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 40px 20px;
}

/* ── Dark mode ── */
.dark .stat-card { background: #1e1e2e; border-color: #2e2e42; }
.dark .tab-item.active { background: #1e1e2e; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
.dark .tab-bar { background: rgba(255, 255, 255, 0.04); }
.dark .data-item { background: rgba(255, 255, 255, 0.03); }
.dark .deal-row:hover { background: rgba(255, 255, 255, 0.04); }
</style>
