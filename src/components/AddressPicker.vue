<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

// Yandex Maps JS API грузится глобально из index.html — используется ТОЛЬКО для
// отрисовки карты. Подсказки и геокодирование идут через HTTP API напрямую:
// ymaps.suggest на нашем ключе отвечает «Suggest is not available» (услуга
// Геосаджест к JS API не подключена), а ymaps-промисы ещё и не имеют .finally,
// из-за чего прежний код молча гасил ошибку и список никогда не появлялся.
declare const ymaps: any

const props = defineProps<{
  address?: string | null
  lat?: number | null
  lng?: number | null
}>()
const emit = defineEmits<{
  (e: 'update:address', v: string): void
  (e: 'update:lat', v: number | null): void
  (e: 'update:lng', v: number | null): void
  (e: 'update:city', v: string): void
}>()

// Центр по умолчанию — Грозный (используется, пока точка не выбрана).
const DEFAULT_CENTER: [number, number] = [43.3169, 45.6981]
// Приоритетная область подсказок (Грозный и окрестности) — «долгота,широта~долгота,широта».
// Мягкий приоритет: адреса вне рамки тоже находятся, просто идут ниже.
const SUGGEST_BBOX = '45.4,43.1~46.0,43.5'
const SUGGEST_URL = 'https://suggest-maps.yandex.ru/v1/suggest'
const GEOCODE_URL = 'https://geocode-maps.yandex.ru/1.x/'

type Suggestion = {
  /** Основная строка — «проспект В.В. Путина, 40». */
  title: string
  /** Уточнение — «Грозный, Чеченская Республика». */
  subtitle: string
  /** Полный адрес одной строкой — им же геокодируем при выборе. */
  formatted: string
  /** Город из компонентов ответа — не требует отдельного запроса. */
  city: string
}

const mapId = 'ap-map-' + Math.random().toString(36).slice(2)
const search = ref('')
const suggestions = ref<Suggestion[]>([])
const searchLoading = ref(false)
const searchError = ref('')
const selectedAddress = ref(props.address ?? '')
const lat = ref<number | null>(props.lat ?? null)
const lng = ref<number | null>(props.lng ?? null)
const available = ref(typeof ymaps !== 'undefined')

let mapInstance: any = null
let placemark: any = null
let searchTimeout: ReturnType<typeof setTimeout> | null = null
let searchAbort: AbortController | null = null

/**
 * Ключ Яндекс.Карт.
 *
 * Значение продублировано из тега JS API в index.html осознанно: читать его
 * из DOM оказалось ненадёжно — блокировщики рекламы вырезают элемент по домену
 * api-maps.yandex.ru, и поиск оставался без ключа. Тег читаем лишь как запасной
 * вариант, чтобы смена ключа только в index.html всё же подхватилась.
 */
const YMAPS_KEY_FALLBACK = '42a38590-9138-4501-8146-0d57c63113ed'

function keyFromScriptTag(): string {
  const el = document.querySelector<HTMLScriptElement>('script[src*="api-maps.yandex.ru"]')
  if (!el) return ''
  try {
    return new URL(el.src, location.href).searchParams.get('apikey') ?? ''
  } catch {
    return ''
  }
}

function ymapsApiKey(): string {
  const fromEnv = import.meta.env.VITE_YANDEX_MAPS_KEY as string | undefined
  return fromEnv || keyFromScriptTag() || YMAPS_KEY_FALLBACK
}

function cityFromComponents(components: { kind: string | string[]; name: string }[]): string {
  const has = (c: (typeof components)[number], kind: string) =>
    Array.isArray(c.kind) ? c.kind.includes(kind) : c.kind === kind
  // Город → посёлок/село → район → регион: первое, что нашлось.
  for (const kind of ['LOCALITY', 'locality', 'AREA', 'area', 'PROVINCE', 'province']) {
    const hit = components.find((c) => has(c, kind))
    if (hit) return hit.name
  }
  return ''
}

// ─── HTTP Suggest API ────────────────────────────────────────────────────────
async function fetchSuggestions(text: string, signal: AbortSignal): Promise<Suggestion[]> {
  const apikey = ymapsApiKey()
  if (!apikey) throw new Error('Не найден ключ Яндекс.Карт')
  const q = new URLSearchParams({
    apikey,
    text,
    lang: 'ru_RU',
    results: '6',
    print_address: '1',
    bbox: SUGGEST_BBOX,
  })
  let res: Response
  try {
    res = await fetch(`${SUGGEST_URL}?${q}`, { signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    // fetch падает так же при офлайне и при блокировке домена расширением —
    // пишем обе причины, иначе сообщение «Failed to fetch» ничего не объясняет.
    throw new Error('Сервис подсказок недоступен — проверьте интернет или блокировщик рекламы')
  }
  if (!res.ok) throw new Error(`Сервис подсказок вернул ${res.status}`)
  const data = await res.json()
  return (data.results ?? []).map((r: any): Suggestion => {
    const title = r.title?.text ?? ''
    const subtitle = r.subtitle?.text ?? ''
    return {
      title,
      subtitle,
      formatted: r.address?.formatted_address ?? [subtitle, title].filter(Boolean).join(', '),
      city: cityFromComponents(r.address?.component ?? []),
    }
  })
}

// ─── HTTP Геокодер ───────────────────────────────────────────────────────────
type GeocodeResult = { address: string; city: string; coords: [number, number] }

async function geocode(geocodeParam: string): Promise<GeocodeResult | null> {
  const apikey = ymapsApiKey()
  if (!apikey) return null
  const q = new URLSearchParams({
    apikey,
    format: 'json',
    lang: 'ru_RU',
    results: '1',
    geocode: geocodeParam,
  })
  const res = await fetch(`${GEOCODE_URL}?${q}`)
  if (!res.ok) throw new Error(`Геокодер вернул ${res.status}`)
  const data = await res.json()
  const geoObject = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject
  if (!geoObject) return null
  const meta = geoObject.metaDataProperty?.GeocoderMetaData
  // Point.pos приходит как «долгота широта» — переворачиваем под формат карты.
  const [posLng, posLat] = String(geoObject.Point?.pos ?? '').split(' ').map(Number)
  if (!Number.isFinite(posLat) || !Number.isFinite(posLng)) return null
  return {
    address: meta?.text ?? '',
    city: cityFromComponents(meta?.Address?.Components ?? []),
    coords: [posLat, posLng],
  }
}

function commit(found: { address: string; city: string } | null, coords: [number, number], recenter = false) {
  lat.value = coords[0]
  lng.value = coords[1]
  if (found) {
    if (found.address) selectedAddress.value = found.address
    if (found.city) emit('update:city', found.city)
  }
  emit('update:address', selectedAddress.value)
  emit('update:lat', lat.value)
  emit('update:lng', lng.value)
  // Метка всегда встаёт в новые координаты; центр двигаем только при выборе из поиска,
  // чтобы клик по карте не «прыгал» и не уводил точку клика в центр.
  placemark?.geometry.setCoordinates(coords)
  if (recenter && mapInstance) {
    mapInstance.setCenter(coords, Math.max(mapInstance.getZoom(), 16))
  }
}

function onSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchAbort?.abort()
  searchError.value = ''
  const text = search.value.trim()
  if (!text) { suggestions.value = []; searchLoading.value = false; return }
  searchTimeout = setTimeout(async () => {
    const ctl = new AbortController()
    searchAbort = ctl
    searchLoading.value = true
    try {
      suggestions.value = await fetchSuggestions(text, ctl.signal)
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      suggestions.value = []
      // Ошибку показываем: молчаливый catch — причина, по которой поломку
      // подсказок не замечали.
      searchError.value = e?.message || 'Не удалось загрузить подсказки'
    } finally {
      if (searchAbort === ctl) { searchLoading.value = false; searchAbort = null }
    }
  }, 350)
}
// Vuetify @input может сработать до обновления v-model — следим за самой ref.
watch(search, onSearchInput)

async function selectSuggestion(item: Suggestion) {
  search.value = ''
  suggestions.value = []
  searchError.value = ''
  // Адрес и город известны сразу — проставляем, не дожидаясь координат.
  selectedAddress.value = item.formatted
  emit('update:address', item.formatted)
  if (item.city) emit('update:city', item.city)
  try {
    const found = await geocode(item.formatted)
    if (found) commit(found, found.coords, true) // из поиска — центрируем
  } catch (e: any) {
    searchError.value = e?.message || 'Не удалось определить координаты адреса'
  }
}

async function reverseGeocode(coords: [number, number]) {
  try {
    // Геокодер ждёт «долгота,широта».
    const found = await geocode(`${coords[1]},${coords[0]}`)
    commit(found, coords)
  } catch {
    commit(null, coords)
  }
}

function initMap() {
  if (typeof ymaps === 'undefined') { available.value = false; return }
  ymaps.ready(() => {
    const hasPoint = lat.value != null && lng.value != null
    const center: [number, number] = hasPoint ? [lat.value!, lng.value!] : DEFAULT_CENTER
    mapInstance = new ymaps.Map(mapId, { center, zoom: hasPoint ? 16 : 10, controls: ['zoomControl', 'geolocationControl'] })
    placemark = new ymaps.Placemark(center, {}, { preset: 'islands#redDotIcon', draggable: true })
    placemark.events.add('dragend', () => reverseGeocode(placemark.geometry.getCoordinates()))
    mapInstance.geoObjects.add(placemark)
    mapInstance.events.add('click', (e: any) => reverseGeocode(e.get('coords')))
    // Диалог открывается с анимацией — контейнер мог быть 0×0 на момент создания.
    setTimeout(() => mapInstance?.container?.fitToViewport?.(), 350)
  })
}

onMounted(() => nextTick(initMap))
onBeforeUnmount(() => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchAbort?.abort()
  if (mapInstance) { mapInstance.destroy(); mapInstance = null; placemark = null }
})
</script>

<template>
  <div class="ap">
    <div class="ap-search">
      <v-text-field
        v-model="search"
        variant="outlined" density="comfortable" rounded="lg" hide-details
        placeholder="Начните вводить адрес…"
        prepend-inner-icon="mdi-magnify"
        :loading="searchLoading"
        autocomplete="off"
      />
      <v-list v-if="suggestions.length" class="ap-suggest" density="compact" rounded="lg">
        <v-list-item
          v-for="(item, i) in suggestions" :key="i"
          :title="item.title"
          :subtitle="item.subtitle"
          @click="selectSuggestion(item)"
        >
          <template #prepend><v-icon icon="mdi-map-marker-outline" size="18" /></template>
        </v-list-item>
      </v-list>
    </div>

    <div v-if="searchError" class="ap-error">
      <v-icon icon="mdi-alert-circle-outline" size="15" />
      <span>{{ searchError }}</span>
    </div>

    <div v-if="available" :id="mapId" class="ap-map"></div>
    <div v-else class="ap-nomap">Карта недоступна — введите адрес вручную ниже</div>

    <div v-if="selectedAddress" class="ap-selected">
      <v-icon icon="mdi-map-marker-check-outline" size="16" color="#047857" />
      <span>{{ selectedAddress }}</span>
    </div>
    <div v-else class="ap-hint">Найдите адрес в поиске или отметьте точку на карте</div>
  </div>
</template>

<style scoped>
.ap { position: relative; }
.ap-search { position: relative; margin-bottom: 10px; }
.ap-suggest {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 30; margin-top: 4px;
  max-height: 240px; overflow-y: auto;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  box-shadow: 0 8px 28px rgba(0,0,0,0.18);
}
.ap-error {
  display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
  font-size: 12.5px; color: #dc2626;
}
.ap-map { width: 100%; height: 300px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); }
.ap-nomap { padding: 20px; text-align: center; border: 1px dashed rgba(var(--v-theme-on-surface), 0.2); border-radius: 12px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); }
.ap-selected { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.8); }
.ap-hint { margin-top: 8px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
</style>
