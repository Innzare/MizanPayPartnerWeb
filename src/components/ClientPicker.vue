<script setup lang="ts">
import { useClientProfilesStore } from '@/stores/clientProfiles'
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

const selected = ref<ClientProfile | null>(null)
const items = ref<ClientProfile[]>([])
const loading = ref(false)
const search = ref('')

let searchTimeout: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  if (props.modelValue) {
    try {
      const profile = await store.findById(props.modelValue)
      selected.value = profile
      items.value = [profile]
    } catch {}
  }
})

watch(() => props.modelValue, async (val) => {
  if (!val) { selected.value = null; return }
  if (selected.value?.id !== val) {
    try {
      const profile = await store.findById(val)
      selected.value = profile
      if (!items.value.find(i => i.id === val)) items.value = [profile, ...items.value]
    } catch { selected.value = null }
  }
})

function onSearch(val: string) {
  search.value = val || ''
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!val?.trim()) { items.value = selected.value ? [selected.value] : []; return }
  searchTimeout = setTimeout(async () => {
    loading.value = true
    try { items.value = await store.search(val, 8) } catch { items.value = [] }
    finally { loading.value = false }
  }, 300)
}

function onSelect(profile: ClientProfile | null) {
  selected.value = profile
  emit('update:modelValue', profile?.id ?? null)
  emit('selected', profile)
}

function selectProfile(profile: ClientProfile) {
  selected.value = profile
  if (!items.value.find(i => i.id === profile.id)) items.value = [profile, ...items.value]
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
        <v-list-item-title class="text-body-2 font-weight-medium">
          {{ clientProfileName(item.raw) }}
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