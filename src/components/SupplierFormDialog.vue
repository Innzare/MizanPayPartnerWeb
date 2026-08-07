<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSuppliersStore, type SupplierRow, type SupplierInput } from '@/stores/suppliers'
import FormModal from '@/components/FormModal.vue'
import AddressPicker from '@/components/AddressPicker.vue'
import ComboBox from '@/components/ComboBox.vue'
import { CITIES } from '@/constants/cities'
import { SUPPLIER_CATEGORIES } from '@/constants/suppliers'
import { PHONE_MASK } from '@/utils/formatters'

const props = defineProps<{ modelValue: boolean; supplier?: SupplierRow | null }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved'): void
}>()

const store = useSuppliersStore()
const isEdit = computed(() => !!props.supplier)
const saving = ref(false)
const error = ref('')

const form = ref<SupplierInput>({ name: '' })

const cityItems = computed(() => {
  const c = form.value.city?.trim()
  return c && !CITIES.includes(c as any) ? [c, ...CITIES] : [...CITIES]
})

watch(() => props.modelValue, (open) => {
  if (open) {
    error.value = ''
    const s = props.supplier
    form.value = {
      name: s?.name ?? '',
      activity: s?.activity ?? '',
      contactName: s?.contactName ?? '',
      phone: s?.phone ?? '',
      email: s?.email ?? '',
      city: s?.city ?? '',
      address: s?.address ?? '',
      lat: s?.lat ?? undefined,
      lng: s?.lng ?? undefined,
      notes: s?.notes ?? '',
    }
  }
})

async function save() {
  if (!form.value.name.trim()) { error.value = 'Укажите наименование'; return }
  saving.value = true
  error.value = ''
  try {
    const payload: SupplierInput = {
      name: form.value.name.trim(),
      activity: form.value.activity?.trim() || undefined,
      contactName: form.value.contactName?.trim() || undefined,
      phone: form.value.phone?.trim() || undefined,
      email: form.value.email?.trim() || undefined,
      city: form.value.city?.trim() || undefined,
      address: form.value.address?.trim() || undefined,
      lat: form.value.lat ?? undefined,
      lng: form.value.lng ?? undefined,
      notes: form.value.notes?.trim() || undefined,
    }
    if (props.supplier) await store.update(props.supplier.id, payload)
    else await store.create(payload)
    emit('saved')
    emit('update:modelValue', false)
  } catch (e: any) {
    error.value = e?.message || 'Не удалось сохранить'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <FormModal
    :model-value="modelValue"
    :title="isEdit ? 'Редактировать партнёра' : 'Новый партнёр'"
    subtitle="Поставщик товаров, у которого выкупаете товар"
    icon="mdi-handshake-outline"
    :max-width="580"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="form-field">
      <label class="field-label">Наименование <span class="required">*</span></label>
      <input v-model="form.name" type="text" class="field-input" placeholder="Магазин / поставщик" />
    </div>

    <div class="form-field">
      <label class="field-label">Чем занимается</label>
      <ComboBox
        :model-value="form.activity ?? ''"
        :items="SUPPLIER_CATEGORIES"
        placeholder="Выберите категорию или введите свою"
        @update:model-value="form.activity = $event"
      />
    </div>

    <div class="form-row-2">
      <div class="form-field">
        <label class="field-label">Контактное лицо</label>
        <input v-model="form.contactName" type="text" class="field-input" placeholder="Имя" />
      </div>
      <div class="form-field">
        <label class="field-label">Телефон</label>
        <input v-model="form.phone" v-maska="PHONE_MASK" type="tel" class="field-input" placeholder="+7 (___) ___-__-__" />
      </div>
    </div>

    <div class="form-field">
      <label class="field-label">Адрес на карте</label>
      <AddressPicker
        :key="supplier?.id ?? 'new'"
        :address="form.address"
        :lat="form.lat"
        :lng="form.lng"
        @update:address="form.address = $event"
        @update:lat="form.lat = $event ?? undefined"
        @update:lng="form.lng = $event ?? undefined"
        @update:city="form.city = $event"
      />
    </div>

    <div class="form-row-2">
      <div class="form-field">
        <label class="field-label">Город</label>
        <select v-model="form.city" class="field-input field-select">
          <option value="">Не выбран</option>
          <option v-for="c in cityItems" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
      <div class="form-field">
        <label class="field-label">Email</label>
        <input v-model="form.email" type="email" class="field-input" placeholder="mail@example.ru" />
      </div>
    </div>

    <div class="form-field">
      <label class="field-label">Адрес (текстом)</label>
      <input v-model="form.address" type="text" class="field-input" placeholder="Уточните вручную при необходимости" />
    </div>

    <div class="form-field">
      <label class="field-label">Заметки</label>
      <textarea v-model="form.notes" class="field-input field-textarea" rows="2" placeholder="Комментарий…"></textarea>
    </div>

    <div v-if="error" class="text-error text-body-2">{{ error }}</div>

    <template #footer>
      <v-btn variant="text" @click="emit('update:modelValue', false)">Отмена</v-btn>
      <v-btn color="primary" variant="flat" rounded="lg" :loading="saving" @click="save">
        {{ isEdit ? 'Сохранить' : 'Добавить' }}
      </v-btn>
    </template>
  </FormModal>
</template>
