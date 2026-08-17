<route lang="json">
{
  "meta": {
    "layout": "auth"
  }
}
</route>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

definePage({
  meta: { layout: 'auth' },
})
import { useThemeMode } from '@/composables/useThemeMode'
import { api } from '@/api/client'
import { useIsDark } from '@/composables/useIsDark'
import ServerPager from '@/components/ServerPager.vue'
import { formatCurrency, formatDate, formatPhone } from '@/utils/formatters'
import type { CoInvestorJournalEntry, CoInvestorJournal, PayoutSchedule, ShareBreakdown } from '@/types'
import { PAYOUT_SCHEDULE_LABELS } from '@/types'

// One cashbox stake, as returned inside the person aggregate. Carries the same
// summary fields the old single-CI page used, so the per-cashbox view reuses them.
interface PublicStake {
  id: string
  cashBox: { id: string; name: string; color: string; icon: string }
  profitPercent: number | null
  costFeeMode?: boolean
  costFeeDefaultRatePct?: number | null
  capital: number
  currentCapital: number
  capitalIn: number
  capitalOut: number
  realizedProfit: number
  totalPayout: number
  balanceOwed: number
  activeDeployment: number
  activeDealsCount: number
  effectivePct: number
  // Распределение прибыли по кассе — приходит ТОЛЬКО если партнёр включил
  // «показывать мою долю инвестору». Иначе полей нет и блок скрыт.
  totalProfit?: number
  coInvestorShare?: number
  myShare?: number
  shareBreakdown?: ShareBreakdown | null
  // Итоги и счётчики вкладок таба «Сделки» — считает сервер по всей выборке.
  dealsTotals?: Record<'all' | 'active' | 'completed', { count: number; inv: number; gross?: number; part?: number }>
}

/** Строка разбора по сделке — приходит постранично, отдельным запросом. */
interface DealRow {
    id: string
    dealNumber: number
    productName: string
    purchasePrice: number
    dealDate: string
    status?: 'ACTIVE' | 'COMPLETED'
    stake: number
    expectedProfit?: number
    dealProfit?: number
    // Доля партнёра — приходит ТОЛЬКО если партнёр включил «показывать мою долю
    // инвестору». Иначе поле отсутствует и строка/полоса партнёра скрываются.
    partnerProfit?: number
    paidPayments?: number
    numberOfPayments?: number
    modeLabel?: string
    // Доля инвестора в уже возвращённых клиентом деньгах + нетто «в работе» по сделке.
    received?: number
    deployed?: number
  costFee?: { ratePct: number; partnerFee: number; investorShare: number }
}

/** Ответ постраничного разбора. */
interface DealsPage {
  items: DealRow[]
  /** Отсутствует при листании: итоги тогда не пересчитываются. */
  total?: number
  limit: number
  offset: number
  totals?: { count: number; inv: number; gross?: number; part?: number }
  counts: { all: number; active: number; completed: number }
}

// `GET /public/co-investors/:token/summary` — now the person aggregate.
interface PublicSummary {
  person: {
    id: string
    name: string
    phone: string | null
    payoutSchedule?: PayoutSchedule
    nextPayoutDate?: string | null
    createdAt: string
  }
  totals: {
    capital: number
    currentCapital: number
    realizedProfit: number
    totalPayout: number
    balanceOwed: number
    activeDeployment: number
  }
  stakes: PublicStake[]
}

const route = useRoute()
const { isDark } = useIsDark()

// Верхний таб кабинета: обзор (сводка + журнал) или детальные сделки.
const mainTab = ref<'overview' | 'deals'>('overview')

// Раскрытые сделки в табе «Сделки».
const expandedDeals = ref<Set<string>>(new Set())
function toggleDealExpand(id: string) {
  const n = new Set(expandedDeals.value)
  n.has(id) ? n.delete(id) : n.add(id)
  expandedDeals.value = n
}

// Переключатель темы: кабинет инвестора живёт на auth-layout, без сайдбара с
// селектом, поэтому здесь тем три и они идут по кругу. Раньше тумблер был
// бинарным и писал в тот же ключ, затирая «ночную», выбранную в кабинете.
const { current: themeMode, options: themeOptions, setTheme } = useThemeMode()

const activeTheme = computed(
  () => themeOptions.find((o) => o.id === themeMode.value) ?? themeOptions[0]!,
)

function toggleTheme() {
  const i = themeOptions.findIndex((o) => o.id === themeMode.value)
  setTheme(themeOptions[(i + 1) % themeOptions.length]!.id)
}

// Нетто «в работе» по сделке — СО ЗНАКОМ. <0 = клиент вернул больше вашей вложенной
// доли (возврат включает наценку); такие сделки уменьшают итог, показываем со знаком,
// чтобы строки сходились с KPI. fallback на stake — для старых ответов без deployed.
function rowDeployed(d: DealRow) {
  return d.deployed ?? d.stake
}
// Разбор долей сделки для раскрытого блока. partnerProfit приходит с бэкенда
// только при включённом флаге приватности — иначе доля партнёра скрыта.
function dealShares(d: DealRow) {
  const gross = d.dealProfit ?? 0
  const invShare = d.expectedProfit ?? 0
  const hasPartner = d.partnerProfit != null
  const partnerProfit = d.partnerProfit ?? 0
  const paid = d.paidPayments ?? 0
  const total = d.numberOfPayments ?? 0
  const left = Math.max(0, total - paid)
  const invPct = gross > 0 ? Math.min(100, (invShare / gross) * 100) : 0
  const partPct = hasPartner && gross > 0 ? Math.min(100 - invPct, (partnerProfit / gross) * 100) : 0
  const paidPct = total > 0 ? (paid / total) * 100 : 0
  return { gross, invShare, hasPartner, partnerProfit, paid, total, left, invPct, partPct, paidPct }
}

// Завершена ли сделка (все платежи оплачены).
function dealDone(d: DealRow): boolean {
  return d.status === 'COMPLETED'
}

// Mobile flag для fullscreen breakdown-диалога.
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
function updateMobile() { isMobile.value = window.innerWidth < 768 }
onMounted(() => window.addEventListener('resize', updateMobile))
onUnmounted(() => window.removeEventListener('resize', updateMobile))

const token = computed(() => route.params.token as string)
const summary = ref<PublicSummary | null>(null)
const journal = ref<CoInvestorJournalEntry[]>([])
const journalLoading = ref(false)
const loading = ref(true)
const error = ref('')
const showActiveBreakdown = ref(false)
// Блок «что означают эти цифры» простым языком (от 2-го лица — читает инвестор).
const showExplain = ref(false)

// Which cashbox stake the investor is currently viewing (summary + journal).
const selectedStakeId = ref<string | null>(null)
const stake = computed<PublicStake | null>(() => {
  const list = summary.value?.stakes ?? []
  return list.find((s) => s.id === selectedStakeId.value) ?? list[0] ?? null
})

// Распределение прибыли по выбранной кассе — есть только если партнёр включил
// «показывать мою долю инвестору» (бэкенд вырезает поля при выключенном флаге).
const distribution = computed(() => {
  const s = stake.value
  if (!s || s.totalProfit == null || !(s.totalProfit > 0) || s.coInvestorShare == null) return null
  const investorPct = Math.round((s.coInvestorShare / s.totalProfit) * 100)
  return { totalProfit: s.totalProfit, coInvestorShare: s.coInvestorShare, myShare: s.myShare ?? 0, investorPct }
})

// ══════════════════════════════════════════════════════════════════
// Таб «Сделки» — серверная страница
//
// Раньше сводка привозила ВСЕ сделки кассы разом: у со-инвестора с 14 813
// связанных сделок это 5,7 МБ и 1,3 секунды на каждое открытие кабинета.
// Теперь сделки приходят страницами, а итоги и счётчики считает сервер по
// всей выборке.
// ══════════════════════════════════════════════════════════════════

const dealFilter = ref<'all' | 'active' | 'completed'>('all')
const DEALS_PAGE = 25
const deals = ref<DealRow[]>([])
const dealsTotal = ref(0)
const dealsLoading = ref(false)
/** Список не загрузился — это не то же самое, что «сделок нет». */
const dealsError = ref(false)
const dealsPage = ref(1)
const dealCounts = ref({ all: 0, active: 0, completed: 0 })
const dealsTotals = ref({ inv: 0, part: 0, gross: 0, hasPartner: false })

// Защита от гонок: переключение фильтров и страниц идёт быстрее ответов.
let dealsReq = 0

async function loadDeals(withTotals = true) {
  const st = stake.value
  if (!st) { deals.value = []; dealsTotal.value = 0; return }
  const req = ++dealsReq
  dealsLoading.value = true
  dealsError.value = false
  try {
    // Итоги и счётчики просим только когда состав выборки мог измениться:
    // при простом листании они те же, а их пересчёт стоит прохода по всем
    // сделкам кассы.
    const needTotals = withTotals
    const qs = new URLSearchParams({
      stakeId: st.id,
      filter: dealFilter.value,
      limit: String(DEALS_PAGE),
      offset: String((dealsPage.value - 1) * DEALS_PAGE),
      ...(needTotals ? {} : { totals: '0' }),
    })
    const res = await api.get<DealsPage>(`/public/co-investors/${token.value}/deals?${qs}`)
    if (req !== dealsReq) return
    deals.value = res.items
    if (!needTotals) return
    dealsTotal.value = res.total ?? dealsTotal.value
    dealCounts.value = res.counts
    // hasPartner: сервер вырезает долю партнёра, если она скрыта настройкой.
    dealsTotals.value = {
      inv: res.totals?.inv ?? 0,
      part: res.totals?.part ?? 0,
      gross: res.totals?.gross ?? 0,
      hasPartner: res.totals?.part != null,
    }
  } catch {
    // Сбой сети не должен выглядеть как «сделок нет» — показываем ошибку с
    // возможностью повторить.
    if (req === dealsReq) { deals.value = []; dealsTotal.value = 0; dealsError.value = true }
  } finally {
    if (req === dealsReq) dealsLoading.value = false
  }
}

// Смена фильтра или кассы возвращает на первую страницу.
watch([dealFilter, selectedStakeId], () => { dealsPage.value = 1; loadDeals() })

/**
 * Переход по страницам — без пересчёта итогов.
 *
 * Загрузку вешать на watch(dealsPage) нельзя: смена фильтра сбрасывает
 * страницу на первую, и со страницы ≥2 это порождало второй запрос, который
 * отменял первый. Строки обновлялись, а KPI и счётчик оставались от прежнего
 * фильтра — инвестор видел чужие суммы над своим списком.
 */
function goToDealsPage(p: number) {
  if (p === dealsPage.value) return
  dealsPage.value = p
  loadDeals(false)
}
watch(mainTab, (t) => { if (t === 'deals' && !deals.value.length) loadDeals() })

const filteredDeals = computed(() => deals.value)
const allDeals = computed(() => deals.value)

// Вкладка «Обзор» показывает короткий список активных сделок. Раньше она
// рисовала их ВСЕ (у крупной кассы это тысячи строк в DOM); теперь берём
// первые несколько, а за полным списком отправляем в таб «Сделки».
const OVERVIEW_DEALS = 10
const overviewDeals = ref<DealRow[]>([])
let overviewReq = 0

async function loadOverviewDeals() {
  const st = stake.value
  if (!st) { overviewDeals.value = []; return }
  const req = ++overviewReq
  try {
    const qs = new URLSearchParams({
      stakeId: st.id, filter: 'active', limit: String(OVERVIEW_DEALS), offset: '0',
    })
    const res = await api.get<DealsPage>(`/public/co-investors/${token.value}/deals?${qs}`)
    if (req === overviewReq) overviewDeals.value = res.items
  } catch {
    if (req === overviewReq) overviewDeals.value = []
  }
}
watch(selectedStakeId, loadOverviewDeals)

const payoutScheduleLabel = computed(() => {
  const s = summary.value?.person.payoutSchedule
  return s ? PAYOUT_SCHEDULE_LABELS[s] : null
})

const nextPayoutOverdue = computed(() => {
  const d = summary.value?.person.nextPayoutDate
  if (!d) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return new Date(d) < today
})

const nextPayoutSub = computed(() => {
  const d = summary.value?.person.nextPayoutDate
  if (!d) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(d); target.setHours(0, 0, 0, 0)
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff < 0) return `Просрочено на ${Math.abs(diff)} ${pluralDaysWord(Math.abs(diff))}`
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Завтра'
  return `Через ${diff} ${pluralDaysWord(diff)}`
})

function pluralDaysWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'день'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дня'
  return 'дней'
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}
function getAvatarColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const palette = ['#3b82f6', '#10b981', '#f59e0b', '#7c3aed', '#ef4444', '#0ea5e9', '#84cc16', '#ec4899']
  return palette[h % palette.length]
}

function pluralDeals(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'сделка'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'сделки'
  return 'сделок'
}

const TYPE_META: Record<string, { label: string; color: string; icon: string; sign: 1 | -1 }> = {
  CAPITAL_IN: { label: 'Пополнение капитала', color: '#3b82f6', icon: 'mdi-arrow-down-circle-outline', sign: 1 },
  CAPITAL_OUT: { label: 'Снятие капитала', color: '#ef4444', icon: 'mdi-arrow-up-circle-outline', sign: -1 },
  PROFIT_ACCRUED: { label: 'Начисление прибыли', color: '#047857', icon: 'mdi-trending-up', sign: 1 },
  DIVIDEND_PAID: { label: 'Выплата дивидендов', color: '#7c3aed', icon: 'mdi-cash-multiple', sign: -1 },
}
function isReversal(e: { type: string; amount: number; meta?: unknown }): boolean {
  const m = e.meta as { reversal?: boolean } | null | undefined
  if (m && m.reversal === true) return true
  const sign = TYPE_META[e.type]?.sign ?? 1
  return (sign === 1 && e.amount < 0) || (sign === -1 && e.amount > 0)
}
function entryMeta(e: { type: string; amount: number; meta?: unknown }) {
  const base = TYPE_META[e.type] ?? { label: e.type, color: '#71717a', icon: 'mdi-circle', sign: 1 }
  if (!isReversal(e)) return base
  const reversalLabels: Record<string, string> = {
    PROFIT_ACCRUED: 'Отмена начисления прибыли',
    DIVIDEND_PAID: 'Отмена выплаты дивидендов',
    CAPITAL_IN: 'Отмена пополнения капитала',
    CAPITAL_OUT: 'Возврат снятия капитала',
  }
  return { label: reversalLabels[e.type] ?? `Отмена: ${base.label.toLowerCase()}`, color: '#ef4444', icon: 'mdi-undo-variant', sign: base.sign }
}
function formatSigned(amount: number) {
  if (amount === 0) return '0 ₽'
  return (amount > 0 ? '+' : '') + formatCurrency(amount)
}

// Per-cashbox journal for the currently selected stake.
async function loadJournal() {
  const st = stake.value
  if (!st) { journal.value = []; return }
  journalLoading.value = true
  try {
    const j = await api.get<CoInvestorJournal>(
      `/public/co-investors/${token.value}/cashflow?limit=200&stakeId=${st.id}`,
    )
    journal.value = j.entries
  } catch {
    journal.value = []
  } finally {
    journalLoading.value = false
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const s = await api.get<PublicSummary>(`/public/co-investors/${token.value}/summary`)
    summary.value = s
    selectedStakeId.value = s.stakes[0]?.id ?? null
    await loadJournal()
  } catch (e: any) {
    error.value = e.message || 'Ссылка недействительна'
  } finally {
    loading.value = false
  }
}

// Reload the journal + close the breakdown when the investor switches cashbox.
function selectStake(id: string) {
  if (selectedStakeId.value === id) return
  selectedStakeId.value = id
  showActiveBreakdown.value = false
  loadJournal()
}

const stakeModeLabel = computed(() => {
  const st = stake.value
  if (!st) return ''
  if (st.costFeeMode) return 'Комиссия от закупки'
  if (st.profitPercent != null && st.profitPercent > 0) return `Фикс ${st.profitPercent}%`
  return 'По вкладу капитала'
})

function pluralCashboxes(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'касса'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'кассы'
  return 'касс'
}

onMounted(load)
</script>

<template>
  <div class="inv-page" :class="{ dark: isDark }">
    <div v-if="loading" class="inv-loading">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <div v-else-if="error || !summary" class="inv-error">
      <v-icon icon="mdi-link-off" size="48" color="grey" />
      <div class="inv-error-title">Ссылка недействительна</div>
      <div class="inv-error-sub">Возможно, партнёр обновил или отозвал её. Попросите свежую ссылку.</div>
    </div>

    <div v-else class="inv-wrap">
      <!-- Header card: person identity + aggregated totals across all cashboxes -->
      <v-card rounded="lg" elevation="0" border class="inv-hero pa-5 mb-4">
        <div class="inv-hero-row">
          <div class="inv-avatar" :style="{ background: getAvatarColor(summary.person.name) }">
            {{ getInitials(summary.person.name) }}
          </div>
          <div class="inv-identity">
            <div class="inv-name">{{ summary.person.name }}</div>
            <div class="inv-meta">
              <span v-if="summary.person.phone">{{ formatPhone(summary.person.phone) }}</span>
              <span v-if="summary.person.phone" class="inv-meta-dot">·</span>
              <span>{{ summary.stakes.length }} {{ pluralCashboxes(summary.stakes.length) }}</span>
              <span v-if="summary.person.createdAt" class="inv-meta-dot">·</span>
              <span v-if="summary.person.createdAt">с {{ formatDate(summary.person.createdAt) }}</span>
            </div>
          </div>
          <button class="inv-theme-btn" :title="`Оформление: ${activeTheme.title}`" @click="toggleTheme">
            <v-icon :icon="activeTheme.icon" size="20" />
          </button>
        </div>

        <!-- Aggregated totals -->
        <div class="inv-stats mt-5">
          <div class="inv-stat">
            <div class="inv-stat-label">Текущий капитал</div>
            <div class="inv-stat-value" style="color: #3b82f6;">{{ formatCurrency(summary.totals.currentCapital) }}</div>
          </div>
          <div class="inv-stat">
            <div class="inv-stat-label">В работе</div>
            <div class="inv-stat-value" style="color: #0ea5e9;">{{ formatCurrency(summary.totals.activeDeployment) }}</div>
          </div>
          <div class="inv-stat">
            <div class="inv-stat-label">Начислено прибыли</div>
            <div class="inv-stat-value" style="color: #047857;">{{ formatCurrency(summary.totals.realizedProfit) }}</div>
          </div>
          <div class="inv-stat">
            <div class="inv-stat-label">Выплачено</div>
            <div class="inv-stat-value" style="color: #7c3aed;">{{ formatCurrency(summary.totals.totalPayout) }}</div>
          </div>
          <div class="inv-stat inv-stat--accent">
            <div class="inv-stat-label">Остаток к выплате</div>
            <div class="inv-stat-value" style="color: #f59e0b;">{{ formatCurrency(summary.totals.balanceOwed) }}</div>
          </div>
        </div>

        <!-- Простое объяснение каждой цифры «на пальцах» -->
        <div class="ci-explain mt-4">
          <button class="ci-explain-head" @click="showExplain = !showExplain">
            <v-icon icon="mdi-help-circle-outline" size="18" />
            <span>Что означают эти цифры? Простыми словами</span>
            <v-icon :icon="showExplain ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="20" class="ci-explain-chev" />
          </button>
          <div v-if="showExplain" class="ci-explain-body">
            <div class="ci-explain-item">
              <span class="ci-explain-dot" style="background: #3b82f6;" />
              <div>
                <div class="ci-explain-term">Текущий капитал — {{ formatCurrency(summary.totals.currentCapital) }}</div>
                <div class="ci-explain-desc">Сколько всего денег вы вложили и пока не забрали. Это ваш «кошелёк» здесь.</div>
              </div>
            </div>
            <div class="ci-explain-item">
              <span class="ci-explain-dot" style="background: #0ea5e9;" />
              <div>
                <div class="ci-explain-term">В работе — {{ formatCurrency(summary.totals.activeDeployment) }}</div>
                <div class="ci-explain-desc">Сколько ваших денег прямо сейчас «в деле»: на них уже куплен товар для клиентов, но клиенты вернули ещё не всё. Когда клиент платит — сумма уменьшается. Нажмите на карточку «В работе», чтобы увидеть расклад по каждой сделке.</div>
              </div>
            </div>
            <div class="ci-explain-item">
              <span class="ci-explain-dot" style="background: #047857;" />
              <div>
                <div class="ci-explain-term">Начислено прибыли — {{ formatCurrency(summary.totals.realizedProfit) }}</div>
                <div class="ci-explain-desc">Сколько вы уже заработали — это ваша доля с наценки по тем платежам, которые клиенты уже внесли. Растёт по мере того, как клиенты платят.</div>
              </div>
            </div>
            <div class="ci-explain-item">
              <span class="ci-explain-dot" style="background: #7c3aed;" />
              <div>
                <div class="ci-explain-term">Выплачено — {{ formatCurrency(summary.totals.totalPayout) }}</div>
                <div class="ci-explain-desc">Сколько из заработанного вам уже отдали на руки.</div>
              </div>
            </div>
            <div class="ci-explain-item">
              <span class="ci-explain-dot" style="background: #f59e0b;" />
              <div>
                <div class="ci-explain-term">Остаток к выплате — {{ formatCurrency(summary.totals.balanceOwed) }}</div>
                <div class="ci-explain-desc">Сколько заработанного вам ещё не отдали. Это просто «Начислено прибыли» минус «Выплачено».</div>
              </div>
            </div>
            <div class="ci-explain-example">
              <v-icon icon="mdi-lightbulb-on-outline" size="16" />
              <div>
                <strong>Простой пример.</strong> Вы вложили 100 000 ₽ — это <b>капитал</b>.
                На 60 000 ₽ из них купили товар для клиентов — это <b>в работе</b>.
                Клиенты платят, и вы заработали 4 000 ₽ своей доли с наценки — это <b>начислено</b>.
                Вам уже отдали 1 000 ₽ — это <b>выплачено</b>.
                Значит, осталось отдать 3 000 ₽ — это <b>остаток к выплате</b>.
              </div>
            </div>
          </div>
        </div>

        <!-- Payout schedule (person-level) -->
        <div v-if="payoutScheduleLabel || summary.person.nextPayoutDate" class="inv-params mt-5">
          <div v-if="payoutScheduleLabel" class="inv-param inv-param--schedule">
            <div class="inv-param-icon"><v-icon icon="mdi-calendar-clock" size="20" /></div>
            <div class="inv-param-body">
              <div class="inv-param-label">Периодичность выплат</div>
              <div class="inv-param-value">{{ payoutScheduleLabel }}</div>
            </div>
          </div>
          <div
            v-if="summary.person.nextPayoutDate"
            class="inv-param"
            :class="nextPayoutOverdue ? 'inv-param--overdue' : 'inv-param--next'"
          >
            <div class="inv-param-icon">
              <v-icon :icon="nextPayoutOverdue ? 'mdi-calendar-alert' : 'mdi-calendar-star'" size="20" />
            </div>
            <div class="inv-param-body">
              <div class="inv-param-label">Следующая выплата</div>
              <div class="inv-param-value">{{ formatDate(summary.person.nextPayoutDate) }}</div>
              <div class="inv-param-sub">{{ nextPayoutSub }}</div>
            </div>
          </div>
        </div>
      </v-card>

      <!-- Верхние табы кабинета -->
      <div class="inv-maintabs mb-4">
        <button class="inv-maintab" :class="{ 'inv-maintab--active': mainTab === 'overview' }" @click="mainTab = 'overview'">
          <v-icon icon="mdi-view-dashboard-outline" size="17" />
          Обзор
        </button>
        <button class="inv-maintab" :class="{ 'inv-maintab--active': mainTab === 'deals' }" @click="mainTab = 'deals'">
          <v-icon icon="mdi-briefcase-outline" size="17" />
          Сделки
        </button>
      </div>

      <!-- Cashbox selector -->
      <div v-if="summary.stakes.length > 1" class="inv-cb-tabs mb-4">
        <button
          v-for="s in summary.stakes"
          :key="s.id"
          type="button"
          class="inv-cb-tab"
          :class="{ 'inv-cb-tab--active': stake && stake.id === s.id }"
          :style="stake && stake.id === s.id ? { borderColor: s.cashBox.color, color: s.cashBox.color, background: s.cashBox.color + '12' } : {}"
          @click="selectStake(s.id)"
        >
          <v-icon :icon="s.cashBox.icon" size="15" :style="{ color: s.cashBox.color }" />
          {{ s.cashBox.name }}
        </button>
      </div>

      <template v-if="mainTab === 'overview'">
      <!-- Selected cashbox: per-stake summary + params -->
      <v-card v-if="stake" rounded="lg" elevation="0" border class="inv-hero pa-5 mb-4">
        <div class="inv-cb-head mb-1">
          <div class="inv-param-icon" :style="{ background: stake.cashBox.color, color: '#fff' }">
            <v-icon :icon="stake.cashBox.icon" size="20" />
          </div>
          <div>
            <div class="inv-cb-name">{{ stake.cashBox.name }}</div>
            <div class="inv-cb-sub">{{ stakeModeLabel }}</div>
          </div>
        </div>

        <!-- KPI stats for this cashbox -->
        <div class="inv-stats mt-4">
          <div class="inv-stat">
            <div class="inv-stat-label">Капитал в кассе</div>
            <div class="inv-stat-value" style="color: #3b82f6;">{{ formatCurrency(stake.currentCapital) }}</div>
          </div>
          <button
            class="inv-stat inv-stat--clickable"
            :disabled="stake.activeDealsCount === 0"
            @click="showActiveBreakdown = true"
          >
            <div class="inv-stat-label">В работе</div>
            <div class="inv-stat-value" style="color: #0ea5e9;">{{ formatCurrency(stake.activeDeployment) }}</div>
            <div class="inv-stat-sub">{{ stake.activeDealsCount }} {{ pluralDeals(stake.activeDealsCount) }}</div>
            <div v-if="stake.activeDealsCount > 0" class="inv-stat-action">
              Подробнее
              <v-icon icon="mdi-arrow-right" size="12" />
            </div>
          </button>
          <div class="inv-stat">
            <div class="inv-stat-label">Начислено прибыли</div>
            <div class="inv-stat-value" style="color: #047857;">{{ formatCurrency(stake.realizedProfit) }}</div>
          </div>
          <div class="inv-stat">
            <div class="inv-stat-label">Выплачено</div>
            <div class="inv-stat-value" style="color: #7c3aed;">{{ formatCurrency(stake.totalPayout) }}</div>
          </div>
          <div class="inv-stat inv-stat--accent">
            <div class="inv-stat-label">Остаток к выплате</div>
            <div class="inv-stat-value" style="color: #f59e0b;">{{ formatCurrency(stake.balanceOwed) }}</div>
          </div>
        </div>

        <!-- Share params for this cashbox -->
        <div class="inv-params mt-5">
          <div
            class="inv-param"
            :class="stake.costFeeMode ? 'inv-param--costfee' : (stake.profitPercent != null && stake.profitPercent > 0 ? 'inv-param--fixed' : 'inv-param--weight')"
          >
            <div class="inv-param-icon">
              <v-icon
                :icon="stake.costFeeMode ? 'mdi-tag-outline' : (stake.profitPercent != null && stake.profitPercent > 0 ? 'mdi-handshake-outline' : 'mdi-scale-balance')"
                size="20"
              />
            </div>
            <div class="inv-param-body">
              <div class="inv-param-label">Доля прибыли</div>
              <div class="inv-param-value">
                <template v-if="stake.costFeeMode">Комиссия от закупки</template>
                <template v-else-if="stake.profitPercent != null && stake.profitPercent > 0">
                  Фикс {{ stake.profitPercent }}%
                </template>
                <template v-else>По вкладу капитала</template>
              </div>
              <div class="inv-param-sub">
                <template v-if="stake.costFeeMode">
                  Вы финансируете закупку и получаете всю сумму сделки за вычетом комиссии партнёра (ставка% × закупка)<template v-if="stake.costFeeDefaultRatePct != null"> — по умолчанию {{ stake.costFeeDefaultRatePct }}%</template>
                </template>
                <template v-else>Фактическая доля {{ stake.effectivePct.toFixed(2) }}% от прибыли кассы</template>
              </div>
            </div>
          </div>
        </div>

        <!-- Cost-fee explanation -->
        <div v-if="stake.shareBreakdown && stake.shareBreakdown.mode === 'cost_fee'" class="inv-formula mt-5">
          <div class="inv-formula-title">
            <v-icon icon="mdi-tag-outline" size="14" />
            Комиссия от закупки
          </div>
          <div class="inv-formula-body">
            На каждой сделке партнёр берёт <strong>ставку % × закупочную цену</strong>. Вы финансируете закупку сами и
            получаете <strong>всю сумму сделки за вычетом этой комиссии</strong> — возврат своего капитала плюс остаток наценки<template v-if="stake.shareBreakdown.defaultRatePct != null"> (ставка по умолчанию <strong>{{ stake.shareBreakdown.defaultRatePct }}%</strong>, задаётся под срок на каждой сделке)</template>.
            Конкретные суммы по активным сделкам — в разделе «В работе».
          </div>
        </div>

        <!-- Распределение прибыли по кассе (только если партнёр раскрыл свою долю) -->
        <template v-if="distribution">
          <div class="inv-share-kpi mt-5">
            <div class="inv-share-kpi-card">
              <div class="inv-share-kpi-label"><span class="inv-share-kpi-dot" style="background: #6366f1;" />Ваша доля</div>
              <div class="inv-share-kpi-val" style="color: #6366f1;">{{ formatCurrency(distribution.coInvestorShare) }}</div>
            </div>
            <div class="inv-share-kpi-card">
              <div class="inv-share-kpi-label"><span class="inv-share-kpi-dot" style="background: #047857;" />Доля партнёра</div>
              <div class="inv-share-kpi-val" style="color: #047857;">{{ formatCurrency(distribution.myShare) }}</div>
            </div>
          </div>
          <div class="inv-hero-dist mt-3">
            <div class="inv-hero-dist-head">
              <span class="inv-hero-dist-title">Распределение прибыли</span>
              <span class="inv-hero-dist-total">{{ formatCurrency(distribution.totalProfit) }}</span>
            </div>
            <div class="inv-hero-dist-bar">
              <div class="inv-hero-dist-fill" :style="{ width: distribution.investorPct + '%' }" />
            </div>
            <div class="inv-hero-dist-legend">
              <span style="color: #6366f1;">Инвестору: {{ distribution.investorPct }}% · {{ formatCurrency(distribution.coInvestorShare) }}</span>
              <span style="color: #047857;">Партнёру: {{ 100 - distribution.investorPct }}% · {{ formatCurrency(distribution.myShare) }}</span>
            </div>
          </div>
        </template>
      </v-card>

      <!-- Journal (per selected cashbox) -->
      <v-card rounded="lg" elevation="0" border class="pa-4">
        <div class="inv-section-title mb-3">
          Журнал операций
          <span v-if="stake && summary.stakes.length > 1" class="inv-section-sub"> · {{ stake.cashBox.name }}</span>
        </div>
        <div v-if="journalLoading" class="inv-empty">
          <v-progress-circular indeterminate color="primary" size="28" />
        </div>
        <div v-else-if="!journal.length" class="inv-empty">
          <v-icon icon="mdi-cash-clock" size="32" color="grey" />
          <div>Операций пока нет</div>
        </div>
        <div v-else class="inv-journal">
          <div v-for="e in journal" :key="e.id" class="inv-journal-row">
            <div class="inv-journal-icon" :style="{ background: entryMeta(e).color + '14', color: entryMeta(e).color }">
              <v-icon :icon="entryMeta(e).icon" size="18" />
            </div>
            <div class="inv-journal-main">
              <div class="inv-journal-title">{{ entryMeta(e).label }}</div>
              <div class="inv-journal-meta">
                <span>{{ formatDate(e.date) }}</span>
                <span v-if="e.dealNumber"> · сделка #{{ e.dealNumber }} {{ e.dealProductName }}</span>
                <span v-if="e.note"> · {{ e.note }}</span>
              </div>
            </div>
            <div class="inv-journal-amount" :style="{ color: e.amount >= 0 ? '#047857' : '#ef4444' }">
              {{ formatSigned(e.amount) }}
            </div>
          </div>
        </div>
      </v-card>
      </template>

      <!-- Deals tab: детальный разбор долей по активным сделкам -->
      <template v-else>
        <v-card rounded="lg" elevation="0" border class="pa-4">
          <div class="inv-section-title mb-3">
            Сделки
            <span v-if="stake" class="inv-section-sub"> · {{ stake.cashBox.name }}</span>
          </div>

          <!-- Фильтр: все / активные / завершённые -->
          <div v-if="dealCounts.all" class="inv-deal-filter">
            <button
              v-for="f in [{ key: 'all', label: 'Все', count: dealCounts.all }, { key: 'active', label: 'Активные', count: dealCounts.active }, { key: 'completed', label: 'Завершённые', count: dealCounts.completed }] as const"
              :key="f.key"
              class="inv-deal-filter-chip"
              :class="{ 'inv-deal-filter-chip--active': dealFilter === f.key }"
              @click="dealFilter = f.key"
            >
              {{ f.label }}<span class="inv-deal-filter-count">{{ f.count }}</span>
            </button>
          </div>

          <!-- KPI: суммарные доли по отфильтрованным сделкам (горизонтальный скролл) -->
          <div v-if="dealsTotal" class="inv-deals-kpi">
            <div class="inv-deals-kpi-card inv-deals-kpi-card--inv">
              <div class="inv-deals-kpi-label"><span class="inv-deal-dot inv-deal-dot--inv" />Ваша доля</div>
              <div class="inv-deals-kpi-val inv-deals-kpi-val--inv">{{ formatCurrency(dealsTotals.inv) }}</div>
            </div>
            <div v-if="dealsTotals.hasPartner" class="inv-deals-kpi-card inv-deals-kpi-card--part">
              <div class="inv-deals-kpi-label"><span class="inv-deal-dot inv-deal-dot--part" />Доля партнёра</div>
              <div class="inv-deals-kpi-val inv-deals-kpi-val--part">{{ formatCurrency(dealsTotals.part) }}</div>
            </div>
            <div v-if="dealsTotals.hasPartner" class="inv-deals-kpi-card">
              <div class="inv-deals-kpi-label"><span class="inv-deal-dot inv-deal-dot--gross" />Вся прибыль</div>
              <div class="inv-deals-kpi-val">{{ formatCurrency(dealsTotals.gross) }}</div>
            </div>
          </div>

          <div v-if="dealsLoading && !deals.length" class="d-flex justify-center pa-8">
            <v-progress-circular indeterminate color="primary" size="32" />
          </div>
          <div v-else-if="dealsError" class="inv-empty">
            <v-icon icon="mdi-wifi-off" size="32" color="grey" />
            <div>Не удалось загрузить сделки</div>
            <button class="inv-retry" @click="loadDeals()">Повторить</button>
          </div>
          <div v-else-if="!deals.length" class="inv-empty">
            <v-icon icon="mdi-briefcase-off-outline" size="32" color="grey" />
            <div>{{ dealCounts.all ? 'Нет сделок в этом фильтре' : 'Сделок пока нет' }}</div>
          </div>

          <div v-else class="inv-deals">
            <div v-for="d in filteredDeals" :key="d.id" class="inv-deal">
              <!-- Header (clickable) -->
              <div class="inv-deal-row" @click="toggleDealExpand(d.id)">
                <v-icon
                  :icon="expandedDeals.has(d.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                  size="18"
                  class="inv-deal-arrow"
                />
                <div class="inv-deal-main">
                  <div class="inv-deal-name">
                    <span class="inv-deal-num">#{{ d.dealNumber }}</span>
                    {{ d.productName }}
                    <span class="inv-deal-badge" :class="dealDone(d) ? 'inv-deal-badge--done' : 'inv-deal-badge--active'">{{ dealDone(d) ? 'Завершена' : 'Активна' }}</span>
                  </div>
                  <div class="inv-deal-meta">Закупка {{ formatCurrency(d.purchasePrice) }} · {{ formatDate(d.dealDate) }}</div>
                </div>
                <div class="inv-deal-earn">
                  <template v-if="d.costFee">
                    <div class="inv-deal-earn-val">{{ formatCurrency(d.purchasePrice + (d.costFee.investorShare ?? 0)) }}</div>
                    <div class="inv-deal-earn-label">вы получите</div>
                  </template>
                  <template v-else>
                    <div class="inv-deal-earn-val">+{{ formatCurrency(d.expectedProfit ?? 0) }}</div>
                    <div class="inv-deal-earn-label">ваша доля</div>
                  </template>
                </div>
              </div>

              <!-- Expanded body -->
              <div v-if="expandedDeals.has(d.id)" class="inv-deal-body">
                <template v-for="s in [dealShares(d)]" :key="'sh'">
                  <!-- Секция: прогресс -->
                  <template v-if="s.total > 0">
                    <div class="inv-deal-sec-label">Прогресс</div>
                    <div class="inv-deal-progress">
                      <div class="inv-deal-progress-head">
                        <span>Оплачено {{ s.paid }} из {{ s.total }}</span>
                        <span :class="s.left > 0 ? '' : 'inv-deal-success'">{{ s.left > 0 ? `осталось ${s.left}` : 'завершается' }}</span>
                      </div>
                      <div class="inv-deal-track"><div class="inv-deal-track-fill" :style="{ width: s.paidPct + '%' }" /></div>
                    </div>
                    <div class="inv-deal-divider" />
                  </template>

                  <!-- Секция: экономика сделки -->
                  <div class="inv-deal-sec-label">Экономика сделки</div>
                  <div class="inv-deal-line">
                    <span class="inv-deal-label">{{ d.costFee ? 'Закупка (возврат капитала)' : 'Закупочная цена' }}</span>
                    <span class="inv-deal-val">{{ formatCurrency(d.purchasePrice) }}</span>
                  </div>
                  <!-- «Вся прибыль» скрываем для доли-по-вкладу/фикс, если партнёр
                       не раскрыл долю (иначе она вычислима: прибыль − ваша доля). -->
                  <div v-if="(d.costFee || s.hasPartner) && d.dealProfit != null" class="inv-deal-line">
                    <span class="inv-deal-label inv-deal-strong">{{ d.costFee ? 'Наценка рассрочки' : 'Вся прибыль сделки' }}</span>
                    <span class="inv-deal-val inv-deal-strong">{{ formatCurrency(s.gross) }}</span>
                  </div>
                  <div class="inv-deal-divider" />

                  <!-- Секция: деление прибыли (или просто ваша доля) -->
                  <template v-if="d.costFee || s.hasPartner">
                    <div class="inv-deal-sec-label">Деление прибыли</div>
                    <div class="inv-deal-split inv-deal-split--lg">
                      <div class="inv-deal-split-inv" :style="{ width: s.invPct + '%' }" />
                      <div v-if="s.hasPartner" class="inv-deal-split-part" :style="{ width: s.partPct + '%' }" />
                    </div>
                    <div class="inv-deal-line">
                      <span class="inv-deal-label">
                        <span class="inv-deal-dot inv-deal-dot--inv" />
                        Ваша доля
                        <span class="inv-deal-mode">{{ d.modeLabel || (d.costFee ? 'Комиссия от закупки' : '') }}</span>
                      </span>
                      <span class="inv-deal-val inv-deal-success">{{ formatCurrency(s.invShare) }}</span>
                    </div>
                    <div v-if="s.hasPartner" class="inv-deal-line">
                      <span class="inv-deal-label">
                        <span class="inv-deal-dot inv-deal-dot--part" />
                        Доля партнёра
                        <span v-if="d.costFee" class="inv-deal-mode">комиссия {{ d.costFee.ratePct }}% от закупки</span>
                      </span>
                      <span class="inv-deal-val inv-deal-part">{{ formatCurrency(s.partnerProfit) }}</span>
                    </div>
                  </template>
                  <template v-else>
                    <div class="inv-deal-sec-label">Ваша доля</div>
                    <div class="inv-deal-line">
                      <span class="inv-deal-label">
                        <span class="inv-deal-dot inv-deal-dot--inv" />
                        {{ d.modeLabel || 'Ваш доход с этой сделки' }}
                      </span>
                      <span class="inv-deal-val inv-deal-success inv-deal-strong">{{ formatCurrency(s.invShare) }}</span>
                    </div>
                  </template>

                  <!-- Секция: итог инвестору (cost-fee) -->
                  <template v-if="d.costFee">
                    <div class="inv-deal-divider" />
                    <div class="inv-deal-line">
                      <span class="inv-deal-label inv-deal-strong">Вам на руки</span>
                      <span class="inv-deal-val inv-deal-strong inv-deal-success">
                        {{ formatCurrency(d.purchasePrice + d.costFee.investorShare) }}
                      </span>
                    </div>
                    <div class="inv-deal-sub">
                      возврат {{ formatCurrency(d.purchasePrice) }} + доход {{ formatCurrency(d.costFee.investorShare) }}
                    </div>
                  </template>
                </template>
              </div>
            </div>
          </div>

          <ServerPager
            v-if="dealsTotal > 0"
            :page="dealsPage"
            :total="dealsTotal"
            :per-page="DEALS_PAGE"
            :busy="dealsLoading"
            :per-page-options="[DEALS_PAGE]"
            @update:page="goToDealsPage($event)"
          />
        </v-card>
      </template>

      <div class="inv-footer">
        Это персональный отчёт инвестора. Только для просмотра.
      </div>
    </div>

    <!-- Active deployment breakdown modal (per selected cashbox) -->
    <v-dialog v-model="showActiveBreakdown" max-width="640" :fullscreen="isMobile">
      <v-card v-if="stake" rounded="lg">
        <div class="inv-dialog-header">
          <div>
            <div class="inv-dialog-title">Деньги в работе · {{ stake.cashBox.name }}</div>
            <div class="text-caption text-medium-emphasis mt-1">
              Из чего складывается {{ formatCurrency(stake.activeDeployment) }}
            </div>
          </div>
          <button class="inv-dialog-close" @click="showActiveBreakdown = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
        <div class="pa-5">
          <div class="inv-formula mb-4">
            <div class="inv-formula-title">
              <v-icon icon="mdi-function-variant" size="14" />
              Как считается
            </div>
            <div class="inv-formula-body">
              <template v-if="stake.costFeeMode">
                Вы в режиме «комиссия от закупки»: в работе — закупочная цена активных сделок
                <strong>за вычетом уже возвращённых вам денег</strong> (первоначальные взносы и оплаченные
                платежи). По мере оплат сумма уменьшается. Итог по всем активным =
                <strong>{{ formatCurrency(stake.activeDeployment) }}</strong>.
              </template>
              <template v-else>
                По каждой активной сделке: ваша доля закупки
                (<strong>закупка × {{ stake.effectivePct.toFixed(2) }}%</strong>)
                <strong>за вычетом вашей доли в уже возвращённых клиентом деньгах</strong>
                (взносы и оплаченные платежи). По мере оплат «в работе» уменьшается. Итог по всем
                активным = <strong>{{ formatCurrency(stake.activeDeployment) }}</strong>.
              </template>
            </div>
          </div>
          <div class="inv-list-header">
            <span>Активные сделки ({{ stake.activeDealsCount }})</span>
            <span class="text-caption text-medium-emphasis">В работе</span>
          </div>
          <div class="inv-list">
            <div
              v-for="d in overviewDeals"
              :key="d.id"
              class="inv-list-row"
            >
              <div class="inv-list-main">
                <div class="inv-list-name">
                  <span class="inv-list-num">#{{ d.dealNumber }}</span>
                  {{ d.productName }}
                </div>
                <div class="inv-list-meta">
                  <template v-if="d.costFee">
                    {{ d.modeLabel ?? 'Комиссия от закупки' }} · {{ formatDate(d.dealDate) }}
                  </template>
                  <template v-else>
                    Закупочная {{ formatCurrency(d.purchasePrice) }} · {{ formatDate(d.dealDate) }}
                  </template>
                  <template v-if="(d.received ?? 0) > 0">
                    <br />
                    доля закупки {{ formatCurrency(d.costFee ? d.purchasePrice : d.stake) }} − возвращено {{ formatCurrency(d.received ?? 0) }}
                  </template>
                  <template v-else-if="d.costFee">
                    <br />
                    возврат {{ formatCurrency(d.purchasePrice) }} + доход {{ formatCurrency(d.costFee.investorShare) }}
                    (комиссия партнёра {{ d.costFee.ratePct }}% = {{ formatCurrency(d.costFee.partnerFee) }})
                  </template>
                </div>
              </div>
              <div class="inv-list-stake" :style="{ color: rowDeployed(d) > 0 ? '#0ea5e9' : (rowDeployed(d) < 0 ? '#f59e0b' : 'rgba(var(--v-theme-on-surface), 0.4)') }">
                {{ rowDeployed(d) > 0 ? formatCurrency(rowDeployed(d)) : (rowDeployed(d) < 0 ? '−' + formatCurrency(-rowDeployed(d)) : 'возвращён') }}
              </div>
            </div>
            <button
              v-if="stake && stake.activeDealsCount > overviewDeals.length"
              class="inv-list-more"
              @click="mainTab = 'deals'"
            >
              Показать все {{ stake.activeDealsCount }}
              <v-icon icon="mdi-chevron-right" size="16" />
            </button>
          </div>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.inv-page {
  min-height: 100vh;
  background: rgb(var(--v-theme-background));
  padding: 24px 16px;
}
.inv-wrap { max-width: 920px; margin: 0 auto; }
.inv-loading, .inv-error {
  min-height: 60vh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px;
}
.inv-error-title { font-size: 18px; font-weight: 700; margin-top: 8px; }
.inv-error-sub { font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.55); }

.inv-hero { background: rgb(var(--v-theme-surface)); }
.inv-hero-row { display: flex; align-items: center; gap: 16px; }
.inv-avatar {
  width: 64px; height: 64px; border-radius: 16px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 22px; letter-spacing: 1px;
}
.inv-identity { flex: 1; min-width: 0; }
.inv-name {
  font-size: 22px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.inv-meta {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 4px;
}
.inv-meta-dot { opacity: 0.5; }

.inv-stats {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;
}
@media (max-width: 1100px) { .inv-stats { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 720px) { .inv-stats { grid-template-columns: repeat(2, 1fr); } }
.inv-stat {
  padding: 14px 16px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
/* Блок «Что означают эти цифры» */
.ci-explain {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.ci-explain-head {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; border: none; background: transparent; cursor: pointer;
  font-size: 13.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.8);
  text-align: left;
}
.ci-explain-head .ci-explain-chev { margin-left: auto; color: rgba(var(--v-theme-on-surface), 0.5); }
.ci-explain-head:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.ci-explain-body {
  padding: 4px 16px 16px; display: flex; flex-direction: column; gap: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.ci-explain-item { display: flex; align-items: flex-start; gap: 10px; padding-top: 10px; }
.ci-explain-dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
.ci-explain-term { font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.ci-explain-desc { font-size: 13px; line-height: 1.5; color: rgba(var(--v-theme-on-surface), 0.62); margin-top: 2px; }
.ci-explain-example {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 12px; border-radius: 10px; margin-top: 2px;
  background: rgba(245, 158, 11, 0.08); color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 12.5px; line-height: 1.55;
}
.ci-explain-example .v-icon { color: #f59e0b; margin-top: 1px; flex-shrink: 0; }
.inv-stat--accent {
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.18);
}
.inv-stat-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5);
}
.inv-stat-value { font-size: 18px; font-weight: 700; margin-top: 4px; }
.inv-stat-sub { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4); margin-top: 2px; }
.inv-stat--clickable {
  border: 1px solid rgba(14, 165, 233, 0.18);
  background: rgba(14, 165, 233, 0.04);
  cursor: pointer; text-align: left;
  font: inherit; color: inherit;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}
.inv-stat--clickable:not(:disabled):hover {
  background: rgba(14, 165, 233, 0.09);
  border-color: rgba(14, 165, 233, 0.45);
  transform: translateY(-1px);
}
.inv-stat--clickable:disabled { cursor: default; opacity: 0.7; }
.inv-stat-action {
  display: inline-flex; align-items: center; gap: 3px; margin-top: 6px;
  font-size: 11px; font-weight: 600; color: rgba(14, 165, 233, 0.7);
}

.inv-params {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 900px) { .inv-params { grid-template-columns: 1fr; } }
.inv-param {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.inv-param--fixed .inv-param-icon { background: rgba(124,58,237,0.12); color: #7c3aed; }
.inv-param--weight .inv-param-icon { background: rgba(99,102,241,0.12); color: #6366f1; }
.inv-param--costfee .inv-param-icon { background: rgba(4,120,87,0.12); color: #047857; }
.inv-param--schedule .inv-param-icon { background: rgba(245,158,11,0.12); color: #f59e0b; }
.inv-param--next .inv-param-icon { background: rgba(16, 185, 129, 0.12); color: #10b981; }
.inv-param--overdue {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.04);
}
.inv-param--overdue .inv-param-icon { background: rgba(239, 68, 68, 0.14); color: #ef4444; }
.inv-param--overdue .inv-param-sub { color: #ef4444; }
.inv-param-icon {
  width: 40px; height: 40px; min-width: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.inv-param-body { flex: 1; min-width: 0; }
.inv-param-label {
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase; letter-spacing: 0.3px;
}
.inv-param-value {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.inv-param-sub {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px;
}

.inv-section-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.inv-section-sub { font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.5); }

/* Cashbox selector tabs */
.inv-cb-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.inv-cb-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 999px; cursor: pointer;
  font-size: 13px; font-weight: 600;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.7);
  transition: all 0.15s;
}
.inv-cb-tab:hover { border-color: rgba(var(--v-theme-on-surface), 0.3); }

/* Theme toggle button (hero corner) */
.inv-theme-btn {
  margin-left: auto; align-self: flex-start; flex-shrink: 0;
  width: 38px; height: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s;
}
.inv-theme-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.3); color: rgba(var(--v-theme-on-surface), 0.95); }

/* Main tabs (Обзор / Сделки) */
.inv-maintabs {
  display: flex; gap: 6px;
  padding: 4px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.inv-maintab {
  flex: 1;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  padding: 9px 12px; border-radius: 9px; cursor: pointer;
  font-size: 13.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition: all 0.15s;
}
.inv-maintab--active {
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.95);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* Deals tab: expandable per-deal share breakdown */
.inv-deals { display: flex; flex-direction: column; }
.inv-deal { border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06); }
.inv-deal:last-child { border-bottom: 0; }
.inv-deal-row {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 4px; cursor: pointer;
}
.inv-deal-arrow { color: rgba(var(--v-theme-on-surface), 0.4); flex-shrink: 0; }
.inv-deal-main { flex: 1; min-width: 0; }
.inv-deal-name {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.inv-deal-num { font-size: 12px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.4); margin-right: 4px; }
.inv-deal-meta { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px; }
/* Бейджик статуса */
.inv-deal-badge {
  display: inline-block; margin-left: 6px;
  padding: 1px 7px; border-radius: 6px;
  font-size: 10px; font-weight: 700; vertical-align: middle;
}
.inv-deal-badge--active {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.inv-deal-badge--done { background: rgba(16, 185, 129, 0.15); color: #10b981; }
/* KPI над списком сделок */
/* Фильтр таба «Сделки»: все / активные / завершённые */
/* Распределение прибыли по кассе в кабинете */
.inv-share-kpi { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.inv-share-kpi-card {
  padding: 12px 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.inv-share-kpi-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.inv-share-kpi-dot { width: 9px; height: 9px; border-radius: 50%; }
.inv-share-kpi-val { font-size: 20px; font-weight: 800; margin-top: 4px; font-variant-numeric: tabular-nums; }
.inv-hero-dist {
  padding: 14px 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.inv-hero-dist-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
.inv-hero-dist-title { font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.75); }
.inv-hero-dist-total { font-size: 16px; font-weight: 800; color: rgba(var(--v-theme-on-surface), 0.9); font-variant-numeric: tabular-nums; }
.inv-hero-dist-bar { height: 10px; border-radius: 5px; overflow: hidden; background: #047857; }
.inv-hero-dist-fill { height: 100%; background: #6366f1; border-radius: 5px 0 0 5px; }
.inv-hero-dist-legend { display: flex; justify-content: space-between; margin-top: 8px; font-size: 12.5px; font-weight: 600; }
.inv-deal-filter { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.inv-deal-filter-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 999px;
  font-size: 13px; font-weight: 600;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s;
}
.inv-deal-filter-chip:hover { border-color: rgba(var(--v-theme-on-surface), 0.3); }
.inv-deal-filter-chip--active {
  background: rgb(var(--v-theme-primary)); border-color: rgb(var(--v-theme-primary)); color: #fff;
}
.inv-deal-filter-count { font-size: 11px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.45); }
.inv-deal-filter-chip--active .inv-deal-filter-count { color: rgba(255, 255, 255, 0.85); }
.inv-deals-kpi {
  display: flex; gap: 8px; margin-bottom: 14px;
  overflow-x: auto; padding-bottom: 2px;
  scrollbar-width: none;
}
.inv-deals-kpi::-webkit-scrollbar { display: none; }
.inv-deals-kpi-card {
  flex: 1 0 140px; min-width: 140px; padding: 10px 12px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.inv-deals-kpi-card--inv { background: rgba(16, 185, 129, 0.1); }
.inv-deals-kpi-card--part { background: rgba(245, 158, 11, 0.1); }
.inv-deals-kpi-label {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 4px;
}
.inv-deals-kpi-val {
  font-size: 17px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-variant-numeric: tabular-nums;
}
.inv-deals-kpi-val--inv { color: #10b981; }
.inv-deals-kpi-val--part { color: #d97706; }
.inv-deal-earn { text-align: right; flex-shrink: 0; }
.inv-deal-earn-val { font-size: 14px; font-weight: 800; color: #10b981; }
.inv-deal-earn-label { font-size: 10.5px; color: rgba(var(--v-theme-on-surface), 0.45); }
.inv-deal-body { padding: 4px 4px 14px 32px; }
.inv-deal-progress { margin-bottom: 9px; }
.inv-deal-progress-head {
  display: flex; justify-content: space-between;
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.55);
  margin-bottom: 5px;
}
.inv-deal-track {
  height: 6px; border-radius: 3px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.inv-deal-track-fill { height: 100%; border-radius: 3px; background: #f59e0b; }
.inv-deal-line {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 4px 0; font-size: 13px;
}
.inv-deal-label {
  display: inline-flex; align-items: center; gap: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.inv-deal-val {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.inv-deal-strong { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.inv-deal-success { color: #10b981; }
.inv-deal-part { color: #d97706; font-weight: 600; }
.inv-deal-mode { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4); }
.inv-deal-sub {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45);
  text-align: right; margin-top: 2px;
}
.inv-deal-divider {
  height: 0; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  margin: 12px 0;
}
/* Заголовок смысловой секции в раскрытом блоке */
.inv-deal-sec-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 7px;
}
.inv-deal-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.inv-deal-dot--inv { background: #10b981; }
.inv-deal-dot--part { background: #f59e0b; }
.inv-deal-dot--gross { background: rgba(var(--v-theme-on-surface), 0.4); }
.inv-deal-split {
  display: flex; height: 7px; border-radius: 4px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.08);
  margin: 8px 0 2px;
}
.inv-deal-split--lg { height: 9px; border-radius: 5px; margin: 0 0 10px; }
.inv-deal-split-inv { background: #10b981; }
.inv-deal-split-part { background: #f59e0b; }

/* Selected cashbox header */
.inv-cb-head { display: flex; align-items: center; gap: 12px; }
.inv-cb-name { font-size: 17px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.inv-cb-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px; }
.inv-retry {
  margin-top: 8px;
  padding: 6px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 8px;
  background: none;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}
.inv-empty {
  text-align: center; padding: 24px 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.inv-journal { display: flex; flex-direction: column; gap: 4px; }
.inv-journal-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 10px;
  transition: background 0.15s;
}
.inv-journal-row:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.inv-journal-icon {
  width: 36px; height: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.inv-journal-main { flex: 1; min-width: 0; }
.inv-journal-title {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.inv-journal-meta {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px;
}
.inv-journal-amount { font-size: 15px; font-weight: 700; flex-shrink: 0; }

.inv-footer {
  text-align: center; margin-top: 24px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Breakdown dialog */
.inv-dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.inv-dialog-title { font-size: 17px; font-weight: 700; }
.inv-dialog-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.inv-formula {
  padding: 12px 14px;
  background: rgba(14, 165, 233, 0.06);
  border: 1px solid rgba(14, 165, 233, 0.2);
  border-radius: 10px;
}
.inv-formula-title {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 700; color: #0ea5e9; margin-bottom: 6px;
}
.inv-formula-body { font-size: 13px; line-height: 1.5; color: rgba(var(--v-theme-on-surface), 0.78); }
.inv-list-more {
  display: flex; align-items: center; justify-content: center; gap: 4px;
  width: 100%; padding: 10px;
  background: none; border: none;
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}
.inv-list-more:hover { opacity: 0.8; }
.inv-list-header {
  display: flex; justify-content: space-between;
  margin-bottom: 8px; font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.inv-list {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 10px;
  max-height: 340px; overflow-y: auto;
}
.inv-list-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
}
.inv-list-row + .inv-list-row {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.inv-list-main { flex: 1; min-width: 0; }
.inv-list-num {
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-right: 6px;
}
.inv-list-name {
  font-size: 13px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.inv-list-meta {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px;
}
.inv-list-stake { font-size: 14px; font-weight: 700; color: #0ea5e9; }

/* ───── Mobile ───── */
@media (max-width: 599px) {
  .inv-page { padding: 16px 12px; }

  /* Hero row — стекаем аватар + имя в колонку при очень узких экранах. */
  .inv-hero { padding: 16px !important; }
  .inv-avatar { width: 56px; height: 56px; border-radius: 14px; font-size: 20px; }
  .inv-name { font-size: 18px; }

  /* KPI cards — компактнее, чтобы 2×2 не растягивались. */
  .inv-stat { padding: 12px; }
  .inv-stat-label { font-size: 10px; }
  .inv-stat-value { font-size: 16px; }

  /* Params (Касса/Доля/Периодичность/Следующая выплата) — иконка чуть меньше. */
  .inv-param { padding: 12px; }
  .inv-param-icon {
    width: 36px; height: 36px; min-width: 36px;
    border-radius: 9px;
  }
  .inv-param-value { font-size: 14px; }
}
</style>
