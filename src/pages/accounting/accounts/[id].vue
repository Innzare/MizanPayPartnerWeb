<script setup lang="ts">
/**
 * Карточка счёта: остаток, действия и лента операций.
 *
 * Отвечает на вопрос «что происходило с этими деньгами»: каждая строка — то,
 * что двигало остаток, с датой, суммой и ссылкой на сделку, если операция
 * пришла оттуда. Отмены здесь тоже видны отдельными строками — история не
 * переписывается задним числом.
 */
import { computed, onMounted, ref, watch } from 'vue'
import BankLogo from '@/components/BankLogo.vue'
import { useRoute, useRouter } from 'vue-router'
import { useAccountingStore, type AccountEntryView, type AccountView, type PointDetail } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { usePageHeaderStore } from '@/stores/pageHeader'
import { useAuthStore } from '@/stores/auth'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { formatCurrency, formatDate, formatPhone } from '@/utils/formatters'
import AccountEditDialog from '@/components/AccountEditDialog.vue'
import AccountTransferDialog from '@/components/AccountTransferDialog.vue'
import AccountReconcileDialog from '@/components/AccountReconcileDialog.vue'
import AccountOperationItems from '@/components/AccountOperationItems.vue'
import OperationDialog from '@/components/OperationDialog.vue'
import { ACCOUNT_KINDS, type OperationKind } from '@/constants/operationKinds'

const route = useRoute()
const router = useRouter()
const store = useAccountingStore()
const toast = useToast()
const { isDark } = useIsDark()
const auth = useAuthStore()
const cashboxes = useCashBoxesStore()

const id = computed(() => String((route.params as Record<string, string>).id))
const account = computed<AccountView | null>(() => store.accounts.find((a) => a.id === id.value) ?? null)

const entries = ref<AccountEntryView[]>([])
const cursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)

const showEdit = ref(false)
const showTransfer = ref(false)
const showReconcile = ref(false)

const canEdit = computed(() => auth.can('accounting.edit'))
const canTransfer = computed(() => auth.can('accounting.transfer'))
const canReconcile = computed(() => auth.can('accounting.reconcile'))
/** Кому вообще доступен ввод денег: капитал, финансы или переводы. */
const canOperate = computed(
  () => auth.can('finance.capital') || auth.can('finance.manage') || auth.can('accounting.transfer'),
)

/** Операция по этому счёту: счёт в форме уже выбран, менять его не нужно. */
const showOperation = ref(false)
const operationKind = ref<OperationKind>('DEPOSIT')
function pickOperation(kind: OperationKind) {
  if (kind === 'TRANSFER') {
    showTransfer.value = true
    return
  }
  operationKind.value = kind
  showOperation.value = true
}

onMounted(() => void load())

/** Чья касса держит деньги этого счёта. Пусто — счёт общий для всех касс. */
const cashBox = computed(() => {
  const boxId = account.value?.cashBoxId
  if (!boxId) return null
  return cashboxes.items.find((b) => b.id === boxId) ?? null
})

async function load() {
  loading.value = true
  try {
    if (!store.accounts.length) await store.fetchAccounts()
    if (!cashboxes.items.length) await cashboxes.fetchAll().catch(() => {})
    const res = await store.fetchHistory(id.value)
    entries.value = res.items
    cursor.value = res.nextCursor
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить операции')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!cursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const res = await store.fetchHistory(id.value, cursor.value)
    entries.value.push(...res.items)
    cursor.value = res.nextCursor
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить ещё')
  } finally {
    loadingMore.value = false
  }
}

/** Как назвать операцию человеку. Внутренние коды наружу не показываем. */
const KIND_LABEL: Record<string, string> = {
  OPENING: 'Начальный остаток',
  SEED_BACKFILL: 'Перенос истории',
  PAYMENT_IN: 'Оплата от клиента',
  DEAL_DEPLOY: 'Закупка по сделке',
  MANUAL: 'Ручная операция',
  CAPITAL: 'Капитал',
  DIVIDEND: 'Выплата инвестору',
  CI_CAPITAL: 'Капитал инвестора',
  TRANSFER_IN: 'Перевод со счёта',
  TRANSFER_OUT: 'Перевод на счёт',
  RECONCILE: 'Пересчёт денег',
  REVERSAL: 'Отмена операции',
}

const KIND_ICON: Record<string, string> = {
  PAYMENT_IN: 'mdi-cash-plus',
  DEAL_DEPLOY: 'mdi-cart-outline',
  MANUAL: 'mdi-pencil-outline',
  CAPITAL: 'mdi-wallet-outline',
  DIVIDEND: 'mdi-account-cash-outline',
  CI_CAPITAL: 'mdi-account-group-outline',
  TRANSFER_IN: 'mdi-arrow-down-left',
  TRANSFER_OUT: 'mdi-arrow-up-right',
  RECONCILE: 'mdi-scale-balance',
  REVERSAL: 'mdi-undo-variant',
  OPENING: 'mdi-flag-outline',
  SEED_BACKFILL: 'mdi-history',
}

function accentOf(a: AccountView): string {
  return a.bank?.color || a.color || '#047857'
}

// ── Пункт приёма: у такого счёта, кроме ленты, есть своя история ──
//
// Раньше под это была вторая страница (/accounting/points/:id), и у одного
// пункта оказывалось две карточки с разными данными. Карточка теперь одна,
// а «пунктовая» часть живёт здесь отдельными вкладками.
const isPoint = computed(() => account.value?.type === 'PAYMENT_POINT')

/**
 * Заголовок страницы — имя счёта.
 *
 * Это отдельный документ, а не вкладка бухгалтерии: в шапке должно стоять «Карта
 * Сбер», а не «Страница» и не «Бухгалтерия».
 */
const pageHeader = usePageHeaderStore()
watch(
  account,
  (a) => {
    if (!a) return
    pageHeader.set(
      a.name,
      [a.code, isPoint.value ? 'Пункт приёма' : a.bank?.name || 'Счёт'].filter(Boolean).join(' · '),
    )
  },
  { immediate: true },
)

type AccountTab = 'entries' | 'payments' | 'pickups'
const tab = ref<AccountTab>('entries')

/** Период — как в отчётах: готовые варианты, а не два поля с календарём. */
const PERIODS = [
  { key: '30', label: '30 дней', days: 30 },
  { key: '90', label: '3 месяца', days: 90 },
  { key: '365', label: 'Год', days: 365 },
]
const period = ref('30')
const point = ref<PointDetail | null>(null)
const pointLoading = ref(false)

async function loadPoint() {
  if (!isPoint.value) return
  pointLoading.value = true
  try {
    const days = PERIODS.find((p) => p.key === period.value)?.days ?? 30
    const from = new Date(Date.now() - days * 86400000).toISOString()
    point.value = await store.fetchPointDetail(id.value, from)
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить историю пункта')
  } finally {
    pointLoading.value = false
  }
}

function setPeriod(key: string) {
  period.value = key
  void loadPoint()
}

// Тип счёта известен только после загрузки списка счетов, поэтому историю
// пункта запрашиваем, когда выяснилось, что счёт — пункт приёма.
watch(isPoint, (v) => { if (v && !point.value) void loadPoint() })

const pointPayments = computed(() =>
  (point.value?.entries ?? []).filter((e) => e.kind === 'PAYMENT_IN'),
)
const pointOther = computed(() =>
  (point.value?.entries ?? []).filter((e) => e.kind !== 'PAYMENT_IN'),
)

/** Кто сколько принял за период — сразу видно, работает точка или стоит. */
const byOperator = computed(() => {
  const map = new Map<string, { name: string; sum: number; count: number }>()
  for (const e of pointPayments.value) {
    const name = e.acceptedBy ?? 'Не указан'
    const cur = map.get(name) ?? { name, sum: 0, count: 0 }
    cur.sum += e.amount
    cur.count += 1
    map.set(name, cur)
  }
  return [...map.values()].sort((a, b) => b.sum - a.sum)
})

const POINT_KIND_LABEL: Record<string, string> = {
  PAYMENT_IN: 'Оплата по договору',
  TRANSFER_IN: 'Пополнение',
  TRANSFER_OUT: 'Забрали из пункта',
  REVERSAL: 'Отмена операции',
  ADJUSTMENT: 'Правка остатка',
  EXPENSE: 'Расход',
  INCOME: 'Приход',
}
const STOP_STATUS: Record<string, string> = {
  PENDING: 'ждём',
  HANDED: 'оператор передал',
  RECEIVED: 'забрали',
  SKIPPED: 'пропущен',
}

function timeLabel(iso: string) {
  const d = new Date(iso)
  const day = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  return `${day}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}

/** «37 платежей», «2 платежа», «1 платёж» — иначе получается «платеж(ей)». */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = n % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

function goToDeal(e: AccountEntryView) {
  if (e.deal) router.push(`/deals/${e.deal.id}`)
}
</script>

<template>
  <div class="ad-page" :class="{ dark: isDark }">

    <!-- Возврат туда, где такой счёт живёт: пункты приёма ищут на своей
         вкладке, остальные счета — на «Балансе». -->
    <button class="back-btn" @click="router.push(isPoint ? '/accounting/points' : '/accounting/balance')">
      <v-icon icon="mdi-arrow-left" size="18" />
      {{ isPoint ? 'Все пункты' : 'Все счета' }}
    </button>

    <div v-if="loading && !account" class="ad-loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="account">
      <!-- Шапка счёта -->
      <div class="ad-hero" :style="{ '--ad-accent': accentOf(account) }">
        <div class="ad-hero-head">
          <div v-if="account.bank" class="ad-logo">
            <BankLogo :bank-name="account.bank.name" :color="accentOf(account)" :fallback="account.code" :size="46" />
          </div>
          <div v-else class="ad-code" :style="{ background: accentOf(account) + '22', color: '#fff' }">
            {{ account.code }}
          </div>
          <div class="ad-hero-title-block">
            <div class="ad-hero-name">{{ account.name }}</div>
            <div class="ad-hero-sub">
              <span class="ad-badge">{{ account.code }}</span>
              <span v-if="account.bank">{{ account.bank.name }}</span>
              <span v-else-if="account.pickup?.contactName">{{ account.pickup.contactName }}</span>
              <span v-else>Наличные</span>
              <span v-if="account.isDefaultForCash || account.isDefaultForBank" class="ad-badge">по умолчанию</span>
              <span v-if="account.disabledAt" class="ad-badge ad-badge--off">
                {{ account.disabledReason || 'Отключён' }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="account.balance !== null" class="ad-amount">{{ formatCurrency(account.balance) }}</div>
        <div class="ad-amount-label">Сейчас на счёте</div>

        <!-- Чья касса: счёт отвечает, где деньги лежат, касса — чьи они. -->
        <div class="ad-hero-line">
          <v-icon icon="mdi-wallet-outline" size="14" />
          <span v-if="cashBox">Касса «{{ cashBox.name }}»</span>
          <span v-else>Общий счёт — деньги любой кассы</span>
        </div>

        <div v-if="account.transferPhone || account.pickup?.address" class="ad-hero-line">
          <v-icon :icon="account.transferPhone ? 'mdi-phone-outline' : 'mdi-map-marker-outline'" size="14" />
          <span v-if="account.transferPhone">
            {{ formatPhone(account.transferPhone) }}<template v-if="account.holderName"> · {{ account.holderName }}</template>
          </span>
          <span v-else>{{ account.pickup?.address }}</span>
        </div>

        <div class="ad-actions">
          <!-- Внести и снять деньги можно прямо здесь: раньше за этим нужно
               было возвращаться на «Баланс» и выбирать счёт заново. -->
          <v-menu v-if="canOperate" location="bottom start" offset="6">
            <template #activator="{ props: menuProps }">
              <button class="ad-action ad-action--main" v-bind="menuProps">
                <v-icon icon="mdi-plus-circle-outline" size="16" />
                Операция
                <v-icon icon="mdi-chevron-down" size="15" />
              </button>
            </template>
            <v-card rounded="lg" elevation="6" class="ad-opmenu">
              <AccountOperationItems :kinds="ACCOUNT_KINDS" @pick="pickOperation" />
            </v-card>
          </v-menu>
          <button v-if="canTransfer" class="ad-action" @click="showTransfer = true">
            <v-icon icon="mdi-swap-horizontal" size="16" />
            Перевести
          </button>
          <button v-if="canReconcile" class="ad-action" @click="showReconcile = true">
            <v-icon icon="mdi-scale-balance" size="16" />
            Пересчитать деньги
          </button>
          <button v-if="canEdit" class="ad-action" @click="showEdit = true">
            <v-icon icon="mdi-cog-outline" size="16" />
            Настройки
          </button>
        </div>
      </div>

      <!-- У пункта приёма, кроме ленты, есть платежи и история инкассаций. -->
      <div v-if="isPoint" class="page-tabs">
        <button class="page-tab" :class="{ active: tab === 'entries' }" @click="tab = 'entries'">
          <v-icon icon="mdi-timeline-text-outline" size="18" />
          <span>Операции</span>
        </button>
        <button class="page-tab" :class="{ active: tab === 'payments' }" @click="tab = 'payments'">
          <v-icon icon="mdi-cash-multiple" size="18" />
          <span>Платежи</span>
          <span v-if="pointPayments.length" class="page-tab-count">{{ pointPayments.length }}</span>
        </button>
        <button class="page-tab" :class="{ active: tab === 'pickups' }" @click="tab = 'pickups'">
          <v-icon icon="mdi-truck-outline" size="18" />
          <span>Инкассации</span>
          <span v-if="point?.pickups.length" class="page-tab-count">{{ point.pickups.length }}</span>
        </button>
      </div>

      <!-- Период и итоги: общие для «Платежей» и «Инкассаций». -->
      <div v-if="isPoint && tab !== 'entries'" class="ad-period">
        <button
          v-for="p in PERIODS"
          :key="p.key"
          class="fb-btn"
          :class="{ 'fb-btn--active': period === p.key }"
          @click="setPeriod(p.key)"
        >
          {{ p.label }}
        </button>
        <span v-if="point" class="ad-period-hint">
          принято {{ formatCurrency(point.totals.income) }} за {{ point.totals.incomeCount }}
          {{ plural(point.totals.incomeCount, 'платёж', 'платежа', 'платежей') }} · вывезено
          {{ formatCurrency(point.totals.outgo) }}
        </span>
      </div>

      <v-progress-linear v-if="pointLoading" indeterminate color="primary" class="mb-3" />

      <!-- ── Платежи пункта ── -->
      <template v-if="isPoint && tab === 'payments'">
        <!-- Кто принимал: короткая сводка вместо чтения всей ленты. -->
        <div v-if="byOperator.length" class="ad-ops">
          <div v-for="o in byOperator" :key="o.name" class="ad-op">
            <v-icon icon="mdi-account-outline" size="15" />
            <span class="ad-op-name">{{ o.name }}</span>
            <span class="ad-op-sum">{{ formatCurrency(o.sum) }}</span>
            <span class="ad-op-count">· {{ o.count }}</span>
          </div>
        </div>

        <v-card rounded="lg" elevation="0" border class="ad-card">
          <div class="pa-4">
            <div v-if="!pointPayments.length && !pointLoading" class="text-center pa-12">
              <v-icon icon="mdi-cash-multiple" size="56" color="grey-lighten-1" class="mb-3" />
              <div class="text-h6 mb-1">За период платежей не было</div>
              <div class="text-body-2 text-medium-emphasis">
                Здесь появятся оплаты клиентов, принятые в этом пункте
              </div>
            </div>

            <v-table v-else density="default" hover class="ad-table">
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Клиент и товар</th>
                  <th>Принял</th>
                  <th class="text-end">Сумма</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="e in pointPayments"
                  :key="e.id"
                  :class="{ 'cursor-pointer': !!e.dealId }"
                  @click="e.dealId && router.push(`/deals/${e.dealId}`)"
                >
                  <td class="text-no-wrap">{{ timeLabel(e.date) }}</td>
                  <td>
                    <div class="ad-cell-title">{{ e.clientName || '—' }}</div>
                    <div class="ad-cell-sub">
                      <template v-if="e.dealNumber">№{{ e.dealNumber }} · </template>
                      {{ e.productName || e.note || '' }}
                    </div>
                  </td>
                  <td>{{ e.acceptedBy || '—' }}</td>
                  <td class="text-end ad-strong">{{ formatCurrency(e.amount) }}</td>
                </tr>
              </tbody>
            </v-table>

            <!-- Остальные движения: вывоз денег, отмены, правки. -->
            <template v-if="pointOther.length">
              <div class="ad-sub-title">Прочие движения</div>
              <v-table density="compact" class="ad-table">
                <tbody>
                  <tr v-for="e in pointOther" :key="e.id">
                    <td class="text-no-wrap ad-cell-sub">{{ timeLabel(e.date) }}</td>
                    <td>{{ POINT_KIND_LABEL[e.kind] || e.kind }}</td>
                    <td class="text-end ad-strong" :class="{ 'ad-neg': e.amount < 0 }">
                      {{ e.amount > 0 ? '+' : '' }}{{ formatCurrency(e.amount) }}
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </template>
          </div>
        </v-card>
      </template>

      <!-- ── История инкассаций ── -->
      <template v-else-if="isPoint && tab === 'pickups'">
        <v-card rounded="lg" elevation="0" border class="ad-card">
          <div class="pa-4">
            <div v-if="!point?.pickups.length && !pointLoading" class="text-center pa-12">
              <v-icon icon="mdi-truck-outline" size="56" color="grey-lighten-1" class="mb-3" />
              <div class="text-h6 mb-1">Отсюда ещё не забирали деньги</div>
              <div class="text-body-2 text-medium-emphasis">
                Здесь появятся рейсы инкассатора с суммами, которые он забрал
              </div>
            </div>

            <v-table v-else density="default" hover class="ad-table">
              <thead>
                <tr>
                  <th>Рейс</th>
                  <th>Инкассатор</th>
                  <th>Состояние</th>
                  <th class="text-end">Передано</th>
                  <th class="text-end">Принято</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in point?.pickups ?? []"
                  :key="p.id"
                  class="cursor-pointer"
                  @click="router.push(`/collections/${p.runId}`)"
                >
                  <td class="text-no-wrap">№{{ p.runNumber }} · {{ formatDate(p.date) }}</td>
                  <td>{{ p.collectorName }}</td>
                  <td>
                    {{ STOP_STATUS[p.status] || p.status }}
                    <div v-if="p.discrepancyNote" class="ad-cell-sub">{{ p.discrepancyNote }}</div>
                  </td>
                  <td class="text-end">
                    {{ p.handedAmount != null ? formatCurrency(p.handedAmount) : '—' }}
                  </td>
                  <td class="text-end ad-strong">
                    {{ p.receivedAmount != null ? formatCurrency(p.receivedAmount) : '—' }}
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </v-card>
      </template>

      <!-- ── Лента операций счёта ── -->
      <template v-else>
      <div class="ad-section-head">
        <div class="ad-section-title">Операции</div>
        <div class="ad-section-hint">Всё, что двигало остаток этого счёта</div>
      </div>

      <div v-if="!entries.length && !loading" class="ad-empty">
        <v-icon icon="mdi-timeline-text-outline" size="34" />
        <div class="ad-empty-title">Операций пока нет</div>
        <div class="ad-empty-text">
          Здесь появятся оплаты клиентов, закупки, переводы и пересчёты по этому счёту.
        </div>
      </div>

      <div v-else class="ad-list">
        <div
          v-for="e in entries"
          :key="e.id"
          class="ad-row"
          :class="{ 'ad-row--clickable': !!e.deal }"
          @click="goToDeal(e)"
        >
          <div class="ad-row-icon" :class="e.amount < 0 ? 'ad-row-icon--out' : 'ad-row-icon--in'">
            <v-icon :icon="KIND_ICON[e.kind] || 'mdi-circle-small'" size="17" />
          </div>
          <div class="ad-row-body">
            <div class="ad-row-title">{{ e.note || KIND_LABEL[e.kind] || 'Операция' }}</div>
            <div class="ad-row-sub">
              {{ formatDate(e.date) }}
              <template v-if="e.deal"> · сделка №{{ e.deal.dealNumber }}</template>
              <template v-else-if="KIND_LABEL[e.kind] && e.note"> · {{ KIND_LABEL[e.kind] }}</template>
            </div>
          </div>
          <div class="ad-row-amount" :class="e.amount < 0 ? 'ad-row-amount--out' : 'ad-row-amount--in'">
            {{ e.amount < 0 ? '−' : '+' }}{{ formatCurrency(Math.abs(e.amount)) }}
          </div>
        </div>

        <button v-if="cursor" class="ad-more" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? 'Загружаю…' : 'Показать ещё' }}
        </button>
      </div>
      </template>
    </template>

    <AccountEditDialog v-model="showEdit" :account="account" @saved="load" />
    <AccountTransferDialog v-model="showTransfer" :from-account-id="id" @done="load" />
    <OperationDialog v-model="showOperation" :kind="operationKind" :account-id="id" @done="load" />
    <AccountReconcileDialog v-model="showReconcile" :account="account" @done="load" />
  </div>
</template>

<style scoped>
.ad-page { padding: 24px 28px 40px; }
.ad-loading { display: flex; justify-content: center; align-items: center; min-height: 300px; }


.ad-hero {
  position: relative; padding: 22px 26px; border-radius: 16px; margin-bottom: 26px;
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  color: #fff;
}
.dark .ad-hero { background: linear-gradient(135deg, #047857 0%, #064e3b 50%, #022c22 100%); }
.ad-hero-head { display: flex; align-items: center; gap: 12px; }
.ad-code {
  min-width: 44px; height: 40px; padding: 0 10px; border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800;
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.ad-hero-name { font-size: 17px; font-weight: 700; }
.ad-hero-sub {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px;
  font-size: 12.5px; color: rgba(255, 255, 255, 0.6);
}
.ad-badge {
  padding: 1px 7px; border-radius: 6px; font-size: 10.5px; font-weight: 600;
  background: rgba(255, 255, 255, 0.16); color: #fff;
}
.ad-badge--off { background: rgba(251, 191, 36, 0.25); color: #fde68a; }

.ad-amount { font-size: 30px; font-weight: 800; letter-spacing: -0.5px; margin-top: 16px; }
.ad-amount-label { font-size: 12px; color: rgba(255, 255, 255, 0.55); }
.ad-hero-line {
  display: flex; align-items: center; gap: 6px; margin-top: 10px;
  font-size: 12.5px; color: rgba(255, 255, 255, 0.6);
}

.ad-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
.ad-action {
  display: flex; align-items: center; gap: 6px;
  padding: 9px 14px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
}
.ad-action:hover { background: rgba(255, 255, 255, 0.24); }
/* Главное действие на счёте — внести или снять деньги, поэтому кнопка плотнее
   остальных: «Перевести» и «Настройки» рядом с ней вторичны. */
.ad-action--main { background: #fff; border-color: #fff; color: #047857; }
.ad-action--main:hover { background: rgba(255, 255, 255, 0.88); }
.ad-opmenu { padding: 6px; min-width: 300px; max-width: 340px; }

/* ── Пункт приёма: период, операторы, таблицы ── */
.ad-period {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.ad-period-hint {
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
/* Кнопки-фильтры — канон со страницы «Сделки». */
.fb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: #fff;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.12s;
}
.fb-btn:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.2);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.fb-btn--active {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-weight: 600;
}
.dark .fb-btn {
  background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border));
}

.ad-ops { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.ad-op {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.ad-op-name { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); }
.ad-op-sum { font-weight: 700; }
.ad-op-count { color: rgba(var(--v-theme-on-surface), 0.45); }

.ad-card { overflow: visible; }
.ad-table :deep(td) { font-size: 14px; }
.ad-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important; white-space: nowrap;
}
.ad-cell-title { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }
.ad-cell-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.ad-strong { font-weight: 700; font-variant-numeric: tabular-nums; }
.ad-neg { color: #ef4444; }
.ad-sub-title {
  font-size: 13px; font-weight: 700; margin: 18px 0 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.ad-section-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.ad-section-title { font-size: 17px; font-weight: 700; }
.ad-section-hint { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.45); }

.ad-list {
  border-radius: 14px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.ad-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.ad-row:last-of-type { border-bottom: none; }
.ad-row--clickable { cursor: pointer; }
.ad-row--clickable:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.ad-row-icon {
  width: 34px; height: 34px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.ad-row-icon--in { background: rgba(16, 185, 129, 0.12); color: #047857; }
.ad-row-icon--out { background: rgba(239, 68, 68, 0.1); color: #b91c1c; }
.ad-row-body { flex: 1; min-width: 0; }
.ad-row-title {
  font-size: 13.5px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ad-row-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }
.ad-row-amount { font-size: 14.5px; font-weight: 700; white-space: nowrap; }
.ad-row-amount--in { color: #047857; }
.ad-row-amount--out { color: rgba(var(--v-theme-on-surface), 0.8); }
.dark .ad-row-icon--in { background: rgba(52, 211, 153, 0.14); color: #34d399; }
.dark .ad-row-icon--out { background: rgba(248, 113, 113, 0.14); color: #f87171; }
.dark .ad-row-amount--in { color: #34d399; }

.ad-more {
  width: 100%; padding: 12px; font-size: 13.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.ad-more:hover { background: rgba(var(--v-theme-on-surface), 0.03); }

.ad-empty {
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  padding: 48px 24px; border-radius: 14px; text-align: center;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ad-empty-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.ad-empty-text { font-size: 13px; max-width: 380px; line-height: 1.5; }
</style>
