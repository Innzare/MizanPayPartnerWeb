<script setup lang="ts">
/**
 * Карточка платежа.
 *
 * До неё всё, что известно о платеже, жило только в момент приёма оплаты:
 * окно закрылось — и квитанцию было уже не скачать, не отправить клиенту и не
 * дописать, о чём договорились. Теперь по клику на строку графика открывается
 * эта карточка: подробности, документы и комментарий.
 *
 * Денежных действий здесь нет сознательно: оплата, отмена и перенос остаются
 * там, где были, — иначе одно и то же действие жило бы в двух местах.
 */
import { computed, ref, watch } from 'vue'
import { usePaymentsStore } from '@/stores/payments'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useSections } from '@/composables/useSections'
import { useIsDark } from '@/composables/useIsDark'
import { useSendPdfWhatsApp } from '@/composables/useSendPdfWhatsApp'
import { useReceiptTemplate } from '@/composables/useReceiptTemplate'
import { generateReceipt } from '@/utils/receiptPdf'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { PAYMENT_STATUS_CONFIG } from '@/constants/statuses'
import { offMonthKind, dueYearMonth, monthPrepositional, overdueDays, pluralDays } from '@/utils/paymentAttribution'
import type { Deal, Payment, User } from '@/types'

const props = defineProps<{
  modelValue: boolean
  payment: Payment | null
  deal: Deal | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** Комментарий сохранён — владельцу стоит перечитать график. */
  (e: 'updated', dealId: string): void
}>()

const paymentsStore = usePaymentsStore()
const authStore = useAuthStore()
const toast = useToast()
const sections = useSections()
const { statusStyle } = useIsDark()
const receiptTemplate = useReceiptTemplate()
const { sendPdf, sending: sendingWhatsApp } = useSendPdfWhatsApp()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

type Tab = 'info' | 'docs' | 'note'
const tab = ref<Tab>('info')

const noteDraft = ref('')
const savingNote = ref(false)

// Каждое открытие начинается с чистого листа: иначе в окно протекает
// комментарий от предыдущего платежа.
watch(
  () => [props.modelValue, props.payment?.id],
  ([isOpen]) => {
    if (!isOpen) return
    tab.value = 'info'
    noteDraft.value = props.payment?.note ?? ''
  },
  { immediate: true },
)

const isDebt = computed(() => !!props.payment?.shortfallOfPaymentId)
const isPaid = computed(() => props.payment?.status === 'PAID')
const noteChanged = computed(() => (props.payment?.note ?? '') !== noteDraft.value.trim())

/**
 * На сколько дней платёж просрочен — или с какой задержкой был оплачен.
 * Ожидаемый платёж просроченным не считаем: об этом говорит его статус.
 */
const lateDays = computed(() => {
  const p = props.payment
  if (!p || (p.status !== 'PAID' && p.status !== 'OVERDUE')) return 0
  return overdueDays(p)
})

/** Оплачен не в свой месяц — доход учтён по факту оплаты. */
const offMonthLabel = computed(() => {
  const p = props.payment
  if (!p || !p.paidAt || !offMonthKind(p)) return ''
  const paid = new Date(p.paidAt)
  const due = dueYearMonth(p.dueDate)
  if (!due) return ''
  const paidStr = monthPrepositional(paid.getFullYear(), paid.getMonth(), due.year)
  const dueStr = monthPrepositional(due.year, due.month, paid.getFullYear())
  return `Оплачен в ${paidStr}, плановый срок — в ${dueStr}. Доход учтён по факту оплаты.`
})

function clientPhoneOnDeal(): string | null {
  const d = props.deal
  if (!d) return null
  return (d.clientProfile as any)?.phone || d.client?.phone || d.externalClientPhone || null
}

async function printReceipt() {
  if (!props.deal || !props.payment) return
  generateReceipt(props.deal, props.payment, authStore.user || {}, {
    template: await receiptTemplate.getTemplate(),
  })
}

async function sendReceiptWhatsApp() {
  const p = props.payment
  if (!props.deal || !p) return
  const phone = clientPhoneOnDeal()
  if (!phone) {
    toast.error('У клиента нет телефона — нельзя отправить в WhatsApp')
    return
  }
  if (!confirm(`Отправить «Квитанция #${p.number}» клиенту в WhatsApp на ${phone}?`)) return
  const investor = (authStore.user || {}) as Partial<User>
  const blob = (await generateReceipt(props.deal, p, investor, {
    returnBlob: true,
    template: await receiptTemplate.getTemplate(),
  })) as Blob
  await sendPdf({
    blob,
    fileName: `Квитанция-${props.deal.dealNumber || props.deal.id.slice(0, 6)}-${p.number}.pdf`,
    dealId: props.deal.id,
    caption: `Квитанция о получении платежа #${p.number} по сделке «${props.deal.productName}».`,
  })
}

async function saveNote() {
  const p = props.payment
  if (!p || savingNote.value) return
  savingNote.value = true
  try {
    await paymentsStore.updatePaymentNote(p.id, p.dealId, noteDraft.value.trim())
    toast.success('Комментарий сохранён')
    emit('updated', p.dealId)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось сохранить комментарий')
  } finally {
    savingNote.value = false
  }
}

const proofEnlarged = ref(false)
</script>

<template>
  <v-dialog v-model="open" max-width="620" scrollable>
    <v-card v-if="payment" rounded="lg" class="pd-card">
      <button class="pd-close" @click="open = false">
        <v-icon icon="mdi-close" size="18" />
      </button>

      <!-- Шапка в фирменном зелёном — как в окне приёма оплаты: два окна про
           один и тот же платёж должны выглядеть роднёй. -->
      <div class="pd-head">
        <div class="pd-title">
          <template v-if="isDebt">Недоплата за платёж №{{ payment.number }}</template>
          <template v-else>Платёж №{{ payment.number }}</template>
        </div>
        <div class="pd-sub">
          <span class="pd-status" :style="statusStyle(PAYMENT_STATUS_CONFIG[payment.status])">
            <v-icon v-if="PAYMENT_STATUS_CONFIG[payment.status]?.icon" :icon="PAYMENT_STATUS_CONFIG[payment.status]?.icon" size="14" />
            {{ PAYMENT_STATUS_CONFIG[payment.status]?.label }}
          </span>
          <span class="pd-amount">{{ formatCurrency(payment.amount) }}</span>
        </div>
      </div>

      <div class="pd-tabs">
        <button class="pd-tab" :class="{ 'pd-tab--active': tab === 'info' }" @click="tab = 'info'">
          Информация
        </button>
        <button class="pd-tab" :class="{ 'pd-tab--active': tab === 'docs' }" @click="tab = 'docs'">
          Документы
          <span v-if="payment.proofScreenshot" class="pd-tab-dot" />
        </button>
        <button class="pd-tab" :class="{ 'pd-tab--active': tab === 'note' }" @click="tab = 'note'">
          Комментарий
          <span v-if="payment.note" class="pd-tab-dot" />
        </button>
      </div>

      <v-card-text class="pd-body">
        <!-- ── Информация ─────────────────────────────────────────────── -->
        <div v-show="tab === 'info'" class="pd-rows">
          <div class="pd-row">
            <span class="pd-label">Срок оплаты</span>
            <span class="pd-value">{{ formatDate(payment.dueDate) }}</span>
          </div>
          <div v-if="payment.rescheduledFrom" class="pd-row">
            <span class="pd-label">Дата переносилась</span>
            <span class="pd-value pd-value--muted">было {{ formatDate(payment.rescheduledFrom) }}</span>
          </div>
          <div class="pd-row">
            <span class="pd-label">Сумма</span>
            <span class="pd-value">{{ formatCurrency(payment.amount) }}</span>
          </div>
          <!-- План против факта: видно, что сумма оплаты отличалась от плановой. -->
          <div
            v-if="payment.scheduledAmount != null && Math.round(payment.scheduledAmount) !== Math.round(payment.amount)"
            class="pd-row"
          >
            <span class="pd-label">Плановая сумма</span>
            <span class="pd-value pd-value--muted">{{ formatCurrency(payment.scheduledAmount) }}</span>
          </div>
          <div class="pd-row">
            <span class="pd-label">Дата оплаты</span>
            <span class="pd-value">{{ payment.paidAt ? formatDate(payment.paidAt) : '—' }}</span>
          </div>
          <div v-if="lateDays > 0" class="pd-row">
            <span class="pd-label">Своевременность</span>
            <span class="pd-value" :class="isPaid ? 'pd-value--late' : 'pd-value--overdue'">
              {{ isPaid ? 'оплачен с задержкой' : 'просрочен' }}
              на {{ lateDays }} {{ pluralDays(lateDays) }}
            </span>
          </div>
          <div class="pd-row">
            <span class="pd-label">Остаток после</span>
            <span class="pd-value">{{ formatCurrency(payment.remainingAfter) }}</span>
          </div>
          <!-- Обещание доплатить живёт у строки-недоплаты. -->
          <div v-if="isDebt && payment.shortfallPromisedDate" class="pd-row">
            <span class="pd-label">Обещал доплатить</span>
            <span class="pd-value">{{ formatDate(payment.shortfallPromisedDate) }}</span>
          </div>
          <div v-if="isDebt && payment.shortfallNote" class="pd-row">
            <span class="pd-label">О чём договорились</span>
            <span class="pd-value">{{ payment.shortfallNote }}</span>
          </div>
          <div v-if="offMonthLabel" class="pd-note">
            <v-icon icon="mdi-information-outline" size="15" />
            <span>{{ offMonthLabel }}</span>
          </div>
        </div>

        <!-- ── Документы ──────────────────────────────────────────────── -->
        <div v-show="tab === 'docs'" class="pd-docs">
          <!-- Квитанция имеет смысл только для принятых денег. -->
          <template v-if="isPaid">
            <div class="pd-doc-row">
              <button class="pd-doc-btn" :disabled="!deal" @click="printReceipt">
                <v-icon icon="mdi-file-document-outline" size="18" />
                <span class="pd-doc-text">
                  <span class="pd-doc-title">Квитанция об оплате</span>
                  <span class="pd-doc-sub">Скачать PDF</span>
                </span>
                <v-icon icon="mdi-download" size="16" />
              </button>
              <button
                v-if="sections.visible('whatsapp')"
                class="pd-wa-btn"
                :disabled="sendingWhatsApp || !deal"
                title="Отправить квитанцию клиенту в WhatsApp"
                @click="sendReceiptWhatsApp"
              >
                <v-progress-circular v-if="sendingWhatsApp" indeterminate size="18" width="2" />
                <v-icon v-else icon="mdi-whatsapp" size="18" />
              </button>
            </div>
          </template>
          <div v-else class="pd-empty">
            Квитанция появится после того, как платёж будет отмечен оплаченным
          </div>

          <div class="pd-doc-label">Скриншот оплаты</div>
          <img
            v-if="payment.proofScreenshot"
            :src="payment.proofScreenshot"
            class="pd-proof"
            title="Открыть во весь экран"
            @click="proofEnlarged = true"
          />
          <div v-else class="pd-empty">Скриншот не прикреплён</div>
        </div>

        <!-- ── Комментарий ────────────────────────────────────────────── -->
        <div v-show="tab === 'note'" class="pd-note-tab">
          <label class="pd-doc-label">Комментарий к платежу</label>
          <textarea
            v-model="noteDraft"
            class="pd-textarea"
            rows="5"
            maxlength="2000"
            placeholder="Например: клиент принёс наличными в офис, обещал остаток в пятницу"
          />
          <div class="pd-note-actions">
            <span class="pd-note-hint">Виден только вам и вашим сотрудникам</span>
            <button class="pd-save" :disabled="!noteChanged || savingNote" @click="saveNote">
              <v-progress-circular v-if="savingNote" indeterminate size="14" width="2" />
              <span v-else>Сохранить</span>
            </button>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <!-- Скриншот во весь экран — как в графике на странице сделки. -->
    <v-dialog v-model="proofEnlarged" max-width="600">
      <v-card rounded="lg" class="pa-2">
        <img v-if="payment?.proofScreenshot" :src="payment.proofScreenshot" style="width: 100%; border-radius: 8px" />
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<style scoped>
.pd-card { display: flex; flex-direction: column; max-height: 88vh; }
.pd-close {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
  z-index: 1;
}
.pd-close:hover { background: rgba(255, 255, 255, 0.28); }
.pd-head {
  padding: 20px 56px 16px 24px;
  background: linear-gradient(135deg, #047857 0%, #065f46 58%, #064e3b 100%);
  color: #fff;
}
.pd-title { font-size: 17px; font-weight: 700; }
.pd-sub {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 8px;
}
.pd-status {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12.5px; font-weight: 600;
  padding: 4px 10px; border-radius: 8px;
}
.pd-amount { font-size: 18px; font-weight: 700; color: #fff; }

.pd-tabs {
  display: flex; gap: 4px;
  padding: 0 24px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.pd-tab {
  position: relative;
  padding: 11px 4px; margin-right: 18px;
  background: none; border: none;
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  cursor: pointer; transition: color 0.15s;
}
.pd-tab:hover { color: rgba(var(--v-theme-on-surface), 0.7); }
.pd-tab--active { color: rgb(var(--v-theme-primary)); }
.pd-tab--active::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -1px;
  height: 2px; background: rgb(var(--v-theme-primary)); border-radius: 2px;
}
/* Точка у вкладки: есть что посмотреть — скриншот или комментарий. */
.pd-tab-dot {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: rgb(var(--v-theme-primary)); margin-left: 5px; vertical-align: middle;
}

.pd-body { padding: 18px 24px 22px !important; }
.pd-rows { display: flex; flex-direction: column; }
.pd-row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.pd-row:last-child { border-bottom: none; }
.pd-label { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }
.pd-value {
  font-size: 14px; font-weight: 600; text-align: right;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.pd-value--muted { font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.6); }
.pd-value--late { color: #d97706; }
.pd-value--overdue { color: #dc2626; }
.pd-note {
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 12px; padding: 10px 12px; border-radius: 10px;
  font-size: 12.5px; color: #0369a1;
  background: rgba(14, 165, 233, 0.07);
}

.pd-docs { display: flex; flex-direction: column; gap: 10px; }
.pd-doc-row { display: flex; gap: 8px; }
.pd-doc-btn {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 12px 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; cursor: pointer; transition: all 0.15s;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.pd-doc-btn:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.4);
  background: rgba(var(--v-theme-primary), 0.04);
}
.pd-doc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pd-doc-text { display: flex; flex-direction: column; align-items: flex-start; flex: 1; }
.pd-doc-title { font-size: 14px; font-weight: 600; }
.pd-doc-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.pd-wa-btn {
  width: 48px; border-radius: 12px;
  border: 1px solid rgba(37, 211, 102, 0.35);
  background: rgba(37, 211, 102, 0.08);
  color: #25d366;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.pd-wa-btn:hover:not(:disabled) { background: rgba(37, 211, 102, 0.18); }
.pd-wa-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pd-doc-label {
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 6px;
}
.pd-proof {
  width: 140px; height: 140px; object-fit: cover;
  border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  transition: transform 0.15s;
}
.pd-proof:hover { transform: scale(1.03); }
.pd-empty {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  padding: 10px 0;
}

.pd-note-tab { display: flex; flex-direction: column; gap: 8px; }
.pd-textarea {
  width: 100%; padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; font-family: inherit; resize: vertical;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.pd-textarea:focus {
  outline: none;
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.pd-note-actions {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.pd-note-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); }
.pd-save {
  min-width: 120px; padding: 9px 18px; border-radius: 10px; border: none;
  background: rgb(var(--v-theme-primary)); color: #fff;
  font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
  display: inline-flex; align-items: center; justify-content: center;
}
.pd-save:hover:not(:disabled) { filter: brightness(1.08); }
.pd-save:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
