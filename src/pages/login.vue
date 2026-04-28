<route lang="json">
{
  "meta": {
    "layout": "auth"
  }
}
</route>

<script lang="ts" setup>
import { useAuthStore } from "@/stores/auth";
import logo from "@/assets/images/logo.svg";
import logoText from "@/assets/images/logo-text.svg";

const authStore = useAuthStore();
const router = useRouter();

const email = ref("");
const password = ref("");
const showPassword = ref(false);
const isLoading = ref(false);
const error = ref("");

const handleLogin = async () => {
  if (!email.value || !password.value) {
    error.value = "Заполните все поля";
    return;
  }

  error.value = "";
  isLoading.value = true;

  try {
    await authStore.login(email.value, password.value);
    const redirect = (router.currentRoute.value.query.redirect as string) || authStore.defaultRoute;
    router.push(redirect);
  } catch (e: any) {
    error.value = e?.message || "Ошибка авторизации";
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <v-main class="login-page">
    <!-- Left panel — showcase -->
    <div class="login-brand d-none d-md-flex">
      <div class="brand-bg" />

      <div class="brand-content">
        <!-- Header -->
        <div class="d-flex align-center ga-3">
          <img :src="logo" alt="MizanPay" style="height: 36px; width: auto;" />
          <img :src="logoText" alt="MizanPay" style="height: 24px; width: auto; filter: brightness(0) invert(1);" />
          <span class="brand-badge">Partner</span>
        </div>

        <!-- Center — text -->
        <div class="brand-text-area">
          <h1 class="brand-title mb-4">
            Панель<br />инвестора
          </h1>
          <p class="brand-subtitle">
            Управляйте портфелем сделок, отслеживайте платежи
            и контролируйте прибыль — всё в одном месте.
          </p>
        </div>

        <!-- Bottom features -->
        <div class="brand-features">
          <div class="brand-feature">
            <div class="feature-icon">
              <v-icon icon="mdi-chart-line" size="18" color="white" />
            </div>
            <div>
              <div class="feature-title">Аналитика</div>
              <div class="feature-desc">ROI, прибыль, прогнозы</div>
            </div>
          </div>
          <div class="brand-feature">
            <div class="feature-icon">
              <v-icon icon="mdi-briefcase-outline" size="18" color="white" />
            </div>
            <div>
              <div class="feature-title">Сделки</div>
              <div class="feature-desc">Все сделки в одном месте</div>
            </div>
          </div>
          <div class="brand-feature">
            <div class="feature-icon">
              <v-icon icon="mdi-bell-ring-outline" size="18" color="white" />
            </div>
            <div>
              <div class="feature-title">Уведомления</div>
              <div class="feature-desc">Платежи и заявки</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Right panel — form -->
    <div class="login-form-panel">
      <div class="login-form-wrapper">
        <!-- Mobile logo -->
        <div class="d-md-none text-center mb-8">
          <div class="d-flex align-center justify-center ga-2 mb-2">
            <v-img :src="logo" width="36" height="36" />
            <img :src="logoText" alt="MizanPay" style="height: 22px; width: auto;" />
          </div>
          <p class="text-body-2" style="color: #5f7a6b">Панель инвестора</p>
        </div>

        <div class="mb-8">
          <h2 class="login-title mb-2">Вход в аккаунт</h2>
          <p class="login-subtitle">Введите данные для входа в панель управления</p>
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

        <form @submit.prevent="handleLogin">
          <div class="mb-5">
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

          <div class="mb-6">
            <label class="field-label">Пароль</label>
            <v-text-field
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              variant="outlined"
              density="comfortable"
              placeholder="Введите пароль"
              prepend-inner-icon="mdi-lock-outline"
              :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
              hide-details="auto"
              rounded="lg"
              @click:append-inner="showPassword = !showPassword"
            />
          </div>

          <div class="d-flex justify-end mb-4">
            <router-link to="/forgot-password" class="forgot-link">Забыли пароль?</router-link>
          </div>

          <v-btn
            type="submit"
            color="primary"
            size="x-large"
            block
            rounded="lg"
            :loading="isLoading"
            class="login-btn mb-4"
          >
            Войти
          </v-btn>
        </form>

        <p class="text-center text-caption mt-10" style="color: #94a3b8">
          &copy; {{ new Date().getFullYear() }} MizanPay. Все права защищены.
        </p>
      </div>
    </div>
  </v-main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
}

/* ===== Left brand panel ===== */
.login-brand {
  width: 42%;
  min-height: 100vh;
  position: relative;
  background: #064e3b;
  overflow: hidden;
  flex-shrink: 0;
}

.brand-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(16, 185, 129, 0.15) 0%, transparent 60%),
    radial-gradient(ellipse at 80% 80%, rgba(52, 211, 153, 0.1) 0%, transparent 50%);
}

.brand-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 32px 40px;
  position: relative;
  z-index: 1;
}

.brand-logo {
  font-size: 1.15rem;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.01em;
}

.brand-logo-accent {
  color: #34d399;
}

.brand-badge {
  font-size: 0.65rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 100px;
}

/* Text area */
.brand-text-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.brand-title {
  font-size: 3rem;
  font-weight: 800;
  color: #ffffff;
  line-height: 1.1;
  letter-spacing: -0.03em;
}

.brand-subtitle {
  font-size: 1.05rem;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.6;
  max-width: 380px;
}

/* Features */
.brand-features {
  display: flex;
  gap: 16px;
}

.brand-feature {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  flex: 1;
}

.feature-icon {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.feature-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: #ffffff;
}

.feature-desc {
  font-size: 0.65rem;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 1px;
}

/* ===== Right form panel ===== */
.login-form-panel {
  flex: 1;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: #fafdfb;
}

.login-form-wrapper {
  width: 100%;
  max-width: 400px;
}

.login-title {
  font-size: 1.75rem;
  font-weight: 800;
  color: #0c1a12;
  letter-spacing: -0.02em;
}

.login-subtitle {
  font-size: 0.9rem;
  color: #5f7a6b;
}

.field-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: #1a2e23;
  margin-bottom: 6px;
}

.login-btn {
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  font-size: 0.95rem;
}

.forgot-link {
  font-size: 0.8rem;
  color: #047857;
  text-decoration: none;
  font-weight: 500;
}

.forgot-link:hover {
  text-decoration: underline;
}
</style>
