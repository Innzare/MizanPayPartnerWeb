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
  // Phase 3: deals are bound to cashboxes, not directly to CIs.
  cashBoxId?: string | null
}

/** Прогресс фоновой фиксации — сервер пишет его в stats.commitProgress черновика. */
export interface CommitProgress {
  state: 'queued' | 'running' | 'done' | 'failed'
  /** Строк обработано / всего к импорту (без «пропустить»). */
  processed: number
  total: number
  created: number
  updated: number
  skipped: number
  startedAt: string
  /** Только для state='failed' — причина, уже с номером строки. */
  error?: string
}

/** Ответ лёгкого эндпоинта опроса GET /import/drafts/:id/progress. */
export interface CommitStatus {
  id: string
  status: ImportDraft['status']
  progress: CommitProgress | null
  /** Прогон молчит дольше допустимого — сервер считает его умершим. */
  stale: boolean
  /** Место в очереди (1 — следующий на запуск); null, если импорт не ждёт. */
  queuePosition: number | null
}

/**
 * Маленькие файлы сервер фиксирует синхронно и отвечает итогами (как раньше).
 * Большие — в фоне: приходит { async: true }, дальше интерфейс опрашивает
 * прогресс, потому что синхронный запрос на тысячи строк висел минуты и
 * упирался в таймауты.
 */
export type CommitResponse =
  | { created: number; updated: number; skipped: number }
  | { async: true; total: number; skipped: number }
  /**
   * Слоты заняты — импорт встал в очередь. Одновременных фиксаций ограниченное
   * число: параллельные прогоны упирались в память сервера и обрывали друг
   * друга. Интерфейс так же опрашивает прогресс, показывая место в очереди.
   */
  | { queued: true; position: number; total: number; skipped: number }

export interface DraftStats {
  total: number
  valid: number
  withErrors: number
  duplicates: number
  byAction: { create: number; update: number; skip: number }
  commitProgress?: CommitProgress
  unitScale?: {
    suspected: boolean
    rowsTotal: number
    rowsSuspicious: number
    samples: { rowIdx: number; productName: string | null; totalPrice: number; probableTotalPrice: number }[]
    /** Все подозрительные строки (номер + цена) — по ним проверяется подтверждение. */
    suspiciousRows: { rowIdx: number; totalPrice: number }[]
    acknowledged?: boolean
    /** Снимок подозрительных строк на момент подтверждения — зеркало серверного гейта. */
    acknowledgedRows?: { rowIdx: number; totalPrice: number }[]
  }
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
  status: 'DRAFT' | 'QUEUED' | 'COMMITTING' | 'COMMITTED' | 'CANCELLED'
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

  /** Подтвердить, что подозрительно низкие суммы в файле верны (или снять подтверждение). */
  async function confirmUnits(id: string, confirmed: boolean) {
    saving.value = true
    try {
      draft.value = await api.post<ImportDraft>(`/import/drafts/${id}/confirm-units`, { confirmed })
      return draft.value
    } finally {
      saving.value = false
    }
  }

  async function commit(id: string) {
    committing.value = true
    try {
      return await api.post<CommitResponse>(`/import/drafts/${id}/commit`)
    } finally {
      committing.value = false
    }
  }

  /** Лёгкий опрос прогресса фоновой фиксации — без normalizedData (мегабайты JSON). */
  async function fetchProgress(id: string): Promise<CommitStatus> {
    return api.get<CommitStatus>(`/import/drafts/${id}/progress`)
  }

  async function cancel(id: string) {
    return api.delete(`/import/drafts/${id}`)
  }

  async function addRow(id: string) {
    saving.value = true
    try {
      draft.value = await api.post<ImportDraft>(`/import/drafts/${id}/rows`)
      return draft.value
    } finally {
      saving.value = false
    }
  }

  async function deleteRow(id: string, rowIdx: number) {
    saving.value = true
    try {
      draft.value = await api.delete<ImportDraft>(`/import/drafts/${id}/rows/${rowIdx}`)
      return draft.value
    } finally {
      saving.value = false
    }
  }

  return { draft, loading, saving, committing, analyze, fetchDraft, savePatches, commit, fetchProgress, cancel, addRow, deleteRow, confirmUnits }
}
