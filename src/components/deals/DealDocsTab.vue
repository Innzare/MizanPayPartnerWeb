<script setup lang="ts">
/**
 * Документы сделки: PDF и фото договора.
 *
 * Перенесено со страницы сделки без изменений в логике. Свой шаблон договора
 * подгружается при первом открытии вкладки, а не вместе со страницей.
 */
import { computed, ref, onMounted } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useDealsStore } from '@/stores/deals'
import { useToast } from '@/composables/useToast'
import { useSubscription } from '@/composables/useSubscription'
import { useSections } from '@/composables/useSections'
import { useIsMobile } from '@/composables/useIsMobile'
import { useSendPdfWhatsApp } from '@/composables/useSendPdfWhatsApp'
import { generateContract } from '@/utils/contractPdf'
import { generateReceipt } from '@/utils/receiptPdf'
import { useReceiptTemplate } from '@/composables/useReceiptTemplate'
import { exportTemplatePdf } from '@/utils/templatePdfExport'
import { generateDealSummary } from '@/utils/dealSummaryPdf'
import type { Deal, Payment } from '@/types'

const props = defineProps<{ deal: Deal; payments: Payment[] }>()

const authStore = useAuthStore()
const receiptTemplate = useReceiptTemplate()
const dealsStore = useDealsStore()
const toast = useToast()
const subscription = useSubscription()
const canAccessFeature = subscription.canAccess
const sections = useSections()
const { isMobile } = useIsMobile()

/** Локальные ссылки на данные — чтобы перенесённый код остался прежним. */
const deal = computed(() => props.deal)
const payments = computed(() => props.payments)
const dealId = computed(() => props.deal.id)

// Contract photos
const contractInputRef = ref<HTMLInputElement | null>(null)
const contractUploading = ref(false)

async function onContractFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !deal.value) return
  contractUploading.value = true
  try {
    const files = Array.from(input.files).filter(f => f.type.startsWith('image/'))
    const newUrls = await api.uploadMultiple(files, `contracts/${deal.value.id}`)
    const existing = deal.value.contractPhotos || []
    await api.patch(`/deals/${deal.value.id}/contract`, { contractPhotos: [...existing, ...newUrls] })
    await dealsStore.fetchDeal(dealId.value)
    toast.success('Фото договора загружены')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки')
  } finally {
    contractUploading.value = false
    if (contractInputRef.value) contractInputRef.value.value = ''
  }
}

async function removeContractPhoto(index: number) {
  if (!deal.value) return
  const updated = (deal.value.contractPhotos || []).filter((_: string, i: number) => i !== index)
  try {
    await api.patch(`/deals/${deal.value.id}/contract`, { contractPhotos: updated })
    await dealsStore.fetchDeal(dealId.value)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
}

const contractEnlargeUrl = ref('')
const contractEnlargeDialog = ref(false)

function downloadContract() {
  if (!deal.value) return
  const investor = authStore.user || {} as Partial<import('@/types').User>
  generateContract(deal.value, payments.value, investor)
}

function downloadSummary() {
  if (!deal.value) return
  const investor = authStore.user || {} as Partial<import('@/types').User>
  generateDealSummary(deal.value, payments.value, investor)
}

// ── Send PDFs via WhatsApp ──
const { sending: sendingWhatsApp, sendPdf } = useSendPdfWhatsApp()

function clientPhoneOnDeal(): string | null {
  if (!deal.value) return null
  return (
    (deal.value.clientProfile as any)?.phone ||
    deal.value.client?.phone ||
    deal.value.externalClientPhone ||
    null
  )
}

async function confirmSend(label: string): Promise<boolean> {
  const phone = clientPhoneOnDeal()
  if (!phone) {
    toast.error('У клиента нет телефона — нельзя отправить в WhatsApp')
    return false
  }
  return confirm(`Отправить «${label}» клиенту в WhatsApp на ${phone}?`)
}

async function sendContractWhatsApp() {
  if (!deal.value) return
  if (!(await confirmSend('Договор мурабаха'))) return
  const investor = authStore.user || {} as Partial<import('@/types').User>
  const blob = (await generateContract(deal.value, payments.value, investor, { returnBlob: true })) as Blob
  await sendPdf({
    blob,
    fileName: `Договор-${deal.value.dealNumber || deal.value.id.slice(0, 6)}.pdf`,
    dealId: deal.value.id,
    caption: `Здравствуйте! Договор по сделке «${deal.value.productName}».`,
  })
}

async function sendSummaryWhatsApp() {
  if (!deal.value) return
  if (!(await confirmSend('Сводка по сделке'))) return
  const investor = authStore.user || {} as Partial<import('@/types').User>
  const blob = (await generateDealSummary(deal.value, payments.value, investor, { returnBlob: true })) as Blob
  await sendPdf({
    blob,
    fileName: `Сводка-${deal.value.dealNumber || deal.value.id.slice(0, 6)}.pdf`,
    dealId: deal.value.id,
    caption: `Сводка по сделке «${deal.value.productName}».`,
  })
}

async function sendCustomContractWhatsApp() {
  if (!deal.value || !customTemplate.value) return
  if (!(await confirmSend('Договор по шаблону'))) return
  const investor = authStore.user || {} as Partial<import('@/types').User>
  const blob = (await exportTemplatePdf(
    customTemplate.value,
    deal.value,
    payments.value,
    investor,
    customTemplateMargins.value || undefined,
    { returnBlob: true },
  )) as Blob
  await sendPdf({
    blob,
    fileName: `Договор-${deal.value.dealNumber || deal.value.id.slice(0, 6)}.pdf`,
    dealId: deal.value.id,
    caption: `Здравствуйте! Договор по сделке «${deal.value.productName}».`,
  })
}

async function sendReceiptWhatsApp(payment: import('@/types').Payment) {
  if (!deal.value) return
  if (!(await confirmSend(`Квитанция #${payment.number}`))) return
  const investor = authStore.user || {} as Partial<import('@/types').User>
  const blob = (await generateReceipt(deal.value, payment, investor, { returnBlob: true, template: await receiptTemplate.getTemplate() })) as Blob
  await sendPdf({
    blob,
    fileName: `Квитанция-${deal.value.dealNumber || deal.value.id.slice(0, 6)}-${payment.number}.pdf`,
    dealId: deal.value.id,
    caption: `Квитанция о получении платежа #${payment.number} по сделке «${deal.value.productName}».`,
  })
}


// Custom template contract

const customTemplate = ref<string | null>(null)
const customTemplateMargins = ref<{ top: number; bottom: number; left: number; right: number } | null>(null)
const customTemplateLoading = ref(false)

async function loadCustomTemplate() {
  try {
    const data = await api.get<{ template: any }>('/auth/investor/contract-template')
    if (data.template?.html) {
      customTemplate.value = data.template.html
      customTemplateMargins.value = data.template.margins || null
    }
  } catch { /* silent */ }
}

async function downloadCustomContract() {
  if (!deal.value || !customTemplate.value) return
  customTemplateLoading.value = true
  try {
    const investor = authStore.user || {} as Partial<import('@/types').User>
    await exportTemplatePdf(customTemplate.value, deal.value, payments.value, investor, customTemplateMargins.value || undefined)
  } catch (e: any) {
    toast.error('Ошибка генерации PDF')
  } finally {
    customTemplateLoading.value = false
  }
}

onMounted(() => {
  loadCustomTemplate()
})
</script>

<template>
  <!-- PDF и фото договора рядом: вместе они занимают ширину экрана целиком,
       а не тянутся узкой колонкой. -->
  <div class="dc-cols">
<!-- Documents: PDF downloads -->
<v-card rounded="lg" elevation="0" border class="pdf-docs-card mb-6">
  <div class="pdf-docs-header">
    <div class="pdf-docs-header-left">
      <div class="contract-icon">
        <v-icon icon="mdi-file-pdf-box" size="22" color="#3b82f6" />
      </div>
      <div>
        <div class="font-weight-bold" style="font-size: 14px;">PDF документы</div>
        <div class="text-caption text-medium-emphasis">Договоры и отчёты по сделке</div>
      </div>
    </div>
    <router-link to="/contract-builder" class="pdf-docs-builder-link">
      <v-icon icon="mdi-pencil-ruler" size="14" />
      Конструктор
    </router-link>
  </div>

  <div class="pdf-docs-list">
    <!-- Contract -->
    <div class="pdf-doc-row">
      <button class="pdf-doc-item" :disabled="!canAccessFeature('pdfContract')" @click="canAccessFeature('pdfContract') && downloadContract()">
        <v-icon icon="mdi-file-document-outline" size="20" color="#3b82f6" />
        <div class="pdf-doc-item-info">
          <div class="pdf-doc-item-name">Договор мурабаха</div>
          <div class="pdf-doc-item-desc">Полный договор с условиями и графиком</div>
        </div>
        <v-icon :icon="canAccessFeature('pdfContract') ? 'mdi-download' : 'mdi-lock-outline'" size="16" class="pdf-doc-item-action" />
      </button>
      <button
        v-if="canAccessFeature('pdfContract') && sections.visible('whatsapp')"
        class="pdf-wa-btn"
        :disabled="sendingWhatsApp"
        title="Отправить договор клиенту в WhatsApp"
        @click="sendContractWhatsApp"
      >
        <v-icon icon="mdi-whatsapp" size="16" />
      </button>
    </div>

    <!-- Custom template -->
    <div v-if="customTemplate" class="pdf-doc-row">
      <button class="pdf-doc-item" :disabled="customTemplateLoading" @click="downloadCustomContract">
        <v-icon icon="mdi-file-cog-outline" size="20" color="#047857" />
        <div class="pdf-doc-item-info">
          <div class="pdf-doc-item-name">Мой договор</div>
          <div class="pdf-doc-item-desc">Из вашего шаблона</div>
        </div>
        <v-progress-circular v-if="customTemplateLoading" indeterminate size="14" width="2" />
        <v-icon v-else icon="mdi-download" size="16" class="pdf-doc-item-action" />
      </button>
      <button
        v-if="sections.visible('whatsapp')"
        class="pdf-wa-btn"
        :disabled="sendingWhatsApp || customTemplateLoading"
        title="Отправить договор клиенту в WhatsApp"
        @click="sendCustomContractWhatsApp"
      >
        <v-icon icon="mdi-whatsapp" size="16" />
      </button>
    </div>

    <!-- Summary -->
    <div class="pdf-doc-row">
      <button class="pdf-doc-item" :disabled="!canAccessFeature('pdfExport')" @click="canAccessFeature('pdfExport') && downloadSummary()">
        <v-icon icon="mdi-file-chart-outline" size="20" color="#8b5cf6" />
        <div class="pdf-doc-item-info">
          <div class="pdf-doc-item-name">Сводка по сделке</div>
          <div class="pdf-doc-item-desc">Детали и график платежей</div>
        </div>
        <v-icon :icon="canAccessFeature('pdfExport') ? 'mdi-download' : 'mdi-lock-outline'" size="16" class="pdf-doc-item-action" />
      </button>
      <button
        v-if="canAccessFeature('pdfExport') && sections.visible('whatsapp')"
        class="pdf-wa-btn"
        :disabled="sendingWhatsApp"
        title="Отправить сводку клиенту в WhatsApp"
        @click="sendSummaryWhatsApp"
      >
        <v-icon icon="mdi-whatsapp" size="16" />
      </button>
    </div>
  </div>
</v-card>

<!-- Contract photos -->
<v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
  <div class="d-flex align-center justify-space-between mb-4">
    <div class="section-title">Документы</div>
    <button class="btn-sm btn-sm--outline" @click="contractInputRef?.click()" :disabled="contractUploading">
      <v-icon :icon="contractUploading ? 'mdi-loading' : 'mdi-plus'" size="16" :class="{ 'mdi-spin': contractUploading }" />
      {{ contractUploading ? 'Загрузка...' : 'Добавить' }}
    </button>
  </div>
  <input ref="contractInputRef" type="file" accept="image/*" multiple hidden @change="onContractFilesSelected" />

  <div v-if="deal?.contractPhotos?.length" class="contract-photo-grid">
    <div v-for="(url, i) in deal.contractPhotos" :key="i" class="contract-photo-item">
      <img
        :src="url"
        class="contract-photo-img"
        @click="contractEnlargeUrl = url; contractEnlargeDialog = true"
      />
      <button class="contract-photo-remove" @click="removeContractPhoto(i)">
        <v-icon icon="mdi-close" size="14" />
      </button>
    </div>
  </div>

  <div v-else class="text-center pa-6 text-medium-emphasis text-body-2">
    <v-icon icon="mdi-file-document-outline" size="32" class="mb-2" style="opacity: 0.3;" />
    <div>Нет документов</div>
    <div class="text-caption mt-1" style="opacity: 0.5;">Фото договора, паспортов, справок</div>
  </div>
</v-card>

<!-- Contract enlarge dialog -->
<v-dialog v-model="contractEnlargeDialog" max-width="800" :fullscreen="isMobile">
  <v-card rounded="lg">
    <img :src="contractEnlargeUrl" style="width: 100%; height: auto; display: block;" />
    <v-card-actions>
      <v-spacer />
      <v-btn variant="text" @click="contractEnlargeDialog = false">Закрыть</v-btn>
    </v-card-actions>
  </v-card>
</v-dialog>
  </div>
</template>

<style scoped>
.dc-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 16px;
  align-items: start;
}
.dc-cols > * {
  margin-bottom: 0 !important;
}

/* Стили перенесены со страницы сделки без изменений. */
.contract-icon {
  width: 40px; height: 40px; border-radius: 10px;
  background: rgba(59, 130, 246, 0.08);
  display: flex; align-items: center; justify-content: center;
}
.contract-photo-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.contract-photo-item { position: relative; width: 100px; height: 100px; }
.contract-photo-img {
  width: 100%; height: 100%; object-fit: cover; border-radius: 10px;
  cursor: pointer; transition: opacity 0.15s;
}
.contract-photo-img:hover { opacity: 0.85; }
.contract-photo-remove {
  position: absolute; top: -6px; right: -6px;
  width: 22px; height: 22px; border-radius: 50%; border: none;
  background: #ef4444; color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0; transition: opacity 0.15s;
}
.contract-photo-item:hover .contract-photo-remove { opacity: 1; }

/* Кнопка «Загрузить фото» — тот же вид, что на странице сделки. */
.btn-sm--outline {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.btn-sm--outline:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  color: rgb(var(--v-theme-primary));
}
.btn-sm--outline:disabled { opacity: 0.4; cursor: not-allowed; }

.pdf-docs-card { padding: 0 !important; overflow: hidden; }
.pdf-docs-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.pdf-docs-header-left { display: flex; align-items: center; gap: 12px; }
.pdf-docs-builder-link {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 7px;
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  text-decoration: none; transition: all 0.12s;
}
.pdf-docs-builder-link:hover { background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.7); }
.pdf-docs-list { display: flex; flex-direction: column; }
.pdf-doc-item {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 20px; border: none; background: none;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.04);
  cursor: pointer; transition: background 0.12s; text-align: left;
  width: 100%; color: inherit;
}
.pdf-doc-item:last-child { border-bottom: none; }
.pdf-doc-item:hover { background: rgba(var(--v-theme-on-surface), 0.02); }
.pdf-doc-item:disabled { opacity: 0.4; cursor: not-allowed; }
.pdf-doc-item:disabled:hover { background: none; }
.pdf-doc-item-info { flex: 1; min-width: 0; }
.pdf-doc-item-name {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.pdf-doc-item-desc {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 1px;
}
.pdf-doc-item-action {
  color: rgba(var(--v-theme-on-surface), 0.2); flex-shrink: 0;
  transition: color 0.12s;
}
.pdf-doc-item:hover .pdf-doc-item-action { color: rgba(var(--v-theme-on-surface), 0.5); }

/* Row wrapper that pairs the download button with a small WhatsApp action */
.pdf-doc-row {
  display: flex; align-items: stretch;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.04);
}
.pdf-doc-row:last-child { border-bottom: none; }
.pdf-doc-row .pdf-doc-item {
  flex: 1;
  border-bottom: none; /* parent row handles the line */
}
.pdf-wa-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; flex-shrink: 0;
  border: none; border-left: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: transparent;
  color: #25d366;
  cursor: pointer; transition: all 0.15s;
}
.pdf-wa-btn:hover {
  background: rgba(37, 211, 102, 0.08);
}
.pdf-wa-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.dark .pdf-docs-header { border-color: rgba(255,255,255,0.06); }
.dark .pdf-doc-item { border-color: rgba(255,255,255,0.04); }
.dark .pdf-doc-row { border-color: rgba(255,255,255,0.04); }
.dark .pdf-wa-btn { border-color: rgba(255,255,255,0.06); }
.dark .pdf-doc-item:hover { background: rgba(255,255,255,0.02); }

.section-title { font-size: 15px; font-weight: 600; }
</style>
