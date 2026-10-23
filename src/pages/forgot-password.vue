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

const email = ref('')
const isLoading = ref(false)
const sent = ref(false)
const emailField = ref<{ focus: () => void } | null>(null)
/** Поле обводится красным, текст ошибки — уведомлением (блок над формой сдвигал её). */
const invalid = ref(false)
watch(email, () => { invalid.value = false })

const handleSubmit = async () => {
  if (!email.value.trim()) {
    invalid.value = true
    toast.error('Введите email')
    emailField.value?.focus()
    return
  }

  isLoading.value = true

  try {
    await api.post('/auth/investor/forgot-password', { email: email.value })
    sent.value = true
  } catch (e) {
    if (isAuthFormError(e)) {
      invalid.value = true
      toast.error(toUserMessage(e, 'Не удалось отправить письмо'))
    }
    else toast.error(e, 'Не удалось отправить письмо — попробуйте ещё раз')
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <v-main class="auth-page">
    <!-- Left: decorative (только на компьютере) -->
    <div class="fp-left d-none d-md-flex">
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
    <div class="auth-panel">
      <div class="auth-card">
        <div class="auth-brand">
          <img :src="logo" alt="" class="auth-brand-logo" />
          <img :src="isDark ? logoTextDark : logoText" alt="MizanPay" class="auth-brand-text" />
        </div>

        <!-- Success state -->
        <div v-if="sent" class="fp-success">
          <div class="fp-success-icon">
            <v-icon icon="mdi-email-check-outline" size="36" />
          </div>
          <h1 class="auth-title">Письмо отправлено</h1>
          <p class="auth-subtitle fp-success-desc">
            Если аккаунт с email <strong class="fp-email">{{ email }}</strong> существует, мы отправили ссылку для сброса пароля.
          </p>
          <div class="fp-success-hint" :style="{ color: isDark ? '#fbbf24' : '#b45309' }">
            <v-icon icon="mdi-information-outline" size="16" />
            <span>Проверьте папку «Спам», если письмо не пришло</span>
          </div>
          <v-btn
            to="/login"
            variant="tonal"
            size="x-large"
            block
            rounded="lg"
            prepend-icon="mdi-arrow-left"
            class="auth-btn"
          >
            Вернуться к входу
          </v-btn>
        </div>

        <!-- Form state -->
        <template v-else>
          <h1 class="auth-title">Сброс пароля</h1>
          <p class="auth-subtitle">Введите email, указанный при регистрации, — пришлём ссылку для нового пароля</p>


          <form @submit.prevent="handleSubmit">
            <div class="auth-field mb-6">
              <label class="auth-label" for="fp-email">Email</label>
              <v-text-field
                id="fp-email"
                ref="emailField"
                v-model="email"
                :error="invalid"
                type="email"
                variant="outlined"
                density="comfortable"
                placeholder="name@example.com"
                prepend-inner-icon="mdi-email-outline"
                hide-details="auto"
                rounded="lg"
                autocomplete="email"
                inputmode="email"
                autocapitalize="none"
                :spellcheck="false"
                enterkeyhint="send"
                autofocus
              />
            </div>

            <v-btn
              type="submit"
              color="primary"
              size="x-large"
              block
              rounded="lg"
              :loading="isLoading"
              prepend-icon="mdi-send"
              class="auth-btn"
            >
              Отправить ссылку
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
/* Left panel — только на компьютере; тёмно-зелёная в любой теме */
.fp-left {
  width: 420px; min-width: 420px;
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  align-items: center; justify-content: center;
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

/* Success */
.fp-success-icon {
  width: 64px; height: 64px; border-radius: 50%; margin-bottom: 20px;
  background: rgba(var(--v-theme-accent), 0.12); color: rgb(var(--v-theme-accent));
  display: flex; align-items: center; justify-content: center;
}
.fp-success-desc { margin-bottom: 16px; }
/* Длинный адрес не должен растягивать страницу вбок на узком экране. */
.fp-email { color: rgba(var(--v-theme-on-surface), 0.85); overflow-wrap: anywhere; }
.fp-success-hint {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(245, 158, 11, 0.1);
  font-size: 0.85rem; font-weight: 500; line-height: 1.4;
  margin-bottom: 24px;
}
.fp-success-hint .v-icon { margin-top: 1px; flex-shrink: 0; }
</style>
