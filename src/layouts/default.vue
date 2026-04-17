<script lang="ts" setup>
import { useRoute, useRouter } from "vue-router";
import { useTheme } from "vuetify";
import logo from "@/assets/images/logo.svg";
import logoDark from "@/assets/images/logo-dark.svg";
import logoText from "@/assets/images/logo-text.svg";
import logoTextDark from "@/assets/images/logo-text-dark.svg";
import { useAuthStore } from "@/stores/auth";
import { useNotificationsStore } from "@/stores/notifications";
import { useSubscription } from "@/composables/useSubscription";
import GlobalToast from "@/components/GlobalToast.vue";
import CreateClientDialog from "@/components/CreateClientDialog.vue";
import type { PlanFeatures } from "@/types";

const authStore = useAuthStore();
const notificationsStore = useNotificationsStore();
const subscription = useSubscription();
const theme = useTheme();

const route = useRoute();
const router = useRouter();

const quickActionsMenu = ref(false);
const showCreateClientDialog = ref(false);

const planBadgeLabels: Record<string, string> = { PRO: 'Стандарт', BUSINESS: 'Бизнес', PREMIUM: 'Премиум' };
const planBadgeLabel = computed(() => planBadgeLabels[subscription.plan.value] || '');
const hasPlan = computed(() => !subscription.isFree.value);

const logoutDialog = ref(false);
const DRAWER_BREAKPOINT = 1280;
const isMobile = ref(window.innerWidth < DRAWER_BREAKPOINT);
const drawer = ref(!isMobile.value);
const collapsed = ref(false);

const sidebarWidth = computed(() => (collapsed.value ? 72 : 260));

onMounted(() => {
  notificationsStore.fetchNotifications()

  const onResize = () => {
    const wasDesktop = !isMobile.value;
    isMobile.value = window.innerWidth < DRAWER_BREAKPOINT;
    if (wasDesktop === false && !isMobile.value) {
      drawer.value = true;
    }
    if (isMobile.value) {
      collapsed.value = false;
    }
  };
  window.addEventListener("resize", onResize);
  onUnmounted(() => window.removeEventListener("resize", onResize));
});

// Dark mode
const isDark = ref(localStorage.getItem("theme") === "dark");

const applyDarkClass = (dark: boolean) => {
  document.documentElement.classList.toggle("dark", dark);
};

if (isDark.value) {
  theme.change("dark");
  applyDarkClass(true);
}

const toggleTheme = () => {
  isDark.value = !isDark.value;
  theme.change(isDark.value ? "dark" : "light");
  localStorage.setItem("theme", isDark.value ? "dark" : "light");
  applyDarkClass(isDark.value);
};

// Navigation
const allMainNavRoutes: { path: string; title: string; icon: string; ownerOnly?: boolean; requiredFeature?: keyof PlanFeatures }[] = [
  { path: "/", title: "Главная", icon: "mdi-view-dashboard" },
  { path: "/analytics", title: "Аналитика", icon: "mdi-chart-line", requiredFeature: "analytics" },
  { path: "/deals", title: "Сделки", icon: "mdi-briefcase" },
  { path: "/clients", title: "Клиенты", icon: "mdi-account-group" },
  { path: "/payments", title: "Платежи", icon: "mdi-cash-multiple" },
  { path: "/products", title: "Каталог", icon: "mdi-store" },
  { path: "/requests", title: "Заявки", icon: "mdi-file-document-outline" },
  { path: "/co-investors", title: "Со-инвесторы", icon: "mdi-account-group-outline", requiredFeature: "coInvestors" },
  { path: "/finance", title: "Мой капитал", icon: "mdi-wallet-outline", requiredFeature: "finance" },
  { path: "/registry", title: "Реестр клиентов", icon: "mdi-shield-account", requiredFeature: "registry" },
  { path: "/staff", title: "Сотрудники", icon: "mdi-account-key", ownerOnly: true, requiredFeature: "staff" },
];

const allSecondaryNavRoutes = [
  { path: "/contract-builder", title: "Конструктор договора", icon: "mdi-file-cog-outline" },
  { path: "/settings", title: "Настройки", icon: "mdi-cog" },
];

const mainNavRoutes = computed(() =>
  allMainNavRoutes
    .filter((r) => {
      if (r.ownerOnly && !authStore.isOwner) return false;
      return authStore.canAccess(r.path);
    })
    .map((r) => ({
      ...r,
      locked: !!r.requiredFeature && !subscription.canAccess(r.requiredFeature),
    }))
);

const secondaryNavRoutes = computed(() =>
  allSecondaryNavRoutes.filter((r) => {
    if ((r as any).ownerOnly && !authStore.isOwner) return false;
    return authStore.canAccess(r.path);
  })
);

// Route titles for header
const routeTitles: Record<string, string> = {
  "/": "Главная",
  "/analytics": "Аналитика",
  "/deals": "Сделки",
  "/clients": "Клиенты",
  "/payments": "Платежи",
  "/products": "Каталог",
  "/requests": "Заявки",
  "/calculator": "Калькулятор",
  "/notifications": "Уведомления",
  "/settings": "Настройки",
  "/create-deal": "Новая сделка",
  "/import": "Импорт сделок",
  "/create-product": "Новый товар",
  "/co-investors": "Со-инвесторы",
  "/finance": "Мой капитал",
  "/registry": "Реестр клиентов",
  "/staff": "Сотрудники",
  "/activity": "История действий",
};

const routeSubtitles: Record<string, string> = {
  "/": "Обзор вашего портфеля",
  "/analytics": "Доход, поступления и прогнозы",
  "/deals": "Управление сделками",
  "/clients": "Ваши клиенты",
  "/payments": "Все платежи по сделкам",
  "/products": "Ваш каталог товаров",
  "/requests": "Заявки от клиентов",
  "/notifications": "Все уведомления",
  "/calculator": "Расчёт условий рассрочки",
  "/settings": "Профиль и настройки",
  "/co-investors": "Управление капиталом партнёров",
  "/finance": "Учёт доходов и расходов",
  "/registry": "Проверяйте платёжеспособность клиентов",
  "/staff": "Управление доступами сотрудников",
  "/activity": "Журнал всех действий в личном кабинете",
};

// User initials for avatar
const userInitials = computed(() => {
  if (!authStore.userName) return "A";
  return authStore.userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
});

const isActive = (path: string) => {
  if (path === "/") return route.path === "/";
  return route.path.startsWith(path);
};

const confirmLogout = async () => {
  logoutDialog.value = false;
  await authStore.logout();
  router.push('/login');
};
</script>

<template>
  <v-responsive class="overflow-visible" :class="{ dark: isDark }">
    <v-app>
      <!-- Sidebar -->
      <v-navigation-drawer
        v-model="drawer"
        class="lyt-sidebar"
        :class="{ 'lyt-sidebar--collapsed': collapsed }"
        :width="sidebarWidth"
        :mobile-breakpoint="0"
        :temporary="isMobile"
      >
        <!-- Logo -->
        <div class="lyt-sidebar-logo">
          <div
            :style="{
              display: 'flex',
              alignItems: 'center',
              gap: collapsed ? '0' : '12px',
            }"
          >
            <v-img
              :src="isDark ? logoDark : logo"
              :width="36"
              :height="36"
              class="lyt-sidebar-logo-img"
            />
            <div class="lyt-sidebar-brand">
              <img :src="isDark ? logoTextDark : logoText" alt="MizanPay" class="lyt-sidebar-logo-text" />
              <span class="lyt-sidebar-brand-label">Partner</span>
            </div>
          </div>
        </div>

        <!-- Collapse toggle -->
        <button class="lyt-collapse-btn" @click="collapsed = !collapsed">
          <div :style="{ display: 'flex', gap: collapsed ? '0' : '12px' }">
            <v-icon
              :icon="collapsed ? 'mdi-chevron-right' : 'mdi-chevron-left'"
              size="18"
            />
            <span class="lyt-nav-text">Свернуть</span>
          </div>
        </button>

        <!-- Main nav -->
        <div class="lyt-nav-section">
          <p class="lyt-nav-label">Основное</p>
          <nav class="lyt-nav">
            <v-tooltip
              v-for="item in mainNavRoutes"
              :key="item.path"
              :text="item.locked ? `${item.title} — доступно с плана Стандарт` : item.title"
              location="end"
              :disabled="!collapsed && !item.locked"
            >
              <template #activator="{ props: tip }">
                <component
                  :is="item.locked ? 'button' : 'router-link'"
                  :to="item.locked ? undefined : item.path"
                  class="lyt-nav-item"
                  :class="{
                    'lyt-nav-item--active': !item.locked && isActive(item.path),
                    'lyt-nav-item--locked': item.locked,
                  }"
                  v-bind="tip"
                  @click="item.locked && $router.push({ path: '/settings', query: { tab: 'subscription' } })"
                >
                  <div
                    :style="{ display: 'flex', gap: collapsed ? '0' : '12px', alignItems: 'center', width: '100%' }"
                  >
                    <v-icon :icon="item.icon" size="20" />
                    <span class="lyt-nav-text">{{ item.title }}</span>
                    <v-icon v-if="item.locked" icon="mdi-crown" size="16" class="lyt-nav-crown" />
                  </div>
                </component>
              </template>
            </v-tooltip>
          </nav>
        </div>

        <!-- Secondary nav -->
        <div class="lyt-nav-section">
          <p class="lyt-nav-label">Прочее</p>
          <nav class="lyt-nav">
            <v-tooltip
              v-for="item in secondaryNavRoutes"
              :key="item.path"
              :text="item.title"
              location="end"
              :disabled="!collapsed"
            >
              <template #activator="{ props: tip }">
                <router-link
                  :to="item.path"
                  class="lyt-nav-item"
                  :class="{ 'lyt-nav-item--active': isActive(item.path) }"
                  v-bind="tip"
                >
                  <div
                    :style="{ display: 'flex', gap: collapsed ? '0' : '12px' }"
                  >
                    <v-icon :icon="item.icon" size="20" />
                    <span class="lyt-nav-text">{{ item.title }}</span>
                  </div>
                </router-link>
              </template>
            </v-tooltip>
          </nav>
        </div>

        <div class="lyt-sidebar-spacer" />

        <!-- Theme toggle -->
        <button class="lyt-theme-btn" @click="toggleTheme">
          <div :style="{ display: 'flex', gap: collapsed ? '0' : '12px' }">
            <v-icon
              :icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
              size="18"
            />
            <span class="lyt-nav-text">{{
              isDark ? "Светлая тема" : "Тёмная тема"
            }}</span>
          </div>
        </button>

        <!-- User card in sidebar -->
        <div class="lyt-sidebar-user">
          <div :style="{ display: 'flex', gap: collapsed ? '0' : '12px' }">
            <v-tooltip text="Профиль" location="end" :disabled="!collapsed">
              <template #activator="{ props: tip }">
                <div
                  class="lyt-sidebar-user-avatar"
                  v-bind="collapsed ? tip : {}"
                >
                  {{ userInitials }}
                </div>
              </template>
            </v-tooltip>
            <div class="lyt-sidebar-user-info">
              <span class="lyt-sidebar-user-name">{{
                authStore.userName || "Администратор"
              }}</span>
              <span v-if="hasPlan" class="lyt-plan-badge">
                <v-icon icon="mdi-crown" size="10" />
                {{ planBadgeLabel }}
              </span>
              <span v-else class="lyt-sidebar-user-role">{{
                authStore.isStaff ? (authStore.staffRole === 'MANAGER' ? 'Менеджер' : 'Оператор') : 'Владелец'
              }}</span>
            </div>
            <v-tooltip text="Выйти" location="end" :disabled="!collapsed">
              <template #activator="{ props: tip }">
                <button
                  class="lyt-sidebar-logout"
                  @click="logoutDialog = true"
                  title="Выйти"
                  v-bind="tip"
                >
                  <v-icon icon="mdi-logout" size="18" />
                </button>
              </template>
            </v-tooltip>
          </div>
        </div>
      </v-navigation-drawer>

      <!-- Main content -->
      <v-main>
        <div class="lyt-content">
          <!-- Header -->
          <header class="lyt-header">
            <div class="lyt-header-left">
              <button
                v-if="isMobile"
                class="lyt-burger-btn"
                @click="drawer = !drawer"
              >
                <v-icon icon="mdi-menu" size="22" />
              </button>
              <div>
                <h1 class="lyt-header-title">
                  {{ routeTitles[route.path] || (route.path.startsWith('/deals/') ? 'Детали сделки' : route.path.startsWith('/clients/') ? 'Профиль клиента' : 'Страница') }}
                </h1>
                <p class="lyt-header-subtitle" v-if="!isMobile">
                  {{ routeSubtitles[route.path] || (route.path.startsWith('/deals/') ? 'Подробная информация' : route.path.startsWith('/clients/') ? 'Документы, сделки и история' : '') }}
                </p>
              </div>
            </div>

            <div class="lyt-header-right">
              <div v-if="!isMobile" class="lyt-header-search">
                <v-icon
                  icon="mdi-magnify"
                  size="18"
                  class="lyt-header-search-icon"
                />
                <input
                  type="text"
                  placeholder="Поиск..."
                  class="lyt-header-search-input"
                />
              </div>

              <!-- Calculator -->
              <router-link to="/calculator" class="lyt-header-icon-btn" title="Калькулятор">
                <v-icon icon="mdi-calculator" size="20" />
              </router-link>

              <!-- Activity history -->
              <v-tooltip :text="subscription.canAccess('activity') ? 'История действий' : 'Доступно с плана Стандарт'" location="bottom">
                <template #activator="{ props: tip }">
                  <component
                    :is="subscription.canAccess('activity') ? 'router-link' : 'button'"
                    :to="subscription.canAccess('activity') ? '/activity' : undefined"
                    class="lyt-header-icon-btn"
                    :class="{ 'lyt-header-icon-btn--locked': !subscription.canAccess('activity') }"
                    v-bind="tip"
                    @click="!subscription.canAccess('activity') && $router.push({ path: '/settings', query: { tab: 'subscription' } })"
                  >
                    <v-icon icon="mdi-history" size="20" />
                    <v-icon v-if="!subscription.canAccess('activity')" icon="mdi-crown" size="14" class="lyt-crown-badge" />
                  </component>
                </template>
              </v-tooltip>

              <!-- Notifications -->
              <router-link to="/notifications" class="lyt-header-icon-btn" title="Уведомления">
                <v-icon icon="mdi-bell-outline" size="20" />
                <span v-if="notificationsStore.unreadCount" class="lyt-header-badge">{{ notificationsStore.unreadCount }}</span>
              </router-link>

              <!-- Quick actions (accent) -->
              <v-menu v-model="quickActionsMenu" offset="8">
                <template v-slot:activator="{ props }">
                  <button class="lyt-header-add-btn" v-bind="props" title="Быстрые действия">
                    <v-icon icon="mdi-plus" size="20" />
                    <span v-if="!isMobile" class="lyt-header-add-btn-label">Создать</span>
                  </button>
                </template>
                <div class="lyt-dropdown">
                  <button class="lyt-dropdown-item" @click="quickActionsMenu = false; showCreateClientDialog = true">
                    <v-icon icon="mdi-account-plus-outline" size="18" />
                    <span>Создать клиента</span>
                  </button>
                  <button class="lyt-dropdown-item" @click="quickActionsMenu = false; router.push('/create-deal')">
                    <v-icon icon="mdi-handshake" size="18" />
                    <span>Новая сделка</span>
                  </button>
                  <button class="lyt-dropdown-item" @click="quickActionsMenu = false; router.push('/create-product')">
                    <v-icon icon="mdi-package-variant-plus" size="18" />
                    <span>Новый товар</span>
                  </button>
                  <button
                    class="lyt-dropdown-item"
                    :class="{ 'lyt-dropdown-item--locked': !subscription.canAccess('import') }"
                    :disabled="!subscription.canAccess('import')"
                    @click="quickActionsMenu = false; subscription.canAccess('import') ? router.push('/import') : router.push({ path: '/settings', query: { tab: 'subscription' } })"
                  >
                    <v-icon icon="mdi-file-upload-outline" size="18" />
                    <span>Импорт из Excel</span>
                    <v-icon v-if="!subscription.canAccess('import')" icon="mdi-crown" size="16" class="ml-auto" style="color: #e8b931;" />
                  </button>
                </div>
              </v-menu>

              <div class="lyt-header-divider" />

              <v-menu offset="8">
                <template v-slot:activator="{ props }">
                  <button class="lyt-header-user" v-bind="props">
                    <div class="lyt-header-user-avatar" style="position: relative;">
                      {{ userInitials }}
                      <div v-if="hasPlan" class="lyt-avatar-plan-dot">
                        <v-icon icon="mdi-crown" size="8" color="#fff" />
                      </div>
                    </div>
                    <v-icon
                      icon="mdi-chevron-down"
                      size="16"
                      class="lyt-header-user-chevron"
                    />
                  </button>
                </template>

                <div class="lyt-dropdown">
                  <div class="lyt-dropdown-header">
                    <div class="lyt-dropdown-avatar">
                      {{ userInitials }}
                    </div>
                    <div>
                      <p class="lyt-dropdown-name">
                        {{ authStore.userName || "Администратор" }}
                        <span v-if="hasPlan" class="lyt-dropdown-plan-badge">
                          <v-icon icon="mdi-crown" size="10" />
                          {{ planBadgeLabel }}
                        </span>
                      </p>
                      <p class="lyt-dropdown-email">
                        {{ authStore.user?.phone ? '+7 ' + authStore.user.phone.slice(1, 4) + ' ***' : '' }}
                      </p>
                    </div>
                  </div>
                  <div class="lyt-dropdown-divider" />
                  <button
                    class="lyt-dropdown-item lyt-dropdown-item--danger"
                    @click="logoutDialog = true"
                  >
                    <v-icon icon="mdi-logout" size="18" />
                    <span>Выйти</span>
                  </button>
                </div>
              </v-menu>
            </div>
          </header>

          <!-- Page content -->
          <router-view v-slot="{ Component }">
            <component :is="Component" />
          </router-view>
        </div>
      </v-main>

      <!-- Logout confirm -->
      <v-dialog v-model="logoutDialog" max-width="400">
        <div class="lyt-logout-dialog">
          <div class="lyt-logout-dialog-icon">
            <v-icon icon="mdi-logout" size="24" />
          </div>
          <h3 class="lyt-logout-dialog-title">Выход из аккаунта</h3>
          <p class="lyt-logout-dialog-text">Вы уверены, что хотите выйти?</p>
          <div class="lyt-logout-dialog-actions">
            <button
              class="lyt-logout-dialog-btn lyt-logout-dialog-btn--cancel"
              @click="logoutDialog = false"
            >
              Отмена
            </button>
            <button
              class="lyt-logout-dialog-btn lyt-logout-dialog-btn--confirm"
              @click="confirmLogout"
            >
              Выйти
            </button>
          </div>
        </div>
      </v-dialog>
    </v-app>
    <GlobalToast />
    <CreateClientDialog v-model="showCreateClientDialog" @created="router.push(`/clients/${$event.id}`)" />
  </v-responsive>
</template>

<style lang="scss">
.lyt-sidebar {
  .v-navigation-drawer__content {
    display: flex !important;
    flex-direction: column !important;
  }
}
</style>

<style scoped lang="scss">
/* ===== SIDEBAR ===== */
.lyt-sidebar {
  background: #fff !important;
  border-right: 1px solid #f0f0f0 !important;
  display: flex;
  flex-direction: column;
  padding: 20px 16px;
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
  overflow: hidden;
}

.lyt-sidebar--collapsed {
  padding: 20px 10px;
}

.lyt-sidebar--collapsed .lyt-sidebar-logo {
  padding: 0 0 24px;
  justify-content: center;
}

.lyt-sidebar--collapsed .lyt-sidebar-brand {
  width: 0;
  opacity: 0;
  overflow: hidden;
}

.lyt-sidebar--collapsed .lyt-nav-label {
  width: 0;
  height: 0;
  opacity: 0;
  margin: 0;
  overflow: hidden;
}

.lyt-sidebar--collapsed .lyt-nav-item {
  justify-content: center;
  padding: 10px;
}

.lyt-sidebar--collapsed .lyt-nav-text {
  width: 0;
  opacity: 0;
  overflow: hidden;
  white-space: nowrap;
}

.lyt-sidebar--collapsed .lyt-sidebar-user {
  justify-content: center;
  padding: 12px 0;
}

.lyt-sidebar--collapsed .lyt-sidebar-user-info {
  width: 0;
  opacity: 0;
  overflow: hidden;
}

.lyt-sidebar--collapsed .lyt-sidebar-logout {
  position: absolute;
  width: 0;
  opacity: 0;
  overflow: hidden;
}

.lyt-sidebar--collapsed .lyt-collapse-btn,
.lyt-sidebar--collapsed .lyt-theme-btn {
  justify-content: center;
  padding: 8px;
}

.lyt-sidebar-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px 22px;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 16px;
  min-height: 36px;
}

.lyt-sidebar-logo-img {
  flex-shrink: 0;
}

.lyt-sidebar-brand {
  display: flex;
  align-items: baseline;
  gap: 6px;
  transition:
    opacity 0.2s ease,
    width 0.25s ease;
  white-space: nowrap;
  position: relative;
}

.lyt-sidebar-logo-text {
  height: 28px;
  width: auto;
}

.lyt-sidebar-brand-label {
  font-size: 9px;
  font-weight: 700;
  color: #047857;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  position: absolute;
  bottom: -18px;
  right: -36px;
  background: color-mix(in srgb, #047857 10%, #fff);
  border: 1px solid color-mix(in srgb, #047857 25%, transparent);
  border-radius: 6px;
  padding: 1px 8px;
}

.lyt-nav-section {
  margin-bottom: 24px;
}

.lyt-nav-label {
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  padding: 0 12px;
  margin-bottom: 8px;
  transition:
    opacity 0.2s ease,
    height 0.25s ease,
    margin 0.25s ease;
  white-space: nowrap;
  overflow: hidden;
}

.lyt-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lyt-nav-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  color: #6b7280;
  text-decoration: none;
  transition: all 0.15s ease;
}

.lyt-nav-item:hover {
  background: #f9f4f0;
  color: #1a1a2e;
}

.lyt-nav-item--active {
  background: color-mix(in srgb, #047857 8%, transparent);
  color: #047857;
  font-weight: 600;
}

.lyt-nav-item--active:hover {
  background: color-mix(in srgb, #047857 12%, transparent);
  color: #047857;
}

.lyt-nav-item--locked {
  opacity: 0.55;
  cursor: pointer;
  border: 1px solid rgba(232, 185, 49, 0.35);
  border-radius: 10px;
}

.lyt-nav-item--locked:hover {
  opacity: 0.75;
  border-color: rgba(232, 185, 49, 0.55);
  background: rgba(232, 185, 49, 0.06);
}

.lyt-nav-crown {
  margin-left: auto;
  color: #e8b931;
}

.lyt-nav-text {
  transition:
    opacity 0.2s ease,
    width 0.25s ease;
  white-space: nowrap;
  overflow: hidden;
}

.lyt-sidebar-spacer {
  flex: 1;
}

.lyt-theme-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 12px;
  border-radius: 10px;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 500;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
}

.lyt-theme-btn:hover {
  background: #f3f4f6;
  color: #6b7280;
}

.lyt-collapse-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  width: 100%;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 500;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 16px;
  white-space: nowrap;
  overflow: hidden;
}

.lyt-collapse-btn:hover {
  background: #f3f4f6;
  color: #6b7280;
}

.lyt-sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid #f0f0f0;
  margin-top: 8px;
  position: relative;
  transition:
    padding 0.25s ease,
    justify-content 0.25s ease;
}

.lyt-sidebar-user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #047857, #ff4081);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.lyt-sidebar-user-info {
  flex: 1;
  min-width: 0;
  transition:
    opacity 0.2s ease,
    width 0.25s ease;
  overflow: hidden;
  white-space: nowrap;
}

.lyt-sidebar-user-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #1a1a2e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lyt-sidebar-user-role {
  display: block;
  font-size: 11px;
  color: #9ca3af;
}

.lyt-plan-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.3px;
  color: #b8941e; background: rgba(232, 185, 49, 0.12);
  border: 1px solid rgba(232, 185, 49, 0.25);
  border-radius: 10px; padding: 1px 8px 1px 6px;
  line-height: 1;
}
.lyt-plan-badge .v-icon { color: #e8b931; }

.lyt-avatar-plan-dot {
  position: absolute; bottom: -2px; right: -2px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #e8b931; border: 2px solid #fff;
  display: flex; align-items: center; justify-content: center;
}

.lyt-dropdown-plan-badge {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; font-weight: 700;
  color: #b8941e; background: rgba(232, 185, 49, 0.12);
  border: 1px solid rgba(232, 185, 49, 0.25);
  border-radius: 10px; padding: 1px 7px 1px 5px;
  margin-left: 6px; vertical-align: middle;
}
.lyt-dropdown-plan-badge .v-icon { color: #e8b931; }

.lyt-sidebar-logout {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: none;
  color: #9ca3af;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.lyt-sidebar-logout:hover {
  background: #fef2f2;
  color: #ef4444;
}

/* ===== CONTENT ===== */
.lyt-content {
  min-height: 100vh;
  background: #f9f4f0;
}

/* ===== HEADER ===== */
.lyt-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 32px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}

.lyt-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.lyt-header-title {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a2e;
  letter-spacing: -0.3px;
  line-height: 1.2;
}

.lyt-header-subtitle {
  font-size: 13px;
  color: #9ca3af;
  margin-top: 2px;
}

.lyt-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lyt-header-search {
  position: relative;
  margin-right: 8px;
}

.lyt-header-search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  pointer-events: none;
}

.lyt-header-search-input {
  width: 240px;
  height: 40px;
  padding: 0 16px 0 38px;
  border-radius: 10px;
  border: 1px solid #f0f0f0;
  background: #f9fafb;
  font-size: 13px;
  color: #1a1a2e;
  outline: none;
  transition: all 0.15s ease;
}

.lyt-header-search-input::placeholder {
  color: #9ca3af;
}

.lyt-header-search-input:focus {
  border-color: #047857;
  background: #fff;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}

.lyt-header-icon-btn {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid #f0f0f0;
  background: #fff;
  color: #6b7280;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  text-decoration: none;
}

.lyt-header-icon-btn:hover {
  background: #f9f4f0;
  color: #1a1a2e;
  border-color: #e5e7eb;
}

.lyt-header-icon-btn--locked {
  opacity: 0.65;
  cursor: pointer;
  border-color: rgba(232, 185, 49, 0.4);
  position: relative;
}

.lyt-header-icon-btn--locked:hover {
  opacity: 0.85;
  border-color: rgba(232, 185, 49, 0.6);
  background: rgba(232, 185, 49, 0.06);
}

.lyt-crown-badge {
  position: absolute;
  bottom: -4px;
  right: -5px;
  color: #e8b931;
  filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.9));
}

.lyt-header-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.lyt-header-divider {
  width: 1px;
  height: 24px;
  background: #f0f0f0;
  margin: 0 8px;
}

/* Accent "Create" button */
.lyt-header-add-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: none;
  margin-left: 4px;
}

.lyt-header-add-btn:hover {
  opacity: 0.9;
}

.lyt-header-add-btn:active {
  transform: translateY(0);
}

.lyt-header-add-btn-label {
  letter-spacing: -0.01em;
}

@media (max-width: 600px) {
  .lyt-header-add-btn {
    width: 40px;
    padding: 0;
    justify-content: center;
  }
}

.lyt-header-user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border-radius: 10px;
  border: none;
  background: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.lyt-header-user:hover {
  background: #f9f4f0;
}

.lyt-header-user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #047857, #ff4081);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lyt-header-user-chevron {
  color: #9ca3af;
}

/* ===== DROPDOWN MENU ===== */
.lyt-dropdown {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
  min-width: 220px;
  padding: 4px;
  overflow: hidden;
}

.lyt-dropdown-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
}

.lyt-dropdown-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #047857, #ff4081);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.lyt-dropdown-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a2e;
}

.lyt-dropdown-email {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 1px;
}

.lyt-dropdown-divider {
  height: 1px;
  background: #f0f0f0;
  margin: 4px 0;
}

.lyt-dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  cursor: pointer;
  transition: all 0.12s ease;
  text-align: left;
}

.lyt-dropdown-item:hover {
  background: #f9f4f0;
}

.lyt-dropdown-item--danger {
  color: #ef4444;
}

.lyt-dropdown-item--danger:hover {
  background: #fef2f2;
}

.lyt-dropdown-item--locked {
  opacity: 0.55;
  cursor: pointer;
  border: 1px solid rgba(232, 185, 49, 0.35);
  border-radius: 8px;
}

.lyt-dropdown-item--locked:hover {
  background: rgba(232, 185, 49, 0.06);
  border-color: rgba(232, 185, 49, 0.55);
  opacity: 0.75;
}

/* ===== LOGOUT DIALOG ===== */
.lyt-logout-dialog {
  background: #fff;
  border-radius: 16px;
  padding: 32px;
  text-align: center;
}

.lyt-logout-dialog-icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: #fef2f2;
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}

.lyt-logout-dialog-title {
  font-size: 18px;
  font-weight: 700;
  color: #1a1a2e;
  margin-bottom: 8px;
}

.lyt-logout-dialog-text {
  font-size: 14px;
  color: #9ca3af;
  margin-bottom: 24px;
}

.lyt-logout-dialog-actions {
  display: flex;
  gap: 12px;
}

.lyt-logout-dialog-btn {
  flex: 1;
  padding: 10px 20px;
  border-radius: 10px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.lyt-logout-dialog-btn--cancel {
  background: #f3f4f6;
  color: #374151;
}

.lyt-logout-dialog-btn--cancel:hover {
  background: #e5e7eb;
}

.lyt-logout-dialog-btn--confirm {
  background: #ef4444;
  color: #fff;
}

.lyt-logout-dialog-btn--confirm:hover {
  background: #dc2626;
}

/* ============================= */
/* ===== DARK MODE OVERRIDES === */
/* ============================= */

.dark .lyt-sidebar {
  background: #1e1e2e !important;
  border-right-color: #2e2e42 !important;
}

.dark .lyt-sidebar-logo {
  border-bottom-color: #2e2e42;
}

.dark .lyt-sidebar-brand-label {
  color: #34d399;
  background: color-mix(in srgb, #059669 12%, #1e1e2e);
  border-color: color-mix(in srgb, #059669 25%, transparent);
}

.dark .lyt-sidebar-brand-name {
  color: #e4e4e7;
}

.dark .lyt-nav-label {
  color: #71717a;
}

.dark .lyt-nav-item {
  color: #a1a1aa;
}

.dark .lyt-nav-item:hover {
  background: #252538;
  color: #e4e4e7;
}

.dark .lyt-nav-item--active {
  background: color-mix(in srgb, #047857 15%, transparent);
  color: #059669;
}

.dark .lyt-nav-item--active:hover {
  background: color-mix(in srgb, #047857 20%, transparent);
  color: #059669;
}

.dark .lyt-nav-item--locked {
  border-color: rgba(232, 185, 49, 0.25);
}

.dark .lyt-nav-item--locked:hover {
  border-color: rgba(232, 185, 49, 0.4);
  background: rgba(232, 185, 49, 0.08);
}

.dark .lyt-theme-btn,
.dark .lyt-collapse-btn {
  color: #71717a;
}

.dark .lyt-theme-btn:hover,
.dark .lyt-collapse-btn:hover {
  background: #252538;
  color: #a1a1aa;
}

.dark .lyt-sidebar-user {
  border-top-color: #2e2e42;
}

.dark .lyt-sidebar-user-name {
  color: #e4e4e7;
}

.dark .lyt-sidebar-user-role {
  color: #71717a;
}
.dark .lyt-plan-badge {
  background: rgba(232, 185, 49, 0.08); border-color: rgba(232, 185, 49, 0.18);
}
.dark .lyt-avatar-plan-dot { border-color: #1e1e2e; }
.dark .lyt-dropdown-plan-badge {
  background: rgba(232, 185, 49, 0.1); border-color: rgba(232, 185, 49, 0.2);
}

.dark .lyt-sidebar-logout {
  color: #71717a;
}

.dark .lyt-sidebar-logout:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

.dark .lyt-content {
  background: #121220;
}

.dark .lyt-header {
  background: #1e1e2e;
  border-bottom-color: #2e2e42;
}

.dark .lyt-header-title {
  color: #e4e4e7;
}

.dark .lyt-header-subtitle {
  color: #71717a;
}

.dark .lyt-header-search-input {
  background: #252538;
  border-color: #2e2e42;
  color: #e4e4e7;
}

.dark .lyt-header-search-input::placeholder {
  color: #71717a;
}

.dark .lyt-header-search-input:focus {
  border-color: #047857;
  background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}

.dark .lyt-header-icon-btn {
  background: #252538;
  border-color: #2e2e42;
  color: #a1a1aa;
}

.dark .lyt-header-icon-btn:hover {
  background: #2e2e42;
  color: #e4e4e7;
  border-color: #3f3f5c;
}

.dark .lyt-header-icon-btn--locked {
  border-color: rgba(232, 185, 49, 0.3);
}

.dark .lyt-header-icon-btn--locked:hover {
  border-color: rgba(232, 185, 49, 0.5);
  background: rgba(232, 185, 49, 0.08);
}

.dark .lyt-crown-badge {
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8));
}

.dark .lyt-header-divider {
  background: #2e2e42;
}

.dark .lyt-header-user:hover {
  background: #252538;
}

.dark .lyt-header-user-chevron {
  color: #71717a;
}

.dark .lyt-dropdown {
  background: #1e1e2e;
  border-color: #2e2e42;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
}

.dark .lyt-dropdown-name {
  color: #e4e4e7;
}

.dark .lyt-dropdown-email {
  color: #71717a;
}

.dark .lyt-dropdown-divider {
  background: #2e2e42;
}

.dark .lyt-dropdown-item {
  color: #a1a1aa;
}

.dark .lyt-dropdown-item:hover {
  background: #252538;
}

.dark .lyt-dropdown-item--danger {
  color: #f87171;
}

.dark .lyt-dropdown-item--danger:hover {
  background: rgba(239, 68, 68, 0.12);
}

.dark .lyt-dropdown-item--locked:hover {
  background: rgba(232, 185, 49, 0.08);
}

.dark .lyt-logout-dialog {
  background: #1e1e2e;
}

.dark .lyt-logout-dialog-icon {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

.dark .lyt-logout-dialog-title {
  color: #e4e4e7;
}

.dark .lyt-logout-dialog-text {
  color: #a1a1aa;
}

.dark .lyt-logout-dialog-btn--cancel {
  background: #252538;
  color: #a1a1aa;
}

.dark .lyt-logout-dialog-btn--cancel:hover {
  background: #2e2e42;
}

/* ===== BURGER BUTTON ===== */
.lyt-burger-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: none;
  background: none;
  color: #6b7280;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.lyt-burger-btn:hover {
  background: #f9f4f0;
  color: #1a1a2e;
}

.dark .lyt-burger-btn {
  color: #a1a1aa;
}

.dark .lyt-burger-btn:hover {
  background: #252538;
  color: #e4e4e7;
}

/* ===== MOBILE ===== */
@media (max-width: 767px) {
  .lyt-header {
    padding: 12px 16px;
  }

  .lyt-header-title {
    font-size: 17px;
  }

  .lyt-logout-dialog {
    padding: 24px 20px;
  }

  .lyt-logout-dialog-actions {
    flex-direction: column;
  }
}
</style>