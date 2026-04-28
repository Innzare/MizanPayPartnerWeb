<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { formatCurrency, formatDate, formatPhone, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { PAYOUT_SCHEDULE_LABELS, type CoInvestorJournalEntry, type CoInvestorSummary } from '@/types'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { isDark } = useIsDark()
const { fetchSummary, fetchJournal, payDividends, fetchDetail } = useCoInvestors()

const id = computed(() => (route.params as { id: string }).id)
const tab = ref<'cashier' | 'deals' | 'payouts'>('cashier')

// ── State ──

const loading = ref(true)
const summary = ref<CoInvestorSummary | null>(null)
const detail = ref<any>(null)
const journal = ref<CoInvestorJournalEntry[]>([])
const journalLoading = ref(false)
const journalTypes = ref<string[]>([]) // empty = all

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
    const [s, d] = await Promise.all([fetchSummary(id.value), fetchDetail(id.value)])
    summary.value = s
    detail.value = d
    await loadJournal()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить данные')
  } finally {
    loading.value = false
  }
}

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

function entryMeta(type: string) {
  return TYPE_META[type] ?? { label: type, color: '#71717a', icon: 'mdi-circle', sign: 1 }
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
        <div class="d-flex align-start ga-4 flex-wrap">
          <div class="hero-avatar" :style="{ background: getAvatarColor(detail.name) }">
            {{ getInitials(detail.name) }}
          </div>
          <div class="flex-1" style="min-width: 0;">
            <div class="d-flex align-center ga-2 flex-wrap mb-1">
              <span class="hero-name">{{ detail.name }}</span>
              <span class="hero-percent">{{ detail.profitPercent }}% от прибыли</span>
              <span v-if="payoutScheduleLabel" class="hero-schedule">
                <v-icon icon="mdi-calendar-clock" size="13" />
                {{ payoutScheduleLabel }}
              </span>
            </div>
            <div class="hero-meta">
              <span v-if="detail.phone">{{ formatPhone(detail.phone) }} · </span>
              {{ dealsList.length }} {{ dealsList.length === 1 ? 'сделка' : 'сделок' }} · с {{ formatDate(detail.createdAt) }}
            </div>
          </div>
          <button class="pay-btn" :disabled="summary.balanceOwed <= 0" @click="openPayDialog">
            <v-icon icon="mdi-cash-multiple" size="18" />
            Выплатить дивиденды
          </button>
        </div>

        <!-- Summary stats grid -->
        <div class="hero-stats mt-5">
          <div class="hero-stat">
            <div class="hero-stat-label">Текущий капитал</div>
            <div class="hero-stat-value" style="color: #3b82f6;">{{ formatCurrency(summary.currentCapital) }}</div>
          </div>
          <div class="hero-stat">
            <div class="hero-stat-label">В работе</div>
            <div class="hero-stat-value" style="color: #0ea5e9;">{{ formatCurrency(summary.activeDeployment) }}</div>
            <div class="hero-stat-sub">{{ summary.activeDealsCount }} {{ pluralDeals(summary.activeDealsCount) }}</div>
          </div>
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
            >{{ entryMeta(t).label }}</button>
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
            <div class="journal-icon" :style="{ background: entryMeta(e.type).color + '14', color: entryMeta(e.type).color }">
              <v-icon :icon="entryMeta(e.type).icon" size="18" />
            </div>
            <div class="journal-main">
              <div class="journal-title">{{ entryMeta(e.type).label }}</div>
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

    <!-- Pay dividends dialog -->
    <v-dialog v-model="payDialog" max-width="480" persistent>
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
.hero-avatar {
  width: 64px; height: 64px; border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 22px; letter-spacing: 1px;
}
.hero-name { font-size: 20px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.hero-percent {
  font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 8px;
  background: rgba(99, 102, 241, 0.10); color: #6366f1;
}
.hero-schedule {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 8px;
  background: rgba(245, 158, 11, 0.10); color: #f59e0b;
}
.hero-meta { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }

.hero-stats {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;
}
@media (max-width: 1100px) { .hero-stats { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 720px) { .hero-stats { grid-template-columns: repeat(2, 1fr); } }

.hero-stat {
  padding: 14px 16px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.hero-stat--accent {
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.18);
}
.hero-stat-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); }
.hero-stat-value { font-size: 18px; font-weight: 700; margin-top: 4px; }
.hero-stat-sub { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4); margin-top: 2px; }

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

/* Tabs */
.tabs {
  display: flex; gap: 4px; padding: 4px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 12px; width: fit-content;
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
