import { createRouter, createWebHistory } from "vue-router";
import { setupLayouts } from "virtual:generated-layouts";
import { routes } from "vue-router/auto-routes";
import { useAuthStore } from "@/stores/auth";
import { useSubscription } from "@/composables/useSubscription";
import type { PlanFeatures } from "@/types";

const ROUTE_FEATURES: Record<string, keyof PlanFeatures> = {
  '/analytics': 'analytics',
  '/import': 'import',
  '/activity': 'activity',
  '/registry': 'registry',
  '/co-investors': 'coInvestors',
  '/finance': 'finance',
  '/staff': 'staff',
};

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: setupLayouts(routes),
});

const publicRoutes = ["/login", "/forgot-password", "/reset-password"];

// Routes intentionally hidden — accessing them via URL redirects to home
const hiddenRoutes = ["/products", "/requests", "/create-product"];

let authChecked = false;

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();

  const isPublicRoute = publicRoutes.some(r => to.path.startsWith(r));

  // Always run checkAuth once on first navigation to refresh user from backend
  if (!authChecked) {
    authChecked = true;
    await authStore.checkAuth();
  }

  if (!authStore.isAuthenticated && !isPublicRoute) {
    return next({
      path: "/login",
      query: { redirect: to.fullPath },
    });
  }

  if (authStore.isAuthenticated && to.path === "/login") {
    return next("/");
  }

  // Hidden routes — redirect to home
  if (hiddenRoutes.some(r => to.path === r || to.path.startsWith(r + '/'))) {
    return next("/");
  }

  // Role-based access check for staff
  if (authStore.isAuthenticated && !authStore.canAccess(to.path)) {
    return next("/");
  }

  // Subscription-based feature check
  if (authStore.isAuthenticated) {
    const featureKey = Object.entries(ROUTE_FEATURES).find(
      ([route]) => to.path === route || to.path.startsWith(route + '/')
    )?.[1];
    if (featureKey) {
      const sub = useSubscription();
      if (!sub.canAccess(featureKey)) {
        return next({ path: '/settings', query: { tab: 'subscription' } });
      }
    }
  }

  next();
});

router.onError((err, to) => {
  if (err?.message?.includes?.("Failed to fetch dynamically imported module")) {
    if (localStorage.getItem("vuetify:dynamic-reload")) {
      console.error("Dynamic import error, reloading page did not fix it", err);
    } else {
      console.log("Reloading page to fix dynamic import error");
      localStorage.setItem("vuetify:dynamic-reload", "true");
      location.assign(to.fullPath);
    }
  } else {
    console.error(err);
  }
});

router.isReady().then(() => {
  localStorage.removeItem("vuetify:dynamic-reload");
});

export default router;