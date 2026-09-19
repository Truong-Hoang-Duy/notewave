import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Extension } from '@tiptap/react'

/**
 * Chốt chặn id khối trùng. Tiptap UniqueID chỉ sửa id trùng trong vùng vừa đổi VÀ khi nút cũ bị xoá — tách một danh sách
 * (Enter 2 lần ở giữa, nâng mục ra ngoài) cắt đôi nút nên hai nửa giữ CÙNG id. Id trùng làm neo câu hỏi Cornell mơ hồ
 * và làm hỏng việc nhận biết danh sách mới (orderedListContinuation). Quy tắc: khối xuất hiện trước giữ id, khối sau
 * nhận id mới. Phải đứng sau UniqueID và trước OrderedListContinuation trong danh sách extensions.
 */
function newId() {
  // crypto.randomUUID chỉ có trong secure context (https / localhost) — mở dev server qua IP LAN thì không có.
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
}

export const BlockIdGuard = Extension.create({
  name: 'blockIdGuard',
  addOptions() {
    return { types: [] }
  },
  addProseMirrorPlugins() {
    const types = new Set(this.options.types)
    return [
      new Plugin({
        key: new PluginKey('blockIdGuard'),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const seen = new Set()
          const tr = newState.tr
          newState.doc.descendants((node, pos) => {
            const id = node.attrs?.id
            if (!id || !types.has(node.type.name)) return true
            if (seen.has(id)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newId() })
            else seen.add(id)
            return true
          })
          return tr.docChanged ? tr : null
        },
      }),
    ]
  },
})
