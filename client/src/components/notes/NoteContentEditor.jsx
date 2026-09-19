import { TaskItem, TaskList } from '@tiptap/extension-list'
import UniqueID from '@tiptap/extension-unique-id'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  ListRestart,
  ListStart,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { BlockIdGuard } from '../../lib/blockIdGuard'
import { ANCHOR_TYPES, blockIdAtSelection } from '../../lib/noteEditor'
import { orderedListAtSelection, OrderedListContinuation, toggleOrderedListNumbering } from '../../lib/orderedListContinuation'

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

function Toolbar({ editor }) {
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
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      }
    },
  })
  const run = (fn) => () => fn(editor.chain().focus()).run()
  return (
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
      <ToolButton icon={Quote} label="Trích dẫn" active={s.quote} onClick={run((c) => c.toggleBlockquote())} />
      <ToolButton icon={SquareCode} label="Khối code" active={s.codeBlock} onClick={run((c) => c.toggleCodeBlock())} />
      <ToolButton icon={Minus} label="Đường kẻ ngang" onClick={run((c) => c.setHorizontalRule())} />
    </div>
  )
}

/**
 * Editor nội dung chi tiết (cột phải Cornell). Không điều khiển (uncontrolled): nội dung ban đầu lấy từ
 * `initialContent` (Tiptap JSON), sau đó chỉ báo `onChange()`; component cha đọc JSON/Markdown qua `editor`
 * lúc tự lưu.
 */
export default function NoteContentEditor({ initialContent, editable = true, onReady, onChange, onActiveBlockChange }) {
  const callbacks = useRef({ onChange, onActiveBlockChange })
  useEffect(() => {
    callbacks.current = { onChange, onActiveBlockChange }
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
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
    editorProps: { attributes: { class: 'note-prose', spellcheck: 'true', 'aria-label': 'Nội dung chi tiết' } },
    onUpdate: ({ editor: e, transaction }) => {
      // UniqueID tự gán id cho khối mới bằng một transaction riêng — vẫn tính là thay đổi nội dung.
      if (transaction.docChanged) callbacks.current.onChange?.(e)
    },
    onSelectionUpdate: ({ editor: e }) => callbacks.current.onActiveBlockChange?.(blockIdAtSelection(e.state)),
    onFocus: ({ editor: e }) => callbacks.current.onActiveBlockChange?.(blockIdAtSelection(e.state)),
  })

  useEffect(() => {
    if (editor) onReady?.(editor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  if (!editor) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editable && (
        <div className="shrink-0 border-b border-[var(--note-line)]">
          <Toolbar editor={editor} />
        </div>
      )}
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
    </div>
  )
}
