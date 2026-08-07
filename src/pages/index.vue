<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { useRequestsStore } from '@/stores/requests'
import { useNotificationsStore } from '@/stores/notifications'
import { formatCurrency, formatCurrencyShort, formatDateShort, formatPhone } from '@/utils/formatters'
import { localDateStr } from '@/utils/paymentAttribution'
import { paymentProfit } from '@/utils/dealProfit'
import { userName, clientProfileName } from '@/types'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useDealLock } from '@/composables/useDealLock'
import { useToast } from '@/composables/useToast'
import HeroSummary from '@/components/HeroSummary.vue'
import MetricDetailDialog from '@/components/MetricDetailDialog.vue'
import { useCapital } from '@/composables/useCapital'
import { useIsMobile } from '@/composables/useIsMobile'
import { useClientsStore } from '@/stores/clients'
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
const clientsStore = useClientsStore()
const authStore = useAuthStore()
const subscription = useSubscription()
const sections = useSections()

// Payment health
const paymentHealth = computed(() => {
  const paid = paymentsStore.paidPayments
  if (!paid.length) return 100
  // Сравниваем КАЛЕНДАРНЫЕ даты; paidAt берём ЛОКАЛЬНО (согласованно с атрибуцией
  // месяца). Тот же фикс, что в analytics.vue paymentHealth.
  const onTime = paid.filter(p => p.paidAt && localDateStr(p.paidAt) <= p.dueDate.slice(0, 10)).length
  return Math.round((onTime / paid.length) * 100)
})

// Upcoming payments with deal info
const upcomingPayments = computed(() => {
  const now = Date.now()
  return paymentsStore.allUpcoming.slice(0, 5).map((item) => {
    const deal = dealsStore.getDeal(item.dealId)
    const dueTime = new Date(item.payment.dueDate).getTime()
    const daysRemaining = Math.ceil((dueTime - now) / 86_400_000)
    return { ...item, deal, daysRemaining }
  })
})

// Строки таблицы активных сделок: всё, что показываем, считаем один раз здесь,
// а не по несколько раз на каждую ячейку при перерисовке.
const topActiveDeals = computed(() =>
  dealsStore.activeDeals.slice(0, 4).map((deal: any) => ({
    deal,
    received: dealReceived(deal),
    next: nextPaymentOf(deal.id),
    progress: deal.numberOfPayments > 0
      ? Math.round((deal.paidPayments / deal.numberOfPayments) * 100)
      : 0,
  })),
)

// ── «Заработано»: чистый доход по уже полученным деньгам ──
// Тот же показатель, что в отчётах на странице аналитики. Доля со-инвесторов
// приходит с сервера (в журнале она разложена по платежам), поэтому без этих
// карт цифра была бы валовой и завышенной.
const ciProfitByPayment = ref<Record<string, number>>({})
const ciProfitByDownPayment = ref<Record<string, number>>({})
const ciLoaded = ref(false)

/**
 * Заработок по одной сделке — ровно та же арифметика и тот же порядок
 * округления, что в отчётах на бэкенде (reports.service.ts, totalsFor):
 * округляем валовой доход по сделке, и только потом вычитаем долю
 * со-инвесторов. Иначе карточка и модалка расходились бы на несколько рублей.
 */
function dealEarnedNet(d: any): number {
  const received =
    (d.downPayment || 0) +
    paymentsStore.allPaymentsFlat
      .filter((p: any) => p.dealId === d.id && p.status === 'PAID')
      .reduce((s: number, p: any) => s + p.amount, 0)
  const ci =
    (ciProfitByDownPayment.value[d.id] ?? 0) +
    paymentsStore.allPaymentsFlat
      .filter((p: any) => p.dealId === d.id && p.status === 'PAID')
      .reduce((s: number, p: any) => s + (ciProfitByPayment.value[p.id] ?? 0), 0)
  return Math.round(paymentProfit(received, d)) - ci
}

// Отменённые сделки не считаются — как и в отчётах.
const earnedDeals = computed(() =>
  (dealsStore.investorDeals as any[]).filter((d) => d.status !== 'CANCELLED'),
)

const earnedNet = computed(() => {
  if (!ciLoaded.value) return null
  return earnedDeals.value.reduce((s, d) => s + dealEarnedNet(d), 0)
})

// ── Счётчики для ключевых показателей ──
const clientsCount = computed(() => clientsStore.clientsInfo.length)
const activeClientsCount = computed(() =>
  clientsStore.clientsInfo.filter((c) => c.activeDealCount > 0).length,
)

// Карточки инвесторов и сотрудников показываем, только если они вообще есть —
// пустой ноль на главной ничего не сообщает, а место занимает.
const investorsCount = ref<number | null>(null)
const staffCount = ref<number | null>(null)
const canSeeCoInvestors = computed(
  () => sections.visible('coInvestors') && authStore.canAccess('/co-investors'),
)
const canSeeStaff = computed(() => authStore.isOwner && sections.visible('staff'))



const pageLoading = ref(true)

onMounted(async () => {
  try {
    await Promise.all([
      dealsStore.fetchDeals(),
      paymentsStore.fetchPayments(),
      requestsStore.fetchRequests(),
      notificationsStore.fetchNotifications(),
      fetchCapital(),
      // Доля со-инвесторов: при ошибке молча остаёмся на валовой цифре, чтобы
      // главная не падала из-за одного вспомогательного запроса.
      Promise.all([
        api.get<Record<string, number>>('/finance/coinvestor-profit-by-payment')
          .then((m) => { ciProfitByPayment.value = m || {} })
          .catch(() => { ciProfitByPayment.value = {} }),
        api.get<Record<string, number>>('/finance/coinvestor-profit-by-downpayment')
          .then((m) => { ciProfitByDownPayment.value = m || {} })
          .catch(() => { ciProfitByDownPayment.value = {} }),
      ]).then(() => { ciLoaded.value = true }),
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
const overdueAmount = computed(() =>
  paymentsStore.overduePayments.reduce((s, p) => s + p.amount, 0)
)

// ── Metric breakdown dialog ──
type MetricKey = 'invested' | 'revenue' | 'profit' | 'remaining' | 'received' | 'earned' | 'roi' | 'overdue'
// ── Расшифровка показателя: общий компонент с аналитикой и отчётами ──
const metricOpen = ref(false)
const metricTitle = ref('')
const metricHint = ref('')
const metricColor = ref('#10b981')
const metricTotal = ref(0)
const metricItems = ref<any[]>([])

function openBreakdown(metric: MetricKey) {
  let deals: { deal: any; value: number; extra?: string; parts?: any[] }[] = []
  let title = ''
  let hint = ''
  let color = ''

  const money = (n: number) => formatCurrency(Math.round(n || 0))
  /** Сколько уже пришло по сделке: первоначальный взнос + оплаченные платежи. */
  const receivedOf = (d: any) =>
    (d.downPayment || 0) +
    paymentsStore.allPaymentsFlat
      .filter((p: any) => p.dealId === d.id && p.status === 'PAID')
      .reduce((s: number, p: any) => s + p.amount, 0)

  switch (metric) {
    case 'invested':
      title = 'Инвестировано в товар'
      hint = 'Сколько денег потрачено на закупку товара по всем сделкам.'
      color = '#3b82f6'
      deals = dealsStore.investorDeals.map((d: any) => ({
        deal: d, value: d.purchasePrice,
        parts: [
          { label: 'продано за', value: money(d.totalPrice) },
          { label: 'наценка', value: money(d.markup) },
          { label: 'вернулось', value: money(receivedOf(d)) },
        ],
      }))
      break

    case 'revenue':
      title = 'Общий оборот'
      hint = 'Сколько всего должны заплатить клиенты по всем сделкам — закупка вместе с наценкой.'
      color = '#0ea5e9'
      deals = dealsStore.investorDeals.map((d: any) => ({
        deal: d, value: d.totalPrice,
        parts: [
          { label: 'закупка', value: money(d.purchasePrice) },
          { label: 'наценка', value: money(d.markup) },
          { label: 'оплачено', value: `${d.paidPayments} из ${d.numberOfPayments}` },
        ],
      }))
      break

    case 'profit':
      title = 'Наценка по сделкам'
      hint = 'Наценка по каждой сделке: цена продажи минус закупка. Это доход до вычета доли со-инвесторов.'
      color = '#059669'
      deals = dealsStore.investorDeals.map((d: any) => ({
        deal: d, value: d.markup,
        parts: [
          { label: 'закупка', value: money(d.purchasePrice) },
          { label: 'цена продажи', value: money(d.totalPrice) },
          { label: 'оплачено', value: `${d.paidPayments} из ${d.numberOfPayments}` },
        ],
      }))
      break

    case 'remaining':
      title = 'Ожидается к получению'
      hint = 'Сколько клиенты ещё должны заплатить по активным сделкам.'
      color = '#f59e0b'
      deals = dealsStore.activeDeals.map((d: any) => ({
        deal: d, value: d.remainingAmount,
        parts: [
          { label: 'всего по сделке', value: money(d.totalPrice) },
          { label: 'уже получено', value: money(receivedOf(d)) },
          { label: 'платежей', value: `${d.paidPayments} из ${d.numberOfPayments}` },
        ],
      }))
      break

    case 'received':
      title = 'Получено'
      hint = 'Деньги, которые клиенты уже отдали: первоначальные взносы и оплаченные платежи.'
      color = '#10b981'
      deals = dealsStore.investorDeals.map((d: any) => ({
        deal: d, value: receivedOf(d),
        parts: [
          { label: 'всего по сделке', value: money(d.totalPrice) },
          { label: 'осталось', value: money(d.remainingAmount) },
          { label: 'взнос', value: money(d.downPayment || 0) },
          { label: 'платежей', value: `${d.paidPayments} из ${d.numberOfPayments}` },
        ],
      }))
      break

    case 'earned': {
      title = 'Заработано'
      hint =
        'Ваш доход по деньгам, которые клиенты уже отдали. В каждом платеже есть ' +
        'доля наценки — она и складывается тут. Доля со-инвесторов уже вычтена.'
      color = '#047857'
      deals = earnedDeals.value.map((d: any) => {
        const got = receivedOf(d)
        const ci =
          (ciProfitByDownPayment.value[d.id] ?? 0) +
          paymentsStore.allPaymentsFlat
            .filter((p: any) => p.dealId === d.id && p.status === 'PAID')
            .reduce((s: number, p: any) => s + (ciProfitByPayment.value[p.id] ?? 0), 0)
        return {
          deal: d, value: dealEarnedNet(d),
          parts: [
            { label: 'получено', value: money(got) },
            { label: 'наценка по сделке', value: money(d.markup) },
            ...(ci > 0 ? [{ label: 'со-инвесторам', value: money(ci) }] : []),
            { label: 'платежей', value: `${d.paidPayments} из ${d.numberOfPayments}` },
          ],
        }
      })
      break
    }

    case 'roi':
      title = 'Доходность сделок'
      hint = 'Сколько наценки приносит каждый вложенный рубль — наценка относительно закупки.'
      color = '#059669'
      deals = dealsStore.investorDeals
        .filter((d: any) => d.purchasePrice > 0)
        .map((d: any) => ({
          deal: d,
          value: Math.round((d.markup / d.purchasePrice) * 1000) / 10,
          parts: [
            { label: 'закупка', value: money(d.purchasePrice) },
            { label: 'наценка', value: money(d.markup) },
          ],
        }))
      break

    case 'overdue': {
      title = 'Просроченные платежи'
      hint = 'Платежи, срок которых уже прошёл, а деньги не поступили.'
      color = '#ef4444'
      const byDeal = new Map<string, { deal: any; value: number; count: number; oldest: string }>()
      for (const p of paymentsStore.overduePayments) {
        const deal = dealsStore.getDeal(p.dealId)
        const cur = byDeal.get(p.dealId)
        if (cur) {
          cur.value += p.amount
          cur.count += 1
          if (p.dueDate < cur.oldest) cur.oldest = p.dueDate
        } else {
          byDeal.set(p.dealId, { deal, value: p.amount, count: 1, oldest: p.dueDate })
        }
      }
      deals = [...byDeal.values()].map((x) => ({
        deal: x.deal, value: x.value,
        parts: [
          { label: 'платежей', value: `${x.count}` },
          { label: 'с', value: formatDate(x.oldest) },
          ...(x.deal ? [{ label: 'остаток долга', value: money(x.deal.remainingAmount) }] : []),
        ],
      }))
      break
    }
  }

  // ROI — проценты, остальное — рубли.
  const isPercent = metric === 'roi'
  metricItems.value = deals
    .filter((d) => d.value !== 0)
    .map((d) => ({
      id: d.deal?.id ?? '',
      title: d.deal?.productName || 'Сделка',
      subtitle: dealClientName(d.deal),
      value: isPercent ? d.value : Math.round(d.value),
      suffix: isPercent ? '%' : undefined,
      parts: d.parts,
    }))
  // Для процентов общий итог складывать бессмысленно — показываем средний.
  metricTotal.value = isPercent
    ? 0
    : metricItems.value.reduce((sum, i) => sum + i.value, 0)
  metricTitle.value = title
  metricHint.value = hint
  metricColor.value = color
  metricOpen.value = true
}

/** Телефон клиента — по нему обычно и звонят из этих таблиц. */
function dealClientPhone(deal?: any): string {
  if (!deal) return ''
  const raw = deal.client?.phone || deal.clientProfile?.phone || deal.externalClientPhone
  return raw ? formatPhone(raw) : ''
}

/** Сколько по сделке уже получено: первоначальный взнос + оплаченные платежи. */
function dealReceived(deal: any): number {
  return (
    (deal.downPayment || 0) +
    paymentsStore.allPaymentsFlat
      .filter((p: any) => p.dealId === deal.id && p.status === 'PAID')
      .reduce((s: number, p: any) => s + p.amount, 0)
  )
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
          <div class="kpi-value">{{ dealsStore.investorDeals.length }}</div>
          <div class="kpi-label">Всего сделок</div>
        </div>
      </div>

      <div class="kpi-card kpi-clickable" @click="router.push('/deals')">
        <div class="kpi-icon-wrap" style="background: rgba(14, 165, 233, 0.1); color: #0ea5e9;">
          <v-icon icon="mdi-briefcase-check" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ dealsStore.activeDeals.length }}</div>
          <div class="kpi-label">Активных</div>
        </div>
      </div>

      <div class="kpi-card kpi-clickable" @click="router.push('/deals')">
        <div class="kpi-icon-wrap" style="background: rgba(22, 163, 74, 0.1); color: #16a34a;">
          <v-icon icon="mdi-check-circle" size="20" />
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ dealsStore.completedDeals.length }}</div>
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
              <div class="chart-subtitle">{{ dealsStore.activeDeals.length }} сделок в работе</div>
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
