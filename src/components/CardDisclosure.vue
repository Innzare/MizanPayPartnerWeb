<script setup lang="ts">
/**
 * Сворачиваемый блок карточки тарифа — та же механика, что у графика в окне
 * приёма платежа: заметная кнопка-заголовок и содержимое под ней.
 *
 * Раньше это были разнородные вещи: график всегда развёрнут, а условия — под
 * бледной ссылкой, которую никто не замечал. Теперь оба блока выглядят
 * одинаково, и понятно, что каждый можно открыть.
 *
 * Живёт на зелёной карточке, поэтому оформление светлое по прозрачному.
 */
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    icon?: string
    /** Короткий итог рядом с заголовком — виден и в свёрнутом виде. */
    note?: string
    defaultOpen?: boolean
  }>(),
  { icon: 'mdi-format-list-bulleted', note: '', defaultOpen: false },
)

const open = ref(props.defaultOpen)
</script>

<template>
  <div class="cd" :class="{ 'cd--open': open }">
    <button class="cd-toggle" @click="open = !open">
      <v-icon :icon="props.icon" size="17" />
      <span class="cd-title">{{ props.title }}</span>
      <span v-if="props.note" class="cd-note">{{ props.note }}</span>
      <span class="cd-action">
        {{ open ? 'Скрыть' : 'Показать' }}
        <v-icon :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
      </span>
    </button>

    <div v-if="open" class="cd-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.cd {
  margin-top: 10px; padding: 10px 12px; border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  transition: border-color 0.15s, background 0.15s;
}
.cd:hover { border-color: rgba(255, 255, 255, 0.3); }
/* Раскрытый блок отделён фоном: видно, где кончается его содержимое. */
.cd--open { background: rgba(0, 0, 0, 0.14); border-color: rgba(255, 255, 255, 0.22); }

.cd-toggle {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 2px 0; border: none; background: none; cursor: pointer; color: #fff;
}
.cd-title { font-size: 13px; font-weight: 600; }
.cd-note { font-size: 11.5px; color: rgba(255, 255, 255, 0.55); white-space: nowrap; }
/* Явное действие вместо бледной подписи — иначе блок не читается как кнопка. */
.cd-action {
  margin-left: auto; display: inline-flex; align-items: center; gap: 3px;
  padding: 5px 10px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  font-size: 12.5px; font-weight: 600; white-space: nowrap;
  transition: background 0.15s;
}
.cd-toggle:hover .cd-action { background: rgba(255, 255, 255, 0.26); }

.cd-body { margin-top: 10px; }
</style>
