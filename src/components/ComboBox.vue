<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  modelValue: string
  items: string[]
  placeholder?: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

// Подсказки: фильтруем по введённому тексту; пустой ввод — весь список.
const filtered = computed(() => {
  const q = props.modelValue.trim().toLowerCase()
  if (!q) return props.items
  return props.items.filter((i) => i.toLowerCase().includes(q))
})

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
  open.value = true
}
function pick(item: string) {
  emit('update:modelValue', item)
  open.value = false
}

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
  <div ref="root" class="cb">
    <input
      class="field-input cb-input"
      :value="modelValue"
      :placeholder="placeholder"
      @input="onInput"
      @focus="open = true"
    />
    <button type="button" class="cb-chevron" tabindex="-1" @click="open = !open">
      <v-icon icon="mdi-chevron-down" size="18" :class="{ 'cb-chevron--rot': open }" />
    </button>

    <div v-if="open && filtered.length" class="cb-menu">
      <div
        v-for="it in filtered" :key="it"
        class="cb-item" :class="{ 'cb-item--active': it === modelValue }"
        @mousedown.prevent="pick(it)"
      >
        {{ it }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.cb { position: relative; }
.cb-input { padding-right: 38px; }
.cb-chevron { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 26px; height: 26px; border: none; background: none; cursor: pointer; color: rgba(var(--v-theme-on-surface), 0.4); display: inline-flex; align-items: center; justify-content: center; }
.cb-chevron--rot { transform: rotate(180deg); transition: transform 0.15s; }

.cb-menu {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px; padding: 6px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  max-height: 240px; overflow-y: auto;
}
.cb-item { padding: 9px 12px; border-radius: 8px; font-size: 14px; cursor: pointer; }
.cb-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.cb-item--active { background: rgba(4, 120, 87, 0.08); color: #047857; font-weight: 600; }
</style>
