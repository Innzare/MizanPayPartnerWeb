/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Plugins
import { registerPlugins } from '@/plugins'

// Components
import App from './App.vue'

// Composables
import { createApp } from 'vue'
import { vMaska } from 'maska/vue'

// Styles
import 'unfonts.css'
import '@/styles/admin-tables.css'

const app = createApp(App)

registerPlugins(app)

app.directive('maska', vMaska)

app.mount('#app')
