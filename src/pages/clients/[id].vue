<script setup lang="ts">
import { api } from '@/api/client'
import CityInput from '@/components/CityInput.vue'
import PhoneListField, { type PhoneDraft } from '@/components/PhoneListField.vue'
import { isCompletePhone } from '@/utils/phone'
import ClientPhones from '@/components/ClientPhones.vue'
import DateField from '@/components/DateField.vue'
import { useClientCities } from '@/composables/useClientCities'
import { useClientProfilesStore } from '@/stores/clientProfiles'
import { useAuthStore } from '@/stores/auth'
import { useSections } from '@/composables/useSections'
import { type ClientProfile, type ClientProfileStats, clientProfileName, type Deal } from '@/types'
import { formatCurrency, formatDate, formatPhone, timeAgo } from '@/utils/formatters'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { useRoute, useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useDealLock } from '@/composables/useDealLock'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const router = useRouter()
const { isDealLocked } = useDealLock()
const clientsStore = useClientProfilesStore()
const authStore = useAuthStore()
const sections = useSections()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const { refresh: refreshCities } = useClientCities()

const profileId = computed(() => (route.params as { id: string }).id)
const pageLoading = ref(true)
const notFound = ref(false)

const profile = ref<ClientProfile | null>(null)
const stats = ref<ClientProfileStats | null>(null)
const resolvedProfileId = ref<string | null>(null)

// Edit mode
const editing = ref(false)
const saving = ref(false)
const publishing = ref(false)
const form = ref({
  phone: '',
  firstName: '',
  lastName: '',
  patronymic: '',
  birthDate: '',
  passportSeries: '',
  passportNumber: '',
  passportIssuedBy: '',
  passportIssuedAt: '',
  city: '',
  registrationAddress: '',
  residentialAddress: '',
  inn: '',
})

onMounted(async () => {
  try {
    // Портфель здесь больше не грузится: сделки клиента приходят отдельной
    // выборкой по его ключу, порциями.
    const p = await clientsStore.findById(profileId.value)
    if (!p) { notFound.value = true; return }

    profile.value = p
    resolvedProfileId.value = p.id
    await Promise.all([
      clientsStore.getStats(p.id).then((st) => { stats.value = st }),
      loadClientDeals(true),
      // Вкладку «Как поручитель» показываем, только если он реально ручался,
      // поэтому сводку запрашиваем сразу — она лёгкая.
      loadGuarantorInfo(),
    ])
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

/**
 * Перечитать профиль — после обмена основного номера с дополнительным.
 * Иначе в шапке остался бы прежний номер, и по нему бы и позвонили.
 */
async function reloadProfile() {
  const p = await clientsStore.findById(profileId.value)
  if (p) profile.value = p
}

// ── Сделки клиента ──
// Приходят с сервера по тому же ключу, что группирует список клиентов, —
// значит счётчик в списке и содержимое этой страницы всегда совпадают.
const DEALS_PAGE = 20
const clientDeals = ref<Deal[]>([])
const dealsTotal = ref(0)
const dealsLoading = ref(false)

async function loadClientDeals(reset: boolean) {
  const id = resolvedProfileId.value
  if (!id) return
  dealsLoading.value = true
  try {
    const qs = new URLSearchParams({
      role: 'investor',
      clientKey: `cp:${id}`,
      limit: String(DEALS_PAGE),
      offset: String(reset ? 0 : clientDeals.value.length),
      sort: 'createdAt',
      dir: 'desc',
    })
    const res = await api.get<{ items: Deal[]; total: number }>(`/deals?${qs.toString()}`)
    clientDeals.value = reset ? res.items : [...clientDeals.value, ...res.items]
    dealsTotal.value = res.total
  } catch (e) {
    console.error('Failed to load client deals:', e)
  } finally {
    dealsLoading.value = false
  }
}

const hasMoreDeals = computed(() => clientDeals.value.length < dealsTotal.value)

const fullName = computed(() => profile.value ? clientProfileName(profile.value) : '')

const initials = computed(() => {
  if (!profile.value) return '?'
  return `${(profile.value.firstName || '?')[0]}${(profile.value.lastName || '')[0]}`.toUpperCase()
})

const hasPassport = computed(() =>
  !!(profile.value?.passportSeries && profile.value?.passportNumber)
)

// Financial stats computed from deals
// Финансовые итоги считает сервер — по ВСЕМ сделкам клиента, а не только по
// загруженной странице.
const finance = computed(() => ({
  totalVolume: (stats.value as any)?.finance?.totalVolume ?? 0,
  totalProfit: (stats.value as any)?.finance?.totalProfit ?? 0,
  remaining: (stats.value as any)?.finance?.remaining ?? 0,
  onTimeRate: (stats.value as any)?.finance?.onTimeRate ?? 100,
}))

/** Открыть переписку с клиентом во встроенном разделе. */
function openChat() {
  const digits = cleanPhone(profile.value?.phone ?? '')
  if (digits) router.push(`/broadcasts?chat=${digits}`)
}

function cleanPhone(phone: string) {
  return phone.replace(/\D/g, '')
}

// Only the creator can edit a non-platform profile. Platform clients (with userId)
// are read-only — their data comes from the User entity.
const canEdit = computed(() => {
  if (!profile.value) return false
  if (profile.value.userId) return false
  // Сотруднику без права на правку клиентов кнопки показывать незачем: сервер
  // всё равно откажет, а человек будет думать, что сломалось.
  if (!authStore.can('clients.edit')) return false
  const me = (authStore.user as any)?.id
  return profile.value.createdByInvestorId === me
})

// ── Удаление клиента ──
// Сделки при этом остаются: рвётся только связь с карточкой, имя и телефон
// в самой сделке сохраняются. Сервер откажет, если у клиента есть действующие
// сделки или он поручитель в чужом договоре.
const showDeleteDialog = ref(false)
const deleting = ref(false)
// Удалять ли заодно сделки клиента. По умолчанию нет: сделки — это история
// денег, и терять её вместе с карточкой партнёр обычно не хочет.
const deleteWithDeals = ref(false)

const canDelete = computed(() => canEdit.value && authStore.can('clients.delete'))

function openDeleteDialog() {
  deleteWithDeals.value = false
  showDeleteDialog.value = true
}

async function doDelete() {
  if (!profile.value) return
  deleting.value = true
  try {
    const res = await api.delete<{ dealsDeleted?: number }>(
      `/client-profiles/${profile.value.id}${deleteWithDeals.value ? '?withDeals=1' : ''}`,
    )
    toast.success(
      res?.dealsDeleted
        ? `Клиент удалён, сделок в корзину: ${res.dealsDeleted}`
        : 'Клиент удалён',
    )
    showDeleteDialog.value = false
    router.push('/registry')
  } catch (e: any) {
    toast.error(e.response?.data?.message || e.message || 'Не удалось удалить клиента')
  } finally {
    deleting.value = false
  }
}

/**
 * Дополнительные номера в форме, а не отдельным блоком карточки.
 *
 * `extraPhones` — то, что сейчас в форме; `originalPhones` — то, что лежит на
 * сервере. Разница между ними и есть список операций при сохранении: удалить,
 * изменить, добавить.
 */
const extraPhones = ref<PhoneDraft[]>([])
const originalPhones = ref<PhoneDraft[]>([])

function startEditing() {
  if (!profile.value) return
  const saved = (profile.value.extraPhones ?? []).map((p) => ({
    id: p.id,
    phone: p.phone,
    label: p.label ?? '',
    hasWhatsapp: !!p.hasWhatsapp,
  }))
  originalPhones.value = saved.map((p) => ({ ...p }))
  extraPhones.value = saved.map((p) => ({ ...p }))
  form.value = {
    phone: profile.value.phone || '',
    firstName: profile.value.firstName || '',
    lastName: profile.value.lastName || '',
    patronymic: profile.value.patronymic || '',
    birthDate: profile.value.birthDate || '',
    passportSeries: profile.value.passportSeries || '',
    passportNumber: profile.value.passportNumber || '',
    passportIssuedBy: profile.value.passportIssuedBy || '',
    passportIssuedAt: profile.value.passportIssuedAt || '',
    city: profile.value.city || '',
    registrationAddress: profile.value.registrationAddress || '',
    residentialAddress: profile.value.residentialAddress || '',
    inn: profile.value.inn || '',
  }
  editing.value = true
}

/**
 * Разложить правку списка на операции сервера.
 *
 * Порядок важен: сначала удаления, потом правки, потом добавления — иначе
 * перестановка двух номеров упирается в проверку «такой номер уже записан».
 * Сбой на одном номере не отменяет сохранённый профиль: говорим, что именно
 * не легло, и оставляем форму открытой на этих номерах.
 */
async function saveExtraPhones() {
  const id = resolvedProfileId.value!
  const kept = extraPhones.value.filter((p) => p.phone.trim())
  const keptIds = new Set(kept.map((p) => p.id).filter(Boolean))
  const failed: string[] = []

  for (const was of originalPhones.value) {
    if (was.id && !keptIds.has(was.id)) {
      try {
        await api.delete(`/client-profiles/${id}/phones/${was.id}`)
      } catch {
        failed.push(was.phone)
      }
    }
  }

  for (const row of kept) {
    const body = {
      phone: row.phone,
      label: row.label.trim() || null,
      hasWhatsapp: !!row.hasWhatsapp,
    }
    const was = row.id ? originalPhones.value.find((p) => p.id === row.id) : null
    try {
      if (!row.id) {
        await api.post(`/client-profiles/${id}/phones`, body)
      } else if (
        was &&
        (was.phone !== row.phone || (was.label || '') !== row.label.trim() || !!was.hasWhatsapp !== !!row.hasWhatsapp)
      ) {
        await api.patch(`/client-profiles/${id}/phones/${row.id}`, body)
      }
    } catch (e: any) {
      failed.push(row.phone)
    }
  }

  if (failed.length) toast.warning(`Не удалось сохранить номера: ${failed.join(', ')}`)
  await reloadProfile()
}

async function saveProfile() {
  if (!form.value.firstName || !form.value.lastName) {
    toast.error('Имя и фамилия обязательны')
    return
  }
  if (!form.value.phone || !isCompletePhone(form.value.phone)) {
    toast.error('Укажите корректный номер телефона')
    return
  }
  saving.value = true
  try {
    const data: Record<string, string | undefined> = {}
    const fields = ['phone', 'firstName', 'lastName', 'patronymic', 'birthDate', 'passportSeries',
      'passportNumber', 'passportIssuedBy', 'passportIssuedAt', 'city', 'registrationAddress',
      'residentialAddress', 'inn'] as const
    for (const key of fields) data[key] = form.value[key] || undefined
    profile.value = await clientsStore.update(resolvedProfileId.value!, data)
    // Номера сохраняем ПОСЛЕ профиля: если основной номер поменялся местами с
    // дополнительным, сервер справедливо не даст записать прежний основной,
    // пока он ещё числится основным в профиле.
    await saveExtraPhones()
    // Город мог измениться — обновляем подсказки и список для фильтра.
    if (data.city !== undefined) void refreshCities()
    editing.value = false
    toast.success('Профиль обновлён')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  } finally {
    saving.value = false
  }
}

// Publish / unpublish to global registry
async function togglePublish() {
  if (!profile.value || !resolvedProfileId.value) return
  publishing.value = true
  try {
    profile.value = profile.value.isPublic
      ? await clientsStore.unpublish(resolvedProfileId.value)
      : await clientsStore.publish(resolvedProfileId.value)
    toast.success(profile.value.isPublic ? 'Профиль опубликован в реестре' : 'Профиль убран из реестра')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось изменить публикацию')
  } finally {
    publishing.value = false
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
const activeTab = ref<'info' | 'deals' | 'reviews' | 'guarantor'>('info')

// ─── Как поручитель ─────────────────────────────────────────────────
// Человек может быть и клиентом, и поручителем одновременно: роль зависит от
// сделки, а не от карточки. Поэтому вкладка появляется, только если он реально
// за кого-то поручился.
interface GuarantorDeal {
  dealId: string
  dealNumber: number
  productName: string
  status: string
  totalPrice: number
  remainingAmount: number
  dealDate: string | null
  overdueAmount: number
  overdueDays: number
  clientId: string | null
  clientName: string | null
}
interface GuarantorSummary {
  guaranteeCount: number
  activeCount: number
  closedCount: number
  guaranteeVolume: number
  guaranteeRemaining: number
  overdueAmount: number
  overdueDealCount: number
  ownDebt: number
  totalExposure: number
  deals: GuarantorDeal[]
}
const guarantorInfo = ref<GuarantorSummary | null>(null)
const guarantorLoading = ref(false)

async function loadGuarantorInfo() {
  if (guarantorInfo.value || guarantorLoading.value) return
  guarantorLoading.value = true
  try {
    guarantorInfo.value = await api.get<GuarantorSummary>(
      `/guarantors/summary/${resolvedProfileId.value || profileId.value}`,
    )
  } catch {
    // Раздел не критичен для карточки — молча оставляем вкладку пустой.
  } finally {
    guarantorLoading.value = false
  }
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Back -->
    <button class="back-btn" @click="router.back()">
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
              <!-- Ведём во встроенную переписку: внешняя ссылка уводила из
                   сервиса, и история переговоров с клиентом там не остаётся. -->
              <button class="contact-btn contact-btn--wa" @click="openChat">
                <v-icon icon="mdi-whatsapp" size="18" /> WhatsApp
              </button>
              <a :href="`https://t.me/+${cleanPhone(profile.phone)}`" target="_blank" class="contact-btn contact-btn--tg">
                <v-icon icon="mdi-send" size="18" /> Telegram
              </a>
            </div>

            <v-divider />

            <!-- Дополнительные номера: жена, работа, сосед. По ним звонят,
                 когда клиент не берёт трубку. -->
            <div class="px-4 py-3">
              <!-- Здесь только показываем и звоним: правка живёт в форме
                   «Редактирование», рядом с основным номером. -->
              <ClientPhones
                :profile-id="profile.id"
                :initial="profile.extraPhones ?? null"
                readonly
              />
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

            <!-- Правка профиля живёт в самой вкладке «Информация», в строке
                 заголовка «Личные данные»: кнопка стоит там, где смотрят на
                 данные, а не в другой колонке экрана. -->
            <div v-if="canEdit && canDelete" class="px-4 pb-4">
              <button class="delete-profile-btn" @click="openDeleteDialog">
                <v-icon icon="mdi-delete-outline" size="16" />
                Удалить клиента
              </button>
            </div>
          </v-card>

          <!-- Publish to registry -->
          <!-- Именно isHidden, а не visible: тарифного ограничения здесь никогда не
             было, и добавить его значит запереть клиента в общем реестре — снять
             публикацию стало бы невозможно после окончания подписки. -->
        <div v-if="canEdit && profile && !sections.isHidden('registry')" class="publish-card">
            <div class="publish-card-row">
              <v-icon :icon="profile.isPublic ? 'mdi-earth' : 'mdi-earth-off'" size="20" :color="profile.isPublic ? '#047857' : '#9ca3af'" />
              <div class="publish-card-text">
                <div class="publish-card-title">{{ profile.isPublic ? 'В глобальном реестре' : 'Только для вас' }}</div>
                <div class="publish-card-sub">{{ profile.isPublic ? 'Другие партнёры видят этот профиль в реестре' : 'Можно опубликовать в общий реестр для всех партнёров' }}</div>
              </div>
              <button class="publish-btn" :class="{ 'publish-btn--active': profile.isPublic }" :disabled="publishing" @click="togglePublish">
                <v-progress-circular v-if="publishing" indeterminate size="14" width="2" />
                <template v-else>{{ profile.isPublic ? 'Убрать' : 'Опубликовать' }}</template>
              </button>
            </div>
          </div>

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
              <span v-if="dealsTotal" class="tab-badge">{{ dealsTotal }}</span>
            </button>
            <button
              v-if="stats && stats.reviews.length"
              class="tab-item" :class="{ active: activeTab === 'reviews' }"
              @click="activeTab = 'reviews'"
            >
              <v-icon icon="mdi-star-outline" size="16" /> Отзывы
              <span class="tab-badge">{{ stats.reviews.length }}</span>
            </button>
            <button
              v-if="guarantorInfo?.guaranteeCount"
              class="tab-item" :class="{ active: activeTab === 'guarantor' }"
              @click="activeTab = 'guarantor'"
            >
              <v-icon icon="mdi-account-check-outline" size="16" /> Как поручитель
              <span class="tab-badge">{{ guarantorInfo.guaranteeCount }}</span>
            </button>
          </div>

          <!-- ── Tab: как поручитель ── -->
          <v-card
            v-if="activeTab === 'guarantor' && guarantorInfo"
            rounded="xl"
            elevation="0"
            border
            class="pa-5"
          >
            <div class="section-label">ЗА КОГО ПОРУЧИЛСЯ</div>
            <div class="gr-metrics">
              <div class="gr-metric">
                <div class="gr-metric-label">Поручительств</div>
                <div class="gr-metric-value">
                  {{ guarantorInfo.guaranteeCount }}
                  <span class="gr-metric-sub">действующих {{ guarantorInfo.activeCount }}</span>
                </div>
              </div>
              <div class="gr-metric">
                <div class="gr-metric-label">На сумму</div>
                <div class="gr-metric-value">{{ formatCurrency(guarantorInfo.guaranteeVolume) }}</div>
              </div>
              <div class="gr-metric">
                <div class="gr-metric-label">Остаток под поручительством</div>
                <div class="gr-metric-value">{{ formatCurrency(guarantorInfo.guaranteeRemaining) }}</div>
              </div>
              <div class="gr-metric" :class="{ 'gr-metric--bad': guarantorInfo.overdueAmount > 0 }">
                <div class="gr-metric-label">Из них просрочено</div>
                <div class="gr-metric-value">
                  {{ formatCurrency(guarantorInfo.overdueAmount) }}
                  <span v-if="guarantorInfo.overdueDealCount" class="gr-metric-sub">
                    в {{ guarantorInfo.overdueDealCount }} сделк{{ guarantorInfo.overdueDealCount === 1 ? 'е' : 'ах' }}
                  </span>
                </div>
              </div>
              <div class="gr-metric gr-metric--total">
                <div class="gr-metric-label">Общая ответственность</div>
                <div class="gr-metric-value">
                  {{ formatCurrency(guarantorInfo.totalExposure) }}
                  <span class="gr-metric-sub">со своим долгом {{ formatCurrency(guarantorInfo.ownDebt) }}</span>
                </div>
              </div>
            </div>

            <div class="section-label mt-5">СДЕЛКИ, ГДЕ ОН ПОРУЧИТЕЛЬ</div>
            <div class="gr-deals">
              <div
                v-for="d in guarantorInfo.deals"
                :key="d.dealId"
                class="gr-deal"
                @click="router.push(`/deals/${d.dealId}`)"
              >
                <div class="flex-grow-1 min-w-0">
                  <div class="gr-deal-title">
                    №{{ d.dealNumber }} · {{ d.productName }}
                  </div>
                  <div class="gr-deal-sub">
                    {{ d.clientName || 'клиент не указан' }}
                    <template v-if="d.dealDate"> · {{ formatDate(d.dealDate) }}</template>
                  </div>
                </div>
                <div class="text-right">
                  <div class="gr-deal-amount">{{ formatCurrency(d.remainingAmount) }}</div>
                  <div v-if="d.overdueAmount > 0" class="gr-deal-overdue">
                    просрочка {{ formatCurrency(d.overdueAmount) }} · {{ d.overdueDays }} дн.
                  </div>
                  <div v-else class="gr-deal-status">
                    {{ d.status === 'ACTIVE' ? 'платит вовремя' : 'закрыта' }}
                  </div>
                </div>
              </div>
            </div>
          </v-card>

          <!-- ── Tab: Info ── -->
          <v-card v-if="activeTab === 'info'" rounded="xl" elevation="0" border class="pa-5">
            <template v-if="!editing">
              <!-- Personal -->
              <div class="section-head">
                <div class="section-label">ЛИЧНЫЕ ДАННЫЕ</div>
                <button v-if="canEdit" class="section-action" @click="startEditing">
                  <v-icon icon="mdi-pencil-outline" size="15" />
                  Редактировать
                </button>
              </div>
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
                <div class="data-item">
                  <div class="data-label">Город</div>
                  <div class="data-value">{{ profile.city || '—' }}</div>
                </div>
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
              <!-- Те же поля и та же сетка, что в окнах «Новый клиент» и
                   «Счёт»: раньше здесь стояли поля Vuetify другого размера и
                   с другими подписями, и вкладка выглядела чужой. -->
              <div class="section-head">
                <div class="section-label">ЛИЧНЫЕ ДАННЫЕ</div>
                <div class="section-actions">
                  <button class="section-action" :disabled="saving" @click="editing = false">
                    Отмена
                  </button>
                  <button class="section-action section-action--primary" :disabled="saving" @click="saveProfile">
                    <v-progress-circular v-if="saving" indeterminate size="13" width="2" color="white" />
                    <v-icon v-else icon="mdi-check" size="15" />
                    Сохранить
                  </button>
                </div>
              </div>

              <div class="cf-row cf-row--3">
                <div class="cf-field">
                  <label class="cf-label">Фамилия <span class="cf-req">*</span></label>
                  <input v-model="form.lastName" type="text" class="cf-input" placeholder="Иванов" />
                </div>
                <div class="cf-field">
                  <label class="cf-label">Имя <span class="cf-req">*</span></label>
                  <input v-model="form.firstName" type="text" class="cf-input" placeholder="Иван" />
                </div>
                <div class="cf-field">
                  <label class="cf-label">Отчество</label>
                  <input v-model="form.patronymic" type="text" class="cf-input" placeholder="Сергеевич" />
                </div>
              </div>

              <div class="cf-row cf-row--2">
                <div class="cf-field">
                  <label class="cf-label">Дата рождения</label>
                  <DateField v-model="form.birthDate" open-to="year" :presets="false" plain />
                </div>
                <div class="cf-field">
                  <label class="cf-label">ИНН</label>
                  <input v-model="form.inn" type="text" class="cf-input" placeholder="500100123456" maxlength="12" />
                </div>
              </div>

              <!-- Телефоны правятся здесь же, вместе с остальными данными:
                   отдельный блок в карточке заставлял открывать форму ради
                   имени и закрывать её ради второго номера. -->
              <PhoneListField
                v-model:primary="form.phone"
                v-model:extras="extraPhones"
                hint="Основной номер — идентификатор клиента в системе"
              />

              <div class="section-label section-label--form">ПАСПОРТНЫЕ ДАННЫЕ</div>
              <div class="cf-row cf-row--3">
                <div class="cf-field">
                  <label class="cf-label">Серия</label>
                  <input v-model="form.passportSeries" type="text" class="cf-input" placeholder="4510" maxlength="4" />
                </div>
                <div class="cf-field">
                  <label class="cf-label">Номер</label>
                  <input v-model="form.passportNumber" type="text" class="cf-input" placeholder="123456" maxlength="6" />
                </div>
                <div class="cf-field">
                  <label class="cf-label">Дата выдачи</label>
                  <DateField v-model="form.passportIssuedAt" plain />
                </div>
              </div>
              <!-- «Кем выдан» во всю ширину: в половине строки название отдела
                   обрезается на середине. -->
              <div class="cf-field">
                <label class="cf-label">Кем выдан</label>
                <input v-model="form.passportIssuedBy" type="text" class="cf-input" placeholder="ОВД г. Махачкалы" />
              </div>

              <div class="section-label section-label--form">АДРЕСА</div>
              <div class="cf-field cf-city">
                <label class="cf-label">Город</label>
                <CityInput v-model="form.city" />
              </div>
              <div class="cf-field">
                <label class="cf-label">Адрес прописки</label>
                <input v-model="form.registrationAddress" type="text" class="cf-input" placeholder="г. Махачкала, ул. Ленина 1, кв. 5" />
              </div>
              <div class="cf-field">
                <label class="cf-label">Адрес проживания</label>
                <input v-model="form.residentialAddress" type="text" class="cf-input" placeholder="г. Махачкала, ул. Тверская 10, кв. 20" />
              </div>
            </template>
          </v-card>

          <!-- ── Tab: Deals ── -->
          <v-card v-if="activeTab === 'deals'" rounded="xl" elevation="0" border class="pa-5">
            <div v-if="dealsLoading && !clientDeals.length" class="d-flex justify-center py-8">
              <v-progress-circular indeterminate size="26" width="3" color="primary" />
            </div>

            <div v-else-if="!clientDeals.length" class="empty-tab">
              <v-icon icon="mdi-handshake-outline" size="48" color="grey-lighten-1" />
              <div class="text-body-2 text-medium-emphasis mt-2">Нет сделок с этим клиентом</div>
            </div>

            <div v-else class="deals-list">
              <div
                v-for="deal in clientDeals"
                :key="deal.id"
                class="deal-row"
                :class="{ 'deal-locked-dim': isDealLocked(deal) }"
                @click="router.push(`/deals/${deal.id}`)"
              >
                <v-avatar size="44" rounded="lg" color="grey-lighten-3" class="mr-3 flex-shrink-0">
                  <v-img v-if="deal.productPhotos?.[0]" :src="deal.productPhotos[0]" cover />
                  <v-icon v-else icon="mdi-package-variant" size="20" />
                </v-avatar>
                <div class="deal-main">
                  <div class="deal-name">{{ deal.productName }}<span v-if="isDealLocked(deal)" class="deal-locked-chip ml-2"><v-icon icon="mdi-lock-outline" />Недоступно</span></div>
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
              <!-- Сделки приходят порциями по 20: у постоянного клиента их
                   могут быть сотни. -->
              <button
                v-if="hasMoreDeals"
                class="client-more-deals"
                :disabled="dealsLoading"
                @click="loadClientDeals(false)"
              >
                <v-progress-circular v-if="dealsLoading" indeterminate size="14" width="2" />
                <span v-else>Показать ещё ({{ dealsTotal - clientDeals.length }})</span>
              </button>
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

    <!-- Удаление клиента -->
    <v-dialog v-model="showDeleteDialog" max-width="460" persistent>
      <v-card rounded="lg">
        <v-card-title class="text-h6 pt-5 px-5">Удалить клиента?</v-card-title>
        <v-card-text class="px-5">
          <p class="mb-3">
            <b>{{ profile ? clientProfileName(profile) : '' }}</b> будет удалён из вашего реестра.
            Действие нельзя отменить.
          </p>
          <!-- Выбор: удалять ли сделки вместе с клиентом -->
          <label class="del-choice" :class="{ 'del-choice--on': deleteWithDeals }">
            <v-checkbox-btn v-model="deleteWithDeals" density="compact" hide-details color="error" />
            <div>
              <div class="del-choice-title">Удалить и сделки этого клиента</div>
              <div class="del-choice-sub">
                Сделки отправятся в корзину — их можно восстановить. Доход по ним уйдёт
                из кассы и аналитики.
              </div>
            </div>
          </label>

          <div class="del-note mt-3">
            <template v-if="deleteWithDeals">
              <div class="del-note-row">
                <v-icon icon="mdi-delete-clock-outline" size="16" color="#ef4444" />
                <span>Все сделки клиента, включая действующие, уйдут <b>в корзину</b></span>
              </div>
              <div class="del-note-row">
                <v-icon icon="mdi-restore" size="16" color="#10b981" />
                <span>Из корзины сделки можно вернуть, но карточку клиента — уже нет</span>
              </div>
            </template>
            <template v-else>
              <div class="del-note-row">
                <v-icon icon="mdi-check-circle-outline" size="16" color="#10b981" />
                <span>Сделки клиента <b>останутся</b> — имя и телефон в них сохранятся</span>
              </div>
              <div class="del-note-row">
                <v-icon icon="mdi-information-outline" size="16" color="#f59e0b" />
                <span>Если есть действующие сделки, удалить не получится — отметьте пункт выше</span>
              </div>
            </template>
            <div class="del-note-row">
              <v-icon icon="mdi-close-circle-outline" size="16" color="#ef4444" />
              <span>Будут удалены отзывы и записи чёрного списка по этому клиенту</span>
            </div>
            <div class="del-note-row">
              <v-icon icon="mdi-shield-alert-outline" size="16" color="#f59e0b" />
              <span>Если клиент — поручитель по действующему договору, удалить нельзя</span>
            </div>
          </div>
        </v-card-text>
        <v-card-actions class="px-5 pb-5">
          <v-spacer />
          <v-btn variant="text" :disabled="deleting" @click="showDeleteDialog = false">Отмена</v-btn>
          <v-btn color="error" variant="flat" :loading="deleting" @click="doDelete">Удалить</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.gr-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.gr-metric {
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
}
.gr-metric--bad {
  border-color: rgba(220, 38, 38, 0.35);
  background: rgba(220, 38, 38, 0.04);
}
.gr-metric--total {
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.04);
}
.gr-metric-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.gr-metric-value {
  font-size: 18px;
  font-weight: 700;
  margin-top: 2px;
}
.gr-metric-sub {
  display: block;
  font-size: 12px;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.gr-deals {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gr-deal {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  cursor: pointer;
}
.gr-deal:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
}
.gr-deal-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gr-deal-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.gr-deal-amount {
  font-weight: 600;
  white-space: nowrap;
}
.gr-deal-overdue {
  font-size: 12px;
  color: #dc2626;
  white-space: nowrap;
}
.gr-deal-status {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* ── Back button ── */

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

.publish-card {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.publish-card-row {
  display: flex; align-items: center; gap: 12px;
}
.publish-card-text { flex: 1; min-width: 0; }
.publish-card-title {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.publish-card-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.publish-btn {
  flex-shrink: 0;
  height: 32px; padding: 0 14px;
  border-radius: 8px; border: none;
  background: #047857; color: #fff;
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  display: inline-flex; align-items: center; gap: 6px;
}
.publish-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.publish-btn:hover:not(:disabled) { background: #065f46; }
.publish-btn--active {
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.65);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
}
.publish-btn--active:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.85);
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
/* На мобиле остаёмся в 2-col — компактнее, чем стек. */
@media (max-width: 480px) { .stats-row { grid-template-columns: repeat(2, 1fr); gap: 8px; } }
@media (max-width: 599px) {
  .stat-card { padding: 12px; }
}

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
/* Заголовок раздела и его действие в одной строке: «Редактировать» стоит
   там, где смотрят на данные, а не в другой колонке экрана. */
.section-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 12px;
}
.section-head .section-label { margin-bottom: 0; }
.section-actions { display: flex; align-items: center; gap: 8px; }
.section-action {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 12.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
  cursor: pointer; transition: all 0.15s;
}
.section-action:hover:not(:disabled) { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.section-action:disabled { opacity: 0.55; cursor: default; }
.section-action--primary {
  background: #047857; border-color: #047857; color: #fff;
}
.section-action--primary:hover:not(:disabled) { background: #036b4e; color: #fff; }

/* ── Поля формы профиля ──
   Те же размеры и подписи, что в окнах «Новый клиент» и «Счёт»: вкладка
   не должна выглядеть формой из другого приложения. */
.section-label--form { margin-top: 22px; }
.cf-row { display: grid; gap: 12px; }
.cf-row--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.cf-row--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 700px) {
  .cf-row--2, .cf-row--3 { grid-template-columns: minmax(0, 1fr); }
}
.cf-field { margin-bottom: 12px; min-width: 0; }
.cf-label {
  display: block; font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 4px;
}
.cf-req { color: #ef4444; }
.cf-input {
  width: 100%; height: 40px; padding: 0 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 14px; outline: none; transition: border-color 0.15s;
}
.cf-input:focus { border-color: rgba(4, 120, 87, 0.5); }
.cf-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.32); }

/* Город — подсказка Vuetify, а не свой инпут: подгоняем её под соседние поля,
   иначе строка выше остальных и форма «ступенькой». */
.cf-city :deep(.v-field) {
  border-radius: 10px;
  font-size: 14px;
}
.cf-city :deep(.v-field__input) { min-height: 38px; padding-top: 0; padding-bottom: 0; }
.cf-city :deep(.v-input__details) { display: none; }

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

/* Удаление — та же форма, что у кнопки редактирования, но приглушённо
   красная: действие необратимое, а рядом стоит обычное. */
.delete-profile-btn {
  width: 100%;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 11px 16px;
  border-radius: 12px;
  font-size: 13px; font-weight: 600;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.2);
  cursor: pointer; transition: all 0.15s;
}
.delete-profile-btn:hover {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.35);
}

/* Пояснение в окне подтверждения: что переживёт удаление, а что нет. */
.del-note {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13px; line-height: 1.45;
}
.del-note-row { display: flex; align-items: flex-start; gap: 8px; }

/* Выбор «удалить и сделки» — отдельным блоком, чтобы его нельзя было
   пропустить взглядом: последствия у него совсем другие. */
.del-choice {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 10px 12px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  cursor: pointer; transition: all 0.15s;
}
.del-choice--on {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.05);
}
.del-choice-title { font-size: 13.5px; font-weight: 600; margin-top: 3px; }
.del-choice-sub {
  font-size: 12.5px; line-height: 1.4; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* ── Dark mode ── */
.dark .stat-card { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
.dark .tab-item.active { background: rgb(var(--v-theme-surface)); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
.dark .tab-bar { background: rgba(255, 255, 255, 0.04); }
.dark .data-item { background: rgba(255, 255, 255, 0.03); }
.dark .deal-row:hover { background: rgba(255, 255, 255, 0.04); }
.dark .edit-profile-btn {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}
.dark .edit-profile-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.18);
}
.dark .edit-btn--cancel {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
}
/* Догрузка сделок клиента порциями. */
.client-more-deals {
  width: 100%;
  margin-top: 10px;
  padding: 10px;
  border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.18);
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  transition: background-color 0.15s;
}
.client-more-deals:hover:not(:disabled) { background: rgba(var(--v-theme-primary), 0.06); }
.client-more-deals:disabled { opacity: 0.6; }
</style>
