import { ref, computed } from 'vue'
import type { ClientProfile } from '@/types'

/**
 * One in-progress deal-creation draft per partner, persisted in
 * localStorage. Wizard auto-saves on every form mutation and reads this
 * back on mount. A floating UI lives in the default layout to surface
 * the draft on every other page so a partner doesn't lose work just
 * because they switched tabs or accidentally closed the wizard.
 *
 * Why localStorage and not the backend:
 *   - Partner usually works from one browser; cross-device sync is not a
 *     reported need.
 *   - Auto-save fires on every keystroke (with debounce). Hammering the
 *     backend would be wasteful and add latency.
 *   - No partial-state to clean up if the partner clears site data.
 *
 * Why a singleton ref instead of returning a fresh ref per call: the
 * floater in the layout and the wizard form need to see the SAME draft
 * value. A shared module-scoped ref keeps them in sync without an event
 * bus.
 */

export interface DealDraft {
  // Schema version — bump if the shape changes incompatibly so we can
  // drop stale drafts cleanly instead of crashing the wizard on a
  // partner who left a draft sitting from a previous deploy.
  version: 1
  partnerId: string
  step: number
  updatedAt: string  // ISO

  // Form fields — only what's actually persisted across the wizard
  // session. Files (photos, contracts) are intentionally excluded:
  // browser File objects can't be serialised, and restoring them from
  // base64 would balloon localStorage. Partner re-attaches on resume.
  productName: string
  productDescription: string
  category: string
  city: string
  purchasePrice: number | null
  markupType: 'percent' | 'fixed'
  markupValue: number
  manualTotalPrice: number | null
  downPayment: number | null
  // Down-payment input mode + the percent value (used when mode === 'percent').
  // Optional so drafts saved before this field shipped still restore cleanly.
  downPaymentType?: 'fixed' | 'percent'
  downPaymentPercent?: number | null
  termMonths: number
  paymentType: string
  paymentInterval: string
  dealDate: string
  customFirstPayment: string
  useWholesalePrice: boolean
  wholesalePrice: number | null
  profitSplitBase: 'MARKUP_ONLY' | 'FULL_MARGIN'

  selectedClientProfileId: string | null
  // Legacy-поля одиночного поручителя. Оставлены опциональными для чтения
  // старых сохранённых черновиков; новые черновики пишут selectedGuarantors.
  selectedGuarantorProfileId?: string | null
  selectedGuarantorProfile?: ClientProfile | null
  // Snapshots of the picker objects so the floater can show a name and
  // the wizard can render the picker state without an extra fetch.
  selectedClientProfile: ClientProfile | null
  // Поручители (до 5), порядок = приоритет. Опционально для старых черновиков.
  selectedGuarantors?: ClientProfile[]

  selectedFolderId: string | null
  selectedCashBoxId: string | null
}

const STORAGE_PREFIX = 'mizanpay:deal-draft:'

// Shared singleton ref. Both the wizard and the floater import this
// composable and observe the SAME value.
const currentDraft = ref<DealDraft | null>(null)
// Track which partner the in-memory draft belongs to. When the caller
// passes a different partnerId we re-read from storage instead of
// returning the cached value from the previous partner — otherwise a
// logout/login in the same tab would leak the old draft to the new
// account.
let cachedForPartnerId: string | null = null

function storageKey(partnerId: string): string {
  return STORAGE_PREFIX + partnerId
}

function readFromStorage(partnerId: string): DealDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(partnerId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DealDraft
    // Schema-mismatch guard — discard so the wizard doesn't crash on
    // missing/renamed fields after a deploy.
    if (parsed.version !== 1) return null
    if (parsed.partnerId !== partnerId) return null
    return parsed
  } catch {
    return null
  }
}

export function useDealDraft(partnerId: string | null | undefined) {
  // Re-hydrate from storage whenever the partner identity changes.
  // Covers two cases:
  //   1) First call ever (cachedForPartnerId is null, partnerId set).
  //   2) Logout + login in the same tab (cached id differs from the
  //      new partnerId — previous logic kept the stale draft).
  // When partnerId is null (anonymous / pre-auth), wipe the in-memory
  // draft so the floater doesn't display a leftover from another
  // session.
  if (partnerId !== cachedForPartnerId) {
    currentDraft.value = partnerId ? readFromStorage(partnerId) : null
    cachedForPartnerId = partnerId ?? null
  }

  const hasDraft = computed(() => currentDraft.value != null)

  function save(draft: Omit<DealDraft, 'version' | 'partnerId' | 'updatedAt'>) {
    if (!partnerId) return
    const full: DealDraft = {
      version: 1,
      partnerId,
      updatedAt: new Date().toISOString(),
      ...draft,
    }
    try {
      localStorage.setItem(storageKey(partnerId), JSON.stringify(full))
      currentDraft.value = full
    } catch {
      // Quota / private mode — drop silently. The partner just loses
      // auto-save for this session; explicit submit still works.
    }
  }

  function clear() {
    if (!partnerId) return
    try {
      localStorage.removeItem(storageKey(partnerId))
    } catch {
      // ignore
    }
    currentDraft.value = null
  }

  function reload() {
    if (!partnerId) return
    currentDraft.value = readFromStorage(partnerId)
  }

  return {
    draft: currentDraft,
    hasDraft,
    save,
    clear,
    reload,
  }
}
