<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRouteSheetsStore, type RouteSheetDetail, type RouteSheetLine, type RouteSheetLineStatus } from '@/stores/routeSheets'
import { useAuthStore } from '@/stores/auth'
import { usePageHeaderStore } from '@/stores/pageHeader'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDateShort } from '@/utils/formatters'
import { generateRouteSheetPdf } from '@/utils/routeSheetPdf'
import RouteSheetFormDialog from '@/components/RouteSheetFormDialog.vue'

const route = useRoute()
const router = useRouter()
const store = useRouteSheetsStore()
const auth = useAuthStore()
const pageHeader = usePageHeaderStore()
const { isDark } = useIsDark()
const toast = useToast()

const id = computed(() => (route.params as Record<string, string>).id)
const canManage = computed(() => auth.can('suppliers.routesheet'))

const sheet = ref<RouteSheetDetail | null>(null)
const loading = ref(true)
const busyLine = ref<string | null>(null)
const editOpen = ref(false)

const statusMeta: Record<string, { label: string; cls: string }> = {
  ISSUED: { label: 'В работе', cls: 'st-issued' },
  COMPLETED: { label: 'Завершён', cls: 'st-done' },
  CANCELLED: { label: 'Отменён', cls: 'st-canc' },
}
const lineMeta: Record<RouteSheetLineStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Ожидает', cls: 'lm-pending' },
  PAID: { label: 'Оплачено', cls: 'lm-paid' },
  SKIPPED: { label: 'Пропущено', cls: 'lm-skip' },
}

const totalPlanned = computed(() => sheet.value?.lines.reduce((s, l) => s + l.amountPlanned, 0) ?? 0)
const totalDebt = computed(() => sheet.value?.lines.reduce((s, l) => s + l.debtTotal, 0) ?? 0)
const totalPaid = computed(() => sheet.value?.lines.reduce((s, l) => s + (l.amountPaid ?? 0), 0) ?? 0)
// Сколько реально можно собрать сейчас (учитывая прямые погашения со страницы партнёра).
function lineDueNow(l: RouteSheetLine): number {
  return l.debts.reduce((s, d) => s + Math.min(d.amountPlanned, Math.max(0, d.remaining)), 0)
}
// Текущий остаток долга по строке (сумма остатков включённых сделок).
function lineRemaining(l: RouteSheetLine): number {
  return l.debts.reduce((s, d) => s + Math.max(0, d.remaining), 0)
}
const isCancelled = computed(() => sheet.value?.status === 'CANCELLED')
const hasPaidLines = computed(() => sheet.value?.lines.some((l) => l.status === 'PAID') ?? false)

// Заголовок листа выносим в верхний бар (не дублируем в контенте).
watch(sheet, (s) => {
  if (!s) return
  const st = statusMeta[s.status]?.label ?? ''
  const dt = formatDateShort(new Date(s.date).toISOString())
  const staff = s.assignedStaffName || 'Без ответственного'
  pageHeader.set(`Путевой лист №${s.number}`, `${st} · ${dt} · ${staff}`)
})
onBeforeUnmount(() => pageHeader.clear())

async function load() {
  loading.value = true
  try {
    sheet.value = await store.getOne(id.value)
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить')
  } finally {
    loading.value = false
  }
}

async function payLine(l: RouteSheetLine, allowPartial = false) {
  busyLine.value = l.id
  try {
    sheet.value = await store.payLine(id.value, l.id, { allowPartial })
    toast.success('Оплата отмечена')
  } catch (e: any) {
    const msg = e?.message || 'Не удалось отметить'
    // Часть/всё уже погашено вне листа — просим подтвердить (частичная оплата или закрытие строки).
    if (!allowPartial && /подтвердите/i.test(msg)) {
      busyLine.value = null
      if (confirm(msg)) return payLine(l, true)
      return
    }
    toast.error(msg)
  } finally {
    busyLine.value = null
  }
}
async function skipLine(l: RouteSheetLine) {
  busyLine.value = l.id
  try {
    sheet.value = await store.skipLine(id.value, l.id)
  } catch (e: any) {
    toast.error(e?.message || 'Ошибка')
  } finally {
    busyLine.value = null
  }
}
async function revertLine(l: RouteSheetLine) {
  busyLine.value = l.id
  try {
    sheet.value = await store.revertLine(id.value, l.id)
  } catch (e: any) {
    toast.error(e?.message || 'Ошибка')
  } finally {
    busyLine.value = null
  }
}

async function cancelSheet() {
  if (!confirm('Отменить путевой лист?')) return
  try {
    sheet.value = await store.cancel(id.value)
    toast.success('Путевой лист отменён')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отменить')
  }
}
async function removeSheet() {
  if (!confirm('Удалить путевой лист?')) return
  try {
    await store.remove(id.value)
    toast.success('Удалён')
    router.push('/suppliers?tab=routesheets')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось удалить')
  }
}

function downloadPdf() {
  if (!sheet.value) return
  generateRouteSheetPdf(sheet.value, auth.userName || 'MizanPay')
}

onMounted(load)
</script>

<template>
  <div class="at-page rsd-page" :class="{ dark: isDark }">
    <div v-if="loading" class="d-flex justify-center pa-12"><v-progress-circular indeterminate color="primary" size="40" /></div>

    <template v-else-if="sheet">
      <!-- Панель действий -->
      <div class="rsd-bar">
        <button class="rsd-back" @click="router.push('/suppliers?tab=routesheets')"><v-icon icon="mdi-arrow-left" size="18" /> К путевым листам</button>
        <v-menu location="bottom end" :close-on-content-click="true">
          <template #activator="{ props }">
            <button class="rsd-actions-btn" v-bind="props">
              <span>Действия</span>
              <v-icon icon="mdi-chevron-down" size="18" />
            </button>
          </template>
          <div class="rsd-menu">
            <button v-if="canManage" class="rsd-menu-item" @click="editOpen = true"><v-icon icon="mdi-pencil-outline" size="17" /> Изменить</button>
            <button class="rsd-menu-item" @click="downloadPdf"><v-icon icon="mdi-file-pdf-box" size="17" /> Скачать PDF</button>
            <template v-if="canManage && !isCancelled && !hasPaidLines">
              <div class="rsd-menu-divider" />
              <button class="rsd-menu-item rsd-menu-item--warn" @click="cancelSheet"><v-icon icon="mdi-close-circle-outline" size="17" /> Отменить лист</button>
            </template>
            <template v-if="canManage && (isCancelled || !hasPaidLines)">
              <div v-if="!(canManage && !isCancelled && !hasPaidLines)" class="rsd-menu-divider" />
              <button class="rsd-menu-item rsd-menu-item--del" @click="removeSheet"><v-icon icon="mdi-delete-outline" size="17" /> Удалить</button>
            </template>
          </div>
        </v-menu>
      </div>

      <!-- Показатели -->
      <div class="rsd-stats">
        <div class="rsd-stat"><div class="rsd-stat-v">{{ formatCurrency(totalDebt) }}</div><div class="rsd-stat-l">Полный долг</div></div>
        <div class="rsd-stat"><div class="rsd-stat-v" style="color:#3b82f6;">{{ formatCurrency(totalPlanned) }}</div><div class="rsd-stat-l">Запланировано к оплате</div></div>
        <div class="rsd-stat"><div class="rsd-stat-v" style="color:#047857;">{{ formatCurrency(totalPaid) }}</div><div class="rsd-stat-l">Оплачено</div></div>
        <div class="rsd-stat"><div class="rsd-stat-v">{{ sheet.lines.filter(l => l.status === 'PAID').length }}/{{ sheet.lines.length }}</div><div class="rsd-stat-l">Строк оплачено</div></div>
      </div>

      <div v-if="sheet.note" class="rsd-desc">
        <div class="rsd-desc-title"><v-icon icon="mdi-note-text-outline" size="15" /> Описание</div>
        <div class="rsd-desc-text">{{ sheet.note }}</div>
      </div>

      <!-- Строки листа: карточка на поставщика -->
      <div class="rsd-title-row">Поставщики к объезду</div>
      <div class="rsd-lines">
        <div v-for="l in sheet.lines" :key="l.id" class="rl" :class="{ 'rl--done': l.status === 'PAID', 'rl--skip': l.status === 'SKIPPED' }">
          <!-- Шапка строки -->
          <div class="rl-head">
            <div class="rl-head-main">
              <div class="rl-supplier">{{ l.supplierName }}</div>
              <div v-if="l.supplierPhone || l.supplierAddress" class="rl-contacts">
                <span v-if="l.supplierPhone"><v-icon icon="mdi-phone-outline" size="13" /> {{ l.supplierPhone }}</span>
                <span v-if="l.supplierAddress"><v-icon icon="mdi-map-marker-outline" size="13" /> {{ l.supplierAddress }}</span>
              </div>
            </div>
            <span class="rl-status" :class="lineMeta[l.status].cls">{{ lineMeta[l.status].label }}</span>
          </div>

          <!-- Суммы -->
          <div class="rl-amounts">
            <div class="rl-amt">
              <div class="rl-amt-l">К оплате по листу</div>
              <div class="rl-amt-v rl-amt-v--plan">{{ formatCurrency(l.amountPlanned) }}</div>
            </div>
            <div class="rl-amt">
              <div class="rl-amt-l">Полный долг</div>
              <div class="rl-amt-v">{{ formatCurrency(l.debtTotal) }}</div>
            </div>
            <div v-if="l.status === 'PENDING' && lineRemaining(l) < l.debtTotal" class="rl-amt">
              <div class="rl-amt-l">Остаток долга</div>
              <div class="rl-amt-v rl-amt-v--rem">{{ formatCurrency(lineRemaining(l)) }}</div>
            </div>
            <div v-if="l.status === 'PENDING' && lineDueNow(l) < l.amountPlanned" class="rl-amt">
              <div class="rl-amt-l">К сбору сейчас</div>
              <div class="rl-amt-v rl-amt-v--rem">{{ formatCurrency(lineDueNow(l)) }}</div>
            </div>
            <div v-if="l.amountPaid != null" class="rl-amt">
              <div class="rl-amt-l">Оплачено</div>
              <div class="rl-amt-v rl-amt-v--paid">{{ formatCurrency(l.amountPaid) }}</div>
            </div>
          </div>

          <!-- Сделки -->
          <div v-if="l.debts.length" class="rl-deals">
            <div class="rl-deals-title">Сделки в строке</div>
            <router-link v-for="d in l.debts" :key="d.debtId" :to="`/deals/${d.dealId}`" class="rl-deal">
              <div class="rl-deal-info">
                <span class="rl-deal-num">#{{ d.dealNumber }}</span>
                <span class="rl-deal-name">{{ d.productName }}</span>
              </div>
              <div class="rl-deal-right">
                <span
                  v-if="l.status === 'PENDING' && d.remaining < d.debtTotal"
                  class="rl-deal-badge" :class="{ 'rl-deal-badge--done': d.remaining <= 0 }"
                >
                  {{ d.remaining <= 0 ? 'погашено' : 'остаток ' + formatCurrency(d.remaining) }}
                </span>
                <span class="rl-deal-amt">
                  {{ formatCurrency(d.amountPlanned) }}<span v-if="d.debtTotal !== d.amountPlanned" class="rl-deal-full"> / {{ formatCurrency(d.debtTotal) }}</span>
                </span>
                <v-icon icon="mdi-arrow-top-right" size="14" class="rl-deal-arrow" />
              </div>
            </router-link>
          </div>

          <!-- Комментарий -->
          <div v-if="l.comment" class="rl-comment"><v-icon icon="mdi-comment-text-outline" size="14" /> {{ l.comment }}</div>

          <!-- Действия -->
          <div v-if="canManage && !isCancelled" class="rl-actions">
            <template v-if="l.status === 'PENDING'">
              <v-btn class="mz-btn-text" size="small" color="primary" variant="flat" rounded="lg" :loading="busyLine === l.id" :prepend-icon="lineDueNow(l) === 0 ? 'mdi-check' : 'mdi-cash-check'" @click="payLine(l)">{{ lineDueNow(l) === 0 ? 'Закрыть строку' : 'Оплачено' }}</v-btn>
              <v-btn class="mz-btn-text" size="small" variant="tonal" rounded="lg" :disabled="busyLine === l.id" prepend-icon="mdi-debug-step-over" @click="skipLine(l)">Пропустить</v-btn>
            </template>
            <template v-else>
              <v-btn class="mz-btn-text" size="small" variant="tonal" rounded="lg" :loading="busyLine === l.id" prepend-icon="mdi-undo" @click="revertLine(l)">Вернуть в работу</v-btn>
            </template>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="text-center pa-12 text-medium-emphasis">Путевой лист не найден</div>

    <RouteSheetFormDialog v-model="editOpen" :edit-id="id" @saved="load" />
  </div>
</template>

<style scoped>
.rsd-page { padding-bottom: 72px; }
.rsd-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.rsd-back { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; cursor: pointer; font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.6); padding: 0; }
.rsd-back:hover { color: #047857; }
.rsd-actions-btn { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgba(var(--v-theme-surface), 1); color: rgba(var(--v-theme-on-surface), 0.8); font-size: 13.5px; font-weight: 600; cursor: pointer; }
.rsd-actions-btn:hover { background: rgba(var(--v-theme-on-surface), 0.05); border-color: rgba(var(--v-theme-on-surface), 0.2); }
.rsd-menu { background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.1); border-radius: 12px; padding: 6px; min-width: 200px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); }
.rsd-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border: none; background: none; border-radius: 8px; font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85); cursor: pointer; text-align: left; }
.rsd-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.rsd-menu-item--warn { color: #b45309; }
.rsd-menu-item--warn:hover { background: rgba(245,158,11,0.12); }
.rsd-menu-item--del { color: #ef4444; }
.rsd-menu-item--del:hover { background: rgba(239,68,68,0.1); }
.rsd-menu-divider { height: 1px; margin: 5px 8px; background: rgba(var(--v-theme-on-surface), 0.08); }

.rsd-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
@media (max-width: 760px) { .rsd-stats { grid-template-columns: 1fr 1fr; } }
@media (max-width: 460px) { .rsd-stats { grid-template-columns: 1fr; } }
.rsd-stat { padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-surface), 1); }
.rsd-stat-v { font-size: 18px; font-weight: 700; }
.rsd-stat-l { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }

.rsd-desc { border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-surface), 1); border-left: 3px solid #047857; padding: 14px 16px; border-radius: 12px; margin-bottom: 16px; }
.rsd-desc-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 6px; }
.rsd-desc-text { font-size: 15px; line-height: 1.55; color: rgba(var(--v-theme-on-surface), 0.85); white-space: pre-wrap; }

.rsd-title-row { font-size: 13px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.55); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 12px; }

/* Карточка строки (поставщик) */
.rsd-lines { display: flex; flex-direction: column; gap: 14px; }
.rl { border: 1px solid rgba(var(--v-theme-on-surface), 0.09); background: rgba(var(--v-theme-surface), 1); border-radius: 16px; padding: 18px; }
.rl--done { border-color: rgba(4,120,87,0.28); background: rgba(4,120,87,0.02); }
.rl--skip { opacity: 0.7; }

.rl-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.rl-supplier { font-size: 16px; font-weight: 700; line-height: 1.25; }
.rl-contacts { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 5px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.rl-contacts span { display: inline-flex; align-items: center; gap: 4px; }
.rl-status { flex-shrink: 0; font-size: 11px; font-weight: 700; padding: 3px 11px; border-radius: 999px; white-space: nowrap; }
.lm-pending { background: rgba(245,158,11,0.14); color: #f59e0b; }
.lm-paid { background: rgba(4,120,87,0.14); color: #047857; }
.lm-skip { background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.5); }

/* Суммы */
.rl-amounts { display: flex; flex-wrap: wrap; gap: 10px 28px; margin-top: 16px; padding: 14px 16px; border-radius: 12px; background: rgba(var(--v-theme-on-surface), 0.03); }
.rl-amt-l { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 3px; }
.rl-amt-v { font-size: 16px; font-weight: 800; line-height: 1.1; }
.rl-amt-v--plan { color: #3b82f6; }
.rl-amt-v--rem { color: #b45309; }
.rl-amt-v--paid { color: #047857; }

/* Сделки */
.rl-deals { margin-top: 16px; }
.rl-deals-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: rgba(var(--v-theme-on-surface), 0.4); margin-bottom: 8px; }
.rl-deal { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); text-decoration: none; color: inherit; transition: all 0.15s; margin-bottom: 6px; }
.rl-deal:last-child { margin-bottom: 0; }
.rl-deal:hover { border-color: rgba(4,120,87,0.3); background: rgba(4,120,87,0.03); }
.rl-deal-info { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.rl-deal-num { font-size: 13px; font-weight: 800; color: #047857; }
.rl-deal-name { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rl-deal-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.rl-deal-amt { font-size: 13.5px; font-weight: 700; white-space: nowrap; }
.rl-deal-full { color: rgba(var(--v-theme-on-surface), 0.45); font-weight: 400; }
.rl-deal-badge { font-size: 10.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: rgba(245,158,11,0.16); color: #b45309; white-space: nowrap; }
.rl-deal-badge--done { background: rgba(4,120,87,0.14); color: #047857; }
.rl-deal-arrow { color: rgba(var(--v-theme-on-surface), 0.35); }

/* Комментарий */
.rl-comment { display: flex; align-items: flex-start; gap: 7px; margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.04); font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7); line-height: 1.45; }
.rl-comment .v-icon { margin-top: 1px; opacity: 0.6; }

/* Действия */
.rl-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
</style>
