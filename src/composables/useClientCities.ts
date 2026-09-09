import { ref } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

export interface ClientCity {
  city: string
  count: number
}

/**
 * Города клиентов партнёра — наполняют фильтр по городу и подсказки при вводе.
 *
 * Состояние общее на всё приложение: список меняется редко (только когда
 * заводят клиента в новом городе), а нужен он сразу в нескольких местах.
 * Поэтому грузим один раз и переиспользуем; `refresh` — после сохранения
 * клиента, чтобы новый город появился в подсказках без перезагрузки страницы.
 */
const cities = ref<ClientCity[]>([])
const loading = ref(false)
let loaded = false

export function useClientCities() {
  const auth = useAuthStore()

  async function fetchCities(force = false) {
    // Города — часть данных клиентов: без права даже не запрашиваем, иначе
    // сервер ответит отказом и в консоли будет шум.
    if (!auth.can('clients.view')) return
    if (loading.value || (loaded && !force)) return
    loading.value = true
    try {
      cities.value = await api.get<ClientCity[]>('/client-profiles/cities')
      loaded = true
    } catch {
      /* тихо: подсказки — вспомогательная вещь, без них форма работает */
    } finally {
      loading.value = false
    }
  }

  // Первый вызов запускает загрузку сам — компонентам не нужно об этом помнить.
  if (!loaded && !loading.value) void fetchCities()

  return { cities, loading, fetchCities, refresh: () => fetchCities(true) }
}
