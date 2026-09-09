<script setup lang="ts">
/**
 * Панель фильтров списка платежей.
 *
 * Устроена так же, как панель сделок, и пользуется тем же оформлением
 * (`styles/filter-panel.css`): привыкли фильтровать в сделках — в платежах
 * всё работает одинаково. Отличается только состав условий: здесь два
 * периода — по плановому сроку и по факту оплаты.
 */
import { computed, ref, watch } from 'vue'
import SelectField from '@/components/SelectField.vue'
import { useAuthStore } from '@/stores/auth'
import { useClientCities } from '@/composables/useClientCities'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useSuppliersStore } from '@/stores/suppliers'
import DateField from '@/components/DateField.vue'
import ClientPicker from '@/components/ClientPicker.vue'
import { api } from '@/api/client'
import { CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import {
  PAYMENT_DATE_PRESETS,
  PAYMENT_STATUS_OPTIONS,
  type PaymentsFilterState,
} from '@/composables/usePaymentsFilters'

const props = defineProps<{
  modelValue: boolean
  state: PaymentsFilterState
  activeCount: number
  presets: Array<{ id: string; name: string }>
  /** Кассы, сотрудники и папки страницы — списки уже загружены ею. */
  cashBoxes?: Array<{ id: string; name: string; color?: string; isDefault?: boolean }>
  staff?: Array<{ id: string; firstName: string; lastName: string }>
  folders?: Array<{ id: string; name: string; color?: string }>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'preset', payload: { key: string; field: 'due' | 'paid' }): void
  (e: 'reset'): void
  (e: 'save-preset', name: string): void
  (e: 'apply-preset', id: string): void
  (e: 'remove-preset', id: string): void
}>()

const auth = useAuthStore()
const { cities, fetchCities } = useClientCities()
const { coInvestors, fetchCoInvestors } = useCoInvestors()
const suppliers = useSuppliersStore()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const canViewClients = computed(() => auth.can('clients.view'))
const cityOptions = computed(() => cities.value.map((c: any) => c.city ?? c))

const presetName = ref('')
const productOptions = ref<string[]>([])
const loaded = ref(false)

// Справочники грузим при первом открытии: список платежей не должен ждать
// данных, которые могут не понадобиться.
watch(open, (v) => {
  if (!v || loaded.value) return
  loaded.value = true
  if (canViewClients.value) void fetchCities()
  void fetchCoInvestors()
  void suppliers.fetchList({ sort: 'name' }).catch(() => {})
  api.get<string[]>('/deals/products').then((r) => { productOptions.value = r }).catch(() => {})
})

const counts = computed(() => {
  const s = props.state
  return {
    due: s.dueFrom || s.dueTo ? 1 : 0,
    paid: s.paidFrom || s.paidTo ? 1 : 0,
    statuses: s.statuses.length,
    amount: s.amountFrom != null || s.amountTo != null ? 1 : 0,
    product: (s.product.trim() ? 1 : 0) + (s.cities.length ? 1 : 0),
    client: s.clientKey ? 1 : 0,
    parties: (s.supplierId ? 1 : 0) + (s.coInvestorId ? 1 : 0),
    where: (s.cashBoxId ? 1 : 0) + (s.staffId ? 1 : 0) + (s.folderId ? 1 : 0),
  }
})

function clearSection(name: string) {
  const s = props.state
  if (name === 'due') { s.dueFrom = ''; s.dueTo = '' }
  if (name === 'paid') { s.paidFrom = ''; s.paidTo = '' }
  if (name === 'statuses') s.statuses = []
  if (name === 'amount') { s.amountFrom = null; s.amountTo = null }
  if (name === 'product') { s.product = ''; s.cities = [] }
  if (name === 'client') s.clientKey = ''
  if (name === 'parties') { s.supplierId = ''; s.coInvestorId = '' }
  if (name === 'where') { s.cashBoxId = ''; s.staffId = ''; s.folderId = '' }
}


function toggle(list: string[], value: string) {
  const i = list.indexOf(value)
  if (i >= 0) list.splice(i, 1)
  else list.push(value)
}

function setNum(key: 'amountFrom' | 'amountTo', raw: unknown) {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/\D/g, ''))
  props.state[key] = Number.isFinite(n) && String(raw ?? '') !== '' ? n : null
}

const clientPickerId = computed(() => {
  const k = props.state.clientKey
  return k.startsWith('cp:') ? k.slice(3) : null
})

function onClientPicked(id: string | null) {
  props.state.clientKey = id ? `cp:${id}` : ''
}

function savePreset() {
  const name = presetName.value.trim()
  if (!name) return
  emit('save-preset', name)
  presetName.value = ''
}

function removePreset(p: { id: string; name: string }) {
  if (!confirm(`Удалить набор «${p.name}»?`)) return
  emit('remove-preset', p.id)
}
</script>

<template>
  <v-dialog
    v-model="open"
    transition="dialog-right-transition"
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
        <!-- Наборы -->
        <section v-if="presets.length || activeCount" class="fp-section">
          <div class="fp-section-head">
            <v-icon icon="mdi-bookmark-multiple-outline" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Наборы</span>
            <v-tooltip location="bottom end" max-width="260">
              <template #activator="{ props: tp }">
                <v-icon v-bind="tp" icon="mdi-information-outline" size="15" class="fp-section-info" />
              </template>
              <span>
                Сохранённый набор — выбранные сейчас фильтры под своим названием.
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

        <!-- Срок платежа -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.due }">
          <div class="fp-section-head">
            <v-icon icon="mdi-calendar-range-outline" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Срок платежа</span>
            <span v-if="counts.due" class="fp-section-count">{{ counts.due }}</span>
            <button v-if="counts.due" type="button" class="fp-section-clear" @click="clearSection('due')">
              Сбросить
            </button>
          </div>
          <div class="fp-presets">
            <button
              v-for="p in PAYMENT_DATE_PRESETS"
              :key="p.key"
              type="button"
              class="fp-preset"
              @click="emit('preset', { key: p.key, field: 'due' })"
            >{{ p.label }}</button>
          </div>
          <div class="fp-row">
            <DateField v-model="state.dueFrom" placeholder="с" plain />
            <DateField v-model="state.dueTo" placeholder="по" plain />
          </div>
        </section>

        <!-- Дата оплаты -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.paid }">
          <div class="fp-section-head">
            <v-icon icon="mdi-cash-check" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Когда оплачен</span>
            <span v-if="counts.paid" class="fp-section-count">{{ counts.paid }}</span>
            <button v-if="counts.paid" type="button" class="fp-section-clear" @click="clearSection('paid')">
              Сбросить
            </button>
          </div>
          <!-- Отдельный период: доход учитывается в месяце фактической оплаты,
               и «что пришло за август» — это другой вопрос, чем «что должны
               были заплатить в августе». -->
          <div class="fp-presets">
            <button
              v-for="p in PAYMENT_DATE_PRESETS"
              :key="p.key"
              type="button"
              class="fp-preset"
              @click="emit('preset', { key: p.key, field: 'paid' })"
            >{{ p.label }}</button>
          </div>
          <div class="fp-row">
            <DateField v-model="state.paidFrom" placeholder="с" plain />
            <DateField v-model="state.paidTo" placeholder="по" plain />
          </div>
        </section>

        <!-- Статус -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.statuses }">
          <div class="fp-section-head">
            <v-icon icon="mdi-flag-outline" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Статус платежа</span>
            <span v-if="counts.statuses" class="fp-section-count">{{ counts.statuses }}</span>
            <button v-if="counts.statuses" type="button" class="fp-section-clear" @click="clearSection('statuses')">
              Сбросить
            </button>
          </div>
          <div class="fp-chips">
            <button
              v-for="o in PAYMENT_STATUS_OPTIONS"
              :key="o.value"
              type="button"
              class="fp-chip"
              :class="{ 'fp-chip--on': state.statuses.includes(o.value) }"
              @click="toggle(state.statuses, o.value)"
            >{{ o.label }}</button>
          </div>
        </section>

        <!-- Сумма -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.amount }">
          <div class="fp-section-head">
            <v-icon icon="mdi-numeric" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Сумма платежа</span>
            <span v-if="counts.amount" class="fp-section-count">{{ counts.amount }}</span>
            <button v-if="counts.amount" type="button" class="fp-section-clear" @click="clearSection('amount')">
              Сбросить
            </button>
          </div>
          <div class="fp-row">
            <input :value="state.amountFrom ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="от"
              @maska="(e: any) => setNum('amountFrom', parseMasked(e))" />
            <input :value="state.amountTo ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="до"
              @maska="(e: any) => setNum('amountTo', parseMasked(e))" />
          </div>
        </section>

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

        <!-- Товар и город -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.product }">
          <div class="fp-section-head">
            <v-icon icon="mdi-package-variant-closed" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Товар и город</span>
            <span v-if="counts.product" class="fp-section-count">{{ counts.product }}</span>
            <button v-if="counts.product" type="button" class="fp-section-clear" @click="clearSection('product')">
              Сбросить
            </button>
          </div>
          <input v-model="state.product" class="fp-input" placeholder="Название товара" list="pf-product-list" />
          <datalist id="pf-product-list">
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
        <section class="fp-section" :class="{ 'fp-section--on': counts.client }">
          <div class="fp-section-head">
            <v-icon icon="mdi-account-outline" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Клиент</span>
            <span v-if="counts.client" class="fp-section-count">1</span>
            <button v-if="counts.client" type="button" class="fp-section-clear" @click="clearSection('client')">
              Сбросить
            </button>
          </div>
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
            compact
            @update:model-value="state.supplierId = $event ?? ''"
          />
          <div style="margin-top: 12px;">
            <SelectField
              :model-value="state.coInvestorId || null"
              :options="(coInvestors ?? []).map((c: any) => ({ value: c.id, label: c.name }))"
              empty-label="Любой инвестор"
              compact
              @update:model-value="state.coInvestorId = $event ?? ''"
            />
          </div>
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
