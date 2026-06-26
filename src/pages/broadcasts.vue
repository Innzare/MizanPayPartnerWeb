<script lang="ts" setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useAuthStore } from '@/stores/auth'
import { formatCurrency, formatDate } from '@/utils/formatters'

// Dedicated "Рассылки" section: WhatsApp connection (QR), manual payment
// reminders, and auto-reminder settings — all the broadcasting controls a
// partner needs in one place. Replaces the old "Напомнить всем" modal and the
// WhatsApp tab that used to live in Settings.

const toast = useToast()
const { isDark } = useIsDark()
const authStore = useAuthStore()
const router = useRouter()

function goToDeal(dealId: string) { router.push(`/deals/${dealId}`) }
function goToClient(clientProfileId: string | null) { if (clientProfileId) router.push(`/clients/${clientProfileId}`) }

type Tab = 'send' | 'auto' | 'connection'
const activeTab = ref<Tab>('send')
const showGuide = ref(false)
const showProtect = ref(false)

// ─────────────────────────── Connection (QR) ───────────────────────────
const waStatus = ref<'loading' | 'disconnected' | 'connecting' | 'connected'>('loading')
const waQrCode = ref<string | null>(null)
let waPolling: ReturnType<typeof setInterval> | null = null
let waTimeout: ReturnType<typeof setTimeout> | null = null

const connected = computed(() => waStatus.value === 'connected')

function stopPolling() {
  if (waPolling) { clearInterval(waPolling); waPolling = null }
  if (waTimeout) { clearTimeout(waTimeout); waTimeout = null }
}

async function checkStatus() {
  try {
    const res = await api.get<{ status: string; connected: boolean }>('/whatsapp/session/status')
    waStatus.value = res.connected ? 'connected' : 'disconnected'
  } catch {
    waStatus.value = 'disconnected'
  }
}

async function connect() {
  waStatus.value = 'connecting'
  waQrCode.value = null
  try {
    await api.post('/whatsapp/session')
    await refreshQr()

    // Poll status; refresh the QR every few ticks since Green's QR expires
    // (~20s) and regenerates. The backend returns a ready data-URL image.
    let tick = 0
    waPolling = setInterval(async () => {
      tick++
      try {
        const status = await api.get<{ status: string; connected: boolean }>('/whatsapp/session/status')
        if (status.connected) {
          stopPolling()
          waStatus.value = 'connected'
          waQrCode.value = null
          toast.success('WhatsApp подключён!')
          loadPreview()
          loadWaSettings()
          activeTab.value = 'send'
          return
        }
        if (tick % 5 === 0) await refreshQr() // ~every 15s
      } catch { /* keep polling */ }
    }, 3000)

    // Give up after 2 minutes — the user can retry.
    waTimeout = setTimeout(() => {
      stopPolling()
      if (waStatus.value === 'connecting') {
        waStatus.value = 'disconnected'
        waQrCode.value = null
        toast.error('Время ожидания истекло. Попробуйте снова.')
      }
    }, 120_000)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка подключения')
    waStatus.value = 'disconnected'
  }
}

// Fetch the current QR. Backend returns it as a ready `data:image/png;base64`
// URL, or status 'connected' if the instance is already authorized.
async function refreshQr() {
  try {
    const res = await api.get<{ qr: string | null; status: string }>('/whatsapp/session/qr')
    if (res.status === 'connected') {
      stopPolling()
      waStatus.value = 'connected'
      waQrCode.value = null
      loadPreview()
      loadWaSettings()
      return
    }
    if (res.qr) waQrCode.value = res.qr
  } catch { /* keep current QR */ }
}

async function disconnect() {
  if (!confirm('Отключить WhatsApp? Авто-напоминания и рассылки перестанут отправляться.')) return
  try {
    await api.delete('/whatsapp/session')
    stopPolling()
    waStatus.value = 'disconnected'
    waQrCode.value = null
    toast.success('WhatsApp отключён')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка отключения')
  }
}

// ─────────────────────────── Reminders (manual) ────────────────────────
interface PaymentRow {
  paymentId: string
  number: number
  amount: number
  dueDate: string
  status: 'PENDING' | 'OVERDUE'
  dealId: string
  dealNumber: number | null
  productName: string
  lastReminderSentAt: string | null
}
interface ClientGroup {
  key: string
  clientPhone: string | null
  clientName: string
  clientFirstName: string
  clientProfileId: string | null
  canSend: boolean
  payments: PaymentRow[]
  totals: {
    overdueCount: number; overdueAmount: number
    upcomingCount: number; upcomingAmount: number
    totalCount: number; totalAmount: number
  }
}
interface PreviewResponse { daysBeforeDue: number; groups: ClientGroup[] }

const daysBeforeDue = ref(3)
const loading = ref(false)
const sending = ref(false)
const groups = ref<ClientGroup[]>([])
const excluded = ref<Set<string>>(new Set())
const excludedPayments = ref<Set<string>>(new Set())
const search = ref('')
const expanded = ref<Set<string>>(new Set())

async function loadPreview() {
  loading.value = true
  excluded.value = new Set()
  excludedPayments.value = new Set()
  expanded.value = new Set()
  try {
    const res = await api.post<PreviewResponse>('/whatsapp/remind-preview', { daysBeforeDue: daysBeforeDue.value })
    groups.value = res.groups
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить список')
    groups.value = []
  } finally {
    loading.value = false
  }
}

const visibleGroups = computed(() => {
  if (!search.value.trim()) return groups.value
  const s = search.value.trim().toLowerCase()
  return groups.value.filter(
    (g) =>
      g.clientName.toLowerCase().includes(s) ||
      (g.clientPhone ?? '').toLowerCase().includes(s) ||
      g.payments.some((p) => p.productName.toLowerCase().includes(s)),
  )
})
const sendableGroups = computed(() => groups.value.filter((g) => g.canSend))

function effectivePayments(group: ClientGroup): PaymentRow[] {
  return group.payments.filter((p) => !excludedPayments.value.has(p.paymentId))
}
function effectiveTotals(group: ClientGroup) {
  let overdueCount = 0, overdueAmount = 0, upcomingCount = 0, upcomingAmount = 0
  for (const p of effectivePayments(group)) {
    if (p.status === 'OVERDUE') { overdueCount++; overdueAmount += p.amount }
    else { upcomingCount++; upcomingAmount += p.amount }
  }
  return { overdueCount, overdueAmount, upcomingCount, upcomingAmount, totalCount: overdueCount + upcomingCount, totalAmount: overdueAmount + upcomingAmount }
}

const selectedGroups = computed(() =>
  sendableGroups.value.filter((g) => !excluded.value.has(g.key) && effectivePayments(g).length > 0),
)
const selectedAmount = computed(() => selectedGroups.value.reduce((s, g) => s + effectiveTotals(g).totalAmount, 0))
const totalPaymentsCount = computed(() => groups.value.reduce((s, g) => s + g.totals.totalCount, 0))
const noPhoneCount = computed(() => groups.value.filter((g) => !g.canSend).length)

function toggleGroup(key: string) {
  const next = new Set(excluded.value)
  if (next.has(key)) {
    next.delete(key)
    const group = groups.value.find((g) => g.key === key)
    if (group) {
      const cleared = new Set(excludedPayments.value)
      for (const p of group.payments) cleared.delete(p.paymentId)
      excludedPayments.value = cleared
    }
  } else next.add(key)
  excluded.value = next
}
function togglePayment(group: ClientGroup, paymentId: string) {
  const next = new Set(excludedPayments.value)
  if (next.has(paymentId)) next.delete(paymentId); else next.add(paymentId)
  excludedPayments.value = next
  const allExcluded = group.payments.every((p) => next.has(p.paymentId))
  const groupExcl = new Set(excluded.value)
  if (allExcluded) groupExcl.add(group.key); else groupExcl.delete(group.key)
  excluded.value = groupExcl
}
function toggleExpanded(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  expanded.value = next
}
function selectAllVisible() {
  const next = new Set(excluded.value)
  const nextPayments = new Set(excludedPayments.value)
  for (const g of visibleGroups.value) {
    if (g.canSend) { next.delete(g.key); for (const p of g.payments) nextPayments.delete(p.paymentId) }
  }
  excluded.value = next
  excludedPayments.value = nextPayments
}
function clearAllVisible() {
  const next = new Set(excluded.value)
  for (const g of visibleGroups.value) if (g.canSend) next.add(g.key)
  excluded.value = next
}
const isAllVisibleSelected = computed(() => {
  const sendable = visibleGroups.value.filter((g) => g.canSend)
  if (sendable.length === 0) return false
  return sendable.every((g) => !excluded.value.has(g.key))
})

// Are there any payments already reminded among the visible groups?
const hasReminded = computed(() =>
  visibleGroups.value.some((g) => g.payments.some((p) => p.lastReminderSentAt)),
)

// Uncheck only the payments a reminder was already sent for. Fresh payments
// stay selected. If that empties a client, its group checkbox unchecks too.
function deselectReminded() {
  const nextPayments = new Set(excludedPayments.value)
  const nextGroups = new Set(excluded.value)
  for (const g of visibleGroups.value) {
    if (!g.canSend) continue
    for (const p of g.payments) if (p.lastReminderSentAt) nextPayments.add(p.paymentId)
    if (g.payments.every((p) => nextPayments.has(p.paymentId))) nextGroups.add(g.key)
  }
  excludedPayments.value = nextPayments
  excluded.value = nextGroups
}

// ─── Campaign (queued send with live progress) ───
interface CampaignRecipient {
  id: string
  clientName: string
  phone: string
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED'
  error: string | null
  sentAt: string | null
}
interface Campaign {
  id: string
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  totalCount: number
  sentCount: number
  failedCount: number
  pendingCount: number
  connected?: boolean
  stalled?: boolean
  dailyLimitReached?: boolean
  dailyLimit?: number
  sentToday?: number
  recipients: CampaignRecipient[]
}
const campaign = ref<Campaign | null>(null)
let campaignPoll: ReturnType<typeof setInterval> | null = null
// A campaign blocks starting a new one while it's still RUNNING or PAUSED.
const campaignActive = computed(
  () => !!campaign.value && (campaign.value.status === 'RUNNING' || campaign.value.status === 'PAUSED'),
)

function stopCampaignPoll() {
  if (campaignPoll) { clearInterval(campaignPoll); campaignPoll = null }
}
async function loadCampaign(id: string) {
  try {
    campaign.value = await api.get<Campaign>(`/whatsapp/campaigns/${id}`)
    if (campaign.value.status !== 'RUNNING') stopCampaignPoll()
  } catch { /* keep last snapshot */ }
}
function startCampaignPoll(id: string) {
  stopCampaignPoll()
  campaignPoll = setInterval(() => loadCampaign(id), 2500)
}

async function send() {
  if (!connected.value) { toast.error('Сначала подключите WhatsApp'); activeTab.value = 'connection'; return }
  const ids = selectedGroups.value.flatMap((g) => effectivePayments(g).map((p) => p.paymentId))
  if (!ids.length) { toast.error('Выберите хотя бы одного клиента'); return }
  const groupCount = selectedGroups.value.length
  const noun = groupCount === 1 ? 'клиенту' : 'клиентам'
  if (!confirm(`Отправить напоминания ${groupCount} ${noun}?`)) return
  sending.value = true
  try {
    const res = await api.post<{ campaignId: string; total: number }>('/whatsapp/campaigns', { paymentIds: ids })
    await loadCampaign(res.campaignId)
    startCampaignPoll(res.campaignId)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка отправки')
  } finally {
    sending.value = false
  }
}

async function retryCampaign() {
  if (!campaign.value) return
  try {
    campaign.value = await api.post<Campaign>(`/whatsapp/campaigns/${campaign.value.id}/retry`)
    startCampaignPoll(campaign.value.id)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось перезапустить')
  }
}
async function pauseCampaign() {
  if (!campaign.value) return
  try {
    campaign.value = await api.post<Campaign>(`/whatsapp/campaigns/${campaign.value.id}/pause`)
    stopCampaignPoll()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось приостановить')
  }
}
async function resumeCampaign() {
  if (!campaign.value) return
  try {
    campaign.value = await api.post<Campaign>(`/whatsapp/campaigns/${campaign.value.id}/resume`)
    startCampaignPoll(campaign.value.id)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось продолжить')
  }
}
async function cancelCampaign() {
  if (!campaign.value || !confirm('Отменить рассылку? Оставшиеся сообщения не будут отправлены.')) return
  try {
    await api.post(`/whatsapp/campaigns/${campaign.value.id}/cancel`)
    await loadCampaign(campaign.value.id)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось отменить')
  }
}
// Close the progress view and return to the builder (refreshed to reflect sends).
function closeCampaign() {
  stopCampaignPoll()
  campaign.value = null
  loadPreview()
}
const recipientLabel: Record<CampaignRecipient['status'], string> = {
  PENDING: 'В очереди', SENDING: 'Отправляется', SENT: 'Отправлено', FAILED: 'Ошибка',
}

function setDays(d: number) { daysBeforeDue.value = d; loadPreview() }
function maskPhone(p: string | null) {
  if (!p) return '—'
  const digits = p.replace(/\D/g, '')
  if (digits.length === 11) return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
  return p
}
function getInitials(name: string) {
  if (!name || name === '—') return '?'
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? '' + (parts[1]?.[0] ?? '')).toUpperCase()
}

// Latest date a reminder was sent across the client's payments (null if never).
function groupLastReminded(group: ClientGroup): string | null {
  const dates = group.payments.map((p) => p.lastReminderSentAt).filter(Boolean) as string[]
  if (!dates.length) return null
  return formatDate(dates.reduce((a, b) => (a > b ? a : b)))
}

// Mirrors the backend `buildConsolidatedReminderText` (whatsapp.service.ts)
// EXACTLY — same formats, blocks and single-occurrence replacements — so the
// preview shows precisely what the client will receive. Uses effectivePayments
// so it updates live as the partner toggles individual payments.
function previewMessage(group: ClientGroup): string {
  const pays = effectivePayments(group)
  if (!pays.length) return ''
  const s = waSettings.value
  const phone = authStore.user?.phone || null
  const phoneTail = phone ? `\nПо вопросам: ${phone}` : ''
  const fmtMoney = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  const clientName = group.clientName

  if (pays.length === 1) {
    const p = pays[0]!
    const tpl = p.status === 'OVERDUE' ? s.overdueTemplate : s.template
    return tpl
      .replace('{сумма}', fmtMoney(p.amount))
      .replace('{товар}', p.productName)
      .replace('{дата}', fmtDate(p.dueDate))
      .replace('{клиент}', clientName && clientName !== '—' ? clientName : '')
      .replace('{телефон_строка}', phoneTail)
  }

  const overdue = pays.filter((p) => p.status === 'OVERDUE')
  const upcoming = pays.filter((p) => p.status !== 'OVERDUE')
  const overdueBlock = overdue.length
    ? 'Просроченные:\n' + overdue.map((p) => `— ${fmtMoney(p.amount)} по «${p.productName}» (был ${fmtDate(p.dueDate)})`).join('\n') + '\n\n'
    : ''
  const upcomingBlock = upcoming.length
    ? (overdue.length ? 'Ближайшие:\n' : 'Ближайшие платежи:\n') + upcoming.map((p) => `— ${fmtMoney(p.amount)} по «${p.productName}» (срок ${fmtDate(p.dueDate)})`).join('\n') + '\n\n'
    : ''
  const total = pays.reduce((acc, p) => acc + p.amount, 0)
  return s.summaryTemplate
    .replace('{имя}', group.clientFirstName || '')
    .replace('{просроченные}', overdueBlock)
    .replace('{ближайшие}', upcomingBlock)
    .replace('{итого}', fmtMoney(total))
    .replace('{телефон_строка}', phoneTail)
}

// ─────────────────────── Auto-reminder settings ────────────────────────
const savingSettings = ref(false)
const waSettings = ref({
  enabled: false,
  daysBefore: 3,
  remindOverdue: true,
  sendTime: '10:00',
  template: 'Здравствуйте, {клиент}! Напоминаем об оплате по рассрочке: {товар} — {сумма}, срок: {дата}.{телефон_строка}',
  overdueTemplate: 'Здравствуйте, {клиент}! У вас просрочен платёж по рассрочке: {товар} — {сумма}, срок был: {дата}. Просим оплатить как можно скорее.{телефон_строка}',
  summaryTemplate: 'Здравствуйте, {имя}!\n\nНапоминаем по вашим платежам:\n\n{просроченные}{ближайшие}Итого к оплате: {итого}.{телефон_строка}',
})
const daysOptions = [1, 2, 3, 5, 7]
const templateVars = ['{сумма}', '{товар}', '{дата}', '{клиент}', '{телефон_строка}']
const summaryTemplateVars = ['{имя}', '{просроченные}', '{ближайшие}', '{итого}', '{телефон_строка}']
const templateRef = ref<HTMLTextAreaElement | null>(null)
const overdueTemplateRef = ref<HTMLTextAreaElement | null>(null)
const summaryTemplateRef = ref<HTMLTextAreaElement | null>(null)

async function loadWaSettings() {
  try {
    const data = await api.get<any>('/whatsapp/settings')
    waSettings.value = { ...waSettings.value, ...data }
  } catch { /* ignore */ }
}
async function saveWaSettings() {
  savingSettings.value = true
  try {
    await api.patch('/whatsapp/settings', waSettings.value)
    toast.success('Настройки сохранены')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  } finally {
    savingSettings.value = false
  }
}
function previewTemplate(tpl: string): string {
  return tpl
    .replace(/\{сумма\}/g, '15 000 ₽')
    .replace(/\{товар\}/g, 'iPhone 15 Pro')
    .replace(/\{дата\}/g, '15 апреля')
    .replace(/\{клиент\}/g, 'Ахмед')
    .replace(/\{телефон_строка\}/g, '\nПо вопросам: +7 928 000 00 00')
}
function previewSummaryTemplate(tpl: string): string {
  const overdueBlock = 'Просроченные:\n— 7 500 ₽ по «iPhone 15» (был 5 мая)\n— 7 500 ₽ по «MacBook» (был 7 мая)\n\n'
  const upcomingBlock = 'Ближайшие:\n— 5 000 ₽ по «AirPods» (срок 14 мая)\n\n'
  return tpl
    .replace(/\{имя\}/g, 'Ахмед')
    .replace(/\{просроченные\}/g, overdueBlock)
    .replace(/\{ближайшие\}/g, upcomingBlock)
    .replace(/\{итого\}/g, '20 000 ₽')
    .replace(/\{телефон_строка\}/g, '\nПо вопросам: +7 928 000 00 00')
}
function insertVar(field: 'template' | 'overdueTemplate' | 'summaryTemplate', variable: string) {
  const textarea = field === 'template' ? templateRef.value : field === 'overdueTemplate' ? overdueTemplateRef.value : summaryTemplateRef.value
  if (!textarea) { waSettings.value[field] += variable; return }
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const text = waSettings.value[field]
  waSettings.value[field] = text.substring(0, start) + variable + text.substring(end)
  nextTick(() => {
    const pos = start + variable.length
    textarea.selectionStart = pos
    textarea.selectionEnd = pos
    textarea.focus()
  })
}

// ─────────────────────────────── Lifecycle ─────────────────────────────
onMounted(async () => {
  // Preview + settings work regardless of connection (the endpoints only read
  // data / plan-gated), so load them always — the reminder builder is usable
  // even when WhatsApp isn't connected; only the actual send is blocked.
  loadPreview()
  loadWaSettings()
  // Resume the progress view if a campaign is still in flight (page reload).
  try {
    const active = await api.get<Campaign | null>('/whatsapp/campaigns/active')
    if (active) { campaign.value = active; startCampaignPoll(active.id) }
  } catch { /* none */ }
  await checkStatus()
})
onUnmounted(() => { stopPolling(); stopCampaignPoll() })

function goConnect() { activeTab.value = 'connection' }
</script>

<template>
  <div class="bc-page" :class="{ dark: isDark }">
    <!-- Header -->
    <div class="bc-header">
      <div>
        <h1 class="bc-title">Рассылки</h1>
        <div class="bc-subtitle">Напоминания клиентам по WhatsApp — вручную и автоматически</div>
      </div>
      <div class="bc-header-right">
        <button class="bc-guide-btn" @click="showGuide = true" title="Как не получить блокировку">
          <v-icon icon="mdi-shield-alert-outline" size="16" />
          Защита от бана
        </button>
        <div class="bc-conn-chip" :class="connected ? 'bc-conn-chip--on' : 'bc-conn-chip--off'">
          <v-icon icon="mdi-whatsapp" size="15" />
          {{ waStatus === 'loading' ? 'Проверка…' : connected ? 'Подключён' : 'Не подключён' }}
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="bc-tabs">
      <button class="bc-tab" :class="{ active: activeTab === 'send' }" @click="activeTab = 'send'">
        <v-icon icon="mdi-send-outline" size="16" /> Напоминания
      </button>
      <button class="bc-tab" :class="{ active: activeTab === 'auto' }" @click="activeTab = 'auto'">
        <v-icon icon="mdi-clock-check-outline" size="16" /> Авто-напоминания и шаблоны
      </button>
      <button class="bc-tab" :class="{ active: activeTab === 'connection' }" @click="activeTab = 'connection'">
        <v-icon icon="mdi-link-variant" size="16" /> Подключение
        <span v-if="!connected && waStatus !== 'loading'" class="bc-tab-dot" />
      </button>
    </div>

    <!-- ══════════════ TAB: Напоминания ══════════════ -->
    <template v-if="activeTab === 'send'">
      <!-- What MizanPay does automatically to protect the partner's number -->
      <div class="bc-protect">
        <button class="bc-protect-head" @click="showProtect = !showProtect">
          <v-icon icon="mdi-shield-check" size="18" />
          <span>MizanPay защищает ваш номер от блокировки</span>
          <v-spacer />
          <v-icon icon="mdi-chevron-down" size="18" class="bc-protect-chev" :class="{ open: showProtect }" />
        </button>
        <div v-if="showProtect" class="bc-protect-body">
          <ul class="bc-protect-list">
            <li><v-icon icon="mdi-timer-sand" size="14" /> Сообщения уходят с паузами (1,5–4 сек) и имитацией набора «печатает…» — как у человека, без «залпов».</li>
            <li><v-icon icon="mdi-counter" size="14" /> Не более 200 сообщений в день с одного номера — остальное автоматически переносится на завтра.</li>
            <li><v-icon icon="mdi-message-text-outline" size="14" /> Клиент получает одно сводное сообщение по всем платежам, а не по одному на каждый.</li>
            <li><v-icon icon="mdi-repeat-off" size="14" /> Повторные напоминания по одному платежу — не чаще раза в сутки.</li>
          </ul>
          <div class="bc-protect-note">Полностью исключить блокировку нельзя — её накладывает WhatsApp. Как ещё защитить номер — см. «Защита от бана» вверху.</div>
        </div>
      </div>

      <!-- ─── Progress section — sits ABOVE the builder, doesn't replace it ─── -->
      <v-card v-if="campaign" rounded="lg" elevation="0" border class="bc-card bc-prog-card" :class="{ 'bc-prog-card--running': campaign.status === 'RUNNING' }">
        <div class="bc-prog-head">
          <div>
            <div class="bc-prog-title">
              <span v-if="campaign.status === 'RUNNING' && !campaign.stalled && !campaign.dailyLimitReached" class="bc-prog-live" />
              {{ campaign.status === 'RUNNING' ? (campaign.stalled ? 'Рассылка ждёт подключения' : campaign.dailyLimitReached ? 'Лимит на сегодня достигнут' : 'Рассылка идёт…') : campaign.status === 'PAUSED' ? 'Рассылка на паузе' : campaign.status === 'COMPLETED' ? 'Рассылка завершена' : 'Рассылка отменена' }}
            </div>
            <div class="bc-prog-sub">{{ campaign.sentCount }} из {{ campaign.totalCount }} отправлено</div>
          </div>
          <div class="bc-prog-actions">
            <button v-if="campaign.status === 'RUNNING'" class="bc-btn bc-btn--ghost" @click="pauseCampaign"><v-icon icon="mdi-pause" size="16" /> Пауза</button>
            <template v-if="campaign.status === 'PAUSED'">
              <button class="bc-btn bc-btn--primary" @click="resumeCampaign"><v-icon icon="mdi-play" size="16" /> Продолжить</button>
              <button class="bc-btn bc-btn--ghost" @click="cancelCampaign">Отменить</button>
            </template>
            <button v-if="campaign.failedCount > 0 && (campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED')" class="bc-btn bc-btn--primary" @click="retryCampaign">
              <v-icon icon="mdi-refresh" size="16" /> Повторить неотправленные ({{ campaign.failedCount }})
            </button>
            <button v-if="campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED'" class="bc-btn bc-btn--ghost" @click="closeCampaign">Скрыть</button>
          </div>
        </div>

        <div v-if="campaign.stalled" class="bc-warn bc-prog-warn">
          <v-icon icon="mdi-alert-circle-outline" size="18" />
          <span>Отправка приостановлена: <b>WhatsApp не подключён</b>. Подключите номер — рассылка продолжится автоматически с того же места.</span>
          <button class="bc-warn-btn" @click="goConnect"><v-icon icon="mdi-qrcode-scan" size="15" /> Подключить</button>
        </div>
        <div v-else-if="campaign.dailyLimitReached" class="bc-warn bc-prog-warn bc-warn--info">
          <v-icon icon="mdi-shield-clock-outline" size="18" />
          <span>Достигнут дневной лимит отправки ({{ campaign.dailyLimit }} сообщений) — это защита номера от блокировки. Оставшиеся напоминания уйдут <b>автоматически завтра</b>.</span>
        </div>

        <div class="bc-prog-bar">
          <div class="bc-prog-fill bc-prog-fill--sent" :style="{ width: (campaign.sentCount / campaign.totalCount * 100) + '%' }" />
          <div class="bc-prog-fill bc-prog-fill--failed" :style="{ width: (campaign.failedCount / campaign.totalCount * 100) + '%' }" />
        </div>
        <div class="bc-prog-legend">
          <span class="bc-prog-leg bc-prog-leg--sent"><v-icon icon="mdi-check-circle" size="13" /> Отправлено: {{ campaign.sentCount }}</span>
          <span v-if="campaign.failedCount > 0" class="bc-prog-leg bc-prog-leg--failed"><v-icon icon="mdi-alert-circle" size="13" /> Ошибка: {{ campaign.failedCount }}</span>
          <span v-if="campaign.pendingCount > 0" class="bc-prog-leg bc-prog-leg--pending"><v-icon icon="mdi-clock-outline" size="13" /> В очереди: {{ campaign.pendingCount }}</span>
        </div>

        <div class="bc-prog-list">
          <div v-for="r in campaign.recipients" :key="r.id" class="bc-prog-row">
            <span class="bc-prog-st" :class="'bc-prog-st--' + r.status.toLowerCase()">
              <v-icon :icon="r.status === 'SENT' ? 'mdi-check' : r.status === 'FAILED' ? 'mdi-close' : r.status === 'SENDING' ? 'mdi-send' : 'mdi-clock-outline'" size="12" />
            </span>
            <div class="bc-prog-row-main">
              <div class="bc-prog-name">{{ r.clientName }}</div>
              <div class="bc-prog-meta">{{ maskPhone(r.phone) }}<span v-if="r.error"> · {{ r.error }}</span></div>
            </div>
            <span class="bc-prog-badge" :class="'bc-prog-badge--' + r.status.toLowerCase()">{{ recipientLabel[r.status] }}</span>
          </div>
        </div>
      </v-card>

      <!-- ─── Builder — always visible; the progress section sits above it ─── -->
      <!-- Not-connected warning: the builder stays usable (preview + selection),
           only sending is blocked until WhatsApp is connected. -->
      <div v-if="!connected && waStatus !== 'loading'" class="bc-warn">
        <v-icon icon="mdi-alert-circle-outline" size="18" />
        <span>WhatsApp не подключён — отправка недоступна. Можно выбрать получателей и посмотреть текст, но отправить нельзя.</span>
        <button class="bc-warn-btn" @click="goConnect"><v-icon icon="mdi-qrcode-scan" size="15" /> Подключить</button>
      </div>

      <v-card rounded="lg" elevation="0" border class="bc-card">
        <div class="bc-filters">
          <div class="bc-days">
            <span class="bc-days-label"><v-icon icon="mdi-calendar-range" size="14" /> Платежи на ближайшие</span>
            <div class="bc-seg">
              <button class="bc-seg-btn" v-for="d in [1, 3, 7, 14, 30]" :key="d" :class="{ active: daysBeforeDue === d }" @click="setDays(d)">{{ d }}</button>
            </div>
            <span class="bc-days-unit">дней</span>
          </div>
          <div class="bc-search-row">
            <div class="bc-search-wrap">
              <v-icon icon="mdi-magnify" size="18" class="bc-search-icon" />
              <input v-model="search" type="text" class="bc-search" placeholder="Поиск по клиенту, телефону или товару…" />
              <button v-if="search" class="bc-search-clear" @click="search = ''" title="Очистить"><v-icon icon="mdi-close" size="14" /></button>
            </div>
            <button
              class="bc-btn bc-btn--primary bc-send-btn"
              :disabled="sending || selectedGroups.length === 0 || !connected || campaignActive"
              :title="campaignActive ? 'Дождитесь завершения текущей рассылки' : !connected ? 'Сначала подключите WhatsApp' : ''"
              @click="send"
            >
              <v-progress-circular v-if="sending" indeterminate size="14" width="2" color="white" />
              <v-icon v-else icon="mdi-whatsapp" size="16" />
              {{ campaignActive ? 'Рассылка уже идёт' : connected ? `Отправить · ${selectedGroups.length}` : 'Подключите WhatsApp' }}
            </button>
          </div>
        </div>

        <div class="bc-summary">
          <span class="bc-summary-item"><strong>{{ groups.length }}</strong> {{ groups.length === 1 ? 'клиент' : 'клиентов' }} ({{ totalPaymentsCount }} {{ totalPaymentsCount === 1 ? 'платёж' : 'платежей' }})</span>
          <span class="bc-summary-sep">·</span>
          <span class="bc-summary-item bc-summary-item--ok"><strong>{{ selectedGroups.length }}</strong> к отправке ({{ formatCurrency(selectedAmount) }})</span>
          <span v-if="noPhoneCount > 0" class="bc-summary-sep">·</span>
          <span v-if="noPhoneCount > 0" class="bc-summary-item bc-summary-item--warn"><v-icon icon="mdi-phone-off" size="13" /><strong>{{ noPhoneCount }}</strong> без телефона</span>
        </div>

        <div class="bc-list-head" v-if="groups.length > 0">
          <label class="bc-check"><input type="checkbox" :checked="isAllVisibleSelected" @change="isAllVisibleSelected ? clearAllVisible() : selectAllVisible()" /></label>
          <span class="bc-list-head-label" @click="isAllVisibleSelected ? clearAllVisible() : selectAllVisible()">{{ isAllVisibleSelected ? 'Снять всех' : 'Выбрать всех' }}</span>
          <span v-if="hasReminded" class="bc-head-sep">·</span>
          <button v-if="hasReminded" class="bc-head-action" @click="deselectReminded" title="Убрать из рассылки клиентов, которым напоминание уже отправляли">
            <v-icon icon="mdi-check-circle-outline" size="14" /> Снять уже отправленные
          </button>
          <v-spacer />
        </div>

        <div class="bc-list" :class="{ loading }">
          <div v-if="loading" class="bc-empty"><v-progress-circular indeterminate size="28" color="primary" /></div>
          <div v-else-if="!visibleGroups.length" class="bc-empty">
            <v-icon icon="mdi-cash-check" size="36" color="grey" />
            <div class="bc-empty-title">Нет платежей по фильтру</div>
            <div class="bc-empty-sub">Попробуйте изменить срок или поиск</div>
          </div>

          <div v-for="g in visibleGroups" :key="g.key" class="bc-group" :class="{ 'bc-group--disabled': !g.canSend, 'bc-group--selected': g.canSend && !excluded.has(g.key) }">
            <div class="bc-group-head" @click="toggleExpanded(g.key)">
              <label class="bc-check" @click.stop>
                <input type="checkbox" :checked="g.canSend && !excluded.has(g.key)" :disabled="!g.canSend" @change="toggleGroup(g.key)" />
              </label>
              <div class="bc-group-avatar" :class="{ 'bc-group-avatar--overdue': effectiveTotals(g).overdueCount > 0 }">{{ getInitials(g.clientName) }}</div>
              <div class="bc-group-main">
                <div class="bc-group-name">{{ g.clientName }}</div>
                <div class="bc-group-sub">
                  <span v-if="g.canSend">{{ maskPhone(g.clientPhone) }}</span>
                  <span v-else class="bc-no-phone"><v-icon icon="mdi-phone-off" size="11" /> нет телефона</span>
                  <span class="bc-dot">·</span>
                  <span>{{ effectiveTotals(g).totalCount }} {{ effectiveTotals(g).totalCount === 1 ? 'платёж' : 'платежей' }}</span>
                  <span v-if="effectiveTotals(g).overdueCount > 0" class="bc-sub-overdue">· {{ effectiveTotals(g).overdueCount }} просроч.</span>
                  <span v-if="groupLastReminded(g)" class="bc-sub-sent" :title="`Напоминание уже отправлялось ${groupLastReminded(g)}`"><v-icon icon="mdi-check-circle" size="12" /> Уже отправлено ({{ groupLastReminded(g) }})</span>
                </div>
              </div>
              <div class="bc-group-right">
                <div class="bc-group-amount">{{ formatCurrency(effectiveTotals(g).totalAmount) }}</div>
                <div v-if="effectiveTotals(g).totalCount < g.totals.totalCount" class="bc-group-partial">выбрано {{ effectiveTotals(g).totalCount }} из {{ g.totals.totalCount }}</div>
              </div>
              <v-icon icon="mdi-chevron-down" size="18" class="bc-group-chev" :class="{ open: expanded.has(g.key) }" />
            </div>

            <div v-if="expanded.has(g.key)" class="bc-group-body">
              <!-- Body toolbar: payments count + client profile link -->
              <div class="bc-body-bar">
                <span class="bc-body-bar-title">Платежи · {{ g.payments.length }}</span>
                <v-spacer />
                <button v-if="g.clientProfileId" class="bc-link-btn" @click.stop="goToClient(g.clientProfileId)">
                  <v-icon icon="mdi-account-outline" size="14" /> Профиль клиента
                </button>
              </div>

              <div class="bc-pay-list">
                <div
                  v-for="p in g.payments"
                  :key="p.paymentId"
                  class="bc-pay"
                  :class="{ 'bc-pay--excluded': excludedPayments.has(p.paymentId) }"
                  @click="g.canSend && togglePayment(g, p.paymentId)"
                >
                  <label class="bc-check bc-check--small" @click.stop><input type="checkbox" :checked="!excludedPayments.has(p.paymentId)" :disabled="!g.canSend" @change="togglePayment(g, p.paymentId)" /></label>
                  <span class="bc-pay-dot" :class="p.status === 'OVERDUE' ? 'bc-pay-dot--overdue' : 'bc-pay-dot--upcoming'" />
                  <button class="bc-pay-deal" type="button" title="Открыть сделку" @click.stop="goToDeal(p.dealId)">
                    <span v-if="p.dealNumber" class="bc-pay-dealnum">#{{ p.dealNumber }}</span>{{ p.productName }}
                    <v-icon icon="mdi-open-in-new" size="11" class="bc-pay-deal-ico" />
                  </button>
                  <span class="bc-pay-due" :class="{ 'bc-pay-due--overdue': p.status === 'OVERDUE' }">дата платежа {{ formatDate(p.dueDate) }}</span>
                  <span v-if="p.lastReminderSentAt" class="bc-pay-sent" :title="`Напоминание по этому платежу отправлено ${formatDate(p.lastReminderSentAt)}`">
                    <v-icon icon="mdi-check-circle" size="12" /> отправлено {{ formatDate(p.lastReminderSentAt) }}
                  </span>
                  <span class="bc-pay-amount">{{ formatCurrency(p.amount) }}</span>
                </div>
              </div>

              <!-- Live preview of the exact message this client will receive -->
              <div v-if="effectivePayments(g).length" class="bc-preview">
                <div class="bc-preview-label"><v-icon icon="mdi-whatsapp" size="13" /> Клиент получит это сообщение</div>
                <div class="bc-bubble"><div class="bc-bubble-text">{{ previewMessage(g) }}</div></div>
              </div>
            </div>
          </div>
        </div>

      </v-card>
    </template>

    <!-- ══════════════ TAB: Авто-напоминания ══════════════ -->
    <template v-else-if="activeTab === 'auto'">
      <!-- Settings stay editable without a connection; they just won't fire
           until WhatsApp is connected. -->
      <div v-if="!connected && waStatus !== 'loading'" class="bc-warn">
        <v-icon icon="mdi-alert-circle-outline" size="18" />
        <span>WhatsApp не подключён — настройки сохранятся, но авто-напоминания начнут отправляться только после подключения.</span>
        <button class="bc-warn-btn" @click="goConnect"><v-icon icon="mdi-qrcode-scan" size="15" /> Подключить</button>
      </div>

      <div class="bc-auto-grid">
        <!-- Left: schedule settings -->
        <v-card rounded="lg" elevation="0" border class="pa-5">
          <div class="bc-card-head">
            <div class="bc-card-ico" style="background: rgba(37,211,102,0.1); color:#25d366;"><v-icon icon="mdi-clock-check-outline" size="20" /></div>
            <div class="bc-card-title">Автоматические напоминания</div>
            <v-switch v-model="waSettings.enabled" color="#25d366" hide-details density="compact" inset />
          </div>
          <div v-if="waSettings.enabled" class="bc-auto-body">
            <div class="bc-field">
              <div class="bc-field-label"><v-icon icon="mdi-calendar-alert" size="16" /> За сколько дней напоминать</div>
              <div class="bc-chips-row">
                <button v-for="d in daysOptions" :key="d" class="bc-chip" :class="{ 'bc-chip--active': waSettings.daysBefore === d }" @click="waSettings.daysBefore = d">{{ d }} {{ d === 1 ? 'день' : d < 5 ? 'дня' : 'дней' }}</button>
              </div>
            </div>
            <div class="bc-field">
              <div class="bc-field-label"><v-icon icon="mdi-clock-outline" size="16" /> Время отправки</div>
              <input v-model="waSettings.sendTime" type="time" class="bc-time-input" />
            </div>
            <div class="bc-toggle-row">
              <div>
                <div class="bc-field-label" style="margin-bottom:0;"><v-icon icon="mdi-alert-circle-outline" size="16" style="color:#ef4444;" /> Напоминать при просрочке</div>
                <div class="bc-field-hint">Уведомление, если платёж просрочен</div>
              </div>
              <v-switch v-model="waSettings.remindOverdue" color="#25d366" hide-details density="compact" inset />
            </div>
          </div>
          <div v-else class="bc-auto-off">Включите, чтобы напоминания отправлялись клиентам автоматически по расписанию.</div>

          <button class="bc-btn bc-btn--primary bc-save" :disabled="savingSettings" @click="saveWaSettings">
            <v-progress-circular v-if="savingSettings" indeterminate size="14" width="2" color="white" />
            <v-icon v-else icon="mdi-content-save-outline" size="16" />
            {{ savingSettings ? 'Сохранение…' : 'Сохранить настройки' }}
          </button>
        </v-card>

        <!-- Right: templates -->
        <v-card rounded="lg" elevation="0" border class="pa-5">
          <div class="bc-card-head">
            <div class="bc-card-ico" style="background: rgba(59,130,246,0.1); color:#3b82f6;"><v-icon icon="mdi-message-text-outline" size="20" /></div>
            <div class="bc-card-title">Шаблоны сообщений</div>
          </div>
          <p class="bc-tpl-intro">
            Текст, который получит клиент. Подставляйте переменные кнопками — при отправке они заменятся реальными данными.
          </p>

          <!-- ── Section: single payment ── -->
          <div class="bc-tpl-section">
            <div class="bc-tpl-section-head">
              <v-icon icon="mdi-numeric-1-circle-outline" size="17" />
              <div>
                <div class="bc-tpl-section-title">Один платёж</div>
                <div class="bc-tpl-section-sub">Авто-напоминания и ручные, когда у клиента ровно один платёж</div>
              </div>
            </div>

            <div class="bc-tpl-block bc-tpl-block--normal">
              <div class="bc-tpl-head">
                <v-icon icon="mdi-bell-outline" size="15" />
                <span class="bc-tpl-name">Обычное напоминание</span>
                <span class="bc-tag bc-tag--green">до срока оплаты</span>
              </div>
              <textarea ref="templateRef" v-model="waSettings.template" class="bc-tpl-area" rows="3" placeholder="Текст напоминания..." />
              <div class="bc-var-row"><span class="bc-var-label">Вставить:</span><button v-for="v in templateVars" :key="'t'+v" class="bc-var-chip" @click="insertVar('template', v)">{{ v }}</button></div>
              <div v-if="waSettings.template" class="bc-tpl-preview">
                <span class="bc-tpl-preview-label"><v-icon icon="mdi-eye-outline" size="12" /> Превью</span>
                <div class="bc-bubble"><div class="bc-bubble-text">{{ previewTemplate(waSettings.template) }}</div></div>
              </div>
            </div>

            <div class="bc-tpl-block bc-tpl-block--overdue">
              <div class="bc-tpl-head">
                <v-icon icon="mdi-alert-circle-outline" size="15" color="error" />
                <span class="bc-tpl-name">При просрочке</span>
                <span class="bc-tag bc-tag--red">срок прошёл</span>
              </div>
              <textarea ref="overdueTemplateRef" v-model="waSettings.overdueTemplate" class="bc-tpl-area" rows="3" placeholder="Текст для просроченных..." />
              <div class="bc-var-row"><span class="bc-var-label">Вставить:</span><button v-for="v in templateVars" :key="'o'+v" class="bc-var-chip" @click="insertVar('overdueTemplate', v)">{{ v }}</button></div>
              <div v-if="waSettings.overdueTemplate" class="bc-tpl-preview">
                <span class="bc-tpl-preview-label"><v-icon icon="mdi-eye-outline" size="12" /> Превью</span>
                <div class="bc-bubble bc-bubble--overdue"><div class="bc-bubble-text">{{ previewTemplate(waSettings.overdueTemplate) }}</div></div>
              </div>
            </div>
          </div>

          <!-- ── Section: multiple payments ── -->
          <div class="bc-tpl-section">
            <div class="bc-tpl-section-head">
              <v-icon icon="mdi-format-list-numbered" size="17" />
              <div>
                <div class="bc-tpl-section-title">Несколько платежей</div>
                <div class="bc-tpl-section-sub">Одно сводное сообщение на клиента по всем его платежам</div>
              </div>
            </div>

            <div class="bc-tpl-block bc-tpl-block--summary">
              <div class="bc-tpl-head">
                <v-icon icon="mdi-format-list-bulleted" size="15" />
                <span class="bc-tpl-name">Сводное напоминание</span>
                <span class="bc-tag bc-tag--blue">только ручная рассылка</span>
              </div>
              <textarea ref="summaryTemplateRef" v-model="waSettings.summaryTemplate" class="bc-tpl-area" rows="6" placeholder="Текст сводного напоминания..." />
              <div class="bc-var-row"><span class="bc-var-label">Вставить:</span><button v-for="v in summaryTemplateVars" :key="'s'+v" class="bc-var-chip" @click="insertVar('summaryTemplate', v)">{{ v }}</button></div>
              <div class="bc-var-legend">
                <div><code>{имя}</code> — имя клиента</div>
                <div><code>{просроченные}</code> — список просроченных платежей</div>
                <div><code>{ближайшие}</code> — список ближайших платежей</div>
                <div><code>{итого}</code> — общая сумма к оплате</div>
                <div><code>{телефон_строка}</code> — ваш телефон для подписи</div>
              </div>
              <div v-if="waSettings.summaryTemplate" class="bc-tpl-preview">
                <span class="bc-tpl-preview-label"><v-icon icon="mdi-eye-outline" size="12" /> Превью (2 просрочки + 1 ближайший)</span>
                <div class="bc-bubble"><div class="bc-bubble-text">{{ previewSummaryTemplate(waSettings.summaryTemplate) }}</div></div>
              </div>
            </div>
          </div>

          <button class="bc-btn bc-btn--primary bc-save" :disabled="savingSettings" @click="saveWaSettings">
            <v-progress-circular v-if="savingSettings" indeterminate size="14" width="2" color="white" />
            <v-icon v-else icon="mdi-content-save-outline" size="16" />
            {{ savingSettings ? 'Сохранение…' : 'Сохранить шаблоны' }}
          </button>
        </v-card>
      </div>
    </template>

    <!-- ══════════════ TAB: Подключение ══════════════ -->
    <template v-else>
      <v-card rounded="lg" elevation="0" border class="bc-card pa-6">
        <!-- Connected -->
        <div v-if="connected" class="bc-conn">
          <div class="bc-conn-banner">
            <div class="bc-conn-ico"><v-icon icon="mdi-whatsapp" size="28" /></div>
            <div class="bc-conn-info">
              <div class="bc-conn-title">WhatsApp подключён</div>
              <div class="bc-conn-desc">Напоминания и рассылки отправляются с вашего номера.</div>
            </div>
            <span class="bc-conn-badge">Активен</span>
          </div>
          <button class="bc-btn bc-btn--danger" @click="disconnect"><v-icon icon="mdi-link-off" size="16" /> Отключить</button>
        </div>

        <!-- Connecting (QR) -->
        <div v-else-if="waStatus === 'connecting'" class="bc-conn bc-conn--center">
          <div class="bc-conn-title">Отсканируйте QR-код</div>
          <div class="bc-conn-desc">Откройте WhatsApp → Связанные устройства → Привязать устройство</div>
          <div class="bc-qr-wrap">
            <img v-if="waQrCode" :src="waQrCode" class="bc-qr-img" alt="QR" />
            <template v-else>
              <v-progress-circular indeterminate size="40" color="primary" />
              <div class="bc-conn-desc mt-3">Загрузка QR-кода…</div>
            </template>
          </div>
          <div class="bc-conn-hint">Ожидание подключения, до 2 минут…</div>
          <button class="bc-btn bc-btn--ghost" @click="checkStatus(); waStatus = 'disconnected'; stopPolling()">Отмена</button>
        </div>

        <!-- Disconnected -->
        <div v-else class="bc-conn bc-conn--center">
          <div class="bc-conn-ico bc-conn-ico--lg"><v-icon icon="mdi-whatsapp" size="36" /></div>
          <div class="bc-conn-title">WhatsApp не подключён</div>
          <div class="bc-conn-desc">Подключите свой номер, чтобы отправлять клиентам напоминания о платежах — вручную и автоматически.</div>
          <button class="bc-btn bc-btn--primary" @click="connect"><v-icon icon="mdi-qrcode-scan" size="18" /> Подключить WhatsApp</button>
        </div>
      </v-card>
    </template>

    <!-- ══════════════ Анти-бан памятка ══════════════ -->
    <v-dialog v-model="showGuide" max-width="680" scrollable>
      <div class="bc-guide" :class="{ dark: isDark }">
        <div class="bc-guide-head">
          <div class="bc-guide-head-ico"><v-icon icon="mdi-shield-check-outline" size="22" /></div>
          <div class="bc-guide-head-text">
            <div class="bc-guide-title">Как не получить блокировку</div>
            <div class="bc-guide-subtitle">Блокировку накладывает сам WhatsApp — следуйте рекомендациям, чтобы её избежать</div>
          </div>
          <button class="bc-guide-close" @click="showGuide = false"><v-icon icon="mdi-close" size="18" /></button>
        </div>

        <div class="bc-guide-body">
          <div class="bc-guide-note">
            <v-icon icon="mdi-information-outline" size="16" />
            <span>Блокировку накладывает <b>WhatsApp</b> — повлиять на снятие напрямую мы не можем. Но риск можно сильно снизить, соблюдая рекомендации ниже.</span>
          </div>

          <div class="bc-guide-sec">
            <div class="bc-guide-sec-title"><v-icon icon="mdi-alert-outline" size="16" /> Что повышает риск</div>
            <ul class="bc-guide-list">
              <li>Признаки автоматизации — отправка без задержек, интервал меньше 0,5 секунды.</li>
              <li>Жалобы от получателей.</li>
              <li>Низкий коэффициент ответов (много отправлено, мало получено в ответ).</li>
              <li>Массовая рассылка одинакового текста незнакомым людям.</li>
              <li>Виртуальные номера и частые проверки номеров на наличие WhatsApp.</li>
            </ul>
          </div>

          <div class="bc-guide-sec">
            <div class="bc-guide-sec-title"><v-icon icon="mdi-speedometer" size="16" /> Безопасные лимиты рассылки</div>
            <ul class="bc-guide-list">
              <li>Интервал между сообщениями — <b>не меньше 15 секунд</b>; одному получателю — не чаще 1 сообщения в минуту.</li>
              <li>Не больше <b>200 получателей в день</b> на один номер. Большие списки — распределяйте по нескольким номерам.</li>
              <li>Не больше <b>8 часов</b> рассылки в день и не больше <b>3 дней подряд</b>.</li>
              <li>После 3 дней — <b>пауза 14 дней</b>, в это время только отвечайте на входящие.</li>
              <li>Держите коэффициент ответов <b>не ниже 50%</b> (получено / отправлено).</li>
            </ul>
          </div>

          <div class="bc-guide-sec">
            <div class="bc-guide-sec-title"><v-icon icon="mdi-account-check-outline" size="16" /> Кому и как писать</div>
            <ul class="bc-guide-list">
              <li>Пишите <b>только тем, кто добавил ваш номер в контакты</b> и ждёт сообщений.</li>
              <li>Перед рассылкой начните диалог сами, задайте вопрос, попросите добавить вас в контакты.</li>
              <li><b>Персонализируйте</b> (имя клиента), пишите короткие сообщения, избегайте одинакового текста.</li>
              <li>Добавляйте возможность отписаться: «Напишите “стоп”, чтобы не получать напоминания».</li>
            </ul>
          </div>

          <div class="bc-guide-sec">
            <div class="bc-guide-sec-title"><v-icon icon="mdi-fire" size="16" /> Прогрев нового / разблокированного номера (≥ 10 дней)</div>
            <ol class="bc-guide-list bc-guide-list--num">
              <li>1-й день после регистрации/разблокировки — <b>не привязывайте</b> инстанс (выждите 24 часа).</li>
              <li>2-й день — авторизуйте инстанс, но <b>не отправляйте</b> сообщения.</li>
              <li>С 3-го дня — прогрев: вам пишут люди с других аккаунтов, каждые ~2 часа по сообщению (3 дня).</li>
              <li>Затем номер начинает отвечать — тоже по сообщению каждые ~2 часа (на контакты).</li>
              <li>В течение 7 дней постепенно наращивайте поток с 12 до 100 сообщений в день.</li>
              <li>После 10 дней номер заметно устойчивее. Полный «зелёный свет» — обычно через 25–30 дней без подозрительной активности.</li>
            </ol>
            <div class="bc-guide-hint">Уже прогретый номер ждать сутки не нужно. Новый — прогревать обязательно.</div>
          </div>

          <div class="bc-guide-sec">
            <div class="bc-guide-sec-title"><v-icon icon="mdi-check-circle-outline" size="16" /> Чего избегать</div>
            <ul class="bc-guide-list">
              <li>Не отправляйте «залпом» — задержка между сообщениями уже включена, не отключайте её.</li>
              <li>Не подключайте номер к веб-/десктоп-версии WhatsApp во время прогрева — даже без отправки это может привести к блокировке.</li>
              <li>Не бросайте номер надолго: без сообщений ~14 дней прогрев «уходит» и риск растёт.</li>
              <li>При смене условий (переустановка, перенос на другой телефон) прогрев начинают заново.</li>
              <li>Если инстанс часто разлогинивается — относитесь к номеру как к новому: 24 часа паузы и прогрев заново.</li>
              <li>Используйте реальный телефон, а не виртуальный номер.</li>
            </ul>
          </div>

          <div class="bc-guide-sec">
            <div class="bc-guide-sec-title"><v-icon icon="mdi-lock-open-alert-outline" size="16" /> Если номер заблокировали</div>
            <ul class="bc-guide-list">
              <li>В приложении WhatsApp (или WhatsApp Business) нажмите <b>«Запросить проверку»</b>; если вышли из аккаунта — меню → «Помощь» → опишите ситуацию. Альтернатива — форма обращения на сайте WhatsApp.</li>
              <li>В обращении укажите, что номер используется для <b>легального делового общения</b> с клиентами.</li>
              <li>Подайте <b>только одну заявку</b> и ждите ~24 часа: придёт два письма — о получении и с решением.</li>
              <li>При отказе повторно обращайтесь <b>не раньше чем через месяц</b>. Между повторными блокировками делайте паузу в несколько дней.</li>
            </ul>
          </div>

          <div class="bc-guide-sec">
            <div class="bc-guide-sec-title"><v-icon icon="mdi-reload-alert" size="16" /> Почему блокируют повторно</div>
            <ul class="bc-guide-list">
              <li>После блокировки инстанс попадает в «подозрительные» — <b>создайте новый инстанс</b> (переподключитесь заново в разделе «Подключение»).</li>
              <li>Номер тоже мог попасть в подозрительные — <b>прогрейте его заново</b>.</li>
              <li>Блокировка по устройству (IMEI) — риск остаётся даже после прогрева; помогает только смена телефона.</li>
              <li>Виртуальные номера повторно блокируются чаще — используйте физический телефон.</li>
            </ul>
          </div>
        </div>
      </div>
    </v-dialog>
  </div>
</template>

<style scoped>
.bc-page { max-width: 1440px; margin: 0 auto; padding: 24px; }

/* Header */
.bc-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.bc-title { font-size: 28px; font-weight: 800; color: #111; letter-spacing: -0.5px; }
.bc-subtitle { font-size: 14px; color: #737373; margin-top: 6px; }
.bc-page.dark .bc-title { color: #f5f5f5; }
.bc-page.dark .bc-subtitle { color: #a3a3a3; }
.bc-header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bc-guide-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14); background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.75); font-size: 12px; font-weight: 600;
  white-space: nowrap; transition: all 0.15s;
}
.bc-guide-btn:hover { border-color: rgba(4,120,87,0.4); color: #047857; background: rgba(4,120,87,0.05); }
.bc-conn-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.bc-conn-chip--on { background: rgba(37,211,102,0.12); color: #1eb558; }
.bc-conn-chip--off { background: rgba(245,158,11,0.12); color: #b45309; }

/* Tabs — white segmented bar */
.bc-tabs {
  display: flex; gap: 4px; margin-bottom: 18px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 12px; padding: 5px;
}
.bc-tab {
  position: relative; display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px; border: none; background: transparent; cursor: pointer;
  font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.55);
  border-radius: 8px; transition: all 0.15s;
}
.bc-tab:hover { color: rgba(var(--v-theme-on-surface), 0.85); background: rgba(var(--v-theme-on-surface), 0.04); }
.bc-tab.active { color: #047857; background: rgba(4, 120, 87, 0.1); }
.bc-tab.active:hover { background: rgba(4, 120, 87, 0.12); }
.bc-tab-dot { width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; }

/* Campaign progress */
.bc-prog-card { margin-bottom: 14px; }
.bc-prog-card--running { border-color: rgba(37, 211, 102, 0.4); box-shadow: 0 0 0 3px rgba(37, 211, 102, 0.06); }
.bc-prog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 16px 18px 12px; }
.bc-prog-title { display: flex; align-items: center; gap: 7px; font-size: 16px; font-weight: 800; color: rgb(var(--v-theme-on-surface)); }
.bc-prog-live { width: 9px; height: 9px; border-radius: 50%; background: #25d366; box-shadow: 0 0 0 0 rgba(37,211,102,0.6); animation: bc-pulse 1.6s infinite; }
@keyframes bc-pulse { 0% { box-shadow: 0 0 0 0 rgba(37,211,102,0.5); } 70% { box-shadow: 0 0 0 7px rgba(37,211,102,0); } 100% { box-shadow: 0 0 0 0 rgba(37,211,102,0); } }
.bc-prog-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 2px; }
.bc-prog-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.bc-prog-warn { margin: 0 18px 12px; }
.bc-warn--info { background: rgba(59,130,246,0.1); color: #2563eb; border-color: rgba(59,130,246,0.25); }

/* "How MizanPay protects your number" collapsible card */
.bc-protect { margin-bottom: 14px; border: 1px solid rgba(4,120,87,0.2); border-radius: 12px; background: rgba(4,120,87,0.04); overflow: hidden; }
.bc-protect-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px 16px; border: none; background: transparent; cursor: pointer; font-size: 13.5px; font-weight: 700; color: #047857; text-align: left; }
.bc-protect-chev { transition: transform 0.2s; color: #047857; }
.bc-protect-chev.open { transform: rotate(180deg); }
.bc-protect-body { padding: 0 16px 14px; }
.bc-protect-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.bc-protect-list li { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.5; color: rgba(var(--v-theme-on-surface), 0.8); }
.bc-protect-list li .v-icon { color: #047857; margin-top: 1px; flex-shrink: 0; }
.bc-protect-note { margin-top: 12px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); line-height: 1.5; }
.bc-prog-bar { display: flex; height: 8px; margin: 0 18px; border-radius: 999px; overflow: hidden; background: rgba(var(--v-theme-on-surface), 0.08); }
.bc-prog-fill { height: 100%; transition: width 0.4s; }
.bc-prog-fill--sent { background: #25d366; }
.bc-prog-fill--failed { background: #ef4444; }
.bc-prog-legend { display: flex; flex-wrap: wrap; gap: 14px; padding: 10px 18px 4px; font-size: 12px; }
.bc-prog-leg { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }
.bc-prog-leg--sent { color: #1eb558; }
.bc-prog-leg--failed { color: #dc2626; }
.bc-prog-leg--pending { color: rgba(var(--v-theme-on-surface), 0.5); }
.bc-prog-list { padding: 8px 12px 12px; display: flex; flex-direction: column; }
.bc-prog-row { display: flex; align-items: center; gap: 10px; padding: 9px 6px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06); }
.bc-prog-row:last-child { border-bottom: none; }
.bc-prog-st { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
.bc-prog-st--sent { background: #25d366; }
.bc-prog-st--failed { background: #ef4444; }
.bc-prog-st--sending { background: #3b82f6; }
.bc-prog-st--pending { background: rgba(var(--v-theme-on-surface), 0.25); }
.bc-prog-row-main { flex: 1; min-width: 0; }
.bc-prog-name { font-size: 13px; font-weight: 600; color: rgb(var(--v-theme-on-surface)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bc-prog-meta { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bc-prog-badge { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; white-space: nowrap; flex-shrink: 0; }
.bc-prog-badge--sent { background: rgba(37,211,102,0.14); color: #1eb558; }
.bc-prog-badge--failed { background: rgba(239,68,68,0.12); color: #dc2626; }
.bc-prog-badge--sending { background: rgba(59,130,246,0.12); color: #2563eb; }
.bc-prog-badge--pending { background: rgba(var(--v-theme-on-surface), 0.07); color: rgba(var(--v-theme-on-surface), 0.5); }

/* Not-connected warning banner */
.bc-warn {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; margin-bottom: 14px;
  background: rgba(245, 158, 11, 0.1); color: #b45309;
  border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 12px;
  font-size: 13px; font-weight: 500;
}
.bc-warn span { flex: 1; min-width: 0; }
.bc-warn-btn {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
  padding: 7px 12px; border-radius: 8px; border: none;
  background: #25d366; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer;
}
.bc-warn-btn:hover { background: #1eb558; }

.bc-card { overflow: hidden; }

/* Anti-ban guide modal */
.bc-guide { background: rgb(var(--v-theme-surface)); border-radius: 16px; overflow: hidden; }
.bc-guide-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 14px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
.bc-guide-head-ico { width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: rgba(4,120,87,0.1); color: #047857; }
.bc-guide-head-text { flex: 1; min-width: 0; }
.bc-guide-title { font-size: 17px; font-weight: 800; color: rgb(var(--v-theme-on-surface)); }
.bc-guide-subtitle { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 3px; line-height: 1.45; }
.bc-guide-close { width: 32px; height: 32px; border-radius: 9px; border: none; flex-shrink: 0; background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.bc-guide-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.bc-guide-body { padding: 16px 20px 20px; max-height: 64vh; overflow-y: auto; }
.bc-guide-note { display: flex; gap: 8px; align-items: flex-start; padding: 11px 13px; border-radius: 10px; background: rgba(245,158,11,0.1); color: #b45309; font-size: 12.5px; line-height: 1.5; margin-bottom: 18px; }
.bc-guide-note b { font-weight: 700; }
.bc-guide-sec { margin-bottom: 18px; }
.bc-guide-sec:last-child { margin-bottom: 0; }
.bc-guide-sec-title { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 800; color: rgb(var(--v-theme-on-surface)); margin-bottom: 8px; }
.bc-guide-sec-title .v-icon { color: #047857; }
.bc-guide-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 5px; font-size: 13px; line-height: 1.5; color: rgba(var(--v-theme-on-surface), 0.8); }
.bc-guide-list--num { list-style: none; padding-left: 0; }
.bc-guide-list b { font-weight: 700; color: rgb(var(--v-theme-on-surface)); }
.bc-guide-hint { margin-top: 8px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); font-style: italic; }
.bc-guide-links { display: flex; flex-direction: column; gap: 7px; }
.bc-guide-links a { display: inline-flex; align-items: center; font-size: 13px; font-weight: 600; color: #047857; text-decoration: none; }
.bc-guide-links a::before { content: '→'; margin-right: 7px; opacity: 0.6; }
.bc-guide-links a:hover { text-decoration: underline; }

/* Locked / empty state */
.bc-locked { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 64px 20px; text-align: center; color: rgba(var(--v-theme-on-surface), 0.5); }
.bc-locked-title { font-size: 17px; font-weight: 800; color: rgb(var(--v-theme-on-surface)); }
.bc-locked-sub { font-size: 13px; max-width: 420px; margin-bottom: 8px; }

/* Buttons */
.bc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 18px; border-radius: 8px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.bc-btn--primary { background: #25d366; color: #fff; }
.bc-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.bc-btn--primary:not(:disabled):hover { background: #1eb558; }
.bc-btn--ghost { background: transparent; color: rgba(var(--v-theme-on-surface), 0.7); }
.bc-btn--ghost:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.06); }
.bc-btn--ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.bc-btn--danger { background: rgba(239,68,68,0.1); color: #dc2626; }
.bc-btn--danger:hover { background: rgba(239,68,68,0.16); }

/* Filters / summary / list — reminder builder */
.bc-filters { display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: center; padding: 16px 20px; border-bottom: 1px solid rgba(0,0,0,0.06); }
.bc-page.dark .bc-filters { border-bottom-color: rgba(255,255,255,0.08); }
.bc-days { display: flex; align-items: center; gap: 8px; }
.bc-days-label { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.6); white-space: nowrap; }
.bc-days-unit { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.45); }
/* Segmented control for the day window */
.bc-seg { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.05); }
.bc-seg-btn { min-width: 34px; padding: 6px 10px; border: none; background: transparent; border-radius: 7px; font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; transition: all 0.15s; }
.bc-seg-btn:hover { color: rgba(var(--v-theme-on-surface), 0.9); }
.bc-seg-btn.active { background: rgb(var(--v-theme-surface)); color: #047857; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
.bc-page.dark .bc-seg-btn.active { background: rgba(255,255,255,0.14); color: #34d399; }

.bc-search-row { display: flex; flex-wrap: wrap; gap: 10px; flex: 1; min-width: 280px; align-items: stretch; }
.bc-send-btn { flex-shrink: 0; white-space: nowrap; box-shadow: 0 2px 8px rgba(37,211,102,0.3); }
.bc-send-btn:disabled { box-shadow: none; }
.bc-search-wrap { position: relative; display: flex; align-items: center; gap: 6px; flex: 1; min-width: 200px; border: 1px solid rgba(var(--v-theme-on-surface), 0.14); border-radius: 10px; padding: 0 12px; background: rgba(var(--v-theme-on-surface), 0.02); transition: border-color 0.15s, background 0.15s; }
.bc-search-wrap:focus-within { border-color: rgba(4,120,87,0.5); background: transparent; }
.bc-search-icon { color: rgba(var(--v-theme-on-surface), 0.4); flex-shrink: 0; }
.bc-search { flex: 1; min-width: 0; border: none; outline: none; padding: 9px 0; font-size: 13px; background: transparent; color: rgb(var(--v-theme-on-surface)); }
.bc-search-clear { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; border: none; background: rgba(var(--v-theme-on-surface), 0.1); color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; flex-shrink: 0; }
.bc-search-clear:hover { background: rgba(var(--v-theme-on-surface), 0.18); }

.bc-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 20px; background: rgba(var(--v-theme-on-surface), 0.02); font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.65); }
.bc-summary-item { display: inline-flex; align-items: center; gap: 4px; }
.bc-summary-item--ok strong { color: #047857; }
.bc-page.dark .bc-summary-item--ok strong { color: #34d399; }
.bc-summary-item--warn { color: #b45309; }
.bc-summary-sep { color: rgba(var(--v-theme-on-surface), 0.3); }

.bc-list-head { display: flex; align-items: center; gap: 10px; padding: 10px 20px; background: rgba(var(--v-theme-on-surface), 0.02); border-bottom: 1px solid rgba(0,0,0,0.06); font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); }
.bc-page.dark .bc-list-head { border-bottom-color: rgba(255,255,255,0.08); }
.bc-list-head-label { font-weight: 600; cursor: pointer; }
.bc-list-head-hint { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45); }
.bc-head-action {
  display: inline-flex; align-items: center; gap: 5px;
  border: none; background: transparent; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #047857; padding: 2px;
}
.bc-head-action:hover { text-decoration: underline; }
.bc-head-sep { color: rgba(var(--v-theme-on-surface), 0.3); }
/* Custom checkboxes — branded box with a drawn checkmark */
.bc-check { display: inline-flex; }
.bc-check input {
  appearance: none; -webkit-appearance: none; margin: 0;
  width: 20px; height: 20px; border-radius: 6px;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.25);
  background: rgb(var(--v-theme-surface));
  cursor: pointer; position: relative; flex-shrink: 0;
  transition: background 0.15s, border-color 0.15s;
}
.bc-check input:hover:not(:disabled) { border-color: rgba(4,120,87,0.55); }
.bc-check input:checked { background: #047857; border-color: #047857; }
.bc-check input:checked::after {
  content: ''; position: absolute; left: 6px; top: 2px;
  width: 4px; height: 9px; border: solid #fff; border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.bc-check input:disabled { opacity: 0.4; cursor: not-allowed; }

/* Per-client message preview inside the expanded card */
.bc-preview { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
.bc-preview-label { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: #1eb558; margin-bottom: 8px; }
.bc-bubble-text { /* inherits bubble */ }

.bc-list { padding: 8px 12px; }
.bc-list.loading { opacity: 0.5; pointer-events: none; }
.bc-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center; }
.bc-empty-title { font-size: 14px; font-weight: 600; margin-top: 8px; }
.bc-empty-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 4px; }

.bc-group { border: 1px solid rgba(var(--v-theme-on-surface), 0.08); border-radius: 12px; margin-bottom: 6px; transition: border-color 0.15s, background 0.15s; }
.bc-group:hover { border-color: rgba(var(--v-theme-on-surface), 0.16); }
.bc-group--disabled { opacity: 0.6; }
.bc-group--selected { border-color: rgba(4,120,87,0.35); background: rgba(4,120,87,0.025); }
.bc-group-head { display: flex; align-items: center; gap: 12px; padding: 12px 14px; cursor: pointer; }
.bc-group-avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.6); font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.bc-group-avatar--overdue { background: rgba(239,68,68,0.12); color: #dc2626; }
.bc-group-main { flex: 1; min-width: 0; }
.bc-group-name { font-size: 14px; font-weight: 600; color: rgb(var(--v-theme-on-surface)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bc-group-sub { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 2px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.bc-dot { opacity: 0.4; }
.bc-no-phone { display: inline-flex; align-items: center; gap: 3px; color: #b45309; }
.bc-sub-overdue { color: #dc2626; font-weight: 600; }
.bc-sub-sent { display: inline-flex; align-items: center; gap: 3px; color: #1eb558; font-weight: 600; }
.bc-group-right { text-align: right; flex-shrink: 0; }
.bc-group-amount { font-size: 14px; font-weight: 700; color: rgb(var(--v-theme-on-surface)); white-space: nowrap; }
.bc-group-partial { font-size: 10.5px; color: #4338ca; margin-top: 1px; white-space: nowrap; }
.bc-group-chev { color: rgba(var(--v-theme-on-surface), 0.35); flex-shrink: 0; transition: transform 0.2s; }
.bc-group-chev.open { transform: rotate(180deg); }
/* Expanded body */
.bc-group-body { padding: 10px 14px 14px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
.bc-check--small input { width: 18px; height: 18px; border-radius: 5px; }
.bc-check--small input:checked::after { left: 5px; top: 2px; width: 4px; height: 8px; }

/* Body toolbar */
.bc-body-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.bc-body-bar-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(var(--v-theme-on-surface), 0.4); }
.bc-link-btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: none; background: transparent; padding: 2px; cursor: pointer;
  color: #047857; font-size: 12px; font-weight: 600;
}
.bc-link-btn:hover { text-decoration: underline; }

/* Payment rows — flat, divided */
.bc-pay-list { display: flex; flex-direction: column; }
.bc-pay {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 2px; cursor: pointer;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.bc-pay:last-child { border-bottom: none; }
.bc-pay--excluded { opacity: 0.45; }
.bc-pay--excluded .bc-pay-deal, .bc-pay--excluded .bc-pay-amount { text-decoration: line-through; }
.bc-pay-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.bc-pay-dot--overdue { background: #ef4444; }
.bc-pay-dot--upcoming { background: #f59e0b; }
.bc-pay-deal {
  flex: 1; min-width: 0;
  display: inline-flex; align-items: center; gap: 4px;
  border: none; background: transparent; padding: 0; cursor: pointer;
  font: inherit; font-size: 13px; text-align: left;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bc-pay-deal:hover { color: #047857; text-decoration: underline; }
.bc-pay-dealnum { color: rgba(var(--v-theme-on-surface), 0.35); font-family: ui-monospace, monospace; margin-right: 4px; }
.bc-pay-deal-ico { flex-shrink: 0; opacity: 0; transition: opacity 0.15s; }
.bc-pay-deal:hover .bc-pay-deal-ico { opacity: 0.6; }
.bc-pay-due { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); font-family: ui-monospace, monospace; white-space: nowrap; flex-shrink: 0; }
.bc-pay-due--overdue { color: #dc2626; }
.bc-pay-sent { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 600; color: #1eb558; white-space: nowrap; flex-shrink: 0; }
.bc-pay-amount { font-size: 13px; font-weight: 600; white-space: nowrap; flex-shrink: 0; color: rgb(var(--v-theme-on-surface)); }

.bc-footer { display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-top: 1px solid rgba(0,0,0,0.06); }
.bc-page.dark .bc-footer { border-top-color: rgba(255,255,255,0.08); }

/* Auto-reminders */
.bc-auto-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; align-items: start; }
.bc-card-head { display: flex; align-items: center; gap: 12px; }
.bc-card-ico { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.bc-card-title { font-size: 15px; font-weight: 700; flex: 1; }
.bc-card-hint { font-size: 11px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.45); margin-left: 6px; }
.bc-auto-body { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
.bc-auto-off { margin-top: 14px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }
.bc-field-label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; margin-bottom: 8px; color: rgba(var(--v-theme-on-surface), 0.8); }
.bc-field-hint { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45); }
.bc-chips-row { display: flex; flex-wrap: wrap; gap: 6px; }
.bc-chip { padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: transparent; color: rgba(var(--v-theme-on-surface), 0.8); font-size: 12px; cursor: pointer; }
.bc-chip--active { background: #047857; color: #fff; border-color: #047857; }
.bc-time-input { border: 1px solid rgba(var(--v-theme-on-surface), 0.12); border-radius: 8px; padding: 8px 12px; font-size: 13px; background: transparent; color: rgb(var(--v-theme-on-surface)); }
.bc-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.bc-save { width: 100%; margin-top: 18px; }

.bc-tpl-intro { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); margin: 8px 0 18px; line-height: 1.5; }

/* Template section (groups single-payment vs multi-payment) */
.bc-tpl-section { margin-bottom: 22px; }
.bc-tpl-section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: rgba(var(--v-theme-on-surface), 0.85); }
.bc-tpl-section-head > .v-icon { color: #3b82f6; flex-shrink: 0; }
.bc-tpl-section-title { font-size: 13.5px; font-weight: 800; }
.bc-tpl-section-sub { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }

/* One template block — bordered card with a colored accent by type */
.bc-tpl-block {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-left-width: 3px;
  border-radius: 10px; padding: 12px 14px; margin-bottom: 12px;
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.bc-tpl-block--normal { border-left-color: #25d366; }
.bc-tpl-block--overdue { border-left-color: #ef4444; }
.bc-tpl-block--summary { border-left-color: #3b82f6; }
.bc-tpl-head { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.bc-tpl-name { font-size: 13px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.bc-tag { margin-left: auto; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.bc-tag--green { background: rgba(37,211,102,0.14); color: #1eb558; }
.bc-tag--red { background: rgba(239,68,68,0.12); color: #dc2626; }
.bc-tag--blue { background: rgba(59,130,246,0.12); color: #2563eb; }

.bc-tpl-area { width: 100%; border: 1px solid rgba(var(--v-theme-on-surface), 0.14); border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.5; background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface)); resize: vertical; font-family: inherit; }
.bc-tpl-area:focus { outline: none; border-color: rgba(4,120,87,0.5); }

.bc-var-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }

/* Variable legend (summary block) */
.bc-var-legend { display: flex; flex-direction: column; gap: 3px; margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: rgba(var(--v-theme-on-surface), 0.03); font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.6); }
.bc-var-legend code { font-family: ui-monospace, monospace; color: #2563eb; background: rgba(59,130,246,0.1); padding: 1px 5px; border-radius: 4px; margin-right: 4px; }

/* Template preview */
.bc-tpl-preview { margin-top: 10px; }
.bc-tpl-preview-label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 6px; }
.bc-var-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45); }
.bc-var-chip { padding: 3px 8px; border-radius: 6px; border: 1px dashed rgba(var(--v-theme-on-surface), 0.2); background: transparent; font-size: 11px; cursor: pointer; color: rgba(var(--v-theme-on-surface), 0.7); font-family: ui-monospace, monospace; }
.bc-var-chip:hover { border-color: rgba(4,120,87,0.5); color: #047857; }
.bc-bubble { margin-top: 10px; background: #dcf8c6; color: #111; border-radius: 10px 10px 10px 2px; padding: 10px 12px; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; max-width: 460px; }
.bc-bubble--overdue { background: #ffe0e0; }
.bc-page.dark .bc-bubble { background: #075e54; color: #e9ffe3; }
.bc-page.dark .bc-bubble--overdue { background: #7f1d1d; color: #ffe0e0; }

/* Connection tab */
.bc-conn { display: flex; flex-direction: column; gap: 16px; }
.bc-conn--center { align-items: center; text-align: center; padding: 24px 12px; }
.bc-conn-banner { display: flex; align-items: center; gap: 14px; padding: 16px; border-radius: 12px; background: rgba(37,211,102,0.08); }
.bc-conn-ico { width: 52px; height: 52px; border-radius: 14px; background: rgba(37,211,102,0.15); color: #1eb558; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.bc-conn-ico--lg { width: 64px; height: 64px; }
.bc-conn-info { flex: 1; min-width: 0; }
.bc-conn-title { font-size: 17px; font-weight: 800; color: rgb(var(--v-theme-on-surface)); }
.bc-conn-desc { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 4px; max-width: 460px; }
.bc-conn-badge { padding: 5px 12px; border-radius: 999px; background: #25d366; color: #fff; font-size: 12px; font-weight: 700; }
.bc-conn-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.bc-qr-wrap { width: 260px; height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid rgba(var(--v-theme-on-surface), 0.1); border-radius: 16px; padding: 12px; background: #fff; }
.bc-qr-img { width: 100%; height: 100%; }

@media (max-width: 860px) {
  .bc-auto-grid { grid-template-columns: 1fr; }
}
@media (max-width: 599px) {
  .bc-page { padding: 16px 12px; }
  .bc-title { font-size: 22px; }
  .bc-pay-due { display: none; }
}
</style>
