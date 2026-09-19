import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Extension } from '@tiptap/react'

/**
 * Đánh số tiếp cho danh sách số bị ngắt bởi đoạn văn (giống Word / Google Docs):
 *   1. a            1. a
 *   Giải thích  ->  Giải thích
 *   1. b            2. b
 * Danh sách số MỚI tạo (nút thanh công cụ, gõ "1. ", tách danh sách) mà vẫn đang bắt đầu từ 1 sẽ nối số theo danh sách
 * số gần nhất phía trên trong cùng khối cha. Gặp tiêu đề thì dừng (sang phần mới -> đánh lại từ 1). Gõ số cụ thể
 * ("5. ") thì giữ nguyên. Người dùng đổi qua lại bằng `toggleOrderedListNumbering` (nút trên thanh công cụ).
 *
 * "Mới" = id (Tiptap UniqueID) chưa có ở trạng thái trước -> extension này phải đứng SAU UniqueID trong danh sách
 * extensions để thấy được id vừa gán.
 */

/** Số bắt đầu nếu nối tiếp danh sách số gần nhất phía trên (cùng khối cha), hoặc null nếu không có / gặp tiêu đề. */
export function continuationStart(parent, index) {
  for (let i = index - 1; i >= 0; i--) {
    const node = parent.child(i)
    if (node.type.name === 'heading') return null
    if (node.type.name === 'orderedList') return (node.attrs.start ?? 1) + node.childCount
  }
  return null
}

/** Danh sách số (trong cùng) chứa con trỏ: { node, pos, start, continuation } hoặc null. */
export function orderedListAtSelection(state) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name !== 'orderedList') continue
    return {
      node,
      pos: $from.before(depth),
      start: node.attrs.start ?? 1,
      continuation: continuationStart($from.node(depth - 1), $from.index(depth - 1)),
    }
  }
  return null
}

/** Đang đánh số tiếp -> đánh lại từ 1; đang từ 1 mà phía trên có danh sách số -> đánh số tiếp. */
export function toggleOrderedListNumbering(editor) {
  const info = orderedListAtSelection(editor.state)
  if (!info) return false
  const start = info.start === 1 && info.continuation ? info.continuation : 1
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setNodeMarkup(info.pos, undefined, { ...info.node.attrs, start })
      return true
    })
    .run()
}

/** Danh sách số gần nhất phía trước / phía sau trong cùng khối cha (không vượt qua tiêu đề). */
function adjacentList(parent, index, step) {
  for (let i = index + step; i >= 0 && i < parent.childCount; i += step) {
    const node = parent.child(i)
    if (node.type.name === 'heading') return -1
    if (node.type.name === 'orderedList') return i
  }
  return -1
}

export const OrderedListContinuation = Extension.create({
  name: 'orderedListContinuation',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('orderedListContinuation'),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const before = new Map() // id -> { start, count } ở trạng thái trước
          oldState.doc.descendants((node) => {
            if (node.type.name === 'orderedList' && node.attrs.id) before.set(node.attrs.id, { start: node.attrs.start ?? 1, count: node.childCount })
          })
          const lists = []
          newState.doc.descendants((node, pos, parent, index) => {
            if (node.type.name === 'orderedList') lists.push({ node, pos, parent, index, fresh: !!node.attrs.id && !before.has(node.attrs.id) })
          })
          const tr = newState.tr
          // setNodeMarkup chỉ đổi thuộc tính, không đổi kích thước -> vị trí của các danh sách khác vẫn đúng.
          const setStart = (list, start) => {
            if ((list.node.attrs.start ?? 1) !== start) tr.setNodeMarkup(list.pos, undefined, { ...list.node.attrs, start })
          }
          const find = (parent, index) => lists.find((l) => l.parent === parent && l.index === index)
          const handled = new Set()

          // 1. Tách danh sách (Enter 2 lần ở giữa / nâng một mục ra ngoài): danh sách cũ ít mục đi + một danh sách mới
          //    ngay cạnh. UniqueID có thể cấp id mới cho nửa đầu HOẶC nửa sau -> nửa đầu giữ số bắt đầu cũ, nửa sau nối tiếp.
          for (const list of lists) {
            const old = list.node.attrs.id && before.get(list.node.attrs.id)
            if (!old || list.node.childCount >= old.count) continue
            const partner = [adjacentList(list.parent, list.index, -1), adjacentList(list.parent, list.index, 1)]
              .map((i) => (i >= 0 ? find(list.parent, i) : null))
              .find((l) => l?.fresh && !handled.has(l))
            if (!partner) continue
            const [first, second] = partner.index < list.index ? [partner, list] : [list, partner]
            setStart(first, old.start)
            setStart(second, old.start + first.node.childCount)
            handled.add(first).add(second)
          }

          // 2. Danh sách số mới tạo, đang bắt đầu từ 1 -> nối theo danh sách số phía trên (nếu có).
          for (const list of lists) {
            if (!list.fresh || handled.has(list) || (list.node.attrs.start ?? 1) !== 1) continue
            const start = continuationStart(list.parent, list.index)
            if (start && start !== 1) setStart(list, start)
          }
          return tr.docChanged ? tr : null
        },
      }),
    ]
  },
})
