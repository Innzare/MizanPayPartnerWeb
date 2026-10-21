<script setup lang="ts">
/**
 * Текст сделки для рабочей группы партнёра — одно окно на всё.
 *
 * Партнёр пересылает короткую карточку сделки в свою группу в мессенджере
 * сам: здесь он видит готовый текст, может поменять его формат кнопками-
 * переменными ({клиент}, {товар}…), копирует и отмечает, что сделка
 * отправлена, — чтобы не отправить дважды и видеть, что ещё не отправлено.
 *
 * Формат сохраняется на кабинет (для всех сделок и сотрудников). Правка без
 * сохранения действует только на эту отправку.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import {
  DEFAULT_GROUP_TEMPLATE, GROUP_SHARE_VARIABLES, copyText, renderGroupShare,
} from '@/utils/dealSummaryText'
import { formatDate } from '@/utils/formatters'
import type { Deal } from '@/types'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** Сделка из списка; полные данные (поручители, график) окно грузит само. */
    deal: Deal | null
    fullscreen?: boolean
  }>(),
  { fullscreen: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** Отметку поставили или сняли — странице обновить строку. */
  (e: 'changed', value: { id: string; groupSentAt: string | null }): void
}>()

const toast = useToast()
const auth = useAuthStore()
const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** Формат кабинета (null — стандартный). Один на все открытия окна. */
const savedTemplate = ref<string | null>(null)
let savedLoaded = false

const loading = ref(false)
const loadError = ref(false)
const full = ref<Deal | null>(null)
const template = ref(DEFAULT_GROUP_TEMPLATE)
const sentAt = ref<string | null>(null)
const saving = ref(false)
const savingFormat = ref(false)
const copied = ref(false)
const editor = ref<HTMLTextAreaElement | null>(null)

const canSaveFormat = computed(() => auth.can('deals.edit'))
const effectiveSaved = computed(() => savedTemplate.value ?? DEFAULT_GROUP_TEMPLATE)
const formatDirty = computed(() => template.value.trim() !== effectiveSaved.value.trim())
const isDefault = computed(() => template.value.trim() === DEFAULT_GROUP_TEMPLATE)
/** Готовый текст — по формату из поля, с данными сделки. */
const text = computed(() => (full.value ? renderGroupShare(template.value, full.value) : ''))

async function load() {
  const d = props.deal
  if (!d) return
  loading.value = true
  loadError.value = false
  copied.value = false
  sentAt.value = d.groupSentAt ?? null
  try {
    // В строке списка нет поручителей, дат рождения и графика — берём сделку целиком.
    const [deal, saved] = await Promise.all([
      api.get<Deal>(`/deals/${d.id}`),
      savedLoaded ? Promise.resolve({ template: savedTemplate.value }) : api.get<{ template: string | null }>('/deals/group-share/template'),
    ])
    savedTemplate.value = saved.template
    savedLoaded = true
    full.value = deal
    template.value = effectiveSaved.value
    sentAt.value = deal.groupSentAt ?? sentAt.value
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// Каждое открытие — свежие данные сделки и сохранённый формат.
watch(() => [props.modelValue, props.deal?.id] as const, ([isOpen]) => { if (isOpen) void load() }, { immediate: true })
watch(template, () => { copied.value = false })

/** Вставить переменную туда, где стоит курсор (или в конец строки). */
async function insertVar(key: string) {
  const el = editor.value
  const value = template.value
  const start = el ? el.selectionStart : value.length
  const end = el ? el.selectionEnd : value.length
  const before = value.slice(0, start)
  const after = value.slice(end)
  // Пробел, чтобы переменная не слиплась с соседним словом.
  const pad = before && !/[\s({«]$/.test(before) ? ' ' : ''
  template.value = before + pad + key + after
  await nextTick()
  const pos = (before + pad + key).length
  el?.focus()
  el?.setSelectionRange(pos, pos)
}

async function saveFormat(next: string | null) {
  if (savingFormat.value) return
  savingFormat.value = true
  try {
    const res = await api.put<{ template: string | null }>('/deals/group-share/template', { template: next })
    savedTemplate.value = res.template
    template.value = effectiveSaved.value
    toast.success(res.template ? 'Формат сохранён — для всех сделок' : 'Вернули стандартный формат')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить формат')
  } finally {
    savingFormat.value = false
  }
}

async function copy() {
  if (!text.value.trim()) return
  try {
    await copyText(text.value)
    copied.value = true
    toast.success('Текст скопирован')
  } catch {
    toast.error('Не удалось скопировать — выделите текст и скопируйте вручную')
  }
}

async function setSent(sent: boolean) {
  const d = props.deal
  if (!d || saving.value) return
  saving.value = true
  try {
    const res = await api.patch<{ id: string; groupSentAt: string | null }>(`/deals/${d.id}/group-sent`, { sent })
    sentAt.value = res.groupSentAt
    emit('changed', { id: d.id, groupSentAt: res.groupSentAt })
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить отметку')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="620" :fullscreen="fullscreen">
    <v-card rounded="lg" class="gs-card">
      <button class="dialog-close-sm" aria-label="Закрыть" @click="open = false">
        <v-icon icon="mdi-close" size="18" />
      </button>

      <div class="gs-title">Текст для рабочей группы</div>
      <div class="gs-sub">
        <template v-if="deal">Сделка № {{ deal.dealNumber }}<template v-if="deal.productName"> · {{ deal.productName }}</template></template>
      </div>

      <!-- Статус отправки: главное, что нужно знать до копирования -->
      <div class="gs-status" :class="{ 'gs-status--on': sentAt, 'gs-status--nudge': copied && !sentAt }">
        <v-icon :icon="sentAt ? 'mdi-check-circle' : 'mdi-send-outline'" size="20" class="gs-status-icon" />
        <div class="gs-status-text">
          <div class="gs-status-title">
            {{ sentAt ? `Отправлено в группу ${formatDate(sentAt)}` : 'Ещё не отправлено в группу' }}
          </div>
          <div class="gs-status-hint">
            <template v-if="sentAt">Снимите отметку, если отправили по ошибке.</template>
            <template v-else-if="copied">Отправили текст в группу? Отметьте здесь.</template>
            <template v-else>Скопируйте текст, отправьте в группу и отметьте здесь.</template>
          </div>
        </div>
        <v-switch
          :model-value="!!sentAt"
          :loading="saving"
          :disabled="saving || !deal"
          color="success"
          inset
          density="compact"
          hide-details
          aria-label="Отправлено в группу"
          @update:model-value="(v: any) => setSent(!!v)"
        />
      </div>

      <div v-if="loading" class="gs-loading">
        <v-progress-circular indeterminate size="20" width="2" color="primary" />
      </div>
      <div v-else-if="loadError" class="gs-loading gs-error">
        Не удалось загрузить сделку.
        <button type="button" class="gs-link" @click="load">Повторить</button>
      </div>
      <template v-else>
        <!-- Формат: текст с переменными -->
        <div class="gs-field">
          <div class="gs-field-head">
            <label class="field-label" for="gs-format">Формат</label>
            <button v-if="!isDefault" type="button" class="gs-link" @click="template = DEFAULT_GROUP_TEMPLATE">
              <v-icon icon="mdi-restore" size="14" />Стандартный
            </button>
          </div>
          <textarea
            id="gs-format"
            ref="editor"
            v-model="template"
            class="field-input gs-format"
            rows="6"
            spellcheck="false"
          />
          <div class="gs-vars-title">Нажмите, чтобы вставить в формат:</div>
          <div class="gs-vars">
            <button
              v-for="v in GROUP_SHARE_VARIABLES"
              :key="v.key"
              type="button"
              class="gs-var"
              :title="`${v.key}${v.hint ? ' — ' + v.hint : ''}`"
              @click="insertVar(v.key)"
            >
              <v-icon icon="mdi-plus" size="13" />{{ v.label }}
            </button>
          </div>
          <div v-if="formatDirty" class="gs-save">
            <span class="gs-save-text">Формат изменён — сейчас он действует только для этой отправки.</span>
            <button
              v-if="canSaveFormat"
              type="button"
              class="gs-save-btn"
              :disabled="savingFormat"
              @click="saveFormat(isDefault ? null : template)"
            >
              <v-progress-circular v-if="savingFormat" indeterminate size="13" width="2" class="mr-1" />
              Сохранить для всех сделок
            </button>
          </div>
        </div>

        <!-- Как увидят в группе -->
        <div class="gs-field">
          <div class="gs-field-head">
            <span class="field-label">Как будет в группе</span>
          </div>
          <div class="gs-preview" :class="{ 'gs-preview--empty': !text }">{{ text || 'Текст пустой — добавьте переменные в формат' }}</div>
        </div>
      </template>

      <div class="gs-actions">
        <button class="btn-secondary" @click="open = false">Закрыть</button>
        <button class="btn-primary" :disabled="loading || loadError || !text.trim()" @click="copy">
          <v-icon :icon="copied ? 'mdi-check' : 'mdi-content-copy'" size="18" class="mr-2" />
          {{ copied ? 'Скопировано' : 'Скопировать' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Цвета — на theme-переменных: диалог уезжает в body, и .dark-селектор
   страницы до него не достаёт (см. styles/forms.css). */
.gs-card { padding: 24px; position: relative; }
.gs-title { font-size: 19px; font-weight: 700; padding-right: 40px; }
.gs-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 2px; }

.gs-status {
  display: flex; align-items: center; gap: 12px;
  margin-top: 18px; padding: 12px 14px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  transition: background 0.2s, border-color 0.2s;
}
.gs-status-icon { color: rgba(var(--v-theme-on-surface), 0.45); flex: none; }
.gs-status-text { flex: 1; min-width: 0; }
.gs-status-title { font-size: 14px; font-weight: 600; }
.gs-status-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 1px; }
.gs-status--on { background: rgba(4, 120, 87, 0.08); border-color: rgba(4, 120, 87, 0.25); }
.gs-status--on .gs-status-icon, .gs-status--on .gs-status-title { color: #047857; }
/* Скопировали, но не отметили — мягко подсветить переключатель. */
.gs-status--nudge { background: rgba(217, 119, 6, 0.08); border-color: rgba(217, 119, 6, 0.35); }
.gs-status--nudge .gs-status-icon { color: #b45309; }

.gs-field { margin-top: 18px; }
.gs-field-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.gs-field-head .field-label { margin-bottom: 0; }
.gs-link {
  display: inline-flex; align-items: center; gap: 4px;
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 12px; font-weight: 600; color: rgb(var(--v-theme-primary));
}
.gs-format { font-size: 13.5px; line-height: 1.55; min-height: 130px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.gs-vars-title { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin: 10px 0 6px; }
.gs-vars { display: flex; flex-wrap: wrap; gap: 6px; }
.gs-var {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 4px 10px 4px 7px; border-radius: 999px; border: none; cursor: pointer;
  font-size: 12.5px; font-weight: 500;
  background: rgba(79, 70, 229, 0.08); color: #4f46e5;
  transition: background 0.15s;
}
.gs-var:hover { background: rgba(79, 70, 229, 0.16); }
.gs-save {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  margin-top: 10px; padding: 8px 10px; border-radius: 10px;
  background: rgba(217, 119, 6, 0.08);
}
.gs-save-text { font-size: 12px; color: #b45309; }
.gs-save-btn {
  display: inline-flex; align-items: center;
  padding: 6px 12px; border-radius: 8px; border: none; cursor: pointer;
  font-size: 12.5px; font-weight: 600; background: #047857; color: #fff;
}
.gs-save-btn:disabled { opacity: 0.6; cursor: progress; }
.gs-preview {
  white-space: pre-wrap; font-size: 14px; line-height: 1.55;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(4, 120, 87, 0.05); border: 1px solid rgba(4, 120, 87, 0.18);
  color: rgba(var(--v-theme-on-surface), 0.88);
}
.gs-preview--empty { color: rgba(var(--v-theme-on-surface), 0.45); font-style: italic; }
.gs-loading {
  min-height: 160px; display: flex; align-items: center; justify-content: center; gap: 8px;
  border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.gs-loading { margin-top: 18px; }
.gs-error { color: #dc2626; }

.gs-actions { display: flex; gap: 12px; margin-top: 20px; }
.gs-actions > * { flex: 1; }

.dialog-close-sm {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.dialog-close-sm:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.field-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  outline: none; resize: vertical;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-family: inherit;
  transition: border-color 0.15s;
}
.field-input:focus { border-color: #047857; }
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 12px 20px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #065f46; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
</style>
