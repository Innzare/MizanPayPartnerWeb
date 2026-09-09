<script setup lang="ts">
/**
 * История всех операций — единая лента по всем счетам.
 *
 * Отдельного журнала под неё нет: движения по счетам уже полная история
 * денег. Поэтому здесь выборка, а не третье хранилище, которое рано или
 * поздно разошлось бы с первыми двумя.
 *
 * Итоги считаются по всему фильтру, а не по видимым строкам: вопрос «сколько
 * пришло за август» не про первую страницу.
 */
import { computed, onMounted, ref, watch } from 'vue'
import BankLogo from '@/components/BankLogo.vue'
import { useRouter } from 'vue-router'
import { useAccountingStore, type AccountEntryView } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { formatCurrency, formatCurrencyShort } from '@/utils/formatters'
import AccountingTabs from '@/components/AccountingTabs.vue'
import DateField from '@/components/DateField.vue'
import { rangeForPreset, customLabel } from '@/composables/useReports'
import type { PeriodPreset, PeriodRange } from '@/types/reports'

const store = useAccountingStore()
const toast = useToast()
const router = useRouter()
const { isDark } = useIsDark()

const items = ref<AccountEntryView[]>([])
const totals = ref({ income: 0, expense: 0, net: 0, count: 0 })
const cursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)

// ── Фильтры ──
const accountId = ref<string>('')
const direction = ref<'' | 'in' | 'out'>('')
const kind = ref<string>('')
const q = ref<string>('')

/** Виды операций для выпадающего списка — теми же словами, что в ленте. */
const KINDS: Array<{ value: string; label: string }> = [
  { value: 'PAYMENT_IN', label: 'Оплаты клиентов' },
  { value: 'DEAL_DEPLOY', label: 'Закупки по сделкам' },
  { value: 'MANUAL', label: 'Ручные доходы и расходы' },
  { value: 'CAPITAL', label: 'Капитал' },
  { value: 'DIVIDEND', label: 'Выплаты инвесторам' },
  { value: 'CI_CAPITAL', label: 'Капитал инвесторов' },
  { value: 'TRANSFER_IN,TRANSFER_OUT', label: 'Переводы между счетами' },
  { value: 'RECONCILE', label: 'Пересчёты денег' },
  { value: 'REVERSAL', label: 'Отмены' },
  { value: 'OPENING,SEED_BACKFILL', label: 'Начальные остатки' },
]

const KIND_LABEL: Record<string, string> = {
  OPENING: 'Начальный остаток',
  SEED_BACKFILL: 'Перенос истории',
  PAYMENT_IN: 'Оплата от клиента',
  DEAL_DEPLOY: 'Закупка по сделке',
  MANUAL: 'Ручная операция',
  CAPITAL: 'Капитал',
  DIVIDEND: 'Выплата инвестору',
  CI_CAPITAL: 'Капитал инвестора',
  TRANSFER_IN: 'Перевод со счёта',
  TRANSFER_OUT: 'Перевод на счёт',
  RECONCILE: 'Пересчёт денег',
  REVERSAL: 'Отмена операции',
}

const KIND_ICON: Record<string, string> = {
  PAYMENT_IN: 'mdi-cash-plus',
  DEAL_DEPLOY: 'mdi-cart-outline',
  MANUAL: 'mdi-pencil-outline',
  CAPITAL: 'mdi-wallet-outline',
  DIVIDEND: 'mdi-account-cash-outline',
  CI_CAPITAL: 'mdi-account-group-outline',
  TRANSFER_IN: 'mdi-arrow-down-left',
  TRANSFER_OUT: 'mdi-arrow-up-right',
  RECONCILE: 'mdi-scale-balance',
  REVERSAL: 'mdi-undo-variant',
  OPENING: 'mdi-flag-outline',
  SEED_BACKFILL: 'mdi-history',
}

/**
 * Лента группируется по дням.
 *
 * Без этого дата повторяется в каждой строке, и одинаковые серые подписи
 * забивают ленту вместо того, чтобы помогать. С заголовком дня взгляд сразу
 * цепляется за границу суток, а итог дня отвечает на главный вопрос —
 * «сколько сегодня пришло».
 */
const groups = computed(() => {
  const out: Array<{ key: string; label: string; income: number; expense: number; items: AccountEntryView[] }> = []
  for (const e of items.value) {
    const key = String(e.date).slice(0, 10)
    let g = out.find((x) => x.key === key)
    if (!g) {
      g = { key, label: dayLabel(e.date), income: 0, expense: 0, items: [] }
      out.push(g)
    }
    g.items.push(e)
    if (e.amount > 0) g.income += e.amount
    else g.expense += e.amount
  }
  return out
})

/** «Сегодня» и «Вчера» человек читает быстрее, чем дату. */
function dayLabel(date: string): string {
  const d = new Date(date)
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/**
 * Период — тем же механизмом, что в отчётах: список пресетов плюс «свой
 * период». Одинаковые вещи в разных разделах должны выбираться одинаково,
 * иначе человек каждый раз заново разбирается, где что.
 */
const PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: 'all', label: 'За всё время' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'half', label: 'Полугодие' },
  { key: 'year', label: 'Год' },
]

const period = ref<PeriodRange>(rangeForPreset('all'))
const customOpen = ref(false)
// Поля своего периода стартуют с текущего месяца: у «за всё время» нижняя
// граница техническая (2000 год) и в календаре смотрелась бы странно.
const thisMonth = rangeForPreset('month')
const customFrom = ref(thisMonth.from)
const customTo = ref(thisMonth.to)

/** Список для селекта: свой период появляется пунктом, только когда выбран. */
const periodItems = computed(() => {
  const list = PRESETS.map((p) => ({ title: p.label, value: p.key as string }))
  if (period.value.preset === 'custom') list.push({ title: period.value.label, value: 'custom' })
  return list
})

function pickPreset(p: PeriodPreset) {
  // «Свой период» в списке — только показ текущего выбора: задают его кнопкой.
  if (p === 'custom') return
  period.value = rangeForPreset(p)
}

function applyCustom() {
  if (!customFrom.value || !customTo.value) return
  const [f, t] =
    customFrom.value <= customTo.value
      ? [customFrom.value, customTo.value]
      : [customTo.value, customFrom.value]
  period.value = { from: f, to: t, preset: 'custom', label: customLabel(f, t) }
  customOpen.value = false
}

/** Пункты селектов: у Vuetify это {title, value}, а не option-разметка. */
const accountItems = computed(() => [
  { title: 'Все счета', value: '' },
  ...store.accounts.map((a) => ({ title: `${a.code} · ${a.name}`, value: a.id })),
])

const kindItems = computed(() => [
  { title: 'Все операции', value: '' },
  ...KINDS.map((k) => ({ title: k.label, value: k.value })),
])

const params = computed(() => ({
  accountIds: accountId.value || undefined,
  direction: direction.value || undefined,
  kinds: kind.value || undefined,
  // «За всё время» границ не шлёт: техническая дата 2000 года только
  // нагружает запрос, а выборку не сужает.
  from: period.value.preset === 'all' ? undefined : period.value.from,
  to: period.value.preset === 'all' ? undefined : period.value.to,
  q: q.value.trim() || undefined,
}))

const hasFilters = computed(
  () => Object.values(params.value).some(Boolean) || period.value.preset !== 'all',
)

onMounted(async () => {
  if (!store.accounts.length) await store.fetchAccounts().catch(() => {})
  await load()
})

// Фильтры меняются — лента начинается сначала, иначе курсор укажет в старую выборку.
let debounce: ReturnType<typeof setTimeout> | null = null
watch(params, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void load(), 250)
})

async function load() {
  loading.value = true
  try {
    const res = await store.fetchFeed(params.value)
    items.value = res.items
    totals.value = res.totals
    cursor.value = res.nextCursor
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить историю')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!cursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const res = await store.fetchFeed(params.value, cursor.value)
    items.value.push(...res.items)
    cursor.value = res.nextCursor
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить ещё')
  } finally {
    loadingMore.value = false
  }
}

function resetFilters() {
  accountId.value = ''
  direction.value = ''
  kind.value = ''
  q.value = ''
  period.value = rangeForPreset('all')
}

function goToDeal(e: AccountEntryView) {
  if (e.deal) router.push(`/deals/${e.deal.id}`)
}
</script>

<template>
  <div class="hs-page" :class="{ dark: isDark }">
    <AccountingTabs />

    <div class="hs-head">
      <div>
        <div class="hs-title">История операций</div>
        <div class="hs-hint">Все движения денег по всем счетам</div>
      </div>

      <!-- Период выбирается так же, как в отчётах: список готовых периодов и
           кнопка своего. Одинаковые вещи в разных разделах должны работать
           одинаково. -->
      <div class="hs-period-ctl">
        <v-select
          :model-value="period.preset"
          :items="periodItems"
          density="compact"
          variant="outlined"
          hide-details
          class="hs-vselect hs-vselect--period"
          @update:model-value="pickPreset"
        />
        <v-menu v-model="customOpen" :close-on-content-click="false" location="bottom end">
          <template #activator="{ props: menuProps }">
            <button
              v-bind="menuProps"
              class="hs-custom-btn"
              :class="{ 'hs-custom-btn--active': period.preset === 'custom' }"
              type="button"
            >
              <v-icon icon="mdi-calendar-range" size="16" />
              Свой период
            </button>
          </template>
          <v-card min-width="280" class="pa-4">
            <div class="text-caption text-medium-emphasis mb-2">С какой даты</div>
            <DateField v-model="customFrom" :max="customTo || undefined" />
            <div class="text-caption text-medium-emphasis mt-3 mb-2">По какую</div>
            <DateField v-model="customTo" :min="customFrom || undefined" />
            <v-btn color="primary" block class="mt-4" @click="applyCustom">Показать</v-btn>
          </v-card>
        </v-menu>
      </div>
    </div>

    <!-- Фильтры одной строкой: поиск слева, уточнения справа -->
    <div class="hs-filters">
      <div class="hs-search">
        <v-icon icon="mdi-magnify" size="18" class="hs-search-icon" />
        <input v-model="q" class="hs-search-input" placeholder="Поиск по описанию" />
        <button v-if="q" class="hs-search-clear" @click="q = ''">
          <v-icon icon="mdi-close" size="14" />
        </button>
      </div>

      <v-select
        v-model="accountId"
        :items="accountItems"
        density="compact"
        variant="outlined"
        hide-details
        class="hs-vselect"
      />

      <v-select
        v-model="kind"
        :items="kindItems"
        density="compact"
        variant="outlined"
        hide-details
        class="hs-vselect hs-vselect--wide"
      />

      <!-- Направление — переключателем: вариантов всего три, и списком они
           читались бы дольше, чем кнопками. -->
      <div class="hs-dir">
        <button class="hs-dir-btn" :class="{ 'hs-dir-btn--on': direction === '' }" @click="direction = ''">Все</button>
        <button class="hs-dir-btn" :class="{ 'hs-dir-btn--on': direction === 'in' }" @click="direction = 'in'">Приход</button>
        <button class="hs-dir-btn" :class="{ 'hs-dir-btn--on': direction === 'out' }" @click="direction = 'out'">Расход</button>
      </div>

      <button v-if="hasFilters" class="hs-reset" title="Сбросить фильтры" @click="resetFilters">
        <v-icon icon="mdi-filter-remove-outline" size="16" />
      </button>
    </div>

    <!-- Итоги по всей выборке, а не по видимым строкам -->
    <div class="hs-totals">
      <div class="hs-total">
        <div class="hs-total-head">
          <span class="hs-total-dot hs-total-dot--in" />
          Пришло
        </div>
        <div class="hs-total-value hs-total-value--in">{{ formatCurrency(totals.income) }}</div>
      </div>
      <div class="hs-total">
        <div class="hs-total-head">
          <span class="hs-total-dot hs-total-dot--out" />
          Ушло
        </div>
        <div class="hs-total-value hs-total-value--out">{{ formatCurrency(Math.abs(totals.expense)) }}</div>
      </div>
      <div class="hs-total">
        <div class="hs-total-head">Разница</div>
        <div class="hs-total-value" :class="totals.net < 0 ? 'hs-total-value--minus' : ''">
          {{ totals.net > 0 ? '+' : '' }}{{ formatCurrency(totals.net) }}
        </div>
      </div>
      <div class="hs-total hs-total--muted">
        <div class="hs-total-head">Операций</div>
        <div class="hs-total-value">{{ totals.count }}</div>
      </div>
    </div>

    <div v-if="loading && !items.length" class="hs-loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="!items.length" class="hs-empty">
      <v-icon icon="mdi-timeline-text-outline" size="34" />
      <div class="hs-empty-title">{{ hasFilters ? 'Ничего не нашлось' : 'Операций пока нет' }}</div>
      <div class="hs-empty-text">
        {{ hasFilters
          ? 'Попробуйте изменить условия — например, расширить период.'
          : 'Здесь появятся оплаты клиентов, закупки, переводы и пересчёты по всем счетам.' }}
      </div>
      <button v-if="hasFilters" class="hs-empty-btn" @click="resetFilters">Сбросить фильтры</button>
    </div>

    <!-- Лента по дням: дата в заголовке, а не в каждой строке -->
    <template v-else>
      <div v-for="g in groups" :key="g.key" class="hs-group">
        <div class="hs-day">
          <span class="hs-day-label">{{ g.label }}</span>
          <span class="hs-day-line" />
          <span v-if="g.income > 0" class="hs-day-sum hs-day-sum--in">+{{ formatCurrencyShort(g.income) }}</span>
          <span v-if="g.expense < 0" class="hs-day-sum hs-day-sum--out">−{{ formatCurrencyShort(Math.abs(g.expense)) }}</span>
        </div>

        <div class="hs-list">
          <div
            v-for="e in g.items"
            :key="e.id"
            class="hs-row"
            :class="{ 'hs-row--clickable': !!e.deal }"
            @click="goToDeal(e)"
          >
            <div class="hs-row-icon" :class="e.amount < 0 ? 'hs-row-icon--out' : 'hs-row-icon--in'">
              <v-icon :icon="KIND_ICON[e.kind] || 'mdi-circle-small'" size="17" />
            </div>

            <div class="hs-row-body">
              <div class="hs-row-title">{{ e.note || KIND_LABEL[e.kind] || 'Операция' }}</div>
              <div class="hs-row-sub">
                <span v-if="e.account" class="hs-row-account">
                  <!-- Логотип банка вместо цветной точки: по какой карте прошла
                       операция, видно сразу. -->
                  <BankLogo
                    :bank-name="e.account.bank?.name"
                    :color="e.account.bank?.color || e.account.color"
                    :fallback="e.account.code"
                    :size="16"
                  />
                  {{ e.account.code }}
                </span>
                <span class="hs-row-kind">{{ KIND_LABEL[e.kind] || 'Операция' }}</span>
                <span v-if="e.deal" class="hs-row-deal">№{{ e.deal.dealNumber }}</span>
              </div>
            </div>

            <div class="hs-row-amount" :class="e.amount < 0 ? 'hs-row-amount--out' : 'hs-row-amount--in'">
              {{ e.amount < 0 ? '−' : '+' }}{{ formatCurrency(Math.abs(e.amount)) }}
            </div>

            <v-icon v-if="e.deal" icon="mdi-chevron-right" size="16" class="hs-row-arrow" />
            <span v-else class="hs-row-arrow-space" />
          </div>
        </div>
      </div>

      <button v-if="cursor" class="hs-more" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? 'Загружаю…' : 'Показать ещё' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.hs-page { padding: 24px 28px 40px; }
.hs-loading { display: flex; justify-content: center; align-items: center; min-height: 260px; }

/* ── Шапка: название слева, период справа ── */
.hs-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; margin-bottom: 16px;
}
.hs-title { font-size: 20px; font-weight: 700; }
.hs-hint { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 3px; }

.hs-period-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hs-custom-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 14px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  /* Поля и кнопки стоят на своём слое, а не сливаются с фоном страницы —
     иначе непонятно, где вообще можно нажать. */
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.hs-custom-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.25); }
.hs-custom-btn--active {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.32);
  color: #10b981;
}

/* ── Фильтры ── */
.hs-filters {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 16px;
}
.hs-search {
  position: relative; flex: 1; min-width: 220px;
  display: flex; align-items: center;
}
.hs-search-icon {
  position: absolute; left: 12px;
  color: rgba(var(--v-theme-on-surface), 0.35); pointer-events: none;
}
.hs-search-input {
  width: 100%; height: 40px; padding: 0 34px 0 38px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 13.5px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.hs-search-input:focus { border-color: #047857; }
.hs-search-clear {
  position: absolute; right: 10px;
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.4);
  background: rgba(var(--v-theme-on-surface), 0.07); cursor: pointer;
}
.hs-search-clear:hover { color: rgba(var(--v-theme-on-surface), 0.7); }

/* Селекты — те же, что в отчётах: со стрелкой и рамкой, чтобы было видно,
   что это выбор из списка, а не подпись. */
.hs-vselect { min-width: 180px; max-width: 210px; }
.hs-vselect--wide { min-width: 210px; max-width: 240px; }
.hs-vselect--period { min-width: 172px; }
.hs-vselect :deep(.v-field) {
  border-radius: 9px; font-size: 13px; font-weight: 600;
  background: rgb(var(--v-theme-surface));
}
.hs-vselect :deep(.v-field__input) { min-height: 40px; padding-top: 0; padding-bottom: 0; }

.hs-dir {
  display: flex; gap: 2px; height: 40px; padding: 3px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
}
.hs-dir-btn {
  display: flex; align-items: center; padding: 0 12px; border-radius: 7px;
  font-size: 12.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55); cursor: pointer;
}
.hs-dir-btn:hover { color: rgba(var(--v-theme-on-surface), 0.8); }
.hs-dir-btn--on {
  background: rgba(16, 185, 129, 0.1);
  color: #047857;
}
.dark .hs-dir-btn--on { color: #34d399; }

.hs-reset {
  width: 40px; height: 40px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.5);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); cursor: pointer;
}
.hs-reset:hover { color: #dc2626; border-color: rgba(220, 38, 38, 0.35); }

/* ── Итоги: четыре колонки на всю ширину ── */
.hs-totals {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
  border-radius: 14px; overflow: hidden; margin-bottom: 22px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.hs-total { padding: 14px 18px; background: rgb(var(--v-theme-surface)); }
.hs-total--muted .hs-total-value { color: rgba(var(--v-theme-on-surface), 0.6); font-weight: 600; }
.hs-total-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.3px;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.hs-total-dot { width: 7px; height: 7px; border-radius: 50%; }
.hs-total-dot--in { background: #10b981; }
.hs-total-dot--out { background: #f59e0b; }
.hs-total-value {
  font-size: 19px; font-weight: 700; margin-top: 5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.3px;
}
.hs-total-value--in { color: #047857; }
.hs-total-value--out { color: #b45309; }
.hs-total-value--minus { color: rgba(var(--v-theme-on-surface), 0.9); }
.dark .hs-total-value--in { color: #34d399; }
.dark .hs-total-value--out { color: #fbbf24; }

/* ── Лента по дням ── */
.hs-group { margin-bottom: 18px; }
.hs-day {
  display: flex; align-items: center; gap: 10px;
  padding: 0 4px 8px;
}
.hs-day-label {
  font-size: 12.5px; font-weight: 700; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.hs-day-line { flex: 1; height: 1px; background: rgba(var(--v-theme-on-surface), 0.08); }
.hs-day-sum {
  font-size: 12px; font-weight: 700; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.hs-day-sum--in { color: #047857; }
.hs-day-sum--out { color: rgba(var(--v-theme-on-surface), 0.45); }
.dark .hs-day-sum--in { color: #34d399; }

.hs-list {
  border-radius: 14px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.hs-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.hs-row:last-child { border-bottom: none; }
.hs-row--clickable { cursor: pointer; }
.hs-row--clickable:hover { background: rgba(var(--v-theme-on-surface), 0.025); }
.hs-row-icon {
  width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.hs-row-icon--in { background: rgba(16, 185, 129, 0.11); color: #047857; }
.hs-row-icon--out { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.55); }
.dark .hs-row-icon--in { background: rgba(52, 211, 153, 0.14); color: #34d399; }

.hs-row-body { flex: 1; min-width: 0; }
.hs-row-title {
  font-size: 13.5px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hs-row-sub {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 3px;
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.hs-row-account { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; }
.hs-row-account-dot { width: 7px; height: 7px; border-radius: 2px; }
.hs-row-kind {
  padding: 1px 7px; border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.hs-row-deal { opacity: 0.75; }

.hs-row-amount {
  font-size: 14px; font-weight: 700; white-space: nowrap;
  font-variant-numeric: tabular-nums;
  min-width: 118px; text-align: right;
}
.hs-row-amount--in { color: #047857; }
.hs-row-amount--out { color: rgba(var(--v-theme-on-surface), 0.85); }
.dark .hs-row-amount--in { color: #34d399; }

.hs-row-arrow { color: rgba(var(--v-theme-on-surface), 0.25); }
.hs-row-arrow-space { width: 16px; }

.hs-more {
  width: 100%; padding: 12px; border-radius: 12px; margin-top: 4px;
  font-size: 13.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  cursor: pointer;
}
.hs-more:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.hs-more:disabled { opacity: 0.6; cursor: default; }

.hs-empty {
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  padding: 52px 24px; border-radius: 14px; text-align: center;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.hs-empty-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.hs-empty-text { font-size: 13px; max-width: 380px; line-height: 1.5; }
.hs-empty-btn {
  margin-top: 8px; padding: 9px 18px; border-radius: 10px;
  font-size: 13px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.75); cursor: pointer;
}
.hs-empty-btn:hover { background: rgba(var(--v-theme-on-surface), 0.11); }

@media (max-width: 900px) {
  .hs-totals { grid-template-columns: repeat(2, 1fr); }
  .hs-vselect, .hs-vselect--wide { max-width: none; flex: 1 1 160px; }
  .hs-period-ctl { width: 100%; }
  .hs-vselect--period { flex: 1; }
}
</style>
