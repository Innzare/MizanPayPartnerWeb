<script setup lang="ts">
/**
 * Формат текста для рабочей группы — настройка кабинета.
 *
 * Раньше формат правился в окне «Текст для рабочей группы» у каждой сделки.
 * Окно убрано: в списке сделок остались кнопки «Скопировать» и «Отправлено»,
 * а копируется текст по формату, сохранённому здесь. Предпросмотр — на
 * последней сделке кабинета, чтобы видеть настоящий результат.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { setGroupShareTemplateCache } from '@/composables/useGroupShare'
import { DEFAULT_GROUP_TEMPLATE, GROUP_SHARE_VARIABLES, renderGroupShare } from '@/utils/dealSummaryText'
import type { Deal } from '@/types'

const toast = useToast()
const auth = useAuthStore()

const loading = ref(true)
const saving = ref(false)
const saved = ref<string | null>(null)
const template = ref(DEFAULT_GROUP_TEMPLATE)
const sample = ref<Deal | null>(null)
const editor = ref<HTMLTextAreaElement | null>(null)

const canSave = computed(() => auth.can('deals.edit'))
const effectiveSaved = computed(() => saved.value ?? DEFAULT_GROUP_TEMPLATE)
const dirty = computed(() => template.value.trim() !== effectiveSaved.value.trim())
const isDefault = computed(() => template.value.trim() === DEFAULT_GROUP_TEMPLATE)
const preview = computed(() => (sample.value ? renderGroupShare(template.value, sample.value) : ''))

onMounted(async () => {
  try {
    const res = await api.get<{ template: string | null }>('/deals/group-share/template')
    saved.value = res.template
    template.value = effectiveSaved.value
    // Предпросмотр на последней сделке; нет сделок — просто без предпросмотра.
    const list = await api.getSilent<{ items?: Deal[] }>('/deals?limit=1&sort=createdAt&dir=desc')
    const last = list?.items?.[0]
    if (last) sample.value = await api.get<Deal>(`/deals/${last.id}`)
  } catch (e: any) {
    toast.error(e, 'Не удалось загрузить формат')
  } finally {
    loading.value = false
  }
})

/** Вставить переменную туда, где стоит курсор (или в конец). */
async function insertVar(key: string) {
  const el = editor.value
  const value = template.value
  const start = el ? el.selectionStart : value.length
  const end = el ? el.selectionEnd : value.length
  const before = value.slice(0, start)
  const pad = before && !/[\s({«]$/.test(before) ? ' ' : ''
  template.value = before + pad + key + value.slice(end)
  await nextTick()
  const pos = (before + pad + key).length
  el?.focus()
  el?.setSelectionRange(pos, pos)
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const next = isDefault.value ? null : template.value
    const res = await api.put<{ template: string | null }>('/deals/group-share/template', { template: next })
    saved.value = res.template
    template.value = effectiveSaved.value
    setGroupShareTemplateCache(res.template)
    toast.success(res.template ? 'Формат сохранён — для всех сделок' : 'Вернули стандартный формат')
  } catch (e: any) {
    toast.error(e, 'Не удалось сохранить формат')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-card rounded="lg" elevation="0" border class="pa-6 gf-card">
    <div class="gf-head">
      <div class="gf-icon"><v-icon icon="mdi-send-outline" size="22" /></div>
      <div>
        <div class="gf-title">Текст для рабочей группы</div>
        <div class="gf-sub">Его копирует кнопка в колонке «В группе» списка сделок</div>
      </div>
    </div>

    <div v-if="loading" class="gf-loading">
      <v-progress-circular indeterminate size="20" width="2" color="primary" />
    </div>
    <template v-else>
      <div class="gf-field-head">
        <label class="gf-label" for="gf-format">Формат</label>
        <button v-if="!isDefault" type="button" class="gf-link" @click="template = DEFAULT_GROUP_TEMPLATE">
          <v-icon icon="mdi-restore" size="14" />Стандартный
        </button>
      </div>
      <textarea v-clear
        id="gf-format"
        ref="editor"
        v-model="template"
        class="gf-format"
        rows="7"
        spellcheck="false"
        :readonly="!canSave"
      />
      <div v-if="canSave" class="gf-vars-title">Нажмите, чтобы вставить в формат:</div>
      <div v-if="canSave" class="gf-vars">
        <button
          v-for="v in GROUP_SHARE_VARIABLES"
          :key="v.key"
          type="button"
          class="gf-var"
          :title="`${v.key}${v.hint ? ' — ' + v.hint : ''}`"
          @click="insertVar(v.key)"
        >
          <v-icon icon="mdi-plus" size="13" />{{ v.label }}
        </button>
      </div>

      <template v-if="sample">
        <div class="gf-field-head gf-mt">
          <span class="gf-label">Как будет в группе</span>
          <span class="gf-hint">на примере сделки № {{ sample.dealNumber }}</span>
        </div>
        <div class="gf-preview" :class="{ 'gf-preview--empty': !preview }">
          {{ preview || 'Текст пустой — добавьте переменные в формат' }}
        </div>
      </template>

      <div v-if="canSave" class="gf-actions">
        <button class="gf-save" :disabled="!dirty || saving" @click="save">
          <v-progress-circular v-if="saving" indeterminate size="14" width="2" class="mr-2" />
          Сохранить формат
        </button>
        <span v-if="dirty" class="gf-dirty">Есть несохранённые изменения</span>
      </div>
    </template>
  </v-card>
</template>

<style scoped>
.gf-card { margin-top: 16px; }
.gf-head { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; }
.gf-icon {
  width: 48px; height: 48px; min-width: 48px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.1); color: #047857;
}
.gf-title { font-size: 17px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.gf-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px; }
.gf-loading { display: flex; justify-content: center; padding: 24px 0; }
.gf-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.gf-mt { margin-top: 18px; }
.gf-label { font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.75); }
.gf-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); }
.gf-link {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12.5px; font-weight: 600; color: #047857; background: none; border: none; cursor: pointer;
}
.gf-format {
  width: 100%; padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.5;
  resize: vertical; outline: none;
}
.gf-format:focus { border-color: #047857; }
.gf-vars-title { margin-top: 10px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.gf-vars { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.gf-var {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 5px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: transparent;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.75);
}
.gf-var:hover { border-color: rgba(4, 120, 87, 0.45); color: #047857; }
.gf-preview {
  white-space: pre-wrap; padding: 12px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13.5px; line-height: 1.5; color: rgba(var(--v-theme-on-surface), 0.85);
}
.gf-preview--empty { color: rgba(var(--v-theme-on-surface), 0.45); }
.gf-actions { display: flex; align-items: center; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
.gf-save {
  display: inline-flex; align-items: center; height: 40px; padding: 0 20px;
  border-radius: 10px; border: none; background: #047857; color: #fff;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.gf-save:disabled { opacity: 0.45; cursor: default; }
.gf-dirty { font-size: 12.5px; color: #b45309; }

@media (max-width: 767px) {
  .gf-card { padding: 14px 16px !important; }
  .gf-format { font-size: 16px; }
  .gf-var { padding: 7px 11px; font-size: 13px; }
  .gf-save { width: 100%; justify-content: center; height: 44px; }
}
</style>
