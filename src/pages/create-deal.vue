<script lang="ts" setup>
import { useDealsStore } from '@/stores/deals'
import SelectField from '@/components/SelectField.vue'
import AccountSelect from '@/components/AccountSelect.vue'
import { todayIso } from '@/utils/dateInput'
import { useAuthStore } from '@/stores/auth'
import {
  availableTerms,
  curveMarkupForDown,
  matchRule,
  minDownPaymentFor,
  pickRuleForDown,
  scheduleShape,
  totalFor,
  totalForEqualPayments,
  totalWithMinMarkup,
  type MarkupBase,
  type ProgramDownMode,
  type ProgramRounding,
  type ProgramRoundingTarget,
  type ProgramRule,
} from '@/utils/programMath'
import { formatCurrency, CURRENCY_MASK, PERCENT_MASK, parseMasked, maskedMoney, maskedPercent } from '@/utils/formatters'
import { CATEGORIES } from '@/constants/categories'
import { CITIES } from '@/constants/cities'
import { useRouter, useRoute } from 'vue-router'
import type { PaymentType, ClientProfile, DealFolder } from '@/types'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useIsMobile } from '@/composables/useIsMobile'
import { useFolders } from '@/composables/useFolders'
import { useDealDraft, type DealDraft } from '@/composables/useDealDraft'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useAccountingStore } from '@/stores/accounting'
import { useCashBoxesStore } from '@/stores/cashboxes'
import GuarantorRiskAlert, { type GuarantorBrief } from '@/components/GuarantorRiskAlert.vue'
import { useSuppliersStore } from '@/stores/suppliers'
import { useSubscription } from '@/composables/useSubscription'
import { useSections } from '@/composables/useSections'
import { api } from '@/api/client'
import DateField from '@/components/DateField.vue'
import CreateClientDialog from '@/components/CreateClientDialog.vue'
import SupplierFormDialog from '@/components/SupplierFormDialog.vue'
import SupplierSelect from '@/components/SupplierSelect.vue'
import ProgramEditDialog from '@/components/ProgramEditDialog.vue'
import DealPeoplePicker from '@/components/DealPeoplePicker.vue'

const authStore = useAuthStore()
const suppliersStore = useSuppliersStore()
const subscription = useSubscription()
const sections = useSections()
const suppliersEnabled = computed(() => sections.visible('suppliers'))
// Партнёр-поставщик, у которого выкуплен товар, и оплачен ли он.
const selectedSupplierId = ref<string | null>(null)
const paidToSupplier = ref(true)
const supplierFormOpen = ref(false)
// Если пришли из заявки поставщика — линкуем её при создании сделки.
const fromSupplierRequestId = ref<string | null>(null)
const supplierItems = computed(() =>
  suppliersStore.rows.map((s) => ({ title: s.city ? `${s.name} · ${s.city}` : s.name, value: s.id })),
)
// Сумма долга = оптовая (если задана) иначе закупочная — как deployAmountFor на бэке.
const supplierDebtAmount = computed(() =>
  useWholesalePrice.value && (wholesalePrice.value || 0) > 0 ? (wholesalePrice.value || 0) : (purchasePrice.value || 0),
)
async function onSupplierCreated() {
  await suppliersStore.fetchList({ sort: 'name' })
  toast.success('Партнёр добавлен — выберите его в списке')
}

const { isDark } = useIsDark()
const { isMobile } = useIsMobile()
const toast = useToast()
// Per-cashbox capital. Loaded for the currently selected cashbox so the
// "доступно" hint and the insufficient-capital warning reflect what's
// actually in that box (not the partner's global capital).
const cashBoxCapital = ref<{ availableCapital: number } | null>(null)
const cashBoxCapitalLoading = ref(false)

async function fetchCashBoxCapital(cashBoxId: string | null) {
  if (!cashBoxId) {
    cashBoxCapital.value = null
    return
  }
  cashBoxCapitalLoading.value = true
  try {
    cashBoxCapital.value = await api.get(`/cashboxes/${cashBoxId}/capital`)
  } catch {
    cashBoxCapital.value = null
  } finally {
    cashBoxCapitalLoading.value = false
  }
}

const capitalInsufficient = computed(() => {
  if (!cashBoxCapital.value) return false
  return (purchasePrice.value || 0) > cashBoxCapital.value.availableCapital
})

const capitalDeficit = computed(() => {
  if (!cashBoxCapital.value) return 0
  return Math.max(0, (purchasePrice.value || 0) - cashBoxCapital.value.availableCapital)
})

const capitalAfterDeal = computed(() => {
  if (!cashBoxCapital.value) return 0
  return cashBoxCapital.value.availableCapital - (purchasePrice.value || 0)
})
const dealsStore = useDealsStore()
const router = useRouter()
const route = useRoute()

const editId = computed(() => (route.query.edit as string) || null)

/**
 * Форма ждёт данные редактируемой сделки или черновика.
 *
 * Значение выставляется СИНХРОННО, до первой отрисовки: иначе на время
 * загрузки мастер показывает пустые поля, и это читается как «создаём новую
 * сделку» — партнёр может начать заполнять её заново поверх существующей.
 */
const prefillLoading = ref(!!route.query.edit || route.query.resume === '1')
const prefillLabel = computed(() =>
  route.query.edit ? 'Загружаем сделку' : 'Восстанавливаем черновик',
)
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
/**
 * Счета сделки. Пусто — сервер подставит сам: счёт кассы, потом счёт по
 * умолчанию для этого вида денег. Спрашиваем не потому, что нужно всегда, а
 * потому что закупка и первый взнос часто идут через разные счета.
 */
const deployAccountId = ref<string | null>(null)
const downPaymentAccountId = ref<string | null>(null)
const accountingStore = useAccountingStore()
const usableAccounts = computed(() =>
  accountingStore.accounts.filter((a) => !a.disabledAt),
)

const purchasePrice = ref<number | null>(null)
const markupType = ref<'percent' | 'fixed'>('percent')
const markupValue = ref(15)
// Down payment supports two input modes, mirroring the markup field:
//   'fixed'   — partner types the amount in ₽ directly (downPayment is the truth)
//   'percent' — partner types a % of the total price; downPaymentPercent is the
//               truth and the ₽ amount is derived, so it auto-updates when the
//               total price changes (markup/purchase edits).
const downPaymentType = ref<'fixed' | 'percent'>('fixed')
const downPayment = ref<number | null>(null)
const downPaymentPercent = ref<number | null>(null)
// Точная сумма в рублях, введённая в поле «Сумма взноса» (в процентном режиме).
// null — сумма выводится из процента. Тот же приём, что у ручной цены договора:
// без него округление процента уводило бы показанные рубли от набранных
// (10 000 → 11 500), а поле с маской возвращалось бы к выведенному значению.
//
// Объявлено здесь, вместе с остальными полями взноса: от них зависит подбор
// условий тарифа (ступень наценки), а он описан ниже по файлу.
const manualDownPayment = ref<number | null>(null)
const termMonths = ref(6)
const paymentType = ref<PaymentType>('EQUAL')
const paymentInterval = ref('MONTHLY')
const dealDate = ref(todayIso())
const customFirstPayment = ref('')

// Wholesale price (what partner actually paid the supplier) and
// profit-split mode. Both optional — when wholesalePrice is null the
// deal is in legacy MARKUP_ONLY mode regardless. Visible only to
// the partner: never sent to the client app or shown in PDFs.
const useWholesalePrice = ref(false)
const wholesalePrice = ref<number | null>(null)
const profitSplitBase = ref<'MARKUP_ONLY' | 'FULL_MARGIN'>('MARKUP_ONLY')

// Snapshot of wholesale fields when edit-mode loads — used by submit
// to detect whether the partner changed any cashflow-affecting field
// and show a confirm dialog (server-side rewriteForDeal will recompute
// CI accruals, so the partner needs to acknowledge).
const initialClientProfileId = ref<string | null>(null)
const initialWholesalePrice = ref<number | null>(null)
const initialProfitSplitBase = ref<'MARKUP_ONLY' | 'FULL_MARGIN'>('MARKUP_ONLY')

// Retail margin = purchasePrice - wholesalePrice (when wholesalePrice
// is set). This is partner's "trade margin" before any installment
// uplift; useful for analytics + when deciding profitSplitBase.
const retailMargin = computed(() => {
  if (!useWholesalePrice.value) return 0
  const w = wholesalePrice.value || 0
  const p = purchasePrice.value || 0
  return Math.max(0, p - w)
})

const markupOptions = [10, 15, 20, 25]
const termOptions = [3, 4, 6, 9, 12, 18, 24]

// Co-investors
// Phase 3: deal-CI relationship is implicit via cashbox. The frontend lists
// the cashbox's CIs informationally — no per-deal selection any more.
interface CoInvestorOption {
  id: string
  name: string
  phone: string | null
  profitPercent: number | null
  cashBoxId: string
  managementFeePct?: number
  costFeeMode?: boolean
  costFeeDefaultRatePct?: number | null
}
const allCoInvestors = ref<CoInvestorOption[]>([])

// Folder (single — a deal lives in at most one folder, or none)
const { folders: allFolders, fetchFolders } = useFolders()
const selectedFolderId = ref<string | null>(null)

// Cashbox — every deal lives in exactly one cashbox. Defaults to the partner's
// «Основная» on mount; partner picks another if they want.
const cashboxesStore = useCashBoxesStore()
const selectedCashBoxId = ref<string | null>(null)

// New deals can't go into a read-only (locked, over-limit) cashbox. Prefer the
// default cashbox if it's active, otherwise the first active one.
function pickDefaultCashBoxId(): string | null {
  const def = cashboxesStore.getDefault()
  if (def && !def.lockedAt) return def.id
  return cashboxesStore.items.find((b) => !b.lockedAt && !b.archivedAt)?.id ?? null
}

// Forward declarations resolved later — see "Draft persistence" block
// below all form refs. We need to call applyDraftToForm() from inside
// onMounted, but onMounted is set up here at the top alongside the rest
// of the cashbox init. Function declarations hoist, but `const`
// references hold values that aren't bound until the assignment line
// runs — so we'd hit a TDZ error if we touched manualTotalPrice etc.
// here. Hoisted `function` declaration sidesteps that as long as we
// only invoke it inside async callbacks (`onMounted` callback runs
// AFTER setup finishes, by which time every const has its value).

/**
 * Снимок черновика, снятый ДО сетевых запросов монтирования. Читать хранилище
 * позже опасно: за время загрузки касс его могло не стать.
 */
let draftSnapshotOnMount: ReturnType<typeof useDealDraft>['draft']['value'] = null

onMounted(async () => {
  draftSnapshotOnMount = dealDraft.draft.value
  // Программы рассрочки: без них форма работает как раньше, поэтому ошибку
  // загрузки не показываем.
  void loadPrograms()
  // Счета — необязательная часть формы: если раздел закрыт правом или счетов
  // нет, секция просто не появится, а сделка создастся как раньше.
  if (authStore.can('accounting.view')) accountingStore.fetchAccounts().catch(() => {})
  // Клиент, переданный из списка клиентов («Новая сделка для этого клиента»).
  // Черновик важнее: если партнёр не дозаполнил прошлую сделку, не перетираем.
  const preClient = route.query.clientProfileId as string | undefined
  if (preClient && !selectedClientProfileId.value) selectedClientProfileId.value = preClient
  // Партнёры-поставщики (только если фича доступна по тарифу).
  if (suppliersEnabled.value) {
    suppliersStore.fetchList({ sort: 'name' }).catch(() => {})
    const rq = route.query.supplierRequestId as string | undefined
    const sup = route.query.supplierId as string | undefined
    if (sup) { selectedSupplierId.value = sup; paidToSupplier.value = false }
    // Конверсия заявки → сделка: предзаполняем товар, закупочную цену и клиента.
    if (rq) {
      fromSupplierRequestId.value = rq
      try {
        const req = await suppliersStore.getRequest(rq)
        if (req.supplierId) { selectedSupplierId.value = req.supplierId; paidToSupplier.value = false }
        if (req.productName && !productName.value) productName.value = req.productName
        if (req.category && !category.value) category.value = req.category
        if (req.city && !city.value) city.value = req.city
        if (req.price != null && purchasePrice.value == null) purchasePrice.value = req.price
        if (req.clientProfileId && !selectedClientProfileId.value) selectedClientProfileId.value = req.clientProfileId
      } catch { /* заявка недоступна — продолжаем с пустой формой */ }
    }
  }
  try {
    // Запрос со-инвесторов вынесен из общего Promise.all: раньше его отказ
    // (скрытый раздел, урезанный тариф, права сотрудника) ронял загрузку
    // папок и касс вместе с ним — форма создания сделки открывалась пустой.
    const [data] = await Promise.all([
      sections.visible('coInvestors')
        ? api.get<any[]>('/co-investors').catch(() => [] as any[])
        : Promise.resolve([] as any[]),
      fetchFolders(),
      cashboxesStore.fetchAll(),
    ])
    allCoInvestors.value = data.map((ci: any) => ({
      id: ci.id,
      name: ci.name,
      phone: ci.phone,
      profitPercent: ci.profitPercent,
      cashBoxId: ci.cashBoxId,
      managementFeePct: ci.managementFeePct,
      costFeeMode: ci.costFeeMode,
      costFeeDefaultRatePct: ci.costFeeDefaultRatePct,
    }))
    // Default to the partner's «Основная» cashbox
    if (!selectedCashBoxId.value) {
      selectedCashBoxId.value = pickDefaultCashBoxId()
    }
    if (selectedCashBoxId.value) await fetchCashBoxCapital(selectedCashBoxId.value)
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
      downPaymentType.value = 'fixed'
      downPaymentPercent.value = null
      termMonths.value = deal.numberOfPayments
      paymentType.value = deal.paymentType as PaymentType
      paymentInterval.value = deal.paymentInterval || 'MONTHLY'
      dealDate.value = deal.dealDate ? new Date(deal.dealDate).toISOString().slice(0, 10) : dealDate.value
      customFirstPayment.value = deal.firstPaymentDate ? new Date(deal.firstPaymentDate).toISOString().slice(0, 10) : ''
      selectedClientProfileId.value = deal.clientProfileId || null
      initialClientProfileId.value = deal.clientProfileId || null
      if (deal.clientProfile) selectedClientProfile.value = deal.clientProfile
      // Поручители: новый упорядоченный набор, с fallback на legacy-поле.
      if (deal.guarantors && deal.guarantors.length) {
        selectedGuarantors.value = [...deal.guarantors]
          .sort((a, b) => a.order - b.order)
          .map((g) => g.clientProfile)
          .filter((p): p is ClientProfile => !!p)
      } else if (deal.guarantorProfile) {
        selectedGuarantors.value = [deal.guarantorProfile]
      }
      selectedFolderId.value = (deal as any).folderId || null
      // Preserve the deal's cashbox so the partner can change it from the
      // edit form too. Falls back to the default cashbox if the field is
      // missing (e.g. pre-cashboxes data).
      selectedCashBoxId.value = (deal as any).cashBoxId || cashboxesStore.getDefault()?.id || null

      // Wholesale price / profit-split mode (Phase 3). Fields are
      // optional — only show the wholesale section if the deal already
      // has a value, so existing partners aren't confused by a new
      // empty input that's irrelevant to them.
      if (deal.wholesalePrice != null && deal.wholesalePrice > 0) {
        useWholesalePrice.value = true
        wholesalePrice.value = deal.wholesalePrice
      }
      if (deal.profitSplitBase) {
        profitSplitBase.value = deal.profitSplitBase
      }
      // Snapshot for change detection in submit (Phase 4 confirm).
      initialWholesalePrice.value = deal.wholesalePrice ?? null
      initialProfitSplitBase.value = deal.profitSplitBase ?? 'MARKUP_ONLY'
      // Load the deal's actual co-investor participation (overrides the default
      // set the cashbox watcher built when selectedCashBoxId was assigned above).
      await loadParticipantsForEdit(editId.value)

      // ВАЖНО: цена сделки — истина в рублях, а markupPercent у части сделок
      // записан от цены продажи (легаси/импорт), поэтому выводить цену из
      // процента нельзя — она «уплывёт» и молча спишет клиенту долг.
      // Ставим сохранённую цену как ручную (после nextTick — watch на
      // purchasePrice/markupValue сбрасывает manualTotalPrice в null).
      await nextTick()
      manualTotalPrice.value = deal.totalPrice
    } catch (e: any) {
      toast.error(e.message || 'Не удалось загрузить сделку')
      router.push('/deals')
    }
    prefillLoading.value = false
    // Editing a real deal — never a draft, don't restore.
    return
  }

  // Auto-restore is gated on `?resume=1` — set by the DealDraftFloater
  // when the partner explicitly clicks "Продолжить". Any other entry
  // (header "Create deal" button, deep link, etc.) starts the wizard
  // empty even when a draft exists. The draft itself stays in storage
  // and the floater keeps offering to resume it, so nothing is lost —
  // the partner just has to opt in.
  const wantsResume = route.query.resume === '1'
  const stored = dealDraft.draft.value ?? draftSnapshotOnMount
  const storedHasContent =
    !!stored &&
    (
      (stored.productName?.trim().length ?? 0) > 0 ||
      (stored.purchasePrice ?? 0) > 0 ||
      !!stored.selectedClientProfileId
    )
  // В режиме редактирования черновик не применяем никогда: форма уже заполнена
  // данными сделки, и восстановление затёрло бы их чужим черновиком.
  if (wantsResume && storedHasContent && !editId.value) {
    await applyDraftToForm(stored)
    wasRestoredOnMount.value = true
    if (selectedCashBoxId.value) await fetchCashBoxCapital(selectedCashBoxId.value)
  } else if (!storedHasContent && dealDraft.hasDraft.value) {
    // Empty legacy draft (one-field {selectedCashBoxId} fallout from
    // before scheduleDraftSave learned to skip empty saves). Clean it
    // up so the floater doesn't light up for nothing.
    dealDraft.clear()
  }
  prefillLoading.value = false
})

// Co-investors of the selected cashbox — the candidate pool for participation.
const cashBoxCoInvestors = computed(() =>
  selectedCashBoxId.value
    ? allCoInvestors.value.filter((ci) => ci.cashBoxId === selectedCashBoxId.value)
    : [],
)

// Phase 4: per-deal participation. The partner picks which of the cashbox's
// co-investors share THIS deal's profit, and can override each one's percent
// just for this deal. Defaults to "everyone participates, no override" — which
// reproduces the legacy whole-cashbox behaviour.
const { fetchDealCoInvestors, saveDealCoInvestors } = useCoInvestors()
interface DealParticipantRow {
  id: string
  name: string
  phone: string | null
  profitPercent: number | null
  participates: boolean
  override: number | null  // per-deal fixed % override; null = use default mode
  // Дефолтная комиссия партнёра инвестора (для weight-режима) — для плейсхолдера/подписи.
  managementFeePct: number | null
  // Per-deal переопределение комиссии партнёра для weight-инвестора (0..100).
  // null ⇒ берётся дефолтная комиссия (managementFeePct).
  mgmtFeeOverride: number | null
  // Phase 5: cost-fee investor — instead of a % override, a rate (% of purchase).
  costFeeMode: boolean
  costFeeRate: number | null
}
const dealParticipants = ref<DealParticipantRow[]>([])
// Whether the partner has TOUCHED participation since it was loaded/built. Used
// (in edit) to decide if we PUT — so that reverting to default (re-including a
// CI, clearing an override) is still persisted, which a "differs from default"
// check would miss.
const participantsDirty = ref(false)

// Called from the UI when the partner toggles a participant or edits an override.
function markParticipantsDirty() { participantsDirty.value = true }
function toggleParticipant(p: DealParticipantRow) {
  const turningOn = !p.participates
  p.participates = turningOn
  // A cost-fee investor takes «наценка − комиссия», leaving no room for anyone
  // else → it must be the sole participant. Enforce both directions.
  if (turningOn) {
    if (p.costFeeMode) {
      for (const o of dealParticipants.value) if (o.id !== p.id) o.participates = false
    } else {
      for (const o of dealParticipants.value) if (o.id !== p.id && o.costFeeMode) o.participates = false
    }
  }
  participantsDirty.value = true
}

// The base actually split with co-investors: markup, or totalPrice−wholesale in
// FULL_MARGIN mode — same base the backend accrues from. Used by cost-fee split
// AND by the fixed-% chip so both match the backend.
const profitSplitBaseAmount = computed(() =>
  (useWholesalePrice.value && profitSplitBase.value === 'FULL_MARGIN' && (wholesalePrice.value || 0) > 0)
    ? Math.max(0, totalPrice.value - (wholesalePrice.value || 0))
    : markup.value
)

// Live split for a cost-fee participant, from the deal's current purchase and
// profit base.
function costFeeCalc(p: DealParticipantRow) {
  const purchase = purchasePrice.value || 0
  const base = profitSplitBaseAmount.value
  const rate = p.costFeeRate != null ? Number(p.costFeeRate) : 0
  const rawFee = Math.round((rate / 100) * purchase)
  const partnerFee = Math.min(rawFee, base)
  // Чистый доход инвестора = наценка − комиссия партнёра. Инвестор финансирует
  // закупку сам и получает всю сумму сделки за вычетом комиссии партнёра, то
  // есть возврат капитала (закупка) + этот доход.
  const net = Math.max(base - partnerFee, 0)
  const total = purchase + net
  // Ставка невалидна, если комиссия ≤ 0 или ≥ наценки: в этом случае одна из
  // сторон не зарабатывает. «≥», а не «>» — при равенстве инвестору 0 дохода.
  const invalid = rate <= 0 || rawFee >= base
  return { partnerFee, investorShare: net, exceedsMarkup: rawFee > base, rawFee, net, total, invalid }
}

// Rebuild the participant list from the selected cashbox's CIs — all included,
// no overrides. Used on create and whenever the partner switches cashbox.
function buildParticipantsFromCashbox() {
  const cis = cashBoxCoInvestors.value
  dealParticipants.value = cis.map((ci) => ({
    id: ci.id,
    name: ci.name,
    phone: ci.phone,
    profitPercent: ci.profitPercent,
    // A cost-fee investor must be the sole participant. So it participates by
    // default only when it's alone in the cashbox; in a mixed cashbox it starts
    // off (the partner opts it in, which toggles the others off).
    participates: ci.costFeeMode ? cis.length === 1 : true,
    override: null,
    managementFeePct: ci.managementFeePct ?? null,
    mgmtFeeOverride: null,
    costFeeMode: !!ci.costFeeMode,
    costFeeRate: ci.costFeeMode ? ci.costFeeDefaultRatePct ?? null : null,
  }))
}

// Edit mode: load the deal's actual participants (linked + available) so the
// partner sees their current customisation instead of a reset-to-all default.
async function loadParticipantsForEdit(dealId: string) {
  try {
    const data = await fetchDealCoInvestors(dealId)
    const rows: DealParticipantRow[] = []
    for (const p of data.participants) {
      rows.push({
        id: p.id, name: p.name, phone: p.phone, profitPercent: p.profitPercent,
        participates: true, override: p.profitPercentOverride,
        managementFeePct: p.managementFeePct ?? null,
        mgmtFeeOverride: p.managementFeePctOverride ?? null,
        costFeeMode: !!p.costFeeMode,
        costFeeRate: p.costFeeMode ? p.costFeeRatePct ?? p.costFeeDefaultRatePct ?? null : null,
      })
    }
    for (const a of data.available) {
      rows.push({
        id: a.id, name: a.name, phone: a.phone, profitPercent: a.profitPercent,
        participates: false, override: null,
        managementFeePct: a.managementFeePct ?? null,
        mgmtFeeOverride: null,
        costFeeMode: !!a.costFeeMode,
        costFeeRate: a.costFeeMode ? a.costFeeDefaultRatePct ?? null : null,
      })
    }
    dealParticipants.value = rows
    // Freshly loaded server state = not dirty. A subsequent cashbox change or
    // user toggle sets it dirty again.
    participantsDirty.value = false
  } catch {
    // GET failed — we don't know the deal's real participation. The cashbox
    // watcher may have left `dirty=true` with a default set; clear it so a
    // blind save can't PUT that default over the deal's actual customization.
    participantsDirty.value = false
  }
}

// True when the partner has deviated from the default (someone excluded, an
// override set, or a cost-fee participant that always needs its rate sent).
const participantsCustomized = computed(() =>
  dealParticipants.value.some((p) => !p.participates || p.override != null || p.mgmtFeeOverride != null || (p.participates && p.costFeeMode)),
)

// The CIs actually sharing this deal's profit. Cost-fee rows carry the rate for
// the review/preview instead of a plain %.
const participatingList = computed(() =>
  dealParticipants.value
    .filter((p) => p.participates)
    .map((p) => ({
      id: p.id,
      name: p.name,
      costFeeMode: p.costFeeMode,
      costFeeRate: p.costFeeRate,
      effectivePercent: p.override != null && p.override > 0
        ? p.override
        : (p.profitPercent != null && p.profitPercent > 0 ? p.profitPercent : null),
      // Эффективная комиссия партнёра для weight-инвестора (override ?? дефолт).
      effectiveMgmtFee: (p.profitPercent == null || p.profitPercent <= 0) && !p.costFeeMode
        ? (p.mgmtFeeOverride != null && (p.mgmtFeeOverride as any) !== '' ? Number(p.mgmtFeeOverride) : p.managementFeePct)
        : null,
    })),
)

// The wire payload: participating CIs with per-deal override OR cost-fee rate.
// Ровно одно per-deal поле по режиму инвестора (бэк валидирует взаимоисключимость):
//   cost-fee   → costFeeRatePct (ставка);
//   фикс (profitPercent>0) → profitPercentOverride;
//   по вкладу  → managementFeePctOverride (комиссия партнёра для этой сделки).
function buildParticipantsPayload() {
  return dealParticipants.value
    .filter((p) => p.participates)
    .map((p) => {
      if (p.costFeeMode) {
        return { coInvestorId: p.id, costFeeRatePct: p.costFeeRate != null ? Number(p.costFeeRate) : null }
      }
      if (p.profitPercent != null && p.profitPercent > 0) {
        return { coInvestorId: p.id, profitPercentOverride: p.override != null && p.override > 0 ? p.override : null }
      }
      // Weight-инвестор: только комиссия-override (пусто → null, берётся дефолт).
      return { coInvestorId: p.id, managementFeePctOverride: p.mgmtFeeOverride != null && (p.mgmtFeeOverride as any) !== '' ? Number(p.mgmtFeeOverride) : null }
    })
}

// Client-side guard so a bad value reaches the partner as a clear message
// instead of a swallowed 400. Returns an error string, or null when valid.
function validateParticipantOverrides(): string | null {
  // Sole-participant rule for cost-fee (server enforces too — catch it early).
  const on = dealParticipants.value.filter((p) => p.participates)
  const costFeeOn = on.find((p) => p.costFeeMode)
  if (costFeeOn && on.length > 1) {
    return `«${costFeeOn.name}» (комиссия от закупки) должен быть единственным участником сделки`
  }
  for (const p of dealParticipants.value) {
    if (!p.participates) continue
    if (p.costFeeMode) {
      if (p.costFeeRate == null || (p.costFeeRate as any) === '') {
        return `Укажите ставку комиссии для «${p.name}»`
      }
      const v = Number(p.costFeeRate)
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        return `Ставка комиссии для «${p.name}» должна быть от 0 до 100`
      }
      // Комиссия обязана быть строго > 0 и строго < наценки, чтобы заработали
      // обе стороны. Иначе блокируем сабмит (не просто предупреждаем).
      if (costFeeCalc(p).invalid) {
        return `Комиссия для «${p.name}» должна быть больше 0 и меньше наценки`
      }
      continue
    }
    // Фикс-инвестор: override — фикс % на сделку (1..99).
    if (p.profitPercent != null && p.profitPercent > 0) {
      if (p.override == null || (p.override as any) === '') continue
      const v = Number(p.override)
      if (!Number.isFinite(v) || v < 1 || v > 99) {
        return `Процент для «${p.name}» должен быть от 1 до 99`
      }
      continue
    }
    // Weight-инвестор: mgmtFeeOverride — комиссия партнёра % на сделку (0..100).
    if (p.mgmtFeeOverride == null || (p.mgmtFeeOverride as any) === '') continue
    const fee = Number(p.mgmtFeeOverride)
    if (!Number.isFinite(fee) || fee < 0 || fee > 100) {
      return `Комиссия партнёра для «${p.name}» должна быть от 0 до 100`
    }
  }
  // Σ эффективных фикс-процентов участников не должна превышать 99% (остаток
  // отходит weight-инвесторам/партнёру). Фикс-участник: участвует, не cost-fee,
  // profitPercent>0; эффективный % — override ?? profitPercent.
  const fixedSum = on.reduce((sum, p) => {
    if (p.costFeeMode) return sum
    if (p.profitPercent == null || p.profitPercent <= 0) return sum
    const eff = p.override != null && (p.override as any) !== '' && Number(p.override) > 0
      ? Number(p.override)
      : p.profitPercent
    return sum + (eff > 0 ? eff : 0)
  }, 0)
  if (fixedSum > 99) {
    return 'Сумма фиксированных процентов участников превышает 99%'
  }
  return null
}

// Persist the current participant selection for an EXISTING deal. Sends the
// full desired set; omitted CIs are detached server-side. Idempotent — safe to
// call on every edit save.
async function syncDealParticipants(dealId: string) {
  if (!cashBoxCoInvestors.value.length) return
  await saveDealCoInvestors(dealId, buildParticipantsPayload())
}

// Rebuild defaults when the partner switches cashbox — a different cashbox has
// a different CI set, so the previous selection can't carry over. Marks dirty
// so the new default is persisted. In edit mode the initial selectedCashBoxId
// assignment also fires this, but loadParticipantsForEdit runs right after and
// resets dirty to false.
watch(selectedCashBoxId, () => {
  buildParticipantsFromCashbox()
  participantsDirty.value = true
})

const selectedFolder = computed<DealFolder | null>(() =>
  selectedFolderId.value
    ? allFolders.value.find(f => f.id === selectedFolderId.value) ?? null
    : null
)

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
/**
 * Программа рассрочки.
 *
 * Выбрал программу — наценка, срок и минимальный взнос приходят из её условий,
 * и продавцу не нужно считать в уме. Не выбрал — форма работает ровно как
 * раньше: весь код ниже включается только при выбранной программе.
 *
 * Цена подставляется через тот же механизм, что и ручной ввод итоговой цены:
 * так в сделку уходит точная сумма в рублях, а не пересчитанный процент.
 */
interface ProgramItem {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  markupBase: MarkupBase
  paymentInterval: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'
  rounding: ProgramRounding
  /** Ступенями или кривой считается зависимость наценки от взноса. */
  downMode?: ProgramDownMode
  /** Куда уходит расхождение от округления платежа. */
  roundingTarget?: ProgramRoundingTarget
  /** Наценка не меньше этой суммы в рублях. */
  minMarkupAmount?: number | null
  /** Взнос, подставляемый в форму сразу при выборе тарифа. */
  defaultDownPaymentPercent?: number | null
  minAmount: number | null
  maxAmount: number | null
  strict: boolean
  archivedAt: string | null
  validFrom?: string | null
  validTo?: string | null
  cashBoxIds?: string[]
  rules: ProgramRule[]
}

const programs = ref<ProgramItem[]>([])
const selectedProgramId = ref<string | null>(null)

const selectedProgram = computed(
  () => programs.value.find((p) => p.id === selectedProgramId.value) ?? null,
)

/** Программы, применимые здесь и сейчас: остальные продавцу только мешают. */
const availablePrograms = computed(() => {
  const now = Date.now()
  return programs.value.filter((p) => {
    if (p.archivedAt) return false
    if (p.validFrom && now < new Date(p.validFrom).getTime()) return false
    if (p.validTo && now > new Date(p.validTo).getTime()) return false
    if (p.cashBoxIds?.length && selectedCashBoxId.value && !p.cashBoxIds.includes(selectedCashBoxId.value)) {
      return false
    }
    return true
  })
})

/**
 * Условия под текущую стоимость, срок и первоначальный взнос.
 *
 * Ступень взноса ищется по ВВЕДЁННОМУ значению, а не по итоговой сумме взноса:
 * та выводится из цены договора, цена — из наценки, а наценка теперь зависит от
 * ступени. Опора на ввод разрывает этот круг. В процентном режиме доля известна
 * сразу; когда сумма задана в рублях, ступень подбирает та же функция, что и
 * сервер, — перебором согласованных ступеней.
 */
const programRule = computed(() => {
  const p = selectedProgram.value
  if (!p) return null
  const price = purchasePrice.value || 0
  if (p.downMode === 'CURVE') {
    return curveMarkupForDown(p.rules, price, termMonths.value, typedDownPayment.value, p.markupBase)?.rule ?? null
  }
  if (downPaymentType.value === 'percent' && manualDownPayment.value === null) {
    return matchRule(p.rules, price, termMonths.value, downPaymentPercent.value || 0)
  }
  return pickRuleForDown(p.rules, price, termMonths.value, typedDownPayment.value, p.markupBase)
})

/**
 * Взнос, набранный руками, в рублях.
 *
 * Именно он участвует в подборе условий: вычисленная сумма взноса выводится из
 * цены договора, а та теперь сама зависит от взноса — подписка на неё
 * закольцевала бы пересчёт. В процентном режиме без явной суммы рубли пока
 * неизвестны, и подбор идёт по проценту.
 */
const typedDownPayment = computed(() =>
  downPaymentType.value === 'percent'
    ? (manualDownPayment.value ?? 0)
    : (downPayment.value || 0),
)

/** Наценка по тарифу с учётом кривой: на ней процент лежит между точками. */
const programMarkupPercent = computed(() => {
  const p = selectedProgram.value
  if (!p) return null
  if (p.downMode === 'CURVE') {
    const got = curveMarkupForDown(
      p.rules,
      purchasePrice.value || 0,
      termMonths.value,
      typedDownPayment.value,
      p.markupBase,
    )
    return got?.markupPercent ?? null
  }
  return programRule.value?.markupPercent ?? null
})

/** Сроки, которые программа допускает для этой стоимости. */
const programTerms = computed(() => {
  const p = selectedProgram.value
  if (!p) return []
  return availableTerms(p.rules, purchasePrice.value || 0)
})

const programMinDownPayment = computed(() => {
  const p = selectedProgram.value
  const rule = programRule.value
  if (!p || !rule) return 0
  return minDownPaymentFor(
    totalFor(purchasePrice.value || 0, rule.markupPercent, p.markupBase),
    rule.minDownPaymentPercent,
  )
})

/**
 * Цена по программе — та же формула, что на сервере.
 *
 * Считается отдельно от полей формы: подстановка через поле «итоговая цена»
 * сбрасывается собственным наблюдателем за наценкой, и до сервера доезжал
 * только процент. Для наценки «от цены продажи» это давало расхождение в
 * десятки рублей на крупных суммах.
 */
const programTotalPrice = computed(() => {
  const p = selectedProgram.value
  const percent = programMarkupPercent.value
  if (!p || percent == null) return null
  // Тот же порядок, что на сервере: процент → минимальная наценка → подгонка
  // под равные платежи, если тариф округляет «в цену».
  let total = totalWithMinMarkup(
    purchasePrice.value || 0,
    totalFor(purchasePrice.value || 0, percent, p.markupBase),
    p.minMarkupAmount,
  )
  if (p.roundingTarget === 'TOTAL') {
    total = totalForEqualPayments(total, typedDownPayment.value, termMonths.value, p.rounding)
  }
  return total > 0 ? total : null
})

/**
 * Как называть срок: у недельной программы «6 мес» — прямая ложь, там шесть
 * недель.
 */
const termUnitShort = computed(() =>
  paymentInterval.value === 'WEEKLY' ? 'нед' : paymentInterval.value === 'BIWEEKLY' ? '× 2 нед' : 'мес',
)

/**
 * Тариф выбран — наценку и цену задаёт он.
 *
 * Раньше поля оставались открытыми у нестрогих тарифов, и это вводило в
 * заблуждение: партнёр правил процент, видел свою цифру в форме, а на сервер
 * всё равно уходила цена по тарифу (`programTotalPrice`) — «поменял 20 на 30,
 * а сделка снова по 20». Тариф на то и тариф: для каждого срока наценка своя,
 * а нужны свои условия — есть пункт «Без программы».
 */
const programLocked = computed(() => !!selectedProgram.value)

/**
 * Правка тарифа прямо из визарда.
 *
 * Партнёр видит применённые условия и хочет их поправить — гонять его в
 * настройки и обратно, теряя заполненную форму, незачем: открываем то же окно,
 * что и в разделе «Тарифы», а после сохранения перечитываем список и заново
 * применяем условия к текущей сделке.
 */
const canEditPrograms = computed(() => authStore.can('deals.programs'))

/** «Тариф „Стандарт“», но без «Тариф „Тариф Innzare“». */
const tariffTitle = computed(() => {
  const name = selectedProgram.value?.name?.trim() ?? ''
  if (!name) return 'Тариф'
  // \b в JS не видит границу после кириллицы — сравниваем со следующим пробелом.
  return /^тариф(\s|$)/i.test(name) ? name : `Тариф «${name}»`
})
const programDialog = ref(false)

async function onProgramSaved() {
  await loadPrograms()
  applyProgram()
}

/** Программа выбрана, но для этой суммы и срока в ней нет условий. */
const programMismatch = computed(
  () => !!selectedProgram.value && !programRule.value && (purchasePrice.value || 0) > 0,
)

async function loadPrograms() {
  try {
    programs.value = await api.get<ProgramItem[]>('/installment-programs')
    // Программу по умолчанию подставляем только в новой сделке: при
    // редактировании условия договора уже зафиксированы.
    if (!isEditMode.value && !selectedProgramId.value) {
      const def = programs.value.find((p) => p.isDefault && !p.archivedAt)
      if (def) selectedProgramId.value = def.id
    }
  } catch {
    // Программы — удобство, а не обязательное условие: без них форма работает.
  }
}

/** Подставляет условия программы в поля цены и срока. */
function applyProgram() {
  const p = selectedProgram.value
  if (!p) return
  const terms = programTerms.value
  // Срок вне программы — берём ближайший из допустимых, иначе продавец увидит
  // «нет условий» и не поймёт, что делать.
  if (terms.length && !terms.includes(termMonths.value)) {
    termMonths.value = terms.reduce((a, b) =>
      Math.abs(b - termMonths.value) < Math.abs(a - termMonths.value) ? b : a,
    )
  }
  // Периодичность платежей — тоже условие программы: у недельной программы
  // месячный график был бы отклонён сервером без всякой подсказки.
  if (paymentInterval.value !== p.paymentInterval) paymentInterval.value = p.paymentInterval
  // Взнос по умолчанию подставляем только в пустое поле: набранное продавцом
  // значение важнее тарифа, затирать его нельзя.
  if (
    p.defaultDownPaymentPercent != null &&
    downPayment.value === null &&
    downPaymentPercent.value === null &&
    manualDownPayment.value === null
  ) {
    downPaymentType.value = 'percent'
    downPaymentPercent.value = p.defaultDownPaymentPercent
  }
  const rule = programRule.value
  if (!rule) return
  const total = totalFor(purchasePrice.value || 0, rule.markupPercent, p.markupBase)
  if (total > 0) onTotalPriceInput(total)
}

watch(selectedProgramId, () => applyProgram())
// Сменили кассу — программа могла перестать действовать. Молча оставлять её
// выбранной нельзя: сервер потом откажет, а продавец не поймёт почему.
watch(availablePrograms, (list) => {
  if (selectedProgramId.value && !list.some((p) => p.id === selectedProgramId.value)) {
    selectedProgramId.value = null
  }
})
// Взнос в этом списке наравне со стоимостью и сроком: от него зависит ступень
// наценки, а значит и цена договора. Следим за ВВЕДЁННЫМИ полями, а не за
// вычисленной суммой взноса — та сама считается от цены, и подписка на неё
// закольцевала бы пересчёт.
watch(
  [purchasePrice, termMonths, downPaymentType, downPayment, downPaymentPercent, manualDownPayment],
  () => {
    if (selectedProgramId.value) applyProgram()
  },
)

// `manualTotalPrice` keeps the exact value the partner typed into the totalPrice
// field — without it, percent rounding would drop kopecks (e.g. 99 250 → 99 246).
// Cleared automatically as soon as the partner edits any other related field.
const manualTotalPrice = ref<number | null>(null)

const totalPriceInput = computed(() => maskedMoney(totalPrice.value))

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

// Reload the cashbox's available capital whenever the partner picks a
// different cashbox so the hint and warning reflect the right balance.
watch(selectedCashBoxId, (id) => { void fetchCashBoxCapital(id) })

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
// Set when the partner tries to enter more than the total price. The value is
// clamped to the max; this flag keeps the error visible until they enter a
// valid amount.
const downPaymentExceeded = ref(false)

// Canonical ₽ value sent to the backend. In percent mode it's the exact typed
// amount if present, otherwise derived from the percent and the live total
// price (so it tracks markup/price edits). Always clamped to [0, totalPrice].
const downPaymentAmount = computed(() => {
  const total = totalPrice.value || 0
  const raw = downPaymentType.value === 'percent'
    ? (manualDownPayment.value !== null
        ? manualDownPayment.value
        : Math.round(total * (downPaymentPercent.value || 0) / 100))
    : (downPayment.value || 0)
  if (raw < 0) return 0
  if (total > 0 && raw > total) return total
  return raw
})
const remainingAmount = computed(() => totalPrice.value - downPaymentAmount.value)

/**
 * Округление платежа у сделки без тарифа.
 *
 * У сделки по тарифу округление — часть его условий, и продавец их не
 * выбирает: показываем как есть.
 */
const ROUNDING_LABEL: Record<ProgramRounding, string> = {
  NONE: 'без округления',
  TO_50: 'до 50 ₽',
  TO_100: 'до 100 ₽',
  TO_500: 'до 500 ₽',
  TO_1000: 'до 1000 ₽',
}
const ROUNDING_OPTIONS = [
  { value: 'NONE', label: 'не округлять' },
  { value: 'TO_100', label: 'до 100 ₽' },
  { value: 'TO_500', label: 'до 500 ₽' },
  { value: 'TO_1000', label: 'до 1000 ₽' },
]
const manualRounding = ref<ProgramRounding>('NONE')
const effectiveRounding = computed<ProgramRounding>(
  () => selectedProgram.value?.rounding ?? manualRounding.value,
)

/**
 * Платёж по графику — тот же расчёт, что будет у созданной сделки.
 *
 * Раньше здесь стояло простое деление долга на срок, и при тарифе с
 * округлением форма показывала одно («10 125 ₽»), а график получался другой
 * («10 100 ₽», последний 10 400 ₽). Округление живёт в тарифе, поэтому и
 * считать надо его же формулой.
 */
const paymentShape = computed(() =>
  scheduleShape(remainingAmount.value, termMonths.value, effectiveRounding.value),
)
const monthlyPayment = computed(() =>
  termMonths.value > 0 ? (paymentShape.value.regular || paymentShape.value.last) : 0,
)
/** Последний платёж забирает расхождение от округления — показываем, если он другой. */
const lastPayment = computed(() => paymentShape.value.last)
/**
 * Показываем последний платёж, только когда он действительно другой.
 *
 * Без округления в конце обычно оседают копейки от деления (13 888 и 13 896) —
 * писать об этом значит шуметь. А вот округление сдвигает туда сотни и тысячи,
 * и умолчать об этом нельзя.
 */
const lastPaymentDiffers = computed(() => {
  const { regular, last } = paymentShape.value
  if (termMonths.value <= 1 || regular <= 0) return false
  const diff = Math.abs(last - regular)
  if (diff < 1) return false
  return effectiveRounding.value !== 'NONE' || diff >= regular * 0.01
})

// When the total price changes (markup/purchase edits), drop the manual ₽
// override so the amount re-derives from the percent, clear the stale over-limit
// warning, and re-clamp a fixed-mode amount that the new (lower) total no longer
// fits.
watch(totalPrice, (total) => {
  manualDownPayment.value = null
  downPaymentExceeded.value = false
  if (downPaymentType.value === 'fixed' && total > 0 && (downPayment.value || 0) > total) {
    downPayment.value = total
  }
})

// Switch the input mode, converting the current value so the ₽ amount is
// preserved across the toggle (percent ⇄ rubles), like switchMarkupType does.
function switchDownPaymentType(type: 'fixed' | 'percent') {
  if (downPaymentType.value === type) return
  const total = totalPrice.value || 0
  downPaymentExceeded.value = false
  if (type === 'percent') {
    const current = downPayment.value || 0
    downPaymentPercent.value = total > 0
      ? Math.min(100, Math.round(current / total * 100 * 100) / 100)
      : 0
    manualDownPayment.value = current // keep the exact ₽ across the toggle
  } else {
    downPayment.value = downPaymentAmount.value
  }
  downPaymentType.value = type
}

// Percent field (percent mode). Setter clamps to [0, 100] and clears the manual
// ₽ override so the percent drives the amount again.
const downPaymentPercentModel = computed({
  get: () => downPaymentPercent.value,
  set: (v: number | null) => {
    let pct = Number(v) || 0
    if (pct < 0) pct = 0
    downPaymentExceeded.value = pct > 100 // attempted more than 100% of the total
    if (pct > 100) pct = 100
    downPaymentPercent.value = pct
    manualDownPayment.value = null
  },
})

// "Сумма взноса" field (percent mode) — the ₽ amount. Editing it stores the
// exact value (no rounding drift) and back-computes the percent for display.
const downPaymentRublesModel = computed({
  get: () => downPaymentAmount.value,
  set: (rub: number) => {
    const total = totalPrice.value || 0
    let v = rub || 0
    if (v < 0) v = 0
    downPaymentExceeded.value = total > 0 && v > total
    if (total > 0 && v > total) v = total
    manualDownPayment.value = v
    downPaymentPercent.value = total > 0 ? Math.round((v / total) * 100 * 100) / 100 : 0
  },
})

// Fixed-mode ₽ input — clamped to [0, totalPrice]; over-total is flagged.
function setDownPaymentFixed(value: number) {
  const total = totalPrice.value || 0
  let v = value || 0
  if (v < 0) v = 0
  downPaymentExceeded.value = total > 0 && v > total
  if (total > 0 && v > total) v = total
  downPayment.value = v
}

const downPaymentPercentOptions = [10, 20, 30, 50]

// The amount is always clamped to [0, totalPrice], so the stored value can't be
// invalid. This message is purely informational: it tells the partner that
// their last input was capped because it exceeded the total.
const downPaymentError = computed(() => {
  const total = totalPrice.value || 0
  if (total <= 0) return ''
  if (downPaymentExceeded.value || (downPayment.value || 0) > total) {
    return `Взнос не может превышать итоговую цену (${formatCurrency(total)})`
  }
  return ''
})

/**
 * Первый платёж не дальше 50 дней от даты договора.
 *
 * Защита от опечатки: вместо сентября случайно указывают следующий год, и
 * договор молча уходит из графика поступлений. В календаре такие дни просто
 * недоступны — то же правило проверяет сервер.
 */
const MAX_FIRST_PAYMENT_DAYS = 50
const firstPaymentMax = computed(() => {
  const d = new Date(dealDate.value)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + MAX_FIRST_PAYMENT_DAYS)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
})

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

/**
 * График платежей для превью — ровно тот, что получится у сделки.
 *
 * Даты считаются так же, как на сервере (`generatePaymentSchedule`): первый
 * платёж от указанной даты, дальше шаг интервала. Суммы — из `scheduleShape`,
 * поэтому округление тарифа видно заранее, вместе с последним платежом.
 */
const previewSchedule = computed(() => {
  const n = termMonths.value
  const amount = remainingAmount.value
  if (!(n > 0) || !(amount > 0)) return []

  const start = customFirstPayment.value
    ? new Date(customFirstPayment.value)
    : (() => {
        const d = new Date(dealDate.value)
        if (paymentInterval.value === 'WEEKLY') d.setDate(d.getDate() + 7)
        else if (paymentInterval.value === 'BIWEEKLY') d.setDate(d.getDate() + 14)
        else d.setMonth(d.getMonth() + 1)
        return d
      })()
  if (Number.isNaN(start.getTime())) return []

  const shape = paymentShape.value
  const rows: Array<{ n: number; date: string; amount: number }> = []
  for (let i = 0; i < n; i++) {
    const due = new Date(start)
    if (paymentInterval.value === 'WEEKLY') due.setDate(due.getDate() + 7 * i)
    else if (paymentInterval.value === 'BIWEEKLY') due.setDate(due.getDate() + 14 * i)
    else due.setMonth(due.getMonth() + i)
    rows.push({
      n: i + 1,
      date: due.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' }),
      amount: i < n - 1 ? shape.regular : shape.last,
    })
  }
  return rows
})

/** Длинный график не разворачиваем целиком: начало, конец и «ещё N». */
const previewScheduleShown = computed(() => {
  const rows = previewSchedule.value
  if (rows.length <= 8) return { head: rows, tail: [] as typeof rows, hidden: 0 }
  return { head: rows.slice(0, 5), tail: rows.slice(-2), hidden: rows.length - 7 }
})

/**
 * Что показать в графике превью.
 *
 * В боковой колонке место дорогое — длинный график сворачивается до начала и
 * конца. На «Обзоре» превью занимает всю ширину и это последняя проверка перед
 * созданием: там показываем весь график целиком, а высоту держит прокрутка.
 */
const previewPlanRows = computed(() =>
  step.value === 4
    ? { head: previewSchedule.value, tail: [] as typeof previewSchedule.value, hidden: 0 }
    : previewScheduleShown.value,
)

// Step 3: Client
const selectedClientProfileId = ref<string | null>(null)

// Выбранный клиент сделки — приходит из блока выбора людей.
const selectedClientProfile = ref<ClientProfile | null>(null)

// Поручители — до 5, порядок = порядок добавления (первый = основной).
const MAX_GUARANTORS = 5
const selectedGuarantors = ref<ClientProfile[]>([])
const peoplePickerRef = ref<InstanceType<typeof DealPeoplePicker> | null>(null)
const selectedGuarantorIds = computed(() => selectedGuarantors.value.map((g) => g.id))
function removeGuarantorAt(index: number) {
  selectedGuarantors.value.splice(index, 1)
}

/**
 * Список поручителей пришёл целиком из блока выбора.
 *
 * Риск-сводку запрашиваем только для новых: у остальных она уже загружена, а
 * повторный запрос на каждый клик по списку ничего не добавляет.
 */
function onGuarantorsChanged(next: ClientProfile[]) {
  const known = new Set(selectedGuarantors.value.map((g) => g.id))
  selectedGuarantors.value = next
  for (const g of next) if (!known.has(g.id)) void loadGuarantorRisk(g.id)
}

// ─── Риск-сводка по поручителю ──────────────────────────────────────
// Показываем в момент выбора: после подписания договора узнать, что человек
// уже отвечает за несколько чужих рассрочек, поздно. Ошибку запроса глотаем —
// проверка не должна мешать заводить сделку.
const guarantorRisk = ref<Record<string, GuarantorBrief>>({})
const guarantorRiskLoading = ref<Record<string, boolean>>({})

async function loadGuarantorRisk(profileId: string) {
  if (guarantorRisk.value[profileId] || guarantorRiskLoading.value[profileId]) return
  guarantorRiskLoading.value[profileId] = true
  try {
    guarantorRisk.value[profileId] = await api.get<GuarantorBrief>(`/guarantors/brief/${profileId}`)
  } catch {
    // молча: без сводки форма работает как раньше
  } finally {
    guarantorRiskLoading.value[profileId] = false
  }
}

// ─── Draft persistence ──────────────────────────────────────────────
// All form refs are declared above, so it's safe to take references to
// them here (no temporal-dead-zone issue) and to register the watcher.
// Restore happens in onMounted (skipped in edit-mode — that's a real
// deal, not a draft); save is debounced through scheduleDraftSave.
const dealDraft = useDealDraft(authStore.user?.id ?? null)
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null
// `isRestoringDraft` shields the watcher from re-saving everything it
// just loaded. We flip it back on a microtask so Vue's flush-pre
// watcher runs while it's still true.
let isRestoringDraft = false
// Banner-visibility flag — only true when the wizard actually hydrated
// real form values from storage on this mount. Without it, the banner
// would also show when the watcher auto-saves the default cashbox on
// first visit and then re-reads it back, even though the partner had
// no real draft.
const wasRestoredOnMount = ref(false)

async function applyDraftToForm(source?: DealDraft | null) {
  const d = source ?? dealDraft.draft.value
  if (!d) return
  isRestoringDraft = true
  try {
    productName.value = d.productName
    productDescription.value = d.productDescription
    category.value = d.category
    city.value = d.city
    purchasePrice.value = d.purchasePrice
    markupType.value = d.markupType
    markupValue.value = d.markupValue
    manualTotalPrice.value = d.manualTotalPrice
    downPayment.value = d.downPayment
    downPaymentType.value = d.downPaymentType ?? 'fixed'
    downPaymentPercent.value = d.downPaymentPercent ?? null
    termMonths.value = d.termMonths
    paymentType.value = d.paymentType as any
    paymentInterval.value = d.paymentInterval
    dealDate.value = d.dealDate
    customFirstPayment.value = d.customFirstPayment
    useWholesalePrice.value = d.useWholesalePrice
    wholesalePrice.value = d.wholesalePrice
    profitSplitBase.value = d.profitSplitBase
    selectedClientProfileId.value = d.selectedClientProfileId
    selectedClientProfile.value = d.selectedClientProfile
    // Поручители: новый массив, с fallback на legacy-снимок одиночного поручителя.
    if (d.selectedGuarantors && d.selectedGuarantors.length) {
      selectedGuarantors.value = [...d.selectedGuarantors]
    } else if (d.selectedGuarantorProfile) {
      selectedGuarantors.value = [d.selectedGuarantorProfile]
    } else {
      selectedGuarantors.value = []
    }
    selectedFolderId.value = d.selectedFolderId
    selectedCashBoxId.value = d.selectedCashBoxId
    selectedSupplierId.value = d.selectedSupplierId ?? null
    if (d.paidToSupplier !== undefined) paidToSupplier.value = d.paidToSupplier
    step.value = d.step

    // Эти значения нельзя ставить сразу: наблюдатели за ценой и кассой
    // отрабатывают следом и обнуляют ручные правки — цена, введённая руками,
    // возвращалась расчётной, а состав участников подменялся на «все из кассы».
    await nextTick()
    manualTotalPrice.value = d.manualTotalPrice
    if (d.manualDownPayment !== undefined) manualDownPayment.value = d.manualDownPayment
    if (d.dealParticipants?.length) {
      dealParticipants.value = d.dealParticipants.map((p) => ({ ...p })) as any
      participantsDirty.value = true
    }
  } finally {
    setTimeout(() => { isRestoringDraft = false }, 0)
  }
}

function scheduleDraftSave() {
  if (isEditMode.value) return
  if (isRestoringDraft) return
  // Страница ещё грузится — форма пуста не потому, что её очистили, а потому
  // что до восстановления черновика дело не дошло. Раньше именно здесь он и
  // терялся: подстановка кассы по умолчанию запускала автосохранение, оно
  // через полсекунды видело пустые поля и СТИРАЛО черновик из хранилища —
  // а восстановление, ждавшее ответа сервера по кассе, приходило уже к пустоте.
  if (prefillLoading.value) return
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => {
    // Та же защита в самом таймере: он мог быть запланирован до того, как
    // начался разбор адреса страницы.
    if (isRestoringDraft || prefillLoading.value) return
    // Don't persist a draft that's effectively empty. On first mount
    // we auto-fill selectedCashBoxId with the partner's default
    // cashbox; the watcher used to treat that as "form was edited"
    // and saved a 1-field draft, which then surfaced the restore
    // banner on every subsequent visit even though the partner never
    // typed anything.
    const hasRealContent =
      productName.value.trim().length > 0 ||
      (purchasePrice.value ?? 0) > 0 ||
      !!selectedClientProfileId.value
    if (!hasRealContent) {
      // Стираем сохранённый черновик, только если партнёр очистил ИМЕННО его —
      // то есть форма была им наполнена. Просто зайти в мастер «Создать сделку»
      // с пустой формой не должно уничтожать отложенную работу.
      if (wasRestoredOnMount.value && dealDraft.hasDraft.value) {
        dealDraft.clear()
        wasRestoredOnMount.value = false
      }
      return
    }
    dealDraft.save({
      step: step.value,
      productName: productName.value,
      productDescription: productDescription.value,
      category: category.value,
      city: city.value,
      purchasePrice: purchasePrice.value,
      markupType: markupType.value,
      markupValue: markupValue.value,
      manualTotalPrice: manualTotalPrice.value,
      downPayment: downPayment.value,
      downPaymentType: downPaymentType.value,
      downPaymentPercent: downPaymentPercent.value,
      termMonths: termMonths.value,
      paymentType: paymentType.value,
      paymentInterval: paymentInterval.value,
      dealDate: dealDate.value,
      customFirstPayment: customFirstPayment.value,
      useWholesalePrice: useWholesalePrice.value,
      wholesalePrice: wholesalePrice.value,
      profitSplitBase: profitSplitBase.value,
      selectedClientProfileId: selectedClientProfileId.value,
      selectedClientProfile: selectedClientProfile.value,
      selectedGuarantors: selectedGuarantors.value,
      selectedFolderId: selectedFolderId.value,
      selectedCashBoxId: selectedCashBoxId.value,
      manualDownPayment: manualDownPayment.value,
      selectedSupplierId: selectedSupplierId.value,
      paidToSupplier: paidToSupplier.value,
      dealParticipants: dealParticipants.value.map((p: DealParticipantRow) => ({ ...p })),
    })
  }, 500)
}

function confirmResetDraft() {
  if (!confirm('Очистить черновик и начать заново?')) return
  resetDraftAndForm()
}

function resetDraftAndForm() {
  dealDraft.clear()
  wasRestoredOnMount.value = false
  productName.value = ''
  productDescription.value = ''
  category.value = ''
  city.value = ''
  purchasePrice.value = null
  markupType.value = 'percent'
  markupValue.value = 15
  manualTotalPrice.value = null
  downPayment.value = null
  downPaymentType.value = 'fixed'
  downPaymentPercent.value = null
  manualDownPayment.value = null
  downPaymentExceeded.value = false
  termMonths.value = 6
  paymentType.value = 'EQUAL' as PaymentType
  paymentInterval.value = 'MONTHLY'
  dealDate.value = todayIso()
  customFirstPayment.value = ''
  useWholesalePrice.value = false
  wholesalePrice.value = null
  profitSplitBase.value = 'MARKUP_ONLY'
  selectedClientProfileId.value = null
  selectedClientProfile.value = null
  selectedGuarantors.value = []
  selectedFolderId.value = null
  selectedCashBoxId.value = pickDefaultCashBoxId()
  step.value = 1
}

// Auto-save watcher. Two notes:
//   1) `deep: true` — большинство ref'ов примитивы или переприсваиваемые
//      объекты, но selectedGuarantors — массив, изменяемый через push/splice,
//      поэтому нужен глубокий обход, чтобы черновик сохранял добавление/удаление
//      поручителей.
//   2) Debounced inside scheduleDraftSave so the actual localStorage
//      write happens at most once per 500ms.
watch(
  [
    productName, productDescription, category, city,
    purchasePrice, markupType, markupValue, manualTotalPrice,
    downPayment, downPaymentType, downPaymentPercent, termMonths, paymentType, paymentInterval,
    dealDate, customFirstPayment,
    useWholesalePrice, wholesalePrice, profitSplitBase,
    selectedClientProfileId,
    selectedClientProfile, selectedGuarantors,
    selectedFolderId, selectedCashBoxId,
    // Ручной взнос, поставщик и состав участников тоже надо запоминать —
    // без них восстановленный черновик отличался бы от того, что видел партнёр.
    manualDownPayment, selectedSupplierId, paidToSupplier, dealParticipants,
    step,
  ],
  scheduleDraftSave,
  { deep: true },
)


function onClientSelected(profile: ClientProfile | null) {
  selectedClientProfile.value = profile
}

// Create client dialog
const showCreateDialog = ref(false)

function openCreateDialog() {
  showCreateDialog.value = true
}

function onClientCreated(profile: ClientProfile) {
  // Нового клиента сразу видно первым в списке и он выбран: иначе партнёр
  // заводит человека и не понимает, куда тот делся.
  peoplePickerRef.value?.prepend(profile)
  selectedClientProfileId.value = profile.id
  selectedClientProfile.value = profile
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
// No need to gate on the down-payment error any more: the amount is clamped to
// the total price on input, so it can never reach an invalid state. The error
// is shown only as informational feedback.
// Потолок графика — зеркало серверного лимита (MAX_PAYMENTS на бэке). Без него
// опечатка в сроке заводила сделку на тысячи платежей: график растягивался на
// столетия, а строки платежей плодились в базе.
const MAX_PAYMENTS = 120
const termTooLong = computed(() => (termMonths.value ?? 0) > MAX_PAYMENTS)
const step2Valid = computed(
  () => (purchasePrice.value ?? 0) > 0 && termMonths.value > 0 && !termTooLong.value,
)
const step3Valid = computed(() => !!selectedClientProfileId.value)

function nextStep() { if (step.value < 4) step.value++ }
function prevStep() { if (step.value > 1) step.value-- }

function canProceed() {
  if (step.value === 1) return step1Valid.value
  // Insufficient capital is no longer a hard block — partner is warned at
  // submit time (dialog) and can still proceed; the cashbox simply goes
  // into negative balance.
  if (step.value === 2) return step2Valid.value
  if (step.value === 3) return step3Valid.value
  return true
}

const submitting = ref(false)
const insufficientCapitalDialog = ref(false)

function confirmOverdraftAndSubmit() {
  insufficientCapitalDialog.value = false
  void submitDeal(true)
}

async function submitDeal(acknowledgedOverdraft = false) {
  // Insufficient-capital warning. Backend no longer blocks creation —
  // it just lets the cashbox go negative. Partners asked for a heads-up
  // so they don't accidentally overdraft. Edit mode skips the dialog
  // (the deal already exists; changing it shouldn't re-prompt).
  if (!isEditMode.value && capitalInsufficient.value && !acknowledgedOverdraft) {
    insufficientCapitalDialog.value = true
    return
  }

  try {
    // Phase 4 — guard against silent CI recompute. When editing an
    // existing deal, changing wholesalePrice or profitSplitBase causes
    // the server to call rewriteForDeal, which deletes existing
    // PROFIT_ACCRUED entries and creates new ones based on the new
    // settings. CI's realizedProfit is decremented/incremented to
    // match. If the deal already has paid payments, this means CI
    // accrual numbers will change. Partner must explicitly acknowledge.
    if (isEditMode.value && editId.value) {
      const newWholesale = useWholesalePrice.value ? (wholesalePrice.value || 0) : null
      const wholesaleChanged = newWholesale !== initialWholesalePrice.value
      const splitBaseChanged = profitSplitBase.value !== initialProfitSplitBase.value
      if (wholesaleChanged || splitBaseChanged) {
        const ok = window.confirm(
          'Изменение оптовой цены или режима распределения прибыли пересчитает ' +
          'ранее начисленную долю инвесторов по этой сделке.\n\n' +
          'Если по сделке уже были оплаченные платежи, суммы у CI могут ' +
          'измениться (увеличиться или уменьшиться).\n\n' +
          'Продолжить?',
        )
        if (!ok) return
      }
    }

    // Phase 4: catch a bad per-deal override before we hit the server, so the
    // partner gets a clear message instead of a swallowed 400 after save.
    const overrideError = validateParticipantOverrides()
    if (overrideError) {
      toast.error(overrideError)
      return
    }

    submitting.value = true

    if (isEditMode.value && editId.value) {
      // Edit flow — update fields, regenerate schedule if needed.
      // wholesalePrice/profitSplitBase changes trigger rewriteForDeal
      // server-side which recomputes CI accruals.
      await dealsStore.updateDeal(editId.value, {
        productName: productName.value,
        purchasePrice: purchasePrice.value || 0,
        markupPercent: markupPercent.value,
        // Явная цена в рублях — источник истины. Без неё сервер пересчитывал
        // цену из процента, и у сделок с процентом «от цены продажи» долг
        // клиента молча уменьшался при каждом сохранении.
        totalPrice: programTotalPrice.value ?? totalPrice.value,
        // 0 — валидное значение (убрать первоначальный взнос), поэтому ?? , не ||
        downPayment: downPaymentAmount.value ?? undefined,
        numberOfPayments: termMonths.value,
        dealDate: dealDate.value,
        firstPaymentDate: customFirstPayment.value || undefined,
        wholesalePrice: useWholesalePrice.value ? (wholesalePrice.value || 0) : null,
        profitSplitBase: profitSplitBase.value,
      })
      // Клиент меняется отдельным эндпоинтом: UpdateDealDto его не принимает,
      // и раньше поле молча отсекалось валидацией — из формы редактирования
      // клиент не сохранялся вообще. Дёргаем только при реальной смене: вызов
      // затирает legacy-поля externalClientName/Phone.
      if (
        selectedClientProfileId.value &&
        selectedClientProfileId.value !== initialClientProfileId.value
      ) {
        try {
          await dealsStore.updateClient(editId.value, selectedClientProfileId.value)
          initialClientProfileId.value = selectedClientProfileId.value
        } catch (e: any) {
          toast.error(e.message || 'Не удалось сменить клиента')
        }
      }
      // Поручители (до 5) заменяются целиком через отдельный эндпоинт.
      // Порядок = порядок в списке, первый = основной.
      try {
        await dealsStore.updateGuarantors(editId.value, selectedGuarantorIds.value)
      } catch (e: any) {
        toast.error(e.message || 'Не удалось сохранить поручителей')
      }
      // Cashbox change goes through the dedicated move endpoint so it also
      // rewrites the journal scope, not just the deal row.
      const originalCashBoxId = (await dealsStore.fetchDeal(editId.value))?.cashBoxId ?? null
      if (selectedCashBoxId.value && selectedCashBoxId.value !== originalCashBoxId) {
        await cashboxesStore.moveDeal(editId.value, selectedCashBoxId.value)
      }
      // Phase 4: persist per-deal participation whenever the partner touched it
      // (including reverting to default — a "differs from default" check would
      // miss that). A cashbox move already re-linked to the destination's CIs;
      // this writes the partner's exact intent on top. Surface failures instead
      // of silently leaving the deal with the wrong participants.
      if (participantsDirty.value) {
        try {
          await syncDealParticipants(editId.value)
        } catch (e: any) {
          toast.error(e.message || 'Не удалось сохранить участников сделки')
        }
      }
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
      // До 5 поручителей (порядок = порядок добавления, первый = основной).
      guarantorProfileIds: selectedGuarantorIds.value.length ? selectedGuarantorIds.value : undefined,
      productName: productName.value,
      productPhotos: photoUrls.length ? photoUrls : undefined,
      contractPhotos: contractUrls.length ? contractUrls : undefined,
      purchasePrice: purchasePrice.value || 0,
      markupPercent: markupPercent.value,
      // Точная цена в рублях. У программы она считается по её же формуле:
      // передавать вместо неё процент нельзя — сервер восстановил бы цену из
      // округлённого процента и получил другую сумму, а строгая программа
      // отклонила бы корректно оформленную сделку.
      totalPrice: programTotalPrice.value ?? (manualTotalPrice.value !== null ? manualTotalPrice.value : undefined),
      downPayment: downPaymentAmount.value || undefined,
      numberOfPayments: termMonths.value,
      // Программа: сервер подставит и проверит условия, а в сделке останется
      // снимок — им потом объясняется, откуда взялась эта цена.
      ...(selectedProgramId.value
        ? { programId: selectedProgramId.value }
        : manualRounding.value !== 'NONE'
          ? { rounding: manualRounding.value }
          : {}),
      paymentInterval: paymentInterval.value,
      paymentType: paymentType.value,
      dealDate: dealDate.value,
      firstPaymentDate: customFirstPayment.value || undefined,
      // Wholesale price + split mode (Phase 3). Both optional; only
      // sent when partner enabled the wholesale section. Default mode
      // is MARKUP_ONLY (legacy behavior — wholesalePrice acts as
      // analytics-only data unless partner explicitly flips to
      // FULL_MARGIN to share retail margin with co-investors).
      wholesalePrice: useWholesalePrice.value ? (wholesalePrice.value || undefined) : undefined,
      profitSplitBase: useWholesalePrice.value ? profitSplitBase.value : undefined,
      cashBoxId: selectedCashBoxId.value || undefined,
      // Счета движений. Пусто — сервер определит сам.
      deployAccountId: deployAccountId.value || undefined,
      downPaymentAccountId: downPaymentAccountId.value || undefined,
      // Партнёр-поставщик + оплачен ли он. paidToSupplier=false создаёт долг.
      supplierId: selectedSupplierId.value || undefined,
      paidToSupplier: selectedSupplierId.value ? paidToSupplier.value : undefined,
      supplierRequestId: fromSupplierRequestId.value || undefined,
      // Phase 4: when the partner customised participation, send the explicit
      // set WITH the create request so it's applied atomically — before the
      // down-payment accrual runs. Omit otherwise → backend defaults to every
      // cashbox CI (legacy behaviour). This replaces the old create-then-PUT,
      // which accrued the down payment to the default set first.
      participants: participantsCustomized.value ? buildParticipantsPayload() : undefined,
    })

    // Participation was sent WITH the create request above (atomic, applied
    // before the down-payment accrual) — no separate call needed here.

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

    // Deal is committed — drop the draft so the floater hides and a
    // fresh navigation to /create-deal starts blank.
    dealDraft.clear()
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
    <!-- Restored-draft hint. Shown when the wizard was rehydrated from a
         previously saved draft, so the partner knows where the
         pre-filled values came from and how to discard them. Hidden in
         edit-mode (real deal) and once they save/clear. -->
    <div v-if="!isEditMode && wasRestoredOnMount" class="draft-restored-banner">
      <v-icon icon="mdi-content-save-outline" size="16" />
      <span>
        Восстановлены данные из черновика.
        <span class="draft-restored-note">Фото и договоры нужно прикрепить заново.</span>
      </span>
      <button class="draft-restored-reset" @click="confirmResetDraft">
        Начать заново
      </button>
    </div>
    <!-- Custom stepper header -->
    <div class="stepper-header" :class="{ 'stepper-header--loading': prefillLoading }">
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

    <!-- Пока данные сделки/черновика не подставлены, показываем скелет той же
         формы. Раньше здесь были настоящие пустые поля — визуально
         неотличимые от создания новой сделки. -->
    <div v-if="prefillLoading" class="wizard-layout wizard-skeleton" aria-busy="true">
      <div class="wizard-main">
        <div class="wz-status">
          <v-progress-circular indeterminate size="18" width="2" color="primary" />
          <span>{{ prefillLabel }}…</span>
        </div>

        <div class="wz-card">
          <div class="wz-head">
            <div class="wz-bar wz-bar--icon" />
            <div class="wz-head-text">
              <div class="wz-bar" style="width: 190px; height: 15px;" />
              <div class="wz-bar" style="width: 260px;" />
            </div>
          </div>

          <div v-for="n in 4" :key="n" class="wz-field">
            <div class="wz-bar" style="width: 120px;" />
            <div class="wz-bar wz-bar--input" />
          </div>

          <div class="wz-row">
            <div class="wz-field wz-field--half">
              <div class="wz-bar" style="width: 90px;" />
              <div class="wz-bar wz-bar--input" />
            </div>
            <div class="wz-field wz-field--half">
              <div class="wz-bar" style="width: 110px;" />
              <div class="wz-bar wz-bar--input" />
            </div>
          </div>
        </div>

      </div>

      <aside class="wizard-preview">
        <div class="wz-card wz-card--preview">
          <div class="wz-bar" style="width: 130px; height: 14px;" />
          <div class="wz-bar wz-bar--photo" />
          <div v-for="n in 5" :key="n" class="wz-preview-row">
            <div class="wz-bar" style="width: 40%;" />
            <div class="wz-bar" style="width: 25%;" />
          </div>
        </div>
      </aside>
    </div>

    <div v-else class="wizard-layout" :class="{ 'wizard-layout--review': step === 4 }">
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
            <div class="input-clearable">
              <input
                v-model="productName"
                type="text"
                class="field-input"
                placeholder="Например: iPhone 15 Pro Max 256GB"
              />
              <button
                v-if="productName"
                type="button"
                class="input-clear"
                title="Очистить"
                @click="productName = ''"
              >
                <v-icon icon="mdi-close" size="15" />
              </button>
            </div>
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
            <SelectField
              :model-value="city || null"
              :options="CITIES.map((c) => ({ value: c, label: c }))"
              placeholder="Выберите город"
              @update:model-value="city = $event ?? ''"
            />
          </div>

          <!-- Photos -->
        <!-- Партнёр-поставщик: это про товар — у кого он выкуплен, а не про
             условия рассрочки, поэтому спрашиваем здесь, на первом шаге. -->
            <div v-if="suppliersEnabled" class="form-field full-width">
              <label class="field-label">Партнёр-поставщик</label>
              <SupplierSelect
                v-model="selectedSupplierId"
                :items="supplierItems"
                placeholder="У кого выкупили товар (необязательно)"
                @create-new="supplierFormOpen = true"
              />

              <div v-if="selectedSupplierId" class="sup-paid-row">
                <label class="wholesale-checkbox-label">
                  <input type="checkbox" :checked="paidToSupplier" @change="paidToSupplier = !paidToSupplier" />
                  <span>Оплачено поставщику</span>
                </label>
                <span v-if="!paidToSupplier" class="sup-debt-hint">
                  <v-icon icon="mdi-cash-minus" size="14" /> Долг поставщику: {{ formatCurrency(supplierDebtAmount) }}
                </span>
              </div>
            </div>

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

        <!-- Тариф выбирается здесь, в заголовке: он задаёт всё остальное на
             шаге, и место ему рядом с названием шага, а не в середине полей. -->
        <div v-if="availablePrograms.length && !isEditMode" class="step-tariff">
          <label class="step-tariff-label">Ваши тарифы</label>
          <SelectField
            v-model="selectedProgramId"
            :options="availablePrograms.map((p) => ({
              value: p.id,
              label: p.name,
              hint: p.strict ? 'строгий' : undefined,
            }))"
            empty-label="Без тарифа — условия вручную"
          />
        </div>
      </div>

          <!-- Закупка: за сколько купили товар. Отдельным блоком — как касса,
               счета и участники ниже: каждый смысловой кусок своей карточкой. -->
          <v-card rounded="lg" elevation="0" border class="pa-5">
            <div class="section-header-sm">
              <v-icon icon="mdi-tag-outline" size="18" />
              <span>Закупка</span>
            </div>
            <div class="form-grid">
              <div class="form-field full-width">
                <label class="field-label">Закупочная цена <span class="required">*</span></label>
                <div class="input-with-suffix">
                  <input :value="maskedMoney(purchasePrice)" v-maska="CURRENCY_MASK" @maska="(e: any) => purchasePrice = parseMasked(e)" type="text" inputmode="numeric" class="field-input" :class="{ 'field-input--error': capitalInsufficient }" placeholder="0" />
                  <button
                    v-if="purchasePrice"
                    type="button"
                    class="input-clear input-clear--suffixed"
                    title="Очистить"
                    @click="purchasePrice = null"
                  >
                    <v-icon icon="mdi-close" size="15" />
                  </button>
                  <span class="input-suffix">₽</span>
                </div>
                <!-- Capital hint — shows the SELECTED cashbox's available capital.
                     Overdraft is allowed; the hint just warns the partner. -->
                <div v-if="cashBoxCapital" class="capital-hint" :class="{ 'capital-hint--error': capitalInsufficient }">
                  <v-icon :icon="capitalInsufficient ? 'mdi-alert-circle' : 'mdi-wallet-outline'" size="14" />
                  <template v-if="capitalInsufficient">
                    Касса уйдёт в минус. Доступно: {{ formatCurrency(cashBoxCapital.availableCapital) }}
                  </template>
                  <template v-else>
                    Доступно в кассе: {{ formatCurrency(cashBoxCapital.availableCapital) }}
                  </template>
                </div>
              </div>

              <!-- Wholesale price (опционально, видно только партнёру) -->
              <div class="form-field full-width wholesale-section">
                <div class="wholesale-toggle-row">
                  <label class="wholesale-checkbox-label">
                    <input
                      type="checkbox"
                      :checked="useWholesalePrice"
                      @change="useWholesalePrice = !useWholesalePrice"
                    />
                    <span>Указать оптовую закупочную цену</span>
                  </label>
                  <span class="wholesale-hint">только для вашего учёта</span>
                </div>

                <div v-if="useWholesalePrice" class="wholesale-body">
                  <label class="field-label mt-3">Оптовая цена закупки</label>
                  <div class="input-with-suffix">
                    <input
                      :value="maskedMoney(wholesalePrice)"
                      v-maska="CURRENCY_MASK"
                      @maska="(e: any) => wholesalePrice = parseMasked(e)"
                      type="text"
                      inputmode="numeric"
                      class="field-input"
                      placeholder="0"
                    />
                    <button
                      v-if="wholesalePrice"
                      type="button"
                      class="input-clear input-clear--suffixed"
                      title="Очистить"
                      @click="wholesalePrice = null"
                    >
                      <v-icon icon="mdi-close" size="15" />
                    </button>
                    <span class="input-suffix">₽</span>
                  </div>

                  <!-- Retail margin preview -->
                  <div v-if="retailMargin > 0" class="wholesale-margin-hint">
                    <v-icon icon="mdi-trending-up" size="14" />
                    Розничная маржа: {{ formatCurrency(retailMargin) }}
                    <span class="wholesale-margin-sub">
                      ({{ formatCurrency(purchasePrice || 0) }} − {{ formatCurrency(wholesalePrice || 0) }})
                    </span>
                  </div>

                  <!-- Profit split mode toggle -->
                  <div class="wholesale-split-block mt-3">
                    <div class="wholesale-split-title">Как делить прибыль с инвесторами</div>
                    <div class="wholesale-split-options">
                      <button
                        type="button"
                        class="split-option"
                        :class="{ active: profitSplitBase === 'MARKUP_ONLY' }"
                        @click="profitSplitBase = 'MARKUP_ONLY'"
                      >
                        <div class="split-option-title">Только наценку рассрочки</div>
                        <div class="split-option-desc">
                          Розничная маржа — полностью вам. Инвестор получает долю
                          только от наценки за рассрочку.
                        </div>
                      </button>
                      <button
                        type="button"
                        class="split-option"
                        :class="{ active: profitSplitBase === 'FULL_MARGIN' }"
                        @click="profitSplitBase = 'FULL_MARGIN'"
                      >
                        <div class="split-option-title">Всю прибыль</div>
                        <div class="split-option-desc">
                          Инвестор получает долю и от розничной маржи, и от наценки
                          за рассрочку.
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </v-card>

          <!-- Условия рассрочки. С тарифом карточка окрашивается в мягкий
               зелёный: видно, что цифры пришли из собственного тарифа. -->
          <v-card
            rounded="lg"
            elevation="0"
            border
            class="pa-5 mt-4 terms-card"
            :class="{ 'terms-card--tariff': !!selectedProgram }"
          >
            <div class="terms-card-head">
              <div class="terms-card-title">
                <!-- Имя тарифа партнёр часто уже начинает со слова «тариф» —
                     второй раз его не повторяем. -->
                <template v-if="selectedProgram">{{ tariffTitle }}</template>
                <template v-else>Условия рассрочки</template>
              </div>
              <button
                v-if="selectedProgram && canEditPrograms"
                class="terms-edit-btn"
                type="button"
                @click="programDialog = true"
              >
                <v-icon icon="mdi-pencil-outline" size="14" />
                Изменить тариф
              </button>
            </div>
            <div class="form-grid">


                <div v-if="programMismatch" class="field-hint-styled program-hint program-hint--warn">
                  <v-icon icon="mdi-alert-outline" size="14" />
                  <span v-if="programTerms.length">
                    Для этой суммы в тарифе есть сроки: {{ programTerms.join(', ') }}
                  </span>
                  <span v-else>
                    Для этой суммы в тарифе нет условий — выберите другой или снимите
                  </span>
                </div>
                <div v-else-if="programRule" class="tariff-note">
                  <v-icon icon="mdi-check-circle-outline" size="14" />
                  <span>
                    Наценка <b>{{ programRule.markupPercent }}%</b>
                    {{ selectedProgram?.markupBase === 'OF_COST' ? 'от закупки' : 'от цены продажи' }}
                    — по тарифу для {{ termMonths }} {{ termUnitShort }}
                    <template v-if="programMinDownPayment">
                      · минимальный взнос {{ formatCurrency(programMinDownPayment) }}
                    </template>
                    <template v-if="selectedProgram?.rounding !== 'NONE'">
                      · платёж округляется {{ ROUNDING_LABEL[selectedProgram!.rounding] }}
                    </template>
                    <!-- Наценку задаёт тариф: у каждого срока своя. Без этой
                         строки партнёр правит процент и не понимает, почему
                         сделка всё равно уходит по тарифной цене. -->
                    <br />
                    Чтобы задать свои условия, выберите «Без тарифа».
                  </span>
                </div>


                <!-- Что получилось по тарифу: наценка в рублях и цена договора.
                     Полей ввода здесь нет — их задаёт тариф. -->
                <div v-if="programRule && (purchasePrice || 0) > 0" class="program-result">
                  <div class="program-result-row">
                    <span>Наценка</span>
                    <span class="program-result-value">+{{ formatCurrency(markup) }}</span>
                  </div>
                  <div class="program-result-row program-result-row--total">
                    <span>Цена договора</span>
                    <span class="program-result-value">{{ formatCurrency(totalPrice) }}</span>
                  </div>
                </div>

              <!-- Тариф выбран — наценку задаёт он, и поле здесь только мешает:
                   заблокированный серый блок выглядел поломкой. Что подставлено,
                   написано под селектом тарифа. -->
              <div v-if="!programLocked" class="form-field full-width">
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
                  <!-- В рублях наценка — деньги, и читается так же, как все
                       остальные суммы в форме: «15 000», а не «15000».
                       В процентах маска не нужна — там две-три цифры. -->
                  <input
                    v-if="markupType === 'fixed'"
                    :value="maskedMoney(markupValue)"
                    v-maska="CURRENCY_MASK"
                    type="text"
                    inputmode="numeric"
                    class="field-input"
                    placeholder="15 000"
                    @maska="(e: any) => markupValue = parseMasked(e)"
                  />
                  <!-- Текстовое поле с маской, а не `type=number`: браузер не
                       умеет показывать разряды в числовом поле, и «88815»
                       читалось как сплошная лента цифр. -->
                  <input
                    v-else
                    :value="maskedPercent(markupValue)"
                    v-maska="PERCENT_MASK"
                    type="text"
                    inputmode="decimal"
                    class="field-input"
                    placeholder="15"
                    @maska="(e: any) => markupValue = parseMasked(e)"
                  />
                  <button
                    v-if="markupValue"
                    type="button"
                    class="input-clear input-clear--suffixed"
                    title="Очистить"
                    @click="markupValue = 0"
                  >
                    <v-icon icon="mdi-close" size="15" />
                  </button>
                  <span class="input-suffix">{{ markupType === 'percent' ? '%' : '₽' }}</span>
                </div>

                <!-- В процентах на экране одни проценты, а решение принимают по
                     деньгам: сколько это в рублях и во что обойдётся клиенту.
                     Суммы — с разделением разрядов, как везде в форме. -->
                <div
                  v-if="markupType === 'percent' && (purchasePrice || 0) > 0 && markupValue > 0"
                  class="field-hint-styled"
                >
                  <v-icon icon="mdi-information-outline" size="14" />
                  Наценка {{ formatCurrency(markup) }} · итоговая цена {{ formatCurrency(totalPrice) }}
                </div>
              </div>

              <div v-if="markupType === 'fixed' && !programLocked" class="form-field full-width">
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
                <div class="field-label-row">
                  <label class="field-label">Первоначальный взнос</label>
                  <div class="markup-type-toggle">
                    <button class="toggle-btn" :class="{ active: downPaymentType === 'percent' }" @click="switchDownPaymentType('percent')">%</button>
                    <button class="toggle-btn" :class="{ active: downPaymentType === 'fixed' }" @click="switchDownPaymentType('fixed')">₽</button>
                  </div>
                </div>

                <!-- Fixed (₽) mode -->
                <template v-if="downPaymentType === 'fixed'">
                  <div class="input-with-suffix" :class="{ 'input-with-suffix--error': downPaymentError }">
                    <input
                      :value="maskedMoney(downPayment)"
                      v-maska="CURRENCY_MASK"
                      @maska="(e: any) => setDownPaymentFixed(parseMasked(e))"
                      type="text"
                      inputmode="numeric"
                      class="field-input"
                      placeholder="0"
                    />
                    <button
                      v-if="downPayment"
                      type="button"
                      class="input-clear input-clear--suffixed"
                      title="Очистить"
                      @click="setDownPaymentFixed(0)"
                    >
                      <v-icon icon="mdi-close" size="15" />
                    </button>
                    <span class="input-suffix">₽</span>
                  </div>
                  <div v-if="downPaymentAmount > 0 && totalPrice > 0 && !downPaymentError" class="field-hint-styled">
                    <v-icon icon="mdi-information-outline" size="14" />
                    {{ Math.round(downPaymentAmount / totalPrice * 100 * 10) / 10 }}% от итоговой цены
                  </div>
                </template>

                <!-- Percent (%) mode: percent input + auto-computed ₽ amount -->
                <template v-else>
                  <div class="chip-group">
                    <button
                      v-for="opt in downPaymentPercentOptions" :key="opt"
                      class="chip-option" :class="{ active: downPaymentPercent === opt }"
                      @click="downPaymentPercentModel = opt"
                    >{{ opt }}%</button>
                  </div>
                  <div class="input-with-suffix mt-2" :class="{ 'input-with-suffix--error': downPaymentError }">
                    <input
                      :value="maskedPercent(downPaymentPercent)"
                      v-maska="PERCENT_MASK"
                      type="text"
                      inputmode="decimal"
                      class="field-input"
                      placeholder="10"
                      @maska="(e: any) => downPaymentPercentModel = e.detail.unmasked === '' ? null : parseMasked(e)"
                    />
                    <button
                      v-if="downPaymentPercent"
                      type="button"
                      class="input-clear input-clear--suffixed"
                      title="Очистить"
                      @click="downPaymentPercentModel = null"
                    >
                      <v-icon icon="mdi-close" size="15" />
                    </button>
                    <span class="input-suffix">%</span>
                  </div>
                  <label class="field-label mt-3 d-block">Сумма взноса</label>
                  <div class="input-with-suffix">
                    <input
                      :value="maskedMoney(downPaymentRublesModel)"
                      v-maska="CURRENCY_MASK"
                      @maska="(e: any) => downPaymentRublesModel = parseMasked(e)"
                      type="text"
                      inputmode="numeric"
                      class="field-input"
                      placeholder="0"
                    />
                    <button
                      v-if="downPaymentRublesModel"
                      type="button"
                      class="input-clear input-clear--suffixed"
                      title="Очистить"
                      @click="downPaymentRublesModel = 0"
                    >
                      <v-icon icon="mdi-close" size="15" />
                    </button>
                    <span class="input-suffix">₽</span>
                  </div>
                  <div class="field-hint-styled">
                    <v-icon icon="mdi-information-outline" size="14" />
                    Сумма рассчитывается от итоговой цены {{ formatCurrency(totalPrice) }}
                  </div>
                </template>

                <div v-if="downPaymentError" class="field-error-text">{{ downPaymentError }}</div>
              </div>

              <div class="form-field full-width">
                <label class="field-label">Срок рассрочки</label>
                <div class="chip-group">
                  <button
                    v-for="opt in (programTerms.length ? programTerms : termOptions)" :key="opt"
                    class="chip-option" :class="{ active: termMonths === opt }"
                    @click="termMonths = opt"
                  >{{ opt }} {{ termUnitShort }}</button>
                </div>
                <!-- Свой срок — только при ручном оформлении: у тарифа сроки
                     перечислены заранее, и произвольный он всё равно не примет. -->
                <div v-if="!selectedProgram" class="input-with-suffix mt-2">
                  <input
                    v-model.number="termMonths"
                    type="number"
                    class="field-input"
                    placeholder="6"
                    min="1"
                    :max="MAX_PAYMENTS"
                  />
                  <span class="input-suffix">мес</span>
                </div>
                <div v-if="termTooLong" class="term-limit-warn">
                  <v-icon icon="mdi-alert-circle-outline" size="14" />
                  Слишком длинный график: не больше {{ MAX_PAYMENTS }} платежей
                </div>
              </div>

              <!-- Округление платежа: у сделки по тарифу это его условие,
                   поэтому выбор показываем только при ручном оформлении. -->
              <div v-if="!selectedProgram" class="form-field full-width">
                <label class="field-label">Округлять платёж</label>
                <SelectField
                  :model-value="manualRounding"
                  :options="ROUNDING_OPTIONS"
                  @update:model-value="manualRounding = ($event as ProgramRounding) ?? 'NONE'"
                />
                <div v-if="manualRounding !== 'NONE'" class="field-hint-styled">
                  <v-icon icon="mdi-information-outline" size="14" />
                  Платёж станет ровным, разница уйдёт в последний
                </div>
              </div>

              <!-- Payment type fixed: EQUAL -->
            </div>
          </v-card>

          <!-- Даты: когда заключили и когда первый платёж. -->
          <v-card rounded="lg" elevation="0" border class="pa-5 mt-4">
            <div class="section-header-sm">
              <v-icon icon="mdi-calendar-outline" size="18" />
              <span>Даты</span>
            </div>
            <div class="form-grid">
              <div class="form-field full-width">
                <label class="field-label">Дата заключения сделки</label>
                <DateField v-model="dealDate" plain />
              </div>

              <div class="form-field full-width">
                <label class="field-label">Дата первого платежа <span class="text-medium-emphasis">(необязательно)</span></label>
                <DateField
                  v-model="customFirstPayment"
                  :placeholder="firstPaymentDate"
                  :max="firstPaymentMax"
                  plain
                />
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

          <!-- Cashbox — every deal lives in exactly one cashbox. Always visible
               so the partner sees "where is this deal going" explicitly, even
               when there's only the default «Основная» (single chip selected). -->
          <v-card v-if="cashboxesStore.items.length > 0" rounded="lg" elevation="0" border class="pa-5 mt-4">
            <div class="section-header-sm">
              <v-icon icon="mdi-wallet-outline" size="18" />
              <span>Касса</span>
              <span class="text-caption text-medium-emphasis ml-1">— из какой кассы покупаем</span>
            </div>
            <div class="folder-list">
              <button
                v-for="b in cashboxesStore.items"
                :key="b.id"
                type="button"
                class="folder-chip"
                :class="{ active: selectedCashBoxId === b.id, 'folder-chip--locked': !!b.lockedAt }"
                :disabled="!!b.lockedAt"
                :title="b.lockedAt ? 'Касса в режиме «только просмотр» — новые сделки недоступны' : ''"
                :style="{
                  '--folder-color': b.color,
                  borderColor: selectedCashBoxId === b.id ? b.color : undefined,
                  background: selectedCashBoxId === b.id ? `${b.color}14` : undefined,
                  color: selectedCashBoxId === b.id ? b.color : undefined,
                }"
                @click="!b.lockedAt && (selectedCashBoxId = b.id)"
              >
                <v-icon :icon="b.lockedAt ? 'mdi-lock-outline' : b.icon" size="16" />
                <span>{{ b.name }}</span>
                <span v-if="b.lockedAt" class="folder-chip-tag">только просмотр</span>
              </button>
            </div>
          </v-card>

          <!-- Счета сделки: с какого счёта ушли деньги на закупку и на какой
               пришёл первый взнос. Речь о движении денег в кассе, а не о
               расчётах с поставщиком: «откуда платим поставщику» сбивало с
               толку — партнёру всё равно, чем он рассчитался, ему важно, какой
               счёт уменьшился. Секции нет, пока счета не заведены. -->
          <!-- overflow-visible: карточка Vuetify по умолчанию обрезает
               содержимое ради скругления, и выпадающий список счёта уходил
               под её границу. -->
          <v-card
            v-if="usableAccounts.length > 0"
            rounded="lg"
            elevation="0"
            border
            class="pa-5 mt-4 deal-accounts-card"
          >
            <div class="section-header-sm">
              <v-icon icon="mdi-bank-outline" size="18" />
              <span>Счета сделки</span>
              <span class="text-caption text-medium-emphasis ml-1">— какие счёта затронет эта сделка</span>
            </div>

            <div class="deal-accounts">
              <div class="deal-account-field">
                <label class="deal-account-label">С какого счёта ушли деньги на закупку</label>
                <AccountSelect
                  v-model="deployAccountId"
                  :items="usableAccounts"
                  empty-label="Определить автоматически"
                />
              </div>

              <div v-if="(downPaymentAmount || 0) > 0" class="deal-account-field">
                <label class="deal-account-label">На какой счёт пришёл первый взнос</label>
                <AccountSelect
                  v-model="downPaymentAccountId"
                  :items="usableAccounts"
                  empty-label="Определить автоматически"
                />
              </div>
            </div>

            <div class="deal-accounts-hint">
              «Автоматически» — счёт этой кассы или счёт по умолчанию. Если подходящего
              нет, деньги встанут в «не разнесено» и их можно будет разнести позже.
              <br />
              Платежи по графику сюда не привязаны: счёт выбирается при приёме каждого
              платежа, по умолчанию — счёт этой кассы.
            </div>
          </v-card>

          <!-- Phase 4: per-deal co-investor participation. Only shown when the
               chosen cashbox actually has co-investors. -->
          <v-card v-if="dealParticipants.length > 0" rounded="lg" elevation="0" border class="pa-5 mt-4">
            <div class="section-header-sm">
              <v-icon icon="mdi-account-group-outline" size="18" />
              <span>Участники прибыли</span>
              <span class="text-caption text-medium-emphasis ml-1">— кто делит прибыль этой сделки</span>
            </div>
            <div class="participants-list">
              <div
                v-for="p in dealParticipants"
                :key="p.id"
                class="participant-row"
                :class="{ 'participant-row--off': !p.participates }"
              >
                <button
                  type="button"
                  class="participant-check"
                  :class="{ active: p.participates }"
                  @click="toggleParticipant(p)"
                >
                  <v-icon :icon="p.participates ? 'mdi-check' : 'mdi-plus'" size="15" />
                </button>
                <div class="participant-info">
                  <div class="participant-name">{{ p.name }}</div>
                  <div class="participant-sub">
                    <template v-if="p.costFeeMode">Комиссия от закупки</template>
                    <template v-else-if="p.profitPercent != null && p.profitPercent > 0">По умолчанию фикс {{ p.profitPercent }}%</template>
                    <template v-else>По умолчанию по вкладу<template v-if="(p.managementFeePct ?? 0) > 0"> · комиссия {{ p.managementFeePct }}%</template></template>
                  </div>
                  <!-- Live split for a participating cost-fee investor -->
                  <template v-if="p.participates && p.costFeeMode && p.costFeeRate != null">
                    <div v-if="costFeeCalc(p).invalid" class="participant-costfee-error">
                      Комиссия должна быть больше 0 и меньше наценки
                    </div>
                    <div v-else class="participant-costfee-calc">
                      <div>Партнёр заработает: {{ formatCurrency(costFeeCalc(p).partnerFee) }}</div>
                      <div>Инвестор получит: {{ formatCurrency(costFeeCalc(p).total) }}</div>
                      <div class="participant-costfee-sub">
                        возврат капитала {{ formatCurrency(purchasePrice || 0) }} + доход {{ formatCurrency(costFeeCalc(p).net) }}
                      </div>
                    </div>
                  </template>
                </div>
                <!-- Поле справа по режиму: cost-fee → ставка; фикс → % override;
                     по вкладу → комиссия партнёра для этой сделки. -->
                <div v-if="p.participates && p.costFeeMode" class="participant-override">
                  <input
                    v-model.number="p.costFeeRate"
                    @input="markParticipantsDirty"
                    type="number"
                    min="0"
                    max="100"
                    class="participant-override-input"
                    :class="{ 'participant-override-input--error': p.costFeeRate != null && costFeeCalc(p).invalid }"
                    placeholder="ставка"
                  />
                  <span class="participant-override-suffix">%</span>
                </div>
                <div v-else-if="p.participates && p.profitPercent != null && p.profitPercent > 0" class="participant-override">
                  <input
                    v-model.number="p.override"
                    @input="markParticipantsDirty"
                    type="number"
                    min="1"
                    max="99"
                    class="participant-override-input"
                    :placeholder="String(p.profitPercent)"
                  />
                  <span class="participant-override-suffix">%</span>
                </div>
                <!-- По вкладу → комиссия партнёра % для этой сделки (0..100). -->
                <div
                  v-else-if="p.participates"
                  class="participant-override participant-override--fee"
                  title="Комиссия партнёра для этой сделки"
                >
                  <span class="participant-override-cap">комиссия</span>
                  <div class="participant-override-field">
                    <input
                      v-model.number="p.mgmtFeeOverride"
                      @input="markParticipantsDirty"
                      type="number"
                      min="0"
                      max="100"
                      class="participant-override-input"
                      :placeholder="(p.managementFeePct ?? 0) > 0 ? String(p.managementFeePct) : '0'"
                    />
                    <span class="participant-override-suffix">%</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="participants-hint">
              По умолчанию прибыль делят все инвесторы кассы. Уберите лишних или задайте отдельный процент для этой сделки.
              Инвестор в режиме «комиссия от закупки» задаёт ставку % от закупки и должен быть единственным участником.
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

      <!-- Клиент и поручители — одним блоком: сверху табы, ниже список
           клиентов с поиском. Раньше здесь стояли два пустых поля поиска, и
           партнёры не понимали, как вообще выбрать человека. -->
      <v-card rounded="lg" elevation="0" border class="pa-5 mb-4">
        <DealPeoplePicker
          ref="peoplePickerRef"
          :client-id="selectedClientProfileId"
          :client="selectedClientProfile"
          :guarantors="selectedGuarantors"
          :max-guarantors="MAX_GUARANTORS"
          @update:client-id="selectedClientProfileId = $event"
          @update:client="onClientSelected"
          @update:guarantors="onGuarantorsChanged"
          @create="openCreateDialog"
        />
      </v-card>

      <!-- Риск-сводка по каждому поручителю: сколько чужих рассрочек он уже
           тянет. После подписания узнавать об этом поздно. -->
      <GuarantorRiskAlert
        v-for="g in selectedGuarantors"
        :key="`risk-${g.id}`"
        :brief="guarantorRisk[g.id] ?? null"
        :loading="guarantorRiskLoading[g.id]"
      />

      <!-- Create client dialog -->
      <CreateClientDialog v-model="showCreateDialog" @created="onClientCreated" />
    </div>

    <!-- Step 4: Review -->
    <!-- Слева тот же расклад, что и в превью справа: два одинаковых блока на
         одном экране только удваивают чтение. Оставляем превью — оно и есть
         сводка сделки, — а здесь только заголовок шага. -->
    <div v-if="step === 4" class="step-content step-content--review">
      <div class="step-title-row">
        <div class="step-icon-wrap" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-check-decagram" size="22" />
        </div>
        <div>
          <div class="step-title">Обзор сделки</div>
          <div class="step-subtitle">Проверьте данные перед созданием</div>
        </div>
      </div>
    </div>

    </div><!-- /wizard-main -->

    <!-- Live preview -->
    <aside class="wizard-preview">
      <!-- Превью — те же секции в обоих режимах: узкой колонкой на шагах
           формы и раскладкой в три колонки на «Обзоре», где ширина позволяет
           не растягивать сводку на два экрана вниз. -->
      <div class="preview-card" :class="{ 'preview-card--wide': step === 4 }">
        <div class="preview-header">
          <v-icon icon="mdi-file-document-check-outline" size="18" />
          <span>Превью сделки</span>
        </div>

        <div class="preview-body">
          <!-- ── Товар: что продаём, когда и чем это отзовётся в кассе ── -->
          <section class="pv-col pv-col--subject">
            <div class="pv-col-title">
              <v-icon icon="mdi-package-variant-closed" size="13" />
              Товар и сроки
            </div>

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

            <div v-if="cashBoxCapital && (purchasePrice || 0) > 0" class="preview-capital">
              <v-icon icon="mdi-wallet-outline" size="14" />
              <span class="preview-capital-label">Капитал кассы после сделки</span>
              <span class="preview-capital-value" :class="{ 'preview-capital-value--negative': capitalAfterDeal < 0 }">{{ formatCurrency(capitalAfterDeal) }}</span>
            </div>
          </section>

          <!-- ── Стоимость: из чего складывается цена ── -->
          <section class="pv-col pv-col--money">
            <div class="pv-col-title">
              <v-icon icon="mdi-cash-multiple" size="13" />
              Стоимость
            </div>

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

          </section>

          <!-- ── Платёж: что клиент платит каждый месяц и сколько это даёт ── -->
          <section class="pv-col pv-col--payment">
            <div class="pv-col-title">
              <v-icon icon="mdi-calendar-check-outline" size="13" />
              Платёж и прибыль
            </div>

            <div v-if="monthlyPayment > 0 && termMonths > 0" class="preview-schedule">
              <div class="preview-schedule-top">Ежемесячный платёж</div>
              <div class="preview-schedule-value">{{ formatCurrency(monthlyPayment) }}</div>
              <div class="preview-schedule-label">
                × {{ termMonths }} {{ termMonths === 1 ? 'месяц' : termMonths < 5 ? 'месяца' : 'месяцев' }} · равные платежи
                <template v-if="lastPaymentDiffers"> · последний {{ formatCurrency(lastPayment) }}</template>
              </div>
            </div>

            <!-- Прибыль по сделке. ROI отсюда убран: процент к закупке ничего
                 не добавляет к решению, а место занимал. -->
            <div v-if="markup > 0" class="preview-metrics preview-metrics--single">
              <div class="preview-metric">
                <div class="preview-metric-label">Прибыль</div>
                <div class="preview-metric-value preview-metric-value--green">{{ formatCurrency(markup) }}</div>
              </div>
            </div>
          </section>

          <!-- ── График: тот же, что будет в созданной сделке. Партнёр видит
               даты и суммы до сохранения, а не после. ── -->
          <section v-if="previewSchedule.length" class="pv-col pv-col--plan">
            <div class="pv-col-title">
              <v-icon icon="mdi-calendar-month-outline" size="13" />
              График платежей
              <span class="pv-col-count">{{ previewSchedule.length }}</span>
            </div>

            <div class="preview-plan">
              <div class="preview-plan-head">
                <span>График платежей</span>
                <span class="preview-plan-count">{{ previewSchedule.length }}</span>
              </div>
              <div class="preview-plan-list">
                <div v-for="row in previewPlanRows.head" :key="row.n" class="preview-plan-row">
                  <span class="preview-plan-num">{{ row.n }}</span>
                  <span class="preview-plan-date">{{ row.date }}</span>
                  <span class="preview-plan-sum">{{ formatCurrency(row.amount) }}</span>
                </div>
                <div v-if="previewPlanRows.hidden" class="preview-plan-more">
                  ещё {{ previewPlanRows.hidden }}
                </div>
                <div v-for="row in previewPlanRows.tail" :key="`t-${row.n}`" class="preview-plan-row">
                  <span class="preview-plan-num">{{ row.n }}</span>
                  <span class="preview-plan-date">{{ row.date }}</span>
                  <span class="preview-plan-sum">{{ formatCurrency(row.amount) }}</span>
                </div>
              </div>
              <div v-if="step === 4 && previewSchedule.length > 8" class="preview-plan-scroll">
                <v-icon icon="mdi-gesture-swipe-vertical" size="13" />
                Прокрутите — всего {{ previewSchedule.length }} платежей
              </div>
              <div v-if="lastPaymentDiffers" class="preview-plan-note">
                Последний платёж другой: округление сдвигает разницу в конец графика.
              </div>
            </div>
          </section>

          <!-- ── Люди: клиент, поручители и те, кто делит прибыль ── -->
          <section
            v-if="selectedClientProfile || selectedGuarantors.length || participatingList.length"
            class="pv-col pv-col--people"
          >
            <div class="pv-col-title">
              <v-icon icon="mdi-account-multiple-outline" size="13" />
              Участники
            </div>

            <div class="pv-people">
              <div v-if="selectedClientProfile" class="preview-client">
                <div class="preview-section-label">
                  <v-icon icon="mdi-account-outline" size="14" />
                  Клиент
                </div>
                <div class="preview-client-name">{{ getClientDisplayName(selectedClientProfile) }}</div>
                <div v-if="selectedClientProfile.phone" class="preview-client-phone">{{ selectedClientProfile.phone }}</div>
              </div>

              <div v-if="selectedGuarantors.length" class="preview-client">
                <div class="preview-section-label">
                  <v-icon icon="mdi-account-supervisor-outline" size="14" />
                  Поручители ({{ selectedGuarantors.length }})
                </div>
                <div v-for="(g, idx) in selectedGuarantors" :key="g.id" class="preview-guarantor-item">
                  <div class="preview-client-name">
                    {{ getClientDisplayName(g) }}
                    <span v-if="idx === 0" class="preview-guarantor-main">· основной</span>
                  </div>
                  <div v-if="g.phone" class="preview-client-phone">{{ g.phone }}</div>
                </div>
              </div>

              <!-- Phase 4: co-investors sharing THIS deal's profit. -->
              <div v-if="participatingList.length" class="preview-coinvestors">
                <div class="preview-section-label">
                  <v-icon icon="mdi-account-group-outline" size="14" />
                  Участники прибыли ({{ participatingList.length }})
                </div>
                <div class="preview-coinvestor-list">
                  <div v-for="ci in participatingList" :key="ci.id" class="preview-coinvestor">
                    <span class="preview-coinvestor-name">{{ ci.name }}</span>
                    <span class="preview-coinvestor-share">
                      <template v-if="ci.costFeeMode">комиссия {{ ci.costFeeRate ?? 0 }}%</template>
                      <template v-else-if="ci.effectivePercent != null">
                        {{ ci.effectivePercent }}%
                      </template>
                      <template v-else>по вкладу<template v-if="(ci.effectiveMgmtFee ?? 0) > 0"> · комиссия {{ ci.effectiveMgmtFee }}%</template></template>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </aside>

    </div><!-- /wizard-layout -->

    <!-- Кнопки шага — липкой панелью внизу экрана: на длинных шагах (условия,
         выбор клиента, обзор) «Далее» иначе оказывается за пределами экрана, и
         до неё приходится доматывать. Панель — последний элемент страницы,
         поэтому она не перекрывает контент, а придерживается низа окна. -->
    <div class="wizard-footer">
      <div class="wizard-footer__inner">
        <button v-if="step > 1" class="btn-secondary" @click="prevStep">
          <v-icon icon="mdi-arrow-left" size="18" />
          Назад
        </button>
        <div v-else />
        <div class="wizard-footer__step">Шаг {{ step }} из 4 · {{ steps[step - 1]?.title }}</div>
        <button v-if="step < 4" class="btn-primary" :disabled="!canProceed()" @click="nextStep">
          Далее
          <v-icon icon="mdi-arrow-right" size="18" />
        </button>
        <button v-else class="btn-primary btn-primary--success" :disabled="submitting" @click="submitDeal()">
          <v-progress-circular v-if="submitting" indeterminate size="16" width="2" color="white" class="mr-1" />
          <v-icon v-else icon="mdi-check" size="18" />
          {{ submitting ? (isEditMode ? 'Сохранение...' : 'Создание...') : (isEditMode ? 'Сохранить изменения' : 'Создать сделку') }}
        </button>
      </div>
    </div>
    </template>

    <!-- Insufficient-capital warning. Cashbox is allowed to go negative;
         this dialog is purely advisory so the partner can confirm. -->
    <v-dialog v-model="insufficientCapitalDialog" max-width="440" :fullscreen="isMobile">
      <v-card rounded="lg" class="pa-6 text-center overdraft-dialog">
        <div class="overdraft-icon mb-4">
          <v-icon icon="mdi-alert-circle-outline" size="28" color="#f59e0b" />
        </div>
        <div class="text-h6 font-weight-bold mb-2">Недостаточно капитала в кассе</div>
        <div class="text-body-2 text-medium-emphasis mb-5">
          В выбранной кассе доступно
          <strong class="overdraft-amount">{{ formatCurrency(cashBoxCapital?.availableCapital ?? 0) }}</strong>,
          а для этой сделки нужно
          <strong class="overdraft-amount">{{ formatCurrency(purchasePrice || 0) }}</strong>.
        </div>
        <div class="overdraft-deficit mb-6">
          <v-icon icon="mdi-trending-down" size="14" />
          Касса уйдёт в минус на <strong>{{ formatCurrency(capitalDeficit) }}</strong>
        </div>
        <div class="d-flex ga-3">
          <button class="btn-secondary flex-grow-1" @click="insufficientCapitalDialog = false">Отмена</button>
          <button class="btn-warning flex-grow-1" @click="confirmOverdraftAndSubmit">Создать всё равно</button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Быстрое создание партнёра-поставщика из формы сделки -->
    <SupplierFormDialog v-model="supplierFormOpen" @saved="onSupplierCreated" />

    <!-- Тариф правится прямо отсюда: то же окно, что в настройках. -->
    <ProgramEditDialog
      v-model="programDialog"
      :program="selectedProgram"
      :existing-count="programs.length"
      @saved="onProgramSaved"
    />
  </div>
</template>

<style scoped>
/* Программа рассрочки: подсказка под селектом и блокировка полей у строгой. */
.program-hint { margin-top: 6px; }
.program-hint--warn { color: #b45309; }
.program-locked { position: relative; }
.program-locked::after {
  content: '';
  position: absolute; inset: 0; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  cursor: not-allowed;
}

/* ── Выбор клиента и поручителей ── */
.picker-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 4px;
}
.picker-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 12px; border-radius: 9px;
  border: 1px solid rgba(4, 120, 87, 0.3);
  background: rgb(var(--v-theme-surface));
  font-size: 12.5px; font-weight: 600; color: #047857; cursor: pointer;
}
.picker-add-btn:hover { background: rgba(4, 120, 87, 0.08); }
.picker-hint {
  font-size: 12.5px; line-height: 1.45; margin-bottom: 10px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* ── Условия рассрочки: своя карточка ── */
.terms-card-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
}
.terms-card-title { font-size: 15px; font-weight: 700; }
/* Тариф — фирменный зелёный, как его же карточка в настройках: партнёр видит
   тот самый тариф, который сам завёл, а не «ещё одну секцию формы». */
.terms-card--tariff {
  background: linear-gradient(135deg, #047857 0%, #065f46 55%, #064e3b 100%);
  border-color: transparent !important;
  color: #fff;
}
.terms-card--tariff .terms-card-title { color: #fff; }
.terms-card--tariff .field-label,
.terms-card--tariff .field-hint-styled { color: rgba(255, 255, 255, 0.7); }

/* Поля внутри зелёной карточки — белые, и текст в них должен быть тёмным.
   `.field-input` наследует цвет (`color: inherit`), а карточка задаёт белый —
   набранное становилось белым по белому и пропадало из виду. */
.terms-card--tariff .field-input,
.terms-card--tariff .field-select,
.terms-card--tariff .input-with-suffix input {
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.terms-card--tariff .field-input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.35);
}
/* Подпись единицы (₽, %) живёт поверх белого поля, а не поверх градиента. */
.terms-card--tariff .input-suffix { color: rgba(var(--v-theme-on-surface), 0.45); }

/* Пояснение и сводка — на полупрозрачной подложке поверх зелёного. */
.terms-card--tariff .tariff-note {
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.9);
}
.terms-card--tariff .tariff-note b { color: #fff; }
.terms-card--tariff .program-result { background: rgba(0, 0, 0, 0.16); }
.terms-card--tariff .program-result-row { color: rgba(255, 255, 255, 0.72); }
.terms-card--tariff .program-result-row--total {
  color: #fff; border-top-color: rgba(255, 255, 255, 0.18);
}

/* Быстрый выбор срока: невыбранные — прозрачные, выбранный — белый. */
.terms-card--tariff .chip-option {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.85);
}
.terms-card--tariff .chip-option:hover { background: rgba(255, 255, 255, 0.2); }
.terms-card--tariff .chip-option.active { background: #fff; color: #047857; border-color: #fff; }

/* Переключатель «% / ₽» у взноса на зелёном. */
.terms-card--tariff .markup-type-toggle { background: rgba(255, 255, 255, 0.14); }
.terms-card--tariff .toggle-btn { color: rgba(255, 255, 255, 0.7); }
.terms-card--tariff .toggle-btn.active { background: #fff; color: #047857; }

.terms-edit-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px; padding: 0 11px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.16);
  font-size: 12.5px; font-weight: 600; color: #fff; cursor: pointer;
}
.terms-edit-btn:hover { background: rgba(255, 255, 255, 0.26); }

/* Селект тарифа в шапке шага. */
.step-tariff { margin-left: auto; min-width: 240px; }
.step-tariff-label {
  display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
@media (max-width: 760px) {
  .step-tariff { margin-left: 0; width: 100%; }
}

/* Пояснение внутри карточки тарифа: в тон карточке, а не синей плашкой. */
.tariff-note {
  display: flex; align-items: flex-start; gap: 7px;
  padding: 9px 11px; border-radius: 10px;
  background: rgba(4, 120, 87, 0.07);
  font-size: 12.5px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.tariff-note--muted { background: rgba(var(--v-theme-on-surface), 0.04); }
.tariff-note b { color: #047857; }

/* Что подставил тариф: цифры вместо заблокированных полей ввода. */
.program-result {
  margin-top: 10px; padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.program-result-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 4px 0; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.program-result-row--total {
  margin-top: 4px; padding-top: 8px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.program-result-value { font-variant-numeric: tabular-nums; font-weight: 700; }

/* ── Счета сделки ── */
.deal-accounts-card { overflow: visible; }
.deal-accounts { display: flex; gap: 12px; flex-wrap: wrap; }
.deal-account-field { flex: 1; min-width: 240px; }
.deal-account-label {
  display: block; font-size: 12.5px; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.deal-account-select {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.deal-account-select:focus { border-color: #047857; }
.deal-accounts-hint {
  font-size: 11.5px; line-height: 1.45; margin-top: 10px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.term-limit-warn {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  font-size: 12px;
  color: #ef4444;
}
/* Партнёр-поставщик в форме сделки */
.sup-paid-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 12px; }
.sup-debt-hint { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 700; color: #ef4444; }

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
.dark .limit-gate__btn--secondary { background: rgb(var(--v-theme-surface-elevated)); color: #fff; }

/* Wizard two-column layout */
/* ── Скелет мастера на время подгрузки сделки/черновика ──
   Повторяет раскладку формы, чтобы при появлении данных ничего не прыгало. */
.stepper-header--loading { pointer-events: none; opacity: 0.5; }

.wz-status {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 16px;
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.wz-card {
  padding: 22px;
  border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.wz-card--preview { display: flex; flex-direction: column; gap: 14px; }

.wz-head { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
.wz-head-text { display: flex; flex-direction: column; gap: 8px; flex: 1; }

.wz-field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
.wz-row { display: flex; gap: 14px; }
.wz-field--half { flex: 1; min-width: 0; }


.wz-preview-row { display: flex; justify-content: space-between; gap: 12px; }

/* Сама «плашка». Мерцание, а не спиннер в каждой строке: спокойнее выглядит
   и не спорит с индикатором в заголовке. */
.wz-bar {
  height: 11px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  animation: wz-pulse 1.4s ease-in-out infinite;
}
.wz-bar--icon { width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0; }
.wz-bar--input { height: 46px; border-radius: 10px; }
.wz-bar--photo { height: 120px; border-radius: 12px; }

@keyframes wz-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* Разная задержка — «волна» сверху вниз вместо мигания всей формы разом. */
.wz-field:nth-child(2) .wz-bar { animation-delay: 0.08s; }
.wz-field:nth-child(3) .wz-bar { animation-delay: 0.16s; }
.wz-field:nth-child(4) .wz-bar { animation-delay: 0.24s; }
.wz-field:nth-child(5) .wz-bar { animation-delay: 0.32s; }

@media (prefers-reduced-motion: reduce) {
  .wz-bar { animation: none; }
}

.wizard-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(480px, 560px);
  gap: 24px;
  align-items: start;
}
.wizard-main {
  min-width: 0;
}
/* Превью держится у верха экрана, но не длиннее самого экрана: иначе низ
   сводки уходил бы и под шапку, и под липкую панель кнопок — без шанса его
   увидеть. Что не влезло — прокручивается внутри колонки. */
.wizard-preview {
  position: sticky;
  top: 16px;
  align-self: start;
  max-height: calc(100vh - 108px);
  overflow-y: auto;
}
.wizard-preview .preview-card { position: static; }

/* Обзор: расклад сделки один — превью. Оно занимает всю ширину и раскладывает
   секции по колонкам: то же содержимое, но лист не уходит на два экрана вниз. */
/* Двойной класс — чтобы раскладку «Обзора» не перебивали медиазапросы ниже:
   у них та же специфичность, но они идут позже по файлу. */
.wizard-layout.wizard-layout--review {
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}
/* Сводка читается как документ: одна колонка по центру, чуть шире формы.
   Заголовок шага при этом остаётся у левого края — как на остальных шагах и
   страницах, иначе он повисает посреди пустоты. */
.wizard-layout--review .wizard-main { width: 100%; }
.wizard-layout--review .wizard-preview {
  width: 100%;
  max-width: 780px;
  margin: 0 auto;
}
.wizard-layout--review .wizard-preview {
  position: static;
  order: 0;
  max-height: none;
  overflow: visible;
}

/* ── Секции превью ──────────────────────────────────────────────────────
   Одна и та же разметка работает в двух режимах: узкой колонкой рядом с формой
   (секции идут стопкой, заголовки не нужны — блоки и так различимы) и широким
   листом на «Обзоре», где секции становятся отдельными карточками с подписями. */
.preview-body { display: flex; flex-direction: column; gap: 20px; }
.pv-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.pv-col-title { display: none; }
.pv-col .preview-plan { margin-top: 0; }
.pv-people { display: flex; flex-direction: column; gap: 16px; }

/* Режим «Обзора»: белый лист, секции идут сверху вниз отдельными карточками —
   каждая со своей подписью, чтобы сводка читалась по разделам. */
/* Двойной класс: ниже по файлу есть ещё одно правило .preview-card с зелёным
   градиентом — с одинаковой специфичностью оно бы перебило белый лист. */
.preview-card.preview-card--wide {
  position: static;
  padding: 20px 22px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.dark .preview-card.preview-card--wide {
  background: rgb(var(--v-theme-surface));
  border-color: rgb(var(--v-theme-border));
}
.preview-card--wide .preview-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.preview-card--wide .pv-col {
  gap: 12px;
  padding: 14px 16px 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface));
}
.preview-card--wide .pv-col-title {
  display: flex; align-items: center; gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.pv-col-count {
  margin-left: auto;
  padding: 1px 7px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  font-size: 11px; letter-spacing: 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Внутри карточки-секции вложенные подложки лишние: фон уже даёт секция. */
.preview-card--wide .preview-finance { background: transparent; padding: 0; gap: 8px; }
.preview-card--wide .preview-finance--secondary {
  padding: 10px 12px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
}
.preview-card--wide .preview-plan {
  margin: 0; padding: 0; border: none; background: transparent;
}
.preview-card--wide .preview-plan-head { display: none; }
.preview-card--wide .preview-metric { background: transparent; padding: 0; text-align: left; }
.preview-card--wide .preview-metrics {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  padding-top: 10px;
}

/* Компактнее по высоте: фото меньше, «платёж месяца» — строкой, а не плакатом. */
.preview-card--wide .preview-product-photo { width: 60px; height: 60px; border-radius: 10px; }
.preview-card--wide .preview-product-name { font-size: 15px; margin-bottom: 6px; }
.preview-card--wide .preview-schedule { padding: 12px 14px; text-align: left; }
.preview-card--wide .preview-schedule-value { font-size: 24px; }
.preview-card--wide .preview-schedule-label { font-size: 12px; margin-top: 4px; }
.preview-card--wide .preview-row--total .preview-row-value { font-size: 16px; }

/* График целиком, но с прокруткой: 24 платежа не должны растягивать лист. */
.preview-card--wide .preview-plan-list {
  max-height: 268px;
  overflow-y: auto;
  padding-right: 4px;
}

.preview-plan-scroll {
  display: flex; align-items: center; gap: 5px;
  margin-top: 8px;
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Люди — последней строкой во всю ширину: их блоки короткие и в колонку
   складываться не должны. */
.preview-card--wide .pv-people {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px 18px;
}

@media (max-width: 699px) {
  .preview-card--wide .pv-people { grid-template-columns: minmax(0, 1fr); }
  .preview-card--wide .preview-plan-list { max-height: none; }
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
    max-height: none;
    overflow: visible;
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

/* ── График платежей в превью ── */
.preview-plan {
  margin-top: 14px; padding: 12px 14px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.preview-plan-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.preview-plan-count {
  padding: 1px 7px; border-radius: 8px; font-size: 11px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.preview-plan-row {
  display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center;
  padding: 6px 0; font-size: 13px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
  font-variant-numeric: tabular-nums;
}
.preview-plan-row:last-child { border-bottom: none; }
.preview-plan-num {
  font-size: 11px; font-weight: 700; text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.preview-plan-date { color: rgba(var(--v-theme-on-surface), 0.6); }
.preview-plan-sum { font-weight: 700; }
.preview-plan-more {
  padding: 5px 0 5px 30px; font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.preview-plan-note {
  margin-top: 8px; font-size: 11.5px; line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* ── Округление платежа в шаге «Условия» ── */
.rounding-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.rounding-row .field-label { margin: 0; }
.rounding-select { width: 180px; }
.rounding-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); }

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
.preview-metrics--single { grid-template-columns: minmax(0, 1fr); }
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

.preview-guarantor-item {
  margin-bottom: 6px;
}
.preview-guarantor-item:last-child {
  margin-bottom: 0;
}
.preview-guarantor-main {
  font-size: 11px;
  color: #6366f1;
  font-weight: 600;
}

/* Guarantor multi-select chips */
.guarantor-chips {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.guarantor-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.guarantor-chip__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #6366f1;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  text-transform: uppercase;
}
.guarantor-chip__info {
  flex: 1;
  min-width: 0;
}
.guarantor-chip__name {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.guarantor-chip__badge {
  font-size: 10px;
  font-weight: 700;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.12);
  border-radius: 6px;
  padding: 1px 6px;
  text-transform: uppercase;
}
.guarantor-chip__phone {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.guarantor-chip__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.guarantor-chip__remove:hover {
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}
.guarantor-limit-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  padding: 8px 0;
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
  background: rgb(var(--v-theme-surface-deep));
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

/* Restored-draft hint shown above the stepper when the wizard was
   rehydrated from a previously saved draft. */
.draft-restored-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(14, 165, 233, 0.08);
  color: rgba(14, 165, 233, 0.95);
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 14px;
}
.draft-restored-banner > span { flex: 1; }
.draft-restored-note {
  display: inline-block;
  margin-left: 4px;
  color: rgba(14, 165, 233, 0.7);
  font-weight: 400;
}
.draft-restored-reset {
  border: none;
  background: transparent;
  color: rgba(14, 165, 233, 0.95);
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.draft-restored-reset:hover { color: rgb(14, 165, 233); }

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
  .stepper-header {
    justify-content: center;
    padding: 12px 14px;
    margin-bottom: 16px;
  }
  .stepper-dot {
    width: 32px; height: 32px; min-width: 32px;
    border-radius: 9px;
  }
}

/* Title row на мобиле — иконка чуть меньше, тайтл компактнее. */
@media (max-width: 599px) {
  .step-title-row {
    gap: 12px;
    margin-bottom: 16px;
  }
  .step-icon-wrap {
    width: 38px; height: 38px; min-width: 38px;
    border-radius: 10px;
  }
  .step-title { font-size: 16px; }
  .step-subtitle { font-size: 12px; }
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
/* Wholesale price section — Phase 3 */
.wholesale-section {
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 12px;
  padding: 14px 16px;
}
.wholesale-toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wholesale-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.wholesale-checkbox-label input {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #6366f1;
}
.wholesale-hint {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-left: auto;
}
.wholesale-body {
  margin-top: 10px;
}
.wholesale-margin-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(34, 197, 94, 0.08);
  color: #16a34a;
  font-size: 12px;
  font-weight: 500;
}
.wholesale-margin-sub {
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-family: ui-monospace, monospace;
}
.wholesale-split-block {
  border-top: 1px dashed rgba(99, 102, 241, 0.2);
  padding-top: 12px;
}
.wholesale-split-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 8px;
}
.wholesale-split-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.split-option {
  text-align: left;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px;
  /* Был жёсткий #fff при тематическом цвете текста: в тёмной теме получался
     белый текст на белой карточке — выбор способа деления прибыли не читался. */
  background: rgb(var(--v-theme-surface-elevated));
  cursor: pointer;
  transition: all 0.15s;
}
.split-option:hover {
  border-color: rgba(99, 102, 241, 0.4);
}
.split-option.active {
  border-color: #6366f1;
  background: rgba(99, 102, 241, 0.06);
}
.split-option-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 4px;
}
.split-option-desc {
  font-size: 11px;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
@media (max-width: 600px) {
  .wholesale-split-options { grid-template-columns: 1fr; }
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
/* Поля белые, как в остальных формах: серая заливка читалась как
   «поле заблокировано». */
.field-input {
  width: 100%; height: 44px; padding: 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit;
  background: rgb(var(--v-theme-surface));
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

/* Крестик очистки поля.
   В полях с подписью единицы (₽, %) он встаёт левее неё, иначе они наезжают
   друг на друга; в обычных — у самого края. */
.input-clear {
  position: absolute; right: 10px; top: 22px; transform: translateY(-50%);
  width: 24px; height: 24px; border: none; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.35);
  cursor: pointer; z-index: 1;
}
.input-clear:hover {
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.input-clear--suffixed { right: 34px; }
.input-with-suffix:has(.input-clear) .field-input { padding-right: 62px; }
/* Поле без подписи единицы: место под крестик всё равно нужно. */
.input-clearable { position: relative; }
.input-clearable .field-input { padding-right: 40px; }

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
  padding: 8px 16px; border-radius: 20px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
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
  background: #fff;
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

/* Actions — липкая панель шага внизу окна.
   Отрицательные поля растягивают её на всю ширину страницы (у .at-page свои
   боковые отступы), а внутренний контейнер возвращает контент на место. */
/* Страница тянется на всю высоту окна, а панель прижата к её низу: иначе на
   коротком содержимом (скелет загрузки, пустой шаг) она всплывала бы посреди
   экрана. Sticky держит её на месте, когда содержимое длиннее экрана. */
.at-page {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - var(--lyt-header-h, 72px));
}
.wizard-footer {
  position: sticky;
  bottom: 0;
  z-index: 6;
  margin: auto -32px -24px;
  padding: 12px 32px calc(12px + env(safe-area-inset-bottom, 0px));
  flex: none;
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 -6px 18px rgba(15, 23, 42, 0.05);
}
.wizard-footer__inner {
  display: flex; align-items: center; gap: 16px;
}
/* Подпись между кнопками: на липкой панели она заменяет шапку степпера,
   которая на длинных шагах уезжает вверх. */
.wizard-footer__step {
  flex: 1;
  text-align: center;
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.wizard-footer__inner > .btn-primary,
.wizard-footer__inner > .btn-secondary { flex: none; }
.wizard-footer__inner > div:not(.wizard-footer__step) { flex: none; width: 0; }
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
/* Белая, как поля формы: прозрачная кнопка на светлом фоне читалась как
   неактивная. */
.btn-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px; padding: 0 24px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.04); }

/* Mobile: кнопки шага равной ширины 50/50, подпись шага не помещается. */
@media (max-width: 767px) {
  .wizard-footer {
    margin: auto -16px -16px;
    padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
  }
}
@media (max-width: 599px) {
  .wizard-footer__inner { gap: 8px; }
  .wizard-footer__step { display: none; }
  .wizard-footer__inner > .btn-primary,
  .wizard-footer__inner > .btn-secondary {
    flex: 1 1 50%;
    padding: 0 12px;
    font-size: 13px;
  }
  .wizard-footer__inner > div:not(.wizard-footer__step) { flex: 1 1 50%; width: auto; }
}

/* Dark mode */
.dark .toggle-btn.active {
  background: rgb(var(--v-theme-surface-elevated)); color: rgba(var(--v-theme-on-surface), 0.92);
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.dark .markup-type-toggle { background: rgb(var(--v-theme-surface)); }
.dark .field-input { background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); color: rgba(var(--v-theme-on-surface), 0.92); }
.dark .field-input:focus {
  border-color: #047857; background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .filter-input { background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); color: rgba(var(--v-theme-on-surface), 0.92); }
.dark .filter-input:focus {
  border-color: #047857; background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .preview-card { background: linear-gradient(135deg, rgba(4, 120, 87, 0.1) 0%, rgba(4, 120, 87, 0.04) 100%); border-color: rgba(4, 120, 87, 0.2); }
.dark .preview-row--highlight-bg { background: rgba(0,0,0,0.15); }
.dark .preview-profit-item { background: rgba(0,0,0,0.15); }
.dark .preview-divider { background: rgba(255,255,255,0.06); }
.dark .client-card { background: rgb(var(--v-theme-surface)); }
.dark .client-card.active { background: rgba(4, 120, 87, 0.08); }
.dark .photo-drop-zone { border-color: rgb(var(--v-theme-border)); }

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

/* Шапка «Обзора»: только заголовок шага — подтверждение ничего не решало и
   отодвигало сводку вниз. */
.step-content--review { margin-bottom: 14px; }
.step-content--review .step-title-row { margin-bottom: 0; }

/* Dark overrides for review */
.dark .stepper-header { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
.dark .review-hero { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
.dark .review-hero__finance { border-color: rgb(var(--v-theme-border)); }
.dark .review-hero__payment { background: linear-gradient(135deg, rgba(4, 120, 87, 0.1) 0%, rgba(4, 120, 87, 0.04) 100%); }
.dark .review-client-card { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }

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

.input-with-suffix--error .field-input {
  border-color: rgba(239, 68, 68, 0.4) !important;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08) !important;
}
.field-error-text {
  margin-top: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #ef4444;
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
.folder-chip--locked {
  opacity: 0.55; cursor: not-allowed;
}
.folder-chip--locked:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
  border-color: rgba(var(--v-theme-on-surface), 0.12);
}
.folder-chip-tag {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  padding: 1px 6px; border-radius: 5px;
  background: rgba(245, 158, 11, 0.15); color: #b45309;
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
.dark .coinvestor-option { background: rgb(var(--v-theme-surface)); }
.dark .coinvestor-option.active { background: rgba(4, 120, 87, 0.1); }
.dark .review-coinvestors { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
.dark .review-coinvestor-chip { background: rgba(4, 120, 87, 0.1); border-color: rgba(4, 120, 87, 0.2); }

/* ── Insufficient-capital dialog ── */
.overdraft-icon {
  width: 56px; height: 56px; border-radius: 50%;
  background: rgba(245, 158, 11, 0.1);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto;
}
.overdraft-amount {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-weight: 700;
  white-space: nowrap;
}
.overdraft-deficit {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px;
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  font-size: 13px; font-weight: 600;
}
.overdraft-deficit strong { font-weight: 700; }

.btn-warning {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 4px; padding: 11px 22px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; color: white; background: #f59e0b;
  cursor: pointer; transition: all 0.15s;
}
.btn-warning:hover { background: #d97706; box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3); }

/* Phase 4: per-deal participants */
.participants-list { display: flex; flex-direction: column; gap: 8px; }
.participant-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  transition: opacity 0.15s;
}
.participant-row--off { opacity: 0.5; }
.participant-check {
  width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.15);
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.4);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: all 0.15s;
}
.participant-check.active { background: #047857; border-color: #047857; color: #fff; }
.participant-info { flex: 1; min-width: 0; }
.participant-name { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }
.participant-sub { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }
.participant-costfee-calc { font-size: 11px; color: #047857; margin-top: 3px; line-height: 1.45; }
.participant-costfee-calc div { white-space: nowrap; }
.participant-costfee-sub { color: rgba(var(--v-theme-on-surface), 0.5); font-size: 10px; }
.participant-costfee-warn { color: #b45309; }
.participant-costfee-error { font-size: 11px; color: #dc2626; margin-top: 3px; font-weight: 500; }
.participant-override { position: relative; display: flex; align-items: center; width: 72px; flex-shrink: 0; }
/* Weight-инвестор: подпись «комиссия» над полем, ниже — сам ввод со суффиксом %. */
.participant-override--fee { flex-direction: column; align-items: flex-end; gap: 2px; }
.participant-override-cap {
  font-size: 10px; font-weight: 600; letter-spacing: 0.01em;
  color: rgba(var(--v-theme-on-surface), 0.45); line-height: 1;
}
.participant-override-field { position: relative; display: flex; align-items: center; width: 100%; }
.participant-override-input {
  width: 100%; padding: 6px 22px 6px 10px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 13px; text-align: right; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85); font-family: inherit; box-sizing: border-box;
}
.participant-override-input:focus { border-color: #047857; }
.participant-override-input--error {
  border-color: #dc2626;
  background: rgba(220, 38, 38, 0.05);
}
.participant-override-input--error:focus { border-color: #dc2626; }
.participant-override-suffix {
  position: absolute; right: 8px; font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35); pointer-events: none;
}
.participants-hint {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 10px; line-height: 1.4;
}
</style>