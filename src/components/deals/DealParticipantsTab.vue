<script setup lang="ts">
/**
 * Участники сделки: клиент и поручители.
 *
 * Клиент и поручители — люди одной сделки, поэтому живут на одной вкладке:
 * у большинства сделок поручителей нет вовсе, и отдельная вкладка стояла бы
 * пустой. Сколько их — видно по счётчику на самой вкладке.
 *
 * Перенесено со страницы сделки без изменений в логике. Статистика клиента и
 * настройки напоминаний подтягиваются при первом открытии вкладки.
 */
import { computed, ref, watch, onMounted } from 'vue'
import ClientPhones from '@/components/ClientPhones.vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useDealsStore } from '@/stores/deals'
import { useToast } from '@/composables/useToast'
import { useSections } from '@/composables/useSections'
import { useSubscription } from '@/composables/useSubscription'
import { dealGuarantors } from '@/utils/dealGuarantors'
import { clientProfileName, userName, type ClientProfile, type Deal, type Payment } from '@/types'
import { formatDate, formatPhone } from '@/utils/formatters'
import ClientLink from '@/components/ClientLink.vue'
import ClientPicker from '@/components/ClientPicker.vue'
import CreateClientDialog from '@/components/CreateClientDialog.vue'

const props = defineProps<{ deal: Deal; payments: Payment[] }>()

const router = useRouter()
const dealsStore = useDealsStore()
const toast = useToast()
const sections = useSections()
const { canAccess: canAccessFeature } = useSubscription()

/** Локальные ссылки — чтобы перенесённый код остался слово в слово. */
const deal = computed(() => props.deal)
const payments = computed(() => props.payments)
const dealId = computed(() => props.deal.id)
const client = computed(() => props.deal.client || null)

/**
 * Платёжная дисциплина клиента — с сервера, по всем его сделкам у этого
 * партнёра. Раньше бралась из списка клиентов, собранного в браузере: работала
 * только если другая страница успела загрузить весь портфель, и всегда
 * показывала 100% из-за ошибки в том расчёте.
 */
const clientInfo = ref<{ onTimeRate: number } | null>(null)

watch(
  () => deal.value?.clientProfileId,
  async (profileId) => {
    clientInfo.value = null
    if (!profileId) return
    try {
      const stats = await api.get<{ finance?: { onTimeRate: number } }>(
        `/client-profiles/${profileId}/stats`,
      )
      if (stats?.finance) clientInfo.value = { onTimeRate: stats.finance.onTimeRate }
    } catch {
      // Профиль недоступен — блок дисциплины просто не показываем.
    }
  },
  { immediate: true },
)

// ── Guarantors (до 5) ──
const MAX_GUARANTORS = 5
const guarantorSaving = ref(false)
const showCreateGuarantorDialog = ref(false)
// v-model для пикера добавления нового поручителя (сбрасывается после добавления).
const guarantorPickerId = ref<string | null>(null)

// Упорядоченный список поручителей сделки (с fallback на legacy-поле).
const guarantorsList = computed<ClientProfile[]>(() =>
  deal.value ? dealGuarantors(deal.value) : [],
)
const canAddGuarantor = computed(() => guarantorsList.value.length < MAX_GUARANTORS)

// Заменить весь набор поручителей (PATCH). Порядок = порядок в массиве ids.
async function saveGuarantors(ids: string[], successMsg: string) {
  if (!deal.value) return
  guarantorSaving.value = true
  try {
    await dealsStore.updateGuarantors(deal.value.id, ids)
    // Стор уже обновил свой кэш, из которого приходит props.deal — на
    // странице здесь стояло присваивание в computed, то есть ничего не делало.
    toast.success(successMsg)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось сохранить поручителей')
  } finally {
    guarantorSaving.value = false
  }
}

async function onGuarantorSelected(profile: ClientProfile | null) {
  guarantorPickerId.value = null
  if (!profile || !deal.value) return
  const current = guarantorsList.value
  if (current.some((g) => g.id === profile.id)) {
    toast.error('Этот поручитель уже добавлен')
    return
  }
  if (current.length >= MAX_GUARANTORS) {
    toast.error(`Можно добавить не больше ${MAX_GUARANTORS} поручителей`)
    return
  }
  await saveGuarantors([...current.map((g) => g.id), profile.id], 'Поручитель добавлен')
}

async function onGuarantorCreated(profile: ClientProfile) {
  await onGuarantorSelected(profile)
}

async function removeGuarantorAt(index: number) {
  const ids = guarantorsList.value.map((g) => g.id)
  ids.splice(index, 1)
  await saveGuarantors(ids, 'Поручитель убран')
}

const sendingReminder = ref(false)

// Per-deal reminder settings
const dealReminderCustom = ref(false)
const dealReminderEnabled = ref(true)
const dealReminderDays = ref(3)

async function loadDealReminder() {
  if (!dealId.value) return
  try {
    const data = await api.get<any>(`/whatsapp/deal/${dealId.value}/settings`)
    if (data?.useCustom) {
      dealReminderCustom.value = true
      dealReminderEnabled.value = data.enabled !== false
      dealReminderDays.value = data.daysBefore || 3
    }
  } catch {}
}

async function toggleDealReminder(useCustom: boolean | null) {
  if (!useCustom) {
    await api.patch(`/whatsapp/deal/${dealId.value}/settings`, { useCustom: false })
    dealReminderCustom.value = false
  } else {
    dealReminderCustom.value = true
    await saveDealReminder()
  }
}

async function saveDealReminder() {
  try {
    await api.patch(`/whatsapp/deal/${dealId.value}/settings`, {
      useCustom: true,
      enabled: dealReminderEnabled.value,
      daysBefore: dealReminderDays.value,
    })
  } catch {}
}

// Раньше запрос уходил при открытии ЛЮБОЙ сделки, даже когда WhatsApp
// не подключён и раздел недоступен — лишний трафик и ошибка в консоли.
onMounted(() => { if (sections.visible('whatsapp')) loadDealReminder() })

async function sendApiReminder() {
  if (!deal.value) return
  sendingReminder.value = true
  try {
    const result = await api.post<{ sent: boolean; error?: string }>(`/whatsapp/remind/${deal.value.id}`)
    if (result.sent) {
      toast.success('Напоминание отправлено в WhatsApp')
    } else {
      toast.error(result.error || 'Не удалось отправить')
    }
  } catch (e: any) {
    toast.error(e.message || 'Ошибка отправки')
  } finally {
    sendingReminder.value = false
  }
}


// Change client
const showChangeClient = ref(false)
const changingClient = ref(false)

async function onChangeClient(profile: import('@/types').ClientProfile | null) {
  if (!profile || !deal.value) return
  changingClient.value = true
  try {
    await dealsStore.updateClient(deal.value.id, profile.id)
    // См. выше: обновление приходит из стора, присваивать здесь нечего.
    showChangeClient.value = false
    toast.success('Клиент изменён')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка смены клиента')
  } finally {
    changingClient.value = false
  }
}
</script>

<template>
  <!-- Клиент и поручители рядом: это люди одной сделки, и держать их друг под
       другом значит гонять взгляд по пустой правой половине экрана. -->
  <div class="pt-cols">
<!-- Client profile card -->
<v-card v-if="deal.clientProfile" rounded="lg" elevation="0" border class="pa-5 mb-6">
  <div class="d-flex align-center justify-space-between mb-4">
    <div class="section-title mb-0">Клиент</div>
    <button v-if="!deal.deletedAt && !showChangeClient" class="ci-add-btn" style="background: rgba(4,120,87,0.1); color: #047857;" @click="showChangeClient = true">
      <v-icon icon="mdi-swap-horizontal" size="14" />
      Сменить
    </button>
  </div>

  <!-- Change client picker -->
  <div v-if="showChangeClient" class="mb-4">
    <ClientPicker
      :model-value="null"
      label="Выберите нового клиента..."
      @selected="onChangeClient"
    />
    <button class="btn-secondary mt-2" style="font-size: 12px; height: 32px; padding: 0 12px;" @click="showChangeClient = false">
      Отмена
    </button>
  </div>

  <router-link :to="`/clients/${deal.clientProfileId}`" class="profile-card-link">
    <div class="d-flex align-center ga-3 mb-4">
      <div class="profile-avatar profile-avatar--client">{{ (deal.clientProfile.firstName || '')[0] || '' }}{{ (deal.clientProfile.lastName || '')[0] || '' }}</div>
      <div class="flex-grow-1">
        <div class="font-weight-bold">{{ clientProfileName(deal.clientProfile) }}</div>
        <div class="text-caption text-medium-emphasis d-flex align-center ga-2">
          <v-icon icon="mdi-phone" size="12" />
          {{ formatPhone(deal.clientProfile.phone) }}
        </div>
      </div>
      <v-icon icon="mdi-chevron-right" size="18" class="text-medium-emphasis" />
    </div>
  </router-link>

  <div class="profile-details-list">
    <template v-if="deal.clientProfile.passportSeries || deal.clientProfile.passportNumber">
      <div class="profile-detail-row">
        <span class="profile-detail-label">Паспорт</span>
        <span class="profile-detail-value">{{ deal.clientProfile.passportSeries }} {{ deal.clientProfile.passportNumber }}</span>
      </div>
      <div v-if="deal.clientProfile.passportIssuedBy" class="profile-detail-row">
        <span class="profile-detail-label">Кем выдан</span>
        <span class="profile-detail-value">{{ deal.clientProfile.passportIssuedBy }}</span>
      </div>
      <div v-if="deal.clientProfile.passportIssuedAt" class="profile-detail-row">
        <span class="profile-detail-label">Дата выдачи</span>
        <span class="profile-detail-value">{{ formatDate(deal.clientProfile.passportIssuedAt) }}</span>
      </div>
    </template>
    <div v-else class="profile-detail-hint">
      <v-icon icon="mdi-information-outline" size="14" />
      Паспортные данные не заполнены
    </div>

    <div v-if="deal.clientProfile.birthDate" class="profile-detail-row">
      <span class="profile-detail-label">Дата рождения</span>
      <span class="profile-detail-value">{{ formatDate(deal.clientProfile.birthDate) }}</span>
    </div>
    <div v-if="deal.clientProfile.registrationAddress" class="profile-detail-row">
      <span class="profile-detail-label">Адрес регистрации</span>
      <span class="profile-detail-value">{{ deal.clientProfile.registrationAddress }}</span>
    </div>
    <div v-if="deal.clientProfile.residentialAddress" class="profile-detail-row">
      <span class="profile-detail-label">Адрес проживания</span>
      <span class="profile-detail-value">{{ deal.clientProfile.residentialAddress }}</span>
    </div>
  </div>

  <!-- Дополнительные номера: когда клиент не берёт трубку, звонить надо
       отсюда, а не искать его карточку в разделе «Клиенты». -->
  <div v-if="deal.clientProfile.extraPhones?.length" class="mt-4">
    <ClientPhones :profile-id="deal.clientProfile.id" :initial="deal.clientProfile.extraPhones" readonly />
  </div>

  <div v-if="clientInfo" class="mt-4">
    <div class="client-info-label mb-1">Своевременность платежей</div>
    <div class="d-flex align-center ga-2">
      <v-progress-linear
        :model-value="clientInfo.onTimeRate"
        :color="clientInfo.onTimeRate >= 90 ? 'success' : clientInfo.onTimeRate >= 70 ? 'warning' : 'error'"
        rounded height="6" class="flex-grow-1"
      />
      <span class="text-caption font-weight-bold">{{ clientInfo.onTimeRate }}%</span>
    </div>
  </div>

  <!-- Reminder buttons (PRO+) -->
  <template v-if="canAccessFeature('whatsapp')">
    <div v-if="deal.clientProfile.phone && deal.status === 'ACTIVE'" class="d-flex ga-2 mt-4" style="flex-wrap: wrap;">
      <button class="reminder-btn reminder-btn--api" :disabled="sendingReminder" @click="sendApiReminder">
        <v-progress-circular v-if="sendingReminder" indeterminate size="14" width="2" />
        <v-icon v-else icon="mdi-whatsapp" size="16" />
        {{ sendingReminder ? 'Отправка...' : 'Напомнить в WhatsApp' }}
      </button>
    </div>

    <!-- Per-deal reminder settings -->
    <div class="deal-reminder-settings mt-4">
      <div class="d-flex align-center justify-space-between mb-2">
        <span class="text-caption font-weight-bold" style="opacity: 0.6;">Настройки напоминаний</span>
        <v-switch
          v-model="dealReminderCustom"
          density="compact"
          hide-details
          color="primary"
          :label="dealReminderCustom ? 'Свои настройки' : 'Глобальные'"
          style="flex: none;"
          @update:model-value="toggleDealReminder"
        />
      </div>

      <div v-if="dealReminderCustom" class="deal-reminder-fields">
        <div class="d-flex align-center ga-3 mb-2">
          <span class="text-caption">Вкл/выкл</span>
          <v-switch v-model="dealReminderEnabled" density="compact" hide-details color="primary" style="flex: none;" @update:model-value="saveDealReminder" />
        </div>
        <div v-if="dealReminderEnabled" class="d-flex align-center ga-2 flex-wrap">
          <span class="text-caption" style="opacity: 0.6;">За</span>
          <button
            v-for="d in [1,2,3,5,7]" :key="d"
            class="deal-day-chip"
            :class="{ active: dealReminderDays === d }"
            @click="dealReminderDays = d; saveDealReminder()"
          >{{ d }} дн</button>
          <span class="text-caption" style="opacity: 0.6;">до платежа</span>
        </div>
      </div>
      <div v-else class="text-caption text-medium-emphasis">
        Используются глобальные настройки из раздела WhatsApp
      </div>
    </div>
  </template>
</v-card>

<!-- Fallback: old client card (platform or external) -->
<v-card v-else-if="client || deal.clientProfile || deal.externalClientName" rounded="lg" elevation="0" border class="pa-5 mb-6">
  <div class="section-title mb-4">Клиент</div>

  <!-- Platform client -->
  <div v-if="client" class="d-flex align-center ga-3 mb-4" style="cursor: pointer;" @click="router.push(deal.clientProfileId ? `/clients/${deal.clientProfileId}` : `/clients/${deal.clientId}`)">
    <div class="client-avatar">{{ (client.firstName || '')[0] || '' }}{{ (client.lastName || '')[0] || '' }}</div>
    <div class="flex-grow-1">
      <div class="font-weight-bold">{{ userName(client) }}</div>
      <div class="text-caption text-medium-emphasis">{{ client.city || '' }}</div>
    </div>
    <v-icon icon="mdi-chevron-right" size="18" class="text-medium-emphasis" />
  </div>

  <!-- External client -->
  <div v-else-if="deal.externalClientName" class="d-flex align-center ga-3 mb-4">
    <div class="client-avatar" style="background: #6366f1;">{{ deal.externalClientName[0] }}</div>
    <div class="flex-grow-1">
      <div class="font-weight-bold">{{ deal.externalClientName }}</div>
      <div class="text-caption text-medium-emphasis d-flex align-center ga-2">
        <span v-if="deal.externalClientPhone">{{ deal.externalClientPhone }}</span>
        <span class="external-client-badge">Внешний клиент</span>
      </div>
    </div>
  </div>

  <div v-if="client" class="client-info-grid">
    <div class="client-info-item">
      <v-icon icon="mdi-star" size="16" color="warning" />
      <div>
        <div class="client-info-label">Рейтинг</div>
        <div class="client-info-value">{{ client.rating ?? 0 }}</div>
      </div>
    </div>
    <div class="client-info-item">
      <v-icon icon="mdi-check-decagram" size="16" color="primary" />
      <div>
        <div class="client-info-label">Завершено</div>
        <div class="client-info-value">{{ client.completedDeals ?? 0 }} сделок</div>
      </div>
    </div>
    <div v-if="client.phone" class="client-info-item">
      <v-icon icon="mdi-phone" size="16" color="info" />
      <div>
        <div class="client-info-label">Телефон</div>
        <div class="client-info-value">{{ formatPhone(client.phone) }}</div>
      </div>
    </div>
  </div>

  <div v-if="clientInfo" class="mt-4">
    <div class="client-info-label mb-1">Своевременность платежей</div>
    <div class="d-flex align-center ga-2">
      <v-progress-linear
        :model-value="clientInfo.onTimeRate"
        :color="clientInfo.onTimeRate >= 90 ? 'success' : clientInfo.onTimeRate >= 70 ? 'warning' : 'error'"
        rounded height="6" class="flex-grow-1"
      />
      <span class="text-caption font-weight-bold">{{ clientInfo.onTimeRate }}%</span>
    </div>
  </div>

  <!-- Reminder buttons (PRO+) -->
  <template v-if="canAccessFeature('whatsapp')">
    <div v-if="(client?.phone || deal?.externalClientPhone) && deal?.status === 'ACTIVE'" class="d-flex ga-2 mt-4" style="flex-wrap: wrap;">
      <button class="reminder-btn reminder-btn--api" :disabled="sendingReminder" @click="sendApiReminder">
        <v-progress-circular v-if="sendingReminder" indeterminate size="14" width="2" />
        <v-icon v-else icon="mdi-whatsapp" size="16" />
        {{ sendingReminder ? 'Отправка...' : 'Напомнить в WhatsApp' }}
      </button>
    </div>

    <!-- Per-deal reminder settings -->
    <div class="deal-reminder-settings mt-4">
      <div class="d-flex align-center justify-space-between mb-2">
        <span class="text-caption font-weight-bold" style="opacity: 0.6;">Настройки напоминаний</span>
        <v-switch
          v-model="dealReminderCustom"
          density="compact"
          hide-details
          color="primary"
          :label="dealReminderCustom ? 'Свои настройки' : 'Глобальные'"
          style="flex: none;"
          @update:model-value="toggleDealReminder"
        />
      </div>

      <div v-if="dealReminderCustom" class="deal-reminder-fields">
        <div class="d-flex align-center ga-3 mb-2">
          <span class="text-caption">Вкл/выкл</span>
          <v-switch v-model="dealReminderEnabled" density="compact" hide-details color="primary" style="flex: none;" @update:model-value="saveDealReminder" />
        </div>
        <div v-if="dealReminderEnabled" class="d-flex align-center ga-2 flex-wrap">
          <span class="text-caption" style="opacity: 0.6;">За</span>
          <button
            v-for="d in [1,2,3,5,7]" :key="d"
            class="deal-day-chip"
            :class="{ active: dealReminderDays === d }"
            @click="dealReminderDays = d; saveDealReminder()"
          >{{ d }} дн</button>
          <span class="text-caption" style="opacity: 0.6;">до платежа</span>
        </div>
      </div>
      <div v-else class="text-caption text-medium-emphasis">
        Используются глобальные настройки из раздела WhatsApp
      </div>
    </div>
  </template>
</v-card>

<!-- Guarantors card (до 5) -->
<v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
  <div class="d-flex align-center justify-space-between mb-4">
    <div class="d-flex align-center ga-2">
      <v-icon icon="mdi-shield-account" size="18" style="color: #6366f1;" />
      <div class="section-title">
        Поручители
        <span v-if="guarantorsList.length" class="text-caption text-medium-emphasis">({{ guarantorsList.length }}/{{ MAX_GUARANTORS }})</span>
      </div>
    </div>
  </div>

  <!-- Existing guarantors (по порядку, первый = основной) -->
  <template v-for="(g, gi) in guarantorsList" :key="g.id">
    <div class="guarantor-item" :class="{ 'guarantor-item--divided': gi > 0 }">
      <div class="d-flex align-center justify-space-between mb-2">
        <span class="guarantor-item__badge" :class="{ 'guarantor-item__badge--main': gi === 0 }">
          {{ gi === 0 ? 'Основной поручитель' : `Поручитель ${gi + 1}` }}
        </span>
        <v-btn
          v-if="!deal.deletedAt"
          variant="text"
          size="x-small"
          color="error"
          prepend-icon="mdi-close"
          :loading="guarantorSaving"
          @click="removeGuarantorAt(gi)"
        >
          Убрать
        </v-btn>
      </div>

      <router-link :to="`/clients/${g.id}`" class="profile-card-link">
        <div class="d-flex align-center ga-3 mb-3">
          <div class="profile-avatar profile-avatar--guarantor">{{ (g.firstName || '')[0] || '' }}{{ (g.lastName || '')[0] || '' }}</div>
          <div class="flex-grow-1">
            <div class="font-weight-bold">{{ clientProfileName(g) }}</div>
            <div class="text-caption text-medium-emphasis d-flex align-center ga-2">
              <v-icon icon="mdi-phone" size="12" />
              {{ formatPhone(g.phone) }}
            </div>
          </div>
          <v-icon icon="mdi-chevron-right" size="18" class="text-medium-emphasis" />
        </div>
      </router-link>

      <div class="profile-details-list">
        <template v-if="g.passportSeries || g.passportNumber">
          <div class="profile-detail-row">
            <span class="profile-detail-label">Паспорт</span>
            <span class="profile-detail-value">{{ g.passportSeries }} {{ g.passportNumber }}</span>
          </div>
          <div v-if="g.passportIssuedBy" class="profile-detail-row">
            <span class="profile-detail-label">Кем выдан</span>
            <span class="profile-detail-value">{{ g.passportIssuedBy }}</span>
          </div>
          <div v-if="g.passportIssuedAt" class="profile-detail-row">
            <span class="profile-detail-label">Дата выдачи</span>
            <span class="profile-detail-value">{{ formatDate(g.passportIssuedAt) }}</span>
          </div>
        </template>
        <div v-else class="profile-detail-hint">
          <v-icon icon="mdi-information-outline" size="14" />
          Паспортные данные не заполнены
        </div>
      </div>
    </div>
  </template>

  <!-- Add guarantor — picker + create (пока не достигнут лимит) -->
  <template v-if="!deal.deletedAt && canAddGuarantor">
    <div class="guarantor-picker-wrap" :class="{ 'mt-4': guarantorsList.length }">
      <ClientPicker
        v-model="guarantorPickerId"
        :label="guarantorsList.length ? 'Добавить ещё поручителя...' : 'Найти поручителя по телефону или имени...'"
        @selected="onGuarantorSelected"
      />
    </div>
    <button class="create-client-btn" type="button" @click="showCreateGuarantorDialog = true">
      <div class="create-client-btn__icon">
        <v-icon icon="mdi-account-plus-outline" size="20" />
      </div>
      <div>
        <div class="create-client-btn__title">Создать нового клиента</div>
        <div class="create-client-btn__sub">Добавить поручителя с паспортными данными</div>
      </div>
    </button>
    <CreateClientDialog v-model="showCreateGuarantorDialog" @created="onGuarantorCreated" />
  </template>

  <!-- Лимит достигнут -->
  <div v-else-if="!deal.deletedAt && !canAddGuarantor" class="profile-detail-hint mt-3">
    <v-icon icon="mdi-information-outline" size="14" />
    Достигнут лимит: не больше {{ MAX_GUARANTORS }} поручителей
  </div>

  <!-- Deleted deal, no guarantors -->
  <div v-else-if="!guarantorsList.length" class="text-body-2 text-medium-emphasis">Не назначен</div>
</v-card>
  </div>
</template>

<style scoped>
.pt-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 16px;
  align-items: start;
}
/* Карточки внутри колонок не должны тащить свой нижний отступ: расстояние
   задаёт сетка. */
.pt-cols > * {
  margin-bottom: 0 !important;
}

/* Кнопка «Создать нового клиента»: раньше её оформление жило в другом блоке
   страницы, и после переноса она осталась нативной. */
.create-client-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.18);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
}
.create-client-btn:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.04);
}
.create-client-btn__icon {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.create-client-btn__title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.create-client-btn__sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.guarantor-picker-wrap {
  margin-top: 4px;
}

/* Стили перенесены со страницы сделки без изменений. */
.client-avatar {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  background: #3b82f6; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 15px;
}
.client-info-grid {
  display: flex; flex-direction: column; gap: 12px;
}
.client-info-item {
  display: flex; align-items: center; gap: 10px;
}
.client-info-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.client-info-value {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.reminder-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px; border-radius: 10px;
  font-size: 13px; font-weight: 600;
  border: none; cursor: pointer;
  transition: all 0.15s;
}
.reminder-btn--wa {
  background: rgba(37, 211, 102, 0.08); color: #25D366;
}
.reminder-btn--wa:hover {
  background: rgba(37, 211, 102, 0.15);
}
.reminder-btn--tg {
  background: rgba(34, 158, 217, 0.08); color: #229ED9;
}
.reminder-btn--tg:hover {
  background: rgba(34, 158, 217, 0.15);
}
.reminder-btn--api {
  background: #25d366 !important;
  color: #fff !important;
  border: none;
  flex: 1;
}
.reminder-btn--api:hover { background: #1da851 !important; }
.reminder-btn--api:disabled { opacity: 0.5; }
.profile-card-link {
  text-decoration: none;
  color: inherit;
  display: block;
  border-radius: 12px;
  transition: background 0.15s;
  margin: -8px;
  padding: 8px;
}
.profile-card-link:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.profile-avatar {
  width: 48px; height: 48px; min-width: 48px; border-radius: 12px;
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 16px; text-transform: uppercase;
}
.profile-avatar--client { background: #047857; }
.profile-avatar--guarantor { background: #6366f1; }
.profile-avatar--coinvestor { background: #f59e0b; }
.profile-details-list {
  display: flex; flex-direction: column; gap: 10px;
}
.profile-detail-row {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  gap: 16px;
}
.profile-detail-row:last-child { border-bottom: none; padding-bottom: 0; }
.profile-detail-label {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap; flex-shrink: 0;
}
.profile-detail-value {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
  text-align: right;
}
.profile-detail-hint {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.35);
  padding: 8px 0;
}
.guarantor-item--divided {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  padding-top: 14px;
  margin-top: 14px;
}
.guarantor-item__badge {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.guarantor-item__badge--main {
  color: #6366f1;
}
.guarantor-picker-wrap {
  margin-bottom: 12px;
}
.guarantor-picker-wrap :deep(.v-autocomplete) {
  --v-input-control-height: 44px;
}
.guarantor-picker-wrap :deep(.v-field) {
  border-radius: 10px;
  font-size: 14px;
}
/* Кнопки «Сменить» и «Отмена»: на странице сделки эти классы были общими с
   другими блоками, здесь нужны свои копии — иначе кнопки остаются нативными. */
.ci-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 14px; border-radius: 8px; border: none;
  background: rgba(245, 158, 11, 0.1); color: #f59e0b;
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.ci-add-btn:hover { background: rgba(245, 158, 11, 0.18); }
.ci-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

/* Общие для карточек участников — на странице сделки они были общими
   с другими блоками, здесь нужны свои копии. */
.section-title { font-size: 15px; font-weight: 600; }
.section-subtitle { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.btn-sm--outline {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.btn-sm--outline:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  color: rgb(var(--v-theme-primary));
}
.btn-sm--outline:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
