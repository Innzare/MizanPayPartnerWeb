import { ref } from 'vue'

/**
 * Track which deals the partner has recently opened, in MRU order, so
 * the quick-access sidebar can offer a "Недавно просмотренные" tab
 * without an extra backend call.
 *
 * Just IDs and timestamps go through localStorage — the full deal
 * objects are still resolved from the deals store at render time. Keeps
 * the persisted payload tiny (~1KB for 20 entries) and avoids stale
 * fields lingering after a deal is edited.
 */

interface RecentVisit {
  id: string
  visitedAt: string  // ISO
}

const STORAGE_PREFIX = 'mizanpay:recent-deals:'
const MAX_RECENT = 20

const recent = ref<RecentVisit[]>([])
// Mirror of the useDealDraft trick — when the partner identity changes
// (logout/login same tab), rehydrate so we don't leak the previous
// partner's recents into the new account.
let cachedForPartnerId: string | null = null

function storageKey(partnerId: string): string {
  return STORAGE_PREFIX + partnerId
}

function readFromStorage(partnerId: string): RecentVisit[] {
  try {
    const raw = localStorage.getItem(storageKey(partnerId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is RecentVisit =>
        e && typeof e.id === 'string' && typeof e.visitedAt === 'string',
    )
  } catch {
    return []
  }
}

export function useRecentDeals(partnerId: string | null | undefined) {
  if (partnerId !== cachedForPartnerId) {
    recent.value = partnerId ? readFromStorage(partnerId) : []
    cachedForPartnerId = partnerId ?? null
  }

  function persist() {
    if (!partnerId) return
    try {
      localStorage.setItem(storageKey(partnerId), JSON.stringify(recent.value))
    } catch {
      // quota / private mode — silently drop
    }
  }

  function recordVisit(dealId: string) {
    if (!partnerId || !dealId) return
    // De-dupe + bump to front. Cap at MAX_RECENT so the list doesn't grow
    // unbounded across months of normal usage.
    const without = recent.value.filter((r) => r.id !== dealId)
    without.unshift({ id: dealId, visitedAt: new Date().toISOString() })
    recent.value = without.slice(0, MAX_RECENT)
    persist()
  }

  function clear() {
    recent.value = []
    if (partnerId) {
      try {
        localStorage.removeItem(storageKey(partnerId))
      } catch {
        // ignore
      }
    }
  }

  function remove(dealId: string) {
    recent.value = recent.value.filter((r) => r.id !== dealId)
    persist()
  }

  return { recent, recordVisit, remove, clear }
}
