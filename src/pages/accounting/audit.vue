<script setup lang="ts">
/**
 * Аудит — не третий журнал, а контроль.
 *
 * История действий уже есть в своём разделе, лента операций — в бухгалтерии.
 * Повторять их здесь значило бы добавить шума. Аудит отвечает на другой
 * вопрос: сходится ли учёт и не было ли операций, которые стоит заметить.
 *
 * Каждая находка ведёт к конкретной сделке или платежу: без этого проверка
 * бесполезна — искать вручную по базе никто не станет.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountingStore } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { formatCurrency, formatDate } from '@/utils/formatters'
import AccountingTabs from '@/components/AccountingTabs.vue'

const store = useAccountingStore()
const toast = useToast()
const router = useRouter()
const { isDark } = useIsDark()

const loading = ref(false)
const checks = ref<Awaited<ReturnType<typeof store.fetchAuditChecks>>['checks']>([])
const problems = ref(0)
const critical = ref<Awaited<ReturnType<typeof store.fetchCriticalActions>>>([])
const openKey = ref<string | null>(null)

onMounted(() => void load())

async function load() {
  loading.value = true
  try {
    const [res, acts] = await Promise.all([store.fetchAuditChecks(), store.fetchCriticalActions(30)])
    checks.value = res.checks
    problems.value = res.problems
    critical.value = acts
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось выполнить проверки')
  } finally {
    loading.value = false
  }
}

/** Сначала то, что важнее: расхождение денег выше незаполненных документов. */
const sorted = computed(() => {
  const weight = { high: 0, medium: 1, low: 2 } as const
  return [...checks.value].sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? 1 : -1
    return weight[a.severity] - weight[b.severity]
  })
})

function toggle(key: string) {
  openKey.value = openKey.value === key ? null : key
}

/**
 * Из находки — сразу к делу. У платежей и сделок ссылка ведёт в карточку
 * сделки: там видно и график, и историю.
 */
function goTo(item: Record<string, any>) {
  const dealId = item.dealId ?? (item.dealNumber ? null : item.id)
  if (item.productName && item.id && !item.number) {
    router.push(`/deals/${item.id}`)
    return
  }
  if (dealId) router.push(`/deals/${dealId}`)
}

/** Как показать находку одной строкой: у каждой проверки свои поля. */
function describe(key: string, item: Record<string, any>): string {
  switch (key) {
    case 'negative_account_balance':
      return `${item.code} · ${item.name} — ${formatCurrency(item.balance)}`
    case 'unallocated_payments':
      return `Сделка №${item.dealNumber} · ${item.productName} · платёж №${item.number} — ${formatCurrency(item.amount)}`
    case 'schedule_mismatch':
      return `Сделка №${item.dealNumber} · ${item.productName} — по договору ${formatCurrency(item.expected)}, в графике ${formatCurrency(item.actual)}`
    case 'paid_before_deal':
      return `Сделка №${item.dealNumber} · платёж №${item.number} оплачен ${formatDate(item.paidAt)}, а договор от ${formatDate(item.dealDate)}`
    case 'paid_in_future':
      return `Сделка №${item.dealNumber} · платёж №${item.number} помечен ${formatDate(item.paidAt)}`
    case 'duplicate_clients':
      return `${item.phone} — ${item.count} профиля: ${item.names}`
    case 'orphan_journal':
      return `${formatDate(item.date)} · ${formatCurrency(item.amount)} · ${item.note ?? item.type}`
    default:
      return JSON.stringify(item)
  }
}

const SEVERITY_LABEL: Record<string, string> = {
  high: 'Важно',
  medium: 'Стоит проверить',
  low: 'Мелочь',
}
</script>

<template>
  <div class="au-page" :class="{ dark: isDark }">
    <AccountingTabs />

    <div class="au-head">
      <div>
        <div class="au-title">Аудит</div>
        <div class="au-hint">
          Проверка учёта и присмотр за операциями, которые стоит замечать сразу.
          Журнал всех действий — в разделе «История действий».
        </div>
      </div>
      <button class="au-refresh" :disabled="loading" @click="load">
        <v-icon icon="mdi-refresh" size="16" />
        {{ loading ? 'Проверяю…' : 'Проверить заново' }}
      </button>
    </div>

    <div v-if="loading && !checks.length" class="au-loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Итог: одна строка вместо чтения всего списка -->
      <div class="au-verdict" :class="problems ? 'au-verdict--bad' : 'au-verdict--ok'">
        <v-icon :icon="problems ? 'mdi-alert-circle-outline' : 'mdi-check-circle-outline'" size="22" />
        <div>
          <div class="au-verdict-title">
            {{ problems ? `Нашлось, что проверить: ${problems} из ${checks.length}` : 'Всё сходится' }}
          </div>
          <div class="au-verdict-text">
            {{ problems
              ? 'Проверки ничего не исправляют сами — решение по деньгам принимаете вы.'
              : 'Учёт сходится: минусов на счетах нет, графики совпадают с договорами.' }}
          </div>
        </div>
      </div>

      <!-- Проверки -->
      <div class="au-checks">
        <div v-for="c in sorted" :key="c.key" class="au-check" :class="{ 'au-check--ok': c.ok }">
          <button class="au-check-head" @click="!c.ok && toggle(c.key)">
            <span class="au-check-icon" :class="c.ok ? 'au-check-icon--ok' : `au-check-icon--${c.severity}`">
              <v-icon :icon="c.ok ? 'mdi-check' : 'mdi-alert'" size="15" />
            </span>
            <span class="au-check-body">
              <span class="au-check-title">{{ c.title }}</span>
              <span class="au-check-hint">{{ c.hint }}</span>
            </span>
            <span v-if="!c.ok" class="au-check-count" :class="`au-check-count--${c.severity}`">
              {{ c.count }}{{ c.count === 20 ? '+' : '' }}
            </span>
            <span v-else class="au-check-clean">чисто</span>
            <v-icon
              v-if="!c.ok"
              :icon="openKey === c.key ? 'mdi-chevron-up' : 'mdi-chevron-down'"
              size="18"
              class="au-check-caret"
            />
          </button>

          <div v-if="openKey === c.key" class="au-items">
            <div class="au-items-note">
              <span class="au-sev" :class="`au-sev--${c.severity}`">{{ SEVERITY_LABEL[c.severity] }}</span>
              Показаны первые {{ c.items.length }}
            </div>
            <button
              v-for="(item, i) in c.items"
              :key="i"
              class="au-item"
              @click="goTo(item)"
            >
              <span class="au-item-text">{{ describe(c.key, item) }}</span>
              <v-icon icon="mdi-chevron-right" size="15" class="au-item-arrow" />
            </button>
          </div>
        </div>
      </div>

      <!-- Критичные операции -->
      <div class="au-section-head">
        <div class="au-section-title">Критичные операции</div>
        <div class="au-section-hint">Отмены, правки и удаления — то, что меняет деньги задним числом</div>
      </div>

      <div v-if="!critical.length" class="au-empty">Таких операций не было</div>

      <div v-else class="au-acts">
        <div v-for="a in critical" :key="a.id" class="au-act">
          <div class="au-act-body">
            <div class="au-act-title">{{ a.title }}</div>
            <div class="au-act-sub">
              {{ formatDate(a.createdAt) }} · {{ a.actorName }}
              <template v-if="a.description"> · {{ a.description }}</template>
            </div>
          </div>
          <button
            v-if="a.entityType === 'DEAL' && a.entityId"
            class="au-act-btn"
            @click="router.push(`/deals/${a.entityId}`)"
          >Открыть</button>
        </div>
      </div>

      <!-- Закрытие месяца пока не сделано: включать его нужно по желанию
           партнёра, иначе оно мешает тем, кто правит задним числом легально. -->
      <div class="au-note">
        <v-icon icon="mdi-information-outline" size="16" />
        Закрытие месяца — запрет правок задним числом — появится отдельной настройкой:
        нужно не всем, а кому-то будет мешать.
      </div>
    </template>
  </div>
</template>

<style scoped>
.au-page { padding: 24px 28px 40px; }
.au-loading { display: flex; justify-content: center; align-items: center; min-height: 260px; }

.au-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; margin-bottom: 18px;
}
.au-title { font-size: 20px; font-weight: 700; }
.au-hint {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 3px; max-width: 620px; line-height: 1.5;
}
.au-refresh {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 15px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.au-refresh:hover:not(:disabled) { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.au-refresh:disabled { opacity: 0.6; cursor: default; }

.au-verdict {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 15px 18px; border-radius: 14px; margin-bottom: 18px;
}
.au-verdict--ok { background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); color: #047857; }
.au-verdict--bad { background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); color: #b45309; }
.au-verdict-title { font-size: 15px; font-weight: 700; }
.au-verdict-text {
  font-size: 12.5px; margin-top: 2px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.au-checks {
  border-radius: 14px; overflow: hidden; margin-bottom: 26px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.au-check { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06); }
.au-check:first-child { border-top: none; }
.au-check-head {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 13px 18px; text-align: left;
}
.au-check:not(.au-check--ok) .au-check-head { cursor: pointer; }
.au-check:not(.au-check--ok) .au-check-head:hover { background: rgba(var(--v-theme-on-surface), 0.025); }
.au-check-icon {
  width: 26px; height: 26px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.au-check-icon--ok { background: rgba(16, 185, 129, 0.12); color: #047857; }
.au-check-icon--high { background: rgba(220, 38, 38, 0.12); color: #b91c1c; }
.au-check-icon--medium { background: rgba(245, 158, 11, 0.14); color: #b45309; }
.au-check-icon--low { background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.5); }
.au-check-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.au-check-title { font-size: 14px; font-weight: 600; }
.au-check-hint {
  font-size: 12px; line-height: 1.4; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.au-check-count {
  font-size: 12.5px; font-weight: 700; padding: 3px 10px; border-radius: 8px;
}
.au-check-count--high { background: rgba(220, 38, 38, 0.12); color: #b91c1c; }
.au-check-count--medium { background: rgba(245, 158, 11, 0.16); color: #b45309; }
.au-check-count--low { background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.5); }
.au-check-clean { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.35); }
.au-check-caret { color: rgba(var(--v-theme-on-surface), 0.3); }

.au-items {
  padding: 4px 18px 14px 56px;
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.au-items-note {
  display: flex; align-items: center; gap: 8px;
  font-size: 11.5px; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.au-sev { padding: 1px 7px; border-radius: 5px; font-weight: 700; }
.au-sev--high { background: rgba(220, 38, 38, 0.12); color: #b91c1c; }
.au-sev--medium { background: rgba(245, 158, 11, 0.16); color: #b45309; }
.au-sev--low { background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.5); }
.au-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 0; text-align: left; cursor: pointer;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.au-item:first-of-type { border-top: none; }
.au-item-text {
  flex: 1; min-width: 0; font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.75);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.au-item:hover .au-item-text { color: #047857; }
.au-item-arrow { color: rgba(var(--v-theme-on-surface), 0.25); }

.au-section-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.au-section-title { font-size: 17px; font-weight: 700; }
.au-section-hint { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.45); }

.au-acts {
  border-radius: 14px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.au-act {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.au-act:first-child { border-top: none; }
.au-act-body { flex: 1; min-width: 0; }
.au-act-title {
  font-size: 13.5px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.au-act-sub { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }
.au-act-btn {
  padding: 6px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.65); cursor: pointer; white-space: nowrap;
}
.au-act-btn:hover { border-color: rgba(4, 120, 87, 0.4); color: #047857; }

.au-empty {
  padding: 28px; border-radius: 14px; text-align: center; font-size: 13px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.au-note {
  display: flex; gap: 8px; align-items: flex-start;
  margin-top: 18px; padding: 12px 14px; border-radius: 10px;
  font-size: 12.5px; line-height: 1.5;
  background: rgba(var(--v-theme-on-surface), 0.03);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
</style>
