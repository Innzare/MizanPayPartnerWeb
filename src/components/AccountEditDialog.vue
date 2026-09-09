<script setup lang="ts">
/**
 * Заведение и правка счёта.
 *
 * Счёт — место, где физически лежат деньги: сейф, карта банка, магазин-партнёр,
 * принимающий наличные от клиентов. У каждого типа свои поля, поэтому форма
 * меняется вслед за выбором типа: у карты — банк и реквизиты перевода, у
 * пункта приёма — контакты магазина и напоминания о заборе денег.
 */
import { computed, ref, watch } from 'vue'
import { useAnchoredMenu } from '@/composables/useAnchoredMenu'
import BankLogo from '@/components/BankLogo.vue'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useAccountingStore, type AccountType, type AccountView } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { useSections } from '@/composables/useSections'
import { CURRENCY_MASK, parseMasked, formatCurrency } from '@/utils/formatters'
import AccountLimitsDialog from '@/components/AccountLimitsDialog.vue'
import AddressPicker from '@/components/AddressPicker.vue'
import PhoneField from '@/components/PhoneField.vue'
import SelectField from '@/components/SelectField.vue'

const props = defineProps<{
  modelValue: boolean
  /** Пусто — заводим новый счёт. */
  account?: AccountView | null
  /**
   * Касса, под которую заводят счёт. Приходит из выбранной кассы на «Балансе»:
   * человек уже сказал, чьи деньги смотрит, и переспрашивать об этом в форме
   * значит заставлять его повторяться (а по невнимательности — заводить счёт
   * не в ту кассу).
   */
  defaultCashBoxId?: string | null
  fullscreen?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

const store = useAccountingStore()
const cashboxes = useCashBoxesStore()
const sections = useSections()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const isEdit = computed(() => !!props.account)

const TYPES: Array<{ value: AccountType; label: string; hint: string; icon: string }> = [
  { value: 'CASH', label: 'Наличные', hint: 'Сейф, деньги у кассира', icon: 'mdi-cash' },
  { value: 'BANK_CARD', label: 'Банк', hint: 'Карта или счёт в банке', icon: 'mdi-credit-card-outline' },
  {
    value: 'PAYMENT_POINT',
    label: 'Пункт приёма',
    hint: 'Магазин-партнёр, куда клиенты приносят наличные',
    icon: 'mdi-store-outline',
  },
]

const form = ref({
  name: '',
  type: 'CASH' as AccountType,
  bankId: '',
  code: '',
  openingBalance: 0 as number,
  transferPhone: '',
  holderName: '',
  isDefaultForCash: false,
  isDefaultForBank: false,
  limits: {
    perOpMax: null as number | null,
    w1Days: 5,
    w1SumMax: null as number | null,
    w1CountMax: null as number | null,
    w2Days: 30,
    w2SumMax: null as number | null,
    w2CountMax: null as number | null,
    warnPct: 80,
  },
  pickup: {
    contactName: '',
    contactPhone: '',
    address: '',
    threshold: null as number | null,
    maxDays: null as number | null,
  },
  tagIds: [] as string[],
  /** Касса, чьи деньги лежат на этом счёте. Пусто — счёт общий для всех касс. */
  cashBoxId: '',
})

const saving = ref(false)
const showLimits = ref(false)

/**
 * Свой список типов вместо системного select: с иконками и пояснениями, как
 * выпадающие списки в остальных формах. Нативный select ни того, ни другого
 * показать не умеет.
 */
/**
 * Пункты приёма скрыты — значит и заводить такой счёт нельзя: деньги потекли бы
 * в раздел, которого у партнёра нет на экране.
 */
const availableTypes = computed(() =>
  TYPES.filter((t) => t.value !== 'PAYMENT_POINT' || sections.visible('paymentPoints')),
)

// Списки рисуются поверх окна (см. useAnchoredMenu): внутри формы со скроллом
// они уезжали под её нижний край.
const {
  open: typeOpen,
  anchor: typeRoot,
  menu: typeMenu,
  pos: typePos,
  flipped: typeUp,
  toggle: toggleType,
  close: closeType,
} = useAnchoredMenu()
const currentType = computed(() => TYPES.find((t) => t.value === form.value.type) ?? TYPES[0]!)

function pickType(v: AccountType) {
  form.value.type = v
  closeType()
}

/**
 * Выбор банка — своим списком, а не системным `select`: банк узнают по
 * логотипу, а в системном выпадающем списке картинку не показать.
 */
const {
  open: bankOpen,
  anchor: bankRoot,
  menu: bankMenu,
  pos: bankPos,
  flipped: bankUp,
  toggle: toggleBank,
  close: closeBank,
} = useAnchoredMenu()
const currentBank = computed(() => store.banks.find((b) => b.id === form.value.bankId) ?? null)

function pickBank(id: string) {
  form.value.bankId = id
  closeBank()
}

/** Подсказка под выбором типа — то, что раньше было написано на плитке. */
const typeHint = computed(() => TYPES.find((t) => t.value === form.value.type)?.hint ?? '')

/** Строка под кнопкой лимитов: включено что-то или нет — видно, не открывая. */
const limitsSummary = computed(() => {
  const l = form.value.limits
  const parts: string[] = []
  if (l.perOpMax != null) parts.push(`операция до ${formatCurrency(l.perOpMax)}`)
  if (l.w1SumMax != null || l.w1CountMax != null) parts.push(`за ${l.w1Days} дн.`)
  if (l.w2SumMax != null || l.w2CountMax != null) parts.push(`за ${l.w2Days} дн.`)
  return parts.length ? parts.join(' · ') : 'Не заданы — переводы ничем не ограничены'
})

// immediate: окно могут смонтировать уже открытым — тогда без этого форма
// осталась бы пустой, с типом «Наличные» вместо настроек редактируемого счёта.
watch(
  () => props.modelValue,
  async (isOpen) => {
    if (!isOpen) return
    await Promise.all([store.fetchBanks(), store.fetchTags()])

    const a = props.account
    form.value = {
      name: a?.name ?? '',
      type: a?.type ?? 'CASH',
      bankId: a?.bank?.id ?? '',
      code: a?.code ?? '',
      openingBalance: 0,
      transferPhone: a?.transferPhone ?? '',
      holderName: a?.holderName ?? '',
      isDefaultForCash: a?.isDefaultForCash ?? false,
      isDefaultForBank: a?.isDefaultForBank ?? false,
      limits: a
        ? { ...a.limits }
        : { perOpMax: null, w1Days: 5, w1SumMax: null, w1CountMax: null, w2Days: 30, w2SumMax: null, w2CountMax: null, warnPct: 80 },
      pickup: {
        contactName: a?.pickup?.contactName ?? '',
        contactPhone: a?.pickup?.contactPhone ?? '',
        address: a?.pickup?.address ?? '',
        threshold: a?.pickup?.threshold ?? null,
        maxDays: a?.pickup?.maxDays ?? null,
      },
      tagIds: (a?.tags ?? []).map((t) => t.id),
      cashBoxId: a?.cashBoxId ?? defaultCashBoxId(),
    }
    showLimits.value = !!a && Object.values(a.limits).some((v) => v != null && v !== 5 && v !== 30 && v !== 80)
    if (!cashboxes.items.length) void cashboxes.fetchAll().catch(() => {})
    if (!a) void refreshCode()
  },
  { immediate: true },
)

/**
 * Кассы для выбора: «чьи деньги лежат на этом счёте».
 *
 * Счёт всегда принадлежит одной кассе — «общего для всех» варианта нет.
 * Касса отвечает на вопрос «чьи деньги», и счёт без ответа на него означал бы
 * деньги неизвестно чьи: фильтр по кассе показывал такой счёт всегда, а сумма
 * кассы с ним не сходилась.
 */
const cashBoxOptions = computed(() =>
  cashboxes.items
    .filter((b) => !b.archivedAt)
    .map((b) => ({ value: b.id, label: b.name, hint: b.isDefault ? 'основная' : undefined, color: b.color })),
)
const showCashBoxPicker = computed(() => cashboxes.items.some((b) => !b.archivedAt))

/**
 * Какую кассу подставить новому счёту: ту, что выбрана на «Балансе», иначе
 * основную — она есть у каждого партнёра.
 */
function defaultCashBoxId(): string {
  const live = cashboxes.items.filter((b) => !b.archivedAt)
  const fromPage = props.defaultCashBoxId
    ? live.find((b) => b.id === props.defaultCashBoxId)?.id
    : undefined
  return fromPage ?? (live.find((b) => b.isDefault) ?? live[0])?.id ?? ''
}

// Кассы приходят запросом: форму могли открыть раньше, чем список загрузился.
// Тогда поле осталось бы пустым, а счёт без кассы завести нельзя.
watch(
  () => cashboxes.items.length,
  () => {
    if (!form.value.cashBoxId) form.value.cashBoxId = defaultCashBoxId()
  },
)

/**
 * Сколько денег кассы ещё не разложено по счетам.
 *
 * Касса отвечает «сколько денег», счета — «где они лежат»: положить на счёт
 * больше, чем есть в кассе, значит сделать оба ответа неправдой. Показываем
 * предел сразу, чтобы человек не упирался в отказ после заполнения формы.
 */
const cashBoxFree = ref<number | null>(null)
const loadingFree = ref(false)

async function refreshFree() {
  const boxId = form.value.cashBoxId
  if (isEdit.value || !boxId) {
    cashBoxFree.value = null
    return
  }
  loadingFree.value = true
  try {
    cashBoxFree.value = (await store.fetchCashBoxFree(boxId)).unallocated
  } catch {
    // Не смогли спросить — не мешаем работать: предел проверит сервер.
    cashBoxFree.value = null
  } finally {
    loadingFree.value = false
  }
}

watch(() => [open.value, form.value.cashBoxId], () => { if (open.value) void refreshFree() })

/**
 * Касса в минусе: её счета уже держат больше, чем есть в ней самой.
 *
 * Внести разницу тут нечестно — касса и счета вырастут на одну сумму, разрыв
 * останется прежним, а счетов в нём станет больше. Пока минус не закрыт, счёт
 * с деньгами не заводим: сервис откажет так же.
 */
const cashBoxShortage = computed(() => {
  const free = cashBoxFree.value
  return free !== null && free < 0 ? -free : 0
})

/** Сколько не хватает в кассе под указанный остаток. */
const missing = computed(() => {
  const free = cashBoxFree.value
  const want = form.value.openingBalance ?? 0
  if (free === null || want <= 0 || free < 0) return 0
  return Math.max(0, want - free)
})

/** Остаток при кассе в минусе — то, чего завести нельзя. */
const blockedByShortage = computed(
  () => !isEdit.value && cashBoxShortage.value > 0 && (form.value.openingBalance ?? 0) > 0,
)

/** Разницу партнёр вносит своими деньгами — иначе счёт не завести. */
const topUpDifference = ref(false)
watch(missing, (m) => { if (!m) topUpDifference.value = false })

/** Ноль в поле суммы выделяем: первая же цифра встаёт вместо него. */
function selectIfZero(e: FocusEvent) {
  const el = e.target as HTMLInputElement
  if (!Number(el.value.replace(/\D/g, ''))) el.select()
}

/** Код подсказываем по банку и типу, но партнёр может вписать свой. */
async function refreshCode() {
  if (isEdit.value) return
  try {
    form.value.code = await store.suggestCode(form.value.bankId || null, form.value.type)
  } catch { /* подсказка не критична */ }
}

watch(() => [form.value.type, form.value.bankId], () => { void refreshCode() })

const canSave = computed(
  () =>
    form.value.name.trim().length > 0 &&
    form.value.code.trim().length > 0 &&
    // Разница сверх кассы допустима только осознанно: партнёр подтверждает,
    // что вносит свои деньги, и капитал кассы вырастет вместе со счётом.
    (missing.value === 0 || topUpDifference.value) &&
    !blockedByShortage.value,
)

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      name: form.value.name.trim(),
      type: form.value.type,
      // null очищает банк, undefined читался бы как «не менять» — а «Не указан»
      // в форме означает именно «убрать».
      bankId: form.value.type === 'BANK_CARD' ? form.value.bankId || null : null,
      code: form.value.code.trim(),
      transferPhone: form.value.transferPhone.trim() || undefined,
      holderName: form.value.holderName.trim() || undefined,
      isDefaultForCash: form.value.type === 'CASH' ? form.value.isDefaultForCash : false,
      isDefaultForBank: form.value.type === 'CASH' ? false : form.value.isDefaultForBank,
      limits: form.value.limits,
      tagIds: form.value.tagIds,
      // Касса обязательна: счёт принадлежит ровно одной.
      cashBoxId: form.value.cashBoxId || defaultCashBoxId(),
      ...(form.value.type === 'PAYMENT_POINT' ? { pickup: form.value.pickup } : {}),
    }
    if (!isEdit.value) {
      payload.openingBalance = form.value.openingBalance ?? 0
      if (missing.value > 0) payload.topUpDifference = true
    }

    if (isEdit.value) await store.updateAccount(props.account!.id, payload)
    else await store.createAccount(payload)

    toast.success(isEdit.value ? 'Счёт сохранён' : 'Счёт заведён')
    open.value = false
    emit('saved')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить счёт')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" :max-width="fullscreen ? undefined : 520" :fullscreen="fullscreen" scrollable>
    <v-card :rounded="fullscreen ? 0 : 'lg'" class="ae-card">
      <button class="dialog-close-sm" @click="open = false">
        <v-icon icon="mdi-close" size="18" />
      </button>

      <div class="ae-head">
        <div class="ae-title">{{ isEdit ? 'Настройки счёта' : 'Новый счёт' }}</div>
        <div class="ae-sub">Счёт — место, где физически лежат деньги</div>
      </div>

      <div class="ae-body mz-form">
        <!-- Тип: обычный select, как в остальных формах сервиса. Три плитки
             занимали треть окна ради выбора, который делают один раз. -->
        <div class="mb-4">
          <label class="field-label">Что это за счёт</label>
          <div ref="typeRoot" class="ae-select">
            <button
              type="button"
              class="field-input ae-select-btn"
              :class="{ 'ae-select-btn--open': typeOpen }"
              :disabled="isEdit"
              @click="toggleType(isEdit)"
            >
              <v-icon :icon="currentType.icon" size="18" class="ae-select-ico" />
              <span class="ae-select-label">{{ currentType.label }}</span>
              <v-icon
                icon="mdi-chevron-down"
                size="18"
                class="ae-select-caret"
                :class="{ 'ae-select-caret--rot': typeOpen }"
              />
            </button>

            <Teleport to="body">
              <Transition name="menu-pop">
              <div
                v-if="typeOpen"
                ref="typeMenu"
                class="ae-select-menu"
                :class="{ 'menu-pop--up': typeUp }"
                :style="{ top: typePos.top + 'px', left: typePos.left + 'px', width: typePos.width + 'px' }"
              >
                <button
                  v-for="t in availableTypes"
                  :key="t.value"
                  type="button"
                  class="ae-select-item"
                  :class="{ 'ae-select-item--on': form.type === t.value }"
                  @click="pickType(t.value)"
                >
                  <v-icon :icon="t.icon" size="18" class="ae-select-item-ico" />
                  <span class="ae-select-item-body">
                    <span class="ae-select-item-title">{{ t.label }}</span>
                    <span class="ae-select-item-hint">{{ t.hint }}</span>
                  </span>
                  <v-icon v-if="form.type === t.value" icon="mdi-check" size="16" class="ae-select-check" />
                </button>
              </div>
            </Transition>
            </Teleport>
          </div>
          <!-- Тип определяет смысл остатка и набор полей, поэтому у заведённого
               счёта его не меняем: проще завести новый и перевести деньги. -->
          <div class="field-hint">
            <template v-if="isEdit">Тип заведённого счёта не меняется</template>
            <template v-else>{{ typeHint }}</template>
          </div>
        </div>

        <!-- Чья касса — сразу за видом счёта: это второй вопрос о счёте после
             «что это», и от него зависит, где счёт потом появится. -->
        <div v-if="showCashBoxPicker" class="mb-4">
          <label class="field-label">Чьи деньги здесь лежат</label>
          <SelectField v-model="form.cashBoxId" :options="cashBoxOptions" />
          <div class="field-hint">
            Деньги этой кассы будут ложиться на этот счёт, и он появится на её странице
            в списке «где лежат деньги»
          </div>
        </div>

        <div class="mb-4">
          <label class="field-label">Название</label>
          <input v-model="form.name" class="field-input" placeholder="Сейф в офисе, Карта Сбер, Магазин Ахмеда" />
        </div>

        <div v-if="form.type === 'BANK_CARD'" class="mb-4">
          <label class="field-label">Банк</label>
          <div ref="bankRoot" class="ae-select">
            <button
              type="button"
              class="field-input ae-select-btn"
              :class="{ 'ae-select-btn--open': bankOpen }"
              @click="toggleBank()"
            >
              <BankLogo
                v-if="currentBank"
                :bank-name="currentBank.name"
                :color="currentBank.color"
                :fallback="currentBank.shortName"
                :size="22"
              />
              <v-icon v-else icon="mdi-bank-outline" size="18" class="ae-select-ico" />
              <span class="ae-select-label">{{ currentBank?.name || 'Не указан' }}</span>
              <v-icon
                icon="mdi-chevron-down"
                size="18"
                class="ae-select-caret"
                :class="{ 'ae-select-caret--rot': bankOpen }"
              />
            </button>

            <Teleport to="body">
              <Transition name="menu-pop">
              <div
                v-if="bankOpen"
                ref="bankMenu"
                class="ae-select-menu ae-select-menu--scroll"
                :class="{ 'menu-pop--up': bankUp }"
                :style="{ top: bankPos.top + 'px', left: bankPos.left + 'px', width: bankPos.width + 'px' }"
              >
                <button
                  type="button"
                  class="ae-select-item"
                  :class="{ 'ae-select-item--on': !form.bankId }"
                  @click="pickBank('')"
                >
                  <v-icon icon="mdi-bank-off-outline" size="18" class="ae-select-item-ico" />
                  <span class="ae-select-item-body">
                    <span class="ae-select-item-title">Не указан</span>
                  </span>
                </button>
                <button
                  v-for="b in store.banks"
                  :key="b.id"
                  type="button"
                  class="ae-select-item"
                  :class="{ 'ae-select-item--on': form.bankId === b.id }"
                  @click="pickBank(b.id)"
                >
                  <BankLogo :bank-name="b.name" :color="b.color" :fallback="b.shortName" :size="22" />
                  <span class="ae-select-item-body">
                    <span class="ae-select-item-title">{{ b.name }}</span>
                  </span>
                  <v-icon v-if="form.bankId === b.id" icon="mdi-check" size="16" class="ae-select-check" />
                </button>
              </div>
            </Transition>
            </Teleport>
          </div>
        </div>

        <div class="mb-4">
          <label class="field-label">Код счёта</label>
          <input v-model="form.code" class="field-input ae-code" placeholder="С1" maxlength="8" />
          <!-- Короткий код нужен для речи и переписки: «оплатил на Т2» вместо
               «на карту Тинькофф, которая на Магомеде». -->
          <div class="field-hint">Короткое обозначение для таблиц и переписки. Должно быть своим у каждого счёта</div>
        </div>

        <div v-if="!isEdit" class="mb-4">
          <label class="field-label">Сколько сейчас на счёте</label>
          <div class="input-with-suffix">
            <!-- Ноль, а не пустое поле: так сразу видно, что сюда вводят
                 сумму. При вводе он выделяется целиком и заменяется первой же
                 цифрой — дописывать вручную ничего не нужно. -->
            <input
              :value="form.openingBalance ?? 0"
              v-maska="CURRENCY_MASK"
              type="text"
              inputmode="numeric"
              class="field-input"
              @focus="selectIfZero"
              @maska="(e: any) => form.openingBalance = parseMasked(e)"
            />
            <span class="input-suffix">₽</span>
          </div>
          <div class="field-hint">
            <template v-if="cashBoxShortage > 0">
              Счета этой кассы держат на {{ formatCurrency(cashBoxShortage) }} больше, чем есть в самой кассе
            </template>
            <template v-else-if="cashBoxFree !== null">
              Свободно в кассе: {{ formatCurrency(cashBoxFree) }} —
              столько денег ещё не разложено по счетам
            </template>
            <template v-else>Начальный остаток — чтобы история сошлась с первого дня</template>
          </div>

          <!-- Минус в кассе внесением не лечится: обе цифры вырастут на одно и
               то же, разрыв останется. Поэтому здесь не согласие, а отказ. -->
          <div v-if="blockedByShortage" class="ae-blocked">
            <v-icon icon="mdi-alert-circle-outline" size="18" />
            <span>
              <span class="ae-blocked-title">Счёт с деньгами завести нельзя</span>
              <span class="ae-blocked-hint">
                В кассе не хватает {{ formatCurrency(cashBoxShortage) }}: её счета уже держат больше,
                чем есть в самой кассе. Внесение разницы это не исправит — вырастут обе суммы сразу.
                Сначала внесите деньги в кассу (операция «Капитал») или проведите инвентаризацию счетов,
                а пока укажите остаток 0.
              </span>
            </span>
          </div>

          <!-- Больше, чем в кассе, бывает по-честному: деньги есть, а в кассу
               их не заводили. Тогда это не «начальный остаток», а внесение
               своих денег — оно поднимет и кассу, и счёт. -->
          <label v-if="missing > 0" class="ae-topup">
            <input v-model="topUpDifference" type="checkbox" class="ae-topup-box" />
            <span>
              <span class="ae-topup-title">
                Внести {{ formatCurrency(missing) }} своих денег в кассу
              </span>
              <span class="ae-topup-hint">
                В кассе свободно {{ formatCurrency(cashBoxFree ?? 0) }},
                а вы указали {{ formatCurrency(form.openingBalance ?? 0) }}.
                Разница запишется как ваше вложение — капитал кассы вырастет.
              </span>
            </span>
          </label>
        </div>

        <!-- Реквизиты перевода -->
        <div v-if="form.type === 'BANK_CARD'" class="mb-4">
          <label class="field-label">Реквизиты для перевода</label>
          <!-- Телефон и имя — друг под другом: в строку они сжимались так,
               что и номер, и имя обрезались на середине. -->
          <div class="ae-stack">
            <!-- Номер, по которому переводят, — тем же полем с маской, что и
                 везде: иначе один и тот же телефон хранился в трёх видах. -->
            <PhoneField v-model="form.transferPhone" plain placeholder="Телефон получателя" />
            <input v-model="form.holderName" class="field-input" placeholder="Имя получателя" />
          </div>
          <!-- Номер карты не храним: переводят по телефону, а хранение
               номеров — лишний риск без пользы. -->
          <div class="field-hint">Переводят по номеру телефона — номер карты не храним</div>
        </div>

        <!-- Пункт приёма -->
        <template v-if="form.type === 'PAYMENT_POINT'">
          <div class="mb-4">
            <label class="field-label">Контакты пункта</label>
            <div class="fp-row ae-row">
              <input v-model="form.pickup.contactName" class="field-input" placeholder="Чей магазин" />
              <!-- Тот же ввод телефона, что в остальных формах: маска, выбор
                   страны и E.164 наружу — руками номер набирали кто как. -->
              <PhoneField v-model="form.pickup.contactPhone" plain placeholder="Телефон" />
            </div>
            <div class="field-hint">Чтобы позвонить перед выездом</div>
          </div>

          <!-- Адрес пункта выбирают на карте, как у партнёров: инкассатор едет
               по нему, а клиенту его называют по телефону — вписанный от руки
               «маг. у рынка» не годится ни там, ни там. -->
          <div class="mb-4">
            <label class="field-label">Адрес пункта</label>
            <AddressPicker
              :key="account?.id ?? 'new'"
              :address="form.pickup.address"
              @update:address="form.pickup.address = $event"
            />
            <input
              v-model="form.pickup.address"
              class="field-input mt-2"
              placeholder="Или впишите адрес вручную"
            />
          </div>

          <div class="mb-4">
            <label class="field-label">Напоминать о заборе денег</label>
            <div class="fp-row ae-row">
              <div class="input-with-suffix">
                <input
                  :value="form.pickup.threshold || ''"
                  v-maska="CURRENCY_MASK"
                  type="text"
                  inputmode="numeric"
                  class="field-input"
                  placeholder="при сумме"
                  @maska="(e: any) => form.pickup.threshold = parseMasked(e)"
                />
                <span class="input-suffix">₽</span>
              </div>
              <input
                v-model.number="form.pickup.maxDays"
                type="number"
                min="1"
                class="field-input"
                placeholder="или раз в N дней"
              />
            </div>
          </div>
        </template>

        <!-- Счёт по умолчанию -->
        <div class="mb-4">
          <label class="ae-check">
            <input
              v-if="form.type === 'CASH'"
              v-model="form.isDefaultForCash"
              type="checkbox"
            />
            <input v-else v-model="form.isDefaultForBank" type="checkbox" />
            <span>
              Счёт по умолчанию для {{ form.type === 'CASH' ? 'наличных' : 'переводов' }}
            </span>
          </label>
          <!-- Мобильное приложение выбирать счёт пока не умеет: без счёта по
               умолчанию такие оплаты повисали бы в «не разнесено». -->
          <div class="field-hint">Сюда попадут оплаты, у которых счёт не выбран</div>
        </div>

        <!-- Лимиты живут в своём окне: семь полей подряд посреди формы
             мешали тем, кто просто заводит сейф. -->
        <button type="button" class="ae-limits-btn" @click="showLimits = true">
          <span class="ae-limits-btn-left">
            <v-icon icon="mdi-speedometer" size="18" />
            <span>
              <span class="ae-limits-btn-title">Лимиты счёта</span>
              <span class="ae-limits-btn-hint">{{ limitsSummary }}</span>
            </span>
          </span>
          <v-icon icon="mdi-chevron-right" size="18" class="ae-limits-btn-caret" />
        </button>

        <!-- Метки -->
        <div v-if="store.tags.length" class="mt-4">
          <label class="field-label">Метки</label>
          <div class="ae-tags">
            <button
              v-for="t in store.tags"
              :key="t.id"
              type="button"
              class="ae-tag"
              :class="{ 'ae-tag--on': form.tagIds.includes(t.id) }"
              :style="form.tagIds.includes(t.id) ? { borderColor: t.color, color: t.color } : {}"
              @click="form.tagIds.includes(t.id)
                ? form.tagIds.splice(form.tagIds.indexOf(t.id), 1)
                : form.tagIds.push(t.id)"
            >{{ t.name }}</button>
          </div>
        </div>
      </div>

      <div class="ae-actions">
        <button class="btn-secondary flex-grow-1" @click="open = false">Отмена</button>
        <button class="btn-primary flex-grow-1" :disabled="!canSave || saving" @click="save">
          <v-progress-circular v-if="saving" indeterminate size="18" width="2" />
          <span v-else>{{ isEdit ? 'Сохранить' : 'Завести счёт' }}</span>
        </button>
      </div>

      <!-- Лимиты правятся поверх формы: значения возвращаются сюда и уходят
           на сервер вместе с остальными настройками счёта. -->
      <AccountLimitsDialog
        v-model="showLimits"
        :limits="form.limits"
        @update:limits="(v) => (form.limits = v)"
      />
    </v-card>
  </v-dialog>
</template>

<style scoped>
.ae-card { display: flex; flex-direction: column; max-height: 88vh; width: 100%; }
.ae-head {
  padding: 20px 56px 14px 24px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.ae-title { font-size: 17px; font-weight: 700; }
.ae-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 2px; }
.ae-body { padding: 18px 24px 8px; overflow-y: auto; flex: 1; }
.ae-actions {
  display: flex; gap: 12px; padding: 14px 24px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}


.ae-row > * { flex: 1; min-width: 0; }
.ae-stack { display: flex; flex-direction: column; gap: 8px; }
.ae-code { max-width: 120px; }
.ae-check {
  display: flex; align-items: center; gap: 8px;
  font-size: 13.5px; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.ae-check input { width: 16px; height: 16px; accent-color: rgb(var(--v-theme-primary)); cursor: pointer; }

/* Вход в лимиты — строка-кнопка со сводкой: видно, заданы они или нет. */
/* Список типов счёта: кнопка-поле и меню с иконками. */
.ae-select { position: relative; }
.ae-select-btn {
  display: flex; align-items: center; gap: 10px; text-align: left; cursor: pointer;
}
.ae-select-btn:disabled { cursor: default; opacity: 0.7; }
.ae-select-btn--open { border-color: #047857; }
.ae-select-ico { color: rgba(var(--v-theme-on-surface), 0.5); }
.ae-select-label { flex: 1; min-width: 0; }
.ae-select-caret { color: rgba(var(--v-theme-on-surface), 0.4); transition: transform 0.15s; }
.ae-select-caret--rot { transform: rotate(180deg); }

/* Банков семнадцать: список прокручивается, а не выталкивает кнопки формы. */
.ae-select-menu--scroll { max-height: 280px; overflow-y: auto; }

.ae-blocked {
  display: flex; align-items: flex-start; gap: 9px;
  margin-top: 10px; padding: 11px 13px; border-radius: 10px;
  background: rgba(220, 38, 38, 0.07);
  border: 1px solid rgba(220, 38, 38, 0.22);
  color: #b91c1c;
}
.ae-blocked-title { display: block; font-size: 13px; font-weight: 700; }
.ae-blocked-hint {
  display: block; font-size: 12px; line-height: 1.5; margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.ae-topup {
  display: flex; align-items: flex-start; gap: 9px;
  margin-top: 10px; padding: 11px 13px; border-radius: 11px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.28);
  cursor: pointer;
}
.ae-topup-box { margin-top: 2px; width: 16px; height: 16px; flex: none; accent-color: #b45309; }
.ae-topup-title { display: block; font-size: 13px; font-weight: 600; color: #b45309; }
.ae-topup-hint {
  display: block; font-size: 12px; line-height: 1.45; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
/* Меню живёт в конце страницы, поэтому позиционируется от окна и должно быть
   выше модалок Vuetify (у них z-index 2400). */
.ae-select-menu {
  position: fixed; z-index: 2500;
  padding: 6px; border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}
.ae-select-item {
  /* Просвет между пунктами: слипшиеся строки читаются одним блоком. */
  margin-bottom: 2px;
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border: none; border-radius: 8px;
  background: transparent; cursor: pointer; text-align: left;
}
.ae-select-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.ae-select-item--on { background: rgba(4, 120, 87, 0.07); }
.ae-select-item-ico { color: rgba(var(--v-theme-on-surface), 0.5); }
.ae-select-item--on .ae-select-item-ico { color: #047857; }
.ae-select-item-body { flex: 1; min-width: 0; }
.ae-select-item-title { display: block; font-size: 14px; font-weight: 600; }
.ae-select-item-hint {
  display: block; font-size: 12px; margin-top: 1px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ae-select-check { color: #047857; }

.ae-limits-btn {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 12px 14px; margin-top: 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); border-radius: 12px;
  background: transparent; cursor: pointer; text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.ae-limits-btn:hover {
  border-color: rgba(4, 120, 87, 0.35);
  background: rgba(4, 120, 87, 0.03);
}
.ae-limits-btn-left {
  display: flex; align-items: center; gap: 10px; min-width: 0;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.ae-limits-btn-title { display: block; font-size: 14px; font-weight: 600; }
.ae-limits-btn-hint {
  display: block; font-size: 12px; margin-top: 1px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ae-limits-btn-caret { color: rgba(var(--v-theme-on-surface), 0.35); }
.ae-limits {
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}

.ae-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.ae-tag {
  padding: 5px 10px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
}
.ae-tag--on { font-weight: 600; }

.fp-row { display: flex; gap: 8px; }

/* Поля и кнопки — те же, что в остальных окнах сервиса. */
.dialog-close-sm {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 1;
}
.dialog-close-sm:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.field-hint {
  font-size: 11.5px; margin-top: 5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.input-with-suffix { position: relative; }
.input-with-suffix .field-input { padding-right: 36px; }
.input-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}
.btn-primary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.btn-primary:hover:not(:disabled) { background: #065f46; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500; cursor: pointer;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.ae-select-item:last-child { margin-bottom: 0; }
</style>
