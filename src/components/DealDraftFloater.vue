<script lang="ts" setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useDealDraft } from '@/composables/useDealDraft'
import { formatCurrency } from '@/utils/formatters'

/**
 * Floating reminder that the partner has an unfinished deal draft. Shows
 * on every authenticated page EXCEPT the wizard itself (the wizard
 * already shows its own restored-draft banner). Two actions: open the
 * wizard to continue, or drop the draft.
 *
 * Rendering decision lives in the layout (`v-if="isAuthenticated"`), so
 * here we only worry about whether there's actually something to show.
 */

const authStore = useAuthStore()
const dealDraft = useDealDraft(authStore.user?.id ?? null)
const route = useRoute()
const router = useRouter()

const isOnWizard = computed(() => route.path === '/create-deal')
const visible = computed(() => dealDraft.hasDraft.value && !isOnWizard.value)

const summary = computed(() => {
  const d = dealDraft.draft.value
  if (!d) return { title: '', subtitle: '', priceLabel: '' }
  // Best-effort short headline. productName is the most informative
  // single field; client name comes second so an empty product still
  // shows something meaningful.
  const title =
    (d.productName && d.productName.trim()) ||
    (d.selectedClientProfile
      ? [d.selectedClientProfile.firstName, d.selectedClientProfile.lastName].filter(Boolean).join(' ')
      : '') ||
    'Без названия'
  const parts: string[] = []
  if (d.selectedClientProfile) {
    const name = [d.selectedClientProfile.firstName, d.selectedClientProfile.lastName].filter(Boolean).join(' ')
    if (name && name !== title) parts.push(name)
  }
  if (d.purchasePrice && d.purchasePrice > 0) parts.push(formatCurrency(d.purchasePrice))
  return {
    title,
    subtitle: parts.join(' · '),
    step: d.step,
  }
})

const updatedLabel = computed(() => {
  const d = dealDraft.draft.value
  if (!d) return ''
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(d.updatedAt).getTime()) / 60000))
  if (diffMin < 1) return 'только что'
  if (diffMin < 60) return `${diffMin} мин назад`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr} ч назад`
  const diffDay = Math.round(diffHr / 24)
  return `${diffDay} дн назад`
})

function open() {
  router.push('/create-deal')
}

function discard() {
  if (!confirm('Удалить незавершённый черновик сделки?')) return
  dealDraft.clear()
}
</script>

<template>
  <transition name="draft-floater">
    <div v-if="visible" class="draft-floater">
      <div class="draft-floater-icon">
        <v-icon icon="mdi-file-document-edit-outline" size="20" color="#0ea5e9" />
      </div>
      <div class="draft-floater-body">
        <div class="draft-floater-headline">Незаконченная сделка</div>
        <div class="draft-floater-title">{{ summary.title }}</div>
        <div v-if="summary.subtitle" class="draft-floater-sub">{{ summary.subtitle }}</div>
        <div class="draft-floater-meta">обновлено {{ updatedLabel }}</div>
      </div>
      <button class="draft-floater-close" title="Удалить черновик" @click="discard">
        <v-icon icon="mdi-close" size="14" />
      </button>
      <button class="draft-floater-continue" @click="open">
        Продолжить
        <v-icon icon="mdi-arrow-right" size="14" />
      </button>
    </div>
  </transition>
</template>

<style scoped>
.draft-floater {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1000;
  width: 320px;
  max-width: calc(100vw - 40px);
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto;
  align-items: start;
  gap: 10px 12px;
  padding: 14px 14px 12px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.04);
}
.draft-floater-icon {
  grid-row: 1 / span 2;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(14, 165, 233, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.draft-floater-body { min-width: 0; }
.draft-floater-headline {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgba(14, 165, 233, 0.95);
  margin-bottom: 2px;
}
.draft-floater-title {
  font-size: 14px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.92);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draft-floater-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draft-floater-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 4px;
}
.draft-floater-close {
  grid-row: 1;
  grid-column: 3;
  border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
}
.draft-floater-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.draft-floater-continue {
  grid-row: 2;
  grid-column: 2 / span 2;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: #0ea5e9;
  color: white;
  font-size: 13px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
}
.draft-floater-continue:hover { background: #0284c7; }

/* Slide-in / slide-out from the bottom right */
.draft-floater-enter-active,
.draft-floater-leave-active {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s;
}
.draft-floater-enter-from,
.draft-floater-leave-to {
  transform: translate(20px, 20px);
  opacity: 0;
}

@media (max-width: 560px) {
  .draft-floater {
    left: 12px;
    right: 12px;
    bottom: 12px;
    width: auto;
  }
}
</style>
