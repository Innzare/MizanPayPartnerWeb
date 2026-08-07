<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSections } from '@/composables/useSections'
import { useRouter } from 'vue-router'
import { formatCurrency } from '@/utils/formatters'
import type { ReportsDealsTable, ReportDealRow } from '@/types/reports'

const props = defineProps<{
  data: ReportsDealsTable
  loading?: boolean
}>()

const router = useRouter()

/**
 * Настраиваемые колонки — тот же приём, что в разделе «Сделки»:
 * выбор живёт в localStorage, чтобы таблица открывалась в привычном виде.
 */
type ColKey =
  | 'dealDate' | 'client' | 'cashBox' | 'cost' | 'totalPrice' | 'margin'
  | 'marginShare' | 'downPayment' | 'received' | 'remaining' | 'progress'
  | 'grossProfit' | 'ciProfit' | 'netProfit' | 'projectedNet' | 'profitLeft'
  | 'overdue' | 'coInvestors' | 'status'

const ALL_COLUMNS: { key: ColKey; label: string; hint?: string; num?: boolean }[] = [
  { key: 'dealDate', label: 'Дата' },
  { key: 'client', label: 'Клиент' },
  { key: 'cashBox', label: 'Касса' },
  { key: 'cost', label: 'Закупка', hint: 'Сколько денег ушло на товар', num: true },
  { key: 'totalPrice', label: 'Цена продажи', num: true },
  { key: 'margin', label: 'Наценка ₽', hint: 'Цена продажи минус закупка', num: true },
  { key: 'marginShare', label: 'Доля прибыли', hint: 'Какая часть каждого платежа — прибыль', num: true },
  { key: 'downPayment', label: 'Первый взнос', num: true },
  { key: 'received', label: 'Пришло', hint: 'Взнос + оплаченные платежи', num: true },
  { key: 'remaining', label: 'Остаток долга', num: true },
  { key: 'progress', label: 'Платежей', hint: 'Оплачено из общего числа' },
  { key: 'grossProfit', label: 'Вся прибыль', hint: 'Наценка с пришедших денег', num: true },
  { key: 'ciProfit', label: 'Со-инвесторам', num: true },
  { key: 'netProfit', label: 'Заработано', hint: 'Ваша прибыль с уже пришедших денег', num: true },
  { key: 'projectedNet', label: 'Будет всего', hint: 'Сколько заработаете, когда сделка закроется полностью', num: true },
  { key: 'profitLeft', label: 'Осталось заработать', hint: 'Разница между итоговой прибылью и уже заработанной', num: true },
  { key: 'overdue', label: 'Просрочка', num: true },
  { key: 'coInvestors', label: 'Инвесторы' },
  { key: 'status', label: 'Статус' },
]

const DEFAULT_COLS: ColKey[] = [
  'dealDate', 'client', 'cost', 'totalPrice', 'margin',
  'received', 'remaining', 'progress', 'netProfit', 'projectedNet', 'status',
]
const STORAGE_KEY = 'reports:table-columns'

/** Колонки со-инвесторов не имеют смысла, когда раздел скрыт. */
const CI_COLS: ColKey[] = ['ciProfit', 'coInvestors']
const sections = useSections()
const availableColumns = computed(() =>
  sections.visible('coInvestors')
    ? ALL_COLUMNS
    : ALL_COLUMNS.filter((c) => !CI_COLS.includes(c.key)),
)

const visible = ref<ColKey[]>(loadCols())
function loadCols(): ColKey[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_COLS]
    const parsed = JSON.parse(raw) as ColKey[]
    // Сверяем с ДОСТУПНЫМИ колонками, а не со всеми: иначе колонка
    // «Со-инвесторам», включённая до скрытия раздела, восстановится из
    // памяти браузера и будет показывать прочерки.
    const valid = parsed.filter((k) => availableColumns.value.some((c) => c.key === k))
    return valid.length ? valid : DEFAULT_COLS.filter((k) => availableColumns.value.some((c) => c.key === k))
  } catch {
    return [...DEFAULT_COLS]
  }
}
watch(visible, (v) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) } catch { /* ignore */ }
}, { deep: true })

const shown = computed(() => availableColumns.value.filter((c) => visible.value.includes(c.key)))
function toggleCol(key: ColKey) {
  const i = visible.value.indexOf(key)
  if (i >= 0) {
    if (visible.value.length === 1) return // хотя бы одна колонка
    visible.value.splice(i, 1)
  } else {
    visible.value.push(key)
  }
}

// ── Фильтры и сортировка ─────────────────────────────────────────────────
const search = ref('')
const overdueOnly = ref(false)
const sortKey = ref<ColKey | 'productName'>('netProfit')
const sortDesc = ref(true)

function toggleSort(key: ColKey | 'productName') {
  if (sortKey.value === key) sortDesc.value = !sortDesc.value
  else { sortKey.value = key; sortDesc.value = true }
}

function sortValue(r: ReportDealRow, key: string): number | string {
  switch (key) {
    case 'productName': return r.productName.toLowerCase()
    case 'client': return r.clientName.toLowerCase()
    case 'cashBox': return (r.cashBoxName || '').toLowerCase()
    case 'status': return r.status
    case 'dealDate': return r.dealDate
    case 'marginShare': return r.marginSharePct
    case 'progress': return r.totalCount > 0 ? r.paidCount / r.totalCount : 0
    case 'grossProfit': return r.grossProfitReceived
    case 'ciProfit': return r.ciProfitFact
    case 'netProfit': return r.netProfitReceived
    case 'projectedNet': return r.projectedNetProfitTotal
    case 'profitLeft': return r.profitLeft
    case 'overdue': return r.overdueAmount
    case 'coInvestors': return r.coInvestorNames.join(',')
    default: return (r as any)[key] ?? 0
  }
}

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = props.data.rows.filter((r) => {
    if (overdueOnly.value && r.overdueCount === 0) return false
    if (q && !r.productName.toLowerCase().includes(q) && !r.clientName.toLowerCase().includes(q)) return false
    return true
  })
  const key = sortKey.value
  list = [...list].sort((a, b) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    const cmp = typeof va === 'string' && typeof vb === 'string'
      ? va.localeCompare(vb, 'ru')
      : Number(va) - Number(vb)
    return sortDesc.value ? -cmp : cmp
  })
  return list
})

/** ИТОГО пересчитываем по видимым строкам — чтобы сходилось с тем, что на экране. */
const totals = computed(() =>
  rows.value.reduce(
    (a, r) => ({
      count: a.count + 1,
      cost: a.cost + r.cost,
      totalPrice: a.totalPrice + r.totalPrice,
      margin: a.margin + r.margin,
      downPayment: a.downPayment + r.downPayment,
      received: a.received + r.received,
      remaining: a.remaining + r.remaining,
      grossProfit: a.grossProfit + r.grossProfitReceived,
      ciProfit: a.ciProfit + r.ciProfitFact,
      netProfit: a.netProfit + r.netProfitReceived,
      projectedNetProfitTotal: a.projectedNetProfitTotal + r.projectedNetProfitTotal,
      profitLeft: a.profitLeft + r.profitLeft,
      overdueAmount: a.overdueAmount + r.overdueAmount,
    }),
    { count: 0, cost: 0, totalPrice: 0, margin: 0, downPayment: 0, received: 0,
      remaining: 0, grossProfit: 0, ciProfit: 0, netProfit: 0,
      projectedNetProfitTotal: 0, profitLeft: 0, overdueAmount: 0 },
  ),
)

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Активна', COMPLETED: 'Завершена', OVERDUE: 'Просрочена', DISPUTED: 'Спорная',
}
function dateStr(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
</script>

<template>
  <v-card rounded="lg" elevation="0" border class="pa-5">
    <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-1">
      <div>
        <div class="rp-block-title">Все сделки за период</div>
        <div class="rp-block-sub">{{ totals.count }} из {{ data.rows.length }} · сделки, выданные в выбранном периоде</div>
      </div>
      <div class="d-flex align-center ga-2 flex-wrap">
        <input v-model="search" class="rt-search" placeholder="Товар или клиент…" >
        <button
          class="rt-chip"
          :class="{ 'rt-chip--active': overdueOnly }"
          type="button"
          @click="overdueOnly = !overdueOnly"
        >
          <v-icon icon="mdi-alert-outline" size="14" />
          С просрочкой
        </button>
        <v-menu :close-on-content-click="false" location="bottom end">
          <template #activator="{ props: p }">
            <button v-bind="p" class="rt-chip" type="button">
              <v-icon icon="mdi-view-column-outline" size="14" />
              Колонки
            </button>
          </template>
          <v-card min-width="260" class="pa-2">
            <div
              v-for="c in availableColumns"
              :key="c.key"
              class="rt-col-opt"
              @click="toggleCol(c.key)"
            >
              <v-icon
                :icon="visible.includes(c.key) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"
                size="18"
                :color="visible.includes(c.key) ? 'primary' : undefined"
              />
              <span>{{ c.label }}</span>
            </div>
          </v-card>
        </v-menu>
      </div>
    </div>

    <div class="rt-scroll">
      <table class="rt">
        <thead>
          <tr>
            <th class="rt-th rt-th--deal" @click="toggleSort('productName')">
              Сделка
              <v-icon v-if="sortKey === 'productName'" :icon="sortDesc ? 'mdi-menu-down' : 'mdi-menu-up'" size="14" />
            </th>
            <th
              v-for="c in shown"
              :key="c.key"
              class="rt-th"
              :class="{ 'rt-th--num': c.num }"
              :title="c.hint"
              @click="toggleSort(c.key)"
            >
              {{ c.label }}
              <v-icon v-if="sortKey === c.key" :icon="sortDesc ? 'mdi-menu-down' : 'mdi-menu-up'" size="14" />
            </th>
          </tr>
          <tr v-if="rows.length" class="rt-total rt-total--top">
            <td class="rt-td rt-td--deal">ИТОГО · {{ totals.count }}</td>
            <td v-for="c in shown" :key="c.key" class="rt-td" :class="{ 'rt-td--num': c.num }">
              <template v-if="c.key === 'cost'">{{ formatCurrency(totals.cost) }}</template>
              <template v-else-if="c.key === 'totalPrice'">{{ formatCurrency(totals.totalPrice) }}</template>
              <template v-else-if="c.key === 'margin'">{{ formatCurrency(totals.margin) }}</template>
              <template v-else-if="c.key === 'downPayment'">{{ formatCurrency(totals.downPayment) }}</template>
              <template v-else-if="c.key === 'received'">{{ formatCurrency(totals.received) }}</template>
              <template v-else-if="c.key === 'remaining'">{{ formatCurrency(totals.remaining) }}</template>
              <template v-else-if="c.key === 'grossProfit'">{{ formatCurrency(totals.grossProfit) }}</template>
              <template v-else-if="c.key === 'ciProfit'">{{ formatCurrency(totals.ciProfit) }}</template>
              <template v-else-if="c.key === 'netProfit'">
                <span class="rt-net">+{{ formatCurrency(Math.max(0, totals.netProfit)) }}</span>
              </template>
              <template v-else-if="c.key === 'projectedNet'">
                <span class="rt-total-profit">{{ formatCurrency(totals.projectedNetProfitTotal) }}</span>
              </template>
              <template v-else-if="c.key === 'profitLeft'">
                <span class="rt-left">{{ formatCurrency(totals.profitLeft) }}</span>
              </template>
              <template v-else-if="c.key === 'overdue'">{{ formatCurrency(totals.overdueAmount) }}</template>
              <template v-else>—</template>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="rt-row" @click="router.push(`/deals/${r.id}`)">
            <td class="rt-td rt-td--deal">
              <div class="rt-deal-name">{{ r.productName }}</div>
              <div class="rt-deal-num">№{{ r.dealNumber }}</div>
            </td>
            <td v-for="c in shown" :key="c.key" class="rt-td" :class="{ 'rt-td--num': c.num }">
              <template v-if="c.key === 'dealDate'">{{ dateStr(r.dealDate) }}</template>
              <template v-else-if="c.key === 'client'">{{ r.clientName }}</template>
              <template v-else-if="c.key === 'cashBox'">{{ r.cashBoxName || '—' }}</template>
              <template v-else-if="c.key === 'cost'">{{ formatCurrency(r.cost) }}</template>
              <template v-else-if="c.key === 'totalPrice'">{{ formatCurrency(r.totalPrice) }}</template>
              <template v-else-if="c.key === 'margin'">{{ formatCurrency(r.margin) }}</template>
              <template v-else-if="c.key === 'marginShare'">{{ r.marginSharePct }}%</template>
              <template v-else-if="c.key === 'downPayment'">{{ r.downPayment ? formatCurrency(r.downPayment) : '—' }}</template>
              <template v-else-if="c.key === 'received'">{{ formatCurrency(r.received) }}</template>
              <template v-else-if="c.key === 'remaining'">
                <span :class="{ 'rt-muted': r.remaining === 0 }">{{ formatCurrency(r.remaining) }}</span>
              </template>
              <template v-else-if="c.key === 'progress'">
                <span class="rt-progress">{{ r.paidCount }}/{{ r.totalCount }}</span>
              </template>
              <template v-else-if="c.key === 'grossProfit'">{{ formatCurrency(r.grossProfitReceived) }}</template>
              <template v-else-if="c.key === 'ciProfit'">
                <span :class="{ 'rt-muted': !r.ciProfitFact }">{{ r.ciProfitFact ? formatCurrency(r.ciProfitFact) : '—' }}</span>
              </template>
              <template v-else-if="c.key === 'netProfit'">
                <span class="rt-net">+{{ formatCurrency(Math.max(0, r.netProfitReceived)) }}</span>
              </template>
              <template v-else-if="c.key === 'projectedNet'">
                <span class="rt-total-profit">{{ formatCurrency(r.projectedNetProfitTotal) }}</span>
              </template>
              <template v-else-if="c.key === 'profitLeft'">
                <span :class="r.profitLeft > 0 ? 'rt-left' : 'rt-muted'">
                  {{ r.profitLeft > 0 ? formatCurrency(r.profitLeft) : '—' }}
                </span>
              </template>
              <template v-else-if="c.key === 'overdue'">
                <span v-if="r.overdueAmount > 0" class="rt-overdue">
                  {{ formatCurrency(r.overdueAmount) }} · {{ r.maxOverdueDays }} дн.
                </span>
                <span v-else class="rt-muted">—</span>
              </template>
              <template v-else-if="c.key === 'coInvestors'">
                <span :class="{ 'rt-muted': !r.coInvestorNames.length }">
                  {{ r.coInvestorNames.length ? r.coInvestorNames.join(', ') : '—' }}
                </span>
              </template>
              <template v-else-if="c.key === 'status'">
                <span class="rt-status" :class="`rt-status--${r.status.toLowerCase()}`">
                  {{ STATUS_LABEL[r.status] || r.status }}
                </span>
              </template>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="shown.length + 1" class="rt-empty">Нет сделок по выбранным условиям</td>
          </tr>
        </tbody>
        <tfoot>
          <tr v-if="rows.length" class="rt-total rt-total--bottom">
            <td class="rt-td rt-td--deal">ИТОГО · {{ totals.count }}</td>
            <td v-for="c in shown" :key="c.key" class="rt-td" :class="{ 'rt-td--num': c.num }">
              <template v-if="c.key === 'cost'">{{ formatCurrency(totals.cost) }}</template>
              <template v-else-if="c.key === 'totalPrice'">{{ formatCurrency(totals.totalPrice) }}</template>
              <template v-else-if="c.key === 'margin'">{{ formatCurrency(totals.margin) }}</template>
              <template v-else-if="c.key === 'downPayment'">{{ formatCurrency(totals.downPayment) }}</template>
              <template v-else-if="c.key === 'received'">{{ formatCurrency(totals.received) }}</template>
              <template v-else-if="c.key === 'remaining'">{{ formatCurrency(totals.remaining) }}</template>
              <template v-else-if="c.key === 'grossProfit'">{{ formatCurrency(totals.grossProfit) }}</template>
              <template v-else-if="c.key === 'ciProfit'">{{ formatCurrency(totals.ciProfit) }}</template>
              <template v-else-if="c.key === 'netProfit'">
                <span class="rt-net">+{{ formatCurrency(Math.max(0, totals.netProfit)) }}</span>
              </template>
              <template v-else-if="c.key === 'projectedNet'">
                <span class="rt-total-profit">{{ formatCurrency(totals.projectedNetProfitTotal) }}</span>
              </template>
              <template v-else-if="c.key === 'profitLeft'">
                <span class="rt-left">{{ formatCurrency(totals.profitLeft) }}</span>
              </template>
              <template v-else-if="c.key === 'overdue'">{{ formatCurrency(totals.overdueAmount) }}</template>
              <template v-else>—</template>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </v-card>
</template>

<style scoped>
.rp-block-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.rp-block-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }

.rt-search {
  padding: 7px 12px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: transparent; color: rgb(var(--v-theme-on-surface));
  font-size: 13px; min-width: 180px;
}
.rt-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 12px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.rt-chip:hover { border-color: rgba(var(--v-theme-on-surface), 0.22); }
.rt-chip--active {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.3);
  color: #f59e0b;
}
.rt-col-opt {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 8px; cursor: pointer;
  font-size: 13px;
}
.rt-col-opt:hover { background: rgba(var(--v-theme-on-surface), 0.05); }

/* Широкая таблица прокручивается внутри себя, страница не едет вбок */
.rt-scroll {
  /* Только горизонтальная прокрутка: таблица показывается целиком, страница
     не едет вбок. Высота НЕ ограничена — листаем страницей.
     Замечание: overflow-x: auto делает контейнер прокручиваемым и по вертикали
     (так работает спецификация), поэтому sticky внутри привязан к контейнеру.
     Пока высота не ограничена, вертикальной прокрутки внутри нет и фиксация
     заголовков не включается — это осознанный размен на полную высоту. */
  overflow-x: auto;
  margin-top: 14px;
  /* Высота строки заголовков — по ней позиционируется строка ИТОГО. */
  --rt-head-h: 38px;
  /* Цвета состояний строк. Липкая первая колонка обязана быть НЕПРОЗРАЧНОЙ
     (иначе при горизонтальной прокрутке сквозь неё видно другие ячейки),
     поэтому там тот же оттенок кладётся СЛОЕМ поверх фона поверхности —
     см. --rt-opaque ниже. Держим цвета в одном месте, чтобы обычные и липкие
     ячейки не разъезжались. */
  --rt-hover: rgba(var(--v-theme-on-surface), 0.04);
  --rt-total: rgba(16, 185, 129, 0.11);
}
.rt { width: 100%; border-collapse: collapse; white-space: nowrap; }
.rt-th {
  text-align: left; padding: 0 12px;
  /* Фиксированная высота: по ней позиционируется вторая липкая строка (ИТОГО). */
  height: var(--rt-head-h);
  box-sizing: border-box;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  cursor: pointer; user-select: none;
  /* Липнет под шапкой приложения (она тоже sticky). */
  position: sticky;
  top: 0;
  background: rgb(var(--v-theme-surface));
  z-index: 2;
}
.rt-th:hover { color: rgba(var(--v-theme-on-surface), 0.7); }
.rt-th--num { text-align: right; }
/* Угол «первая колонка × шапка» перекрывает и строки, и соседей. */
/* Угол «первая колонка × шапка» перекрывает и строки, и соседей. */
.rt-th--deal { left: 0; z-index: 4; }
.rt-row:hover .rt-td--deal .rt-deal-name { color: rgba(var(--v-theme-on-surface), 0.95); }

.rt-row { cursor: pointer; }
/* Подсветку вешаем на ЯЧЕЙКИ, а не на строку: у липкой первой колонки свой
   непрозрачный фон, и фон строки под него просто не виден.
   БЕЗ transition — сознательно: у обычных ячеек меняется цвет фона (он
   анимируется), а у липкой колонки слой-градиент (он НЕ анимируется), и строка
   подсвечивалась в два приёма. Мгновенная подсветка срабатывает одновременно. */
.rt-row:hover .rt-td { background: var(--rt-hover); }
.rt-td {
  padding: 12px; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.8);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.rt-td--num { text-align: right; }
.rt-td--deal {
  position: sticky; left: 0; z-index: 1;
  background: rgb(var(--v-theme-surface));
}
/* Два слоя: сверху оттенок состояния, снизу непрозрачная поверхность.
   Так колонка и просвечивать не будет, и подсветится как остальные. */
.rt-row:hover .rt-td--deal {
  background:
    linear-gradient(var(--rt-hover), var(--rt-hover)),
    rgb(var(--v-theme-surface));
}
.rt-deal-name { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.rt-deal-num { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4); }

.rt-net { color: #059669; font-weight: 700; }
.rt-total-profit { color: #0ea5e9; font-weight: 700; }
.rt-left { color: #3b82f6; font-weight: 600; }
.rt-overdue { color: #f59e0b; font-weight: 600; }
.rt-muted { color: rgba(var(--v-theme-on-surface), 0.3); }
.rt-progress { font-weight: 600; }
.rt-status {
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.rt-status--active { color: #10b981; background: rgba(16, 185, 129, 0.1); }
.rt-status--completed { color: #3b82f6; background: rgba(59, 130, 246, 0.1); }

/* ИТОГО дублируется СВЕРХУ и СНИЗУ: на длинной таблице сумма всегда рядом,
   куда бы ни отлистал. Выделяем заметно — это ключевая строка отчёта. */
.rt-total .rt-td {
  font-weight: 800;
  font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.95);
  padding: 14px 12px;
  background: var(--rt-total);
  border-bottom: none;
}
.rt-total--top .rt-td { border-bottom: 2px solid rgba(16, 185, 129, 0.4); }
.rt-total--bottom .rt-td { border-top: 2px solid rgba(16, 185, 129, 0.4); }
/* Липкая только верхняя — нижняя просто замыкает таблицу. */
.rt-total--top .rt-td {
  position: sticky;
  top: var(--rt-head-h);
  z-index: 2;
}
/* Первая колонка ИТОГО — тот же оттенок, но слоем поверх непрозрачной
   поверхности (колонка липкая и не должна просвечивать). */
.rt-total .rt-td--deal {
  left: 0;
  z-index: 4;
  background:
    linear-gradient(var(--rt-total), var(--rt-total)),
    rgb(var(--v-theme-surface));
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 12px;
}

.rt-empty {
  padding: 40px; text-align: center;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.4);
}
</style>
