<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { formatCurrency, formatDate, formatPhone, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { PAYOUT_SCHEDULE_LABELS, type CoInvestorJournalEntry, type CoInvestorSummary } from '@/types'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { isDark } = useIsDark()

// Mobile flag для fullscreen-диалогов.
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
function updateMobile() { isMobile.value = window.innerWidth < 768 }
onMounted(() => window.addEventListener('resize', updateMobile))
onUnmounted(() => window.removeEventListener('resize', updateMobile))
const { fetchSummary, fetchJournal, payDividends, fetchDetail } = useCoInvestors()
const cashboxesStore = useCashBoxesStore()

const id = computed(() => (route.params as { id: string }).id)
const tab = ref<'cashier' | 'deals' | 'payouts'>('cashier')

// ── State ──

const loading = ref(true)
const summary = ref<CoInvestorSummary | null>(null)
const detail = ref<any>(null)
const journal = ref<CoInvestorJournalEntry[]>([])
const journalLoading = ref(false)
const journalTypes = ref<string[]>([]) // empty = all

// ── «В работе» breakdown modal: shows which active deals contribute to
// activeDeployment + how the CI's per-deal stake is computed from purchase
// price × effective profit %. Mirrors backend's getCoInvestorSummary.
const showActiveBreakdown = ref(false)

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
// idemKey generated once when dialog opens — survives across submit retries
// (timeout/refresh) so a 504 that actually committed server-side won't be
// re-paid. Reset to '' on close so reopening produces a fresh key.
const payIdemKey = ref('')

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

const dividendsList = computed(() =>
  journal.value.filter((e) => e.type === 'DIVIDEND_PAID')
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
  if (payForm.value.amount > summary.value.balanceOwed) {
    return toast.error(`Не больше остатка к выплате: ${formatCurrency(summary.value.balanceOwed)}`)
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
  } catch (e: any) {
    toast.error(e.message || 'Ошибка выплаты')
  } finally {
    paying.value = false
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

function entryMeta(e: { type: string; amount: number; meta?: unknown }) {
  const base = TYPE_META[e.type] ?? { label: e.type, color: '#71717a', icon: 'mdi-circle', sign: 1 }
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
  <div class="ci-detail" :class="{ dark: isDark }">
    <!-- Top bar -->
    <div class="topbar mb-4">
      <button class="back-btn" @click="router.back()">
        <v-icon icon="mdi-arrow-left" size="18" />
        Назад
      </button>
      <v-spacer />
      <button class="ghost-btn" @click="downloadStatement" :disabled="loading">
        <v-icon icon="mdi-download-outline" size="16" />
        Выписка CSV
      </button>
    </div>

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
              <span>{{ dealsList.length }} {{ dealsList.length === 1 ? 'сделка' : 'сделок' }}</span>
              <span class="hero-meta-dot">·</span>
              <span>с {{ formatDate(detail.createdAt) }}</span>
            </div>
          </div>
          <div class="hero-actions">
            <button class="share-btn" title="Поделиться ссылкой с инвестором" @click="openShareDialog">
              <v-icon icon="mdi-share-variant-outline" size="18" />
              Поделиться
            </button>
            <button class="pay-btn" :disabled="summary.balanceOwed <= 0" @click="openPayDialog">
              <v-icon icon="mdi-cash-multiple" size="18" />
              Выплатить дивиденды
            </button>
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
            :class="detail.profitPercent != null && detail.profitPercent > 0 ? 'hero-param--fixed' : 'hero-param--weight'"
          >
            <div class="hero-param-icon">
              <v-icon
                :icon="detail.profitPercent != null && detail.profitPercent > 0 ? 'mdi-handshake-outline' : 'mdi-scale-balance'"
                size="20"
              />
            </div>
            <div class="hero-param-body">
              <div class="hero-param-label">Доля прибыли</div>
              <div class="hero-param-value">
                <template v-if="detail.profitPercent != null && detail.profitPercent > 0">
                  Фикс {{ detail.profitPercent }}%
                </template>
                <template v-else>
                  По вкладу капитала
                </template>
              </div>
              <div class="hero-param-sub">
                Фактическая доля {{ summary.effectivePct.toFixed(2) }}% от прибыли кассы
              </div>
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
          </div>
        </div>
      </v-card>

      <!-- Deals tab -->
      <v-card v-else-if="tab === 'deals'" rounded="lg" elevation="0" border class="pa-4">
        <div class="d-flex align-center mb-3">
          <span class="section-title">Связанные сделки ({{ dealsList.length }})</span>
        </div>
        <div v-if="!dealsList.length" class="empty">
          <v-icon icon="mdi-briefcase-off-outline" size="40" color="grey" />
          <div class="empty-title">Нет привязанных сделок</div>
          <div class="empty-sub">Привязка делается из списка со-инвесторов</div>
        </div>
        <div v-else class="deals-list">
          <div
            v-for="d in dealsList"
            :key="d.id"
            class="deal-row"
            @click="router.push(`/deals/${d.id}`)"
          >
            <div class="flex-1" style="min-width: 0;">
              <div class="deal-name">{{ d.productName }}</div>
              <div class="deal-meta">
                <span class="deal-status" :style="{ background: (DEAL_STATUS_COLORS[d.status] ?? '#71717a') + '18', color: DEAL_STATUS_COLORS[d.status] ?? '#71717a' }">
                  {{ DEAL_STATUS_LABELS[d.status] ?? d.status }}
                </span>
                <span>{{ formatCurrency(d.totalPrice) }}</span>
                <span style="color: #047857;">+{{ formatCurrency(d.markup) }}</span>
              </div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" color="grey" />
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
              Доля инвестора в кассе — <strong>{{ summary.effectivePct.toFixed(2) }}%</strong>.
              Для каждой активной сделки берётся
              <strong>закупочная цена × {{ summary.effectivePct.toFixed(2) }}%</strong>
              — это та часть, которую вложил инвестор в эту сделку.
              Суммируем по всем активным сделкам = <strong>{{ formatCurrency(summary.activeDeployment) }}</strong>.
            </div>
          </div>

          <!-- Deals list -->
          <div class="active-list-header">
            <span>Активные сделки ({{ summary.activeDealsCount }})</span>
            <span class="text-caption text-medium-emphasis">Доля инвестора</span>
          </div>
          <div class="active-list">
            <router-link
              v-for="d in summary.activeDealsBreakdown"
              :key="d.id"
              :to="`/deals/${d.id}`"
              class="active-row"
            >
              <div class="active-row-main">
                <div class="active-row-name">
                  <span class="active-row-num">#{{ d.dealNumber }}</span>
                  {{ d.productName }}
                </div>
                <div class="active-row-meta">
                  Закупочная {{ formatCurrency(d.purchasePrice) }} · {{ formatDate(d.dealDate) }}
                </div>
              </div>
              <div class="active-row-stake">{{ formatCurrency(d.stake) }}</div>
              <v-icon icon="mdi-chevron-right" size="16" class="active-row-arrow" />
            </router-link>
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
              @click="payForm.amount = summary!.balanceOwed"
            >
              Выплатить полностью
            </button>
          </div>

          <div class="field mb-3">
            <label class="field-label">Сумма выплаты</label>
            <div class="field-input-wrap">
              <input
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
          <button class="btn btn--primary" :disabled="paying || payForm.amount <= 0" @click="submitDividends">
            <v-progress-circular v-if="paying" indeterminate size="14" width="2" color="white" class="mr-2" />
            Выплатить
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.ci-detail { padding: 8px; }

/* Topbar */
.topbar { display: flex; align-items: center; gap: 8px; }
.back-btn, .ghost-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px; border: 1px solid #e5e7eb;
  background: #fff; color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.back-btn:hover, .ghost-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: #d1d5db;
}
.ghost-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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

/* Participation parameters: cashbox, share, schedule */
.hero-params {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 900px) { .hero-params { grid-template-columns: 1fr; } }
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
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;
}
@media (max-width: 1100px) { .hero-stats { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 720px) { .hero-stats { grid-template-columns: repeat(2, 1fr); } }
/* На совсем узких экранах — по одной KPI карточке на строку.
   Большие суммы (например «Остаток к выплате» в миллионах) обрезались
   в 2-col layout. */
@media (max-width: 480px) {
  .hero-stats { grid-template-columns: 1fr; gap: 8px; }
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
  max-height: 340px;
  overflow-y: auto;
}
.active-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  text-decoration: none; color: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.active-row + .active-row {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.active-row:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
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

/* Hero action group (share + pay) */
.hero-actions {
  display: flex; align-items: center; gap: 8px; flex-shrink: 0;
}
@media (max-width: 600px) {
  .hero-actions { width: 100%; flex-direction: column; }
  .hero-actions .share-btn, .hero-actions .pay-btn { width: 100%; }
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
.dark .back-btn, .dark .ghost-btn {
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
