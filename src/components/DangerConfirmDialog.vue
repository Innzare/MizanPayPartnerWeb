<script setup lang="ts">
/**
 * Подтверждение необратимого действия: очистка кабинета и удаление аккаунта.
 *
 * Одно окно на оба случая — они отличаются только текстами и последствиями, а
 * порядок разговора один: сначала показать в цифрах, что именно исчезнет,
 * потом попросить набрать слово и пароль. Два похожих окна разошлись бы через
 * месяц, и в одном из них защита оказалась бы слабее.
 */
import { useOperationProgress } from '@/composables/useOperationProgress'
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
  /**
   * Показать выбор «сделать резервную копию перед действием».
   *
   * Есть только у очистки: при удалении аккаунта копия бессмысленна — она
   * удаляется вместе с ним.
   */
  backupOption?: boolean
  /**
   * Показать итог после успеха вместо молчаливого закрытия.
   *
   * Есть у очистки: операция идёт минутами, и партнёр должен увидеть, чем она
   * закончилась. У удаления аккаунта итог показывать некому — кабинета больше
   * нет, и следом идёт выход.
   */
  resultTitle?: string
  /** Как назвать строки в итоге: ключ ответа сервера → подпись. */
  resultRows?: Array<{ key: string; label: string }>
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

/**
 * Поля подтверждения не должны заполняться сами.
 *
 * Браузер видит пару «текст + пароль» и подставляет туда сохранённые данные от
 * кабинета — а это окно как раз про то, чтобы человек своими руками подтвердил
 * необратимое: очистку кабинета или удаление аккаунта. Подставленный пароль
 * превращает защиту в одну кнопку.
 *
 * `autocomplete="off"` браузеры для таких форм игнорируют, поэтому здесь ещё
 * два приёма: `new-password` (менеджеры не предлагают сохранённый пароль от
 * этого сайта) и поле, которое до первого щелчка стоит `readonly` — заполнять
 * его автоподстановка отказывается.
 */
const noAutofill = {
  autocomplete: 'new-password',
  autocorrect: 'off',
  autocapitalize: 'off',
  spellcheck: 'false',
  /** Метки для менеджеров паролей: 1Password и LastPass. */
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
} as const

/** Сняли `readonly` — человек щёлкнул в поле сам. */
const typed = ref(false)

/** Полоса хода: очистка и удаление идут минутами. */
const progress = useOperationProgress()

/**
 * Делать ли резервную копию перед действием.
 *
 * По умолчанию — да: копия и есть страховка от ошибки. Но собирается она
 * дольше самой очистки, и партнёру, который чистит только что заведённый
 * кабинет, ждать её незачем.
 */
const withBackup = ref(true)

// ── Итог операции ──
// Окно не закрывается молча: очистка идёт минутами, и её результат — такая же
// часть разговора, как и подтверждение.
const doneOpen = ref(false)
const doneResult = ref<any>(null)

/** Что удалось — по крупным разделам, пустые не показываем. */
const doneRows = computed(() =>
  (props.resultRows ?? [])
    .map((r) => ({ ...r, value: Number(doneResult.value?.removed?.[r.key] ?? 0) }))
    .filter((r) => r.value > 0),
)

const doneTotal = computed(() => Number(doneResult.value?.total ?? 0))

function finishDone() {
  doneOpen.value = false
  emit('done', doneResult.value)
}
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
      // Следующее открытие окна снова начинается с полей «только для чтения».
      typed.value = false
      withBackup.value = true
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
  progress.start()
  try {
    const res = await api.post<any>(props.submitUrl, {
      password: password.value,
      confirmation: confirmation.value.trim().toUpperCase(),
      ...(props.backupOption ? { backup: withBackup.value } : {}),
    })
    open.value = false
    if (props.resultTitle) {
      doneResult.value = res
      doneOpen.value = true
    } else {
      emit('done', res)
    }
  } catch (e: any) {
    // Неверный пароль и «есть действующие сделки» — это ответ на действие, и
    // читать его нужно здесь же, не закрывая окно.
    error.value = e?.message || 'Не удалось выполнить действие'
    toast.error(error.value)
  } finally {
    running.value = false
    progress.stop()
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

        <!-- Автозаполнение здесь отключено намеренно, см. `noAutofill`:
             оба поля — это подтверждение необратимого действия, и заполнять их
             должен человек, а не менеджер паролей. -->
        <!-- Выбор копии: по умолчанию включён. Снимают его те, кому нечего
             терять — например, при очистке только что заведённого кабинета. -->
        <label v-if="backupOption" class="dc-backup" :class="{ 'dc-backup--off': !withBackup }">
          <input v-model="withBackup" type="checkbox" :disabled="running" />
          <span>
            <span class="dc-backup-title">Сделать резервную копию перед очисткой</span>
            <span class="dc-backup-note">
              {{ withBackup
                ? 'Копия останется в разделе «Резервные копии» — из неё можно вернуть всю работу'
                : 'Без копии вернуть данные будет нечем' }}
            </span>
          </span>
        </label>

        <div class="dc-field">
          <label class="dc-label">Введите слово <b>{{ word }}</b></label>
          <input
            v-model="confirmation"
            v-bind="noAutofill"
            :readonly="!typed"
            class="dc-input"
            :placeholder="word"
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

        <!-- Пока идёт работа — полоса вместо ожидания в пустоту. Проценты
             честные: сервер считает их от того же числа записей, которое
             показано выше. -->
        <div v-if="running" class="dc-progress">
          <div class="dc-progress-head">
            <span>
              <!-- Копия и очистка считаются раздельно: без номера шага
                   заполнившаяся полоса выглядела бы как «всё, готово». -->
              <span v-if="progress.stages.value > 1" class="dc-progress-stage">
                Шаг {{ progress.stage.value }} из {{ progress.stages.value }} ·
              </span>
              {{ progress.phase.value || 'Начинаем…' }}
            </span>
            <span class="dc-progress-pct">{{ progress.percent.value }} %</span>
          </div>
          <div class="dc-progress-bar">
            <!-- Сборка копии — созидательный шаг, и красная полоса на нём
                 читается как «идёт удаление». Красным отмечаем только сам
                 необратимый этап. -->
            <div
              class="dc-progress-fill"
              :class="{ 'dc-progress-fill--safe': progress.stages.value > 1 && progress.stage.value === 1 }"
              :style="{ width: progress.percent.value + '%' }"
            />
          </div>
          <!-- Счёт записей показываем только там, где считаются записи: на
               сборке копии единица работы — таблица, и «84 из 94 записей» было
               бы неправдой. -->
          <div v-if="progress.unit.value === 'rows' && progress.total.value" class="dc-progress-note">
            {{ progress.done.value.toLocaleString('ru-RU') }} из
            {{ progress.total.value.toLocaleString('ru-RU') }} записей · не закрывайте вкладку
          </div>
          <div v-else class="dc-progress-note">Не закрывайте вкладку</div>
        </div>

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

  <!-- Итог: то же окно, что после восстановления из копии. Закрыть мимо
       нельзя — единственный выход отсюда перезагружает кабинет, иначе
       открытые разделы останутся со старыми данными в памяти браузера. -->
  <v-dialog v-model="doneOpen" max-width="440" persistent>
    <v-card rounded="lg" class="dc-done">
      <div class="dc-done-icon"><v-icon icon="mdi-check" size="30" /></div>
      <div class="dc-done-title">{{ resultTitle }}</div>
      <div class="dc-done-sub">
        Удалено {{ doneTotal.toLocaleString('ru-RU') }}
        {{ doneTotal === 1 ? 'запись' : doneTotal % 10 >= 2 && doneTotal % 10 <= 4 && (doneTotal % 100 < 10 || doneTotal % 100 >= 20) ? 'записи' : 'записей' }}.
        <template v-if="doneResult?.backupToken">
          Резервная копия сохранена — она в разделе «Резервные копии».
        </template>
      </div>

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

.dc-field { margin-bottom: 14px; }
.dc-field:last-of-type { margin-bottom: 0; }
.dc-label {
  display: block; font-size: 12.5px; margin-bottom: 5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
/* Итоговое окно. */
.dc-done { padding: 26px 24px 22px; text-align: center; }
.dc-done-icon {
  width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.1); color: #047857;
}
.dc-done-title { font-size: 18px; font-weight: 700; }
.dc-done-sub {
  margin-top: 6px; font-size: 13px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.dc-done-list {
  margin: 18px 0 4px; padding: 10px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px; text-align: left;
}
.dc-done-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 0; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.dc-done-row:last-child { border-bottom: none; }
.dc-done-row b { color: rgba(var(--v-theme-on-surface), 0.9); font-variant-numeric: tabular-nums; }
.dc-btn--go {
  width: 100%; margin-top: 20px; justify-content: center;
  background: #047857; color: #fff;
}
.dc-btn--go:hover { background: #065f46; }

/* Выбор резервной копии. */
.dc-backup {
  display: flex; align-items: flex-start; gap: 10px;
  /* Тот же зазор, что между остальными блоками окна: снизу поле подтверждения,
     сверху пояснение, и галочка не должна липнуть ни к одному из них. */
  margin: 18px 0; padding: 12px 14px; border-radius: 10px;
  border: 1px solid rgba(4, 120, 87, 0.2);
  background: rgba(4, 120, 87, 0.05);
  cursor: pointer;
}
.dc-backup--off {
  border-color: rgba(220, 38, 38, 0.25);
  background: rgba(220, 38, 38, 0.05);
}
.dc-backup input { width: 17px; height: 17px; margin-top: 1px; accent-color: #047857; cursor: pointer; }
.dc-backup > span { display: flex; flex-direction: column; }
.dc-backup-title { font-size: 13.5px; font-weight: 600; }
.dc-backup-note {
  margin-top: 2px; font-size: 12px; line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.dc-backup--off .dc-backup-note { color: #dc2626; }

/* Полоса хода операции. */
.dc-progress { margin-top: 20px; }
.dc-progress-head {
  display: flex; align-items: baseline; justify-content: space-between;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7);
}
.dc-progress-pct { font-weight: 700; font-variant-numeric: tabular-nums; }
.dc-progress-stage { color: rgba(var(--v-theme-on-surface), 0.45); }
.dc-progress-bar {
  margin-top: 6px; height: 6px; border-radius: 4px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.dc-progress-fill {
  height: 100%; border-radius: 4px; background: #dc2626;
  transition: width 0.4s ease, background-color 0.3s ease;
}
.dc-progress-fill--safe { background: #047857; }
.dc-progress-note {
  margin-top: 6px; font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-variant-numeric: tabular-nums;
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

.dc-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
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
