<script setup lang="ts">
/**
 * Сообщения клиентам по событиям.
 *
 * Партнёр включает нужные события и правит тексты; система сама отправляет их
 * в момент, когда событие произошло. Пока рассылка не включена, ничего не
 * отправляется — на экране это сказано прямо, чтобы включение было осознанным.
 *
 * Здесь же журнал: что ушло, что ждёт утра, что не отправилось и почему.
 */
import { computed, onMounted, ref } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { formatDate } from '@/utils/formatters'

interface TemplateRow {
  id: string | null
  event: string
  name: string
  hint: string
  body: string
  enabled: boolean
  offsetDays: number | null
  accountId: string | null
  isDefaultBody: boolean
}
interface Placeholder {
  key: string
  label: string
  sample: string
}
interface DispatchRow {
  id: string
  event: string
  phone: string
  body: string
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED' | 'SKIPPED'
  scheduledAt: string
  sentAt: string | null
  error: string | null
  createdAt: string
}

const auth = useAuthStore()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const engineEnabled = ref(false)
const whatsappConnected = ref(false)
const timezone = ref('Europe/Moscow')
const items = ref<TemplateRow[]>([])
const placeholders = ref<Placeholder[]>([])
const dispatches = ref<DispatchRow[]>([])

const canEdit = computed(() => auth.can('broadcasts.templates'))

/** Часовые пояса, в которых реально работают партнёры. */
const TIMEZONES = [
  { value: 'Europe/Kaliningrad', title: 'Калининград (МСК−1)' },
  { value: 'Europe/Moscow', title: 'Москва (МСК)' },
  { value: 'Europe/Samara', title: 'Самара (МСК+1)' },
  { value: 'Asia/Yekaterinburg', title: 'Екатеринбург (МСК+2)' },
  { value: 'Asia/Omsk', title: 'Омск (МСК+3)' },
  { value: 'Asia/Krasnoyarsk', title: 'Красноярск (МСК+4)' },
  { value: 'Asia/Irkutsk', title: 'Иркутск (МСК+5)' },
  { value: 'Asia/Yakutsk', title: 'Якутск (МСК+6)' },
  { value: 'Asia/Vladivostok', title: 'Владивосток (МСК+7)' },
]

const STATUS_LABEL: Record<DispatchRow['status'], string> = {
  PENDING: 'ждёт отправки',
  SENDING: 'отправляется',
  SENT: 'отправлено',
  FAILED: 'не отправлено',
  CANCELLED: 'отменено',
  SKIPPED: 'пропущено',
}

async function load() {
  loading.value = true
  try {
    const [list, ph] = await Promise.all([
      api.get<{ engineEnabled: boolean; whatsappConnected: boolean; timezone: string; items: TemplateRow[] }>(
        '/message-templates',
      ),
      api.get<{ items: Placeholder[] }>('/message-templates/placeholders'),
    ])
    engineEnabled.value = list.engineEnabled
    whatsappConnected.value = list.whatsappConnected
    timezone.value = list.timezone
    items.value = list.items
    placeholders.value = ph.items
    if (engineEnabled.value) await loadDispatches()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить шаблоны')
  } finally {
    loading.value = false
  }
}

async function loadDispatches() {
  try {
    const res = await api.get<{ items: DispatchRow[] }>('/message-templates/dispatches?limit=30')
    dispatches.value = res.items
  } catch {
    // журнал не критичен для настройки — молчим
  }
}

onMounted(load)

async function toggleEngine() {
  saving.value = true
  try {
    const res = await api.post<{ engineEnabled: boolean; items: TemplateRow[] }>(
      engineEnabled.value ? '/message-templates/disable' : '/message-templates/enable',
      {},
    )
    engineEnabled.value = res.engineEnabled
    items.value = res.items
    toast.success(
      engineEnabled.value
        ? 'Сообщения по событиям включены'
        : 'Сообщения по событиям выключены — работают прежние авто-напоминания',
    )
    if (engineEnabled.value) await loadDispatches()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось изменить настройку')
  } finally {
    saving.value = false
  }
}

async function toggleTemplate(row: TemplateRow) {
  if (!row.id) return
  const next = !row.enabled
  try {
    await api.patch(`/message-templates/${row.id}`, { enabled: next })
    row.enabled = next
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить')
  }
}

async function saveTimezone(v: string) {
  try {
    await api.patch('/message-templates/timezone', { timezone: v })
    timezone.value = v
    toast.success('Часовой пояс сохранён')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить часовой пояс')
  }
}

// ── Редактор одного события ──

const editing = ref<TemplateRow | null>(null)
const draft = ref({ body: '', offsetDays: 3 })
const preview = ref<{ text: string; sample: boolean } | null>(null)
const previewLoading = ref(false)
const bodyRef = ref<HTMLTextAreaElement | null>(null)

function openEditor(row: TemplateRow) {
  editing.value = row
  draft.value = { body: row.body, offsetDays: row.offsetDays ?? 3 }
  preview.value = null
}

/** Вставка подстановки туда, где стоит курсор, а не в конец текста. */
function insertPlaceholder(key: string) {
  const el = bodyRef.value
  if (!el) {
    draft.value.body += key
    return
  }
  const start = el.selectionStart ?? draft.value.body.length
  const end = el.selectionEnd ?? start
  draft.value.body = draft.value.body.slice(0, start) + key + draft.value.body.slice(end)
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + key.length, start + key.length)
  })
}

async function showPreview(real: boolean) {
  if (!editing.value?.id) return
  previewLoading.value = true
  try {
    // Текст уходит на сервер в теле запроса, а не сохраняется в шаблон:
    // недописанная посреди правки фраза не должна уйти клиенту, если в этот
    // момент кто-то отметит оплату.
    const res = await api.post<{ text: string; sample: boolean }>(
      `/message-templates/${editing.value.id}/preview`,
      { real, body: draft.value.body },
    )
    preview.value = res
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось показать предпросмотр')
  } finally {
    previewLoading.value = false
  }
}

async function saveTemplate() {
  const row = editing.value
  if (!row?.id) return
  saving.value = true
  try {
    const patch: Record<string, unknown> = { body: draft.value.body }
    if (row.event === 'BEFORE_DUE') patch.offsetDays = draft.value.offsetDays
    await api.patch(`/message-templates/${row.id}`, patch)
    row.body = draft.value.body
    row.offsetDays = row.event === 'BEFORE_DUE' ? draft.value.offsetDays : row.offsetDays
    row.isDefaultBody = false
    editing.value = null
    toast.success('Текст сохранён')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить текст')
  } finally {
    saving.value = false
  }
}

async function resetTemplate() {
  const row = editing.value
  if (!row?.id) return
  try {
    const res = await api.post<{ body: string }>(`/message-templates/${row.id}/reset`, {})
    draft.value.body = res.body
    preview.value = null
    toast.success('Вернули стандартный текст')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось вернуть текст')
  }
}

async function cancelDispatch(row: DispatchRow) {
  try {
    await api.post(`/message-templates/dispatches/${row.id}/cancel`, {})
    row.status = 'CANCELLED'
    toast.success('Сообщение отменено')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отменить')
  }
}

const enabledCount = computed(() => items.value.filter((i) => i.enabled).length)
</script>

<template>
  <div class="mt-tab">
    <div v-if="loading" class="d-flex justify-center pa-12">
      <v-progress-circular indeterminate color="primary" size="32" />
    </div>

    <template v-else>
      <!-- Выключатель всей рассылки по событиям -->
      <v-card rounded="lg" elevation="0" border class="pa-5 mb-4">
        <div class="mt-head">
          <div class="mt-head-body">
            <div class="mt-title">Сообщения по событиям</div>
            <div class="mt-sub">
              Система сама пишет клиенту, когда наступает событие: подходит срок
              платежа, появилась просрочка, деньги получены, договор закрыт.
              <template v-if="engineEnabled">
                Прежние авто-напоминания при этом отключены — иначе клиент получал
                бы одно и то же дважды.
              </template>
              <template v-else>
                Отличие от прежних напоминаний: о просрочке пишем в отдельные дни
                (первый, третий, седьмой), а не каждый день подряд.
              </template>
            </div>
          </div>
          <button
            v-if="canEdit"
            class="mt-switch"
            :class="{ 'mt-switch--on': engineEnabled }"
            :disabled="saving"
            @click="toggleEngine"
          >
            {{ engineEnabled ? 'Включено' : 'Включить' }}
          </button>
        </div>

        <div v-if="engineEnabled" class="mt-meta">
          <div class="mt-meta-item">
            <v-icon icon="mdi-check-circle-outline" size="15" />
            Включено событий: {{ enabledCount }} из {{ items.length }}
          </div>
          <div class="mt-meta-item">
            <v-icon icon="mdi-clock-outline" size="15" />
            Не пишем клиентам с 21:00 до 9:00 — сообщение уходит утром
          </div>
          <div class="mt-meta-item">
            <v-icon icon="mdi-shield-check-outline" size="15" />
            Не больше двух сообщений одному клиенту в сутки
          </div>
        </div>

        <div v-if="engineEnabled && !whatsappConnected" class="mt-warn">
          <v-icon icon="mdi-alert-outline" size="16" />
          WhatsApp не подключён — сообщения копятся в очереди и уйдут после подключения
        </div>

        <div v-if="engineEnabled && canEdit" class="mt-tz">
          <label class="mt-tz-label">Часовой пояс — по нему считаются тихие часы</label>
          <select :value="timezone" class="mt-select" @change="saveTimezone(($event.target as HTMLSelectElement).value)">
            <option v-for="tz in TIMEZONES" :key="tz.value" :value="tz.value">{{ tz.title }}</option>
          </select>
        </div>
      </v-card>

      <!-- Список событий -->
      <div class="mt-list" :class="{ 'mt-list--off': !engineEnabled }">
        <div v-for="row in items" :key="row.event" class="mt-row">
          <button
            class="mt-check"
            :class="{ 'mt-check--on': row.enabled }"
            :disabled="!engineEnabled || !canEdit || !row.id"
            :title="row.enabled ? 'Отправляется' : 'Не отправляется'"
            @click="toggleTemplate(row)"
          >
            <v-icon v-if="row.enabled" icon="mdi-check" size="14" />
          </button>

          <div class="mt-row-body" @click="engineEnabled && canEdit && row.id ? openEditor(row) : null">
            <div class="mt-row-title">
              {{ row.name }}
              <span v-if="row.event === 'BEFORE_DUE' && row.offsetDays" class="mt-row-days">
                за {{ row.offsetDays }} дн.
              </span>
            </div>
            <div class="mt-row-hint">{{ row.hint }}</div>
            <div class="mt-row-body-text">{{ row.body }}</div>
          </div>

          <button
            v-if="canEdit && row.id"
            class="mt-edit"
            :disabled="!engineEnabled"
            @click="openEditor(row)"
          >
            Изменить
          </button>
        </div>
      </div>

      <!-- Журнал отправок -->
      <div v-if="engineEnabled" class="mt-journal">
        <div class="mt-journal-head">
          <div class="mt-title">Что уходило клиентам</div>
          <button class="mt-refresh" @click="loadDispatches">
            <v-icon icon="mdi-refresh" size="15" />
            Обновить
          </button>
        </div>

        <div v-if="!dispatches.length" class="mt-empty">
          Пока ничего не отправлялось. Первые сообщения появятся, когда наступит
          событие по одной из ваших сделок.
        </div>

        <v-card v-else rounded="lg" elevation="0" border class="pa-0">
          <div v-for="d in dispatches" :key="d.id" class="mt-disp">
            <div class="mt-disp-main">
              <div class="mt-disp-top">
                <span class="mt-disp-status" :class="`mt-disp-status--${d.status.toLowerCase()}`">
                  {{ STATUS_LABEL[d.status] }}
                </span>
                <span class="mt-disp-phone">{{ d.phone }}</span>
                <span class="mt-disp-date">
                  {{ formatDate(d.sentAt || d.scheduledAt) }}
                </span>
              </div>
              <div class="mt-disp-text">{{ d.body }}</div>
              <div v-if="d.error" class="mt-disp-error">{{ d.error }}</div>
            </div>
            <button
              v-if="d.status === 'PENDING' && canEdit"
              class="mt-disp-cancel"
              @click="cancelDispatch(d)"
            >
              Отменить
            </button>
          </div>
        </v-card>
      </div>
    </template>

    <!-- Редактор текста -->
    <v-dialog :model-value="!!editing" max-width="640" scrollable @update:model-value="editing = null">
      <v-card v-if="editing" rounded="lg" class="mt-editor">
        <div class="mt-editor-head">
          <div>
            <div class="mt-title">{{ editing.name }}</div>
            <div class="mt-sub">{{ editing.hint }}</div>
          </div>
          <button class="mt-close" @click="editing = null">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="mt-editor-body">
          <div v-if="editing.event === 'BEFORE_DUE'" class="mt-days">
            Напомнить за
            <input v-model.number="draft.offsetDays" type="number" min="1" max="30" class="mt-days-input" />
            дней до срока
          </div>

          <label class="mt-label">Текст сообщения</label>
          <textarea ref="bodyRef" v-model="draft.body" class="mt-textarea" rows="6"></textarea>

          <div class="mt-ph-label">Подставить данные клиента:</div>
          <div class="mt-ph-list">
            <button
              v-for="p in placeholders"
              :key="p.key"
              class="mt-ph"
              :title="`${p.label} — например «${p.sample}»`"
              @click="insertPlaceholder(p.key)"
            >
              {{ p.key }}
            </button>
          </div>

          <div class="mt-preview-actions">
            <button class="mt-ghost" :disabled="previewLoading" @click="showPreview(false)">
              Посмотреть на примере
            </button>
            <button class="mt-ghost" :disabled="previewLoading" @click="showPreview(true)">
              На реальной сделке
            </button>
          </div>

          <div v-if="preview" class="mt-preview">
            <div class="mt-preview-label">
              {{ preview.sample ? 'Так это будет выглядеть (данные вымышленные)' : 'На вашей последней сделке' }}
            </div>
            <div class="mt-bubble">{{ preview.text }}</div>
          </div>
        </div>

        <div class="mt-editor-actions">
          <button class="mt-reset" @click="resetTemplate">Вернуть стандартный текст</button>
          <v-spacer />
          <button class="mt-cancel" @click="editing = null">Отмена</button>
          <button class="mt-save" :disabled="saving || !draft.body.trim()" @click="saveTemplate">
            {{ saving ? 'Сохраняю…' : 'Сохранить' }}
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.mt-head { display: flex; align-items: flex-start; gap: 16px; }
.mt-head-body { flex: 1; min-width: 0; }
.mt-title { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.mt-sub {
  font-size: 13px; line-height: 1.5; margin-top: 3px; max-width: 640px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.mt-switch {
  flex-shrink: 0; padding: 9px 18px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  background: transparent; font-size: 13px; font-weight: 600; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.7); transition: all 0.15s;
}
.mt-switch:hover { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.mt-switch--on { background: #047857; border-color: #047857; color: #fff; }

.mt-meta { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 14px; }
.mt-meta-item {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55);
}
.mt-warn {
  display: flex; align-items: center; gap: 8px; margin-top: 12px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(245, 158, 11, 0.1); color: #b45309; font-size: 12.5px;
}
.mt-tz { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
.mt-tz-label { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.mt-select {
  height: 36px; padding: 0 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  background: rgb(var(--v-theme-surface)); font-size: 13px; color: inherit; outline: none;
}

/* ── Список событий ── */
.mt-list { display: flex; flex-direction: column; gap: 8px; }
.mt-list--off { opacity: 0.55; }
.mt-row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface));
}
.mt-check {
  width: 22px; height: 22px; flex-shrink: 0; margin-top: 2px;
  border-radius: 6px; border: 1.5px solid rgba(var(--v-theme-on-surface), 0.25);
  background: transparent; cursor: pointer; color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.mt-check--on { background: #047857; border-color: #047857; }
.mt-check:disabled { cursor: default; opacity: 0.6; }

.mt-row-body { flex: 1; min-width: 0; cursor: pointer; }
.mt-row-title {
  font-size: 14.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.mt-row-days {
  margin-left: 6px; font-size: 12px; font-weight: 600; color: #047857;
}
.mt-row-hint { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.mt-row-body-text {
  margin-top: 6px; font-size: 13px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.65);
  white-space: pre-wrap;
}
.mt-edit {
  flex-shrink: 0; padding: 7px 14px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; font-size: 12.5px; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.mt-edit:hover:not(:disabled) { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.mt-edit:disabled { opacity: 0.5; cursor: default; }

/* ── Журнал ── */
.mt-journal { margin-top: 28px; }
.mt-journal-head {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;
}
.mt-refresh {
  display: inline-flex; align-items: center; gap: 5px;
  border: none; background: none; cursor: pointer; font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.mt-refresh:hover { color: #047857; }
.mt-empty {
  padding: 24px; border-radius: 12px; text-align: center; font-size: 13px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.15);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.mt-disp { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; }
.mt-disp + .mt-disp { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
.mt-disp-main { flex: 1; min-width: 0; }
.mt-disp-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mt-disp-status {
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.mt-disp-status--sent { background: rgba(16, 185, 129, 0.14); color: #047857; }
.mt-disp-status--pending { background: rgba(59, 130, 246, 0.12); color: #2563eb; }
.mt-disp-status--failed { background: rgba(239, 68, 68, 0.12); color: #dc2626; }
.mt-disp-phone { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.7); }
.mt-disp-date { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); }
.mt-disp-text {
  margin-top: 5px; font-size: 13px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.7); white-space: pre-wrap;
}
.mt-disp-error { margin-top: 4px; font-size: 12px; color: #dc2626; }
.mt-disp-cancel {
  flex-shrink: 0; padding: 6px 12px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.06); cursor: pointer;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.65);
}

/* ── Редактор ── */
.mt-editor { padding: 0; }
.mt-editor-head {
  display: flex; align-items: flex-start; gap: 12px; padding: 20px 24px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.mt-close {
  margin-left: auto; width: 32px; height: 32px; border-radius: 8px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5); cursor: pointer;
}
.mt-editor-body { padding: 16px 24px; max-height: 60vh; overflow-y: auto; }
.mt-days {
  display: flex; align-items: center; gap: 8px; margin-bottom: 14px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7);
}
.mt-days-input {
  width: 64px; height: 34px; padding: 0 8px; text-align: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15); border-radius: 8px;
  background: rgb(var(--v-theme-surface)); font-size: 14px; color: inherit; outline: none;
}
.mt-label { display: block; font-size: 12.5px; margin-bottom: 6px; color: rgba(var(--v-theme-on-surface), 0.55); }
.mt-textarea {
  width: 100%; padding: 12px 14px; border-radius: 10px; resize: vertical;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  background: rgb(var(--v-theme-surface));
  font-size: 14px; line-height: 1.5; font-family: inherit; color: inherit; outline: none;
}
.mt-textarea:focus {
  border-color: #047857; box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}
.mt-ph-label { margin-top: 14px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.mt-ph-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.mt-ph {
  padding: 5px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.mt-ph:hover { border-color: rgba(4, 120, 87, 0.4); color: #047857; }

.mt-preview-actions { display: flex; gap: 8px; margin-top: 16px; }
.mt-ghost {
  padding: 8px 14px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.mt-ghost:hover:not(:disabled) { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.mt-preview { margin-top: 14px; }
.mt-preview-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 6px; }
.mt-bubble {
  padding: 12px 14px; border-radius: 12px 12px 12px 4px;
  background: rgba(4, 120, 87, 0.08);
  font-size: 13.5px; line-height: 1.5; white-space: pre-wrap;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.mt-editor-actions {
  display: flex; align-items: center; gap: 8px; padding: 14px 24px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.mt-reset {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55);
}
.mt-reset:hover { color: #047857; }
.mt-cancel {
  padding: 9px 16px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7); font-size: 13px; font-weight: 600; cursor: pointer;
}
.mt-save {
  padding: 9px 18px; border-radius: 10px; border: none;
  background: #047857; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
}
.mt-save:disabled { opacity: 0.5; cursor: default; }
</style>
