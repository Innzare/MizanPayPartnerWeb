<script setup lang="ts">
/**
 * Иконка «i» с пояснением по наведению (и по нажатию — на телефоне).
 * Для длинных пояснений, которые не должны занимать место в интерфейсе.
 */
withDefaults(defineProps<{ text?: string; size?: number; maxWidth?: number; location?: 'top' | 'bottom' | 'left' | 'right' }>(), {
  size: 16,
  maxWidth: 300,
  location: 'top',
})
</script>

<template>
  <v-tooltip :location="location" :max-width="maxWidth" open-on-click>
    <template #activator="{ props: tp }">
      <button v-bind="tp" type="button" class="info-tip" aria-label="Пояснение" @click.stop.prevent>
        <v-icon icon="mdi-information-outline" :size="size" />
      </button>
    </template>
    <div class="info-tip-body"><slot>{{ text }}</slot></div>
  </v-tooltip>
</template>

<style scoped>
.info-tip {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  color: rgba(var(--v-theme-on-surface), 0.42); cursor: help; border-radius: 50%;
  transition: color 0.15s;
}
.info-tip:hover { color: rgb(var(--v-theme-primary)); }
.info-tip-body { font-size: 12.5px; line-height: 1.5; }
</style>
