<script lang="ts" setup>
/**
 * Бухгалтерия → Баланс: сколько денег у партнёра и где они лежат.
 *
 * Касса отвечает на вопрос «чьи деньги», счёт — «где они». Поэтому счета
 * живут здесь, внутри баланса: наличные в сейфе, карты банков и
 * магазины-партнёры, принимающие оплату, складываются в один общий остаток.
 */
import { computed, onMounted, ref, watch } from 'vue'
import BankLogo from '@/components/BankLogo.vue'
import { useAccountingStore, type AccountView, type AccountType } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useAuthStore } from '@/stores/auth'
import { useSections } from '@/composables/useSections'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useAnchoredMenu } from '@/composables/useAnchoredMenu'
import { formatCurrency, formatCurrencyShort, formatPhone } from '@/utils/formatters'
import AccountEditDialog from '@/components/AccountEditDialog.vue'
import AccountingTabs from '@/components/AccountingTabs.vue'
import AccountTransferDialog from '@/components/AccountTransferDialog.vue'
import AllocateUnallocatedDialog from '@/components/AllocateUnallocatedDialog.vue'
import AccountLimitsDialog from '@/components/AccountLimitsDialog.vue'
import OperationDialog from '@/components/OperationDialog.vue'
import AccountOperationItems from '@/components/AccountOperationItems.vue'
import { ACCOUNT_KINDS, type OperationKind } from '@/constants/operationKinds'
import PendingOpsCard from '@/components/PendingOpsCard.vue'
import { useRouter } from 'vue-router'

const store = useAccountingStore()
const toast = useToast()
const { isDark } = useIsDark()
const auth = useAuthStore()
const sections = useSections()
const cashboxes = useCashBoxesStore()
const router = useRouter()

/** Открыть карточку счёта: остаток, действия и лента операций. */
function openAccount(a: AccountView) {
  router.push(`/accounting/accounts/${a.id}`)
}

const showTransfer = ref(false)
const showOperation = ref(false)
/**
 * Какую операцию открыли из меню. Вид выбирается до окна, а не внутри него:
 * человек уже знает, что собирается сделать, и лишний шаг «выберите вид»
 * только замедляет.
 */
const operationKind = ref<OperationKind>('DEPOSIT')

/**
 * Счёт, с которого открыли операцию. Пусто — операцию начали из шапки, и счёт
 * выбирается уже в форме.
 */
const operationAccountId = ref<string | null>(null)

/** Перевод — своё окно: там пара счетов и предпросмотр остатков. */
function pickOperation(kind: OperationKind, accountId: string | null = null) {
  operationAccountId.value = accountId
  if (kind === 'TRANSFER') {
    showTransfer.value = true
    return
  }
  operationKind.value = kind
  showOperation.value = true
}
const canTransfer = computed(() => auth.can('accounting.transfer'))
/** Кому вообще доступен ввод денег: капитал, финансы или переводы. */
const canOperate = computed(
  () => auth.can('finance.capital') || auth.can('finance.transactions') || auth.can('accounting.transfer'),
)

const showDialog = ref(false)
const editing = ref<AccountView | null>(null)

/**
 * Вид списка счетов. Карточки удобны, пока счетов немного и важны цвета
 * банков; когда их полтора десятка — нужна таблица, где всё в одну строку и
 * взгляд идёт по колонке остатков. Выбор запоминаем: это привычка человека,
 * а не состояние страницы.
 */
type ViewMode = 'cards' | 'table'
const VIEW_KEY = 'accounting.accountsView'
// По умолчанию таблица: она отвечает на главный вопрос раздела — «сколько где
// лежит» — одним взглядом по колонке остатков. Карточки включают, когда
// счетов мало и хочется видеть цвета банков.
const viewMode = ref<ViewMode>(
  (localStorage.getItem(VIEW_KEY) as ViewMode) === 'cards' ? 'cards' : 'table',
)
watch(viewMode, (v) => localStorage.setItem(VIEW_KEY, v))

const canEdit = computed(() => auth.can('accounting.edit'))
/** Разнести деньги по счетам = пересчитать остатки, право то же. */
const canReconcile = computed(() => auth.can('accounting.reconcile'))
const showAllocate = ref(false)
/** Лимиты правятся отдельным окном — из меню счёта и из его настроек. */
const limitsTarget = ref<AccountView | null>(null)
const canCreate = computed(() => auth.can('accounting.create'))
const canToggle = computed(() => auth.can('accounting.toggle'))
const canDelete = computed(() => auth.can('accounting.delete'))

onMounted(() => {
  void load()
})

async function load() {
  try {
    await store.fetchAccounts()
    // Самопроверка молчит, пока всё сходится: показывать «всё хорошо» на
    // каждом заходе — шум, а вот расхождение обязано бросаться в глаза.
    await store.checkBalances()
    await store.fetchUnallocated()
    await store.fetchLimits()
    await store.fetchPending()
    // Доступные деньги — своим запросом: он собирает цифры из касс,
    // обязательств и счетов, и ради него не стоит задерживать список счетов.
    if (canSeeAvailable.value) void store.fetchAvailable().catch(() => {})
    if (!cashboxes.items.length) await cashboxes.fetchAll().catch(() => {})
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить счета')
  }
}

const GROUPS: Array<{ type: AccountType; title: string; hint: string; icon: string }> = [
  { type: 'CASH', title: 'Наличные', hint: 'Сейф, деньги на руках', icon: 'mdi-cash' },
  { type: 'BANK_CARD', title: 'Банки', hint: 'Карты и счета', icon: 'mdi-credit-card-outline' },
  { type: 'PAYMENT_POINT', title: 'Пункты приёма', hint: 'Магазины, принимающие оплату', icon: 'mdi-store-outline' },
]

/**
 * Касса, чьи счета смотрим. Пусто — все.
 *
 * Касса отвечает на вопрос «чьи деньги», счёт — «где они лежат». У партнёра с
 * несколькими кассами вопрос почти всегда конкретный: где деньги вот этой
 * кассы. Счета без кассы («общие») показываем всегда: на них могут лежать
 * деньги любой из них.
 */
const cashBoxFilter = ref('')

const cashBoxOptions = computed(() =>
  cashboxes.items
    .filter((b) => !b.archivedAt)
    .map((b) => ({ value: b.id, label: b.name, color: b.color })),
)
const showCashBoxFilter = computed(() => cashBoxOptions.value.length > 1)

const visible = computed(() => {
  if (!cashBoxFilter.value) return store.accounts
  return store.accounts.filter(
    (a) => a.cashBoxId === cashBoxFilter.value,
  )
})

const currentCashBox = computed(
  () => cashboxes.items.find((b) => b.id === cashBoxFilter.value) ?? null,
)

/**
 * Сколько денег лежит на счетах каждой кассы — показываем прямо в списке.
 *
 * Общие счета в сумму кассы не входят: они принадлежат всем сразу, и приписать
 * их одной кассе значило бы посчитать одни деньги несколько раз.
 */
const sumByCashBox = computed(() => {
  const map = new Map<string, number>()
  for (const a of store.accounts) {
    const id = a.cashBoxId
    if (!id || a.balance === null) continue
    map.set(id, (map.get(id) ?? 0) + a.balance)
  }
  return map
})

const {
  open: boxMenuOpen,
  anchor: boxMenuAnchor,
  menu: boxMenuEl,
  pos: boxMenuPos,
  flipped: boxMenuUp,
  toggle: toggleBoxMenu,
  close: closeBoxMenu,
} = useAnchoredMenu()

function pickCashBox(id: string) {
  cashBoxFilter.value = id
  closeBoxMenu()
}

/**
 * Фильтр по виду денег.
 *
 * При десятке карт и пяти пунктах приёма список счетов перестаёт помещаться на
 * экран, а искать глазами нужную группу дольше, чем нажать кнопку. Выбор живёт
 * до перезагрузки страницы: это взгляд на список, а не настройка раздела.
 */
const typeFilter = ref<AccountType | 'ALL'>('ALL')

const typeFilters = computed(() => [
  { key: 'ALL' as const, title: 'Все', count: visible.value.length },
  ...GROUPS.map((g) => ({
    key: g.type,
    title: g.title,
    count: visible.value.filter((a) => a.type === g.type).length,
  })).filter((g) => g.count > 0),
])

const filtered = computed(() =>
  typeFilter.value === 'ALL'
    ? visible.value
    : visible.value.filter((a) => a.type === typeFilter.value),
)

/**
 * Готов ли счёт принимать деньги.
 *
 * Выбранный лимит не запрещает перевод — банк его проведёт, и в жизни так и
 * бывает. Но в списке такой счёт должен читаться сразу: раньше он отличался
 * только приглушённым цветом, а это слишком тихо для «сюда лучше не лить».
 */
type AccountReady = { label: string; kind: 'ok' | 'off'; why: string }
function readyOf(a: AccountView): AccountReady {
  if (a.disabledAt) {
    return {
      label: 'Недоступен',
      kind: 'off',
      why: a.disabledReason || 'Счёт отключён — система не будет класть на него деньги сама',
    }
  }
  if (limitOf(a.id)?.full) {
    return {
      label: 'Недоступен',
      kind: 'off',
      why: 'Лимит по счёту выбран — следующий перевод банк может не пропустить',
    }
  }
  return { label: 'Доступен', kind: 'ok', why: 'Счёт принимает деньги' }
}
/** Порядок в списке: рабочие счета выше, недоступные — в конец. */
const READY_ORDER: Record<AccountReady['kind'], number> = { ok: 0, off: 1 }

const grouped = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    items: filtered.value
      .filter((a) => a.type === g.type)
      .slice()
      .sort((x, y) => READY_ORDER[readyOf(x).kind] - READY_ORDER[readyOf(y).kind]),
  })).filter((g) => g.items.length > 0),
)

/**
 * Остаток приходит `null`, если у сотрудника нет права видеть суммы. Тогда
 * счета остаются на месте, а деньги нигде не всплывают — ни в карточке, ни в
 * итоге.
 */
const canSeeBalance = computed(() => store.accounts.some((a) => a.balance !== null))

/**
 * «Доступные деньги»: сколько можно потратить прямо сейчас.
 *
 * Считает сервер — цифра слишком дорогая, чтобы собирать её на клиенте из
 * четырёх запросов и расходиться с кассой. Здесь только подписи к шагам:
 * человеку нужно не число, а причина, по которой остальное недоступно.
 *
 * Цифра общая по всем кассам и не реагирует на фильтр вверху страницы:
 * долги поставщикам и займы к кассе не привязаны, и делить их между кассами
 * было бы выдумкой.
 */
// Оба права: финансы дают саму кассу, «видеть общий баланс» — суммы по
// счетам внутри цепочки. Сервер требует того же, здесь только чтобы не
// ходить за заведомым отказом.
const canSeeAvailable = computed(() => auth.can('finance.view') && auth.can('accounting.balanceView'))
const avail = computed(() => store.available)
const availOpen = ref(localStorage.getItem('accounting.availOpen') === '1')
function toggleAvail() {
  availOpen.value = !availOpen.value
  localStorage.setItem('accounting.availOpen', availOpen.value ? '1' : '0')
}

/** Подписи шагов: что за сумма и почему она здесь. */
const STEP_TEXT: Record<string, { title: string; note: string }> = {
  broughtIn: {
    title: 'Завели в дело',
    note: 'Стартовый капитал касс, деньги со-инвесторов и ваши пополнения — за вычетом того, что вы уже забрали себе.',
  },
  deployed: {
    title: 'Ушло в закупки',
    note: 'Деньги, потраченные на товар по всем сделкам — и по действующим, и по закрытым.',
  },
  received: {
    title: 'Вернулось от клиентов',
    note: 'Все оплаты клиентов: первые взносы и платежи по графику.',
  },
  dividendOut: {
    title: 'Выплачено со-инвесторам',
    note: 'Дивиденды, которые вы уже отдали инвесторам на руки.',
  },
  loans: {
    title: 'Займы',
    note: 'Взяли и вернули, дали в долг и нам вернули — вместе.',
  },
  other: {
    title: 'Прочие операции',
    note: 'Ручные доходы и расходы и всё остальное движение по кассе.',
  },
  reconcile: {
    title: 'Инвентаризация',
    note: 'Пересчитали деньги и поправили остаток счёта. Касса о пересчёте не знает, поэтому поправка видна отдельной строкой.',
  },
  pendingIn: {
    title: 'Пришло без назначения',
    note: 'Деньги легли на счёт, но чьи они — ещё не решили. В кассе их пока нет.',
  },
  pendingOut: {
    title: 'Выдано под отчёт',
    note: 'Деньги ушли со счёта, а в кассе они ещё числятся — пока операцию не разнесли.',
  },
  disabledAccounts: {
    title: 'На отключённых счетах',
    note: 'Счёт отключён вручную: снять и перевести с него нельзя, пока вы его не включите.',
  },
  atPoints: {
    title: 'В пунктах приёма',
    note: 'Деньги приняты, но лежат у приёмщика — пока их не забрали, распорядиться ими нельзя.',
  },
  inHands: {
    title: 'На руках у сотрудников',
    note: 'Наличные на счетах, закреплённых за сотрудниками.',
  },

  owedToCoInvestors: {
    title: 'Должны со-инвесторам',
    note: 'Прибыль, начисленная инвесторам, но ещё не выплаченная. Деньги пока у вас, но они уже не ваши.',
  },
  borrowed: {
    title: 'Взято в долг',
    note: 'Заёмные деньги лежат на счетах и работают, но бизнесу не принадлежат — их придётся вернуть.',
  },
}

/** Шаги без нулей: пустые строки только мешают читать цепочку. */
const availInflow = computed(() => (avail.value?.inflow ?? []).filter((s) => s.amount !== 0))
const availLocked = computed(() => (avail.value?.locked ?? []).filter((s) => s.amount !== 0))

/** Общий остаток — сумма по всем счетам. */
const total = computed(() => visible.value.reduce((s, a) => s + (a.balance ?? 0), 0))

/**
 * Деньги на всех счетах, независимо от выбранной кассы.
 *
 * Нужно пункту «Все кассы» в списке: он обязан показывать сумму всех касс,
 * иначе после выбора одной кассы этот пункт повторял её же сумму — и выглядел
 * так, будто других денег нет.
 */
const totalAllBoxes = computed(() =>
  store.accounts.reduce((s, a) => s + (a.balance ?? 0), 0),
)

const totalByType = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    sum: visible.value
      .filter((a) => a.type === g.type)
      .reduce((s, a) => s + (a.balance ?? 0), 0),
    count: visible.value.filter((a) => a.type === g.type).length,
  })).filter((g) => g.count > 0),
)

/**
 * Доли видов денег в общем остатке. Показываем полосой: «сколько лежит
 * наличными» спрашивают чаще, чем точные суммы по каждому счёту.
 */
const shares = computed(() => {
  const t = total.value
  if (t <= 0) return []
  return totalByType.value
    .map((g) => ({ ...g, pct: Math.round((g.sum / t) * 100) }))
    .filter((g) => g.pct > 0)
})

/* Оттенки одного белого на зелёном сливаются — виды денег разводим цветом. */
const SHARE_COLORS: Record<AccountType, string> = {
  CASH: '#ffffff',
  BANK_CARD: '#6ee7b7',
  PAYMENT_POINT: '#fcd34d',
}

/**
 * Самое заполненное ограничение счёта — его и показываем.
 *
 * Показывать все четыре окна в строке таблицы бессмысленно: важно ближайшее
 * узкое место, остальное партнёр посмотрит в настройках счёта.
 */
/**
 * Доля счёта во всех деньгах на счетах.
 *
 * Отвечает на главный вопрос к списку: где сосредоточены деньги. По колонке
 * сумм это читается медленнее, чем по полоске одинаковой длины у всех карточек.
 * Считаем от видимых счетов, а не от всех: при включённом фильтре по виду денег
 * доля «от невидимого целого» сбивала бы с толку.
 */
const totalVisibleBalance = computed(() =>
  visible.value.reduce((sum, a) => sum + Math.max(a.balance ?? 0, 0), 0),
)

function shareOf(a: AccountView): number | null {
  const total = totalVisibleBalance.value
  if (!canSeeBalance.value || total <= 0 || a.balance === null || a.balance <= 0) return null
  return Math.round((a.balance / total) * 100)
}

function limitOf(accountId: string) {
  return store.limits.find((l) => l.id === accountId)?.limits.worst ?? null
}

function limitClass(accountId: string) {
  const w = limitOf(accountId)
  if (!w) return ''
  return w.full ? 'ac-limit--full' : w.warn ? 'ac-limit--warn' : ''
}

function limitText(accountId: string) {
  const w = limitOf(accountId)
  if (!w) return ''
  return w.kind === 'sum'
    ? `${formatCurrencyShort(w.used)} из ${formatCurrencyShort(w.limit)} за ${w.days} дн.`
    : `${w.used} из ${w.limit} операций за ${w.days} дн.`
}

/**
 * Сколько денег ещё без счёта — по выбранной кассе, а не по всем сразу.
 *
 * Считать общей суммой нельзя: у одной кассы деньги могут быть не разложены,
 * у другой (после импорта) журнал уходит в минус, и в сумме получается минус —
 * блок исчезает ровно там, где он нужнее всего. Смотрят всегда конкретную
 * кассу, по ней и считаем.
 */
const boxUnallocated = ref<number | null>(null)

async function refreshUnallocated() {
  try {
    boxUnallocated.value = cashBoxFilter.value
      ? (await store.fetchCashBoxFree(cashBoxFilter.value)).unallocated
      : null
  } catch {
    boxUnallocated.value = null
  }
}

watch(cashBoxFilter, () => { void refreshUnallocated() })

const unallocatedAmount = computed(() =>
  Math.round(
    (cashBoxFilter.value ? boxUnallocated.value : store.unallocated?.unallocated) ?? 0,
  ),
)

/**
 * Чья касса держит деньги на этом счёте. Пусто — счёт общий.
 *
 * Показываем прямо в списке: без этого привязка существовала только внутри
 * формы, и понять, к какой кассе относится счёт, было неоткуда.
 */
function cashBoxOf(a: AccountView): { name: string; color: string } | null {
  const box = cashboxes.items.find((b) => b.id === a.cashBoxId)
  return box ? { name: box.name, color: box.color } : null
}

function accentOf(a: AccountView): string {
  return a.bank?.color || a.color || '#047857'
}

/**
 * Фирменный цвет банка годится для полоски, но не для текста: жёлтый Т-Банка
 * на белом фоне не читается, тёмно-синий ВТБ — на чёрном. Подтягиваем яркость
 * к границе читаемости, оттенок при этом сохраняется.
 */
function readable(hex: string): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return hex
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const k = isDark.value
    ? (lum < 0.5 ? 0.5 / Math.max(lum, 0.05) : 1)
    : (lum > 0.55 ? 0.55 / lum : 1)
  if (k === 1) return hex
  const f = (v: number) => Math.min(255, Math.round(v * k)).toString(16).padStart(2, '0')
  return `#${f(r)}${f(g)}${f(b)}`
}

function openCreate() {
  editing.value = null
  showDialog.value = true
}

function openEdit(a: AccountView) {
  editing.value = a
  showDialog.value = true
}

/**
 * Отключение спрашивает причину: через неделю никто не вспомнит, почему карта
 * выключена, а «выбран лимит» и «заблокировал банк» — разные истории.
 * Включение обратно вопросов не требует.
 */
const offTarget = ref<AccountView | null>(null)
const offReason = ref('')
const offBusy = ref(false)
const OFF_REASONS = ['Достигнут лимит', 'Заблокирован банком', 'Карта перевыпускается', 'Временно не используем']

async function toggle(a: AccountView) {
  if (a.disabledAt) {
    try {
      await store.toggleAccount(a.id, true)
      toast.success('Счёт включён')
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось включить счёт')
    }
    return
  }
  offReason.value = ''
  offTarget.value = a
}

async function confirmDisable() {
  if (!offTarget.value) return
  offBusy.value = true
  try {
    await store.toggleAccount(offTarget.value.id, false, offReason.value.trim() || undefined)
    toast.success('Счёт отключён')
    offTarget.value = null
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отключить счёт')
  } finally {
    offBusy.value = false
  }
}

/** Пересобрать остатки из движений — когда самопроверка нашла расхождение. */
const fixing = ref(false)
async function recompute() {
  fixing.value = true
  try {
    const fixed = await store.recomputeBalances()
    toast.success(fixed.length ? `Остатки пересобраны: ${fixed.length}` : 'Расхождений не осталось')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось пересобрать остатки')
  } finally {
    fixing.value = false
  }
}

async function remove(a: AccountView) {
  if (!confirm(`Удалить счёт «${a.name}» полностью? Действие необратимо.`)) return
  try {
    await store.removeAccount(a.id)
    toast.success('Счёт удалён')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось удалить счёт')
  }
}

function statusOf(a: AccountView): { label: string; kind: 'off' } | null {
  if (a.disabledAt) return { label: a.disabledReason || 'Отключён', kind: 'off' }
  return null
}
</script>

<template>
  <div class="ac-page" :class="{ dark: isDark }">
    <AccountingTabs />

    <!-- Расхождение остатка со списком операций — единственное, что обязано
         кричать: значит, деньги записали мимо счёта. -->
    <div v-if="store.balanceIssues.length" class="ac-alert">
      <v-icon icon="mdi-alert-circle-outline" size="20" />
      <div class="ac-alert-body">
        <div class="ac-alert-title">Остаток не сходится с операциями</div>
        <div class="ac-alert-text">
          <template v-for="(i, n) in store.balanceIssues" :key="i.accountId">
            <span v-if="n">, </span>{{ i.name }} — расхождение {{ formatCurrency(i.diff) }}
          </template>
        </div>
      </div>
      <!-- Истина — список операций, хранимое число лишь ускоряет списки.
           Поэтому лечение одно: пересчитать остаток по операциям. -->
      <button v-if="canEdit" class="ac-alert-btn" :disabled="fixing" @click="recompute">
        {{ fixing ? 'Считаю…' : 'Пересчитать по операциям' }}
      </button>
    </div>

    <div v-if="store.loading && !store.accounts.length" class="ac-loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Шапка раздела: главное число крупно, остальное — рядом с ним -->
      <div class="ac-hero">
        <div class="ac-hero-actions">
          <v-menu v-if="canOperate && visible.length" location="bottom end" offset="6">
            <template #activator="{ props: menuProps }">
              <button class="ac-hero-btn" v-bind="menuProps">
                <v-icon icon="mdi-plus-circle-outline" size="16" />
                Операции
                <v-icon icon="mdi-chevron-down" size="15" class="ac-hero-btn-caret" />
              </button>
            </template>
            <v-card rounded="lg" elevation="6" class="ac-opmenu">
              <!-- Только работа со счетами: внести, снять, перевести. Всё
                   остальное — в разделе «Временные операции», у него свой
                   смысл и свой итог. -->
              <AccountOperationItems :kinds="ACCOUNT_KINDS" @pick="pickOperation($event)" />
            </v-card>
          </v-menu>
          <button v-if="canCreate && visible.length" class="ac-hero-btn ac-hero-btn--main" @click="openCreate">
            <v-icon icon="mdi-plus" size="16" />
            Новый счёт
          </button>
        </div>

        <!-- Касса выбирается здесь, а не в списке ниже: она меняет и сумму в
             шапке, и разбивку, и сам список — то есть весь экран, а не одну
             таблицу. Селект в панели «Счета» это скрывал. -->
        <div v-if="showCashBoxFilter" ref="boxMenuAnchor" class="ac-hero-picker">
          <button class="ac-hero-select" :class="{ 'ac-hero-select--open': boxMenuOpen }" @click="toggleBoxMenu()">
            <span v-if="currentCashBox" class="ac-hero-select-dot" :style="{ background: currentCashBox.color }" />
            <v-icon v-else icon="mdi-wallet-outline" size="15" />
            <span class="ac-hero-select-label">{{ currentCashBox?.name || 'Все кассы' }}</span>
            <v-icon
              icon="mdi-chevron-down"
              size="17"
              class="ac-hero-select-caret"
              :class="{ 'ac-hero-select-caret--rot': boxMenuOpen }"
            />
          </button>

          <Teleport to="body">
            <!-- Всплывает от кнопки, как меню «Операции» рядом: мгновенное
                 появление рядом с ним читалось как сбой отрисовки. -->
            <Transition name="menu-pop">
            <div
              v-if="boxMenuOpen"
              ref="boxMenuEl"
              class="ac-boxmenu"
              :class="{ 'menu-pop--up': boxMenuUp }"
              :style="{ top: boxMenuPos.top + 'px', left: boxMenuPos.left + 'px', minWidth: boxMenuPos.width + 'px' }"
            >
              <button
                class="ac-boxmenu-item"
                :class="{ 'ac-boxmenu-item--on': !cashBoxFilter }"
                @click="pickCashBox('')"
              >
                <v-icon icon="mdi-wallet-outline" size="16" class="ac-boxmenu-ico" />
                <span class="ac-boxmenu-body">
                  <span class="ac-boxmenu-title">Все кассы</span>
                  <span class="ac-boxmenu-hint">Все счета вместе</span>
                </span>
                <span v-if="canSeeBalance" class="ac-boxmenu-sum">{{ formatCurrency(totalAllBoxes) }}</span>
              </button>

              <div class="ac-boxmenu-divider" />

              <button
                v-for="b in cashBoxOptions"
                :key="b.value"
                class="ac-boxmenu-item"
                :class="{ 'ac-boxmenu-item--on': cashBoxFilter === b.value }"
                @click="pickCashBox(b.value)"
              >
                <span class="ac-boxmenu-dot" :style="{ background: b.color }" />
                <span class="ac-boxmenu-body">
                  <span class="ac-boxmenu-title">{{ b.label }}</span>
                  <!-- Общие счета в сумму кассы не входят: они принадлежат
                       всем сразу. -->
                  <span class="ac-boxmenu-hint">Свои счета кассы</span>
                </span>
                <span v-if="canSeeBalance" class="ac-boxmenu-sum">
                  {{ formatCurrency(sumByCashBox.get(b.value) ?? 0) }}
                </span>
              </button>
            </div>
          </Transition>
          </Teleport>
        </div>

        <div class="ac-hero-label">{{ canSeeBalance ? 'Всего на счетах' : 'Счета' }}</div>
        <template v-if="canSeeBalance">
          <div class="ac-hero-amount">{{ formatCurrency(total) }}</div>
          <div class="ac-hero-sub">
            <template v-if="currentCashBox">
              Где лежат деньги кассы «{{ currentCashBox.name }}» — вместе с общими счетами
            </template>
            <template v-else>Деньги, которые сейчас у вас на руках и на картах</template>
          </div>
        </template>
        <div v-else class="ac-hero-sub ac-hero-sub--hidden">
          Суммы скрыты — у вас нет доступа к остаткам счетов
        </div>

        <div v-if="canSeeBalance && totalByType.length" class="ac-hero-metrics">
          <template v-for="(g, i) in totalByType" :key="g.type">
            <div v-if="i" class="ac-hero-divider" />
            <div class="ac-hero-metric">
              <div class="ac-hero-metric-value">{{ formatCurrency(g.sum) }}</div>
              <div class="ac-hero-metric-label">
                <v-icon :icon="g.icon" size="13" />
                {{ g.title }} · {{ g.count }}
              </div>
            </div>
          </template>
        </div>

        <!-- Полоса долей: сколько денег наличными, сколько на картах -->
        <div v-if="shares.length > 1" class="ac-hero-bar">
          <div
            v-for="g in shares"
            :key="g.type"
            class="ac-hero-bar-part"
            :style="{ width: g.pct + '%', background: SHARE_COLORS[g.type] }"
            :title="`${g.title} — ${g.pct}%`"
          />
        </div>
        <div v-if="shares.length > 1" class="ac-hero-bar-legend">
          <span v-for="g in shares" :key="g.type" class="ac-hero-legend-item">
            <span class="ac-hero-legend-dot" :style="{ background: SHARE_COLORS[g.type] }" />
            {{ g.title }} {{ g.pct }}%
          </span>
        </div>
      </div>

      <!-- Доступные деньги: главный ответ раздела. Одной суммы мало — рядом
           обязана стоять цепочка, иначе это очередная цифра, которой нет
           причины верить. -->
      <div v-if="canSeeAvailable && avail && canSeeBalance" class="av-card">
        <div class="av-head">
          <div class="av-head-main">
            <div class="av-label">Доступно сейчас</div>
            <div class="av-amount" :class="{ 'av-amount--neg': avail.available < 0 }">
              {{ formatCurrency(avail.available) }}
            </div>
            <div class="av-sub">
              Из {{ formatCurrency(avail.cashInBox) }}, которые есть сейчас, свободно распорядиться можно этой суммой
            </div>
            <!-- Пока учёт не сходится, выдавать цифру за точную нельзя. -->
            <div v-if="avail.warnings.includes('accountsExceedCash')" class="av-warn">
              <v-icon icon="mdi-alert-outline" size="15" />
              На счетах записано больше, чем есть в кассах — на
              {{ formatCurrency(Math.abs(avail.notes.unallocated)) }}. Пока расхождение не устранено,
              сумма приблизительная.
            </div>
          </div>
          <button class="av-toggle" @click="toggleAvail">
            {{ availOpen ? 'Свернуть' : 'Откуда эта сумма' }}
            <v-icon :icon="availOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
          </button>
        </div>

        <!-- Цепочка: сначала как деньги появились, потом что из них занято.
             Свёрнута по умолчанию — ежедневно нужен итог, а разбор открывают,
             когда цифра удивила. -->
        <div v-if="availOpen" class="av-chain">
          <div class="av-chain-title">Сколько денег есть на самом деле</div>
          <div v-for="s in availInflow" :key="s.key" class="av-step">
            <div class="av-step-sign" :class="`av-step-sign--${s.sign === '-' ? 'minus' : 'plus'}`">
              {{ s.sign }}
            </div>
            <div class="av-step-body">
              <div class="av-step-title">{{ STEP_TEXT[s.key]?.title || s.key }}</div>
              <div class="av-step-note">{{ STEP_TEXT[s.key]?.note }}</div>
            </div>
            <div class="av-step-sum">{{ formatCurrency(s.amount) }}</div>
          </div>

          <div class="av-total">
            <div class="av-total-title">Всего денег сейчас</div>
            <div class="av-total-sum">{{ formatCurrency(avail.cashInBox) }}</div>
          </div>

          <div v-if="availLocked.length" class="av-chain-title av-chain-title--gap">
            Что из них уже занято
          </div>
          <div v-for="s in availLocked" :key="s.key" class="av-step">
            <div class="av-step-sign av-step-sign--minus">−</div>
            <div class="av-step-body">
              <div class="av-step-title">{{ STEP_TEXT[s.key]?.title || s.key }}</div>
              <div class="av-step-note">{{ STEP_TEXT[s.key]?.note }}</div>
            </div>
            <div class="av-step-sum">{{ formatCurrency(s.amount) }}</div>
          </div>

          <div class="av-total av-total--final">
            <div class="av-total-title">Доступно сейчас</div>
            <div class="av-total-sum" :class="{ 'av-amount--neg': avail.available < 0 }">
              {{ formatCurrency(avail.available) }}
            </div>
          </div>

          <!-- Справки: в цепочке не участвуют, но без них цифры выглядят
               странно — «почему в сейфе больше, чем в кассе». -->
          <div class="av-notes">
            <div class="av-notes-title">Рядом, но в расчёт не входит</div>
            <div v-if="avail.notes.inProgress > 0" class="av-note">
              <b>{{ formatCurrency(avail.notes.inProgress) }}</b> — в товаре по действующим сделкам.
              Эти деньги уже ушли из кассы, поэтому второй раз не вычитаются.
            </div>
            <div v-if="avail.notes.supplierDebt > 0" class="av-note">
              <b>{{ formatCurrency(avail.notes.supplierDebt) }}</b> — долг поставщикам. Касса списала
              закупку ещё при создании сделки, поэтому эти деньги у вас на руках есть, а в кассе
              их уже нет — вычитать их ещё раз значило бы отнять одну сумму дважды.
            </div>
            <div v-if="avail.notes.clientsOwe > 0" class="av-note">
              <b>{{ formatCurrency(avail.notes.clientsOwe) }}</b> — должны клиенты по действующим
              сделкам. Эти деньги ещё не пришли.
            </div>
            <div v-if="avail.notes.lentOut > 0" class="av-note">
              <b>{{ formatCurrency(avail.notes.lentOut) }}</b> — вам должны по выданным займам.
              Деньги из кассы уже ушли и вернутся позже.
            </div>
          </div>
        </div>
      </div>

      <!-- Пусто -->
      <div v-if="!visible.length" class="ac-empty">
        <v-icon icon="mdi-wallet-outline" size="40" />
        <div class="ac-empty-title">Счетов пока нет</div>
        <div class="ac-empty-text">
          Заведите сейф и карты, на которые принимаете оплату, — и каждая оплата
          будет знать, куда легли деньги.
        </div>
        <button v-if="canCreate" class="ac-btn-primary" @click="openCreate">Завести первый счёт</button>
      </div>

      <!-- Деньги, про которые ещё не сказано, где они лежат. Показываем
           всегда, пока сумма не нулевая: без этой строки сумма счетов молча
           не сходилась бы с кассой, и партнёр решил бы, что деньги пропали. -->
      <!-- Только положительный остаток: «разнести» имеет смысл, когда деньги
           в кассе есть, а место хранения не указано. Обратный случай (на
           счетах записано больше, чем в кассе) — ошибка учёта, её лечит
           инвентаризация счёта, а не раскладывание по счетам. -->
      <div v-if="unallocatedAmount > 0" class="ac-unalloc">
        <div class="ac-unalloc-icon"><v-icon icon="mdi-help-circle-outline" size="20" /></div>
        <div class="ac-unalloc-body">
          <div class="ac-unalloc-title">
            Не разнесено по счетам<template v-if="currentCashBox"> · {{ currentCashBox.name }}</template>
          </div>
          <div class="ac-unalloc-text">
            Деньги в кассе есть, но не сказано, где они лежат: старые операции
            и оплаты без выбора счёта. Разнесите их — сумма счетов сойдётся
            с кассой, а в кассе и капитале ничего не изменится.
          </div>
        </div>
        <div class="ac-unalloc-right">
          <div class="ac-unalloc-sum">{{ formatCurrency(unallocatedAmount) }}</div>
          <!-- Разносить может тот же, кто пересчитывает деньги на счетах:
               под капотом это и есть пересчёт остатка. -->
          <button
            v-if="canReconcile"
            class="ac-unalloc-btn"
            @click="showAllocate = true"
          >
            <v-icon icon="mdi-arrow-decision-outline" size="16" />
            Разнести
          </button>
        </div>
      </div>

      <!-- Деньги без назначения: пока буфер не пуст, часть денег не отнесена
           ни к чему — это должно быть видно постоянно. -->
      <PendingOpsCard v-if="sections.visible('pettyExpenses')" @changed="load" />

      <!-- Пора забрать деньги из пунктов приёма. Мелкие суммы копятся
           неделями и незаметно становятся крупными, лежащими у чужого
           человека, — поэтому напоминание видно сразу, а не в отчёте. -->
      <div v-if="store.pickups.length" class="ac-pickups">
        <div class="ac-pickups-head">
          <v-icon icon="mdi-package-variant-closed" size="18" />
          <span class="ac-pickups-title">Пора забрать деньги</span>
        </div>
        <div class="ac-pickup" v-for="p in store.pickups" :key="p.id">
          <div class="ac-pickup-body">
            <div class="ac-pickup-name">{{ p.name }}<template v-if="p.contactName"> · {{ p.contactName }}</template></div>
            <div class="ac-pickup-why">
              <template v-if="p.reason === 'amount'">Накопилось больше {{ formatCurrency(p.threshold ?? 0) }}</template>
              <template v-else-if="p.daysSinceLastPickup !== null">Не забирали {{ p.daysSinceLastPickup }} дн.</template>
              <template v-else>Деньги ещё ни разу не забирали</template>
            </div>
          </div>
          <div class="ac-pickup-sum">{{ formatCurrency(p.balance) }}</div>
          <button v-if="canTransfer" class="ac-pickup-btn" @click="openAccount({ id: p.id } as any)">
            Забрать
          </button>
        </div>
      </div>

      <!-- Счета: заголовок, фильтры и сам список — один блок.
           Раньше это были три отдельных плитки на сером фоне, и таблица
           читалась как что-то постороннее рядом с управлением. -->
      <div v-if="visible.length" class="ac-panel">
        <div class="ac-panel-head">
          <div class="ac-panel-head-left">
            <div class="ac-panel-title">Счета</div>
            <!-- Пояснение нужно один раз — при первом знакомстве с разделом.
                 Дальше оно только занимает место рядом с заголовком. -->
            <v-tooltip location="right" max-width="280">
              <template #activator="{ props }">
                <button class="ac-info-btn" v-bind="props" type="button">
                  <v-icon icon="mdi-information-outline" size="14" />
                </button>
              </template>
              <span>
                Счёт — место, где физически лежат деньги: сейф, карта банка или
                магазин-партнёр, принимающий оплату. Касса отвечает на вопрос
                «чьи деньги», счёт — «где они».
              </span>
            </v-tooltip>
            <span class="ac-panel-count">{{ visible.length }}</span>
          </div>

          <div class="ac-panel-actions">
            <!-- Фильтр по виду денег: у кого десяток карт, тот ищет нужную
                 группу дольше, чем нажимает кнопку. -->
            <div v-if="typeFilters.length > 2" class="ac-type-filter">
              <button
                v-for="f in typeFilters"
                :key="f.key"
                class="ac-type-btn"
                :class="{ 'ac-type-btn--on': typeFilter === f.key }"
                @click="typeFilter = f.key"
              >
                {{ f.title }}
                <span class="ac-type-count">{{ f.count }}</span>
              </button>
            </div>
            <!-- Переключатель вида: карточки для наглядности, таблица — когда
                 счетов много и нужен взгляд по колонке остатков. -->
            <div class="ac-view-switch">
              <button
                class="ac-view-btn"
                :class="{ 'ac-view-btn--on': viewMode === 'cards' }"
                title="Карточками"
                @click="viewMode = 'cards'"
              >
                <v-icon icon="mdi-view-grid-outline" size="16" />
              </button>
              <button
                class="ac-view-btn"
                :class="{ 'ac-view-btn--on': viewMode === 'table' }"
                title="Таблицей"
                @click="viewMode = 'table'"
              >
                <v-icon icon="mdi-format-list-bulleted" size="16" />
              </button>
            </div>
          </div>
        </div>

        <!-- Таблица: те же счета, но строками и с разделением по видам денег -->
        <div v-if="viewMode === 'table'" class="ac-table-scroll">
          <div class="ac-table">
            <div class="ac-tr ac-tr--head">
              <div>Счёт</div>
              <div>Название</div>
              <div>Где</div>
              <div>Реквизиты</div>
              <div>Метки</div>
              <div>Состояние</div>
              <div class="ac-td--right">Остаток</div>
              <div />
            </div>

            <div v-for="g in grouped" :key="g.type" class="ac-group-block">
              <!-- Смысловая граница: наличные, банки и пункты приёма — разные
                   деньги, и складывать их взглядом в одну кучу нельзя.
                   Полоса-подзаголовок вместо отступа с линией: список остаётся
                   сплошным, а границы между видами денег всё равно видны. -->
              <div class="ac-grouprow">
                <div class="ac-grouprow-left">
                  <v-icon :icon="g.icon" size="14" />
                  <span class="ac-grouprow-title">{{ g.title }}</span>
                  <span class="ac-grouprow-count">{{ g.items.length }}</span>
                  <span class="ac-grouprow-hint">{{ g.hint }}</span>
                </div>
                <div v-if="canSeeBalance" class="ac-grouprow-sum">
                  {{ formatCurrency(g.items.reduce((s2, a) => s2 + (a.balance ?? 0), 0)) }}
                </div>
              </div>

              <div
                v-for="a in g.items"
                :key="a.id"
                class="ac-tr ac-tr--link"
                :class="{ 'ac-tr--muted': !!a.disabledAt }"
                @click="openAccount(a)"
              >
                <div>
                  <span class="ac-code ac-code--sm" :style="{ background: accentOf(a) + '18', color: readable(accentOf(a)) }">
                    {{ a.code }}
                  </span>
                </div>
                <!-- Логотип рядом с названием: строку счёта читают отсюда, и банк
                     должен попадать в поле зрения вместе с именем карты. -->
                <div class="ac-td-account">
                  <BankLogo
                    v-if="a.bank"
                    :bank-name="a.bank.name"
                    :color="accentOf(a)"
                    :fallback="a.bank.shortName"
                    :size="26"
                  />
                  <div class="ac-td-account-body">
                    <div class="ac-td-name" :title="a.name">{{ a.name }}</div>
                    <div v-if="a.isDefaultForCash || a.isDefaultForBank || statusOf(a)" class="ac-td-badges">
                      <span v-if="a.isDefaultForCash || a.isDefaultForBank" class="ac-default">по умолчанию</span>
                      <span
                        v-if="statusOf(a)"
                        class="ac-status"
                        :class="`ac-status--${statusOf(a)!.kind}`"
                      >{{ statusOf(a)!.label }}</span>
                    </div>
                  </div>
                </div>
                <!-- Не название банка: оно уже стоит логотипом у имени счёта.
                     Здесь — чьи это деньги: касса, за которой закреплён счёт,
                     а под ней вид денег. -->
                <div class="ac-td-box">
                  <span v-if="cashBoxOf(a)" class="ac-boxtag">
                    <span class="ac-boxtag-dot" :style="{ background: cashBoxOf(a)!.color }" />
                    {{ cashBoxOf(a)!.name }}
                  </span>
                  <span class="ac-td-dim">
                    <span v-if="a.type === 'BANK_CARD'">Банковский счёт</span>
                    <span v-else-if="a.pickup?.contactName">{{ a.pickup.contactName }}</span>
                    <span v-else>{{ g.title }}</span>
                  </span>
                </div>
                <div class="ac-td-dim">
                  <span v-if="a.transferPhone">
                    {{ formatPhone(a.transferPhone) }}<template v-if="a.holderName"> · {{ a.holderName }}</template>
                  </span>
                  <span v-else-if="a.pickup?.address">{{ a.pickup.address }}</span>
                  <span v-else>—</span>
                </div>
                <div class="ac-td-tags">
                  <span
                    v-for="t in a.tags"
                    :key="t.id"
                    class="ac-tag"
                    :style="{ borderColor: readable(t.color), color: readable(t.color) }"
                  >{{ t.name }}</span>
                  <span v-if="!a.tags.length" class="ac-td-dim">—</span>
                </div>
                <!-- Готовность счёта: исчерпанный лимит должно быть видно из
                     списка, не наводя курсор на полоску под остатком. -->
                <div class="ac-td-ready">
                  <span
                    class="ac-ready"
                    :class="`ac-ready--${readyOf(a).kind}`"
                    :title="readyOf(a).why"
                  >
                    <span class="ac-ready-dot" />
                    {{ readyOf(a).label }}
                  </span>
                </div>
                <div class="ac-td--right ac-td-amount">
                  {{ a.balance !== null ? formatCurrency(a.balance) : '—' }}
                  <!-- Самое узкое место по лимитам: если карта скоро упрётся в
                       потолок, узнать об этом лучше заранее. -->
                  <div v-if="limitOf(a.id)" class="ac-limit" :class="limitClass(a.id)">
                    <div class="ac-limit-bar">
                      <div class="ac-limit-fill" :style="{ width: limitOf(a.id)!.pct + '%' }" />
                    </div>
                    <span class="ac-limit-text">{{ limitText(a.id) }}</span>
                  </div>
                </div>
                <div class="ac-td--right">
                  <v-menu location="bottom end" offset="6">
                    <template #activator="{ props }">
                      <button class="ac-menu-btn" v-bind="props" @click.stop>
                        <v-icon icon="mdi-dots-vertical" size="18" />
                      </button>
                    </template>
                    <v-card rounded="lg" elevation="4" class="ac-menu">
                      <!-- Операции по этому счёту: те же окна, что и в шапке раздела, но
                           счёт в них уже выбран — из списка это самый короткий путь
                           внести или снять деньги. -->
                      <template v-if="canOperate">
                        <AccountOperationItems
                          compact
                          :kinds="ACCOUNT_KINDS"
                          @pick="pickOperation($event, a.id)"
                        />
                        <div class="ac-menu-divider" />
                      </template>
                      <button v-if="canEdit" class="ac-menu-item" @click="openEdit(a)">
                        <v-icon icon="mdi-pencil-outline" size="16" /><span>Изменить</span>
                      </button>
                      <button v-if="canEdit" class="ac-menu-item" @click="limitsTarget = a">
                        <v-icon icon="mdi-speedometer" size="16" /><span>Изменить лимиты</span>
                      </button>
                      <button v-if="canToggle" class="ac-menu-item" @click="toggle(a)">
                        <v-icon :icon="a.disabledAt ? 'mdi-play-circle-outline' : 'mdi-pause-circle-outline'" size="16" />
                        <span>{{ a.disabledAt ? 'Включить' : 'Отключить' }}</span>
                      </button>
                      <template v-if="canDelete">
                        <div class="ac-menu-divider" />
                        <button class="ac-menu-item ac-menu-item--danger" @click="remove(a)">
                          <v-icon icon="mdi-delete-outline" size="16" /><span>Удалить</span>
                        </button>
                      </template>
                    </v-card>
                  </v-menu>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Карточки: тот же список и те же группы, что в таблице. Карточка
             отвечает на три вопроса сразу — сколько на счёте, какая это доля
             всех денег и не упирается ли счёт в лимит. -->
        <div v-else class="ac-cards-body">
          <div v-for="g in grouped" :key="g.type" class="ac-cards-group">
            <div class="ac-grouprow">
              <div class="ac-grouprow-left">
                <v-icon :icon="g.icon" size="14" />
                <span class="ac-grouprow-title">{{ g.title }}</span>
                <span class="ac-grouprow-count">{{ g.items.length }}</span>
                <span class="ac-grouprow-hint">{{ g.hint }}</span>
              </div>
              <div v-if="canSeeBalance" class="ac-grouprow-sum">
                {{ formatCurrency(g.items.reduce((s2, a) => s2 + (a.balance ?? 0), 0)) }}
              </div>
            </div>

            <div class="ac-grid">
              <article
                v-for="a in g.items"
                :key="a.id"
                class="ac-c"
                :class="{ 'ac-c--muted': !!a.disabledAt }"
                :style="{ '--ac-accent': accentOf(a) }"
                @click="openAccount(a)"
              >
                <div class="ac-c-top">
                  <!-- Банк узнают по логотипу, а у сейфа и пункта приёма логотипа
                       нет — там иконка вида денег. Раньше в этом месте стоял код
                       счёта, и он же повторялся строкой ниже. -->
                  <BankLogo
                    v-if="a.bank"
                    :bank-name="a.bank.name"
                    :color="accentOf(a)"
                    :fallback="a.bank.shortName"
                    :size="40"
                  />
                  <div
                    v-else
                    class="ac-c-ico"
                    :style="{ background: accentOf(a) + '18', color: readable(accentOf(a)) }"
                  >
                    <v-icon :icon="g.icon" size="20" />
                  </div>
                  <div class="ac-c-id">
                    <div class="ac-c-name" :title="a.name">{{ a.name }}</div>
                    <div class="ac-c-meta">
                      <span class="ac-code-inline" :style="{ background: accentOf(a) + '18', color: readable(accentOf(a)) }">{{ a.code }}</span>
                      <span class="ac-c-where">
                        <template v-if="a.bank">{{ a.bank.name }}</template>
                        <template v-else-if="a.type === 'PAYMENT_POINT' && a.pickup?.contactName">{{ a.pickup.contactName }}</template>
                        <template v-else>{{ g.title }}</template>
                      </span>
                      <!-- Чья касса: у партнёра с несколькими кассами это
                           первое, что нужно знать о счёте. -->
                      <span v-if="cashBoxOf(a)" class="ac-boxtag">
                        <span class="ac-boxtag-dot" :style="{ background: cashBoxOf(a)!.color }" />
                        {{ cashBoxOf(a)!.name }}
                      </span>
                    </div>
                  </div>

                  <v-menu location="bottom end" offset="6">
                    <template #activator="{ props }">
                      <button class="ac-menu-btn" v-bind="props" @click.stop>
                        <v-icon icon="mdi-dots-vertical" size="18" />
                      </button>
                    </template>
                    <v-card rounded="lg" elevation="4" class="ac-menu">
                      <!-- Операции по этому счёту: те же окна, что и в шапке раздела,
                           но счёт в них уже выбран. -->
                      <template v-if="canOperate">
                        <AccountOperationItems
                          compact
                          :kinds="ACCOUNT_KINDS"
                          @pick="pickOperation($event, a.id)"
                        />
                        <div class="ac-menu-divider" />
                      </template>
                      <button v-if="canEdit" class="ac-menu-item" @click="openEdit(a)">
                        <v-icon icon="mdi-pencil-outline" size="16" /><span>Изменить</span>
                      </button>
                      <button v-if="canEdit" class="ac-menu-item" @click="limitsTarget = a">
                        <v-icon icon="mdi-speedometer" size="16" /><span>Изменить лимиты</span>
                      </button>
                      <button v-if="canToggle" class="ac-menu-item" @click="toggle(a)">
                        <v-icon :icon="a.disabledAt ? 'mdi-play-circle-outline' : 'mdi-pause-circle-outline'" size="16" />
                        <span>{{ a.disabledAt ? 'Включить' : 'Отключить' }}</span>
                      </button>
                      <template v-if="canDelete">
                        <div class="ac-menu-divider" />
                        <button class="ac-menu-item ac-menu-item--danger" @click="remove(a)">
                          <v-icon icon="mdi-delete-outline" size="16" /><span>Удалить</span>
                        </button>
                      </template>
                    </v-card>
                  </v-menu>
                </div>

                <div v-if="a.balance !== null" class="ac-c-money">
                  <div class="ac-c-sum">{{ formatCurrency(a.balance) }}</div>
                  <!-- Доля счёта в общих деньгах: главный вопрос к списку счетов —
                       «где сосредоточены деньги», и по одним суммам он читается
                       медленнее, чем по полоске одной длины у всех карточек. -->
                  <div v-if="shareOf(a) !== null" class="ac-c-share">
                    <div class="ac-c-share-bar">
                      <div class="ac-c-share-fill" :style="{ width: Math.max(shareOf(a)!, 1.5) + '%' }" />
                    </div>
                    <span class="ac-c-share-text">{{ shareOf(a) }}% всех денег</span>
                  </div>
                </div>

                <!-- Лимит показываем и в карточках: раньше он был только в
                     таблице, и «карта вот-вот упрётся» было видно не всем. -->
                <div v-if="limitOf(a.id)" class="ac-limit ac-c-limit" :class="limitClass(a.id)">
                  <div class="ac-limit-bar">
                    <div class="ac-limit-fill" :style="{ width: limitOf(a.id)!.pct + '%' }" />
                  </div>
                  <span class="ac-limit-text">{{ limitText(a.id) }}</span>
                </div>

                <div v-if="a.transferPhone || a.pickup?.address" class="ac-c-row">
                  <v-icon :icon="a.transferPhone ? 'mdi-phone-outline' : 'mdi-map-marker-outline'" size="13" />
                  <span v-if="a.transferPhone">
                    {{ formatPhone(a.transferPhone) }}<template v-if="a.holderName"> · {{ a.holderName }}</template>
                  </span>
                  <span v-else>{{ a.pickup?.address }}</span>
                </div>

                <div
                  v-if="a.tags.length || statusOf(a) || a.isDefaultForCash || a.isDefaultForBank"
                  class="ac-c-foot"
                >
                  <span v-if="a.isDefaultForCash || a.isDefaultForBank" class="ac-default">по умолчанию</span>
                  <span
                    v-for="t in a.tags"
                    :key="t.id"
                    class="ac-tag"
                    :style="{ borderColor: readable(t.color), color: readable(t.color) }"
                  >{{ t.name }}</span>
                  <span
                    v-if="statusOf(a)"
                    class="ac-status"
                    :class="`ac-status--${statusOf(a)!.kind}`"
                  >{{ statusOf(a)!.label }}</span>
                </div>
              </article>
            </div>
          </div>
        </div>
      </div>

    </template>

    <!-- Новый счёт заводится в ту кассу, что сейчас выбрана в шапке. -->
    <AccountEditDialog
      v-model="showDialog"
      :account="editing"
      :default-cash-box-id="cashBoxFilter || null"
      @saved="load"
    />
    <!-- Раскладываем по счетам той кассы, чьи деньги считали. -->
    <AllocateUnallocatedDialog
      v-model="showAllocate"
      :amount="unallocatedAmount"
      :cash-box-id="cashBoxFilter || null"
      @done="load"
    />
    <AccountLimitsDialog
      :model-value="!!limitsTarget"
      :account="limitsTarget"
      @update:model-value="(v: boolean) => { if (!v) limitsTarget = null }"
      @saved="load"
    />
    <AccountTransferDialog v-model="showTransfer" :from-account-id="operationAccountId" @done="load" />
    <OperationDialog
      v-model="showOperation"
      :kind="operationKind"
      :account-id="operationAccountId"
      @done="load"
    />

    <!-- Отключение счёта -->
    <v-dialog :model-value="!!offTarget" max-width="440" @update:model-value="offTarget = null">
      <v-card rounded="lg" class="ac-off-card">
        <div class="ac-off-title">Отключить счёт «{{ offTarget?.name }}»</div>
        <div class="ac-off-sub">
          Счёт останется в списке, но принимать на него деньги будет нельзя.
          Причину увидят сотрудники — чтобы не спрашивать, почему нельзя.
        </div>

        <div class="ac-off-reasons">
          <button
            v-for="r in OFF_REASONS"
            :key="r"
            type="button"
            class="ac-off-reason"
            :class="{ 'ac-off-reason--on': offReason === r }"
            @click="offReason = r"
          >{{ r }}</button>
        </div>

        <input v-model="offReason" class="ac-off-input" placeholder="Своя причина" />

        <div class="ac-off-actions">
          <button class="ac-off-cancel" @click="offTarget = null">Отмена</button>
          <button class="ac-off-confirm" :disabled="offBusy" @click="confirmDisable">
            {{ offBusy ? 'Отключаю…' : 'Отключить' }}
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Раздел во всю ширину: таблица счетов с реквизитами и метками в колонку
   1200 px не помещается, а обрезать реквизиты ради «красивой колонки» нельзя —
   именно их и списывают глазами при переводе. */
.ac-page { padding: 24px 28px 40px; }
.ac-loading { display: flex; justify-content: center; align-items: center; min-height: 300px; }

.ac-alert {
  display: flex; gap: 12px; align-items: flex-start;
  padding: 14px 16px; margin-bottom: 20px; border-radius: 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #b91c1c;
}
.ac-alert-body { flex: 1; }
.ac-alert-title { font-size: 14px; font-weight: 700; }
.ac-alert-btn {
  align-self: center; white-space: nowrap;
  padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: rgba(239, 68, 68, 0.14); color: inherit; cursor: pointer;
}
.ac-alert-btn:hover:not(:disabled) { background: rgba(239, 68, 68, 0.22); }
.ac-alert-btn:disabled { opacity: 0.6; cursor: default; }

.ac-off-card { padding: 22px 24px 18px; }
.ac-off-title { font-size: 16px; font-weight: 700; }
.ac-off-sub {
  font-size: 13px; line-height: 1.5; margin-top: 6px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ac-off-reasons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
.ac-off-reason {
  padding: 6px 11px; border-radius: 8px; font-size: 12.5px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.7); cursor: pointer;
}
.ac-off-reason--on {
  border-color: #b45309; color: #b45309; font-weight: 600;
  background: rgba(245, 158, 11, 0.1);
}
.ac-off-input {
  width: 100%; margin-top: 10px; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none; color: rgba(var(--v-theme-on-surface), 0.85);
}
.ac-off-input:focus { border-color: #b45309; }
.ac-off-actions { display: flex; gap: 10px; margin-top: 18px; }
.ac-off-cancel, .ac-off-confirm {
  flex: 1; padding: 11px 16px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.ac-off-cancel {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500;
}
.ac-off-confirm { background: #b45309; color: #fff; }
.ac-off-confirm:disabled { opacity: 0.6; cursor: default; }
.ac-alert-text { font-size: 13px; margin-top: 2px; opacity: 0.9; }

/* Шапка раздела — тот же приём, что в сводке на главной: одно крупное число
   на фирменном фоне, вокруг — из чего оно сложилось. */
.ac-hero {
  position: relative;
  padding: 24px 28px 22px; border-radius: 16px; margin-bottom: 26px;
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  color: #fff;
}
.dark .ac-hero {
  background: linear-gradient(135deg, #047857 0%, #064e3b 50%, #022c22 100%);
}
.ac-hero-actions {
  position: absolute; top: 18px; right: 18px;
  display: flex; gap: 8px;
}

/* Выбор кассы в шапке: кнопка под зелёный фон, список — обычный светлый,
   чтобы длинные названия и суммы читались. */
.ac-hero-picker { margin-bottom: 16px; max-width: 320px; }
.ac-hero-select {
  display: inline-flex; align-items: center; gap: 9px;
  min-width: 220px; max-width: 100%;
  padding: 9px 13px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff; font-size: 13.5px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ac-hero-select:hover { background: rgba(255, 255, 255, 0.22); }
.ac-hero-select--open { background: rgba(255, 255, 255, 0.24); border-color: rgba(255, 255, 255, 0.4); }
.ac-hero-select-dot {
  width: 8px; height: 8px; border-radius: 50%; flex: none;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35);
}
.ac-hero-select-label {
  flex: 1; min-width: 0; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ac-hero-select-caret { opacity: 0.75; transition: transform 0.15s; }
.ac-hero-select-caret--rot { transform: rotate(180deg); }

.ac-boxmenu {
  position: fixed; z-index: 2500;
  max-width: 380px; max-height: 320px; overflow-y: auto;
  padding: 6px; border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.16);
}
.ac-boxmenu-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  margin-bottom: 2px; padding: 9px 10px; border-radius: 9px;
  text-align: left; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.ac-boxmenu-item:last-child { margin-bottom: 0; }
.ac-boxmenu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.ac-boxmenu-item--on { background: rgba(4, 120, 87, 0.08); }
.ac-boxmenu-ico { color: rgba(var(--v-theme-on-surface), 0.4); flex: none; }
.ac-boxmenu-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; margin: 0 3px; }
.ac-boxmenu-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ac-boxmenu-title {
  font-size: 13.5px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ac-boxmenu-hint { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 1px; }
.ac-boxmenu-sum {
  font-size: 13px; font-weight: 700; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.ac-boxmenu-divider { height: 1px; margin: 5px 4px; background: rgba(var(--v-theme-on-surface), 0.08); }

@media (max-width: 760px) {
  .ac-hero-picker { margin-top: 34px; }
}

.ac-hero-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 9px 15px; border-radius: 11px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.ac-hero-btn:hover { background: rgba(255, 255, 255, 0.24); border-color: rgba(255, 255, 255, 0.22); }
.ac-hero-btn-caret { opacity: 0.7; margin-left: -2px; }

/* Меню операций: виды разложены по смыслу, у каждого — пояснение, потому что
   «снять на себя» и «расход по бизнесу» по названию похожи, а по последствиям
   для прибыли — нет. */
.ac-opmenu { padding: 6px; min-width: 300px; max-width: 340px; }
.ac-hero-label {
  font-size: 12.5px; font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.62);
}
.ac-hero-amount { font-size: 34px; font-weight: 800; letter-spacing: -0.6px; margin-top: 4px; }
.ac-hero-sub { font-size: 13px; color: rgba(255, 255, 255, 0.55); margin-top: 2px; }
.ac-hero-sub--hidden { margin-top: 10px; }
.ac-hero-metrics { display: flex; align-items: center; gap: 22px; margin-top: 20px; flex-wrap: wrap; }
.ac-hero-divider { width: 1px; height: 30px; background: rgba(255, 255, 255, 0.16); }
.ac-hero-metric-value { font-size: 16px; font-weight: 700; }
.ac-hero-metric-label {
  display: flex; align-items: center; gap: 5px; margin-top: 2px;
  font-size: 11.5px; color: rgba(255, 255, 255, 0.55);
}
/* Полоса долей — не декор, а способ увидеть перекос между наличными и
   картами, поэтому она заметной высоты. */
.ac-hero-bar {
  display: flex; gap: 2px; height: 12px; margin-top: 18px;
  border-radius: 4px; overflow: hidden;
  background: rgba(255, 255, 255, 0.14);
}
.ac-hero-bar-part { height: 100%; }
.ac-hero-bar-legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 9px; }
.ac-hero-legend-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: rgba(255, 255, 255, 0.6);
}
.ac-hero-legend-dot { width: 8px; height: 8px; border-radius: 2px; }

/* Фильтр по виду денег — тот же вид, что у переключателя «карточки/таблица». */
.ac-type-filter {
  display: flex; gap: 2px; padding: 3px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.ac-type-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 8px; border: none; background: transparent;
  font-size: 12.5px; font-weight: 500; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.55);
  transition: background 0.15s, color 0.15s;
}
.ac-type-btn:hover { color: rgba(var(--v-theme-on-surface), 0.85); }
.ac-type-btn--on {
  background: rgb(var(--v-theme-surface));
  color: #047857; font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.ac-type-count {
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.ac-type-btn--on .ac-type-count { color: rgba(4, 120, 87, 0.7); }


/* Переключатель вида */
.ac-view-switch {
  display: flex; gap: 2px; padding: 3px; border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.ac-view-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 28px; border-radius: 7px;
  color: rgba(var(--v-theme-on-surface), 0.45); cursor: pointer;
}
.ac-view-btn:hover { color: rgba(var(--v-theme-on-surface), 0.7); }
.ac-view-btn--on {
  background: rgb(var(--v-theme-surface));
  color: #047857;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* Панель счетов: заголовок, фильтры и список — одна карточка, как таблица
   графика на странице сделки. Тремя отдельными блоками на сером фоне это
   читалось как три разные вещи, а не как один список с управлением. */
.ac-panel {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
  margin-bottom: 26px;
}
.ac-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap;
  padding: 15px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.ac-panel-head-left { display: flex; align-items: center; gap: 8px; }
.ac-panel-title { font-size: 17px; font-weight: 700; }
.ac-panel-count {
  font-size: 11.5px; font-weight: 700; padding: 1px 7px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ac-panel-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* Полоса-подзаголовок группы. Один вид и в таблице, и в карточках: это одна
   и та же граница между наличными, банками и пунктами приёма. */
.ac-grouprow {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 11px 18px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ac-grouprow-left { display: flex; align-items: center; gap: 7px; min-width: 0; }
.ac-grouprow-title {
  font-size: 13px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.ac-grouprow-count {
  font-size: 11px; font-weight: 700; padding: 0 6px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ac-grouprow-hint { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.38); }
.ac-grouprow-sum {
  font-size: 13.5px; font-weight: 700; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
@media (max-width: 600px) {
  .ac-grouprow-hint { display: none; }
}
.ac-info-btn {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: help; transition: all 0.15s;
}
.ac-info-btn:hover {
  border-color: rgba(4, 120, 87, 0.5);
  color: #047857;
}
.ac-cards-body { padding-bottom: 2px; }
.ac-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(288px, 1fr));
  gap: 12px; padding: 14px 18px 16px;
}

/* Карточка счёта.
   Порядок сверху вниз повторяет порядок вопросов к счёту: что это за счёт →
   сколько на нём → какая это доля всех денег → не упирается ли в лимит →
   куда переводить. Цвет банка живёт в логотипе и коде, отдельной цветной
   рейки у края больше нет: она красила карточку, ничего не сообщая. */
.ac-c {
  display: flex; flex-direction: column;
  padding: 14px 16px 13px; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  /* Чуть тонированный фон: карточка на панели того же цвета держалась только
     на рамке и в тёмной теме почти сливалась с ней. */
  background: rgba(var(--v-theme-on-surface), 0.022);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.ac-c:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: rgba(var(--v-theme-on-surface), 0.18);
  box-shadow: 0 8px 20px -14px rgba(0, 0, 0, 0.5);
  transform: translateY(-1px);
}
.ac-c--muted { opacity: 0.55; }

.ac-c-top { display: flex; align-items: flex-start; gap: 10px; }
/* Между содержимым и нижними бейджами всегда есть воздух, даже когда
   карточка короткая и прижимать нечего. */
.ac-c > * + .ac-c-foot { margin-top: max(auto, 12px); }
.ac-c-id { flex: 1; min-width: 0; padding-top: 1px; }
.ac-c-name {
  font-size: 14.5px; font-weight: 600; line-height: 1.25;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ac-c-meta {
  display: flex; align-items: center; gap: 6px; margin-top: 3px; min-width: 0;
}
.ac-c-where {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Квадрат с иконкой вида денег там, где у банка стоит логотип: карточки
   сейфа и пункта приёма выравниваются с банковскими. */
.ac-c-ico {
  width: 40px; height: 40px; border-radius: 11px; flex: none;
  display: flex; align-items: center; justify-content: center;
}

.ac-c-money { margin-top: 14px; }
.ac-c-sum {
  font-size: 23px; font-weight: 700; letter-spacing: -0.4px; line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
/* Доля — полоса во всю ширину карточки: у всех карточек она одной длины,
   поэтому «где лежит основная масса денег» видно, не читая цифр. */
.ac-c-share { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.ac-c-share-bar {
  flex: 1; height: 3px; border-radius: 2px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.ac-c-share-fill { height: 100%; border-radius: 2px; background: var(--ac-accent); opacity: 0.8; }
.ac-c-share-text {
  font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.42);
}

.ac-c-limit { margin-top: 10px; }
.ac-c-row {
  display: flex; align-items: center; gap: 6px; margin-top: 10px;
  min-width: 0;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Бейджи внизу, отделённые линией: метки и статус — про счёт в целом,
   а не продолжение реквизитов. */
.ac-c-foot {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: auto; padding-top: 11px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.ac-code {
  min-width: 38px; height: 38px; padding: 0 8px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800; letter-spacing: 0.3px;
}
.ac-code-inline {
  padding: 1px 6px; border-radius: 6px;
  font-size: 11px; font-weight: 800; letter-spacing: 0.3px;
}
.ac-td-account { display: flex; align-items: center; gap: 9px; min-width: 0; }
.ac-td-account-body { min-width: 0; }
.ac-default {
  padding: 1px 6px; border-radius: 5px; font-size: 10.5px; font-weight: 600;
  background: rgba(4, 120, 87, 0.12); color: #047857;
}
.ac-menu-btn {
  width: 28px; height: 28px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.4); cursor: pointer;
}
.ac-menu-btn:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.ac-menu { padding: 6px; min-width: 190px; }
.ac-menu-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 8px 10px; border-radius: 8px; font-size: 13.5px;
  color: rgba(var(--v-theme-on-surface), 0.8); cursor: pointer; text-align: left;
}
.ac-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.ac-menu-item--danger { color: #dc2626; }
.ac-menu-divider { height: 1px; margin: 5px 0; background: rgba(var(--v-theme-on-surface), 0.08); }

.ac-tag {
  padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;
  border: 1px solid currentColor;
}
.ac-status { padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
.ac-status--off { background: rgba(245, 158, 11, 0.14); color: #b45309; }

/* Готовность счёта принимать деньги — отдельной колонкой. Исчерпанный лимит
   красный: приглушённой строки для этого мало, её принимали за оформление. */
.ac-td-ready { min-width: 0; }
.ac-ready {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  padding: 3px 9px; border-radius: 7px;
  font-size: 11.5px; font-weight: 600; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.ac-ready-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.ac-ready--ok { background: rgba(16, 185, 129, 0.12); color: #047857; }
/* Недоступен — красным и с рамкой: это предупреждение, а не оттенок. */
.ac-ready--off {
  background: rgba(239, 68, 68, 0.12); color: #dc2626;
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.3);
}

/* ── Табличный вид ── */
/* Таблица живёт внутри панели, поэтому своей рамки у неё нет. Прокрутка по
   горизонтали обязана быть: колонок семь, и на ноутбуке они не помещаются —
   раньше правый край просто обрезался. */
.ac-table-scroll { overflow-x: auto; }
.ac-table { min-width: 1120px; }
.ac-tr {
  display: grid;
  grid-template-columns: 62px minmax(200px, 1.6fr) minmax(120px, 1fr) minmax(170px, 1.3fr) minmax(100px, 0.8fr) 128px 150px 48px;
  align-items: center; gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.ac-tr:first-child { border-top: none; }
.ac-tr--head {
  padding: 11px 18px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.ac-tr--muted { opacity: 0.55; }
.ac-tr--link { cursor: pointer; }
.ac-tr--link:hover { background: rgba(var(--v-theme-on-surface), 0.03); }

/* Подзаголовок группы в таблице — та же полоса, что и в карточках
   (`.ac-grouprow`). Отступ с линией между группами убран: он разрывал таблицу
   на куски и оставлял под последней строкой пустое место непонятного смысла. */
.ac-table .ac-grouprow { min-width: 1000px; }

.ac-code--sm { min-width: 34px; height: 28px; font-size: 12px; border-radius: 8px; }
.ac-td-name {
  font-size: 13.5px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ac-td-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
.ac-td-box { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-width: 0; }
.ac-boxtag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 1px 7px; border-radius: 6px; max-width: 100%;
  font-size: 11px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.65);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ac-boxtag--all { color: rgba(var(--v-theme-on-surface), 0.4); }
.ac-boxtag-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }

.ac-td-dim {
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ac-td-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.ac-td-amount { font-size: 14.5px; font-weight: 700; }
.ac-td--right { text-align: right; justify-self: end; }

/* Обычная карточка, а не пунктирная «заглушка»: это не черновик, а задача,
   которую партнёр закрывает кнопкой рядом. */
/* ── Доступные деньги ──────────────────────────────────────────────
   Главный ответ раздела: одна сумма крупно, под ней — цепочка, из которой
   она получилась. Цепочка свёрнута: каждый день нужен итог, разбор открывают,
   когда цифра удивила. */
.av-card {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 16px;
  padding: 20px 22px;
  margin-bottom: 18px;
  background: rgba(var(--v-theme-surface), 1);
}
.av-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.av-head-main { min-width: 0; }
.av-label {
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.av-amount {
  font-size: 30px; font-weight: 800; line-height: 1.15; margin-top: 4px;
  color: #047857;
}
.av-amount--neg { color: #ef4444; }
.av-sub { font-size: 13px; margin-top: 4px; color: rgba(var(--v-theme-on-surface), 0.55); }
.av-warn {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 12.5px; line-height: 1.45; margin-top: 8px;
  padding: 8px 10px; border-radius: 10px;
  color: #b45309; background: rgba(245, 158, 11, 0.12);
}
.av-toggle {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 13px; font-weight: 600;
  padding: 7px 12px; border-radius: 10px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.05);
  transition: background 0.15s;
}
.av-toggle:hover { background: rgba(var(--v-theme-on-surface), 0.09); }
.av-chain { margin-top: 18px; }
.av-chain-title {
  font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 8px;
}
.av-chain-title--gap { margin-top: 18px; }
.av-step { display: flex; align-items: flex-start; gap: 12px; padding: 8px 0; }
.av-step-sign {
  flex: 0 0 22px; height: 22px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 800; line-height: 1;
}
.av-step-sign--plus { color: #047857; background: rgba(4, 120, 87, 0.1); }
.av-step-sign--minus { color: #ef4444; background: rgba(239, 68, 68, 0.1); }
.av-step-body { flex: 1; min-width: 0; }
.av-step-title { font-size: 14px; font-weight: 600; }
.av-step-note {
  font-size: 12.5px; line-height: 1.45; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.av-step-sum { flex: 0 0 auto; font-size: 14px; font-weight: 700; white-space: nowrap; }
.av-total {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-top: 8px; padding: 12px 14px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.av-total-title { font-size: 14px; font-weight: 700; }
.av-total-sum { font-size: 17px; font-weight: 800; white-space: nowrap; }
.av-total--final { background: rgba(4, 120, 87, 0.09); }
.av-total--final .av-total-sum { color: #047857; }
.av-notes {
  margin-top: 18px; padding-top: 14px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
}
.av-notes-title {
  font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 8px;
}
.av-note {
  font-size: 12.5px; line-height: 1.5; margin-top: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.av-note b { color: rgba(var(--v-theme-on-surface), 0.85); }
@media (max-width: 700px) {
  .av-card { padding: 16px; border-radius: 14px; }
  .av-head { flex-direction: column; gap: 12px; }
  .av-amount { font-size: 26px; }
  .av-step-sum { font-size: 13px; }
}

.ac-unalloc {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 18px; border-radius: 14px; margin-bottom: 26px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface));
}
.ac-unalloc-right { display: flex; align-items: center; gap: 12px; }
.ac-unalloc-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 14px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background 0.15s;
}
.ac-unalloc-btn:hover { background: #065f46; }
.ac-unalloc-icon { color: rgba(var(--v-theme-on-surface), 0.35); }
.ac-unalloc-body { flex: 1; min-width: 0; }
.ac-unalloc-title { font-size: 14px; font-weight: 600; }
.ac-unalloc-text {
  font-size: 12.5px; line-height: 1.5; margin-top: 3px; max-width: 620px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ac-unalloc-sum { font-size: 18px; font-weight: 700; white-space: nowrap; }

/* ── Пора забрать деньги ── */
.ac-pickups {
  padding: 14px 18px; border-radius: 14px; margin-bottom: 22px;
  border: 1px solid rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.06);
}
.ac-pickups-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
  font-size: 14px; font-weight: 700; color: #b45309;
}
.ac-pickup {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 0; border-top: 1px solid rgba(245, 158, 11, 0.18);
}
.ac-pickup:first-of-type { border-top: none; }
.ac-pickup-body { flex: 1; min-width: 0; }
.ac-pickup-name { font-size: 13.5px; font-weight: 600; }
.ac-pickup-why { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }
.ac-pickup-sum { font-size: 15px; font-weight: 700; white-space: nowrap; }
.ac-pickup-btn {
  padding: 7px 13px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  background: #b45309; color: #fff; cursor: pointer; white-space: nowrap;
}
.ac-pickup-btn:hover { background: #92400e; }

/* ── Заполнение лимита ── */
.ac-limit { margin-top: 5px; }
.ac-limit-bar {
  height: 3px; border-radius: 2px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.1);
}
.ac-limit-fill { height: 100%; background: rgba(var(--v-theme-on-surface), 0.35); }
.ac-limit-text {
  display: block; font-size: 10.5px; margin-top: 3px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.ac-limit--warn .ac-limit-fill { background: #f59e0b; }
.ac-limit--warn .ac-limit-text { color: #b45309; }
.ac-limit--full .ac-limit-fill { background: #dc2626; }
.ac-limit--full .ac-limit-text { color: #b91c1c; }

.ac-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 56px 24px; border-radius: 16px; text-align: center;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ac-empty-title { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.ac-empty-text { font-size: 13.5px; max-width: 380px; line-height: 1.5; }
.ac-btn-primary {
  margin-top: 10px; padding: 11px 22px; border-radius: 10px; border: none;
  background: #047857; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
}
.ac-btn-primary:hover { background: #065f46; }

/* На графите фиксированные «бумажные» цвета темнеют до нечитаемости —
   для тёмной темы берём те же оттенки, но светлее. */
.ac-page.dark .ac-default { background: rgba(52, 211, 153, 0.14); color: #34d399; }
.ac-page.dark .ac-status--off { background: rgba(251, 191, 36, 0.14); color: #fbbf24; }
.ac-page.dark .ac-alert { color: #fca5a5; }
.ac-page.dark .ac-menu-item--danger { color: #f87171; }
</style>
