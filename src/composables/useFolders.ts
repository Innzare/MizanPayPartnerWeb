import { ref } from 'vue'
import { api } from '@/api/client'
import type { DealFolder } from '@/types'

const folders = ref<DealFolder[]>([])
const loading = ref(false)

export function useFolders() {
  async function fetchFolders() {
    loading.value = true
    try {
      folders.value = await api.get<DealFolder[]>('/deal-folders')
    } catch { /* silent */ }
    finally { loading.value = false }
  }

  async function createFolder(data: { name: string; color?: string; icon?: string }) {
    const folder = await api.post<DealFolder>('/deal-folders', data)
    folders.value.push(folder)
    return folder
  }

  async function updateFolder(id: string, data: { name?: string; color?: string; icon?: string }) {
    const updated = await api.patch<DealFolder>(`/deal-folders/${id}`, data)
    const idx = folders.value.findIndex(f => f.id === id)
    if (idx >= 0) folders.value[idx] = updated
    return updated
  }

  async function deleteFolder(id: string) {
    await api.delete(`/deal-folders/${id}`)
    folders.value = folders.value.filter(f => f.id !== id)
  }

  async function moveDeal(dealId: string, folderId: string | null) {
    return api.post('/deal-folders/move', { dealId, folderId })
  }

  async function moveBatch(dealIds: string[], folderId: string | null) {
    return api.post('/deal-folders/move-batch', { dealIds, folderId })
  }

  return { folders, loading, fetchFolders, createFolder, updateFolder, deleteFolder, moveDeal, moveBatch }
}
