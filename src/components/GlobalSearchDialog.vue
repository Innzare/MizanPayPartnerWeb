<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="(v) => emit('update:modelValue', v)"
    max-width="640"
    transition="fade-transition"
  >
    <v-card rounded="xl" class="gs-card">
      <!-- Search input -->
      <div class="gs-search">
        <v-icon icon="mdi-magnify" size="20" class="gs-search-icon" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          placeholder="Найти сделку или клиента — имя, телефон, товар или #номер…"
          class="gs-search-input"
          @keydown="onKey"
        />
        <span class="gs-search-shortcut">esc</span>
      </div>

      <!-- Body -->
      <div class="gs-body">
        <!-- Loader -->
        <div v-if="loading" class="gs-state">
          <v-progress-circular indeterminate size="20" width="2" color="primary" />
          <span>Ищем…</span>
        </div>

        <!-- Empty: nothing typed -->
        <div v-else-if="!query.trim()" class="gs-state gs-state--hint">
          <v-icon icon="mdi-text-search" size="32" class="gs-hint-icon" />
          <div class="gs-hint-title">Глобальный поиск</div>
          <div class="gs-hint-text">
            Введите имя клиента, телефон, название товара или <span class="gs-kbd-mini">#42</span> — найдём сделку или клиента
          </div>
        </div>

        <!-- Empty: no results -->
        <div v-else-if="!hasResults" class="gs-state gs-state--empty">
          <v-icon icon="mdi-magnify-close" size="32" class="gs-empty-icon" />
          <div class="gs-empty-title">Ничего не найдено</div>
          <div class="gs-empty-text">Попробуйте другие слова или часть номера телефона</div>
        </div>

        <!-- Results -->
        <template v-else>
          <!-- Deals group -->
          <div v-if="results.deals.length" class="gs-group">
            <div class="gs-group-head">
              <v-icon icon="mdi-briefcase-outline" size="13" />
              <span>Сделки</span>
              <span class="gs-group-count">{{ results.deals.length }}</span>
            </div>
            <button
              v-for="(d, i) in results.deals"
              :key="d.id"
              :ref="(el) => setItemRef(el, dealOffset + i)"
              class="gs-item"
              :class="{ 'gs-item--active': activeIdx === dealOffset + i }"
              @mouseenter="activeIdx = dealOffset + i"
              @click="goToDeal(d.id)"
            >
              <div class="gs-item-icon gs-item-icon--deal">
                <v-icon icon="mdi-briefcase-outline" size="16" />
              </div>
              <div class="gs-item-main">
                <div class="gs-item-title">
                  <span class="gs-item-num">#{{ d.dealNumber }}</span>
                  <span class="gs-item-product">{{ d.productName }}</span>
                </div>
                <div class="gs-item-sub">
                  <span v-if="d.clientName">{{ d.clientName }}</span>
                  <span v-if="d.clientName" class="gs-item-dot">·</span>
                  <span class="gs-item-status" :class="`gs-item-status--${d.status.toLowerCase()}`">
                    {{ statusLabel(d.status) }}
                  </span>
                </div>
              </div>
              <div class="gs-item-right">
                <div class="gs-item-amount">{{ formatCurrency(d.totalPrice) }}</div>
                <v-icon icon="mdi-arrow-top-right" size="14" class="gs-item-arrow" />
              </div>
            </button>
          </div>

          <!-- Clients group -->
          <div v-if="results.clients.length" class="gs-group">
            <div class="gs-group-head">
              <v-icon icon="mdi-account-circle-outline" size="13" />
              <span>Клиенты</span>
              <span class="gs-group-count">{{ results.clients.length }}</span>
            </div>
            <button
              v-for="(c, i) in results.clients"
              :key="c.id"
              :ref="(el) => setItemRef(el, clientOffset + i)"
              class="gs-item"
              :class="{ 'gs-item--active': activeIdx === clientOffset + i }"
              @mouseenter="activeIdx = clientOffset + i"
              @click="goToClient(c.id)"
            >
              <div class="gs-item-icon gs-item-icon--client">
                <v-icon icon="mdi-account-circle-outline" size="16" />
              </div>
              <div class="gs-item-main">
                <div class="gs-item-title">
                  <span class="gs-item-product">{{ c.name }}</span>
                </div>
                <div v-if="c.phone" class="gs-item-sub">{{ formatPhone(c.phone) }}</div>
              </div>
              <div class="gs-item-right">
                <v-icon icon="mdi-arrow-top-right" size="14" class="gs-item-arrow" />
              </div>
            </button>
          </div>
        </template>
      </div>

      <!-- Footer hints -->
      <div class="gs-footer">
        <span class="gs-footer-hint">
          <span class="gs-kbd">↑</span><span class="gs-kbd">↓</span> навигация
        </span>
        <span class="gs-footer-hint">
          <span class="gs-kbd">↵</span> открыть
        </span>
        <span class="gs-footer-hint">
          <span class="gs-kbd">esc</span> закрыть
        </span>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { formatCurrency, formatPhone } from '@/utils/formatters'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
}>()

const router = useRouter()

interface DealResult {
  id: string
  dealNumber: number
  productName: string
  status: 'ACTIVE' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED'
  totalPrice: number
  remainingAmount: number
  clientName: string
}
interface ClientResult {
  id: string
  name: string
  phone: string
}

const inputRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const loading = ref(false)
const results = ref<{ deals: DealResult[]; clients: ClientResult[] }>({ deals: [], clients: [] })
const activeIdx = ref(0)
const itemRefs = ref<Array<HTMLElement | null>>([])

function setItemRef(el: any, idx: number) {
  itemRefs.value[idx] = el as HTMLElement | null
}

const dealOffset = computed(() => 0)
const clientOffset = computed(() => results.value.deals.length)
const totalItems = computed(() => results.value.deals.length + results.value.clients.length)
const hasResults = computed(() => totalItems.value > 0)

function statusLabel(s: DealResult['status']) {
  return ({ ACTIVE: 'Активна', COMPLETED: 'Завершена', DISPUTED: 'Спор', CANCELLED: 'Отменена' } as const)[s]
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  if (q.trim().length === 0) {
    results.value = { deals: [], clients: [] }
    activeIdx.value = 0
    return
  }
  searchTimer = setTimeout(() => doSearch(q.trim()), 200)
})

async function doSearch(q: string) {
  loading.value = true
  try {
    results.value = await api.get(`/deals/global-search?q=${encodeURIComponent(q)}`)
    activeIdx.value = 0
    itemRefs.value = []
  } catch {
    results.value = { deals: [], clients: [] }
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    query.value = ''
    results.value = { deals: [], clients: [] }
    activeIdx.value = 0
    nextTick(() => inputRef.value?.focus())
  } else {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null }
  }
})

function close() {
  emit('update:modelValue', false)
}

function goToDeal(id: string) {
  close()
  router.push(`/deals/${id}`)
}

function goToClient(id: string) {
  close()
  router.push(`/clients/${id}`)
}

function activate(idx: number) {
  if (idx < 0 || idx >= totalItems.value) return
  if (idx < results.value.deals.length) {
    goToDeal(results.value.deals[idx].id)
  } else {
    goToClient(results.value.clients[idx - results.value.deals.length].id)
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (totalItems.value > 0) {
      activeIdx.value = (activeIdx.value + 1) % totalItems.value
      scrollActive()
    }
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (totalItems.value > 0) {
      activeIdx.value = (activeIdx.value - 1 + totalItems.value) % totalItems.value
      scrollActive()
    }
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    activate(activeIdx.value)
  }
}

function scrollActive() {
  nextTick(() => {
    const el = itemRefs.value[activeIdx.value]
    if (el) el.scrollIntoView({ block: 'nearest' })
  })
}
</script>

<style scoped>
.gs-card {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

/* Search */
.gs-search {
  position: relative;
  display: flex; align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.gs-search-icon { color: rgba(var(--v-theme-on-surface), 0.4); margin-right: 12px; flex-shrink: 0; }
.gs-search-input {
  flex: 1;
  border: none; outline: none; background: transparent;
  font-size: 15px;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-family: inherit;
  padding: 4px 0;
}
.gs-search-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.4); }
.gs-search-shortcut {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 11px; font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Body */
.gs-body {
  max-height: min(60vh, 480px);
  overflow-y: auto;
  padding: 6px;
}
.gs-state {
  display: flex; align-items: center; justify-content: center;
  gap: 8px;
  padding: 32px 20px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 13px;
}
.gs-state--hint, .gs-state--empty {
  flex-direction: column; gap: 8px;
  padding: 48px 20px;
}
.gs-hint-icon, .gs-empty-icon {
  color: rgba(var(--v-theme-on-surface), 0.25);
  margin-bottom: 4px;
}
.gs-hint-title, .gs-empty-title {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.gs-hint-text, .gs-empty-text {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-align: center;
  max-width: 360px;
  line-height: 1.5;
}
.gs-kbd-mini {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-family: ui-monospace, SF Mono, monospace;
  font-size: 11px; font-weight: 600;
}

/* Group */
.gs-group { padding: 4px 0 8px; }
.gs-group-head {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px 4px;
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.gs-group-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 6px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 10px; font-weight: 700;
  margin-left: 2px;
}

/* Item */
.gs-item {
  display: flex; align-items: center; gap: 12px;
  width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.1s;
}
.gs-item--active {
  background: rgba(var(--v-theme-primary), 0.08);
}
.gs-item--active .gs-item-arrow { color: rgb(var(--v-theme-primary)); opacity: 1; }
.gs-item-icon {
  width: 32px; height: 32px; min-width: 32px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.gs-item-icon--deal {
  background: rgba(99, 102, 241, 0.10);
  color: #6366f1;
}
.gs-item-icon--client {
  background: rgba(4, 120, 87, 0.10);
  color: #047857;
}
.dark .gs-item-icon--client { color: #34d399; background: rgba(74, 222, 128, 0.12); }
.gs-item-main { flex: 1; min-width: 0; }
.gs-item-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.gs-item-num {
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgba(var(--v-theme-on-surface), 0.06);
  padding: 2px 6px;
  border-radius: 5px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.gs-item-product {
  font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  min-width: 0;
}
.gs-item-sub {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}
.gs-item-dot { opacity: 0.5; }
.gs-item-status {
  font-weight: 600;
  font-size: 11px;
}
.gs-item-status--active { color: #047857; }
.gs-item-status--completed { color: rgba(var(--v-theme-on-surface), 0.5); }
.gs-item-status--disputed { color: #f59e0b; }
.gs-item-status--cancelled { color: #ef4444; }

.gs-item-right {
  display: flex; align-items: center; gap: 10px;
  flex-shrink: 0;
}
.gs-item-amount {
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-variant-numeric: tabular-nums;
}
.gs-item-arrow {
  color: rgba(var(--v-theme-on-surface), 0.3);
  opacity: 0;
  transition: all 0.15s;
}
.gs-item:hover .gs-item-arrow { opacity: 1; }

/* Footer */
.gs-footer {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 10px 16px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.dark .gs-footer { background: rgba(255, 255, 255, 0.02); }
.gs-footer-hint {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.gs-kbd {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-family: ui-monospace, SF Mono, monospace;
  font-size: 10px; font-weight: 600;
}
</style>
