<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatCurrency } from '@/utils/formatters'
import { useIsMobile } from '@/composables/useIsMobile'

/**
 * Универсальная модалка «откуда взялась цифра».
 *
 * Показывает, из каких сделок складывается конкретный показатель: заголовок,
 * крупный итог, объяснение расчёта простыми словами и список сделок со
 * вкладом каждой. Ничего лишнего — только то, что относится к этой строке.
 *
 * Используется и в отчётах, и в общей сводке: раньше в каждом месте была своя
 * модалка со своей вёрсткой, и они разъезжались.
 */
export interface MetricDetailItem {
  /** id сделки — по клику открываем её */
  id: string
  title: string
  subtitle?: string
  /** Вклад этой сделки в показатель */
  value: number
  /** Из чего сложилось значение именно этой сделки */
  parts?: Array<{ label: string; value: string }>
  /** Значение в процентах вместо рублей (для долей) */
  suffix?: string
}

const props = defineProps<{
  modelValue: boolean
  title: string
  /** Объяснение расчёта на бытовом языке */
  hint?: string
  total: number
  /** Подпись над колонкой значений */
  valueLabel?: string
  color?: string
  items: MetricDetailItem[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const router = useRouter()
const { isMobile } = useIsMobile()
const search = ref('')

// Сбрасываем поиск при каждом открытии — иначе прошлый фильтр «прячет» данные.
watch(() => props.modelValue, (v) => { if (v) search.value = '' })

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = q
    ? props.items.filter(
        (i) => i.title.toLowerCase().includes(q) || (i.subtitle ?? '').toLowerCase().includes(q),
      )
    : props.items
  // Крупные вклады сверху — так сразу видно, что формирует цифру.
  return [...list].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
})

const shownTotal = computed(() => rows.value.reduce((s, r) => s + r.value, 0))
const filtered = computed(() => rows.value.length !== props.items.length)

function fmt(item: MetricDetailItem) {
  return item.suffix ? `${item.value}${item.suffix}` : formatCurrency(item.value)
}

function openDeal(id: string) {
  emit('update:modelValue', false)
  router.push(`/deals/${id}`)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="920"
    scrollable
    :fullscreen="isMobile"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card rounded="lg" class="md-card">
      <!-- Шапка: что за показатель и сколько это -->
      <div class="md-head">
        <div class="md-head-main">
          <div class="md-title">{{ title }}</div>
          <div v-if="hint" class="md-hint">{{ hint }}</div>
        </div>
        <button class="md-close" @click="emit('update:modelValue', false)">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="md-total" :style="{ background: (color || '#10b981') + '0f' }">
        <div>
          <div class="md-total-value" :style="{ color: color || '#10b981' }">
            {{ formatCurrency(total) }}
          </div>
          <div class="md-total-label">
            {{ items.length }} {{ items.length === 1 ? 'сделка' : items.length < 5 ? 'сделки' : 'сделок' }}
          </div>
        </div>
        <input v-model="search" class="md-search" placeholder="Найти товар или клиента…" >
      </div>

      <!-- Список сделок -->
      <div class="md-list">
        <div v-if="!rows.length" class="md-empty">
          {{ items.length ? 'Ничего не найдено' : 'Нет сделок для этого показателя' }}
        </div>

        <div v-for="r in rows" :key="r.id" class="md-row" @click="openDeal(r.id)">
          <div class="md-row-body">
            <div class="md-row-left">
              <div class="md-row-title">{{ r.title }}</div>
              <div v-if="r.subtitle" class="md-row-sub">{{ r.subtitle }}</div>
              <div v-if="r.parts?.length" class="md-parts">
                <span v-for="p in r.parts" :key="p.label" class="md-part">
                  {{ p.label }} <b>{{ p.value }}</b>
                </span>
              </div>
            </div>
            <div class="md-row-value" :style="{ color: color || '#10b981' }">{{ fmt(r) }}</div>
          </div>
        </div>
      </div>

      <!-- Итог по отфильтрованному — чтобы поиск не сбивал с толку -->
      <div v-if="filtered && rows.length" class="md-foot">
        Найдено {{ rows.length }} — на сумму <b>{{ formatCurrency(shownTotal) }}</b>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.md-card { display: flex; flex-direction: column; max-height: 88vh; }

.md-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; padding: 20px 24px 14px;
  flex-shrink: 0;
}
.md-title {
  font-size: 18px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.9);
  letter-spacing: -0.01em;
}
.md-hint {
  font-size: 13px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 4px;
}
.md-close {
  width: 32px; height: 32px; border: none; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; flex-shrink: 0;
}
.md-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

.md-total {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 12px;
  margin: 0 24px; padding: 14px 18px;
  border-radius: 12px;
  flex-shrink: 0;
}
.md-total-value { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
.md-total-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px; }
.md-search {
  padding: 8px 13px; border-radius: 9px; min-width: 210px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px;
}

.md-list { overflow-y: auto; padding: 8px 16px 4px; flex: 1 1 auto; min-height: 0; }
.md-row {
  border-radius: 10px;
  cursor: pointer;
}
.md-row:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.md-row-body {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; padding: 11px 12px;
}
.md-row + .md-row .md-row-body {
  box-shadow: inset 0 1px 0 rgba(var(--v-theme-on-surface), 0.05);
}
.md-row-left { min-width: 0; }
.md-row-title {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.87);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.md-row-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 1px; }
.md-parts { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 5px; }
.md-part {
  font-size: 11px; padding: 2px 7px; border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
}
.md-part b { color: rgba(var(--v-theme-on-surface), 0.75); font-weight: 700; }
.md-row-value { font-size: 15px; font-weight: 800; white-space: nowrap; flex-shrink: 0; }

.md-empty {
  padding: 48px 0; text-align: center;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.md-foot {
  padding: 12px 24px; flex-shrink: 0;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
}
.md-foot b { color: rgba(var(--v-theme-on-surface), 0.85); }

@media (max-width: 600px) {
  .md-card { max-height: 100%; border-radius: 0; }
  .md-head { padding: 16px 16px 10px; }
  .md-total { margin: 0 16px; padding: 12px 14px; }
  .md-total-value { font-size: 22px; }
  .md-list { padding: 8px; }
  .md-search { min-width: 100%; }
}
</style>
