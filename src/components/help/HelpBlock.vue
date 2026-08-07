<script setup lang="ts">
import { computed } from 'vue'
import HelpRichText from './HelpRichText.vue'
import type { HelpBlock } from '@/types/help'

const props = defineProps<{ block: HelpBlock; highlight?: string }>()

const CALLOUT = {
  tip: { icon: 'mdi-lightbulb-on-outline', color: '#047857', label: 'Совет' },
  info: { icon: 'mdi-information-outline', color: '#3b82f6', label: 'Как это работает' },
  warning: { icon: 'mdi-alert-outline', color: '#f59e0b', label: 'Обратите внимание' },
  danger: { icon: 'mdi-alert-octagon-outline', color: '#ef4444', label: 'Действие необратимо' },
  plan: { icon: 'mdi-crown-outline', color: '#e8b931', label: 'Зависит от тарифа' },
} as const

const callout = computed(() =>
  props.block.kind === 'callout' ? CALLOUT[props.block.variant] : null,
)
</script>

<template>
  <p v-if="block.kind === 'p'" class="hb-p">
    <HelpRichText :text="block.text" :highlight="highlight" />
  </p>

  <ol v-else-if="block.kind === 'list' && block.ordered" class="hb-list hb-list--ol">
    <li v-for="(it, i) in block.items" :key="i">
      <HelpRichText :text="it" :highlight="highlight" />
    </li>
  </ol>

  <ul v-else-if="block.kind === 'list'" class="hb-list">
    <li v-for="(it, i) in block.items" :key="i">
      <HelpRichText :text="it" :highlight="highlight" />
    </li>
  </ul>

  <!-- Пошаговая инструкция: номер шага крупно, чтобы можно было выполнять
       по порядку, не теряя место. -->
  <div v-else-if="block.kind === 'steps'" class="hb-steps">
    <div v-for="(st, i) in block.items" :key="i" class="hb-step">
      <div class="hb-step-num">{{ i + 1 }}</div>
      <div class="hb-step-body">
        <div class="hb-step-title">
          <HelpRichText :text="st.title" :highlight="highlight" />
        </div>
        <div v-if="st.text" class="hb-step-text">
          <HelpRichText :text="st.text" :highlight="highlight" />
        </div>
      </div>
    </div>
  </div>

  <div
    v-else-if="block.kind === 'callout' && callout"
    class="hb-callout"
    :style="{ '--hb-c': callout.color }"
  >
    <v-icon :icon="callout.icon" size="19" />
    <div>
      <div class="hb-callout-title">{{ block.title || callout.label }}</div>
      <div class="hb-callout-text">
        <HelpRichText :text="block.text" :highlight="highlight" />
      </div>
    </div>
  </div>

  <div v-else-if="block.kind === 'table'" class="hb-table-wrap">
    <table class="hb-table">
      <thead>
        <tr><th v-for="h in block.headers" :key="h">{{ h }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in block.rows" :key="i">
          <td v-for="(c, j) in r" :key="j">
            <HelpRichText :text="c" :highlight="highlight" />
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="block.caption" class="hb-caption">{{ block.caption }}</div>
  </div>

  <div v-else-if="block.kind === 'faq'" class="hb-faq">
    <details v-for="(f, i) in block.items" :key="i" class="hb-faq-item">
      <summary class="hb-faq-q">
        <v-icon icon="mdi-chevron-right" size="18" class="hb-faq-chev" />
        <HelpRichText :text="f.q" :highlight="highlight" />
      </summary>
      <div class="hb-faq-a">
        <HelpRichText :text="f.a" :highlight="highlight" />
      </div>
    </details>
  </div>

  <div v-else-if="block.kind === 'links'" class="hb-links">
    <router-link v-for="l in block.items" :key="l.to" :to="l.to" class="hb-link-card">
      <v-icon :icon="l.icon || 'mdi-arrow-right-circle-outline'" size="20" />
      <div>
        <div class="hb-link-label">{{ l.label }}</div>
        <div v-if="l.desc" class="hb-link-desc">{{ l.desc }}</div>
      </div>
      <v-icon icon="mdi-chevron-right" size="18" class="hb-link-chev" />
    </router-link>
  </div>

  <div v-else-if="block.kind === 'divider'" class="hb-divider" />
</template>

<style scoped>
.hb-p {
  font-size: 14.5px;
  line-height: 1.7;
  color: rgba(var(--v-theme-on-surface), 0.78);
  margin: 0 0 12px;
}

.hb-list { margin: 0 0 14px; padding-left: 20px; }
.hb-list li {
  font-size: 14.5px;
  line-height: 1.65;
  color: rgba(var(--v-theme-on-surface), 0.78);
  margin-bottom: 7px;
}
.hb-list li::marker { color: rgba(var(--v-theme-on-surface), 0.35); }
.hb-list--ol li::marker { font-weight: 700; color: #047857; }

.hb-steps { margin: 4px 0 16px; }
.hb-step { display: flex; gap: 14px; padding-bottom: 16px; position: relative; }
/* Линия между шагами — видно, что это последовательность, а не просто список. */
.hb-step:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 13px; top: 30px; bottom: 2px;
  width: 2px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.hb-step-num {
  flex-shrink: 0;
  width: 28px; height: 28px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
  color: #047857;
  background: rgba(4, 120, 87, 0.1);
  position: relative; z-index: 1;
}
.hb-step-title {
  font-size: 14.5px; font-weight: 650;
  color: rgba(var(--v-theme-on-surface), 0.9);
  padding-top: 3px;
}
.hb-step-text {
  font-size: 14px; line-height: 1.6;
  color: rgba(var(--v-theme-on-surface), 0.62);
  margin-top: 3px;
}

.hb-callout {
  display: flex; gap: 11px;
  padding: 13px 15px;
  margin: 4px 0 16px;
  border-radius: 11px;
  border-left: 3px solid var(--hb-c);
  background: color-mix(in srgb, var(--hb-c) 8%, transparent);
}
.hb-callout :deep(.v-icon) { color: var(--hb-c); flex-shrink: 0; margin-top: 1px; }
.hb-callout-title {
  font-size: 13px; font-weight: 700;
  color: var(--hb-c);
  margin-bottom: 2px;
}
.hb-callout-text {
  font-size: 14px; line-height: 1.6;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.hb-table-wrap { margin: 4px 0 18px; overflow-x: auto; }
.hb-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.hb-table th {
  text-align: left;
  padding: 9px 12px;
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  white-space: nowrap;
}
.hb-table td {
  padding: 10px 12px;
  color: rgba(var(--v-theme-on-surface), 0.75);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
  vertical-align: top;
}
.hb-table tr:last-child td { border-bottom: none; }
.hb-caption {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 6px;
}

.hb-faq { margin: 4px 0 16px; }
.hb-faq-item {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.hb-faq-q {
  display: flex; align-items: flex-start; gap: 7px;
  padding: 12px 2px;
  font-size: 14.5px; font-weight: 620;
  color: rgba(var(--v-theme-on-surface), 0.85);
  cursor: pointer;
  list-style: none;
}
.hb-faq-q::-webkit-details-marker { display: none; }
.hb-faq-chev { transition: transform 0.16s; margin-top: 1px; flex-shrink: 0; }
.hb-faq-item[open] .hb-faq-chev { transform: rotate(90deg); }
.hb-faq-a {
  font-size: 14px; line-height: 1.65;
  color: rgba(var(--v-theme-on-surface), 0.7);
  padding: 0 2px 14px 26px;
}

.hb-links { display: grid; gap: 8px; margin: 4px 0 16px; }
.hb-link-card {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border-radius: 11px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  text-decoration: none;
  transition: border-color 0.15s, background 0.15s;
}
.hb-link-card:hover {
  border-color: rgba(4, 120, 87, 0.35);
  background: rgba(4, 120, 87, 0.04);
}
.hb-link-card :deep(.v-icon) { color: #047857; flex-shrink: 0; }
.hb-link-card > div { flex: 1; min-width: 0; }
.hb-link-label { font-size: 14px; font-weight: 650; color: rgba(var(--v-theme-on-surface), 0.88); }
.hb-link-desc { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px; }
.hb-link-chev { color: rgba(var(--v-theme-on-surface), 0.3) !important; }

.hb-divider {
  height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  margin: 22px 0;
}
</style>
