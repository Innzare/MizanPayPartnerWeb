<script setup lang="ts">
/**
 * События — сводка, которую партнёр открывает вместо обхода пяти разделов.
 *
 * Слева то, что требует действий сегодня: какие платежи ждём, сколько
 * просрочено, кто обещал заплатить, сколько денег ещё не доехало до кассы.
 * Справа — что произошло за период: собрано, заработано, оформлено, закрыто.
 * Каждая карточка ведёт в раздел, где с этим можно что-то сделать.
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { formatCurrency } from '@/utils/formatters'

interface Value {
  count: number
  amount: number
}
interface Metric extends Value {
  prevCount: number
  prevAmount: number
}
interface Digest {
  from: string
  to: string
  attention: number
  now: {
    dueToday: Value
    overdue: Value
    overdueAdded: number
    promisesToday: Value
    cashOutside: Value
  }
  period: {
    collected: Metric
    earned: Metric
    dealsCreated: Metric
    dealsCompleted: Metric
  }
  hidden: string[]
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  /** Свежее число для кнопки в шапке: панель уже всё посчитала. */
  (e: 'attention', v: number): void
}>()

const router = useRouter()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** Периоды: за сколько партнёр обычно и спрашивает «что было». */
const PERIODS = [
  { key: 'day', label: 'За сегодня', days: 1 },
  { key: 'week', label: 'За неделю', days: 7 },
  { key: 'month', label: 'За месяц', days: 30 },
]
const period = ref('week')
const periodLabel = computed(
  () => PERIODS.find((p) => p.key === period.value)?.label ?? 'За неделю',
)

const loading = ref(false)
const digest = ref<Digest | null>(null)

/**
 * Номер последнего запроса.
 *
 * Периоды переключают быстро, а «за месяц» считается дольше «за сутки»:
 * без этого поздний ответ старого запроса лёг бы поверх нового, и партнёр
 * увидел бы месячные цифры под выбранной кнопкой «За сутки».
 */
let requestId = 0

async function load() {
  const id = ++requestId
  loading.value = true
  try {
    // Границы периода считает сервер, целыми днями по времени партнёра: у
    // «Заработано» день оплаты календарный, и скользящее окно «минус 24 часа»
    // рассказывало бы про другой отрезок времени, чем соседние карточки.
    const days = PERIODS.find((p) => p.key === period.value)?.days ?? 7
    const res = await api.get<Digest>(`/digest?days=${days}`)
    if (id !== requestId) return
    digest.value = res
    // Кнопка в шапке живёт недельным окном — обновляем её только тогда, когда
    // открыт тот же период, иначе бейдж прыгал бы вслед за переключателем.
    if (period.value === 'week') emit('attention', res.attention)
  } catch {
    // Сводка — вспомогательный экран: не загрузилась, панель просто покажет
    // пустое состояние, а работа партнёра не остановится.
    if (id === requestId) digest.value = null
  } finally {
    if (id === requestId) loading.value = false
  }
}

// immediate: панель может быть смонтирована уже открытой — тогда без этого она
// показала бы пустой экран вместо сводки.
watch(open, (v) => { if (v) load() }, { immediate: true })
watch(period, () => { if (open.value) load() })

interface Card {
  key: string
  label: string
  /** Что показать крупно: количество или сумма. */
  primary: 'count' | 'amount'
  value: Value
  /** Мелкая строка под главным числом. */
  note?: string
  to?: string
  alarm?: boolean
  change?: { text: string; tone: 'good' | 'bad' | 'same' } | null
}

/**
 * Насколько изменилось против прошлого такого же периода.
 *
 * Цвет означает «хорошо это или плохо», а не «больше или меньше». Рост
 * просрочек — плохая новость, и красить её зелёным потому, что число выросло,
 * значит вводить партнёра в заблуждение на самом важном показателе.
 */
function change(m: Metric, money: boolean, bad = false) {
  const now = money ? m.amount : m.count
  const before = money ? m.prevAmount : m.prevCount
  if (!before) return null
  const diff = (now - before) / before
  if (Math.abs(diff) < 0.05) return { text: 'как обычно', tone: 'same' as const }
  const pct = Math.round(Math.abs(diff) * 100)
  const grew = diff > 0
  return {
    text: `${grew ? '+' : '−'}${pct}%`,
    tone: (grew === bad ? 'bad' : 'good') as 'good' | 'bad',
  }
}

const shown = (key: string) => !digest.value?.hidden.includes(key)

/** Левая колонка: положение дел на сегодня. */
const nowCards = computed<Card[]>(() => {
  const d = digest.value
  if (!d) return []
  const cards: Card[] = [
    {
      key: 'dueToday',
      label: 'Ждём сегодня',
      primary: 'count',
      value: d.now.dueToday,
      note: 'платежей по графику',
      to: '/payments',
    },
    {
      key: 'overdue',
      label: 'Просрочено',
      primary: 'count',
      value: d.now.overdue,
      note: d.now.overdueAdded
        ? `+${d.now.overdueAdded} за период`
        : 'платежей не в срок',
      to: '/debtors',
      alarm: d.now.overdue.count > 0,
    },
  ]
  if (shown('promisesToday')) {
    cards.push({
      key: 'promisesToday',
      label: 'Обещали заплатить',
      primary: 'count',
      value: d.now.promisesToday,
      note: 'срок обещания настал',
      to: '/debtors',
    })
  }
  if (shown('cashOutside')) {
    cards.push({
      key: 'cashOutside',
      label: 'Не сдано в кассу',
      primary: 'amount',
      value: d.now.cashOutside,
      note: d.now.cashOutside.count
        ? `на ${d.now.cashOutside.count} ${plural(d.now.cashOutside.count, 'счёте', 'счетах', 'счетах')}`
        : 'всё сдано',
      to: '/accounting',
    })
  }
  return cards
})

/** Правая колонка: что произошло за выбранный период. */
const periodCards = computed<Card[]>(() => {
  const d = digest.value
  if (!d) return []
  const cards: Card[] = [
    {
      key: 'collected',
      label: 'Собрано',
      primary: 'count',
      value: d.period.collected,
      note: 'платежей принято',
      to: '/payments',
      change: change(d.period.collected, false),
    },
  ]
  if (shown('earned')) {
    cards.push({
      key: 'earned',
      label: 'Заработано',
      primary: 'amount',
      value: d.period.earned,
      note: 'ваш доход с этих денег',
      to: '/analytics',
      change: change(d.period.earned, true),
    })
  }
  cards.push(
    {
      key: 'dealsCreated',
      label: 'Новые сделки',
      primary: 'count',
      value: d.period.dealsCreated,
      note: 'оформлено договоров',
      to: '/deals',
      change: change(d.period.dealsCreated, false),
    },
    {
      key: 'dealsCompleted',
      label: 'Закрыто договоров',
      primary: 'count',
      value: d.period.dealsCompleted,
      note: 'клиенты рассчитались',
      to: '/deals',
      change: change(d.period.dealsCompleted, false),
    },
  )
  return cards
})

/** Склонение по числу — «на 1 счёте», «на 3 счетах». */
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function go(card: Card) {
  if (!card.to) return
  open.value = false
  router.push(card.to)
}

const isEmpty = computed(
  () =>
    !!digest.value &&
    [...nowCards.value, ...periodCards.value].every((c) => !c.value.count && !c.value.amount),
)
</script>

<template>
  <div class="dg-pop">
    <div class="dg-head">
      <div class="dg-head-text">
        <div class="dg-title">События</div>
        <div class="dg-sub">Что нужно сделать сегодня и что происходило</div>
      </div>

      <div class="dg-periods">
        <button
          v-for="p in PERIODS"
          :key="p.key"
          class="dg-period"
          :class="{ 'dg-period--on': period === p.key }"
          @click="period = p.key"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="dg-state">
      <v-progress-circular indeterminate color="primary" size="28" />
    </div>

    <div v-else-if="!digest" class="dg-state">Не удалось загрузить сводку</div>

    <div v-else-if="isEmpty" class="dg-state">
      Ни дел на сегодня, ни движений за период
    </div>

    <!-- Две колонки: слева требующее действий, справа итоги периода. В один
         столбец восемь карточек пришлось бы прокручивать ради того, что должно
         читаться сразу. -->
    <div v-else class="dg-cols">
      <section class="dg-col">
        <div class="dg-col-title">Прямо сейчас</div>
        <button
          v-for="c in nowCards"
          :key="c.key"
          class="dg-card"
          :class="{ 'dg-card--alarm': c.alarm }"
          :disabled="!c.to"
          @click="go(c)"
        >
          <div class="dg-card-body">
            <div class="dg-card-label">{{ c.label }}</div>
            <div class="dg-card-note">{{ c.note }}</div>
          </div>
          <div class="dg-card-value">
            <div class="dg-primary">
              {{ c.primary === 'count' ? c.value.count : formatCurrency(c.value.amount) }}
            </div>
            <div v-if="c.primary === 'count' && c.value.amount" class="dg-secondary">
              {{ formatCurrency(c.value.amount) }}
            </div>
          </div>
          <v-icon v-if="c.to" icon="mdi-chevron-right" size="18" class="dg-go" />
        </button>
      </section>

      <section class="dg-col">
        <div class="dg-col-title">{{ periodLabel }}</div>
        <button
          v-for="c in periodCards"
          :key="c.key"
          class="dg-card"
          :disabled="!c.to"
          @click="go(c)"
        >
          <div class="dg-card-body">
            <div class="dg-card-label">{{ c.label }}</div>
            <div class="dg-card-note">{{ c.note }}</div>
          </div>
          <div class="dg-card-value">
            <div class="dg-primary">
              {{ c.primary === 'count' ? c.value.count : formatCurrency(c.value.amount) }}
            </div>
            <div v-if="c.primary === 'count' && c.value.amount" class="dg-secondary">
              {{ formatCurrency(c.value.amount) }}
            </div>
            <div v-if="c.change" class="dg-change" :class="`dg-change--${c.change.tone}`">
              {{ c.change.text }}
            </div>
          </div>
          <v-icon v-if="c.to" icon="mdi-chevron-right" size="18" class="dg-go" />
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
/*
 * Окно раскрывается из кнопки в шапке, а не приходит модалкой поверх экрана:
 * это подсказка о происходящем, а не отдельная задача, и работа под ней должна
 * оставаться на виду. Формат горизонтальный (16:9) — две колонки читаются
 * одним взглядом, без прокрутки.
 */
.dg-pop {
  width: min(760px, calc(100vw - 24px));
  aspect-ratio: 16 / 9;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 14px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.14);
  overflow: hidden;
}

.dg-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.dg-head-text { min-width: 0; }
.dg-title { font-size: 16px; font-weight: 700; }
.dg-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }

.dg-periods { display: flex; gap: 4px; margin-left: auto; }
.dg-period {
  padding: 6px 13px; border-radius: 9px; border: none; cursor: pointer;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6);
  white-space: nowrap;
}
.dg-period--on { background: #047857; color: #fff; font-weight: 600; }

.dg-cols {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 10px;
  padding: 10px;
}
.dg-col { display: flex; flex-direction: column; gap: 2px; }
.dg-col-title {
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.38);
  padding: 4px 12px 6px;
}

.dg-card {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border: none; border-radius: 12px; background: transparent;
  text-align: left; cursor: pointer;
}
.dg-card:disabled { cursor: default; }
.dg-card:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.03); }
.dg-card--alarm { background: rgba(239, 68, 68, 0.06); }
.dg-card--alarm:hover:not(:disabled) { background: rgba(239, 68, 68, 0.1); }
.dg-card-body { flex: 1; min-width: 0; }
.dg-card-label { font-size: 13.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }
.dg-card--alarm .dg-card-label { color: #dc2626; }
.dg-card-note {
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Главное — количество: суммы бывают семизначными и, стоя первыми, забирают
   всё внимание и всё место. Деньги идут строкой ниже и помельче. */
.dg-card-value { text-align: right; }
.dg-primary {
  font-size: 18px; font-weight: 700; line-height: 1.15;
  font-variant-numeric: tabular-nums; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.92);
}
.dg-card--alarm .dg-primary { color: #dc2626; }
.dg-secondary {
  font-size: 11.5px; white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.dg-change { font-size: 11px; margin-top: 1px; }
.dg-change--good { color: #047857; }
.dg-change--bad { color: #dc2626; }
.dg-change--same { color: rgba(var(--v-theme-on-surface), 0.4); }
.dg-go { color: rgba(var(--v-theme-on-surface), 0.25); }

.dg-state {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  padding: 24px; text-align: center; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* На узком экране пропорция превратила бы окно в полоску: там карточки идут
   одной колонкой, а высоту задаёт содержимое. */
@media (max-width: 720px) {
  .dg-pop { aspect-ratio: auto; max-height: 70vh; }
  .dg-head { flex-direction: column; align-items: flex-start; gap: 10px; }
  .dg-periods { margin-left: 0; }
  .dg-cols { grid-template-columns: 1fr; gap: 8px; }
}
</style>
