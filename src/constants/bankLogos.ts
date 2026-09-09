/**
 * Логотипы банков.
 *
 * Счёт в списке узнают по банку, а не по названию строки: логотип Сбера
 * находится взглядом за долю секунды, «Сбербанк» приходится читать. Поэтому
 * логотип показывается везде, где счёт выбирают или ищут.
 *
 * Источник — официальный реестр участников СБП (НСПК): это те же изображения,
 * которые банки сами предоставили для отображения в приложениях. Файлы лежат в
 * репозитории, а не грузятся с чужого сервера: интерфейс не должен зависеть от
 * доступности стороннего домена, и адрес счёта партнёра никуда не уходит.
 *
 * У банка без логотипа остаётся прежняя буквенная плашка с его фирменным
 * цветом — так же выглядят кассы и пункты приёма.
 */
import akbars from '@/assets/banks/akbars.png'
import alfa from '@/assets/banks/alfa.png'
import domrf from '@/assets/banks/domrf.png'
import gazprombank from '@/assets/banks/gazprombank.png'
import mkb from '@/assets/banks/mkb.png'
import ozon from '@/assets/banks/ozon.png'
import psb from '@/assets/banks/psb.png'
import raiffeisen from '@/assets/banks/raiffeisen.png'
import rshb from '@/assets/banks/rshb.png'
import sber from '@/assets/banks/sber.png'
import sovcombank from '@/assets/banks/sovcombank.png'
import tbank from '@/assets/banks/tbank.png'
import uralsib from '@/assets/banks/uralsib.png'
import vtb from '@/assets/banks/vtb.png'
import yandex from '@/assets/banks/yandex.png'

/**
 * Ключ ищется по написанию названия, а не по id: справочник банков заводится
 * сидом, и его записи у разных партнёров имеют разные идентификаторы.
 */
const BY_KEY: Record<string, string> = {
  сбербанк: sber,
  сбер: sber,
  тбанк: tbank,
  тинькофф: tbank,
  втб: vtb,
  альфабанк: alfa,
  альфа: alfa,
  ozonбанк: ozon,
  ozon: ozon,
  озонбанк: ozon,
  яндексбанк: yandex,
  яндекс: yandex,
  райффайзен: raiffeisen,
  райффайзенбанк: raiffeisen,
  газпромбанк: gazprombank,
  россельхозбанк: rshb,
  рсхб: rshb,
  промсвязьбанк: psb,
  псб: psb,
  совкомбанк: sovcombank,
  мкб: mkb,
  московскийкредитныйбанк: mkb,
  уралсиб: uralsib,
  домрф: domrf,
  акбарс: akbars,
}

/**
 * Приведение названия к ключу: регистр, пробелы, дефисы и точки не должны
 * решать, найдётся логотип или нет («Дом.РФ», «ДОМ РФ», «дом-рф» — один банк).
 */
function keyOf(name: string): string {
  return name.toLowerCase().replace(/[\s.\-–—«»"']/g, '')
}

/** Логотип банка или `null`, если его нет — тогда рисуется буквенная плашка. */
export function bankLogo(name?: string | null): string | null {
  if (!name) return null
  return BY_KEY[keyOf(name)] ?? null
}
