import { ref } from 'vue'
import { api } from '@/api/client'

export type NisabBase = 'GOLD' | 'SILVER'
export type RecipientCategory =
  | 'FUQARA'
  | 'MASAKIN'
  | 'AMILIN'
  | 'MUALLAFA'
  | 'RIQAB'
  | 'GHARIMIN'
  | 'FI_SABILILLAH'
  | 'IBN_SABIL'

export interface ZakatSettings {
  id: string
  investorId: string
  hawlStartDate: string | null
  nisabBase: NisabBase
  goldPricePerGram: number
  silverPricePerGram: number
  remindersEnabled: boolean
  // Enriched server-side
  nisabValue: number
  nisabGrams: number
  nextHawlDate: string | null
  daysUntilHawl: number | null
}

export interface ManualAssets {
  cash?: number
  bank?: number
  goldGrams?: number
  silverGrams?: number
  tradeGoods?: number
  otherInvestments?: number
  personalDebts?: number
}

export interface ZakatCalculation {
  auto: {
    freeCapital: number
    capitalInDeals: number
    expectedReturns: number
    activeDealsCount: number
    totalAuto: number
  }
  manual: {
    cash: number
    bank: number
    goldGrams: number
    goldRub: number
    silverGrams: number
    silverRub: number
    tradeGoods: number
    otherInvestments: number
    personalDebts: number
    manualTotal: number
  }
  grossBase: number
  taxableBase: number
  nisab: {
    base: NisabBase
    grams: number
    value: number
    goldPricePerGram: number
    silverPricePerGram: number
  }
  meetsNisab: boolean
  rate: number
  zakatAmount: number
  hawl: {
    startDate: string | null
    nextHawlDate: string | null
    daysUntilHawl: number | null
  }
}

export interface ZakatPayment {
  id: string
  investorId: string
  calculationDate: string
  paidAt: string | null
  breakdown: any
  zakatAmount: number
  recipientNote: string | null
  recipientCategory: RecipientCategory | null
  attachmentUrl: string | null
  createdAt: string
  updatedAt: string
}

export const RECIPIENT_LABELS: Record<RecipientCategory, string> = {
  FUQARA: 'Нуждающиеся (фукара)',
  MASAKIN: 'Бедные (масакин)',
  AMILIN: 'Сборщики закята',
  MUALLAFA: 'Те, чьи сердца склоняются к исламу',
  RIQAB: 'Освобождение пленников',
  GHARIMIN: 'Должники, неспособные погасить долг',
  FI_SABILILLAH: 'На пути Аллаха',
  IBN_SABIL: 'Путники в нужде',
}

export function useZakat() {
  const settings = ref<ZakatSettings | null>(null)
  const calculation = ref<ZakatCalculation | null>(null)
  const payments = ref<ZakatPayment[]>([])
  const loading = ref(false)
  const calculating = ref(false)
  const saving = ref(false)

  async function fetchSettings() {
    settings.value = await api.get<ZakatSettings>('/zakat/settings')
  }

  async function updateSettings(patch: Partial<{
    hawlStartDate: string | null
    nisabBase: NisabBase
    goldPricePerGram: number
    silverPricePerGram: number
    remindersEnabled: boolean
  }>) {
    saving.value = true
    try {
      settings.value = await api.patch<ZakatSettings>('/zakat/settings', patch)
    } finally {
      saving.value = false
    }
  }

  async function calculate(input: { manualAssets?: ManualAssets } = {}) {
    calculating.value = true
    try {
      calculation.value = await api.post<ZakatCalculation>('/zakat/calculate', input)
      return calculation.value
    } finally {
      calculating.value = false
    }
  }

  async function fetchPayments() {
    loading.value = true
    try {
      payments.value = await api.get<ZakatPayment[]>('/zakat/payments')
    } finally {
      loading.value = false
    }
  }

  async function createPayment(data: {
    breakdown: any
    zakatAmount: number
    paidAt?: string
    recipientNote?: string
    recipientCategory?: RecipientCategory
    attachmentUrl?: string
  }) {
    const created = await api.post<ZakatPayment>('/zakat/payments', data)
    payments.value.unshift(created)
    return created
  }

  async function updatePayment(id: string, patch: Partial<{
    paidAt: string | null
    recipientNote: string | null
    recipientCategory: RecipientCategory | null
    attachmentUrl: string | null
  }>) {
    const updated = await api.patch<ZakatPayment>(`/zakat/payments/${id}`, patch)
    const idx = payments.value.findIndex((p) => p.id === id)
    if (idx >= 0) payments.value[idx] = updated
    return updated
  }

  async function deletePayment(id: string) {
    await api.delete(`/zakat/payments/${id}`)
    payments.value = payments.value.filter((p) => p.id !== id)
  }

  return {
    settings,
    calculation,
    payments,
    loading,
    calculating,
    saving,
    fetchSettings,
    updateSettings,
    calculate,
    fetchPayments,
    createPayment,
    updatePayment,
    deletePayment,
  }
}
