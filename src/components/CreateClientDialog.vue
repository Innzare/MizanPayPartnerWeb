<script setup lang="ts">
/**
 * Окно клиента: создание и правка.
 *
 * Форма одна на оба случая — поля, порядок и подписи у нового клиента и у
 * существующего совпадают, а две копии неизбежно разъезжались бы. Режим
 * определяется пропом `profile`: пусто — создаём, передан — правим.
 */
import { useClientProfilesStore } from '@/stores/clientProfiles'
import CityInput from '@/components/CityInput.vue'
import PhoneListField, { type PhoneDraft } from '@/components/PhoneListField.vue'
import { api } from '@/api/client'
import DateField from '@/components/DateField.vue'
import { useClientCities } from '@/composables/useClientCities'
import type { ClientProfile } from '@/types'
import { useToast } from '@/composables/useToast'
import { useIsMobile } from '@/composables/useIsMobile'

const props = defineProps<{
  modelValue: boolean
  /** Профиль для правки. Пусто — окно создаёт нового клиента. */
  profile?: ClientProfile | null
}>()

const emit = defineEmits<{
  'update:modelValue': [val: boolean]
  'created': [profile: ClientProfile]
  /** Профиль сохранён — владелец окна перечитывает карточку. */
  'saved': [profile: ClientProfile]
}>()

const store = useClientProfilesStore()
const toast = useToast()
const { refresh: refreshCities } = useClientCities()
const { isMobile } = useIsMobile()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const isEdit = computed(() => !!props.profile)

const saving = ref(false)
const form = ref(emptyForm())
/**
 * Дополнительные номера — здесь же, а не в карточке созданного клиента.
 * Заполняют их в один заход с основным: «жена, работа, сосед» вспоминают
 * ровно в тот момент, когда записывают человека.
 */
const extraPhones = ref<PhoneDraft[]>([])
/** Номера, какими они лежат на сервере, — чтобы вычислить правки. */
const originalPhones = ref<PhoneDraft[]>([])

function emptyForm() {
  return {
    phone: '', firstName: '', lastName: '', patronymic: '',
    birthDate: '', passportSeries: '', passportNumber: '',
    passportIssuedBy: '', passportIssuedAt: '',
    city: '', registrationAddress: '', residentialAddress: '',
  }
}

function formFromProfile(p: ClientProfile) {
  return {
    phone: p.phone || '',
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    patronymic: p.patronymic || '',
    birthDate: p.birthDate || '',
    passportSeries: p.passportSeries || '',
    passportNumber: p.passportNumber || '',
    passportIssuedBy: p.passportIssuedBy || '',
    passportIssuedAt: p.passportIssuedAt || '',
    city: p.city || '',
    registrationAddress: p.registrationAddress || '',
    residentialAddress: p.residentialAddress || '',
  }
}

// Каждое открытие начинается с актуальных данных: иначе в окно протекает
// предыдущий клиент. `immediate` обязателен: окно может быть смонтировано уже
// открытым, и тогда наблюдатель сам по себе не сработает — форма осталась бы
// пустой при живом профиле.
watch(show, (v) => {
  if (!v) return
  const p = props.profile
  if (p) {
    form.value = formFromProfile(p)
    const saved = (p.extraPhones ?? []).map((x) => ({
      id: x.id,
      phone: x.phone,
      label: x.label ?? '',
      hasWhatsapp: !!x.hasWhatsapp,
    }))
    originalPhones.value = saved.map((x) => ({ ...x }))
    extraPhones.value = saved.map((x) => ({ ...x }))
  } else {
    form.value = emptyForm()
    originalPhones.value = []
    extraPhones.value = []
  }
}, { immediate: true })

const canSave = computed(() =>
  form.value.phone.trim() && form.value.firstName.trim() && form.value.lastName.trim()
)

/** Поля профиля в том виде, в каком их ждёт сервер. */
function payload() {
  const f = form.value
  return {
    phone: f.phone,
    firstName: f.firstName,
    lastName: f.lastName,
    patronymic: f.patronymic || undefined,
    birthDate: f.birthDate || undefined,
    passportSeries: f.passportSeries || undefined,
    passportNumber: f.passportNumber || undefined,
    passportIssuedBy: f.passportIssuedBy || undefined,
    passportIssuedAt: f.passportIssuedAt || undefined,
    city: f.city || undefined,
    registrationAddress: f.registrationAddress || undefined,
    residentialAddress: f.residentialAddress || undefined,
  }
}

/**
 * Разложить правку списка номеров на операции сервера.
 *
 * Порядок важен: сначала удаления, потом правки, потом добавления — иначе
 * перестановка двух номеров упирается в проверку «такой номер уже записан».
 * Сбой на одном номере не отменяет сохранённый профиль.
 */
async function saveExtraPhones(profileId: string) {
  const kept = extraPhones.value.filter((p) => p.phone.trim())
  const keptIds = new Set(kept.map((p) => p.id).filter(Boolean))
  const failed: string[] = []

  for (const was of originalPhones.value) {
    if (was.id && !keptIds.has(was.id)) {
      try {
        await api.delete(`/client-profiles/${profileId}/phones/${was.id}`)
      } catch {
        failed.push(was.phone)
      }
    }
  }

  for (const row of kept) {
    const body = {
      phone: row.phone,
      label: row.label.trim() || null,
      hasWhatsapp: !!row.hasWhatsapp,
    }
    const was = row.id ? originalPhones.value.find((p) => p.id === row.id) : null
    try {
      if (!row.id) {
        await api.post(`/client-profiles/${profileId}/phones`, body)
      } else if (
        was &&
        (was.phone !== row.phone || (was.label || '') !== row.label.trim() || !!was.hasWhatsapp !== !!row.hasWhatsapp)
      ) {
        await api.patch(`/client-profiles/${profileId}/phones/${row.id}`, body)
      }
    } catch {
      failed.push(row.phone)
    }
  }

  if (failed.length) toast.warning(`Не удалось сохранить номера: ${failed.join(', ')}`)
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    if (isEdit.value) {
      const id = props.profile!.id
      const updated = await store.update(id, payload())
      // Номера сохраняем ПОСЛЕ профиля: если основной номер поменялся местами
      // с дополнительным, сервер справедливо не даст записать прежний
      // основной, пока он ещё числится основным в профиле.
      await saveExtraPhones(id)
      if (form.value.city) void refreshCities()
      emit('saved', updated)
      show.value = false
      toast.success('Профиль обновлён')
      return
    }

    const profile = await store.create(payload())
    // Номера заводим после клиента: до создания профиля их не к чему привязать.
    const failed: string[] = []
    for (const extra of extraPhones.value) {
      if (!extra.phone.trim()) continue
      try {
        await api.post(`/client-profiles/${profile.id}/phones`, {
          phone: extra.phone,
          label: extra.label.trim() || null,
          hasWhatsapp: !!extra.hasWhatsapp,
        })
      } catch {
        failed.push(extra.phone)
      }
    }
    if (failed.length) toast.warning(`Не удалось сохранить номера: ${failed.join(', ')}`)

    emit('created', profile)
    // Новый город должен сразу попасть в подсказки и фильтр.
    if (form.value.city) void refreshCities()
    show.value = false
    toast.success('Клиент создан')
  } catch (e: any) {
    toast.error(e.message || (isEdit.value ? 'Ошибка сохранения' : 'Ошибка создания клиента'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="show" max-width="600" scrollable persistent :fullscreen="isMobile">
    <v-card rounded="lg">
      <v-card-title class="d-flex align-center justify-space-between pa-5 pb-3">
        <span class="text-h6">{{ isEdit ? 'Данные клиента' : 'Новый клиент' }}</span>
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
        <div class="form-field">
          <label class="field-label">Отчество</label>
          <input v-model="form.patronymic" type="text" class="field-input" placeholder="Сергеевич" />
        </div>

        <!-- Телефоны вместе: основной и «как ещё дозвониться». Раньше вторые
             номера заводили уже в карточке созданного клиента — форму
             сохраняли, искали человека и возвращались дописывать. -->
        <PhoneListField
          v-model:primary="form.phone"
          v-model:extras="extraPhones"
        />
        <div class="form-field">
          <label class="field-label">Дата рождения</label>
          <DateField v-model="form.birthDate" open-to="year" :presets="false" plain />
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
          <DateField v-model="form.passportIssuedAt" plain />
        </div>

        <div class="form-section-label mt-5">Адреса</div>
        <!-- Город отдельным полем: по нему фильтруют списки, а внутри строки
             адреса его пишут кто во что горазд. -->
        <div class="form-field">
          <label class="field-label">Город</label>
          <CityInput v-model="form.city" />
        </div>
        <div class="form-field">
          <label class="field-label">Адрес прописки</label>
          <input v-model="form.registrationAddress" type="text" class="field-input" placeholder="г. Москва, ул. Ленина 1, кв 5" />
        </div>
        <div class="form-field">
          <label class="field-label">Адрес проживания</label>
          <input v-model="form.residentialAddress" type="text" class="field-input" placeholder="г. Москва, ул. Тверская 10, кв 20" />
        </div>
      </v-card-text>
      <v-divider />
      <div class="d-flex justify-end ga-2 pa-4">
        <v-btn variant="text" @click="show = false">Отмена</v-btn>
        <v-btn color="primary" variant="flat" :loading="saving" :disabled="!canSave" @click="save">
          {{ isEdit ? 'Сохранить' : 'Создать клиента' }}
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
