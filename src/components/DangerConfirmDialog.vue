<script setup lang="ts">
/**
 * Подтверждение необратимого действия: очистка кабинета и удаление аккаунта.
 *
 * Одно окно на оба случая — они отличаются только текстами и последствиями, а
 * порядок разговора один: сначала показать в цифрах, что именно исчезнет,
 * потом попросить набрать слово и пароль. Два похожих окна разошлись бы через
 * месяц, и в одном из них защита оказалась бы слабее.
 */
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  modelValue: boolean
  title: string
  subtitle: string
  /** Слово, которое партнёр набирает руками. */
  word: string
  /** Надпись на кнопке действия. */
  action: string
  /** Откуда взять цифры последствий. */
  previewUrl: string
  /** Куда отправить подтверждение. */
  submitUrl: string
  /** Как назвать строки в списке последствий. */
  rows: Array<{ key: string; label: string }>
  /** Пояснение под списком: чем это обратимо (или что уже не вернуть). */
  note: string
  /** Опасное пояснение — красным, а не спокойным серым. */
  noteDanger?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'done', payload: any): void
}>()

const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const preview = ref<Record<string, number> | null>(null)
const loading = ref(false)
const running = ref(false)
const password = ref('')
const confirmation = ref('')
/** Ошибка сервера показывается в самом окне: тост за модалкой не виден. */
const error = ref('')

const lines = computed(() =>
  props.rows
    .map((r) => ({ label: r.label, value: preview.value?.[r.key] ?? 0 }))
    .filter((r) => r.value > 0),
)

const ready = computed(
  () => confirmation.value.trim().toUpperCase() === props.word && password.value.length > 0,
)

// immediate: окно может быть смонтировано уже открытым — тогда без этого оно
// показало бы «данных нет» вместо настоящих цифр.
watch(
  open,
  async (v) => {
    error.value = ''
    if (!v) {
      password.value = ''
      confirmation.value = ''
      return
    }
    loading.value = true
    try {
      preview.value = await api.get<Record<string, number>>(props.previewUrl)
    } catch {
      preview.value = null
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

async function run() {
  if (!ready.value || running.value) return
  running.value = true
  error.value = ''
  try {
    const res = await api.post<any>(props.submitUrl, {
      password: password.value,
      confirmation: confirmation.value.trim().toUpperCase(),
    })
    open.value = false
    emit('done', res)
  } catch (e: any) {
    // Неверный пароль и «есть действующие сделки» — это ответ на действие, и
    // читать его нужно здесь же, не закрывая окно.
    error.value = e?.message || 'Не удалось выполнить действие'
    toast.error(error.value)
  } finally {
    running.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="520" :persistent="running">
    <v-card rounded="lg" class="dc-card">
      <div class="dc-head">
        <div class="dc-icon"><v-icon icon="mdi-alert-outline" size="22" /></div>
        <div>
          <div class="dc-title">{{ title }}</div>
          <div class="dc-sub">{{ subtitle }}</div>
        </div>
      </div>

      <div v-if="loading" class="dc-loading">
        <v-progress-circular indeterminate size="26" width="2" color="primary" />
      </div>

      <template v-else>
        <div v-if="lines.length" class="dc-list">
          <div class="dc-list-title">Будет удалено безвозвратно</div>
          <div v-for="r in lines" :key="r.label" class="dc-row">
            <span>{{ r.label }}</span>
            <span class="dc-row-value">{{ r.value.toLocaleString('ru-RU') }}</span>
          </div>
        </div>
        <div v-else class="dc-empty">В кабинете нет данных.</div>

        <div class="dc-note" :class="{ 'dc-note--danger': noteDanger }">
          <v-icon :icon="noteDanger ? 'mdi-alert-outline' : 'mdi-shield-check-outline'" size="16" />
          <span>{{ note }}</span>
        </div>

        <div class="dc-field">
          <label class="dc-label">Введите слово <b>{{ word }}</b></label>
          <input v-model="confirmation" class="dc-input" :placeholder="word" autocomplete="off" />
        </div>

        <div class="dc-field">
          <label class="dc-label">Пароль от аккаунта</label>
          <input
            v-model="password"
            type="password"
            class="dc-input"
            autocomplete="current-password"
            @keyup.enter="run"
          />
        </div>

        <div v-if="error" class="dc-error">{{ error }}</div>

        <div class="dc-actions">
          <button class="dc-btn dc-btn--ghost" :disabled="running" @click="open = false">
            Отмена
          </button>
          <button class="dc-btn dc-btn--danger" :disabled="!ready || running" @click="run">
            <v-progress-circular v-if="running" indeterminate size="15" width="2" color="white" />
            {{ running ? 'Выполняем…' : action }}
          </button>
        </div>
      </template>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.dc-card { padding: 20px; }

.dc-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.dc-icon {
  width: 40px; height: 40px; border-radius: 11px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(239, 68, 68, 0.1); color: #dc2626;
}
.dc-title { font-size: 16px; font-weight: 700; }
.dc-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 2px; }

.dc-loading { display: flex; justify-content: center; padding: 24px; }

.dc-list {
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 12px; padding: 10px 12px; margin-bottom: 12px;
}
.dc-list-title {
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: #dc2626; margin-bottom: 6px;
}
.dc-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 0; font-size: 13.5px;
}
.dc-row-value { font-weight: 700; font-variant-numeric: tabular-nums; }
.dc-empty {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); margin-bottom: 12px;
}

.dc-note {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 10px 12px; border-radius: 10px; margin-bottom: 14px;
  background: rgba(4, 120, 87, 0.07);
  font-size: 12.5px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
/* Когда возвращать нечего, оговорка не должна выглядеть успокаивающей. */
.dc-note--danger { background: rgba(239, 68, 68, 0.08); color: #b91c1c; }

.dc-field { margin-bottom: 12px; }
.dc-label {
  display: block; font-size: 12.5px; margin-bottom: 5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.dc-input {
  width: 100%; height: 42px; padding: 0 13px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 10px; background: rgb(var(--v-theme-surface));
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9); outline: none;
}
.dc-input:focus { border-color: #dc2626; }

.dc-error {
  margin-bottom: 10px; font-size: 12.5px; color: #dc2626;
}

.dc-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.dc-btn {
  display: flex; align-items: center; gap: 7px;
  height: 40px; padding: 0 16px; border: none; border-radius: 10px;
  font-size: 13.5px; font-weight: 600; cursor: pointer;
}
.dc-btn:disabled { opacity: 0.5; cursor: default; }
.dc-btn--ghost {
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.6);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.dc-btn--danger { background: #dc2626; color: #fff; }
</style>
