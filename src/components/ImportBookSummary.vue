<template>
  <div class="book-banner" :class="{ blocked: summary.problems.length > 0 }">
    <div class="book-banner-icon">
      <v-icon icon="mdi-book-open-page-variant-outline" size="20" />
    </div>
    <div class="book-banner-body">
      <div class="book-banner-title">Книга переноса</div>
      <div class="book-banner-sub">
        Кроме сделок в файле справочники и история денег. Всё запишется одним импортом:
        сначала кассы, счета и инвесторы, потом сделки, в конце — остатки счетов на
        <template v-if="summary.transferDate">
          <b>{{ formatDay(summary.transferDate) }}</b>.
        </template>
        <template v-else>
          день импорта — дата переноса в файле не указана.
        </template>
      </div>

      <!-- Что мешает импорту -->
      <div v-if="summary.problems.length" class="book-problems">
        <div class="book-problems-title">
          <v-icon icon="mdi-alert-octagon-outline" size="16" />
          Импорт не начнётся, пока это не исправлено в файле
        </div>
        <ul>
          <li v-for="(p, i) in summary.problems" :key="i">{{ p }}</li>
        </ul>
      </div>

      <!-- Листы -->
      <div class="book-sheets">
        <div v-for="s in sheets" :key="s.name" class="book-sheet">
          <div class="book-sheet-name">{{ s.name }}</div>
          <div class="book-sheet-count">
            <template v-if="s.reference">
              <span v-if="s.info.willCreate">{{ s.info.willCreate }} {{ plural(s.info.willCreate, FEMININE.has(s.name) ? 'новая' : 'новый', 'новых', 'новых') }}</span>
              <span v-if="s.info.willCreate && s.info.willReuse"> · </span>
              <span v-if="s.info.willReuse" class="muted">{{ s.info.willReuse }} уже в системе</span>
              <span v-if="!s.info.willCreate && !s.info.willReuse">{{ s.info.rows }} {{ plural(s.info.rows, 'строка', 'строки', 'строк') }}</span>
            </template>
            <template v-else>
              {{ s.info.rows }} {{ plural(s.info.rows, 'строка', 'строки', 'строк') }}
            </template>
          </div>
          <div class="book-sheet-flags">
            <span v-if="s.info.missingRequired.length" class="flag flag-error">нет колонок</span>
            <span v-if="s.info.withErrors" class="flag flag-error">{{ s.info.withErrors }} с ошибками</span>
            <span v-if="s.info.withWarnings" class="flag flag-warn">{{ s.info.withWarnings }} с замечаниями</span>
          </div>
        </div>
      </div>

      <!-- Колонки, которых нет в шаблоне: импорт их не читает. Партнёр
           дописывает свои колонки («Менеджер», «Доп телефон») и узнавал, что
           данные не перенеслись, только после импорта. -->
      <div v-if="unknownColumns.length" class="book-unknown">
        <div class="book-unknown-title">
          <v-icon icon="mdi-table-column-remove" size="16" />
          Эти колонки не перенесутся — их нет в шаблоне
        </div>
        <div v-for="u in unknownColumns" :key="u.sheet" class="book-unknown-row">
          <span class="book-unknown-sheet">{{ u.sheet }}:</span>
          <span>{{ u.columns.map((c) => `«${c}»`).join(', ') }}</span>
        </div>
        <div class="book-unknown-hint">
          Если в них нужные данные — переименуйте колонку как в шаблоне или перенесите значения в подходящую колонку.
        </div>
      </div>

      <!-- Что система достроит сама -->
      <div v-if="warnings.length" class="book-warnings">
        <div v-for="(w, i) in visibleWarnings" :key="i" class="book-warning">
          <v-icon icon="mdi-information-outline" size="14" />
          <span>{{ w }}</span>
        </div>
        <button v-if="warnings.length > WARN_LIMIT" type="button" class="book-link" @click="showAllWarnings = !showAllWarnings">
          {{ showAllWarnings ? 'Свернуть' : `Ещё ${warnings.length - WARN_LIMIT}` }}
        </button>
      </div>

      <!-- Строки с замечаниями — по запросу: их бывает много -->
      <div v-if="hasIssues" class="book-issues">
        <button type="button" class="book-link" :disabled="issuesLoading" @click="toggleIssues">
          <v-icon :icon="issuesOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
          {{ issuesOpen ? 'Скрыть строки с замечаниями' : 'Показать строки с замечаниями' }}
        </button>
        <v-progress-linear v-if="issuesLoading" indeterminate color="primary" class="mt-2" />
        <div v-if="issuesOpen && issues" class="book-issues-list">
          <div v-for="sheet in issues.sheets" :key="sheet.name" class="book-issues-sheet">
            <div class="book-issues-sheet-name">Лист «{{ sheet.name }}»</div>
            <div v-if="sheet.missingRequired.length" class="book-issue error">
              Не хватает колонок: {{ sheet.missingRequired.join(', ') }}
            </div>
            <div v-for="r in sheet.rows" :key="r.rowNo" class="book-issue-row">
              <span class="book-issue-rowno">Строка {{ r.rowNo }}</span>
              <div class="book-issue-messages">
                <div v-for="(e, i) in r.errors" :key="'e' + i" class="book-issue error">
                  <b>{{ e.column }}:</b> {{ e.message }}
                </div>
                <div v-for="(w, i) in r.warnings" :key="'w' + i" class="book-issue warn">{{ w }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BookIssues, BookSummary } from '@/composables/useImportDraft'
import { useImportDraft } from '@/composables/useImportDraft'

const props = defineProps<{ summary: BookSummary; draftId: string }>()

/** Порядок листов — как в шаблоне: сначала справочники, потом история. */
const ORDER = [
  'Кассы', 'Счета', 'Сотрудники', 'Инвесторы', 'Поставщики', 'Папки', 'Клиенты',
  'Платежи', 'Поручители', 'Инвесторы в сделках',
  'Движения инвесторов', 'Движения по кассе', 'Выплаты поставщикам', 'Долги и займы',
]
const REFERENCE = new Set(['Кассы', 'Счета', 'Сотрудники', 'Инвесторы', 'Поставщики', 'Папки'])
const WARN_LIMIT = 3
/** Род для «1 новая касса» / «1 новый счёт». */
const FEMININE = new Set(['Кассы', 'Папки'])

type SheetInfo = BookSummary['sheets'][string]
const sheets = computed(() =>
  ORDER.flatMap((name) => {
    const info: SheetInfo | undefined = props.summary.sheets[name]
    if (!info || !(info.rows > 0 || info.withErrors > 0 || info.missingRequired.length > 0)) return []
    return [{ name, info, reference: REFERENCE.has(name) }]
  }),
)

/** Незнакомые колонки по листам — в порядке листов шаблона. */
const unknownColumns = computed(() =>
  ['Сделки', ...ORDER].flatMap((name) => {
    const cols = props.summary.sheets[name]?.unknownColumns ?? []
    return cols.length ? [{ sheet: name, columns: cols }] : []
  }),
)

const warnings = computed(() => props.summary.warnings ?? [])
const showAllWarnings = ref(false)
const visibleWarnings = computed(() => (showAllWarnings.value ? warnings.value : warnings.value.slice(0, WARN_LIMIT)))

const hasIssues = computed(() =>
  Object.values(props.summary.sheets).some((s) => s.withErrors || s.withWarnings || s.missingRequired.length),
)

const { fetchBookIssues } = useImportDraft()
const issues = ref<BookIssues | null>(null)
const issuesOpen = ref(false)
const issuesLoading = ref(false)

async function toggleIssues() {
  issuesOpen.value = !issuesOpen.value
  if (!issuesOpen.value || issues.value) return
  issuesLoading.value = true
  try {
    issues.value = await fetchBookIssues(props.draftId)
  } finally {
    issuesLoading.value = false
  }
}

function formatDay(ymd: string) {
  const [y, m, d] = ymd.split('-')
  return `${d}.${m}.${y}`
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
</script>

<style scoped>
.book-banner {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 16px 18px; border-radius: 12px;
  background: rgba(99, 102, 241, 0.06);
  border: 1px solid rgba(99, 102, 241, 0.24);
}
.book-banner.blocked { border-color: rgba(239, 68, 68, 0.35); }
.book-banner-icon {
  width: 38px; height: 38px; min-width: 38px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(99, 102, 241, 0.12); color: #6366f1;
}
.book-banner-body { flex: 1; min-width: 0; }
.book-banner-title { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.book-banner-sub {
  font-size: 13px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.book-problems {
  margin-top: 12px; padding: 10px 12px; border-radius: 9px;
  background: rgba(239, 68, 68, 0.08);
  font-size: 12.5px; line-height: 1.5;
}
.book-problems-title {
  display: flex; align-items: center; gap: 6px;
  font-weight: 700; color: #dc2626; margin-bottom: 4px;
}
.book-problems ul { margin: 0; padding-left: 18px; }

.book-sheets {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px; margin-top: 12px;
}
.book-sheet {
  padding: 9px 11px; border-radius: 9px;
  background: rgba(var(--v-theme-surface), 1);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.book-sheet-name { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.book-sheet-count { font-size: 14px; font-weight: 700; margin-top: 2px; }
.book-sheet-count .muted { font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.6); }
.book-sheet-flags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.book-sheet-flags:empty { display: none; }
.flag { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 6px; }
.flag-error { background: rgba(239, 68, 68, 0.12); color: #dc2626; }
.flag-warn { background: rgba(245, 158, 11, 0.14); color: #b45309; }

.book-unknown {
  margin-top: 12px; padding: 10px 12px; border-radius: 10px;
  background: rgba(245, 158, 11, 0.08);
  font-size: 12.5px; line-height: 1.45;
}
.book-unknown-title {
  display: flex; align-items: center; gap: 6px;
  font-weight: 700; color: #b45309; margin-bottom: 4px;
}
.book-unknown-row { color: rgba(var(--v-theme-on-surface), 0.8); }
.book-unknown-sheet { font-weight: 600; margin-right: 4px; }
.book-unknown-hint { margin-top: 4px; color: rgba(var(--v-theme-on-surface), 0.55); }
.book-warnings { margin-top: 12px; display: flex; flex-direction: column; gap: 5px; }
.book-warning {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 12.5px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.book-warning .v-icon { margin-top: 2px; color: #b45309; }

.book-link {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12.5px; font-weight: 600; color: #6366f1;
  background: none; border: none; padding: 0; cursor: pointer;
}
.book-link:disabled { opacity: 0.6; cursor: default; }
.book-issues { margin-top: 12px; }
.book-issues-list { margin-top: 8px; display: flex; flex-direction: column; gap: 10px; }
.book-issues-sheet-name { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
.book-issue-row {
  display: flex; gap: 10px; padding: 5px 0;
  font-size: 12.5px; line-height: 1.45;
}
.book-issue-row + .book-issue-row { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06); }
.book-issue-rowno { min-width: 76px; color: rgba(var(--v-theme-on-surface), 0.55); }
.book-issue-messages { flex: 1; min-width: 0; }
.book-issue.error { color: #dc2626; }
.book-issue.warn { color: #b45309; }
</style>
