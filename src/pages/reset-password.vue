<route lang="json">
{
  "meta": {
    "layout": "auth"
  }
}
</route>

<script lang="ts" setup>
import { api } from '@/api/client'
import logo from '@/assets/images/logo.svg'
import logoText from '@/assets/images/logo-text.svg'

const route = useRoute()
const router = useRouter()

const newPassword = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const isLoading = ref(false)
const error = ref('')
const success = ref(false)

const token = computed(() => (route.query.token as string) || '')

const handleSubmit = async () => {
  if (!token.value) {
    error.value = 'Недействительная ссылка для сброса пароля'
    return
  }

  if (!newPassword.value || newPassword.value.length < 6) {
    error.value = 'Пароль должен быть не менее 6 символов'
    return
  }

  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Пароли не совпадают'
    return
  }

  error.value = ''
  isLoading.value = true

  try {
    await api.post('/auth/investor/reset-password', {
      token: token.value,
      newPassword: newPassword.value,
    })
    success.value = true
  } catch (e: any) {
    error.value = e?.message || 'Ошибка сброса пароля'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <v-main class="reset-page">
    <div class="reset-panel">
      <div class="reset-wrapper">
        <div class="d-flex align-center justify-center ga-2 mb-8">
          <v-img :src="logo" width="36" height="36" />
          <img :src="logoText" alt="MizanPay" style="height: 22px; width: auto;" />
        </div>

        <!-- Success state -->
        <template v-if="success">
          <div class="text-center">
            <v-icon icon="mdi-check-circle-outline" size="64" color="success" class="mb-4" />
            <h2 class="reset-title mb-3">Пароль изменён</h2>
            <p class="reset-subtitle mb-6">
              Ваш пароль успешно обновлён. Теперь вы можете войти с новым паролем.
            </p>
            <v-btn
              color="primary"
              size="large"
              rounded="lg"
              block
              class="submit-btn"
              @click="router.push('/login')"
            >
              Войти
            </v-btn>
          </div>
        </template>

        <!-- No token -->
        <template v-else-if="!token">
          <div class="text-center">
            <v-icon icon="mdi-link-off" size="64" color="error" class="mb-4" />
            <h2 class="reset-title mb-3">Недействительная ссылка</h2>
            <p class="reset-subtitle mb-6">
              Ссылка для сброса пароля недействительна или повреждена. Запросите новую.
            </p>
            <v-btn
              variant="text"
              color="primary"
              to="/forgot-password"
              class="text-none"
            >
              Запросить новую ссылку
            </v-btn>
          </div>
        </template>

        <!-- Form state -->
        <template v-else>
          <div class="mb-6">
            <h2 class="reset-title mb-2">Новый пароль</h2>
            <p class="reset-subtitle">Придумайте новый пароль для вашего аккаунта</p>
          </div>

          <v-alert
            v-if="error"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-5"
            closable
            @click:close="error = ''"
          >
            {{ error }}
          </v-alert>

          <form @submit.prevent="handleSubmit">
            <div class="mb-5">
              <label class="field-label">Новый пароль</label>
              <v-text-field
                v-model="newPassword"
                :type="showPassword ? 'text' : 'password'"
                variant="outlined"
                density="comfortable"
                placeholder="Минимум 6 символов"
                prepend-inner-icon="mdi-lock-outline"
                :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                hide-details="auto"
                rounded="lg"
                @click:append-inner="showPassword = !showPassword"
              />
            </div>

            <div class="mb-6">
              <label class="field-label">Подтвердите пароль</label>
              <v-text-field
                v-model="confirmPassword"
                :type="showPassword ? 'text' : 'password'"
                variant="outlined"
                density="comfortable"
                placeholder="Повторите пароль"
                prepend-inner-icon="mdi-lock-check-outline"
                hide-details="auto"
                rounded="lg"
              />
            </div>

            <v-btn
              type="submit"
              color="primary"
              size="x-large"
              block
              rounded="lg"
              :loading="isLoading"
              class="submit-btn mb-4"
            >
              Сохранить пароль
            </v-btn>
          </form>

          <div class="text-center">
            <router-link to="/login" class="back-link">
              <v-icon icon="mdi-arrow-left" size="16" class="mr-1" />
              Вернуться к входу
            </router-link>
          </div>
        </template>
      </div>
    </div>
  </v-main>
</template>

<style scoped>
.reset-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafdfb;
}

.reset-panel {
  width: 100%;
  max-width: 440px;
  padding: 32px;
}

.reset-wrapper {
  width: 100%;
}

.reset-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0c1a12;
  letter-spacing: -0.02em;
}

.reset-subtitle {
  font-size: 0.9rem;
  color: #5f7a6b;
  line-height: 1.5;
}

.field-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: #1a2e23;
  margin-bottom: 6px;
}

.submit-btn {
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  font-size: 0.95rem;
}

.back-link {
  font-size: 0.8rem;
  color: #047857;
  text-decoration: none;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
}

.back-link:hover {
  text-decoration: underline;
}
</style>
