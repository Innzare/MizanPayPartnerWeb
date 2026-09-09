<script setup lang="ts">
/**
 * История сделки.
 *
 * Раньше она рисовалась в браузере из трёх кусочков: создана, платежи
 * оплачены, закрыта. На вопрос «почему у клиента изменилась сумма» ответить
 * было нечем — ни автора, ни того, что именно поменяли.
 *
 * Теперь это настоящий журнал с сервера: правки с расшифровкой «было → стало»,
 * оплаты и их отмены, переносы, работа с должником. Грузится при первом
 * открытии вкладки, а не вместе со страницей.
 */
import { computed, onMounted, ref } from 'vue'
import { api } from '@/api/client'
import { formatDate } from '@/utils/formatters'

interface HistoryItem {
  id: string
  kind: 'ACTION' | 'COLLECTION'
  type: string
  title: string
  description: string | null
  actorName: string
  actorType: string
  createdAt: string
  changes?: Array<{ label: string; from: string; to: string }>
}

const props = defineProps<{ dealId: string }>()

const items = ref<HistoryItem[]>([])
const loading = ref(false)
const failed = ref(false)

/** Цвет точки по смыслу события: деньги, отмена, удаление, всё прочее. */
function colorOf(i: HistoryItem): string {
  if (i.type.includes('DELETED')) return '#dc2626'
  if (i.type.includes('UNPAID') || i.type.includes('REMOVED')) return '#f59e0b'
  if (i.type.includes('PAID')) return '#047857'
  if (i.kind === 'COLLECTION') return '#3b82f6'
  return '#64748b'
}

const grouped = computed(() => {
  const map = new Map<string, HistoryItem[]>()
  for (const i of items.value) {
    const day = formatDate(i.createdAt)
    if (!map.has(day)) map.set(day, [])
    map.get(day)!.push(i)
  }
  return [...map.entries()]
})

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

onMounted(async () => {
  loading.value = true
  try {
    const res = await api.get<{ items: HistoryItem[] }>(`/deals/${props.dealId}/history`)
    items.value = res.items
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <v-card rounded="lg" elevation="0" border class="pa-5">
    <div class="section-title mb-4">История сделки</div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-3" />

    <div v-if="failed" class="dh-empty">Не удалось загрузить историю</div>
    <div v-else-if="!loading && !items.length" class="dh-empty">Событий пока нет</div>

    <div v-for="[day, events] in grouped" :key="day" class="dh-day">
      <div class="dh-day-label">{{ day }}</div>
      <div class="timeline">
        <div v-for="(e, i) in events" :key="e.id" class="timeline-item">
          <div class="timeline-dot" :style="{ background: colorOf(e) }" />
          <div class="timeline-line" v-if="i < events.length - 1" />
          <div class="timeline-content">
            <div class="timeline-label">{{ e.title }}</div>
            <div v-if="e.description" class="dh-desc">{{ e.description }}</div>

            <!-- Что именно изменилось: ради этого история и нужна -->
            <div v-if="e.changes?.length" class="dh-changes">
              <div v-for="c in e.changes" :key="c.label" class="dh-change">
                <span class="dh-change-label">{{ c.label }}</span>
                <span class="dh-change-from">{{ c.from }}</span>
                <v-icon icon="mdi-arrow-right" size="12" />
                <span class="dh-change-to">{{ c.to }}</span>
              </div>
            </div>

            <div class="timeline-date">{{ timeOf(e.createdAt) }} · {{ e.actorName }}</div>
          </div>
        </div>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.timeline { position: relative; }
.timeline-item {
  display: flex;
  gap: 12px;
  position: relative;
  padding-bottom: 18px;
}
.timeline-item:last-child { padding-bottom: 0; }
.timeline-dot {
  width: 10px; height: 10px; min-width: 10px; border-radius: 50%;
  margin-top: 4px; z-index: 1;
}
.timeline-line {
  position: absolute; left: 4px; top: 18px; bottom: 0;
  width: 2px; background: rgba(var(--v-theme-on-surface), 0.08);
}
.timeline-content { min-width: 0; }
.timeline-label {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.timeline-date {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.dh-desc {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.dh-changes {
  margin-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.dh-change {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  flex-wrap: wrap;
}
.dh-change-label {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.dh-change-from {
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-decoration: line-through;
}
.dh-change-to {
  font-weight: 600;
}
.dh-day {
  margin-bottom: 18px;
}
.dh-day-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 8px;
}
.dh-empty {
  padding: 24px 0;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.section-title {
  font-size: 15px;
  font-weight: 600;
}
</style>
