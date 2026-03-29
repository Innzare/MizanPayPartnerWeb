<script lang="ts" setup>
import { useNotificationsStore, type NotificationType } from '@/stores/notifications'
import { timeAgo } from '@/utils/formatters'

const store = useNotificationsStore()

onMounted(() => {
  store.fetchNotifications()
})

const filter = ref<'all' | 'unread'>('all')

const displayedNotifications = computed(() => {
  if (filter.value === 'unread') {
    return store.sortedNotifications.filter((n) => !n.isRead)
  }
  return store.sortedNotifications
})

const typeConfig: Record<NotificationType, { icon: string; color: string }> = {
  payment: { icon: 'mdi-cash-check', color: '#047857' },
  deal: { icon: 'mdi-handshake', color: '#3b82f6' },
  request: { icon: 'mdi-file-document-plus-outline', color: '#8b5cf6' },
  system: { icon: 'mdi-information-outline', color: '#64748b' },
}

// Group by date
const groupedNotifications = computed(() => {
  const groups: { label: string; items: typeof displayedNotifications.value }[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const todayItems: typeof displayedNotifications.value = []
  const yesterdayItems: typeof displayedNotifications.value = []
  const olderItems: typeof displayedNotifications.value = []

  for (const n of displayedNotifications.value) {
    const d = new Date(n.createdAt)
    d.setHours(0, 0, 0, 0)
    if (d.getTime() === today.getTime()) todayItems.push(n)
    else if (d.getTime() === yesterday.getTime()) yesterdayItems.push(n)
    else olderItems.push(n)
  }

  if (todayItems.length) groups.push({ label: 'Сегодня', items: todayItems })
  if (yesterdayItems.length) groups.push({ label: 'Вчера', items: yesterdayItems })
  if (olderItems.length) groups.push({ label: 'Ранее', items: olderItems })

  return groups
})
</script>

<template>
  <div class="at-page">
    <v-card rounded="lg" elevation="0" border>
      <!-- Header -->
      <div class="d-flex align-center justify-space-between pa-4 pb-0">
        <div class="d-flex align-center ga-3">
          <button
            class="ntf-filter-btn"
            :class="{ active: filter === 'all' }"
            @click="filter = 'all'"
          >
            Все
            <span class="ntf-filter-count">{{ store.sortedNotifications.length }}</span>
          </button>
          <button
            class="ntf-filter-btn"
            :class="{ active: filter === 'unread' }"
            @click="filter = 'unread'"
          >
            Непрочитанные
            <span v-if="store.unreadCount" class="ntf-filter-count ntf-filter-count--accent">{{ store.unreadCount }}</span>
          </button>
        </div>

        <div class="d-flex ga-1">
          <v-btn
            v-if="store.unreadCount > 0"
            variant="tonal"
            size="small"
            prepend-icon="mdi-check-all"
            @click="store.markAllAsRead()"
          >
            Прочитать все
          </v-btn>
          <v-btn
            v-if="store.notifications.length > 0"
            variant="tonal"
            color="error"
            size="small"
            icon="mdi-delete-sweep-outline"
            @click="store.clearAll()"
          />
        </div>
      </div>

      <v-divider class="mt-4" />

      <!-- Notification list -->
      <div v-if="groupedNotifications.length" class="pa-4">
        <div v-for="group in groupedNotifications" :key="group.label" class="mb-4">
          <div class="text-caption font-weight-bold text-medium-emphasis text-uppercase mb-2">
            {{ group.label }}
          </div>

          <div
            v-for="n in group.items"
            :key="n.id"
            class="ntf-item"
            :class="{ 'ntf-item--unread': !n.isRead }"
            @click="store.markAsRead(n.id)"
          >
            <div class="ntf-icon" :style="{ background: typeConfig[n.type].color + '14', color: typeConfig[n.type].color }">
              <v-icon :icon="typeConfig[n.type].icon" size="20" />
            </div>

            <div class="ntf-content">
              <div class="d-flex align-center ga-2">
                <span class="ntf-title">{{ n.title }}</span>
                <span v-if="!n.isRead" class="ntf-dot" />
              </div>
              <div class="ntf-message">{{ n.message }}</div>
              <div class="ntf-time">{{ timeAgo(n.createdAt) }}</div>
            </div>

            <button class="ntf-delete" @click.stop="store.deleteNotification(n.id)" title="Удалить">
              <v-icon icon="mdi-close" size="16" />
            </button>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="text-center pa-12">
        <v-icon icon="mdi-bell-check-outline" size="56" color="grey-lighten-1" class="mb-3" />
        <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">
          {{ filter === 'unread' ? 'Нет непрочитанных' : 'Нет уведомлений' }}
        </p>
        <p class="text-body-2 text-medium-emphasis">
          {{ filter === 'unread' ? 'Все уведомления прочитаны' : 'Здесь будут появляться уведомления' }}
        </p>
      </div>
    </v-card>
  </div>
</template>

<style scoped>
.ntf-filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 20px;
  border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  transition: all 0.15s;
}

.ntf-filter-btn:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

.ntf-filter-btn.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

.ntf-filter-count {
  font-size: 11px;
  font-weight: 600;
  padding: 0 6px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  line-height: 18px;
  min-width: 20px;
  text-align: center;
}

.ntf-filter-btn.active .ntf-filter-count {
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
}

.ntf-filter-count--accent {
  background: #ef4444 !important;
  color: #fff !important;
}

.ntf-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}

.ntf-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.ntf-item--unread {
  background: rgba(var(--v-theme-primary), 0.04);
}

.ntf-item--unread:hover {
  background: rgba(var(--v-theme-primary), 0.07);
}

.ntf-icon {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ntf-content {
  flex: 1;
  min-width: 0;
}

.ntf-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.ntf-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  flex-shrink: 0;
}

.ntf-message {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-top: 2px;
  line-height: 1.4;
}

.ntf-time {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 4px;
}

.ntf-delete {
  opacity: 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: none;
  color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
  margin-top: 2px;
}

.ntf-item:hover .ntf-delete {
  opacity: 1;
}

.ntf-delete:hover {
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}
</style>
