<script setup lang="ts">
import { computed } from 'vue'

/**
 * Текст справки с минимальной разметкой.
 *
 *   **жирный**            — выделение
 *   [[/deals|Сделки]]     — ссылка на раздел приложения
 *   `Ctrl+K`              — клавиша
 *
 * Разбираем в массив кусочков и рендерим через v-for, а не через v-html:
 * v-html не умеет создавать router-link (ссылка перезагрузила бы приложение)
 * и мешает подсветке найденного текста.
 */
const props = defineProps<{
  text: string
  /** Что подсветить — строка поиска. */
  highlight?: string
}>()

type Token =
  | { t: 'text'; v: string }
  | { t: 'b'; v: string }
  | { t: 'kbd'; v: string }
  | { t: 'link'; to: string; v: string }

const RE = /\*\*(.+?)\*\*|\[\[(.+?)\|(.+?)\]\]|`(.+?)`/g

const tokens = computed<Token[]>(() => {
  const out: Token[] = []
  let last = 0
  for (const m of props.text.matchAll(RE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ t: 'text', v: props.text.slice(last, at) })
    if (m[1] !== undefined) out.push({ t: 'b', v: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'link', to: m[2], v: m[3]! })
    else if (m[4] !== undefined) out.push({ t: 'kbd', v: m[4] })
    last = at + m[0].length
  }
  if (last < props.text.length) out.push({ t: 'text', v: props.text.slice(last) })
  return out
})

/** Режем кусок на «до / совпадение / после», чтобы подсветить найденное. */
function parts(v: string): { v: string; hit: boolean }[] {
  const q = props.highlight?.trim()
  if (!q) return [{ v, hit: false }]
  const res: { v: string; hit: boolean }[] = []
  const lower = v.toLowerCase()
  const needle = q.toLowerCase()
  let i = 0
  for (;;) {
    const at = lower.indexOf(needle, i)
    if (at === -1) { res.push({ v: v.slice(i), hit: false }); break }
    if (at > i) res.push({ v: v.slice(i, at), hit: false })
    res.push({ v: v.slice(at, at + needle.length), hit: true })
    i = at + needle.length
  }
  return res.filter((p) => p.v)
}
</script>

<template>
  <span class="hrt">
    <template v-for="(tk, i) in tokens" :key="i">
      <router-link v-if="tk.t === 'link'" :to="tk.to" class="hrt-link">{{ tk.v }}</router-link>
      <kbd v-else-if="tk.t === 'kbd'" class="hrt-kbd">{{ tk.v }}</kbd>
      <b v-else-if="tk.t === 'b'" class="hrt-b">
        <span v-for="(p, j) in parts(tk.v)" :key="j" :class="{ 'hrt-hit': p.hit }">{{ p.v }}</span>
      </b>
      <template v-else>
        <span v-for="(p, j) in parts(tk.v)" :key="j" :class="{ 'hrt-hit': p.hit }">{{ p.v }}</span>
      </template>
    </template>
  </span>
</template>

<style scoped>
.hrt-b { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.92); }
.hrt-link {
  color: #047857;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgba(4, 120, 87, 0.35);
  font-weight: 600;
}
.hrt-link:hover { text-decoration-color: #047857; }
.hrt-kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  border-bottom-width: 2px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
/* Своя подсветка, а не тег mark: дефолтный жёлтый фон нечитаем в тёмной теме. */
.hrt-hit {
  background: rgba(245, 158, 11, 0.28);
  border-radius: 3px;
  padding: 0 1px;
}
</style>
