import { Node, mergeAttributes } from '@tiptap/core'

export const BorderedBlock = Node.create({
  name: 'borderedBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      borderStyle: {
        default: 'solid',
        parseHTML: el => el.getAttribute('data-border-style') || 'solid',
        renderHTML: attrs => ({ 'data-border-style': attrs.borderStyle }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-bordered]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-bordered': '',
      style: 'border: 1px solid #000; padding: 10px 14px; margin: 8px 0; border-radius: 2px;',
    }), 0]
  },

  addCommands() {
    return {
      toggleBorderedBlock: () => ({ commands, state }) => {
        const { from, to } = state.selection
        const node = state.doc.nodeAt(from)

        // If already inside a bordered block, lift it
        if (state.doc.resolve(from).parent.type.name === 'borderedBlock') {
          return commands.lift('borderedBlock')
        }

        // Wrap selection in bordered block
        return commands.wrapIn('borderedBlock')
      },
    }
  },
})
