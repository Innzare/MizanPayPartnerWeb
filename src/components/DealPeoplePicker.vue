<script setup lang="ts">
/**
 * Кто участвует в сделке: клиент и поручители — одним блоком.
 *
 * Раньше здесь стояли два поля поиска, пустых до первого символа. Партнёры
 * регулярно спрашивали, «как сюда добавить клиента»: поле молчит, пока не
 * начнёшь печатать, и непонятно, есть ли вообще база. Теперь список клиентов
 * виден сразу — как в разделе «Клиенты», только компактно: строка поиска,
 * двадцать человек, кнопка «Показать ещё».
 *
 * Клиент и поручители переключаются табами, потому что это одно и то же
 * действие над одним и тем же списком — выбрать человека, — и держать для них
 * два разных списка на экране незачем.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import type { ClientProfile } from '@/types'
import { clientProfileName } from '@/types'
import { formatPhone } from '@/utils/formatters'

const props = withDefaults(
  defineProps<{
    /** Выбранный клиент сделки. */
    clientId: string | null
    client: ClientProfile | null
    /** Поручители, по порядку: первый — основной. */
    guarantors: ClientProfile[]
    maxGuarantors?: number
  }>(),
  { maxGuarantors: 5 },
)

const emit = defineEmits<{
  (e: 'update:clientId', v: string | null): void
  (e: 'update:client', v: ClientProfile | null): void
  (e: 'update:guarantors', v: ClientProfile[]): void
  /** Партнёр нажал «Новый клиент» — окно создания открывает родитель. */
  (e: 'create'): void
}>()

const toast = useToast()

const tab = ref<'client' | 'guarantors'>('client')
const search = ref('')
const items = ref<ClientProfile[]>([])
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)

const PAGE = 20

async function load(reset = true) {
  if (reset) loading.value = true
  else loadingMore.value = true
  try {
    const qs = new URLSearchParams({
      limit: String(PAGE),
      offset: String(reset ? 0 : items.value.length),
    })
    if (search.value.trim()) qs.set('q', search.value.trim())
    const res = await api.get<{ items: ClientProfile[]; total: number }>(
      `/client-profiles/picker?${qs}`,
    )
    items.value = reset ? res.items : [...items.value, ...res.items]
    total.value = res.total
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить клиентов')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

onMounted(() => load())

// Поиск с задержкой: партнёр печатает фамилию, а не жмёт «найти».
let timer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => load(), 300)
})

const hasMore = computed(() => items.value.length < total.value)

const guarantorIds = computed(() => new Set(props.guarantors.map((g) => g.id)))
const canAddGuarantor = computed(() => props.guarantors.length < props.maxGuarantors)

/** Что показывает строка: выбран клиент, поручитель или ничего. */
function roleOf(p: ClientProfile): 'client' | 'guarantor' | null {
  if (props.clientId === p.id) return 'client'
  return guarantorIds.value.has(p.id) ? 'guarantor' : null
}

function pick(p: ClientProfile) {
  if (tab.value === 'client') {
    // Клиент и поручитель — разные люди: иначе договор сам себе гарантия.
    if (guarantorIds.value.has(p.id)) {
      toast.error('Этот человек уже добавлен поручителем')
      return
    }
    const same = props.clientId === p.id
    emit('update:clientId', same ? null : p.id)
    emit('update:client', same ? null : p)
    return
  }

  if (props.clientId === p.id) {
    toast.error('Это клиент сделки — поручителем он быть не может')
    return
  }
  if (guarantorIds.value.has(p.id)) {
    emit('update:guarantors', props.guarantors.filter((g) => g.id !== p.id))
    return
  }
  if (!canAddGuarantor.value) {
    toast.error(`Не больше ${props.maxGuarantors} поручителей`)
    return
  }
  emit('update:guarantors', [...props.guarantors, p])
}

function removeGuarantor(id: string) {
  emit('update:guarantors', props.guarantors.filter((g) => g.id !== id))
}

function clearClient() {
  emit('update:clientId', null)
  emit('update:client', null)
}

function hasPassport(p: ClientProfile): boolean {
  return !!(p.passportSeries && p.passportNumber)
}

function initials(p: ClientProfile): string {
  return `${p.firstName?.[0] ?? ''}${p.lastName?.[0] ?? ''}`.toUpperCase()
}

/** Город и паспорт — то, по чему различают однофамильцев. */
function subline(p: ClientProfile): string {
  return [p.phone ? formatPhone(p.phone) : null, p.city].filter(Boolean).join(' · ')
}

/** Только что созданного клиента показываем сразу первым в списке. */
function prepend(p: ClientProfile) {
  items.value = [p, ...items.value.filter((i) => i.id !== p.id)]
  total.value += 1
}

defineExpose({ prepend, reload: () => load() })
</script>

<template>
  <div class="dp">
    <div class="dp-head">
      <div class="dp-tabs">
        <button
          class="dp-tab"
          :class="{ 'dp-tab--on': tab === 'client' }"
          type="button"
          @click="tab = 'client'"
        >
          Клиент
          <span v-if="client" class="dp-tab-mark"><v-icon icon="mdi-check" size="12" /></span>
          <span v-else class="dp-tab-req">*</span>
        </button>
        <button
          class="dp-tab"
          :class="{ 'dp-tab--on': tab === 'guarantors' }"
          type="button"
          @click="tab = 'guarantors'"
        >
          Поручители
          <span v-if="guarantors.length" class="dp-tab-count">{{ guarantors.length }}</span>
        </button>
      </div>

      <button class="dp-add" type="button" @click="emit('create')">
        <v-icon icon="mdi-account-plus-outline" size="15" />
        Новый клиент
      </button>
    </div>

    <!-- Выбранные: клиент один, поручителей до пяти. Показываем над списком,
         чтобы было видно результат, а не только процесс. -->
    <div v-if="tab === 'client' && client" class="dp-chosen">
      <div class="dp-chosen-ava">{{ initials(client) }}</div>
      <div class="dp-chosen-body">
        <div class="dp-chosen-name">{{ clientProfileName(client) }}</div>
        <div class="dp-chosen-sub">{{ subline(client) }}</div>
      </div>
      <span v-if="!hasPassport(client)" class="dp-flag dp-flag--warn">без паспорта</span>
      <button class="dp-chosen-x" type="button" title="Убрать" @click="clearClient">
        <v-icon icon="mdi-close" size="16" />
      </button>
    </div>

    <div v-if="tab === 'guarantors' && guarantors.length" class="dp-chosen-list">
      <div v-for="(g, i) in guarantors" :key="g.id" class="dp-chosen">
        <div class="dp-chosen-ava">{{ initials(g) }}</div>
        <div class="dp-chosen-body">
          <div class="dp-chosen-name">
            {{ clientProfileName(g) }}
            <span v-if="i === 0" class="dp-flag dp-flag--main">основной</span>
          </div>
          <div class="dp-chosen-sub">{{ subline(g) }}</div>
        </div>
        <button class="dp-chosen-x" type="button" title="Убрать" @click="removeGuarantor(g.id)">
          <v-icon icon="mdi-close" size="16" />
        </button>
      </div>
    </div>

    <div v-if="tab === 'guarantors'" class="dp-note">
      Поручители необязательны, до {{ maxGuarantors }} человек. Первый в списке — основной.
    </div>

    <!-- Поиск и список: видно сразу, печатать необязательно. -->
    <div class="dp-search">
      <v-icon icon="mdi-magnify" size="17" class="dp-search-ico" />
      <input
        v-model="search"
        type="text"
        class="dp-search-input"
        :placeholder="tab === 'client' ? 'Найти клиента: имя, телефон, паспорт' : 'Найти поручителя: имя, телефон, паспорт'"
      />
      <button v-if="search" class="dp-search-x" type="button" title="Очистить" @click="search = ''">
        <v-icon icon="mdi-close" size="14" />
      </button>
    </div>

    <div v-if="loading" class="dp-loading">
      <v-progress-circular indeterminate size="24" width="2" color="#047857" />
    </div>

    <div v-else-if="!items.length" class="dp-empty">
      <v-icon icon="mdi-account-search-outline" size="26" />
      <div class="dp-empty-title">
        <template v-if="search">Никого не нашли</template>
        <template v-else>В базе пока нет клиентов</template>
      </div>
      <div class="dp-empty-text">
        <template v-if="search">Проверьте написание или заведите нового клиента.</template>
        <template v-else>Заведите первого — он появится здесь и в разделе «Клиенты».</template>
      </div>
      <button class="dp-add mt-3" type="button" @click="emit('create')">
        <v-icon icon="mdi-account-plus-outline" size="15" />
        Новый клиент
      </button>
    </div>

    <template v-else>
      <div class="dp-list">
        <button
          v-for="p in items"
          :key="p.id"
          type="button"
          class="dp-row"
          :class="{
            'dp-row--on': roleOf(p) !== null,
            'dp-row--other': roleOf(p) !== null && roleOf(p) !== (tab === 'client' ? 'client' : 'guarantor'),
          }"
          @click="pick(p)"
        >
          <div class="dp-row-ava">{{ initials(p) }}</div>
          <div class="dp-row-body">
            <div class="dp-row-name">
              {{ clientProfileName(p) }}
              <span v-if="hasPassport(p)" class="dp-flag dp-flag--ok">паспорт</span>
              <span v-else class="dp-flag dp-flag--warn">без паспорта</span>
            </div>
            <div class="dp-row-sub">{{ subline(p) }}</div>
          </div>

          <span v-if="roleOf(p) === 'client'" class="dp-role dp-role--client">клиент</span>
          <span v-else-if="roleOf(p) === 'guarantor'" class="dp-role dp-role--guarantor">поручитель</span>
          <span v-else class="dp-pick">Выбрать</span>
        </button>
      </div>

      <div class="dp-foot">
        <button v-if="hasMore" class="dp-more" type="button" :disabled="loadingMore" @click="load(false)">
          <v-progress-circular v-if="loadingMore" indeterminate size="14" width="2" />
          <template v-else>
            <v-icon icon="mdi-chevron-down" size="16" />
            Показать ещё
          </template>
        </button>
        <span class="dp-count">Показано {{ items.length }} из {{ total }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dp-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
}
.dp-tabs {
  display: flex; gap: 4px; padding: 4px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.dp-tab {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 14px; border-radius: 9px; border: none;
  background: transparent; cursor: pointer;
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.dp-tab--on { background: rgb(var(--v-theme-surface)); color: #047857; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); }
.dp-tab-req { color: #ef4444; }
.dp-tab-mark { color: #047857; display: inline-flex; }
.dp-tab-count {
  min-width: 18px; padding: 0 5px; border-radius: 8px;
  font-size: 11px; font-weight: 700; text-align: center;
  background: rgba(4, 120, 87, 0.12); color: #047857;
}

.dp-add {
  display: inline-flex; align-items: center; gap: 5px;
  height: 34px; padding: 0 12px; border-radius: 9px;
  border: 1px solid rgba(4, 120, 87, 0.3);
  background: rgb(var(--v-theme-surface));
  font-size: 12.5px; font-weight: 600; color: #047857; cursor: pointer;
}
.dp-add:hover { background: rgba(4, 120, 87, 0.08); }

/* ── Выбранные ── */
.dp-chosen-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.dp-chosen {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 12px; border-radius: 12px; margin-bottom: 12px;
  border: 1px solid rgba(4, 120, 87, 0.28);
  background: rgba(4, 120, 87, 0.06);
}
.dp-chosen-list .dp-chosen { margin-bottom: 0; }
.dp-chosen-ava {
  width: 36px; height: 36px; border-radius: 11px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.14); color: #047857;
  font-size: 13px; font-weight: 700;
}
.dp-chosen-body { flex: 1; min-width: 0; }
.dp-chosen-name {
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  font-size: 14px; font-weight: 600;
}
.dp-chosen-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }
.dp-chosen-x {
  width: 28px; height: 28px; border-radius: 8px; border: none; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.dp-chosen-x:hover { background: rgba(220, 38, 38, 0.1); color: #dc2626; }

.dp-note {
  font-size: 12.5px; line-height: 1.45; margin-bottom: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* ── Поиск ── */
.dp-search { position: relative; margin-bottom: 10px; }
.dp-search-ico {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.dp-search-input {
  width: 100%; height: 44px; padding: 0 36px 0 38px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.87); outline: none;
}
.dp-search-input:focus { border-color: rgba(4, 120, 87, 0.5); }
.dp-search-x {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  width: 22px; height: 22px; border-radius: 7px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: transparent; cursor: pointer; color: rgba(var(--v-theme-on-surface), 0.4);
}
.dp-search-x:hover { background: rgba(var(--v-theme-on-surface), 0.07); }

/* ── Список ── */
.dp-loading { display: flex; justify-content: center; padding: 28px 0; }
.dp-list {
  display: flex; flex-direction: column;
  max-height: 340px; overflow-y: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 12px;
}
.dp-row {
  display: flex; align-items: center; gap: 11px; width: 100%;
  padding: 10px 12px; border: none; background: transparent;
  text-align: left; cursor: pointer;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.dp-row:last-child { border-bottom: none; }
.dp-row:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.dp-row--on { background: rgba(4, 120, 87, 0.06); }
/* Человек уже занят в другой роли: выбрать его повторно нельзя. */
.dp-row--other { opacity: 0.65; }
.dp-row-ava {
  width: 34px; height: 34px; border-radius: 10px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 12.5px; font-weight: 700;
}
.dp-row-body { flex: 1; min-width: 0; }
.dp-row-name {
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  font-size: 13.5px; font-weight: 600;
}
.dp-row-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 1px; }

.dp-flag {
  padding: 1px 7px; border-radius: 7px; font-size: 10.5px; font-weight: 700;
  white-space: nowrap;
}
.dp-flag--ok { background: rgba(4, 120, 87, 0.12); color: #047857; }
.dp-flag--warn { background: rgba(245, 158, 11, 0.16); color: #b45309; }
.dp-flag--main { background: rgba(4, 120, 87, 0.14); color: #047857; }

.dp-pick {
  font-size: 12.5px; font-weight: 600; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.dp-row:hover .dp-pick { color: #047857; }
.dp-role {
  padding: 2px 9px; border-radius: 8px; font-size: 11px; font-weight: 700; white-space: nowrap;
}
.dp-role--client { background: #047857; color: #fff; }
.dp-role--guarantor { background: rgba(124, 58, 237, 0.14); color: #7c3aed; }

.dp-foot {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 10px;
}
.dp-more {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 13px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.dp-more:hover:not(:disabled) { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.dp-more:disabled { opacity: 0.6; cursor: default; }
.dp-count { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4); }

/* ── Пусто ── */
.dp-empty {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 32px 20px; text-align: center;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.dp-empty-title { font-size: 14.5px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.75); }
.dp-empty-text { font-size: 12.5px; line-height: 1.5; max-width: 380px; }
</style>
