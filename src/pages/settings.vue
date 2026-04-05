<script lang="ts" setup>
import { useAuthStore } from '@/stores/auth'
import { formatPhone, formatDate } from '@/utils/formatters'
import { CITIES } from '@/constants/cities'

import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { api } from '@/api/client'

const { isDark } = useIsDark()
const toast = useToast()
const authStore = useAuthStore()

// Tabs
const activeTab = ref<'profile' | 'security' | 'subscription'>('profile')

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
  free: 'Без подписки',
  standard: 'Стандарт',
  business: 'Бизнес',
  premium: 'Премиум',
}

const plans = [
  {
    id: 'free',
    label: 'Без подписки',
    price: '0 ₽',
    priceNote: 'навсегда',
    responsePrice: '500 ₽',
    features: [
      'До 3 активных сделок',
      'Отклик на заявку — 500 ₽',
      'Калькулятор рассрочки',
      'Стандартная поддержка',
    ],
    limitations: [
      'Нет аналитики',
      'Нет экспорта',
      'Нет приоритета в каталоге',
    ],
    icon: 'mdi-gift-outline',
  },
  {
    id: 'standard',
    label: 'Стандарт',
    price: '3 900 ₽',
    priceNote: 'в месяц',
    responsePrice: '300 ₽',
    features: [
      'До 15 активных сделок',
      'Отклик на заявку — 300 ₽',
      'Базовая аналитика',
      'Экспорт PDF',
      'Приоритетная поддержка',
    ],
    limitations: [
      'Нет приоритета в каталоге',
    ],
    icon: 'mdi-star-outline',
  },
  {
    id: 'business',
    label: 'Бизнес',
    price: '7 900 ₽',
    priceNote: 'в месяц',
    responsePrice: '100 ₽',
    features: [
      'До 50 активных сделок',
      'Отклик на заявку — 100 ₽',
      'Полная аналитика + графики',
      'Экспорт PDF / Excel',
      'Приоритет в каталоге',
      'Персональный менеджер',
    ],
    limitations: [],
    icon: 'mdi-rocket-launch-outline',
    popular: true,
  },
  {
    id: 'premium',
    label: 'Премиум',
    price: '11 900 ₽',
    priceNote: 'в месяц',
    responsePrice: 'Бесплатно',
    features: [
      'Безлимит активных сделок',
      'Отклик на заявку — бесплатно',
      'Полная аналитика + графики',
      'Экспорт PDF / Excel / API',
      'Топ-приоритет в каталоге',
      'Персональный менеджер',
      'Кастомные отчёты',
      'Ранний доступ к фичам',
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
                <input v-model="editForm.phone" type="tel" class="field-input" placeholder="+7 (___) ___-__-__" />
              </div>
              <div class="form-field">
                <label class="field-label">Город <span class="required">*</span></label>
                <select v-model="editForm.city" class="field-input field-select">
                  <option value="" disabled>Выберите город</option>
                  <option v-for="c in CITIES" :key="c" :value="c">{{ c }}</option>
                </select>
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
            <div class="profile-card-role">
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

    <!-- Subscription Tab -->
    <div v-if="activeTab === 'subscription'" class="tab-content">
      <!-- Current plan -->
      <div v-if="authStore.user?.subscriptionPlan !== 'free'" class="current-plan-banner">
        <div class="current-plan-left">
          <v-icon icon="mdi-crown" size="20" />
          <div>
            <div class="current-plan-label">Текущий план</div>
            <div class="current-plan-name">{{ planLabels[authStore.user?.subscriptionPlan || 'free'] }}</div>
          </div>
        </div>
        <div v-if="authStore.user?.subscriptionExpiry" class="current-plan-expiry">
          до {{ formatDate(authStore.user.subscriptionExpiry) }}
        </div>
      </div>

      <!-- Response cost explainer -->
      <div class="info-banner mb-5">
        <v-icon icon="mdi-information-outline" size="18" />
        <span>Клиенты оставляют заявки бесплатно. Чтобы связаться с клиентом, нужно оплатить отклик. Чем выше подписка — тем дешевле отклик.</span>
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
          <div class="plan-price">{{ plan.price }}</div>
          <div class="plan-price-note">{{ plan.priceNote }}</div>

          <!-- Response price highlight -->
          <div class="plan-response-price" :class="{ 'plan-response-price--free': plan.responsePrice === 'Бесплатно' }">
            <v-icon :icon="plan.responsePrice === 'Бесплатно' ? 'mdi-check-circle' : 'mdi-message-reply-text-outline'" size="16" />
            <span>Отклик: <strong>{{ plan.responsePrice }}</strong></span>
          </div>

          <div class="plan-divider" />

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
              Текущий план
            </button>
            <button
              v-else
              class="btn-plan"
              :class="{ 'btn-plan--primary': plan.popular || plan.id === 'premium' }"
            >
              {{ plan.id === 'free' ? 'Текущий' : 'Выбрать' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Comparison note -->
      <div class="plans-comparison-note">
        <v-icon icon="mdi-scale-balance" size="16" />
        <span>При 20+ откликах в месяц подписка <strong>Бизнес</strong> окупается. При 25+ — выгоднее <strong>Премиум</strong>.</span>
      </div>
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
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
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
  background: #fff;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
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

/* Delete account */
.delete-account-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; margin-top: 32px;
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
.current-plan-expiry {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
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
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  display: flex; flex-direction: column; align-items: center;
  transition: all 0.2s;
}
.plan-card:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.05);
}
.plan-card--active {
  border-color: rgba(4, 120, 87, 0.3);
  background: rgba(4, 120, 87, 0.03);
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
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.35);
}
.plan-limitation .v-icon { color: rgba(var(--v-theme-on-surface), 0.25); flex-shrink: 0; }

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

/* Dark mode */
.dark .settings-tab.active {
  background: #252538; color: #e4e4e7;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
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
.dark .plan-card { background: #1e1e2e; border-color: #2e2e42; }
.dark .plan-card:hover { border-color: #3e3e52; box-shadow: 0 4px 16px rgba(0,0,0,0.2); }
.dark .plan-card--active { background: rgba(4, 120, 87, 0.06); border-color: rgba(4, 120, 87, 0.25); }
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
</style>
