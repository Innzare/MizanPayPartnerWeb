<route lang="json">
{
  "meta": {
    "layout": "auth"
  }
}
</route>

<script lang="ts" setup>
import { onMounted, ref, watch } from "vue";
import { useAuthStore } from "@/stores/auth";
import logo from "@/assets/images/logo.svg";
import logoText from "@/assets/images/logo-text.svg";
import logoTextDark from "@/assets/images/logo-text-dark.svg";
import { useIsDark } from "@/composables/useIsDark";
import { isAuthFormError, toUserMessage } from "@/api/errors";
import { useToast } from "@/composables/useToast";

const toast = useToast();

const { isDark } = useIsDark()

const authStore = useAuthStore();
const router = useRouter();

const email = ref("");
const password = ref("");
const showPassword = ref(false);
const isLoading = ref(false);
const emailField = ref<{ focus: () => void } | null>(null);
const passwordField = ref<{ focus: () => void } | null>(null);
/** Какое поле обвести красным. Текст ошибки — уведомлением: блок над формой сдвигал её. */
const invalid = ref<"email" | "password" | "both" | null>(null);
watch([email, password], () => { invalid.value = null; });

/** Enter в поле email — к паролю (на телефоне кнопка «Далее»), а не отправка пустой формы. */
const toPassword = () => {
  if (password.value) handleLogin();
  else passwordField.value?.focus();
};

/**
 * Причина, по которой человека выкинуло из кабинета.
 *
 * Её оставляет api-клиент — например, когда у компании кончилась подписка и
 * доступ сотрудников приостановлен. Без этого экран входа молчит, и человек
 * думает, что «просто разлогинило».
 */
onMounted(() => {
  const notice = localStorage.getItem("auth_notice");
  if (notice) {
    toast.show(notice, "warning", 10000);
    localStorage.removeItem("auth_notice");
  }
});

const handleLogin = async () => {
  if (!email.value.trim()) {
    invalid.value = "email";
    toast.error(password.value ? "Введите email" : "Введите email и пароль");
    emailField.value?.focus();
    return;
  }
  if (!password.value) {
    invalid.value = "password";
    toast.error("Введите пароль");
    passwordField.value?.focus();
    return;
  }

  isLoading.value = true;

  try {
    await authStore.login(email.value, password.value);
    const redirect = (router.currentRoute.value.query.redirect as string) || authStore.defaultRoute;
    router.push(redirect);
  } catch (e) {
    // Неверный пароль — в форме; сеть и сервер — тостом.
    if (isAuthFormError(e)) {
      invalid.value = "both";
      toast.error(toUserMessage(e, "Не удалось войти"));
    } else toast.error(e, "Не удалось войти — попробуйте ещё раз");
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <v-main class="auth-page">
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
    <div class="auth-panel">
      <div class="auth-card">
        <!-- Логотип на телефоне: левой панели там нет -->
        <div class="auth-brand d-md-none">
          <img :src="logo" alt="" class="auth-brand-logo" />
          <img :src="isDark ? logoTextDark : logoText" alt="MizanPay" class="auth-brand-text" />
          <span class="auth-brand-badge">Панель партнёра</span>
        </div>

        <h1 class="auth-title">Вход в аккаунт</h1>
        <p class="auth-subtitle">Введите данные для входа в панель управления</p>


        <form @submit.prevent="handleLogin">
          <div class="auth-field">
            <label class="auth-label" for="login-email">Email</label>
            <v-text-field
              id="login-email"
              ref="emailField"
              v-model="email"
              :error="invalid === 'email' || invalid === 'both'"
              type="email"
              variant="outlined"
              density="comfortable"
              placeholder="name@example.com"
              prepend-inner-icon="mdi-email-outline"
              hide-details="auto"
              rounded="lg"
              autocomplete="username"
              inputmode="email"
              autocapitalize="none"
              :spellcheck="false"
              enterkeyhint="next"
              @keydown.enter.prevent="toPassword"
            />
          </div>

          <div class="auth-field mb-1">
            <label class="auth-label" for="login-password">Пароль</label>
            <v-text-field
              id="login-password"
              ref="passwordField"
              v-model="password"
              :error="invalid === 'password' || invalid === 'both'"
              :type="showPassword ? 'text' : 'password'"
              variant="outlined"
              density="comfortable"
              placeholder="Введите пароль"
              prepend-inner-icon="mdi-lock-outline"
              hide-details="auto"
              rounded="lg"
              autocomplete="current-password"
              autocapitalize="none"
              :spellcheck="false"
              enterkeyhint="go"
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

          <div class="d-flex justify-end mb-3">
            <router-link to="/forgot-password" class="auth-link">Забыли пароль?</router-link>
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
            Войти
          </v-btn>
        </form>
      </div>

      <p class="auth-footer-note">
        &copy; {{ new Date().getFullYear() }} MizanPay. Все права защищены.
      </p>
    </div>
  </v-main>
</template>

<style scoped>
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

/* Всё выше — на переменных темы, отдельных правил под тёмные темы не нужно.
   Через `.dark` делать нельзя: класс ставится скриптом, и в момент, когда тема
   уже тёмная, а класс ещё/уже не проставлен (например, сразу после выхода из
   кабинета), страница осталась бы светлой со светлым текстом.
   Левая брендовая панель тёмно-зелёная в любой теме — её не трогаем. */
</style>
