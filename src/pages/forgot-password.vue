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
  <v-main class="fp-page">
    <div class="fp-container">
      <!-- Left: decorative -->
      <div class="fp-left">
        <div class="fp-left-content">
          <div class="fp-left-icon">
            <v-icon icon="mdi-lock-reset" size="48" />
          </div>
          <div class="fp-left-title">Восстановление доступа</div>
          <div class="fp-left-desc">Мы отправим ссылку для сброса пароля на вашу электронную почту</div>
          <div class="fp-left-steps">
            <div class="fp-step">
              <div class="fp-step-num">1</div>
              <span>Введите ваш email</span>
            </div>
            <div class="fp-step">
              <div class="fp-step-num">2</div>
              <span>Откройте письмо</span>
            </div>
            <div class="fp-step">
              <div class="fp-step-num">3</div>
              <span>Задайте новый пароль</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: form -->
      <div class="fp-right">
        <div class="fp-form-wrap">
          <div class="d-flex align-center ga-2 mb-8">
            <img :src="logo" alt="" style="width: 32px; height: 32px;" />
            <img :src="logoText" alt="MizanPay" style="height: 20px; width: auto;" />
          </div>

          <!-- Success state -->
          <template v-if="sent">
            <div class="fp-success">
              <div class="fp-success-icon">
                <v-icon icon="mdi-email-check-outline" size="36" />
              </div>
              <div class="fp-success-title">Письмо отправлено!</div>
              <div class="fp-success-desc">
                Если аккаунт с email <strong>{{ email }}</strong> существует, мы отправили ссылку для сброса пароля.
              </div>
              <div class="fp-success-hint">
                <v-icon icon="mdi-information-outline" size="14" />
                Проверьте папку «Спам», если письмо не пришло
              </div>
              <router-link to="/login" class="fp-back-btn">
                <v-icon icon="mdi-arrow-left" size="16" />
                Вернуться к входу
              </router-link>
            </div>
          </template>

          <!-- Form state -->
          <template v-else>
            <div class="fp-title">Сброс пароля</div>
            <div class="fp-subtitle">Введите email, указанный при регистрации</div>

            <div v-if="error" class="fp-error">
              <v-icon icon="mdi-alert-circle" size="16" />
              {{ error }}
              <button class="fp-error-close" @click="error = ''">
                <v-icon icon="mdi-close" size="14" />
              </button>
            </div>

            <form @submit.prevent="handleSubmit">
              <div class="fp-field">
                <label class="fp-label">Email</label>
                <div class="fp-input-wrap">
                  <v-icon icon="mdi-email-outline" size="18" class="fp-input-icon" />
                  <input
                    v-model="email"
                    type="email"
                    class="fp-input"
                    placeholder="name@example.com"
                    autofocus
                  />
                </div>
              </div>

              <button type="submit" class="fp-submit" :disabled="isLoading">
                <v-progress-circular v-if="isLoading" indeterminate size="18" width="2" color="white" />
                <v-icon v-else icon="mdi-send" size="18" />
                {{ isLoading ? 'Отправка...' : 'Отправить ссылку' }}
              </button>
            </form>

            <div class="fp-footer">
              <router-link to="/login" class="fp-back-link">
                <v-icon icon="mdi-arrow-left" size="14" />
                Вернуться к входу
              </router-link>
            </div>
          </template>
        </div>
      </div>
    </div>
  </v-main>
</template>

<style scoped>
.fp-page {
  min-height: 100vh;
  display: flex;
  background: #fafdfb;
}

.fp-container {
  display: flex; width: 100%; min-height: 100vh;
}

/* Left panel */
.fp-left {
  width: 420px; min-width: 420px;
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  display: flex; align-items: center; justify-content: center;
  padding: 48px;
}
.fp-left-content { color: #fff; }
.fp-left-icon {
  width: 80px; height: 80px; border-radius: 20px;
  background: rgba(255, 255, 255, 0.12);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 24px;
}
.fp-left-title {
  font-size: 26px; font-weight: 800;
  margin-bottom: 10px; line-height: 1.2;
}
.fp-left-desc {
  font-size: 14px; opacity: 0.7;
  line-height: 1.6; margin-bottom: 32px;
  max-width: 300px;
}
.fp-left-steps { display: flex; flex-direction: column; gap: 14px; }
.fp-step {
  display: flex; align-items: center; gap: 12px;
  font-size: 14px; font-weight: 500; opacity: 0.85;
}
.fp-step-num {
  width: 28px; height: 28px; border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; flex-shrink: 0;
}

/* Right panel */
.fp-right {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 48px;
}
.fp-form-wrap { width: 100%; max-width: 400px; }

.fp-title {
  font-size: 24px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 6px;
}
.fp-subtitle {
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 28px;
}

/* Error */
.fp-error {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(239, 68, 68, 0.08); color: #ef4444;
  font-size: 13px; font-weight: 500; margin-bottom: 20px;
}
.fp-error-close {
  margin-left: auto; background: none; border: none;
  color: #ef4444; cursor: pointer; opacity: 0.5;
}
.fp-error-close:hover { opacity: 1; }

/* Form */
.fp-field { margin-bottom: 20px; }
.fp-label {
  display: block; font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.03em;
}
.fp-input-wrap { position: relative; }
.fp-input-icon {
  position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
  color: rgba(var(--v-theme-on-surface), 0.3); pointer-events: none;
}
.fp-input {
  width: 100%; height: 48px; padding: 0 16px 0 42px;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px; font-size: 15px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.02);
  outline: none; transition: all 0.15s;
}
.fp-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.25); }
.fp-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 4px rgba(4, 120, 87, 0.08);
}

.fp-submit {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; height: 48px; border-radius: 12px; border: none;
  background: #047857; color: #fff;
  font-size: 15px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
}
.fp-submit:hover { background: #065f46; }
.fp-submit:disabled { opacity: 0.6; cursor: not-allowed; }

.fp-footer { text-align: center; margin-top: 20px; }
.fp-back-link {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  text-decoration: none; transition: color 0.12s;
}
.fp-back-link:hover { color: #047857; }

/* Success */
.fp-success { text-align: center; }
.fp-success-icon {
  width: 72px; height: 72px; border-radius: 50%; margin: 0 auto 20px;
  background: rgba(4, 120, 87, 0.1); color: #047857;
  display: flex; align-items: center; justify-content: center;
}
.fp-success-title {
  font-size: 22px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 8px;
}
.fp-success-desc {
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.5);
  line-height: 1.6; margin-bottom: 16px;
}
.fp-success-hint {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px;
  background: rgba(245, 158, 11, 0.08); color: #f59e0b;
  font-size: 12px; font-weight: 500; margin-bottom: 24px;
}
.fp-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 20px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 600; text-decoration: none;
  transition: all 0.12s;
}
.fp-back-btn:hover { background: rgba(var(--v-theme-on-surface), 0.08); }

@media (max-width: 900px) {
  .fp-left { display: none; }
  .fp-right { padding: 32px 24px; }
}
</style>
