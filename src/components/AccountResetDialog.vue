<script setup lang="ts">
/**
 * Подтверждение очистки личного кабинета.
 *
 * Порядок разговора: сначала в цифрах показать, что исчезнет, потом попросить
 * набрать слово и пароль. На этой ветке резервной копии перед очисткой нет —
 * вернуть данные будет нечем, и окно говорит об этом прямо.
 */
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'

const WORD = 'ОЧИСТИТЬ'

const props = defineProps<{ modelValue: boolean }>()
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
const error = ref('')

/**
 * Поля подтверждения не должны заполняться сами: браузер видит пару «текст +
 * пароль» и подставляет сохранённые данные от кабинета, а это превращает
 * защиту в одну кнопку. Поле до первого щелчка — только для чтения.
 */
const noAutofill = {
  autocomplete: 'new-password',
  autocorrect: 'off',
  autocapitalize: 'off',
  spellcheck: 'false',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
} as const
const typed = ref(false)

const ROWS = [
  { key: 'deals', label: 'Сделки' },
  { key: 'payments', label: 'Платежи' },
  { key: 'clients', label: 'Клиенты' },
  { key: 'journal', label: 'Записи в журнале кассы' },
  { key: 'staff', label: 'Сотрудники' },
]
const lines = computed(() =>
  ROWS.map((r) => ({ label: r.label, value: preview.value?.[r.key] ?? 0 })).filter((r) => r.value > 0),
)
const ready = computed(() => confirmation.value.trim().toUpperCase() === WORD && password.value.length > 0)

// Итог: окно не закрывается молча — сразу видно, сколько стёрто.
const doneOpen = ref(false)
const doneResult = ref<any>(null)
const doneTotal = computed(() => Number(doneResult.value?.total ?? 0))
const DONE_ROWS = [
  { key: 'deal', label: 'Сделки' },
  { key: 'payment', label: 'Платежи' },
  { key: 'clientProfile', label: 'Клиенты' },
  { key: 'cashFlowEntry', label: 'Записи журнала кассы' },
  { key: 'investorStaff', label: 'Сотрудники' },
]
const doneRows = computed(() =>
  DONE_ROWS.map((r) => ({ ...r, value: Number(doneResult.value?.removed?.[r.key] ?? 0) })).filter((r) => r.value > 0),
)
const recordsWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? 'запись' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'записи' : 'записей'

watch(
  open,
  async (v) => {
    error.value = ''
    if (!v) {
      password.value = ''
      confirmation.value = ''
      typed.value = false
      return
    }
    loading.value = true
    try {
      preview.value = await api.get<Record<string, number>>('/account/reset/preview')
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
    const res = await api.post<any>('/account/reset', {
      password: password.value,
      confirmation: confirmation.value.trim().toUpperCase(),
    })
    open.value = false
    doneResult.value = res
    doneOpen.value = true
  } catch (e: any) {
    // Неверный пароль — ответ на действие: показываем в самом окне.
    error.value = e?.message || 'Не удалось очистить кабинет'
    toast.error(error.value)
  } finally {
    running.value = false
  }
}

function finishDone() {
  doneOpen.value = false
  emit('done', doneResult.value)
}
</script>

<template>
  <v-dialog v-model="open" max-width="500" :persistent="running">
    <v-card rounded="lg" class="dc-card">
      <div class="dc-head">
        <div class="dc-icon"><v-icon icon="mdi-alert-outline" size="22" /></div>
        <div>
          <div class="dc-title">Очистить личный кабинет</div>
          <div class="dc-sub">Кабинет станет таким, каким был в день создания</div>
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

        <div class="dc-note">
          <v-icon icon="mdi-alert-outline" size="16" />
          <span>Вернуть данные будет нельзя. Аккаунт, подписка и доступ останутся, касса «Основная» создастся заново.</span>
        </div>

        <div class="dc-field">
          <label class="dc-label">Введите слово <b>{{ WORD }}</b></label>
          <input
            v-model="confirmation"
            v-bind="noAutofill"
            :readonly="!typed"
            class="dc-input"
            :placeholder="WORD"
            @focus="typed = true"
          />
        </div>
        <div class="dc-field">
          <label class="dc-label">Пароль от аккаунта</label>
          <input
            v-model="password"
            type="password"
            v-bind="noAutofill"
            :readonly="!typed"
            class="dc-input"
            @focus="typed = true"
            @keyup.enter="run"
          />
        </div>

        <div v-if="error" class="dc-error">{{ error }}</div>
        <div v-if="running" class="dc-running">Очищаем кабинет — это может занять до минуты. Не закрывайте вкладку.</div>

        <div class="dc-actions">
          <button class="dc-btn dc-btn--ghost" :disabled="running" @click="open = false">Отмена</button>
          <button class="dc-btn dc-btn--danger" :disabled="!ready || running" @click="run">
            <v-progress-circular v-if="running" indeterminate size="15" width="2" color="white" />
            {{ running ? 'Очищаем…' : 'Очистить кабинет' }}
          </button>
        </div>
      </template>
    </v-card>
  </v-dialog>

  <!-- Итог. Единственный выход перезагружает кабинет: иначе открытые разделы
       останутся со старыми данными в памяти браузера. -->
  <v-dialog v-model="doneOpen" max-width="420" persistent>
    <v-card rounded="lg" class="dc-done">
      <div class="dc-done-icon"><v-icon icon="mdi-check" size="30" /></div>
      <div class="dc-done-title">Личный кабинет очищен</div>
      <div class="dc-done-sub">Удалено {{ doneTotal.toLocaleString('ru-RU') }} {{ recordsWord(doneTotal) }}.</div>
      <div v-if="doneRows.length" class="dc-done-list">
        <div v-for="r in doneRows" :key="r.key" class="dc-done-row">
          <span>{{ r.label }}</span>
          <b>{{ r.value.toLocaleString('ru-RU') }}</b>
        </div>
      </div>
      <button class="dc-btn dc-btn--go" @click="finishDone">Начать работу</button>
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
.dc-list { border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; }
.dc-list-title {
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: #dc2626; margin-bottom: 6px;
}
.dc-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 13.5px; }
.dc-row-value { font-weight: 700; font-variant-numeric: tabular-nums; }
.dc-empty { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); margin-bottom: 12px; }
.dc-note {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 10px 12px; border-radius: 10px; margin-bottom: 14px;
  background: rgba(239, 68, 68, 0.08); color: #b91c1c;
  font-size: 12.5px; line-height: 1.45;
}
.dc-field { margin-bottom: 14px; }
.dc-label { display: block; font-size: 12.5px; margin-bottom: 5px; color: rgba(var(--v-theme-on-surface), 0.6); }
.dc-input {
  width: 100%; height: 42px; padding: 0 13px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 10px; background: rgb(var(--v-theme-surface));
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9); outline: none;
}
.dc-input:focus { border-color: #dc2626; }
.dc-error { margin-bottom: 10px; font-size: 12.5px; color: #dc2626; }
.dc-running { margin-top: 4px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.dc-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
.dc-btn {
  display: flex; align-items: center; gap: 7px;
  height: 40px; padding: 0 16px; border: none; border-radius: 10px;
  font-size: 13.5px; font-weight: 600; cursor: pointer;
}
.dc-btn:disabled { opacity: 0.5; cursor: default; }
.dc-btn--ghost { background: transparent; color: rgba(var(--v-theme-on-surface), 0.6); border: 1px solid rgba(var(--v-theme-on-surface), 0.12); }
.dc-btn--danger { background: #dc2626; color: #fff; }
.dc-done { padding: 26px 24px 22px; text-align: center; }
.dc-done-icon {
  width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.1); color: #047857;
}
.dc-done-title { font-size: 18px; font-weight: 700; }
.dc-done-sub { margin-top: 6px; font-size: 13px; line-height: 1.5; color: rgba(var(--v-theme-on-surface), 0.6); }
.dc-done-list {
  margin: 18px 0 4px; padding: 10px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1); border-radius: 12px; text-align: left;
}
.dc-done-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 0; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.dc-done-row:last-child { border-bottom: none; }
.dc-done-row b { color: rgba(var(--v-theme-on-surface), 0.9); font-variant-numeric: tabular-nums; }
.dc-btn--go { width: 100%; margin-top: 20px; justify-content: center; background: #047857; color: #fff; }
.dc-btn--go:hover { background: #065f46; }
</style>
