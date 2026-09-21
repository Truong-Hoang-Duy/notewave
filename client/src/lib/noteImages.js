import Image from '@tiptap/extension-image'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension } from '@tiptap/react'
import { api, apiUrl, toApiPath } from './api'
import { compressImage } from './imageCompress'

/**
 * Ảnh trong ghi chú.
 * - `NoteImage`: nội dung chỉ lưu đường dẫn tương đối `/api/note-images/<id>` (ổn định, không phụ thuộc domain backend);
 *   khi hiển thị mới ghép `VITE_API_BASE_URL`, khi đọc lại từ HTML (copy/paste trong app) thì bỏ phần domain.
 * - `ImageUploadPlaceholder`: ô "Đang tải ảnh…" là decoration (không nằm trong tài liệu) -> autosave không bao giờ lưu
 *   URL tạm; vị trí được map qua mọi thay đổi nên người dùng gõ tiếp trong lúc chờ, ảnh vẫn chèn đúng chỗ.
 */
export const NoteImage = Image.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {}
    return {
      ...parent,
      src: {
        default: null,
        parseHTML: (el) => toApiPath(el.getAttribute('src')),
        renderHTML: (attrs) => ({ src: apiUrl(attrs.src) }),
      },
    }
  },
}).configure({ inline: false, allowBase64: false, HTMLAttributes: { loading: 'lazy', draggable: 'false' } })

const placeholderKey = new PluginKey('imageUploadPlaceholder')

function placeholderWidget(label) {
  const el = document.createElement('div')
  el.className = 'note-upload-placeholder'
  el.setAttribute('contenteditable', 'false')
  el.textContent = label
  return el
}

export const ImageUploadPlaceholder = Extension.create({
  name: 'imageUploadPlaceholder',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: placeholderKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            set = set.map(tr.mapping, tr.doc)
            const action = tr.getMeta(placeholderKey)
            if (action?.add) {
              const widget = Decoration.widget(action.add.pos, placeholderWidget(action.add.label), { id: action.add.id, side: -1 })
              set = set.add(tr.doc, [widget])
            } else if (action?.remove) {
              set = set.remove(set.find(undefined, undefined, (spec) => spec.id === action.remove.id))
            }
            return set
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})

function findPlaceholder(state, id) {
  const found = placeholderKey.getState(state).find(undefined, undefined, (spec) => spec.id === id)
  return found.length ? found[0].from : null
}

export const isImageFile = (file) => /^image\/(png|jpeg|webp|gif)$/.test(file?.type ?? '')

/**
 * Tải nhiều ảnh vào note tại vị trí `pos` (mặc định: con trỏ). Mỗi ảnh: nén -> tải lên -> chèn node ảnh vào chỗ ô chờ.
 * Trả số ảnh chèn thành công; lỗi từng ảnh báo qua `onError(message)`.
 */
export async function uploadImages(editor, noteId, files, { pos, onError } = {}) {
  const images = [...files].filter(isImageFile)
  const skipped = files.length - images.length
  if (skipped) onError?.(`Bỏ qua ${skipped} file không phải ảnh PNG / JPEG / WebP / GIF.`)
  let inserted = 0
  const start = pos ?? editor.state.selection.from
  const jobs = images.map((file, i) => {
    const id = `up-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`
    const label = images.length > 1 ? `Đang tải ảnh ${i + 1}/${images.length}…` : 'Đang tải ảnh…'
    editor.view.dispatch(editor.state.tr.setMeta(placeholderKey, { add: { id, pos: start, label } }))
    return (async () => {
      try {
        const compressed = await compressImage(file)
        const uploaded = await api.uploadNoteImage(noteId, compressed).promise
        if (editor.isDestroyed) return
        const at = findPlaceholder(editor.state, id)
        const chain = editor.chain().command(({ tr }) => {
          tr.setMeta(placeholderKey, { remove: { id } })
          return true
        })
        if (at !== null) {
          // insertContentAt tự tách đoạn văn khi ô chờ nằm giữa dòng chữ.
          chain.insertContentAt(at, { type: 'image', attrs: { src: uploaded.url, alt: (file.name || '').replace(/\.[^.]+$/, '') || null } })
          inserted += 1
        }
        chain.run()
      } catch (err) {
        if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(placeholderKey, { remove: { id } }))
        onError?.(`Không tải được ảnh “${file.name || 'ảnh dán'}”: ${err.message}`)
      }
    })()
  })
  await Promise.all(jobs)
  return inserted
}
