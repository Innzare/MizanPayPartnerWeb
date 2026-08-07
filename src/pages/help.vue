<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useIsMobile } from '@/composables/useIsMobile'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useSubscription } from '@/composables/useSubscription'
import { useSections } from '@/composables/useSections'
import { useScrollSpy } from '@/composables/useScrollSpy'
import { minPlanLabelForFeature } from '@/types'
import HelpNav from '@/components/help/HelpNav.vue'
import HelpBlockView from '@/components/help/HelpBlock.vue'
import HelpRichText from '@/components/help/HelpRichText.vue'
import { HELP_CHAPTERS, helpPlainText } from '@/constants/help'
import type { HelpChapter } from '@/types/help'

const route = useRoute()
const { isDark } = useIsDark()
// Ниже 1200px правая колонка уже не оставляет контенту читаемой ширины.
const { isMobile: isNarrow } = useIsMobile(1200)
const toast = useToast()
const authStore = useAuthStore()
const subscription = useSubscription()
const sections = useSections()

/** Сотруднику не показываем главы про разделы, куда его всё равно не пустят. */
const chapters = computed(() =>
  HELP_CHAPTERS.filter((ch) => {
    if (ch.ownerOnly && authStore.isStaff) return false
    // Скрытый раздел не должен всплывать и в справке — ни главой, ни в поиске.
    if (ch.requiredFeature && sections.isHidden(ch.requiredFeature)) return false
    return true
  }),
)

/** Глава про возможность, недоступную на текущем тарифе → показываем корону. */
function lockedFeature(ch: HelpChapter): string | null {
  if (!ch.requiredFeature) return null
  if (subscription.canAccess(ch.requiredFeature)) return null
  return minPlanLabelForFeature(ch.requiredFeature)
}

// ── Поиск ──
const search = ref('')

const index = computed(() =>
  chapters.value.flatMap((ch) =>
    ch.sections.map((s) => ({
      chapterId: ch.id,
      chapterTitle: ch.title,
      sectionId: s.id,
      sectionTitle: s.title,
      // ё и е ищутся одинаково: пользователь набирает как придётся.
      plain: (s.title + ' ' + (s.keywords || []).join(' ') + ' ' + s.blocks.map(helpPlainText).join(' '))
        .toLowerCase()
        .replace(/ё/g, 'е'),
    })),
  ),
)

const results = computed(() => {
  const q = search.value.trim().toLowerCase().replace(/ё/g, 'е')
  if (!q) return []
  const words = q.split(/\s+/).filter(Boolean)

  return index.value
    .map((row) => {
      // Все слова запроса должны найтись — иначе выдача забивается мусором.
      if (!words.every((w) => row.plain.includes(w))) return null
      const inTitle = row.sectionTitle.toLowerCase().replace(/ё/g, 'е').includes(q)
      const score = (inTitle ? 100 : 0) + (row.chapterTitle.toLowerCase().includes(q) ? 30 : 0)
      const at = row.plain.indexOf(words[0]!)
      const snippet =
        at >= 0
          ? (at > 40 ? '…' : '') + row.plain.slice(Math.max(0, at - 40), at + 90).trim() + '…'
          : ''
      return { ...row, score, snippet }
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
})

/** В режиме поиска показываем только главы, где что-то нашлось. */
const visibleChapters = computed(() => {
  if (!search.value.trim()) return chapters.value
  const ids = new Set(results.value.map((r) => r.sectionId))
  return chapters.value
    .map((ch) => ({ ...ch, sections: ch.sections.filter((s) => ids.has(s.id)) }))
    .filter((ch) => ch.sections.length)
})

// ── Подсветка при прокрутке ──
// В список якорей входят и главы, и разделы: так активным становится
// заголовок главы, пока не начался её первый раздел.
const spyIds = computed(() =>
  visibleChapters.value.flatMap((ch) => [ch.id, ...ch.sections.map((s) => s.id)]),
)

const headerH = ref(72)
const anchorOffset = computed(() => headerH.value + 20)
const { activeId, scrollTo, refresh } = useScrollSpy(spyIds, { offset: anchorOffset })

const navOpen = ref(false)

function go(id: string) {
  // На узком экране дерево живёт в полноэкранном окне. Закрыть его нужно ДО
  // прокрутки: пока окно открыто, страница под ним заблокирована и прокрутка
  // уходит в никуда.
  if (navOpen.value) {
    navOpen.value = false
    nextTick(() => scrollTo(id))
  } else {
    scrollTo(id)
  }
  history.replaceState(history.state, '', '#' + id)
}

function copyLink(id: string) {
  const url = `${location.origin}${location.pathname}#${id}`
  navigator.clipboard?.writeText(url)
    .then(() => toast.success('Ссылка на раздел скопирована'))
    .catch(() => {})
}

// ── Высота залипающей шапки приложения ──
// Меряем, а не задаём числом: у шапки скрывается подзаголовок на узких
// экранах, и константа разъехалась бы при первой же правке лэйаута.
let headerRo: ResizeObserver | undefined

onMounted(async () => {
  const el = document.querySelector<HTMLElement>('.lyt-header')
  if (el) {
    headerH.value = el.offsetHeight
    headerRo = new ResizeObserver(() => { headerH.value = el.offsetHeight })
    headerRo.observe(el)
  }

  // Переход по прямой ссылке /help#deal-create. Роутер сам к якорю не
  // прокручивает — в проекте не задан scrollBehavior.
  const hash = route.hash.slice(1)
  if (hash) {
    await nextTick()
    requestAnimationFrame(() => scrollTo(hash, 'auto'))
    // Над контентом может доехать баннер подписки и сдвинуть всё вниз —
    // повторяем прицеливание, если человек за это время не прокрутил сам.
    const y = window.scrollY
    setTimeout(() => { if (Math.abs(window.scrollY - y) < 4) scrollTo(hash, 'auto') }, 500)
  }
})

onBeforeUnmount(() => headerRo?.disconnect())

// Отфильтровали контент поиском — позиции заголовков изменились.
watch(visibleChapters, () => nextTick(refresh))

// ── Кнопка «наверх» ──
const showTop = ref(false)
function onScroll() { showTop.value = window.scrollY > 600 }
// В шаблоне window недоступен — нужна обёртка.
function toTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }
onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <div class="at-page help-page" :class="{ dark: isDark }">
    <div class="help-layout">
      <!-- ── Контент ── -->
      <div class="help-content">
        <!-- Оглавление плиткой: первый вход не должен выглядеть стеной текста -->
        <div v-if="!search.trim()" class="help-intro">
          <h1 class="help-h1">Как работать с MizanPay</h1>
          <p class="help-lead">
            Здесь собрано всё: от первой сделки до деления прибыли с инвесторами.
            Выберите тему или воспользуйтесь поиском.
          </p>
          <div class="help-toc">
            <button
              v-for="ch in chapters"
              :key="ch.id"
              class="help-toc-card"
              @click="go(ch.id)"
            >
              <v-icon :icon="ch.icon" size="20" />
              <div class="help-toc-body">
                <div class="help-toc-title">
                  {{ ch.title }}
                  <v-icon
                    v-if="lockedFeature(ch)"
                    icon="mdi-crown-outline"
                    size="13"
                    class="help-toc-crown"
                  />
                </div>
                <div v-if="ch.summary" class="help-toc-sum">{{ ch.summary }}</div>
              </div>
            </button>
          </div>
        </div>

        <div v-if="search.trim() && !visibleChapters.length" class="help-nothing">
          <v-icon icon="mdi-file-search-outline" size="34" />
          <div class="help-nothing-title">Ничего не нашлось</div>
          <div class="help-nothing-sub">
            Попробуйте другое слово — например, «просрочка», «касса» или «наценка».
          </div>
        </div>

        <section v-for="ch in visibleChapters" :id="ch.id" :key="ch.id" class="help-chapter">
          <div class="help-ch-head">
            <div class="help-ch-icon"><v-icon :icon="ch.icon" size="22" /></div>
            <div>
              <h2 class="help-h2">
                {{ ch.title }}
                <button class="help-anchor" title="Скопировать ссылку" @click="copyLink(ch.id)">#</button>
              </h2>
              <p v-if="ch.summary" class="help-ch-sum">{{ ch.summary }}</p>
            </div>
          </div>

          <div v-if="lockedFeature(ch)" class="help-plan">
            <v-icon icon="mdi-crown-outline" size="18" />
            <div>
              <b>Доступно с тарифа «{{ lockedFeature(ch) }}»</b>
              — раздел можно прочитать, но в приложении он пока закрыт.
            </div>
            <router-link to="/settings?tab=subscription" class="help-plan-btn">Тарифы</router-link>
          </div>

          <section v-for="s in ch.sections" :id="s.id" :key="s.id" class="help-section">
            <h3 class="help-h3">
              <HelpRichText :text="s.title" :highlight="search" />
              <button class="help-anchor" title="Скопировать ссылку" @click="copyLink(s.id)">#</button>
            </h3>
            <HelpBlockView
              v-for="(b, i) in s.blocks"
              :key="i"
              :block="b"
              :highlight="search"
            />
          </section>
        </section>

        <!-- Запас снизу: без него последняя короткая глава физически не может
             доехать до верха экрана, и её пункт никогда не подсветился бы. -->
        <div class="help-tail">
          <div class="help-tail-card">
            <v-icon icon="mdi-lifebuoy" size="24" />
            <div>
              <div class="help-tail-title">Не нашли ответ?</div>
              <div class="help-tail-sub">
                Напишите нам — подскажем и дополним справку.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Навигация справа ── -->
      <aside v-if="!isNarrow" class="help-aside">
        <HelpNav
          :chapters="chapters"
          :active-id="activeId"
          :search="search"
          :results="results"
          :locked-feature="lockedFeature"
          @go="go"
          @update:search="search = $event"
        />
      </aside>
    </div>

    <!-- ── Узкий экран: полоса «где я» + дерево в полноэкранном окне ── -->
    <template v-if="isNarrow">
      <div class="help-mobar" :style="{ top: headerH + 'px' }">
        <v-icon icon="mdi-format-list-bulleted" size="18" />
        <span class="help-mobar-label">{{
          visibleChapters.find((c) => c.id === activeId || c.sections.some((s) => s.id === activeId))?.title
            || 'Содержание'
        }}</span>
        <button class="help-mobar-btn" @click="navOpen = true">Содержание</button>
      </div>

      <v-dialog v-model="navOpen" fullscreen>
        <v-card class="help-modal">
          <div class="help-modal-head">
            <span>Содержание</span>
            <button class="help-modal-close" @click="navOpen = false">
              <v-icon icon="mdi-close" size="20" />
            </button>
          </div>
          <HelpNav
            class="help-modal-nav"
            :chapters="chapters"
            :active-id="activeId"
            :search="search"
            :results="results"
            :locked-feature="lockedFeature"
            @go="go"
            @update:search="search = $event"
          />
        </v-card>
      </v-dialog>
    </template>

    <button v-show="showTop" class="help-top" title="Наверх" @click="toTop">
      <v-icon icon="mdi-arrow-up" size="20" />
    </button>
  </div>
</template>

<style scoped>
.help-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 40px;
  align-items: start;
}
/* Белое полотно под контентом — текст читается на чистом фоне, а не на
   бежевом фоне приложения. */
.help-content {
  max-width: 880px; margin: 0 auto; width: 100%;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  border-radius: 16px;
  padding: 28px 34px 0;
}

@media (max-width: 1200px) {
  .help-layout { grid-template-columns: minmax(0, 1fr); gap: 0; }
  /* Место под полосу «где я» — она перекрывает верх контента. */
  .help-content { margin-top: 52px; padding: 22px 18px 0; }
}

/* ── Шапка и оглавление ── */
.help-h1 {
  font-size: 27px; font-weight: 800; letter-spacing: -0.02em;
  color: rgba(var(--v-theme-on-surface), 0.92);
}
.help-lead {
  font-size: 15px; line-height: 1.6;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin: 6px 0 22px;
  max-width: 620px;
}
.help-toc {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 10px;
  margin-bottom: 40px;
}
.help-toc-card {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  background: rgb(var(--v-theme-surface));
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.help-toc-card:hover { border-color: rgba(4, 120, 87, 0.4); transform: translateY(-1px); }
.help-toc-card :deep(.v-icon) { color: #047857; flex-shrink: 0; margin-top: 1px; }
.help-toc-body { min-width: 0; }
.help-toc-title {
  font-size: 14px; font-weight: 650;
  color: rgba(var(--v-theme-on-surface), 0.88);
  display: flex; align-items: center; gap: 5px;
}
.help-toc-crown { color: #e8b931 !important; }
.help-toc-sum {
  font-size: 12.5px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}

/* ── Главы ── */
.help-chapter { padding-top: 8px; }
/* Уводит заголовок из-под залипающей шапки — работает и по клику,
   и при переходе по прямой ссылке с якорем. */
.help-chapter, .help-section { scroll-margin-top: calc(v-bind('headerH + "px"') + 20px); }

.help-ch-head {
  display: flex; align-items: flex-start; gap: 13px;
  padding: 28px 0 6px;
  margin-top: 20px;
  border-top: 2px solid rgba(var(--v-theme-on-surface), 0.07);
}
.help-chapter:first-child .help-ch-head { border-top: none; margin-top: 0; padding-top: 0; }
.help-ch-icon {
  width: 42px; height: 42px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
  flex-shrink: 0;
}
.help-h2 {
  font-size: 21px; font-weight: 750; letter-spacing: -0.015em;
  color: rgba(var(--v-theme-on-surface), 0.92);
  line-height: 1.25;
}
.help-ch-sum {
  font-size: 13.5px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.52);
  margin-top: 3px;
}

.help-section { padding-top: 18px; }
.help-h3 {
  font-size: 16.5px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
  margin-bottom: 10px;
}

.help-anchor {
  border: none; background: none; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.18);
  font-weight: 700;
  padding: 0 6px;
  opacity: 0;
  transition: opacity 0.15s;
}
.help-h2:hover .help-anchor, .help-h3:hover .help-anchor { opacity: 1; }
.help-anchor:hover { color: #047857; }

.help-plan {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px;
  margin: 12px 0 4px;
  border-radius: 11px;
  background: rgba(232, 185, 49, 0.1);
  font-size: 13.5px;
  color: rgba(var(--v-theme-on-surface), 0.72);
}
.help-plan :deep(.v-icon) { color: #e8b931; flex-shrink: 0; }
.help-plan > div { flex: 1; }
.help-plan-btn {
  flex-shrink: 0;
  padding: 5px 12px; border-radius: 8px;
  background: rgba(232, 185, 49, 0.2);
  color: #92700f;
  font-size: 12.5px; font-weight: 700;
  text-decoration: none;
}
.dark .help-plan-btn { color: #e8b931; }

/* ── Хвост ── */
.help-tail { padding-bottom: 55vh; padding-top: 36px; }
.help-tail-card {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 20px;
  border-radius: 14px;
  background: rgba(4, 120, 87, 0.06);
}
.help-tail-card :deep(.v-icon) { color: #047857; }
.help-tail-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.88); }
.help-tail-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 2px; }

.help-nothing {
  padding: 60px 20px; text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.help-nothing-title { font-size: 16px; font-weight: 700; margin-top: 10px; }
.help-nothing-sub { font-size: 13.5px; margin-top: 4px; }

/* ── Правая колонка ── */
.help-aside {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  border-radius: 16px;
  padding: 14px 10px 14px 14px;
  position: sticky;
  /* Ниже z-index шапки приложения (10) — иначе перекроет её при прокрутке. */
  z-index: 5;
  top: calc(v-bind('headerH + "px"') + 16px);
  max-height: calc(100vh - v-bind('headerH + "px"') - 32px);
  display: flex; flex-direction: column;
}

/* ── Узкий экран ── */
.help-mobar {
  position: fixed;
  left: 0; right: 0;
  z-index: 6;
  display: flex; align-items: center; gap: 9px;
  padding: 9px 16px;
  background: rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.help-mobar :deep(.v-icon) { color: rgba(var(--v-theme-on-surface), 0.4); }
.help-mobar-label {
  flex: 1; min-width: 0;
  font-size: 13.5px; font-weight: 650;
  color: rgba(var(--v-theme-on-surface), 0.8);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.help-mobar-btn {
  flex-shrink: 0;
  padding: 5px 12px; border: none; border-radius: 8px;
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer;
}

.help-modal { display: flex; flex-direction: column; height: 100%; padding: 12px 14px 0; }
.help-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 12px;
  font-size: 16px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.help-modal-close {
  width: 32px; height: 32px; border: none; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
}
.help-modal-nav { flex: 1; min-height: 0; padding-bottom: 12px; }

.help-top {
  position: fixed;
  right: 24px; bottom: 24px;
  z-index: 7;
  width: 42px; height: 42px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
}
.help-top:hover { color: #047857; border-color: rgba(4, 120, 87, 0.4); }
</style>
