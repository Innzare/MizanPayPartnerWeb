import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type NotificationType = 'deal' | 'payment' | 'request' | 'system'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  isRead: boolean
  createdAt: string
  meta?: {
    dealId?: string
    requestId?: string
    clientName?: string
    amount?: number
  }
}

const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: 'n-1',
    type: 'payment',
    title: 'Платёж получен',
    message: 'Ахмад Исмаилов оплатил 18 332 ₽ по сделке iPhone 15 Pro Max',
    isRead: false,
    createdAt: '2026-03-11T09:30:00Z',
    meta: { dealId: 'deal-1', clientName: 'Ахмад Исмаилов', amount: 18332 },
  },
  {
    id: 'n-2',
    type: 'request',
    title: 'Новая заявка',
    message: 'Муса Дудаев оставил заявку на MacBook Air M3 15" за 159 990 ₽',
    isRead: false,
    createdAt: '2026-03-11T08:15:00Z',
    meta: { requestId: 'req-2', clientName: 'Муса Дудаев', amount: 159990 },
  },
  {
    id: 'n-3',
    type: 'deal',
    title: 'Сделка подтверждена',
    message: 'Клиент Ибрагим Алиев подтвердил получение товара по сделке "Диван Монако"',
    isRead: false,
    createdAt: '2026-03-10T16:45:00Z',
    meta: { dealId: 'deal-4', clientName: 'Ибрагим Алиев' },
  },
  {
    id: 'n-4',
    type: 'payment',
    title: 'Просроченный платёж',
    message: 'Хасан Магомедов пропустил платёж 14 165 ₽ по сделке Samsung холодильник',
    isRead: true,
    createdAt: '2026-03-09T10:00:00Z',
    meta: { dealId: 'deal-6', clientName: 'Хасан Магомедов', amount: 14165 },
  },
  {
    id: 'n-5',
    type: 'request',
    title: 'Новая заявка',
    message: 'Ахмад Исмаилов оставил заявку на PlayStation 5 Slim за 52 990 ₽',
    isRead: true,
    createdAt: '2026-03-08T14:20:00Z',
    meta: { requestId: 'req-5', clientName: 'Ахмад Исмаилов', amount: 52990 },
  },
  {
    id: 'n-6',
    type: 'system',
    title: 'Подписка Pro активна',
    message: 'Ваша подписка Pro продлена до 15 июня 2026',
    isRead: true,
    createdAt: '2026-03-07T12:00:00Z',
  },
  {
    id: 'n-7',
    type: 'deal',
    title: 'Договор подписан',
    message: 'Муса Дудаев подписал договор по сделке MacBook Pro 14"',
    isRead: true,
    createdAt: '2026-03-06T18:30:00Z',
    meta: { dealId: 'deal-3', clientName: 'Муса Дудаев' },
  },
  {
    id: 'n-8',
    type: 'payment',
    title: 'Платёж получен',
    message: 'Ибрагим Алиев оплатил 12 500 ₽ по сделке Диван Монако',
    isRead: true,
    createdAt: '2026-03-05T11:00:00Z',
    meta: { dealId: 'deal-4', clientName: 'Ибрагим Алиев', amount: 12500 },
  },
]

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref<Notification[]>([...MOCK_NOTIFICATIONS])
  const isLoading = ref(false)

  const unreadCount = computed(() =>
    notifications.value.filter((n) => !n.isRead).length
  )

  const sortedNotifications = computed(() =>
    [...notifications.value].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  )

  function markAsRead(id: string) {
    const n = notifications.value.find((n) => n.id === id)
    if (n) n.isRead = true
  }

  function markAllAsRead() {
    notifications.value.forEach((n) => (n.isRead = true))
  }

  function deleteNotification(id: string) {
    notifications.value = notifications.value.filter((n) => n.id !== id)
  }

  function clearAll() {
    notifications.value = []
  }

  return {
    notifications,
    isLoading,
    unreadCount,
    sortedNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  }
})
