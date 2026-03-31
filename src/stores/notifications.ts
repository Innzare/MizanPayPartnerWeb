import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api/client'

export type NotificationType =
  | 'PAYMENT_DUE'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_OVERDUE'
  | 'DEAL_CREATED'
  | 'DEAL_STATUS'
  | 'REQUEST_NEW'
  | 'REQUEST_ACCEPTED'
  | 'REQUEST_REJECTED'
  | 'SYSTEM'

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

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref<Notification[]>([])
  const isLoading = ref(false)

  const unreadCount = computed(() =>
    notifications.value.filter((n) => !n.isRead).length
  )

  const sortedNotifications = computed(() =>
    [...notifications.value].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  )

  async function fetchNotifications() {
    isLoading.value = true
    try {
      const data = await api.get<Notification[]>('/notifications')
      notifications.value = data
    } catch (e) {
      console.error('Failed to fetch notifications:', e)
    } finally {
      isLoading.value = false
    }
  }

  async function fetchUnreadCount() {
    try {
      const data = await api.get<{ count: number }>('/notifications/unread-count')
      // We already compute unreadCount from the list, but this can be used
      // for badge updates without fetching the full list
      return data.count
    } catch (e) {
      console.error('Failed to fetch unread count:', e)
      return 0
    }
  }

  async function markAsRead(id: string) {
    try {
      await api.patch(`/notifications/${id}/read`)
      const n = notifications.value.find((n) => n.id === id)
      if (n) n.isRead = true
    } catch (e) {
      console.error('Failed to mark notification as read:', e)
    }
  }

  async function markAllAsRead() {
    try {
      await api.patch('/notifications/read-all')
      notifications.value.forEach((n) => (n.isRead = true))
    } catch (e) {
      console.error('Failed to mark all as read:', e)
    }
  }

  async function deleteNotification(id: string) {
    try {
      await api.delete(`/notifications/${id}`)
      notifications.value = notifications.value.filter((n) => n.id !== id)
    } catch (e) {
      console.error('Failed to delete notification:', e)
    }
  }

  async function clearAll() {
    try {
      await api.delete('/notifications')
      notifications.value = []
    } catch (e) {
      console.error('Failed to clear notifications:', e)
    }
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
    fetchNotifications,
    fetchUnreadCount,
  }
})