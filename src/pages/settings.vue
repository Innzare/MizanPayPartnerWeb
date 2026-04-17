<script lang="ts" setup>
import { useAuthStore } from '@/stores/auth'
import { formatPhone, formatDate, PHONE_MASK } from '@/utils/formatters'
import { CITIES } from '@/constants/cities'

import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useSubscription } from '@/composables/useSubscription'
import { api } from '@/api/client'
import QRCode from 'qrcode'

const { isDark } = useIsDark()
const toast = useToast()
const authStore = useAuthStore()
const { canAccess: canAccessFeature, plan: currentPlan, isFree } = useSubscription()
const settingsPlanLabels: Record<string, string> = { PRO: 'Стандарт', BUSINESS: 'Бизнес', PREMIUM: 'Премиум' }

// Tabs
const route = useRoute()
const validTabs = ['profile', 'security', 'whatsapp', 'export', 'subscription'] as const
type TabId = typeof validTabs[number]
const initTab = validTabs.includes(route.query.tab as TabId) ? route.query.tab as TabId : 'profile'
const activeTab = ref<TabId>(initTab)

// WhatsApp
const waStatus = ref<'disconnected' | 'connecting' | 'connected' | 'loading'>('loading')
const waQrCode = ref<string | null>(null)
const waPolling = ref<ReturnType<typeof setInterval> | null>(null)

async function checkWhatsAppStatus() {
  try {
    const result = await api.get<{ status: string; connected: boolean }>('/whatsapp/session/status')
    waStatus.value = result.connected ? 'connected' : 'disconnected'
    if (result.connected) loadWaSettings()
  } catch {
    waStatus.value = 'disconnected'
  }
}

async function connectWhatsApp() {
  waStatus.value = 'connecting'
  try {
    await api.post('/whatsapp/session')
    const qrResult = await api.get<{ qr: string | null; status: string }>('/whatsapp/session/qr')
    if (qrResult.qr) {
      waQrCode.value = await QRCode.toDataURL(qrResult.qr, { width: 260, margin: 2 })
    }

    // Poll for connection
    waPolling.value = setInterval(async () => {
      const status = await api.get<{ status: string; connected: boolean }>('/whatsapp/session/status')
      if (status.connected) {
        waStatus.value = 'connected'
        waQrCode.value = null
        if (waPolling.value) clearInterval(waPolling.value)
        toast.success('WhatsApp подключён!')
        loadWaSettings()
      }
    }, 3000)

    // Stop polling after 2 minutes
    setTimeout(() => {
      if (waPolling.value) {
        clearInterval(waPolling.value)
        if (waStatus.value === 'connecting') {
          waStatus.value = 'disconnected'
          waQrCode.value = null
          toast.error('Время ожидания истекло. Попробуйте снова.')
        }
      }
    }, 120000)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка подключения')
    waStatus.value = 'disconnected'
  }
}

async function disconnectWhatsApp() {
  if (!confirm('Отключить WhatsApp? Напоминания перестанут отправляться.')) return
  try {
    await api.delete('/whatsapp/session')
    waStatus.value = 'disconnected'
    toast.success('WhatsApp отключён')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка отключения')
  }
}

// WhatsApp reminder settings
const waSettings = ref({
  enabled: false,
  daysBefore: 3,
  remindOverdue: true,
  sendTime: '10:00',
  template: 'Здравствуйте, {клиент}! Напоминаем об оплате по рассрочке: {товар} — {сумма}, срок: {дата}.{телефон_строка}',
  overdueTemplate: 'Здравствуйте, {клиент}! У вас просрочен платёж по рассрочке: {товар} — {сумма}, срок был: {дата}. Просим оплатить как можно скорее.{телефон_строка}',
})
const savingSettings = ref(false)
const daysOptions = [1, 2, 3, 5, 7]
const templateVars = ['{сумма}', '{товар}', '{дата}', '{клиент}', '{телефон_строка}']

const templateRef = ref<HTMLTextAreaElement | null>(null)
const overdueTemplateRef = ref<HTMLTextAreaElement | null>(null)

async function loadWaSettings() {
  try {
    const data = await api.get<any>('/whatsapp/settings')
    waSettings.value = { ...waSettings.value, ...data }
  } catch {}
}

async function saveWaSettings() {
  savingSettings.value = true
  try {
    await api.patch('/whatsapp/settings', waSettings.value)
    toast.success('Настройки сохранены')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  } finally {
    savingSettings.value = false
  }
}

function previewTemplate(tpl: string): string {
  return tpl
    .replace(/\{сумма\}/g, '15 000 ₽')
    .replace(/\{товар\}/g, 'iPhone 15 Pro')
    .replace(/\{дата\}/g, '15 апреля')
    .replace(/\{клиент\}/g, 'Ахмед')
    .replace(/\{телефон_строка\}/g, '\nПо вопросам: +7 928 000 00 00')
}

function insertVar(field: 'template' | 'overdueTemplate', variable: string) {
  const textarea = field === 'template' ? templateRef.value : overdueTemplateRef.value
  if (!textarea) {
    waSettings.value[field] += variable
    return
  }
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const text = waSettings.value[field]
  waSettings.value[field] = text.substring(0, start) + variable + text.substring(end)
  nextTick(() => {
    const pos = start + variable.length
    textarea.selectionStart = pos
    textarea.selectionEnd = pos
    textarea.focus()
  })
}

onMounted(() => {
  checkWhatsAppStatus()
})

// Export Excel
const exporting = ref(false)

async function exportExcel() {
  exporting.value = true
  try {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/export/excel`, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.message || 'Ошибка экспорта')
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `MizanPay_Export_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Файл скачан')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка экспорта')
  } finally {
    exporting.value = false
  }
}

// Delete account
const deletingAccount = ref(false)

async function confirmDeleteAccount() {
  if (!confirm('Удалить аккаунт? Все данные будут удалены безвозвратно. Это действие необратимо.')) return
  deletingAccount.value = true
  try {
    await api.delete('/auth/investor/account')
    toast.success('Аккаунт удалён')
    authStore.logout()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить аккаунт')
  } finally {
    deletingAccount.value = false
  }
}

const tabs = [
  { id: 'profile' as const, label: 'Профиль', icon: 'mdi-account-outline' },
  { id: 'security' as const, label: 'Безопасность', icon: 'mdi-shield-lock-outline' },
  { id: 'whatsapp' as const, label: 'WhatsApp', icon: 'mdi-whatsapp' },
  { id: 'export' as const, label: 'Экспорт', icon: 'mdi-download-outline' },
  { id: 'subscription' as const, label: 'Подписка', icon: 'mdi-crown-outline' },
]

// Profile editing
const isEditing = ref(false)
const editForm = ref({
  firstName: '',
  lastName: '',
  patronymic: '',
  phone: '',
  city: '',
  birthDate: '',
})
const profileSaving = ref(false)
const profileSaved = ref(false)

function startEditing() {
  if (!authStore.user) return
  editForm.value = {
    firstName: authStore.user.firstName,
    lastName: authStore.user.lastName,
    patronymic: authStore.user.patronymic || '',
    phone: authStore.user.phone,
    city: authStore.user.city,
    birthDate: (authStore.user as any).birthDate?.slice(0, 10) || '',
  }
  removeAvatarFile()
  isEditing.value = true
}

function cancelEditing() {
  removeAvatarFile()
  isEditing.value = false
}

async function saveProfile() {
  profileSaving.value = true
  try {
    let avatarUrl: string | undefined
    if (avatarFile.value) {
      avatarUrl = await api.upload(avatarFile.value, 'avatars')
    }
    await authStore.updateProfile({
      firstName: editForm.value.firstName,
      lastName: editForm.value.lastName,
      patronymic: editForm.value.patronymic || undefined,
      phone: editForm.value.phone,
      city: editForm.value.city,
      birthDate: editForm.value.birthDate || undefined,
      ...(avatarUrl ? { avatar: avatarUrl } : {}),
    } as any)
    removeAvatarFile()
    isEditing.value = false
    toast.success('Профиль сохранён')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения профиля')
  } finally {
    profileSaving.value = false
  }
}

// Avatar upload
const avatarFile = ref<File | null>(null)
const avatarPreview = ref('')
const avatarInputRef = ref<HTMLInputElement | null>(null)

function onAvatarSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value)
  avatarFile.value = file
  avatarPreview.value = URL.createObjectURL(file)
  input.value = ''
}

function removeAvatarFile() {
  if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value)
  avatarFile.value = null
  avatarPreview.value = ''
}

const profileFormValid = computed(() =>
  editForm.value.firstName.trim() &&
  editForm.value.lastName.trim() &&
  editForm.value.phone.trim() &&
  editForm.value.city
)

// Password
const passwordForm = ref({
  current: '',
  new: '',
  confirm: '',
})
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const passwordSaving = ref(false)
const passwordSaved = ref(false)
const passwordError = ref('')

const passwordFormValid = computed(() =>
  passwordForm.value.current.length >= 6 &&
  passwordForm.value.new.length >= 6 &&
  passwordForm.value.new === passwordForm.value.confirm
)

const passwordMismatch = computed(() =>
  passwordForm.value.confirm.length > 0 &&
  passwordForm.value.new !== passwordForm.value.confirm
)

async function changePassword() {
  if (!passwordFormValid.value) return
  passwordSaving.value = true
  passwordError.value = ''
  try {
    await authStore.changePassword(passwordForm.value.current, passwordForm.value.new)
    passwordForm.value = { current: '', new: '', confirm: '' }
    toast.success('Пароль изменён')
  } catch (e: any) {
    toast.error(e.message || 'Неверный текущий пароль')
  } finally {
    passwordSaving.value = false
  }
}

// Verification
const verificationLabels: Record<number, string> = {
  0: 'Не верифицирован',
  1: 'Телефон подтверждён',
  2: 'Документ проверен',
  3: 'Полная верификация',
}

const verificationSteps = [
  { level: 1, label: 'Телефон', icon: 'mdi-phone-check' },
  { level: 2, label: 'Документ', icon: 'mdi-card-account-details' },
  { level: 3, label: 'Селфи', icon: 'mdi-face-recognition' },
]

// Subscription
const planLabels: Record<string, string> = {
  FREE: 'Без подписки',
  PRO: 'Стандарт',
  BUSINESS: 'Бизнес',
  PREMIUM: 'Премиум',
}

const showContactDialog = ref(false)
const selectedPlan = ref<typeof plans[number] | null>(null)
const dialogPeriod = ref<'monthly' | 'yearly'>('monthly')
const billingPeriod = ref<'monthly' | 'yearly'>('monthly')
const requestMessage = ref('')
const requestSending = ref(false)
const requestSent = ref(false)

function selectPlan(plan: typeof plans[number]) {
  if (plan.id === authStore.user?.subscriptionPlan) return
  selectedPlan.value = plan
  dialogPeriod.value = billingPeriod.value
  requestMessage.value = ''
  requestSent.value = false
  showContactDialog.value = true
}

const dialogPrice = computed(() => {
  if (!selectedPlan.value) return ''
  return dialogPeriod.value === 'yearly' ? selectedPlan.value.yearlyPrice : selectedPlan.value.monthlyPrice
})

const dialogTotalPrice = computed(() => {
  if (!selectedPlan.value) return ''
  if (dialogPeriod.value === 'yearly') return selectedPlan.value.yearlyTotal
  return ''
})

async function sendSubscriptionRequest() {
  if (!selectedPlan.value || requestSending.value) return
  requestSending.value = true
  try {
    const price = dialogPeriod.value === 'yearly'
      ? `${selectedPlan.value.yearlyPrice}/мес (${selectedPlan.value.yearlyTotal})`
      : `${selectedPlan.value.monthlyPrice}/мес`
    await api.post('/auth/investor/subscription-request', {
      plan: selectedPlan.value.label,
      period: dialogPeriod.value === 'yearly' ? 'Ежегодно' : 'Ежемесячно',
      price,
      message: requestMessage.value || undefined,
    })
    requestSent.value = true
    toast.success('Заявка отправлена!')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка отправки')
  } finally {
    requestSending.value = false
  }
}

const plans = [
  {
    id: 'FREE' as const,
    label: 'Без подписки',
    monthlyPrice: '0 ₽',
    yearlyPrice: '0 ₽',
    priceNote: 'навсегда',
    yearlyTotal: '',
    yearlySaving: '',
    responsePrice: '500 ₽',
    features: [
      'До 3 активных сделок',
      'Отклик на заявку — 500 ₽',
    ],
    limitations: [
      'Нет аналитики',
      'Нет PDF договоров',
      'Нет экспорта PDF',
      'Нет экспорта в Excel',
      'Нет импорта из Excel',
      'Нет WhatsApp-напоминаний',
      'Нет со-инвесторов',
      'Нет сотрудников',
      'Нет раздела «Мой капитал»',
      'Нет реестра клиентов',
      'Нет истории действий',
      'Нет календаря платежей',
    ],
    icon: 'mdi-gift-outline',
  },
  {
    id: 'PRO' as const,
    label: 'Стандарт',
    monthlyPrice: '3 900 ₽',
    yearlyPrice: '3 100 ₽',
    priceNote: 'в месяц',
    yearlyTotal: '37 200 ₽ / год',
    yearlySaving: 'Экономия 9 600 ₽',
    responsePrice: '300 ₽',
    features: [
      'До 15 активных сделок',
      'Отклик на заявку — 300 ₽',
      'Аналитика (KPI цифры)',
      'Экспорт PDF',
      'PDF договора',
      'Со-инвесторы, сотрудники',
      'Мой капитал, реестр клиентов',
      'История действий',
    ],
    limitations: [
      'Нет графиков в аналитике',
      'Нет экспорта в Excel',
      'Нет импорта из Excel',
      'Нет WhatsApp-напоминаний',
      'Нет календаря платежей',
    ],
    icon: 'mdi-star-outline',
  },
  {
    id: 'BUSINESS' as const,
    label: 'Бизнес',
    monthlyPrice: '7 900 ₽',
    yearlyPrice: '6 300 ₽',
    priceNote: 'в месяц',
    yearlyTotal: '75 600 ₽ / год',
    yearlySaving: 'Экономия 19 200 ₽',
    responsePrice: '100 ₽',
    includesFrom: 'Все функции Стандарт',
    features: [
      'До 50 активных сделок',
      'Отклик на заявку — 100 ₽',
      'Полная аналитика + графики',
      'Экспорт PDF / Excel',
      'Импорт из Excel',
      'WhatsApp-напоминания',
      'Календарь платежей',
    ],
    limitations: [],
    icon: 'mdi-rocket-launch-outline',
    popular: true,
  },
  {
    id: 'PREMIUM' as const,
    label: 'Премиум',
    monthlyPrice: '11 900 ₽',
    yearlyPrice: '9 500 ₽',
    priceNote: 'в месяц',
    yearlyTotal: '114 000 ₽ / год',
    yearlySaving: 'Экономия 28 800 ₽',
    responsePrice: 'Бесплатно',
    includesFrom: 'Все функции Бизнес',
    features: [
      'Безлимит активных сделок',
      'Отклик на заявку — бесплатно',
    ],
    limitations: [],
    icon: 'mdi-crown-outline',
  },
]
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Page header -->
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-icon-wrap">
          <v-icon icon="mdi-cog-outline" size="22" />
        </div>
        <div>
          <div class="page-title">Настройки</div>
          <div class="page-subtitle">Управление профилем и безопасностью</div>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="settings-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="settings-tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        <v-icon :icon="tab.icon" size="18" />
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- Profile Tab -->
    <div v-if="activeTab === 'profile'" class="tab-content">
      <v-row>
        <!-- Profile info / edit -->
        <v-col cols="12" lg="7">
          <v-card rounded="lg" elevation="0" border class="pa-5">
            <div class="section-header">
              <div class="section-header-left">
                <v-icon icon="mdi-account-outline" size="18" />
                <span>Личные данные</span>
              </div>
              <button
                v-if="!isEditing"
                class="btn-text"
                @click="startEditing"
              >
                <v-icon icon="mdi-pencil-outline" size="16" />
                Редактировать
              </button>
              <div v-else class="d-flex ga-2">
                <button class="btn-text btn-text--muted" @click="cancelEditing">Отмена</button>
                <button
                  class="btn-sm btn-sm--primary"
                  :disabled="!profileFormValid || profileSaving"
                  @click="saveProfile"
                >
                  <v-progress-circular v-if="profileSaving" size="14" width="2" indeterminate />
                  <v-icon v-else icon="mdi-check" size="14" />
                  Сохранить
                </button>
              </div>
            </div>

            <!-- Success banner -->
            <div v-if="profileSaved" class="info-banner info-banner--success mb-4">
              <v-icon icon="mdi-check-circle" size="18" />
              <span>Профиль успешно обновлён</span>
            </div>

            <!-- View mode -->
            <div v-if="!isEditing" class="profile-rows">
              <div class="profile-row">
                <span class="profile-row-label">Имя</span>
                <span class="profile-row-value">{{ authStore.user?.firstName }}</span>
              </div>
              <div class="profile-row">
                <span class="profile-row-label">Фамилия</span>
                <span class="profile-row-value">{{ authStore.user?.lastName }}</span>
              </div>
              <div v-if="authStore.user?.patronymic" class="profile-row">
                <span class="profile-row-label">Отчество</span>
                <span class="profile-row-value">{{ authStore.user.patronymic }}</span>
              </div>
              <div class="profile-row">
                <span class="profile-row-label">Телефон</span>
                <span class="profile-row-value">{{ formatPhone(authStore.user?.phone || '') }}</span>
              </div>
              <div class="profile-row">
                <span class="profile-row-label">Город</span>
                <span class="profile-row-value">{{ authStore.user?.city }}</span>
              </div>
              <div class="profile-row">
                <span class="profile-row-label">Роль</span>
                <span class="profile-row-value">
                  <span class="role-badge">Инвестор</span>
                </span>
              </div>
              <div class="profile-row">
                <span class="profile-row-label">Дата регистрации</span>
                <span class="profile-row-value">{{ authStore.user?.createdAt ? formatDate(authStore.user.createdAt) : '—' }}</span>
              </div>
            </div>

            <!-- Edit mode -->
            <div v-else class="form-grid">
              <div class="form-row-2">
                <div class="form-field">
                  <label class="field-label">Имя <span class="required">*</span></label>
                  <input v-model="editForm.firstName" type="text" class="field-input" placeholder="Имя" />
                </div>
                <div class="form-field">
                  <label class="field-label">Фамилия <span class="required">*</span></label>
                  <input v-model="editForm.lastName" type="text" class="field-input" placeholder="Фамилия" />
                </div>
              </div>
              <div class="form-field">
                <label class="field-label">Отчество</label>
                <input v-model="editForm.patronymic" type="text" class="field-input" placeholder="Отчество (необязательно)" />
              </div>
              <div class="form-field">
                <label class="field-label">Телефон <span class="required">*</span></label>
                <input v-model="editForm.phone" v-maska="PHONE_MASK" type="tel" class="field-input" placeholder="+7 (___) ___-__-__" />
              </div>
              <div class="form-field">
                <label class="field-label">Город <span class="required">*</span></label>
                <select v-model="editForm.city" class="field-input field-select">
                  <option value="" disabled>Выберите город</option>
                  <option v-for="c in CITIES" :key="c" :value="c">{{ c }}</option>
                </select>
              </div>
              <div class="form-field">
                <label class="field-label">Дата рождения</label>
                <input v-model="editForm.birthDate" type="date" class="field-input" />
              </div>
            </div>
          </v-card>
        </v-col>

        <!-- Profile card + stats -->
        <v-col cols="12" lg="5">
          <div class="profile-card-visual">
            <div class="profile-avatar-wrap">
              <div v-if="avatarPreview || authStore.user?.avatar" class="profile-avatar profile-avatar--img">
                <img :src="avatarPreview || authStore.user?.avatar" class="profile-avatar-img" />
              </div>
              <div v-else class="profile-avatar">
                {{ authStore.user?.firstName?.[0] }}{{ authStore.user?.lastName?.[0] }}
              </div>
              <button v-if="isEditing" class="avatar-edit-btn" @click="avatarInputRef?.click()" title="Изменить фото">
                <v-icon icon="mdi-camera" size="14" />
              </button>
              <button
                v-if="isEditing && (avatarPreview || authStore.user?.avatar)"
                class="avatar-remove-btn"
                @click="removeAvatarFile"
                title="Удалить фото"
              >
                <v-icon icon="mdi-close" size="12" />
              </button>
            </div>
            <input
              ref="avatarInputRef"
              type="file"
              accept="image/*"
              style="display: none;"
              @change="onAvatarSelected"
            />
            <div class="profile-card-name">{{ authStore.userName }}</div>
            <div class="profile-card-phone">{{ formatPhone(authStore.user?.phone || '') }}</div>
            <div v-if="!isFree" class="profile-plan-badge">
              <v-icon icon="mdi-crown" size="12" />
              {{ settingsPlanLabels[currentPlan] }}
            </div>
            <div v-else class="profile-card-role">
              <v-icon icon="mdi-shield-check" size="14" />
              Инвестор
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-item">
              <div class="stat-value">{{ authStore.user?.rating || 0 }}</div>
              <div class="stat-label">Рейтинг</div>
              <v-icon icon="mdi-star" size="16" class="stat-icon stat-icon--yellow" />
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ authStore.user?.completedDeals || 0 }}</div>
              <div class="stat-label">Завершено</div>
              <v-icon icon="mdi-check-circle" size="16" class="stat-icon stat-icon--green" />
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ authStore.user?.activeDeals || 0 }}</div>
              <div class="stat-label">Активных</div>
              <v-icon icon="mdi-briefcase" size="16" class="stat-icon stat-icon--blue" />
            </div>
          </div>
        </v-col>
      </v-row>
    </div>

    <!-- Security Tab -->
    <div v-if="activeTab === 'security'" class="tab-content">
      <v-row>
        <v-col cols="12" lg="7">
          <!-- Change password -->
          <v-card rounded="lg" elevation="0" border class="pa-5 mb-4">
            <div class="section-header">
              <div class="section-header-left">
                <v-icon icon="mdi-lock-outline" size="18" />
                <span>Смена пароля</span>
              </div>
            </div>

            <div v-if="passwordSaved" class="info-banner info-banner--success mb-4">
              <v-icon icon="mdi-check-circle" size="18" />
              <span>Пароль успешно изменён</span>
            </div>

            <div v-if="passwordError" class="info-banner info-banner--error mb-4">
              <v-icon icon="mdi-alert-circle" size="18" />
              <span>{{ passwordError }}</span>
            </div>

            <div class="form-grid">
              <div class="form-field">
                <label class="field-label">Текущий пароль</label>
                <div class="input-with-action">
                  <input
                    v-model="passwordForm.current"
                    :type="showCurrentPassword ? 'text' : 'password'"
                    class="field-input"
                    placeholder="Введите текущий пароль"
                  />
                  <button class="input-action" @click="showCurrentPassword = !showCurrentPassword">
                    <v-icon :icon="showCurrentPassword ? 'mdi-eye-off' : 'mdi-eye'" size="18" />
                  </button>
                </div>
              </div>
              <div class="form-field">
                <label class="field-label">Новый пароль</label>
                <div class="input-with-action">
                  <input
                    v-model="passwordForm.new"
                    :type="showNewPassword ? 'text' : 'password'"
                    class="field-input"
                    placeholder="Минимум 6 символов"
                  />
                  <button class="input-action" @click="showNewPassword = !showNewPassword">
                    <v-icon :icon="showNewPassword ? 'mdi-eye-off' : 'mdi-eye'" size="18" />
                  </button>
                </div>
                <div v-if="passwordForm.new && passwordForm.new.length < 6" class="field-hint field-hint--error">
                  Минимум 6 символов
                </div>
              </div>
              <div class="form-field">
                <label class="field-label">Повторите пароль</label>
                <input
                  v-model="passwordForm.confirm"
                  type="password"
                  class="field-input"
                  :class="{ 'field-input--error': passwordMismatch }"
                  placeholder="Повторите новый пароль"
                />
                <div v-if="passwordMismatch" class="field-hint field-hint--error">
                  Пароли не совпадают
                </div>
              </div>
              <button
                class="btn-primary"
                :disabled="!passwordFormValid || passwordSaving"
                @click="changePassword"
              >
                <v-progress-circular v-if="passwordSaving" size="16" width="2" indeterminate color="white" />
                <v-icon v-else icon="mdi-lock-reset" size="18" />
                Сменить пароль
              </button>
            </div>
          </v-card>
        </v-col>

        <!-- Verification -->
        <v-col cols="12" lg="5">
          <v-card rounded="lg" elevation="0" border class="pa-5">
            <div class="section-header">
              <div class="section-header-left">
                <v-icon icon="mdi-shield-check-outline" size="18" />
                <span>Верификация</span>
              </div>
            </div>

            <div class="verification-status">
              <div class="verification-progress-ring">
                <v-progress-circular
                  :model-value="((authStore.user?.verificationLevel || 0) / 3) * 100"
                  :size="72"
                  :width="5"
                  color="#047857"
                >
                  <span class="verification-progress-text">{{ authStore.user?.verificationLevel }}/3</span>
                </v-progress-circular>
              </div>
              <div class="verification-level-text">
                {{ verificationLabels[authStore.user?.verificationLevel || 0] }}
              </div>
            </div>

            <div class="verification-steps">
              <div
                v-for="vs in verificationSteps"
                :key="vs.level"
                class="verification-step"
                :class="{ done: (authStore.user?.verificationLevel || 0) >= vs.level }"
              >
                <div class="verification-step-icon">
                  <v-icon
                    v-if="(authStore.user?.verificationLevel || 0) >= vs.level"
                    icon="mdi-check"
                    size="16"
                  />
                  <v-icon v-else :icon="vs.icon" size="16" />
                </div>
                <div class="verification-step-info">
                  <span class="verification-step-label">Уровень {{ vs.level }}</span>
                  <span class="verification-step-desc">{{ vs.label }}</span>
                </div>
              </div>
            </div>

            <div v-if="(authStore.user?.verificationLevel || 0) < 3" class="info-banner mt-4">
              <v-icon icon="mdi-information-outline" size="18" />
              <span>Повысьте верификацию для доступа к расширенным функциям</span>
            </div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Delete account -->
      <div class="delete-account-bar">
        <div class="d-flex align-center ga-3">
          <div class="delete-account-icon">
            <v-icon icon="mdi-delete-outline" size="18" />
          </div>
          <div>
            <div class="delete-account-title">Удалить аккаунт</div>
            <div class="delete-account-desc">Все данные будут удалены безвозвратно</div>
          </div>
        </div>
        <button
          class="delete-account-btn"
          :disabled="deletingAccount"
          @click="confirmDeleteAccount"
        >
          <v-progress-circular v-if="deletingAccount" indeterminate size="14" width="2" color="white" />
          {{ deletingAccount ? 'Удаление...' : 'Удалить' }}
        </button>
      </div>
    </div>

    <!-- WhatsApp Tab -->
    <div v-if="activeTab === 'whatsapp'" class="tab-content">
      <!-- Upgrade prompt for FREE -->
      <template v-if="!canAccessFeature('whatsapp')">
        <div class="wa-locked-card">
          <div class="wa-locked-icon-wrap">
            <v-icon icon="mdi-whatsapp" size="36" color="#25d366" />
            <div class="wa-locked-crown">
              <v-icon icon="mdi-crown" size="16" color="#e8b931" />
            </div>
          </div>
          <div class="wa-locked-title">WhatsApp-напоминания</div>
          <div class="wa-locked-desc">
            Отправляйте напоминания о платежах клиентам прямо в WhatsApp — автоматически или вручную, без открытия приложения.
          </div>

          <div class="wa-locked-features">
            <div class="wa-locked-feature">
              <v-icon icon="mdi-clock-check-outline" size="18" color="#25d366" />
              <span>Автоматические напоминания за 1–3 дня до платежа</span>
            </div>
            <div class="wa-locked-feature">
              <v-icon icon="mdi-send-outline" size="18" color="#25d366" />
              <span>Ручная отправка напоминания одной кнопкой</span>
            </div>
            <div class="wa-locked-feature">
              <v-icon icon="mdi-account-group-outline" size="18" color="#25d366" />
              <span>Массовая рассылка «Напомнить всем»</span>
            </div>
            <div class="wa-locked-feature">
              <v-icon icon="mdi-file-document-edit-outline" size="18" color="#25d366" />
              <span>Настраиваемые шаблоны сообщений</span>
            </div>
          </div>

          <div class="wa-locked-plan-badge">
            <v-icon icon="mdi-crown" size="14" color="#e8b931" />
            Доступно с плана Бизнес
          </div>

          <button class="wa-locked-btn" @click="activeTab = 'subscription'">
            <v-icon icon="mdi-arrow-right" size="18" />
            Перейти к подпискам
          </button>
        </div>
      </template>

      <template v-else>
      <v-card rounded="lg" elevation="0" border class="pa-6">
        <!-- Connected state -->
        <div v-if="waStatus === 'connected'">
          <!-- Status banner -->
          <div class="wa-connected-banner">
            <div class="wa-connected-icon">
              <v-icon icon="mdi-whatsapp" size="28" />
            </div>
            <div class="wa-connected-info">
              <div class="wa-connected-title">WhatsApp подключён</div>
              <div class="wa-connected-desc">Напоминания отправляются от вашего номера</div>
            </div>
            <div class="wa-connected-badge">Активен</div>
          </div>
        </div>
      </v-card>

      <!-- Settings cards (only when connected) -->
      <template v-if="waStatus === 'connected'">

        <!-- Card 1: Auto-reminders -->
        <v-card rounded="lg" elevation="0" border class="pa-5 mt-4">
          <div class="wa-card-header">
            <div class="wa-card-icon" style="background: rgba(37, 211, 102, 0.1); color: #25d366;">
              <v-icon icon="mdi-clock-check-outline" size="20" />
            </div>
            <div class="wa-card-title">Автоматические напоминания</div>
            <v-switch
              v-model="waSettings.enabled"
              color="#25d366"
              hide-details
              density="compact"
              inset
            />
          </div>

          <div v-if="waSettings.enabled" class="wa-card-body">
            <!-- Days before -->
            <div class="wa-field">
              <div class="wa-field-label">
                <v-icon icon="mdi-calendar-alert" size="16" class="mr-1" style="opacity: 0.5;" />
                За сколько дней напоминать
              </div>
              <div class="wa-chips-row">
                <button
                  v-for="d in daysOptions" :key="d"
                  class="wa-chip" :class="{ 'wa-chip--active': waSettings.daysBefore === d }"
                  @click="waSettings.daysBefore = d"
                >{{ d }} {{ d === 1 ? 'день' : d < 5 ? 'дня' : 'дней' }}</button>
              </div>
            </div>

            <!-- Send time -->
            <div class="wa-field">
              <div class="wa-field-label">
                <v-icon icon="mdi-clock-outline" size="16" class="mr-1" style="opacity: 0.5;" />
                Время отправки
              </div>
              <input v-model="waSettings.sendTime" type="time" class="wa-time-input" />
            </div>

            <!-- Overdue -->
            <div class="wa-toggle-row">
              <div>
                <div class="wa-field-label" style="margin-bottom: 0;">
                  <v-icon icon="mdi-alert-circle-outline" size="16" class="mr-1" style="opacity: 0.5; color: #ef4444;" />
                  Напоминать при просрочке
                </div>
                <div class="wa-field-hint">Уведомление, если платёж просрочен</div>
              </div>
              <v-switch v-model="waSettings.remindOverdue" color="#25d366" hide-details density="compact" inset />
            </div>
          </div>
        </v-card>

        <!-- Card 2: Templates -->
        <v-card v-if="waSettings.enabled" rounded="lg" elevation="0" border class="pa-5 mt-4">
          <div class="wa-card-header mb-4">
            <div class="wa-card-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
              <v-icon icon="mdi-message-text-outline" size="20" />
            </div>
            <div class="wa-card-title">Шаблоны сообщений</div>
          </div>

          <!-- Regular template -->
          <div class="wa-template-block">
            <div class="wa-template-label">
              <v-icon icon="mdi-bell-outline" size="14" color="primary" />
              Напоминание о платеже
            </div>
            <textarea
              ref="templateRef"
              v-model="waSettings.template"
              class="wa-template-textarea"
              rows="3"
              placeholder="Текст напоминания..."
            />
            <div class="wa-var-row">
              <span class="wa-var-label">Вставить:</span>
              <button v-for="v in templateVars" :key="'tpl-' + v" class="wa-var-chip" @click="insertVar('template', v)">{{ v }}</button>
            </div>
            <div v-if="waSettings.template" class="wa-preview-block">
              <div class="wa-preview-header">
                <v-icon icon="mdi-eye-outline" size="14" />
                Предпросмотр
              </div>
              <div class="wa-bubble">
                <div class="wa-bubble-text">{{ previewTemplate(waSettings.template) }}</div>
                <div class="wa-bubble-time">10:00</div>
              </div>
            </div>
          </div>

          <!-- Overdue template -->
          <div v-if="waSettings.remindOverdue" class="wa-template-block wa-template-block--overdue">
            <div class="wa-template-label">
              <v-icon icon="mdi-alert-circle-outline" size="14" color="error" />
              При просрочке платежа
            </div>
            <textarea
              ref="overdueTemplateRef"
              v-model="waSettings.overdueTemplate"
              class="wa-template-textarea"
              rows="3"
              placeholder="Текст для просроченных..."
            />
            <div class="wa-var-row">
              <span class="wa-var-label">Вставить:</span>
              <button v-for="v in templateVars" :key="'overdue-' + v" class="wa-var-chip" @click="insertVar('overdueTemplate', v)">{{ v }}</button>
            </div>
            <div v-if="waSettings.overdueTemplate" class="wa-preview-block">
              <div class="wa-preview-header">
                <v-icon icon="mdi-eye-outline" size="14" />
                Предпросмотр
              </div>
              <div class="wa-bubble wa-bubble--overdue">
                <div class="wa-bubble-text">{{ previewTemplate(waSettings.overdueTemplate) }}</div>
                <div class="wa-bubble-time">10:00</div>
              </div>
            </div>
          </div>
        </v-card>

        <!-- Save + Disconnect -->
        <div class="wa-bottom-actions mt-4">
          <button class="wa-save-btn" :disabled="savingSettings" @click="saveWaSettings">
            <v-progress-circular v-if="savingSettings" indeterminate size="16" width="2" color="white" />
            <v-icon v-else icon="mdi-content-save-outline" size="18" />
            {{ savingSettings ? 'Сохранение...' : 'Сохранить настройки' }}
          </button>
          <button class="wa-disconnect-btn" @click="disconnectWhatsApp">
            <v-icon icon="mdi-link-off" size="16" />
            Отключить
          </button>
        </div>
      </template>

      <!-- Connecting / Loading / Disconnected -->
      <v-card v-if="waStatus !== 'connected'" rounded="lg" elevation="0" border class="pa-6">
        <!-- Connecting state (QR code) -->
        <div v-if="waStatus === 'connecting'" class="text-center">
          <div class="text-h6 font-weight-bold mb-2">Отсканируйте QR-код</div>
          <div class="text-body-2 text-medium-emphasis mb-5">
            Откройте WhatsApp → Связанные устройства → Привязать устройство
          </div>

          <div v-if="waQrCode" class="wa-qr-wrap">
            <img :src="waQrCode" class="wa-qr-img" />
          </div>
          <div v-else class="wa-qr-wrap">
            <v-progress-circular indeterminate size="40" color="primary" />
            <div class="text-caption text-medium-emphasis mt-3">Загрузка QR-кода...</div>
          </div>

          <div class="text-caption text-medium-emphasis mt-4">
            QR-код обновляется автоматически. Ожидание: 2 минуты.
          </div>
        </div>

        <!-- Loading state -->
        <div v-if="waStatus === 'loading'" class="text-center pa-8">
          <v-progress-circular indeterminate size="32" color="primary" />
        </div>

        <!-- Disconnected state -->
        <div v-if="waStatus === 'disconnected'" class="text-center">
          <div class="wa-status-icon">
            <v-icon icon="mdi-whatsapp" size="40" />
          </div>
          <div class="text-h6 font-weight-bold mt-3">Подключите WhatsApp</div>
          <div class="text-body-2 text-medium-emphasis mt-1 mb-2" style="max-width: 420px; margin: 0 auto;">
            Отправляйте напоминания о платежах клиентам прямо в WhatsApp одной кнопкой — без открытия приложения
          </div>

          <div class="wa-features">
            <div class="wa-feature">
              <v-icon icon="mdi-send" size="16" color="primary" />
              <span>Напоминания от вашего номера</span>
            </div>
            <div class="wa-feature">
              <v-icon icon="mdi-clock-fast" size="16" color="primary" />
              <span>Отправка в один клик</span>
            </div>
            <div class="wa-feature">
              <v-icon icon="mdi-account-group" size="16" color="primary" />
              <span>Массовая рассылка</span>
            </div>
          </div>

          <button class="btn-whatsapp-connect" @click="connectWhatsApp">
            <v-icon icon="mdi-qrcode-scan" size="18" />
            Подключить WhatsApp
          </button>
        </div>
      </v-card>
      </template>
    </div>

    <!-- Export Tab -->
    <div v-if="activeTab === 'export'" class="tab-content">
      <template v-if="!canAccessFeature('excelExport')">
        <!-- Locked state -->
        <div class="export-locked-card">
          <div class="export-locked-icon-wrap">
            <v-icon icon="mdi-file-excel-outline" size="36" color="#047857" />
            <div class="export-locked-crown">
              <v-icon icon="mdi-crown" size="16" color="#e8b931" />
            </div>
          </div>
          <div class="export-locked-title">Экспорт данных</div>
          <div class="export-locked-desc">
            Скачайте все данные из личного кабинета в формате Excel — сделки, платежи, клиентов и сводку с формулами.
          </div>

          <div class="export-locked-features">
            <div class="export-locked-feature">
              <v-icon icon="mdi-handshake" size="18" color="#047857" />
              <span>Все сделки с финансами</span>
            </div>
            <div class="export-locked-feature">
              <v-icon icon="mdi-calendar-check" size="18" color="#047857" />
              <span>История платежей</span>
            </div>
            <div class="export-locked-feature">
              <v-icon icon="mdi-account-group" size="18" color="#047857" />
              <span>База клиентов</span>
            </div>
            <div class="export-locked-feature">
              <v-icon icon="mdi-function-variant" size="18" color="#047857" />
              <span>Формулы и итоги</span>
            </div>
          </div>

          <div class="export-locked-plan-badge">
            <v-icon icon="mdi-crown" size="14" color="#e8b931" />
            Доступно с плана Бизнес
          </div>

          <button class="export-locked-btn" @click="activeTab = 'subscription'">
            <v-icon icon="mdi-arrow-right" size="18" />
            Перейти к подпискам
          </button>
        </div>
      </template>

      <template v-else>
        <!-- Available state -->
        <div class="export-card">
          <div class="export-card-header">
            <div class="export-card-icon">
              <v-icon icon="mdi-file-excel-outline" size="24" />
            </div>
            <div>
              <div class="export-card-title">Экспорт в Excel</div>
              <div class="export-card-desc">Скачать все данные из личного кабинета</div>
            </div>
          </div>

          <div class="export-sheets">
            <div class="export-sheet">
              <v-icon icon="mdi-chart-pie" size="20" color="#047857" />
              <div>
                <div class="export-sheet-title">Сводка</div>
                <div class="export-sheet-desc">Общие показатели, ROI, статистика платежей</div>
              </div>
            </div>
            <div class="export-sheet">
              <v-icon icon="mdi-handshake" size="20" color="#3b82f6" />
              <div>
                <div class="export-sheet-title">Сделки</div>
                <div class="export-sheet-desc">Все сделки с формулами наценки и итогами</div>
              </div>
            </div>
            <div class="export-sheet">
              <v-icon icon="mdi-calendar-check" size="20" color="#8b5cf6" />
              <div>
                <div class="export-sheet-title">Платежи</div>
                <div class="export-sheet-desc">Все платежи, суммы по статусам (SUMIF)</div>
              </div>
            </div>
            <div class="export-sheet">
              <v-icon icon="mdi-account-group" size="20" color="#f59e0b" />
              <div>
                <div class="export-sheet-title">Клиенты</div>
                <div class="export-sheet-desc">Профили клиентов, паспортные данные, суммы</div>
              </div>
            </div>
          </div>

          <button
            class="export-download-btn"
            :disabled="exporting"
            @click="exportExcel"
          >
            <v-progress-circular v-if="exporting" indeterminate size="18" width="2" color="white" />
            <v-icon v-else icon="mdi-download" size="20" />
            {{ exporting ? 'Формирование файла...' : 'Скачать Excel' }}
          </button>
        </div>
      </template>
    </div>

    <!-- Subscription Tab -->
    <div v-if="activeTab === 'subscription'" class="tab-content">
      <!-- Current plan -->
      <div v-if="authStore.user?.subscriptionPlan && authStore.user.subscriptionPlan !== 'FREE'" class="current-plan-banner">
        <div class="current-plan-left">
          <v-icon icon="mdi-crown" size="20" />
          <div>
            <div class="current-plan-label">Текущий план</div>
            <div class="current-plan-name">{{ planLabels[authStore.user?.subscriptionPlan || 'FREE'] }}</div>
          </div>
        </div>
        <div class="current-plan-right">
          <div v-if="authStore.user?.daysUntilExpiry != null" class="current-plan-expiry">
            <span v-if="authStore.user.daysUntilExpiry > 0">Осталось {{ authStore.user.daysUntilExpiry }} дн.</span>
            <span v-else class="text-error">Подписка истекла</span>
          </div>
          <div v-if="authStore.user?.subscriptionExpiry" class="current-plan-date">
            до {{ formatDate(authStore.user.subscriptionExpiry) }}
          </div>
        </div>
      </div>

      <!-- Usage info -->
      <div v-if="authStore.user?.planLimits" class="usage-banner mb-5">
        <v-icon icon="mdi-chart-bar" size="18" />
        <span>
          Активных сделок: <strong>{{ Math.max(0, authStore.user.activeDeals || 0) }}</strong>
          из <strong>{{ authStore.user.planLimits.maxActiveDeals === -1 ? '∞' : authStore.user.planLimits.maxActiveDeals }}</strong>
        </span>
      </div>

      <!-- Response cost explainer -->
      <div class="info-banner mb-5">
        <v-icon icon="mdi-information-outline" size="18" />
        <span>Клиенты оставляют заявки бесплатно. Чтобы связаться с клиентом, нужно оплатить отклик. Чем выше подписка — тем дешевле отклик.</span>
      </div>

      <!-- Billing period toggle -->
      <div class="billing-toggle-wrap mb-5">
        <button
          class="billing-toggle-btn"
          :class="{ active: billingPeriod === 'monthly' }"
          @click="billingPeriod = 'monthly'"
        >
          Ежемесячно
        </button>
        <button
          class="billing-toggle-btn"
          :class="{ active: billingPeriod === 'yearly' }"
          @click="billingPeriod = 'yearly'"
        >
          Ежегодно
          <span class="billing-discount-badge">−20%</span>
        </button>
      </div>

      <!-- Plans grid -->
      <div class="plans-grid">
        <div
          v-for="plan in plans"
          :key="plan.id"
          class="plan-card"
          :class="{
            'plan-card--active': authStore.user?.subscriptionPlan === plan.id,
            'plan-card--popular': plan.popular,
          }"
        >
          <div v-if="plan.popular" class="plan-popular-badge">Популярный</div>
          <div class="plan-icon-wrap">
            <v-icon :icon="plan.icon" size="24" />
          </div>
          <div class="plan-name">{{ plan.label }}</div>
          <div class="plan-price">
            {{ billingPeriod === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice }}
          </div>
          <div class="plan-price-note">
            <template v-if="plan.id === 'FREE'">навсегда</template>
            <template v-else>в месяц</template>
          </div>
          <div v-if="billingPeriod === 'yearly' && plan.yearlyTotal" class="plan-yearly-info">
            <div class="plan-yearly-total">{{ plan.yearlyTotal }}</div>
            <div class="plan-yearly-saving">{{ plan.yearlySaving }}</div>
          </div>

          <!-- Response price highlight -->
          <div class="plan-response-price" :class="{ 'plan-response-price--free': plan.responsePrice === 'Бесплатно' }">
            <v-icon :icon="plan.responsePrice === 'Бесплатно' ? 'mdi-check-circle' : 'mdi-message-reply-text-outline'" size="16" />
            <span>Отклик: <strong>{{ plan.responsePrice }}</strong></span>
          </div>

          <div class="plan-divider" />

          <div v-if="plan.includesFrom" class="plan-includes-badge">
            <v-icon icon="mdi-check-decagram" size="16" />
            <span>{{ plan.includesFrom }}</span>
          </div>

          <div class="plan-features">
            <div v-for="(feature, fi) in plan.features" :key="fi" class="plan-feature">
              <v-icon icon="mdi-check" size="14" />
              <span>{{ feature }}</span>
            </div>
          </div>

          <div v-if="plan.limitations.length" class="plan-limitations">
            <div v-for="(lim, li) in plan.limitations" :key="li" class="plan-limitation">
              <v-icon icon="mdi-close" size="14" />
              <span>{{ lim }}</span>
            </div>
          </div>

          <div class="plan-btn-wrap">
            <button
              v-if="authStore.user?.subscriptionPlan === plan.id"
              class="btn-plan btn-plan--current"
              disabled
            >
              Текущий
            </button>
            <button
              v-else
              class="btn-plan"
              :class="{ 'btn-plan--primary': plan.id === 'PRO' || plan.popular || plan.id === 'PREMIUM' }"
              @click="selectPlan(plan)"
            >
              Выбрать
            </button>
          </div>
        </div>
      </div>

      <!-- Comparison note -->
      <div class="plans-comparison-note">
        <v-icon icon="mdi-scale-balance" size="16" />
        <span>При 20+ откликах в месяц подписка <strong>Бизнес</strong> окупается. При 25+ — выгоднее <strong>Премиум</strong>.</span>
      </div>

      <!-- Subscription request dialog -->
      <v-dialog v-model="showContactDialog" max-width="480">
        <div class="sub-dialog" :class="{ dark: isDark }">
          <button class="sub-dialog-close" @click="showContactDialog = false">
            <v-icon icon="mdi-close" size="20" />
          </button>

          <!-- Header -->
          <div class="sub-dialog-header">
            <div class="sub-dialog-icon">
              <v-icon :icon="selectedPlan?.icon || 'mdi-star'" size="28" />
            </div>
            <div class="sub-dialog-title">{{ selectedPlan?.label }}</div>
            <div class="sub-dialog-price">{{ dialogPrice }}</div>
            <div class="sub-dialog-price-note">в месяц</div>
            <div v-if="dialogTotalPrice" class="sub-dialog-total">{{ dialogTotalPrice }}</div>
          </div>

          <!-- Period toggle -->
          <div class="sub-dialog-period">
            <button
              class="sub-period-btn"
              :class="{ active: dialogPeriod === 'monthly' }"
              @click="dialogPeriod = 'monthly'"
            >
              Ежемесячно
            </button>
            <button
              class="sub-period-btn"
              :class="{ active: dialogPeriod === 'yearly' }"
              @click="dialogPeriod = 'yearly'"
            >
              Ежегодно
              <span class="sub-period-badge">−20%</span>
            </button>
          </div>

          <!-- Saving highlight -->
          <div v-if="dialogPeriod === 'yearly' && selectedPlan?.yearlySaving" class="sub-dialog-saving">
            <v-icon icon="mdi-piggy-bank-outline" size="16" />
            {{ selectedPlan.yearlySaving }}
          </div>

          <!-- Success state -->
          <template v-if="requestSent">
            <div class="sub-dialog-success">
              <v-icon icon="mdi-check-circle" size="48" />
              <div class="sub-dialog-success-title">Заявка отправлена!</div>
              <div class="sub-dialog-success-text">
                Мы свяжемся с вами в ближайшее время для подключения подписки.
              </div>
              <button class="sub-dialog-btn sub-dialog-btn--primary" @click="showContactDialog = false">
                Отлично
              </button>
            </div>
          </template>

          <template v-else>
            <!-- Comment -->
            <div class="sub-dialog-field">
              <label class="sub-dialog-label">Комментарий <span style="opacity: 0.4;">(необязательно)</span></label>
              <textarea
                v-model="requestMessage"
                class="sub-dialog-textarea"
                placeholder="Например: хочу перейти с текущего плана..."
                rows="2"
              />
            </div>

            <!-- Submit button -->
            <button
              class="sub-dialog-btn sub-dialog-btn--primary"
              :disabled="requestSending"
              @click="sendSubscriptionRequest"
            >
              <v-icon v-if="requestSending" icon="mdi-loading mdi-spin" size="18" />
              <v-icon v-else icon="mdi-send" size="18" />
              {{ requestSending ? 'Отправка...' : 'Отправить заявку' }}
            </button>

            <!-- Divider -->
            <div class="sub-dialog-divider">
              <span>или свяжитесь напрямую</span>
            </div>

            <!-- Contact buttons -->
            <div class="sub-dialog-contacts">
              <a class="sub-contact-btn sub-contact-btn--wa" href="https://wa.me/79170414764" target="_blank">
                <v-icon icon="mdi-whatsapp" size="20" />
                WhatsApp
              </a>
              <a class="sub-contact-btn sub-contact-btn--tg" href="https://t.me/mizanpay" target="_blank">
                <v-icon icon="mdi-send" size="20" />
                Telegram
              </a>
            </div>
          </template>
        </div>
      </v-dialog>
    </div>
  </div>
</template>

<style scoped>
/* Page header */
.page-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20px;
}
.page-header-left { display: flex; align-items: center; gap: 14px; }
.page-icon-wrap {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
}
.page-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.page-subtitle {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Tabs */
.settings-tabs {
  display: flex; gap: 4px; margin-bottom: 24px;
  padding: 4px; border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.settings-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 18px; border-radius: 8px; border: none;
  background: transparent;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
}
.settings-tab:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.settings-tab.active {
  background: #047857;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(4, 120, 87, 0.25);
}
@media (max-width: 600px) {
  .settings-tabs { overflow-x: auto; }
  .settings-tab { white-space: nowrap; padding: 8px 14px; font-size: 12px; }
}

/* Section header */
.section-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20px; padding-bottom: 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.section-header-left {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* Buttons */
.btn-text {
  display: inline-flex; align-items: center; gap: 4px;
  border: none; background: none; padding: 6px 10px; border-radius: 8px;
  font-size: 13px; font-weight: 500; color: #047857;
  cursor: pointer; transition: all 0.15s;
}
.btn-text:hover { background: rgba(4, 120, 87, 0.06); }
.btn-text--muted { color: rgba(var(--v-theme-on-surface), 0.5); }
.btn-text--muted:hover { background: rgba(var(--v-theme-on-surface), 0.06); }

.btn-sm {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px; border-radius: 8px; border: none;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.btn-sm--primary {
  background: #047857; color: #fff;
}
.btn-sm--primary:hover { background: #065f46; }
.btn-sm--primary:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px; padding: 0 24px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  width: fit-content;
}
.btn-primary:hover { background: #065f46; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

/* Profile rows (view) */
.profile-rows { display: flex; flex-direction: column; gap: 14px; }
.profile-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.04);
}
.profile-row:last-child { border-bottom: none; }
.profile-row-label {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.profile-row-value {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.role-badge {
  display: inline-flex; padding: 3px 10px; border-radius: 6px;
  background: rgba(4, 120, 87, 0.1); color: #047857;
  font-size: 12px; font-weight: 600;
}

/* Form */
.form-grid { display: flex; flex-direction: column; gap: 16px; }
.form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 500px) { .form-row-2 { grid-template-columns: 1fr; } }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.field-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.required { color: #ef4444; }
.field-input {
  width: 100%; height: 44px; padding: 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.03);
  outline: none; transition: all 0.15s;
}
.field-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.3); }
.field-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}
.field-input--error { border-color: #ef4444; }
.field-input--error:focus { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1); }
.field-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M3 5l3 3 3-3'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 36px;
}
.field-hint {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.field-hint--error { color: #ef4444; }

.input-with-action { position: relative; }
.input-with-action .field-input { padding-right: 44px; }
.input-action {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 36px; height: 36px; border-radius: 8px; border: none;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.35);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.input-action:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* Profile visual card */
.profile-card-visual {
  display: flex; flex-direction: column; align-items: center;
  padding: 28px 20px 24px;
  border-radius: 14px; margin-bottom: 16px;
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.08) 0%, rgba(4, 120, 87, 0.03) 100%);
  border: 1px solid rgba(4, 120, 87, 0.12);
}
.profile-avatar-wrap {
  position: relative; margin-bottom: 12px;
}
.profile-avatar {
  width: 72px; height: 72px; border-radius: 18px;
  background: linear-gradient(135deg, #047857, #059669);
  color: #fff; font-size: 24px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(4, 120, 87, 0.25);
  overflow: hidden;
}
.profile-avatar--img {
  background: none; box-shadow: 0 4px 12px rgba(0,0,0,0.12);
}
.profile-avatar-img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.avatar-edit-btn {
  position: absolute; bottom: -4px; right: -4px;
  width: 28px; height: 28px; border-radius: 8px; border: 2px solid #fff;
  background: #047857; color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.avatar-edit-btn:hover { background: #065f46; }
.avatar-remove-btn {
  position: absolute; top: -4px; right: -4px;
  width: 20px; height: 20px; border-radius: 6px; border: 2px solid #fff;
  background: #ef4444; color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.avatar-remove-btn:hover { background: #dc2626; }
.profile-card-name {
  font-size: 17px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.profile-card-phone {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.profile-card-role {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 10px; padding: 4px 12px; border-radius: 8px;
  background: rgba(4, 120, 87, 0.1); color: #047857;
  font-size: 12px; font-weight: 600;
}
.profile-plan-badge {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 10px; padding: 4px 14px 4px 10px; border-radius: 10px;
  background: rgba(232, 185, 49, 0.12); color: #b8941e;
  border: 1px solid rgba(232, 185, 49, 0.25);
  font-size: 12px; font-weight: 700;
}
.profile-plan-badge .v-icon { color: #e8b931; }

/* Stats grid */
.stats-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
}
.stat-item {
  display: flex; flex-direction: column; align-items: center;
  padding: 14px 8px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  position: relative;
}
.stat-value {
  font-size: 20px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.stat-label {
  font-size: 11px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 2px;
}
.stat-icon {
  position: absolute; top: 8px; right: 8px; opacity: 0.5;
}
.stat-icon--yellow { color: #f59e0b; }
.stat-icon--green { color: #047857; }
.stat-icon--blue { color: #3b82f6; }

/* Info banner */
.info-banner {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(59, 130, 246, 0.06);
  color: #3b82f6; font-size: 13px;
  border: 1px solid rgba(59, 130, 246, 0.12);
}
.info-banner--success {
  background: rgba(4, 120, 87, 0.06);
  color: #047857; border-color: rgba(4, 120, 87, 0.12);
}
.info-banner--error {
  background: rgba(239, 68, 68, 0.06);
  color: #ef4444; border-color: rgba(239, 68, 68, 0.12);
}

/* Export tab — locked card */
.export-locked-card {
  display: flex; flex-direction: column; align-items: center;
  background: #fff; border: 2px solid rgba(232, 185, 49, 0.25);
  border-radius: 16px; padding: 40px 32px; text-align: center;
}
.export-locked-icon-wrap {
  position: relative; width: 72px; height: 72px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.08); border-radius: 50%; margin-bottom: 16px;
}
.export-locked-crown {
  position: absolute; bottom: -2px; right: -2px;
  width: 26px; height: 26px; border-radius: 50%;
  background: #fff; border: 2px solid rgba(232, 185, 49, 0.3);
  display: flex; align-items: center; justify-content: center;
}
.export-locked-title {
  font-size: 20px; font-weight: 700; margin-bottom: 8px;
}
.export-locked-desc {
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.55);
  max-width: 460px; line-height: 1.5; margin-bottom: 24px;
}
.export-locked-features {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px;
  text-align: left; margin-bottom: 24px; width: 100%; max-width: 480px;
}
.export-locked-feature {
  display: flex; align-items: center; gap: 10px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(4, 120, 87, 0.05); border-radius: 10px; padding: 10px 14px;
}
.export-locked-plan-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; color: #b8941e;
  background: rgba(232, 185, 49, 0.1); border: 1px solid rgba(232, 185, 49, 0.2);
  border-radius: 20px; padding: 6px 16px; margin-bottom: 20px;
}
.export-locked-btn {
  display: inline-flex; align-items: center; gap: 8px;
  height: 44px; padding: 0 28px; border-radius: 12px; border: none;
  background: #047857; color: #fff; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.export-locked-btn:hover { background: #065f46; }

/* Export tab — available card */
.export-card {
  background: #fff; border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 16px; padding: 28px;
}
.export-card-header {
  display: flex; align-items: center; gap: 14px; margin-bottom: 24px;
}
.export-card-icon {
  width: 48px; height: 48px; border-radius: 14px;
  background: rgba(4, 120, 87, 0.1); color: #047857;
  display: flex; align-items: center; justify-content: center;
}
.export-card-title { font-size: 18px; font-weight: 700; }
.export-card-desc { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px; }

.export-sheets {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;
}
.export-sheet {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.export-sheet .v-icon { margin-top: 2px; flex-shrink: 0; }
.export-sheet-title { font-size: 13px; font-weight: 600; }
.export-sheet-desc { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }

.export-download-btn {
  display: inline-flex; align-items: center; gap: 8px;
  height: 48px; padding: 0 32px; border-radius: 12px; border: none;
  background: #047857; color: #fff; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.export-download-btn:hover { background: #065f46; }
.export-download-btn:disabled { opacity: 0.6; cursor: not-allowed; }

/* Dark mode export */
.dark .export-locked-card { background: #1e1e2e; border-color: rgba(232, 185, 49, 0.15); }
.dark .export-locked-crown { background: #1e1e2e; }
.dark .export-locked-feature { background: rgba(4, 120, 87, 0.08); }
.dark .export-card { background: #1e1e2e; border-color: #2e2e42; }
.dark .export-sheet { background: rgba(var(--v-theme-on-surface), 0.04); border-color: #2e2e42; }

/* Delete account */
.delete-account-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; margin-top: 12px;
  border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgba(var(--v-theme-on-surface), 0.02);
  transition: all 0.2s;
}
.delete-account-bar:hover {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.02);
}
.delete-account-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.3);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.delete-account-bar:hover .delete-account-icon {
  background: rgba(239, 68, 68, 0.08); color: #ef4444;
}
.delete-account-title {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  transition: color 0.2s;
}
.delete-account-bar:hover .delete-account-title { color: #ef4444; }
.delete-account-desc {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.3);
}
.delete-account-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 14px; border-radius: 8px; border: none;
  background: rgba(239, 68, 68, 0.08); color: #ef4444;
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.delete-account-btn:hover { background: #ef4444; color: #fff; }
.delete-account-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.dark .delete-account-bar { background: rgba(var(--v-theme-on-surface), 0.03); border-color: #2e2e42; }

/* WhatsApp locked card */
.wa-locked-card {
  display: flex; flex-direction: column; align-items: center;
  background: #fff; border: 2px solid rgba(232, 185, 49, 0.25);
  border-radius: 16px; padding: 40px 32px; text-align: center;
}
.wa-locked-icon-wrap {
  position: relative; width: 72px; height: 72px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(37, 211, 102, 0.08); border-radius: 50%; margin-bottom: 16px;
}
.wa-locked-crown {
  position: absolute; bottom: -2px; right: -2px;
  width: 26px; height: 26px; border-radius: 50%;
  background: #fff; border: 2px solid rgba(232, 185, 49, 0.3);
  display: flex; align-items: center; justify-content: center;
}
.wa-locked-title {
  font-size: 20px; font-weight: 700; margin-bottom: 8px;
  color: rgba(var(--v-theme-on-surface), 0.87);
}
.wa-locked-desc {
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.55);
  max-width: 460px; line-height: 1.5; margin-bottom: 24px;
}
.wa-locked-features {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px;
  text-align: left; margin-bottom: 24px; width: 100%; max-width: 520px;
}
.wa-locked-feature {
  display: flex; align-items: center; gap: 10px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(37, 211, 102, 0.05); border-radius: 10px; padding: 10px 14px;
}
.wa-locked-plan-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; color: #b8941e;
  background: rgba(232, 185, 49, 0.1); border: 1px solid rgba(232, 185, 49, 0.2);
  border-radius: 20px; padding: 6px 16px; margin-bottom: 20px;
}
.wa-locked-btn {
  display: inline-flex; align-items: center; gap: 8px;
  height: 44px; padding: 0 28px; border-radius: 12px; border: none;
  background: #047857; color: #fff; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.wa-locked-btn:hover { background: #065f46; }

/* Dark mode */
.dark .wa-locked-card { background: #1e1e2e; border-color: rgba(232, 185, 49, 0.15); }
.dark .wa-locked-crown { background: #1e1e2e; }
.dark .wa-locked-feature { background: rgba(37, 211, 102, 0.08); }
.dark .wa-locked-plan-badge { background: rgba(232, 185, 49, 0.08); border-color: rgba(232, 185, 49, 0.15); }

/* WhatsApp */
.wa-connected-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 20px; border-radius: 14px;
  background: linear-gradient(135deg, rgba(37, 211, 102, 0.08) 0%, rgba(37, 211, 102, 0.02) 100%);
  border: 1px solid rgba(37, 211, 102, 0.15);
}
.wa-connected-icon {
  width: 48px; height: 48px; border-radius: 14px;
  background: rgba(37, 211, 102, 0.12); color: #25d366;
  display: flex; align-items: center; justify-content: center;
}
.wa-connected-info { flex: 1; }
.wa-connected-title { font-size: 15px; font-weight: 700; color: #25d366; }
.wa-connected-desc { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }
.wa-connected-badge {
  padding: 4px 12px; border-radius: 8px;
  background: #25d366; color: #fff;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
}

/* Cards */
.wa-card-header {
  display: flex; align-items: center; gap: 12px;
}
.wa-card-icon {
  width: 40px; height: 40px; min-width: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
}
.wa-card-title { flex: 1; font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.wa-card-body { margin-top: 20px; display: flex; flex-direction: column; gap: 20px; }

/* Fields */
.wa-field { display: flex; flex-direction: column; gap: 8px; }
.wa-field-label {
  display: flex; align-items: center;
  font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.6);
}
.wa-field-hint { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.35); margin-top: 2px; }
.wa-chips-row { display: flex; gap: 6px; flex-wrap: wrap; }
.wa-chip {
  padding: 8px 14px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer; transition: all 0.15s;
}
.wa-chip:hover { background: rgba(37, 211, 102, 0.08); color: #25d366; }
.wa-chip--active { background: rgba(37, 211, 102, 0.12); color: #25d366; box-shadow: inset 0 0 0 2px rgba(37, 211, 102, 0.3); }
.wa-time-input {
  width: 140px; height: 42px; padding: 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.03); outline: none;
}
.wa-time-input:focus { border-color: #25d366; box-shadow: 0 0 0 3px rgba(37, 211, 102, 0.08); }
.wa-toggle-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 16px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

/* Templates */
.wa-template-block {
  padding: 18px; border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  margin-bottom: 16px;
}
.wa-template-block--overdue {
  border-color: rgba(239, 68, 68, 0.12);
  background: rgba(239, 68, 68, 0.02);
}
.wa-template-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 10px;
}
.wa-template-textarea {
  width: 100%; padding: 12px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  font-size: 13px; line-height: 1.6; color: inherit; resize: vertical;
  background: rgba(var(--v-theme-on-surface), 0.02); outline: none;
}
.wa-template-textarea:focus { border-color: #25d366; box-shadow: 0 0 0 3px rgba(37, 211, 102, 0.08); }
.wa-var-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px;
}
.wa-var-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.35); }
.wa-var-chip {
  padding: 3px 8px; border-radius: 6px; border: none;
  background: rgba(37, 211, 102, 0.08); color: #25d366;
  font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.wa-var-chip:hover { background: rgba(37, 211, 102, 0.15); }

/* Preview bubble */
.wa-preview-block { margin-top: 14px; }
.wa-preview-header {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.35);
  margin-bottom: 8px;
}
.wa-bubble {
  max-width: 360px; padding: 10px 14px; border-radius: 0 12px 12px 12px;
  background: #dcf8c6; color: #1a1a1a;
  font-size: 13px; line-height: 1.5;
  position: relative;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
.wa-bubble--overdue { background: #fef2f2; }
.wa-bubble-time {
  text-align: right; font-size: 10px; color: rgba(0,0,0,0.35); margin-top: 4px;
}
.wa-bubble-text { white-space: pre-line; }

/* Bottom actions */
.wa-bottom-actions {
  display: flex; align-items: center; gap: 12px;
}
.wa-save-btn {
  display: inline-flex; align-items: center; gap: 8px;
  height: 44px; padding: 0 24px; border-radius: 12px; border: none;
  background: #25d366; color: #fff;
  font-size: 14px; font-weight: 700;
  cursor: pointer; transition: all 0.15s;
}
.wa-save-btn:hover { background: #1da851; }
.wa-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.wa-disconnect-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 44px; padding: 0 18px; border-radius: 12px;
  border: 1px solid rgba(239, 68, 68, 0.2); background: transparent;
  color: #ef4444; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.wa-disconnect-btn:hover { background: rgba(239, 68, 68, 0.04); }

/* QR / Disconnected */
.wa-status-icon {
  width: 72px; height: 72px; border-radius: 20px; margin: 0 auto;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.3);
  display: flex; align-items: center; justify-content: center;
}
.wa-qr-wrap {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 20px; min-height: 280px;
}
.wa-qr-img {
  width: 260px; height: 260px; border-radius: 16px;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.08);
}
.wa-features {
  display: flex; flex-direction: column; gap: 8px; align-items: center;
  margin: 20px 0 24px;
}
.wa-feature {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.btn-whatsapp-connect {
  display: inline-flex; align-items: center; gap: 8px;
  height: 48px; padding: 0 28px; border-radius: 14px; border: none;
  background: #25d366; color: #fff;
  font-size: 15px; font-weight: 700;
  cursor: pointer; transition: all 0.15s;
}
.btn-whatsapp-connect:hover { background: #1da851; }

/* Dark mode WhatsApp */
.dark .wa-connected-banner { background: linear-gradient(135deg, rgba(37, 211, 102, 0.12) 0%, rgba(37, 211, 102, 0.04) 100%); border-color: rgba(37, 211, 102, 0.2); }
.dark .wa-chip { background: #252538; }
.dark .wa-chip--active { background: rgba(37, 211, 102, 0.15); }
.dark .wa-time-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .wa-time-input:focus { border-color: #25d366; }
.dark .wa-toggle-row { background: #1e1e2e; border-color: #2e2e42; }
.dark .wa-template-block { background: #1e1e2e; border-color: #2e2e42; }
.dark .wa-template-block--overdue { background: rgba(239, 68, 68, 0.04); border-color: rgba(239, 68, 68, 0.15); }
.dark .wa-template-textarea { background: #252538; border-color: #2e2e42; }
.dark .wa-template-textarea:focus { border-color: #25d366; }
.dark .wa-bubble { background: #1a3a2a; color: #e4e4e7; }
.dark .wa-bubble--overdue { background: #3b1111; color: #fca5a5; }
.dark .wa-bubble-time { color: rgba(255,255,255,0.3); }

/* WhatsApp settings */
.wa-settings-section { margin-bottom: 20px; }
.wa-settings-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.wa-settings-title {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.wa-settings-subtitle {
  font-size: 12px; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.wa-settings-details { margin-top: 4px; }
.wa-chips-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.wa-chip {
  height: 34px; padding: 0 14px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.wa-chip:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.wa-chip--active {
  background: rgba(37, 211, 102, 0.12); color: #047857;
  box-shadow: inset 0 0 0 1.5px rgba(4, 120, 87, 0.3);
}
.wa-textarea {
  resize: vertical; min-height: 72px; line-height: 1.5;
  font-family: inherit;
}
.wa-var-chips {
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
}
.wa-var-chip {
  height: 26px; padding: 0 10px; border-radius: 6px; border: none;
  background: rgba(37, 211, 102, 0.08); color: #047857;
  font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.wa-var-chip:hover { background: rgba(37, 211, 102, 0.18); }
.wa-preview { margin-top: 12px; }
.wa-preview-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.35); margin-bottom: 6px;
}
.wa-preview-bubble {
  padding: 10px 14px; border-radius: 0 12px 12px 12px;
  background: rgba(37, 211, 102, 0.07);
  border: 1px solid rgba(37, 211, 102, 0.15);
  font-size: 13px; line-height: 1.5; white-space: pre-line;
  color: rgba(var(--v-theme-on-surface), 0.75);
  max-width: 400px;
}
.wa-preview-bubble--overdue {
  background: rgba(239, 68, 68, 0.05);
  border-color: rgba(239, 68, 68, 0.15);
}
.btn-whatsapp-save {
  display: inline-flex; align-items: center; gap: 8px;
  height: 44px; padding: 0 24px; border-radius: 12px; border: none;
  background: #25d366; color: #fff;
  font-size: 14px; font-weight: 700;
  cursor: pointer; transition: all 0.15s;
  margin-top: 4px;
}
.btn-whatsapp-save:hover { background: #1da851; }
.btn-whatsapp-save:disabled { opacity: 0.6; cursor: not-allowed; }

/* Verification */
.verification-status {
  display: flex; flex-direction: column; align-items: center;
  padding: 16px 0 20px; gap: 10px;
}
.verification-progress-text {
  font-size: 16px; font-weight: 700; color: #047857;
}
.verification-level-text {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.verification-steps {
  display: flex; flex-direction: column; gap: 10px;
}
.verification-step {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.verification-step.done {
  background: rgba(4, 120, 87, 0.04);
  border-color: rgba(4, 120, 87, 0.12);
}
.verification-step-icon {
  width: 32px; height: 32px; min-width: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.verification-step.done .verification-step-icon {
  background: rgba(4, 120, 87, 0.12); color: #047857;
}
.verification-step-info {
  display: flex; flex-direction: column; gap: 1px;
}
.verification-step-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.verification-step.done .verification-step-label { color: #047857; }
.verification-step-desc {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* Current plan banner */
.current-plan-banner {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-radius: 12px; margin-bottom: 20px;
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.08) 0%, rgba(4, 120, 87, 0.03) 100%);
  border: 1px solid rgba(4, 120, 87, 0.15);
}
.current-plan-left {
  display: flex; align-items: center; gap: 12px; color: #047857;
}
.current-plan-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.current-plan-name {
  font-size: 16px; font-weight: 700; color: #047857;
}
.current-plan-right {
  text-align: right;
}
.current-plan-expiry {
  font-size: 13px; font-weight: 600;
  color: #047857;
}
.current-plan-date {
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.usage-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-radius: 10px; font-size: 13px;
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-primary), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* Billing toggle */
.billing-toggle-wrap {
  display: inline-flex; gap: 4px;
  padding: 4px; border-radius: 10px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.billing-toggle-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 18px; border-radius: 8px; border: none;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: transparent;
  cursor: pointer; transition: all 0.15s;
}
.billing-toggle-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.billing-toggle-btn.active {
  background: #047857; color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(4, 120, 87, 0.25);
}
.billing-discount-badge {
  padding: 2px 7px; border-radius: 5px;
  font-size: 11px; font-weight: 700;
  background: rgba(4, 120, 87, 0.12);
  color: #047857;
}
.billing-toggle-btn.active .billing-discount-badge {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

/* Yearly info on card */
.plan-yearly-info {
  text-align: center; margin-bottom: 4px;
}
.plan-yearly-total {
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.plan-yearly-saving {
  font-size: 11px; font-weight: 600;
  color: #047857;
}

/* Plans grid */
.plans-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
}
@media (max-width: 1200px) {
  .plans-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 650px) {
  .plans-grid { grid-template-columns: 1fr; }
}
.plan-card {
  position: relative; padding: 24px 20px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  display: flex; flex-direction: column; align-items: center;
  transition: all 0.2s;
}
.plan-card:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.06);
}
.plan-card--active {
  border-color: #047857;
  border-width: 2px;
  background: rgba(4, 120, 87, 0.04);
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.1), 0 4px 16px rgba(4, 120, 87, 0.08);
}
.plan-card--popular {
  border-color: rgba(4, 120, 87, 0.2);
}
.plan-popular-badge {
  position: absolute; top: -10px;
  padding: 3px 12px; border-radius: 6px;
  background: #047857; color: #fff;
  font-size: 11px; font-weight: 600;
}
.plan-icon-wrap {
  width: 48px; height: 48px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-bottom: 12px;
}
.plan-card--popular .plan-icon-wrap,
.plan-card--active .plan-icon-wrap {
  background: rgba(4, 120, 87, 0.1); color: #047857;
}
.plan-name {
  font-size: 16px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 4px;
}
.plan-price {
  font-size: 22px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 0;
  line-height: 1.2;
}
.plan-price-note {
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 12px;
}

/* Response price */
.plan-response-price {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 14px;
}
.plan-response-price strong {
  font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8);
}
.plan-response-price--free {
  background: rgba(4, 120, 87, 0.08);
  color: #047857;
}
.plan-response-price--free strong { color: #047857; }
.plan-response-price--free .v-icon { color: #047857; }

.plan-divider {
  width: 100%; height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  margin-bottom: 14px;
}

.plan-includes-badge {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 8px 12px; margin-bottom: 10px;
  border-radius: 8px;
  background: rgba(4, 120, 87, 0.08);
  border: 1px solid rgba(4, 120, 87, 0.15);
  font-size: 13px; font-weight: 600;
  color: #047857;
}
.plan-includes-badge .v-icon { color: #047857; }

.plan-features {
  display: flex; flex-direction: column; gap: 8px;
  width: 100%;
}
.plan-feature {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.plan-feature .v-icon { color: #047857; flex-shrink: 0; margin-top: 1px; }

.plan-limitations {
  display: flex; flex-direction: column; gap: 6px;
  width: 100%; margin-top: 8px;
}
.plan-limitation {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: #d32f2f;
}
.plan-limitation .v-icon { color: #d32f2f; flex-shrink: 0; }

.plan-btn-wrap {
  width: 100%; margin-top: auto; padding-top: 16px;
}

.btn-plan {
  width: 100%; height: 40px; border-radius: 10px; border: none;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.btn-plan:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.btn-plan--primary {
  background: #047857; color: #fff;
}
.btn-plan--primary:hover { background: #065f46; }
.btn-plan--current {
  background: rgba(4, 120, 87, 0.08); color: #047857;
  cursor: default;
}

/* Comparison note */
.plans-comparison-note {
  display: flex; align-items: center; gap: 8px;
  margin-top: 20px; padding: 12px 16px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
}
.plans-comparison-note strong { color: #047857; font-weight: 600; }
.plans-comparison-note .v-icon { color: rgba(var(--v-theme-on-surface), 0.35); flex-shrink: 0; }

/* Subscription dialog */
.sub-dialog {
  background: #fff; border-radius: 20px;
  padding: 32px; position: relative;
  overflow: hidden;
}
.sub-dialog-close {
  position: absolute; top: 16px; right: 16px; z-index: 1;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.sub-dialog-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.sub-dialog-header {
  text-align: center; margin-bottom: 20px;
}
.sub-dialog-icon {
  width: 56px; height: 56px; border-radius: 14px; margin: 0 auto 12px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.1); color: #047857;
}
.sub-dialog-title {
  font-size: 20px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 4px;
}
.sub-dialog-price {
  font-size: 32px; font-weight: 800;
  color: #047857; line-height: 1.2;
}
.sub-dialog-price-note {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.sub-dialog-total {
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 2px;
}

/* Period toggle in dialog */
.sub-dialog-period {
  display: flex; gap: 4px; padding: 4px;
  border-radius: 10px; margin-bottom: 16px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.sub-period-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px; border: none;
  font-size: 13px; font-weight: 500; cursor: pointer;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.5);
  transition: all 0.15s;
}
.sub-period-btn:hover { color: rgba(var(--v-theme-on-surface), 0.7); }
.sub-period-btn.active {
  background: #047857; color: #fff; font-weight: 600;
  box-shadow: 0 2px 6px rgba(4, 120, 87, 0.25);
}
.sub-period-badge {
  padding: 1px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 700;
  background: rgba(4, 120, 87, 0.12); color: #047857;
}
.sub-period-btn.active .sub-period-badge {
  background: rgba(255,255,255,0.2); color: #fff;
}

/* Saving */
.sub-dialog-saving {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px; margin-bottom: 16px;
  background: #f0fdf4; border: 1px solid #bbf7d0;
  font-size: 13px; font-weight: 600; color: #047857;
}

/* Field */
.sub-dialog-field {
  margin-bottom: 16px;
}
.sub-dialog-label {
  display: block; font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-bottom: 6px;
}
.sub-dialog-textarea {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.8);
  resize: none; outline: none; font-family: inherit;
  transition: border-color 0.15s;
}
.sub-dialog-textarea:focus {
  border-color: #047857;
}

/* Buttons */
.sub-dialog-btn {
  width: 100%; height: 44px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all 0.15s;
}
.sub-dialog-btn--primary {
  background: #047857; color: #fff;
}
.sub-dialog-btn--primary:hover { background: #065f46; }
.sub-dialog-btn--primary:disabled {
  opacity: 0.6; cursor: not-allowed;
}

/* Divider */
.sub-dialog-divider {
  display: flex; align-items: center; gap: 12px;
  margin: 20px 0;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.35);
}
.sub-dialog-divider::before,
.sub-dialog-divider::after {
  content: ''; flex: 1; height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

/* Contact buttons */
.sub-dialog-contacts {
  display: flex; gap: 10px;
}
.sub-contact-btn {
  flex: 1; height: 40px; border-radius: 10px; border: none;
  font-size: 13px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  text-decoration: none; transition: all 0.15s;
}
.sub-contact-btn--wa {
  background: #25d366; color: #fff;
}
.sub-contact-btn--wa:hover { background: #1fb855; }
.sub-contact-btn--tg {
  background: #229ed9; color: #fff;
}
.sub-contact-btn--tg:hover { background: #1a8bc2; }

/* Success state */
.sub-dialog-success {
  text-align: center; padding: 12px 0;
}
.sub-dialog-success .v-icon { color: #047857; margin-bottom: 12px; }
.sub-dialog-success-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 6px;
}
.sub-dialog-success-text {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  margin-bottom: 20px; line-height: 1.5;
}

/* Dark mode */
.dark .settings-tab.active {
  background: #047857; color: #fff;
  box-shadow: 0 2px 6px rgba(4, 120, 87, 0.3);
}
.dark .field-input {
  background: #252538; border-color: #2e2e42; color: #e4e4e7;
}
.dark .field-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .profile-card-visual {
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.12) 0%, rgba(4, 120, 87, 0.04) 100%);
  border-color: rgba(4, 120, 87, 0.2);
}
.dark .stat-item { background: #1e1e2e; border-color: #2e2e42; }
.dark .plan-card { background: #1e1e2e; border-color: #2e2e42; box-shadow: none; }
.dark .plan-card:hover { border-color: #3e3e52; box-shadow: 0 4px 16px rgba(0,0,0,0.2); }
.dark .plan-card--active { background: rgba(4, 120, 87, 0.08); border-color: #047857; box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.15), 0 4px 16px rgba(4, 120, 87, 0.1); }
.dark .plan-includes-badge { background: rgba(4, 120, 87, 0.12); border-color: rgba(4, 120, 87, 0.2); }
.dark .plan-response-price { background: #252538; }
.dark .plan-response-price--free { background: rgba(4, 120, 87, 0.1); }
.dark .plan-divider { background: #2e2e42; }
.dark .plans-comparison-note { background: #1a1a2e; border-color: #2e2e42; }
.dark .verification-step { background: #1e1e2e; border-color: #2e2e42; }
.dark .verification-step.done { background: rgba(4, 120, 87, 0.06); border-color: rgba(4, 120, 87, 0.2); }
.dark .current-plan-banner {
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.12) 0%, rgba(4, 120, 87, 0.04) 100%);
  border-color: rgba(4, 120, 87, 0.2);
}
.dark .settings-tabs { background: #1a1a2e; border-color: #2e2e42; }
.dark .billing-toggle-wrap { background: #1a1a2e; border-color: #2e2e42; box-shadow: none; }
.dark .billing-toggle-btn.active { background: #047857; color: #fff; }
.dark .billing-discount-badge { background: rgba(4, 120, 87, 0.2); color: #34d399; }
.dark .billing-toggle-btn.active .billing-discount-badge { background: rgba(255,255,255,0.2); color: #fff; }
.dark .info-banner {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.2);
}
.dark .info-banner--success {
  background: rgba(4, 120, 87, 0.1);
  border-color: rgba(4, 120, 87, 0.2);
}
.dark .info-banner--error {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
}
.dark .role-badge {
  background: rgba(4, 120, 87, 0.15); color: #34d399;
}
.dark .profile-card-role {
  background: rgba(4, 120, 87, 0.15); color: #34d399;
}
.dark .profile-plan-badge {
  background: rgba(232, 185, 49, 0.08); border-color: rgba(232, 185, 49, 0.18);
}
.dark .wa-chip { background: #252538; color: rgba(var(--v-theme-on-surface), 0.5); }
.dark .wa-chip:hover { background: #2e2e42; }
.dark .wa-chip--active { background: rgba(37, 211, 102, 0.15); color: #34d399; }
.dark .wa-var-chip { background: rgba(37, 211, 102, 0.1); color: #34d399; }
.dark .wa-var-chip:hover { background: rgba(37, 211, 102, 0.2); }
.dark .wa-preview-bubble { background: rgba(37, 211, 102, 0.06); border-color: rgba(37, 211, 102, 0.12); }
.dark .wa-preview-bubble--overdue { background: rgba(239, 68, 68, 0.06); border-color: rgba(239, 68, 68, 0.12); }

/* Dialog dark */
.dark .sub-dialog { background: #1a1a2e; }
.dark .sub-dialog-close { background: #252538; color: #71717a; }
.dark .sub-dialog-close:hover { background: #2e2e42; color: #a1a1aa; }
.dark .sub-dialog-period { background: #252538; border-color: #2e2e42; }
.dark .sub-period-btn { color: #71717a; }
.dark .sub-period-btn.active { background: #047857; color: #fff; }
.dark .sub-period-badge { background: rgba(4,120,87,0.2); color: #34d399; }
.dark .sub-period-btn.active .sub-period-badge { background: rgba(255,255,255,0.2); color: #fff; }
.dark .sub-dialog-saving { background: rgba(4,120,87,0.1); border-color: rgba(4,120,87,0.2); }
.dark .sub-dialog-textarea { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .sub-dialog-textarea:focus { border-color: #047857; }
</style>
