<script setup lang="ts">
import { useClientProfilesStore } from '@/stores/clientProfiles'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import type { ClientProfile } from '@/types'
import { clientProfileName } from '@/types'
import { formatPhone } from '@/utils/formatters'

const props = defineProps<{
  modelValue?: string | null
  label?: string
  required?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [id: string | null]
  'selected': [profile: ClientProfile | null]
}>()

const store = useClientProfilesStore()
const authStore = useAuthStore()
const toast = useToast()

const selected = ref<ClientProfile | null>(null)
const items = ref<(ClientProfile & { _source?: 'mine' | 'global' })[]>([])
const loading = ref(false)
const search = ref('')

let searchTimeout: ReturnType<typeof setTimeout> | null = null

const myId = computed(() => (authStore.user as any)?.id || '')

function tagItems(rows: ClientProfile[]) {
  return rows.map((p) => ({
    ...p,
    _source: (p.createdByInvestorId === myId.value ? 'mine' : 'global') as 'mine' | 'global',
  }))
}

onMounted(async () => {
  if (props.modelValue) {
    try {
      const profile = await store.findById(props.modelValue)
      selected.value = profile
      items.value = tagItems([profile])
    } catch {}
  }
})

watch(() => props.modelValue, async (val) => {
  if (!val) { selected.value = null; return }
  if (selected.value?.id !== val) {
    try {
      const profile = await store.findById(val)
      selected.value = profile
      if (!items.value.find(i => i.id === val)) items.value = [...tagItems([profile]), ...items.value]
    } catch { selected.value = null }
  }
})

function onSearch(val: string) {
  search.value = val || ''
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!val?.trim()) { items.value = selected.value ? tagItems([selected.value]) : []; return }
  searchTimeout = setTimeout(async () => {
    loading.value = true
    try {
      // search() returns both my clients and global registry — tag each row
      const rows = await store.search(val, 8) as any[]
      items.value = rows.map((p) => ({
        ...p,
        _source: (p.isGlobal || p.createdByInvestorId !== myId.value) ? 'global' : 'mine',
      }))
    } catch { items.value = [] }
    finally { loading.value = false }
  }, 300)
}

async function onSelect(profile: (ClientProfile & { _source?: string }) | null) {
  if (!profile) {
    selected.value = null
    emit('update:modelValue', null)
    emit('selected', null)
    return
  }
  // If selected from global registry → auto-clone into my registry
  if (profile._source === 'global' && !profile.userId) {
    try {
      const cloned = await store.cloneFromGlobal(profile.id)
      selected.value = cloned
      if (!items.value.find((i) => i.id === cloned.id)) {
        items.value = [{ ...cloned, _source: 'mine' }, ...items.value]
      }
      emit('update:modelValue', cloned.id)
      emit('selected', cloned)
      toast.success('Клиент скопирован из реестра в вашу базу')
      return
    } catch (e: any) {
      toast.error(e.message || 'Не удалось скопировать клиента из реестра')
      selected.value = null
      emit('update:modelValue', null)
      emit('selected', null)
      return
    }
  }
  // Platform clients (Variant X) or own clients — link directly
  selected.value = profile
  emit('update:modelValue', profile.id)
  emit('selected', profile)
}

function selectProfile(profile: ClientProfile) {
  selected.value = profile
  if (!items.value.find(i => i.id === profile.id)) items.value = [...tagItems([profile]), ...items.value]
  emit('update:modelValue', profile.id)
  emit('selected', profile)
}

function hasPassport(p: ClientProfile): boolean {
  return !!(p.passportSeries || p.passportNumber)
}

defineExpose({ selectProfile })
</script>

<template>
  <v-autocomplete
    v-model="selected"
    :items="items"
    :loading="loading"
    :label="label || 'Поиск клиента по телефону или имени...'"
    :placeholder="label || 'Поиск клиента по телефону или имени...'"
    item-value="id"
    :item-title="(item: any) => clientProfileName(item)"
    return-object
    no-filter
    hide-no-data
    clearable
    variant="outlined"
    density="comfortable"
    rounded="lg"
    @update:search="onSearch"
    @update:model-value="onSelect"
  >
    <template #item="{ item, props: itemProps }">
      <v-list-item v-bind="itemProps" :title="undefined" :subtitle="undefined">
        <template #prepend>
          <v-avatar size="36" color="primary" variant="tonal" class="text-caption font-weight-bold">
            {{ item.raw.firstName?.[0] }}{{ item.raw.lastName?.[0] }}
          </v-avatar>
        </template>
        <v-list-item-title class="text-body-2 font-weight-medium d-flex align-center ga-2">
          {{ clientProfileName(item.raw) }}
          <v-chip
            v-if="item.raw._source === 'global'"
            size="x-small" color="info" variant="tonal" label
          >
            <v-icon start icon="mdi-earth" size="10" />
            Из реестра
          </v-chip>
          <v-chip
            v-else
            size="x-small" color="success" variant="tonal" label
          >
            Мой
          </v-chip>
        </v-list-item-title>
        <v-list-item-subtitle class="text-caption">
          {{ formatPhone(item.raw.phone) }}
        </v-list-item-subtitle>
        <template #append>
          <v-chip v-if="hasPassport(item.raw)" size="x-small" color="success" variant="tonal" label>
            <v-icon start icon="mdi-check-circle" size="10" />
            Документы
          </v-chip>
        </template>
      </v-list-item>
    </template>

    <template #selection="{ item }">
      <div class="cp-selection">
        <v-avatar size="28" color="primary" class="text-caption font-weight-bold mr-2">
          {{ item.raw.firstName?.[0] }}{{ item.raw.lastName?.[0] }}
        </v-avatar>
        <span class="text-body-2 font-weight-medium">{{ clientProfileName(item.raw) }}</span>
        <v-chip
          v-if="hasPassport(item.raw)"
          size="x-small"
          color="success"
          variant="tonal"
          label
          class="ml-2"
        >
          Паспорт
        </v-chip>
        <v-chip v-else size="x-small" color="warning" variant="tonal" label class="ml-2">
          Без паспорта
        </v-chip>
      </div>
    </template>

    <template #prepend-inner>
      <v-icon icon="mdi-magnify" size="18" class="me-1" />
    </template>
  </v-autocomplete>
</template>

<style scoped>
.cp-selection {
  display: flex;
  align-items: center;
}
</style>
