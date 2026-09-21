/** Tiện ích cho editor ghi chú (Tiptap) và cột câu hỏi Cornell — tách khỏi file component để fast refresh chạy đúng. */

// Khối được gán id ổn định (thuộc tính data-id, Tiptap UniqueID) — câu hỏi ở cột trái neo vào các id này.
export const ANCHOR_TYPES = [
  'heading',
  'paragraph',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'table',
  'image',
  'blockMath',
]

/** Chữ của một node để làm "đáp án" ôn tập: công thức -> LaTeX, ảnh -> nhãn, còn lại -> text. */
function nodeText(node) {
  if (node.type.name === 'blockMath' || node.type.name === 'inlineMath') return `$${node.attrs.latex}$`
  if (node.type.name === 'image') return `[Ảnh${node.attrs.alt ? `: ${node.attrs.alt}` : ''}]`
  if (node.type.name === 'noteLink') return `[[${node.attrs.title}]]`
  if (node.isText) return node.text
  let out = ''
  node.forEach((child, _offset, index) => {
    if (index && child.isBlock) out += '\n'
    out += nodeText(child)
  })
  return out
}

export function newCueId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** Id của khối gần nhất (trong cùng) chứa con trỏ. */
export function blockIdAtSelection(state) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const id = $from.node(depth).attrs?.id
    if (id) return id
  }
  return null
}

/** Duyệt tài liệu lấy tập id khối (để biết câu hỏi nào đang neo vào đoạn đã bị xoá). */
export function collectBlockIds(editor) {
  const ids = new Set()
  editor?.state.doc.descendants((node) => {
    if (node.attrs?.id) ids.add(node.attrs.id)
  })
  return ids
}

/** Nội dung dạng chữ của một khối (dùng làm "đáp án" trong chế độ ôn tập). */
export function blockText(editor, id) {
  let text = null
  editor?.state.doc.descendants((node) => {
    if (text !== null) return false
    if (node.attrs?.id === id) {
      text = nodeText(node)
      return false
    }
    return true
  })
  return text
}

/**
 * Cuộn tới khối và nháy sáng để người dùng thấy đoạn được neo. Dùng Web Animations API thay vì thêm class:
 * ProseMirror theo dõi DOM của editor và tự khôi phục mọi thuộc tính bị sửa từ bên ngoài (class bị gỡ ngay).
 */
export function revealBlock(editor, id) {
  const el = editor?.view.dom.querySelector(`[data-id="${CSS.escape(id)}"]`)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const soft = getComputedStyle(el).getPropertyValue('--note-soft').trim() || '#edf5f1'
  el.animate(
    [
      { backgroundColor: soft, boxShadow: `0 0 0 0.35em ${soft}`, offset: 0 },
      { backgroundColor: soft, boxShadow: `0 0 0 0.35em ${soft}`, offset: 0.35 },
      { backgroundColor: 'transparent', boxShadow: '0 0 0 0.35em transparent', offset: 1 },
    ],
    { duration: 1800, easing: 'ease-out' },
  )
  return true
}
