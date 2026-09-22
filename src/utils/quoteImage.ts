/**
 * Картинка с расчётом рассрочки — то, что партнёр отправляет клиенту.
 *
 * Рисуем макет сами, а не снимаем экран: в снимке остались бы поля ввода,
 * ползунок и кнопки, а клиенту нужен чистый расчёт — платёж, условия и график.
 * Заодно картинка не зависит от того, как выглядит интерфейс сегодня.
 *
 * Размеры здесь в «логических» точках, а холст делается вдвое крупнее: иначе
 * текст на телефоне выглядит замыленным.
 */

export interface QuoteImageRow {
  label: string
  date: string
  amount: string
  left: string
  down: boolean
}

export interface QuoteImageInput {
  /** «Тариф „Стандарт“» — заголовок картинки. */
  title: string
  /** «от компании „Мизан“» — подпись под заголовком, может быть пустой. */
  seller?: string
  /** Заголовок крупной суммы: «Ежемесячный платёж». */
  paymentTitle: string
  payment: string
  /** «6 платежей · последний 17 500 ₽». */
  paymentNote: string
  facts: { label: string; value: string }[]
  rows: QuoteImageRow[]
  /** Нижняя строка: дата расчёта и оговорка. */
  footer: string
}

const W = 900
const PAD = 48

/**
 * Плотность картинки.
 *
 * Макет считается в условных 900 точках ширины, а холст заводится во столько
 * раз крупнее — от этого зависит, останется ли картинка чёткой при печати и
 * на телефоне с плотным экраном. Раньше множитель был жёстко равен двум
 * (1800 px по ширине); берём столько, сколько потянет браузер.
 *
 * Потолок не абстрактный: холст сверх лимитов у Safari молча превращается в
 * пустой, поэтому ограничиваем и сторону, и общую площадь, а при неудаче
 * спускаемся на ступень ниже (см. `renderQuoteImage`).
 */
const SCALE_STEPS = [4, 3, 2] as const
const MAX_SIDE = 8192
const MAX_AREA = 40_000_000

/** Наибольшая плотность, при которой холст остаётся в пределах лимитов. */
function scalesFor(height: number): number[] {
  const fits = (k: number) =>
    W * k <= MAX_SIDE && height * k <= MAX_SIDE && W * k * height * k <= MAX_AREA
  const usable = SCALE_STEPS.filter(fits)
  // Совсем длинный график не влезает даже в двойной масштаб — рисуем как есть:
  // лучше картинка попроще, чем ошибка вместо неё.
  return usable.length ? usable : [2]
}

const INK = '#ffffff'
const INK_SOFT = 'rgba(255, 255, 255, 0.62)'
const INK_FAINT = 'rgba(255, 255, 255, 0.4)'
const LINE = 'rgba(255, 255, 255, 0.14)'
const GREEN_DEEP = '#065f46'

/** Скругление: `roundRect` есть не везде, а прямые углы ломают весь вид. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  if (typeof (ctx as any).roundRect === 'function') {
    ;(ctx as any).roundRect(x, y, w, h, r)
    return
  }
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fontFamily(): string {
  const body = getComputedStyle(document.body).fontFamily
  return body || 'system-ui, sans-serif'
}

/** Сколько места займёт картинка: считаем до того, как заводить холст. */
function layout(input: QuoteImageInput) {
  const headH = input.seller ? 130 : 104
  const payH = 150
  const factRows = Math.ceil(input.facts.length / 2)
  const factsH = factRows * 76 + (factRows - 1) * 10
  // 34 — подпись «График платежей», 40 — шапка таблицы, по 40 на строку.
  const tableH = input.rows.length ? 34 + 40 + input.rows.length * 40 + 24 : 0
  // Подпись занимает одну строку: больше запаса — и внизу зияет пустая полоса.
  const footH = 34
  return {
    headH,
    payH,
    factsH,
    tableH,
    footH,
    height: PAD + headH + payH + 20 + factsH + (tableH ? 40 + tableH : 0) + footH + PAD,
  }
}

export async function renderQuoteImage(input: QuoteImageInput): Promise<Blob> {
  // Без этого первый вызов рисует запасным шрифтом: макет «прыгает» по ширине.
  if (document.fonts?.ready) await document.fonts.ready

  const L = layout(input)
  const scales = scalesFor(L.height)
  let lastError: unknown = null

  for (const scale of scales) {
    try {
      return await drawQuote(input, L, scale)
    } catch (e) {
      // Лимит холста у каждого браузера свой и заранее не спрашивается:
      // единственный надёжный способ узнать — попробовать и отступить.
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Не удалось сохранить картинку')
}

async function drawQuote(
  input: QuoteImageInput,
  L: ReturnType<typeof layout>,
  SCALE: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(W * SCALE)
  canvas.height = Math.round(L.height * SCALE)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не удалось подготовить картинку')
  ctx.scale(SCALE, SCALE)

  const ff = fontFamily()
  const font = (size: number, weight = 400) => `${weight} ${size}px ${ff}`

  // ── фон ──
  const bg = ctx.createLinearGradient(0, 0, W, L.height)
  bg.addColorStop(0, '#047857')
  bg.addColorStop(0.55, '#065f46')
  bg.addColorStop(1, '#064e3b')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, L.height)

  let y = PAD

  // ── шапка ──
  ctx.fillStyle = INK_FAINT
  ctx.font = font(15, 700)
  ctx.fillText('РАСЧЁТ РАССРОЧКИ', PAD, y + 15)

  ctx.fillStyle = INK
  ctx.font = font(38, 700)
  ctx.fillText(input.title, PAD, y + 66)

  if (input.seller) {
    ctx.fillStyle = INK_SOFT
    ctx.font = font(18)
    ctx.fillText(input.seller, PAD, y + 100)
  }
  y += L.headH

  // ── крупная сумма платежа ──
  roundRect(ctx, PAD, y, W - PAD * 2, L.payH, 20)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  ctx.textAlign = 'center'
  const cx = W / 2
  ctx.fillStyle = 'rgba(6, 95, 70, 0.65)'
  ctx.font = font(15, 700)
  ctx.fillText(input.paymentTitle.toUpperCase(), cx, y + 42)

  ctx.fillStyle = GREEN_DEEP
  ctx.font = font(54, 800)
  ctx.fillText(input.payment, cx, y + 102)

  ctx.fillStyle = 'rgba(6, 95, 70, 0.7)'
  ctx.font = font(17)
  ctx.fillText(input.paymentNote, cx, y + 130)
  ctx.textAlign = 'left'
  y += L.payH + 20

  // ── плитки с условиями ──
  const colW = (W - PAD * 2 - 10) / 2
  input.facts.forEach((fact, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = PAD + col * (colW + 10)
    const ty = y + row * 86

    roundRect(ctx, x, ty, colW, 76, 14)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.fill()

    ctx.fillStyle = INK_SOFT
    ctx.font = font(14)
    ctx.fillText(fact.label, x + 18, ty + 30)

    ctx.fillStyle = INK
    ctx.font = font(24, 700)
    ctx.fillText(fact.value, x + 18, ty + 60)
  })
  y += L.factsH

  // ── график платежей ──
  if (input.rows.length) {
    y += 40
    const right = W - PAD

    ctx.fillStyle = INK
    ctx.font = font(20, 700)
    ctx.fillText('График платежей', PAD, y)
    y += 34
    const colAmount = right - 190
    const colDate = PAD + 90

    ctx.fillStyle = INK_FAINT
    ctx.font = font(13, 700)
    ctx.fillText('№', PAD, y)
    ctx.fillText('ДАТА', colDate, y)
    ctx.textAlign = 'right'
    ctx.fillText('ПЛАТЁЖ', colAmount, y)
    ctx.fillText('ОСТАТОК', right, y)
    ctx.textAlign = 'left'

    y += 14
    ctx.strokeStyle = LINE
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD, y + 0.5)
    ctx.lineTo(right, y + 0.5)
    ctx.stroke()

    for (const row of input.rows) {
      y += 40
      const baseline = y - 12

      ctx.fillStyle = row.down ? INK : 'rgba(255, 255, 255, 0.86)'
      ctx.font = font(row.down ? 14 : 17, row.down ? 700 : 400)
      ctx.fillText(row.down ? 'ВЗНОС' : row.label, PAD, baseline)

      ctx.font = font(17, row.down ? 600 : 400)
      ctx.fillText(row.date, colDate, baseline)

      ctx.textAlign = 'right'
      ctx.font = font(17, row.down ? 700 : 600)
      ctx.fillText(row.amount, colAmount, baseline)
      ctx.fillStyle = row.down ? INK : INK_SOFT
      ctx.font = font(17)
      ctx.fillText(row.left, right, baseline)
      ctx.textAlign = 'left'

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)'
      ctx.beginPath()
      ctx.moveTo(PAD, y + 0.5)
      ctx.lineTo(right, y + 0.5)
      ctx.stroke()
    }
    y += 24
  }

  // ── подпись ──
  ctx.fillStyle = INK_FAINT
  ctx.font = font(14)
  ctx.fillText(input.footer, PAD, y + 24)

  // Проверка, что холст действительно нарисован: при превышении лимита память
  // под него не выделяется, и вместо картинки уходит прозрачный прямоугольник
  // без единой ошибки. Левый верхний угол занят фоном — он не может быть пуст.
  const probe = ctx.getImageData(2, 2, 1, 1).data
  if (!probe[3]) throw new Error('Холст не отрисован: слишком большой размер')

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось сохранить картинку'))),
      'image/png',
    )
  })
}

/** Отдать картинку пользователю файлом. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Освобождаем не сразу: Safari не успевает начать скачивание.
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
