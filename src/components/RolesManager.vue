<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import type {
  PermissionRegistry,
  PermissionDef,
  PermissionSection,
  StaffRoleTemplate,
  RolePreset,
} from '@/types'

const toast = useToast()

const loading = ref(true)
const saving = ref(false)
const registry = ref<PermissionRegistry>({ sections: [], presets: [], grantable: null })

/**
 * Чем распоряжается тот, кто сейчас правит роль.
 *
 * null — владелец: доступно всё. Сотрудник видит чужие права, но не трогает
 * их: выдать коллеге то, чего лишён сам, он не может, а снять — тем более,
 * иначе обходил бы собственное ограничение чужими руками. Сервер проверяет
 * то же самое; здесь — чтобы человек видел причину, а не терял правку молча.
 */
const grantable = computed(() => (registry.value.grantable ? new Set(registry.value.grantable) : null))
function canEditPerm(key: string): boolean {
  return !grantable.value || grantable.value.has(key)
}
const roles = ref<StaffRoleTemplate[]>([])

interface Draft { id: string | null; name: string; isSystem: boolean; staffCount: number; perms: Set<string> }
const draft = ref<Draft | null>(null)
const expanded = ref<Set<string>>(new Set())
const nameInput = ref<HTMLInputElement | null>(null)
const showCancelConfirm = ref(false)

const allKeys = computed(() => registry.value.sections.flatMap((s) => s.permissions.map((p) => p.key)))
const permCount = computed(() => draft.value?.perms.size ?? 0)
const dirty = ref(false)

onMounted(async () => {
  try {
    const [reg, list] = await Promise.all([
      api.get<PermissionRegistry>('/auth/investor/roles/registry'),
      api.get<StaffRoleTemplate[]>('/auth/investor/roles'),
    ])
    registry.value = reg
    roles.value = list
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить роли')
  } finally {
    loading.value = false
  }
})

function openDraft(d: Draft, expandSelected: boolean) {
  draft.value = d
  dirty.value = false
  expanded.value = new Set(
    expandSelected
      ? registry.value.sections.filter((s) => s.permissions.some((p) => d.perms.has(p.key))).map((s) => s.key)
      : [],
  )
}
function selectRole(r: StaffRoleTemplate) {
  openDraft({ id: r.id, name: r.name, isSystem: r.isSystem, staffCount: r.staffCount, perms: new Set(r.permissions) }, true)
}
async function newRole() {
  openDraft({ id: null, name: '', isSystem: false, staffCount: 0, perms: new Set() }, false)
  await nextTick()
  nameInput.value?.focus()
}
function applyPreset(preset: RolePreset) {
  if (!draft.value) return
  // Недоступные права берём из текущего состояния роли, а не из пресета:
  // иначе «быстрый старт» стал бы лазейкой мимо собственных ограничений.
  const current = draft.value.perms
  draft.value.perms = grantable.value
    ? new Set([
        ...preset.permissions.filter((k) => canEditPerm(k)),
        ...[...current].filter((k) => !canEditPerm(k)),
      ])
    : new Set(preset.permissions)
  dirty.value = true
  expanded.value = new Set(
    registry.value.sections.filter((s) => s.permissions.some((p) => draft.value!.perms.has(p.key))).map((s) => s.key),
  )
}

// ── чекбоксы (зеркалит серверный normalizePermissions) ──
function hasPerm(key: string): boolean {
  return !!draft.value?.perms.has(key)
}
function sectionKeys(sectionKey: string): string[] {
  const sec = registry.value.sections.find((s) => s.key === sectionKey)
  return sec ? sec.permissions.map((p) => p.key) : []
}
/**
 * Включение/выключение права — зеркалит серверный normalizePermissions.
 *
 * Считаем по префиксу ключа, а не по секции: секция — это раскладка окна
 * («Что видно внутри сделки» — отдельная карточка, но права там всё те же
 * `deals.*`). Если считать по секции, интерфейс добавлял бы ключ вида
 * `dealCard.view`, которого не существует, и показывал бы состояние, которое
 * сервер потом выбросит.
 */
function viewKeyFor(key: string): string {
  return `${key.split('.')[0]}.view`
}
function togglePerm(_sectionKey: string, key: string) {
  if (!draft.value || !canEditPerm(key)) return
  const perms = draft.value.perms
  const viewKey = viewKeyFor(key)
  if (perms.has(key)) {
    perms.delete(key)
    // Сняли «доступ к области» — снимаем и всё, что без него бессмысленно,
    // где бы эти права ни показывались.
    if (key === viewKey) {
      for (const k of allKeys.value) if (viewKeyFor(k) === viewKey && canEditPerm(k)) perms.delete(k)
    }
  } else {
    perms.add(key)
    if (key !== viewKey && allKeys.value.includes(viewKey)) perms.add(viewKey)
  }
  dirty.value = true
}
/** Секции, разложенные по группам реестра (порядок групп — как в реестре). */
interface SectionGroup { title: string; sections: PermissionSection[] }
const groupedSections = computed<SectionGroup[]>(() => {
  const out: SectionGroup[] = []
  for (const sec of registry.value.sections) {
    const title = sec.group ?? ''
    const last = out[out.length - 1]
    if (last && last.title === title) last.sections.push(sec)
    else out.push({ title, sections: [sec] })
  }
  return out
})
/**
 * Права секции, разложенные по подблокам («Оформление», «Необратимое»…).
 *
 * Полтора десятка одинаковых чекбоксов подряд человек читает перебором —
 * подзаголовок и линия дают глазу, за что зацепиться. У коротких секций блоков
 * в реестре нет: там делить нечего, и заголовок только мешал бы.
 */
interface PermBlock { title: string; permissions: PermissionDef[] }
function blocksOf(sec: PermissionSection): PermBlock[] {
  const out: PermBlock[] = []
  for (const p of sec.permissions) {
    const title = p.block ?? ''
    const last = out[out.length - 1]
    if (last && last.title === title) last.permissions.push(p)
    else out.push({ title, permissions: [p] })
  }
  return out
}
function blockOnCount(b: PermBlock): number {
  return b.permissions.filter((p) => hasPerm(p.key)).length
}
/** Включить/снять весь подблок разом. */
function toggleBlock(b: PermBlock) {
  if (!draft.value) return
  const perms = draft.value.perms
  const allOn = blockOnCount(b) === b.permissions.length
  for (const p of b.permissions) {
    if (allOn) {
      perms.delete(p.key)
    } else {
      perms.add(p.key)
      const viewKey = viewKeyFor(p.key)
      if (p.key !== viewKey && allKeys.value.includes(viewKey)) perms.add(viewKey)
    }
  }
  dirty.value = true
}

function groupTotal(g: SectionGroup): number {
  return g.sections.reduce((n, s) => n + s.permissions.length, 0)
}
function groupOnCount(g: SectionGroup): number {
  return g.sections.reduce((n, s) => n + sectionOnCount(s.key), 0)
}

function sectionState(sectionKey: string): 'none' | 'partial' | 'all' {
  const keys = sectionKeys(sectionKey)
  const on = keys.filter((k) => hasPerm(k)).length
  return on === 0 ? 'none' : on === keys.length ? 'all' : 'partial'
}
function sectionOnCount(sectionKey: string): number {
  return sectionKeys(sectionKey).filter((k) => hasPerm(k)).length
}
function toggleSection(sectionKey: string) {
  if (!draft.value) return
  const keys = sectionKeys(sectionKey)
  const perms = draft.value.perms
  if (sectionState(sectionKey) === 'all') {
    for (const k of keys) perms.delete(k)
  } else {
    for (const k of keys) {
      perms.add(k)
      // Та же добавка «доступа к области», что и при отдельном чекбоксе:
      // иначе, включив всю секцию «Что видно внутри сделки», человек не
      // увидел бы галку на доступе к сделкам, а сервер бы её проставил.
      const viewKey = viewKeyFor(k)
      if (k !== viewKey && allKeys.value.includes(viewKey)) perms.add(viewKey)
    }
  }
  dirty.value = true
}
function toggleExpand(sectionKey: string) {
  if (expanded.value.has(sectionKey)) expanded.value.delete(sectionKey)
  else expanded.value.add(sectionKey)
}
function selectAll() {
  if (!draft.value) return
  draft.value.perms = new Set(allKeys.value)
  dirty.value = true
}
function clearAll() {
  if (!draft.value) return
  draft.value.perms = new Set()
  dirty.value = true
}

async function save() {
  if (!draft.value) return
  const name = draft.value.name.trim()
  if (!name) { toast.error('Укажите название роли'); nameInput.value?.focus(); return }
  saving.value = true
  try {
    const body = { name, permissions: [...draft.value.perms] }
    if (draft.value.id) {
      const updated = await api.patch<StaffRoleTemplate>(`/auth/investor/roles/${draft.value.id}`, body)
      const idx = roles.value.findIndex((r) => r.id === updated.id)
      if (idx >= 0) roles.value[idx] = { ...updated, staffCount: roles.value[idx].staffCount }
      toast.success('Роль сохранена')
    } else {
      const created = await api.post<StaffRoleTemplate>('/auth/investor/roles', body)
      roles.value.push({ ...created, staffCount: 0 })
      selectRole({ ...created, staffCount: 0 })
      toast.success('Роль создана')
    }
    dirty.value = false
  } catch (e: any) {
    toast.error(e.message || 'Не удалось сохранить роль')
  } finally {
    saving.value = false
  }
}

// Отмена создания новой роли: если что-то введено — спросить подтверждение.
function cancelCreate() {
  if (!draft.value) return
  const hasContent = draft.value.name.trim().length > 0 || draft.value.perms.size > 0
  if (hasContent) { showCancelConfirm.value = true; return }
  draft.value = null
}
function confirmCancel() {
  draft.value = null
  showCancelConfirm.value = false
}

async function removeRole() {
  if (!draft.value?.id) return
  if (!confirm(`Удалить роль «${draft.value.name}»?`)) return
  saving.value = true
  try {
    await api.delete(`/auth/investor/roles/${draft.value.id}`)
    roles.value = roles.value.filter((r) => r.id !== draft.value!.id)
    draft.value = null
    toast.success('Роль удалена')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить роль')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="rm">
    <div v-if="loading" class="rm-loading"><v-progress-circular indeterminate color="#047857" /></div>

    <div v-else class="rm-grid">
      <!-- Список ролей -->
      <aside class="rm-list">
        <div class="rm-list-head">
          <span class="rm-list-title">Роли<span class="rm-list-count">{{ roles.length }}</span></span>
          <button class="btn-sm btn-sm--primary" @click="newRole"><v-icon icon="mdi-plus" size="15" /> Создать</button>
        </div>
        <!-- Черновик новой роли — появляется сразу, название обновляется вживую -->
        <div v-if="draft && !draft.id" class="rm-role rm-role--active rm-role--draft">
          <div class="rm-role-top">
            <span class="rm-role-name" :class="{ 'rm-role-name--placeholder': !draft.name.trim() }">
              {{ draft.name.trim() || 'Новая роль' }}
            </span>
            <span class="rm-badge rm-badge--draft">черновик</span>
          </div>
          <div class="rm-role-sub">
            <span><v-icon icon="mdi-key-outline" size="12" /> {{ permCount }}</span>
          </div>
        </div>
        <button
          v-for="r in roles"
          :key="r.id"
          class="rm-role"
          :class="{ 'rm-role--active': draft?.id === r.id }"
          @click="selectRole(r)"
        >
          <div class="rm-role-top">
            <span class="rm-role-name">{{ r.name }}</span>
            <span v-if="r.isSystem" class="rm-badge">пресет</span>
          </div>
          <div class="rm-role-sub">
            <span><v-icon icon="mdi-key-outline" size="12" /> {{ r.permissions.length }}</span>
            <span><v-icon icon="mdi-account-outline" size="12" /> {{ r.staffCount }}</span>
          </div>
        </button>
        <div v-if="!roles.length" class="rm-empty-list">Пока нет ролей</div>
      </aside>

      <!-- Редактор -->
      <section v-if="draft" class="rm-editor">
        <div class="rm-head">
          <div class="rm-field">
            <label class="field-label">Название роли</label>
            <input ref="nameInput" v-model="draft.name" class="field-input" placeholder="Например: Кассир" maxlength="60" />
          </div>
          <div class="rm-head-actions">
            <!-- Удаление только у кастомных ролей (пресеты удалять нельзя) -->
            <button
              v-if="draft.id && !draft.isSystem"
              class="rm-icon-btn rm-icon-btn--danger"
              :disabled="saving || draft.staffCount > 0"
              :title="draft.staffCount > 0 ? `Назначена ${draft.staffCount} сотр. — сначала переназначьте` : 'Удалить роль'"
              @click="removeRole"
            >
              <v-icon icon="mdi-trash-can-outline" size="18" />
            </button>
            <!-- Новая роль: Отменить + Сохранить -->
            <button v-if="!draft.id" class="btn-ghost rm-save" :disabled="saving" @click="cancelCreate">Отменить</button>
            <button class="btn-primary rm-save" :disabled="saving || (!!draft.id && !dirty)" @click="save">
              <v-progress-circular v-if="saving" indeterminate size="15" width="2" color="#fff" />
              <template v-else>Сохранить</template>
            </button>
          </div>
        </div>

        <!-- Роль без сотрудников легко принять за действующую: названия ролей
             совпадают со старыми, и правка «Менеджера» ни на кого не влияет. -->
        <div v-if="draft.id && draft.staffCount === 0" class="rm-unused">
          <v-icon icon="mdi-alert-outline" size="15" />
          <span>Роль никому не назначена — изменения прав ни на кого не подействуют. Назначьте её сотруднику в окне «Доступы и роль».</span>
        </div>

        <!-- Быстрый старт из пресета -->
        <div v-if="registry.presets.length" class="rm-presets">
          <span class="rm-presets-label">Быстрый старт:</span>
          <button v-for="p in registry.presets" :key="p.key" class="rm-chip" @click="applyPreset(p)">{{ p.name }}</button>
        </div>

        <!-- Панель: счётчик + массовые действия -->
        <div class="rm-toolbar">
          <div class="rm-summary">
            Выбрано <b>{{ permCount }}</b> из {{ allKeys.length }}
          </div>
          <div class="rm-bulk">
            <button class="btn-text" @click="selectAll">Выбрать все</button>
            <span class="rm-sep">·</span>
            <button class="btn-text btn-text--muted" @click="clearAll">Снять все</button>
          </div>
        </div>

        <!-- Секции, разложенные по смысловым группам: полтора десятка
             одинаковых плашек подряд читались как сплошная стена. -->
        <div v-for="g in groupedSections" :key="g.title || 'no-group'" class="rm-group">
          <div v-if="g.title" class="rm-group-head">
            <span class="rm-group-title">{{ g.title }}</span>
            <span class="rm-group-count">{{ groupOnCount(g) }}/{{ groupTotal(g) }}</span>
          </div>
          <div class="rm-sections">
            <div
              v-for="sec in g.sections"
              :key="sec.key"
              class="rm-section"
              :class="{
                'rm-section--on': sectionState(sec.key) !== 'none',
                'rm-section--open': expanded.has(sec.key),
              }"
            >
            <div class="rm-section-head">
              <!-- Мастер-чекбокс секции (tri-state) -->
              <button
                class="rm-check rm-check--lg"
                :class="{ 'rm-check--on': sectionState(sec.key) === 'all', 'rm-check--partial': sectionState(sec.key) === 'partial' }"
                @click.stop="toggleSection(sec.key)"
                :title="sectionState(sec.key) === 'all' ? 'Снять всю секцию' : 'Выбрать всю секцию'"
              >
                <v-icon v-if="sectionState(sec.key) === 'all'" icon="mdi-check" size="14" />
                <v-icon v-else-if="sectionState(sec.key) === 'partial'" icon="mdi-minus" size="14" />
              </button>
              <button class="rm-section-main" @click="toggleExpand(sec.key)">
                <span class="rm-section-title">{{ sec.label }}</span>
                <span class="rm-section-count" :class="{ 'rm-section-count--on': sectionOnCount(sec.key) > 0 }">
                  {{ sectionOnCount(sec.key) }}/{{ sec.permissions.length }}
                </span>
                <v-icon icon="mdi-chevron-down" size="20" class="rm-chevron" :class="{ 'rm-chevron--open': expanded.has(sec.key) }" />
              </button>
            </div>
            <div v-show="expanded.has(sec.key)" class="rm-blocks">
              <!-- Внутри раздела права разложены по смыслу: доступ, обычная
                   работа, необратимое, показатели. -->
              <div v-for="(b, bi) in blocksOf(sec)" :key="b.title || bi" class="rm-block">
                <button
                  v-if="b.title"
                  class="rm-block-head"
                  :class="{ 'rm-block-head--on': blockOnCount(b) > 0 }"
                  :title="blockOnCount(b) === b.permissions.length ? 'Снять всё в блоке' : 'Выбрать всё в блоке'"
                  @click="toggleBlock(b)"
                >
                  <span class="rm-block-mark" />
                  <span class="rm-block-title">{{ b.title }}</span>
                  <span class="rm-block-count" :class="{ 'rm-block-count--on': blockOnCount(b) > 0 }">
                    {{ blockOnCount(b) }}/{{ b.permissions.length }}
                  </span>
                </button>
                <div class="rm-perms">
                  <label
                    v-for="p in b.permissions"
                    :key="p.key"
                    class="rm-perm"
                    :class="{ 'rm-perm--on': hasPerm(p.key), 'rm-perm--locked': !canEditPerm(p.key) }"
                    :title="canEditPerm(p.key) ? '' : 'Это право не выдано вам самим — менять его может только владелец'"
                    @click.prevent="togglePerm(sec.key, p.key)"
                  >
                    <span class="rm-check" :class="{ 'rm-check--on': hasPerm(p.key) }">
                      <v-icon v-if="hasPerm(p.key)" icon="mdi-check" size="13" />
                    </span>
                    <!-- Пояснение там, где цена ошибки выше обычной: реестр даёт
                         его не всем правам, и раньше оно просто терялось. -->
                    <span class="rm-perm-text">
                      <span class="rm-perm-label">
                        {{ p.label }}
                        <v-icon v-if="!canEditPerm(p.key)" icon="mdi-lock-outline" size="12" class="rm-perm-lock" />
                      </span>
                      <span v-if="p.hint" class="rm-perm-hint">{{ p.hint }}</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Пустой редактор -->
      <section v-else class="rm-editor rm-editor--empty">
        <v-icon icon="mdi-shield-key-outline" size="52" class="rm-empty-icon" />
        <p class="rm-empty-title">Управление ролями</p>
        <p class="rm-empty-sub">Выберите роль слева, чтобы изменить права, или создайте новую.</p>
        <button class="btn-primary" @click="newRole"><v-icon icon="mdi-plus" size="18" /> Создать роль</button>
      </section>
    </div>

    <!-- Подтверждение отмены создания роли -->
    <v-dialog v-model="showCancelConfirm" max-width="380">
      <div class="rm-confirm">
        <div class="rm-confirm-icon"><v-icon icon="mdi-alert-outline" size="26" color="#f59e0b" /></div>
        <div class="rm-confirm-title">Отменить создание роли?</div>
        <div class="rm-confirm-text">Введённые данные не будут сохранены.</div>
        <div class="rm-confirm-actions">
          <button class="btn-ghost" @click="showCancelConfirm = false">Продолжить</button>
          <button class="btn-danger" @click="confirmCancel">Отменить создание</button>
        </div>
      </div>
    </v-dialog>
  </div>
</template>

<style scoped>
.rm { width: 100%; }
.rm-loading { display: flex; justify-content: center; align-items: center; min-height: 320px; }
.rm-grid { display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start; }

/* Список */
.rm-list { display: flex; flex-direction: column; gap: 8px; }
.rm-list-head { display: flex; align-items: center; justify-content: space-between; padding: 0 2px 4px; }
.rm-list-title { font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.7); display: flex; align-items: center; gap: 8px; }
.rm-list-count {
  font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 20px;
  background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.5);
}
.rm-role {
  text-align: left; padding: 12px 14px; border-radius: 12px; cursor: pointer; color: inherit;
  background: rgba(var(--v-theme-surface), 1);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  transition: border-color .15s, background .15s;
}
.rm-role:hover { border-color: rgba(var(--v-theme-on-surface), 0.2); }
.rm-role--active { border-color: #047857; background: rgba(4, 120, 87, 0.05); }
.rm-role-top { display: flex; align-items: center; gap: 8px; }
.rm-role-name { font-weight: 600; font-size: 14px; }
.rm-badge {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 6px; border-radius: 6px; background: rgba(4, 120, 87, 0.1); color: #047857;
}
.rm-role-sub { display: flex; gap: 12px; font-size: 12px; opacity: 0.55; margin-top: 5px; }
.rm-role-sub span { display: inline-flex; align-items: center; gap: 3px; }
.rm-empty-list { padding: 24px; text-align: center; opacity: 0.5; font-size: 13px; }

/* Редактор */
.rm-editor {
  background: rgba(var(--v-theme-surface), 1);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 16px; padding: 22px;
}
.rm-editor--empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 340px; text-align: center; }
.rm-empty-icon { opacity: 0.3; margin-bottom: 6px; }
.rm-empty-title { font-size: 16px; font-weight: 700; margin: 0; }
.rm-empty-sub { font-size: 13px; opacity: 0.55; margin: 0 0 14px; max-width: 280px; }

.rm-head { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 18px; }
.rm-field { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.6); }
.field-input {
  width: 100%; height: 44px; padding: 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); border-radius: 10px;
  font-size: 14px; color: inherit; background: rgba(var(--v-theme-on-surface), 0.03);
  outline: none; transition: all 0.15s;
}
.field-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.3); }
.field-input:focus { border-color: #047857; box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent); }
.rm-head-actions { display: flex; align-items: center; gap: 8px; }
.rm-save { height: 44px; }
.rm-icon-btn {
  width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: transparent; color: inherit;
  transition: all .15s;
}
.rm-icon-btn--danger { color: #ef4444; }
.rm-icon-btn--danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); }
.rm-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px; padding: 0 22px; border-radius: 10px; border: none;
  background: #047857; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #065f46; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm {
  display: inline-flex; align-items: center; gap: 4px; padding: 7px 12px; border-radius: 8px; border: none;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.btn-sm--primary { background: #047857; color: #fff; }
.btn-sm--primary:hover { background: #065f46; }
.btn-ghost {
  display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0 20px;
  border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.14); background: transparent;
  color: inherit; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.btn-ghost:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.05); }
.btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-danger {
  display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0 18px;
  border-radius: 10px; border: none; background: #ef4444; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.btn-danger:hover { background: #dc2626; }

/* Черновик в списке */
.rm-role--draft { cursor: default; border-style: dashed; }
.rm-role-name--placeholder { opacity: 0.45; font-style: italic; }
.rm-badge--draft { background: rgba(245, 158, 11, 0.12); color: #b45309; }

/* Диалог подтверждения */
.rm-confirm {
  background: rgba(var(--v-theme-surface), 1); border-radius: 16px; padding: 24px; text-align: center;
}
.rm-confirm-icon {
  width: 52px; height: 52px; border-radius: 50%; background: rgba(245, 158, 11, 0.12);
  display: flex; align-items: center; justify-content: center; margin: 0 auto 14px;
}
.rm-confirm-title { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
.rm-confirm-text { font-size: 13.5px; opacity: 0.6; margin-bottom: 20px; }
.rm-confirm-actions { display: flex; gap: 10px; }
.rm-confirm-actions > * { flex: 1; }
.btn-text {
  display: inline-flex; align-items: center; gap: 4px; border: none; background: none; padding: 4px 8px; border-radius: 6px;
  font-size: 13px; font-weight: 600; color: #047857; cursor: pointer; transition: all 0.15s;
}
.btn-text:hover { background: rgba(4, 120, 87, 0.08); }
.btn-text--muted { color: rgba(var(--v-theme-on-surface), 0.5); }
.btn-text--muted:hover { background: rgba(var(--v-theme-on-surface), 0.06); }

/* Роль без назначенных сотрудников */
.rm-unused {
  display: flex; align-items: flex-start; gap: 8px; margin-bottom: 14px;
  padding: 10px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.45;
  background: rgba(245, 158, 11, 0.09); border: 1px solid rgba(245, 158, 11, 0.26); color: #92400e;
}

/* Пресеты */
.rm-presets { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.rm-presets-label { font-size: 12px; opacity: 0.5; }
.rm-chip {
  font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 20px; cursor: pointer;
  background: rgba(4, 120, 87, 0.08); color: #047857; border: 1px solid transparent; transition: all .15s;
}
.rm-chip:hover { background: rgba(4, 120, 87, 0.15); }

/* Тулбар */
.rm-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 0 14px; margin-bottom: 6px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.rm-summary { font-size: 13px; opacity: 0.7; }
.rm-summary b { color: #047857; }
.rm-bulk { display: flex; align-items: center; gap: 2px; }
.rm-sep { opacity: 0.3; }

/* Секции */
/* Смысловая группа секций */
.rm-group + .rm-group { margin-top: 20px; }
.rm-group-head {
  display: flex; align-items: baseline; gap: 8px; margin: 0 2px 8px;
}
.rm-group-title {
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  opacity: 0.55;
}
.rm-group-count { font-size: 11px; opacity: 0.4; }

.rm-sections { display: flex; flex-direction: column; gap: 8px; }
.rm-section { border: 1px solid rgba(var(--v-theme-on-surface), 0.08); border-radius: 12px; overflow: hidden; transition: border-color .15s; }
.rm-section--on { border-color: rgba(4, 120, 87, 0.25); }
/* Шапка раздела: своя подложка и отбивка снизу — у раскрытого раздела внутри
   ещё свои заголовки, и без этого шапка терялась среди них. */
.rm-section-head {
  display: flex; align-items: center; gap: 10px; padding: 4px 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.rm-section--open .rm-section-head { border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
.rm-section--on .rm-section-head { background: rgba(4, 120, 87, 0.035); }
.rm-section-main {
  flex: 1; display: flex; align-items: center; gap: 10px; padding: 11px 0;
  background: none; border: none; cursor: pointer; color: inherit; text-align: left;
}
.rm-section-title { font-weight: 700; font-size: 14.5px; flex: 1; letter-spacing: -0.01em; }
.rm-section-count {
  font-size: 12px; opacity: 0.45; font-variant-numeric: tabular-nums;
  padding: 1px 8px; border-radius: 20px;
}
.rm-section-count--on { background: rgba(4, 120, 87, 0.1); color: #047857; opacity: 1; }
.rm-chevron { opacity: 0.4; transition: transform .18s; }
.rm-chevron--open { transform: rotate(180deg); }

/* Подблоки внутри секции.
   Заголовок блока намеренно не похож на шапку раздела: у раздела — крупное
   название с чекбоксом и «галочкой» раскрытия, у блока — плашка с отбивкой
   сверху и вертикальной меткой слева. Иначе внутри раскрытого раздела два
   одинаковых по весу заголовка спорили друг с другом. */
.rm-blocks { padding: 6px 10px 12px; }
.rm-block + .rm-block {
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.rm-block-head {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 7px 10px; margin-bottom: 2px; border: none; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.035); color: inherit;
  cursor: pointer; text-align: left; transition: background .12s;
}
/* Подложка блока всегда нейтральная: зелёным залита шапка раздела, и если
   красить блоки тем же цветом, два уровня заголовков сливаются. Состояние
   блока показывают метка слева и счётчик справа. */
.rm-block-head:hover { background: rgba(var(--v-theme-on-surface), 0.07); }
.rm-block-mark {
  width: 3px; height: 13px; border-radius: 2px; flex: none;
  background: rgba(var(--v-theme-on-surface), 0.25); transition: background .12s;
}
.rm-block-head--on .rm-block-mark { background: #047857; }
.rm-block-head:hover .rm-block-mark { background: #047857; }
.rm-block-title {
  flex: 1; font-size: 11.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  opacity: 0.72;
}
.rm-block-head--on .rm-block-title { opacity: 0.85; }
.rm-block-count { font-size: 11px; opacity: 0.4; font-variant-numeric: tabular-nums; }
.rm-block-count--on { opacity: 1; color: #047857; font-weight: 600; }

.rm-perms {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 2px;
}
.rm-perm { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; transition: background .12s; }
.rm-perm:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
/* Право, которого нет у самого редактора: видно, но не трогается. */
.rm-perm--locked { cursor: not-allowed; opacity: 0.45; }
.rm-perm--locked:hover { background: transparent; }
.rm-perm-lock { opacity: 0.7; margin-left: 3px; vertical-align: baseline; }
.rm-perm-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rm-perm-label { font-size: 13px; line-height: 20px; }
.rm-perm--on .rm-perm-label { font-weight: 500; }
.rm-perm-hint { font-size: 11.5px; line-height: 1.35; opacity: 0.55; }

.rm-check {
  width: 20px; height: 20px; min-width: 20px; border-radius: 6px;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.25);
  display: flex; align-items: center; justify-content: center; color: #fff; cursor: pointer;
  background: transparent; transition: background .12s, border-color .12s;
}
.rm-check--lg { width: 24px; height: 24px; min-width: 24px; }
.rm-check--on { background: #047857; border-color: #047857; }
.rm-check--partial { background: rgba(4, 120, 87, 0.5); border-color: #047857; }

@media (max-width: 800px) { .rm-grid { grid-template-columns: 1fr; } }
</style>
