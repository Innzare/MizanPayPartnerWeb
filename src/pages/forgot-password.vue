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

const email = ref('')
const isLoading = ref(false)
const error = ref('')
const sent = ref(false)

const handleSubmit = async () => {
  if (!email.value) {
    error.value = 'Введите email'
    return
  }

  error.value = ''
  isLoading.value = true

  try {
    await api.post('/auth/investor/forgot-password', { email: email.value })
    sent.value = true
  } catch (e: any) {
    error.value = e?.message || 'Ошибка отправки'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <v-main class="forgot-page">
    <div class="forgot-panel">
      <div class="forgot-wrapper">
        <div class="d-flex align-center justify-center ga-2 mb-8">
          <v-img :src="logo" width="36" height="36" />
          <img :src="logoText" alt="MizanPay" style="height: 22px; width: auto;" />
        </div>

        <!-- Success state -->
        <template v-if="sent">
          <div class="text-center">
            <v-icon icon="mdi-email-check-outline" size="64" color="success" class="mb-4" />
            <h2 class="forgot-title mb-3">Письмо отправлено</h2>
            <p class="forgot-subtitle mb-6">
              Если аккаунт с email <strong>{{ email }}</strong> существует, мы отправили ссылку для сброса пароля. Проверьте почту.
            </p>
            <v-btn
              variant="text"
              color="primary"
              to="/login"
              class="text-none"
            >
              Вернуться к входу
            </v-btn>
          </div>
        </template>

        <!-- Form state -->
        <template v-else>
          <div class="mb-6">
            <h2 class="forgot-title mb-2">Сброс пароля</h2>
            <p class="forgot-subtitle">Введите email, указанный при регистрации. Мы отправим ссылку для сброса пароля.</p>
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
            <div class="mb-6">
              <label class="field-label">Email</label>
              <v-text-field
                v-model="email"
                type="email"
                variant="outlined"
                density="comfortable"
                placeholder="name@example.com"
                prepend-inner-icon="mdi-email-outline"
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
              Отправить ссылку
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
.forgot-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafdfb;
}

.forgot-panel {
  width: 100%;
  max-width: 440px;
  padding: 32px;
}

.forgot-wrapper {
  width: 100%;
}

.forgot-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0c1a12;
  letter-spacing: -0.02em;
}

.forgot-subtitle {
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
