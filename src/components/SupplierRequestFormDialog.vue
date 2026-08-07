<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useSuppliersStore, type SupplierRequest, type SupplierRequestInput, type SupplierRow } from '@/stores/suppliers'
import { CURRENCY_MASK } from '@/utils/formatters'
import type { ClientProfile } from '@/types'
import { CATEGORIES } from '@/constants/categories'
import { CITIES } from '@/constants/cities'
import FormModal from '@/components/FormModal.vue'
import ClientPicker from '@/components/ClientPicker.vue'
import CreateClientDialog from '@/components/CreateClientDialog.vue'

const props = defineProps<{
  modelValue: boolean
  request?: SupplierRequest | null
  presetSupplierId?: string | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved'): void
}>()

const store = useSuppliersStore()
const isEdit = computed(() => !!props.request)
const saving = ref(false)
const error = ref('')
const suppliers = ref<SupplierRow[]>([])

const supplierId = ref('')
const productName = ref('')
const category = ref('')
const city = ref('')
const priceInput = ref('')
const clientProfileId = ref<string | null>(null)
const comment = ref('')

const clientPickerRef = ref<InstanceType<typeof ClientPicker> | null>(null)
const showCreateClient = ref(false)

const ownedSuppliers = computed(() => suppliers.value.filter((s) => !s.archivedAt))
const cityItems = computed(() => {
  const c = city.value?.trim()
  return c && !CITIES.includes(c as any) ? [c, ...CITIES] : [...CITIES]
})

async function loadSuppliers() {
  await store.fetchList({ sort: 'name' })
  suppliers.value = [...store.rows]
}

watch(() => props.modelValue, (open) => {
  if (open) {
    error.value = ''
    const r = props.request
    supplierId.value = r?.supplierId ?? props.presetSupplierId ?? ''
    productName.value = r?.productName ?? ''
    category.value = r?.category ?? ''
    city.value = r?.city ?? ''
    priceInput.value = r?.price != null ? String(r.price) : ''
    clientProfileId.value = r?.clientProfileId ?? null
    comment.value = r?.comment ?? ''
    if (!suppliers.value.length) loadSuppliers()
  }
})

onMounted(loadSuppliers)

function onClientCreated(profile: ClientProfile) {
  clientPickerRef.value?.selectProfile(profile)
  clientProfileId.value = profile.id
}

function priceToNumber(): number | undefined {
  const digits = priceInput.value.replace(/\D/g, '')
  return digits ? Number(digits) : undefined
}

async function save() {
  if (!supplierId.value) { error.value = 'Выберите поставщика'; return }
  if (!productName.value.trim()) { error.value = 'Укажите товар'; return }
  saving.value = true
  error.value = ''
  try {
    const payload: SupplierRequestInput = {
      supplierId: supplierId.value,
      productName: productName.value.trim(),
      category: category.value || undefined,
      city: city.value || undefined,
      price: priceToNumber(),
      clientProfileId: clientProfileId.value,
      comment: comment.value.trim() || undefined,
    }
    if (props.request) await store.updateRequest(props.request.id, payload)
    else await store.createRequest(payload)
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
    :title="isEdit ? 'Редактировать заявку' : 'Новая заявка от поставщика'"
    subtitle="Товар, который партнёр предлагает продать в рассрочку"
    icon="mdi-clipboard-text-outline"
    :max-width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="form-field">
      <label class="field-label">Поставщик <span class="required">*</span></label>
      <select v-model="supplierId" :disabled="isEdit" class="field-input field-select">
        <option value="" disabled>Выберите поставщика</option>
        <option v-for="s in ownedSuppliers" :key="s.id" :value="s.id">{{ s.city ? `${s.name} · ${s.city}` : s.name }}</option>
      </select>
    </div>

    <div class="form-field">
      <label class="field-label">Товар <span class="required">*</span></label>
      <input v-model="productName" type="text" class="field-input" placeholder="Что предлагает продать" />
    </div>

    <div class="form-row-2">
      <div class="form-field">
        <label class="field-label">Категория</label>
        <select v-model="category" class="field-input field-select">
          <option value="">Не выбрана</option>
          <option v-for="c in CATEGORIES" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
      </div>
      <div class="form-field">
        <label class="field-label">Город</label>
        <select v-model="city" class="field-input field-select">
          <option value="">Не выбран</option>
          <option v-for="c in cityItems" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
    </div>

    <div class="form-field">
      <label class="field-label">Ожидаемая закупочная цена</label>
      <div class="input-suffix-wrap">
        <input v-model="priceInput" v-maska="CURRENCY_MASK" inputmode="numeric" class="field-input" placeholder="0" />
        <span class="input-suffix">₽</span>
      </div>
    </div>

    <div class="form-field">
      <label class="field-label">Клиент</label>
      <ClientPicker
        ref="clientPickerRef"
        v-model="clientProfileId"
        label="Поиск клиента по телефону или имени…"
        class="mb-2"
      />
      <button type="button" class="srf-add-client" @click="showCreateClient = true">
        <v-icon icon="mdi-account-plus-outline" size="18" /> Создать нового клиента
      </button>
    </div>

    <div class="form-field">
      <label class="field-label">Комментарий</label>
      <textarea v-model="comment" class="field-input field-textarea" rows="2" placeholder="Условия, детали…"></textarea>
    </div>

    <div v-if="error" class="text-error text-body-2">{{ error }}</div>

    <CreateClientDialog v-model="showCreateClient" @created="onClientCreated" />

    <template #footer>
      <v-btn variant="text" @click="emit('update:modelValue', false)">Отмена</v-btn>
      <v-btn color="primary" variant="flat" rounded="lg" :loading="saving" @click="save">
        {{ isEdit ? 'Сохранить' : 'Создать заявку' }}
      </v-btn>
    </template>
  </FormModal>
</template>

<style scoped>
.srf-add-client { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 0; border: none; background: none; font-size: 13px; font-weight: 600; color: #047857; cursor: pointer; }
.srf-add-client:hover { text-decoration: underline; }
</style>
