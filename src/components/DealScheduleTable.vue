<script setup lang="ts">
/**
 * График платежей по сделке.
 *
 * Один компонент на страницу сделки и на окно предпросмотра из списка: график
 * с недоплатами, ветками-долгами и своевременностью слишком нагружен, чтобы
 * жить в двух копиях — они неизбежно разъезжались бы при каждой правке.
 *
 * Действия рисует владелец через слот `actions`: на странице сделки это
 * перенос даты и отмена оплаты, в предпросмотре действий нет вовсе.
 */
import { computed } from 'vue'
import { PAYMENT_STATUS_CONFIG } from '@/constants/statuses'
import { useIsDark } from '@/composables/useIsDark'
import { formatCurrency, formatDate, formatDateShortYear } from '@/utils/formatters'
import { offMonthKind, dueYearMonth, monthPrepositional, overdueDays, pluralDays } from '@/utils/paymentAttribution'
import type { Payment } from '@/types'

const props = withDefaults(
  defineProps<{
    payments: Payment[]
    /** Показывать колонку «Действия» — её содержимое даёт слот `actions`. */
    actions?: boolean
    /**
     * Ужатый вид для окна предпросмотра: без колонки «Остаток после» и без
     * словесной подписи своевременности. Полный график занимает больше
     * ширины, чем разумно отдавать модальному окну.
     */
    compact?: boolean
  }>(),
  { actions: false, compact: false },
)

const emit = defineEmits<{
  /** Клик по миниатюре скриншота оплаты — открыть его во весь экран. */
  (e: 'proof', url: string): void
  /** Клик по строке — открыть карточку платежа. */
  (e: 'select', payment: Payment): void
}>()

const { statusStyle } = useIsDark()

/**
 * Недоплаты, оставленные долгом: платёж → его строка-остаток.
 *
 * У оплаченного платежа вместо «план: 9 000» показываем «внесено из 9 000» —
 * иначе не видно, что разница не пропала, а висит отдельной строкой ниже.
 */
const shortfallByPayment = computed(() => {
  const map = new Map<string, Payment>()
  for (const p of props.payments) if (p.shortfallOfPaymentId) map.set(p.shortfallOfPaymentId, p)
  return map
})

/**
 * Строки графика с пометками для вёрстки: долг рисуется веткой своего платежа,
 * а следующий за веткой платёж отбивается чертой — иначе ветка склеивается со
 * следующим месяцем и читается как его часть.
 */
const scheduleRows = computed(() =>
  props.payments.map((p, i) => ({
    p,
    isDebt: !!p.shortfallOfPaymentId,
    beforeDebt: !p.shortfallOfPaymentId && !!props.payments[i + 1]?.shortfallOfPaymentId,
    afterDebt: !p.shortfallOfPaymentId && !!props.payments[i - 1]?.shortfallOfPaymentId,
  })),
)

/** Значок статуса — берём из общего конфига, чтобы бейджи везде совпадали. */
function statusIcon(status: Payment['status']): string | undefined {
  return PAYMENT_STATUS_CONFIG[status]?.icon
}

/**
 * На сколько дней платёж просрочен — или с какой задержкой был оплачен.
 *
 * Ожидаемый платёж здесь не считаем просроченным, даже если срок прошёл:
 * в графике сделки статус строки — единственный источник правды, и «Ожидается»
 * с красной припиской противоречило бы само себе.
 */
function daysOverdue(p: { dueDate: string; status: string; paidAt?: string | null }): number {
  if (p.status !== 'PAID' && p.status !== 'OVERDUE') return 0
  return overdueDays(p)
}

/** Подпись у строки-долга: обещание доплатить и его дата. */
function shortfallPromiseLabel(p: Payment): string {
  if (p.status !== 'PENDING' && p.status !== 'OVERDUE') return ''
  return p.shortfallPromisedDate
    ? `обещал доплатить ${formatDate(p.shortfallPromisedDate)}`
    : 'обещал доплатить, дата не указана'
}

function paymentOffMonth(p: { status: string; paidAt?: string | null; dueDate: string }): 'early' | 'late' | null {
  return offMonthKind(p)
}

function paymentOffMonthLabel(p: { paidAt?: string | null; dueDate: string }): string {
  if (!p.paidAt) return ''
  const paid = new Date(p.paidAt)
  const due = dueYearMonth(p.dueDate)
  if (!due) return ''
  const paidStr = monthPrepositional(paid.getFullYear(), paid.getMonth(), due.year)
  const dueStr = monthPrepositional(due.year, due.month, paid.getFullYear())
  return `Оплачен в ${paidStr}, а плановый срок — в ${dueStr}. Доход учтён в месяце фактической оплаты.`
}
</script>

<template>
  <div>
    <!-- Узкий контейнер (окно предпросмотра) прокручивает таблицу вбок,
         вместо того чтобы ломать слова внутри ячеек. -->
    <div class="schedule-scroll">
      <v-table density="default" class="schedule-table schedule-table--desktop">
      <thead>
        <tr>
          <th>#</th>
          <th>Дата</th>
          <th>Статус</th>
          <th>Дата оплаты</th>
          <th class="text-end">Сумма</th>
          <th v-if="!compact" class="text-end">Остаток после</th>
          <th v-if="actions" class="text-center">Действия</th>
        </tr>
      </thead>
      <tbody>
        <!-- Клик по строке открывает карточку платежа: квитанция, скриншот,
             комментарий. Кнопки действий и чекбоксы клик не пропускают. -->
        <tr
          v-for="{ p, isDebt, beforeDebt, afterDebt } in scheduleRows"
          :key="p.id"
          class="row-clickable"
          :class="{
            'row-overdue': p.status === 'OVERDUE' && !isDebt,
            'row-debt': isDebt,
            'row-before-debt': beforeDebt,
            'row-after-debt': afterDebt,
          }"
          @click="emit('select', p)"
        >
          <!-- Долг — ветка своего платежа: номер не повторяем, вместо
               него угол, и строка сдвинута вправо. -->
          <td v-if="isDebt" class="debt-branch"><span class="debt-connector" /></td>
          <td v-else class="font-weight-medium">{{ p.number }}</td>
          <td>
            <!-- Срок у долга тот же, что у платежа строкой выше, —
                 повторять дату незачем, важнее о чём договорились. -->
            <template v-if="isDebt">
              <div class="debt-title">Недоплата за платёж №{{ p.number }}</div>
              <div
                v-if="shortfallPromiseLabel(p)"
                class="shortfall-promise"
                :class="{ 'shortfall-promise--nodate': !p.shortfallPromisedDate }"
              >
                <v-icon icon="mdi-handshake-outline" size="12" />
                {{ shortfallPromiseLabel(p) }}
              </div>
              <div v-if="p.shortfallNote" class="shortfall-note">{{ p.shortfallNote }}</div>
            </template>
            <template v-else>
              {{ formatDate(p.dueDate) }}
            </template>
            <div v-if="p.rescheduledFrom" class="rescheduled-hint">
              <v-icon icon="mdi-calendar-arrow-right" size="12" />
              было {{ formatDate(p.rescheduledFrom) }}
            </div>
          </td>

          <!-- Статус и своевременность отвечают на один вопрос: пришли
               деньги или нет и в срок ли. Подпись — справа от бейджика. -->
          <td class="status-cell">
            <div class="status-line">
              <span class="pay-status" :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])">
                <v-icon v-if="statusIcon(p.status)" :icon="statusIcon(p.status)" size="14" />
                {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
              </span>
              <span v-if="p.status === 'PAID' && daysOverdue(p) > 0" class="status-note status-note--late">
                {{ isDebt ? 'доплачено' : '' }} с задержкой на {{ daysOverdue(p) }} {{ pluralDays(daysOverdue(p)) }}
              </span>
              <span v-else-if="p.status === 'PAID'" class="status-note">
                {{ isDebt ? 'доплачено вовремя' : 'вовремя' }}
              </span>
              <span v-else-if="p.status === 'OVERDUE' && daysOverdue(p) > 0" class="status-note status-note--overdue">
                на {{ daysOverdue(p) }} {{ pluralDays(daysOverdue(p)) }}
              </span>
            </div>
          </td>

          <td class="text-medium-emphasis">
            <div>{{ p.paidAt ? formatDate(p.paidAt) : '—' }}</div>
            <!-- Оплачен не в свой месяц → доход учтён по факту оплаты. -->
            <div
              v-if="paymentOffMonth(p)"
              class="offmonth-chip"
              :class="paymentOffMonth(p) === 'early' ? 'offmonth-chip--early' : 'offmonth-chip--late'"
              :title="paymentOffMonthLabel(p)"
            >
              <v-icon :icon="paymentOffMonth(p) === 'early' ? 'mdi-calendar-arrow-left' : 'mdi-calendar-arrow-right'" size="11" />
              {{ paymentOffMonth(p) === 'early' ? 'учтён по факту (досрочно)' : 'учтён по факту (позже срока)' }}
            </div>
            <div v-if="p.proofScreenshot" class="mt-1">
              <img
                :src="p.proofScreenshot"
                class="proof-thumbnail"
                title="Скриншот оплаты"
                @click="emit('proof', p.proofScreenshot!)"
              />
            </div>
          </td>

          <!-- Красной сумма долга остаётся, только пока он не доплачен. -->
          <td
            class="text-end font-weight-bold text-no-wrap"
            :class="{ 'debt-amount': isDebt && (p.status === 'PENDING' || p.status === 'OVERDUE') }"
          >
            {{ formatCurrency(p.amount) }}
            <!-- Сколько ждали по этому месяцу. Что стало с недоплатой,
                 видно в строке-ветке прямо под платежом. -->
            <div
              v-if="shortfallByPayment.get(p.id) && p.scheduledAmount != null"
              class="plan-vs-fact shortfall-paid"
            >
              внесено из {{ formatCurrency(p.scheduledAmount) }}
            </div>
            <div
              v-else-if="p.scheduledAmount != null && Math.round(p.scheduledAmount) !== Math.round(p.amount)"
              class="plan-vs-fact"
              :style="{ color: p.amount > p.scheduledAmount ? '#10b981' : '#f59e0b' }"
            >
              план: {{ formatCurrency(p.scheduledAmount) }}
            </div>
          </td>
          <td v-if="!compact" class="text-end text-medium-emphasis text-no-wrap">{{ formatCurrency(p.remainingAfter) }}</td>
          <!-- Действия перехватывают клик: перенос даты и отмена оплаты не
               должны попутно открывать карточку платежа. -->
          <td v-if="actions" class="text-center" @click.stop>
            <slot name="actions" :p="p" :is-debt="isDebt" />
          </td>
        </tr>
      </tbody>
      </v-table>
    </div>

    <!-- Узкий экран: лента. Слева значок статуса, в середине номер, срок и
         что случилось с платежом, справа деньги. Строки во всю ширину, без
         карточек — в графике десятки платежей, и карточки растягивали его на
         десятки экранов. Недоплата — ветка со сдвигом под своим платежом. -->
    <div class="sm-list">
      <div
        v-for="{ p, isDebt, afterDebt } in scheduleRows"
        :key="p.id"
        class="sm-row"
        :class="{
          'sm-row--debt': isDebt,
          'sm-row--after-debt': afterDebt,
          'sm-row--overdue': p.status === 'OVERDUE' && !isDebt,
          'sm-row--closed': p.status === 'CLOSED_EARLY',
        }"
        @click="emit('select', p)"
      >
        <div class="sm-main">
          <span class="sm-ico" :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])">
            <v-icon :icon="statusIcon(p.status) || 'mdi-circle-small'" size="16" />
          </span>

          <div class="sm-mid">
            <div class="sm-title">
              <template v-if="isDebt">Недоплата за №{{ p.number }}</template>
              <template v-else>№{{ p.number }} · {{ formatDate(p.dueDate) }}</template>
            </div>
            <div class="sm-state" :style="{ color: statusStyle(PAYMENT_STATUS_CONFIG[p.status]).color }">
              <template v-if="p.status === 'PAID' && p.paidAt">
                {{ isDebt ? 'Доплачено' : 'Оплачен' }} {{ formatDateShortYear(p.paidAt) }}
              </template>
              <template v-else>{{ PAYMENT_STATUS_CONFIG[p.status]?.label }}</template>
              <span
                v-if="daysOverdue(p) > 0"
                class="sm-late"
                :class="{ 'sm-late--overdue': p.status === 'OVERDUE' }"
              >
                · {{ p.status === 'PAID' ? 'с задержкой' : '' }} на {{ daysOverdue(p) }} {{ pluralDays(daysOverdue(p)) }}
              </span>
            </div>
            <div v-if="p.rescheduledFrom" class="rescheduled-hint">
              <v-icon icon="mdi-calendar-arrow-right" size="12" />
              было {{ formatDate(p.rescheduledFrom) }}
            </div>
            <template v-if="isDebt">
              <div
                v-if="shortfallPromiseLabel(p)"
                class="shortfall-promise"
                :class="{ 'shortfall-promise--nodate': !p.shortfallPromisedDate }"
              >
                <v-icon icon="mdi-handshake-outline" size="12" />
                {{ shortfallPromiseLabel(p) }}
              </div>
              <div v-if="p.shortfallNote" class="shortfall-note">{{ p.shortfallNote }}</div>
            </template>
            <div
              v-if="paymentOffMonth(p)"
              class="offmonth-chip"
              :class="paymentOffMonth(p) === 'early' ? 'offmonth-chip--early' : 'offmonth-chip--late'"
              :title="paymentOffMonthLabel(p)"
            >
              <v-icon :icon="paymentOffMonth(p) === 'early' ? 'mdi-calendar-arrow-left' : 'mdi-calendar-arrow-right'" size="11" />
              {{ paymentOffMonth(p) === 'early' ? 'доход учтён по факту (досрочно)' : 'доход учтён по факту (позже срока)' }}
            </div>
          </div>

          <div class="sm-money">
            <div
              class="sm-amount"
              :class="{ 'debt-amount': isDebt && (p.status === 'PENDING' || p.status === 'OVERDUE') }"
            >{{ formatCurrency(p.amount) }}</div>
            <div
              v-if="shortfallByPayment.get(p.id) && p.scheduledAmount != null"
              class="plan-vs-fact shortfall-paid"
            >
              внесено из {{ formatCurrency(p.scheduledAmount) }}
            </div>
            <div
              v-else-if="p.scheduledAmount != null && Math.round(p.scheduledAmount) !== Math.round(p.amount)"
              class="plan-vs-fact"
              :style="{ color: p.amount > p.scheduledAmount ? '#10b981' : '#f59e0b' }"
            >
              план: {{ formatCurrency(p.scheduledAmount) }}
            </div>
            <div v-if="!isDebt" class="sm-rest">ост. {{ formatCurrency(p.remainingAfter) }}</div>
            <img
              v-if="p.proofScreenshot"
              :src="p.proofScreenshot"
              class="proof-thumbnail sm-proof"
              title="Скриншот оплаты"
              @click.stop="emit('proof', p.proofScreenshot!)"
            />
          </div>

          <!-- Действия строки на телефоне — компактно справа (обычно меню «⋮»),
               если владелец дал слот mobile-actions; иначе — кнопками ниже. -->
          <div v-if="actions && $slots['mobile-actions']" class="sm-act" @click.stop>
            <slot name="mobile-actions" :p="p" :is-debt="isDebt" />
          </div>
        </div>

        <div v-if="actions && !$slots['mobile-actions']" class="sm-actions" @click.stop>
          <slot name="actions" :p="p" :is-debt="isDebt" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Schedule table */
.schedule-scroll { overflow-x: auto; }
.schedule-table :deep(td) {
  font-size: 14px;
  /* Одинаковая высота строк графика: платёж без подписей («внесено из…»,
     обещание, ветка) иначе выглядит сплющенным рядом с соседями.
     !important — высоту строки задаёт сама таблица Vuetify. */
  height: 64px !important;
  padding-top: 12px !important; padding-bottom: 12px !important;
}
.schedule-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}
/* Боковые отступы ячеек уже стандартных: колонок семь, и с крупным бейджем
   статуса таблица переставала помещаться в окно предпросмотра. */
.schedule-table :deep(td),
.schedule-table :deep(th) {
  padding-left: 10px !important;
  padding-right: 10px !important;
}
.schedule-table :deep(td:first-child),
.schedule-table :deep(th:first-child) { padding-left: 16px !important; }
.schedule-table :deep(td:last-child),
.schedule-table :deep(th:last-child) { padding-right: 16px !important; }
.row-overdue { background: rgba(239, 68, 68, 0.04); }
/* Строка кликабельна — показываем это курсором и подсветкой, иначе о карточке
   платежа никто не догадается. */
.row-clickable { cursor: pointer; }
.schedule-table :deep(tbody tr.row-clickable:hover) {
  background: rgba(var(--v-theme-primary), 0.045);
}
/* Дата и подписи под ней не переносятся по словам: «21 апреля 2026 г.» в три
   строки растягивает всю строку графика. Узкий контейнер вместо этого
   прокручивается вбок. */
.schedule-table :deep(td), .schedule-table :deep(th) { white-space: nowrap; }
/* Значок слева от подписи: статус читается ещё до чтения слова.
   Бейдж крупнее остальных подписей строки — он первое, что ищут глазами. */
.pay-status {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12.5px; font-weight: 600;
  padding: 5px 12px; border-radius: 8px; white-space: nowrap;
}

/* Долг-недоплата в графике — ветка своего платежа.
   Платёж и его недоплата читаются одним блоком: черту между ними убираем,
   её место занимает уголок-связка. Цветом не кричим: о том, что это долг,
   говорят сумма и статус, а подсветка строки только группирует. */
/* Под последней строкой линия есть всегда: без неё фон просроченной строки
   сливался с блоком под таблицей, и строка казалась заехавшей под него. */
.schedule-table :deep(tbody tr:last-child td) {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08) !important;
}
.row-before-debt :deep(td) {
  border-bottom: none !important;
  padding-top: 12px !important; padding-bottom: 12px !important;
}
.row-debt { background: rgba(var(--v-theme-on-surface), 0.022); }
.row-debt :deep(td) {
  border-bottom: none !important;
  padding-top: 10px !important; padding-bottom: 12px !important;
}
.debt-branch { position: relative; padding-right: 0 !important; }
/* Уголок рисуем линиями, а не символом «└»: символ читался как случайная
   галочка и висел не на своём месте. */
.debt-connector {
  /* Линия идёт от цифры платежа вниз и упирается ровно в середину строки
     долга: низ задан не высотой, а `bottom: 50%` — строка бывает и в одну
     подпись, и в три. */
  position: absolute; left: 19px; top: -8px; bottom: 50%;
  width: 20px;
  border-left: 2px solid rgba(var(--v-theme-on-surface), 0.22);
  border-bottom: 2px solid rgba(var(--v-theme-on-surface), 0.22);
  border-bottom-left-radius: 8px;
}
.debt-title { font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.8); }
.debt-amount { color: #dc2626; }
/* Следующий платёж после ветки отбиваем чертой — иначе он читается как
   продолжение долга, а не как новый месяц. */
.row-after-debt :deep(td) {
  border-top: 2px solid rgba(var(--v-theme-on-surface), 0.14);
}

.shortfall-promise {
  display: flex; align-items: center; gap: 4px;
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 3px;
}
.shortfall-promise--nodate { color: rgba(var(--v-theme-on-surface), 0.45); }
.shortfall-note {
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
  max-width: 260px;
  white-space: normal;
}
.shortfall-paid { color: rgba(var(--v-theme-on-surface), 0.45); }
.plan-vs-fact {
  font-size: 11px; font-weight: 500;
  margin-top: 2px; line-height: 1.2;
}

.rescheduled-hint {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: #f59e0b; margin-top: 2px;
  text-decoration: line-through;
  text-decoration-color: rgba(245, 158, 11, 0.4);
}

.status-cell { white-space: nowrap; }
.status-line { display: flex; align-items: center; gap: 8px; }
.status-note {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
/* Оплачено, но позже срока — предупреждение, а не ошибка: янтарный, не красный. */
.status-note--late { color: #d97706; font-weight: 600; }
.status-note--overdue { color: #ef4444; font-weight: 600; }
/* Тот же смысл для чипа в мобильной карточке. */
.overdue-chip--late { color: #d97706; background: rgba(217, 119, 6, 0.1); }
.overdue-chip {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 11px; font-weight: 700;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
  border-radius: 5px;
  white-space: nowrap;
}

/* «Оплачен не в свой месяц» — приглушённый чип, доход учтён по факту оплаты. */
.offmonth-chip {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10.5px; font-weight: 600;
  margin-top: 3px; padding: 1px 6px; border-radius: 6px;
  line-height: 1.3;
}
.offmonth-chip--early { color: #059669; background: rgba(16, 185, 129, 0.1); }
.offmonth-chip--late { color: #d97706; background: rgba(245, 158, 11, 0.1); }

.proof-thumbnail {
  width: 36px; height: 36px; border-radius: 6px;
  object-fit: cover; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  transition: all 0.15s;
}
.proof-thumbnail:hover { transform: scale(1.08); }

/* ───── Узкий экран: лента вместо широкой таблицы ───── */
.sm-list { display: none; }

@media (max-width: 767px) {
  .schedule-table--desktop { display: none !important; }
  .sm-list { display: block; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
}

.sm-row {
  padding: 8px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.sm-row:active { background: rgba(var(--v-theme-on-surface), 0.03); }
.sm-row--overdue { background: rgba(239, 68, 68, 0.04); }
.sm-row--closed { opacity: 0.6; }
/* Недоплата — ветка своего платежа: сдвиг и линия слева, без черты сверху. */
.sm-row--debt {
  position: relative;
  padding-left: 46px;
  margin-top: -1px;
  background: rgba(var(--v-theme-on-surface), 0.022);
}
.sm-row--debt::before {
  content: ''; position: absolute; left: 26px; top: 0; height: 50%; width: 12px;
  border-left: 2px solid rgba(var(--v-theme-on-surface), 0.2);
  border-bottom: 2px solid rgba(var(--v-theme-on-surface), 0.2);
  border-bottom-left-radius: 8px;
}
.sm-row--debt .sm-ico { display: none; }
.sm-row--after-debt { border-top: 2px solid rgba(var(--v-theme-on-surface), 0.12); }

.sm-main { display: flex; align-items: center; gap: 10px; }
.sm-ico {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.sm-ico .v-icon { font-size: 14px !important; }
.sm-mid { flex: 1; min-width: 0; }
.sm-title {
  font-size: 13.5px; font-weight: 600; line-height: 1.3;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.sm-state { font-size: 12px; font-weight: 500; margin-top: 1px; line-height: 1.3; }
.sm-late { color: #d97706; font-weight: 600; }
.sm-late--overdue { color: #dc2626; }
.sm-money { flex-shrink: 0; text-align: right; display: flex; flex-direction: column; align-items: flex-end; }
.sm-amount {
  font-size: 14px; font-weight: 700; line-height: 1.3;
  color: rgba(var(--v-theme-on-surface), 0.92); font-variant-numeric: tabular-nums;
}
.sm-rest {
  font-size: 11.5px; margin-top: 1px;
  color: rgba(var(--v-theme-on-surface), 0.45); font-variant-numeric: tabular-nums;
}
.sm-proof { width: 28px; height: 28px; margin-top: 4px; }
.sm-mid .rescheduled-hint, .sm-mid .shortfall-promise, .sm-mid .offmonth-chip { margin-top: 3px; }
/* Кнопки приходят слотом из родителя — до них достаёт только :deep. */
.sm-actions {
  display: flex; gap: 6px; flex-wrap: wrap;
  margin: 6px 0 2px 32px;
}
.sm-actions:empty { display: none; }
.sm-act { flex-shrink: 0; margin-right: -10px; }
.sm-act:empty { display: none; }
.sm-actions :deep(.action-btn) {
  flex: 1 1 auto; width: auto; height: 32px;
  padding: 0 12px; gap: 6px;
  font-size: 13px; font-weight: 500;
}
</style>
