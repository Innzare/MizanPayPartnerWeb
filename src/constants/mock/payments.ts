import type { Payment } from '@/types'

export const MOCK_PAYMENTS: Record<string, Payment[]> = {
  'deal-1': [
    { id: 'pay-1-1', dealId: 'deal-1', number: 1, amount: 11748, dueDate: '2026-01-01T00:00:00Z', paidAt: '2025-12-30T10:00:00Z', status: 'paid', method: 'transfer', remainingAfter: 58741 },
    { id: 'pay-1-2', dealId: 'deal-1', number: 2, amount: 11748, dueDate: '2026-02-01T00:00:00Z', paidAt: '2026-01-31T10:00:00Z', status: 'paid', method: 'transfer', remainingAfter: 46993 },
    { id: 'pay-1-3', dealId: 'deal-1', number: 3, amount: 11748, dueDate: '2026-03-01T00:00:00Z', paidAt: '2026-02-28T10:00:00Z', status: 'paid', method: 'transfer', remainingAfter: 35245 },
    { id: 'pay-1-4', dealId: 'deal-1', number: 4, amount: 11748, dueDate: '2026-04-01T00:00:00Z', status: 'pending', remainingAfter: 23497 },
    { id: 'pay-1-5', dealId: 'deal-1', number: 5, amount: 11748, dueDate: '2026-05-01T00:00:00Z', status: 'pending', remainingAfter: 11749 },
    { id: 'pay-1-6', dealId: 'deal-1', number: 6, amount: 11749, dueDate: '2026-06-01T00:00:00Z', status: 'pending', remainingAfter: 0 },
  ],
  'deal-4': [
    { id: 'pay-4-1', dealId: 'deal-4', number: 1, amount: 6640, dueDate: '2026-02-01T00:00:00Z', paidAt: '2026-02-01T10:00:00Z', status: 'paid', method: 'transfer', remainingAfter: 33199 },
    { id: 'pay-4-2', dealId: 'deal-4', number: 2, amount: 6640, dueDate: '2026-03-01T00:00:00Z', status: 'pending', remainingAfter: 26559 },
    { id: 'pay-4-3', dealId: 'deal-4', number: 3, amount: 6640, dueDate: '2026-04-01T00:00:00Z', status: 'pending', remainingAfter: 19919 },
    { id: 'pay-4-4', dealId: 'deal-4', number: 4, amount: 6640, dueDate: '2026-05-01T00:00:00Z', status: 'pending', remainingAfter: 13279 },
    { id: 'pay-4-5', dealId: 'deal-4', number: 5, amount: 6640, dueDate: '2026-06-01T00:00:00Z', status: 'pending', remainingAfter: 6639 },
    { id: 'pay-4-6', dealId: 'deal-4', number: 6, amount: 6639, dueDate: '2026-07-01T00:00:00Z', status: 'pending', remainingAfter: 0 },
  ],
  'deal-6': [
    { id: 'pay-6-1', dealId: 'deal-6', number: 1, amount: 9207, dueDate: '2026-01-15T00:00:00Z', paidAt: '2026-01-14T10:00:00Z', status: 'paid', method: 'transfer', remainingAfter: 46032 },
    { id: 'pay-6-2', dealId: 'deal-6', number: 2, amount: 9207, dueDate: '2026-02-15T00:00:00Z', paidAt: '2026-02-16T10:00:00Z', status: 'paid', method: 'transfer', remainingAfter: 36825 },
    { id: 'pay-6-3', dealId: 'deal-6', number: 3, amount: 9207, dueDate: '2026-03-15T00:00:00Z', status: 'pending', remainingAfter: 27618 },
    { id: 'pay-6-4', dealId: 'deal-6', number: 4, amount: 9207, dueDate: '2026-04-15T00:00:00Z', status: 'pending', remainingAfter: 18411 },
    { id: 'pay-6-5', dealId: 'deal-6', number: 5, amount: 9207, dueDate: '2026-05-15T00:00:00Z', status: 'pending', remainingAfter: 9204 },
    { id: 'pay-6-6', dealId: 'deal-6', number: 6, amount: 9204, dueDate: '2026-06-15T00:00:00Z', status: 'pending', remainingAfter: 0 },
  ],
}
