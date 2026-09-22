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
import '@/styles/forms.css'
import '@/styles/row-actions.css'
import '@/styles/filter-panel.css'
import '@/styles/page-tabs.css'
import '@/styles/anchored-menu.css'
import '@/styles/back-button.css'
import '@/styles/side-drawer.css'
import '@/styles/table-columns.css'

// AG Grid — register community modules once for entire app
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
ModuleRegistry.registerModules([AllCommunityModule])

const app = createApp(App)

registerPlugins(app)

app.directive('maska', vMaska)

app.mount('#app')
