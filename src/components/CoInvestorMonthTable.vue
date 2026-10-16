<script setup lang="ts">
/**
 * Инвесторы кассы по месяцам — таблица, как у партнёров в Excel.
 *
 * Строка — инвестор кассы: капитал, доля в капитале, процент, начислено за
 * месяц, остаток с прошлых месяцев, выплачено, реинвест и остаток к выплате.
 * Сверху строка партнёра (его часть прибыли месяца), снизу — итог.
 *
 * «Расчёт за месяц» — повышение процента (не ниже базового), выплата и
 * реинвест по каждому инвестору одной операцией. Что не выплачено и не
 * реинвестировано, остаётся долгом и само переходит в следующий месяц.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { rangeForPreset } from '@/composables/useReports'
import { formatCurrency, maskedMoney, parseMasked, CURRENCY_MASK } from '@/utils/formatters'
import MonthYearPicker from '@/components/MonthYearPicker.vue'
import SelectField from '@/components/SelectField.vue'
import { useMonthLocks } from '@/composables/useMonthLocks'
import type { PeriodRange } from '@/types/reports'
import type { InvestorPerson } from '@/types'

const props = defineProps<{ persons: InvestorPerson[]; isMobile?: boolean }>()
const emit = defineEmits<{
  (e: 'create'): void
  (e: 'edit', p: InvestorPerson): void
  (e: 'remove', p: InvestorPerson): void
  /** Что-то записали — списку инвесторов и KPI страницы пора обновиться. */
  (e: 'changed'): void
}>()

interface PctBucket { pct: number; amount: number }
interface MonthRow {
  id: string
  personId: string | null
  name: string
  phone: string | null
  archived: boolean
  mode: 'weight' | 'fixed' | 'costFee'
  basePct: number | null
  monthPct: number | null
  buckets: PctBucket[]
  capitalStart: number
  invested: number
  reinvestedCapital: number
  withdrawn: number
  capitalEnd: number
  capitalSharePct: number
  accruedDeals: number
  bonus: number
  /** Начисления месяца изменились после повышения — сумма будет пересчитана. */
  bonusStale?: boolean
  earned: number
  paid: number
  reinvested: number
  /** Из них проведено автоматически (авто-реинвест в день расчёта). */
  reinvestedAuto?: number
  owedStart: number
  owedEnd: number
  owedNow: number
  nextPayoutDate: string | null
}
interface MonthData {
  month: string
  currentMonth: string
  isFuture: boolean
  cashBox: { id: string; name: string; initialCapital: number; partnerParticipatesByCapital: boolean }
  payoutDay: number | null
  nextPayoutDate: string | null
  partner: {
    capital: number
    participatesByCapital: boolean
    capitalSharePct: number
    gross: number
    investorsTotal: number
    earned: number
  }
  rows: MonthRow[]
  totals: Record<string, number>
  /** Закрытие месяца: состояние и что с ним можно сделать сейчас. */
  close?: {
    closed: { closedAt: string; closedByName: string | null; snapshot: CloseSnapshot | null } | null
    lastClosed: string | null
    canClose: boolean
    closeBlocked: string | null
    canReopen: boolean
  }
}
/** Итоги месяца на момент закрытия. */
interface CloseSnapshot {
  partner?: { earned?: number }
  rows?: Array<{ id: string; name: string; capitalEnd: number; earned: number; paid: number; reinvested: number; owedEnd: number }>
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const cashboxes = useCashBoxesStore()
const toast = useToast()
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

// ── Касса и месяц (в адресе — чтобы ссылка открывала тот же срез) ──
const boxOptions = computed(() =>
  cashboxes.items
    .filter((b) => !b.archivedAt)
    .map((b) => ({ value: b.id, label: b.name, color: b.color, hint: b.isDefault ? 'осн.' : undefined })),
)
function lsGet(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* приватный режим */ } }

const cashBoxId = ref<string | null>(null)
function pickInitialBox() {
  const wanted = (route.query.box as string) || lsGet('ci-month:box')
  const ok = (id: string | null) => !!id && boxOptions.value.some((o) => o.value === id)
  cashBoxId.value = ok(wanted) ? wanted : (cashboxes.getDefault()?.id ?? boxOptions.value[0]?.value ?? null)
}

function periodOfMonth(m: string | undefined): PeriodRange {
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mm] = m.split('-').map(Number)
    return rangeForPreset('month', new Date(y!, mm! - 1, 1))
  }
  return rangeForPreset('month')
}
const period = ref<PeriodRange>(periodOfMonth(route.query.month as string | undefined))
const month = computed(() => period.value.from.slice(0, 7))
const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return `${MONTHS_NOM[m! - 1]} ${y}`
})
const monthPrep = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return `в ${MONTHS_PREP[m! - 1]} ${y}`
})

// ── Данные ──
const data = ref<MonthData | null>(null)
const loading = ref(false)
let seq = 0
async function load() {
  if (!cashBoxId.value) { data.value = null; return }
  const my = ++seq
  loading.value = true
  try {
    const q = new URLSearchParams({ cashBoxId: cashBoxId.value, month: month.value, tz: TZ })
    const res = await api.get<MonthData>(`/co-investors/month?${q}`)
    if (my === seq) data.value = res
  } catch (e: any) {
    if (my === seq) toast.error(e.message || 'Не удалось загрузить таблицу')
  } finally {
    if (my === seq) loading.value = false
  }
}
watch([cashBoxId, month], () => {
  if (cashBoxId.value) lsSet('ci-month:box', cashBoxId.value)
  router.replace({ query: { ...route.query, box: cashBoxId.value ?? undefined, month: month.value } })
  load()
})
onMounted(async () => {
  if (!cashboxes.items.length) await cashboxes.fetchAll()
  pickInitialBox()
  if (cashBoxId.value) load()
})
defineExpose({ reload: load })

// ── Вид ──
const rows = computed(() => data.value?.rows ?? [])
const activeRows = computed(() => rows.value.filter((r) => !r.archived))
const toPayEnd = computed(() => rows.value.reduce((s, r) => s + Math.max(r.owedEnd, 0), 0))
const overpaidEnd = computed(() => rows.value.reduce((s, r) => s + Math.max(-r.owedEnd, 0), 0))
// Переплата одного инвестора не гасит долг другому — итог только по долгам.
const toPayStart = computed(() => rows.value.reduce((s, r) => s + Math.max(r.owedStart, 0), 0))
const capitalTotal = computed(() =>
  (data.value?.totals.capitalEnd ?? 0) +
  (data.value?.partner.participatesByCapital ? data.value.partner.capital : 0))

function pct(v: number | null | undefined) {
  if (v == null) return '—'
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/\.?0+$/, '')}%`
}
function modeLabel(r: MonthRow) {
  if (r.mode === 'costFee') return 'От закупки'
  if (r.mode === 'fixed') return 'Фикс'
  return 'По вкладу'
}
function money(v: number) { return v ? formatCurrency(v) : '—' }
function dayMonth(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`
}

// ── Закрытие месяца ──
// После «Расчёта за месяц» месяц закрывают: его оплаты, выплаты и удаление
// сделок становятся недоступны, пока владелец его не откроет. Закрывают по
// порядку; открыть можно только последний закрытый.
const monthLocks = useMonthLocks()
const closeInfo = computed(() => data.value?.close ?? null)
const isClosed = computed(() => !!closeInfo.value?.closed)
const closeDialog = ref<'close' | 'reopen' | null>(null)
const closingBusy = ref(false)

async function confirmCloseAction() {
  if (!data.value || !closeDialog.value || closingBusy.value) return
  const action = closeDialog.value
  closingBusy.value = true
  try {
    data.value = await api.post<MonthData>(`/co-investors/month/${action === 'close' ? 'close' : 'reopen'}`, {
      cashBoxId: data.value.cashBox.id,
      month: month.value,
      tz: TZ,
    })
    closeDialog.value = null
    void monthLocks.refresh()
    toast.success(action === 'close' ? `${monthLabel.value} закрыт` : `${monthLabel.value} открыт`)
    emit('changed')
  } catch (e: any) {
    toast.error(e?.message || 'Не получилось')
  } finally {
    closingBusy.value = false
  }
}

function closedWhen(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Что изменилось после закрытия: сравниваем итоги на момент закрытия с
 * нынешними. Деньги закрытого месяца менять нельзя, но правка цены сделки и
 * условий инвестора разрешена — и она пересчитывает прошлые месяцы.
 */
const snapshotDiff = computed(() => {
  const snap = closeInfo.value?.closed?.snapshot
  // Только владельцу: сотрудник с доступом к части сделок видит доход партнёра
  // по своим сделкам, и сравнение с полным снимком показало бы ложные изменения.
  if (!auth.isOwner || !snap?.rows || !data.value) return []
  const now = new Map(data.value.rows.map((r) => [r.id, r]))
  const out: Array<{ name: string; label: string; was: number; now: number }> = []
  const fields: Array<[keyof NonNullable<CloseSnapshot['rows']>[number], string]> = [
    ['earned', 'начислено'], ['paid', 'выплачено'], ['reinvested', 'реинвест'], ['owedEnd', 'долг на конец'],
  ]
  for (const was of snap.rows) {
    const cur = now.get(was.id)
    for (const [k, label] of fields) {
      const a = Number(was[k] ?? 0)
      const b = Number((cur as any)?.[k] ?? 0)
      if (Math.round(a) !== Math.round(b)) out.push({ name: was.name, label, was: a, now: b })
    }
  }
  const pWas = snap.partner?.earned
  if (pWas != null && Math.round(pWas) !== Math.round(data.value.partner.earned)) {
    out.push({ name: 'Вам', label: 'доход', was: pWas, now: data.value.partner.earned })
  }
  return out
})
function personOf(r: MonthRow) { return props.persons.find((p) => p.id === r.personId) ?? null }
function openRow(r: MonthRow) { if (r.personId) router.push(`/co-investors/person/${r.personId}`) }

// ── День расчёта ──
const dayMenu = ref(false)
const savingDay = ref(false)
async function setPayoutDay(day: number | null) {
  if (!cashBoxId.value) return
  savingDay.value = true
  try {
    await api.put('/co-investors/month/payout-day', { cashBoxId: cashBoxId.value, day, tz: TZ })
    dayMenu.value = false
    toast.success(day ? `День расчёта — ${day} число` : 'День расчёта снят')
    await load()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось сохранить')
  } finally {
    savingDay.value = false
  }
}

// ── Расчёт за месяц ──
/** Доплата до повышенного процента — зеркало bonusFor на сервере. */
function bonusFor(buckets: PctBucket[], target: number): number {
  let sum = 0
  for (const b of buckets) {
    if (b.pct > 0 && b.pct < target && b.amount > 0) sum += (b.amount * (target - b.pct)) / b.pct
  }
  return Math.round(sum)
}

interface SettleLine {
  row: MonthRow
  pct: number | null
  pay: number
  reinvest: number
}
const settleOpen = ref(false)
const settling = ref(false)
const lines = ref<SettleLine[]>([])
const allPct = ref<number | null>(null)
let idemKey = ''
const canReinvest = computed(() => auth.can('coinvestors.capital'))
// Повышение процента — правка условий инвестора: право «Редактировать».
const canRaise = computed(() => auth.can('coinvestors.edit'))

function lineBonus(l: SettleLine) {
  const base = l.row.basePct
  if (base == null || l.pct == null || l.pct <= base) return 0
  return bonusFor(l.row.buckets, l.pct)
}
/** Сколько можно распределить: остаток сейчас с учётом нового повышения. */
function lineAvailable(l: SettleLine) {
  return Math.max(l.row.owedNow - l.row.bonus + lineBonus(l), 0)
}
function lineLeft(l: SettleLine) { return lineAvailable(l) - l.pay - l.reinvest }
function linePctBad(l: SettleLine) {
  const base = l.row.basePct
  return base != null && l.pct != null && (l.pct < base || l.pct > 100)
}

function openSettle() {
  lines.value = activeRows.value
    .filter((r) => r.owedNow > 0 || r.buckets.length > 0 || r.bonus > 0)
    .map((r) => ({ row: r, pct: r.monthPct, pay: 0, reinvest: 0 }))
  for (const l of lines.value) l.pay = lineAvailable(l)
  allPct.value = null
  idemKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  settleOpen.value = true
}
/**
 * «Всем» — только инвесторам «по вкладу»: у них процент — их часть своей
 * доли (40 из 60/40). Фиксированный процент — доля всей прибыли сделки, и
 * поднять 25% до тех же 44% значило бы почти удвоить ему доход.
 */
const hasWeightLines = computed(() => lines.value.some((l) => l.row.mode === 'weight'))
function applyAllPct() {
  if (allPct.value == null) return
  for (const l of lines.value) {
    if (l.row.basePct == null || l.row.mode !== 'weight') continue
    l.pct = Math.max(l.row.basePct, Math.min(100, allPct.value))
    fitLine(l)
  }
}
/** После смены процента сумма к распределению меняется — подгоняем выплату. */
function fitLine(l: SettleLine) {
  const avail = lineAvailable(l)
  if (l.pay + l.reinvest > avail) {
    l.reinvest = Math.min(l.reinvest, avail)
    l.pay = Math.max(avail - l.reinvest, 0)
  } else if (l.reinvest === 0) {
    l.pay = avail
  }
}
function fillAll(kind: 'pay' | 'reinvest' | 'leave') {
  for (const l of lines.value) {
    const avail = lineAvailable(l)
    l.pay = kind === 'pay' ? avail : 0
    l.reinvest = kind === 'reinvest' ? avail : 0
  }
}
const settleTotals = computed(() => lines.value.reduce((t, l) => {
  t.bonus += lineBonus(l) - l.row.bonus
  t.pay += l.pay
  t.reinvest += l.reinvest
  t.left += lineLeft(l)
  return t
}, { bonus: 0, pay: 0, reinvest: 0, left: 0 }))
const settleInvalid = computed(() => lines.value.some((l) => linePctBad(l) || lineLeft(l) < 0))

async function submitSettle() {
  if (!data.value || settleInvalid.value) return
  const items = lines.value
    .map((l) => ({
      coInvestorId: l.row.id,
      ...(l.row.basePct != null && l.pct !== l.row.monthPct ? { pct: l.pct } : {}),
      pay: Math.round(l.pay),
      reinvest: Math.round(l.reinvest),
    }))
    .filter((i) => 'pct' in i || i.pay > 0 || i.reinvest > 0)
  if (!items.length) {
    settleOpen.value = false
    toast.success('Всё остаётся долгом и перейдёт в следующий месяц')
    return
  }
  settling.value = true
  try {
    data.value = await api.post<MonthData>('/co-investors/month/settle', {
      cashBoxId: data.value.cashBox.id,
      month: month.value,
      tz: TZ,
      idemKey,
      items,
    })
    settleOpen.value = false
    toast.success(`Расчёт за ${monthLabel.value.toLowerCase()} проведён`)
    emit('changed')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось провести расчёт')
    // Часть могла пройти (или прошла в прошлый раз) — показываем то, что в базе.
    load()
  } finally {
    settling.value = false
  }
}
</script>

<template>
  <v-card rounded="lg" elevation="0" border class="cim">
    <!-- Панель: касса, месяц, день расчёта, действия -->
    <div class="cim-toolbar">
      <div class="cim-box">
        <SelectField v-model="cashBoxId" :options="boxOptions" placeholder="Касса" />
      </div>
      <MonthYearPicker v-model="period" month-only />
      <v-spacer />
      <v-menu v-if="auth.can('coinvestors.edit')" v-model="dayMenu" :close-on-content-click="false" location="bottom end" offset="6">
        <template #activator="{ props: mp }">
          <button v-bind="mp" type="button" class="cim-day" :disabled="!data">
            <v-icon icon="mdi-calendar-check-outline" size="16" />
            <span v-if="data?.payoutDay">Расчёт {{ data.payoutDay }} числа</span>
            <span v-else>День расчёта</span>
          </button>
        </template>
        <v-card rounded="xl" elevation="4" class="cim-day-menu">
          <div class="cim-day-title">Какого числа вы рассчитываетесь с инвесторами?</div>
          <div class="cim-day-sub">
            Выберите число месяца. Например, 10 — расчёт за сентябрь проводите 10 октября.
            Эта дата станет датой следующей выплаты у всех инвесторов кассы.
          </div>
          <div class="cim-day-grid">
            <button
              v-for="d in 28"
              :key="d"
              type="button"
              class="cim-day-cell"
              :class="{ 'cim-day-cell--on': data?.payoutDay === d }"
              :disabled="savingDay"
              @click="setPayoutDay(d)"
            >{{ d }}</button>
          </div>
          <button v-if="data?.payoutDay" type="button" class="cim-day-clear" :disabled="savingDay" @click="setPayoutDay(null)">
            Не напоминать
          </button>
        </v-card>
      </v-menu>
      <button
        v-if="auth.can('coinvestors.dividends')"
        type="button"
        class="cim-btn cim-btn--primary"
        :disabled="!data || data.isFuture || !activeRows.length || isClosed"
        :title="isClosed ? 'Месяц закрыт — сначала откройте его' : undefined"
        @click="openSettle"
      >
        <v-icon icon="mdi-calculator-variant-outline" size="18" />
        <span>Расчёт за месяц</span>
      </button>
      <span v-if="isClosed" class="cim-closed-chip">
        <v-icon icon="mdi-lock-outline" size="15" />
        Закрыт
      </span>
      <button
        v-else-if="auth.can('coinvestors.closeMonth') && data && !data.isFuture && closeInfo"
        type="button"
        class="cim-btn"
        :disabled="!closeInfo.canClose"
        :title="closeInfo.closeBlocked || 'Зафиксировать месяц: его оплаты и выплаты станут недоступны'"
        @click="closeDialog = 'close'"
      >
        <v-icon icon="mdi-lock-outline" size="18" />
        <span>Закрыть месяц</span>
      </button>
      <button v-if="auth.can('coinvestors.create')" type="button" class="cim-btn" @click="emit('create')">
        <v-icon icon="mdi-plus" size="18" />
        <span class="d-none d-sm-inline">Добавить инвестора</span>
      </button>
    </div>

    <div v-if="!cashBoxId" class="cim-empty">Нет касс — создайте кассу, чтобы вести инвесторов.</div>

    <template v-else-if="data">
      <!-- Итоги месяца — отдельными карточками, чтобы не терялись -->
      <div class="cim-kpis">
        <div class="cim-kpi">
          <div class="cim-kpi-icon" style="--c: #0f766e"><v-icon icon="mdi-cash-multiple" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Прибыль кассы {{ monthPrep }}</div>
            <div class="cim-kpi-val">{{ formatCurrency(data.partner.gross) }}</div>
          </div>
        </div>
        <div class="cim-kpi">
          <div class="cim-kpi-icon" style="--c: #4f46e5"><v-icon icon="mdi-account-group-outline" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Инвесторам</div>
            <div class="cim-kpi-val cim-c-inv">{{ formatCurrency(data.partner.investorsTotal) }}</div>
          </div>
        </div>
        <div class="cim-kpi">
          <div class="cim-kpi-icon" style="--c: #047857"><v-icon icon="mdi-account-tie" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Вам</div>
            <div class="cim-kpi-val cim-c-me">{{ formatCurrency(data.partner.earned) }}</div>
          </div>
        </div>
        <div class="cim-kpi">
          <div class="cim-kpi-icon" style="--c: #d97706"><v-icon icon="mdi-cash-clock" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Долг на конец месяца</div>
            <div class="cim-kpi-val cim-c-owed">{{ formatCurrency(toPayEnd) }}</div>
            <div v-if="overpaidEnd" class="cim-kpi-note">ещё переплачено {{ formatCurrency(overpaidEnd) }}</div>
          </div>
        </div>
        <div v-if="data.nextPayoutDate" class="cim-kpi">
          <div class="cim-kpi-icon" style="--c: #7c3aed"><v-icon icon="mdi-calendar-check-outline" size="20" /></div>
          <div class="cim-kpi-body">
            <div class="cim-kpi-label">Следующий расчёт</div>
            <div class="cim-kpi-val">{{ dayMonth(data.nextPayoutDate) }}</div>
          </div>
        </div>
      </div>

      <div v-if="data.isFuture" class="cim-note">
        <v-icon icon="mdi-information-outline" size="16" />
        Месяц ещё не наступил — показаны только записи, уже сделанные на эти даты.
      </div>

      <div v-if="closeInfo?.closed" class="cim-closed">
        <div class="cim-closed-main">
          <v-icon icon="mdi-lock-outline" size="18" />
          <div>
            <div class="cim-closed-title">
              {{ monthLabel }} закрыт {{ closedWhen(closeInfo.closed.closedAt) }}<template v-if="closeInfo.closed.closedByName"> · {{ closeInfo.closed.closedByName }}</template>
            </div>
            <div class="cim-closed-sub">Оплаты, выплаты инвесторам и удаление сделок этого месяца недоступны.</div>
          </div>
          <button
            v-if="auth.isOwner && closeInfo.canReopen"
            type="button"
            class="cim-btn cim-btn--sm"
            @click="closeDialog = 'reopen'"
          >Открыть месяц</button>
        </div>
        <div v-if="snapshotDiff.length" class="cim-closed-diff">
          <div class="cim-closed-diff-title">
            <v-icon icon="mdi-alert-outline" size="15" />
            После закрытия цифры изменились — скорее всего, поменяли цену сделки или условия инвестора:
          </div>
          <div v-for="(d, i) in snapshotDiff" :key="i" class="cim-closed-diff-row">
            {{ d.name }}, {{ d.label }}: было {{ formatCurrency(d.was) }}, стало {{ formatCurrency(d.now) }}
          </div>
        </div>
      </div>

      <div class="cim-scroll" :class="{ 'cim-scroll--loading': loading }">
        <table class="cim-table">
          <thead>
            <tr>
              <th class="cim-n">№</th>
              <th class="cim-name">Инвестор</th>
              <th class="cim-num">Капитал</th>
              <th class="cim-num">Доля в капитале</th>
              <th class="cim-num">Процент</th>
              <th class="cim-num">Начислено</th>
              <th class="cim-num">
                <v-tooltip location="top" max-width="300">
                  <template #activator="{ props: tp }">
                    <span v-bind="tp" class="cim-th-help">Долг на начало<v-icon icon="mdi-help-circle-outline" size="13" /></span>
                  </template>
                  Сколько вы были должны инвестору к началу месяца: всё начисленное за прошлые месяцы минус всё выплаченное и реинвестированное за них.
                  Минус — переплата: инвестор получил больше, чем ему начислено.
                </v-tooltip>
              </th>
              <th class="cim-num">Выплачено</th>
              <th class="cim-num">Реинвест</th>
              <th class="cim-num">
                <v-tooltip location="top" max-width="300">
                  <template #activator="{ props: tp }">
                    <span v-bind="tp" class="cim-th-help">Долг на конец<v-icon icon="mdi-help-circle-outline" size="13" /></span>
                  </template>
                  Долг на начало + начислено за месяц − выплачено − реинвест. Эта сумма переходит в следующий месяц как его «долг на начало».
                  Минус — переплата, она уменьшит будущие выплаты.
                </v-tooltip>
              </th>
              <th class="cim-act" />
            </tr>
          </thead>
          <tbody>
            <!-- Партнёр -->
            <tr class="cim-partner">
              <td class="cim-n"><v-icon icon="mdi-account-tie" size="16" /></td>
              <td class="cim-name">
                <div class="cim-who">Вы</div>
                <div class="cim-sub">{{ data.partner.participatesByCapital ? 'участвуете капиталом' : 'управляете, без капитала' }}</div>
              </td>
              <td class="cim-num">{{ data.partner.participatesByCapital ? money(data.partner.capital) : '—' }}</td>
              <td class="cim-num">{{ data.partner.capitalSharePct ? pct(data.partner.capitalSharePct) : '—' }}</td>
              <td class="cim-num cim-muted">остаток</td>
              <td class="cim-num cim-c-me cim-strong">{{ formatCurrency(data.partner.earned) }}</td>
              <td class="cim-num cim-muted">—</td>
              <td class="cim-num cim-muted">—</td>
              <td class="cim-num cim-muted">—</td>
              <td class="cim-num cim-muted">—</td>
              <td class="cim-act" />
            </tr>

            <tr v-if="!rows.length">
              <td colspan="11" class="cim-none">В этой кассе нет инвесторов</td>
            </tr>

            <tr
              v-for="(r, i) in rows"
              :key="r.id"
              class="cim-row"
              :class="{ 'cim-row--archived': r.archived }"
              @click="openRow(r)"
            >
              <td class="cim-n">{{ i + 1 }}</td>
              <td class="cim-name">
                <div class="cim-who">{{ r.name }}</div>
                <div class="cim-sub">
                  {{ modeLabel(r) }}<template v-if="r.archived"> · исключён</template>
                </div>
              </td>
              <td class="cim-num">
                <div>{{ money(r.capitalEnd) }}</div>
                <div v-if="r.invested" class="cim-sub cim-c-in">+{{ formatCurrency(r.invested) }} внёс</div>
                <div v-if="r.reinvestedCapital" class="cim-sub cim-c-in">+{{ formatCurrency(r.reinvestedCapital) }} реинвест</div>
                <div v-if="r.withdrawn" class="cim-sub cim-c-out">−{{ formatCurrency(r.withdrawn) }} снял</div>
              </td>
              <td class="cim-num">{{ r.mode === 'weight' && r.capitalSharePct ? pct(r.capitalSharePct) : '—' }}</td>
              <td class="cim-num">
                <template v-if="r.basePct == null">—</template>
                <template v-else-if="r.monthPct != null && r.monthPct > r.basePct">
                  <span class="cim-muted cim-strike">{{ pct(r.basePct) }}</span>
                  <span class="cim-raise">{{ pct(r.monthPct) }}</span>
                </template>
                <template v-else>{{ pct(r.basePct) }}</template>
              </td>
              <td class="cim-num">
                <div class="cim-c-inv">{{ money(r.earned) }}</div>
                <div v-if="r.bonus" class="cim-sub cim-raise">в т.ч. повышение {{ formatCurrency(r.bonus) }}</div>
                <div v-if="r.bonusStale" class="cim-sub cim-c-owed" title="Начисления месяца изменились после повышения. «Расчёт за месяц» пересчитает его по текущим начислениям.">
                  повышение пересчитается
                </div>
              </td>
              <td class="cim-num" :class="{ 'cim-c-out': r.owedStart < 0 }">{{ money(r.owedStart) }}</td>
              <td class="cim-num">{{ money(r.paid) }}</td>
              <td class="cim-num">
                {{ money(r.reinvested) }}
                <div v-if="r.reinvestedAuto" class="cim-sub" title="Проведено автоматически в день расчёта">
                  авто {{ formatCurrency(r.reinvestedAuto) }}
                </div>
              </td>
              <td class="cim-num cim-strong">
                <template v-if="r.owedEnd < 0">
                  <div class="cim-c-out">{{ formatCurrency(r.owedEnd) }}</div>
                  <div class="cim-sub" title="Инвестор получил больше, чем ему начислено. Переплата закроется будущими начислениями.">переплата</div>
                </template>
                <span v-else :class="{ 'cim-c-owed': r.owedEnd > 0 }">{{ money(r.owedEnd) }}</span>
              </td>
              <td class="cim-act" @click.stop>
                <v-menu location="bottom end" offset="4">
                  <template #activator="{ props: mp }">
                    <button v-bind="mp" type="button" class="cim-dots" title="Действия">
                      <v-icon icon="mdi-dots-vertical" size="18" />
                    </button>
                  </template>
                  <div class="cim-menu">
                    <button type="button" class="cim-menu-item" @click="openRow(r)">
                      <v-icon icon="mdi-open-in-new" size="18" /><span>Открыть карточку</span>
                    </button>
                    <button
                      v-if="personOf(r) && auth.can('coinvestors.edit')"
                      type="button"
                      class="cim-menu-item"
                      @click="emit('edit', personOf(r)!)"
                    >
                      <v-icon icon="mdi-pencil-outline" size="18" /><span>Редактировать</span>
                    </button>
                    <button
                      v-if="personOf(r) && auth.can('coinvestors.delete')"
                      type="button"
                      class="cim-menu-item cim-menu-item--danger"
                      @click="emit('remove', personOf(r)!)"
                    >
                      <v-icon icon="mdi-trash-can-outline" size="18" /><span>Удалить инвестора</span>
                    </button>
                  </div>
                </v-menu>
              </td>
            </tr>
          </tbody>
          <tfoot v-if="rows.length">
            <tr>
              <td class="cim-n" />
              <td class="cim-name">Итого</td>
              <td class="cim-num">{{ formatCurrency(capitalTotal) }}</td>
              <td class="cim-num" />
              <td class="cim-num" />
              <td class="cim-num cim-c-inv">{{ money(data.totals.earned ?? 0) }}</td>
              <td class="cim-num">{{ money(toPayStart) }}</td>
              <td class="cim-num">{{ money(data.totals.paid ?? 0) }}</td>
              <td class="cim-num">{{ money(data.totals.reinvested ?? 0) }}</td>
              <td class="cim-num">
                <div class="cim-c-owed">{{ money(toPayEnd) }}</div>
                <div v-if="overpaidEnd" class="cim-sub cim-c-out">переплата {{ formatCurrency(overpaidEnd) }}</div>
              </td>
              <td class="cim-act" />
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="cim-foot-note">
        <b>Долг на конец</b> = долг на начало + начислено − выплачено − реинвест, и он же — долг на начало следующего месяца.
        Минус означает переплату: инвестору выплатили больше начисленного, она закроется будущими начислениями.
        Начислено — по платежам, оплаченным {{ monthPrep }}; выплаты относятся к месяцу, за который их провели.
      </div>
    </template>

    <div v-else class="cim-loading">
      <v-progress-circular indeterminate color="primary" size="32" />
    </div>

    <!-- Закрытие / открытие месяца -->
    <v-dialog :model-value="!!closeDialog" max-width="440" :persistent="closingBusy" @update:model-value="(v) => { if (!v) closeDialog = null }">
      <v-card rounded="lg" class="cim-cd">
        <div class="cim-cd-title">
          {{ closeDialog === 'close' ? `Закрыть ${monthLabel.toLowerCase()}?` : `Открыть ${monthLabel.toLowerCase()}?` }}
        </div>
        <template v-if="closeDialog === 'close'">
          <ul class="cim-cd-list">
            <li>Оплаты с датой этого месяца нельзя будет отметить или отменить.</li>
            <li>Расчёт за месяц, выплаты и реинвест за него станут недоступны.</li>
            <li>Сделки с деньгами этого месяца нельзя будет удалить, отменить или перенести в другую кассу.</li>
            <li>Итоги месяца сохранятся — если цифры потом изменятся, это будет видно.</li>
          </ul>
          <div v-if="!closeInfo?.lastClosed" class="cim-cd-note mb-2">
            Это первое закрытие в кассе. Месяцы до него останутся открытыми — их изменения могут сдвинуть
            «долг на начало» закрытого месяца. Дальше месяцы закрываются строго по порядку.
          </div>
          <div class="cim-cd-note">Открыть месяц сможет только владелец.</div>
        </template>
        <template v-else>
          <div class="cim-cd-note">
            Оплаты и выплаты этого месяца снова можно будет менять. Сохранённые итоги закрытия удалятся.
          </div>
        </template>
        <div class="cim-cd-actions">
          <button type="button" class="cim-btn" :disabled="closingBusy" @click="closeDialog = null">Отмена</button>
          <button type="button" class="cim-btn cim-btn--primary" :disabled="closingBusy" @click="confirmCloseAction">
            <v-progress-circular v-if="closingBusy" indeterminate size="15" width="2" color="white" />
            {{ closeDialog === 'close' ? 'Закрыть месяц' : 'Открыть месяц' }}
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Расчёт за месяц -->
    <v-dialog v-model="settleOpen" max-width="1040" scrollable :fullscreen="isMobile">
      <v-card rounded="lg" class="cim-dlg">
        <div class="cim-dlg-head">
          <div>
            <div class="cim-dlg-title">Расчёт за {{ monthLabel.toLowerCase() }}</div>
            <div class="cim-dlg-sub">{{ data?.cashBox.name }} · повысить процент, выплатить, реинвестировать или оставить</div>
          </div>
          <button type="button" class="cim-dots" @click="settleOpen = false"><v-icon icon="mdi-close" size="20" /></button>
        </div>

        <div class="cim-dlg-bulk">
          <div v-if="hasWeightLines && canRaise" class="cim-bulk-pct">
            <span>Повысить всем «по вкладу» до</span>
            <input v-model.number="allPct" type="number" min="0" max="100" step="0.5" class="cim-in cim-in--pct" placeholder="%" />
            <span>%</span>
            <button type="button" class="cim-btn cim-btn--sm" :disabled="allPct == null" @click="applyAllPct">Применить</button>
          </div>
          <v-spacer />
          <button type="button" class="cim-chip" @click="fillAll('pay')">Всё выплатить</button>
          <button v-if="canReinvest" type="button" class="cim-chip" @click="fillAll('reinvest')">Всё реинвестировать</button>
          <button type="button" class="cim-chip" @click="fillAll('leave')">Всё оставить</button>
        </div>

        <v-card-text class="cim-dlg-body">
          <div v-if="!lines.length" class="cim-none">Распределять нечего — ни начислений, ни долга.</div>
          <table v-else class="cim-table cim-table--dlg">
            <thead>
              <tr>
                <th class="cim-name">Инвестор</th>
                <th class="cim-num">Процент</th>
                <th class="cim-num">Повышение</th>
                <th class="cim-num">К выплате</th>
                <th class="cim-num">Выплатить</th>
                <th v-if="canReinvest" class="cim-num">Реинвест</th>
                <th class="cim-num">Остаётся долгом</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in lines" :key="l.row.id">
                <td class="cim-name">
                  <div class="cim-who">{{ l.row.name }}</div>
                  <div class="cim-sub">{{ modeLabel(l.row) }}<template v-if="l.row.basePct != null"> · базовый {{ pct(l.row.basePct) }}</template></div>
                </td>
                <td class="cim-num">
                  <template v-if="!canRaise">{{ pct(l.pct) }}</template>
                  <template v-else-if="l.row.basePct == null"><span class="cim-muted" title="При комиссии от закупки процент не повышается">—</span></template>
                  <div v-else class="cim-in-wrap">
                    <input
                      v-model.number="l.pct"
                      type="number"
                      :min="l.row.basePct"
                      max="100"
                      step="0.5"
                      class="cim-in cim-in--pct"
                      :class="{ 'cim-in--bad': linePctBad(l) }"
                      @change="fitLine(l)"
                    />
                    <span class="cim-in-suf">%</span>
                  </div>
                  <div v-if="linePctBad(l)" class="cim-err">не ниже {{ pct(l.row.basePct) }}</div>
                </td>
                <td class="cim-num">
                  <span v-if="lineBonus(l)" class="cim-raise">+{{ formatCurrency(lineBonus(l)) }}</span>
                  <span v-else class="cim-muted">—</span>
                </td>
                <td class="cim-num cim-strong">{{ formatCurrency(lineAvailable(l)) }}</td>
                <td class="cim-num">
                  <div class="cim-in-wrap">
                    <input
                      :value="maskedMoney(l.pay)"
                      v-maska="CURRENCY_MASK"
                      type="text"
                      inputmode="numeric"
                      class="cim-in"
                      @maska="(e: any) => l.pay = parseMasked(e)"
                    />
                    <span class="cim-in-suf">₽</span>
                  </div>
                </td>
                <td v-if="canReinvest" class="cim-num">
                  <div class="cim-in-wrap">
                    <input
                      :value="maskedMoney(l.reinvest)"
                      v-maska="CURRENCY_MASK"
                      type="text"
                      inputmode="numeric"
                      class="cim-in"
                      @maska="(e: any) => l.reinvest = parseMasked(e)"
                    />
                    <span class="cim-in-suf">₽</span>
                  </div>
                </td>
                <td class="cim-num">
                  <span v-if="lineLeft(l) < 0" class="cim-err">больше, чем к выплате</span>
                  <span v-else :class="{ 'cim-c-owed': lineLeft(l) > 0, 'cim-muted': !lineLeft(l) }">{{ money(lineLeft(l)) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="cim-dlg-hint">
            Повышение — отдельная строка «Повышение доли за месяц» из вашей части прибыли: начисления по сделкам не меняются.
            Ниже базового процента опустить нельзя. Остаток долга переходит в следующий месяц.
          </div>
        </v-card-text>

        <div class="cim-dlg-foot">
          <div class="cim-dlg-totals">
            <span v-if="settleTotals.bonus">Повышение <b class="cim-raise">{{ settleTotals.bonus > 0 ? '+' : '' }}{{ formatCurrency(settleTotals.bonus) }}</b></span>
            <span>Выплатить <b>{{ formatCurrency(settleTotals.pay) }}</b></span>
            <span v-if="canReinvest">Реинвест <b>{{ formatCurrency(settleTotals.reinvest) }}</b></span>
            <span>Остаётся <b>{{ formatCurrency(Math.max(settleTotals.left, 0)) }}</b></span>
          </div>
          <button type="button" class="cim-btn" @click="settleOpen = false">Отмена</button>
          <button
            type="button"
            class="cim-btn cim-btn--primary"
            :disabled="settling || settleInvalid || !lines.length"
            @click="submitSettle"
          >
            <v-progress-circular v-if="settling" indeterminate size="16" width="2" />
            <span>Провести расчёт</span>
          </button>
        </div>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<style scoped>
.cim { overflow: hidden; }
.cim-toolbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 16px;
}
.cim-box { width: 220px; max-width: 100%; }
.cim-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 16px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.85);
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background 0.15s, box-shadow 0.15s;
}
.cim-btn:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.04); }
.cim-btn:disabled { opacity: 0.5; cursor: default; }
.cim-btn--primary { background: #047857; border-color: #047857; color: #fff; }
.cim-btn--primary:hover:not(:disabled) { background: #065f46; box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25); }
.cim-btn--sm { height: 32px; padding: 0 12px; }

.cim-day {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 12px; border-radius: 10px; border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
  background: none; color: rgba(var(--v-theme-on-surface), 0.75); font-size: 13px; font-weight: 600; cursor: pointer;
}
.cim-day:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.04); }
.cim-day-menu { padding: 14px; width: 300px; }
.cim-day-title { font-size: 14px; font-weight: 700; }
.cim-day-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6); margin: 4px 0 10px; line-height: 1.4; }
.cim-day-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.cim-day-cell {
  height: 32px; border-radius: 8px; border: none; background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13px; font-weight: 600; cursor: pointer; color: rgba(var(--v-theme-on-surface), 0.85);
}
.cim-day-cell:hover { background: rgba(4, 120, 87, 0.12); }
.cim-day-cell--on { background: #047857; color: #fff; }
.cim-day-clear {
  margin-top: 10px; width: 100%; height: 32px; border-radius: 8px; border: none; background: none;
  color: #dc2626; font-size: 13px; font-weight: 600; cursor: pointer;
}

.cim-kpis {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px;
  padding: 0 16px 16px;
}
.cim-kpi {
  display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.cim-kpi-icon {
  flex: none; width: 38px; height: 38px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--c); background: color-mix(in srgb, var(--c) 12%, transparent);
}
.cim-kpi-body { min-width: 0; }
.cim-kpi-label { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); line-height: 1.3; }
.cim-kpi-val { font-size: 21px; font-weight: 800; margin-top: 3px; font-variant-numeric: tabular-nums; letter-spacing: -0.2px; }
.cim-kpi-note { font-size: 11.5px; color: #dc2626; margin-top: 2px; }

.cim-closed-chip {
  display: inline-flex; align-items: center; gap: 5px; height: 36px; padding: 0 12px;
  border-radius: 10px; font-size: 13px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.7);
}
.cim-closed {
  margin: 0 16px 12px; padding: 12px 14px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgba(var(--v-theme-on-surface), 0.03);
}
.cim-closed-main { display: flex; align-items: center; gap: 10px; }
.cim-closed-main > div { flex: 1; min-width: 0; }
.cim-closed-title { font-size: 13.5px; font-weight: 600; }
.cim-closed-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; }
.cim-closed-diff { margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.15); font-size: 12.5px; }
.cim-closed-diff-title { display: flex; gap: 6px; align-items: center; color: #b45309; font-weight: 600; margin-bottom: 4px; }
.cim-closed-diff-row { color: rgba(var(--v-theme-on-surface), 0.75); padding-left: 21px; }
.cim-cd { padding: 20px; }
.cim-cd-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
.cim-cd-list { margin: 0 0 10px; padding-left: 18px; font-size: 13px; line-height: 1.55; color: rgba(var(--v-theme-on-surface), 0.75); }
.cim-cd-note { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); }
.cim-cd-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
.cim-note {
  display: flex; align-items: center; gap: 6px; margin: 12px 16px 0;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.65);
}

.cim-scroll { overflow-x: auto; transition: opacity 0.15s; }
.cim-scroll--loading { opacity: 0.55; pointer-events: none; }
.cim-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.cim-table thead th {
  text-align: left; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  padding: 12px 12px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.16); white-space: nowrap;
  vertical-align: middle;
  /* Подложка поверх фона карточки: шапка отделена от строк и при прокрутке. */
  background: linear-gradient(rgba(var(--v-theme-on-surface), 0.04), rgba(var(--v-theme-on-surface), 0.04)), rgb(var(--v-theme-surface));
}
.cim-table tbody td, .cim-table tfoot td {
  padding: 10px 12px; vertical-align: middle; font-size: 14px; font-weight: 500;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  white-space: nowrap;
}
/* Цвет значений — с нулевым весом селектора: цветные классы на самой ячейке
   (переплата, доля партнёра, «остаток») должны его перекрывать. */
:where(.cim-table) :where(tbody, tfoot) :where(td) { color: rgba(var(--v-theme-on-surface), 0.87); }
.cim-table tfoot td {
  font-weight: 700; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12); border-bottom: none;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.cim-table th.cim-num, .cim-table td.cim-num { text-align: right; }
.cim-n { width: 36px; color: rgba(var(--v-theme-on-surface), 0.45); text-align: center !important; }
.cim-name { min-width: 160px; }
.cim-act { width: 1%; }
.cim-who { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }
.cim-sub { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; font-weight: 500; }
.cim-muted { color: rgba(var(--v-theme-on-surface), 0.4); }
.cim-strong { font-weight: 700; }
.cim-strike { text-decoration: line-through; margin-right: 6px; }
.cim-raise { color: #7c3aed; font-weight: 700; }
.cim-c-inv { color: #4f46e5; }
.cim-c-me { color: #047857; }
.cim-c-owed { color: #d97706; }
.cim-c-in { color: #047857; }
.cim-c-out { color: #dc2626; }

.cim-partner td { background: rgba(4, 120, 87, 0.05); }
.cim-row { cursor: pointer; transition: background 0.12s; }
.cim-row:hover td { background: rgba(var(--v-theme-on-surface), 0.03); }
.cim-row--archived td { opacity: 0.6; }
.cim-none { text-align: center; padding: 28px 12px !important; color: rgba(var(--v-theme-on-surface), 0.5); }

/* Имя закреплено слева — на телефоне таблица листается вбок. */
@media (max-width: 960px) {
  .cim-table .cim-name {
    position: sticky; left: 0; z-index: 1;
    background: rgb(var(--v-theme-surface));
    box-shadow: 1px 0 0 rgba(var(--v-theme-on-surface), 0.06);
  }
  .cim-partner .cim-name { background: rgb(var(--v-theme-surface)); }
  .cim-n { display: none; }
}

.cim-dots {
  width: 32px; height: 32px; border-radius: 8px; border: none; background: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: rgba(var(--v-theme-on-surface), 0.55);
}
.cim-dots:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.cim-menu {
  background: rgb(var(--v-theme-surface)); border-radius: 12px; padding: 6px; min-width: 210px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.cim-menu-item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: 8px;
  border: none; background: none; cursor: pointer; font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85);
}
.cim-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.cim-menu-item--danger { color: #dc2626; }

.cim-th-help { display: inline-flex; align-items: center; gap: 3px; cursor: help; }
.cim-th-help .v-icon { opacity: 0.6; }
.cim-foot-note b { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.7); }
.cim-foot-note {
  padding: 10px 16px 14px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); line-height: 1.45;
}
.cim-empty, .cim-loading { padding: 40px 16px; text-align: center; color: rgba(var(--v-theme-on-surface), 0.55); }

/* Окно расчёта */
.cim-dlg-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 10px;
}
.cim-dlg-title { font-size: 18px; font-weight: 700; }
.cim-dlg-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; }
.cim-dlg-bulk {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 20px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.cim-bulk-pct { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.cim-chip {
  height: 32px; padding: 0 12px; border-radius: 16px; border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: none; font-size: 12.5px; font-weight: 600; cursor: pointer; color: rgba(var(--v-theme-on-surface), 0.8);
}
.cim-chip:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.cim-dlg-body { padding: 0 !important; }
.cim-table--dlg td { vertical-align: middle; }
.cim-in-wrap { position: relative; display: inline-flex; align-items: center; }
.cim-in {
  width: 130px; height: 36px; padding: 0 26px 0 10px; border-radius: 8px; text-align: right;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16); background: rgb(var(--v-theme-surface));
  font-size: 13.5px; font-variant-numeric: tabular-nums; color: rgba(var(--v-theme-on-surface), 0.9); outline: none;
}
.cim-in:focus { border-color: #047857; box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.12); }
.cim-in--pct { width: 76px; padding-right: 22px; }
.cim-bulk-pct .cim-in--pct { padding-right: 10px; }
.cim-in--bad { border-color: #dc2626; }
.cim-in-suf { position: absolute; right: 9px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.45); pointer-events: none; }
.cim-err { font-size: 11.5px; color: #dc2626; margin-top: 2px; }
.cim-dlg-hint { padding: 12px 20px 16px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); line-height: 1.45; }
.cim-dlg-foot {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.cim-dlg-totals { flex: 1 1 auto; display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65); }
.cim-dlg-totals b { color: rgba(var(--v-theme-on-surface), 0.9); font-variant-numeric: tabular-nums; }
</style>
