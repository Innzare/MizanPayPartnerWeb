import { ref } from 'vue'
import { api } from '@/api/client'

export type RowAction = 'create' | 'update' | 'skip'

export interface DuplicateMatch {
  dealId: string
  reason: 'externalId' | 'phone+product+date'
  hasPayments: boolean
}

export interface FieldError {
  field: string
  message: string
}

export interface DraftRow {
  rowIdx: number
  externalId: string | null
  action: RowAction
  duplicate?: DuplicateMatch
  errors: FieldError[]

  // identity
  clientName?: string
  clientPhone?: string
  productName?: string
  dealDate?: string
  totalPrice?: number

  // financial
  purchasePrice?: number
  downPayment?: number
  markup?: number
  markupPercent?: number
  monthlyPayment?: number
  remainingAmount?: number

  // schedule
  numberOfPayments?: number
  firstPaymentDate?: string

  // guarantor
  guarantorName?: string
  guarantorPhone?: string

  // payments
  payments?: Array<{
    number: number
    dueDate?: string
    amount?: number
    paidAt?: string
    paidAmount?: number
  }>

  // assignments (set in editor)
  folderId?: string | null
  coInvestorId?: string | null
}

export interface DraftStats {
  total: number
  valid: number
  withErrors: number
  duplicates: number
  byAction: { create: number; update: number; skip: number }
}

export interface ImportDraft {
  id: string
  investorId: string
  originalFileName: string
  format: 'horizontal' | 'vertical' | 'custom'
  normalizedData: DraftRow[]
  aiConfidence: Record<string, Record<string, number>>
  duplicateChecks: Record<string, any>
  validationErrors: Record<string, Record<string, string>>
  stats: DraftStats
  status: 'DRAFT' | 'COMMITTED' | 'CANCELLED'
  expiresAt: string
  committedAt: string | null
  createdAt: string
  updatedAt: string
}

export function useImportDraft() {
  const draft = ref<ImportDraft | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const committing = ref(false)

  async function analyze(file: File): Promise<{ id: string; stats: DraftStats; format: string; originalFileName: string }> {
    return api.uploadTo<{ id: string; stats: DraftStats; format: string; originalFileName: string }>(
      '/import/analyze',
      file,
    )
  }

  async function fetchDraft(id: string) {
    loading.value = true
    try {
      draft.value = await api.get<ImportDraft>(`/import/drafts/${id}`)
    } finally {
      loading.value = false
    }
  }

  async function savePatches(id: string, patches: { rowIdx: number; data: Partial<DraftRow> }[]) {
    if (!patches.length) return
    saving.value = true
    try {
      draft.value = await api.patch<ImportDraft>(`/import/drafts/${id}`, { patches })
    } finally {
      saving.value = false
    }
  }

  async function commit(id: string) {
    committing.value = true
    try {
      return await api.post<{ created: number; updated: number; skipped: number }>(
        `/import/drafts/${id}/commit`,
      )
    } finally {
      committing.value = false
    }
  }

  async function cancel(id: string) {
    return api.delete(`/import/drafts/${id}`)
  }

  return { draft, loading, saving, committing, analyze, fetchDraft, savePatches, commit, cancel }
}
