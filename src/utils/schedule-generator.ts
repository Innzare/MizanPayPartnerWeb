import type { Payment } from '@/types'

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function generateEqualSchedule(
  dealId: string,
  remainingAmount: number,
  numberOfPayments: number,
  firstPaymentDate: string
): Payment[] {
  const monthlyAmount = Math.ceil(remainingAmount / numberOfPayments);
  const payments: Payment[] = [];
  let remaining = remainingAmount;

  for (let i = 0; i < numberOfPayments; i++) {
    const dueDate = new Date(firstPaymentDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    const isLast = i === numberOfPayments - 1;
    const amount = isLast ? remaining : monthlyAmount;
    remaining -= amount;

    payments.push({
      id: generateId(),
      dealId,
      number: i + 1,
      amount,
      dueDate: dueDate.toISOString(),
      status: 'pending',
      remainingAfter: Math.max(0, remaining),
    });
  }

  return payments;
}

export function generateDecreasingSchedule(
  dealId: string,
  remainingAmount: number,
  numberOfPayments: number,
  firstPaymentDate: string
): Payment[] {
  const payments: Payment[] = [];
  let remaining = remainingAmount;

  const totalParts = (numberOfPayments * (numberOfPayments + 1)) / 2;

  for (let i = 0; i < numberOfPayments; i++) {
    const dueDate = new Date(firstPaymentDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    const weight = numberOfPayments - i;
    const isLast = i === numberOfPayments - 1;
    const amount = isLast ? remaining : Math.ceil((remainingAmount * weight) / totalParts);
    remaining -= amount;

    payments.push({
      id: generateId(),
      dealId,
      number: i + 1,
      amount,
      dueDate: dueDate.toISOString(),
      status: 'pending',
      remainingAfter: Math.max(0, remaining),
    });
  }

  return payments;
}
