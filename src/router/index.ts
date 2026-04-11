import { createRouter, createWebHistory } from "vue-router";
import { setupLayouts } from "virtual:generated-layouts";
import { routes } from "vue-router/auto-routes";
import { useAuthStore } from "@/stores/auth";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: setupLayouts(routes),
});

const publicRoutes = ["/login"];

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

  // Role-based access check for staff
  if (authStore.isAuthenticated && !authStore.canAccess(to.path)) {
    return next("/");
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