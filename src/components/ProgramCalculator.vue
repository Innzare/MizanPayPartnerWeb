<script setup lang="ts">
/**
 * Калькулятор тарифа — проверка условий на живых суммах.
 *
 * Стоит в карточке тарифа: таблица «6 платежей — 20%» не отвечает на вопрос, с
 * которым партнёр сюда приходит — «что получит клиент за телефон в 60 000 с
 * взносом в 10 000». Здесь он вводит эти три числа и видит ответ.
 *
 * Считает общая функция `quoteProgram` — та же цепочка, что в форме сделки и на
 * сервере. Расходиться калькулятору и оформлению нельзя: партнёр показывает эти
 * цифры клиенту.
 *
 * Разметка держит постоянную высоту: подписи и подстрочники стоят всегда, даже
 * когда им нечего показать. Иначе ввод суммы дёргает всю карточку.
 *
 * Живёт на зелёной карточке тарифа, поэтому оформление светлое по прозрачному —
 * своей подложки компонент не рисует.
 */
import { computed, ref, watch } from 'vue'
import { CURRENCY_MASK, formatCurrency, formatDate, formatDateShort, parseMasked } from '@/utils/formatters'
import { useToast } from '@/composables/useToast'
import { downloadBlob, renderQuoteImage } from '@/utils/quoteImage'
import SelectField from '@/components/SelectField.vue'
import { availableTerms, type ProgramRule } from '@/utils/programMath'
import { quoteProgram, type QuoteProgram } from '@/utils/programQuote'
import CardDisclosure from '@/components/CardDisclosure.vue'

const props = defineProps<{
  program: QuoteProgram & {
    paymentInterval: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'
    defaultDownPaymentPercent?: number | null
    minAmount?: number | null
    rules: ProgramRule[]
  }
  /** Заголовок картинки с расчётом: «Тариф „Стандарт“». */
  title?: string
  /** Подпись под заголовком: «от компании „Мизан“». */
  seller?: string
}>()

const toast = useToast()

/**
 * Стоимость для проверки. Начинаем с нижней границы тарифа, если она задана:
 * по тарифу «от 300 000» проверка на 100 000 не дала бы ни одного условия.
 */
const price = ref(Math.max(props.program.minAmount ?? 0, 100000))
const downPayment = ref(0)
const term = ref(0)

/** Сроки, которые тариф допускает для такой стоимости. */
const terms = computed(() => availableTerms(props.program.rules, price.value || 0))

/**
 * Сроки для списка: подпись сразу с «платежами», иначе голое число в
 * свёрнутом селекте читается как что угодно.
 */
const termOptions = computed(() =>
  terms.value.map((t) => ({
    value: String(t),
    label: `${t} ${plural(t, 'платёж', 'платежа', 'платежей')}`,
  })),
)

/** Селект работает со строками, срок внутри — число. */
const termValue = computed({
  get: () => (term.value ? String(term.value) : null),
  set: (v: string | null) => {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) term.value = n
  },
})

/** Срок держим в пределах доступных: сменилась цена — список мог стать другим. */
watch(
  terms,
  (list) => {
    if (!list.length) return
    if (!list.includes(term.value)) term.value = list.includes(6) ? 6 : list[0]!
  },
  { immediate: true },
)

/**
 * Взнос по умолчанию подставляем один раз — как в форме сделки, чтобы партнёр
 * сразу видел тариф в его обычном режиме, а не «без взноса».
 */
const defaultDown = props.program.defaultDownPaymentPercent
if (defaultDown) downPayment.value = Math.round((price.value * defaultDown) / 100)

watch(price, (p) => {
  if (downPayment.value > p) downPayment.value = p
})

/**
 * Ползунок взноса.
 *
 * Стоит отдельной строкой постоянной высоты под обоими полями: раньше он жил
 * внутри поля взноса и делал вторую колонку выше первой — от этого карточку и
 * дёргало. Шаг подбираем под масштаб цены: 1000 ₽ на товаре за 15 000 — грубо.
 */
const downStep = computed(() => {
  const p = price.value || 0
  if (p <= 20000) return 100
  if (p <= 100000) return 500
  return 1000
})

/** Залитая часть дорожки — обычным градиентом, доли процента здесь не нужны. */
const fillPercent = computed(() => {
  const p = price.value || 0
  if (!(p > 0)) return 0
  return Math.min(100, Math.max(0, (downPayment.value / p) * 100))
})

const quote = computed(() => quoteProgram(props.program, price.value, term.value, downPayment.value))

/**
 * График платежей — как на странице сделки: строка на платёж, сумма и остаток.
 *
 * Столбики показывали форму рассрочки, но не отвечали на вопрос «сколько
 * останется после третьего платежа». Партнёр читает этот график клиенту, и
 * привычнее он в том же виде, что в самой сделке.
 */
const scheduleRows = computed(() => {
  const q = quote.value
  if (!q || term.value <= 0) return null

  const start = new Date()
  const dateOf = (i: number) => {
    const d = new Date(start)
    if (props.program.paymentInterval === 'WEEKLY') d.setDate(d.getDate() + 7 * i)
    else if (props.program.paymentInterval === 'BIWEEKLY') d.setDate(d.getDate() + 14 * i)
    else d.setMonth(d.getMonth() + i)
    return d
  }

  const rows: {
    label: string
    date: string
    amount: string
    left: string
    down: boolean
  }[] = []

  let left = q.total
  if (q.downPayment > 0) {
    left -= q.downPayment
    rows.push({
      label: '—',
      date: 'в день сделки',
      amount: formatCurrency(q.downPayment),
      left: formatCurrency(left),
      down: true,
    })
  }
  for (let i = 1; i <= term.value; i++) {
    const amount = i === term.value ? q.last : q.regular
    left = Math.max(0, left - amount)
    rows.push({
      label: String(i),
      date: formatDateShort(dateOf(i)),
      amount: formatCurrency(amount),
      left: left > 0 ? formatCurrency(left) : '—',
      down: false,
    })
  }
  return rows
})

/** «Ежемесячный платёж» у недельного тарифа был бы неправдой. */
const paymentTitle = computed(() =>
  props.program.paymentInterval === 'WEEKLY'
    ? 'Еженедельный платёж'
    : props.program.paymentInterval === 'BIWEEKLY'
      ? 'Платёж раз в две недели'
      : 'Ежемесячный платёж',
)

/** Подстрочник под платежом — стоит всегда, чтобы блок не менял высоту. */
const paymentNote = computed(() => {
  const q = quote.value
  if (!q) return '—'
  const parts = [`${term.value} ${plural(term.value, 'платёж', 'платежа', 'платежей')}`]
  if (q.lastDiffers) parts.push(`последний ${formatCurrency(q.last)}`)
  return parts.join(' · ')
})

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/**
 * Доля взноса — рядом с полем, чтобы процент не приходилось считать в уме.
 *
 * Когда взнос подтянут до минимума тарифа, доля молчит: в поле стоит одно
 * число, а процент был бы посчитан от другого — это читалось как ошибка.
 * Про подъём говорит подсказка под расчётом.
 */
const downShare = computed(() => {
  const q = quote.value
  if (!q || q.downPayment <= 0 || q.downPaymentRaised) return ''
  return `${Math.round(q.downPercent)}% от цены договора`
})

/**
 * Картинка с расчётом — её партнёр отправляет клиенту в переписке.
 *
 * Собирается из того же расчёта, что показан в карточке: клиенту уходит ровно
 * то, что продавец видит перед собой.
 */
const savingImage = ref(false)

async function saveImage() {
  const q = quote.value
  if (!q || savingImage.value) return
  savingImage.value = true
  try {
    const blob = await renderQuoteImage({
      title: props.title || 'Расчёт рассрочки',
      seller: props.seller,
      paymentTitle: paymentTitle.value,
      payment: formatCurrency(q.regular),
      paymentNote: paymentNote.value,
      facts: [
        { label: 'Цена товара', value: formatCurrency(price.value) },
        {
          label: 'Первый взнос',
          value: q.downPayment ? formatCurrency(q.downPayment) : 'без взноса',
        },
        { label: 'Цена договора', value: formatCurrency(q.total) },
        {
          label: 'Переплата клиента',
          value: `${formatCurrency(q.overpay)} · ${q.overpayPercent}%`,
        },
      ],
      rows: scheduleRows.value ?? [],
      footer: `Предварительный расчёт от ${formatDate(new Date())}. Точные условия — в договоре.`,
    })
    // В имени файла недопустимы слеши и двоеточия — иначе браузер молча
    // сохранит его как «download».
    const name = `Рассрочка ${formatCurrency(price.value)} ${term.value} платежей.png`.replace(
      /[/\\?%*:|"<>]/g,
      '-',
    )
    downloadBlob(blob, name)
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить картинку')
  } finally {
    savingImage.value = false
  }
}

const markupLabel = computed(() => {
  const q = quote.value
  if (!q) return '—'
  return `${Math.round(q.markupPercent * 10) / 10}%`
})
</script>

<template>
  <div class="pc">
    <div class="pc-controls">
      <div class="pc-field">
        <div class="pc-label">
          <span>Цена товара</span>
        </div>
        <div class="pc-input-wrap">
          <input
            :value="price"
            v-maska="CURRENCY_MASK"
            class="pc-input"
            inputmode="numeric"
            @maska="(e: any) => (price = parseMasked(e) ?? 0)"
          />
          <!-- Крестик появляется только при набранном значении: пустое поле
               очищать нечего, а место под него занято всегда. -->
          <button v-if="price" class="pc-clear" title="Очистить" @click="price = 0">
            <v-icon icon="mdi-close" size="13" />
          </button>
          <span class="pc-input-cur">₽</span>
        </div>
      </div>

      <div class="pc-field">
        <div class="pc-label">
          <span>Первый взнос</span>
          <!-- Место под долю занято всегда: появляющаяся строка дёргала бы поля. -->
          <span class="pc-label-note">{{ downShare }}</span>
        </div>
        <div class="pc-input-wrap">
          <input
            :value="downPayment"
            v-maska="CURRENCY_MASK"
            class="pc-input"
            inputmode="numeric"
            @maska="(e: any) => (downPayment = parseMasked(e) ?? 0)"
          />
          <button v-if="downPayment" class="pc-clear" title="Очистить" @click="downPayment = 0">
            <v-icon icon="mdi-close" size="13" />
          </button>
          <span class="pc-input-cur">₽</span>
        </div>
      </div>
    </div>

    <!-- Ползунок отдельной строкой во всю ширину: внутри поля он делал колонку
         выше соседней и дёргал карточку при каждом движении. -->
    <div class="pc-slider">
      <input
        v-model.number="downPayment"
        type="range"
        min="0"
        :max="price || 0"
        :step="downStep"
        class="pc-range"
        :style="{ '--fill': `${fillPercent}%` }"
        aria-label="Первый взнос"
      />
      <div class="pc-slider-ends">
        <span>без взноса</span>
        <span>{{ formatCurrency(price || 0) }}</span>
      </div>
    </div>

    <!-- Срок списком, а не рядом кнопок: тариф на двенадцать сроков
         разворачивал в карточке две строки плашек, и выбранную среди них
         приходилось выискивать. -->
    <div v-if="terms.length" class="pc-pick">
      <div class="pc-label"><span>Срок</span></div>
      <SelectField v-model="termValue" :options="termOptions" placeholder="Выберите срок" />
    </div>

    <div v-if="quote" class="pc-result">
      <!-- Картинка с расчётом — иконкой в углу: действие нечастое, и место
           крупной кнопки лучше отдать самим цифрам. -->
      <button
        class="pc-save"
        :disabled="savingImage"
        title="Сохранить расчёт картинкой"
        @click="saveImage"
      >
        <v-icon v-if="savingImage" icon="mdi-timer-sand" size="19" />
        <!-- Обычная иконка изображения плюс стрелка в углу: скачивается
             картинка, и это должно читаться с первого взгляда. -->
        <span v-else class="pc-save-ico">
          <v-icon icon="mdi-image-outline" size="21" />
          <v-icon class="pc-save-ico-arrow" icon="mdi-arrow-down-bold" size="11" />
        </span>
      </button>

      <div class="pc-total">
        <span class="pc-total-label">{{ paymentTitle }}</span>
        <span class="pc-total-value">{{ formatCurrency(quote.regular) }}</span>
        <span class="pc-total-note">{{ paymentNote }}</span>
      </div>

      <dl class="pc-rows">
        <div class="pc-row">
          <dt><v-icon class="pc-row-ico" icon="mdi-file-document-outline" size="15" />Цена договора</dt>
          <dd>{{ formatCurrency(quote.total) }}</dd>
        </div>
        <div class="pc-row">
          <dt><v-icon class="pc-row-ico" icon="mdi-wallet-outline" size="15" />Первый взнос</dt>
          <dd>{{ quote.downPayment ? formatCurrency(quote.downPayment) : 'без взноса' }}</dd>
        </div>
        <div class="pc-row">
          <dt><v-icon class="pc-row-ico" icon="mdi-percent-outline" size="15" />Наценка</dt>
          <dd>{{ markupLabel }}</dd>
        </div>
        <div class="pc-row">
          <dt><v-icon class="pc-row-ico" icon="mdi-cash-plus" size="15" />Переплата клиента</dt>
          <dd>{{ formatCurrency(quote.overpay) }} <span class="pc-row-sub">{{ quote.overpayPercent }}%</span></dd>
        </div>
      </dl>

      <!-- Почему цифра именно такая: молчаливая правка ввода выглядит как
           ошибка калькулятора. -->
      <p v-if="quote.downPaymentRaised" class="pc-hint">
        Тариф требует взнос не меньше {{ formatCurrency(quote.minDownPayment) }} — посчитано по нему.
      </p>
    </div>

    <!-- График живёт отдельным сворачиваемым блоком, а не внутри тёмной
         плашки расчёта: раскрытый, он занимает больше места, чем всё
         остальное в карточке. -->
    <CardDisclosure
      v-if="quote && scheduleRows"
      title="График платежей"
      icon="mdi-calendar-check-outline"
      :note="`итого ${formatCurrency(quote.total)}`"
    >
      <div class="pc-sched-wrap">
        <table class="pc-sched-tbl">
          <thead>
            <tr>
              <th>№</th>
              <th>Дата</th>
              <th class="pc-sched-num">Платёж</th>
              <th class="pc-sched-num">Остаток</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in scheduleRows" :key="i" :class="{ 'pc-sched-row--down': r.down }">
              <td>{{ r.down ? 'взнос' : r.label }}</td>
              <td>{{ r.date }}</td>
              <td class="pc-sched-num">{{ r.amount }}</td>
              <td class="pc-sched-num">{{ r.left }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </CardDisclosure>

    <div v-else class="pc-result pc-result--empty">
      <template v-if="!terms.length">
        Для товара такой стоимости условий в тарифе нет — продавец не сможет выбрать
        этот тариф при оформлении.
      </template>
      <template v-else>Укажите стоимость товара, чтобы увидеть условия.</template>
    </div>
  </div>
</template>

<style scoped>
.pc { margin-top: 16px; }

/* Поля друг под другом во всю ширину: суммы тут длинные, и в две колонки они
   жались, хотя место есть. */
.pc-controls { display: flex; flex-direction: column; gap: 10px; }
.pc-field { min-width: 0; }

/* Высота подписи фиксирована: доля взноса появляется и исчезает, но строка
   остаётся на месте — поля под ней не двигаются. */
.pc-label {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  height: 16px; margin-bottom: 6px; overflow: hidden;
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}
.pc-label-note {
  font-size: 10.5px; font-weight: 600; letter-spacing: 0; text-transform: none;
  white-space: nowrap; color: rgba(255, 255, 255, 0.62);
}

.pc-input-wrap { position: relative; }
.pc-input {
  width: 100%; height: 42px; padding: 0 52px 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 10px;
  background: rgba(255, 255, 255, 0.1); color: #fff;
  font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums;
  outline: none; transition: border-color 0.15s, background 0.15s;
}
.pc-input:hover { border-color: rgba(255, 255, 255, 0.3); }
.pc-input:focus { border-color: rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.16); }
.pc-input-cur {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  font-size: 13px; color: rgba(255, 255, 255, 0.55); pointer-events: none;
}
.pc-clear {
  position: absolute; right: 30px; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border: none; border-radius: 50%;
  background: rgba(255, 255, 255, 0.16); color: #fff; cursor: pointer;
}
.pc-clear:hover { background: rgba(255, 255, 255, 0.32); }

/* Ползунок: постоянная высота строки и дорожка, залитая до текущего взноса.
   Браузерную отрисовку не используем — на зелёном она уходит в бордовый. */
.pc-slider { height: 40px; margin-top: 10px; }
.pc-range {
  display: block; width: 100%; height: 20px; margin: 0;
  background: transparent; cursor: pointer;
  -webkit-appearance: none; appearance: none;
}
.pc-range::-webkit-slider-runnable-track {
  height: 6px; border-radius: 99px;
  background: linear-gradient(
    to right,
    #fff 0, #fff var(--fill),
    rgba(255, 255, 255, 0.22) var(--fill), rgba(255, 255, 255, 0.22) 100%
  );
}
.pc-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 18px; height: 18px; margin-top: -6px; border: none; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
.pc-range::-moz-range-track { height: 6px; border-radius: 99px; background: rgba(255, 255, 255, 0.22); }
.pc-range::-moz-range-progress { height: 6px; border-radius: 99px; background: #fff; }
.pc-range::-moz-range-thumb {
  width: 18px; height: 18px; border: none; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
.pc-range:focus-visible::-webkit-slider-thumb { outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 2px; }
.pc-slider-ends {
  display: flex; justify-content: space-between; gap: 12px; margin-top: 2px;
  font-size: 11px; color: rgba(255, 255, 255, 0.5); font-variant-numeric: tabular-nums;
}

.pc-pick { min-width: 0; margin-top: 12px; }
/* Селект сервиса светлый по умолчанию — на тёмной карточке он одевается
   как соседние поля: та же полупрозрачная заливка и белый текст. Список
   рисуется вне карточки и остаётся обычным. */
.pc-pick :deep(.sf-btn) {
  height: 42px; border-radius: 10px;
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.1);
  color: #fff; font-size: 14px; font-weight: 600;
}
.pc-pick :deep(.sf-btn:hover:not(:disabled)) { border-color: rgba(255, 255, 255, 0.3); }
.pc-pick :deep(.sf-btn--open) {
  border-color: rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.16);
}
.pc-pick :deep(.sf-chev) { color: rgba(255, 255, 255, 0.6); }
.pc-pick :deep(.sf-label--dim) { color: rgba(255, 255, 255, 0.55); }

.pc-result {
  position: relative;
  margin-top: 14px; padding: 14px; border-radius: 12px;
  background: rgba(0, 0, 0, 0.18);
}
.pc-result--empty { font-size: 12.5px; line-height: 1.5; color: rgba(255, 255, 255, 0.7); }

.pc-total {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding-bottom: 13px; margin-bottom: 3px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}
.pc-total-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}
.pc-total-value {
  font-size: 30px; font-weight: 800; line-height: 1.1; letter-spacing: -0.6px;
  font-variant-numeric: tabular-nums;
}
.pc-total-note { font-size: 12px; color: rgba(255, 255, 255, 0.6); }

.pc-rows { margin: 0; }
.pc-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.pc-row:last-child { border-bottom: none; padding-bottom: 0; }
.pc-row dt {
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; color: rgba(255, 255, 255, 0.65);
}
/* Иконка — метка строки, а не акцент: тише подписи, чтобы взгляд шёл к цифре. */
.pc-row-ico { color: rgba(255, 255, 255, 0.4); flex: none; }
.pc-row dd {
  margin: 0; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pc-row-sub { font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.55); margin-left: 4px; }

/* График платежей таблицей — тот же вид, что на странице сделки.
   Прокрутки и липкой шапки нет: блок и так раскрывается по кнопке, а полоса
   фона под заголовками резала таблицу пополам. */
.pc-sched-tbl { width: 100%; border-collapse: collapse; }
.pc-sched-tbl th {
  padding: 0 10px 7px; text-align: left; white-space: nowrap;
  font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
}
/* Заголовок числовой колонки — вправо, ровно над своими значениями. Без этого
   правила его перебивает `text-align: left` у самого th. */
.pc-sched-tbl th.pc-sched-num { text-align: right; }
.pc-sched-tbl td {
  padding: 7px 10px; font-size: 12.5px; color: rgba(255, 255, 255, 0.85);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.pc-sched-tbl tbody tr:last-child td { border-bottom: none; padding-bottom: 0; }
/* Колонка номера — узкая и постоянной ширины, чтобы даты шли ровным столбцом. */
.pc-sched-tbl th:first-child, .pc-sched-tbl td:first-child { padding-left: 0; width: 46px; }
.pc-sched-tbl th:last-child, .pc-sched-tbl td:last-child { padding-right: 0; }
.pc-sched-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
/* Взнос платится в день сделки, а не по графику — выделяем строку. */
.pc-sched-row--down td { color: #fff; font-weight: 600; }
.pc-sched-row--down td:first-child {
  font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
}

.pc-save {
  position: absolute; top: 10px; right: 10px;
  display: flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.85);
  cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.pc-save:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.24); border-color: rgba(255, 255, 255, 0.35); color: #fff;
}
.pc-save:disabled { opacity: 0.6; cursor: default; }
/* Стрелка сидит в правом нижнем углу кнопки, за рамкой картинки, — так она
   не перекрывает рисунок и не требует подложки под себя. */
.pc-save-ico { position: relative; display: inline-flex; }
.pc-save-ico-arrow { position: absolute; right: -6px; bottom: -5px; }

.pc-hint {
  margin: 10px 0 0; font-size: 11.5px; line-height: 1.45;
  color: rgba(255, 255, 255, 0.62);
}

@media (max-width: 560px) {
  .pc-sched-tbl th, .pc-sched-tbl td { padding-left: 6px; padding-right: 6px; font-size: 12px; }
}
</style>
