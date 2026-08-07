<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useDebtorsStore, type DebtorRow, type CollectionActivity, type PromiseStatus, type DealPayment, type PaymentStatus } from '@/stores/debtors'
import { useIsMobile } from '@/composables/useIsMobile'
import { formatCurrency, formatDateShort } from '@/utils/formatters'
import PromiseDialog from './PromiseDialog.vue'

const props = defineProps<{
  modelValue: boolean
  row: DebtorRow | null
  canActivity: boolean
  canDelete: boolean
  canAssign: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'write', row: DebtorRow): void
  (e: 'assign', row: DebtorRow): void
}>()

const store = useDebtorsStore()
const router = useRouter()
const { isMobile } = useIsMobile()

const modalTab = ref<'overview' | 'history'>('overview')
const activities = ref<CollectionActivity[]>([])
const loading = ref(false)
const error = ref('')

// Платежи сделки
const payments = ref<DealPayment[]>([])
const paymentsLoading = ref(false)
const paymentsError = ref('')

// Композер заметки
type NoteType = 'NOTE' | 'CALL' | 'WHATSAPP' | 'CONTACTED'
const noteType = ref<NoteType>('NOTE')
const noteText = ref('')
const sending = ref(false)
const NOTE_TYPES: { key: NoteType; label: string; icon: string }[] = [
  { key: 'NOTE', label: 'Заметка', icon: 'mdi-note-text-outline' },
  { key: 'CALL', label: 'Звонок', icon: 'mdi-phone-outline' },
  { key: 'WHATSAPP', label: 'WhatsApp', icon: 'mdi-whatsapp' },
  { key: 'CONTACTED', label: 'Связались', icon: 'mdi-account-check-outline' },
]

const promiseOpen = ref(false)
const editingPromise = ref<CollectionActivity | null>(null)
const timelineRef = ref<HTMLElement | null>(null)

function openAddPromise() { editingPromise.value = null; promiseOpen.value = true }
function openEditPromise(a: CollectionActivity) { editingPromise.value = a; promiseOpen.value = true }
async function deletePromiseEntry(a: CollectionActivity) {
  if (!confirm('Удалить это обещание?')) return
  try {
    await store.deletePromise(a.id)
    activities.value = activities.value.filter((x) => x.id !== a.id)
    await store.fetchDebtors()
  } catch (e: any) {
    error.value = e?.message || 'Не удалось удалить обещание'
  }
}

function close() { emit('update:modelValue', false) }

watch(() => props.modelValue, async (open) => {
  if (open && props.row) {
    modalTab.value = 'overview'
    promisesExpanded.value = false
    loadPayments()
    await loadActivities()
  } else {
    activities.value = []
    payments.value = []
    noteText.value = ''
    noteType.value = 'NOTE'
    error.value = ''
  }
})

// При переключении на «Историю» — прокрутить ленту вниз.
watch(modalTab, async (t) => {
  if (t === 'history') { await nextTick(); scrollToBottom() }
})

async function loadPayments() {
  if (!props.row) return
  paymentsLoading.value = true
  paymentsError.value = ''
  try {
    payments.value = await store.fetchDealPayments(props.row.dealId)
  } catch (e: any) {
    paymentsError.value = e?.message || 'Не удалось загрузить платежи'
  } finally {
    paymentsLoading.value = false
  }
}

async function loadActivities() {
  if (!props.row) return
  loading.value = true
  error.value = ''
  try {
    activities.value = await store.fetchActivities(props.row.dealId)
    if (modalTab.value === 'history') { await nextTick(); scrollToBottom() }
  } catch (e: any) {
    error.value = e?.message || 'Не удалось загрузить историю'
  } finally {
    loading.value = false
  }
}
function scrollToBottom() {
  const el = timelineRef.value
  if (el) el.scrollTop = el.scrollHeight
}

async function submitNote() {
  if (!props.row || !noteText.value.trim()) return
  sending.value = true
  try {
    const act = await store.addActivity(props.row.dealId, { type: noteType.value, text: noteText.value.trim() })
    activities.value.push(act)
    noteText.value = ''
    await nextTick()
    scrollToBottom()
  } catch (e: any) {
    error.value = e?.message || 'Не удалось сохранить'
  } finally {
    sending.value = false
  }
}

async function onPromiseSaved() {
  editingPromise.value = null
  await loadActivities()
  await store.fetchDebtors() // колонка «обещал оплатить» пересчитывается на бэке
}

async function removeActivity(id: string) {
  if (!confirm('Удалить эту запись из истории?')) return
  try {
    await store.deleteActivity(id)
    activities.value = activities.value.filter((a) => a.id !== id)
    if (props.row) await store.fetchDebtors()
  } catch (e: any) {
    error.value = e?.message || 'Не удалось удалить'
  }
}

function openDeal() { if (props.row) router.push(`/deals/${props.row.dealId}`) }

function fmtDate(ts: number | null) { return ts ? formatDateShort(new Date(ts).toISOString()) : '—' }
// Дата буквенным месяцем: «6 августа 2026».
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
function fmtWords(ts: number | null) {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`
}
// Фактическая дата оплаты по обещанию = самая поздняя дата оплаты его платежей.
function promisePaidDate(a: CollectionActivity): number | null {
  const nums = a.promisedPaymentNumbers || []
  const paid = payments.value.filter((p) => (nums.length ? nums.includes(p.number) : true) && p.paidAt)
  return paid.length ? Math.max(...paid.map((p) => p.paidAt as number)) : null
}
function dayTs(ts: number) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }
// Статус обещания для отображения: у сдержанных различаем «в срок» и «с опозданием».
function promiseView(a: CollectionActivity): { label: string; cls: string } {
  if (a.promiseStatus === 'KEPT') {
    const paid = promisePaidDate(a)
    if (paid && a.promisedDate && dayTs(paid) > dayTs(a.promisedDate)) {
      return { label: 'Оплачено с опозданием', cls: 'ps--late' }
    }
    return { label: 'Сдержано', cls: 'ps--kept' }
  }
  return a.promiseStatus ? PROMISE_STATUS_META[a.promiseStatus] : { label: 'Ожидается', cls: 'ps--pending' }
}
const promiseIsLate = (a: CollectionActivity) => {
  if (a.promiseStatus !== 'KEPT') return false
  const paid = promisePaidDate(a)
  return !!(paid && a.promisedDate && dayTs(paid) > dayTs(a.promisedDate))
}
function fmtDateTime(ts: number) {
  const d = new Date(ts)
  return `${formatDateShort(d.toISOString())}, ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}
function daysLabel(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} день`
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} дня`
  return `${n} дней`
}
function progressPct(r: DebtorRow) { return r.numberOfPayments ? Math.round((r.paidPayments / r.numberOfPayments) * 100) : 0 }
const initials = computed(() => {
  const parts = (props.row?.clientName || '').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—'
})

const TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  NOTE: { label: 'Заметка', icon: 'mdi-note-text-outline', color: '#64748b' },
  CALL: { label: 'Звонок', icon: 'mdi-phone-outline', color: '#3b82f6' },
  WHATSAPP: { label: 'WhatsApp', icon: 'mdi-whatsapp', color: '#25d366' },
  CONTACTED: { label: 'Связались', icon: 'mdi-account-check-outline', color: '#8b5cf6' },
  PROMISE: { label: 'Обещал оплатить', icon: 'mdi-hand-coin-outline', color: '#f59e0b' },
  SYSTEM: { label: 'Система', icon: 'mdi-cog-outline', color: '#94a3b8' },
}
const PROMISE_STATUS_META: Record<PromiseStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Ожидается', cls: 'ps--pending' },
  KEPT: { label: 'Сдержано', cls: 'ps--kept' },
  BROKEN: { label: 'Нарушено', cls: 'ps--broken' },
  SUPERSEDED: { label: 'Заменено', cls: 'ps--superseded' },
}
const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Ожидает', cls: 'pm--pending' },
  PAID: { label: 'Оплачен', cls: 'pm--paid' },
  OVERDUE: { label: 'Просрочен', cls: 'pm--overdue' },
  CLOSED_EARLY: { label: 'Закрыт', cls: 'pm--closed' },
}
const overdueSummary = computed(() => {
  const od = payments.value.filter((p) => p.status === 'OVERDUE')
  return { count: od.length, amount: od.reduce((s, p) => s + p.amount, 0) }
})

// Активные (PENDING) обещания — их может быть несколько.
const pendingPromises = computed(() => activities.value.filter((a) => a.type === 'PROMISE' && a.promiseStatus === 'PENDING'))
// Все обещания списком: активные (ближайшие первыми) → затем закрытые (свежие первыми).
const allPromises = computed(() => {
  const rank = (s: string | null | undefined) => (s === 'PENDING' ? 0 : 1)
  return activities.value
    .filter((a) => a.type === 'PROMISE')
    .slice()
    .sort((a, b) => {
      const ra = rank(a.promiseStatus)
      const rb = rank(b.promiseStatus)
      if (ra !== rb) return ra - rb
      if (ra === 0) return (a.promisedDate ?? Infinity) - (b.promisedDate ?? Infinity)
      return b.createdAt - a.createdAt
    })
})
const PROMISE_PREVIEW = 2
const promisesExpanded = ref(false)
const displayedPromises = computed(() => (promisesExpanded.value ? allPromises.value : allPromises.value.slice(0, PROMISE_PREVIEW)))
// Платежи, входящие в ВЫПОЛНЕННЫЕ (KEPT) обещания — для отметки «обещание выполнено».
const keptByPayment = computed(() => {
  const s = new Set<number>()
  for (const a of activities.value) {
    if (a.type === 'PROMISE' && a.promiseStatus === 'KEPT') {
      for (const n of a.promisedPaymentNumbers || []) s.add(n)
    }
  }
  return s
})
// Платёж №N → дата ближайшего обещания, которое его покрывает (для отметки в графике).
const promiseByPayment = computed(() => {
  const m = new Map<number, number>()
  for (const a of pendingPromises.value) {
    if (!a.promisedDate) continue
    for (const n of a.promisedPaymentNumbers || []) {
      const cur = m.get(n)
      if (cur === undefined || a.promisedDate < cur) m.set(n, a.promisedDate)
    }
  }
  return m
})
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    :max-width="isMobile ? undefined : 1040"
    :fullscreen="isMobile"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card v-if="row" class="dm-card" rounded="lg">
      <!-- Шапка -->
      <div class="dm-hero">
        <button class="dm-close" @click="close"><v-icon icon="mdi-close" size="20" /></button>
        <div class="dm-hero-row">
          <div class="dm-hero-avatar">{{ initials }}</div>
          <div class="dm-hero-info">
            <div class="dm-hero-badge"><span class="dm-hero-dot-red" /> Просрочка {{ daysLabel(row.overdueDays) }}</div>
            <div class="dm-hero-name">{{ row.clientName }}</div>
            <div class="dm-hero-meta">
              <span v-if="row.clientPhone" class="dm-hero-phone">{{ row.clientPhone }}</span>
              <span class="dm-hero-dot">·</span>
              <span>Сделка #{{ row.dealNumber }}</span>
              <span class="dm-hero-dot">·</span>
              <span class="dm-hero-product">{{ row.productName }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Панель действий (всегда видна) -->
      <div class="dm-actions">
        <button v-if="canActivity" class="dm-btn dm-btn--primary" @click="openAddPromise">
          <v-icon icon="mdi-hand-coin-outline" size="16" /> Обещал оплатить
        </button>
        <button v-if="row.clientPhone" class="dm-btn" @click="emit('write', row)">
          <v-icon icon="mdi-whatsapp" size="16" /> Написать
        </button>
        <button v-if="canAssign" class="dm-btn" @click="emit('assign', row)">
          <v-icon icon="mdi-account-arrow-right-outline" size="16" /> Назначить
        </button>
        <button class="dm-btn" @click="openDeal">
          <v-icon icon="mdi-briefcase-outline" size="16" /> Открыть сделку
        </button>
      </div>

      <!-- Табы модалки -->
      <div class="dm-tabs">
        <button class="dm-tab" :class="{ active: modalTab === 'overview' }" @click="modalTab = 'overview'">
          <v-icon icon="mdi-information-outline" size="17" /> Обзор
        </button>
        <button class="dm-tab" :class="{ active: modalTab === 'history' }" @click="modalTab = 'history'">
          <v-icon icon="mdi-history" size="17" /> История работы
          <span v-if="activities.length" class="dm-tab-count">{{ activities.length }}</span>
        </button>
      </div>

      <!-- ── Таб: Обзор ── -->
      <div v-if="modalTab === 'overview'" class="dm-overview">
        <!-- Просрочка -->
        <div class="dm-overdue">
          <div class="dm-overdue-amt">{{ formatCurrency(row.overdueAmount) }}</div>
          <div class="dm-overdue-sub">просрочка · {{ row.overdueCount }} плат. · {{ daysLabel(row.overdueDays) }}</div>
        </div>

        <!-- Сетка показателей -->
        <div class="dm-stats">
          <div class="dm-stat">
            <span class="dm-stat-lbl">Остаток</span>
            <span class="dm-stat-val">{{ formatCurrency(row.remainingAmount) }}</span>
          </div>
          <div class="dm-stat">
            <span class="dm-stat-lbl">Сумма договора</span>
            <span class="dm-stat-val">{{ formatCurrency(row.totalPrice) }}</span>
          </div>
          <div class="dm-stat">
            <span class="dm-stat-lbl">Следующий платёж</span>
            <span class="dm-stat-val">{{ fmtDate(row.nextDueDate) }}</span>
            <span v-if="row.nextDueDate" class="dm-stat-sub">{{ formatCurrency(row.nextDueAmount) }}</span>
          </div>
          <div class="dm-stat">
            <span class="dm-stat-lbl">Прогресс</span>
            <span class="dm-stat-val">{{ row.paidPayments }}/{{ row.numberOfPayments }}</span>
            <v-progress-linear :model-value="progressPct(row)" color="primary" rounded height="4" class="mt-1" />
          </div>
        </div>

        <!-- Обещания оплаты — сворачиваемый список с редактированием/удалением -->
        <div v-if="allPromises.length" class="dm-promises">
          <div class="dm-promises-head">
            <span class="dm-promises-title"><v-icon icon="mdi-hand-coin-outline" size="16" /> Обещания оплаты</span>
            <span class="dm-promises-count">{{ allPromises.length }}</span>
          </div>

          <div
            v-for="a in displayedPromises"
            :key="a.id"
            class="dm-promise-item"
            :class="a.promiseStatus ? 'dm-promise-item--' + a.promiseStatus.toLowerCase() : ''"
          >
            <div class="dm-promise-item-main">
              <v-icon icon="mdi-calendar-check" size="15" />
              <span>Обещал на <b>{{ fmtWords(a.promisedDate) }}</b></span>
              <span v-if="a.promisedAmount" class="dm-promise-item-amt">· {{ formatCurrency(a.promisedAmount) }}</span>
              <span v-if="a.promiseStatus" class="dm-ps" :class="promiseView(a).cls">{{ promiseView(a).label }}</span>
              <div v-if="canActivity" class="dm-promise-item-acts">
                <button v-if="a.promiseStatus === 'PENDING'" title="Редактировать" @click="openEditPromise(a)">
                  <v-icon icon="mdi-pencil-outline" size="15" />
                </button>
                <button title="Удалить" @click="deletePromiseEntry(a)">
                  <v-icon icon="mdi-delete-outline" size="15" />
                </button>
              </div>
            </div>
            <div v-if="a.promiseStatus === 'KEPT' && promisePaidDate(a)" class="dm-promise-item-paid" :class="{ 'dm-promise-item-paid--late': promiseIsLate(a) }">
              <v-icon icon="mdi-check-circle" size="14" /> Оплачено {{ fmtWords(promisePaidDate(a)) }}
            </div>
            <div v-if="a.promisedPaymentNumbers && a.promisedPaymentNumbers.length" class="dm-promise-item-pays">
              За платежи: {{ a.promisedPaymentNumbers.map((n) => '№' + n).join(', ') }}
            </div>
            <div v-if="a.text" class="dm-promise-item-note">{{ a.text }}</div>
          </div>

          <button v-if="allPromises.length > PROMISE_PREVIEW" class="dm-promises-toggle" @click="promisesExpanded = !promisesExpanded">
            <v-icon :icon="promisesExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
            {{ promisesExpanded ? 'Свернуть' : 'Показать ещё ' + (allPromises.length - PROMISE_PREVIEW) }}
          </button>
        </div>

        <!-- Ответственный -->
        <div class="dm-inforows">
          <div class="dm-info-row">
            <span class="dm-info-lbl"><v-icon icon="mdi-account-outline" size="15" /> Ответственный</span>
            <span class="dm-info-val">
              <span v-if="row.assignedStaffName">{{ row.assignedStaffName }}</span>
              <span v-else class="text-medium-emphasis">Не назначен</span>
            </span>
          </div>
        </div>

        <!-- Платежи -->
        <div class="dm-pays">
          <div class="dm-pays-head">
            <span class="dm-pays-title">График платежей</span>
            <span v-if="overdueSummary.count" class="dm-pays-badge">
              Просрочено {{ overdueSummary.count }} на {{ formatCurrency(overdueSummary.amount) }}
            </span>
          </div>
          <div v-if="paymentsLoading" class="d-flex justify-center pa-6">
            <v-progress-circular indeterminate color="primary" size="24" />
          </div>
          <div v-else-if="paymentsError" class="dm-pays-empty" style="color:#dc2626">{{ paymentsError }}</div>
          <table v-else-if="payments.length" class="dm-pays-table">
            <thead>
              <tr>
                <th style="width: 36px;">№</th>
                <th>Дата платежа</th>
                <th class="text-end">Сумма</th>
                <th class="text-end">Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in payments" :key="p.id" :class="{ 'dm-pay-row--overdue': p.status === 'OVERDUE', 'dm-pay-row--promised': promiseByPayment.has(p.number) }">
                <td class="dm-pay-num">{{ p.number }}</td>
                <td>
                  {{ fmtDate(p.dueDate) }}
                  <span v-if="p.status === 'OVERDUE'" class="dm-pay-late">просрочен {{ daysLabel(p.daysOverdue) }}</span>
                  <span v-else-if="p.status === 'PAID' && p.paidAt" class="dm-pay-sub">оплачен {{ fmtDate(p.paidAt) }}</span>
                  <span v-if="promiseByPayment.has(p.number)" class="dm-pay-promised">
                    <v-icon icon="mdi-hand-coin-outline" size="12" /> обещал оплатить {{ fmtDate(promiseByPayment.get(p.number)!) }}
                  </span>
                  <span v-else-if="keptByPayment.has(p.number)" class="dm-pay-kept">
                    <v-icon icon="mdi-check-circle" size="12" /> обещание выполнено
                  </span>
                </td>
                <td class="text-end text-no-wrap font-weight-medium">{{ formatCurrency(p.amount) }}</td>
                <td class="text-end">
                  <span class="dm-pm" :class="PAYMENT_STATUS_META[p.status].cls">{{ PAYMENT_STATUS_META[p.status].label }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="dm-pays-empty">Платежей нет</div>
        </div>
      </div>

      <!-- ── Таб: История работы ── -->
      <div v-else class="dm-history">
        <div ref="timelineRef" class="dm-timeline">
          <div v-if="loading" class="d-flex justify-center pa-6">
            <v-progress-circular indeterminate color="primary" size="28" />
          </div>
          <div v-else-if="!activities.length" class="dm-empty">
            <v-icon icon="mdi-comment-text-outline" size="40" />
            <div>Пока нет записей</div>
            <div class="dm-empty-sub">Добавьте комментарий или отметьте обещание оплаты</div>
          </div>
          <template v-else>
            <div v-for="a in activities" :key="a.id" class="dm-entry">
              <div class="dm-entry-ico" :style="{ background: TYPE_META[a.type]?.color + '1f', color: TYPE_META[a.type]?.color }">
                <v-icon :icon="TYPE_META[a.type]?.icon || 'mdi-circle-small'" size="16" />
              </div>
              <div class="dm-entry-body">
                <div class="dm-entry-head">
                  <span class="dm-entry-type">{{ TYPE_META[a.type]?.label || a.type }}</span>
                  <span class="dm-entry-actor">{{ a.actorName }}</span>
                  <span class="dm-entry-time">{{ fmtDateTime(a.createdAt) }}</span>
                  <template v-if="a.type === 'PROMISE' && canActivity">
                    <button class="dm-entry-del" title="Редактировать" @click="openEditPromise(a)">
                      <v-icon icon="mdi-pencil-outline" size="15" />
                    </button>
                    <button class="dm-entry-del" title="Удалить" @click="deletePromiseEntry(a)">
                      <v-icon icon="mdi-delete-outline" size="15" />
                    </button>
                  </template>
                  <button v-else-if="canDelete" class="dm-entry-del" title="Удалить" @click="removeActivity(a.id)">
                    <v-icon icon="mdi-delete-outline" size="15" />
                  </button>
                </div>
                <div v-if="a.type === 'PROMISE'" class="dm-promise-card">
                  <div class="dm-promise-line">
                    <v-icon icon="mdi-calendar-check" size="15" />
                    <span>Обещал на <b>{{ fmtWords(a.promisedDate) }}</b></span>
                    <span v-if="a.promisedAmount">· {{ formatCurrency(a.promisedAmount) }}</span>
                    <span v-if="a.promiseStatus" class="dm-ps" :class="promiseView(a).cls">{{ promiseView(a).label }}</span>
                  </div>
                  <div v-if="a.promiseStatus === 'KEPT' && promisePaidDate(a)" class="dm-promise-paid" :class="{ 'dm-promise-paid--late': promiseIsLate(a) }">
                    <v-icon icon="mdi-check-circle" size="13" /> Оплачено {{ fmtWords(promisePaidDate(a)) }}
                  </div>
                  <div v-if="a.promisedPaymentNumbers && a.promisedPaymentNumbers.length" class="dm-promise-pays">
                    За платежи: {{ a.promisedPaymentNumbers.map((n) => '№' + n).join(', ') }}
                  </div>
                  <div v-if="a.text" class="dm-entry-text">{{ a.text }}</div>
                </div>
                <div v-else-if="a.text" class="dm-entry-text">{{ a.text }}</div>
              </div>
            </div>
          </template>
        </div>

        <div v-if="canActivity" class="dm-composer">
          <div class="dm-type-chips">
            <button v-for="t in NOTE_TYPES" :key="t.key" class="dm-type-chip" :class="{ active: noteType === t.key }" @click="noteType = t.key">
              <v-icon :icon="t.icon" size="14" /> {{ t.label }}
            </button>
          </div>
          <div class="dm-composer-row">
            <textarea v-model="noteText" class="dm-composer-input" rows="2" placeholder="Что сказал клиент, договорённости…" @keydown.ctrl.enter="submitNote" />
            <button class="dm-send" :disabled="!noteText.trim() || sending" @click="submitNote">
              <v-icon icon="mdi-send" size="18" />
            </button>
          </div>
        </div>
        <div v-if="error" class="dm-error">{{ error }}</div>
      </div>
    </v-card>

    <PromiseDialog v-model="promiseOpen" :row="row" :edit-activity="editingPromise" @saved="onPromiseSaved" />
  </v-dialog>
</template>

<style scoped>
.dm-card { display: flex; flex-direction: column; overflow: hidden; max-height: 88vh; }

/* Шапка — фирменный зелёный градиент проекта */
.dm-hero { position: relative; padding: 20px 24px; background: linear-gradient(135deg, #047857 0%, #065f46 100%); color: #fff; }
.dm-close { position: absolute; top: 14px; right: 14px; width: 32px; height: 32px; border-radius: 8px; border: none; background: rgba(255,255,255,0.2); color: #fff; cursor: pointer; }
.dm-close:hover { background: rgba(255,255,255,0.32); }
.dm-hero-row { display: flex; align-items: center; gap: 16px; }
.dm-hero-avatar { width: 56px; height: 56px; min-width: 56px; border-radius: 50%; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; }
.dm-hero-info { min-width: 0; }
.dm-hero-badge { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; font-size: 12px; font-weight: 600; padding: 4px 11px; border-radius: 999px; background: #fff; color: #b91c1c; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.dm-hero-dot-red { width: 7px; height: 7px; border-radius: 50%; background: #ef4444; }
.dm-hero-name { font-size: 20px; font-weight: 800; padding-right: 40px; }
.dm-hero-meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-size: 13px; margin-top: 5px; opacity: 0.92; }
.dm-hero-dot { opacity: 0.6; }
.dm-hero-product { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 340px; }

/* Панель действий (под шапкой, всегда видна) */
.dm-actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 14px 20px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08); }

/* Табы модалки */
.dm-tabs { display: flex; gap: 4px; padding: 10px 20px 0; }
.dm-tab { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border: none; background: transparent; border-bottom: 2px solid transparent; font-size: 13.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.5); cursor: pointer; transition: all 0.15s; }
.dm-tab:hover { color: rgba(var(--v-theme-on-surface), 0.8); }
.dm-tab.active { color: #047857; border-bottom-color: #047857; }
.dm-tab-count { font-size: 11px; font-weight: 700; padding: 0 6px; border-radius: 9px; background: rgba(var(--v-theme-on-surface), 0.08); }

/* Таб «Обзор» */
.dm-overview { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 20px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
.dm-overdue { padding: 16px; border-radius: 14px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); margin-bottom: 16px; }
.dm-overdue-amt { font-size: 26px; font-weight: 800; color: #ef4444; line-height: 1.1; }
.dm-overdue-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 4px; }
.dm-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
@media (max-width: 640px) { .dm-stats { grid-template-columns: 1fr 1fr; } }
.dm-stat { padding: 12px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); display: flex; flex-direction: column; gap: 2px; }
.dm-stat-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: rgba(var(--v-theme-on-surface), 0.45); }
.dm-stat-val { font-size: 15px; font-weight: 700; }
.dm-stat-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.dm-info-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06); }
.dm-info-lbl { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); }
.dm-info-val { font-size: 13.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }

.dm-inforows { margin-bottom: 16px; }
.dm-btn { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.14); background: rgb(var(--v-theme-surface)); font-size: 13.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.78); cursor: pointer; transition: all 0.12s; }
.dm-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.28); }
.dm-btn--primary { background: #f59e0b; border-color: #f59e0b; color: #fff; }
.dm-btn--primary:hover { background: #d98b09; }

/* Платежи (в Обзоре) */
.dm-pays-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.dm-pays-title { font-size: 14px; font-weight: 700; }
.dm-pays-badge { font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; background: rgba(239,68,68,0.12); color: #dc2626; }
.dm-pays-table { width: 100%; border-collapse: collapse; }
.dm-pays-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: rgba(var(--v-theme-on-surface), 0.45); font-weight: 600; padding: 6px 10px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
.dm-pays-table td { font-size: 13px; padding: 9px 10px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05); }
.dm-pay-row--overdue td { background: rgba(239,68,68,0.04); }
.dm-pay-row--promised td { background: rgba(245,158,11,0.07); }
.dm-pay-num { color: rgba(var(--v-theme-on-surface), 0.45); font-variant-numeric: tabular-nums; }
.dm-pay-late { display: block; font-size: 11.5px; color: #dc2626; font-weight: 600; }
.dm-pay-sub { display: block; font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); }
.dm-pay-promised { display: inline-flex; align-items: center; gap: 3px; font-size: 11.5px; color: #b45309; font-weight: 700; margin-top: 2px; }
.dm-pay-kept { display: inline-flex; align-items: center; gap: 3px; font-size: 11.5px; color: #047857; font-weight: 700; margin-top: 2px; }

/* Список обещаний в «Обзоре» */
.dm-promises { margin-bottom: 16px; }
.dm-promises-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.dm-promises-title { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; }
.dm-promises-count { font-size: 11px; font-weight: 700; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: rgba(245,158,11,0.18); color: #b45309; display: inline-flex; align-items: center; justify-content: center; }
.dm-promise-item { padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(245,158,11,0.25); background: rgba(245,158,11,0.06); margin-bottom: 8px; }
.dm-promise-item--kept { border-color: rgba(16,185,129,0.25); background: rgba(16,185,129,0.06); }
.dm-promise-item--broken { border-color: rgba(239,68,68,0.25); background: rgba(239,68,68,0.06); }
.dm-promise-item--superseded { border-color: rgba(148,163,184,0.22); background: rgba(148,163,184,0.08); }
.dm-promise-item-main { display: flex; align-items: center; gap: 6px; font-size: 13.5px; flex-wrap: wrap; }
.dm-promise-item-amt { font-weight: 600; }
.dm-promise-item-acts { margin-left: auto; display: inline-flex; gap: 2px; }
.dm-promise-item-acts button { border: none; background: none; color: rgba(var(--v-theme-on-surface), 0.4); cursor: pointer; padding: 3px; border-radius: 6px; }
.dm-promise-item-acts button:hover { color: #ef4444; background: rgba(239,68,68,0.1); }
.dm-promise-item-paid { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 600; color: #047857; margin-top: 4px; }
.dm-promise-paid { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 600; color: #047857; margin-top: 4px; }
.dm-promise-item-pays { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 4px; }
.dm-promise-item-note { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.8); margin-top: 4px; white-space: pre-wrap; word-break: break-word; }
.dm-promises-toggle { display: inline-flex; align-items: center; gap: 4px; padding: 6px 2px; border: none; background: none; cursor: pointer; font-size: 12.5px; font-weight: 600; color: #047857; }
.dm-promises-toggle:hover { text-decoration: underline; }
.dm-pays-empty { padding: 20px; text-align: center; color: rgba(var(--v-theme-on-surface), 0.4); font-size: 13px; }
.dm-pm { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
.pm--pending { background: rgba(59,130,246,0.14); color: #2563eb; }
.pm--paid { background: rgba(16,185,129,0.15); color: #047857; }
.pm--overdue { background: rgba(239,68,68,0.15); color: #dc2626; }
.pm--closed { background: rgba(148,163,184,0.18); color: #64748b; }

/* Таб «История» */
.dm-history { flex: 1; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
.dm-timeline { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; min-height: 240px; }
.dm-empty { text-align: center; color: rgba(var(--v-theme-on-surface), 0.4); padding: 40px 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.dm-empty-sub { font-size: 12.5px; }
.dm-entry { display: flex; gap: 10px; }
.dm-entry-ico { width: 30px; height: 30px; min-width: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.dm-entry-body { flex: 1; min-width: 0; }
.dm-entry-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dm-entry-type { font-size: 13px; font-weight: 600; }
.dm-entry-actor { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.dm-entry-time { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.4); margin-left: auto; }
.dm-entry-del { border: none; background: none; color: rgba(var(--v-theme-on-surface), 0.35); cursor: pointer; padding: 2px; border-radius: 6px; }
.dm-entry-del:hover { color: #ef4444; background: rgba(239,68,68,0.1); }
.dm-entry-text { font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85); margin-top: 3px; white-space: pre-wrap; word-break: break-word; }
.dm-promise-card { margin-top: 6px; padding: 10px 12px; border-radius: 10px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); }
.dm-promise-line { display: flex; align-items: center; gap: 6px; font-size: 13.5px; flex-wrap: wrap; }
.dm-promise-pays { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 4px; }

.dm-ps { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
.ps--pending { background: rgba(245,158,11,0.15); color: #b45309; }
.ps--kept { background: rgba(16,185,129,0.15); color: #047857; }
.ps--late { background: rgba(249,115,22,0.15); color: #c2410c; }
.ps--broken { background: rgba(239,68,68,0.15); color: #dc2626; }
.ps--superseded { background: rgba(148,163,184,0.18); color: #64748b; }
.dm-promise-item-paid--late, .dm-promise-paid--late { color: #c2410c; }

/* Композер */
.dm-composer { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08); padding: 10px 20px 16px; }
.dm-type-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.dm-type-chip { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 999px; border: 1px solid rgba(var(--v-theme-on-surface), 0.14); background: transparent; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; }
.dm-type-chip.active { background: rgba(var(--v-theme-primary), 0.12); border-color: rgba(var(--v-theme-primary), 0.4); color: rgb(var(--v-theme-primary)); font-weight: 600; }
.dm-composer-row { display: flex; gap: 8px; align-items: flex-end; }
.dm-composer-input { flex: 1; resize: none; border-radius: 10px; padding: 9px 12px; font-size: 14px; border: 1px solid rgba(var(--v-theme-on-surface), 0.16); background: rgb(var(--v-theme-surface)); color: inherit; outline: none; }
.dm-composer-input:focus { border-color: rgb(var(--v-theme-primary)); }
.dm-send { width: 40px; height: 40px; border-radius: 10px; border: none; background: rgb(var(--v-theme-primary)); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.dm-send:disabled { opacity: 0.4; cursor: not-allowed; }
.dm-error { padding: 0 20px 12px; color: #ef4444; font-size: 12.5px; }

/* Мобилка: модалка на весь экран */
@media (max-width: 780px) {
  .dm-card { max-height: none; height: 100%; }
  .dm-timeline { min-height: 160px; }
  .dm-hero-product { max-width: 200px; }
}
</style>
