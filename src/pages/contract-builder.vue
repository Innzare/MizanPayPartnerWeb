<script lang="ts" setup>
import { api } from '@/api/client'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import { StarterKit } from '@tiptap/starter-kit'
import { Underline } from '@tiptap/extension-underline'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Image } from '@tiptap/extension-image'
import { Highlight } from '@tiptap/extension-highlight'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Placeholder } from '@tiptap/extension-placeholder'
import { BorderedBlock } from '@/utils/tiptap-bordered-block'
import { FontSize } from '@/utils/tiptap-font-size'
import { CONTRACT_TEMPLATES, CONTRACT_VARIABLES, type ContractTemplate } from '@/utils/contractTemplates'

const { isDark } = useIsDark()
const toast = useToast()

// State
const loading = ref(true)
const saving = ref(false)
const showTemplateDialog = ref(false)

// Page margins (mm)
const margins = ref({ top: 20, bottom: 20, left: 25, right: 15 })
const showVariablesPanel = ref(true)
const showFontSizeMenu = ref(false)
const showColorPicker = ref(false)
const imageInputRef = ref<HTMLInputElement | null>(null)

const FONT_SIZES = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '24px']

function setFontSize(size: string) {
  editor.value?.chain().focus().setFontSize(size).run()
  showFontSizeMenu.value = false
}

function setTextColor(color: string) {
  editor.value?.chain().focus().setColor(color).run()
  showColorPicker.value = false
}

function onImageSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    if (reader.result) {
      editor.value?.chain().focus().setImage({ src: reader.result as string }).run()
    }
  }
  reader.readAsDataURL(file)
  input.value = ''
}

// TipTap editor
const editor = useEditor({
  extensions: [
    StarterKit,
    Underline,
    TextStyle,
    Color,
    FontSize,
    Highlight.configure({ multicolor: true }),
    Image.configure({ inline: true, allowBase64: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    BorderedBlock,
    Placeholder.configure({ placeholder: 'Начните писать договор или выберите шаблон...' }),
  ],
  content: '',
  editorProps: {
    attributes: {
      class: 'cb-editor-content',
    },
  },
})

// Load saved template
async function loadTemplate() {
  loading.value = true
  try {
    const data = await api.get<{ template: any }>('/auth/investor/contract-template')
    if (data.template && typeof data.template === 'string') {
      editor.value?.commands.setContent(data.template)
    } else if (data.template && data.template.html) {
      editor.value?.commands.setContent(data.template.html)
      if (data.template.margins) margins.value = data.template.margins
    }
  } catch { /* silent */ }
  finally { loading.value = false }
}

// Save template
async function saveTemplate() {
  if (!editor.value) return
  saving.value = true
  try {
    await api.patch('/auth/investor/contract-template', {
      template: { html: editor.value.getHTML(), margins: margins.value },
    })
    toast.success('Шаблон сохранён')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка сохранения')
  } finally { saving.value = false }
}

// Apply preset template
function applyTemplate(template: ContractTemplate) {
  if (editor.value?.getHTML() && editor.value.getHTML() !== '<p></p>') {
    if (!confirm('Текущий шаблон будет заменён. Продолжить?')) return
  }
  editor.value?.commands.setContent(template.html)
  showTemplateDialog.value = false
  toast.success(`Шаблон «${template.name}» применён`)
}

// Insert variable at cursor
function insertVariable(variable: string) {
  editor.value?.commands.insertContent(variable)
  editor.value?.commands.focus()
}

// Group variables
const variableGroups = computed(() => {
  const groups: Record<string, typeof CONTRACT_VARIABLES> = {}
  for (const v of CONTRACT_VARIABLES) {
    if (!groups[v.group]) groups[v.group] = []
    groups[v.group].push(v)
  }
  return groups
})

onMounted(() => {
  // Wait for editor to initialize
  setTimeout(loadTemplate, 100)
})

onBeforeUnmount(() => { editor.value?.destroy() })
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Loading -->
    <div v-if="loading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
      <!-- Header -->
      <div class="cb-header">
        <div>
          <div class="cb-title">Конструктор договора</div>
          <div class="cb-subtitle">Редактируйте шаблон как в Word. Переменные подставятся из сделки автоматически</div>
        </div>
        <div class="d-flex ga-2">
          <button class="cb-btn cb-btn--outline" @click="showTemplateDialog = true">
            <v-icon icon="mdi-file-document-multiple-outline" size="16" />
            Шаблоны
          </button>
          <button class="cb-btn cb-btn--outline" @click="showVariablesPanel = !showVariablesPanel">
            <v-icon icon="mdi-code-braces" size="16" />
            Переменные
          </button>
          <button class="cb-btn cb-btn--primary" :disabled="saving" @click="saveTemplate">
            <v-progress-circular v-if="saving" indeterminate size="14" width="2" color="white" />
            <v-icon v-else icon="mdi-content-save" size="16" />
            Сохранить
          </button>
        </div>
      </div>

      <div class="cb-layout" :class="{ 'cb-layout--with-panel': showVariablesPanel }">
        <!-- Editor area -->
        <div class="cb-editor-wrap">
          <!-- Toolbar -->
          <div v-if="editor" class="cb-toolbar">
            <!-- Text style -->
            <div class="cb-toolbar-group">
              <button class="cb-tool" :class="{ active: editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()" title="Жирный">
                <v-icon icon="mdi-format-bold" size="18" />
              </button>
              <button class="cb-tool" :class="{ active: editor.isActive('italic') }" @click="editor.chain().focus().toggleItalic().run()" title="Курсив">
                <v-icon icon="mdi-format-italic" size="18" />
              </button>
              <button class="cb-tool" :class="{ active: editor.isActive('underline') }" @click="editor.chain().focus().toggleUnderline().run()" title="Подчёркнутый">
                <v-icon icon="mdi-format-underline" size="18" />
              </button>
              <button class="cb-tool" :class="{ active: editor.isActive('strike') }" @click="editor.chain().focus().toggleStrike().run()" title="Зачёркнутый">
                <v-icon icon="mdi-format-strikethrough" size="18" />
              </button>
            </div>
            <div class="cb-toolbar-divider" />

            <!-- Font size -->
            <div class="cb-toolbar-group">
              <v-menu v-model="showFontSizeMenu" :close-on-content-click="false" location="bottom">
                <template #activator="{ props: menuProps }">
                  <button v-bind="menuProps" class="cb-tool cb-tool--wide" title="Размер шрифта">
                    <v-icon icon="mdi-format-size" size="18" />
                    <v-icon icon="mdi-chevron-down" size="12" />
                  </button>
                </template>
                <v-card rounded="lg" elevation="3" min-width="100" class="pa-1">
                  <button
                    v-for="s in FONT_SIZES" :key="s"
                    class="cb-size-option"
                    @click="setFontSize(s)"
                  >{{ s }}</button>
                </v-card>
              </v-menu>
            </div>
            <div class="cb-toolbar-divider" />

            <!-- Color -->
            <div class="cb-toolbar-group">
              <v-menu v-model="showColorPicker" :close-on-content-click="false" location="bottom">
                <template #activator="{ props: menuProps }">
                  <button v-bind="menuProps" class="cb-tool" title="Цвет текста">
                    <v-icon icon="mdi-format-color-text" size="18" />
                  </button>
                </template>
                <v-card rounded="lg" elevation="3" class="pa-3" style="width: 200px;">
                  <div class="cb-color-grid">
                    <button v-for="c in ['#000000','#333333','#666666','#999999','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#047857','#0ea5e9']"
                      :key="c" class="cb-color-swatch" :style="{ background: c }" @click="setTextColor(c)" />
                  </div>
                  <button class="cb-color-reset" @click="editor.chain().focus().unsetColor().run(); showColorPicker = false">
                    Сбросить цвет
                  </button>
                </v-card>
              </v-menu>

              <button class="cb-tool" :class="{ active: editor.isActive('highlight') }" @click="editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()" title="Выделить фоном">
                <v-icon icon="mdi-marker" size="18" />
              </button>
            </div>
            <div class="cb-toolbar-divider" />

            <!-- Headings -->
            <div class="cb-toolbar-group">
              <button class="cb-tool" :class="{ active: editor.isActive('heading', { level: 1 }) }" @click="editor.chain().focus().toggleHeading({ level: 1 }).run()">
                <span style="font-size: 13px; font-weight: 800;">H1</span>
              </button>
              <button class="cb-tool" :class="{ active: editor.isActive('heading', { level: 2 }) }" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()">
                <span style="font-size: 12px; font-weight: 700;">H2</span>
              </button>
              <button class="cb-tool" :class="{ active: editor.isActive('heading', { level: 3 }) }" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()">
                <span style="font-size: 11px; font-weight: 700;">H3</span>
              </button>
            </div>
            <div class="cb-toolbar-divider" />

            <!-- Alignment -->
            <div class="cb-toolbar-group">
              <button class="cb-tool" :class="{ active: editor.isActive({ textAlign: 'left' }) }" @click="editor.chain().focus().setTextAlign('left').run()">
                <v-icon icon="mdi-format-align-left" size="18" />
              </button>
              <button class="cb-tool" :class="{ active: editor.isActive({ textAlign: 'center' }) }" @click="editor.chain().focus().setTextAlign('center').run()">
                <v-icon icon="mdi-format-align-center" size="18" />
              </button>
              <button class="cb-tool" :class="{ active: editor.isActive({ textAlign: 'right' }) }" @click="editor.chain().focus().setTextAlign('right').run()">
                <v-icon icon="mdi-format-align-right" size="18" />
              </button>
            </div>
            <div class="cb-toolbar-divider" />

            <!-- Lists -->
            <div class="cb-toolbar-group">
              <button class="cb-tool" :class="{ active: editor.isActive('bulletList') }" @click="editor.chain().focus().toggleBulletList().run()">
                <v-icon icon="mdi-format-list-bulleted" size="18" />
              </button>
              <button class="cb-tool" :class="{ active: editor.isActive('orderedList') }" @click="editor.chain().focus().toggleOrderedList().run()">
                <v-icon icon="mdi-format-list-numbered" size="18" />
              </button>
            </div>
            <div class="cb-toolbar-divider" />

            <!-- Insert -->
            <div class="cb-toolbar-group">
              <button class="cb-tool" @click="editor.chain().focus().setHorizontalRule().run()" title="Разделитель">
                <v-icon icon="mdi-minus" size="18" />
              </button>
              <button class="cb-tool" @click="editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: false }).run()" title="Таблица">
                <v-icon icon="mdi-table" size="18" />
              </button>
              <button class="cb-tool" :class="{ active: editor.isActive('borderedBlock') }" @click="(editor as any).commands.toggleBorderedBlock()" title="Рамка">
                <v-icon icon="mdi-card-outline" size="18" />
              </button>
              <button class="cb-tool" @click="imageInputRef?.click()" title="Изображение">
                <v-icon icon="mdi-image-plus" size="18" />
              </button>
              <input ref="imageInputRef" type="file" accept="image/*" style="display: none;" @change="onImageSelected" />
            </div>
            <div class="cb-toolbar-divider" />

            <!-- Undo/Redo -->
            <div class="cb-toolbar-group">
              <button class="cb-tool" @click="editor.chain().focus().undo().run()" :disabled="!editor.can().undo()">
                <v-icon icon="mdi-undo" size="18" />
              </button>
              <button class="cb-tool" @click="editor.chain().focus().redo().run()" :disabled="!editor.can().redo()">
                <v-icon icon="mdi-redo" size="18" />
              </button>
            </div>
          </div>

          <!-- Editor paper -->
          <div class="cb-paper-wrap">
            <div class="cb-paper" :style="{ padding: `${margins.top * 1.5}px ${margins.right * 1.5}px ${margins.bottom * 1.5}px ${margins.left * 1.5}px` }">
              <EditorContent :editor="editor" />
            </div>
          </div>
        </div>

        <!-- Variables panel -->
        <div v-if="showVariablesPanel" class="cb-vars-panel">
          <!-- Margins -->
          <div class="cb-vars-group">
            <div class="cb-vars-group-title">Отступы страницы (мм)</div>
            <div class="cb-margins-grid">
              <div class="cb-margin-field">
                <label>Сверху</label>
                <input type="number" v-model.number="margins.top" min="0" max="60" />
              </div>
              <div class="cb-margin-field">
                <label>Снизу</label>
                <input type="number" v-model.number="margins.bottom" min="0" max="60" />
              </div>
              <div class="cb-margin-field">
                <label>Слева</label>
                <input type="number" v-model.number="margins.left" min="0" max="60" />
              </div>
              <div class="cb-margin-field">
                <label>Справа</label>
                <input type="number" v-model.number="margins.right" min="0" max="60" />
              </div>
            </div>
          </div>

          <div class="cb-vars-title">Переменные</div>
          <div class="cb-vars-hint">Нажмите чтобы вставить в текст</div>

          <div v-for="(vars, group) in variableGroups" :key="group" class="cb-vars-group">
            <div class="cb-vars-group-title">{{ group }}</div>
            <div class="cb-vars-list">
              <button
                v-for="v in vars" :key="v.key"
                class="cb-var-chip"
                @click="insertVariable(v.key)"
                :title="v.label"
              >
                {{ v.key }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Template picker dialog -->
    <v-dialog v-model="showTemplateDialog" max-width="600">
      <v-card rounded="xl" class="pa-6">
        <div class="d-flex align-center justify-space-between mb-4">
          <div style="font-size: 18px; font-weight: 700;">Выберите шаблон</div>
          <button class="cb-close" @click="showTemplateDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
        <div class="cb-template-grid">
          <button
            v-for="t in CONTRACT_TEMPLATES"
            :key="t.id"
            class="cb-template-card"
            @click="applyTemplate(t)"
          >
            <div class="cb-template-icon">
              <v-icon icon="mdi-file-document-outline" size="28" />
            </div>
            <div class="cb-template-name">{{ t.name }}</div>
            <div class="cb-template-desc">{{ t.description }}</div>
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Header */
.cb-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 16px; flex-wrap: wrap; gap: 12px;
}
.cb-title { font-size: 20px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.cb-subtitle { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.4); margin-top: 2px; }

.cb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 10px; border: none;
  font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.cb-btn--primary { background: #047857; color: #fff; }
.cb-btn--primary:hover { background: #065f46; }
.cb-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.cb-btn--outline {
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.6);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.cb-btn--outline:hover { background: rgba(var(--v-theme-on-surface), 0.04); }

/* Layout */
.cb-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
.cb-layout--with-panel {
  grid-template-columns: 1fr 260px;
}

/* Editor wrap */
.cb-editor-wrap {
  border-radius: 12px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: #fff;
}

/* Toolbar */
.cb-toolbar {
  display: flex; align-items: center; gap: 2px;
  padding: 6px 10px; flex-wrap: wrap;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.cb-toolbar-group { display: flex; gap: 1px; }
.cb-toolbar-divider {
  width: 1px; height: 24px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  margin: 0 6px;
}
.cb-tool {
  width: 32px; height: 32px; border-radius: 6px; border: none;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.1s;
}
.cb-tool:hover { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.8); }
.cb-tool.active { background: rgba(var(--v-theme-primary), 0.1); color: rgb(var(--v-theme-primary)); }
.cb-tool:disabled { opacity: 0.3; cursor: not-allowed; }
.cb-tool--wide { width: auto; padding: 0 6px; gap: 2px; }

/* Font size dropdown */
.cb-size-option {
  display: block; width: 100%; padding: 5px 12px; border: none;
  background: none; text-align: left; border-radius: 4px;
  font-size: 12px; cursor: pointer; color: inherit;
}
.cb-size-option:hover { background: rgba(var(--v-theme-primary), 0.08); }

/* Color picker */
.cb-color-grid {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px;
  margin-bottom: 8px;
}
.cb-color-swatch {
  width: 26px; height: 26px; border-radius: 6px; border: 2px solid transparent;
  cursor: pointer; transition: all 0.1s;
}
.cb-color-swatch:hover { border-color: rgba(var(--v-theme-on-surface), 0.3); transform: scale(1.15); }
.cb-color-reset {
  width: 100%; padding: 4px; border: none; background: none;
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: pointer; border-radius: 4px;
}
.cb-color-reset:hover { background: rgba(var(--v-theme-on-surface), 0.05); }

/* Paper */
.cb-paper-wrap {
  display: flex; justify-content: center;
  padding: 24px;
  background: #f5f5f5;
  min-height: calc(100vh - 250px);
  overflow-y: auto;
}
.cb-paper {
  width: 100%; max-width: 700px;
  background: #fff;
  box-shadow: 0 1px 8px rgba(0,0,0,0.08);
  padding: 48px 56px;
  min-height: 900px;
  border-radius: 2px;
}

/* Editor content styles */
.cb-paper :deep(.cb-editor-content) {
  outline: none;
  font-size: 13px;
  line-height: 1.6;
  color: #222;
}
.cb-paper :deep(.cb-editor-content p) { margin: 0 0 8px; }
.cb-paper :deep(.cb-editor-content h1) { font-size: 20px; font-weight: 800; margin: 0 0 12px; }
.cb-paper :deep(.cb-editor-content h2) { font-size: 17px; font-weight: 700; margin: 12px 0 8px; }
.cb-paper :deep(.cb-editor-content h3) { font-size: 14px; font-weight: 700; margin: 12px 0 6px; }
.cb-paper :deep(.cb-editor-content hr) { border: none; border-top: 1px solid #ccc; margin: 12px 0; }
.cb-paper :deep(.cb-editor-content ul),
.cb-paper :deep(.cb-editor-content ol) { margin: 4px 0 8px; padding-left: 20px; }
.cb-paper :deep(.cb-editor-content li) { margin-bottom: 2px; }
.cb-paper :deep(.cb-editor-content table) {
  border-collapse: collapse; width: 100%; margin: 8px 0;
}
.cb-paper :deep(.cb-editor-content td),
.cb-paper :deep(.cb-editor-content th) {
  border: 1px solid #ddd; padding: 6px 10px;
  vertical-align: top; font-size: 12px;
}
.cb-paper :deep(.cb-editor-content div[data-bordered]) {
  border: 1px solid #000; padding: 10px 14px; margin: 8px 0; border-radius: 2px;
}
.cb-paper :deep(.cb-editor-content img) {
  max-width: 100%; height: auto; border-radius: 4px; margin: 4px 0;
}
.cb-paper :deep(.cb-editor-content mark) {
  background: #fef08a; padding: 1px 2px; border-radius: 2px;
}
.cb-paper :deep(.cb-editor-content .is-empty::before) {
  content: attr(data-placeholder);
  color: rgba(var(--v-theme-on-surface), 0.25);
  pointer-events: none;
  float: left; height: 0;
}

/* Variables panel */
.cb-vars-panel {
  background: #fff; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  padding: 16px; overflow-y: auto;
  max-height: calc(100vh - 200px);
  position: sticky; top: 80px;
}
/* Margins */
.cb-margins-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
}
.cb-margin-field {
  display: flex; flex-direction: column; gap: 2px;
}
.cb-margin-field label {
  font-size: 10px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.cb-margin-field input {
  width: 100%; height: 32px; padding: 0 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 6px; font-size: 12px; font-weight: 600;
  color: inherit; background: rgba(var(--v-theme-on-surface), 0.03);
  outline: none; text-align: center;
}
.cb-margin-field input:focus { border-color: rgb(var(--v-theme-primary)); }
.dark .cb-margin-field input { background: #1a1a2a; border-color: #2e2e42; }

.cb-vars-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
  margin-bottom: 2px;
}
.cb-vars-hint {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.35);
  margin-bottom: 14px;
}
.cb-vars-group { margin-bottom: 14px; }
.cb-vars-group-title {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.3); letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.cb-vars-list { display: flex; flex-wrap: wrap; gap: 4px; }
.cb-var-chip {
  display: inline-flex; padding: 4px 8px; border-radius: 6px;
  border: 1px solid rgba(var(--v-theme-primary), 0.15);
  background: rgba(var(--v-theme-primary), 0.04);
  color: rgb(var(--v-theme-primary));
  font-size: 10px; font-weight: 600; font-family: monospace;
  cursor: pointer; transition: all 0.12s;
}
.cb-var-chip:hover {
  background: rgba(var(--v-theme-primary), 0.12);
  border-color: rgba(var(--v-theme-primary), 0.3);
}

/* Template dialog */
.cb-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.4);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.cb-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.cb-template-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.cb-template-card {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 20px 12px; border-radius: 14px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.03);
  cursor: pointer; transition: all 0.15s; text-align: center;
}
.cb-template-card:hover {
  background: rgba(var(--v-theme-primary), 0.06);
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.15);
}
.cb-template-icon {
  width: 56px; height: 56px; border-radius: 14px;
  background: rgba(var(--v-theme-primary), 0.08); color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
}
.cb-template-name { font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.cb-template-desc { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4); }

/* Dark */
.dark .cb-editor-wrap { background: #1e1e2e; border-color: #2e2e42; }
.dark .cb-toolbar { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06); }
.dark .cb-paper-wrap { background: #151520; }
.dark .cb-paper { background: #1e1e2e; box-shadow: 0 1px 8px rgba(0,0,0,0.3); }
.dark .cb-paper :deep(.cb-editor-content) { color: #e4e4e7; }
.dark .cb-paper :deep(.cb-editor-content td),
.dark .cb-paper :deep(.cb-editor-content th) { border-color: #3e3e52; }
.dark .cb-vars-panel { background: #1e1e2e; border-color: #2e2e42; }
.dark .cb-template-card { background: rgba(255,255,255,0.04); }

@media (max-width: 900px) {
  .cb-layout--with-panel { grid-template-columns: 1fr; }
  .cb-vars-panel { position: static; max-height: none; }
  .cb-paper { padding: 24px 20px; }
  .cb-template-grid { grid-template-columns: 1fr; }
}
</style>
