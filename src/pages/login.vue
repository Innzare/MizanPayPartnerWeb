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
    const redirect = (router.currentRoute.value.query.redirect as string) || "/";
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
    <v-container class="fill-height" fluid>
      <v-row align="center" justify="center">
        <v-col cols="12" sm="8" md="5" lg="4" xl="3">
          <v-card flat rounded="xl" class="pa-8">
            <div class="text-center mb-6">
              <v-img :src="logo" width="48" height="48" class="mx-auto mb-3" />
              <h1 class="text-h5 font-weight-bold">MizanPay Partner</h1>
              <p class="text-body-2 text-medium-emphasis mt-1">
                Войдите в панель управления
              </p>
            </div>

            <v-alert
              v-if="error"
              type="error"
              variant="tonal"
              density="compact"
              class="mb-4"
              closable
              @click:close="error = ''"
            >
              {{ error }}
            </v-alert>

            <form @submit.prevent="handleLogin">
              <v-text-field
                v-model="email"
                label="Email"
                type="email"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-email-outline"
                class="mb-2"
                hide-details="auto"
              />

              <v-text-field
                v-model="password"
                label="Пароль"
                :type="showPassword ? 'text' : 'password'"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-lock-outline"
                :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                class="mb-4"
                hide-details="auto"
                @click:append-inner="showPassword = !showPassword"
              />

              <v-btn
                type="submit"
                color="primary"
                size="large"
                block
                rounded="lg"
                :loading="isLoading"
              >
                Войти
              </v-btn>
            </form>
          </v-card>

          <p class="text-center text-caption text-medium-emphasis mt-6">
            &copy; {{ new Date().getFullYear() }} MizanPay. Все права защищены.
          </p>
        </v-col>
      </v-row>
    </v-container>
  </v-main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
}

.fill-height {
  min-height: 100vh;
}
</style>