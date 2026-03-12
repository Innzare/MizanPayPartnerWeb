import vuetify from "eslint-config-vuetify";

export default [
  ...vuetify(),
  {
    rules: {
      "@stylistic/indent": ["error", 2],
    },
  },
];
