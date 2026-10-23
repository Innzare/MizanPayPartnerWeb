<route lang="json">
{
  "meta": {
    "layout": "auth"
  }
}
</route>

<script lang="ts" setup>
import { api } from '@/api/client'
import { isAuthFormError, toUserMessage } from '@/api/errors'
import { useToast } from '@/composables/useToast'

const toast = useToast()
import logo from '@/assets/images/logo.svg'
import logoText from '@/assets/images/logo-text.svg'
import logoTextDark from '@/assets/images/logo-text-dark.svg'
import { useIsDark } from '@/composables/useIsDark'

const { isDark } = useIsDark()

const route = useRoute()
const router = useRouter()

const newPassword = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const isLoading = ref(false)
const success = ref(false)
const newField = ref<{ focus: () => void } | null>(null)
const confirmField = ref<{ focus: () => void } | null>(null)
/** Какое поле обвести красным; текст ошибки — уведомлением (блок над формой сдвигал её). */
const invalid = ref<'new' | 'confirm' | null>(null)
watch([newPassword, confirmPassword], () => { invalid.value = null })

function fail(field: 'new' | 'confirm', message: string) {
  invalid.value = field
  toast.error(message)
  ;(field === 'new' ? newField : confirmField).value?.focus()
}

/** Enter в первом поле — ко второму (на телефоне кнопка «Далее»). */
const toConfirm = () => {
  if (confirmPassword.value) handleSubmit()
  else confirmField.value?.focus()
}

const token = computed(() => (route.query.token as string) || '')

const handleSubmit = async () => {
  if (!token.value) {
    toast.error('Недействительная ссылка для сброса пароля')
    return
  }

  if (!newPassword.value) return fail('new', 'Введите новый пароль')
  if (newPassword.value.length < 6) return fail('new', 'Пароль должен быть не менее 6 символов')
  if (!confirmPassword.value) return fail('confirm', 'Повторите пароль')
  if (newPassword.value !== confirmPassword.value) return fail('confirm', 'Пароли не совпадают')

  isLoading.value = true

  try {
    await api.post('/auth/investor/reset-password', {
      token: token.value,
      newPassword: newPassword.value,
    })
    success.value = true
  } catch (e) {
    if (isAuthFormError(e)) toast.error(toUserMessage(e, 'Не удалось сменить пароль'))
    else toast.error(e, 'Не удалось сменить пароль — попробуйте ещё раз')
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <v-main class="auth-page">
    <div class="auth-panel">
      <div class="auth-card">
        <div class="auth-brand">
          <img :src="logo" alt="" class="auth-brand-logo" />
          <img :src="isDark ? logoTextDark : logoText" alt="MizanPay" class="auth-brand-text" />
        </div>

        <!-- Success state -->
        <template v-if="success">
          <div class="rp-state-icon rp-state-icon--ok">
            <v-icon icon="mdi-check-circle-outline" size="36" />
          </div>
          <h1 class="auth-title">Пароль изменён</h1>
          <p class="auth-subtitle">
            Ваш пароль успешно обновлён. Теперь вы можете войти с новым паролем.
          </p>
          <v-btn
            color="primary"
            size="x-large"
            rounded="lg"
            block
            class="auth-btn"
            @click="router.push('/login')"
          >
            Войти
          </v-btn>
        </template>

        <!-- No token -->
        <template v-else-if="!token">
          <div class="rp-state-icon rp-state-icon--bad">
            <v-icon icon="mdi-link-off" size="36" />
          </div>
          <h1 class="auth-title">Недействительная ссылка</h1>
          <p class="auth-subtitle">
            Ссылка для сброса пароля недействительна или повреждена. Запросите новую.
          </p>
          <v-btn
            to="/forgot-password"
            color="primary"
            size="x-large"
            rounded="lg"
            block
            class="auth-btn"
          >
            Запросить новую ссылку
          </v-btn>
          <div class="text-center mt-4">
            <router-link to="/login" class="auth-link auth-link--muted">
              <v-icon icon="mdi-arrow-left" size="16" />
              Вернуться к входу
            </router-link>
          </div>
        </template>

        <!-- Form state -->
        <template v-else>
          <h1 class="auth-title">Новый пароль</h1>
          <p class="auth-subtitle">Придумайте новый пароль для вашего аккаунта</p>


          <form @submit.prevent="handleSubmit">
            <div class="auth-field">
              <label class="auth-label" for="rp-new">Новый пароль</label>
              <v-text-field
                id="rp-new"
                ref="newField"
                v-model="newPassword"
                :error="invalid === 'new'"
                :type="showPassword ? 'text' : 'password'"
                variant="outlined"
                density="comfortable"
                placeholder="Минимум 6 символов"
                prepend-inner-icon="mdi-lock-outline"
                hide-details="auto"
                rounded="lg"
                autocomplete="new-password"
                autocapitalize="none"
                :spellcheck="false"
                enterkeyhint="next"
                @keydown.enter.prevent="toConfirm"
              >
                <template #append-inner>
                  <button
                    type="button"
                    class="auth-eye"
                    :aria-label="showPassword ? 'Скрыть пароль' : 'Показать пароль'"
                    @click="showPassword = !showPassword"
                  >
                    <v-icon :icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'" size="22" />
                  </button>
                </template>
              </v-text-field>
            </div>

            <div class="auth-field mb-6">
              <label class="auth-label" for="rp-confirm">Подтвердите пароль</label>
              <v-text-field
                id="rp-confirm"
                ref="confirmField"
                v-model="confirmPassword"
                :error="invalid === 'confirm'"
                :type="showPassword ? 'text' : 'password'"
                variant="outlined"
                density="comfortable"
                placeholder="Повторите пароль"
                prepend-inner-icon="mdi-lock-check-outline"
                hide-details="auto"
                rounded="lg"
                autocomplete="new-password"
                autocapitalize="none"
                :spellcheck="false"
                enterkeyhint="done"
              />
            </div>

            <v-btn
              type="submit"
              color="primary"
              size="x-large"
              block
              rounded="lg"
              :loading="isLoading"
              class="auth-btn"
            >
              Сохранить пароль
            </v-btn>
          </form>

          <div class="text-center mt-4">
            <router-link to="/login" class="auth-link auth-link--muted">
              <v-icon icon="mdi-arrow-left" size="16" />
              Вернуться к входу
            </router-link>
          </div>
        </template>
      </div>
    </div>
  </v-main>
</template>

<style scoped>
.rp-state-icon {
  width: 64px; height: 64px; border-radius: 50%; margin-bottom: 20px;
  display: flex; align-items: center; justify-content: center;
}
.rp-state-icon--ok { background: rgba(var(--v-theme-success), 0.12); color: rgb(var(--v-theme-success)); }
.rp-state-icon--bad { background: rgba(var(--v-theme-error), 0.12); color: rgb(var(--v-theme-error)); }
</style>
