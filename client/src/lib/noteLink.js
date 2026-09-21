import { Extension, mergeAttributes, Node } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * Liên kết [[...]] giữa các ghi chú (GĐ3).
 *
 * - `NoteLink`: node inline dạng "chip", lưu KÈM ID note đích (`id`) và tiêu đề lúc chèn (`title`) — đổi tên note đích
 *   không làm gãy liên kết. Markdown xuất ra `[[Tiêu đề]](/notes/<id>)`; backend đọc đúng dạng này để tính backlink
 *   (`server/app/services/note_links.py`).
 * - `NoteLinkSuggestion`: nhận biết người dùng vừa gõ `[[` và báo cho React mở danh sách chọn ghi chú
 *   (`components/notes/NoteLinkMenu.jsx`). Không tự chèn gì — mọi thao tác chèn đi qua `insertNoteLink`.
 */

const ID_PATTERN = /^[0-9a-f]{32}$/

export const NoteLink = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-note-link'),
        renderHTML: (attrs) => ({ 'data-note-link': attrs.id }),
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-note-title') || el.textContent?.replace(/^\[\[|\]\]$/g, '') || '',
        renderHTML: (attrs) => ({ 'data-note-title': attrs.title }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-note-link]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'note-link',
        href: `#/notes/${node.attrs.id}`,
        title: `Mở ghi chú “${node.attrs.title}”`,
      }),
      `[[${node.attrs.title}]]`,
    ]
  },

  // Chữ dùng cho getText() / "đáp án" chế độ ôn tập.
  renderText({ node }) {
    return `[[${node.attrs.title}]]`
  },

  renderMarkdown(node) {
    return `[[${node.attrs?.title ?? ''}]](/notes/${node.attrs?.id ?? ''})`
  },

  // Dán lại Markdown có liên kết (vd. copy giữa 2 ghi chú dưới dạng chữ) -> dựng lại node.
  markdownTokenizer: {
    name: 'noteLink',
    level: 'inline',
    start: (src) => src.indexOf('[['),
    tokenize: (src) => {
      const match = /^\[\[([^\]\n]*)\]\]\(\/notes\/([0-9a-f]{32})\)/.exec(src)
      if (!match) return
      return { type: 'noteLink', raw: match[0], title: match[1], id: match[2] }
    },
  },
  parseMarkdown: (token) => ({ type: 'noteLink', attrs: { id: token.id, title: token.title } }),

  addProseMirrorPlugins() {
    const name = this.name
    return [
      new Plugin({
        key: new PluginKey('noteLinkClick'),
        props: {
          // Bấm vào chip -> mở ghi chú đích (trình duyệt không tự đi theo <a> bên trong vùng contenteditable).
          handleClickOn: (_view, _pos, node) => {
            if (node.type.name !== name || !ID_PATTERN.test(node.attrs.id ?? '')) return false
            window.location.hash = `/notes/${node.attrs.id}`
            return true
          },
        },
      }),
    ]
  },
})

export const noteLinkSuggestionKey = new PluginKey('noteLinkSuggestion')

// `[[` + phần đang gõ (không chứa ngoặc / xuống dòng) ngay trước con trỏ.
const TRIGGER = /\[\[([^[\]\n]{0,100})$/

function matchTrigger(state) {
  const { selection } = state
  if (!selection.empty) return null
  const { $from } = selection
  if (!$from.parent.isTextblock || $from.parent.type.name === 'codeBlock') return null
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 120), $from.parentOffset, undefined, '￼')
  const match = TRIGGER.exec(before)
  if (!match) return null
  return { query: match[1], from: $from.pos - match[0].length, to: $from.pos }
}

/**
 * Theo dõi việc gõ `[[` và báo ra ngoài qua `handlers` — phải là các HÀM cố định (Tiptap `configure()` deep-clone
 * options nên object bị sửa sau khi cấu hình sẽ không tới được plugin):
 * - `onChange(state | null)`: `{ query, from, to }` khi đang gõ gợi ý, `null` khi đóng.
 * - `onKeyDown(event) -> boolean`: menu xử lý ↑ ↓ Enter/Tab; trả true = đã xử lý.
 */
export const NoteLinkSuggestion = Extension.create({
  name: 'noteLinkSuggestion',
  // Ưu tiên cao hơn StarterKit: Enter / ↑ ↓ / Esc phải tới menu gợi ý trước khi keymap mặc định xuống dòng.
  priority: 1000,

  addOptions() {
    return { handlers: {} }
  },

  addProseMirrorPlugins() {
    const { handlers } = this.options
    let last = null
    const notify = (next) => {
      const same = next === last || (next && last && next.query === last.query && next.from === last.from)
      if (same) return
      last = next
      handlers.onChange?.(next)
    }
    const activeMatch = (state) => {
      const match = matchTrigger(state)
      const dismissed = noteLinkSuggestionKey.getState(state)?.dismissedFrom
      return match && match.from !== dismissed ? match : null
    }
    return [
      new Plugin({
        key: noteLinkSuggestionKey,
        state: {
          init: () => ({ dismissedFrom: null }),
          apply(tr, value) {
            const meta = tr.getMeta(noteLinkSuggestionKey)
            if (meta) return { dismissedFrom: meta.dismiss ?? null }
            return value
          },
        },
        view: () => ({
          update: (view) => notify(activeMatch(view.state)),
          destroy: () => notify(null),
        }),
        props: {
          handleKeyDown: (view, event) => {
            const match = activeMatch(view.state)
            if (!match) return false
            if (event.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(noteLinkSuggestionKey, { dismiss: match.from }))
              return true
            }
            return handlers.onKeyDown?.(event) ?? false
          },
        },
      }),
    ]
  },
})

/** Thay đoạn `[[đang gõ` bằng chip liên kết + một khoảng trắng. */
export function insertNoteLink(editor, range, note) {
  editor
    .chain()
    .focus()
    .insertContentAt({ from: range.from, to: range.to }, [
      { type: 'noteLink', attrs: { id: note.id, title: note.title } },
      { type: 'text', text: ' ' },
    ])
    .run()
}

/** Đóng gợi ý (Esc / bấm ra ngoài) mà không đụng vào chữ người dùng đã gõ. */
export function dismissNoteLinkSuggestion(editor, from) {
  if (!editor) return
  editor.view.dispatch(editor.state.tr.setMeta(noteLinkSuggestionKey, { dismiss: from }))
}
