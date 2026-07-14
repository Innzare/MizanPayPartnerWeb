<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useIsMobile } from '@/composables/useIsMobile'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useCashBoxesStore } from '@/stores/cashboxes'
import CoInvestorRemoveDialog from '@/components/CoInvestorRemoveDialog.vue'
import { formatCurrency, formatDate, formatPhone, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { PAYOUT_SCHEDULE_LABELS, type CoInvestorJournalEntry, type CoInvestorSummary } from '@/types'

// The cashier detail of ONE co-investor. Reused by the mobile full-page route
// (`/co-investors/:id`) and by the desktop master-detail right pane. The parent
// remounts it via `:key="id"` on selection, so `onMounted(loadAll)` re-runs and
// no state (dialogs, payIdemKey, journal filters) leaks between investors.
const props = defineProps<{ id: string }>()
// Emitted after a confirmed dividend payout so the parent list can refresh its
// balances. (Token regen / journal filters don't affect the list — no emit.)
const emit = defineEmits<{ changed: [] }>()

const router = useRouter()
const toast = useToast()
const { isDark } = useIsDark()
const { isMobile } = useIsMobile()
const { fetchSummary, fetchJournal, payDividends, adjustCapital, reinvest, cancelCapital, cancelDividend, fetchDetail, removeStake } = useCoInvestors()
const cashboxesStore = useCashBoxesStore()

const id = computed(() => props.id)
const tab = ref<'cashier' | 'deals' | 'payouts'>('cashier')

// Single "Действия" dropdown collapsing all cashier actions. Closed on
// each item click (v-model → false) so the menu doesn't linger open.
const actionsMenu = ref(false)

// ── State ──

const loading = ref(true)
const summary = ref<CoInvestorSummary | null>(null)
const detail = ref<any>(null)
const journal = ref<CoInvestorJournalEntry[]>([])
const journalLoading = ref(false)
const journalTypes = ref<string[]>([]) // empty = all
// id записи журнала, отмена которой сейчас выполняется (для дизейбла кнопки)
const cancellingId = ref<string | null>(null)

// ── «В работе» breakdown modal: shows which active deals contribute to
// activeDeployment + how the CI's per-deal stake is computed from purchase
// price × effective profit %. Mirrors backend's getCoInvestorSummary.
const showActiveBreakdown = ref(false)
// Раскрытие строк активных сделок в модалке «В работе»
const expandedActiveDeals = ref<Set<string>>(new Set())
function toggleActiveDeal(id: string) {
  const n = new Set(expandedActiveDeals.value)
  n.has(id) ? n.delete(id) : n.add(id)
  expandedActiveDeals.value = n
}

// ── Share link dialog: shows the public read-only URL the partner can
// send to the investor. Regenerating rotates the token (old URL 404s).
const showShareDialog = ref(false)
const regenerating = ref(false)
const copied = ref(false)
const shareUrl = computed(() => {
  const t = detail.value?.shareToken
  if (!t) return ''
  return `${window.location.origin}/investor/${t}`
})

function openShareDialog() {
  copied.value = false
  showShareDialog.value = true
}

async function copyShareUrl() {
  if (!shareUrl.value) return
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // fallback: select the text
  }
}

async function regenerateToken() {
  if (!detail.value) return
  if (!confirm('Создать новую ссылку? Старая перестанет работать.')) return
  regenerating.value = true
  try {
    const res = await api.post<{ id: string; shareToken: string }>(`/co-investors/${detail.value.id}/regenerate-share-token`, {})
    detail.value.shareToken = res.shareToken
    copied.value = false
  } catch (e: any) {
    toast.error(e.message || 'Не удалось обновить ссылку')
  } finally {
    regenerating.value = false
  }
}

// ── Pay dividends dialog ──
const payDialog = ref(false)
const paying = ref(false)
const payForm = ref({ amount: 0, note: '', date: '' })
// v-maska не переформатирует поле при программной установке модели (клик по
// «Выплатить полностью»). Инкремент ключа форсит ре-рендер инпута — маска
// пересчитывает отображение из нового amount, ручной ввод не ломается.
const payAmountKey = ref(0)
// idemKey generated once when dialog opens — survives across submit retries
// (timeout/refresh) so a 504 that actually committed server-side won't be
// re-paid. Reset to '' on close so reopening produces a fresh key.
const payIdemKey = ref('')

// Выплата может превысить причитающиеся дивиденды — тогда излишек снимается из
// капитала инвестора. Жёсткий потолок: дивиденды к выплате + весь капитал.
const payMax = computed(() =>
  summary.value ? summary.value.balanceOwed + summary.value.currentCapital : 0,
)
// Сколько из введённой суммы уйдёт сверх дивидендов (из капитала).
const payFromCapital = computed(() =>
  summary.value ? Math.max(0, payForm.value.amount - summary.value.balanceOwed) : 0,
)
// Сумма превышает потолок (дивиденды + капитал) — операцию нужно запретить.
const payExceedsMax = computed(() =>
  summary.value ? payForm.value.amount > payMax.value : false,
)

// ── Avatar helpers ──
const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#047857', '#3b82f6', '#0ea5e9', '#ec4899', '#f59e0b']
function getAvatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}

// ── Fetch ──

async function loadAll() {
  loading.value = true
  try {
    const [s, d] = await Promise.all([
      fetchSummary(id.value),
      fetchDetail(id.value),
      // Cashboxes are needed for the hero badge + future move flow.
      // Skip if store is already populated.
      cashboxesStore.items.length === 0 ? cashboxesStore.fetchAll() : Promise.resolve(),
    ])
    summary.value = s
    detail.value = d
    await loadJournal()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить данные')
  } finally {
    loading.value = false
  }
}

// Phase 2: the cashbox this CI lives in. Read from detail.cashBoxId (returned
// by the backend findById) and resolved through the cashboxes store cache.
const ciCashBox = computed(() => {
  const cbId = detail.value?.cashBoxId
  if (!cbId) return null
  return cashboxesStore.items.find((b) => b.id === cbId) ?? null
})

async function loadJournal() {
  journalLoading.value = true
  try {
    const res = await fetchJournal(id.value, {
      types: journalTypes.value.length ? journalTypes.value : undefined,
      limit: 200,
    })
    journal.value = res.entries
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки журнала')
  } finally {
    journalLoading.value = false
  }
}

onMounted(loadAll)

// ── Computed ──

const dealsList = computed(() => detail.value?.dealsList ?? [])

// Next planned payout date — partner-scheduled marker. Highlighted red if
// the date is already past (cron doesn't auto-shift; partner needs to act).
const nextPayoutOverdue = computed(() => {
  const d = summary.value?.coInvestor.nextPayoutDate
  if (!d) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return new Date(d) < today
})

const nextPayoutSub = computed(() => {
  const d = summary.value?.coInvestor.nextPayoutDate
  if (!d) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(d); target.setHours(0, 0, 0, 0)
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff < 0) return `Просрочено на ${Math.abs(diff)} ${pluralDays(Math.abs(diff))}`
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Завтра'
  return `Через ${diff} ${pluralDays(diff)}`
})

function pluralDays(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'день'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дня'
  return 'дней'
}

const payoutScheduleLabel = computed(() => {
  const s = (detail.value as any)?.payoutSchedule ?? summary.value?.coInvestor?.payoutSchedule
  return s ? PAYOUT_SCHEDULE_LABELS[s as keyof typeof PAYOUT_SCHEDULE_LABELS] : null
})

// «История выплат» — только реальные выплаты кэшем. Реинвест тоже пишется как
// DIVIDEND_PAID (meta.reason='reinvest'), но деньги из кассы не выходят —
// исключаем его, иначе история выплат завышена и показывает «выдано на руки».
const dividendsList = computed(() =>
  journal.value.filter((e) => e.type === 'DIVIDEND_PAID' && !isReinvestDividend(e))
)

// ── Pay dividends ──

function openPayDialog() {
  if (!summary.value) return
  payForm.value = {
    amount: summary.value.balanceOwed,
    note: '',
    date: new Date().toISOString().slice(0, 10),
  }
  // Generate idemKey only when there isn't one already pending. If a
  // previous submit timed out (504) without a confirmed success, the same
  // key persists across reopens so the server's idempotency catches the
  // duplicate even after the user closed and reopened the dialog. Cleared
  // only when payDividends returns successfully.
  if (!payIdemKey.value) {
    payIdemKey.value = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  }
  payDialog.value = true
}

function closePayDialog() {
  // Don't clear payIdemKey here — see openPayDialog comment. The key sticks
  // until a server-confirmed success or a full page reload.
  payDialog.value = false
}

async function submitDividends() {
  if (!summary.value) return
  if (payForm.value.amount <= 0) return toast.error('Сумма должна быть положительной')
  if (payForm.value.amount > payMax.value) {
    return toast.error(
      `Максимум ${formatCurrency(payMax.value)} — дивиденды (${formatCurrency(summary.value.balanceOwed)}) плюс капитал (${formatCurrency(summary.value.currentCapital)})`,
    )
  }
  // Выплата сверх причитающихся дивидендов затрагивает капитал инвестора —
  // подтверждаем явно, чтобы не снять капитал по ошибке.
  if (payFromCapital.value > 0) {
    if (!confirm(`Сумма превышает причитающиеся дивиденды. Из капитала инвестора будет снято ${formatCurrency(payFromCapital.value)}. Продолжить?`)) return
  }
  paying.value = true
  try {
    summary.value = await payDividends(id.value, {
      amount: payForm.value.amount,
      note: payForm.value.note.trim() || undefined,
      date: payForm.value.date || undefined,
      idemKey: payIdemKey.value,
    })
    // Confirmed success — invalidate the idemKey so the next dialog open
    // starts a fresh idempotency scope.
    payIdemKey.value = ''
    closePayDialog()
    toast.success('Дивиденды выплачены')
    await loadJournal()
    // Let the parent (desktop list / summary cards) refresh its balances.
    emit('changed')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка выплаты')
  } finally {
    paying.value = false
  }
}

// ── Capital operations: пополнить / снять / реинвестировать ──
// Одна модалка на все три режима — заголовок, поля и подсказки меняются по mode.
type CapitalMode = 'topup' | 'withdraw' | 'reinvest'
const capitalDialog = ref(false)
const capitalMode = ref<CapitalMode>('topup')
const capitalSaving = ref(false)
const capitalForm = ref({ amount: 0, note: '' })
// См. payAmountKey — форсит ре-рендер инпута суммы после «Снять всё» / «Реинвест всё».
const capitalAmountKey = ref(0)

const capitalTitle = computed(() => ({
  topup: 'Пополнить капитал',
  withdraw: 'Снять капитал',
  reinvest: 'Реинвестировать дивиденды',
}[capitalMode.value]))

// Лимит для текущего режима: снятие ≤ currentCapital, реинвест ≤ balanceOwed.
const capitalLimit = computed(() => {
  if (!summary.value) return 0
  if (capitalMode.value === 'withdraw') return summary.value.currentCapital
  if (capitalMode.value === 'reinvest') return summary.value.balanceOwed
  return Infinity
})

// Новый капитал после операции (для наглядной подсказки).
const capitalProjected = computed(() => {
  if (!summary.value) return 0
  const a = capitalForm.value.amount || 0
  if (capitalMode.value === 'withdraw') return summary.value.currentCapital - a
  // topup и reinvest — оба увеличивают капитал.
  return summary.value.currentCapital + a
})

function openCapitalDialog(mode: CapitalMode) {
  capitalMode.value = mode
  capitalForm.value = { amount: 0, note: '' }
  capitalDialog.value = true
}

function closeCapitalDialog() {
  capitalDialog.value = false
}

async function submitCapital() {
  if (!summary.value) return
  const amount = capitalForm.value.amount || 0
  if (amount <= 0) return toast.error('Сумма должна быть положительной')
  if (capitalMode.value === 'withdraw' && amount > summary.value.currentCapital) {
    return toast.error(`Не больше текущего капитала: ${formatCurrency(summary.value.currentCapital)}`)
  }
  if (capitalMode.value === 'reinvest' && amount > summary.value.balanceOwed) {
    return toast.error(`Не больше остатка к выплате: ${formatCurrency(summary.value.balanceOwed)}`)
  }
  capitalSaving.value = true
  try {
    if (capitalMode.value === 'reinvest') {
      summary.value = await reinvest(id.value, amount)
    } else {
      const signed = capitalMode.value === 'withdraw' ? -amount : amount
      summary.value = await adjustCapital(id.value, signed, capitalForm.value.note)
    }
    closeCapitalDialog()
    toast.success({
      topup: 'Капитал пополнен',
      withdraw: 'Капитал снят',
      reinvest: 'Дивиденды реинвестированы',
    }[capitalMode.value])
    await loadJournal()
    emit('changed')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось выполнить операцию')
  } finally {
    capitalSaving.value = false
  }
}

// ── Remove this stake from the cashbox ──
// The identity (person) is NOT deleted — only this per-cashbox stake. On
// success we emit `changed` so the parent (person page) reloads: the tab
// disappears, or if it was the last active cashbox the parent routes away.
const removeDialog = ref(false)
const removing = ref(false)

async function confirmRemoveStake(opts: { mode: 'full' | 'exclude'; unpaid?: 'keep' | 'writeoff' }) {
  removing.value = true
  try {
    await removeStake(id.value, opts)
    removeDialog.value = false
    toast.success(opts.mode === 'full' ? 'Инвестор удалён из кассы' : 'Инвестор исключён из кассы')
    emit('changed')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить из кассы')
  } finally {
    removing.value = false
  }
}

// ── CSV download ──

async function downloadStatement() {
  try {
    const API_URL = import.meta.env.VITE_API_URL as string
    const token = localStorage.getItem('access_token')
    const res = await fetch(`${API_URL}/co-investors/${id.value}/statement.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('Ошибка скачивания')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${detail.value?.name ?? 'co-investor'}-statement.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось скачать выписку')
  }
}

// ── Helpers ──

const TYPE_META: Record<string, { label: string; color: string; icon: string; sign: 1 | -1 }> = {
  CAPITAL_IN: { label: 'Пополнение капитала', color: '#3b82f6', icon: 'mdi-arrow-down-circle-outline', sign: 1 },
  CAPITAL_OUT: { label: 'Снятие капитала', color: '#ef4444', icon: 'mdi-arrow-up-circle-outline', sign: -1 },
  PROFIT_ACCRUED: { label: 'Начисление прибыли', color: '#047857', icon: 'mdi-trending-up', sign: 1 },
  DIVIDEND_PAID: { label: 'Выплата дивидендов', color: '#7c3aed', icon: 'mdi-cash-multiple', sign: -1 },
}

// Reversal entries have the same `type` as the original (e.g. unmarking a
// payment writes a negative PROFIT_ACCRUED with meta.reversal=true). Without
// distinguishing them in the UI, every cancelled accrual would still read
// "Начисление прибыли" — confusing. Detect via meta.reversal or by an
// amount sign that contradicts the type's natural direction.
function isReversal(e: { type: string; amount: number; meta?: unknown }): boolean {
  const m = e.meta as { reversal?: boolean } | null | undefined
  if (m && m.reversal === true) return true
  const sign = TYPE_META[e.type]?.sign ?? 1
  // Contradicts natural direction → reversal of the opposite operation.
  return (sign === 1 && e.amount < 0) || (sign === -1 && e.amount > 0)
}

// Реинвест пишется как CAPITAL_IN и DIVIDEND_PAID с note «Реинвестирование
// дивидендов». Показываем обе строки как «Реинвестирование» с отдельной иконкой.
const REINVEST_NOTE = 'Реинвестирование дивидендов'
function isReinvest(e: { type: string; note?: string | null }): boolean {
  return (e.type === 'CAPITAL_IN' || e.type === 'DIVIDEND_PAID') && e.note === REINVEST_NOTE
}

function entryMeta(e: { type: string; amount: number; note?: string | null; meta?: unknown }) {
  const base = TYPE_META[e.type] ?? { label: e.type, color: '#71717a', icon: 'mdi-circle', sign: 1 }
  if (isReinvest(e)) {
    // CAPITAL_IN (+) — капитал вырос; DIVIDEND_PAID (−) — «к выплате» уменьшилось.
    return {
      label: e.type === 'CAPITAL_IN' ? 'Реинвестирование (в капитал)' : 'Реинвестирование (из выплат)',
      color: '#6366f1',
      icon: 'mdi-refresh-auto',
      sign: base.sign,
    }
  }
  if (!isReversal(e)) return base
  // Reversal: rephrase, flip colour to red, swap icon for an "undo" cue.
  const reversalLabels: Record<string, string> = {
    PROFIT_ACCRUED: 'Отмена начисления прибыли',
    DIVIDEND_PAID: 'Отмена выплаты дивидендов',
    CAPITAL_IN: 'Отмена пополнения капитала',
    CAPITAL_OUT: 'Возврат снятия капитала',
  }
  return {
    label: reversalLabels[e.type] ?? `Отмена: ${base.label.toLowerCase()}`,
    color: '#ef4444',
    icon: 'mdi-undo-variant',
    sign: base.sign,
  }
}

function formatSigned(amount: number) {
  if (amount === 0) return '0 ₽'
  return (amount > 0 ? '+' : '') + formatCurrency(amount)
}

// ── Отмена операции ──
// Отменяемы «живые» записи:
//  • CAPITAL_IN / CAPITAL_OUT — пополнение/снятие капитала (кроме реинвест-строк
//    и откатов; их капитал завязан на дивиденды).
//  • DIVIDEND_PAID — выплата дивидендов ИЛИ реинвест (обе отменяемы через
//    отдельный эндпоинт; кроме откатов).
// Дивидендная строка реинвеста — DIVIDEND_PAID с meta.reason==='reinvest' или
// note «Реинвестирование дивидендов». CAPITAL_IN реинвеста кнопки НЕ получает.
function isDividendEntry(e: { type: string }): boolean {
  return e.type === 'DIVIDEND_PAID'
}

function isReinvestDividend(e: { type: string; note?: string | null; meta?: unknown }): boolean {
  if (e.type !== 'DIVIDEND_PAID') return false
  const m = e.meta as { reason?: string } | null | undefined
  return m?.reason === 'reinvest' || e.note === REINVEST_NOTE
}

function canCancelEntry(e: { type: string; amount: number; note?: string | null; meta?: unknown }): boolean {
  if (isReversal(e)) return false
  if (e.type === 'DIVIDEND_PAID') return true
  if (e.type !== 'CAPITAL_IN' && e.type !== 'CAPITAL_OUT') return false
  if (isReinvest(e)) return false
  const m = e.meta as { reason?: string } | null | undefined
  if (m?.reason === 'reinvest') return false
  return true
}

async function cancelEntry(e: CoInvestorJournalEntry) {
  if (cancellingId.value) return
  const dividend = isDividendEntry(e)
  const confirmText = dividend
    ? (isReinvestDividend(e)
        ? `Отменить реинвестирование? Сумма (${formatCurrency(Math.abs(e.amount))}) снова станет причитающейся к выплате, а текущий капитал инвестора уменьшится на неё.`
        : 'Отменить выплату дивидендов? Сумма снова станет причитающейся к выплате.')
    : 'Отменить операцию? Капитал вернётся к прежнему значению.'
  if (!confirm(confirmText)) return
  cancellingId.value = e.id
  try {
    summary.value = dividend
      ? await cancelDividend(id.value, e.id)
      : await cancelCapital(id.value, e.id)
    toast.success('Операция отменена')
    await loadJournal()
    emit('changed')
  } catch (err: any) {
    toast.error(err.message || 'Не удалось отменить операцию')
  } finally {
    cancellingId.value = null
  }
}

const DEAL_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Активна', COMPLETED: 'Завершена', CANCELLED: 'Отменена',
}
const DEAL_STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#047857', COMPLETED: '#3b82f6', CANCELLED: '#71717a',
}

function pluralDeals(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'сделка'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'сделки'
  return 'сделок'
}
</script>

<template>
  <div class="ci-cashier" :class="{ dark: isDark }">
    <div v-if="loading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else-if="summary && detail">
      <!-- Header card -->
      <v-card rounded="lg" elevation="0" border class="hero-card pa-5 mb-4">
        <div class="hero-row">
          <div class="hero-avatar" :style="{ background: getAvatarColor(detail.name) }">
            {{ getInitials(detail.name) }}
          </div>
          <div class="hero-identity">
            <div class="hero-name">{{ detail.name }}</div>
            <div class="hero-meta">
              <span v-if="detail.phone">{{ formatPhone(detail.phone) }}</span>
              <span v-if="detail.phone" class="hero-meta-dot">·</span>
              <span>{{ dealsList.length }} {{ pluralDeals(dealsList.length) }}</span>
              <span class="hero-meta-dot">·</span>
              <span>с {{ formatDate(detail.createdAt) }}</span>
            </div>
          </div>
          <div class="hero-actions">
            <!-- All cashier actions collapsed into a single "Действия" menu,
                 patterned after the header "Создать" dropdown. Extra items
                 (add-to-cashbox / delete-investor) are injected by the parent
                 via the menu-primary / menu-danger slots as <button class="ci-menu-item">. -->
            <v-menu v-model="actionsMenu" offset="8">
              <template #activator="{ props: menuProps }">
                <button class="ci-actions-btn" v-bind="menuProps" title="Действия">
                  <v-icon icon="mdi-cog-outline" size="18" />
                  Действия
                  <v-icon icon="mdi-chevron-down" size="16" class="ci-actions-btn-chevron" />
                </button>
              </template>
              <div class="ci-menu">
                <button
                  class="ci-menu-item ci-menu-item--accent"
                  :disabled="summary.balanceOwed <= 0"
                  @click="actionsMenu = false; openPayDialog()"
                >
                  <v-icon icon="mdi-cash-multiple" size="18" />
                  <span>Выплатить дивиденды</span>
                </button>
                <button
                  class="ci-menu-item"
                  :disabled="summary.balanceOwed <= 0"
                  @click="actionsMenu = false; openCapitalDialog('reinvest')"
                >
                  <v-icon icon="mdi-refresh-auto" size="18" />
                  <span>Реинвестировать дивиденды</span>
                </button>
                <div class="ci-menu-divider" />
                <button class="ci-menu-item" @click="actionsMenu = false; openCapitalDialog('topup')">
                  <v-icon icon="mdi-bank-transfer" size="18" />
                  <span>Капитал: пополнить / снять</span>
                </button>
                <!-- Родитель кладёт сюда «Добавить в кассу» -->
                <slot name="menu-primary" />
                <div class="ci-menu-divider" />
                <button class="ci-menu-item" @click="actionsMenu = false; openShareDialog()">
                  <v-icon icon="mdi-share-variant-outline" size="18" />
                  <span>Поделиться</span>
                </button>
                <button class="ci-menu-item" @click="actionsMenu = false; downloadStatement()">
                  <v-icon icon="mdi-download-outline" size="18" />
                  <span>Скачать CSV</span>
                </button>
                <div class="ci-menu-divider" />
                <button class="ci-menu-item ci-menu-item--danger" @click="actionsMenu = false; removeDialog = true">
                  <v-icon icon="mdi-account-remove-outline" size="18" />
                  <span>Удалить из кассы</span>
                </button>
                <!-- Родитель кладёт сюда «Удалить инвестора» -->
                <slot name="menu-danger" />
              </div>
            </v-menu>
          </div>
        </div>

        <!-- Summary stats grid -->
        <div class="hero-stats mt-5">
          <div class="hero-stat">
            <div class="hero-stat-label">Текущий капитал</div>
            <div class="hero-stat-value" style="color: #3b82f6;">{{ formatCurrency(summary.currentCapital) }}</div>
          </div>
          <button
            class="hero-stat hero-stat--clickable"
            :disabled="summary.activeDealsCount === 0"
            @click="showActiveBreakdown = true"
          >
            <div class="hero-stat-label">В работе</div>
            <div class="hero-stat-value" style="color: #0ea5e9;">{{ formatCurrency(summary.activeDeployment) }}</div>
            <div class="hero-stat-sub">{{ summary.activeDealsCount }} {{ pluralDeals(summary.activeDealsCount) }}</div>
            <div v-if="summary.activeDealsCount > 0" class="hero-stat-action">
              Подробнее
              <v-icon icon="mdi-arrow-right" size="12" />
            </div>
          </button>
          <div class="hero-stat">
            <div class="hero-stat-label">Начислено прибыли</div>
            <div class="hero-stat-value" style="color: #047857;">{{ formatCurrency(summary.realizedProfit) }}</div>
          </div>
          <div class="hero-stat">
            <div class="hero-stat-label">Выплачено дивидендов</div>
            <div class="hero-stat-value" style="color: #7c3aed;">{{ formatCurrency(summary.totalPayout) }}</div>
          </div>
          <div class="hero-stat hero-stat--accent">
            <div class="hero-stat-label">Остаток к выплате</div>
            <div class="hero-stat-value" style="color: #f59e0b;">{{ formatCurrency(summary.balanceOwed) }}</div>
          </div>
        </div>

        <!-- Participation parameters: cashbox, share type, payout schedule -->
        <div class="hero-params mt-5">
          <router-link
            v-if="ciCashBox"
            :to="`/cashboxes/${ciCashBox.id}`"
            class="hero-param hero-param--clickable"
            :style="{
              borderColor: ciCashBox.color + '40',
              background: ciCashBox.color + '0d',
            }"
          >
            <div class="hero-param-icon" :style="{ background: ciCashBox.color, color: '#fff' }">
              <v-icon :icon="ciCashBox.icon" size="20" />
            </div>
            <div class="hero-param-body">
              <div class="hero-param-label">Касса</div>
              <div class="hero-param-value">{{ ciCashBox.name }}</div>
              <div class="hero-param-sub">Открыть кассу</div>
            </div>
            <v-icon icon="mdi-arrow-top-right" size="16" class="hero-param-arrow" />
          </router-link>

          <div
            class="hero-param"
            :class="detail.costFeeMode ? 'hero-param--costfee' : (detail.profitPercent != null && detail.profitPercent > 0 ? 'hero-param--fixed' : 'hero-param--weight')"
          >
            <div class="hero-param-icon">
              <v-icon
                :icon="detail.costFeeMode ? 'mdi-tag-outline' : (detail.profitPercent != null && detail.profitPercent > 0 ? 'mdi-handshake-outline' : 'mdi-scale-balance')"
                size="20"
              />
            </div>
            <div class="hero-param-body">
              <div class="hero-param-label">Доля прибыли</div>
              <div class="hero-param-value">
                <template v-if="detail.costFeeMode">Комиссия от закупки</template>
                <template v-else-if="detail.profitPercent != null && detail.profitPercent > 0">
                  Фикс {{ detail.profitPercent }}%
                </template>
                <template v-else>
                  По вкладу капитала
                </template>
              </div>
              <div class="hero-param-sub">
                <template v-if="detail.costFeeMode">
                  Вы финансируете закупку и получаете всю сумму сделки за вычетом комиссии партнёра (ставка% × закупка) — возврат вашего капитала плюс остаток наценки<template v-if="detail.costFeeDefaultRatePct != null"> (по умолчанию {{ detail.costFeeDefaultRatePct }}%)</template>
                </template>
                <template v-else>Фактическая доля {{ summary.effectivePct.toFixed(2) }}% от прибыли кассы</template>
              </div>
            </div>
          </div>

          <div
            v-if="(detail.profitPercent == null || detail.profitPercent === 0) && (detail.managementFeePct ?? 0) > 0"
            class="hero-param hero-param--fixed"
          >
            <div class="hero-param-icon">
              <v-icon icon="mdi-briefcase-outline" size="20" />
            </div>
            <div class="hero-param-body">
              <div class="hero-param-label">Комиссия партнёра</div>
              <div class="hero-param-value">{{ detail.managementFeePct }}%</div>
              <div class="hero-param-sub">Забираете с доли инвестора по вкладу</div>
            </div>
          </div>

          <div v-if="payoutScheduleLabel" class="hero-param hero-param--schedule">
            <div class="hero-param-icon">
              <v-icon icon="mdi-calendar-clock" size="20" />
            </div>
            <div class="hero-param-body">
              <div class="hero-param-label">Периодичность выплат</div>
              <div class="hero-param-value">{{ payoutScheduleLabel }}</div>
              <div class="hero-param-sub">Как часто планируется выплачивать дивиденды</div>
            </div>
          </div>

          <div
            v-if="summary.coInvestor.nextPayoutDate"
            class="hero-param"
            :class="nextPayoutOverdue ? 'hero-param--overdue' : 'hero-param--next'"
          >
            <div class="hero-param-icon">
              <v-icon :icon="nextPayoutOverdue ? 'mdi-calendar-alert' : 'mdi-calendar-star'" size="20" />
            </div>
            <div class="hero-param-body">
              <div class="hero-param-label">Следующая выплата</div>
              <div class="hero-param-value">{{ formatDate(summary.coInvestor.nextPayoutDate) }}</div>
              <div class="hero-param-sub">{{ nextPayoutSub }}</div>
            </div>
          </div>
        </div>

        <!-- Where the effective % comes from (by-capital investors) -->
        <div v-if="summary.shareBreakdown && summary.shareBreakdown.mode === 'weight'" class="active-formula mt-5">
          <div class="active-formula-title">
            <v-icon icon="mdi-function-variant" size="14" />
            Откуда доля {{ summary.shareBreakdown.effectivePct }}%
          </div>
          <div class="active-formula-body">
            <div class="share-line">
              <span class="share-line-n">1</span>
              <span>
                Капитал инвестора <strong>{{ formatCurrency(summary.shareBreakdown.capital) }}</strong>
                из общего пула <strong>{{ formatCurrency(summary.shareBreakdown.poolCapital) }}</strong><template v-if="summary.shareBreakdown.partnerParticipates || summary.shareBreakdown.otherCICapital > 0"> (<template v-if="summary.shareBreakdown.partnerParticipates">ваш капитал {{ formatCurrency(summary.shareBreakdown.partnerCapital) }}</template><template v-if="summary.shareBreakdown.partnerParticipates && summary.shareBreakdown.otherCICapital > 0"> + </template><template v-if="summary.shareBreakdown.otherCICapital > 0">другие инвесторы {{ formatCurrency(summary.shareBreakdown.otherCICapital) }}</template> + этот инвестор {{ formatCurrency(summary.shareBreakdown.capital) }})</template>
                <template v-if="summary.shareBreakdown.hasFixedInvestors"> — из остатка {{ summary.shareBreakdown.remainingPct }}% после фикс-инвесторов</template>
                = <strong>{{ summary.shareBreakdown.grossPct }}%</strong> по вкладу
              </span>
            </div>
            <div v-if="summary.shareBreakdown.commissionPct > 0" class="share-line">
              <span class="share-line-n">2</span>
              <span>
                Минус ваша комиссия <strong>{{ summary.shareBreakdown.commissionPct }}%</strong>
                → инвестору остаётся <strong>{{ summary.shareBreakdown.effectivePct }}%</strong> от прибыли кассы
              </span>
            </div>
            <div v-else class="share-line">
              <span class="share-line-n">✓</span>
              <span>Комиссии нет — инвестор получает все <strong>{{ summary.shareBreakdown.effectivePct }}%</strong></span>
            </div>
          </div>
        </div>

        <!-- Cost-fee explanation -->
        <div v-if="summary.shareBreakdown && summary.shareBreakdown.mode === 'cost_fee'" class="active-formula mt-5">
          <div class="active-formula-title">
            <v-icon icon="mdi-tag-outline" size="14" />
            Комиссия от закупки
          </div>
          <div class="active-formula-body">
            На каждой сделке партнёр берёт <strong>ставку % × закупочную цену</strong>. Инвестор финансирует закупку сам и
            получает <strong>всю сумму сделки за вычетом этой комиссии</strong> — возврат своего капитала плюс остаток наценки<template v-if="summary.shareBreakdown.defaultRatePct != null"> (ставка по умолчанию <strong>{{ summary.shareBreakdown.defaultRatePct }}%</strong>, задаётся под срок на каждой сделке)</template>.
            Конкретные суммы по активным сделкам — в разделе «В работе».
          </div>
        </div>
      </v-card>

      <!-- Tabs -->
      <div class="tabs mb-3">
        <button
          class="tab"
          :class="{ 'tab--active': tab === 'cashier' }"
          @click="tab = 'cashier'"
        >
          <v-icon icon="mdi-wallet-outline" size="16" /> Касса
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': tab === 'deals' }"
          @click="tab = 'deals'"
        >
          <v-icon icon="mdi-briefcase-outline" size="16" /> Сделки
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': tab === 'payouts' }"
          @click="tab = 'payouts'"
        >
          <v-icon icon="mdi-cash-multiple" size="16" /> Выплаты
        </button>
      </div>

      <!-- Cashier tab -->
      <v-card v-if="tab === 'cashier'" rounded="lg" elevation="0" border class="pa-4">
        <div class="d-flex align-center ga-2 mb-3 flex-wrap">
          <span class="section-title">Журнал операций</span>
          <v-spacer />
          <div class="filter-chips">
            <button
              class="chip"
              :class="{ 'chip--active': journalTypes.length === 0 }"
              @click="journalTypes = []; loadJournal()"
            >Все</button>
            <button
              v-for="t of ['CAPITAL_IN', 'PROFIT_ACCRUED', 'DIVIDEND_PAID', 'CAPITAL_OUT'] as const"
              :key="t"
              class="chip"
              :class="{ 'chip--active': journalTypes.includes(t) }"
              @click="journalTypes = journalTypes.includes(t) ? journalTypes.filter(x => x !== t) : [...journalTypes, t]; loadJournal()"
            >{{ TYPE_META[t].label }}</button>
          </div>
        </div>

        <div v-if="journalLoading" class="d-flex justify-center pa-6">
          <v-progress-circular indeterminate size="28" color="primary" />
        </div>
        <div v-else-if="!journal.length" class="empty">
          <v-icon icon="mdi-cash-remove" size="40" color="grey" />
          <div class="empty-title">Нет операций</div>
          <div class="empty-sub">По выбранным фильтрам ничего не найдено</div>
        </div>
        <div v-else class="journal-list">
          <div v-for="e in journal" :key="e.id" class="journal-row">
            <div class="journal-icon" :style="{ background: entryMeta(e).color + '14', color: entryMeta(e).color }">
              <v-icon :icon="entryMeta(e).icon" size="18" />
            </div>
            <div class="journal-main">
              <div class="journal-title">{{ entryMeta(e).label }}</div>
              <div class="journal-meta">
                <span>{{ formatDate(e.date) }}</span>
                <span v-if="e.dealNumber"> · сделка #{{ e.dealNumber }} {{ e.dealProductName }}</span>
                <span v-if="e.note"> · {{ e.note }}</span>
              </div>
            </div>
            <div class="journal-amount" :style="{ color: e.amount >= 0 ? '#047857' : '#ef4444' }">
              {{ formatSigned(e.amount) }}
            </div>
            <button
              v-if="canCancelEntry(e)"
              class="journal-cancel"
              :disabled="cancellingId === e.id"
              title="Отменить операцию"
              @click="cancelEntry(e)"
            >
              <v-progress-circular v-if="cancellingId === e.id" indeterminate size="14" width="2" />
              <v-icon v-else icon="mdi-undo" size="16" />
            </button>
          </div>
        </div>
      </v-card>

      <!-- Deals tab: активные сделки инвестора + разбор его доли (раскрытие) -->
      <v-card v-else-if="tab === 'deals'" rounded="lg" elevation="0" border class="pa-4">
        <div class="d-flex align-center mb-3">
          <span class="section-title">Активные сделки ({{ summary.activeDealsBreakdown.length }})</span>
          <v-spacer />
          <span class="text-caption text-medium-emphasis">Доля инвестора</span>
        </div>
        <div v-if="!summary.activeDealsBreakdown.length" class="empty">
          <v-icon icon="mdi-briefcase-off-outline" size="40" color="grey" />
          <div class="empty-title">Нет активных сделок</div>
          <div class="empty-sub">Здесь появятся сделки, где участвует инвестор</div>
        </div>
        <div v-else class="active-list">
          <div v-for="d in summary.activeDealsBreakdown" :key="d.id" class="active-item">
            <!-- Header (clickable) -->
            <div class="active-row" @click="toggleActiveDeal(d.id)">
              <v-icon
                :icon="expandedActiveDeals.has(d.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                size="18"
                class="active-row-arrow"
              />
              <div class="active-row-main">
                <div class="active-row-name">
                  <span class="active-row-num">#{{ d.dealNumber }}</span>
                  {{ d.productName }}
                </div>
                <div class="active-row-meta">{{ d.modeLabel }} · {{ formatDate(d.dealDate) }}</div>
              </div>
              <div class="active-row-stake">
                <template v-if="d.costFee">
                  <div class="active-row-earn">{{ formatCurrency(d.purchasePrice + (d.costFee.investorShare ?? 0)) }}</div>
                  <div class="active-row-earn-label">получит</div>
                </template>
                <template v-else>
                  <div class="active-row-earn">+{{ formatCurrency(d.expectedProfit ?? 0) }}</div>
                  <div class="active-row-earn-label">ваша доля</div>
                </template>
              </div>
            </div>

            <!-- Expanded body -->
            <div v-if="expandedActiveDeals.has(d.id)" class="active-body">
              <template v-if="d.costFee">
                <div class="active-line">
                  <span class="active-line-label">Закупка (возврат капитала)</span>
                  <span class="active-line-val">{{ formatCurrency(d.purchasePrice) }}</span>
                </div>
                <div class="active-line">
                  <span class="active-line-label">Наценка рассрочки</span>
                  <span class="active-line-val">{{ formatCurrency(d.dealProfit ?? 0) }}</span>
                </div>
                <div class="active-line">
                  <span class="active-line-label">− Доля партнёра ({{ d.costFee.ratePct }}% от закупки)</span>
                  <span class="active-line-val">{{ formatCurrency(d.costFee.partnerFee) }}</span>
                </div>
                <div class="active-divider" />
                <div class="active-line">
                  <span class="active-line-label active-line-strong">Вам на руки</span>
                  <span class="active-line-val active-line-strong active-line-success">
                    {{ formatCurrency(d.purchasePrice + d.costFee.investorShare) }}
                  </span>
                </div>
                <div class="active-line-sub">
                  возврат {{ formatCurrency(d.purchasePrice) }} + доход {{ formatCurrency(d.costFee.investorShare) }}
                </div>
              </template>
              <template v-else>
                <div class="active-line">
                  <span class="active-line-label active-line-strong">Вся прибыль сделки</span>
                  <span class="active-line-val active-line-strong">{{ formatCurrency(d.dealProfit ?? 0) }}</span>
                </div>
                <div class="active-line">
                  <span class="active-line-label">
                    <span class="active-dot" />
                    Ваша доля
                    <span class="active-line-mode">{{ d.modeLabel }}</span>
                  </span>
                  <span class="active-line-val active-line-success">{{ formatCurrency(d.expectedProfit ?? 0) }}</span>
                </div>
              </template>

              <router-link :to="`/deals/${d.id}`" class="active-open-link">Открыть сделку →</router-link>
            </div>
          </div>
        </div>
      </v-card>

      <!-- Payouts tab -->
      <v-card v-else-if="tab === 'payouts'" rounded="lg" elevation="0" border class="pa-4">
        <div class="d-flex align-center mb-3">
          <span class="section-title">История выплат ({{ dividendsList.length }})</span>
          <v-spacer />
          <button class="pay-btn pay-btn--sm" :disabled="summary.balanceOwed <= 0" @click="openPayDialog">
            <v-icon icon="mdi-plus" size="16" />
            Новая выплата
          </button>
        </div>
        <div v-if="!dividendsList.length" class="empty">
          <v-icon icon="mdi-cash-clock" size="40" color="grey" />
          <div class="empty-title">Выплат ещё не было</div>
          <div class="empty-sub">Когда накопится сумма, выплатите дивиденды</div>
        </div>
        <div v-else class="journal-list">
          <div v-for="e in dividendsList" :key="e.id" class="journal-row">
            <div class="journal-icon" style="background: rgba(124, 58, 237, 0.10); color: #7c3aed;">
              <v-icon icon="mdi-cash-multiple" size="18" />
            </div>
            <div class="journal-main">
              <div class="journal-title">{{ e.note ?? 'Выплата дивидендов' }}</div>
              <div class="journal-meta">{{ formatDate(e.date) }}</div>
            </div>
            <div class="journal-amount" style="color: #ef4444;">
              {{ formatSigned(e.amount) }}
            </div>
          </div>
        </div>
      </v-card>
    </template>

    <!-- Share link dialog -->
    <v-dialog v-model="showShareDialog" max-width="520" :fullscreen="isMobile">
      <v-card v-if="detail" rounded="lg">
        <div class="dialog-header">
          <div>
            <div class="dialog-title">Ссылка для инвестора</div>
            <div class="text-caption text-medium-emphasis mt-1">
              Пришлите эту ссылку — инвестор увидит свой капитал, прибыль и журнал. Только просмотр.
            </div>
          </div>
          <button class="dialog-close" @click="showShareDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
        <div class="pa-5">
          <div v-if="!detail?.shareToken" class="share-warning mb-3">
            <v-icon icon="mdi-alert-circle-outline" size="16" />
            <div>
              У этого инвестора ещё нет ссылки. Нажмите «Пересоздать ссылку»
              — мы сгенерируем токен и URL появится здесь.
            </div>
          </div>
          <div v-else class="share-url-wrap mb-3">
            <input
              :value="shareUrl"
              readonly
              class="share-url-input"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <button class="share-copy-btn" :class="{ 'share-copy-btn--done': copied }" @click="copyShareUrl">
              <v-icon :icon="copied ? 'mdi-check' : 'mdi-content-copy'" size="16" />
              {{ copied ? 'Скопировано' : 'Копировать' }}
            </button>
          </div>
          <div class="share-warning mb-4">
            <v-icon icon="mdi-shield-alert-outline" size="16" />
            <div>
              Любой, у кого есть ссылка, увидит данные инвестора. Если ссылка попала не туда —
              <button class="share-warning-link" @click="regenerateToken">создайте новую</button>,
              старая перестанет работать.
            </div>
          </div>
          <div class="d-flex justify-end ga-2">
            <button class="ghost-btn" :disabled="regenerating" @click="regenerateToken">
              <v-icon icon="mdi-refresh" size="16" />
              {{ regenerating ? 'Обновление...' : 'Пересоздать ссылку' }}
            </button>
            <button class="ghost-btn ghost-btn--primary" @click="showShareDialog = false">Готово</button>
          </div>
        </div>
      </v-card>
    </v-dialog>

    <!-- «В работе» breakdown modal -->
    <v-dialog v-model="showActiveBreakdown" max-width="640" :fullscreen="isMobile">
      <v-card v-if="summary" rounded="lg">
        <div class="dialog-header">
          <div>
            <div class="dialog-title">Деньги в работе</div>
            <div class="text-caption text-medium-emphasis mt-1">
              Из чего складывается сумма {{ formatCurrency(summary.activeDeployment) }}
            </div>
          </div>
          <button class="dialog-close" @click="showActiveBreakdown = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <!-- Formula card -->
          <div class="active-formula mb-4">
            <div class="active-formula-title">
              <v-icon icon="mdi-function-variant" size="14" />
              Как считается
            </div>
            <div class="active-formula-body">
              <template v-if="detail.costFeeMode">
                Инвестор в режиме «комиссия от закупки» — деньги в работе равны полной закупочной цене
                активных сделок (закупка идёт на его средства). По каждой сделке ниже показан делёж наценки:
                комиссия партнёра и доля инвестора.
              </template>
              <template v-else>
                Доля инвестора в кассе — <strong>{{ summary.effectivePct.toFixed(2) }}%</strong>.
                Для каждой активной сделки берётся
                <strong>закупочная цена × {{ summary.effectivePct.toFixed(2) }}%</strong>
                — это та часть, которую вложил инвестор в эту сделку.
                Суммируем по всем активным сделкам = <strong>{{ formatCurrency(summary.activeDeployment) }}</strong>.
              </template>
            </div>
          </div>

          <!-- Deals list -->
          <div class="active-list-header">
            <span>Активные сделки ({{ summary.activeDealsCount }})</span>
            <span class="text-caption text-medium-emphasis">Доля инвестора</span>
          </div>
          <div class="active-list">
            <div
              v-for="d in summary.activeDealsBreakdown"
              :key="d.id"
              class="active-item"
            >
              <!-- Header (clickable) -->
              <div class="active-row" @click="toggleActiveDeal(d.id)">
                <v-icon
                  :icon="expandedActiveDeals.has(d.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                  size="18"
                  class="active-row-arrow"
                />
                <div class="active-row-main">
                  <div class="active-row-name">
                    <span class="active-row-num">#{{ d.dealNumber }}</span>
                    {{ d.productName }}
                  </div>
                  <div class="active-row-meta">
                    {{ d.modeLabel }} · {{ formatDate(d.dealDate) }}
                  </div>
                </div>
                <div class="active-row-stake">
                  <template v-if="d.costFee">
                    <div class="active-row-earn">{{ formatCurrency(d.purchasePrice + (d.costFee.investorShare ?? 0)) }}</div>
                    <div class="active-row-earn-label">получит</div>
                  </template>
                  <template v-else>
                    <div class="active-row-earn">+{{ formatCurrency(d.expectedProfit ?? 0) }}</div>
                    <div class="active-row-earn-label">ваша доля</div>
                  </template>
                </div>
              </div>

              <!-- Expanded body -->
              <div v-if="expandedActiveDeals.has(d.id)" class="active-body">
                <template v-if="d.costFee">
                  <div class="active-line">
                    <span class="active-line-label">Закупка (возврат капитала)</span>
                    <span class="active-line-val">{{ formatCurrency(d.purchasePrice) }}</span>
                  </div>
                  <div class="active-line">
                    <span class="active-line-label">Наценка рассрочки</span>
                    <span class="active-line-val">{{ formatCurrency(d.dealProfit ?? 0) }}</span>
                  </div>
                  <div class="active-line">
                    <span class="active-line-label">− Доля партнёра ({{ d.costFee.ratePct }}% от закупки)</span>
                    <span class="active-line-val">{{ formatCurrency(d.costFee.partnerFee) }}</span>
                  </div>
                  <div class="active-divider" />
                  <div class="active-line">
                    <span class="active-line-label active-line-strong">Вам на руки</span>
                    <span class="active-line-val active-line-strong active-line-success">
                      {{ formatCurrency(d.purchasePrice + d.costFee.investorShare) }}
                    </span>
                  </div>
                  <div class="active-line-sub">
                    возврат {{ formatCurrency(d.purchasePrice) }} + доход {{ formatCurrency(d.costFee.investorShare) }}
                  </div>
                </template>
                <template v-else>
                  <div class="active-line">
                    <span class="active-line-label active-line-strong">Вся прибыль сделки</span>
                    <span class="active-line-val active-line-strong">{{ formatCurrency(d.dealProfit ?? 0) }}</span>
                  </div>
                  <div class="active-line">
                    <span class="active-line-label">
                      <span class="active-dot" />
                      Ваша доля
                      <span class="active-line-mode">{{ d.modeLabel }}</span>
                    </span>
                    <span class="active-line-val active-line-success">{{ formatCurrency(d.expectedProfit ?? 0) }}</span>
                  </div>
                </template>

                <router-link :to="`/deals/${d.id}`" class="active-open-link">
                  Открыть сделку →
                </router-link>
              </div>
            </div>
          </div>
        </div>
      </v-card>
    </v-dialog>

    <!-- Pay dividends dialog -->
    <v-dialog v-model="payDialog" max-width="480" persistent :fullscreen="isMobile">
      <v-card rounded="lg">
        <div class="dialog-header">
          <span class="dialog-title">Выплата дивидендов</span>
          <button class="dialog-close" @click="closePayDialog">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
        <div class="pa-5">
          <div v-if="summary" class="suggest-row mb-4">
            <div>
              <div class="suggest-label">Остаток к выплате</div>
              <div class="suggest-value">{{ formatCurrency(summary.balanceOwed) }}</div>
            </div>
            <button
              class="chip chip--ghost"
              @click="payForm.amount = summary!.balanceOwed; payAmountKey++"
            >
              Выплатить полностью
            </button>
          </div>

          <div class="field mb-3">
            <label class="field-label">Сумма выплаты</label>
            <div class="field-input-wrap">
              <input
                :key="payAmountKey"
                :value="payForm.amount || ''"
                v-maska="CURRENCY_MASK"
                @maska="(e: any) => payForm.amount = parseMasked(e)"
                type="text"
                inputmode="numeric"
                class="field-input"
                placeholder="0"
              />
              <span class="field-suffix">₽</span>
            </div>
          </div>

          <!-- Превышение потолка (дивиденды + капитал) — запрет -->
          <div v-if="summary && payExceedsMax" class="pay-note pay-note--error mb-3">
            <v-icon icon="mdi-alert-circle-outline" size="16" />
            <span>
              Нельзя выплатить больше {{ formatCurrency(payMax) }} —
              это дивиденды ({{ formatCurrency(summary.balanceOwed) }})
              и весь капитал инвестора ({{ formatCurrency(summary.currentCapital) }}).
            </span>
          </div>
          <!-- Сверх дивидендов, но в пределах капитала — предупреждение -->
          <div
            v-else-if="summary && payFromCapital > 0"
            class="pay-note pay-note--warn mb-3"
          >
            <v-icon icon="mdi-alert-outline" size="16" />
            <span>
              Сумма больше причитающихся дивидендов ({{ formatCurrency(summary.balanceOwed) }}).
              Излишек {{ formatCurrency(payFromCapital) }} будет снят из капитала инвестора —
              останется {{ formatCurrency(summary.currentCapital - payFromCapital) }}.
            </span>
          </div>

          <div class="field mb-3">
            <label class="field-label">Дата</label>
            <input v-model="payForm.date" type="date" class="field-input" />
          </div>

          <div class="field">
            <label class="field-label">Комментарий</label>
            <input v-model="payForm.note" type="text" class="field-input" placeholder="Например: за март" />
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn--ghost" @click="closePayDialog" :disabled="paying">Отмена</button>
          <button class="btn btn--primary" :disabled="paying || payForm.amount <= 0 || payExceedsMax" @click="submitDividends">
            <v-progress-circular v-if="paying" indeterminate size="14" width="2" color="white" class="mr-2" />
            Выплатить
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Capital dialog: пополнить / снять / реинвестировать -->
    <v-dialog v-model="capitalDialog" max-width="480" persistent :fullscreen="isMobile">
      <v-card v-if="summary" rounded="lg">
        <div class="dialog-header">
          <span class="dialog-title">{{ capitalMode === 'reinvest' ? capitalTitle : 'Капитал' }}</span>
          <button class="dialog-close" @click="closeCapitalDialog">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
        <div class="pa-5">
          <!-- Табы Пополнить/Снять (реинвест — отдельным пунктом меню) -->
          <div v-if="capitalMode !== 'reinvest'" class="cap-tabs mb-4">
            <button
              type="button"
              class="cap-tab"
              :class="{ 'cap-tab--active': capitalMode === 'topup' }"
              @click="capitalMode = 'topup'; capitalForm.amount = 0"
            >
              <v-icon icon="mdi-arrow-down-circle-outline" size="15" /> Пополнить
            </button>
            <button
              type="button"
              class="cap-tab"
              :class="{ 'cap-tab--active': capitalMode === 'withdraw' }"
              @click="capitalMode = 'withdraw'; capitalForm.amount = 0"
            >
              <v-icon icon="mdi-arrow-up-circle-outline" size="15" /> Снять
            </button>
          </div>

          <!-- Контекст: текущий капитал (для всех) + «к выплате» для реинвеста -->
          <div class="suggest-row mb-4">
            <div>
              <div class="suggest-label">
                {{ capitalMode === 'reinvest' ? 'Остаток к выплате' : 'Текущий капитал' }}
              </div>
              <div class="suggest-value" style="color: #3b82f6;">
                {{ formatCurrency(capitalMode === 'reinvest' ? summary.balanceOwed : summary.currentCapital) }}
              </div>
            </div>
            <button
              v-if="capitalMode !== 'topup'"
              class="chip chip--ghost"
              @click="capitalForm.amount = capitalLimit; capitalAmountKey++"
            >
              {{ capitalMode === 'withdraw' ? 'Снять всё' : 'Реинвест всё' }}
            </button>
          </div>

          <div class="field mb-3">
            <label class="field-label">Сумма</label>
            <div class="field-input-wrap">
              <input
                :key="capitalAmountKey"
                :value="capitalForm.amount || ''"
                v-maska="CURRENCY_MASK"
                @maska="(e: any) => capitalForm.amount = parseMasked(e)"
                type="text"
                inputmode="numeric"
                class="field-input"
                placeholder="0"
              />
              <span class="field-suffix">₽</span>
            </div>
          </div>

          <div v-if="capitalMode !== 'reinvest'" class="field mb-3">
            <label class="field-label">Комментарий</label>
            <input v-model="capitalForm.note" type="text" class="field-input" placeholder="Например: довнесение" />
          </div>

          <!-- Наглядный итог операции -->
          <div v-if="capitalForm.amount > 0" class="cap-note" :class="`cap-note--${capitalMode}`">
            <v-icon
              :icon="capitalMode === 'withdraw' ? 'mdi-arrow-up-circle-outline' : (capitalMode === 'reinvest' ? 'mdi-refresh-auto' : 'mdi-arrow-down-circle-outline')"
              size="16"
            />
            <div>
              <template v-if="capitalMode === 'topup'">
                Вложенный капитал вырастет до <strong>{{ formatCurrency(capitalProjected) }}</strong>.
              </template>
              <template v-else-if="capitalMode === 'withdraw'">
                Капитал уменьшится до <strong>{{ formatCurrency(capitalProjected) }}</strong>.
              </template>
              <template v-else>
                Эти деньги вернутся в ваш капитал (до <strong>{{ formatCurrency(capitalProjected) }}</strong>),
                доля «по вкладу» вырастет. Деньги не выходят из кассы — «к выплате» уменьшается.
              </template>
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn--ghost" :disabled="capitalSaving" @click="closeCapitalDialog">Отмена</button>
          <button
            class="btn btn--primary"
            :disabled="capitalSaving || capitalForm.amount <= 0 || capitalForm.amount > capitalLimit"
            @click="submitCapital"
          >
            <v-progress-circular v-if="capitalSaving" indeterminate size="14" width="2" color="white" class="mr-2" />
            {{ capitalTitle }}
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Remove-from-cashbox dialog -->
    <CoInvestorRemoveDialog
      v-if="summary && detail"
      v-model="removeDialog"
      scope="stake"
      :name="detail.name"
      :balance-owed="summary.balanceOwed"
      :loading="removing"
      @confirm="confirmRemoveStake"
    />
  </div>
</template>

<style scoped>
.ci-cashier { padding: 0; }

.ghost-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px; border: 1px solid #e5e7eb;
  background: #fff; color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.ghost-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: #d1d5db;
}
.ghost-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── "Действия" trigger + dropdown (образец — хедерная кнопка «Создать») ── */
.ci-actions-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 16px;
  border-radius: 10px; border: none;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  color: #fff; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: opacity 0.2s ease;
}
.ci-actions-btn:hover { opacity: 0.9; }
.ci-actions-btn-chevron { opacity: 0.85; }

.ci-menu {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
  min-width: 240px;
  padding: 4px;
}
.ci-menu-divider {
  height: 1px; background: rgba(0, 0, 0, 0.06); margin: 4px 0;
}
/* Единый класс для своих пунктов И для слот-контента родителя. */
.ci-menu-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 10px 12px;
  border-radius: 8px; border: none; background: none;
  font-size: 13px; font-weight: 500; color: #374151;
  cursor: pointer; transition: all 0.12s ease; text-align: left;
}
.ci-menu-item:hover { background: #f9f4f0; }
.ci-menu-item:disabled { opacity: 0.45; cursor: not-allowed; }
.ci-menu-item:disabled:hover { background: none; }
.ci-menu-item--accent { color: #047857; font-weight: 600; }
.ci-menu-item--accent :deep(.v-icon) { color: #047857; }
.ci-menu-item--accent:hover { background: rgba(4, 120, 87, 0.08); }
.ci-menu-item--danger { color: #ef4444; }
.ci-menu-item--danger :deep(.v-icon) { color: #ef4444; }
.ci-menu-item--danger:hover { background: #fef2f2; }

.dark .ci-menu {
  background: #1e1e2e;
  border-color: #2e2e42;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
}
.dark .ci-menu-divider { background: #2e2e42; }
.dark .ci-menu-item { color: #a1a1aa; }
.dark .ci-menu-item:hover { background: #252538; }
.dark .ci-menu-item--accent { color: rgb(74, 222, 128); }
.dark .ci-menu-item--accent :deep(.v-icon) { color: rgb(74, 222, 128); }
.dark .ci-menu-item--accent:hover { background: rgba(74, 222, 128, 0.10); }
.dark .ci-menu-item--danger { color: #f87171; }
.dark .ci-menu-item--danger:hover { background: rgba(239, 68, 68, 0.12); }

/* Hero */
.hero-card { background: #fff; }
.hero-row {
  display: flex; align-items: center; gap: 16px;
}
.hero-avatar {
  width: 64px; height: 64px; border-radius: 16px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 22px; letter-spacing: 1px;
}
.hero-identity { flex: 1; min-width: 0; }
.hero-name {
  font-size: 22px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
  margin-bottom: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hero-meta {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap;
}
.hero-meta-dot { opacity: 0.5; }
/* Hero компактнее на мобиле — аватар поменьше, имя сжимается, кнопки
   действий идут на свою строку. */
@media (max-width: 599px) {
  .hero-avatar {
    width: 52px; height: 52px;
    border-radius: 13px;
    font-size: 18px;
  }
  .hero-name { font-size: 18px; }
  .hero-meta { font-size: 12px; gap: 4px; }
}
@media (max-width: 600px) {
  .hero-row { flex-wrap: wrap; }
  .hero-row .pay-btn { width: 100%; }
}

/* Participation parameters: cashbox, share, schedule.
   auto-fit so the grid adapts to the PANEL width (desktop right pane), not just
   the viewport — media queries wouldn't fire inside a narrow container. */
.hero-params {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px;
}
@media (max-width: 599px) {
  /* Карточки компактнее — иконка поменьше, value поменьше. */
  .hero-params { gap: 8px; }
  .hero-param { padding: 12px 14px; }
  .hero-param-icon {
    width: 36px; height: 36px; min-width: 36px;
    border-radius: 10px;
  }
  .hero-param-value { font-size: 14px; }
}
.hero-param {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
  text-decoration: none;
  color: inherit;
  transition: filter 0.15s, transform 0.15s;
}
.hero-param--clickable {
  cursor: pointer;
}
.hero-param--clickable:hover {
  filter: brightness(0.97);
  transform: translateY(-1px);
}
.hero-param--fixed .hero-param-icon {
  background: rgba(124, 58, 237, 0.12); color: #7c3aed;
}
.hero-param--weight .hero-param-icon {
  background: rgba(99, 102, 241, 0.12); color: #6366f1;
}
.hero-param--costfee .hero-param-icon {
  background: rgba(4, 120, 87, 0.12); color: #047857;
}
.hero-param--schedule .hero-param-icon {
  background: rgba(245, 158, 11, 0.12); color: #f59e0b;
}
.hero-param--next .hero-param-icon {
  background: rgba(16, 185, 129, 0.12); color: #10b981;
}
.hero-param--overdue {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.04);
}
.hero-param--overdue .hero-param-icon {
  background: rgba(239, 68, 68, 0.14); color: #ef4444;
}
.hero-param--overdue .hero-param-sub {
  color: #ef4444;
}
.hero-param-icon {
  width: 40px; height: 40px; min-width: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.hero-param-body { flex: 1; min-width: 0; }
.hero-param-label {
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.hero-param-value {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hero-param-sub {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.hero-param-arrow {
  color: rgba(var(--v-theme-on-surface), 0.4);
  flex-shrink: 0;
}
.hero-param--clickable:hover .hero-param-arrow {
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.hero-stats {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px;
}
@media (max-width: 480px) {
  .hero-stats { gap: 8px; }
  .hero-stat { padding: 12px 14px; }
  .hero-stat-value { font-size: 16px; }
}

.hero-stat {
  padding: 14px 16px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.hero-stat--accent {
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.18);
}
.hero-stat-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5);
  display: inline-flex; align-items: center; gap: 4px;
}
.hero-stat-value { font-size: 18px; font-weight: 700; margin-top: 4px; }
.hero-stat-sub { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4); margin-top: 2px; }
.hero-stat--clickable {
  position: relative;
  border: 1px solid rgba(14, 165, 233, 0.18);
  background: rgba(14, 165, 233, 0.04);
  cursor: pointer; text-align: left;
  font: inherit; color: inherit;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}
.hero-stat--clickable:not(:disabled):hover {
  background: rgba(14, 165, 233, 0.09);
  border-color: rgba(14, 165, 233, 0.45);
  transform: translateY(-1px);
}
.hero-stat--clickable:not(:disabled):hover .hero-stat-action {
  color: #0ea5e9;
}
.hero-stat--clickable:disabled { cursor: default; opacity: 0.7; }
.hero-stat-action {
  display: inline-flex; align-items: center; gap: 3px;
  margin-top: 6px;
  font-size: 11px; font-weight: 600;
  color: rgba(14, 165, 233, 0.7);
  transition: color 0.15s;
}

/* «В работе» breakdown modal */
.active-formula {
  padding: 12px 14px;
  background: rgba(14, 165, 233, 0.06);
  border: 1px solid rgba(14, 165, 233, 0.2);
  border-radius: 10px;
}
.active-formula-title {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 700; color: #0ea5e9;
  margin-bottom: 6px;
}
.active-formula-body {
  font-size: 13px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.78);
}
.share-line {
  display: flex; align-items: flex-start; gap: 8px;
}
.share-line + .share-line { margin-top: 8px; }
.share-line-n {
  flex-shrink: 0;
  width: 18px; height: 18px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  background: rgba(14, 165, 233, 0.15); color: #0ea5e9;
  margin-top: 1px;
}
.active-list-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 8px;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.active-list {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 10px;
  overflow: hidden;
}
.active-item + .active-item {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.active-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  text-decoration: none; color: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.active-row:hover { background: rgba(var(--v-theme-on-surface), 0.04); }

/* Expanded body */
.active-body {
  padding: 12px 14px 14px 42px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.08);
}
.active-line {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
  padding: 4px 0;
  font-size: 13px;
}
.active-line-label {
  display: inline-flex; align-items: center; gap: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.active-line-val {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.active-line-strong { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.active-line-success { color: #10b981; }
.active-line-mode {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.active-line-sub {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-align: right;
  margin-top: 2px;
}
.active-divider {
  height: 0;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  margin: 6px 0;
}
.active-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #10b981;
  flex-shrink: 0;
}
.active-open-link {
  display: block;
  text-align: center;
  margin-top: 12px;
  font-size: 12px; font-weight: 600;
  color: #0ea5e9;
  text-decoration: none;
}
.active-open-link:hover { text-decoration: underline; }
.active-row-main { flex: 1; min-width: 0; }
.active-row-num {
  display: inline-block;
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-right: 6px;
}
.active-row-name {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.active-row-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.active-row-stake {
  font-size: 14px; font-weight: 700;
  color: #0ea5e9;
  text-align: right;
}
.active-row-earn {
  font-size: 14px; font-weight: 700;
  color: #10b981;
}
.active-row-earn-label {
  font-size: 10px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 1px;
}
.active-row-arrow { color: rgba(var(--v-theme-on-surface), 0.35); }

/* Pay button */
.pay-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 18px; border-radius: 10px; border: none;
  background: #7c3aed; color: #fff; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.pay-btn:hover:not(:disabled) {
  background: #6d28d9;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.30);
}
.pay-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pay-btn--sm { padding: 7px 14px; font-size: 12px; }

/* Hero action group (CSV + share + pay) */
.hero-actions {
  display: flex; align-items: center; gap: 8px; flex-shrink: 0;
}
@media (max-width: 600px) {
  .hero-actions { width: 100%; flex-wrap: wrap; }
  .hero-actions .share-btn, .hero-actions .pay-btn, .hero-actions .remove-btn { flex: 1; }
}

/* Remove-from-cashbox button (destructive ghost) */
.remove-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: transparent;
  color: #ef4444;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.remove-btn:hover {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.55);
}

/* Share button */
.share-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.share-btn:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.25);
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* Share dialog */
.share-url-wrap { display: flex; gap: 6px; }
.share-url-input {
  flex: 1; min-width: 0;
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 13px; font-family: ui-monospace, SFMono-Regular, monospace;
  color: rgba(var(--v-theme-on-surface), 0.85);
  outline: none;
}
.share-url-input:focus { border-color: #0ea5e9; }
.share-copy-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 10px 14px; border-radius: 10px; border: none;
  background: #0ea5e9; color: #fff;
  font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.share-copy-btn:hover { background: #0284c7; }
.share-copy-btn--done { background: #047857; }
.share-warning {
  display: flex; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.22);
  font-size: 12px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.78);
}
.share-warning .v-icon { color: #f59e0b; flex-shrink: 0; margin-top: 1px; }
.share-warning-link {
  background: none; border: none; padding: 0;
  color: #0ea5e9; font: inherit; cursor: pointer; text-decoration: underline;
}
.ghost-btn--primary {
  background: #047857; color: #fff; border-color: #047857;
}
.ghost-btn--primary:hover { background: #065f46; border-color: #065f46; }

/* Tabs */
.tabs {
  display: flex; gap: 4px; padding: 4px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 12px; width: fit-content;
}
@media (max-width: 599px) {
  /* На мобиле вкладки растягиваются на всю ширину, чтобы не съезжать
     в один угол и легко тапаться. */
  .tabs { width: 100%; }
  .tab { flex: 1 1 auto; justify-content: center; padding: 8px 10px; font-size: 13px; }
}
.tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 8px; border: none;
  background: transparent; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer;
  transition: all 0.15s;
}
.tab:hover { color: rgba(var(--v-theme-on-surface), 0.85); }
.tab--active {
  background: #fff; color: #6366f1; font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

/* Sections */
.section-title { font-size: 15px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); }

.filter-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  padding: 5px 12px; border-radius: 8px; border: 1px solid #e5e7eb;
  background: #fff; font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer;
  transition: all 0.15s;
}
.chip:hover { border-color: #6366f1; color: #6366f1; }
.chip--active { border-color: #6366f1; background: rgba(99, 102, 241, 0.08); color: #6366f1; }
.chip--ghost {
  background: rgba(124, 58, 237, 0.08); border-color: rgba(124, 58, 237, 0.20); color: #7c3aed;
}
.chip--ghost:hover { background: rgba(124, 58, 237, 0.14); }

/* Empty */
.empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 40px 16px; text-align: center;
}
.empty-title { font-size: 15px; font-weight: 600; margin-top: 12px; color: rgba(var(--v-theme-on-surface), 0.7); }
.empty-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 4px; }

/* Journal list */
.journal-list { display: flex; flex-direction: column; gap: 4px; }
.journal-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.journal-icon {
  width: 36px; height: 36px; min-width: 36px;
  border-radius: 10px; display: flex; align-items: center; justify-content: center;
}
.journal-main { flex: 1; min-width: 0; }
.journal-title { font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); }
.journal-meta { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px; }
.journal-amount { font-size: 14px; font-weight: 700; white-space: nowrap; }
.journal-cancel {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; min-width: 30px;
  border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: pointer; transition: all 0.15s; opacity: 0.55;
}
.journal-row:hover .journal-cancel { opacity: 1; }
.journal-cancel:hover {
  border-color: rgba(239, 68, 68, 0.30);
  background: rgba(239, 68, 68, 0.08); color: #ef4444;
}
.journal-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

/* Deals list */
.deals-list { display: flex; flex-direction: column; gap: 6px; }
.deal-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  cursor: pointer; transition: background 0.15s;
}
.deal-row:hover { background: rgba(99, 102, 241, 0.06); }
.deal-name { font-size: 14px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.85); }
.deal-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); flex-wrap: wrap; }
.deal-status { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 5px; }

/* Pay dialog */
.dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.dialog-title { font-size: 17px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.cap-tabs {
  display: flex; gap: 4px; padding: 4px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.cap-tab {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 8px 12px; border-radius: 9px; border: none; background: transparent;
  font-size: 13px; font-weight: 600; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.6); transition: all 0.15s;
}
.cap-tab--active {
  background: rgb(var(--v-theme-surface)); color: #6366f1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.dialog-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.dialog-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 20px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.suggest-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-radius: 12px;
  background: rgba(124, 58, 237, 0.05);
  border: 1px solid rgba(124, 58, 237, 0.15);
}
.suggest-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55); }
.suggest-value { font-size: 18px; font-weight: 700; color: #7c3aed; }

/* Предупреждение/запрет в модалке выплаты дивидендов */
.pay-note {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  font-size: 12.5px; line-height: 1.4;
}
.pay-note .v-icon { flex: 0 0 auto; margin-top: 1px; }
.pay-note--warn {
  color: #b45309;
  background: rgba(245, 158, 11, 0.10);
  border: 1px solid rgba(245, 158, 11, 0.25);
}
.pay-note--error {
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.10);
  border: 1px solid rgba(239, 68, 68, 0.25);
}

/* Наглядный итог операции с капиталом */
.cap-note {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  font-size: 12.5px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.78);
}
.cap-note .v-icon { flex-shrink: 0; margin-top: 1px; }
.cap-note--topup { background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); }
.cap-note--topup .v-icon { color: #3b82f6; }
.cap-note--withdraw { background: rgba(239, 68, 68, 0.07); border: 1px solid rgba(239, 68, 68, 0.2); }
.cap-note--withdraw .v-icon { color: #ef4444; }
.cap-note--reinvest { background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); }
.cap-note--reinvest .v-icon { color: #6366f1; }

.field-label { display: block; font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px; }
.field-input {
  width: 100%; padding: 10px 14px;
  border-radius: 10px; border: 1px solid #e5e7eb;
  background: #f9fafb; font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: all 0.15s; font-family: inherit;
}
.field-input:focus { border-color: #7c3aed; background: #fff; box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.08); }
.field-input-wrap { position: relative; }
.field-input-wrap .field-input { padding-right: 36px; }
.field-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.35);
}

.btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 9px 20px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--primary { background: #7c3aed; color: #fff; }
.btn--primary:hover:not(:disabled) { background: #6d28d9; }
.btn--ghost {
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.5);
  border: 1px solid #e5e7eb;
}
.btn--ghost:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.04); }

/* Dark mode */
.dark .ghost-btn {
  background: #1e1e2e; border-color: #2e2e42; color: #d4d4d8;
}
.dark .hero-card, .dark .v-card { background: #1e1e2e !important; }
.dark .hero-stat { background: rgba(255, 255, 255, 0.04); }
.dark .tabs { background: rgba(255, 255, 255, 0.05); }
.dark .tab--active { background: #1e1e2e; }
.dark .chip { background: #1e1e2e; border-color: #2e2e42; color: #a1a1aa; }
.dark .field-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .field-input:focus { background: #1e1e2e; }
.dark .journal-row, .dark .deal-row { background: rgba(255, 255, 255, 0.02); }
.dark .deal-row:hover { background: rgba(99, 102, 241, 0.10); }
.dark .btn--ghost { background: transparent; border-color: #2e2e42; color: #a1a1aa; }
.dark .dialog-header, .dark .dialog-actions { border-color: #2e2e42; }
</style>
