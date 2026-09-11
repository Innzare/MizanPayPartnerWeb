<script setup lang="ts">
/**
 * Панель фильтров списка сделок.
 *
 * Условий много — полтора десятка, — поэтому они живут в выдвижной панели, а
 * не в ряду над таблицей: иначе шапка съедала бы пол-экрана. Включённые
 * условия видны плашками над списком, панель нужна только чтобы их задать.
 *
 * Состояние и подписи — в `useDealsFilters`: тот же набор кормит запрос к
 * серверу и адрес страницы, поэтому панель здесь занимается только вводом.
 */
import { computed, ref, watch } from 'vue'
import SelectField from '@/components/SelectField.vue'
import { useAuthStore } from '@/stores/auth'
import { useClientCities } from '@/composables/useClientCities'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useSuppliersStore } from '@/stores/suppliers'
import DateField from '@/components/DateField.vue'
import { CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { api } from '@/api/client'
import ClientPicker from '@/components/ClientPicker.vue'
import {
  DATE_FIELDS,
  DATE_PRESETS,
  DEAL_FLAG_OPTIONS,
  DEAL_STATUS_OPTIONS,
  PAY_STATE_OPTIONS,
  type DealsFilterState,
} from '@/composables/useDealsFilters'

const props = defineProps<{
  modelValue: boolean
  state: DealsFilterState
  activeCount: number
  /** Сохранённые наборы условий. */
  presets: Array<{ id: string; name: string }>
  /** Кассы, сотрудники и папки страницы — списки уже загружены ею. */
  cashBoxes?: Array<{ id: string; name: string; color?: string; isDefault?: boolean }>
  staff?: Array<{ id: string; firstName: string; lastName: string }>
  folders?: Array<{ id: string; name: string; color?: string }>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'preset', key: string): void
  (e: 'reset'): void
  (e: 'save-preset', name: string): void
  (e: 'apply-preset', id: string): void
  (e: 'remove-preset', id: string): void
}>()

/** Имя нового набора. Пустое поле — кнопка сохранения неактивна. */
const presetName = ref('')

function savePreset() {
  const name = presetName.value.trim()
  if (!name) return
  emit('save-preset', name)
  presetName.value = ''
}

/**
 * Удаление набора спрашиваем: восстановить его нечем — наборы хранятся в
 * браузере, а крестик стоит вплотную к названию, по которому набор применяют.
 */
function removePreset(p: { id: string; name: string }) {
  if (!confirm(`Удалить набор «${p.name}»?`)) return
  emit('remove-preset', p.id)
}

const auth = useAuthStore()
const { cities, fetchCities } = useClientCities()
const { coInvestors, fetchCoInvestors } = useCoInvestors()
const suppliers = useSuppliersStore()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** Города — часть данных клиентов: без права раздел не показываем. */
const canViewClients = computed(() => auth.can('clients.view'))

// Справочники подтягиваем при первом открытии панели, а не при загрузке
// страницы: список сделок не должен ждать данных, которые могут не
// понадобиться.
const loaded = ref(false)
watch(open, (v) => {
  if (!v || loaded.value) return
  loaded.value = true
  if (canViewClients.value) void fetchCities()
  void fetchCoInvestors()
  void suppliers.fetchList({ sort: 'name' }).catch(() => {})
})

const cityOptions = computed(() => cities.value.map((c: any) => c.city ?? c))

// ── Подсказки товаров ──
// Печатать название целиком неудобно, а список показывает, что вообще есть
// в портфеле. Грузим по мере ввода, с задержкой — иначе каждый символ уходит
// запросом.
const productOptions = ref<string[]>([])
let productTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.state.product,
  (v) => {
    if (productTimer) clearTimeout(productTimer)
    productTimer = setTimeout(async () => {
      try {
        const q = String(v ?? '').trim()
        productOptions.value = await api.get<string[]>(`/deals/products${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      } catch { productOptions.value = [] }
    }, 300)
  },
)

// Список подсказок нужен и до ввода: партнёр может просто выбрать из своего.
watch(open, (v) => {
  if (v && !productOptions.value.length) {
    api.get<string[]>('/deals/products').then((r) => { productOptions.value = r }).catch(() => {})
  }
})

/**
 * Ключ клиента в фильтре и id профиля в выбиралке — разные вещи: список
 * клиентов группируется своим ключом, чтобы счётчик сходился с содержимым
 * карточки. Для профиля ключ выглядит как `cp:<id>`.
 */
const clientPickerId = computed(() => {
  const k = props.state.clientKey
  return k.startsWith('cp:') ? k.slice(3) : null
})

function onClientPicked(id: string | null) {
  props.state.clientKey = id ? `cp:${id}` : ''
}

/** Переключение значения в наборе — галочки статусов, признаков и оплат. */
function toggle(list: string[], value: string) {
  const i = list.indexOf(value)
  if (i >= 0) list.splice(i, 1)
  else list.push(value)
}

/**
 * Сколько условий выбрано в каждой секции.
 *
 * Нужны, чтобы при шести секциях было видно, где уже что-то задано: без этого
 * панель читается сплошной простынёй, и включённый фильтр легко потерять.
 */
const counts = computed(() => {
  const s = props.state
  const range = (a: number | null, b: number | null) => (a != null || b != null ? 1 : 0)
  return {
    period: s.dateFrom || s.dateTo ? 1 : 0,
    statuses: s.statuses.length,
    flags: s.flags.length,
    payStates: s.payStates.length,
    ranges:
      range(s.totalFrom, s.totalTo) +
      range(s.remainingFrom, s.remainingTo) +
      range(s.monthlyFrom, s.monthlyTo) +
      range(s.termFrom, s.termTo) +
      range(s.overdueFrom, s.overdueTo),
    product: (s.product.trim() ? 1 : 0) + (s.cities.length ? 1 : 0),
    where: (s.cashBoxId ? 1 : 0) + (s.staffId ? 1 : 0) + (s.folderId ? 1 : 0),
    parties:
      (s.supplierId ? 1 : 0) + (s.noSupplier ? 1 : 0) +
      (s.coInvestorId ? 1 : 0) + (s.noCoInvestor ? 1 : 0),
  }
})

/** Очистить одну секцию — не трогая остальные. */

function clearSection(name: string) {
  const s = props.state
  if (name === 'period') { s.dateFrom = ''; s.dateTo = ''; s.dateField = 'createdAt' }
  if (name === 'statuses') s.statuses = []
  if (name === 'flags') s.flags = []
  if (name === 'payStates') s.payStates = []
  if (name === 'ranges') {
    s.totalFrom = s.totalTo = null
    s.remainingFrom = s.remainingTo = null
    s.monthlyFrom = s.monthlyTo = null
    s.termFrom = s.termTo = null
    s.overdueFrom = s.overdueTo = null
  }
  if (name === 'product') { s.product = ''; s.cities = [] }
  if (name === 'where') { s.cashBoxId = ''; s.staffId = ''; s.folderId = '' }
  if (name === 'parties') {
    s.supplierId = ''
    s.coInvestorId = ''
    s.noSupplier = false
    s.noCoInvestor = false
  }
}

/** Числовое поле: пустая строка — «без ограничения», а не ноль. */
function setNum(key: keyof DealsFilterState, raw: unknown) {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/\D/g, ''))
  ;(props.state as any)[key] = Number.isFinite(n) && String(raw ?? '') !== '' ? n : null
}
</script>

<template>
  <!-- Панель-«ящик» справа. Сделана диалогом, а не боковой панелью Vuetify:
       та обязана быть прямым потомком каркаса приложения, а фильтры живут
       внутри страницы — и падали с ошибкой раскладки. -->
  <v-dialog
    v-model="open"
    transition="fp-slide"
    width="380"
    class="fp-dialog"
    scrim="rgba(0,0,0,0.3)"
  >
    <div class="fp-drawer">
    <div class="fp-head">
      <div class="fp-title">
        Фильтры
        <span v-if="activeCount" class="fp-count">{{ activeCount }}</span>
      </div>
      <button class="fp-close" @click="open = false">
        <v-icon icon="mdi-close" size="18" />
      </button>
    </div>

    <div class="fp-body">
      <!-- Сохранённые наборы: «Просроченные по Ахмеду», «Поставщик X за
           квартал» — один клик вместо шести. -->
      <section v-if="presets.length || activeCount" class="fp-section">
        <div class="fp-section-head">
          <v-icon icon="mdi-bookmark-multiple-outline" size="15" class="fp-section-icon" />
          <span class="fp-section-title">Наборы</span>
          <!-- Что такое набор, из названия секции не очевидно — поясняем по
               наведению, не занимая место постоянной подписью. -->
          <v-tooltip location="bottom end" max-width="260">
            <template #activator="{ props: tp }">
              <v-icon v-bind="tp" icon="mdi-information-outline" size="15" class="fp-section-info" />
            </template>
            <span>
              Сохранённый набор — это выбранные сейчас фильтры под своим названием.
              Например «Просроченные по Ахмеду»: один клик вместо шести.
              Наборы хранятся в этом браузере.
            </span>
          </v-tooltip>
        </div>
        <div v-if="presets.length" class="fp-presets">
          <span v-for="p in presets" :key="p.id" class="fp-saved">
            <button type="button" class="fp-saved-apply" @click="emit('apply-preset', p.id)">
              {{ p.name }}
            </button>
            <button type="button" class="fp-saved-del" title="Удалить набор" @click="removePreset(p)">
              <v-icon icon="mdi-close" size="12" />
            </button>
          </span>
        </div>
        <div v-if="activeCount" class="fp-row">
          <input v-model="presetName" class="fp-input" placeholder="Название набора" @keyup.enter="savePreset" />
          <button class="fp-preset" :disabled="!presetName.trim()" @click="savePreset">Сохранить</button>
        </div>
      </section>

      <!-- Период -->
      <section class="fp-section" :class="{ 'fp-section--on': counts.period }">
        <div class="fp-section-head">
          <v-icon icon="mdi-calendar-range-outline" size="15" class="fp-section-icon" />
          <span class="fp-section-title">Период</span>
          <span v-if="counts.period" class="fp-section-count">{{ counts.period }}</span>
          <button v-if="counts.period" type="button" class="fp-section-clear" @click="clearSection('period')">
            Сбросить
          </button>
        </div>
        <div class="fp-presets">
          <button
            v-for="p in DATE_PRESETS"
            :key="p.key"
            type="button"
            class="fp-preset"
            @click="emit('preset', p.key)"
          >{{ p.label }}</button>
        </div>
        <div class="fp-row">
          <DateField v-model="state.dateFrom" placeholder="с" plain />
          <DateField v-model="state.dateTo" placeholder="по" plain />
        </div>
        <!-- У импортированных договоров дата создания — день загрузки файла,
             а заключены они за прошлые годы. Без выбора поля фильтр по датам
             для них давал бы бессмыслицу. -->
        <SelectField
          v-model="state.dateField"
          :options="DATE_FIELDS.map((f) => ({ value: f.value, label: f.label }))"
          compact
        />
      </section>

      <!-- Статус -->
      <section class="fp-section" :class="{ 'fp-section--on': counts.statuses }">
        <div class="fp-section-head">
          <v-icon icon="mdi-flag-outline" size="15" class="fp-section-icon" />
          <span class="fp-section-title">Статус договора</span>
          <span v-if="counts.statuses" class="fp-section-count">{{ counts.statuses }}</span>
          <button v-if="counts.statuses" type="button" class="fp-section-clear" @click="clearSection('statuses')">
            Сбросить
          </button>
        </div>
        <div class="fp-chips">
          <button
            v-for="o in DEAL_STATUS_OPTIONS"
            :key="o.value"
            type="button"
            class="fp-chip"
            :class="{ 'fp-chip--on': state.statuses.includes(o.value) }"
            @click="toggle(state.statuses, o.value)"
          >{{ o.label }}</button>
        </div>
      </section>

      <!-- Признаки -->
      <section class="fp-section" :class="{ 'fp-section--on': counts.flags }">
        <div class="fp-section-head">
          <v-icon icon="mdi-tag-outline" size="15" class="fp-section-icon" />
          <span class="fp-section-title">Признаки</span>
          <span v-if="counts.flags" class="fp-section-count">{{ counts.flags }}</span>
          <button v-if="counts.flags" type="button" class="fp-section-clear" @click="clearSection('flags')">
            Сбросить
          </button>
        </div>
        <div class="fp-hint">Показываем договоры с любым из отмеченных</div>
        <div class="fp-chips">
          <button
            v-for="o in DEAL_FLAG_OPTIONS"
            :key="o.value"
            type="button"
            class="fp-chip"
            :class="{ 'fp-chip--on': state.flags.includes(o.value) }"
            @click="toggle(state.flags, o.value)"
          >{{ o.label }}</button>
        </div>
      </section>

      <!-- Состояние оплат -->
      <section class="fp-section" :class="{ 'fp-section--on': counts.payStates }">
        <div class="fp-section-head">
          <v-icon icon="mdi-cash-multiple" size="15" class="fp-section-icon" />
          <span class="fp-section-title">Оплаты</span>
          <span v-if="counts.payStates" class="fp-section-count">{{ counts.payStates }}</span>
          <button v-if="counts.payStates" type="button" class="fp-section-clear" @click="clearSection('payStates')">
            Сбросить
          </button>
        </div>
        <div class="fp-chips">
          <button
            v-for="o in PAY_STATE_OPTIONS"
            :key="o.value"
            type="button"
            class="fp-chip"
            :class="{ 'fp-chip--on': state.payStates.includes(o.value) }"
            @click="toggle(state.payStates, o.value)"
          >{{ o.label }}</button>
        </div>
      </section>

      <!-- Числовые диапазоны -->
      <section class="fp-section" :class="{ 'fp-section--on': counts.ranges }">
        <div class="fp-section-head">
          <v-icon icon="mdi-numeric" size="15" class="fp-section-icon" />
          <span class="fp-section-title">Суммы и срок</span>
          <span v-if="counts.ranges" class="fp-section-count">{{ counts.ranges }}</span>
          <button v-if="counts.ranges" type="button" class="fp-section-clear" @click="clearSection('ranges')">
            Сбросить
          </button>
        </div>

        <div class="fp-range">
          <span class="fp-range-label">Сумма договора</span>
          <div class="fp-row">
            <input :value="state.totalFrom ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="от"
              @maska="(e: any) => setNum('totalFrom', parseMasked(e))" />
            <input :value="state.totalTo ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="до"
              @maska="(e: any) => setNum('totalTo', parseMasked(e))" />
          </div>
        </div>

        <div class="fp-range">
          <span class="fp-range-label">Остаток долга</span>
          <div class="fp-row">
            <input :value="state.remainingFrom ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="от"
              @maska="(e: any) => setNum('remainingFrom', parseMasked(e))" />
            <input :value="state.remainingTo ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="до"
              @maska="(e: any) => setNum('remainingTo', parseMasked(e))" />
          </div>
        </div>

        <div class="fp-range">
          <span class="fp-range-label">Ежемесячный платёж</span>
          <div class="fp-row">
            <input :value="state.monthlyFrom ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="от"
              @maska="(e: any) => setNum('monthlyFrom', parseMasked(e))" />
            <input :value="state.monthlyTo ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="до"
              @maska="(e: any) => setNum('monthlyTo', parseMasked(e))" />
          </div>
        </div>

        <div class="fp-range">
          <span class="fp-range-label">Срок, месяцев</span>
          <div class="fp-row">
            <input :value="state.termFrom ?? ''" type="number" min="1" class="fp-input" placeholder="от"
              @input="(e: any) => setNum('termFrom', e.target.value)" />
            <input :value="state.termTo ?? ''" type="number" min="1" class="fp-input" placeholder="до"
              @input="(e: any) => setNum('termTo', e.target.value)" />
          </div>
        </div>

        <div class="fp-range">
          <span class="fp-range-label">Сумма просрочки</span>
          <div class="fp-row">
            <input :value="state.overdueFrom ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="от"
              @maska="(e: any) => setNum('overdueFrom', parseMasked(e))" />
            <input :value="state.overdueTo ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="до"
              @maska="(e: any) => setNum('overdueTo', parseMasked(e))" />
          </div>
        </div>
      </section>

      <!-- Товар и город -->
      <!-- Касса, ответственный, папка -->
      <section
        v-if="(cashBoxes?.length ?? 0) > 1 || staff?.length || folders?.length"
        class="fp-section"
        :class="{ 'fp-section--on': counts.where }"
      >
        <div class="fp-section-head">
          <v-icon icon="mdi-office-building-outline" size="15" class="fp-section-icon" />
          <span class="fp-section-title">Где и кто</span>
          <span v-if="counts.where" class="fp-section-count">{{ counts.where }}</span>
          <button v-if="counts.where" type="button" class="fp-section-clear" @click="clearSection('where')">
            Сбросить
          </button>
        </div>

        <!-- Списками, а не кнопками: касс и сотрудников бывает много, и
             десяток кнопок вытеснил бы из панели всё остальное. -->
        <div v-if="(cashBoxes?.length ?? 0) > 1" class="fp-group">
          <span class="fp-group-title">Касса</span>
          <SelectField
            :model-value="state.cashBoxId || null"
            :options="(cashBoxes ?? []).map((b) => ({ value: b.id, label: b.name, color: b.color, hint: b.isDefault ? 'осн.' : undefined }))"
            empty-label="Все кассы"
            compact
            @update:model-value="state.cashBoxId = $event ?? ''"
          />
        </div>

        <div v-if="staff?.length" class="fp-group">
          <span class="fp-group-title">Ответственный</span>
          <SelectField
            :model-value="state.staffId || null"
            :options="(staff ?? []).map((p) => ({ value: p.id, label: `${p.firstName} ${p.lastName}`.trim() }))"
            empty-label="Все сотрудники"
            compact
            @update:model-value="state.staffId = $event ?? ''"
          />
        </div>

        <div v-if="folders?.length" class="fp-group">
          <span class="fp-group-title">Папка</span>
          <SelectField
            :model-value="state.folderId || null"
            :options="(folders ?? []).map((f) => ({ value: f.id, label: f.name, color: f.color || '#6366f1' }))"
            empty-label="Все папки"
            compact
            @update:model-value="state.folderId = $event ?? ''"
          />
        </div>

      </section>

      <section class="fp-section" :class="{ 'fp-section--on': counts.product }">
        <div class="fp-section-head">
          <v-icon icon="mdi-package-variant-closed" size="15" class="fp-section-icon" />
          <span class="fp-section-title">Товар и город</span>
          <span v-if="counts.product" class="fp-section-count">{{ counts.product }}</span>
          <button v-if="counts.product" type="button" class="fp-section-clear" @click="clearSection('product')">
            Сбросить
          </button>
        </div>
        <input
          v-model="state.product"
          class="fp-input"
          placeholder="Название товара"
          list="fp-product-list"
        />
        <!-- Подсказки из уже оформленных товаров: список короткий, поэтому
             обычный datalist, без тяжёлого выпадающего компонента. -->
        <datalist id="fp-product-list">
          <option v-for="p in productOptions" :key="p" :value="p" />
        </datalist>
        <div v-if="canViewClients && cityOptions.length" class="fp-chips fp-cities">
          <button
            v-for="c in cityOptions"
            :key="c"
            type="button"
            class="fp-chip"
            :class="{ 'fp-chip--on': state.cities.includes(c) }"
            @click="toggle(state.cities, c)"
          >{{ c }}</button>
        </div>
      </section>

      <!-- Клиент -->
      <section class="fp-section" :class="{ 'fp-section--on': state.clientKey }">
        <div class="fp-section-head">
          <v-icon icon="mdi-account-outline" size="15" class="fp-section-icon" />
          <span class="fp-section-title">Клиент</span>
          <span v-if="state.clientKey" class="fp-section-count">1</span>
          <button v-if="state.clientKey" type="button" class="fp-section-clear" @click="state.clientKey = ''">
            Сбросить
          </button>
        </div>
        <!-- Поиск по имени и телефону есть и в общей строке поиска, но фильтр
             удобнее, когда выбор нужно зафиксировать и дальше листать. -->
        <ClientPicker
          :model-value="clientPickerId"
          label="Выбрать клиента"
          @update:model-value="onClientPicked"
        />
      </section>

      <!-- Участники -->
      <section class="fp-section" :class="{ 'fp-section--on': counts.parties }">
        <div class="fp-section-head">
          <v-icon icon="mdi-account-group-outline" size="15" class="fp-section-icon" />
          <span class="fp-section-title">Участники</span>
          <span v-if="counts.parties" class="fp-section-count">{{ counts.parties }}</span>
          <button v-if="counts.parties" type="button" class="fp-section-clear" @click="clearSection('parties')">
            Сбросить
          </button>
        </div>

        <SelectField
          :model-value="state.supplierId || null"
          :options="(suppliers.rows ?? []).map((s: any) => ({ value: s.id, label: s.name }))"
          empty-label="Любой поставщик"
          :disabled="state.noSupplier"
          compact
          @update:model-value="state.supplierId = $event ?? ''"
        />
        <label class="fp-check">
          <input v-model="state.noSupplier" type="checkbox" />
          <span>Без поставщика — закупка на свои</span>
        </label>

        <SelectField
          :model-value="state.coInvestorId || null"
          :options="(coInvestors ?? []).map((c: any) => ({ value: c.id, label: c.name }))"
          empty-label="Любой инвестор"
          :disabled="state.noCoInvestor"
          compact
          @update:model-value="state.coInvestorId = $event ?? ''"
        />
        <label class="fp-check">
          <input v-model="state.noCoInvestor" type="checkbox" />
          <span>Без инвесторов</span>
        </label>
      </section>
    </div>

    <div class="fp-actions">
      <button class="fp-reset" :disabled="!activeCount" @click="emit('reset')">Сбросить всё</button>
      <button class="fp-apply" @click="open = false">Готово</button>
    </div>
    </div>
  </v-dialog>
</template>

<style scoped>
/* Оформление панели — в общем файле styles/filter-panel.css. */

/* Внутри раздела три списка подряд — каждому нужна своя подпись, иначе
   непонятно, где кассы, а где папки. */
.fp-group { margin-top: 8px; }
.fp-group:first-of-type { margin-top: 2px; }
.fp-group-title {
  display: block; margin-bottom: 5px;
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45);
}
</style>
