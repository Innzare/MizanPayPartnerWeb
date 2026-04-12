<script setup lang="ts">
import { useClientProfilesStore } from '@/stores/clientProfiles'
import type { ClientProfile } from '@/types'
import { useToast } from '@/composables/useToast'
import { PHONE_MASK } from '@/utils/formatters'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [val: boolean]
  'created': [profile: ClientProfile]
}>()

const store = useClientProfilesStore()
const toast = useToast()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const saving = ref(false)
const form = ref(emptyForm())

function emptyForm() {
  return {
    phone: '', firstName: '', lastName: '', patronymic: '',
    birthDate: '', passportSeries: '', passportNumber: '',
    passportIssuedBy: '', passportIssuedAt: '',
    registrationAddress: '', residentialAddress: '', inn: '',
  }
}

watch(show, (v) => {
  if (v) form.value = emptyForm()
})

const canSave = computed(() =>
  form.value.phone.trim() && form.value.firstName.trim() && form.value.lastName.trim()
)

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    const f = form.value
    const profile = await store.create({
      phone: f.phone,
      firstName: f.firstName,
      lastName: f.lastName,
      patronymic: f.patronymic || undefined,
      birthDate: f.birthDate || undefined,
      passportSeries: f.passportSeries || undefined,
      passportNumber: f.passportNumber || undefined,
      passportIssuedBy: f.passportIssuedBy || undefined,
      passportIssuedAt: f.passportIssuedAt || undefined,
      registrationAddress: f.registrationAddress || undefined,
      residentialAddress: f.residentialAddress || undefined,
      inn: f.inn || undefined,
    })
    emit('created', profile)
    show.value = false
    toast.success('Клиент создан')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка создания клиента')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="show" max-width="600" scrollable persistent>
    <v-card rounded="lg">
      <v-card-title class="d-flex align-center justify-space-between pa-5 pb-3">
        <span class="text-h6">Новый клиент</span>
        <v-btn icon variant="text" size="small" @click="show = false">
          <v-icon icon="mdi-close" />
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text style="max-height: 520px;">
        <div class="form-section-label">Основные данные</div>
        <div class="form-row-2">
          <div class="form-field">
            <label class="field-label">Фамилия <span class="required">*</span></label>
            <input v-model="form.lastName" type="text" class="field-input" placeholder="Иванов" />
          </div>
          <div class="form-field">
            <label class="field-label">Имя <span class="required">*</span></label>
            <input v-model="form.firstName" type="text" class="field-input" placeholder="Иван" />
          </div>
        </div>
        <div class="form-row-2">
          <div class="form-field">
            <label class="field-label">Отчество</label>
            <input v-model="form.patronymic" type="text" class="field-input" placeholder="Сергеевич" />
          </div>
          <div class="form-field">
            <label class="field-label">Телефон <span class="required">*</span></label>
            <input v-model="form.phone" v-maska="PHONE_MASK" type="tel" class="field-input" placeholder="+7 (___) ___-__-__" />
          </div>
        </div>
        <div class="form-field">
          <label class="field-label">Дата рождения</label>
          <input v-model="form.birthDate" type="date" class="field-input" />
        </div>

        <div class="form-section-label mt-5">Паспортные данные</div>
        <div class="form-row-2">
          <div class="form-field">
            <label class="field-label">Серия</label>
            <input v-model="form.passportSeries" type="text" class="field-input" placeholder="4510" maxlength="4" />
          </div>
          <div class="form-field">
            <label class="field-label">Номер</label>
            <input v-model="form.passportNumber" type="text" class="field-input" placeholder="123456" maxlength="6" />
          </div>
        </div>
        <div class="form-field">
          <label class="field-label">Кем выдан</label>
          <input v-model="form.passportIssuedBy" type="text" class="field-input" placeholder="ОВД г. Москвы" />
        </div>
        <div class="form-field">
          <label class="field-label">Когда выдан</label>
          <input v-model="form.passportIssuedAt" type="date" class="field-input" />
        </div>

        <div class="form-section-label mt-5">Адреса</div>
        <div class="form-field">
          <label class="field-label">Адрес прописки</label>
          <input v-model="form.registrationAddress" type="text" class="field-input" placeholder="г. Москва, ул. Ленина 1, кв 5" />
        </div>
        <div class="form-field">
          <label class="field-label">Адрес проживания</label>
          <input v-model="form.residentialAddress" type="text" class="field-input" placeholder="г. Москва, ул. Тверская 10, кв 20" />
        </div>
        <div class="form-field">
          <label class="field-label">ИНН</label>
          <input v-model="form.inn" type="text" class="field-input" placeholder="500100123456" maxlength="12" />
        </div>
      </v-card-text>
      <v-divider />
      <div class="d-flex justify-end ga-2 pa-4">
        <v-btn variant="text" @click="show = false">Отмена</v-btn>
        <v-btn color="primary" variant="flat" :loading="saving" :disabled="!canSave" @click="save">
          Создать клиента
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.form-section-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  text-transform: uppercase; margin-bottom: 12px;
}
.form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 480px) { .form-row-2 { grid-template-columns: 1fr; } }

.form-field { margin-bottom: 12px; }
.field-label {
  display: block; font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 4px;
}
.field-label .required { color: #ef4444; }
.field-input {
  width: 100%; height: 40px; padding: 0 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-surface), 1);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 14px; outline: none; transition: border-color 0.15s;
}
.field-input:focus { border-color: rgba(var(--v-theme-primary), 0.5); }
</style>