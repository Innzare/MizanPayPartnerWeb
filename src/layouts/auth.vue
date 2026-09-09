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
