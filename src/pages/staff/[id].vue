<script setup lang="ts">
/**
 * Профиль сотрудника: что человек сделал за период.
 *
 * Цифры берутся из самих данных — кто отметил платёж, кто завёл сделку.
 * Из журнала действий приходит только то, чего в данных нет по сути: отмены,
 * удаления, распорядок дня. Журнал хранится 90 дней, и страница об этом
 * честно предупреждает, а не делает вид, что показывает всю историю.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { usePageHeaderStore } from '@/stores/pageHeader'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDate } from '@/utils/formatters'
import DateField from '@/components/DateField.vue'

interface Summary {
  staff: {
    id: string
    name: string
    email: string
    role: string
    roleName: string | null
    isActive: boolean
    since: string
    dealsAccessMode: string
    canCreateDeals: boolean
    hiddenCashBoxCount: number
  }
  period: { from: string; to: string }
  metrics: {
    money: { count: number; amount: number; overdueCount: number; overdueAmount: number }
    deals: {
      createdCount: number
      createdVolume: number
      assignedActive: number
      assignedRemaining: number
      assignedOverdueAmount: number
      assignedOverdueDeals: number
    }
    collections: {
      contacts: number
      promises: number
      promisesKept: number
      promisesBroken: number
      keptRate: number | null
    }
    attention: {
      paymentsUnmarked: number
      dealsDeleted: number
      forgiveCount: number
      forgiveAmount: number
      actionsTotal: number
    }
  }
  daily: Array<{ day: string; actions: number }>
  notes: { activityRetentionDays: number }
  attentionItems: Array<{ code: string; text: string }>
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const pageHeader = usePageHeaderStore()
const toast = useToast()

const staffId = computed(() => (route.params as { id: string }).id)
const data = ref<Summary | null>(null)
const loading = ref(false)
const tab = ref<'overview' | 'activity' | 'deals'>('overview')

const PRESETS = [
  { key: '30', label: '30 дней', days: 30 },
  { key: '90', label: '3 месяца', days: 90 },
  { key: '365', label: 'Год', days: 365 },
]
const preset = ref('30')

/**
 * Свой период.
 *
 * Готовые «30 дней / 3 месяца / год» закрывают девять случаев из десяти, но
 * когда партнёр разбирается с конкретным месяцем, ему нужны точные даты —
 * ровно как в «Бухгалтерии». Обе возможности живут в одной кнопке: отдельный
 * ряд мелких кнопок рядом с плашкой вкладок выглядел как чужой элемент.
 */
const periodOpen = ref(false)
const customFrom = ref('')
const customTo = ref('')
const customLabel = ref('')

/** Подпись на кнопке: выбранный пресет либо «12 авг — 5 сен». */
const periodLabel = computed(() =>
  preset.value === 'custom'
    ? customLabel.value
    : (PRESETS.find((p) => p.key === preset.value)?.label ?? '30 дней'),
)

/** Сколько дней охватывает выбранное — по нему предупреждаем о чистке журнала. */
const periodDays = computed(() => {
  if (preset.value !== 'custom') {
    return PRESETS.find((p) => p.key === preset.value)?.days ?? 30
  }
  if (!customFrom.value) return 30
  const to = customTo.value ? new Date(customTo.value) : new Date()
  return Math.max(1, Math.round((to.getTime() - new Date(customFrom.value).getTime()) / 86400000))
})

/** За пределами 90 дней журнал уже вычищен — предупреждаем, а не молчим. */
const activityIncomplete = computed(
  () => !!data.value && periodDays.value > data.value.notes.activityRetentionDays,
)

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/** Применить свой период: без начальной даты показывать нечего. */
function applyCustom() {
  if (!customFrom.value) return
  preset.value = 'custom'
  customLabel.value = `${shortDate(customFrom.value)} — ${customTo.value ? shortDate(customTo.value) : 'сегодня'}`
  periodOpen.value = false
  void load()
}

async function load() {
  loading.value = true
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'
    let from: string
    let to = ''
    if (preset.value === 'custom' && customFrom.value) {
      from = new Date(customFrom.value).toISOString()
      // Конец дня: иначе платежи самой последней даты в период не попадут.
      if (customTo.value) to = new Date(`${customTo.value}T23:59:59`).toISOString()
    } else {
      const days = PRESETS.find((p) => p.key === preset.value)?.days ?? 30
      from = new Date(Date.now() - days * 86400000).toISOString()
    }
    data.value = await api.get<Summary>(
      `/staff-profile/${staffId.value}/summary?from=${from}` +
        (to ? `&to=${to}` : '') +
        `&tz=${encodeURIComponent(tz)}`,
    )
    pageHeader.set(data.value.staff.name, 'Профиль сотрудника')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить профиль')
    router.push('/staff')
  } finally {
    loading.value = false
  }
}
onMounted(load)

function setPreset(key: string) {
  preset.value = key
  periodOpen.value = false
  load()
}

const maxDaily = computed(() => Math.max(1, ...(data.value?.daily ?? []).map((d) => d.actions)))
const dailyTotal = computed(() => (data.value?.daily ?? []).reduce((s2, d) => s2 + d.actions, 0))

/** Цвет роли — тот же, что в списке сотрудников: человек узнаётся по нему. */
const ROLE_COLORS: Record<string, string> = {
  MANAGER: '#3b82f6',
  OPERATOR: '#f59e0b',
  POINT_OPERATOR: '#7c3aed',
}
const roleColor = computed(() => ROLE_COLORS[data.value?.staff.role ?? ''] ?? '#047857')
const roleLabel = computed(() => {
  const st = data.value?.staff
  if (!st) return ''
  return (
    st.roleName ||
    (st.role === 'MANAGER' ? 'Менеджер' : st.role === 'POINT_OPERATOR' ? 'Оператор пункта' : 'Оператор')
  )
})
const initials = computed(() => {
  const parts = (data.value?.staff.name ?? '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—'
})

/**
 * За период не случилось ничего.
 *
 * Страница из одних нулей выглядит сломанной: непонятно, человек ничего не
 * делал или данные не приехали. Говорим об этом словами и предлагаем период
 * пошире, а не оставляем сетку пустых плиток.
 */
const nothingHappened = computed(() => {
  const m = data.value?.metrics
  if (!m) return false
  return (
    m.money.count === 0 &&
    m.deals.createdCount === 0 &&
    m.deals.assignedActive === 0 &&
    m.collections.contacts === 0 &&
    m.collections.promises === 0 &&
    m.attention.actionsTotal === 0
  )
})

// ── Активность ──
const activity = ref<any[]>([])
const activityLoading = ref(false)
async function loadActivity() {
  if (activity.value.length || activityLoading.value) return
  activityLoading.value = true
  try {
    const res = await api.get<any>(`/activity?actorId=${staffId.value}&limit=50`)
    activity.value = Array.isArray(res) ? res : (res.items ?? [])
  } catch {
    // лента не критична для страницы
  } finally {
    activityLoading.value = false
  }
}

// ── Сделки сотрудника ──
const deals = ref<any[]>([])
const dealsLoading = ref(false)
async function loadDeals() {
  if (deals.value.length || dealsLoading.value) return
  dealsLoading.value = true
  try {
    // Свой эндпоинт профиля, а не общий список сделок: тот принимает фильтр
    // «по сотруднику» только от владельца и сотруднику-наблюдателю вернул бы
    // все сделки партнёра под видом сделок этого человека.
    deals.value = await api.get<any[]>(`/staff-profile/${staffId.value}/deals?limit=50`)
  } catch {
    // список не критичен
  } finally {
    dealsLoading.value = false
  }
}

function openTab(t: 'overview' | 'activity' | 'deals') {
  tab.value = t
  if (t === 'activity') loadActivity()
  if (t === 'deals') loadDeals()
}

/** «в 12 сделках», «в 1 сделке» — иначе получается «сделк(ах)». */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = n % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

function timeLabel(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}
</script>

<template>
  <div class="sp-page">
    <button class="back-btn" @click="router.push('/staff')">
      <v-icon icon="mdi-arrow-left" size="18" />
      Все сотрудники
    </button>

    <v-progress-linear v-if="loading && !data" indeterminate color="primary" class="mb-3" />

    <template v-if="data">
      <!-- Шапка: кто это, что ему доступно и что с ним можно сделать. -->
      <div class="sp-hero">
        <div class="sp-hero-ava" :style="{ background: roleColor + '18', color: roleColor }">{{ initials }}</div>
        <div class="sp-hero-main">
          <div class="sp-hero-name">
            {{ data.staff.name }}
            <span class="sp-role-tag" :style="{ background: roleColor + '14', color: roleColor }">{{ roleLabel }}</span>
            <span v-if="!data.staff.isActive" class="sp-off">отключён</span>
          </div>
          <div class="sp-hero-sub">
            {{ data.staff.email }} · в команде с {{ formatDate(data.staff.since) }}
          </div>
          <!-- Доступ читается сразу: за этим на профиль и заходят. -->
          <div class="sp-hero-facts">
            <span class="sp-fact">
              <v-icon icon="mdi-briefcase-outline" size="13" />
              {{ data.staff.dealsAccessMode === 'ASSIGNED_ONLY' ? 'Только назначенные сделки' : 'Все сделки' }}
            </span>
            <span class="sp-fact">
              <v-icon :icon="data.staff.canCreateDeals ? 'mdi-plus-circle-outline' : 'mdi-minus-circle-outline'" size="13" />
              {{ data.staff.canCreateDeals ? 'Может создавать сделки' : 'Без создания сделок' }}
            </span>
            <span v-if="data.staff.hiddenCashBoxCount > 0" class="sp-fact">
              <v-icon icon="mdi-eye-off-outline" size="13" />
              {{ data.staff.hiddenCashBoxCount }}
              {{ plural(data.staff.hiddenCashBoxCount, 'касса скрыта', 'кассы скрыты', 'касс скрыто') }}
            </span>
          </div>
        </div>
        <div class="sp-hero-acts">
          <button class="sp-btn" @click="router.push(`/staff?staff=${data.staff.id}`)">
            <v-icon icon="mdi-message-text-outline" size="15" />
            Написать
          </button>
        </div>
      </div>

      <!-- Обратите внимание: нейтрально, без обвинений -->
      <div v-if="data.attentionItems.length" class="sp-attention">
        <div class="sp-attention-title">
          <v-icon icon="mdi-eye-outline" size="16" />
          Обратите внимание
        </div>
        <div v-for="a in data.attentionItems" :key="a.code" class="sp-attention-line">{{ a.text }}</div>
      </div>

      <!-- Вкладки и период в одной строке: период относится ко всем вкладкам. -->
      <div class="page-tabs-row">
        <div class="page-tabs">
          <button class="page-tab" :class="{ active: tab === 'overview' }" @click="openTab('overview')">
            Обзор
          </button>
          <button class="page-tab" :class="{ active: tab === 'activity' }" @click="openTab('activity')">
            Активность
          </button>
          <button class="page-tab" :class="{ active: tab === 'deals' }" @click="openTab('deals')">
            Сделки
            <span v-if="data.metrics.deals.assignedActive" class="page-tab-count">
              {{ data.metrics.deals.assignedActive }}
            </span>
          </button>
        </div>
        <div class="page-tabs-actions">
          <!-- Период одной кнопкой, как «Свой период» в «Бухгалтерии»: ряд
               мелких кнопок рядом с высокой плашкой вкладок смотрелся чужим. -->
          <v-menu v-model="periodOpen" :close-on-content-click="false" location="bottom end" offset="6">
            <template #activator="{ props: menuProps }">
              <button v-bind="menuProps" class="sp-period-btn" type="button">
                <v-icon icon="mdi-calendar-range" size="16" />
                <span class="sp-period-btn-label">{{ periodLabel }}</span>
                <v-icon icon="mdi-chevron-down" size="15" class="sp-period-btn-caret" />
              </button>
            </template>

            <div class="sp-period-menu">
              <div class="sp-period-menu-head">Период</div>
              <button
                v-for="p in PRESETS"
                :key="p.key"
                class="sp-period-item"
                :class="{ 'sp-period-item--on': preset === p.key }"
                @click="setPreset(p.key)"
              >
                <v-icon icon="mdi-calendar-blank-outline" size="16" />
                <span>{{ p.label }}</span>
                <v-icon v-if="preset === p.key" icon="mdi-check" size="15" class="sp-period-check" />
              </button>

              <div class="sp-period-sep" />

              <div class="sp-period-menu-head">Свой период</div>
              <div class="sp-period-field">
                <label class="sp-period-label">С какой даты</label>
                <DateField v-model="customFrom" :max="customTo || undefined" plain />
              </div>
              <div class="sp-period-field">
                <label class="sp-period-label">По какую</label>
                <DateField v-model="customTo" :min="customFrom || undefined" plain />
              </div>
              <button class="sp-period-apply" :disabled="!customFrom" @click="applyCustom">Показать</button>
            </div>
          </v-menu>
        </div>
      </div>

      <!-- ── Обзор ── -->
      <template v-if="tab === 'overview'">
        <!-- Ничего за период — говорим словами, а не сеткой нулей: иначе
             непонятно, человек не работал или данные не приехали. -->
        <div v-if="nothingHappened" class="sp-quiet">
          <v-icon icon="mdi-sleep" size="26" />
          <div class="sp-quiet-title">За выбранный период активности нет</div>
          <div class="sp-quiet-text">
            {{ data.staff.name }} не принимал платежей, не заводил сделок и не работал с должниками.
            Возможно, стоит посмотреть период побольше.
          </div>
          <div class="sp-quiet-acts">
            <button v-if="preset !== '90'" class="sp-btn" @click="setPreset('90')">Показать 3 месяца</button>
            <button v-if="preset !== '365'" class="sp-btn" @click="setPreset('365')">Показать год</button>
          </div>
        </div>

        <template v-else>
          <div class="sp-panel">
            <div class="sp-panel-head">
              <span class="sp-panel-title">Деньги</span>
              <span class="sp-panel-hint">что человек принёс в кассу за период</span>
            </div>
            <div class="sp-cards sp-cards--2">
              <div class="sp-card">
                <div class="sp-card-ico" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
                  <v-icon icon="mdi-cash-multiple" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Принял платежей</div>
                  <div class="sp-card-value" :class="{ 'sp-card-value--zero': !data.metrics.money.amount }">
                    {{ formatCurrency(data.metrics.money.amount) }}
                  </div>
                  <div class="sp-card-sub">{{ data.metrics.money.count }} {{ plural(data.metrics.money.count, 'платёж', 'платежа', 'платежей') }}</div>
                </div>
              </div>
              <div class="sp-card">
                <div class="sp-card-ico" style="background: rgba(245, 158, 11, 0.12); color: #b45309;">
                  <v-icon icon="mdi-clock-alert-outline" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Из них по просроченным долгам</div>
                  <div class="sp-card-value" :class="{ 'sp-card-value--zero': !data.metrics.money.overdueAmount }">
                    {{ formatCurrency(data.metrics.money.overdueAmount) }}
                  </div>
                  <div class="sp-card-sub">{{ data.metrics.money.overdueCount }} {{ plural(data.metrics.money.overdueCount, 'платёж', 'платежа', 'платежей') }} · это возвращённые долги</div>
                </div>
              </div>
            </div>
          </div>

          <div class="sp-panel">
            <div class="sp-panel-head">
              <span class="sp-panel-title">Сделки</span>
              <span class="sp-panel-hint">что он завёл и что ведёт сейчас</span>
            </div>
            <div class="sp-cards sp-cards--3">
              <div class="sp-card">
                <div class="sp-card-ico" style="background: rgba(59, 130, 246, 0.12); color: #2563eb;">
                  <v-icon icon="mdi-file-plus-outline" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Завёл за период</div>
                  <div class="sp-card-value" :class="{ 'sp-card-value--zero': !data.metrics.deals.createdCount }">
                    {{ data.metrics.deals.createdCount }}
                  </div>
                  <div class="sp-card-sub">на {{ formatCurrency(data.metrics.deals.createdVolume) }}</div>
                </div>
              </div>
              <div class="sp-card">
                <div class="sp-card-ico" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
                  <v-icon icon="mdi-briefcase-outline" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Сейчас ведёт</div>
                  <div class="sp-card-value" :class="{ 'sp-card-value--zero': !data.metrics.deals.assignedActive }">
                    {{ data.metrics.deals.assignedActive }}
                  </div>
                  <div class="sp-card-sub">остаток {{ formatCurrency(data.metrics.deals.assignedRemaining) }}</div>
                </div>
              </div>
              <div class="sp-card" :class="{ 'sp-card--bad': data.metrics.deals.assignedOverdueAmount > 0 }">
                <div class="sp-card-ico" style="background: rgba(220, 38, 38, 0.1); color: #dc2626;">
                  <v-icon icon="mdi-alert-circle-outline" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Просрочка в его сделках</div>
                  <div class="sp-card-value" :class="{ 'sp-card-value--zero': !data.metrics.deals.assignedOverdueAmount }">
                    {{ formatCurrency(data.metrics.deals.assignedOverdueAmount) }}
                  </div>
                  <div class="sp-card-sub">
                    в {{ data.metrics.deals.assignedOverdueDeals }}
                    {{ plural(data.metrics.deals.assignedOverdueDeals, 'сделке', 'сделках', 'сделках') }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="sp-panel">
            <div class="sp-panel-head">
              <span class="sp-panel-title">Работа с должниками</span>
              <span class="sp-panel-hint">звонки, обещания и что из них вышло</span>
            </div>
            <div class="sp-cards sp-cards--3">
              <div class="sp-card">
                <div class="sp-card-ico" style="background: rgba(124, 58, 237, 0.12); color: #7c3aed;">
                  <v-icon icon="mdi-phone-outline" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Контактов</div>
                  <div class="sp-card-value" :class="{ 'sp-card-value--zero': !data.metrics.collections.contacts }">
                    {{ data.metrics.collections.contacts }}
                  </div>
                  <div class="sp-card-sub">звонки и сообщения должникам</div>
                </div>
              </div>
              <div class="sp-card">
                <div class="sp-card-ico" style="background: rgba(59, 130, 246, 0.12); color: #2563eb;">
                  <v-icon icon="mdi-handshake-outline" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Обещаний получено</div>
                  <div class="sp-card-value" :class="{ 'sp-card-value--zero': !data.metrics.collections.promises }">
                    {{ data.metrics.collections.promises }}
                  </div>
                  <div class="sp-card-sub">клиент назвал дату оплаты</div>
                </div>
              </div>
              <div class="sp-card">
                <div class="sp-card-ico" style="background: rgba(16, 185, 129, 0.12); color: #047857;">
                  <v-icon icon="mdi-check-decagram-outline" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Из них сдержано</div>
                  <template v-if="data.metrics.collections.keptRate != null">
                    <div class="sp-card-value">{{ data.metrics.collections.keptRate }}%</div>
                    <div class="sp-card-sub">
                      {{ data.metrics.collections.promisesKept }} из
                      {{ data.metrics.collections.promisesKept + data.metrics.collections.promisesBroken }}
                    </div>
                  </template>
                  <template v-else>
                    <div class="sp-card-value sp-card-value--zero">—</div>
                    <div class="sp-card-sub">срок обещаний ещё не наступил</div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <div class="sp-panel">
            <div class="sp-panel-head">
              <span class="sp-panel-title">Действия</span>
              <span v-if="activityIncomplete" class="sp-panel-hint sp-panel-hint--warn">
                история хранится {{ data.notes.activityRetentionDays }} дней — за больший период данные неполные
              </span>
              <span v-else class="sp-panel-hint">отмены, удаления и прощённые долги</span>
            </div>
            <div class="sp-cards sp-cards--3">
              <div class="sp-card">
                <div class="sp-card-ico" style="background: rgba(148, 163, 184, 0.2); color: #64748b;">
                  <v-icon icon="mdi-undo-variant" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Отменено оплат</div>
                  <div class="sp-card-value" :class="{ 'sp-card-value--zero': !data.metrics.attention.paymentsUnmarked }">
                    {{ data.metrics.attention.paymentsUnmarked }}
                  </div>
                </div>
              </div>
              <div class="sp-card">
                <div class="sp-card-ico" style="background: rgba(148, 163, 184, 0.2); color: #64748b;">
                  <v-icon icon="mdi-delete-outline" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Удалено сделок</div>
                  <div class="sp-card-value" :class="{ 'sp-card-value--zero': !data.metrics.attention.dealsDeleted }">
                    {{ data.metrics.attention.dealsDeleted }}
                  </div>
                </div>
              </div>
              <div class="sp-card" :class="{ 'sp-card--bad': data.metrics.attention.forgiveAmount > 0 }">
                <div class="sp-card-ico" style="background: rgba(245, 158, 11, 0.12); color: #b45309;">
                  <v-icon icon="mdi-hand-heart-outline" size="18" />
                </div>
                <div class="sp-card-body">
                  <div class="sp-card-label">Прощено долга</div>
                  <div class="sp-card-value" :class="{ 'sp-card-value--zero': !data.metrics.attention.forgiveAmount }">
                    {{ formatCurrency(data.metrics.attention.forgiveAmount) }}
                  </div>
                  <div class="sp-card-sub">
                    {{ data.metrics.attention.forgiveCount }}
                    {{ plural(data.metrics.attention.forgiveCount, 'раз', 'раза', 'раз') }} · это ваш заработок
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Активность по дням -->
          <div v-if="data.daily.length" class="sp-panel">
            <div class="sp-panel-head">
              <span class="sp-panel-title">Активность по дням</span>
              <span class="sp-panel-hint">{{ dailyTotal }} {{ plural(dailyTotal, 'действие', 'действия', 'действий') }} за период</span>
            </div>
            <div v-if="dailyTotal > 0" class="sp-chart">
              <div
                v-for="d in data.daily"
                :key="d.day"
                class="sp-bar-wrap"
                :title="`${d.day}: ${d.actions}`"
              >
                <div class="sp-bar" :style="{ height: Math.max(3, (d.actions / maxDaily) * 100) + '%' }" />
              </div>
            </div>
            <div v-else class="sp-chart-empty">За период действий не записано</div>
            <div v-if="data.daily.length" class="sp-chart-axis">
              <span>{{ formatDate(data.daily[0]!.day) }}</span>
              <span>{{ formatDate(data.daily[data.daily.length - 1]!.day) }}</span>
            </div>
          </div>
        </template>
      </template>

      <!-- ── Активность ── -->
      <template v-else-if="tab === 'activity'">
        <div class="sp-panel">
          <div class="sp-panel-head">
            <span class="sp-panel-title">Что делал сотрудник</span>
            <span class="sp-panel-hint">последние действия, новые сверху</span>
          </div>
          <v-progress-linear v-if="activityLoading" indeterminate color="#047857" class="mb-3" />
          <div v-if="!activityLoading && !activity.length" class="sp-empty">
            <v-icon icon="mdi-history" size="26" />
            <div class="sp-empty-title">Действий за период нет</div>
            <div class="sp-empty-text">Здесь появятся оплаты, сделки, правки и отмены — всё, что человек делает в системе.</div>
          </div>
          <div v-else class="sp-feed">
            <div v-for="a in activity" :key="a.id" class="sp-feed-row">
              <div class="sp-feed-dot"><v-icon icon="mdi-circle-small" size="18" /></div>
              <div class="sp-feed-body">
                <div class="sp-feed-title">{{ a.title }}</div>
                <div v-if="a.description" class="sp-feed-desc">{{ a.description }}</div>
              </div>
              <div class="sp-feed-time">{{ timeLabel(a.createdAt) }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Сделки ── -->
      <template v-else>
        <div class="sp-panel">
          <div class="sp-panel-head">
            <span class="sp-panel-title">Сделки сотрудника</span>
            <span class="sp-panel-hint">закреплены за ним — он видит их в своём списке</span>
          </div>
          <v-progress-linear v-if="dealsLoading" indeterminate color="#047857" class="mb-3" />
          <div v-if="!dealsLoading && !deals.length" class="sp-empty">
            <v-icon icon="mdi-briefcase-off-outline" size="26" />
            <div class="sp-empty-title">Сделок за сотрудником нет</div>
            <div class="sp-empty-text">
              Прикрепить сделку можно в разделе «Сотрудники» — на вкладке «Сделки» рядом с перепиской.
            </div>
          </div>
          <div v-else class="sp-feed">
            <div
              v-for="d in deals"
              :key="d.id"
              class="sp-feed-row sp-feed-row--click"
              @click="router.push(`/deals/${d.id}`)"
            >
              <div class="sp-feed-num">№{{ d.dealNumber }}</div>
              <div class="sp-feed-body">
                <div class="sp-feed-title">{{ d.productName }}</div>
                <div class="sp-feed-desc">{{ d.clientName || 'Клиент не указан' }}</div>
              </div>
              <div class="sp-feed-amount">
                {{ formatCurrency(d.remainingAmount ?? 0) }}
                <span class="sp-feed-amount-label">остаток</span>
              </div>
              <v-icon icon="mdi-chevron-right" size="18" class="sp-feed-go" />
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* Поля страницы — те же, что в остальных разделах: контент не должен
   прилипать к краю окна. */
.sp-page { padding: 24px 28px 40px; }
@media (max-width: 700px) { .sp-page { padding: 16px 12px 32px; } }

/* ── Шапка профиля ──
   Зелёный градиент, как на карточке счёта и сделки: страница человека — такой
   же «объект» системы, и шапка должна читаться так же. */
.sp-hero {
  display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap;
  padding: 22px 26px; margin-bottom: 20px;
  border-radius: 16px;
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  color: #fff;
}
.dark .sp-hero { background: linear-gradient(135deg, #047857 0%, #064e3b 50%, #022c22 100%); }
.sp-hero-ava {
  width: 54px; height: 54px; border-radius: 16px; flex: none;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; letter-spacing: 0.5px;
  background: rgba(255, 255, 255, 0.16) !important;
  color: #fff !important;
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.sp-hero-main { flex: 1 1 240px; min-width: 0; }
.sp-hero-name {
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
  font-size: 20px; font-weight: 700; letter-spacing: -0.3px;
}
.sp-hero .sp-role-tag {
  background: rgba(255, 255, 255, 0.18) !important;
  color: #fff !important;
}
.sp-role-tag {
  padding: 2px 8px; border-radius: 7px;
  font-size: 11.5px; font-weight: 700; white-space: nowrap;
}
.sp-off {
  padding: 2px 7px; border-radius: 6px;
  font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  background: rgba(251, 191, 36, 0.25); color: #fde68a;
}
.sp-hero-sub {
  margin-top: 4px; font-size: 13px;
  color: rgba(255, 255, 255, 0.62);
}
.sp-hero-facts { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
.sp-fact {
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
  font-size: 12px; color: rgba(255, 255, 255, 0.72);
}
.sp-hero-acts { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
/* На узком экране кнопки уходят под имя: рядом с ним они сжимали фамилию
   в две строки, а подписи доступа рвались по словам. */
@media (max-width: 700px) {
  .sp-hero { padding: 18px; }
  .sp-hero-acts { width: 100%; margin-left: 0; }
  .sp-hero-acts .sp-btn { flex: 1 1 auto; justify-content: center; }
}
/* Кнопки на градиенте — светлые полупрозрачные, как на карточке счёта. */
.sp-hero-acts .sp-btn {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.sp-hero-acts .sp-btn:hover { background: rgba(255, 255, 255, 0.24); color: #fff; }
.sp-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 13px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; cursor: pointer;
  font-size: 12.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.sp-btn:hover { border-color: rgba(4, 120, 87, 0.4); color: #047857; }

/* Кнопка периода — вровень с плашкой вкладок, поэтому её высота (44 px), а
   не высота обычной кнопки: рядом они читаются как одна строка. */
.sp-period-btn {
  display: inline-flex; align-items: center; gap: 8px;
  height: 44px; padding: 0 14px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: pointer; white-space: nowrap;
}
.sp-period-btn:hover { color: #047857; border-color: rgba(4, 120, 87, 0.35); }
.sp-period-btn-label { font-variant-numeric: tabular-nums; }
.sp-period-btn-caret { color: rgba(var(--v-theme-on-surface), 0.35); }

.sp-period-menu {
  min-width: 260px; padding: 8px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.14);
}
.sp-period-menu-head {
  padding: 6px 8px 4px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.sp-period-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 9px 10px; border: none; border-radius: 9px; background: transparent;
  font-size: 13px; font-weight: 500; text-align: left; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.sp-period-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.sp-period-item--on { background: rgba(4, 120, 87, 0.09); color: #047857; font-weight: 600; }
.sp-period-check { margin-left: auto; }
.sp-period-sep { height: 1px; margin: 6px 8px; background: rgba(var(--v-theme-on-surface), 0.08); }
.sp-period-field { padding: 0 8px 8px; }
.sp-period-label {
  display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.sp-period-apply {
  width: calc(100% - 16px); margin: 2px 8px 4px;
  height: 36px; border-radius: 9px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.sp-period-apply:hover:not(:disabled) { background: #036b4e; }
.sp-period-apply:disabled { opacity: 0.5; cursor: default; }

.sp-attention {
  padding: 12px 16px; margin-bottom: 16px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.07);
  border-radius: 12px;
}
.sp-attention-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 700; color: #92400e; margin-bottom: 4px;
}
.sp-attention-line { font-size: 13px; line-height: 1.5; color: #92400e; }

/* ── Панели разделов ── */
.sp-panel {
  padding: 16px 18px; margin-bottom: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
}
.sp-panel-head {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  margin-bottom: 12px;
}
.sp-panel-title { font-size: 14.5px; font-weight: 700; }
.sp-panel-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.42); }
.sp-panel-hint--warn { color: #b45309; }

/* ── Плитки показателей ── */
.sp-cards { display: grid; gap: 10px; }
.sp-cards--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sp-cards--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.sp-cards--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 1000px) {
  .sp-cards--3, .sp-cards--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 620px) {
  .sp-cards--2, .sp-cards--3, .sp-cards--4 { grid-template-columns: minmax(0, 1fr); }
}
.sp-card {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 13px 14px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.sp-card--bad { border-color: rgba(220, 38, 38, 0.25); background: rgba(220, 38, 38, 0.04); }
.sp-card-ico {
  width: 34px; height: 34px; border-radius: 10px; flex: none;
  display: flex; align-items: center; justify-content: center;
}
.sp-card-body { min-width: 0; }
.sp-card-label {
  font-size: 11.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.sp-card-value {
  font-size: 20px; font-weight: 700; margin-top: 2px;
  font-variant-numeric: tabular-nums; letter-spacing: -0.3px;
}
/* Ноль не должен кричать как цифра: взгляд цепляется за то, что есть. */
.sp-card-value--zero { color: rgba(var(--v-theme-on-surface), 0.32); font-weight: 600; }
.sp-card-sub {
  font-size: 11.5px; line-height: 1.4; margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.42);
}

/* ── Пустой период ── */
.sp-quiet {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 44px 24px; text-align: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.sp-quiet-title { font-size: 15.5px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.sp-quiet-text { font-size: 13px; line-height: 1.5; max-width: 460px; }
.sp-quiet-acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }

/* ── График по дням ── */
.sp-chart { display: flex; align-items: flex-end; gap: 3px; height: 96px; }
.sp-bar-wrap { flex: 1; min-width: 2px; height: 100%; display: flex; align-items: flex-end; }
.sp-bar {
  width: 100%; border-radius: 3px 3px 0 0;
  background: linear-gradient(180deg, #34d399, #059669);
}
.sp-chart-empty {
  padding: 26px 0; text-align: center; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.sp-chart-axis {
  display: flex; justify-content: space-between; margin-top: 7px;
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}

/* ── Ленты: действия и сделки ── */
.sp-feed { display: flex; flex-direction: column; }
.sp-feed-row {
  display: flex; align-items: center; gap: 11px;
  padding: 11px 8px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.sp-feed-row:last-child { border-bottom: none; }
.sp-feed-row--click { cursor: pointer; border-radius: 10px; }
.sp-feed-row--click:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.sp-feed-dot { color: rgba(var(--v-theme-on-surface), 0.3); flex: none; }
.sp-feed-num {
  min-width: 58px; font-size: 12px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-variant-numeric: tabular-nums;
}
.sp-feed-body { flex: 1; min-width: 0; }
.sp-feed-title {
  font-size: 13.5px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sp-feed-desc {
  font-size: 12px; margin-top: 1px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sp-feed-time {
  font-size: 11.5px; white-space: nowrap; text-align: right;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.sp-feed-amount {
  text-align: right; font-size: 13.5px; font-weight: 700; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.sp-feed-amount-label {
  display: block; font-size: 11px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.sp-feed-go { color: rgba(var(--v-theme-on-surface), 0.3); flex: none; }

/* ── Пусто во вкладках ── */
.sp-empty {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 34px 24px; text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.sp-empty-title { font-size: 14.5px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.75); }
.sp-empty-text { font-size: 12.5px; line-height: 1.5; max-width: 420px; }
</style>
