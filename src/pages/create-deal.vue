<script lang="ts" setup>
import { useDealsStore } from '@/stores/deals'
import { useAuthStore } from '@/stores/auth'
import { formatCurrency, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { CATEGORIES } from '@/constants/categories'
import { CITIES } from '@/constants/cities'
import { useRouter, useRoute } from 'vue-router'
import type { PaymentType, ClientProfile, DealFolder } from '@/types'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useCapital } from '@/composables/useCapital'
import { useFolders } from '@/composables/useFolders'
import { api } from '@/api/client'
import ClientPicker from '@/components/ClientPicker.vue'
import CreateClientDialog from '@/components/CreateClientDialog.vue'

const authStore = useAuthStore()

const { isDark } = useIsDark()
const toast = useToast()
const { capital, isCapitalSet, fetchCapital } = useCapital()

// Capital is fetched in the co-investors onMounted below

const capitalInsufficient = computed(() => {
  if (!isCapitalSet.value || !capital.value) return false
  return (purchasePrice.value || 0) > capital.value.availableCapital
})

const capitalAfterDeal = computed(() => {
  if (!capital.value) return 0
  return capital.value.availableCapital - (purchasePrice.value || 0)
})
const dealsStore = useDealsStore()
const router = useRouter()
const route = useRoute()

const editId = computed(() => (route.query.edit as string) || null)
const isEditMode = computed(() => !!editId.value)

// Plan-limit gate. Editing existing deals is always allowed (Approach A:
// read-only freeze means existing deals stay editable; only NEW deal
// creation is blocked when over the active-deal limit).
const dealLimitInfo = computed(() => {
  const limit = authStore.user?.planLimits?.maxActiveDeals ?? -1
  const active = authStore.user?.activeDeals ?? 0
  return {
    limit,
    active,
    blocked: !isEditMode.value && limit > 0 && active >= limit,
    plan: authStore.user?.subscriptionPlan ?? 'FREE',
  }
})

function goToSubscription() {
  router.push({ path: '/settings', query: { tab: 'subscription' } })
}

const step = ref(1)
const steps = [
  { num: 1, title: 'Товар', icon: 'mdi-package-variant-closed' },
  { num: 2, title: 'Условия', icon: 'mdi-calculator-variant' },
  { num: 3, title: 'Клиент', icon: 'mdi-account' },
  { num: 4, title: 'Обзор', icon: 'mdi-check-decagram' },
]

// Step 1: Product
const productName = ref('')
const productDescription = ref('')
const category = ref('')
const city = ref('')
const photoFiles = ref<File[]>([])
const photoPreviewUrls = ref<string[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const contractFiles = ref<File[]>([])
const contractPreviewUrls = ref<string[]>([])
const contractInput = ref<HTMLInputElement | null>(null)

function onPhotoSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) {
    const remaining = 8 - photoFiles.value.length
    const files = Array.from(input.files).filter(f => f.type.startsWith('image/')).slice(0, remaining)
    for (const file of files) {
      photoFiles.value.push(file)
      photoPreviewUrls.value.push(URL.createObjectURL(file))
    }
  }
  if (fileInput.value) fileInput.value.value = ''
}

function removePhoto(index: number) {
  const url = photoPreviewUrls.value[index]
  if (url) URL.revokeObjectURL(url)
  photoFiles.value.splice(index, 1)
  photoPreviewUrls.value.splice(index, 1)
}

function onContractSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) {
    const remaining = 10 - contractFiles.value.length
    const files = Array.from(input.files).filter(f => f.type.startsWith('image/')).slice(0, remaining)
    for (const file of files) {
      contractFiles.value.push(file)
      contractPreviewUrls.value.push(URL.createObjectURL(file))
    }
  }
  if (contractInput.value) contractInput.value.value = ''
}

function removeContract(index: number) {
  const url = contractPreviewUrls.value[index]
  if (url) URL.revokeObjectURL(url)
  contractFiles.value.splice(index, 1)
  contractPreviewUrls.value.splice(index, 1)
}

// Step 2: Terms
const purchasePrice = ref<number | null>(null)
const markupType = ref<'percent' | 'fixed'>('percent')
const markupValue = ref(15)
const downPayment = ref<number | null>(null)
const termMonths = ref(6)
const paymentType = ref<PaymentType>('EQUAL')
const paymentInterval = ref('MONTHLY')
const dealDate = ref(new Date().toISOString().slice(0, 10))
const customFirstPayment = ref('')

const markupOptions = [10, 15, 20, 25]
const termOptions = [3, 4, 6, 9, 12, 18, 24]

// Co-investors
interface CoInvestorOption {
  id: string
  name: string
  phone: string | null
  profitPercent: number
}
const allCoInvestors = ref<CoInvestorOption[]>([])
const selectedCoInvestorIds = ref<string[]>([])

// Folder (single — a deal lives in at most one folder, or none)
const { folders: allFolders, fetchFolders } = useFolders()
const selectedFolderId = ref<string | null>(null)

onMounted(async () => {
  try {
    const [data] = await Promise.all([
      api.get<any[]>('/co-investors'),
      fetchCapital(),
      fetchFolders(),
    ])
    allCoInvestors.value = data.map(ci => ({ id: ci.id, name: ci.name, phone: ci.phone, profitPercent: ci.profitPercent }))
  } catch { /* ignore */ }

  // Load deal data for edit mode
  if (editId.value) {
    try {
      const deal = await dealsStore.fetchDeal(editId.value)
      if (!deal) {
        toast.error('Сделка не найдена')
        router.push('/deals')
        return
      }
      // Populate form
      productName.value = deal.productName || ''
      purchasePrice.value = deal.purchasePrice
      markupType.value = 'percent'
      markupValue.value = Math.round(deal.markupPercent * 100) / 100
      downPayment.value = deal.downPayment || null
      termMonths.value = deal.numberOfPayments
      paymentType.value = deal.paymentType as PaymentType
      paymentInterval.value = deal.paymentInterval || 'MONTHLY'
      dealDate.value = deal.dealDate ? new Date(deal.dealDate).toISOString().slice(0, 10) : dealDate.value
      customFirstPayment.value = deal.firstPaymentDate ? new Date(deal.firstPaymentDate).toISOString().slice(0, 10) : ''
      selectedClientProfileId.value = deal.clientProfileId || null
      selectedGuarantorProfileId.value = deal.guarantorProfileId || null
      if (deal.clientProfile) selectedClientProfile.value = deal.clientProfile
      if (deal.guarantorProfile) selectedGuarantorProfile.value = deal.guarantorProfile
      selectedFolderId.value = (deal as any).folderId || null
    } catch (e: any) {
      toast.error(e.message || 'Не удалось загрузить сделку')
      router.push('/deals')
    }
  }
})

const selectedCoInvestors = computed(() =>
  allCoInvestors.value.filter(ci => selectedCoInvestorIds.value.includes(ci.id))
)

const selectedFolder = computed<DealFolder | null>(() =>
  selectedFolderId.value
    ? allFolders.value.find(f => f.id === selectedFolderId.value) ?? null
    : null
)

function toggleCoInvestor(id: string) {
  const idx = selectedCoInvestorIds.value.indexOf(id)
  if (idx >= 0) {
    selectedCoInvestorIds.value.splice(idx, 1)
  } else {
    selectedCoInvestorIds.value.push(id)
  }
}

// Markup type switch with value conversion
function switchMarkupType(type: 'percent' | 'fixed') {
  if (markupType.value === type) return
  const purchase = purchasePrice.value || 0
  if (type === 'fixed') {
    markupValue.value = purchase > 0 ? Math.round(purchase * markupValue.value / 100) : 0
  } else {
    markupValue.value = purchase > 0 ? Math.round((markupValue.value / purchase) * 100) : 0
  }
  markupType.value = type
}

// Total price ↔ markup sync.
// `manualTotalPrice` keeps the exact value the partner typed into the totalPrice
// field — without it, percent rounding would drop kopecks (e.g. 99 250 → 99 246).
// Cleared automatically as soon as the partner edits any other related field.
const manualTotalPrice = ref<number | null>(null)

const totalPriceInput = computed(() => totalPrice.value || '')

function onTotalPriceInput(value: number) {
  const purchase = purchasePrice.value || 0
  if (!value || purchase <= 0) return
  const markupAmount = value - purchase
  if (markupAmount < 0) return
  manualTotalPrice.value = value
  // Sync markupValue for display in the markup field — but it's no longer
  // the source of truth, manualTotalPrice is.
  if (markupType.value === 'percent') {
    markupValue.value = Math.round((markupAmount / purchase) * 100 * 100) / 100
  } else {
    markupValue.value = markupAmount
  }
}

// Any change to purchase / markup / type drops the manual override —
// from then on, totalPrice is derived from markup again.
watch([purchasePrice, markupValue, markupType], () => {
  manualTotalPrice.value = null
})

// Computed deal preview
const markup = computed(() => {
  const purchase = purchasePrice.value || 0
  if (manualTotalPrice.value !== null) {
    return Math.max(0, manualTotalPrice.value - purchase)
  }
  return markupType.value === 'percent'
    ? Math.round(purchase * markupValue.value / 100)
    : markupValue.value
})
const markupPercent = computed(() => {
  const purchase = purchasePrice.value || 0
  if (manualTotalPrice.value !== null && purchase > 0) {
    return Math.round((markup.value / purchase) * 100 * 100) / 100
  }
  return markupType.value === 'percent'
    ? markupValue.value
    : (purchase > 0 ? Math.round((markupValue.value / purchase) * 100 * 100) / 100 : 0)
})
const totalPrice = computed(() =>
  manualTotalPrice.value !== null
    ? manualTotalPrice.value
    : (purchasePrice.value || 0) + markup.value,
)
const downPaymentAmount = computed(() => downPayment.value || 0)
const remainingAmount = computed(() => totalPrice.value - downPaymentAmount.value)
const monthlyPayment = computed(() => termMonths.value > 0 ? remainingAmount.value / termMonths.value : 0)

const firstPaymentDate = computed(() => {
  if (customFirstPayment.value) {
    return new Date(customFirstPayment.value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  }
  const d = new Date(dealDate.value)
  if (paymentInterval.value === 'WEEKLY') d.setDate(d.getDate() + 7)
  else if (paymentInterval.value === 'BIWEEKLY') d.setDate(d.getDate() + 14)
  else d.setMonth(d.getMonth() + 1)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
})

// Step 3: Client
const selectedClientProfileId = ref<string | null>(null)
const selectedGuarantorProfileId = ref<string | null>(null)

// Selected profiles (resolved by ClientPicker)
const selectedClientProfile = ref<ClientProfile | null>(null)
const selectedGuarantorProfile = ref<ClientProfile | null>(null)

const clientPickerRef = ref<InstanceType<typeof ClientPicker> | null>(null)

function onClientSelected(profile: ClientProfile | null) {
  selectedClientProfile.value = profile
}
function onGuarantorSelected(profile: ClientProfile | null) {
  selectedGuarantorProfile.value = profile
}

// Create client dialog
const showCreateDialog = ref(false)

function openCreateDialog() {
  showCreateDialog.value = true
}

function onClientCreated(profile: ClientProfile) {
  clientPickerRef.value?.selectProfile(profile)
}

// Preview helpers
const categoryOption = computed(() => CATEGORIES.find((c) => c.id === category.value))

function formatDateRU(dateStr: string) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function getClientDisplayName(p: ClientProfile | null): string {
  if (!p) return ''
  return [p.lastName, p.firstName, p.patronymic].filter(Boolean).join(' ')
}

// Validation
const step1Valid = computed(() => !!productName.value)
const step2Valid = computed(() => (purchasePrice.value ?? 0) > 0 && termMonths.value > 0)
const step3Valid = computed(() => !!selectedClientProfileId.value)

function nextStep() { if (step.value < 4) step.value++ }
function prevStep() { if (step.value > 1) step.value-- }

function canProceed() {
  if (step.value === 1) return step1Valid.value
  if (step.value === 2) return step2Valid.value && isCapitalSet.value && !capitalInsufficient.value
  if (step.value === 3) return step3Valid.value
  return true
}

const submitting = ref(false)

async function submitDeal() {
  try {
    submitting.value = true

    if (isEditMode.value && editId.value) {
      // Edit flow — update fields, regenerate schedule if needed
      await dealsStore.updateDeal(editId.value, {
        productName: productName.value,
        purchasePrice: purchasePrice.value || 0,
        markupPercent: markupPercent.value,
        downPayment: downPaymentAmount.value || undefined,
        numberOfPayments: termMonths.value,
        dealDate: dealDate.value,
        firstPaymentDate: customFirstPayment.value || undefined,
      })
      toast.success('Сделка обновлена')
      router.push(`/deals/${editId.value}`)
      return
    }

    // Create flow
    let photoUrls: string[] = []
    if (photoFiles.value.length > 0) {
      photoUrls = await api.uploadMultiple(photoFiles.value, 'deals')
    }

    let contractUrls: string[] = []
    if (contractFiles.value.length > 0) {
      contractUrls = await api.uploadMultiple(contractFiles.value, 'contracts')
    }

    const deal = await dealsStore.createDirectDeal({
      clientProfileId: selectedClientProfileId.value || undefined,
      guarantorProfileId: selectedGuarantorProfileId.value || undefined,
      productName: productName.value,
      productPhotos: photoUrls.length ? photoUrls : undefined,
      contractPhotos: contractUrls.length ? contractUrls : undefined,
      purchasePrice: purchasePrice.value || 0,
      markupPercent: markupPercent.value,
      // Send explicit totalPrice when partner typed it manually — backend
      // prefers it over markupPercent to preserve the exact rubles.
      totalPrice: manualTotalPrice.value !== null ? manualTotalPrice.value : undefined,
      downPayment: downPaymentAmount.value || undefined,
      numberOfPayments: termMonths.value,
      paymentInterval: paymentInterval.value,
      paymentType: paymentType.value,
      dealDate: dealDate.value,
      firstPaymentDate: customFirstPayment.value || undefined,
    })

    // Link selected co-investors
    if (deal?.id && selectedCoInvestorIds.value.length > 0) {
      await Promise.allSettled(
        selectedCoInvestorIds.value.map(ciId =>
          api.post(`/co-investors/${ciId}/deals/${deal.id}`)
        )
      )
    }

    // Place into folder (or unfile if user cleared it). The /deal-folders/move
    // endpoint accepts null to detach. Best-effort — failure here doesn't
    // invalidate the just-created deal.
    if (deal?.id) {
      try {
        await api.post('/deal-folders/move', {
          dealId: deal.id,
          folderId: selectedFolderId.value,
        })
      } catch { /* non-blocking */ }
    }

    toast.success('Сделка создана')
    router.push('/deals')
  } catch (e: any) {
    toast.error(e.message || (isEditMode.value ? 'Ошибка обновления сделки' : 'Ошибка создания сделки'))
  } finally {
    submitting.value = false
  }
}

</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Plan-limit gate: hide the form when partner is over active-deal limit -->
    <div v-if="dealLimitInfo.blocked" class="limit-gate">
      <div class="limit-gate__icon">
        <v-icon icon="mdi-lock-alert-outline" size="40" />
      </div>
      <div class="limit-gate__title">Достигнут лимит активных сделок</div>
      <div class="limit-gate__subtitle">
        На текущем плане доступно
        <strong>{{ dealLimitInfo.limit }}</strong>
        активных сделок. Сейчас у вас:
        <strong>{{ dealLimitInfo.active }}</strong>.
      </div>
      <div class="limit-gate__hint">
        Завершите часть сделок или перейдите на более высокий тариф, чтобы создавать новые.
      </div>
      <div class="limit-gate__actions">
        <button class="limit-gate__btn limit-gate__btn--primary" @click="goToSubscription">
          Перейти к подпискам
        </button>
        <button class="limit-gate__btn limit-gate__btn--secondary" @click="router.push('/deals')">
          К списку сделок
        </button>
      </div>
    </div>

    <template v-else>
    <!-- Custom stepper header -->
    <div class="stepper-header">
      <div
        v-for="(s, i) in steps"
        :key="s.num"
        class="stepper-step"
        :class="{
          'stepper-step--active': step === s.num,
          'stepper-step--done': step > s.num,
          'stepper-step--upcoming': step < s.num,
        }"
        @click="s.num < step ? step = s.num : undefined"
      >
        <div class="stepper-dot">
          <v-icon v-if="step > s.num" icon="mdi-check" size="16" />
          <v-icon v-else :icon="s.icon" size="16" />
        </div>
        <span class="stepper-label">{{ s.title }}</span>
        <div v-if="i < steps.length - 1" class="stepper-line" :class="{ done: step > s.num }" />
      </div>
    </div>

    <div class="wizard-layout">
    <div class="wizard-main">

    <!-- Step 1: Product -->
    <div v-if="step === 1" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap">
          <v-icon icon="mdi-package-variant-closed" size="22" />
        </div>
        <div>
          <div class="step-title">Информация о товаре</div>
          <div class="step-subtitle">Укажите основные данные о товаре для сделки</div>
        </div>
      </div>

      <v-card rounded="lg" elevation="0" border class="pa-5">
        <div class="form-grid">
          <div class="form-field full-width">
            <label class="field-label">Название товара <span class="required">*</span></label>
            <input
              v-model="productName"
              type="text"
              class="field-input"
              placeholder="Например: iPhone 15 Pro Max 256GB"
            />
          </div>

          <div class="form-field full-width">
            <label class="field-label">Описание</label>
            <textarea
              v-model="productDescription"
              class="field-input field-textarea"
              placeholder="Краткое описание товара..."
              rows="3"
            />
          </div>

          <div class="form-field">
            <label class="field-label">Категория <span class="required">*</span></label>
            <div class="category-grid">
              <button
                v-for="cat in CATEGORIES"
                :key="cat.id"
                class="category-option"
                :class="{ active: category === cat.id }"
                @click="category = cat.id"
              >
                <v-icon :icon="cat.icon" size="20" />
                <span>{{ cat.label }}</span>
              </button>
            </div>
          </div>

          <div class="form-field">
            <label class="field-label">Город <span class="required">*</span></label>
            <select v-model="city" class="field-input field-select">
              <option value="" disabled>Выберите город</option>
              <option v-for="c in CITIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>

          <!-- Photos -->
          <div class="form-field full-width">
            <label class="field-label">Фото товара <span class="text-medium-emphasis">({{ photoFiles.length }}/8)</span></label>
            <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPhotoSelect" />
            <div
              v-if="photoFiles.length < 8"
              class="photo-drop-zone"
              @click="fileInput?.click()"
            >
              <v-icon icon="mdi-camera-plus-outline" size="24" />
              <span>Добавить фото</span>
            </div>
            <div v-if="photoFiles.length" class="photo-grid mt-3">
              <div v-for="(_, idx) in photoFiles" :key="idx" class="photo-grid-item">
                <img :src="photoPreviewUrls[idx]" class="photo-grid-img" />
                <button class="photo-remove-btn" @click.stop="removePhoto(idx)">
                  <v-icon icon="mdi-close" size="14" />
                </button>
              </div>
            </div>
          </div>

          <!-- Contract photos -->
          <div class="form-field full-width">
            <label class="field-label">Фото договора <span class="text-medium-emphasis">(необязательно, {{ contractFiles.length }}/10)</span></label>
            <input ref="contractInput" type="file" accept="image/*" multiple hidden @change="onContractSelect" />
            <div
              v-if="contractFiles.length < 10"
              class="photo-drop-zone"
              @click="contractInput?.click()"
            >
              <v-icon icon="mdi-file-document-outline" size="24" />
              <span>Добавить скан договора</span>
            </div>
            <div v-if="contractFiles.length" class="photo-grid mt-3">
              <div v-for="(_, idx) in contractFiles" :key="idx" class="photo-grid-item">
                <img :src="contractPreviewUrls[idx]" class="photo-grid-img" />
                <button class="photo-remove-btn" @click.stop="removeContract(idx)">
                  <v-icon icon="mdi-close" size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </v-card>
    </div>

    <!-- Step 2: Terms -->
    <div v-if="step === 2" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap">
          <v-icon icon="mdi-calculator-variant" size="22" />
        </div>
        <div>
          <div class="step-title">Условия мурабахи</div>
          <div class="step-subtitle">Настройте финансовые параметры сделки</div>
        </div>
      </div>

      <!-- Capital block -->
      <div v-if="!isCapitalSet" class="capital-block-banner mb-4">
        <div class="capital-block-banner-icon">
          <v-icon icon="mdi-lock-outline" size="22" />
        </div>
        <div class="capital-block-banner-content">
          <div class="capital-block-banner-title">Установите начальный капитал</div>
          <div class="capital-block-banner-text">Для создания сделки необходимо указать каким капиталом вы располагаете</div>
        </div>
        <button class="capital-block-banner-btn" @click="$router.push('/finance')">
          Настроить
          <v-icon icon="mdi-arrow-right" size="16" />
        </button>
      </div>

          <v-card rounded="lg" elevation="0" border class="pa-5">
            <div class="form-grid">
              <div class="form-field full-width">
                <label class="field-label">Закупочная цена <span class="required">*</span></label>
                <div class="input-with-suffix">
                  <input :value="purchasePrice || ''" v-maska="CURRENCY_MASK" @maska="(e: any) => purchasePrice = parseMasked(e)" type="text" inputmode="numeric" class="field-input" :class="{ 'field-input--error': capitalInsufficient }" placeholder="0" />
                  <span class="input-suffix">₽</span>
                </div>
                <!-- Capital hint -->
                <div v-if="isCapitalSet && capital" class="capital-hint" :class="{ 'capital-hint--error': capitalInsufficient }">
                  <v-icon :icon="capitalInsufficient ? 'mdi-alert-circle' : 'mdi-wallet-outline'" size="14" />
                  <template v-if="capitalInsufficient">
                    Недостаточно капитала. Доступно: {{ formatCurrency(capital.availableCapital) }}
                  </template>
                  <template v-else>
                    Доступно: {{ formatCurrency(capital.availableCapital) }}
                  </template>
                </div>
              </div>

              <div class="form-field full-width">
                <div class="field-label-row">
                  <label class="field-label">Наценка</label>
                  <div class="markup-type-toggle">
                    <button class="toggle-btn" :class="{ active: markupType === 'percent' }" @click="switchMarkupType('percent')">%</button>
                    <button class="toggle-btn" :class="{ active: markupType === 'fixed' }" @click="switchMarkupType('fixed')">₽</button>
                  </div>
                </div>
                <div v-if="markupType === 'percent'" class="chip-group">
                  <button
                    v-for="opt in markupOptions" :key="opt"
                    class="chip-option" :class="{ active: markupValue === opt }"
                    @click="markupValue = opt"
                  >{{ opt }}%</button>
                </div>
                <div class="input-with-suffix mt-2">
                  <input v-model.number="markupValue" type="number" class="field-input" :placeholder="markupType === 'percent' ? '15' : '15000'" min="0" />
                  <span class="input-suffix">{{ markupType === 'percent' ? '%' : '₽' }}</span>
                </div>
              </div>

              <div v-if="markupType === 'fixed'" class="form-field full-width">
                <label class="field-label">Итоговая цена</label>
                <div class="input-with-suffix">
                  <input
                    :value="totalPriceInput"
                    v-maska="CURRENCY_MASK"
                    @maska="(e: any) => onTotalPriceInput(parseMasked(e))"
                    type="text"
                    inputmode="numeric"
                    class="field-input"
                    placeholder="115 000"
                  />
                  <span class="input-suffix">₽</span>
                </div>
                <div class="field-hint-styled">
                  <v-icon icon="mdi-information-outline" size="14" />
                  Наценка рассчитается автоматически
                </div>
              </div>

              <div class="form-field full-width">
                <label class="field-label">Первоначальный взнос</label>
                <div class="input-with-suffix">
                  <input :value="downPayment || ''" v-maska="CURRENCY_MASK" @maska="(e: any) => downPayment = parseMasked(e)" type="text" inputmode="numeric" class="field-input" placeholder="0" />
                  <span class="input-suffix">₽</span>
                </div>
              </div>

              <div class="form-field full-width">
                <label class="field-label">Срок рассрочки</label>
                <div class="chip-group">
                  <button
                    v-for="opt in termOptions" :key="opt"
                    class="chip-option" :class="{ active: termMonths === opt }"
                    @click="termMonths = opt"
                  >{{ opt }} мес</button>
                </div>
                <div class="input-with-suffix mt-2">
                  <input v-model.number="termMonths" type="number" class="field-input" placeholder="6" min="1" />
                  <span class="input-suffix">мес</span>
                </div>
              </div>

              <!-- Payment type fixed: EQUAL -->

              <div class="form-field full-width">
                <label class="field-label">Дата заключения сделки</label>
                <input v-model="dealDate" type="date" class="field-input" />
              </div>

              <div class="form-field full-width">
                <label class="field-label">Дата первого платежа <span class="text-medium-emphasis">(необязательно)</span></label>
                <input v-model="customFirstPayment" type="date" class="field-input" :placeholder="firstPaymentDate" />
                <div class="first-payment-hint">
                  <div class="first-payment-hint__icon">
                    <v-icon icon="mdi-calendar-clock" size="14" />
                  </div>
                  <div>
                    <div class="first-payment-hint__date">{{ firstPaymentDate }}</div>
                    <div class="first-payment-hint__sub">Дата по умолчанию · измените при необходимости</div>
                  </div>
                </div>
              </div>
            </div>
          </v-card>

          <!-- Co-investors -->
          <v-card v-if="allCoInvestors.length > 0" rounded="lg" elevation="0" border class="pa-5 mt-4">
            <div class="section-header-sm">
              <v-icon icon="mdi-account-group-outline" size="18" />
              <span>Со-инвесторы</span>
              <span class="text-caption text-medium-emphasis ml-1">(необязательно)</span>
            </div>
            <div class="coinvestor-list">
              <button
                v-for="ci in allCoInvestors"
                :key="ci.id"
                type="button"
                class="coinvestor-option"
                :class="{ active: selectedCoInvestorIds.includes(ci.id) }"
                @click="toggleCoInvestor(ci.id)"
              >
                <div class="coinvestor-option-check">
                  <v-icon :icon="selectedCoInvestorIds.includes(ci.id) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'" size="20" />
                </div>
                <div class="coinvestor-option-info">
                  <div class="coinvestor-option-name">{{ ci.name }}</div>
                  <div class="coinvestor-option-meta">{{ ci.profitPercent }}% от прибыли</div>
                </div>
                <div v-if="selectedCoInvestorIds.includes(ci.id)" class="coinvestor-option-share">
                  {{ formatCurrency(Math.round(markup * ci.profitPercent / 100)) }}
                </div>
              </button>
            </div>
          </v-card>

          <!-- Folder -->
          <v-card v-if="allFolders.length > 0" rounded="lg" elevation="0" border class="pa-5 mt-4">
            <div class="section-header-sm">
              <v-icon icon="mdi-folder-outline" size="18" />
              <span>Папка</span>
              <span class="text-caption text-medium-emphasis ml-1">(необязательно)</span>
            </div>
            <div class="folder-list">
              <button
                type="button"
                class="folder-chip"
                :class="{ active: selectedFolderId === null }"
                @click="selectedFolderId = null"
              >
                <v-icon icon="mdi-tray-remove" size="16" />
                <span>Без папки</span>
              </button>
              <button
                v-for="f in allFolders"
                :key="f.id"
                type="button"
                class="folder-chip"
                :class="{ active: selectedFolderId === f.id }"
                :style="{
                  '--folder-color': f.color || '#6366f1',
                  borderColor: selectedFolderId === f.id ? (f.color || '#6366f1') : undefined,
                  background: selectedFolderId === f.id ? `${f.color || '#6366f1'}14` : undefined,
                  color: selectedFolderId === f.id ? (f.color || '#6366f1') : undefined,
                }"
                @click="selectedFolderId = f.id"
              >
                <v-icon :icon="f.icon || 'mdi-folder'" size="16" />
                <span>{{ f.name }}</span>
              </button>
            </div>
          </v-card>
    </div>

    <!-- Step 3: Client & Guarantor -->
    <div v-if="step === 3" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap">
          <v-icon icon="mdi-account" size="22" />
        </div>
        <div>
          <div class="step-title">Клиент и поручитель</div>
          <div class="step-subtitle">Найдите клиента в базе или создайте нового</div>
        </div>
      </div>

      <!-- Client -->
      <v-card rounded="lg" elevation="0" border class="pa-5 mb-4">
        <div class="text-subtitle-2 font-weight-bold mb-3">
          <v-icon icon="mdi-account-outline" size="18" class="mr-1" />
          Клиент <span class="text-error">*</span>
        </div>
        <ClientPicker
          ref="clientPickerRef"
          v-model="selectedClientProfileId"
          label="Поиск клиента по телефону или имени..."
          @selected="onClientSelected"
        />
      </v-card>

      <!-- Guarantor -->
      <v-card rounded="lg" elevation="0" border class="pa-5 mb-4">
        <div class="text-subtitle-2 font-weight-bold mb-3">
          <v-icon icon="mdi-shield-account-outline" size="18" class="mr-1" />
          Поручитель <span class="text-caption text-medium-emphasis font-weight-regular">(необязательно)</span>
        </div>
        <ClientPicker
          v-model="selectedGuarantorProfileId"
          label="Поиск поручителя по телефону или имени..."
          @selected="onGuarantorSelected"
        />
      </v-card>

      <!-- Create new client button -->
      <button class="create-client-btn" type="button" @click="openCreateDialog">
        <v-icon icon="mdi-account-plus-outline" size="20" />
        <div>
          <div class="create-client-btn__title">Создать нового клиента</div>
          <div class="create-client-btn__sub">Если клиента нет в базе — добавьте его с паспортными данными</div>
        </div>
      </button>

      <!-- Create client dialog -->
      <CreateClientDialog v-model="showCreateDialog" @created="onClientCreated" />
    </div>

    <!-- Step 4: Review -->
    <div v-if="step === 4" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-check-decagram" size="22" />
        </div>
        <div>
          <div class="step-title">Обзор сделки</div>
          <div class="step-subtitle">Проверьте данные перед созданием</div>
        </div>
      </div>

      <!-- Hero card — main deal summary -->
      <div class="review-hero">
        <div class="review-hero__header">
          <div class="review-hero__product">
            <div class="review-hero__product-icon">
              <v-icon icon="mdi-package-variant-closed" size="24" />
            </div>
            <div>
              <div class="review-hero__product-name">{{ productName }}</div>
              <div class="review-hero__product-meta">
                {{ new Date(dealDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) }}
                <span v-if="photoFiles.length"> · {{ photoFiles.length }} фото</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Photo strip -->
        <div v-if="photoPreviewUrls.length" class="review-hero__photos">
          <img v-for="(url, i) in photoPreviewUrls.slice(0, 4)" :key="i" :src="url" class="review-hero__photo" />
          <div v-if="photoPreviewUrls.length > 4" class="review-hero__photo-more">
            +{{ photoPreviewUrls.length - 4 }}
          </div>
        </div>

        <!-- Financial breakdown -->
        <div class="review-hero__finance">
          <div class="review-hero__finance-row">
            <span>Закупочная цена</span>
            <span>{{ formatCurrency(purchasePrice || 0) }}</span>
          </div>
          <div class="review-hero__finance-row review-hero__finance-row--accent">
            <span>Наценка {{ markupPercent }}%</span>
            <span>+{{ formatCurrency(markup) }}</span>
          </div>
          <div v-if="downPaymentAmount > 0" class="review-hero__finance-row">
            <span>Первоначальный взнос</span>
            <span>-{{ formatCurrency(downPaymentAmount) }}</span>
          </div>
          <div class="review-hero__finance-divider" />
          <div class="review-hero__finance-row review-hero__finance-row--total">
            <span>Итоговая цена</span>
            <span>{{ formatCurrency(totalPrice) }}</span>
          </div>
        </div>

        <!-- Big payment highlight -->
        <div class="review-hero__payment">
          <div class="review-hero__payment-amount">~{{ formatCurrency(monthlyPayment) }}</div>
          <div class="review-hero__payment-label">
            ежемесячный платёж · {{ termMonths }} мес · равные платежи
          </div>
          <div class="review-hero__payment-date">
            <v-icon icon="mdi-calendar-clock" size="14" />
            Первый платёж: {{ firstPaymentDate }}
          </div>
        </div>
      </div>

      <!-- Client card -->
      <div v-if="selectedClientProfile" class="review-client-card">
        <div class="review-client-card__icon">
          <div class="review-client-card__avatar" style="background: #047857;">
            {{ selectedClientProfile.firstName?.[0] }}{{ selectedClientProfile.lastName?.[0] }}
          </div>
        </div>
        <div class="review-client-card__info">
          <div class="review-client-card__name">{{ selectedClientProfile.lastName }} {{ selectedClientProfile.firstName }} {{ selectedClientProfile.patronymic || '' }}</div>
          <div class="review-client-card__meta">
            <v-icon icon="mdi-phone" size="12" /> {{ selectedClientProfile.phone }}
            <span v-if="selectedClientProfile.passportSeries" class="review-client-card__badge review-client-card__badge--platform">Паспорт заполнен</span>
          </div>
        </div>
      </div>

      <!-- Guarantor card -->
      <div v-if="selectedGuarantorProfile" class="review-client-card mt-3">
        <div class="review-client-card__icon">
          <div class="review-client-card__avatar" style="background: #6366f1;">
            {{ selectedGuarantorProfile.firstName?.[0] }}{{ selectedGuarantorProfile.lastName?.[0] }}
          </div>
        </div>
        <div class="review-client-card__info">
          <div class="review-client-card__name">{{ selectedGuarantorProfile.lastName }} {{ selectedGuarantorProfile.firstName }} {{ selectedGuarantorProfile.patronymic || '' }}</div>
          <div class="review-client-card__meta">
            <v-icon icon="mdi-shield-account-outline" size="12" /> Поручитель · {{ selectedGuarantorProfile.phone }}
          </div>
        </div>
      </div>

      <!-- Co-investors -->
      <div v-if="selectedCoInvestors.length > 0" class="review-coinvestors">
        <div class="review-coinvestors__title">
          <v-icon icon="mdi-account-group-outline" size="16" />
          Со-инвесторы ({{ selectedCoInvestors.length }})
        </div>
        <div class="review-coinvestors__list">
          <div v-for="ci in selectedCoInvestors" :key="ci.id" class="review-coinvestor-chip">
            <div class="review-coinvestor-chip__avatar">{{ ci.name[0] }}</div>
            <div class="review-coinvestor-chip__info">
              <span class="review-coinvestor-chip__name">{{ ci.name }}</span>
              <span class="review-coinvestor-chip__share">{{ ci.profitPercent }}% · {{ formatCurrency(Math.round(markup * ci.profitPercent / 100)) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Folder -->
      <div v-if="selectedFolder" class="review-coinvestors">
        <div class="review-coinvestors__title">
          <v-icon icon="mdi-folder-outline" size="16" />
          Папка
        </div>
        <div class="folder-list">
          <div
            class="folder-chip active"
            :style="{
              borderColor: selectedFolder.color || '#6366f1',
              background: `${selectedFolder.color || '#6366f1'}14`,
              color: selectedFolder.color || '#6366f1',
            }"
          >
            <v-icon :icon="selectedFolder.icon || 'mdi-folder'" size="16" />
            <span>{{ selectedFolder.name }}</span>
          </div>
        </div>
      </div>

      <!-- Confirm banner -->
      <div class="review-confirm-banner">
        <v-icon icon="mdi-shield-check-outline" size="20" />
        <div>
          <div class="review-confirm-banner__title">Всё готово к созданию</div>
          <div class="review-confirm-banner__text">
            После создания будет сформирован график из {{ termMonths }} платежей.
            Вы сможете отслеживать оплаты и отправлять напоминания клиенту.
          </div>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="step-actions">
      <button v-if="step > 1" class="btn-secondary" @click="prevStep">
        <v-icon icon="mdi-arrow-left" size="18" />
        Назад
      </button>
      <div v-else />
      <button v-if="step < 4" class="btn-primary" :disabled="!canProceed()" @click="nextStep">
        Далее
        <v-icon icon="mdi-arrow-right" size="18" />
      </button>
      <button v-else class="btn-primary btn-primary--success" :disabled="submitting" @click="submitDeal">
        <v-progress-circular v-if="submitting" indeterminate size="16" width="2" color="white" class="mr-1" />
        <v-icon v-else icon="mdi-check" size="18" />
        {{ submitting ? (isEditMode ? 'Сохранение...' : 'Создание...') : (isEditMode ? 'Сохранить изменения' : 'Создать сделку') }}
      </button>
    </div>

    </div><!-- /wizard-main -->

    <!-- Live preview -->
    <aside class="wizard-preview">
      <div class="preview-card">
        <div class="preview-header">
          <v-icon icon="mdi-file-document-check-outline" size="18" />
          <span>Превью сделки</span>
        </div>

        <!-- Product hero -->
        <div class="preview-product">
          <div v-if="photoPreviewUrls.length" class="preview-product-photo">
            <img :src="photoPreviewUrls[0]" alt="" />
          </div>
          <div v-else class="preview-product-photo preview-product-photo--empty">
            <v-icon :icon="categoryOption?.icon || 'mdi-package-variant-closed'" size="32" color="#d1d5db" />
          </div>
          <div class="preview-product-info">
            <div class="preview-product-name" :class="{ 'preview-product-name--empty': !productName }">
              {{ productName || 'Название товара' }}
            </div>
            <div class="preview-product-meta">
              <span v-if="categoryOption">
                <v-icon :icon="categoryOption.icon" size="12" />
                {{ categoryOption.label }}
              </span>
              <span v-if="city">
                <v-icon icon="mdi-map-marker-outline" size="12" />
                {{ city }}
              </span>
            </div>
          </div>
        </div>

        <!-- Financial breakdown -->
        <div class="preview-finance">
          <div class="preview-row">
            <span class="preview-row-label">Закупочная цена</span>
            <span class="preview-row-value">{{ formatCurrency(purchasePrice || 0) }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-row-label">Наценка</span>
            <span class="preview-row-value preview-row-value--accent">
              +{{ formatCurrency(markup) }}
              <small v-if="markupPercent">({{ markupPercent.toFixed(1) }}%)</small>
            </span>
          </div>
          <div class="preview-divider" />
          <div class="preview-row preview-row--total">
            <span class="preview-row-label">Итоговая цена</span>
            <span class="preview-row-value">{{ formatCurrency(totalPrice) }}</span>
          </div>
        </div>

        <!-- Down payment -->
        <div v-if="downPaymentAmount > 0" class="preview-finance preview-finance--secondary">
          <div class="preview-row">
            <span class="preview-row-label">Первоначальный взнос</span>
            <span class="preview-row-value preview-row-value--down">−{{ formatCurrency(downPaymentAmount) }}</span>
          </div>
          <div class="preview-row preview-row--remaining">
            <span class="preview-row-label">Остаток к выплате</span>
            <span class="preview-row-value">{{ formatCurrency(remainingAmount) }}</span>
          </div>
        </div>

        <!-- Schedule highlight -->
        <div v-if="monthlyPayment > 0 && termMonths > 0" class="preview-schedule">
          <div class="preview-schedule-top">Ежемесячный платёж</div>
          <div class="preview-schedule-value">~{{ formatCurrency(Math.round(monthlyPayment)) }}</div>
          <div class="preview-schedule-label">× {{ termMonths }} {{ termMonths === 1 ? 'месяц' : termMonths < 5 ? 'месяца' : 'месяцев' }} · равные платежи</div>
        </div>

        <!-- Profit / ROI -->
        <div v-if="markup > 0" class="preview-metrics">
          <div class="preview-metric">
            <div class="preview-metric-label">Прибыль</div>
            <div class="preview-metric-value preview-metric-value--green">{{ formatCurrency(markup) }}</div>
          </div>
          <div class="preview-metric">
            <div class="preview-metric-label">ROI</div>
            <div class="preview-metric-value">{{ (purchasePrice || 0) > 0 ? ((markup / (purchasePrice || 1)) * 100).toFixed(1) : '0' }}%</div>
          </div>
        </div>

        <!-- Capital after deal -->
        <div v-if="isCapitalSet && capital && (purchasePrice || 0) > 0" class="preview-capital">
          <v-icon icon="mdi-wallet-outline" size="14" />
          <span class="preview-capital-label">Капитал после сделки</span>
          <span class="preview-capital-value">{{ formatCurrency(capitalAfterDeal) }}</span>
        </div>

        <!-- Dates -->
        <div class="preview-dates">
          <div class="preview-date">
            <v-icon icon="mdi-calendar-start-outline" size="14" />
            <span class="preview-date-label">Дата сделки</span>
            <span class="preview-date-value">{{ formatDateRU(dealDate) || '—' }}</span>
          </div>
          <div class="preview-date">
            <v-icon icon="mdi-calendar-arrow-right" size="14" />
            <span class="preview-date-label">Первый платёж</span>
            <span class="preview-date-value">{{ firstPaymentDate }}</span>
          </div>
        </div>

        <!-- Client -->
        <div v-if="selectedClientProfile" class="preview-client">
          <div class="preview-section-label">
            <v-icon icon="mdi-account-outline" size="14" />
            Клиент
          </div>
          <div class="preview-client-name">{{ getClientDisplayName(selectedClientProfile) }}</div>
          <div v-if="selectedClientProfile.phone" class="preview-client-phone">{{ selectedClientProfile.phone }}</div>
        </div>

        <!-- Guarantor -->
        <div v-if="selectedGuarantorProfile" class="preview-client">
          <div class="preview-section-label">
            <v-icon icon="mdi-account-supervisor-outline" size="14" />
            Поручитель
          </div>
          <div class="preview-client-name">{{ getClientDisplayName(selectedGuarantorProfile) }}</div>
          <div v-if="selectedGuarantorProfile.phone" class="preview-client-phone">{{ selectedGuarantorProfile.phone }}</div>
        </div>

        <!-- Co-investors -->
        <div v-if="selectedCoInvestors.length" class="preview-coinvestors">
          <div class="preview-section-label">
            <v-icon icon="mdi-account-group-outline" size="14" />
            Со-инвесторы ({{ selectedCoInvestors.length }})
          </div>
          <div class="preview-coinvestor-list">
            <div v-for="ci in selectedCoInvestors" :key="ci.id" class="preview-coinvestor">
              <span class="preview-coinvestor-name">{{ ci.name }}</span>
              <span class="preview-coinvestor-share">{{ ci.profitPercent }}%</span>
            </div>
          </div>
        </div>
      </div>
    </aside>

    </div><!-- /wizard-layout -->
    </template>
  </div>
</template>

<style scoped>
/* Plan-limit gate (blocks the form when over active-deal limit) */
.limit-gate {
  max-width: 540px;
  margin: 60px auto;
  padding: 40px 32px;
  background: #fff;
  border-radius: 16px;
  border: 1px solid #f0f0f0;
  text-align: center;
}
.limit-gate__icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(244, 67, 54, 0.1);
  color: #c62828;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}
.limit-gate__title {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 12px;
}
.limit-gate__subtitle {
  font-size: 15px;
  color: #4a4a4a;
  margin-bottom: 8px;
  line-height: 1.5;
}
.limit-gate__hint {
  font-size: 13px;
  color: #888;
  margin-bottom: 24px;
  line-height: 1.5;
}
.limit-gate__actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
.limit-gate__btn {
  padding: 12px 24px;
  border-radius: 10px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.limit-gate__btn:hover { opacity: 0.85; }
.limit-gate__btn--primary { background: #1a1a1a; color: #fff; }
.limit-gate__btn--secondary { background: #f5f5f5; color: #1a1a1a; }
.dark .limit-gate {
  background: #1a1a1a;
  border-color: #333;
}
.dark .limit-gate__title { color: #fff; }
.dark .limit-gate__subtitle { color: #ccc; }
.dark .limit-gate__hint { color: #888; }
.dark .limit-gate__btn--primary { background: #fff; color: #1a1a1a; }
.dark .limit-gate__btn--secondary { background: #2a2a2a; color: #fff; }

/* Wizard two-column layout */
.wizard-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(480px, 560px);
  gap: 24px;
  align-items: start;
}
.wizard-main {
  min-width: 0;
}
.wizard-preview {
  position: sticky;
  top: 16px;
  align-self: start;
}

@media (max-width: 1439px) {
  .wizard-layout {
    grid-template-columns: minmax(0, 1fr) 440px;
  }
}

@media (max-width: 1279px) {
  .wizard-layout {
    grid-template-columns: 1fr;
  }
  .wizard-preview {
    position: static;
    order: -1;
  }
}

/* Preview card */
.preview-card {
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 14px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.preview-product {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.preview-product-photo {
  width: 84px;
  height: 84px;
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.preview-product-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.preview-product-photo--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.15);
}
.preview-product-info {
  min-width: 0;
  flex: 1;
}
.preview-product-name {
  font-size: 17px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  line-height: 1.3;
  margin-bottom: 8px;
  word-break: break-word;
}
.preview-product-name--empty {
  color: rgba(var(--v-theme-on-surface), 0.35);
  font-weight: 500;
  font-style: italic;
}
.preview-product-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.preview-product-meta span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.preview-finance {
  background: rgba(var(--v-theme-on-surface), 0.025);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.preview-finance--secondary {
  background: transparent;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.1);
}
.preview-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-size: 14px;
}
.preview-row-label {
  color: rgba(var(--v-theme-on-surface), 0.55);
  flex-shrink: 0;
}
.preview-row-value {
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  text-align: right;
}
.preview-row-value small {
  font-size: 11px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.preview-row-value--accent {
  color: #10b981;
}
.preview-row-value--down {
  color: #ef4444;
}
.preview-row--total .preview-row-label {
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.preview-row--total .preview-row-value {
  font-size: 18px;
  color: rgba(var(--v-theme-on-surface), 1);
}
.preview-row--remaining .preview-row-value {
  color: #f59e0b;
  font-size: 14px;
}
.preview-divider {
  height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  margin: 2px 0;
}

.preview-schedule {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
  border-radius: 12px;
  padding: 20px 20px 22px;
  text-align: center;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.2);
}
.preview-schedule-top {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.85;
  margin-bottom: 6px;
}
.preview-schedule-value {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.01em;
}
.preview-schedule-label {
  font-size: 13px;
  opacity: 0.9;
  margin-top: 6px;
}

/* Profit / ROI metrics */
.preview-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.preview-metric {
  background: rgba(var(--v-theme-on-surface), 0.025);
  border-radius: 10px;
  padding: 12px 14px;
  text-align: center;
}
.preview-metric-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-bottom: 4px;
}
.preview-metric-value {
  font-size: 18px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.preview-metric-value--green {
  color: #059669;
}

/* Capital after deal */
.preview-capital {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #f5f3ff;
  border-radius: 8px;
  font-size: 12px;
  color: #7c3aed;
}
.preview-capital-label {
  flex: 1;
  font-weight: 500;
}
.preview-capital-value {
  font-weight: 700;
}
.dark .preview-capital {
  background: rgba(124, 58, 237, 0.12);
}
.dark .preview-metric {
  background: rgba(255, 255, 255, 0.03);
}

.preview-dates {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.preview-date {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.preview-date-label {
  flex: 1;
}
.preview-date-value {
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.preview-client,
.preview-coinvestors {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.preview-section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}
.preview-client-name {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.preview-client-phone {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.preview-coinvestor-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preview-coinvestor {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 8px;
  font-size: 12px;
}
.preview-coinvestor-name {
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-weight: 500;
}
.preview-coinvestor-share {
  font-weight: 600;
  color: #10b981;
}

.dark .preview-card {
  background: #1a1f2e;
  border-color: rgba(255, 255, 255, 0.08);
}
.dark .preview-finance {
  background: rgba(255, 255, 255, 0.03);
}
.dark .preview-finance--secondary {
  border-color: rgba(255, 255, 255, 0.1);
}
.dark .preview-coinvestor {
  background: rgba(255, 255, 255, 0.04);
}

/* Stepper header */
.stepper-header {
  display: flex; align-items: center;
  padding: 16px 20px; margin-bottom: 24px;
  gap: 0;
  background: #fff; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.stepper-step {
  display: flex; align-items: center; gap: 8px;
  position: relative; flex-shrink: 0;
  cursor: default;
}
.stepper-step--done { cursor: pointer; }
.stepper-dot {
  width: 36px; height: 36px; min-width: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.35);
  transition: all 0.2s;
}
.stepper-step--active .stepper-dot {
  background: #047857; color: #fff;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}
.stepper-step--done .stepper-dot {
  background: rgba(4, 120, 87, 0.12); color: #047857;
}
.stepper-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  white-space: nowrap;
}
.stepper-step--active .stepper-label {
  color: rgba(var(--v-theme-on-surface), 0.85); font-weight: 600;
}
.stepper-step--done .stepper-label { color: #047857; }
.stepper-line {
  width: 32px; min-width: 24px; height: 2px; flex-shrink: 1; flex-grow: 1;
  background: rgba(var(--v-theme-on-surface), 0.1);
  margin: 0 8px; border-radius: 1px;
  transition: background 0.2s;
}
.stepper-line.done { background: rgba(4, 120, 87, 0.3); }

@media (max-width: 700px) {
  .stepper-label { display: none; }
  .stepper-line { width: 16px; min-width: 12px; margin: 0 4px; }
  .stepper-header { justify-content: center; }
}

/* Step content */
.step-content { margin-bottom: 20px; }
.step-title-row {
  display: flex; align-items: center; gap: 14px; margin-bottom: 20px;
}
.step-icon-wrap {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
}
.step-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.step-subtitle {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Form */
.form-grid { display: flex; flex-direction: column; gap: 20px; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.field-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.field-label-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.markup-type-toggle {
  display: flex; gap: 2px; padding: 2px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.toggle-btn {
  padding: 4px 12px; border-radius: 5px; border: none;
  font-size: 12px; font-weight: 600;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.45);
  cursor: pointer; transition: all 0.15s;
}
.toggle-btn.active {
  background: #fff; color: rgba(var(--v-theme-on-surface), 0.8);
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
}
.field-hint-styled {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; padding: 8px 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
  font-size: 12px; font-weight: 500;
}
.required { color: #ef4444; }
.field-input {
  width: 100%; height: 44px; padding: 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.03);
  outline: none; transition: all 0.15s;
}
.field-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.3); }
.field-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M3 5l3 3 3-3'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 36px;
}
.category-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px;
}
.category-option {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 12px 8px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 11px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.category-option:hover {
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
}
.category-option.active {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.3);
}
.field-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}
.field-textarea { height: auto; padding: 12px 14px; resize: vertical; }

.input-with-suffix { position: relative; }
.input-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}
.input-with-suffix .field-input { padding-right: 36px; }

/* First payment hint */
.first-payment-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(4, 120, 87, 0.04);
  border: 1px solid rgba(4, 120, 87, 0.1);
}

.first-payment-hint__icon {
  width: 30px;
  height: 30px;
  min-width: 30px;
  border-radius: 8px;
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
  display: flex;
  align-items: center;
  justify-content: center;
}

.first-payment-hint__date {
  font-size: 13px;
  font-weight: 700;
  color: #047857;
}

.first-payment-hint__sub {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 1px;
}

.dark .first-payment-hint {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.15);
}

/* Photos */
.photo-drop-zone {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 24px; border-radius: 12px; cursor: pointer;
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 13px; font-weight: 500;
  transition: all 0.15s;
}
.photo-drop-zone:hover {
  border-color: #047857; color: #047857;
  background: rgba(4, 120, 87, 0.04);
}
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.photo-grid-item { position: relative; width: 80px; height: 80px; }
.photo-grid-img { width: 100%; height: 100%; object-fit: cover; border-radius: 10px; }
.photo-remove-btn {
  position: absolute; top: -6px; right: -6px;
  width: 22px; height: 22px; border-radius: 50%; border: none;
  background: #ef4444; color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}

/* Chip group */
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
.chip-option {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 8px 16px; border-radius: 20px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.chip-option:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.chip-option.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}
.chip-option--wide { padding: 8px 20px; }

/* Preview card */
.preview-card {
  border-radius: 14px; overflow: hidden;
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.06) 0%, rgba(4, 120, 87, 0.02) 100%);
  border: 1px solid rgba(4, 120, 87, 0.12);
  position: sticky; top: 80px;
}
.preview-hero {
  padding: 28px 24px 20px; text-align: center;
}
.preview-hero-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 4px;
}
.preview-hero-value {
  font-size: 32px; font-weight: 800;
  color: #047857; line-height: 1.2;
}
.preview-hero-sub {
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 4px;
}
.preview-rows { padding: 16px 24px; }
.preview-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 7px 0; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.preview-value {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.preview-value--bold {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.preview-row--highlight-bg {
  margin: 4px -8px; padding: 8px 8px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.preview-divider {
  height: 1px; margin: 0 24px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.preview-profit {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  padding: 16px 24px 20px;
}
.preview-profit-item {
  padding: 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  text-align: center;
}
.preview-profit-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 4px;
}
.preview-profit-value {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.preview-profit-value--green { color: #047857; }
.preview-footer {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 12px 24px 16px;
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Client selection */
.filter-input-wrap { position: relative; }
.filter-input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #9ca3af; pointer-events: none;
}
.filter-input {
  width: 100%; height: 42px; padding: 0 16px 0 38px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  font-size: 14px; color: inherit;
  outline: none; transition: all 0.15s;
}
.filter-input::placeholder { color: #9ca3af; }
.filter-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}

.client-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;
}
.client-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px; border-radius: 12px;
  border: 2px solid transparent;
  background: rgba(var(--v-theme-on-surface), 0.03);
  cursor: pointer; transition: all 0.15s;
}
.client-card:hover {
  background: rgba(var(--v-theme-primary), 0.04);
  border-color: rgba(var(--v-theme-primary), 0.15);
}
.client-card.active {
  background: rgba(var(--v-theme-primary), 0.06);
  border-color: #047857;
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.1);
}
.client-avatar {
  width: 40px; height: 40px; min-width: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);
  transition: all 0.15s;
}
.client-card.active .client-avatar { color: #fff; }
.client-info { flex: 1; min-width: 0; }
.client-name {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.client-meta {
  display: flex; gap: 10px; margin-top: 2px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.client-meta span { display: flex; align-items: center; gap: 3px; }
.client-check { flex-shrink: 0; }

/* Review */
.review-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;
}
.review-section-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 16px; padding-bottom: 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.review-rows { display: flex; flex-direction: column; gap: 10px; }
.review-row { display: flex; justify-content: space-between; align-items: center; }
.review-label { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45); }
.review-value {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  text-align: right;
}
.review-row--bold .review-label { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.65); }
.review-row--bold .review-value { font-size: 15px; }
.review-client { display: flex; align-items: center; gap: 14px; }

/* Info banner */
.info-banner {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 14px 16px; border-radius: 10px;
  background: rgba(59, 130, 246, 0.06);
  color: #3b82f6; font-size: 13px;
  border: 1px solid rgba(59, 130, 246, 0.12);
}

/* Actions */
.step-actions {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 8px;
}
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px; padding: 0 24px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.btn-primary:hover { background: #065f46; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary--success { background: #047857; }
.btn-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px; padding: 0 24px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.04); }

/* Dark mode */
.dark .toggle-btn.active {
  background: #252538; color: #e4e4e7;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.dark .markup-type-toggle { background: #1e1e2e; }
.dark .field-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .field-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .filter-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .filter-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .preview-card { background: linear-gradient(135deg, rgba(4, 120, 87, 0.1) 0%, rgba(4, 120, 87, 0.04) 100%); border-color: rgba(4, 120, 87, 0.2); }
.dark .preview-row--highlight-bg { background: rgba(0,0,0,0.15); }
.dark .preview-profit-item { background: rgba(0,0,0,0.15); }
.dark .preview-divider { background: rgba(255,255,255,0.06); }
.dark .client-card { background: #1e1e2e; }
.dark .client-card.active { background: rgba(4, 120, 87, 0.08); }
.dark .photo-drop-zone { border-color: #2e2e42; }

/* ─── Review Hero ─── */
.review-hero {
  border-radius: 16px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: #fff;
  margin-bottom: 16px;
}
.review-hero__header {
  padding: 20px 24px 16px;
}
.review-hero__product {
  display: flex; align-items: center; gap: 14px;
}
.review-hero__product-icon {
  width: 48px; height: 48px; border-radius: 14px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.review-hero__product-name {
  font-size: 17px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.review-hero__product-meta {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}

/* Photos strip */
.review-hero__photos {
  display: flex; gap: 6px; padding: 0 24px 16px; overflow-x: auto;
}
.review-hero__photo {
  width: 72px; height: 72px; border-radius: 10px; object-fit: cover;
  flex-shrink: 0;
}
.review-hero__photo-more {
  width: 72px; height: 72px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Finance breakdown */
.review-hero__finance {
  padding: 16px 24px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.review-hero__finance-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 5px 0; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.review-hero__finance-row span:last-child {
  font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.8);
}
.review-hero__finance-row--accent span:last-child { color: #047857; }
.review-hero__finance-row--total {
  font-size: 15px; font-weight: 700; padding: 6px 0;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.review-hero__finance-row--total span:last-child { color: #047857; font-size: 16px; }
.review-hero__finance-divider {
  height: 1px; margin: 6px 0;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

/* Big payment block */
.review-hero__payment {
  padding: 20px 24px; text-align: center;
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.06) 0%, rgba(4, 120, 87, 0.02) 100%);
}
.review-hero__payment-amount {
  font-size: 28px; font-weight: 800; color: #047857;
  letter-spacing: -0.5px;
}
.review-hero__payment-label {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 4px;
}
.review-hero__payment-date {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 10px; padding: 5px 12px; border-radius: 8px;
  background: rgba(4, 120, 87, 0.08);
  font-size: 12px; font-weight: 600; color: #047857;
}

/* Client card */
.review-client-card {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 20px; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: #fff;
  margin-bottom: 16px;
}
.review-client-card__avatar {
  width: 44px; height: 44px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700; color: #fff;
}
.review-client-card__name {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.review-client-card__meta {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 3px;
}
.review-client-card__badge {
  padding: 2px 8px; border-radius: 6px;
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.3px; margin-left: 6px;
}
.review-client-card__badge--external {
  background: rgba(99, 102, 241, 0.1); color: #6366f1;
}
.review-client-card__badge--platform {
  background: rgba(4, 120, 87, 0.1); color: #047857;
}

/* Confirm banner */
.review-confirm-banner {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px 18px; border-radius: 14px;
  background: #fff;
  border: 1px solid rgba(4, 120, 87, 0.15);
  color: #047857;
}
.review-confirm-banner__title {
  font-size: 14px; font-weight: 700;
}
.review-confirm-banner__text {
  font-size: 12px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}

/* Dark overrides for review */
.dark .stepper-header { background: #1e1e2e; border-color: #2e2e42; }
.dark .review-hero { background: #1e1e2e; border-color: #2e2e42; }
.dark .review-hero__finance { border-color: #2e2e42; }
.dark .review-hero__payment { background: linear-gradient(135deg, rgba(4, 120, 87, 0.1) 0%, rgba(4, 120, 87, 0.04) 100%); }
.dark .review-client-card { background: #1e1e2e; border-color: #2e2e42; }
.dark .review-confirm-banner { background: rgba(4, 120, 87, 0.08); border-color: rgba(4, 120, 87, 0.2); }

/* Create client button */
.create-client-btn {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px 20px;
  border-radius: 12px;
  border: 1px dashed rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.03);
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.create-client-btn:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.create-client-btn__title {
  font-size: 14px;
  font-weight: 600;
}
.create-client-btn__sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.form-section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 12px;
}
.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
.dark .create-client-btn {
  background: rgba(var(--v-theme-primary), 0.05);
  border-color: rgba(var(--v-theme-primary), 0.2);
}
@media (max-width: 600px) {
  .form-row-2 { grid-template-columns: 1fr; }
}

/* ─── Capital validation ─── */
.capital-block-banner {
  display: flex; align-items: center; gap: 16px;
  padding: 18px 20px; border-radius: 14px;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.06) 0%, rgba(239, 68, 68, 0.02) 100%);
  border: 1px solid rgba(239, 68, 68, 0.15);
}
.capital-block-banner-icon {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  background: rgba(239, 68, 68, 0.1); color: #ef4444;
  display: flex; align-items: center; justify-content: center;
}
.capital-block-banner-content { flex: 1; }
.capital-block-banner-title {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.capital-block-banner-text {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.capital-block-banner-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 8px; border: none;
  background: #ef4444; color: #fff;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.capital-block-banner-btn:hover { background: #dc2626; }

.capital-hint {
  display: flex; align-items: center; gap: 6px;
  margin-top: 6px; font-size: 12px; font-weight: 500;
  color: #7c3aed;
}
.capital-hint--error { color: #ef4444; }

.field-input--error {
  border-color: rgba(239, 68, 68, 0.4) !important;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08) !important;
}

.dark .capital-block-banner {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(239, 68, 68, 0.04) 100%);
  border-color: rgba(239, 68, 68, 0.2);
}

/* ─── Co-investor selection (Step 2) ─── */
.section-header-sm {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 14px;
}
.coinvestor-list {
  display: flex; flex-direction: column; gap: 8px;
}
.coinvestor-option {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.03);
  cursor: pointer; transition: all 0.15s;
  width: 100%; text-align: left;
}
.coinvestor-option:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.coinvestor-option.active {
  background: rgba(4, 120, 87, 0.06);
  box-shadow: inset 0 0 0 2px rgba(4, 120, 87, 0.2);
}
.coinvestor-option-check {
  flex-shrink: 0;
  color: rgba(var(--v-theme-on-surface), 0.25);
}
.coinvestor-option.active .coinvestor-option-check {
  color: #047857;
}
.coinvestor-option-info {
  flex: 1; min-width: 0;
}
.coinvestor-option-name {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.coinvestor-option-meta {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 1px;
}
.coinvestor-option-share {
  font-size: 13px; font-weight: 700;
  color: #047857; flex-shrink: 0;
}

/* ─── Folder picker (Step 2) ─── */
.folder-list {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.folder-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.folder-chip:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-color: rgba(var(--v-theme-on-surface), 0.20);
}
.folder-chip.active {
  font-weight: 600;
}

/* ─── Co-investors in Review (Step 4) ─── */
.review-coinvestors {
  padding: 16px 20px; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: #fff;
  margin-bottom: 16px;
}
.review-coinvestors__title {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 12px;
}
.review-coinvestors__list {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.review-coinvestor-chip {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px 8px 8px; border-radius: 10px;
  background: rgba(4, 120, 87, 0.05);
  border: 1px solid rgba(4, 120, 87, 0.12);
}
.review-coinvestor-chip__avatar {
  width: 32px; height: 32px; border-radius: 8px;
  background: #047857; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; flex-shrink: 0;
}
.review-coinvestor-chip__info {
  display: flex; flex-direction: column;
}
.review-coinvestor-chip__name {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.review-coinvestor-chip__share {
  font-size: 11px; font-weight: 500;
  color: #047857;
}

/* Dark overrides for co-investors */
.dark .coinvestor-option { background: #1e1e2e; }
.dark .coinvestor-option.active { background: rgba(4, 120, 87, 0.1); }
.dark .review-coinvestors { background: #1e1e2e; border-color: #2e2e42; }
.dark .review-coinvestor-chip { background: rgba(4, 120, 87, 0.1); border-color: rgba(4, 120, 87, 0.2); }
</style>