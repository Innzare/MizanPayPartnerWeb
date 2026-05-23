import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Reactive viewport-mobile flag. True when innerWidth < 768.
 *
 * Used to:
 *   • Make v-dialogs fullscreen on phones (`:fullscreen="isMobile"`).
 *   • Toggle list/card views and other layout switches that media-queries
 *     alone can't drive (e.g. computed defaults, watchers).
 *
 * Listens to window resize while the calling component is mounted; cleans
 * up on unmount. Safe to call multiple times — each consumer gets its own
 * ref (no shared singleton, so SSR/multi-instance is fine).
 */
export function useIsMobile(breakpoint = 768) {
  const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < breakpoint)
  function update() { isMobile.value = window.innerWidth < breakpoint }
  onMounted(() => window.addEventListener('resize', update))
  onUnmounted(() => window.removeEventListener('resize', update))
  return { isMobile }
}
