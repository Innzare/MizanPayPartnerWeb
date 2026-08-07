<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'

interface Item { title: string; value: string }
const props = defineProps<{
  modelValue: string | null
  items: Item[]
  placeholder?: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string | null): void
  (e: 'create-new'): void
}>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

const selectedTitle = computed(() => props.items.find((i) => i.value === props.modelValue)?.title ?? '')

function toggle() { open.value = !open.value }
function pick(v: string | null) { emit('update:modelValue', v); open.value = false }
function createNew() { open.value = false; emit('create-new') }

function onDocPointer(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
watch(open, (o) => {
  if (o) document.addEventListener('mousedown', onDocPointer)
  else document.removeEventListener('mousedown', onDocPointer)
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocPointer))
</script>

<template>
  <div ref="root" class="ss">
    <button type="button" class="ss-control" :class="{ 'ss-control--open': open }" @click="toggle">
      <span class="ss-value" :class="{ 'ss-value--ph': !selectedTitle }">
        {{ selectedTitle || placeholder || 'Выберите' }}
      </span>
      <v-icon icon="mdi-chevron-down" size="18" class="ss-chev" :class="{ 'ss-chev--rot': open }" />
    </button>

    <div v-if="open" class="ss-menu">
      <div class="ss-item ss-item--muted" :class="{ 'ss-item--sel': modelValue === null }" @click="pick(null)">
        Без партнёра
      </div>
      <div
        v-for="it in items" :key="it.value"
        class="ss-item" :class="{ 'ss-item--sel': it.value === modelValue }"
        @click="pick(it.value)"
      >
        {{ it.title }}
      </div>
      <div class="ss-add" @click="createNew">
        <v-icon icon="mdi-plus" size="16" /> Новый партнёр
      </div>
    </div>
  </div>
</template>

<style scoped>
.ss { position: relative; }
.ss-control {
  width: 100%; height: 44px; padding: 0 14px;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit; text-align: left;
  background: rgba(var(--v-theme-on-surface), 0.03);
  cursor: pointer; transition: all 0.15s;
}
.ss-control:hover { border-color: rgba(var(--v-theme-on-surface), 0.2); }
.ss-control--open { border-color: #047857; box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent); }
.ss-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ss-value--ph { color: rgba(var(--v-theme-on-surface), 0.3); }
.ss-chev { color: rgba(var(--v-theme-on-surface), 0.4); transition: transform 0.15s; flex-shrink: 0; }
.ss-chev--rot { transform: rotate(180deg); }

.ss-menu {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px; padding: 6px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  max-height: 280px; overflow-y: auto;
}
.ss-item {
  padding: 10px 12px; border-radius: 8px; font-size: 14px; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ss-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.ss-item--muted { color: rgba(var(--v-theme-on-surface), 0.55); }
.ss-item--sel { background: rgba(4, 120, 87, 0.08); color: #047857; font-weight: 600; }
.ss-add {
  display: flex; align-items: center; gap: 6px;
  margin-top: 4px; padding: 10px 12px; border-radius: 8px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  font-size: 13.5px; font-weight: 600; color: #047857; cursor: pointer;
}
.ss-add:hover { background: rgba(4, 120, 87, 0.06); }
</style>
