<script setup lang="ts">
/**
 * Карточка клиента.
 *
 * Раньше страница была двухколоночной: слева узкая карточка профиля, справа
 * вкладки с данными и короткими строчками сделок. Данные ютились в трети
 * экрана, а по сделкам не было видно ни сумм, ни остатков.
 *
 * Теперь тот же язык, что на странице сделки: широкая шапка с фирменным
 * градиентом, где собрано всё о человеке, показатели под ней и сделки
 * полноценной таблицей. Правка — окном, тем же самым, что заводит клиента:
 * поля там одни и те же, и две формы неизбежно разъехались бы.
 */
import { api } from '@/api/client'
import CreateClientDialog from '@/components/CreateClientDialog.vue'
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

const profileId = computed(() => (route.params as { id: string }).id)
const pageLoading = ref(true)
const notFound = ref(false)

const profile = ref<ClientProfile | null>(null)
const stats = ref<ClientProfileStats | null>(null)
const resolvedProfileId = ref<string | null>(null)

const editDialog = ref(false)
const publishing = ref(false)

onMounted(async () => {
  try {
    // Портфель здесь не грузится: сделки клиента приходят отдельной выборкой
    // по его ключу, порциями.
    const p = await clientsStore.findById(profileId.value)
    if (!p) { notFound.value = true; return }

    profile.value = p
    resolvedProfileId.value = p.id
    await Promise.all([
      clientsStore.getStats(p.id).then((st) => { stats.value = st }),
      loadClientDeals(true),
      // Блок «как поручитель» показываем, только если он реально ручался,
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

/** Профиль сохранён в окне правки — перечитываем карточку целиком. */
async function onProfileSaved(updated: ClientProfile) {
  profile.value = updated
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

const passportText = computed(() => {
  const p = profile.value
  if (!p?.passportSeries || !p?.passportNumber) return '—'
  return `${p.passportSeries} ${p.passportNumber}`
})

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

/** Сколько по сделке уже внесено — для колонки «Оплачено». */
function dealPaid(deal: Deal): number {
  return Math.max(0, (deal.totalPrice ?? 0) - (deal.remainingAmount ?? 0))
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

// ─── Как поручитель ─────────────────────────────────────────────────
// Человек может быть и клиентом, и поручителем одновременно: роль зависит от
// сделки, а не от карточки. Поэтому блок появляется, только если он реально
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
    // Раздел не критичен для карточки — молча оставляем блок скрытым.
  } finally {
    guarantorLoading.value = false
  }
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <button class="back-btn" @click="router.back()">
      <v-icon icon="mdi-arrow-left" size="18" />
      Назад
    </button>

    <div v-if="pageLoading" class="text-center py-16">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <div v-else-if="notFound" class="empty-state">
      <v-icon icon="mdi-account-off" size="64" color="grey-lighten-1" />
      <div class="text-h6 mt-3 mb-1">Клиент не найден</div>
      <div class="text-body-2 text-medium-emphasis mb-4">Профиль не существует или был удалён</div>
      <v-btn variant="outlined" size="small" @click="router.push('/clients')">К списку клиентов</v-btn>
    </div>

    <template v-else-if="profile">
      <!-- ── Шапка: всё о человеке в одном месте ── -->
      <div class="client-hero mb-5">
        <div class="client-hero-actions">
          <button v-if="canEdit" class="hero-action" @click="editDialog = true">
            <v-icon icon="mdi-pencil-outline" size="15" />
            Редактировать
          </button>
          <button
            v-if="canEdit && !sections.isHidden('registry')"
            class="hero-action"
            :class="{ 'hero-action--on': profile.isPublic }"
            :disabled="publishing"
            :title="profile.isPublic
              ? 'Профиль виден другим партнёрам в общем реестре'
              : 'Опубликовать профиль в общем реестре партнёров'"
            @click="togglePublish"
          >
            <v-progress-circular v-if="publishing" indeterminate size="14" width="2" />
            <v-icon v-else :icon="profile.isPublic ? 'mdi-earth' : 'mdi-earth-off'" size="15" />
            {{ profile.isPublic ? 'В реестре' : 'Опубликовать' }}
          </button>
        </div>

        <div class="client-hero-top">
          <div class="client-hero-avatar" :style="{ background: avatarColor(profile.firstName) }">
            {{ initials }}
          </div>
          <div class="client-hero-ident">
            <div class="client-hero-badges">
              <span class="hero-badge" :class="hasPassport ? 'hero-badge--ok' : 'hero-badge--warn'">
                <v-icon :icon="hasPassport ? 'mdi-check-circle' : 'mdi-alert-circle'" size="12" />
                {{ hasPassport ? 'Паспорт есть' : 'Без паспорта' }}
              </span>
              <span class="hero-badge">
                <v-icon :icon="profile.userId ? 'mdi-cellphone' : 'mdi-account-plus'" size="12" />
                {{ profile.userId ? 'В приложении' : 'Внешний клиент' }}
              </span>
              <span v-if="profile.isPublic" class="hero-badge">
                <v-icon icon="mdi-earth" size="12" />
                В общем реестре
              </span>
            </div>
            <h1 class="client-hero-title">{{ fullName }}</h1>
            <div class="client-hero-phone">{{ formatPhone(profile.phone) }}</div>
            <div class="client-hero-contacts">
              <button class="hero-contact" @click="openChat">
                <v-icon icon="mdi-whatsapp" size="16" /> WhatsApp
              </button>
              <a
                :href="`https://t.me/+${cleanPhone(profile.phone)}`"
                target="_blank"
                class="hero-contact"
              >
                <v-icon icon="mdi-send" size="16" /> Telegram
              </a>
            </div>
          </div>
        </div>

        <!-- Данные клиента прямо здесь: их немного, и ради них незачем
             заводить отдельную вкладку. -->
        <div class="client-hero-facts">
          <div class="fact">
            <div class="fact-key">Дата рождения</div>
            <div class="fact-val">{{ profile.birthDate ? formatDate(profile.birthDate) : '—' }}</div>
          </div>
          <div class="fact">
            <div class="fact-key">Город</div>
            <div class="fact-val">{{ profile.city || '—' }}</div>
          </div>
          <div class="fact">
            <div class="fact-key">Паспорт</div>
            <div class="fact-val">{{ passportText }}</div>
          </div>
          <div class="fact">
            <div class="fact-key">Выдан</div>
            <div class="fact-val">{{ profile.passportIssuedAt ? formatDate(profile.passportIssuedAt) : '—' }}</div>
          </div>
          <div class="fact fact--wide">
            <div class="fact-key">Кем выдан</div>
            <div class="fact-val">{{ profile.passportIssuedBy || '—' }}</div>
          </div>
          <div class="fact fact--wide">
            <div class="fact-key">Адрес прописки</div>
            <div class="fact-val">{{ profile.registrationAddress || '—' }}</div>
          </div>
          <div class="fact fact--wide">
            <div class="fact-key">Адрес проживания</div>
            <div class="fact-val">{{ profile.residentialAddress || '—' }}</div>
          </div>
          <div v-if="profile.extraPhones?.length" class="fact fact--wide">
            <div class="fact-key">Другие номера</div>
            <div class="fact-val fact-phones">
              <span v-for="ph in profile.extraPhones" :key="ph.id" class="fact-phone">
                {{ formatPhone(ph.phone) }}
                <template v-if="ph.label"> · {{ ph.label }}</template>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Показатели ── -->
      <div class="client-kpi mb-5">
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
            <v-icon icon="mdi-handshake" size="18" />
          </div>
          <div class="kpi-body">
            <div class="kpi-label">Сделок</div>
            <div class="kpi-value">
              {{ stats?.totalDeals ?? 0 }}
              <span class="kpi-sub">активных {{ stats?.activeDeals ?? 0 }}</span>
            </div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
            <v-icon icon="mdi-currency-rub" size="18" />
          </div>
          <div class="kpi-body">
            <div class="kpi-label">Объём</div>
            <div class="kpi-value">{{ formatCurrency(finance.totalVolume) }}</div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">
            <v-icon icon="mdi-trending-up" size="18" />
          </div>
          <div class="kpi-body">
            <div class="kpi-label">Прибыль</div>
            <div class="kpi-value">{{ formatCurrency(finance.totalProfit) }}</div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
            <v-icon icon="mdi-cash-clock" size="18" />
          </div>
          <div class="kpi-body">
            <div class="kpi-label">Остаток долга</div>
            <div class="kpi-value">{{ formatCurrency(finance.remaining) }}</div>
          </div>
        </div>
        <div class="kpi-card">
          <div
            class="kpi-icon"
            :style="{ background: getScoreColor(finance.onTimeRate) + '1a', color: getScoreColor(finance.onTimeRate) }"
          >
            <v-icon icon="mdi-heart-pulse" size="18" />
          </div>
          <div class="kpi-body">
            <div class="kpi-label">Платит вовремя</div>
            <div class="kpi-value" :style="{ color: getScoreColor(finance.onTimeRate) }">
              {{ finance.onTimeRate }}%
            </div>
          </div>
        </div>
      </div>

      <!-- Чёрный список — до сделок: это то, что обязаны увидеть сразу. -->
      <v-alert
        v-if="stats && stats.blacklistEntries.length"
        type="error"
        variant="tonal"
        rounded="lg"
        class="mb-5"
        icon="mdi-alert-octagon"
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

      <!-- ── Сделки клиента ── -->
      <v-card rounded="lg" elevation="0" border class="mb-6">
        <div class="pa-5 pb-3 d-flex align-center justify-space-between ga-3 flex-wrap">
          <div>
            <div class="section-title">Сделки клиента</div>
            <div class="section-subtitle">
              {{ dealsTotal ? `Всего ${dealsTotal}` : 'Пока ни одной' }}
            </div>
          </div>
        </div>

        <div v-if="dealsLoading && !clientDeals.length" class="d-flex justify-center py-8">
          <v-progress-circular indeterminate size="26" width="3" color="primary" />
        </div>

        <div v-else-if="!clientDeals.length" class="empty-tab">
          <v-icon icon="mdi-handshake-outline" size="48" color="grey-lighten-1" />
          <div class="text-body-2 text-medium-emphasis mt-2">Нет сделок с этим клиентом</div>
        </div>

        <template v-else>
          <div class="deals-scroll">
            <v-table density="default" class="deals-table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Товар</th>
                  <th>Статус</th>
                  <th>Дата</th>
                  <th class="text-end">Сумма</th>
                  <th class="text-end">Оплачено</th>
                  <th class="text-end">Остаток</th>
                  <th>Платежи</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="deal in clientDeals"
                  :key="deal.id"
                  class="deal-tr"
                  :class="{ 'deal-tr--locked': isDealLocked(deal) }"
                  @click="router.push(`/deals/${deal.id}`)"
                >
                  <td class="deal-num">#{{ deal.dealNumber }}</td>
                  <td>
                    <div class="deal-product">
                      {{ deal.productName }}
                      <span v-if="isDealLocked(deal)" class="deal-locked-chip">
                        <v-icon icon="mdi-lock-outline" size="11" />Недоступно
                      </span>
                    </div>
                  </td>
                  <td>
                    <span class="deal-status" :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])">
                      {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                    </span>
                  </td>
                  <td class="text-medium-emphasis text-no-wrap">
                    {{ deal.dealDate ? formatDate(deal.dealDate) : formatDate(deal.createdAt) }}
                  </td>
                  <td class="text-end font-weight-bold text-no-wrap">{{ formatCurrency(deal.totalPrice) }}</td>
                  <td class="text-end text-no-wrap deal-paid">{{ formatCurrency(dealPaid(deal)) }}</td>
                  <td class="text-end text-no-wrap" :class="{ 'deal-rest': deal.remainingAmount > 0 }">
                    {{ formatCurrency(deal.remainingAmount) }}
                  </td>
                  <td>
                    <div class="deal-progress">
                      <v-progress-linear
                        :model-value="dealProgress(deal)"
                        color="primary"
                        rounded
                        height="5"
                        style="width: 64px;"
                      />
                      <span class="deal-progress-text">{{ deal.paidPayments }}/{{ deal.numberOfPayments }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <!-- Сделки приходят порциями по 20: у постоянного клиента их могут
               быть сотни. -->
          <div v-if="hasMoreDeals" class="pa-4">
            <button class="client-more-deals" :disabled="dealsLoading" @click="loadClientDeals(false)">
              <v-progress-circular v-if="dealsLoading" indeterminate size="14" width="2" />
              <span v-else>Показать ещё ({{ dealsTotal - clientDeals.length }})</span>
            </button>
          </div>
        </template>
      </v-card>

      <!-- ── Как поручитель: только если он реально за кого-то ручался ── -->
      <v-card v-if="guarantorInfo?.guaranteeCount" rounded="lg" elevation="0" border class="pa-5 mb-6">
        <div class="section-title mb-1">Как поручитель</div>
        <div class="section-subtitle mb-4">Ответственность за чужие договоры</div>

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
              <div class="gr-deal-title">№{{ d.dealNumber }} · {{ d.productName }}</div>
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

      <!-- ── Отзывы других партнёров ── -->
      <v-card v-if="stats && stats.reviews.length" rounded="lg" elevation="0" border class="pa-5 mb-6">
        <div class="section-title mb-1">Отзывы партнёров</div>
        <div class="section-subtitle mb-4">Что о клиенте говорят коллеги</div>
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

      <!-- ── Опасная зона: внизу страницы, как у сделки ── -->
      <div v-if="canDelete" class="danger-bar">
        <div class="d-flex align-center ga-3">
          <div class="danger-icon">
            <v-icon icon="mdi-delete-outline" size="18" />
          </div>
          <div>
            <div class="danger-title">Удалить клиента</div>
            <div class="danger-desc">Карточка удаляется навсегда; сделки можно сохранить</div>
          </div>
        </div>
        <button class="danger-btn" @click="openDeleteDialog">
          <v-icon icon="mdi-delete-outline" size="16" />
          <span>Удалить</span>
        </button>
      </div>
    </template>

    <!-- Правка профиля — то же окно, что заводит нового клиента. -->
    <CreateClientDialog v-model="editDialog" :profile="profile" @saved="onProfileSaved" />

    <!-- Удаление клиента -->
    <v-dialog v-model="showDeleteDialog" max-width="460" persistent>
      <v-card rounded="lg">
        <v-card-title class="text-h6 pt-5 px-5">Удалить клиента?</v-card-title>
        <v-card-text class="px-5">
          <p class="mb-3">
            <b>{{ profile ? clientProfileName(profile) : '' }}</b> будет удалён из вашего реестра.
            Действие нельзя отменить.
          </p>
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
/* ── Шапка ──
   Тот же приём, что на странице сделки: фирменный градиент, белый текст,
   действия в правом верхнем углу. Данные клиента живут здесь же — их немного,
   и ради них незачем заводить отдельную вкладку. */
.client-hero {
  position: relative;
  border-radius: 16px;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  padding: 28px 32px;
  color: #fff;
}
@media (max-width: 700px) { .client-hero { padding: 22px; } }
.client-hero-actions {
  position: absolute; top: 16px; right: 16px; z-index: 2;
  display: flex; gap: 8px; flex-wrap: wrap;
}
.hero-action {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.16);
  color: #fff; font-size: 12.5px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  backdrop-filter: blur(8px);
}
.hero-action:hover:not(:disabled) { background: rgba(255, 255, 255, 0.28); }
.hero-action:disabled { opacity: 0.6; cursor: not-allowed; }
/* Уже опубликован — действие «снять», поэтому вид спокойнее. */
.hero-action--on { background: rgba(255, 255, 255, 0.28); }

.client-hero-top { display: flex; align-items: center; gap: 22px; }
@media (max-width: 700px) { .client-hero-top { flex-direction: column; align-items: flex-start; gap: 14px; } }
.client-hero-avatar {
  width: 88px; height: 88px; min-width: 88px;
  border-radius: 24px;
  display: flex; align-items: center; justify-content: center;
  font-size: 30px; font-weight: 700; color: #fff;
  border: 2px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}
.client-hero-ident { min-width: 0; }
.client-hero-badges {
  display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;
  padding-right: 240px; /* место под кнопки действий */
}
@media (max-width: 900px) { .client-hero-badges { padding-right: 0; } }
.hero-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 600;
  padding: 3px 9px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}
.hero-badge--ok { background: rgba(255, 255, 255, 0.92); color: #047857; }
.hero-badge--warn { background: rgba(245, 158, 11, 0.95); color: #fff; }
.client-hero-title {
  font-size: 26px; font-weight: 700; line-height: 1.2;
  word-break: break-word;
}
.client-hero-phone {
  font-size: 15px; font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin-top: 2px;
}
.client-hero-contacts { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.hero-contact {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px;
  font-size: 12.5px; font-weight: 600;
  text-decoration: none;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer; transition: all 0.15s;
}
.hero-contact:hover { background: rgba(255, 255, 255, 0.26); }

/* Данные — сеткой по четыре в ряд: подпись над значением, чтобы длинные
   адреса не растягивали строку и не отрывались от подписи. */
.client-hero-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px 24px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
}
@media (max-width: 1100px) { .client-hero-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .client-hero-facts { grid-template-columns: minmax(0, 1fr); } }
.fact { min-width: 0; }
.fact--wide { grid-column: span 2; }
@media (max-width: 600px) { .fact--wide { grid-column: span 1; } }
.fact-key {
  font-size: 11.5px; font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 2px;
}
.fact-val {
  font-size: 13.5px; font-weight: 600;
  color: #fff;
  word-break: break-word;
}
.fact-phones { display: flex; gap: 8px; flex-wrap: wrap; font-weight: 600; }
.fact-phone {
  padding: 2px 8px; border-radius: 7px;
  background: rgba(255, 255, 255, 0.16);
  font-size: 12.5px;
}

/* ── Показатели ── */
.client-kpi {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}
@media (max-width: 1200px) { .client-kpi { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 700px) { .client-kpi { grid-template-columns: repeat(2, 1fr); } }
.kpi-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.kpi-icon {
  width: 38px; height: 38px; min-width: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.kpi-body { min-width: 0; }
.kpi-label { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.kpi-value {
  font-size: 17px; font-weight: 700; line-height: 1.25;
  color: rgba(var(--v-theme-on-surface), 0.9);
  white-space: nowrap;
}
.kpi-sub {
  display: block;
  font-size: 11.5px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* ── Заголовки разделов ── */
.section-title {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.section-subtitle {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.section-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
  color: rgba(var(--v-theme-on-surface), 0.35);
  margin-bottom: 12px;
}

/* ── Таблица сделок ── */
.deals-scroll { overflow-x: auto; }
.deals-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase;
  letter-spacing: 0.03em; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}
.deals-table :deep(td) {
  font-size: 14px; height: 58px !important;
  padding-top: 10px !important; padding-bottom: 10px !important;
}
.deal-tr { cursor: pointer; }
.deals-table :deep(tbody tr.deal-tr:hover) { background: rgba(var(--v-theme-primary), 0.045); }
.deal-tr--locked { opacity: 0.55; }
.deal-num { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.55); white-space: nowrap; }
.deal-product {
  font-weight: 500; max-width: 260px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.deal-locked-chip {
  display: inline-flex; align-items: center; gap: 3px;
  margin-left: 6px; padding: 1px 6px; border-radius: 6px;
  font-size: 10.5px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.deal-status {
  display: inline-block;
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px; white-space: nowrap;
}
.deal-paid { color: #047857; font-weight: 600; }
.deal-rest { color: #f59e0b; font-weight: 600; }
.deal-progress { display: flex; align-items: center; gap: 8px; }
.deal-progress-text {
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); white-space: nowrap;
}
.client-more-deals {
  width: 100%; padding: 10px;
  border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.18);
  background: transparent;
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-primary));
  transition: background-color 0.15s;
}
.client-more-deals:hover:not(:disabled) { background: rgba(var(--v-theme-primary), 0.06); }
.client-more-deals:disabled { opacity: 0.6; }

/* ── Как поручитель ── */
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
.gr-metric--bad { border-color: rgba(220, 38, 38, 0.35); background: rgba(220, 38, 38, 0.04); }
.gr-metric--total { border-color: rgba(var(--v-theme-primary), 0.35); background: rgba(var(--v-theme-primary), 0.04); }
.gr-metric-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.gr-metric-value { font-size: 18px; font-weight: 700; margin-top: 2px; }
.gr-metric-sub {
  display: block; font-size: 12px; font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.gr-deals { display: flex; flex-direction: column; gap: 8px; }
.gr-deal {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px; cursor: pointer;
}
.gr-deal:hover { border-color: rgba(var(--v-theme-primary), 0.4); }
.gr-deal-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gr-deal-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.gr-deal-amount { font-weight: 600; white-space: nowrap; }
.gr-deal-overdue { font-size: 12px; color: #dc2626; white-space: nowrap; }
.gr-deal-status { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }

/* ── Отзывы и пустые состояния ── */
.review-card { padding: 4px 0; }
.empty-state {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 80px 20px; text-align: center;
}
.empty-tab {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 40px 20px;
}

/* ── Опасная зона ──
   Внизу страницы и спокойного вида: действие необратимое, но не должно
   выглядеть кнопкой, на которую тянется рука. */
.danger-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
  padding: 16px 20px; border-radius: 14px;
  border: 1px solid rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.03);
}
.danger-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(239, 68, 68, 0.1); color: #ef4444;
}
.danger-title { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); }
.danger-desc { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.danger-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 16px; border-radius: 10px;
  border: 1px solid rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.danger-btn:hover { background: rgba(239, 68, 68, 0.16); border-color: rgba(239, 68, 68, 0.45); }

/* Пояснение в окне подтверждения: что переживёт удаление, а что нет. */
.del-note {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13px; line-height: 1.45;
}
.del-note-row { display: flex; align-items: flex-start; gap: 8px; }
.del-choice {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 10px 12px 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  cursor: pointer; transition: all 0.15s;
}
.del-choice--on { border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.05); }
.del-choice-title { font-size: 13.5px; font-weight: 600; margin-top: 3px; }
.del-choice-sub {
  font-size: 12.5px; line-height: 1.4; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* ── Тёмная тема ── */
.dark .kpi-card { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
</style>
