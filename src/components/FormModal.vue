<script setup lang="ts">
import { computed } from 'vue'
import { useIsMobile } from '@/composables/useIsMobile'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  subtitle?: string
  icon?: string
  maxWidth?: number | string
  persistent?: boolean
}>(), {
  icon: '',
  maxWidth: 560,
  persistent: false,
})
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const { isMobile } = useIsMobile()
const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})
</script>

<template>
  <v-dialog v-model="show" :max-width="maxWidth" scrollable :persistent="persistent" :fullscreen="isMobile">
    <v-card rounded="lg" class="mz-modal mz-form">
      <!-- Header -->
      <div class="mz-modal-header">
        <div class="mz-modal-header-main">
          <div v-if="icon" class="mz-modal-icon"><v-icon :icon="icon" size="20" color="primary" /></div>
          <div style="min-width: 0;">
            <div class="mz-modal-title">{{ title }}</div>
            <div v-if="subtitle" class="mz-modal-subtitle">{{ subtitle }}</div>
          </div>
        </div>
        <button class="mz-modal-close" type="button" @click="show = false"><v-icon icon="mdi-close" size="20" /></button>
      </div>
      <v-divider />

      <!-- Content -->
      <div class="mz-modal-body">
        <slot />
      </div>
      <v-divider />

      <!-- Footer -->
      <div class="mz-modal-footer">
        <slot name="footer" />
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.mz-modal { display: flex; flex-direction: column; max-height: 90vh; }
.mz-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 20px; }
.mz-modal-header-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.mz-modal-icon { width: 40px; height: 40px; min-width: 40px; border-radius: 11px; background: rgba(4,120,87,0.1); display: flex; align-items: center; justify-content: center; }
.mz-modal-title { font-size: 17px; font-weight: 700; line-height: 1.2; }
.mz-modal-subtitle { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 2px; }
.mz-modal-close { width: 34px; height: 34px; border-radius: 9px; border: none; background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.mz-modal-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.mz-modal-body { padding: 20px; overflow-y: auto; flex: 1 1 auto; }
.mz-modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 14px 20px; flex-shrink: 0; }
</style>
