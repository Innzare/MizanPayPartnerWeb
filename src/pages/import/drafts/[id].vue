<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Page header — single row with back, title, meta -->
    <div class="page-header mb-6">
      <router-link to="/import" class="page-header-back-btn">
        <v-icon icon="mdi-chevron-left" size="16" />
        Импорт
      </router-link>
      <div class="page-header-title">
        <v-icon icon="mdi-file-table-outline" size="20" class="page-header-icon" />
        <h1 class="page-header-name">{{ draft?.originalFileName || 'Импорт продаж' }}</h1>
      </div>
      <v-spacer />
      <div v-if="draft" class="page-header-meta">
        <span class="page-header-meta-item">
          <v-icon icon="mdi-calendar-outline" size="13" />
          {{ formatDateShort(draft.createdAt) }}
        </span>
        <span class="page-header-meta-dot">·</span>
        <span class="page-header-meta-item">{{ draft.format === 'vertical' ? 'Pyrus-формат' : 'Excel-таблица' }}</span>
      </div>
    </div>

    <!-- Page loader -->
    <div v-if="loading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else-if="draft">
      <!-- Summary stats -->
      <div class="stats-row mb-5">
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(99, 102, 241, 0.10); color: #6366f1;">
            <v-icon icon="mdi-table-large" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ draft.stats.total }}</div>
            <div class="stat-label">Всего строк</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(4, 120, 87, 0.10); color: #047857;">
            <v-icon icon="mdi-check-circle-outline" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ readyCount }}</div>
            <div class="stat-label">Готовы к импорту</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(245, 158, 11, 0.10); color: #f59e0b;">
            <v-icon icon="mdi-content-duplicate" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ duplicatesCount }}</div>
            <div class="stat-label">Возможные дубликаты</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(239, 68, 68, 0.10); color: #ef4444;">
            <v-icon icon="mdi-alert-circle-outline" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ errorCount }}</div>
            <div class="stat-label">С ошибками</div>
          </div>
        </div>
      </div>

      <!-- Errors hint banner — shown until all errors are fixed or skipped -->
      <div v-if="errorCount > 0" class="errors-banner mb-4">
        <div class="errors-banner-icon">
          <v-icon icon="mdi-alert-circle-outline" size="20" />
        </div>
        <div class="errors-banner-text">
          <div class="errors-banner-title">
            Импорт недоступен — есть {{ errorCount }} {{ pluralize(errorCount, 'строка', 'строки', 'строк') }} с ошибками
          </div>
          <div class="errors-banner-sub">
            Исправьте данные в красных ячейках или нажмите «Пропустить ошибки», чтобы исключить эти строки из импорта.
          </div>
        </div>
        <button
          class="errors-banner-cta"
          :disabled="saving"
          @click="filterMode = 'errors'"
        >
          Показать ошибки
          <v-icon icon="mdi-arrow-right" size="14" />
        </button>
      </div>

      <!-- Toolbar: filters left, bulk-assignments + actions right -->
      <div class="toolbar mb-4">
        <div class="filter-pills">
          <button
            class="filter-pill"
            :class="{ active: filterMode === 'all' }"
            @click="filterMode = 'all'"
          >
            Все <span class="filter-pill-count">{{ rows.length }}</span>
          </button>
          <button
            class="filter-pill"
            :class="{ active: filterMode === 'ready' }"
            :disabled="readyCount === 0"
            @click="filterMode = 'ready'"
          >
            Готовы <span class="filter-pill-count">{{ readyCount }}</span>
          </button>
          <button
            class="filter-pill"
            :class="{ active: filterMode === 'duplicates' }"
            :disabled="duplicatesCount === 0"
            @click="filterMode = 'duplicates'"
          >
            Дубликаты <span class="filter-pill-count">{{ duplicatesCount }}</span>
          </button>
          <button
            class="filter-pill"
            :class="{ active: filterMode === 'errors' }"
            :disabled="errorCount === 0"
            @click="filterMode = 'errors'"
          >
            Ошибки <span class="filter-pill-count">{{ errorCount }}</span>
          </button>
        </div>

        <v-spacer />

        <!-- Bulk: folder -->
        <v-menu :close-on-content-click="true" location="bottom end">
          <template #activator="{ props: menuProps }">
            <button v-bind="menuProps" class="assign-btn" :class="{ 'assign-btn--mixed': folderLabel?.kind === 'mixed', 'assign-btn--set': folderLabel?.kind === 'all' && folderLabel.text !== 'Без папки' }">
              <v-icon icon="mdi-folder-outline" size="15" class="assign-btn-icon" />
              <template v-if="folderLabel?.kind === 'all' && 'color' in folderLabel && folderLabel.color">
                <span class="assign-btn-dot" :style="{ background: folderLabel.color }" />
                <span class="assign-btn-text">{{ folderLabel.text }}</span>
              </template>
              <template v-else-if="folderLabel?.kind === 'mixed'">
                <span class="assign-btn-text">{{ folderLabel.text }}</span>
                <span class="assign-btn-badge">{{ folderLabel.distinct }}</span>
              </template>
              <template v-else>
                <span class="assign-btn-text assign-btn-text--placeholder">Папка</span>
              </template>
              <v-icon icon="mdi-chevron-down" size="13" class="assign-btn-caret" />
            </button>
          </template>
          <v-card rounded="lg" elevation="4" class="assign-menu">
            <div class="assign-menu-header">
              <v-icon icon="mdi-folder-outline" size="14" />
              <span>Папка для всех строк</span>
            </div>
            <div class="assign-menu-body">
              <button class="assign-menu-item" :class="{ 'assign-menu-item--active': folderState.allSame && folderState.value === null }" @click="applyBulk('folderId', null)">
                <v-icon icon="mdi-folder-off-outline" size="16" class="assign-menu-item-icon" />
                <span class="assign-menu-item-name">Без папки</span>
                <v-icon v-if="folderState.allSame && folderState.value === null" icon="mdi-check" size="14" class="assign-menu-item-check" />
              </button>
              <div v-if="folders.length" class="assign-menu-divider" />
              <button
                v-for="f in folders" :key="f.id"
                class="assign-menu-item"
                :class="{ 'assign-menu-item--active': folderState.allSame && folderState.value === f.id }"
                @click="applyBulk('folderId', f.id)"
              >
                <span class="assign-menu-item-dot" :style="{ background: f.color }" />
                <span class="assign-menu-item-name">{{ f.name }}</span>
                <v-icon v-if="folderState.allSame && folderState.value === f.id" icon="mdi-check" size="14" class="assign-menu-item-check" />
              </button>
              <div class="assign-menu-divider" />
              <button class="assign-menu-create" @click="showFolderDialog = true">
                <v-icon icon="mdi-plus" size="14" />
                Создать папку
              </button>
            </div>
          </v-card>
        </v-menu>

        <!-- Bulk: co-investor -->
        <v-menu :close-on-content-click="true" location="bottom end">
          <template #activator="{ props: menuProps }">
            <button v-bind="menuProps" class="assign-btn" :class="{ 'assign-btn--mixed': coInvestorLabel?.kind === 'mixed', 'assign-btn--set': coInvestorLabel?.kind === 'all' && coInvestorLabel.text !== 'Без со-инвестора' }">
              <v-icon icon="mdi-account-cash-outline" size="15" class="assign-btn-icon" />
              <template v-if="coInvestorLabel?.kind === 'all' && coInvestorLabel.text !== 'Без со-инвестора'">
                <span class="assign-btn-text">{{ coInvestorLabel.text }}</span>
                <span v-if="'subtitle' in coInvestorLabel && coInvestorLabel.subtitle" class="assign-btn-sub">{{ coInvestorLabel.subtitle }}</span>
              </template>
              <template v-else-if="coInvestorLabel?.kind === 'mixed'">
                <span class="assign-btn-text">{{ coInvestorLabel.text }}</span>
                <span class="assign-btn-badge">{{ coInvestorLabel.distinct }}</span>
              </template>
              <template v-else>
                <span class="assign-btn-text assign-btn-text--placeholder">Со-инвестор</span>
              </template>
              <v-icon icon="mdi-chevron-down" size="13" class="assign-btn-caret" />
            </button>
          </template>
          <v-card rounded="lg" elevation="4" class="assign-menu">
            <div class="assign-menu-header">
              <v-icon icon="mdi-account-cash-outline" size="14" />
              <span>Со-инвестор для всех строк</span>
            </div>
            <div class="assign-menu-body">
              <button class="assign-menu-item" :class="{ 'assign-menu-item--active': coInvestorState.allSame && coInvestorState.value === null }" @click="applyBulk('coInvestorId', null)">
                <v-icon icon="mdi-account-off-outline" size="16" class="assign-menu-item-icon" />
                <span class="assign-menu-item-name">Без со-инвестора</span>
                <v-icon v-if="coInvestorState.allSame && coInvestorState.value === null" icon="mdi-check" size="14" class="assign-menu-item-check" />
              </button>
              <div v-if="coInvestors.length" class="assign-menu-divider" />
              <button
                v-for="c in coInvestors" :key="c.id"
                class="assign-menu-item"
                :class="{ 'assign-menu-item--active': coInvestorState.allSame && coInvestorState.value === c.id }"
                @click="applyBulk('coInvestorId', c.id)"
              >
                <v-icon icon="mdi-account-circle-outline" size="16" class="assign-menu-item-icon" />
                <span class="assign-menu-item-name">{{ c.name }}</span>
                <span class="assign-menu-item-meta">{{ c.profitPercent }}%</span>
                <v-icon v-if="coInvestorState.allSame && coInvestorState.value === c.id" icon="mdi-check" size="14" class="assign-menu-item-check" />
              </button>
              <div class="assign-menu-divider" />
              <button class="assign-menu-create" @click="showCoInvestorDialog = true">
                <v-icon icon="mdi-plus" size="14" />
                Создать со-инвестора
              </button>
            </div>
          </v-card>
        </v-menu>

        <div class="toolbar-sep" />

        <button
          v-if="errorCount > 0"
          class="tb-btn tb-btn--ghost"
          :disabled="saving"
          @click="skipAllErrors"
        >
          <v-icon icon="mdi-eye-off-outline" size="14" />
          Пропустить ошибки
          <span class="tb-btn-count">{{ errorCount }}</span>
        </button>

        <button
          v-if="pendingPatches.length"
          class="tb-btn tb-btn--save"
          :disabled="saving"
          @click="flushPatches"
        >
          <v-icon icon="mdi-content-save" size="14" />
          Сохранить
          <span class="tb-btn-count">{{ pendingPatches.length }}</span>
        </button>

        <button
          class="tb-btn"
          :disabled="saving || committing"
          @click="onAddRow"
        >
          <v-icon icon="mdi-plus" size="14" />
          Добавить строку
        </button>

        <button
          class="tb-btn tb-btn--danger"
          :disabled="committing"
          @click="onCancel"
        >
          <v-icon icon="mdi-close" size="14" />
          Отменить
        </button>
      </div>

      <!-- Table card -->
      <v-card rounded="lg" elevation="0" border class="grid-card">
        <AgGridVue
          :class="['import-grid', isDark ? 'ag-theme-quartz-dark' : 'ag-theme-quartz']"
          style="width: 100%; height: 60vh; min-height: 420px;"
          :column-defs="columnDefs"
          :row-data="visibleRows"
          :get-row-class="getRowClass"
          :get-row-id="getRowId"
          :default-col-def="defaultColDef"
          :row-height="48"
          :header-height="44"
          :group-header-height="36"
          :animate-rows="false"
          :stop-editing-when-cells-lose-focus="true"
          :tooltip-show-delay="400"
          @cell-value-changed="onCellChanged"
        />
      </v-card>

      <!-- Action bar -->
      <div class="action-bar mt-5">
        <div class="action-summary">
          <div class="action-summary-item">
            <span class="action-summary-dot" style="background: #047857;" />
            <span class="action-summary-label">Создать</span>
            <span class="action-summary-value">{{ draft.stats.byAction.create }}</span>
          </div>
          <div class="action-summary-item">
            <span class="action-summary-dot" style="background: #3b82f6;" />
            <span class="action-summary-label">Обновить</span>
            <span class="action-summary-value">{{ draft.stats.byAction.update }}</span>
          </div>
          <div class="action-summary-item">
            <span class="action-summary-dot" style="background: rgba(127,127,127,0.5);" />
            <span class="action-summary-label">Пропустить</span>
            <span class="action-summary-value">{{ draft.stats.byAction.skip }}</span>
          </div>
        </div>
        <v-spacer />

        <v-tooltip v-if="!canCommit" location="top">
          <template #activator="{ props }">
            <button v-bind="props" class="commit-btn commit-btn--disabled" disabled>
              <v-icon icon="mdi-upload" size="18" />
              <span>Импортировать</span>
            </button>
          </template>
          {{ commitBlockReason }}
        </v-tooltip>

        <button
          v-else
          class="commit-btn"
          :disabled="committing"
          @click="onCommit"
        >
          <v-progress-circular v-if="committing" indeterminate size="16" width="2" color="white" />
          <v-icon v-else icon="mdi-upload" size="18" />
          <span>{{ committing ? 'Импортируем…' : 'Импортировать' }}</span>
          <span v-if="!committing" class="commit-btn-count">{{ readyCount }}</span>
        </button>
      </div>
    </template>

    <!-- Inline create dialogs — created entity is auto-applied to all rows -->
    <FolderCreateDialog v-model="showFolderDialog" @created="onFolderCreated" />
    <CoInvestorCreateDialog v-model="showCoInvestorDialog" @created="onCoInvestorCreated" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AgGridVue } from 'ag-grid-vue3'
import type {
  ColDef, ColGroupDef, CellClassParams, CellValueChangedEvent, RowClassParams,
} from 'ag-grid-community'
import { useImportDraft, type DraftRow, type RowAction } from '@/composables/useImportDraft'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useFolders } from '@/composables/useFolders'
import { useCoInvestors } from '@/composables/useCoInvestors'
import FolderCreateDialog from '@/components/FolderCreateDialog.vue'
import CoInvestorCreateDialog from '@/components/CoInvestorCreateDialog.vue'
import { formatDateShort } from '@/utils/formatters'
import type { DealFolder, CoInvestor } from '@/types'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'

const route = useRoute()
const router = useRouter()
const { draft, loading, saving, committing, fetchDraft, savePatches, commit, cancel, addRow, deleteRow } = useImportDraft()
const { show: showToast } = useToast()
const { isDark } = useIsDark()
const { folders, fetchFolders } = useFolders()
const { coInvestors, fetchCoInvestors } = useCoInvestors()

const draftId = computed(() => route.params.id as string)
const rows = computed<DraftRow[]>(() => draft.value?.normalizedData ?? [])

const filterMode = ref<'all' | 'ready' | 'duplicates' | 'errors'>('all')

const visibleRows = computed<DraftRow[]>(() => {
  const list = rows.value
  if (filterMode.value === 'ready') return list.filter((r) => r.action !== 'skip' && r.errors.length === 0)
  if (filterMode.value === 'duplicates') return list.filter((r) => !!r.duplicate)
  if (filterMode.value === 'errors') return list.filter((r) => r.errors.length > 0)
  return list
})

const readyCount = computed(() =>
  rows.value.filter((r) => r.action !== 'skip' && r.errors.length === 0).length,
)
const errorCount = computed(() => rows.value.filter((r) => r.errors.length > 0).length)
const duplicatesCount = computed(() => rows.value.filter((r) => !!r.duplicate).length)

// ── Aggregate state for folder/coInvestor across all rows ──
function aggregateField<K extends 'folderId' | 'coInvestorId'>(field: K) {
  return computed(() => {
    const total = rows.value.length
    if (total === 0) return { total: 0, allSame: true, value: null, topCount: 0, distinct: 0 }
    const counts = new Map<string | null, number>()
    for (const r of rows.value) {
      const k = (r[field] as string | null | undefined) ?? null
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    let topKey: string | null = null
    let topCount = 0
    for (const [k, v] of counts) {
      if (v > topCount) { topCount = v; topKey = k }
    }
    return {
      total,
      allSame: counts.size === 1,
      value: topKey,
      topCount,
      distinct: counts.size,
    }
  })
}

const folderState = aggregateField('folderId')
const coInvestorState = aggregateField('coInvestorId')

const folderLabel = computed(() => {
  const s = folderState.value
  if (s.total === 0) return null
  if (s.allSame) {
    if (s.value === null) return { kind: 'empty' as const, text: 'Без папки' }
    const f = folders.value.find((x) => x.id === s.value)
    return { kind: 'all' as const, text: f?.name ?? '?', color: f?.color, icon: f?.icon ?? 'mdi-folder' }
  }
  // Mixed
  const main = s.value !== null ? folders.value.find((x) => x.id === s.value) : null
  return {
    kind: 'mixed' as const,
    text: main ? `${main.name} · ${s.topCount} из ${s.total}` : `Без папки · ${s.topCount} из ${s.total}`,
    color: main?.color,
    icon: main?.icon ?? 'mdi-folder',
    distinct: s.distinct,
  }
})

const coInvestorLabel = computed(() => {
  const s = coInvestorState.value
  if (s.total === 0) return null
  if (s.allSame) {
    if (s.value === null) return { kind: 'empty' as const, text: 'Без со-инвестора' }
    const c = coInvestors.value.find((x) => x.id === s.value)
    return { kind: 'all' as const, text: c?.name ?? '?', subtitle: c ? `${c.profitPercent}%` : '' }
  }
  const main = s.value !== null ? coInvestors.value.find((x) => x.id === s.value) : null
  return {
    kind: 'mixed' as const,
    text: main ? `${main.name} · ${s.topCount} из ${s.total}` : `Без со-инвестора · ${s.topCount} из ${s.total}`,
    distinct: s.distinct,
  }
})

const canCommit = computed(() => {
  if (!draft.value) return false
  if (readyCount.value === 0) return false
  return !rows.value.some((r) => r.action !== 'skip' && r.errors.length > 0)
})

const commitBlockReason = computed(() => {
  if (readyCount.value === 0) return 'Нет строк готовых к импорту'
  const blocking = rows.value.filter((r) => r.action !== 'skip' && r.errors.length > 0).length
  return `${blocking} ${pluralize(blocking, 'строка', 'строки', 'строк')} с ошибками — исправьте или пометьте «Пропустить»`
})

function pluralize(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

// ── Debounced patch queue ──
const pendingPatches = ref<{ rowIdx: number; data: Partial<DraftRow> }[]>([])
let flushTimer: ReturnType<typeof setTimeout> | null = null

function queuePatch(rowIdx: number, data: Partial<DraftRow>) {
  const existing = pendingPatches.value.find((p) => p.rowIdx === rowIdx)
  if (existing) Object.assign(existing.data, data)
  else pendingPatches.value.push({ rowIdx, data })
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flushPatches, 1000)
}

async function flushPatches() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (!pendingPatches.value.length) return
  const patches = [...pendingPatches.value]
  pendingPatches.value = []
  try {
    await savePatches(draftId.value, patches)
  } catch (e: any) {
    showToast(e.message || 'Не удалось сохранить правки', 'error')
    pendingPatches.value.unshift(...patches)
  }
}

async function skipAllErrors() {
  const patches = rows.value
    .filter((r) => r.errors.length > 0 && r.action !== 'skip')
    .map((r) => ({ rowIdx: r.rowIdx, data: { action: 'skip' as RowAction } }))
  if (!patches.length) return
  try {
    await savePatches(draftId.value, patches)
    showToast(`Пропущено ${patches.length} ${pluralize(patches.length, 'строка', 'строки', 'строк')} с ошибками`, 'success')
  } catch (e: any) {
    showToast(e.message || 'Не удалось применить', 'error')
  }
}

async function onAddRow() {
  // Flush any in-flight edits first so the new blank row doesn't land in a
  // stale snapshot. Then add server-side and reset the rowIdx counter.
  if (pendingPatches.value.length) await flushPatches()
  try {
    await addRow(draftId.value)
    showToast('Добавлена пустая строка — заполните её', 'success')
  } catch (e: any) {
    showToast(e.message || 'Не удалось добавить строку', 'error')
  }
}

async function onDeleteRow(rowIdx: number) {
  if (!confirm('Удалить эту строку из черновика? Действие не отменить.')) return
  // Drop any pending patch that targets this row — it would 404 server-side
  // after the delete since rowIdx no longer exists.
  pendingPatches.value = pendingPatches.value.filter((p) => p.rowIdx !== rowIdx)
  try {
    await deleteRow(draftId.value, rowIdx)
    showToast('Строка удалена', 'success')
  } catch (e: any) {
    showToast(e.message || 'Не удалось удалить строку', 'error')
  }
}

// ── Inline create dialogs ──
const showFolderDialog = ref(false)
const showCoInvestorDialog = ref(false)

async function onFolderCreated(folder: DealFolder) {
  // Apply newly created folder to all rows
  await applyBulk('folderId', folder.id)
}

async function onCoInvestorCreated(coInvestor: CoInvestor) {
  await applyBulk('coInvestorId', coInvestor.id)
}

async function applyBulk(field: 'folderId' | 'coInvestorId', value: string | null) {
  // Flush any pending edits first so they don't overwrite the bulk
  await flushPatches()
  const patches = rows.value.map((r) => ({ rowIdx: r.rowIdx, data: { [field]: value } as Partial<DraftRow> }))
  try {
    await savePatches(draftId.value, patches)
    // No toast — current state is visible in the bulk-row chips
  } catch (e: any) {
    showToast(e.message || 'Не удалось применить', 'error')
  }
}

// ── Column defs ──
const ACTION_OPTIONS: { value: RowAction; label: string }[] = [
  { value: 'create', label: 'Создать' },
  { value: 'update', label: 'Обновить' },
  { value: 'skip', label: 'Пропустить' },
]

const cellHasError = (params: CellClassParams, field: string): boolean => {
  const row = params.data as DraftRow
  return !!row?.errors?.some((e) => e.field === field)
}

const moneyFmt = (v: number | null | undefined) =>
  v == null ? '' : new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽'

const numberParser = (params: any) => {
  const v = params.newValue
  if (v == null || v === '') return null
  const num = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'))
  return Number.isFinite(num) ? num : null
}

const dateParser = (params: any) => {
  const v = params.newValue
  if (!v) return null
  const str = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
  const m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
  if (m) {
    const year = m[3].length === 2 ? '20' + m[3] : m[3]
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

const errorTooltip = (params: any) => {
  const row = params.data as DraftRow
  const err = row?.errors?.find((e) => e.field === params.colDef.field)
  return err?.message
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const maxPayments = computed(() => {
  let max = 0
  for (const r of rows.value) {
    const cnt = Math.max(r.payments?.length ?? 0, r.numberOfPayments ?? 0)
    if (cnt > max) max = cnt
  }
  return max
})

function ensurePayment(row: DraftRow, idx: number) {
  if (!row.payments) row.payments = []
  while (row.payments.length <= idx) {
    row.payments.push({ number: row.payments.length + 1 })
  }
  return row.payments[idx]
}

function buildPaymentColumns(): ColGroupDef[] {
  const groups: ColGroupDef[] = []
  for (let i = 0; i < maxPayments.value; i++) {
    groups.push({
      headerName: `Платёж ${i + 1}`,
      marryChildren: true,
      children: [
        {
          headerName: 'Дата',
          colId: `payments_${i}_dueDate`,
          width: 110,
          editable: true,
          valueGetter: (p: any) => {
            const pay = (p.data as DraftRow)?.payments?.[i]
            return pay?.paidAt ?? pay?.dueDate ?? ''
          },
          valueSetter: (p: any) => {
            const row = p.data as DraftRow
            const next = ensurePayment(row, i)
            const parsed = dateParser({ newValue: p.newValue }) || undefined
            // If this payment was paid, update paidAt; else update dueDate
            if (next.paidAt) next.paidAt = parsed
            else next.dueDate = parsed
            queuePatch(row.rowIdx, { payments: [...row.payments!] })
            return true
          },
          cellClass: (p: any) =>
            (p.data as DraftRow)?.payments?.[i]?.paidAt ? 'cell-payment-paid' : '',
          tooltipValueGetter: (p: any) =>
            (p.data as DraftRow)?.payments?.[i]?.paidAt ? 'Оплачен' : 'Ожидается',
        },
        {
          headerName: 'Сумма',
          colId: `payments_${i}_amount`,
          width: 110,
          type: 'numericColumn',
          editable: true,
          valueGetter: (p: any) => {
            const pay = (p.data as DraftRow)?.payments?.[i]
            return pay?.paidAmount ?? pay?.amount ?? null
          },
          valueSetter: (p: any) => {
            const row = p.data as DraftRow
            const next = ensurePayment(row, i)
            const num = numberParser({ newValue: p.newValue }) ?? undefined
            // Update both — they're synced for paid payments
            next.amount = num
            if (next.paidAt) next.paidAmount = num
            queuePatch(row.rowIdx, { payments: [...row.payments!] })
            return true
          },
          valueFormatter: (p: any) => moneyFmt(p.value),
          cellClass: (p: any) =>
            (p.data as DraftRow)?.payments?.[i]?.paidAt ? 'cell-payment-paid' : '',
        },
      ],
    })
  }
  return groups
}

const columnDefs = computed<(ColDef | ColGroupDef)[]>(() => {
  const errRules = (field: string) => ({
    cellClassRules: { 'cell-error': (p: CellClassParams) => cellHasError(p, field) },
    tooltipValueGetter: errorTooltip,
  })

  const baseCols: (ColDef | ColGroupDef)[] = [
    {
      headerName: '#',
      valueGetter: (p: any) => (p.node?.rowIndex ?? 0) + 1,
      width: 54,
      pinned: 'left',
      editable: false,
      sortable: false,
      filter: false,
      suppressHeaderMenuButton: true,
      cellClass: 'cell-index',
    },
    {
      headerName: 'Статус',
      field: 'action',
      width: 130,
      pinned: 'left',
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: ACTION_OPTIONS.map((o) => o.value) },
      valueFormatter: (p: any) => ACTION_OPTIONS.find((o) => o.value === p.value)?.label ?? p.value,
      cellClassRules: {
        'cell-action-create': (p: any) => p.value === 'create',
        'cell-action-update': (p: any) => p.value === 'update',
        'cell-action-skip': (p: any) => p.value === 'skip',
      },
      suppressHeaderMenuButton: true,
    },
    {
      headerName: 'Замечание',
      width: 220,
      editable: false,
      valueGetter: (p: any) => {
        const row = p.data as DraftRow
        if (row.errors?.length) {
          return row.errors[0].message + (row.errors.length > 1 ? ` (+${row.errors.length - 1})` : '')
        }
        if (row.duplicate) {
          return row.duplicate.reason === 'externalId'
            ? 'Тот же ID уже есть'
            : 'Тот же клиент + товар + дата'
        }
        return ''
      },
      cellClassRules: {
        'cell-error': (p: any) => !!(p.data as DraftRow)?.errors?.length,
        'cell-duplicate': (p: any) => !!(p.data as DraftRow)?.duplicate && !(p.data as DraftRow).errors?.length,
      },
      tooltipValueGetter: (p: any) => {
        const row = p.data as DraftRow
        if (row.errors?.length) return row.errors.map((e) => e.message).join(' • ')
        return ''
      },
      suppressHeaderMenuButton: true,
    },
    { headerName: 'ФИО', field: 'clientName', width: 200, ...errRules('clientName') },
    { headerName: 'Телефон', field: 'clientPhone', width: 140, ...errRules('clientPhone') },
    { headerName: 'Товар', field: 'productName', width: 200, ...errRules('productName') },
    {
      headerName: 'Дата сделки',
      field: 'dealDate',
      width: 130,
      valueParser: dateParser,
      headerTooltip: 'Дата заключения сделки (когда товар передан клиенту)',
      ...errRules('dealDate'),
    },
    {
      headerName: 'Дата 1-го платежа',
      field: 'firstPaymentDate',
      width: 150,
      valueParser: dateParser,
      headerTooltip: 'Дата первого платежа клиента. Если не указана — берётся через месяц от даты сделки.',
      ...errRules('firstPaymentDate'),
    },
    {
      headerName: 'Закупка',
      field: 'purchasePrice',
      width: 120,
      type: 'numericColumn',
      valueParser: numberParser,
      valueFormatter: (p: any) => moneyFmt(p.value),
      ...errRules('purchasePrice'),
    },
    {
      headerName: 'Цена продажи',
      field: 'totalPrice',
      width: 130,
      type: 'numericColumn',
      valueParser: numberParser,
      valueFormatter: (p: any) => moneyFmt(p.value),
      ...errRules('totalPrice'),
    },
    {
      headerName: 'Взнос',
      field: 'downPayment',
      width: 110,
      type: 'numericColumn',
      valueParser: numberParser,
      valueFormatter: (p: any) => moneyFmt(p.value),
    },
    {
      headerName: 'Срок',
      field: 'numberOfPayments',
      width: 80,
      type: 'numericColumn',
      valueParser: numberParser,
      ...errRules('numberOfPayments'),
    },
    {
      headerName: 'Папка',
      field: 'folderId',
      width: 170,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: () => ({
        values: [null, ...folders.value.map((f) => f.id)],
      }),
      valueFormatter: (p: any) => {
        if (!p.value) return '—'
        return folders.value.find((f) => f.id === p.value)?.name ?? '?'
      },
      cellRenderer: (p: any) => {
        if (!p.value) {
          return '<span style="color: rgba(127,127,127,0.5);">—</span>'
        }
        const f = folders.value.find((x) => x.id === p.value)
        if (!f) return '?'
        return `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${f.color};display:inline-block;"></span><span>${escapeHtml(f.name)}</span></span>`
      },
      cellClass: 'cell-assignment',
      headerTooltip: 'Папка для группировки сделок. Можно изменить после импорта.',
    },
    {
      headerName: 'Со-инвестор',
      field: 'coInvestorId',
      width: 200,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: () => ({
        values: [null, ...coInvestors.value.map((c) => c.id)],
      }),
      valueFormatter: (p: any) => {
        if (!p.value) return '—'
        return coInvestors.value.find((c) => c.id === p.value)?.name ?? '?'
      },
      cellRenderer: (p: any) => {
        if (!p.value) {
          return '<span style="color: rgba(127,127,127,0.5);">—</span>'
        }
        const c = coInvestors.value.find((x) => x.id === p.value)
        if (!c) return '?'
        return `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:6px;height:6px;border-radius:50%;background:#047857;display:inline-block;"></span><span>${escapeHtml(c.name)}</span><span style="font-size:11px;color:rgba(127,127,127,0.7);">${c.profitPercent}%</span></span>`
      },
      cellClass: 'cell-assignment',
      headerTooltip: 'Со-инвестор, делящий прибыль по этой сделке.',
    },
  ]
  // Trailing actions column — pinned right so the delete button is always
  // visible even on wide tables.
  const actionsCol: ColDef = {
    headerName: '',
    width: 56,
    pinned: 'right',
    editable: false,
    sortable: false,
    filter: false,
    suppressHeaderMenuButton: true,
    cellClass: 'cell-row-actions',
    cellRenderer: (p: any) => {
      const btn = document.createElement('button')
      btn.className = 'row-delete-btn'
      btn.title = 'Удалить строку'
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z" /></svg>'
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const rowIdx = p.data?.rowIdx
        if (typeof rowIdx === 'number') onDeleteRow(rowIdx)
      })
      return btn
    },
  }

  return [...baseCols, ...buildPaymentColumns(), actionsCol]
})

const defaultColDef: ColDef = {
  editable: true,
  resizable: true,
  sortable: true,
  filter: false,
  suppressHeaderMenuButton: true,
}

const getRowId = (params: any) => String((params.data as DraftRow).rowIdx)

const getRowClass = (params: RowClassParams) => {
  const row = params.data as DraftRow
  if (row?.action === 'skip') return 'row-skip'
  if (row?.errors?.length) return 'row-error'
  if (row?.duplicate) return 'row-duplicate'
  return ''
}

function onCellChanged(e: CellValueChangedEvent) {
  const row = e.data as DraftRow
  const field = e.colDef.field
  if (!field) return
  queuePatch(row.rowIdx, { [field]: e.newValue } as Partial<DraftRow>)
}

async function onCommit() {
  await flushPatches()
  if (!canCommit.value) {
    showToast(commitBlockReason.value, 'warning')
    return
  }
  try {
    const res = await commit(draftId.value)
    showToast(
      `Импорт завершён: создано ${res.created}, обновлено ${res.updated}, пропущено ${res.skipped}`,
      'success',
    )
    router.push('/deals')
  } catch (e: any) {
    showToast(e.message || 'Не удалось импортировать', 'error')
  }
}

async function onCancel() {
  if (!confirm('Отменить черновик? Данные не будут импортированы.')) return
  try {
    await cancel(draftId.value)
    router.push('/import')
  } catch (e: any) {
    showToast(e.message || 'Не удалось отменить', 'error')
  }
}

onMounted(() => {
  fetchDraft(draftId.value).catch((e: any) => {
    showToast(e.message || 'Не удалось загрузить черновик', 'error')
    router.push('/import')
  })
  fetchFolders()
  fetchCoInvestors()
})

onBeforeUnmount(() => {
  if (flushTimer) clearTimeout(flushTimer)
  if (pendingPatches.value.length) flushPatches()
})

watch(() => route.params.id, (id) => {
  if (id) fetchDraft(id as string)
})
</script>

<style scoped>
/* Stats grid — matches payments.vue */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .stats-row { grid-template-columns: 1fr; } }

.stat-card {
  display: flex; align-items: center; gap: 12px;
  padding: 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.dark .stat-card {
  background: #1e1e2e;
  border-color: #2e2e42;
}
.stat-icon {
  width: 40px; height: 40px; min-width: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.stat-value {
  font-size: 18px; font-weight: 700; line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.stat-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Errors hint banner */
.errors-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; border-radius: 12px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.20);
}
.errors-banner-icon {
  width: 38px; height: 38px; min-width: 38px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(239, 68, 68, 0.10);
  color: #ef4444;
  flex-shrink: 0;
}
.errors-banner-text { flex: 1; min-width: 0; }
.errors-banner-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.errors-banner-sub {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6);
  margin-top: 3px; line-height: 1.45;
}
.errors-banner-cta {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 9px; border: 1px solid rgba(239, 68, 68, 0.30);
  background: rgb(var(--v-theme-surface));
  color: #ef4444; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  font-family: inherit; flex-shrink: 0;
  white-space: nowrap;
}
.errors-banner-cta:hover {
  background: rgba(239, 68, 68, 0.08);
}
.errors-banner-cta:disabled { opacity: 0.5; cursor: not-allowed; }
.dark .errors-banner-cta {
  background: #1e1e2e;
}

/* Per-row delete button in actions column */
.row-delete-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px; border: none;
  background: transparent;
  color: rgba(127, 127, 127, 0.55);
  cursor: pointer; transition: all 0.12s;
}
.row-delete-btn:hover {
  background: rgba(239, 68, 68, 0.10);
  color: #ef4444;
}

/* Filter pills */
.filter-pills {
  display: inline-flex;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}
.dark .filter-pills {
  background: #1e1e2e;
  border-color: #2e2e42;
}
.filter-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 7px; border: none;
  background: transparent;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.filter-pill:hover:not(:disabled):not(.active) {
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.filter-pill.active {
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.dark .filter-pill.active { background: #2a2a3e; }
.filter-pill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.filter-pill-count {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-weight: 500;
}
.filter-pill.active .filter-pill-count {
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/* ─── Page header ─── */
.page-header {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.page-header-back-btn {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 6px 12px 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  text-decoration: none;
  transition: all 0.15s;
  flex-shrink: 0;
}
.page-header-back-btn:hover {
  border-color: rgba(var(--v-theme-primary), 0.30);
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.04);
}
.page-header-title {
  display: flex; align-items: center; gap: 10px;
  min-width: 0; flex: 1 1 auto;
}
.page-header-icon { color: rgba(var(--v-theme-on-surface), 0.4); flex-shrink: 0; }
.page-header-name {
  font-size: 20px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
  line-height: 1.2;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.page-header-meta {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
  flex-shrink: 0;
}
.page-header-meta-item { display: inline-flex; align-items: center; gap: 4px; }
.page-header-meta-dot { opacity: 0.4; }

/* ─── Unified toolbar ─── */
.toolbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.toolbar-sep {
  width: 1px; height: 22px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  margin: 0 2px;
}

/* Assign buttons (folder, co-investor) — same family as toolbar buttons */
.assign-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px 6px 11px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  max-width: 240px;
}
.assign-btn:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
  background: rgba(var(--v-theme-primary), 0.04);
}
.assign-btn--set {
  border-color: rgba(4, 120, 87, 0.30);
  background: rgb(var(--v-theme-surface));
  color: #047857;
}
.assign-btn--set:hover {
  border-color: rgba(4, 120, 87, 0.50);
  background: rgba(4, 120, 87, 0.04);
}
.dark .assign-btn--set { color: #34d399; border-color: rgba(74, 222, 128, 0.30); }
.assign-btn--mixed {
  border-color: rgba(245, 158, 11, 0.35);
  background: rgb(var(--v-theme-surface));
}
.assign-btn--mixed:hover {
  border-color: rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.04);
}
.assign-btn-icon { color: currentColor; opacity: 0.7; flex-shrink: 0; }
.assign-btn-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
}
.assign-btn-text {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-weight: 600;
}
.assign-btn-text--placeholder {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-weight: 500;
}
.assign-btn-sub {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-left: -2px;
}
.assign-btn--set .assign-btn-sub { color: rgba(4, 120, 87, 0.7); }
.dark .assign-btn--set .assign-btn-sub { color: rgba(74, 222, 128, 0.65); }
.assign-btn-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.18);
  color: #b45309;
  font-size: 10px; font-weight: 700;
}
.dark .assign-btn-badge { background: rgba(245, 158, 11, 0.22); color: #fbbf24; }
.assign-btn-caret {
  opacity: 0.4;
  margin-left: 1px;
}

/* Assign menu */
.assign-menu { min-width: 260px; padding: 4px; }
.assign-menu-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px 6px;
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.assign-menu-body { display: flex; flex-direction: column; padding: 0 2px 2px; }
.assign-menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  border: none; background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  cursor: pointer; text-align: left;
  font-family: inherit;
  transition: background 0.1s;
}
.assign-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.assign-menu-item--active {
  background: rgba(4, 120, 87, 0.08);
  color: #047857;
  font-weight: 600;
}
.dark .assign-menu-item--active { background: rgba(74, 222, 128, 0.10); color: #34d399; }
.assign-menu-item-icon { color: rgba(var(--v-theme-on-surface), 0.4); }
.assign-menu-item-dot {
  width: 10px; height: 10px; border-radius: 50%;
  flex-shrink: 0;
}
.assign-menu-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assign-menu-item-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-weight: 500;
}
.assign-menu-item-check { color: currentColor; }
.assign-menu-divider {
  height: 1px; margin: 4px 0;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.assign-menu-create {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px;
  border: none; background: transparent;
  border-radius: 6px;
  font-size: 13px; font-weight: 500;
  color: rgb(var(--v-theme-primary));
  cursor: pointer; text-align: left;
  font-family: inherit;
  transition: background 0.1s;
}
.assign-menu-create:hover { background: rgba(var(--v-theme-primary), 0.06); }

/* Toolbar buttons (skip, save, cancel) */
.tb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.tb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tb-btn-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 18px; padding: 0 5px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 10px; font-weight: 700;
  margin-left: 2px;
}
.tb-btn--ghost {
  border-color: rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.tb-btn--ghost:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-on-surface), 0.20);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.tb-btn--save {
  border-color: rgba(4, 120, 87, 0.25);
  background: rgba(4, 120, 87, 0.08);
  color: #047857;
}
.tb-btn--save:hover:not(:disabled) {
  background: rgba(4, 120, 87, 0.14);
}
.dark .tb-btn--save { color: #34d399; border-color: rgba(74, 222, 128, 0.25); background: rgba(74, 222, 128, 0.10); }
.tb-btn--save .tb-btn-count {
  background: rgba(4, 120, 87, 0.15);
  color: #047857;
}
.dark .tb-btn--save .tb-btn-count { background: rgba(74, 222, 128, 0.20); color: #34d399; }
.tb-btn--danger {
  border-color: rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.tb-btn--danger:hover:not(:disabled) {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.30);
  background: rgba(239, 68, 68, 0.04);
}

/* Grid card wrapper */
.grid-card {
  overflow: hidden;
}

/* Action bar at bottom */
.action-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.dark .action-bar {
  background: #1e1e2e;
  border-color: #2e2e42;
}

.action-summary {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
}
.action-summary-item {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px;
}
.action-summary-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
}
.action-summary-label {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-weight: 500;
}
.action-summary-value {
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* Commit button — primary CTA */
.commit-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 22px 11px 18px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(180deg, #047857 0%, #036647 100%);
  color: #fff;
  font-size: 14px; font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  box-shadow: 0 1px 2px rgba(4, 120, 87, 0.20), 0 4px 12px rgba(4, 120, 87, 0.18);
}
.commit-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, #065f46 0%, #044d36 100%);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(4, 120, 87, 0.25), 0 6px 16px rgba(4, 120, 87, 0.22);
}
.commit-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(4, 120, 87, 0.20);
}
.commit-btn:disabled, .commit-btn--disabled {
  background: rgba(var(--v-theme-on-surface), 0.08) !important;
  color: rgba(var(--v-theme-on-surface), 0.35) !important;
  box-shadow: none !important;
  transform: none !important;
  cursor: not-allowed;
}
.commit-btn-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 24px; height: 22px; padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.20);
  color: #fff;
  font-size: 12px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-left: 2px;
}
</style>

<style>
/* ──────────────────────────────────────────────────────────
   AG Grid — глубокая интеграция с Vuetify-темой партнёрки
   ────────────────────────────────────────────────────────── */
.import-grid.ag-theme-quartz,
.import-grid.ag-theme-quartz-dark {
  --ag-grid-size: 6px;
  --ag-font-size: 14px;
  --ag-font-family: inherit;
  --ag-border-radius: 0;
  --ag-wrapper-border-radius: 0;
  --ag-card-radius: 0;

  --ag-foreground-color: rgb(var(--v-theme-on-surface));
  --ag-background-color: rgb(var(--v-theme-surface));
  --ag-secondary-foreground-color: rgba(var(--v-theme-on-surface), 0.7);
  --ag-data-color: rgb(var(--v-theme-on-surface));

  --ag-border-color: rgba(var(--v-theme-on-surface), 0.10);
  --ag-row-border-color: rgba(var(--v-theme-on-surface), 0.08);
  --ag-cell-horizontal-border: solid rgba(var(--v-theme-on-surface), 0.06);
  --ag-header-column-separator-display: block;
  --ag-header-column-separator-color: rgba(var(--v-theme-on-surface), 0.10);
  --ag-header-column-separator-height: 60%;
  --ag-header-column-separator-width: 1px;

  --ag-header-background-color: transparent;
  --ag-header-foreground-color: rgba(var(--v-theme-on-surface), 0.5);
  --ag-header-cell-hover-background-color: rgba(var(--v-theme-on-surface), 0.04);

  --ag-odd-row-background-color: transparent;
  --ag-row-hover-color: rgba(var(--v-theme-primary), 0.04);
  --ag-selected-row-background-color: rgba(var(--v-theme-primary), 0.08);

  --ag-input-focus-border-color: rgb(var(--v-theme-primary));
  --ag-range-selection-border-color: rgb(var(--v-theme-primary));
  --ag-range-selection-background-color: rgba(var(--v-theme-primary), 0.10);

  --ag-control-panel-background-color: rgb(var(--v-theme-surface));
}

.import-grid .ag-root-wrapper { border: none !important; }
.import-grid .ag-header {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.dark .import-grid .ag-header { background: rgba(255, 255, 255, 0.02); }

.import-grid .ag-header-cell {
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.import-grid .ag-header-group-cell {
  font-size: 11px !important;
  font-weight: 700 !important;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(4, 120, 87) !important;
  background: rgba(4, 120, 87, 0.05);
  border-bottom: 1px solid rgba(4, 120, 87, 0.15);
}
.dark .import-grid .ag-header-group-cell {
  color: rgb(74, 222, 128) !important;
  background: rgba(74, 222, 128, 0.05);
  border-bottom-color: rgba(74, 222, 128, 0.15);
}

.import-grid .ag-row {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.import-grid .ag-cell {
  display: flex;
  align-items: center;
  line-height: 1.4;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.dark .import-grid .ag-row { border-bottom-color: rgba(255, 255, 255, 0.08); }
.dark .import-grid .ag-cell { border-right-color: rgba(255, 255, 255, 0.06); }
.import-grid .ag-cell:last-child { border-right: none; }
.import-grid .ag-header-cell {
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.dark .import-grid .ag-header-cell { border-right-color: rgba(255, 255, 255, 0.08); }
.import-grid .ag-header-cell:last-child { border-right: none; }

.import-grid .cell-index {
  color: rgba(var(--v-theme-on-surface), 0.35);
  font-size: 12px !important;
  font-weight: 500;
}

/* Pinned columns — soft shadow */
.import-grid .ag-pinned-left-cols-container,
.import-grid .ag-pinned-left-header {
  box-shadow: 1px 0 0 rgba(var(--v-theme-on-surface), 0.06);
}
.import-grid .ag-pinned-left-header { border-right: none !important; }

/* Numeric */
.import-grid .ag-cell.ag-right-aligned-cell { justify-content: flex-end; }
.import-grid .ag-header-cell.ag-right-aligned-header { justify-content: flex-end; }

/* Edit input */
.import-grid .ag-cell-inline-editing {
  height: 44px;
  border: 2px solid rgb(var(--v-theme-primary)) !important;
  border-radius: 6px;
  box-shadow: 0 0 0 4px rgba(var(--v-theme-primary), 0.12);
  padding: 0 !important;
}
.import-grid .ag-input-field-input { font-size: 14px !important; }

/* Semantic classes */
.import-grid .cell-error {
  background: rgba(239, 68, 68, 0.08) !important;
  color: rgb(185, 28, 28);
  font-weight: 500;
}
.import-grid .ag-theme-quartz-dark .cell-error,
.dark .import-grid .cell-error { color: rgb(252, 165, 165); }

.import-grid .cell-duplicate {
  background: rgba(245, 158, 11, 0.08) !important;
  color: rgb(180, 83, 9);
  font-weight: 500;
}
.dark .import-grid .cell-duplicate { color: rgb(253, 186, 116); }

.import-grid .cell-action-create { color: rgb(5, 150, 105); font-weight: 600; }
.import-grid .cell-action-update { color: rgb(37, 99, 235); font-weight: 600; }
.import-grid .cell-action-skip   { color: rgba(var(--v-theme-on-surface), 0.4); font-style: italic; }
.dark .import-grid .cell-action-create { color: rgb(74, 222, 128); }
.dark .import-grid .cell-action-update { color: rgb(96, 165, 250); }

.import-grid .cell-payment-paid {
  background: rgba(5, 150, 105, 0.07) !important;
  color: rgb(6, 95, 70);
  font-weight: 500;
}
.dark .import-grid .cell-payment-paid {
  background: rgba(74, 222, 128, 0.07) !important;
  color: rgb(134, 239, 172);
}

.import-grid .row-error .ag-cell:not(.cell-error):not(.cell-action-create):not(.cell-action-update):not(.cell-action-skip):not(.cell-payment-paid):not(.cell-index) {
  background: rgba(239, 68, 68, 0.02);
}
.import-grid .row-duplicate .ag-cell:not(.cell-duplicate):not(.cell-action-create):not(.cell-action-update):not(.cell-action-skip):not(.cell-payment-paid):not(.cell-index) {
  background: rgba(245, 158, 11, 0.02);
}
.import-grid .row-skip { opacity: 0.55; }
</style>
