<script setup lang="ts">
// Полоса тестового контура нужна и на входе: логиниться в тестовую копию,
// думая, что это боевая, — тот же самый способ перепутать окружения.
import EnvBanner from '@/components/EnvBanner.vue'
</script>

<template>
  <v-app>
    <EnvBanner />
    <router-view />
  </v-app>
</template>

<style>
/*
 * Общий каркас страниц входа (вход, «Забыли пароль», новый пароль).
 *
 * На компьютере форма по центру экрана. На телефоне — от верха: по центру
 * она прыгает при открытии клавиатуры, а сверху остаётся пустая половина
 * экрана. Высота — 100dvh: 100vh в мобильном Safari больше видимой области
 * (под адресной строкой), и подвал уезжал за край. Отступы под вырез и
 * полоску «домой» — env(safe-area-inset-*), без viewport-fit=cover там 0.
 *
 * Цвета — только на переменных темы: класс `.dark` ставится скриптом и может
 * отсутствовать в момент показа (сразу после выхода из кабинета).
 */
.auth-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  background: rgb(var(--v-theme-surface));
}

.auth-panel {
  flex: 1;
  min-width: 0;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.auth-card {
  width: 100%;
  max-width: 400px;
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 32px;
}
.auth-brand-logo { width: 40px; height: 40px; flex-shrink: 0; }
.auth-brand-text { height: 24px; width: auto; }
.auth-brand-badge {
  margin-left: auto;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 4px 10px;
  border-radius: 100px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  white-space: nowrap;
}

.auth-title {
  font-size: 1.75rem;
  font-weight: 800;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.95);
  letter-spacing: -0.02em;
  margin-bottom: 8px;
}
.auth-subtitle {
  font-size: 0.95rem;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 28px;
}

.auth-field { margin-bottom: 20px; }
.auth-label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
  margin-bottom: 6px;
}

/* «Показать пароль»: иконка в поле — 24px, пальцем мимо; кнопка 40×40. */
.auth-eye {
  width: 40px;
  height: 40px;
  margin-right: -8px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer;
}
.auth-eye:hover { background: rgba(var(--v-theme-on-surface), 0.05); }

.auth-btn.v-btn {
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  font-size: 1rem;
}

/* Ссылки — с полем нажатия не меньше 44px по высоте. */
.auth-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  padding: 0 4px;
  font-size: 0.9rem;
  font-weight: 500;
  color: rgb(var(--v-theme-accent));
  text-decoration: none;
}
.auth-link:hover { text-decoration: underline; }
.auth-link--muted { color: rgba(var(--v-theme-on-surface), 0.6); }

.auth-footer-note {
  margin-top: 40px;
  text-align: center;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

@media (max-width: 959.98px) {
  .auth-panel {
    justify-content: flex-start;
    padding:
      calc(clamp(24px, 7vh, 64px) + env(safe-area-inset-top))
      calc(20px + env(safe-area-inset-right))
      calc(16px + env(safe-area-inset-bottom))
      calc(20px + env(safe-area-inset-left));
  }
  /* Подвал прижат к низу экрана, а не висит сразу под кнопкой. */
  .auth-footer-note { margin-top: auto; padding-top: 32px; }
}

@media (max-width: 359.98px) {
  .auth-panel { padding-left: 16px; padding-right: 16px; }
  .auth-brand { margin-bottom: 24px; }
  .auth-title { font-size: 1.5rem; }
  .auth-subtitle { margin-bottom: 22px; }
}
</style>
