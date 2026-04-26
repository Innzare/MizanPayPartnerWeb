<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Page header -->
    <div class="page-head mb-6">
      <div class="page-head-icon">
        <v-icon icon="mdi-cloud-upload-outline" size="22" />
      </div>
      <div class="page-head-text">
        <h1 class="page-head-title">Импорт продаж</h1>
        <div class="page-head-subtitle">Загрузите Excel или CSV — AI разберёт колонки, найдёт дубликаты и подготовит черновик к проверке</div>
      </div>
    </div>

    <!-- Hero block -->
    <v-card rounded="lg" elevation="0" border class="hero-card mb-6">
      <div class="hero-grid">
        <div class="hero-text">
          <div class="hero-eyebrow">
            <v-icon icon="mdi-flash" size="14" />
            Двухэтапный импорт
          </div>
          <h2 class="hero-title">Загрузите файл — система всё проверит</h2>
          <p class="hero-desc">
            Excel или CSV любого формата. AI распознает колонки, найдёт возможные дубликаты и
            подготовит черновик. Вы проверите данные, исправите ошибки и только потом импортируете.
          </p>

          <div class="hero-features">
            <div class="hero-feature">
              <div class="hero-feature-icon" style="background: rgba(99, 102, 241, 0.10); color: #6366f1;">
                <v-icon icon="mdi-robot-outline" size="16" />
              </div>
              <div class="hero-feature-content">
                <div class="hero-feature-title">AI-распознавание</div>
                <div class="hero-feature-desc">Любой формат таблицы</div>
              </div>
            </div>
            <div class="hero-feature">
              <div class="hero-feature-icon" style="background: rgba(245, 158, 11, 0.10); color: #f59e0b;">
                <v-icon icon="mdi-content-duplicate" size="16" />
              </div>
              <div class="hero-feature-content">
                <div class="hero-feature-title">Защита от дубликатов</div>
                <div class="hero-feature-desc">Сверка с базой</div>
              </div>
            </div>
            <div class="hero-feature">
              <div class="hero-feature-icon" style="background: rgba(4, 120, 87, 0.10); color: #047857;">
                <v-icon icon="mdi-check-decagram-outline" size="16" />
              </div>
              <div class="hero-feature-content">
                <div class="hero-feature-title">Контроль перед импортом</div>
                <div class="hero-feature-desc">Правка в редакторе</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Upload zone -->
        <div
          class="upload-zone"
          :class="{ 'upload-zone--drag': isDragging, 'upload-zone--loading': analyzing }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
          @click="!analyzing && pickFile()"
        >
          <div v-if="analyzing" class="upload-loading">
            <div class="upload-loading-spinner">
              <v-progress-circular indeterminate color="primary" size="44" width="3" />
            </div>
            <div class="upload-loading-title">Анализируем файл…</div>
            <div class="upload-loading-desc">AI распознаёт колонки и проверяет данные</div>
          </div>
          <template v-else>
            <div class="upload-icon-wrap">
              <v-icon icon="mdi-cloud-upload-outline" size="36" />
            </div>
            <div class="upload-title">
              {{ isDragging ? 'Отпустите файл' : 'Перетащите файл сюда' }}
            </div>
            <div class="upload-desc">или нажмите, чтобы выбрать</div>
            <div class="upload-formats">
              <span class="fmt-chip">
                <v-icon icon="mdi-microsoft-excel" size="13" />
                .xlsx
              </span>
              <span class="fmt-chip">
                <v-icon icon="mdi-microsoft-excel" size="13" />
                .xls
              </span>
              <span class="fmt-chip">
                <v-icon icon="mdi-file-delimited-outline" size="13" />
                .csv
              </span>
              <span class="upload-formats-note">до 10 МБ</span>
            </div>
          </template>
          <input
            ref="fileInputRef"
            type="file"
            accept=".xlsx,.xls,.csv"
            class="d-none"
            @change="onFileSelected"
          />
        </div>
      </div>

      <v-alert
        v-if="uploadError"
        type="error"
        variant="tonal"
        class="ma-4"
        closable
        @click:close="uploadError = ''"
      >
        {{ uploadError }}
      </v-alert>
    </v-card>

    <!-- Drafts -->
    <div class="section-head mb-4">
      <h2 class="section-title">Активные черновики</h2>
      <span v-if="drafts.length" class="section-count">{{ drafts.length }}</span>
      <v-spacer />
      <button
        v-if="drafts.length"
        class="refresh-btn"
        :disabled="loadingDrafts"
        @click="loadDrafts"
      >
        <v-progress-circular v-if="loadingDrafts" indeterminate size="13" width="2" />
        <v-icon v-else icon="mdi-refresh" size="14" />
        Обновить
      </button>
    </div>

    <div v-if="loadingDrafts && !drafts.length" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <v-row v-else-if="drafts.length" dense>
      <v-col v-for="d in drafts" :key="d.id" cols="12" md="6" lg="4">
        <button class="draft-card" @click="openDraft(d.id)">
          <div class="draft-card-head">
            <div class="draft-icon">
              <v-icon icon="mdi-file-document-outline" size="20" />
            </div>
            <div class="draft-info">
              <div class="draft-name">{{ d.originalFileName }}</div>
              <div class="draft-meta">
                <span>{{ formatRelative(d.createdAt) }}</span>
                <span class="draft-meta-dot">·</span>
                <span class="draft-meta-expire">истекает {{ formatRelative(d.expiresAt) }}</span>
              </div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="draft-chevron" />
          </div>

          <div class="draft-stats">
            <div class="draft-stat">
              <span class="draft-stat-label">Всего</span>
              <span class="draft-stat-value">{{ d.stats.total }}</span>
            </div>
            <div v-if="d.stats.valid > 0" class="draft-stat draft-stat--success">
              <v-icon icon="mdi-check-circle" size="12" />
              <span>{{ d.stats.valid }}</span>
            </div>
            <div v-if="d.stats.duplicates > 0" class="draft-stat draft-stat--warning">
              <v-icon icon="mdi-content-duplicate" size="12" />
              <span>{{ d.stats.duplicates }}</span>
            </div>
            <div v-if="d.stats.withErrors > 0" class="draft-stat draft-stat--error">
              <v-icon icon="mdi-alert-circle" size="12" />
              <span>{{ d.stats.withErrors }}</span>
            </div>
          </div>
        </button>
      </v-col>
    </v-row>

    <v-card v-else rounded="lg" elevation="0" border class="empty-state">
      <div class="empty-state-icon">
        <v-icon icon="mdi-file-document-outline" size="32" />
      </div>
      <div class="empty-title">Нет активных черновиков</div>
      <div class="empty-desc">Загрузите файл выше — здесь появится черновик для проверки</div>
    </v-card>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useImportDraft, type DraftStats } from '@/composables/useImportDraft'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'

const router = useRouter()
const { analyze } = useImportDraft()
const { show: showToast } = useToast()
const { isDark } = useIsDark()

interface DraftListItem {
  id: string
  originalFileName: string
  format: string
  stats: DraftStats
  status: string
  createdAt: string
  expiresAt: string
}

const fileInputRef = ref<HTMLInputElement | null>(null)
const analyzing = ref(false)
const uploadError = ref('')
const isDragging = ref(false)
const drafts = ref<DraftListItem[]>([])
const loadingDrafts = ref(false)

function pickFile() {
  fileInputRef.value?.click()
}

function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) void handleFile(file)
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) void handleFile(file)
}

async function handleFile(file: File) {
  const name = file.name.toLowerCase()
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
    uploadError.value = 'Допустимы только .xlsx, .xls или .csv'
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    uploadError.value = 'Файл больше 10 МБ'
    return
  }

  uploadError.value = ''
  analyzing.value = true
  try {
    const res = await analyze(file)
    showToast('Файл проанализирован. Проверьте данные в редакторе', 'success')
    router.push(`/import/drafts/${res.id}`)
  } catch (e: any) {
    uploadError.value = e.message || 'Не удалось обработать файл'
    showToast(uploadError.value, 'error')
  } finally {
    analyzing.value = false
  }
}

async function loadDrafts() {
  loadingDrafts.value = true
  try {
    drafts.value = await api.get<DraftListItem[]>('/import/drafts')
  } catch {
    drafts.value = []
  } finally {
    loadingDrafts.value = false
  }
}

function openDraft(id: string) {
  router.push(`/import/drafts/${id}`)
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diffMs = d.getTime() - now
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return 'сегодня'
  if (diffDays === 1) return 'завтра'
  if (diffDays === -1) return 'вчера'
  if (diffDays > 0) return `через ${diffDays} дн`
  return `${Math.abs(diffDays)} дн назад`
}

onMounted(() => {
  void loadDrafts()
})
</script>

<style scoped>
/* ─── Page header ─── */
.page-head {
  display: flex; align-items: center; gap: 14px;
}
.page-head-icon {
  width: 44px; height: 44px; min-width: 44px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.08);
  color: #047857;
}
.dark .page-head-icon { background: rgba(74, 222, 128, 0.10); color: #34d399; }
.page-head-text { min-width: 0; }
.page-head-title {
  font-size: 22px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
  line-height: 1.2;
}
.page-head-subtitle {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 4px;
}

/* ─── Hero card ─── */
.hero-card {
  overflow: hidden;
}
.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(420px, 520px);
  gap: 0;
}
@media (max-width: 1100px) {
  .hero-grid { grid-template-columns: 1fr; }
}
.hero-text {
  padding: 36px 36px 36px 32px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(4, 120, 87);
  background: rgba(4, 120, 87, 0.08);
  padding: 4px 10px;
  border-radius: 999px;
  margin-bottom: 16px;
}
.dark .hero-eyebrow { color: rgb(74, 222, 128); background: rgba(74, 222, 128, 0.10); }
.hero-title {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.25;
  color: rgba(var(--v-theme-on-surface), 0.95);
  margin-bottom: 10px;
}
.hero-desc {
  font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  line-height: 1.55;
  margin-bottom: 24px;
}
.hero-features {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hero-feature {
  display: flex;
  align-items: center;
  gap: 12px;
}
.hero-feature-icon {
  width: 34px; height: 34px; min-width: 34px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.hero-feature-content { line-height: 1.3; }
.hero-feature-title {
  font-size: 13.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.hero-feature-desc {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}

/* ─── Upload zone ─── */
.upload-zone {
  position: relative;
  margin: 24px;
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.015);
  padding: 36px 28px;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, transform 0.15s;
}
.upload-zone:hover:not(.upload-zone--loading) {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.04);
}
.upload-zone:hover:not(.upload-zone--loading) .upload-icon-wrap {
  transform: translateY(-2px);
  background: rgba(var(--v-theme-primary), 0.12);
}
.upload-zone--drag {
  border-color: rgb(var(--v-theme-primary)) !important;
  background: rgba(var(--v-theme-primary), 0.07) !important;
  transform: scale(1.01);
}
.upload-zone--loading {
  cursor: default;
  border-style: solid;
  border-color: rgba(var(--v-theme-primary), 0.30);
  background: rgba(var(--v-theme-primary), 0.04);
}
.dark .upload-zone {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.12);
}
.upload-icon-wrap {
  width: 64px; height: 64px;
  border-radius: 18px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  margin-bottom: 18px;
  transition: all 0.2s;
}
.upload-title {
  font-size: 16px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
  margin-bottom: 4px;
}
.upload-desc {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-bottom: 22px;
}
.upload-formats {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
}
/* Custom format chips — no Vuetify dependence */
.fmt-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-variant-numeric: tabular-nums;
}
.fmt-chip .v-icon { color: rgba(var(--v-theme-on-surface), 0.45); }
.upload-formats-note {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-left: 4px;
}
.upload-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.upload-loading-spinner {
  width: 64px; height: 64px;
  border-radius: 18px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-primary), 0.06);
}
.upload-loading-title {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  margin-top: 4px;
}
.upload-loading-desc {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/* ─── Section header ─── */
.section-head {
  display: flex; align-items: center; gap: 8px;
}
.section-title {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.section-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 7px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 11px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* Refresh button — same family as toolbar buttons in drafts page */
.refresh-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.refresh-btn:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.30);
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.04);
}
.refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }

/* ─── Draft cards ─── */
.draft-card {
  width: 100%;
  display: block;
  text-align: left;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.dark .draft-card { background: #1e1e2e; border-color: #2e2e42; }
.draft-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
}
.draft-card:hover .draft-chevron {
  color: rgb(var(--v-theme-primary));
  transform: translateX(2px);
}
.draft-card-head {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 14px;
}
.draft-icon {
  width: 38px; height: 38px; min-width: 38px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.draft-info { flex: 1; min-width: 0; }
.draft-name {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.95);
  line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.draft-meta {
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 4px;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
}
.draft-meta-dot { opacity: 0.5; }
.draft-meta-expire { color: rgba(var(--v-theme-on-surface), 0.4); }
.draft-chevron {
  color: rgba(var(--v-theme-on-surface), 0.35);
  transition: all 0.15s;
}

.draft-stats {
  display: flex; gap: 6px; flex-wrap: wrap;
}
.draft-stat {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 11.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-variant-numeric: tabular-nums;
}
.draft-stat-label {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-weight: 500;
  margin-right: 2px;
}
.draft-stat-value { font-weight: 700; }
.draft-stat--success {
  background: rgba(4, 120, 87, 0.10);
  color: #047857;
}
.dark .draft-stat--success { background: rgba(74, 222, 128, 0.12); color: #34d399; }
.draft-stat--warning {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
}
.dark .draft-stat--warning { background: rgba(245, 158, 11, 0.16); color: #fbbf24; }
.draft-stat--error {
  background: rgba(239, 68, 68, 0.10);
  color: #dc2626;
}
.dark .draft-stat--error { background: rgba(239, 68, 68, 0.14); color: #f87171; }

/* ─── Empty state ─── */
.empty-state {
  padding: 56px 24px;
  text-align: center;
  background: rgba(var(--v-theme-on-surface), 0.015) !important;
}
.dark .empty-state {
  background: rgba(255, 255, 255, 0.02) !important;
}
.empty-state-icon {
  width: 60px; height: 60px;
  border-radius: 16px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.35);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 14px;
}
.empty-title {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 4px;
}
.empty-desc {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
</style>
