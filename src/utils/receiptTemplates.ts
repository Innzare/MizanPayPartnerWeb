/**
 * Готовые бланки квитанции и её переменные.
 *
 * Квитанция собирается тем же конструктором, что и договор: партнёры просили
 * не «форму с галочками», а тот же редактор — они уже привыкли к нему и хотят
 * ставить свои печати, логотипы и формулировки.
 *
 * Отличается только набор данных: договор описывает сделку целиком, квитанция —
 * один платёж по ней.
 */
import type { ContractTemplate } from './contractTemplates'

export const RECEIPT_TEMPLATES: ContractTemplate[] = [
  {
    id: 'receipt-standard',
    name: 'Стандартная',
    description: 'Привычный вид: шапка, платёж, итоги по договору',
    html: `<p style="text-align: center"><strong style="font-size: 16px">{{продавец}}</strong></p>
<p style="text-align: center"><span style="font-size: 11px">тел. {{телефон_продавца}}</span></p>
<hr>
<p style="text-align: center"><strong style="font-size: 14px">КВИТАНЦИЯ ОБ ОПЛАТЕ</strong></p>
<p style="text-align: center"><span style="font-size: 11px">от {{дата_оплаты}}</span></p>
<p><strong>Договор:</strong> №{{номер_договора}} от {{дата_договора}}</p>
<p><strong>Клиент:</strong> {{покупатель}} &nbsp;&nbsp; тел. {{телефон_покупателя}}</p>
<p><strong>Товар:</strong> {{товар}}</p>
<table>
  <tbody>
    <tr>
      <td><strong>Платёж №{{номер_платежа}} из {{всего_платежей}}</strong></td>
      <td style="text-align: right"><strong style="font-size: 15px">{{сумма_платежа}}</strong></td>
    </tr>
    <tr>
      <td>Оплачено по договору</td>
      <td style="text-align: right">{{оплачено_всего}}</td>
    </tr>
    <tr>
      <td>Остаток к оплате</td>
      <td style="text-align: right">{{остаток}}</td>
    </tr>
    <tr>
      <td>Следующий платёж</td>
      <td style="text-align: right">{{следующий_платёж}}</td>
    </tr>
  </tbody>
</table>
<p><span style="font-size: 11px">Принял: _________________ &nbsp;&nbsp;&nbsp; Клиент: _________________</span></p>`,
  },
  {
    id: 'receipt-compact',
    name: 'Компактная',
    description: 'Половина листа — для печати на узкой ленте',
    html: `<p style="text-align: center"><strong>{{продавец}}</strong> · тел. {{телефон_продавца}}</p>
<p style="text-align: center"><strong>Квитанция от {{дата_оплаты}}</strong></p>
<p><span style="font-size: 11px">Договор №{{номер_договора}} · {{покупатель}} · {{товар}}</span></p>
<p><strong>Платёж №{{номер_платежа}}: {{сумма_платежа}}</strong></p>
<p><span style="font-size: 11px">Остаток по договору: {{остаток}} · следующий платёж {{следующий_платёж}}</span></p>`,
  },
  {
    id: 'receipt-requisites',
    name: 'С реквизитами',
    description: 'Добавлены реквизиты для следующего перевода',
    html: `<p style="text-align: center"><strong style="font-size: 16px">{{продавец}}</strong></p>
<p style="text-align: center"><span style="font-size: 11px">{{адрес_продавца}} · тел. {{телефон_продавца}}</span></p>
<hr>
<p style="text-align: center"><strong style="font-size: 14px">КВИТАНЦИЯ ОБ ОПЛАТЕ</strong> · {{дата_оплаты}}</p>
<p><strong>Договор:</strong> №{{номер_договора}} от {{дата_договора}} &nbsp;&nbsp; <strong>Клиент:</strong> {{покупатель}}</p>
<p><strong>Товар:</strong> {{товар}}</p>
<table>
  <tbody>
    <tr>
      <td><strong>Платёж №{{номер_платежа}} из {{всего_платежей}}</strong></td>
      <td style="text-align: right"><strong style="font-size: 15px">{{сумма_платежа}}</strong></td>
    </tr>
    <tr>
      <td>Остаток к оплате</td>
      <td style="text-align: right">{{остаток}}</td>
    </tr>
    <tr>
      <td>Следующий платёж</td>
      <td style="text-align: right">{{следующий_платёж}}</td>
    </tr>
  </tbody>
</table>
<p><strong>Реквизиты для перевода:</strong><br>{{реквизиты}}</p>
<p><span style="font-size: 11px">Спасибо за оплату!</span></p>`,
  },
]

/**
 * Переменные квитанции.
 *
 * Часть повторяет договорные (клиент, товар, номер договора) — это удобно:
 * партнёр, собравший договор, уже знает половину списка. Остальное — про
 * конкретный платёж, которого в договоре нет.
 */
export const RECEIPT_VARIABLES: { key: string; label: string; group: string }[] = [
  { key: '{{продавец}}', label: 'Название / ФИО продавца', group: 'Продавец' },
  { key: '{{телефон_продавца}}', label: 'Телефон продавца', group: 'Продавец' },
  { key: '{{адрес_продавца}}', label: 'Адрес продавца', group: 'Продавец' },
  { key: '{{реквизиты}}', label: 'Реквизиты для перевода', group: 'Продавец' },
  { key: '{{инн}}', label: 'ИНН', group: 'Продавец' },

  { key: '{{покупатель}}', label: 'ФИО клиента', group: 'Клиент' },
  { key: '{{телефон_покупателя}}', label: 'Телефон клиента', group: 'Клиент' },

  { key: '{{номер_платежа}}', label: 'Номер платежа', group: 'Платёж' },
  { key: '{{всего_платежей}}', label: 'Всего платежей по договору', group: 'Платёж' },
  { key: '{{сумма_платежа}}', label: 'Сумма платежа', group: 'Платёж' },
  { key: '{{дата_оплаты}}', label: 'Дата оплаты', group: 'Платёж' },
  { key: '{{дата_платежа_по_графику}}', label: 'Дата по графику', group: 'Платёж' },
  { key: '{{способ_оплаты}}', label: 'Куда принят платёж', group: 'Платёж' },

  { key: '{{номер_договора}}', label: 'Номер договора', group: 'Договор' },
  { key: '{{дата_договора}}', label: 'Дата договора', group: 'Договор' },
  { key: '{{товар}}', label: 'Товар', group: 'Договор' },
  { key: '{{цена}}', label: 'Сумма договора', group: 'Договор' },
  { key: '{{оплачено_всего}}', label: 'Оплачено по договору', group: 'Договор' },
  { key: '{{остаток}}', label: 'Остаток к оплате', group: 'Договор' },
  { key: '{{следующий_платёж}}', label: 'Следующий платёж (дата и сумма)', group: 'Договор' },
  { key: '{{график_платежей}}', label: 'Таблица платежей', group: 'Договор' },
]
