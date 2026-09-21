import { TaskItem, TaskList } from '@tiptap/extension-list'
import Mathematics from '@tiptap/extension-mathematics'
import { TableKit } from '@tiptap/extension-table'
import UniqueID from '@tiptap/extension-unique-id'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import 'katex/dist/katex.min.css'
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Code,
  Columns3,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListRestart,
  ListStart,
  Minus,
  PenLine,
  Pilcrow,
  Quote,
  Redo2,
  Rows3,
  Sigma,
  SquareCode,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { refreshNoteLibrary } from '../../hooks/useNoteLibrary'
import { api } from '../../lib/api'
import { BlockIdGuard } from '../../lib/blockIdGuard'
import { ANCHOR_TYPES, blockIdAtSelection } from '../../lib/noteEditor'
import { ImageUploadPlaceholder, isImageFile, NoteImage, uploadImages } from '../../lib/noteImages'
import { NoteLink, NoteLinkSuggestion } from '../../lib/noteLink'
import { orderedListAtSelection, OrderedListContinuation, toggleOrderedListNumbering } from '../../lib/orderedListContinuation'
import { useToast } from '../Toast'
import DrawFormulaDialog from './DrawFormulaDialog'
import MathDialog from './MathDialog'
import NoteLinkMenu from './NoteLinkMenu'

// Có Supabase Storage hay chưa (health `note_images_configured`) — hỏi 1 lần cho cả phiên làm việc.
let imagesConfigured = null
function useImagesConfigured() {
  const [value, setValue] = useState(imagesConfigured)
  useEffect(() => {
    if (imagesConfigured !== null) return
    imagesConfigured = api
      .health()
      .then((h) => Boolean(h.note_images_configured))
      .catch(() => true) // không hỏi được thì cứ cho thử, backend sẽ báo lỗi rõ ràng
    imagesConfigured.then((v) => {
      imagesConfigured = v
      setValue(v)
    })
  }, [])
  return value instanceof Promise ? null : value
}

function ToolButton({ icon: Icon, label, active, disabled, onClick }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      // Giữ focus trong editor khi bấm nút (không làm mất vùng chọn).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid size-9 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-35 ${
        active ? 'bg-[var(--note-soft)] text-[var(--note-accent)]' : 'text-[var(--note-muted)] hover:bg-[var(--note-soft)] hover:text-[var(--note-fg)]'
      }`}
    >
      <Icon className="size-[18px]" />
    </button>
  )
}

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-[var(--note-line)]" aria-hidden="true" />

function Toolbar({ editor, onImage, onMath, onDraw, onNoteLink, imagesDisabledReason }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const list = orderedListAtSelection(e.state)
      return {
        // Nút đổi cách đánh số: chỉ hiện khi con trỏ ở danh sách số đang đánh tiếp, hoặc có danh sách số phía trên để nối.
        numbering: list && (list.start !== 1 ? 'restart' : list.continuation ? 'continue' : null),
        p: e.isActive('paragraph'),
        h1: e.isActive('heading', { level: 1 }),
        h2: e.isActive('heading', { level: 2 }),
        h3: e.isActive('heading', { level: 3 }),
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        quote: e.isActive('blockquote'),
        codeBlock: e.isActive('codeBlock'),
        table: e.isActive('table'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      }
    },
  })
  const run = (fn) => () => fn(editor.chain().focus()).run()
  return (
    <>
      <div role="toolbar" aria-label="Định dạng nội dung" className="flex items-center gap-0.5 overflow-x-auto px-2 py-1.5 [scrollbar-width:none]">
        <ToolButton icon={Undo2} label="Hoàn tác (Ctrl+Z)" disabled={!s.canUndo} onClick={run((c) => c.undo())} />
        <ToolButton icon={Redo2} label="Làm lại (Ctrl+Shift+Z)" disabled={!s.canRedo} onClick={run((c) => c.redo())} />
        <Divider />
        <ToolButton icon={Pilcrow} label="Đoạn văn" active={s.p} onClick={run((c) => c.setParagraph())} />
        <ToolButton icon={Heading1} label="Tiêu đề 1" active={s.h1} onClick={run((c) => c.toggleHeading({ level: 1 }))} />
        <ToolButton icon={Heading2} label="Tiêu đề 2" active={s.h2} onClick={run((c) => c.toggleHeading({ level: 2 }))} />
        <ToolButton icon={Heading3} label="Tiêu đề 3" active={s.h3} onClick={run((c) => c.toggleHeading({ level: 3 }))} />
        <Divider />
        <ToolButton icon={Bold} label="In đậm (Ctrl+B)" active={s.bold} onClick={run((c) => c.toggleBold())} />
        <ToolButton icon={Italic} label="In nghiêng (Ctrl+I)" active={s.italic} onClick={run((c) => c.toggleItalic())} />
        <ToolButton icon={Underline} label="Gạch chân (Ctrl+U)" active={s.underline} onClick={run((c) => c.toggleUnderline())} />
        <ToolButton icon={Strikethrough} label="Gạch ngang" active={s.strike} onClick={run((c) => c.toggleStrike())} />
        <ToolButton icon={Code} label="Code trong dòng" active={s.code} onClick={run((c) => c.toggleCode())} />
        <Divider />
        <ToolButton icon={List} label="Danh sách chấm" active={s.bullet} onClick={run((c) => c.toggleBulletList())} />
        <ToolButton icon={ListOrdered} label="Danh sách số" active={s.ordered} onClick={run((c) => c.toggleOrderedList())} />
        <ToolButton icon={ListChecks} label="Danh sách việc (checklist)" active={s.task} onClick={run((c) => c.toggleTaskList())} />
        {s.numbering === 'restart' && <ToolButton icon={ListRestart} label="Đánh số lại từ 1" onClick={() => toggleOrderedListNumbering(editor)} />}
        {s.numbering === 'continue' && <ToolButton icon={ListStart} label="Đánh số tiếp theo danh sách phía trên" onClick={() => toggleOrderedListNumbering(editor)} />}
        <Divider />
        <ToolButton icon={ImagePlus} label={imagesDisabledReason || 'Chèn ảnh (hoặc dán / kéo thả ảnh vào nội dung)'} disabled={Boolean(imagesDisabledReason)} onClick={onImage} />
        <ToolButton
          icon={Table2}
          label="Chèn bảng 3×3"
          active={s.table}
          disabled={s.table}
          onClick={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}
        />
        <ToolButton icon={Sigma} label="Chèn công thức (LaTeX)" onClick={onMath} />
        <ToolButton icon={Link2} label="Liên kết tới ghi chú khác (hoặc gõ [[ )" onClick={onNoteLink} />
        <ToolButton icon={PenLine} label="Vẽ công thức bằng tay → LaTeX" onClick={onDraw} />
        <Divider />
        <ToolButton icon={Quote} label="Trích dẫn" active={s.quote} onClick={run((c) => c.toggleBlockquote())} />
        <ToolButton icon={SquareCode} label="Khối code" active={s.codeBlock} onClick={run((c) => c.toggleCodeBlock())} />
        <ToolButton icon={Minus} label="Đường kẻ ngang" onClick={run((c) => c.setHorizontalRule())} />
      </div>
      {s.table && (
        <div
          role="toolbar"
          aria-label="Thao tác với bảng"
          className="flex items-center gap-0.5 overflow-x-auto border-t border-dashed border-[var(--note-line)] px-2 py-1 [scrollbar-width:none]"
        >
          <span className="mr-1 shrink-0 text-[12px] font-medium text-[var(--note-muted)]">Bảng:</span>
          <ToolButton icon={BetweenHorizontalStart} label="Thêm hàng phía trên" onClick={run((c) => c.addRowBefore())} />
          <ToolButton icon={BetweenHorizontalEnd} label="Thêm hàng phía dưới" onClick={run((c) => c.addRowAfter())} />
          <ToolButton icon={BetweenVerticalStart} label="Thêm cột bên trái" onClick={run((c) => c.addColumnBefore())} />
          <ToolButton icon={BetweenVerticalEnd} label="Thêm cột bên phải" onClick={run((c) => c.addColumnAfter())} />
          <Divider />
          <ToolButton icon={Rows3} label="Xoá hàng đang chọn" onClick={run((c) => c.deleteRow())} />
          <ToolButton icon={Columns3} label="Xoá cột đang chọn" onClick={run((c) => c.deleteColumn())} />
          <ToolButton icon={Heading} label="Bật / tắt hàng tiêu đề" onClick={run((c) => c.toggleHeaderRow())} />
          <Divider />
          <ToolButton icon={Trash2} label="Xoá cả bảng" onClick={run((c) => c.deleteTable())} />
        </div>
      )}
    </>
  )
}

/**
 * Editor nội dung chi tiết (cột phải Cornell). Không điều khiển (uncontrolled): nội dung ban đầu lấy từ
 * `initialContent` (Tiptap JSON), sau đó chỉ báo `onChange()`; component cha đọc JSON/Markdown qua `editor`
 * lúc tự lưu. Ảnh dán / kéo thả / chọn file được tải lên Supabase Storage qua backend (`lib/noteImages.js`).
 */
export default function NoteContentEditor({ noteId, initialContent, editable = true, onReady, onChange, onActiveBlockChange }) {
  const toast = useToast()
  const imagesConfigured = useImagesConfigured()
  const [mathDialog, setMathDialog] = useState(null) // { latex, mode, pos?, editing, warning? }
  const [drawOpen, setDrawOpen] = useState(false)
  // Gợi ý liên kết [[...]]: plugin trong editor báo ra đây qua `linkHandlers` (object giữ nguyên tham chiếu cả vòng đời).
  const [linkSuggest, setLinkSuggest] = useState(null)
  const linkApi = useRef({ onChange: null, onKeyDown: null }).current
  linkApi.onChange = setLinkSuggest
  // `configure()` của Tiptap deep-clone options, nên KHÔNG truyền thẳng object rồi sửa sau (bản sao sẽ không thấy).
  // Truyền 2 hàm cố định: hàm được sao chép theo tham chiếu nên vẫn gọi tới `linkApi` mới nhất.
  const linkBridge = useRef({
    onChange: (next) => linkApi.onChange?.(next),
    onKeyDown: (event) => linkApi.onKeyDown?.(event) ?? false,
  }).current
  // Menu gợi ý đăng ký hàm xử lý phím ↑ ↓ Enter/Tab mỗi lần render (để thấy lựa chọn đang sáng mới nhất).
  const registerLinkKeys = useCallback(
    (fn) => {
      linkApi.onKeyDown = fn
      return () => {
        linkApi.onKeyDown = null
      }
    },
    [linkApi],
  )
  const fileInput = useRef(null)
  const callbacks = useRef({ onChange, onActiveBlockChange })
  const ctx = useRef({ noteId, toast, imagesConfigured, editor: null })
  useEffect(() => {
    callbacks.current = { onChange, onActiveBlockChange }
    Object.assign(ctx.current, { noteId, toast, imagesConfigured })
  })

  // Dán / thả file ảnh vào nội dung -> tải lên. Chỉ chặn khi CÓ file ảnh; còn lại để Tiptap xử lý (dán văn bản có định dạng).
  const handleFiles = (files, pos) => {
    const images = [...(files ?? [])].filter(isImageFile)
    if (!images.length) return false
    if (ctx.current.imagesConfigured === false) {
      ctx.current.toast.error('Chưa cấu hình kho lưu ảnh (Supabase Storage) nên chưa chèn được ảnh.')
      return true
    }
    uploadImages(ctx.current.editor, ctx.current.noteId, images, { pos, onError: (m) => ctx.current.toast.error(m) })
    return true
  }
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // resizable: bọc bảng trong .tableWrapper (tự cuộn ngang) + min-width = số cột × cellMinWidth -> bảng nhiều cột
      // trên điện thoại cuộn ngang thay vì bị ép hẹp tới mức chữ gãy từng ký tự; desktop kéo được độ rộng cột.
      TableKit.configure({ table: { resizable: true, cellMinWidth: 96, lastColumnResizable: false } }),
      NoteImage,
      ImageUploadPlaceholder,
      NoteLink,
      NoteLinkSuggestion.configure({ handlers: linkBridge }),
      Mathematics.configure({
        katexOptions: { throwOnError: false },
        // Bấm vào công thức có sẵn -> mở hộp thoại sửa.
        inlineOptions: { onClick: (node, pos) => setMathDialog({ latex: node.attrs.latex, mode: 'inline', pos, editing: true }) },
        blockOptions: { onClick: (node, pos) => setMathDialog({ latex: node.attrs.latex, mode: 'block', pos, editing: true }) },
      }),
      Placeholder.configure({
        placeholder: ({ editor: e }) => (e.isEmpty ? 'Ghi nội dung bài học ở đây — dùng thanh công cụ hoặc gõ "# ", "- ", "[ ] "…' : ''),
      }),
      UniqueID.configure({ types: ANCHOR_TYPES }),
      // Thứ tự quan trọng: UniqueID -> sửa id trùng (tách danh sách) -> đánh số tiếp (nhận biết danh sách mới qua id).
      BlockIdGuard.configure({ types: ANCHOR_TYPES }),
      OrderedListContinuation,
      Markdown,
    ],
    content: initialContent ?? '',
    editable,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'note-prose', spellcheck: 'true', 'aria-label': 'Nội dung chi tiết' },
      handlePaste: (view, event) => handleFiles(event.clipboardData?.files, view.state.selection.from),
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !event.dataTransfer?.files?.length) return false
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        let pos = at?.pos ?? view.state.selection.from
        // Thả ảnh xuống giữa một dòng chữ -> đặt ảnh vào ranh giới khối (trước đoạn nếu thả ở đầu đoạn, còn lại sau
        // đoạn) thay vì cắt đôi từ tại điểm thả. Dán (Ctrl+V) vẫn chèn đúng con trỏ.
        const $pos = view.state.doc.resolve(pos)
        if ($pos.parent.isTextblock && $pos.depth > 0) pos = $pos.parentOffset === 0 ? $pos.before() : $pos.after()
        const handled = handleFiles(event.dataTransfer.files, pos)
        if (handled) event.preventDefault()
        return handled
      },
    },
    onUpdate: ({ editor: e, transaction }) => {
      // UniqueID tự gán id cho khối mới bằng một transaction riêng — vẫn tính là thay đổi nội dung.
      if (transaction.docChanged) callbacks.current.onChange?.(e)
    },
    onSelectionUpdate: ({ editor: e }) => callbacks.current.onActiveBlockChange?.(blockIdAtSelection(e.state)),
    onFocus: ({ editor: e }) => callbacks.current.onActiveBlockChange?.(blockIdAtSelection(e.state)),
  })
  useEffect(() => {
    ctx.current.editor = editor
    if (editor) onReady?.(editor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  if (!editor) return null

  const submitMath = ({ latex, mode }) => {
    const d = mathDialog
    setMathDialog(null)
    const chain = editor.chain().focus()
    if (d.editing && d.pos != null) {
      const node = editor.state.doc.nodeAt(d.pos)
      const sameType = node?.type.name === (mode === 'inline' ? 'inlineMath' : 'blockMath')
      if (sameType) {
        ;(mode === 'inline' ? chain.updateInlineMath({ latex, pos: d.pos }) : chain.updateBlockMath({ latex, pos: d.pos })).run()
        return
      }
      // Đổi kiểu trong dòng <-> khối: xoá node cũ rồi chèn node mới ở cùng chỗ.
      ;(d.mode === 'inline' ? chain.deleteInlineMath({ pos: d.pos }) : chain.deleteBlockMath({ pos: d.pos })).run()
      editor.chain().focus().insertContentAt(d.pos, { type: mode === 'inline' ? 'inlineMath' : 'blockMath', attrs: { latex } }).run()
      return
    }
    ;(mode === 'inline' ? chain.insertInlineMath({ latex }) : chain.insertBlockMath({ latex })).run()
  }

  const deleteMath = () => {
    const d = mathDialog
    setMathDialog(null)
    const chain = editor.chain().focus()
    ;(d.mode === 'inline' ? chain.deleteInlineMath({ pos: d.pos }) : chain.deleteBlockMath({ pos: d.pos })).run()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editable && (
        <div className="shrink-0 border-b border-[var(--note-line)]">
          <Toolbar
            editor={editor}
            imagesDisabledReason={imagesConfigured === false ? 'Chưa cấu hình kho lưu ảnh (Supabase Storage) nên chưa chèn được ảnh' : null}
            onImage={() => fileInput.current?.click()}
            onMath={() => setMathDialog({ latex: '', mode: 'block', editing: false })}
            // Gõ hộ "[[" -> plugin gợi ý tự mở, không cần đường đi riêng cho nút này.
            onNoteLink={() => editor.chain().focus().insertContent('[[').run()}
            onDraw={() => setDrawOpen(true)}
          />
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          const files = [...e.target.files]
          e.target.value = ''
          if (files.length) handleFiles(files, editor.state.selection.from)
        }}
      />
      {/* Vùng cuộn riêng của nội dung; bấm vào khoảng trống dưới cùng thì đưa con trỏ về cuối tài liệu. */}
      <div
        className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onMouseDown={(e) => {
          const blank = e.target === e.currentTarget || e.target === e.currentTarget.firstElementChild
          if (!blank || !editor.isEditable) return
          e.preventDefault()
          editor.commands.focus('end')
        }}
      >
        <EditorContent editor={editor} className="note-content px-5 py-5 sm:px-8" />
      </div>
      {linkSuggest && (
        <NoteLinkMenu
          editor={editor}
          state={linkSuggest}
          currentNoteId={noteId}
          registerKeys={registerLinkKeys}
          onCreated={(created) => {
            refreshNoteLibrary()
            toast.success(`Đã tạo ghi chú “${created.title}” và chèn liên kết.`)
          }}
          onError={(message) => toast.error(message)}
        />
      )}
      {mathDialog && (
        <MathDialog
          initial={mathDialog}
          editing={mathDialog.editing}
          warning={mathDialog.warning}
          onSubmit={submitMath}
          onDelete={deleteMath}
          onClose={() => setMathDialog(null)}
        />
      )}
      {drawOpen && (
        <DrawFormulaDialog
          onClose={() => setDrawOpen(false)}
          onRecognized={(result) => {
            setDrawOpen(false)
            setMathDialog({
              latex: result.latex,
              mode: 'block',
              editing: false,
              warning: result.multiple
                ? 'Nhận ra nhiều hơn một công thức — có thể có phần bị đọc thừa. Kiểm tra và xoá phần không đúng trước khi chèn.'
                : 'Kiểm tra lại kết quả nhận diện (ký hiệu viết tay dễ bị đọc nhầm) rồi bấm Chèn.',
            })
          }}
        />
      )}
    </div>
  )
}
