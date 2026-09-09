/**
 * Бланк квитанции — общий для всех мест, где её печатают.
 *
 * Квитанцию выдают из четырёх разных экранов, и если бы каждый грузил бланк
 * сам, партнёр видел бы свои настройки в одних местах и стандартный вид в
 * других. Загружается один раз за сеанс: бланк меняют раз в год, а печатают
 * десятки раз в день.
 */
import { ref } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { ReceiptTemplate } from '@/utils/receiptPdf'

/** Ответ сервера: `exists` говорит, настраивал ли партнёр бланк вообще. */
type TemplateResponse = ReceiptTemplate & { exists?: boolean }

const template = ref<ReceiptTemplate | null>(null)
/**
 * Чей бланк лежит в кэше.
 *
 * Кэш живёт в модуле и переживает смену пользователя без перезагрузки
 * страницы. Без этой проверки партнёр, вошедший вторым в том же окне, напечатал
 * бы клиенту чужие реквизиты для перевода — деньги ушли бы не туда.
 */
const cachedFor = ref<string | null>(null)
let loading: Promise<ReceiptTemplate | null> | null = null

export function useReceiptTemplate() {
  const auth = useAuthStore()

  async function fetchTemplate(ownerId: string | null): Promise<ReceiptTemplate | null> {
    try {
      const res = await api.getSilent<TemplateResponse>('/receipt-template')
      // Партнёр ничего не настраивал — печатаем стандартный бланк. Сервер
      // подставляет в ответ имя и телефон из профиля для формы редактора, но
      // это не значит, что их нужно печатать на квитанции.
      const value = res && res.exists ? res : null
      template.value = value
      cachedFor.value = ownerId
      return value
    } catch {
      // Бланк — оформление, а не условие печати: не загрузился, печатаем
      // стандартный. Клиент своей квитанции дождётся в любом случае.
      return null
    }
  }

  /** Бланк для печати. Ждёт загрузку, если она ещё идёт. */
  async function getTemplate(): Promise<ReceiptTemplate | null> {
    const ownerId = auth.user?.id ?? null
    if (cachedFor.value !== ownerId) invalidate()
    if (template.value) return template.value
    if (!loading) {
      loading = fetchTemplate(ownerId).finally(() => {
        loading = null
      })
    }
    return loading
  }

  /** Сбросить кэш — после сохранения настроек и при смене пользователя. */
  function invalidate() {
    template.value = null
    cachedFor.value = null
    // Запрос, летящий прямо сейчас, писать в кэш уже нельзя: он вернёт то, что
    // было до правки.
    loading = null
  }

  return { template, getTemplate, invalidate }
}
