<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useChats } from '@/composables/useChats'
import { useDealsStore } from '@/stores/deals'
import { formatCurrency } from '@/utils/formatters'
import type { ChatMessage, Deal } from '@/types'

const props = defineProps<{
  chatId: string | null
  /** Optional header counterpart name + role label override (used in drawer with known staff). */
  counterpartName?: string
  counterpartRoleLabel?: string
}>()

const router = useRouter()
const authStore = useAuthStore()
const toast = useToast()
const chats = useChats()
const dealsStore = useDealsStore()

const messages = ref<ChatMessage[]>([])
const messagesLoading = ref(false)
const sending = ref(false)
const draft = ref('')
const messageListRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// Mention autocomplete state. Triggered by `#` at word boundary, the dropdown
// shows up to 8 deals filtered by the chars typed after `#` (matched against
// dealNumber prefix and productName substring). Selecting an item replaces the
// `#partial` token with `#<dealNumber>` so the backend can resolve it.
const mention = ref<{ startIdx: number; query: string; selectedIdx: number } | null>(null)
const dealsLoaded = ref(false)

let chatPollTimer: number | null = null

async function loadMessages() {
  if (!props.chatId) {
    messages.value = []
    return
  }
  messagesLoading.value = true
  try {
    messages.value = await chats.fetchMessages(props.chatId)
    await chats.markRead(props.chatId)
    chats.refreshUnreadCount()
    await nextTick()
    scrollToBottom()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить переписку')
  } finally {
    messagesLoading.value = false
  }
}

async function pollNew() {
  if (!props.chatId || messagesLoading.value) return
  const last = messages.value[messages.value.length - 1]
  const since = last?.createdAt
  try {
    const fresh = await chats.fetchMessages(props.chatId, since)
    if (fresh.length) {
      messages.value.push(...fresh)
      await chats.markRead(props.chatId)
      chats.refreshUnreadCount()
      await nextTick()
      scrollToBottom()
    }
  } catch { /* silent */ }
}

async function send() {
  const text = draft.value.trim()
  if (!text || !props.chatId || sending.value) return
  sending.value = true
  const text0 = draft.value
  draft.value = ''
  try {
    const created = await chats.sendMessage(props.chatId, text)
    messages.value.push(created)
    await nextTick()
    scrollToBottom()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось отправить')
    draft.value = text0
  } finally {
    sending.value = false
  }
}

function scrollToBottom() {
  const el = messageListRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function isMine(m: ChatMessage): boolean {
  return authStore.isOwner ? m.authorType === 'OWNER' : m.authorType === 'STAFF'
}

type Segment = { type: 'text'; value: string } | { type: 'mention'; dealId: string; dealNumber: number; productName: string }
function renderSegments(m: ChatMessage): Segment[] {
  const text = m.text
  const mentions = m.dealMentions || []
  if (!mentions.length) return [{ type: 'text', value: text }]
  const map = new Map<number, { dealId: string; productName: string }>()
  for (const md of mentions) map.set(md.dealNumber, { dealId: md.dealId, productName: md.productName })
  const segments: Segment[] = []
  const re = /#(\d+)/g
  let lastIdx = 0
  let m2: RegExpExecArray | null
  while ((m2 = re.exec(text)) !== null) {
    const num = parseInt(m2[1], 10)
    const found = map.get(num)
    if (!found) continue
    if (m2.index > lastIdx) segments.push({ type: 'text', value: text.slice(lastIdx, m2.index) })
    segments.push({ type: 'mention', dealId: found.dealId, dealNumber: num, productName: found.productName })
    lastIdx = m2.index + m2[0].length
  }
  if (lastIdx < text.length) segments.push({ type: 'text', value: text.slice(lastIdx) })
  return segments
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function openDeal(dealId: string) {
  router.push(`/deals/${dealId}`)
}

const showHeader = computed(() => !!(props.counterpartName || props.counterpartRoleLabel))

// ---- Mention autocomplete ----

/** Detect whether the caret sits inside a `#token` at a word boundary. */
function detectMention(text: string, caretPos: number): { startIdx: number; query: string } | null {
  let i = caretPos - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '#') {
      const before = i > 0 ? text[i - 1] : ' '
      if (i === 0 || /\s/.test(before)) {
        return { startIdx: i, query: text.slice(i + 1, caretPos) }
      }
      return null
    }
    if (/\s/.test(ch)) return null
    i--
  }
  return null
}

const mentionMatches = computed<Deal[]>(() => {
  if (!mention.value) return []
  const q = mention.value.query.toLowerCase().trim()
  const all = dealsStore.investorDeals
  // No query → show recent deals (already sorted desc by createdAt from backend)
  if (!q) return all.slice(0, 8)
  return all
    .filter(
      (d) =>
        String(d.dealNumber).startsWith(q) ||
        d.productName.toLowerCase().includes(q),
    )
    .slice(0, 8)
})

async function ensureDealsLoaded() {
  if (dealsLoaded.value) return
  if (dealsStore.investorDeals.length > 0) {
    dealsLoaded.value = true
    return
  }
  try {
    await dealsStore.fetchDeals()
  } catch { /* silent */ }
  finally { dealsLoaded.value = true }
}

function onInput() {
  const ta = textareaRef.value
  if (!ta) return
  const detected = detectMention(draft.value, ta.selectionStart)
  if (detected) {
    if (!mention.value) ensureDealsLoaded()
    mention.value = {
      startIdx: detected.startIdx,
      query: detected.query,
      selectedIdx: 0,
    }
  } else {
    mention.value = null
  }
}

function onKeydown(e: KeyboardEvent) {
  if (mention.value && mentionMatches.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      mention.value.selectedIdx = (mention.value.selectedIdx + 1) % mentionMatches.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      mention.value.selectedIdx =
        (mention.value.selectedIdx - 1 + mentionMatches.value.length) % mentionMatches.value.length
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      selectMention(mention.value.selectedIdx)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      selectMention(mention.value.selectedIdx)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      mention.value = null
      return
    }
  }
  // Default: Enter sends, Shift+Enter inserts newline
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function selectMention(idx: number) {
  if (!mention.value) return
  const d = mentionMatches.value[idx]
  if (!d) {
    mention.value = null
    return
  }
  const ta = textareaRef.value
  if (!ta) return
  const caret = ta.selectionStart
  const before = draft.value.slice(0, mention.value.startIdx)
  const after = draft.value.slice(caret)
  // Add trailing space so the mention is closed and the user can keep typing
  const insertion = `#${d.dealNumber} `
  draft.value = before + insertion + after
  mention.value = null
  nextTick(() => {
    const pos = before.length + insertion.length
    ta.focus()
    ta.setSelectionRange(pos, pos)
  })
}

function closeMentionDelayed() {
  // Delay so that a click on a dropdown item registers before blur clears it.
  // mousedown.prevent on the dropdown items keeps focus, but Safari can fire
  // blur on the textarea before click — keep the timeout as a safety net.
  setTimeout(() => { mention.value = null }, 150)
}

function dealStatusColor(status: string): string {
  switch (status) {
    case 'ACTIVE': return '#10b981'
    case 'COMPLETED': return '#6b7280'
    case 'DISPUTED': return '#f59e0b'
    case 'CANCELLED': return '#ef4444'
    default: return '#6b7280'
  }
}

function dealStatusLabel(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'Активна'
    case 'COMPLETED': return 'Завершена'
    case 'DISPUTED': return 'Спор'
    case 'CANCELLED': return 'Отменена'
    default: return status
  }
}

watch(() => props.chatId, async () => {
  if (chatPollTimer) { window.clearInterval(chatPollTimer); chatPollTimer = null }
  await loadMessages()
  if (props.chatId) {
    chatPollTimer = window.setInterval(pollNew, 4000)
  }
})

onMounted(async () => {
  await loadMessages()
  if (props.chatId) chatPollTimer = window.setInterval(pollNew, 4000)
})

onBeforeUnmount(() => {
  if (chatPollTimer) window.clearInterval(chatPollTimer)
})
</script>

<template>
  <div class="cp-root">
    <header v-if="showHeader" class="cp-header">
      <div class="cp-name">{{ counterpartName || '—' }}</div>
      <div v-if="counterpartRoleLabel" class="cp-sub">{{ counterpartRoleLabel }}</div>
    </header>

    <div ref="messageListRef" class="cp-list">
      <div v-if="messagesLoading && !messages.length" class="d-flex justify-center pa-6">
        <v-progress-circular indeterminate size="20" color="primary" />
      </div>
      <div v-else-if="!messages.length" class="cp-empty">
        <v-icon icon="mdi-message-text-outline" size="32" color="grey-lighten-1" />
        <div class="cp-empty-title">Нет сообщений</div>
        <div class="cp-empty-sub">Напишите первое — упоминайте сделки через <code>#номер</code></div>
      </div>
      <template v-else>
        <div
          v-for="m in messages"
          :key="m.id"
          class="cp-bubble-row"
          :class="{ 'cp-bubble-row--mine': isMine(m) }"
        >
          <div class="cp-bubble" :class="{ 'cp-bubble--mine': isMine(m) }">
            <div class="cp-bubble-text">
              <template v-for="(seg, i) in renderSegments(m)" :key="i">
                <span v-if="seg.type === 'text'">{{ seg.value }}</span>
                <button
                  v-else
                  type="button"
                  class="cp-mention"
                  :title="`Перейти к сделке #${seg.dealNumber}`"
                  @click="openDeal(seg.dealId)"
                >
                  <v-icon icon="mdi-briefcase-outline" size="13" class="cp-mention-icon" />
                  <span class="cp-mention-num-inline">#{{ seg.dealNumber }}</span>
                  <span class="cp-mention-name-inline">{{ seg.productName }}</span>
                </button>
              </template>
            </div>
            <div class="cp-bubble-time">{{ formatMessageTime(m.createdAt) }}</div>
          </div>
        </div>
      </template>
    </div>

    <footer class="cp-input-row">
      <div class="cp-input-wrap">
        <!-- Mention autocomplete dropdown -->
        <div
          v-if="mention && mentionMatches.length"
          class="cp-mention-menu"
          @mousedown.prevent
        >
          <button
            v-for="(d, idx) in mentionMatches"
            :key="d.id"
            type="button"
            class="cp-mention-item"
            :class="{ 'cp-mention-item--active': idx === mention.selectedIdx }"
            @click="selectMention(idx)"
            @mouseenter="mention!.selectedIdx = idx"
          >
            <span class="cp-mention-num">#{{ d.dealNumber }}</span>
            <span class="cp-mention-product">{{ d.productName }}</span>
            <span class="cp-mention-meta">
              {{ formatCurrency(d.totalPrice) }}
            </span>
            <span
              class="cp-mention-status"
              :style="{ background: dealStatusColor(d.status) + '14', color: dealStatusColor(d.status) }"
            >
              {{ dealStatusLabel(d.status) }}
            </span>
          </button>
        </div>

        <!-- Empty result hint -->
        <div
          v-else-if="mention && dealsLoaded && !mentionMatches.length"
          class="cp-mention-menu cp-mention-menu--empty"
          @mousedown.prevent
        >
          Сделки не найдены
        </div>

        <textarea
          ref="textareaRef"
          v-model="draft"
          class="cp-input"
          placeholder="Сообщение... #номер для упоминания сделки"
          rows="1"
          :disabled="!props.chatId"
          @input="onInput"
          @keydown="onKeydown"
          @click="onInput"
          @blur="closeMentionDelayed"
        />
      </div>
      <button class="cp-send" :disabled="!draft.trim() || sending || !props.chatId" @click="send">
        <v-progress-circular v-if="sending" indeterminate size="16" width="2" color="white" />
        <v-icon v-else icon="mdi-send" size="18" />
      </button>
    </footer>
  </div>
</template>

<style scoped>
.cp-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: rgb(var(--v-theme-surface));
}
.dark .cp-root { background: #1a1a26; }

.cp-header {
  padding: 14px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.dark .cp-header { border-bottom-color: rgba(255,255,255,0.06); }
.cp-name { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.cp-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }

.cp-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cp-empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.cp-empty-title { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.7); }
.cp-empty-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); text-align: center; }
.cp-empty-sub code {
  background: rgba(var(--v-theme-on-surface), 0.06);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}

.cp-bubble-row { display: flex; }
.cp-bubble-row--mine { justify-content: flex-end; }

.cp-bubble {
  max-width: 70%;
  padding: 8px 12px;
  border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.92);
}
.dark .cp-bubble { background: #2a2a3c; }
.cp-bubble--mine { background: rgb(var(--v-theme-primary)); color: white; }
.cp-bubble-text { font-size: 14px; line-height: 1.4; word-break: break-word; white-space: pre-wrap; }
.cp-bubble-time { margin-top: 3px; font-size: 10px; opacity: 0.65; text-align: right; }

.cp-mention {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  margin: 1px 2px;
  border-radius: 8px;
  background: rgba(255,255,255,0.18);
  color: inherit;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  border: none;
  text-decoration: none;
  vertical-align: middle;
  max-width: 100%;
}
.cp-bubble:not(.cp-bubble--mine) .cp-mention {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.cp-mention:hover { filter: brightness(1.1); }
.cp-mention-icon { opacity: 0.7; }
.cp-mention-num-inline { font-weight: 700; flex-shrink: 0; }
.cp-mention-name-inline {
  font-weight: 500;
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.cp-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.dark .cp-input-row { border-top-color: rgba(255,255,255,0.06); }

.cp-input-wrap {
  flex: 1;
  position: relative;
}
.cp-input {
  width: 100%;
  resize: none;
  font-size: 14px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-family: inherit;
  outline: none;
  max-height: 140px;
  min-height: 38px;
}
.dark .cp-input { background: #2a2a3c; border-color: #3e3e52; }
.cp-input:focus { border-color: rgb(var(--v-theme-primary)); }
.cp-input:disabled { opacity: 0.5; cursor: not-allowed; }

/* Mention autocomplete dropdown — positioned above textarea */
.cp-mention-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  max-height: 280px;
  overflow-y: auto;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 50;
}
.dark .cp-mention-menu {
  background: #25253a;
  border-color: rgba(255,255,255,0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.cp-mention-menu--empty {
  padding: 14px;
  text-align: center;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.cp-mention-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: background 0.1s;
}
.cp-mention-item--active { background: rgba(var(--v-theme-primary), 0.1); }
.cp-mention-num {
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  font-size: 13px;
  flex-shrink: 0;
  min-width: 36px;
}
.cp-mention-product {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-mention-meta {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  flex-shrink: 0;
}
.cp-mention-status {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  flex-shrink: 0;
}

.cp-send {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgb(var(--v-theme-primary));
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s;
}
.cp-send:disabled { opacity: 0.4; cursor: not-allowed; }
.cp-send:not(:disabled):hover { filter: brightness(1.05); }
</style>
