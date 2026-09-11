import { computed, onUnmounted, ref } from 'vue'
import { api } from '@/api/client'

interface ProgressState {
  op: 'reset' | 'delete' | 'restore' | 'backup' | null
  phase?: string
  done?: number
  total?: number
  /** Этап и сколько их всего: копия и очистка считаются раздельно. */
  stage?: number
  stages?: number
  /** Что считается на этом этапе: записи или шаги (таблицы). */
  unit?: 'rows' | 'steps'
  finishedAt?: number
  error?: string
}

/**
 * Ход длинной операции — очистки кабинета, удаления аккаунта, восстановления.
 *
 * Все три идут одним запросом и минутами: браузер всё это время показывает
 * крутящийся кружок, и понять, ждать десять секунд или пять минут, нельзя.
 * Сервер отмечает, что делает сейчас, а здесь мы раз в секунду это
 * спрашиваем и показываем полосу.
 *
 * Опрос лёгкий: сервер отдаёт состояние из памяти, без обращения к базе, —
 * иначе он мешал бы самой операции, ход которой показывает.
 */
export function useOperationProgress() {
  const phase = ref('')
  const done = ref(0)
  const total = ref(0)
  const stage = ref(1)
  const stages = ref(1)
  const unit = ref<'rows' | 'steps'>('rows')
  const active = ref(false)
  const finished = ref(false)

  let timer: number | null = null

  /**
   * Доля выполненного.
   *
   * Пока сервер не прислал первую отметку, полоса стоит на 5 %: пустая полоса
   * читается как «ничего не происходит», а операция уже идёт.
   */
  const percent = computed(() => {
    if (!total.value) return 5
    return Math.min(99, Math.max(5, Math.round((done.value / total.value) * 100)))
  })

  async function tick() {
    try {
      const s = await api.get<ProgressState>('/progress')
      if (!s?.op) return
      phase.value = s.phase ?? ''
      done.value = s.done ?? 0
      total.value = s.total ?? 0
      stage.value = s.stage ?? 1
      stages.value = s.stages ?? 1
      unit.value = s.unit ?? 'rows'
      finished.value = !!s.finishedAt
    } catch {
      // Опрос — вспомогательный: его ошибка не должна выглядеть как ошибка
      // самой операции. Молча ждём следующей секунды.
    }
  }

  function start() {
    stop()
    active.value = true
    phase.value = ''
    done.value = 0
    total.value = 0
    stage.value = 1
    stages.value = 1
    unit.value = 'rows'
    finished.value = false
    void tick()
    timer = window.setInterval(tick, 1000)
  }

  function stop() {
    if (timer) window.clearInterval(timer)
    timer = null
    active.value = false
  }

  // Таймер живёт дольше страницы, если его не остановить.
  onUnmounted(stop)

  return { phase, done, total, stage, stages, unit, percent, active, finished, start, stop }
}
