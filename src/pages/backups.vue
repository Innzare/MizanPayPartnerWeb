<script setup lang="ts">
/**
 * Резервные копии — отдельный раздел, а не пункт настроек.
 *
 * Сюда заходят за файлом: перед проверкой, перед переустановкой, после сбоя.
 * Поэтому список копий открыт сразу, а расписание вынесено на вторую вкладку —
 * его настраивают один раз, а копии скачивают постоянно.
 */
import { ref } from 'vue'
import { useIsDark } from '@/composables/useIsDark'
import BackupsPanel from '@/components/BackupsPanel.vue'

const { isDark } = useIsDark()
const tab = ref<'files' | 'settings'>('files')
/** Сколько готовых копий — счётчик на вкладке, приходит из панели. */
const filesCount = ref(0)
</script>

<template>
  <div class="at-page bkp-page" :class="{ dark: isDark }">
    <div class="page-tabs">
      <button class="page-tab" :class="{ active: tab === 'files' }" @click="tab = 'files'">
        <v-icon icon="mdi-folder-download-outline" size="18" />
        <span>Копии</span>
        <span v-if="filesCount" class="page-tab-count">{{ filesCount }}</span>
      </button>
      <button class="page-tab" :class="{ active: tab === 'settings' }" @click="tab = 'settings'">
        <v-icon icon="mdi-calendar-clock-outline" size="18" />
        <span>Настройки</span>
      </button>
    </div>

    <v-card rounded="lg" elevation="0" border class="pa-4">
      <!-- Панель одна на обе вкладки: расписание и список загружаются вместе,
           и переключение не должно перезапрашивать их заново. -->
      <BackupsPanel :view="tab" @files-count="filesCount = $event" />
    </v-card>
  </div>
</template>

<style scoped>
.bkp-page { padding-bottom: 40px; }
</style>
