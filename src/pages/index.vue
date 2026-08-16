<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { useRequestsStore } from '@/stores/requests'
import { useNotificationsStore } from '@/stores/notifications'
import { formatCurrency, formatCurrencyShort, formatDateShort, formatPhone } from '@/utils/formatters'
import { userName, clientProfileName } from '@/types'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useDealLock } from '@/composables/useDealLock'
import { useToast } from '@/composables/useToast'
import HeroSummary from '@/components/HeroSummary.vue'
import { useAnalyticsSummary, fetchDealsBreakdown } from '@/composables/useAnalyticsOverview'
import MetricDetailDialog from '@/components/MetricDetailDialog.vue'
import { useCapital } from '@/composables/useCapital'
import { useIsMobile } from '@/composables/useIsMobile'
import { useAuthStore } from '@/stores/auth'
import { useSubscription } from '@/composables/useSubscription'
import { useSections } from '@/composables/useSections'
import { api } from '@/api/client'

const router = useRouter()
const { isDealLocked } = useDealLock()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const { isMobile } = useIsMobile()
const { capital, isCapitalSet, fetchCapital } = useCapital()



const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()
const requestsStore = useRequestsStore()
const notificationsStore = useNotificationsStore()
const authStore = useAuthStore()
const subscription = useSubscription()
const sections = useSections()

// Upcoming payments with deal info
const upcomingPayments = computed(() => {
  const now = Date.now()
  // Сделка приходит вместе с платежом — портфель в памяти для этого больше
  // не нужен.
  return upcomingRows.value.map((p: any) => ({
    payment: p,
    dealId: p.dealId,
    deal: p.deal,
    daysRemaining: Math.ceil((new Date(p.dueDate).getTime() - now) / 86_400_000),
  }))
})

// Строки таблицы активных сделок: всё, что показываем, считаем один раз здесь,
// а не по несколько раз на каждую ячейку при перерисовке.
const topActiveDeals = computed(() =>
  topDealRows.value.map((deal: any) => ({
    deal,
    received: dealReceived(deal),
    next: nextPaymentOf(deal.id),
    progress: deal.numberOfPayments > 0
      ? Math.round((deal.paidPayments / deal.numberOfPayments) * 100)
      : 0,
  })),
)

// Доход по уже полученным деньгам за вычетом доли со-инвесторов. Считает
// сервер — теми же формулами, что и раздел «Отчёты».
const earnedNet = computed(() => summary.value?.deals.earnedNet ?? null)

// ── Счётчики для ключевых показателей ──
/** Итоги для hero-блока: сервер считает их теми же формулами, что «Отчёты». */
const heroTotals = computed(() => {
  const d = summary.value?.deals
  if (!d) return null
  return {
    // Главная всегда показывала остаток по АКТИВНЫМ сделкам — тем же числом,
    // что и расшифровка по клику. Поле `remaining` (по всем статусам) остаётся
    // за вкладкой «Отчёты».
    totalRemaining: d.remainingActive ?? d.remaining,
    totalRevenue: d.contractTotal,
    totalInvested: d.purchaseTotal,
    totalProfit: d.marginTotal,
    monthlyIncome: 0, // на главной не показывается
  }
})

const dealsTotalCount = computed(() => {
  const by = dealsStore.counts?.byStatus
  return by ? Object.values(by).reduce((s, n) => s + n, 0) : 0
})
const dealsActiveCount = computed(() => dealsStore.counts?.byStatus?.ACTIVE ?? 0)
const dealsCompletedCount = computed(() => dealsStore.counts?.byStatus?.COMPLETED ?? 0)

const clientsCount = computed(() => summary.value?.clients.total ?? 0)
const activeClientsCount = computed(() => summary.value?.clients.withActiveDeals ?? 0)

// Карточки инвесторов и сотрудников показываем, только если они вообще есть —
// пустой ноль на главной ничего не сообщает, а место занимает.
const investorsCount = ref<number | null>(null)
const staffCount = ref<number | null>(null)
const canSeeCoInvestors = computed(
  () => sections.visible('coInvestors') && authStore.canAccess('/co-investors'),
)
const canSeeStaff = computed(() => authStore.isOwner && sections.visible('staff'))



// ══════════════════════════════════════════════════════════════════
// Серверные данные главной
//
// Раньше страница поднимала в память весь портфель сделок и все платежи, а
// показатели считала сама. Теперь итоги приходят одним запросом, а списки —
// короткими выборками: пять ближайших платежей и четыре активные сделки.
// ══════════════════════════════════════════════════════════════════

const { summary } = useAnalyticsSummary(() => null)

/** Ближайшие платежи: сервер сортирует по сроку и отдаёт первые пять. */
const upcomingRows = ref<any[]>([])
async function loadUpcoming() {
  try {
    const res = await api.get<{ items: any[] }>(
      '/payments?tab=active&sort=dueDate&dir=asc&limit=5',
    )
    upcomingRows.value = res.items ?? []
  } catch (e) {
    console.error('Failed to load upcoming payments:', e)
  }
}

/** Четыре последние активные сделки для таблицы на главной. */
const topDealRows = ref<any[]>([])
async function loadTopDeals() {
  try {
    const res = await api.get<{ items: any[] }>(
      '/deals?role=investor&status=ACTIVE&limit=4&sort=createdAt&dir=desc',
    )
    topDealRows.value = res.items ?? []
    // График нужен, чтобы показать следующий платёж по каждой сделке —
    // четыре лёгких запроса вместо выгрузки всех платежей партнёра.
    await Promise.all(
      topDealRows.value.map((d) => paymentsStore.fetchPaymentsForDeal(d.id).catch(() => {})),
    )
  } catch (e) {
    console.error('Failed to load top deals:', e)
  }
}

const pageLoading = ref(true)

onMounted(async () => {
  try {
    await Promise.all([
      // Портфель сделок и все платежи здесь больше не грузятся: у партнёра с
      // тысячами сделок это были два самых тяжёлых запроса в кабинете. Итоги
      // считает сервер, списки приходят короткими.
      dealsStore.fetchDealCounts({}),
      loadUpcoming(),
      loadTopDeals(),
      requestsStore.fetchRequests(),
      notificationsStore.fetchNotifications(),
      fetchCapital(),
      canSeeCoInvestors.value
        ? api.get<any[]>('/co-investors/persons')
            .then((r) => { investorsCount.value = r?.length ?? 0 })
            .catch(() => {})
        : Promise.resolve(),
      canSeeStaff.value
        ? api.get<any[]>('/auth/investor/staff')
            .then((r) => { staffCount.value = r?.length ?? 0 })
            .catch(() => {})
        : Promise.resolve(),
    ])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки данных')
  } finally {
    pageLoading.value = false
  }
})

// Overdue amount
// Сервер считает просрочку по тому же правилу, что и аналитика: платежи
// отменённых и принудительно закрытых сделок деньгами не являются. Раньше
// главная их суммировала и показывала завышенную цифру.
const overdueAmount = computed(() => summary.value?.payments.overdueSum ?? 0)

// ── Metric breakdown dialog ──
type MetricKey = 'invested' | 'revenue' | 'profit' | 'remaining' | 'received' | 'earned' | 'roi' | 'overdue'
// ── Расшифровка показателя: общий компонент с аналитикой и отчётами ──
const metricOpen = ref(false)
const metricTitle = ref('')
const metricHint = ref('')
const metricColor = ref('#10b981')
const metricTotal = ref(0)
const metricItems = ref<any[]>([])

/** Заголовок, пояснение и цвет для каждой расшифровки. */
const BREAKDOWN_META: Record<string, { title: string; hint: string; color: string }> = {
  invested: {
    title: 'Инвестировано в товар',
    hint: 'Сколько денег потрачено на закупку товара по всем сделкам.',
    color: '#3b82f6',
  },
  revenue: {
    title: 'Общий оборот',
    hint: 'Сколько всего должны заплатить клиенты по всем сделкам — закупка вместе с наценкой.',
    color: '#0ea5e9',
  },
  profit: {
    title: 'Наценка по сделкам',
    hint: 'Наценка по каждой сделке: цена продажи минус закупка. Это доход до вычета доли со-инвесторов.',
    color: '#059669',
  },
  remaining: {
    title: 'Ожидается к получению',
    hint: 'Сколько клиенты ещё должны заплатить по активным сделкам.',
    color: '#f59e0b',
  },
  received: {
    title: 'Получено',
    hint: 'Деньги, которые клиенты уже отдали: первоначальные взносы и оплаченные платежи.',
    color: '#10b981',
  },
  earned: {
    title: 'Заработано',
    hint: 'Ваш доход по деньгам, которые клиенты уже отдали.',
    color: '#047857',
  },
  roi: {
    title: 'Доходность сделок',
    hint: 'Сколько наценки приносит каждый вложенный рубль — наценка относительно закупки.',
    color: '#059669',
  },
  overdue: {
    title: 'Просроченные платежи',
    hint: 'Платежи, срок которых уже прошёл, а деньги не поступили.',
    color: '#ef4444',
  },
}

const BREAKDOWN_PAGE = 100
const metricLoading = ref(false)
const metricMetric = ref<MetricKey>('invested')
/** Всего сделок за показателем — в списке может быть показана лишь часть. */
const metricCount = ref(0)

const money = (n: number) => formatCurrency(Math.round(n || 0))

/** Строка списка из серверной сделки: значение показателя плюс пояснения. */
function breakdownRow(metric: MetricKey, d: any) {
  const base = {
    id: d.id,
    title: d.productName || 'Сделка',
    subtitle: d.clientName || '—',
  }
  switch (metric) {
    case 'invested':
      return { ...base, value: d.cost, parts: [
        { label: 'продано за', value: money(d.totalPrice) },
        { label: 'наценка', value: money(d.margin) },
        { label: 'вернулось', value: money(d.received) },
      ] }
    case 'revenue':
      return { ...base, value: d.totalPrice, parts: [
        { label: 'закупка', value: money(d.cost) },
        { label: 'наценка', value: money(d.margin) },
      ] }
    case 'profit':
      return { ...base, value: d.margin, parts: [
        { label: 'закупка', value: money(d.cost) },
        { label: 'цена продажи', value: money(d.totalPrice) },
      ] }
    case 'remaining':
      return { ...base, value: d.remaining, parts: [
        { label: 'всего по сделке', value: money(d.totalPrice) },
        { label: 'уже получено', value: money(d.received) },
      ] }
    case 'received':
      return { ...base, value: d.received, parts: [
        { label: 'всего по сделке', value: money(d.totalPrice) },
        { label: 'осталось', value: money(d.remaining) },
        { label: 'взнос', value: money(d.downPayment) },
      ] }
    case 'earned':
      // Чистый доход считает сервер (прибыль с полученных денег минус доля
      // со-инвесторов) — раньше здесь стояла наценка, и расшифровка показывала
      // сумму в разы больше самой карточки.
      return { ...base, value: d.earnedNet ?? 0, parts: [
        { label: 'получено', value: money(d.received) },
        { label: 'наценка по сделке', value: money(d.margin) },
      ] }
    case 'roi':
      return {
        ...base,
        value: d.cost > 0 ? Math.round((d.margin / d.cost) * 1000) / 10 : 0,
        suffix: '%',
        parts: [
          { label: 'закупка', value: money(d.cost) },
          { label: 'наценка', value: money(d.margin) },
        ],
      }
    case 'overdue':
      return { ...base, value: d.overdueAmount, parts: [
        { label: 'просрочено дней', value: String(d.maxOverdueDays) },
        { label: 'остаток долга', value: money(d.remaining) },
      ] }
    default:
      return { ...base, value: 0, parts: [] }
  }
}

/**
 * Расшифровка показателя. Сделки грузятся с сервера порциями: у партнёра их
 * тысячи, и раньше страница перебирала весь портфель в памяти.
 */
async function openBreakdown(metric: MetricKey) {
  const meta = BREAKDOWN_META[metric] ?? BREAKDOWN_META.invested!
  metricMetric.value = metric
  metricTitle.value = meta.title
  metricHint.value = meta.hint
  metricColor.value = meta.color
  metricItems.value = []
  metricTotal.value = 0
  metricCount.value = 0
  metricOpen.value = true
  metricLoading.value = true
  try {
    const res = await fetchDealsBreakdown(metric as any, { limit: BREAKDOWN_PAGE })
    metricItems.value = res.items.map((d) => breakdownRow(metric, d))
    metricCount.value = res.count
    // Итог считает сервер по ВСЕЙ выборке — в списке может быть лишь часть.
    // Для доходности сумма бессмысленна.
    metricTotal.value = metric === 'roi' ? 0 : res.total
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить расшифровку')
  } finally {
    metricLoading.value = false
  }
}

/** Догрузить следующую порцию сделок в открытую расшифровку. */
async function loadMoreBreakdown() {
  if (metricLoading.value) return
  metricLoading.value = true
  try {
    const res = await fetchDealsBreakdown(metricMetric.value as any, {
      limit: BREAKDOWN_PAGE,
      offset: metricItems.value.length,
    })
    metricItems.value = [
      ...metricItems.value,
      ...res.items.map((d) => breakdownRow(metricMetric.value, d)),
    ]
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить ещё')
  } finally {
    metricLoading.value = false
  }
}

const metricHasMore = computed(() => metricItems.value.length < metricCount.value)

/** Телефон клиента — по нему обычно и звонят из этих таблиц. */
function dealClientPhone(deal?: any): string {
  if (!deal) return ''
  const raw = deal.client?.phone || deal.clientProfile?.phone || deal.externalClientPhone
  return raw ? formatPhone(raw) : ''
}

/** Сколько по сделке уже получено: первоначальный взнос + оплаченные платежи. */
function dealReceived(deal: any): number {
  // Сумма договора минус остаток: то же число, но без перебора всех платежей
  // партнёра в памяти.
  return Math.max(0, (deal.totalPrice || 0) - (deal.remainingAmount || 0))
}

/**
 * Ближайший неоплаченный платёж по сделке. Не getNextPayment из стора: тот
 * берёт первый PENDING и проскакивает просрочку, а именно она тут важнее всего.
 */
function nextPaymentOf(dealId: string) {
  return paymentsStore
    .getPaymentsForDeal(dealId)
    .filter((p: any) => p.status === 'PENDING' || p.status === 'OVERDUE')
    .sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate))[0]
}

const AVATAR_COLORS = ['#047857', '#3b82f6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ef4444']
function dealClientName(deal?: any): string {
  if (!deal) return '—'
  if (deal.client) return userName(deal.client)
  if (deal.clientProfile) return clientProfileName(deal.clientProfile)
  return deal.externalClientName || '—'
}
function getInitial(name?: string) { return name ? name.charAt(0).toUpperCase() : '?' }
function getAvatarColor(name?: string) {
  if (!name) return AVATAR_COLORS[0]
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Page loader -->
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
    <!-- Capital banner -->
    <div v-if="!isCapitalSet" class="dash-capital-banner mb-4" @click="router.push('/cashboxes')">
      <div class="dash-capital-banner-icon">
        <v-icon icon="mdi-wallet-outline" size="20" />
      </div>
      <div class="dash-capital-banner-content">
        <div class="dash-capital-banner-title">Настройте учёт капитала</div>
        <div class="dash-capital-banner-text">Укажите начальный капитал для контроля доступных средств</div>
      </div>
      <v-icon icon="mdi-chevron-right" size="20" style="color: rgba(var(--v-theme-on-surface), 0.3);" />
    </div>

    <!-- Общая сводка на всю ширину -->
    <HeroSummary
      show-analytics-link
      show-locked-overlay
      :totals="heroTotals"
      :earned-net="earnedNet"
      class="hero-card mb-6"
      @metric="openBreakdown($event as MetricKey)"
    />

    <!-- KPI Cards (horizontal) -->
    <div class="dash-section-title">Ключевые показатели</div>
    <div class="kpi-row mb-6">
      <div class="kpi-card kpi-clickable" @click="router.push('/deals')">
        <div class="kpi-icon-wrap" style="background: rgba(100, 116, 139, 0.12); color: #64748b;">
          <v-icon icon="mdi-briefcase-outline" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ dealsTotalCount }}</div>
          <div class="kpi-label">Всего сделок</div>
        </div>
      </div>

      <div class="kpi-card kpi-clickable" @click="router.push('/deals')">
        <div class="kpi-icon-wrap" style="background: rgba(14, 165, 233, 0.1); color: #0ea5e9;">
          <v-icon icon="mdi-briefcase-check" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ dealsActiveCount }}</div>
          <div class="kpi-label">Активных</div>
        </div>
      </div>

      <div class="kpi-card kpi-clickable" @click="router.push('/deals')">
        <div class="kpi-icon-wrap" style="background: rgba(22, 163, 74, 0.1); color: #16a34a;">
          <v-icon icon="mdi-check-circle" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ dealsCompletedCount }}</div>
          <div class="kpi-label">Завершённых</div>
        </div>
      </div>

      <div class="kpi-card kpi-clickable" @click="router.push('/clients')">
        <div class="kpi-icon-wrap" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
          <v-icon icon="mdi-account-group" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ clientsCount }}</div>
          <div class="kpi-label">Клиентов</div>
        </div>
      </div>

      <div class="kpi-card kpi-clickable" @click="router.push('/clients')">
        <div class="kpi-icon-wrap" style="background: rgba(236, 72, 153, 0.1); color: #ec4899;">
          <v-icon icon="mdi-account-clock-outline" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ activeClientsCount }}</div>
          <div class="kpi-label">С активными сделками</div>
        </div>
      </div>

      <!-- Инвесторы и сотрудники — только когда они есть -->
      <div
        v-if="investorsCount"
        class="kpi-card kpi-clickable"
        @click="router.push('/co-investors')"
      >
        <div class="kpi-icon-wrap" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
          <v-icon icon="mdi-handshake-outline" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ investorsCount }}</div>
          <div class="kpi-label">Со-инвесторов</div>
        </div>
      </div>

      <div
        v-if="staffCount"
        class="kpi-card kpi-clickable"
        @click="router.push('/staff')"
      >
        <div class="kpi-icon-wrap" style="background: rgba(6, 182, 212, 0.1); color: #06b6d4;">
          <v-icon icon="mdi-account-key" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ staffCount }}</div>
          <div class="kpi-label">Сотрудников</div>
        </div>
      </div>

      <div class="kpi-card kpi-clickable" v-if="overdueAmount > 0" @click="openBreakdown('overdue')">
        <div class="kpi-icon-wrap" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
          <v-icon icon="mdi-alert-circle" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value" style="color: #ef4444;">{{ formatCurrencyShort(overdueAmount) }}</div>
          <div class="kpi-label">Просрочено</div>
        </div>
      </div>
    </div>

    <!-- Ближайшие платежи и активные сделки — таблицами, друг под другом -->
    <div class="dash-section-title">Активность</div>
    <v-row>
      <!-- Ближайшие платежи -->
      <v-col cols="12">
        <v-card rounded="lg" elevation="0" border class="h-100">
          <div class="d-flex align-center justify-space-between pa-5 pb-3">
            <div>
              <div class="chart-title">Ближайшие платежи</div>
              <div class="chart-subtitle">{{ upcomingPayments.length }} ожидаемых</div>
            </div>
            <button class="dash-link-btn" @click="router.push('/payments')">
              Все платежи
              <v-icon icon="mdi-arrow-right" size="16" />
            </button>
          </div>

          <div v-if="upcomingPayments.length" class="dt-scroll">
            <table class="dt">
              <thead>
                <tr>
                  <th class="dt-th">Сделка</th>
                  <th class="dt-th">Клиент</th>
                  <th class="dt-th dt-th--num">Платёж</th>
                  <th class="dt-th dt-th--num">Сумма</th>
                  <th class="dt-th dt-th--num">Долг после оплаты</th>
                  <th class="dt-th dt-th--num">Срок</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in upcomingPayments"
                  :key="item.payment.id"
                  class="dt-row"
                  :class="{ 'deal-locked-dim': isDealLocked(item.deal) }"
                  @click="item.deal && router.push(`/deals/${item.deal.id}`)"
                >
                  <td class="dt-td">
                    <span class="dt-name">{{ item.deal?.productName || 'Товар' }}</span>
                    <span v-if="isDealLocked(item.deal)" class="deal-locked-chip ml-2">
                      <v-icon icon="mdi-lock-outline" />Недоступно
                    </span>
                    <div v-if="item.deal" class="dt-sub">№ {{ item.deal.dealNumber }}</div>
                  </td>
                  <td class="dt-td">
                    <div class="dt-client">{{ dealClientName(item.deal) }}</div>
                    <div v-if="dealClientPhone(item.deal)" class="dt-sub">
                      {{ dealClientPhone(item.deal) }}
                    </div>
                  </td>
                  <td class="dt-td dt-td--num">
                    {{ item.payment.number }}<span class="dt-muted"> из {{ item.deal?.numberOfPayments ?? '—' }}</span>
                  </td>
                  <td class="dt-td dt-td--num dt-strong">{{ formatCurrency(item.payment.amount) }}</td>
                  <!-- Остаток по сделке ПОСЛЕ этого платежа: сразу видно,
                       закрывает ли он сделку или это середина графика. -->
                  <td class="dt-td dt-td--num dt-muted">
                    {{ formatCurrency(item.payment.remainingAfter) }}
                  </td>
                  <td class="dt-td dt-td--num">
                    <span
                      class="dt-badge"
                      :class="item.daysRemaining >= 0 ? 'dt-badge--ok' : 'dt-badge--overdue'"
                    >
                      {{ item.daysRemaining >= 0
                        ? `через ${item.daysRemaining} дн`
                        : `просрочен ${Math.abs(item.daysRemaining)} дн` }}
                    </span>
                    <div class="dt-sub">{{ formatDateShort(item.payment.dueDate) }}</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else class="pa-8 text-center text-medium-emphasis text-body-2">
            Нет предстоящих платежей
          </div>
        </v-card>
      </v-col>

      <!-- Активные сделки -->
      <v-col cols="12">
        <v-card rounded="lg" elevation="0" border class="h-100">
          <div class="d-flex align-center justify-space-between pa-5 pb-3">
            <div>
              <div class="chart-title">Активные сделки</div>
              <div class="chart-subtitle">{{ dealsActiveCount }} сделок в работе</div>
            </div>
            <button class="dash-link-btn" @click="router.push('/deals')">
              Все сделки
              <v-icon icon="mdi-arrow-right" size="16" />
            </button>
          </div>

          <div v-if="topActiveDeals.length" class="dt-scroll">
            <table class="dt">
              <thead>
                <tr>
                  <th class="dt-th">Сделка</th>
                  <th class="dt-th">Клиент</th>
                  <th class="dt-th dt-th--num">Сумма сделки</th>
                  <th class="dt-th dt-th--num">Получено</th>
                  <th class="dt-th dt-th--num">Остаток</th>
                  <th class="dt-th dt-th--num">Платежи</th>
                  <th class="dt-th dt-th--num">Следующий платёж</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in topActiveDeals"
                  :key="row.deal.id"
                  class="dt-row"
                  :class="{ 'deal-locked-dim': isDealLocked(row.deal) }"
                  @click="router.push(`/deals/${row.deal.id}`)"
                >
                  <td class="dt-td">
                    <span class="dt-name">{{ row.deal.productName }}</span>
                    <span v-if="isDealLocked(row.deal)" class="deal-locked-chip ml-2">
                      <v-icon icon="mdi-lock-outline" />Недоступно
                    </span>
                    <div class="dt-sub">№ {{ row.deal.dealNumber }}</div>
                  </td>
                  <td class="dt-td">
                    <div class="dt-client">{{ dealClientName(row.deal) }}</div>
                    <div v-if="dealClientPhone(row.deal)" class="dt-sub">{{ dealClientPhone(row.deal) }}</div>
                  </td>
                  <td class="dt-td dt-td--num">{{ formatCurrency(row.deal.totalPrice) }}</td>
                  <!-- Получено + Остаток в сумме дают сумму сделки — цифры
                       сходятся прямо в строке, ничего не надо пересчитывать. -->
                  <td class="dt-td dt-td--num dt-pos">{{ formatCurrency(row.received) }}</td>
                  <td class="dt-td dt-td--num dt-strong">{{ formatCurrency(row.deal.remainingAmount) }}</td>
                  <td class="dt-td dt-td--num">
                    <div>{{ row.deal.paidPayments }} <span class="dt-muted">из {{ row.deal.numberOfPayments }}</span></div>
                    <div class="dt-track">
                      <div class="dt-fill" :style="{ width: row.progress + '%' }" />
                    </div>
                  </td>
                  <td class="dt-td dt-td--num">
                    <template v-if="row.next">
                      <div class="dt-strong">{{ formatCurrency(row.next.amount) }}</div>
                      <div class="dt-sub" :class="{ 'dt-sub--overdue': row.next.status === 'OVERDUE' }">
                        {{ formatDateShort(row.next.dueDate) }}
                      </div>
                    </template>
                    <span v-else class="dt-muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else class="pa-8 text-center text-medium-emphasis text-body-2">
            Нет активных сделок
          </div>
        </v-card>
      </v-col>
    </v-row>
    </template>

    <!-- Metric Breakdown Dialog -->
    <!-- Расшифровка показателя — общий компонент с аналитикой и отчётами -->
    <MetricDetailDialog
      v-model="metricOpen"
      :title="metricTitle"
      :hint="metricHint"
      :total="metricTotal"
      :color="metricColor"
      :items="metricItems"
      :loading="metricLoading"
      :count="metricCount"
      :has-more="metricHasMore"
      @load-more="loadMoreBreakdown"
    />

  </div>
</template>

<style scoped>
/* Section titles */
.dash-section-title {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.35);
  margin-bottom: 12px;
  padding-left: 2px;
}

/* ── Таблицы блоков активности ──
   Тот же табличный вид, что в разделах сделок и отчётов: заголовки колонок,
   строки-ссылки, числа справа. Раньше это были списки-карточки, которые
   выбивались из остального интерфейса. */
.dt-scroll { overflow-x: auto; padding: 0 8px 8px; }
.dt { width: 100%; border-collapse: collapse; white-space: nowrap; }
.dt-th {
  text-align: left; padding: 8px 12px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.42);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.09);
}
.dt-th--num { text-align: right; }
.dt-row { cursor: pointer; }
.dt-row:hover .dt-td { background: rgba(var(--v-theme-on-surface), 0.03); }
.dt-td {
  padding: 11px 12px; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.75);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.dt-row:last-child .dt-td { border-bottom: none; }
.dt-td--num { text-align: right; }
.dt-name {
  font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9);
  max-width: 210px; display: inline-block; vertical-align: middle;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dt-muted { color: rgba(var(--v-theme-on-surface), 0.5); }
.dt-pos { color: #10b981; font-weight: 600; }
.dt-client {
  max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.dt-sub--overdue { color: #ef4444; }
.dt-strong { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.dt-sub { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4); margin-top: 2px; }
.dt-badge {
  display: inline-block; font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 6px;
}
.dt-badge--ok { color: #10b981; background: rgba(16, 185, 129, 0.1); }
.dt-badge--overdue { color: #ef4444; background: rgba(239, 68, 68, 0.1); }
.dt-track {
  width: 84px; height: 4px; margin-left: auto; margin-top: 5px;
  border-radius: 3px; background: rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden;
}
.dt-fill { height: 100%; background: rgb(var(--v-theme-primary)); border-radius: 3px; }

@media (max-width: 600px) {
  .dt-name { max-width: 130px; }
  .dt-td, .dt-th { padding: 9px 8px; }
}

/* KPI Row (horizontal) */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.kpi-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}

.kpi-icon-wrap {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kpi-info {
  min-width: 0;
}

.kpi-value {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.kpi-label {
  font-size: 12px;
  line-height: 1.25;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Chart title (used in activity section) */
.chart-title {
  font-size: 16px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.chart-subtitle {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Link button */
.dash-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  border: none;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.dash-link-btn:hover {
  background: rgba(var(--v-theme-primary), 0.15);
}

.payment-row--clickable { cursor: pointer; }

.payment-badge--ok {
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
}

.payment-badge--overdue {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.deal-row--clickable { cursor: pointer; }



.kpi-clickable {
  cursor: pointer;
  transition: all 0.15s;
}
.kpi-clickable:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.04);
}

</style>
