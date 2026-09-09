<script setup lang="ts">
/**
 * Бланк квитанции.
 *
 * Квитанция — единственный документ, который клиент уносит с собой, поэтому
 * партнёры просят на нём своё название, телефон и реквизиты для перевода.
 *
 * Правки видно сразу: кнопка предпросмотра открывает настоящий PDF на
 * вымышленной сделке — тем же генератором, что печатает клиенту. Иначе бланк
 * настраивают вслепую и узнают о криво влезшем логотипе от клиента.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useReceiptTemplate } from '@/composables/useReceiptTemplate'
import { generateReceipt } from '@/utils/receiptPdf'
import type { Deal, Payment } from '@/types'

interface TemplateForm {
  companyName: string
  phone: string
  address: string
  site: string
  requisites: string
  inn: string
  blocks: string[]
  footerText: string
  showSignature: boolean
  accentColor: string
  fontSize: number
}

const router = useRouter()
const auth = useAuthStore()
const toast = useToast()
const { isDark } = useIsDark()
const receiptTemplate = useReceiptTemplate()

const canEdit = computed(() => auth.can('settings.receiptTemplate'))

const loading = ref(true)
const saving = ref(false)
const form = ref<TemplateForm>({
  companyName: '',
  phone: '',
  address: '',
  site: '',
  requisites: '',
  inn: '',
  blocks: ['contract', 'payment', 'summary'],
  footerText: '',
  showSignature: true,
  accentColor: '#047857',
  fontSize: 10,
})

/** Блоки бланка: что печатать, а что клиенту в квитанции не нужно. */
const BLOCKS: { key: string; label: string; hint: string }[] = [
  { key: 'contract', label: 'Данные договора', hint: 'Товар, номер и дата договора, стороны' },
  { key: 'payment', label: 'Данные платежа', hint: 'Какой платёж по счёту, срок и сумма' },
  { key: 'summary', label: 'Сводка по договору', hint: 'Цена, оплачено ранее, остаток после оплаты' },
  { key: 'requisites', label: 'Реквизиты для оплаты', hint: 'Куда переводить следующий платёж' },
]

const ACCENTS = ['#047857', '#1d4ed8', '#7c3aed', '#b45309', '#be123c', '#0f172a']

async function load() {
  loading.value = true
  try {
    const res = await api.get<TemplateForm>('/receipt-template')
    form.value = { ...form.value, ...res }
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить бланк')
  } finally {
    loading.value = false
  }
}
onMounted(load)

function toggleBlock(key: string) {
  const i = form.value.blocks.indexOf(key)
  if (i < 0) {
    form.value.blocks.push(key)
    return
  }
  // Совсем пустая квитанция — не документ, а лист с подписями. Последний блок
  // снять не даём.
  const content = form.value.blocks.filter((b) => b !== 'requisites')
  if (content.length <= 1 && key !== 'requisites') {
    toast.error('Оставьте хотя бы один блок — иначе на квитанции нечего печатать')
    return
  }
  form.value.blocks.splice(i, 1)
}

async function save() {
  saving.value = true
  try {
    await api.put('/receipt-template', form.value)
    // Сбрасываем кэш: иначе печать из других экранов ещё какое-то время шла бы
    // по старому бланку.
    receiptTemplate.invalidate()
    toast.success('Бланк сохранён')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить бланк')
  } finally {
    saving.value = false
  }
}

async function reset() {
  try {
    const res = await api.post<TemplateForm>('/receipt-template/reset', {})
    form.value = { ...form.value, ...res }
    receiptTemplate.invalidate()
    toast.success('Вернули стандартный бланк')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сбросить бланк')
  }
}

/** Вымышленная сделка для предпросмотра — печатать настоящую незачем. */
function previewData(): { deal: Deal; payment: Payment } {
  const today = new Date().toISOString()
  const deal = {
    id: 'preview-deal-000001',
    dealNumber: 4296,
    productName: 'Диван «Милан»',
    totalPrice: 120000,
    remainingAmount: 60000,
    numberOfPayments: 6,
    downPayment: 12000,
    dealDate: today,
    createdAt: today,
    clientProfile: { firstName: 'Иван', lastName: 'Петров', patronymic: 'Сергеевич', phone: '+79280001122' },
  } as unknown as Deal

  const payment = {
    id: 'preview-payment',
    number: 3,
    amount: 18000,
    dueDate: today,
    paidAt: today,
    remainingAfter: 42000,
    status: 'PAID',
  } as unknown as Payment

  return { deal, payment }
}

function preview() {
  const { deal, payment } = previewData()
  generateReceipt(deal, payment, auth.user || {}, { template: form.value })
}
</script>

<template>
  <div class="at-page rt-page" :class="{ dark: isDark }">
    <button class="back-btn" @click="router.push('/settings')">
      <v-icon icon="mdi-arrow-left" size="18" />
      Настройки
    </button>

    <div class="rt-head">
      <div>
        <div class="rt-title">Бланк квитанции</div>
        <div class="rt-sub">
          Квитанция — единственный документ, который клиент уносит с собой.
          Здесь настраивается, что на нём напечатано.
        </div>
      </div>
      <div class="rt-head-actions">
        <button class="rt-ghost" @click="preview">
          <v-icon icon="mdi-file-eye-outline" size="16" />
          Посмотреть образец
        </button>
        <button v-if="canEdit" class="rt-save" :disabled="saving" @click="save">
          {{ saving ? 'Сохраняю…' : 'Сохранить' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="d-flex justify-center pa-12">
      <v-progress-circular indeterminate color="primary" size="32" />
    </div>

    <div v-else class="rt-grid mz-form">
      <!-- Шапка бланка -->
      <v-card rounded="lg" elevation="0" border class="pa-5">
        <div class="rt-card-title">Шапка документа</div>
        <div class="rt-card-hint">
          Пустые поля не печатаются. Название берётся из профиля, если не указать своё.
        </div>

        <div class="form-field">
          <label class="field-label">Название компании</label>
          <input v-model="form.companyName" class="field-input" placeholder="ИП Умаев Ш. А." />
        </div>

        <div class="form-row-2">
          <div class="form-field">
            <label class="field-label">Телефон</label>
            <input v-model="form.phone" class="field-input" placeholder="+7 928 000-11-22" />
          </div>
          <div class="form-field">
            <label class="field-label">ИНН</label>
            <input v-model="form.inn" class="field-input" placeholder="2013001122" />
          </div>
        </div>

        <div class="form-field">
          <label class="field-label">Адрес</label>
          <input v-model="form.address" class="field-input" placeholder="Грозный, пр. Победы, 12" />
        </div>

        <div class="form-field">
          <label class="field-label">Сайт или страница</label>
          <input v-model="form.site" class="field-input" placeholder="instagram.com/…" />
        </div>
      </v-card>

      <!-- Содержимое -->
      <v-card rounded="lg" elevation="0" border class="pa-5">
        <div class="rt-card-title">Что печатать</div>
        <div class="rt-card-hint">
          Порядок блоков задан вёрсткой — так бланк остаётся читаемым при любом наборе.
        </div>

        <label v-for="b in BLOCKS" :key="b.key" class="rt-check">
          <input type="checkbox" :checked="form.blocks.includes(b.key)" @change="toggleBlock(b.key)" />
          <span>
            <span class="rt-check-title">{{ b.label }}</span>
            <span class="rt-check-hint">{{ b.hint }}</span>
          </span>
        </label>

        <div v-if="form.blocks.includes('requisites')" class="form-field mt-3">
          <label class="field-label">Реквизиты для перевода</label>
          <textarea
            v-model="form.requisites"
            class="field-input field-textarea"
            rows="3"
            placeholder="Перевод по номеру +7 928 000-11-22 (Сбер), получатель Шамиль У."
          ></textarea>
        </div>

        <label class="rt-check mt-2">
          <input v-model="form.showSignature" type="checkbox" />
          <span>
            <span class="rt-check-title">Место для подписей</span>
            <span class="rt-check-hint">Нужно, если квитанцию подписывают на месте</span>
          </span>
        </label>

        <div class="form-field mt-3">
          <label class="field-label">Строка внизу</label>
          <input
            v-model="form.footerText"
            class="field-input"
            placeholder="Спасибо, что выбрали нас! Вопросы — по телефону выше"
          />
        </div>
      </v-card>

      <!-- Оформление -->
      <v-card rounded="lg" elevation="0" border class="pa-5">
        <div class="rt-card-title">Оформление</div>

        <div class="form-field">
          <label class="field-label">Цвет заголовков</label>
          <div class="rt-colors">
            <button
              v-for="c in ACCENTS"
              :key="c"
              class="rt-color"
              :class="{ 'rt-color--on': form.accentColor === c }"
              :style="{ background: c }"
              :title="c"
              @click="form.accentColor = c"
            />
          </div>
        </div>

        <div class="form-field">
          <label class="field-label">Размер шрифта</label>
          <div class="rt-font">
            <input v-model.number="form.fontSize" type="range" min="8" max="14" step="1" class="rt-range" />
            <span class="rt-font-value">{{ form.fontSize }}</span>
          </div>
          <div class="field-hint">
            Крупнее — легче читать пожилым клиентам, но содержимое может уйти на вторую страницу
          </div>
        </div>

        <button v-if="canEdit" class="rt-reset" @click="reset">Вернуть стандартный бланк</button>
      </v-card>
    </div>
  </div>
</template>

<style scoped>
.rt-page { padding-bottom: 40px; }
.rt-head { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.rt-title { font-size: 17px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.rt-sub {
  font-size: 13px; line-height: 1.5; margin-top: 3px; max-width: 560px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.rt-head-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.rt-ghost {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.rt-ghost:hover { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.rt-save {
  padding: 9px 18px; border-radius: 10px; border: none;
  background: #047857; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
}
.rt-save:disabled { opacity: 0.5; cursor: default; }

.rt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; align-items: start; }
.rt-card-title { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.rt-card-hint {
  font-size: 12.5px; line-height: 1.45; margin-bottom: 14px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.rt-check {
  display: flex; align-items: flex-start; gap: 10px; cursor: pointer;
  font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85);
}
.rt-check + .rt-check { margin-top: 10px; }
.rt-check input { width: 17px; height: 17px; margin-top: 2px; accent-color: #047857; cursor: pointer; }
.rt-check-title { display: block; font-weight: 600; }
.rt-check-hint {
  display: block; font-size: 12px; margin-top: 1px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.rt-colors { display: flex; gap: 8px; flex-wrap: wrap; }
.rt-color {
  width: 30px; height: 30px; border-radius: 9px; cursor: pointer;
  border: 2px solid transparent;
}
.rt-color--on { border-color: rgba(var(--v-theme-on-surface), 0.55); }

.rt-font { display: flex; align-items: center; gap: 12px; }
.rt-range { flex: 1; accent-color: #047857; }
.rt-font-value { font-size: 14px; font-weight: 700; min-width: 24px; text-align: right; }

.rt-reset {
  margin-top: 12px; border: none; background: none; padding: 0; cursor: pointer;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55);
}
.rt-reset:hover { color: #dc2626; }
</style>
