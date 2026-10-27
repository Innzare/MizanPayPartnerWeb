<script setup lang="ts">
/**
 * Окно подтверждения удаления — одно на весь кабинет (см. useConfirmDelete).
 */
import { useConfirmDelete } from '@/composables/useConfirmDelete'

const { state, answer } = useConfirmDelete()
</script>

<template>
  <v-dialog :model-value="state.open" max-width="420" @update:model-value="(v: boolean) => !v && answer(false)">
    <v-card rounded="lg" class="cdh-card">
      <div class="cdh-icon"><v-icon icon="mdi-trash-can-outline" size="22" /></div>
      <div class="cdh-title">{{ state.title }}</div>
      <div v-if="state.warning" class="cdh-text cdh-text--warn">{{ state.warning }}</div>
      <div v-if="state.text" class="cdh-text">{{ state.text }}</div>
      <div class="cdh-actions">
        <button class="cdh-btn" @click="answer(false)">Отмена</button>
        <button class="cdh-btn cdh-btn--danger" @click="answer(true)">{{ state.action || 'Удалить' }}</button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.cdh-card { padding: 22px 24px 18px; }
.cdh-icon {
  width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
  background: rgba(220, 38, 38, 0.1); color: #dc2626; margin-bottom: 12px;
}
.cdh-title { font-size: 17px; font-weight: 700; }
.cdh-text { font-size: 13px; line-height: 1.5; margin-top: 8px; color: rgba(var(--v-theme-on-surface), 0.6); white-space: pre-line; }
.cdh-text--warn { color: #b45309; font-weight: 600; }
.cdh-actions { display: flex; gap: 10px; margin-top: 18px; }
.cdh-btn {
  flex: 1; padding: 11px 16px; border-radius: 10px; border: none; cursor: pointer;
  font-size: 14px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.7);
}
.cdh-btn--danger { background: #dc2626; color: #fff; }
.cdh-btn--danger:hover { background: #b91c1c; }
</style>
