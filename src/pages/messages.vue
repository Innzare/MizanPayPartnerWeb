<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useChats } from '@/composables/useChats'
import ChatPanel from '@/components/ChatPanel.vue'

const router = useRouter()
const authStore = useAuthStore()
const { isDark } = useIsDark()
const toast = useToast()
const chats = useChats()

const pageLoading = ref(true)
const chatId = ref<string | null>(null)
const partnerName = ref('')

onMounted(async () => {
  // Owner shouldn't be on this page — redirect to /staff where the chat lives.
  if (authStore.isOwner) {
    router.replace('/staff')
    return
  }
  try {
    const thread = await chats.findOrCreate()
    chatId.value = thread.id
    partnerName.value = `${thread.counterpart.firstName} ${thread.counterpart.lastName}`.trim()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось открыть чат')
  } finally {
    pageLoading.value = false
  }
})
</script>

<template>
  <div class="at-page msg-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center pa-12">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <div v-else class="msg-shell">
      <ChatPanel
        :chat-id="chatId"
        :counterpart-name="partnerName"
        counterpart-role-label="Партнёр"
      />
    </div>
  </div>
</template>

<style scoped>
.msg-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 88px);
}
.msg-shell {
  flex: 1;
  min-height: 0;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 14px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.dark .msg-shell { border-color: rgba(255, 255, 255, 0.06); background: #1a1a26; }
</style>
