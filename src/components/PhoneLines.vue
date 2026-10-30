<script setup lang="ts">
/**
 * Телефоны в ячейке таблицы: номер, рядом переход в переписку WhatsApp, под
 * номером — чей он («жена», имя поручителя). Общая для «Сделок» и
 * «Должников», чтобы колонки с номерами выглядели одинаково.
 */
import { useRouter } from 'vue-router'
import { formatPhone } from '@/utils/formatters'
import { useSections } from '@/composables/useSections'

defineProps<{
  items: Array<{ phone: string; caption?: string | null }>
}>()

const router = useRouter()
const sections = useSections()

function openChat(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits) router.push(`/broadcasts?chat=${digits}`)
}
</script>

<template>
  <div v-if="items.length">
    <div v-for="(it, i) in items" :key="i" class="pl-item">
      <div class="pl-phone">
        {{ formatPhone(it.phone) }}
        <button
          v-if="sections.visible('whatsapp')"
          type="button"
          class="pl-wa"
          title="Написать в WhatsApp"
          @click.stop="openChat(it.phone)"
        >
          <v-icon icon="mdi-whatsapp" size="13" />
        </button>
      </div>
      <div v-if="it.caption" class="pl-caption">{{ it.caption }}</div>
    </div>
  </div>
  <span v-else class="text-medium-emphasis">—</span>
</template>

<style scoped>
.pl-item + .pl-item { margin-top: 6px; }
.pl-phone {
  display: flex; align-items: center; gap: 6px;
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.pl-caption {
  font-size: 11.5px; line-height: 1.25;
  color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;
}
.pl-wa {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
  color: #16a34a; background: rgba(37, 211, 102, 0.1);
  cursor: pointer;
}
.pl-wa:hover { background: rgba(37, 211, 102, 0.2); }
</style>
