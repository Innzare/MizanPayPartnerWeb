<script setup lang="ts">
/**
 * Резервные копии данных.
 *
 * В каждой копии два файла: таблица Excel — смотреть данные глазами, и файл
 * восстановления — вернуть работу целиком, со сделками, графиками, кассой и
 * связями. Оба лежат у партнёра на руках и не зависят от нас.
 *
 * Восстановление разрешено только в пустой аккаунт: поверх существующих данных
 * оно задвоило бы деньги.
 */
import { useOperationProgress } from '@/composables/useOperationProgress'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { formatDate } from '@/utils/formatters'

type Frequency = 'EVERY_N_HOURS' | 'DAILY' | 'WEEKLY'

interface Schedule {
  enabled: boolean
  frequency: Frequency
  everyNHours: number | null
  timeOfDay: string
  weekdays: number[]
  emailOnCreate: boolean
  lastRunAt: string | null
  available: boolean
  minHours: number
  timezone: string
  email: string | null
}

interface BackupFile {
  id: string
  token: string
  fileName: string
  sizeBytes: number
  /** Полный слепок рядом с таблицей — из него данные восстанавливаются. */
  dumpSizeBytes: number | null
  dealsCount: number
  trigger: 'SCHEDULED' | 'MANUAL'
  status: 'PENDING' | 'READY' | 'FAILED'
  error: string | null
  downloadedAt: string | null
  createdAt: string
  expiresAt: string
}

const props = withDefaults(
  defineProps<{
    /** Какую половину раздела показывать: список копий или расписание. */
    view?: 'files' | 'settings'
  }>(),
  { view: 'files' },
)

const emit = defineEmits<{
  /** Сколько готовых копий — для счётчика на вкладке. */
  (e: 'files-count', v: number): void
}>()

const auth = useAuthStore()
const toast = useToast()

const canManage = computed(() => auth.can('backups.manage'))
const canDownload = computed(() => auth.can('backups.download'))

const schedule = ref<Schedule | null>(null)
/** Сколько места занимают копии и сколько их из положенных. */
const usage = ref<{ files: number; limit: number; bytes: number } | null>(null)
const files = ref<BackupFile[]>([])
const loading = ref(true)
/**
 * Полоса хода: сборка копии и восстановление идут минутами.
 *
 * Объявлена здесь, до первого использования: ниже она нужна и в `runNow`, и в
 * наблюдателе за готовящейся копией, а `const` до объявления недоступна —
 * панель падала с «Cannot access 'progress' before initialization».
 */
const progress = useOperationProgress()
const saving = ref(false)
const running = ref(false)

const WEEKDAYS = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 7, label: 'Вс' },
]

async function load() {
  loading.value = true
  try {
    const [s, list, use] = await Promise.all([
      api.get<Schedule>('/backups/schedule'),
      api.get<BackupFile[]>('/backups'),
      api.get<{ files: number; limit: number; bytes: number }>('/backups/usage'),
    ])
    schedule.value = s
    files.value = list
    usage.value = use
    emit('files-count', list.filter((f) => f.status === 'READY').length)
  } catch {
    // Раздел вспомогательный: не загрузился — остальные настройки работают.
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  // Копия могла начать собираться по расписанию до открытия страницы —
  // иначе строка «Готовится…» висела бы до ручного обновления.
  pollWhilePending()
})

/** Есть ли копия, которая сейчас собирается: пока да — список надо обновлять. */
const pending = computed(() => files.value.some((f) => f.status === 'PENDING'))

let pollTimer: number | null = null

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = null
}

function pollWhilePending() {
  stopPolling()
  if (!pending.value) return
  pollTimer = window.setInterval(async () => {
    if (!pending.value) return stopPolling()
    try {
      files.value = await api.get<BackupFile[]>('/backups')
    } catch {
      // Опрос прекращаем при первой же ошибке: иначе после выхода из аккаунта
      // страница продолжала бы стучаться в сервер мёртвым токеном каждые пять
      // секунд — бесконечно, потому что список так и остался бы «готовится».
      stopPolling()
    }
  }, 5000)
}

// Таймер живёт дольше страницы, если его не остановить.
onUnmounted(stopPolling)

async function save() {
  if (!schedule.value || saving.value) return
  saving.value = true
  try {
    const s = schedule.value
    schedule.value = await api.patch<Schedule>('/backups/schedule', {
      enabled: s.enabled,
      frequency: s.frequency,
      everyNHours: s.frequency === 'EVERY_N_HOURS' ? s.everyNHours ?? s.minHours : undefined,
      timeOfDay: s.timeOfDay,
      weekdays: s.weekdays,
      emailOnCreate: s.emailOnCreate,
    })
    toast.success('Расписание сохранено')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить расписание')
  } finally {
    saving.value = false
  }
}

async function runNow() {
  if (running.value) return
  running.value = true
  // Копия крупного партнёра собирается минутами: список обновляется по
  // статусу, но всё это время непонятно, идёт ли работа. Полоса показывает ход.
  progress.start()
  try {
    await api.post('/backups/run', {})
    toast.success('Копия готовится — файл появится в списке через минуту')
    await load()
    pollWhilePending()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось запустить копию')
    progress.stop()
  } finally {
    // Кнопку отпускаем сразу — сборка идёт в фоне, и ход её видно по полосе.
    running.value = false
  }
}

/**
 * Полоса сборки живёт, пока копия собирается.
 *
 * Запрос «создать копию» отвечает мгновенно, а работа продолжается на сервере:
 * останавливать опрос по ответу нельзя — полоса исчезла бы через секунду после
 * появления.
 */
watch(
  [pending, () => progress.finished.value],
  ([isPending, done]) => {
    if (!progress.active.value) return
    if (done || (!isPending && !running.value)) progress.stop()
  },
)

/**
 * Скачивание идёт через авторизованный запрос: файл лежит в приватном
 * хранилище, и прямой ссылкой его не отдать — там паспортные данные клиентов.
 */
async function download(f: BackupFile) {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/backups/download/${f.token}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || 'Не удалось скачать файл')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = f.fileName
    a.click()
    URL.revokeObjectURL(url)
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось скачать файл')
  }
}

/** Скачать файл восстановления — тем же путём, что и таблицу. */
async function downloadFull(f: BackupFile) {
  await fetchFile(`/backups/download/${f.token}/full`, f.fileName.replace(/\.xlsx$/, '.mzbackup'))
}

async function fetchFile(path: string, name: string) {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || 'Не удалось скачать файл')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось скачать файл')
  }
}

// ── Восстановление ──────────────────────────────────────────────────────────

interface RestorePreview {
  meta: { createdAt: string; counts: Record<string, number>; partner: { companyName: string | null } }
  current: { deals: number; payments: number; accounts: number; clients: number }
  canRestore: boolean
  blockedReason?: string
}

const restoreFile = ref<File | null>(null)
const restorePreview = ref<RestorePreview | null>(null)
const restoring = ref(false)

/** Сколько записей вернётся — по крупным разделам, а не по всем таблицам. */
function previewRows(p: RestorePreview | null) {
  const c = p?.meta.counts ?? {}
  return [
    { label: 'Сделок', value: c.deal ?? 0 },
    { label: 'Платежей', value: c.payment ?? 0 },
    { label: 'Клиентов', value: c.clientProfile ?? 0 },
    { label: 'Записей журнала кассы', value: c.cashFlowEntry ?? 0 },
    { label: 'Счетов', value: c.account ?? 0 },
  ].filter((r) => r.value > 0)
}
const restoreRows = computed(() => previewRows(restorePreview.value))

async function pickRestoreFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  restoreFile.value = file
  restorePreview.value = null
  const form = new FormData()
  form.append('file', file)
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/backups/restore/preview`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      body: form,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.message || 'Не удалось прочитать файл')
    restorePreview.value = data
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось прочитать файл')
    restoreFile.value = null
  }
}

async function runRestore() {
  if (!restoreFile.value || !restorePreview.value?.canRestore || restoring.value) return
  if (!confirm('Восстановить данные из этого файла? Текущий аккаунт пуст, данные будут загружены целиком.')) return
  restoring.value = true
  progress.start()
  const form = new FormData()
  form.append('file', restoreFile.value)
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/backups/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      body: form,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.message || 'Не удалось восстановить')
    // Не тост: восстановление идёт минутами, и всплывшая на три секунды
    // плашка легко проходит мимо глаз. После такой операции партнёр должен
    // увидеть, что именно вернулось, и осознанно вернуться к работе.
    restoreResult.value = data?.restored ?? {}
    restoreSkipped.value = data?.skipped ?? {}
    restoreDone.value = true
    restoreFile.value = null
    restorePreview.value = null
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось восстановить')
  } finally {
    restoring.value = false
    progress.stop()
  }
}

// ── Восстановление прямо из копии ──
// Раньше путь был один: скачать файл, потом загрузить его обратно. Файл уже
// лежит у нас, поэтому браузеру достаточно сказать «эту».
const restoringFromId = ref<string | null>(null)
/** Копия, для которой показан предпросмотр: что вернётся и можно ли вообще. */
const restoreCopy = ref<BackupFile | null>(null)
const restoreCopyPreview = ref<RestorePreview | null>(null)

async function restoreFromCopy(f: BackupFile) {
  if (restoringFromId.value) return
  restoringFromId.value = f.id
  try {
    // Сначала предпросмотр — тот же шаг, что и при загрузке файла руками:
    // восстановление необратимо, и сначала надо увидеть, во что оно превратит
    // кабинет.
    restoreCopyPreview.value = await api.post<RestorePreview>(`/backups/${f.id}/restore/preview`, {})
    restoreCopy.value = f
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось прочитать копию')
  } finally {
    restoringFromId.value = null
  }
}

/** Подтвердили в окне — запускаем. Дальше показывается общий итог. */
async function confirmRestoreFromCopy() {
  const f = restoreCopy.value
  if (!f || !restoreCopyPreview.value?.canRestore || restoring.value) return
  restoring.value = true
  progress.start()
  try {
    const data = await api.post<{ restored: Record<string, number>; skipped: Record<string, number> }>(
      `/backups/${f.id}/restore`,
      {},
    )
    restoreResult.value = data?.restored ?? {}
    restoreSkipped.value = data?.skipped ?? {}
    restoreCopy.value = null
    restoreCopyPreview.value = null
    restoreDone.value = true
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось восстановить')
  } finally {
    restoring.value = false
    progress.stop()
  }
}

// ── Итог восстановления ──
// Показываем окном, а не тостом: операция необратимая и долгая.
const restoreDone = ref(false)
const restoreResult = ref<Record<string, number>>({})
const restoreSkipped = ref<Record<string, number>>({})

/** Крупные разделы — в том же порядке, что и в предпросмотре файла. */
const RESTORE_SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'deal', label: 'Сделки' },
  { key: 'payment', label: 'Платежи' },
  { key: 'clientProfile', label: 'Клиенты' },
  { key: 'cashFlowEntry', label: 'Записи журнала кассы' },
  { key: 'account', label: 'Счета' },
]

const restoredRows = computed(() =>
  RESTORE_SECTIONS.map((s) => ({ ...s, value: restoreResult.value[s.key] ?? 0 })).filter(
    (r) => r.value > 0,
  ),
)

/** Всего строк — включая справочники, которые отдельной строкой не показываем. */
const restoredTotal = computed(() =>
  Object.values(restoreResult.value).reduce((sum, n) => sum + n, 0),
)

/**
 * Сколько записей копия не отдала.
 *
 * Обычно ноль. Если не ноль — это не ошибка восстановления, но партнёр должен
 * знать: часть данных в файле оказалась несовместимой с текущей версией.
 */
const restoredSkippedTotal = computed(() =>
  Object.values(restoreSkipped.value).reduce((sum, n) => sum + n, 0),
)

/** Кабинет перечитывает всё с нуля: половина разделов уже в памяти браузера. */
function finishRestore() {
  window.location.reload()
}

/**
 * Отправить выбранную копию на почту прямо сейчас.
 *
 * В письме ссылка, а не файл: таблица с паспортными данными клиентов не должна
 * лежать вложением в почте, откуда её открывает любой, кому письмо переслали.
 */
const emailingId = ref<string | null>(null)
async function emailBackup(f: BackupFile) {
  if (emailingId.value) return
  emailingId.value = f.id
  try {
    const res = await api.post<{ email: string }>(`/backups/${f.id}/email`, {})
    toast.success(`Письмо со ссылкой на копию отправлено на ${res.email}`)
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отправить письмо')
  } finally {
    emailingId.value = null
  }
}

/** Удалить копию: неудачные и лишние накапливаются, место не бесконечно. */
async function removeBackup(f: BackupFile) {
  const when = whenLabel(f.createdAt)
  if (!confirm(`Удалить копию от ${when}? Файлы будут стёрты безвозвратно.`)) return
  try {
    await api.delete(`/backups/${f.id}`)
    files.value = files.value.filter((x) => x.id !== f.id)
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось удалить копию')
  }
}

/**
 * Имя файла восстановления рядом с таблицей.
 *
 * Сервер отдаёт только имя xlsx, а в списке нужны оба имени: партнёр ищет
 * скачанный файл у себя на диске по названию, а не по строке «копия от».
 */
function fullName(f: BackupFile): string {
  return f.fileName.replace(/\.xlsx$/, '.mzbackup')
}

function sizeLabel(bytes: number): string {
  if (!bytes) return '—'
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function whenLabel(iso: string): string {
  const d = new Date(iso)
  return `${formatDate(iso)}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}

function toggleWeekday(day: number) {
  if (!schedule.value) return
  const set = new Set(schedule.value.weekdays)
  if (set.has(day)) set.delete(day)
  else set.add(day)
  // Пустой список означал бы расписание, которое не срабатывает никогда.
  schedule.value.weekdays = set.size ? [...set].sort() : [day]
}
</script>

<template>
  <div v-if="!loading && schedule" class="bk">
    <div v-if="props.view === 'files'" class="bk-note">
      <v-icon icon="mdi-information-outline" size="16" />
      <span>
        В каждой копии два файла. <b>Таблица Excel</b> — чтобы смотреть и проверять данные
        глазами. <b>Файл восстановления</b> — чтобы вернуть работу целиком: сделки, графики
        платежей, клиентов, счета и журнал кассы со всеми связями.
      </span>
    </div>

    <!-- Тариф без выгрузки: настраивать нечего, и тумблер, который сервер всё
         равно отклонит, только вводит в заблуждение. -->
    <div v-if="!schedule.available" class="bk-locked">
      <v-icon icon="mdi-crown" size="16" color="#e8b931" />
      <span>Резервные копии доступны с плана Бизнес</span>
    </div>

    <template v-else-if="props.view === 'settings' && canManage">
      <!-- Переключатель цельной плашкой: подпись и сам флажок рядом, а не по
           разным краям строки — иначе непонятно, к чему относится галочка. -->
      <label class="bk-toggle" :class="{ 'bk-toggle--on': schedule.enabled }">
        <input v-model="schedule.enabled" type="checkbox" />
        <span class="bk-toggle-box">
          <v-icon v-if="schedule.enabled" icon="mdi-check" size="15" />
        </span>
        <span class="bk-toggle-text">
          <span class="bk-toggle-title">Собирать копии автоматически</span>
          <span class="bk-toggle-hint">
            {{ schedule.enabled
              ? `Копии собираются сами, по вашему времени (${schedule.timezone})`
              : 'Сейчас копии создаются только вручную' }}
          </span>
        </span>
      </label>

      <!-- Параметры внутри рамки и с отступом: видно, что они относятся к
           переключателю выше, а не живут сами по себе. -->
      <div v-if="schedule.enabled" class="bk-nested">
        <div class="bk-row bk-row--first">
          <div class="bk-row-body">
            <div class="bk-row-title">Как часто</div>
          </div>
          <div class="bk-freq">
            <button
              v-for="f in [
                { v: 'WEEKLY', label: 'Раз в неделю' },
                { v: 'DAILY', label: 'Каждый день' },
                { v: 'EVERY_N_HOURS', label: 'Несколько раз в день' },
              ]"
              :key="f.v"
              class="bk-chip"
              :class="{ 'bk-chip--on': schedule.frequency === f.v }"
              @click="schedule.frequency = f.v as Frequency"
            >
              {{ f.label }}
            </button>
          </div>
        </div>

        <div v-if="schedule.frequency === 'EVERY_N_HOURS'" class="bk-row">
          <div class="bk-row-body">
            <div class="bk-row-title">Раз во сколько часов</div>
            <div class="bk-row-hint">На вашем тарифе — не чаще, чем раз в {{ schedule.minHours }} ч</div>
          </div>
          <input
            v-model.number="schedule.everyNHours"
            type="number"
            :min="schedule.minHours"
            max="24"
            class="bk-input bk-input--num"
          />
        </div>

        <div v-else class="bk-row">
          <div class="bk-row-body">
            <div class="bk-row-title">Во сколько</div>
          </div>
          <input v-model="schedule.timeOfDay" type="time" class="bk-input bk-input--num" />
        </div>

        <div v-if="schedule.frequency === 'WEEKLY'" class="bk-row">
          <div class="bk-row-body">
            <div class="bk-row-title">В какие дни</div>
          </div>
          <div class="bk-freq">
            <button
              v-for="d in WEEKDAYS"
              :key="d.value"
              class="bk-chip bk-chip--day"
              :class="{ 'bk-chip--on': schedule.weekdays.includes(d.value) }"
              @click="toggleWeekday(d.value)"
            >
              {{ d.label }}
            </button>
          </div>
        </div>

        <!-- Письмо — часть того же расписания, поэтому внутри той же рамки.
             Адрес показан прямо здесь: иначе приходится вспоминать, какую
             почту указывал в профиле. -->
        <label
          v-if="schedule.frequency !== 'EVERY_N_HOURS'"
          class="bk-toggle bk-toggle--inner"
          :class="{
            'bk-toggle--on': schedule.emailOnCreate && !!schedule.email,
            'bk-toggle--off': !schedule.email,
          }"
        >
          <input
            v-model="schedule.emailOnCreate"
            type="checkbox"
            :disabled="!schedule.email"
          />
          <span class="bk-toggle-box">
            <v-icon v-if="schedule.emailOnCreate && schedule.email" icon="mdi-check" size="15" />
          </span>
          <span class="bk-toggle-text">
            <span class="bk-toggle-title">Присылать ссылку на почту</span>
            <span class="bk-toggle-hint">
              <template v-if="schedule.email">
                Письмо со ссылкой уйдёт на <b>{{ schedule.email }}</b>. Файлы вложением не
                отправляются — они слишком большие; ссылка открывается после входа.
              </template>
              <template v-else>
                В профиле не указана почта — укажите её в настройках, и письма начнут
                приходить.
              </template>
            </span>
          </span>
        </label>

        <div v-if="schedule.frequency === 'EVERY_N_HOURS'" class="bk-hint-row">
          <v-icon icon="mdi-email-off-outline" size="14" />
          При копиях несколько раз в день письма не отправляются — иначе почта
          заполнится ими за неделю.
        </div>

        <div class="bk-hint-row">
          <v-icon icon="mdi-information-outline" size="14" />
          Если с прошлой копии данные не менялись, новая не создаётся — одинаковые
          файлы не копятся.
        </div>
      </div>

      <div class="bk-actions">
        <button class="bk-btn" :disabled="saving" @click="save">
          {{ saving ? 'Сохранение…' : 'Сохранить расписание' }}
        </button>
      </div>
    </template>

    <!-- Список копий -->
    <div v-if="props.view === 'files'" class="bk-files">
      <div class="bk-files-head">
        <span class="bk-files-title">Готовые копии</span>
        <!-- Сколько занято и сколько осталось: копия крупного партнёра весит
             десятки мегабайт, и потолок лучше видеть заранее, а не узнавать
             о нём в момент, когда старая копия исчезла. -->
        <span v-if="usage" class="bk-usage">
          {{ usage.files }} из {{ usage.limit }} · {{ sizeLabel(usage.bytes) }}
        </span>
        <template v-if="canManage && schedule.available">
          <button class="bk-btn" :disabled="running || pending" @click="runNow">
            <v-icon icon="mdi-plus" size="17" />
            {{ pending ? 'Копия готовится…' : 'Создать копию' }}
          </button>
        </template>
      </div>

      <!-- Сборка идёт в фоне: полоса — единственный признак, что работа
           началась и сколько ещё осталось. -->
      <div
        v-if="progress.active.value && progress.stages.value === 1 && !restoring"
        class="bk-progress bk-progress--card"
      >
        <div class="bk-progress-head">
          <span>{{ progress.phase.value || 'Готовим копию…' }}</span>
          <span class="bk-progress-pct">{{ progress.percent.value }} %</span>
        </div>
        <div class="bk-progress-bar">
          <div class="bk-progress-fill" :style="{ width: progress.percent.value + '%' }" />
        </div>
      </div>

      <div v-if="usage && usage.files >= usage.limit" class="bk-limit-note">
        <v-icon icon="mdi-information-outline" size="14" />
        Хранится последние {{ usage.limit }} копий — при создании новой самая старая
        удаляется автоматически.
      </div>

      <div v-if="!files.length" class="bk-empty">
        Копий пока нет. Включите расписание или создайте копию вручную.
      </div>

      <!-- Таблица, а не карточки: партнёр приходит сюда за файлом, и список
           должен читаться как папка на диске — имя файла, тип, размер, дата. -->
      <div v-else class="bk-table">
        <div class="bk-thead">
          <span class="bk-th">Копия</span>
          <span class="bk-th">Таблица</span>
          <span class="bk-th">Файл для восстановления</span>
          <span class="bk-th bk-th--right">Хранится до</span>
          <span class="bk-th" />
        </div>

        <div
          v-for="f in files"
          :key="f.id"
          class="bk-tr"
          :class="{ 'bk-tr--bad': f.status === 'FAILED', 'bk-tr--wait': f.status === 'PENDING' }"
        >
          <div class="bk-td bk-td--when">
            <span class="bk-when-ico">
              <v-icon
                :icon="f.status === 'READY' ? 'mdi-folder-zip-outline' : f.status === 'PENDING' ? 'mdi-progress-clock' : 'mdi-alert-circle-outline'"
                size="18"
              />
            </span>
            <span class="bk-when-body">
              <span class="bk-when-title">{{ whenLabel(f.createdAt) }}</span>
              <span class="bk-when-sub">
                {{ f.trigger === 'MANUAL' ? 'вручную' : 'по расписанию' }}
                <template v-if="f.status === 'READY'"> · {{ f.dealsCount }} сделок</template>
                <template v-if="f.downloadedAt"> · уже скачивали</template>
              </span>
            </span>
          </div>

          <!-- Каждый файл в своей колонке: таблица к таблице, файл
               восстановления к файлу восстановления — колонки сравниваются
               взглядом сверху вниз, как в списке файлов. -->
          <template v-if="f.status === 'READY'">
            <div class="bk-td bk-td--file">
              <!-- Строка файла целиком кликабельна: маленькая кнопка «скачать»
                   сбоку заставляла целиться, хотя вся строка и есть файл. -->
              <button
                class="bk-fileline"
                :disabled="!canDownload"
                :title="canDownload ? 'Скачать ' + f.fileName : 'Нет доступа к скачиванию'"
                @click="download(f)"
              >
                <span class="bk-fileline-ico bk-fileline-ico--xls">XLSX</span>
                <span class="bk-fileline-body">
                  <span class="bk-fileline-name">
                    Таблица <span class="bk-fileline-size">{{ sizeLabel(f.sizeBytes) }}</span>
                  </span>
                  <span class="bk-fileline-meta">{{ f.fileName }}</span>
                </span>
                <v-icon class="bk-fileline-dl" icon="mdi-tray-arrow-down" size="17" />
                <!-- Отправка на почту — второй иконкой в той же строке: копий
                     несколько, и уходить должна та, которую выбрали. Клик по
                     ней не должен запускать скачивание, поэтому .stop. -->
                <span
                  class="bk-fileline-dl bk-fileline-mail"
                  :class="{ 'bk-fileline-mail--busy': emailingId === f.id }"
                  title="Отправить эту копию на почту аккаунта"
                  @click.stop="emailBackup(f)"
                >
                  <v-progress-circular v-if="emailingId === f.id" indeterminate size="14" width="2" />
                  <v-icon v-else icon="mdi-email-arrow-right-outline" size="17" />
                </span>
              </button>
            </div>

            <div class="bk-td bk-td--file">
              <button
                v-if="f.dumpSizeBytes"
                class="bk-fileline"
                :disabled="!canDownload"
                :title="canDownload ? 'Скачать ' + fullName(f) : 'Нет доступа к скачиванию'"
                @click="downloadFull(f)"
              >
                <span class="bk-fileline-ico bk-fileline-ico--dump">MZB</span>
                <span class="bk-fileline-body">
                  <span class="bk-fileline-name">
                    Файл восстановления <span class="bk-fileline-size">{{ sizeLabel(f.dumpSizeBytes) }}</span>
                  </span>
                  <span class="bk-fileline-meta">{{ fullName(f) }}</span>
                </span>
                <v-icon class="bk-fileline-dl" icon="mdi-tray-arrow-down" size="17" />
                <!-- Восстановление прямо отсюда: файл уже лежит у нас, и
                     возить его через браузер туда-обратно незачем. Доступно
                     только владельцу — операция переписывает весь кабинет. -->
                <span
                  v-if="canManage"
                  class="bk-fileline-dl bk-fileline-restore"
                  :class="{ 'bk-fileline-restore--busy': restoringFromId === f.id }"
                  title="Восстановить данные из этой копии"
                  @click.stop="restoreFromCopy(f)"
                >
                  <v-progress-circular v-if="restoringFromId === f.id" indeterminate size="14" width="2" />
                  <v-icon v-else icon="mdi-backup-restore" size="17" />
                </span>
              </button>

              <!-- Копии, снятые до появления восстановления, содержат только
                   таблицу: молчать об этом нельзя — партнёр будет искать файл. -->
              <span v-else class="bk-fileline bk-fileline--absent">
                <span class="bk-fileline-ico bk-fileline-ico--none">—</span>
                <span class="bk-fileline-body">
                  <span class="bk-fileline-name">Файла нет</span>
                  <span class="bk-fileline-meta">копия старого формата</span>
                </span>
              </span>
            </div>
          </template>

          <div v-else class="bk-td bk-td--state">
            <span v-if="f.status === 'PENDING'" class="bk-state">
              <v-icon icon="mdi-progress-clock" size="15" /> Файлы готовятся…
            </span>
            <span v-else class="bk-state bk-state--bad">
              <v-icon icon="mdi-alert-circle-outline" size="15" />
              {{ f.error || 'Не удалось собрать копию' }}
            </span>
          </div>

          <div class="bk-td bk-td--keep">
            <span v-if="f.status === 'READY'" class="bk-keep">{{ formatDate(f.expiresAt) }}</span>
          </div>

          <div class="bk-td bk-td--act">
            <button
              v-if="canManage && f.status !== 'PENDING'"
              class="bk-file-del"
              title="Удалить копию"
              @click="removeBackup(f)"
            >
              <v-icon icon="mdi-close" size="16" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Восстановление: отдельным блоком внизу и только для владельца —
         действие определяет содержимое всего кабинета. -->
    <div v-if="props.view === 'files' && canManage" class="bk-restore">
      <div class="bk-files-title">Восстановление из копии</div>
      <div class="bk-restore-hint">
        Загрузите файл восстановления (.mzbackup) — данные вернутся такими, какими были на
        момент копии. Восстановить можно только в пустой аккаунт: иначе сделки и платежи
        задвоятся.
      </div>

      <label class="bk-restore-pick">
        <input type="file" accept=".mzbackup,application/gzip" @change="pickRestoreFile" />
        <v-icon icon="mdi-file-upload-outline" size="18" />
        <span>{{ restoreFile ? restoreFile.name : 'Выбрать файл копии' }}</span>
      </label>

      <div v-if="restorePreview" class="bk-restore-preview">
        <div class="bk-restore-preview-title">
          Копия от {{ whenLabel(restorePreview.meta.createdAt) }}
        </div>
        <div v-if="restoreRows.length" class="bk-restore-list">
          <span v-for="r in restoreRows" :key="r.label" class="bk-restore-item">
            {{ r.label }}: <b>{{ r.value.toLocaleString('ru-RU') }}</b>
          </span>
        </div>

        <div v-if="!restorePreview.canRestore" class="bk-restore-blocked">
          <v-icon icon="mdi-alert-outline" size="16" />
          <span>{{ restorePreview.blockedReason }}</span>
        </div>
        <button v-else class="bk-btn" :disabled="restoring" @click="runRestore">
          {{ restoring ? 'Восстанавливаю…' : 'Восстановить данные' }}
        </button>

        <!-- Ход восстановления: крупная копия разворачивается минутами, и без
             полосы окно выглядит зависшим. Проценты честные — сервер считает их
             от того же числа записей, что показано выше. -->
        <div v-if="restoring" class="bk-progress">
          <div class="bk-progress-head">
            <span>{{ progress.phase.value || 'Начинаем…' }}</span>
            <span class="bk-progress-pct">{{ progress.percent.value }} %</span>
          </div>
          <div class="bk-progress-bar">
            <div class="bk-progress-fill" :style="{ width: progress.percent.value + '%' }" />
          </div>
          <div class="bk-progress-note">
            <template v-if="progress.total.value">
                {{ progress.done.value.toLocaleString('ru-RU') }} из
                {{ progress.total.value.toLocaleString('ru-RU') }} записей ·
            </template>
            не закрывайте вкладку
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- Подтверждение восстановления из копии в списке. Тот же разговор, что и
       при загрузке файла: сначала показываем, что внутри и можно ли, и только
       потом кнопка. -->
  <v-dialog :model-value="!!restoreCopy" max-width="460" @update:model-value="v => { if (!v) restoreCopy = null }">
    <v-card v-if="restoreCopy" rounded="lg" class="bk-confirm">
      <div class="bk-confirm-title">Восстановить из этой копии?</div>
      <div class="bk-confirm-sub">
        Копия от {{ whenLabel(restoreCopy.createdAt) }}
      </div>

      <!-- Список показываем, только когда в копии есть что перечислить: у
           файлов старого формата счётчиков нет, и рамка оставалась пустой. -->
      <div v-if="previewRows(restoreCopyPreview).length" class="bk-done-list">
        <div v-for="r in previewRows(restoreCopyPreview)" :key="r.label" class="bk-done-row">
          <span>{{ r.label }}</span>
          <b>{{ r.value.toLocaleString('ru-RU') }}</b>
        </div>
      </div>

      <div v-if="restoreCopyPreview && !restoreCopyPreview.canRestore" class="bk-done-warn">
        <v-icon icon="mdi-alert-outline" size="16" />
        <span>{{ restoreCopyPreview.blockedReason }}</span>
      </div>
      <div v-else class="bk-confirm-note">
        Данные из копии загрузятся целиком. Отменить восстановление нельзя.
      </div>

      <!-- Ход восстановления: крупная копия разворачивается минутами, и без
           полосы окно выглядит зависшим. Проценты честные — сервер считает их
           от того же числа записей, что показано выше. -->
      <div v-if="restoring" class="bk-progress">
        <div class="bk-progress-head">
          <span>
            <span v-if="progress.stages.value > 1" class="bk-progress-stage">
              Шаг {{ progress.stage.value }} из {{ progress.stages.value }} ·
            </span>
            {{ progress.phase.value || 'Начинаем…' }}
          </span>
          <span class="bk-progress-pct">{{ progress.percent.value }} %</span>
        </div>
        <div class="bk-progress-bar">
          <div class="bk-progress-fill" :style="{ width: progress.percent.value + '%' }" />
        </div>
        <div class="bk-progress-note">
          <!-- Записи считаем только на том этапе, где идут записи: чтение
               файла измеряется шагами. -->
          <template v-if="progress.unit.value === 'rows' && progress.total.value">
            {{ progress.done.value.toLocaleString('ru-RU') }} из
            {{ progress.total.value.toLocaleString('ru-RU') }} записей ·
          </template>
          не закрывайте вкладку
        </div>
      </div>

      <div class="bk-confirm-actions">
        <button class="bk-btn bk-btn--ghost" :disabled="restoring" @click="restoreCopy = null">Отмена</button>
        <button
          v-if="restoreCopyPreview?.canRestore"
          class="bk-btn"
          :disabled="restoring"
          @click="confirmRestoreFromCopy"
        >
          {{ restoring ? 'Восстанавливаю…' : 'Восстановить' }}
        </button>
      </div>
    </v-card>
  </v-dialog>

  <!-- Итог восстановления. Закрыть мимо нельзя: единственный выход отсюда —
       перезагрузить кабинет, иначе половина разделов останется со старыми
       (пустыми) данными в памяти браузера. -->
  <v-dialog v-model="restoreDone" max-width="460" persistent>
    <v-card rounded="lg" class="bk-done">
      <div class="bk-done-icon">
        <v-icon icon="mdi-check" size="30" />
      </div>
      <div class="bk-done-title">Данные восстановлены</div>
      <div class="bk-done-sub">
        Из копии вернулось {{ restoredTotal.toLocaleString('ru-RU') }}
        {{ restoredTotal === 1 ? 'запись' : restoredTotal % 10 >= 2 && restoredTotal % 10 <= 4 && (restoredTotal % 100 < 10 || restoredTotal % 100 >= 20) ? 'записи' : 'записей' }}.
      </div>

      <div v-if="restoredRows.length" class="bk-done-list">
        <div v-for="r in restoredRows" :key="r.key" class="bk-done-row">
          <span>{{ r.label }}</span>
          <b>{{ r.value.toLocaleString('ru-RU') }}</b>
        </div>
      </div>

      <div v-if="restoredSkippedTotal" class="bk-done-warn">
        <v-icon icon="mdi-alert-outline" size="16" />
        <span>
          {{ restoredSkippedTotal.toLocaleString('ru-RU') }} записей файл не отдал —
          напишите нам, посмотрим, что это было.
        </span>
      </div>

      <button class="bk-btn bk-done-btn" @click="finishRestore">Начать работу</button>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.bk { display: flex; flex-direction: column; gap: 12px; }

.bk-note {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 12.5px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.bk-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 0;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.bk-row--switch { cursor: pointer; }
.bk-row-body { flex: 1; min-width: 0; }
.bk-row-title { font-size: 14px; font-weight: 600; }
.bk-row-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }

.bk-switch { width: 20px; height: 20px; accent-color: #047857; cursor: pointer; }

.bk-freq { display: flex; gap: 6px; flex-wrap: wrap; }
.bk-chip {
  padding: 6px 12px; border-radius: 9px; border: none; cursor: pointer;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.65);
}
.bk-chip--day { padding: 6px 10px; }
.bk-chip--on { background: #047857; color: #fff; font-weight: 600; }

.bk-input {
  height: 38px; padding: 0 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9); outline: none;
}
.bk-input--num { width: 120px; text-align: center; }
.bk-input:focus { border-color: #047857; }

.bk-actions { display: flex; gap: 8px; justify-content: flex-end; padding-top: 4px; }
.bk-btn {
  display: flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 16px; border: none; border-radius: 10px;
  background: #047857; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
}
.bk-btn:disabled { opacity: 0.55; cursor: default; }
.bk-btn--ghost {
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.7);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.bk-locked {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(232, 185, 49, 0.1);
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7);
}

/* Переключатель-плашка: попадание по всей строке, состояние видно по рамке. */
.bk-toggle {
  display: flex; align-items: center; gap: 11px;
  padding: 12px 14px; border-radius: 12px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  transition: border-color 0.15s, background-color 0.15s;
}
.bk-toggle:hover { border-color: rgba(var(--v-theme-on-surface), 0.22); }
.bk-toggle--on { border-color: rgba(4, 120, 87, 0.45); background: rgba(4, 120, 87, 0.05); }
.bk-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.bk-toggle-box {
  width: 22px; height: 22px; flex: none; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.25);
  color: #fff;
}
.bk-toggle--on .bk-toggle-box { background: #047857; border-color: #047857; }
.bk-toggle-text { display: flex; flex-direction: column; }
.bk-toggle-title { font-size: 14px; font-weight: 600; }
.bk-toggle-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }

/* Параметры расписания — вложенным блоком под переключателем: рамка и отступ
   показывают подчинение, а не соседство. */
.bk-nested {
  margin: -4px 0 0 15px;
  padding: 2px 14px 12px;
  border-left: 2px solid rgba(4, 120, 87, 0.25);
}
.bk-row--first { border-top: none; }
.bk-toggle--inner { margin-top: 10px; }
.bk-toggle--off { opacity: 0.75; cursor: default; }
.bk-toggle-hint b { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.75); }
.bk-hint-row {
  display: flex; align-items: flex-start; gap: 6px;
  margin-top: 12px; padding-left: 2px;
  font-size: 12px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.bk-file-del {
  width: 28px; height: 28px; flex: none; border: none; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.35); cursor: pointer;
}
.bk-file-del:hover { background: rgba(239, 68, 68, 0.1); color: #dc2626; }

.bk-files { margin-top: 6px; }
/* Шапка списка: заголовок слева, действия справа — кнопки живут рядом с тем,
   к чему относятся, а не отдельной полосой над всем разделом. */
.bk-files-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 10px;
}
.bk-files-head .bk-btn { height: 34px; }
.bk-files-head .bk-btn:first-of-type { margin-left: auto; }
.bk-usage {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-variant-numeric: tabular-nums;
}
.bk-files-title {
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.bk-limit-note {
  display: flex; align-items: flex-start; gap: 6px;
  margin-bottom: 8px; font-size: 12px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.bk-empty { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); padding: 8px 0; }

/* ── Таблица копий ───────────────────────────────────────────────────────
   Рамка, шапка со столбцами и разделители между строками: так список читается
   как перечень файлов, а не как лента карточек. */
.bk-table {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  overflow: hidden;
}
.bk-thead,
.bk-tr {
  display: grid;
  grid-template-columns: minmax(170px, 1fr) 280px 330px minmax(100px, 0.6fr) 34px;
  gap: 12px;
  align-items: center;
}
.bk-thead {
  padding: 8px 14px;
  background: rgba(var(--v-theme-on-surface), 0.035);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.bk-th {
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.bk-th--right { text-align: right; }

.bk-tr {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.bk-tr:last-child { border-bottom: none; }
.bk-tr:hover { background: rgba(var(--v-theme-on-surface), 0.02); }
.bk-tr--bad { background: rgba(220, 38, 38, 0.04); }
.bk-tr--wait { background: rgba(4, 120, 87, 0.03); }

.bk-td { min-width: 0; }
.bk-td--when { display: flex; align-items: center; gap: 10px; }
.bk-when-ico {
  width: 32px; height: 32px; flex: none; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.1); color: #047857;
}
.bk-tr--bad .bk-when-ico { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
.bk-when-body { display: flex; flex-direction: column; min-width: 0; }
.bk-when-title { font-size: 13.5px; font-weight: 600; }
.bk-when-sub { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); }

/* Файлы — по колонкам: у таблицы и файла восстановления одна ширина, и обе
   строки читаются сверху вниз столбиком, а не парами внутри строки. */
.bk-td--file { min-width: 0; }
.bk-td--file > .bk-fileline { width: 100%; }
/* Название файла не переносим: у слепка справа три действия, и перенос
   превращал одну строку в две. */
.bk-fileline-name { white-space: nowrap; }
/* Название файла не переносим: у слепка три действия справа, и перенос
   превращал одну строку в две. */
.bk-fileline-name { white-space: nowrap; }
.bk-td--state { grid-column: span 2; }

/* Восстановление — третье действие у файла слепка. */
.bk-fileline-restore {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
}
.bk-fileline-restore:hover { color: #b45309; }
.bk-fileline-restore--busy { color: #b45309; }

/* Отправка на почту стоит рядом со скачиванием — два действия одного файла. */
.bk-fileline-mail {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
}
.bk-fileline-mail:hover { color: #047857; }
.bk-fileline-mail--busy { color: #047857; }

/* Строка файла: значок формата, имя как на диске, назначение и размер. */
.bk-fileline {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 7px 10px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-surface), 1);
  text-align: left; cursor: pointer;
}
.bk-fileline:hover:not(:disabled) {
  border-color: rgba(4, 120, 87, 0.45);
  background: rgba(4, 120, 87, 0.05);
}
.bk-fileline:disabled { cursor: default; opacity: 0.6; }
.bk-fileline-ico {
  width: 34px; height: 26px; flex: none; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 9.5px; font-weight: 800; letter-spacing: 0.02em; color: #fff;
}
.bk-fileline-ico--xls { background: #047857; }
.bk-fileline-ico--dump { background: #0f766e; }
.bk-fileline-ico--none {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.bk-fileline-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.bk-fileline-name {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 12.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.88);
}
/* Размер — рядом с названием: он относится к файлу, а не к его имени. */
.bk-fileline-size {
  font-size: 11px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-variant-numeric: tabular-nums;
}
.bk-fileline-meta {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bk-fileline-dl { flex: none; color: rgba(var(--v-theme-on-surface), 0.35); }
.bk-fileline-body + .bk-fileline-dl { margin-right: 2px; }
.bk-fileline:hover:not(:disabled) .bk-fileline-dl { color: #047857; }
.bk-fileline--absent {
  cursor: default;
  border-style: dashed;
  background: transparent;
}
.bk-fileline--absent .bk-fileline-name { color: rgba(var(--v-theme-on-surface), 0.5); font-weight: 500; }

.bk-state {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55);
}
.bk-state--bad { color: #dc2626; }

.bk-td--keep {
  text-align: right;
  font-size: 12px; font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.bk-td--act { display: flex; justify-content: flex-end; }

/* Узкий экран: столбцы схлопываются в карточку, шапка теряет смысл. */
@media (max-width: 1080px) {
  .bk-thead { display: none; }
  .bk-tr {
    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: 8px;
  }
  .bk-td--when { grid-column: 1; }
  .bk-td--act { grid-column: 2; }
  .bk-td--file,
  .bk-td--state,
  .bk-td--keep { grid-column: 1 / -1; }
  .bk-td--keep { text-align: left; }
  .bk-td--keep .bk-keep::before { content: 'хранится до '; }
}

/* Полоса хода восстановления. */
/* Внутри окна полоса идёт следом за текстом — ей хватает воздуха сверху. */
.bk-progress { margin-top: 16px; }
/*
 * На странице копий она живёт между шапкой списка и таблицей, поэтому
 * оформлена плашкой: без неё строка липла к соседним блокам и читалась как
 * часть таблицы.
 */
.bk-progress--card {
  margin: 4px 0 14px;
  padding: 12px 14px;
  border: 1px solid rgba(4, 120, 87, 0.2);
  border-radius: 12px;
  background: rgba(4, 120, 87, 0.04);
}
.bk-progress-head {
  display: flex; align-items: baseline; justify-content: space-between;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7);
}
.bk-progress-pct { font-weight: 700; font-variant-numeric: tabular-nums; }
.bk-progress-stage { color: rgba(var(--v-theme-on-surface), 0.45); }
.bk-progress-bar {
  margin-top: 6px; height: 6px; border-radius: 4px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.bk-progress-fill {
  height: 100%; border-radius: 4px; background: #047857;
  transition: width 0.4s ease;
}
.bk-progress-note {
  margin-top: 6px; font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-variant-numeric: tabular-nums;
}

/* ── Окно подтверждения восстановления из копии ── */
.bk-confirm { padding: 22px 22px 18px; }
.bk-confirm-title { font-size: 17px; font-weight: 700; }
.bk-confirm-sub {
  margin-top: 3px; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.bk-confirm-note {
  margin-top: 12px; font-size: 12.5px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.bk-confirm-actions {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px;
}

/* ── Окно «данные восстановлены» ── */
.bk-done { padding: 26px 24px 22px; text-align: center; }
.bk-done-icon {
  width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.1); color: #047857;
}
.bk-done-title { font-size: 18px; font-weight: 700; }
.bk-done-sub {
  margin-top: 5px; font-size: 13px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.bk-done-list {
  margin: 16px 0 4px; padding: 10px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px; text-align: left;
}
.bk-done-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 0; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.bk-done-row:last-child { border-bottom: none; }
.bk-done-row b { color: rgba(var(--v-theme-on-surface), 0.9); font-variant-numeric: tabular-nums; }
.bk-done-warn {
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 12px; padding: 10px 12px; border-radius: 10px;
  background: rgba(245, 158, 11, 0.1); color: #b45309;
  font-size: 12.5px; line-height: 1.45; text-align: left;
}
.bk-done-btn { width: 100%; margin-top: 18px; justify-content: center; }

.bk-restore {
  margin-top: 18px; padding-top: 16px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.bk-restore-hint {
  font-size: 12.5px; line-height: 1.45; margin-bottom: 10px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.bk-restore-pick {
  display: inline-flex; align-items: center; gap: 8px;
  height: 38px; padding: 0 14px; border-radius: 10px; cursor: pointer;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7);
}
.bk-restore-pick input { display: none; }
.bk-restore-preview {
  margin-top: 12px; padding: 12px;
  border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.03);
}
.bk-restore-preview-title { font-size: 13.5px; font-weight: 600; }
.bk-restore-list {
  display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0 10px;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.bk-restore-blocked {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 12.5px; line-height: 1.45; color: #b45309;
}
</style>
