/**
 * plugins/vuetify.ts
 *
 * Три темы: светлая, тёмная (холодный графит) и ночная (глубокая).
 *
 * Тёмные палитры собраны по принятым практикам тёмного режима: без чистого
 * чёрного и без чистого белого текста (резкий контраст утомляет глаз и «мылит»
 * на OLED), слои различаются тоном, а не тенями — тени на тёмном фоне не
 * видны. Все пары «текст на фоне» проверены по WCAG: основной текст 13.6:1 и
 * 14.8:1, вторичный 6.5:1, подписи 4.4:1, акценты 5–7:1.
 *
 * Отдельная беда прежней тёмной темы: фирменный #047857 на тёмном давал 2.99:1
 * — кнопка сливалась с фоном. В тёмных темах primary поднят на тон (#05835f:
 * белый текст 4.75:1, сама кнопка отделяется от карточки 3.39:1), а для
 * акцентного ТЕКСТА (ссылки, суммы, иконки) заведён отдельный светлый
 * `accent` — тёмно-зелёный в роли текста нечитаем.
 *
 * ВАЖНО про использование в CSS. Vuetify отдаёт каналы, а не готовый цвет:
 *   background: rgb(var(--v-theme-surface));
 *   border-color: rgba(var(--v-theme-on-surface), 0.12);
 * Хардкодить цвета в компонентах нельзя — иначе элемент останется светлым в
 * тёмной теме (и одинаковым в обеих тёмных).
 *
 * Framework documentation: https://vuetifyjs.com
 */

// Styles
import "@mdi/font/css/materialdesignicons.css";
import "vuetify/styles";

// Composables
import { createVuetify } from "vuetify";
import type { ThemeDefinition } from "vuetify";

/** Идентификаторы тем — единственный источник правды для переключателя. */
export const THEME_IDS = ["light", "dark", "night"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** Подписи для меню выбора темы. */
export const THEME_LABELS: Record<ThemeId, { title: string; hint: string; icon: string }> = {
  light: { title: "Светлая", hint: "Для дневного света", icon: "mdi-white-balance-sunny" },
  dark: { title: "Тёмная", hint: "Спокойный графит", icon: "mdi-brightness-4" },
  // Не полумесяц: он уже занят разделом «Закят» в шапке.
  night: { title: "Ночная", hint: "Глубокая, для темноты", icon: "mdi-weather-night" },
};

const light: ThemeDefinition = {
  dark: false,
  colors: {
    primary: "#047857",
    secondary: "#3d3d3d",
    success: "#16a34a",
    warning: "#F97316",
    error: "#dc2626",
    info: "#2563eb",
    background: "#f9f4f0",
    surface: "#ffffff",
    // Слои и граница — те же роли, что в тёмных темах: правила в компонентах
    // пишутся один раз и переключаются вместе с темой.
    "surface-deep": "#f3f4f6",
    "surface-elevated": "#f9fafb",
    border: "#e5e7eb",
    accent: "#047857",
  },
};

/**
 * Тёмная — холодный графит в духе GitHub dim: фон не проваливается в чёрный,
 * слои читаются, синие акценты не грязнят.
 */
const dark: ThemeDefinition = {
  dark: true,
  colors: {
    primary: "#05835f",
    secondary: "#9ca3af",
    success: "#3fbf85",
    warning: "#e0a542",
    error: "#e8686b",
    info: "#5b9cf0",
    background: "#16181c",
    surface: "#1e2127",
    "surface-deep": "#16181c",
    "surface-elevated": "#262a31",
    border: "#323740",
    accent: "#35b98a",
    "on-surface": "#e6edf3",
    "on-background": "#e6edf3",
    "on-primary": "#ffffff",
  },
};

/**
 * Ночная — тот же холодный тон, но глубже: для тёмной комнаты и OLED. Не
 * чистый чёрный: на #000 белый текст даёт ореол и «смазывание» при прокрутке.
 */
const night: ThemeDefinition = {
  dark: true,
  colors: {
    primary: "#05835f",
    secondary: "#8f96a3",
    success: "#3fbf85",
    warning: "#e0a542",
    error: "#e8686b",
    info: "#5b9cf0",
    background: "#0b0d11",
    surface: "#131720",
    "surface-deep": "#0b0d11",
    "surface-elevated": "#1b1f28",
    border: "#282d38",
    accent: "#35b98a",
    "on-surface": "#e3eaf2",
    "on-background": "#e3eaf2",
    "on-primary": "#ffffff",
  },
};

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  theme: {
    defaultTheme: "light",
    themes: { light, dark, night },
  },
});
