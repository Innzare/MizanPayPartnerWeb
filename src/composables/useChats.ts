import { ref } from 'vue'
import { api } from '@/api/client'
import type { ChatThread, ChatMessage } from '@/types'

const threads = ref<ChatThread[]>([])
const totalUnread = ref(0)
const loading = ref(false)

export function useChats() {
  async function fetchThreads() {
    loading.value = true
    try {
      threads.value = await api.get<ChatThread[]>('/chats')
    } catch { /* silent */ }
    finally { loading.value = false }
  }

  async function findOrCreate(staffId?: string) {
    const body = staffId ? { staffId } : {}
    return api.post<ChatThread>('/chats', body)
  }

  async function fetchMessages(chatId: string, since?: string) {
    const qs = since ? `?since=${encodeURIComponent(since)}` : ''
    return api.get<ChatMessage[]>(`/chats/${chatId}/messages${qs}`)
  }

  async function sendMessage(chatId: string, text: string) {
    return api.post<ChatMessage>(`/chats/${chatId}/messages`, { text })
  }

  async function markRead(chatId: string) {
    return api.post<{ ok: boolean }>(`/chats/${chatId}/read`, {})
  }

  async function refreshUnreadCount() {
    try {
      const res = await api.get<{ count: number }>('/chats/unread-count')
      totalUnread.value = res.count
    } catch { /* silent */ }
  }

  return {
    threads,
    totalUnread,
    loading,
    fetchThreads,
    findOrCreate,
    fetchMessages,
    sendMessage,
    markRead,
    refreshUnreadCount,
  }
}
