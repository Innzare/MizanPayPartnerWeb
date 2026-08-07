<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { HelpChapter } from '@/types/help'

const props = defineProps<{
  chapters: HelpChapter[]
  activeId: string | null
  /** Что искать — при непустом запросе дерево заменяется списком найденного. */
  search: string
  results: { chapterTitle: string; sectionId: string; sectionTitle: string; snippet: string }[]
  lockedFeature?: (ch: HelpChapter) => string | null
}>()

const emit = defineEmits<{
  (e: 'go', id: string): void
  (e: 'update:search', v: string): void
}>()

/**
 * Главы, раскрытые вручную, остаются раскрытыми даже когда скролл ушёл в другую
 * главу. Автоматическое схлопывание — главный раздражитель таких деревьев:
 * человек открыл ветку, чтобы сравнить два пункта, а она закрылась сама.
 */
const manuallyOpened = ref(new Set<string>())
const manuallyClosed = ref(new Set<string>())

/** В какой главе сейчас находимся — по активному разделу. */
const activeChapterId = computed(() => {
  if (!props.activeId) return null
  const ch = props.chapters.find(
    (c) => c.id === props.activeId || c.sections.some((s) => s.id === props.activeId),
  )
  return ch?.id ?? null
})

function isOpen(ch: HelpChapter) {
  if (manuallyClosed.value.has(ch.id)) return false
  return manuallyOpened.value.has(ch.id) || activeChapterId.value === ch.id
}

function toggle(ch: HelpChapter) {
  if (isOpen(ch)) {
    manuallyOpened.value.delete(ch.id)
    manuallyClosed.value.add(ch.id)
  } else {
    manuallyClosed.value.delete(ch.id)
    manuallyOpened.value.add(ch.id)
  }
  // Set не реактивен по мутации — подменяем ссылку.
  manuallyOpened.value = new Set(manuallyOpened.value)
  manuallyClosed.value = new Set(manuallyClosed.value)
}

function expandAll() {
  manuallyClosed.value = new Set()
  manuallyOpened.value = new Set(props.chapters.map((c) => c.id))
}
function collapseAll() {
  manuallyOpened.value = new Set()
  manuallyClosed.value = new Set(props.chapters.map((c) => c.id))
}

// ── Подкрутка списка к активному пункту ──
const scrollEl = ref<HTMLElement | null>(null)

/**
 * Считаем позицию вручную. scrollIntoView прокручивает ВСЕ прокручиваемые
 * предки, включая саму страницу, — а от этого возникает петля: подсветка
 * двигает список, список двигает страницу, страница меняет подсветку.
 */
watch(
  () => props.activeId,
  async (id) => {
    if (!id || !scrollEl.value) return
    await nextTick()
    const item = scrollEl.value.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(id)}"]`)
    if (!item) return
    const box = scrollEl.value
    const rel = item.offsetTop - box.offsetTop
    const visible = rel >= box.scrollTop && rel + item.offsetHeight <= box.scrollTop + box.clientHeight
    if (!visible) {
      box.scrollTop = rel - box.clientHeight / 2 + item.offsetHeight / 2
    }
  },
)

defineExpose({ expandAll, collapseAll })
</script>

<template>
  <div class="hn">
    <div class="hn-search-wrap">
      <v-icon icon="mdi-magnify" size="17" class="hn-search-icon" />
      <input
        :value="search"
        class="hn-search"
        placeholder="Поиск по справке…"
        @input="emit('update:search', ($event.target as HTMLInputElement).value)"
      >
      <button v-if="search" class="hn-search-clear" @click="emit('update:search', '')">
        <v-icon icon="mdi-close" size="15" />
      </button>
    </div>

    <!-- Режим поиска: дерево уступает место найденному -->
    <div v-if="search.trim()" ref="scrollEl" class="hn-scroll">
      <div v-if="!results.length" class="hn-empty">
        Ничего не нашлось.<br >Попробуйте другое слово — например, «просрочка» или «касса».
      </div>
      <button
        v-for="r in results"
        :key="r.sectionId"
        class="hn-result"
        :data-nav-id="r.sectionId"
        :class="{ 'hn-result--active': activeId === r.sectionId }"
        @click="emit('go', r.sectionId)"
      >
        <div class="hn-result-chapter">{{ r.chapterTitle }}</div>
        <div class="hn-result-title">{{ r.sectionTitle }}</div>
        <div v-if="r.snippet" class="hn-result-snippet">{{ r.snippet }}</div>
      </button>
    </div>

    <!-- Обычный режим: дерево глав -->
    <template v-else>
      <div class="hn-tools">
        <button class="hn-tool" @click="expandAll">Развернуть всё</button>
        <span class="hn-tool-sep">·</span>
        <button class="hn-tool" @click="collapseAll">Свернуть</button>
      </div>

      <nav ref="scrollEl" class="hn-scroll">
        <div v-for="ch in chapters" :key="ch.id" class="hn-chapter">
          <button
            class="hn-ch-btn"
            :data-nav-id="ch.id"
            :class="{ 'hn-ch-btn--active': activeChapterId === ch.id }"
            @click="emit('go', ch.id)"
          >
            <v-icon :icon="ch.icon" size="17" class="hn-ch-icon" />
            <span class="hn-ch-title">{{ ch.title }}</span>
            <v-icon
              v-if="lockedFeature?.(ch)"
              icon="mdi-crown-outline"
              size="14"
              class="hn-ch-crown"
            />
            <span
              class="hn-ch-toggle"
              :class="{ 'hn-ch-toggle--open': isOpen(ch) }"
              @click.stop="toggle(ch)"
            >
              <v-icon icon="mdi-chevron-down" size="16" />
            </span>
          </button>

          <div v-show="isOpen(ch)" class="hn-sections">
            <button
              v-for="s in ch.sections"
              :key="s.id"
              class="hn-sec"
              :data-nav-id="s.id"
              :class="{ 'hn-sec--active': activeId === s.id }"
              @click="emit('go', s.id)"
            >
              {{ s.title }}
            </button>
          </div>
        </div>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.hn { display: flex; flex-direction: column; min-height: 0; }

.hn-search-wrap { position: relative; margin-bottom: 10px; }
.hn-search {
  width: 100%;
  padding: 9px 30px 9px 32px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-size: 13.5px;
}
.hn-search:focus { outline: none; border-color: rgba(4, 120, 87, 0.5); }
.hn-search-icon {
  position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.hn-search-clear {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 22px; height: 22px; border: none; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer;
}

.hn-tools {
  display: flex; align-items: center; gap: 6px;
  padding: 0 4px 8px;
  font-size: 11.5px;
}
.hn-tool {
  border: none; background: none; padding: 0; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.hn-tool:hover { color: #047857; }
.hn-tool-sep { color: rgba(var(--v-theme-on-surface), 0.2); }

.hn-scroll {
  overflow-y: auto;
  /* Без этого прокрутка списка «протекает» на страницу, когда список кончился. */
  overscroll-behavior: contain;
  flex: 1 1 auto;
  min-height: 0;
  padding-right: 4px;
}

.hn-chapter { margin-bottom: 1px; }
.hn-ch-btn {
  width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 8px 8px 9px;
  border: none; border-radius: 9px;
  background: none;
  text-align: left;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 13.5px; font-weight: 600;
  line-height: 1.3;
}
.hn-ch-btn:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.hn-ch-btn--active { background: rgba(4, 120, 87, 0.09); color: #047857; }
.hn-ch-icon { flex-shrink: 0; opacity: 0.75; }
.hn-ch-title { flex: 1; min-width: 0; }
.hn-ch-crown { color: #e8b931 !important; flex-shrink: 0; }
.hn-ch-toggle {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 5px;
  color: rgba(var(--v-theme-on-surface), 0.3);
  transition: transform 0.16s;
}
.hn-ch-toggle:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.hn-ch-toggle--open { transform: rotate(180deg); }

/* Рельса слева — видно, что это подпункты своей главы, а не отдельный список. */
.hn-sections {
  margin: 1px 0 6px 17px;
  padding-left: 11px;
  border-left: 1.5px solid rgba(var(--v-theme-on-surface), 0.08);
}
.hn-sec {
  display: block; width: 100%;
  padding: 6px 8px;
  border: none; border-radius: 7px;
  background: none;
  text-align: left;
  cursor: pointer;
  font-size: 13px; line-height: 1.35;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.hn-sec:hover { background: rgba(var(--v-theme-on-surface), 0.04); color: rgba(var(--v-theme-on-surface), 0.8); }
.hn-sec--active {
  color: #047857; font-weight: 650;
  background: rgba(4, 120, 87, 0.07);
}

.hn-result {
  display: block; width: 100%;
  padding: 9px 10px;
  margin-bottom: 3px;
  border: none; border-radius: 9px;
  background: none;
  text-align: left;
  cursor: pointer;
}
.hn-result:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.hn-result--active { background: rgba(4, 120, 87, 0.08); }
.hn-result-chapter {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.38);
}
.hn-result-title {
  font-size: 13.5px; font-weight: 650;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-top: 1px;
}
.hn-result-snippet {
  font-size: 12px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 3px;
}

.hn-empty {
  padding: 24px 10px;
  font-size: 13px; line-height: 1.6;
  color: rgba(var(--v-theme-on-surface), 0.42);
  text-align: center;
}
</style>
