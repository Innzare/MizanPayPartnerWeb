/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import "@mdi/font/css/materialdesignicons.css";
import "vuetify/styles";

// Composables
import { createVuetify } from "vuetify";

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  theme: {
    defaultTheme: "light",
    themes: {
      light: {
        colors: {
          primary: "#047857",
          secondary: "#3d3d3d",
          success: "#16a34a",
          warning: "#F97316",
          background: "#f9f4f0",
          surface: "#ffffff",
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: "#047857",
          secondary: "#9ca3af",
          success: "#22c55e",
          warning: "#fb923c",
          background: "#121220",
          surface: "#1e1e2e",
        },
      },
    },
  },
});
