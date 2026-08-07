<script setup lang="ts">
import { ref, computed, onMounted, nextTick, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useSuppliersStore, type SupplierRow, type SupplierDebt, type SupplierDeal, type SupplierPayout } from '@/stores/suppliers'
import { useAuthStore } from '@/stores/auth'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDateShort } from '@/utils/formatters'
import SupplierPayoutDialog from './SupplierPayoutDialog.vue'
import SupplierFormDialog from './SupplierFormDialog.vue'
import SupplierMapDialog from './SupplierMapDialog.vue'

declare const ymaps: any
const props = defineProps<{ id: string }>()

const store = useSuppliersStore()
const auth = useAuthStore()
const router = useRouter()
const { isDark } = useIsDark()
const toast = useToast()

const canPay = computed(() => auth.can('suppliers.pay'))
const canEdit = computed(() => auth.can('suppliers.edit'))

const supplier = ref<(SupplierRow & { paidTotal: number }) | null>(null)
const debts = ref<SupplierDebt[]>([])
const deals = ref<SupplierDeal[]>([])
const payouts = ref<SupplierPayout[]>([])
const loading = ref(true)

type Tab = 'ops' | 'deals' | 'payouts'
const tab = ref<Tab>('ops')

const payoutOpen = ref(false)
const presetDebtId = ref<string | null>(null)
const editOpen = ref(false)
const mapDialogOpen = ref(false)

const openDebts = computed(() => debts.value.filter((d) => d.status === 'OPEN'))
const debtTotal = computed(() => openDebts.value.reduce((s, d) => s + d.remaining, 0))

const fullAddress = computed(() =>
  supplier.value ? [supplier.value.city, supplier.value.address].filter(Boolean).join(', ') : '',
)
const hasCoords = computed(() => !!supplier.value && supplier.value.lat != null && supplier.value.lng != null)

// Карта адреса в шапке (Яндекс.Карты, только чтение).
const mapId = 'sd-map-' + Math.random().toString(36).slice(2)
let mapInstance: any = null
function destroyMap() { if (mapInstance) { mapInstance.destroy(); mapInstance = null } }
function initMap() {
  if (typeof ymaps === 'undefined' || !supplier.value || supplier.value.lat == null || supplier.value.lng == null) return
  ymaps.ready(() => {
    destroyMap()
    const coords: [number, number] = [supplier.value!.lat!, supplier.value!.lng!]
    // Чистая карта-превью: без контролов, без блока «Открыть в Яндекс.Картах», без POI.
    mapInstance = new ymaps.Map(
      mapId,
      { center: coords, zoom: 15, controls: [] },
      { suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true },
    )
    mapInstance.behaviors.disable(['scrollZoom', 'dblClickZoom', 'multiTouch'])
    mapInstance.geoObjects.add(new ymaps.Placemark(coords, {}, { preset: 'islands#redDotIcon' }))
    setTimeout(() => mapInstance?.container?.fitToViewport?.(), 300)
  })
}

const DEAL_STATUS_META: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Активна', cls: 'ds-active' },
  COMPLETED: { label: 'Завершена', cls: 'ds-done' },
  DISPUTED: { label: 'Спор', cls: 'ds-disputed' },
  CANCELLED: { label: 'Отменена', cls: 'ds-cancelled' },
}

async function load() {
  loading.value = true
  try {
    const [s, db, dl, po] = await Promise.all([
      store.getOne(props.id),
      store.fetchDebts(props.id, 'all'),
      store.fetchDeals(props.id),
      store.fetchPayouts(props.id),
    ])
    supplier.value = s
    debts.value = db
    deals.value = dl
    payouts.value = po
  } finally {
    loading.value = false
  }
  if (hasCoords.value) nextTick(initMap)
}

function openPayout(debtId?: string) { presetDebtId.value = debtId ?? null; payoutOpen.value = true }
async function onPaid() { toast.success('Выплата проведена'); await load() }
async function onEdited() { toast.success('Партнёр обновлён'); await load() }

async function cancelPayout(p: SupplierPayout) {
  if (!confirm(`Отменить выплату ${formatCurrency(p.amount)}?`)) return
  try {
    await store.cancelPayout(props.id, p.id)
    toast.success('Выплата отменена')
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отменить')
  }
}

function fmtDate(ts: number) { return formatDateShort(new Date(ts).toISOString()) }
function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '—'
}

onMounted(load)
onBeforeUnmount(destroyMap)
</script>

<template>
  <div class="at-page sd-page" :class="{ dark: isDark }">
    <button class="sd-back" @click="router.push('/suppliers')"><v-icon icon="mdi-arrow-left" size="18" /> К партнёрам</button>

    <div v-if="loading" class="d-flex justify-center pa-12"><v-progress-circular indeterminate color="primary" size="40" /></div>

    <template v-else-if="supplier">
      <!-- Шапка -->
      <div class="sd-hero">
        <div class="sd-hero-body">
          <div class="sd-hero-top">
            <div class="sd-avatar">{{ initials(supplier.name) }}</div>
            <div class="sd-hero-info">
              <div class="sd-name">{{ supplier.name }} <span v-if="supplier.archivedAt" class="sd-arch">архив</span></div>
              <div v-if="supplier.activity" class="sd-activity">{{ supplier.activity }}</div>
            </div>
          </div>

          <div class="sd-hero-lines">
            <div v-if="fullAddress" class="sd-hero-line"><v-icon icon="mdi-map-marker-outline" size="16" /> {{ fullAddress }}</div>
            <div v-if="supplier.phone" class="sd-hero-line"><v-icon icon="mdi-phone-outline" size="16" /> {{ supplier.phone }}</div>
            <div v-if="supplier.contactName" class="sd-hero-line"><v-icon icon="mdi-account-outline" size="16" /> {{ supplier.contactName }}</div>
            <div v-if="supplier.email" class="sd-hero-line"><v-icon icon="mdi-email-outline" size="16" /> {{ supplier.email }}</div>
          </div>

          <div class="sd-actions">
            <button v-if="canEdit" class="sd-btn" @click="editOpen = true"><v-icon icon="mdi-pencil-outline" size="16" /> Изменить</button>
            <button v-if="canPay && debtTotal > 0" class="sd-btn sd-btn--primary" @click="openPayout()"><v-icon icon="mdi-cash-check" size="16" /> Выплата</button>
          </div>
        </div>

        <div v-if="hasCoords" class="sd-hero-map">
          <div :id="mapId" class="sd-map"></div>
          <button class="sd-map-expand" title="Открыть карту крупно" @click="mapDialogOpen = true">
            <v-icon icon="mdi-arrow-expand-all" size="16" />
          </button>
        </div>
        <div v-else class="sd-hero-map sd-hero-map--empty">
          <v-icon icon="mdi-map-marker-off-outline" size="30" />
          <span>Адрес на карте не указан</span>
        </div>
      </div>

      <!-- Показатели -->
      <div class="sd-stats">
        <div class="sd-stat"><span class="sd-stat-lbl">Текущий долг</span><span class="sd-stat-val" :style="debtTotal > 0 ? 'color:#ef4444' : ''">{{ formatCurrency(debtTotal) }}</span></div>
        <div class="sd-stat"><span class="sd-stat-lbl">Открытых долгов</span><span class="sd-stat-val">{{ openDebts.length }}</span></div>
        <div class="sd-stat"><span class="sd-stat-lbl">Всего выплачено</span><span class="sd-stat-val" style="color:#047857">{{ formatCurrency(supplier.paidTotal) }}</span></div>
        <div class="sd-stat"><span class="sd-stat-lbl">Сделок</span><span class="sd-stat-val">{{ deals.length }}</span></div>
      </div>

      <!-- Табы -->
      <div class="settings-tabs">
        <button class="settings-tab" :class="{ active: tab === 'ops' }" @click="tab = 'ops'"><v-icon icon="mdi-cash-multiple" size="18" /><span>Операции</span><span v-if="openDebts.length" class="sd-tabc" :class="{ on: tab === 'ops' }">{{ openDebts.length }}</span></button>
        <button class="settings-tab" :class="{ active: tab === 'deals' }" @click="tab = 'deals'"><v-icon icon="mdi-file-document-outline" size="18" /><span>История договоров</span></button>
        <button class="settings-tab" :class="{ active: tab === 'payouts' }" @click="tab = 'payouts'"><v-icon icon="mdi-history" size="18" /><span>История выплат</span></button>
      </div>

      <!-- Операции: открытые долги -->
      <div v-if="tab === 'ops'" class="sd-card">
        <v-table v-if="openDebts.length" density="comfortable" class="sd-table">
          <thead><tr><th>Сделка</th><th>Дата</th><th class="text-end">Долг</th><th class="text-end">Оплачено</th><th class="text-end">Остаток</th><th class="text-end" style="width:120px;"></th></tr></thead>
          <tbody>
            <tr v-for="d in openDebts" :key="d.id">
              <td>
                <router-link :to="`/deals/${d.dealId}`" class="sd-deal-link">#{{ d.dealNumber }} · {{ d.productName }} <v-icon icon="mdi-arrow-top-right" size="13" /></router-link>
              </td>
              <td class="text-no-wrap">{{ fmtDate(d.dealDate) }}</td>
              <td class="text-end text-no-wrap">{{ formatCurrency(d.amount) }}</td>
              <td class="text-end text-no-wrap text-medium-emphasis">{{ formatCurrency(d.paidAmount) }}</td>
              <td class="text-end">
                <div class="text-no-wrap"><span class="sd-debt">{{ formatCurrency(d.remaining) }}</span></div>
                <router-link
                  v-if="d.inRouteSheet && d.routeSheetId"
                  :to="`/suppliers/route-sheets/${d.routeSheetId}`" class="sd-rs-badge"
                  title="Эта сделка уже в путевом листе (в работе)"
                >
                  <v-icon icon="mdi-clipboard-list-outline" size="12" /> в листе №{{ d.routeSheetNumber }}
                </router-link>
              </td>
              <td class="text-end">
                <button v-if="canPay" class="sd-pay-btn" @click="openPayout(d.id)">Погасить</button>
              </td>
            </tr>
          </tbody>
        </v-table>
        <div v-else class="text-center pa-10">
          <v-icon icon="mdi-check-circle-outline" size="48" color="grey-lighten-1" class="mb-2" />
          <div class="text-body-1">Нет открытых долгов</div>
          <div class="text-body-2 text-medium-emphasis">Всё выплачено этому партнёру</div>
        </div>
      </div>

      <!-- История договоров -->
      <div v-else-if="tab === 'deals'" class="sd-card">
        <v-table v-if="deals.length" density="comfortable" class="sd-table">
          <thead><tr><th>Сделка</th><th>Дата</th><th class="text-end">Закупка</th><th class="text-end">Договор</th><th>Оплата поставщику</th><th>Статус</th></tr></thead>
          <tbody>
            <tr v-for="d in deals" :key="d.dealId">
              <td>
                <router-link :to="`/deals/${d.dealId}`" class="sd-deal-link">#{{ d.dealNumber }} · {{ d.productName }} <v-icon icon="mdi-arrow-top-right" size="13" /></router-link>
              </td>
              <td class="text-no-wrap">{{ fmtDate(d.dealDate) }}</td>
              <td class="text-end text-no-wrap">{{ formatCurrency(d.purchasePrice) }}</td>
              <td class="text-end text-no-wrap">{{ formatCurrency(d.totalPrice) }}</td>
              <td class="text-no-wrap">
                <span v-if="!d.debt || d.debt.status !== 'OPEN'" class="sd-paid-tag">Оплачено</span>
                <span v-else class="sd-owe-tag">Долг {{ formatCurrency(d.debt.remaining) }}</span>
              </td>
              <td class="text-no-wrap">
                <span class="sd-status-badge" :class="(DEAL_STATUS_META[d.status] || {}).cls">{{ (DEAL_STATUS_META[d.status] || { label: d.status }).label }}</span>
              </td>
            </tr>
          </tbody>
        </v-table>
        <div v-else class="text-center pa-10 text-medium-emphasis">Сделок с этим партнёром пока нет</div>
      </div>

      <!-- История выплат -->
      <div v-else class="sd-card">
        <v-table v-if="payouts.length" density="comfortable" class="sd-table">
          <thead><tr><th>Дата</th><th class="text-end">Сумма</th><th>За что</th><th>Заметка</th><th class="text-end" style="width:48px;"></th></tr></thead>
          <tbody>
            <tr v-for="p in payouts" :key="p.id">
              <td class="text-no-wrap">{{ fmtDate(p.date) }}</td>
              <td class="text-end text-no-wrap"><span class="sd-paid">{{ formatCurrency(p.amount) }}</span></td>
              <td>
                <span v-for="(a, i) in p.allocations" :key="i" class="sd-alloc">#{{ a.dealNumber }}<template v-if="i < p.allocations.length - 1">, </template></span>
                <span v-if="!p.allocations.length" class="text-medium-emphasis">—</span>
              </td>
              <td class="sd-sub">{{ p.note || '—' }}<span v-if="p.fromRouteSheet" class="sd-rs-tag">путевой лист</span></td>
              <td class="text-end">
                <button v-if="canPay && !p.fromRouteSheet" class="sd-del" title="Отменить" @click="cancelPayout(p)"><v-icon icon="mdi-close" size="16" /></button>
              </td>
            </tr>
          </tbody>
        </v-table>
        <div v-else class="text-center pa-10 text-medium-emphasis">Выплат ещё не было</div>
      </div>
    </template>

    <SupplierPayoutDialog
      v-if="supplier"
      v-model="payoutOpen"
      :supplier-id="supplier.id"
      :supplier-name="supplier.name"
      :debts="debts"
      :preset-debt-id="presetDebtId"
      @saved="onPaid"
    />
    <SupplierFormDialog v-model="editOpen" :supplier="supplier as any" @saved="onEdited" />
    <SupplierMapDialog
      v-if="supplier"
      v-model="mapDialogOpen"
      :name="supplier.name"
      :address="fullAddress || supplier.address"
      :lat="supplier.lat"
      :lng="supplier.lng"
    />
  </div>
</template>

<style scoped>
.sd-page { padding-bottom: 72px; }
.sd-back { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 16px; border: none; background: none; cursor: pointer; font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.6); }
.sd-back:hover { color: rgb(var(--v-theme-primary)); }

.sd-hero { display: flex; align-items: stretch; gap: 20px; padding: 24px; border-radius: 18px; background: linear-gradient(135deg, #047857 0%, #065f46 100%); color: #fff; margin-bottom: 16px; box-shadow: 0 10px 30px rgba(4,120,87,0.22); }
.sd-hero-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sd-hero-top { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.sd-avatar { width: 60px; height: 60px; min-width: 60px; border-radius: 16px; background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; }
.sd-hero-info { flex: 1; min-width: 0; }
.sd-name { font-size: 24px; font-weight: 800; line-height: 1.2; }
.sd-arch { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: rgba(255,255,255,0.25); vertical-align: middle; }
.sd-activity { display: inline-flex; margin-top: 6px; font-size: 12px; font-weight: 600; padding: 3px 12px; border-radius: 999px; background: rgba(255,255,255,0.18); }
.sd-hero-lines { display: flex; flex-direction: column; gap: 7px; margin-bottom: 18px; }
.sd-hero-line { display: flex; align-items: center; gap: 8px; font-size: 14px; opacity: 0.95; }
.sd-hero-line .v-icon { opacity: 0.8; }
.sd-actions { display: flex; gap: 8px; margin-top: auto; flex-wrap: wrap; }
.sd-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.15); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.sd-btn:hover { background: rgba(255,255,255,0.25); }
.sd-btn--primary { background: #fff; color: #047857; border-color: #fff; }
.sd-btn--primary:hover { background: rgba(255,255,255,0.9); }

.sd-hero-map { position: relative; width: 320px; min-width: 320px; border-radius: 14px; overflow: hidden; border: 3px solid rgba(255,255,255,0.25); }
.sd-map { width: 100%; height: 100%; min-height: 220px; }
.sd-map-expand { position: absolute; top: 10px; right: 10px; z-index: 5; width: 34px; height: 34px; border-radius: 9px; border: none; background: rgba(255,255,255,0.95); color: #047857; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.sd-map-expand:hover { background: #fff; }
/* Убираем копирайт/лого/промо Яндекса на карте-превью */
.sd-map :deep([class*="copyrights-pane"]),
.sd-map :deep([class*="map-copyrights"]),
.sd-map :deep([class*="copyright"]),
.sd-map :deep([class*="gototech"]),
.sd-map :deep([class*="logo"]) { display: none !important; }
.sd-hero-map--empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.75); font-size: 13px; }
@media (max-width: 760px) {
  .sd-hero { flex-direction: column; }
  .sd-hero-map { width: 100%; min-width: 0; height: 200px; }
  .sd-name { font-size: 21px; }
}

.sd-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
@media (max-width: 700px) { .sd-stats { grid-template-columns: 1fr 1fr; } }
.sd-stat { padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-surface), 1); display: flex; flex-direction: column; gap: 3px; }
.sd-stat-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: rgba(var(--v-theme-on-surface), 0.45); }
.sd-stat-val { font-size: 18px; font-weight: 800; }

.settings-tabs { display: flex; gap: 4px; margin-bottom: 16px; padding: 4px; border-radius: 12px; background: #fff; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow-x: auto; }
.settings-tab { display: flex; align-items: center; gap: 6px; padding: 10px 16px; border-radius: 8px; border: none; background: transparent; font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.5); cursor: pointer; transition: all 0.15s; white-space: nowrap; }
.settings-tab:hover { color: rgba(var(--v-theme-on-surface), 0.7); background: rgba(var(--v-theme-on-surface), 0.04); }
.settings-tab.active { background: #047857; color: #fff; font-weight: 600; box-shadow: 0 2px 6px rgba(4,120,87,0.25); }
.sd-page.dark .settings-tabs { background: #1a1a2e; border-color: #2e2e42; box-shadow: none; }
.sd-tabc { font-size: 11px; font-weight: 700; padding: 0 6px; border-radius: 10px; background: rgba(var(--v-theme-on-surface),0.08); }
.sd-tabc.on { background: rgba(255,255,255,0.25); color: #fff; }

.sd-card { border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-surface), 1); overflow: hidden; }
.sd-table :deep(th) { font-size: 12px !important; text-transform: uppercase; letter-spacing: 0.03em; color: rgba(var(--v-theme-on-surface), 0.5) !important; }
.sd-table :deep(tbody td) { height: 62px !important; padding-top: 12px !important; padding-bottom: 12px !important; }
.sd-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.sd-debt { font-weight: 700; color: #ef4444; }
.sd-paid { font-weight: 700; color: #047857; }
.sd-alloc { font-size: 12.5px; }
.sd-deal-link { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: #047857; text-decoration: none; }
.sd-deal-link:hover { text-decoration: underline; }
.sd-deal-link .v-icon { opacity: 0.55; }
.sd-status-badge { font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 999px; white-space: nowrap; background: rgba(var(--v-theme-on-surface),0.08); color: rgba(var(--v-theme-on-surface),0.6); }
.ds-active { background: rgba(59,130,246,0.14); color: #3b82f6; }
.ds-done { background: rgba(4,120,87,0.14); color: #047857; }
.ds-disputed { background: rgba(245,158,11,0.16); color: #b45309; }
.ds-cancelled { background: rgba(var(--v-theme-on-surface),0.08); color: rgba(var(--v-theme-on-surface),0.5); }
.sd-paid-tag { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: rgba(16,185,129,0.15); color: #047857; }
.sd-owe-tag { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: rgba(239,68,68,0.14); color: #dc2626; }
.sd-rs-tag { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: rgba(var(--v-theme-on-surface),0.08); color: rgba(var(--v-theme-on-surface),0.55); margin-left: 6px; }
.sd-rs-badge { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; font-size: 11.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: rgba(59,130,246,0.12); color: #3b82f6; text-decoration: none; }
.sd-rs-badge:hover { background: rgba(59,130,246,0.2); }
.sd-pay-btn { padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(4,120,87,0.35); background: rgba(4,120,87,0.08); color: #047857; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.sd-pay-btn:hover { background: #047857; color: #fff; border-color: #047857; }
.sd-del { width: 30px; height: 30px; border-radius: 8px; border: none; background: rgba(var(--v-theme-on-surface),0.05); color: rgba(var(--v-theme-on-surface),0.5); cursor: pointer; }
.sd-del:hover { background: rgba(239,68,68,0.12); color: #ef4444; }
</style>
