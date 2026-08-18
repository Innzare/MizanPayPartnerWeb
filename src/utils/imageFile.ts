/**
 * Подготовка картинки для конструктора договора.
 *
 * Шаблон хранится как HTML-строка в БД, а картинки внутри него — base64. Поэтому
 * фото с телефона (4000px, 5 МБ) сначала ужимается: иначе шаблон раздувается,
 * сохранение подвисает, а html2canvas при экспорте PDF рисует его вечность.
 */

export interface PreparedImage {
  /** data:URL, готовый для вставки в документ */
  src: string
  /** размер после сжатия, px */
  width: number
  height: number
}

const MAX_SIDE = 1600

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Не удалось открыть изображение'))
    img.src = src
  })
}

export async function prepareImageFile(file: File): Promise<PreparedImage> {
  const dataUrl = await readAsDataUrl(file)

  // SVG масштабируется без потерь — перерисовывать в canvas нельзя, испортим.
  if (file.type === 'image/svg+xml') {
    const img = await loadImage(dataUrl).catch(() => null)
    return { src: dataUrl, width: img?.naturalWidth || 300, height: img?.naturalHeight || 300 }
  }

  const img = await loadImage(dataUrl)
  const w = img.naturalWidth || 1
  const h = img.naturalHeight || 1
  const ratio = Math.min(1, MAX_SIDE / Math.max(w, h))

  // Мелкие картинки не трогаем: пережатие только испортит логотип.
  if (ratio >= 1) return { src: dataUrl, width: w, height: h }

  const outW = Math.round(w * ratio)
  const outH = Math.round(h * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return { src: dataUrl, width: w, height: h }
  ctx.drawImage(img, 0, 0, outW, outH)

  // PNG/WebP могут быть с прозрачностью (печати, подписи) — их держим в PNG.
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif'
  const src = keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9)
  return { src, width: outW, height: outH }
}
