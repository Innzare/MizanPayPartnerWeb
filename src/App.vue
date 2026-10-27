<template>
  <router-view />
  <!-- Уведомления — на всех страницах, включая вход и сброс пароля. -->
  <GlobalToast />
  <!-- Подтверждение удаления — одно окно на весь кабинет. -->
  <ConfirmDeleteHost />
</template>

<script lang="ts" setup>
  import { useThemeMode } from '@/composables/useThemeMode'
  import GlobalToast from '@/components/GlobalToast.vue'
  import ConfirmDeleteHost from '@/components/ConfirmDeleteHost.vue'

  /**
   * Тему применяем в корне, а не в лэйауте кабинета: раньше сохранённый выбор
   * подхватывался только внутри кабинета, поэтому страница входа при прямом
   * заходе оставалась светлой, а после выхода из тёмного кабинета — наоборот,
   * тёмной. Здесь выбор действует на все страницы сразу.
   */
  useThemeMode().initTheme()
</script>
