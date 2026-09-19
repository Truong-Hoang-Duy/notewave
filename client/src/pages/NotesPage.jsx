import {
  ArrowDownUp,
  ChevronRight,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Hash,
  Inbox,
  ListTree,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import FolderSelect from '../components/notes/FolderSelect'
import NameDialog from '../components/notes/NameDialog'
import { useDismiss } from '../components/notes/useDismiss'
import { useToast } from '../components/Toast'
import { Button, Card, EmptyState, ErrorState } from '../components/ui'
import { buildFolderTree, folderPath, noteLibraryActions, useNoteLibrary } from '../hooks/useNoteLibrary'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'

const SORT_OPTIONS = [
  ['updated_desc', 'Sửa gần đây nhất'],
  ['created_desc', 'Mới tạo trước'],
  ['created_asc', 'Cũ nhất trước'],
  ['title_asc', 'Tên A → Z'],
  ['title_desc', 'Tên Z → A'],
]
const SORT_KEY = 'notewave:notes-sort'

function readSort() {
  try {
    const saved = localStorage.getItem(SORT_KEY)
    return SORT_OPTIONS.some(([v]) => v === saved) ? saved : 'updated_desc'
  } catch {
    return 'updated_desc'
  }
}

// Bộ lọc thư mục/tag được giữ trong bộ nhớ khi mở một note rồi quay lại danh sách (không lưu qua lần tải trang).
const lastView = { folderId: '', tagId: '', expanded: new Set() }

function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

function RowMenu({ label, items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useDismiss(ref, open, () => setOpen(false))
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`grid size-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'}`}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-30 mt-1 w-52 animate-fade-in rounded-xl border border-line bg-surface p-1.5 shadow-float">
          {items.map(({ icon: Icon, label: text, onClick, danger }) => (
            <button
              key={text}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onClick()
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] ${danger ? 'text-rec hover:bg-rec-soft' : 'hover:bg-paper'}`}
            >
              <Icon className="size-4 shrink-0" /> {text}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SidebarItem({ icon: Icon, label, count, active, depth = 0, onClick, expander, menu }) {
  return (
    <div
      className={`group flex items-center rounded-lg pr-1 transition-colors ${active ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-sunken/70'}`}
      style={{ paddingLeft: `${0.25 + depth * 0.9}rem` }}
    >
      {expander ?? <span className="w-6 shrink-0" />}
      <button type="button" onClick={onClick} aria-current={active || undefined} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-[13.5px] font-medium">
        <Icon className={`size-4 shrink-0 ${active ? 'text-brand-600' : 'text-muted'}`} />
        <span className="truncate">{label}</span>
        {count > 0 && <span className="ml-auto pl-1 text-[11.5px] text-muted tabular-nums">{count}</span>}
      </button>
      {menu}
    </div>
  )
}

function FolderNodes({ nodes, selected, onSelect, expanded, onToggle, onAction }) {
  return nodes.map(({ folder, depth, children }) => {
    const open = expanded.has(folder.id)
    return (
      <div key={folder.id}>
        <SidebarItem
          icon={open && children.length ? FolderOpen : Folder}
          label={folder.name}
          count={folder.note_count}
          depth={depth}
          active={selected === folder.id}
          onClick={() => onSelect(folder.id)}
          expander={
            children.length ? (
              <button
                type="button"
                onClick={() => onToggle(folder.id)}
                aria-label={open ? `Thu gọn ${folder.name}` : `Mở rộng ${folder.name}`}
                aria-expanded={open}
                className="grid size-6 shrink-0 place-items-center rounded text-muted hover:text-ink"
              >
                <ChevronRight className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
            ) : undefined
          }
          menu={
            <RowMenu
              label={`Thao tác với thư mục ${folder.name}`}
              items={[
                { icon: FolderPlus, label: 'Thêm thư mục con', onClick: () => onAction('create-child', folder) },
                { icon: Pencil, label: 'Đổi tên', onClick: () => onAction('rename', folder) },
                { icon: FolderInput, label: 'Chuyển tới…', onClick: () => onAction('move', folder) },
                { icon: Trash2, label: 'Xoá thư mục', onClick: () => onAction('delete', folder), danger: true },
              ]}
            />
          }
        />
        {open && children.length > 0 && (
          <FolderNodes nodes={children} selected={selected} onSelect={onSelect} expanded={expanded} onToggle={onToggle} onAction={onAction} />
        )}
      </div>
    )
  })
}

function MoveFolderDialog({ folder, onClose }) {
  const toast = useToast()
  const [target, setTarget] = useState(folder.parent_id ?? '')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await noteLibraryActions.moveFolder(folder.id, target || null)
      toast.success(`Đã chuyển thư mục “${folder.name}”.`)
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      title={`Chuyển thư mục “${folder.name}”`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Chuyển
          </Button>
        </>
      }
    >
      <FolderSelect value={target} onChange={setTarget} rootLabel="(Thư mục gốc)" excludeId={folder.id} ariaLabel="Thư mục cha mới" />
      <p className="mt-2 text-[12.5px] text-muted">Thư mục con và ghi chú bên trong được chuyển theo.</p>
    </Modal>
  )
}

function NoteRow({ item, folders, onOpen }) {
  const path = item.folder ? folderPath(folders, item.folder.id) || item.folder.name : null
  return (
    <li>
      <button onClick={() => onOpen(item.id)} className="group flex w-full items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-paper/70 sm:px-5">
        <div className="mt-0.5 hidden size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 sm:grid">
          <NotebookPen className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-ink">{item.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
            <span>Sửa {formatDateTime(item.updated_at).toLowerCase()}</span>
            {path && (
              <span className="inline-flex max-w-60 items-center gap-1 truncate font-medium text-brand-700">
                <Folder className="size-3 shrink-0" />
                <span className="truncate">{path}</span>
              </span>
            )}
            {item.cue_count > 0 && (
              <span className="inline-flex items-center gap-1">
                <ListTree className="size-3" />
                {item.cue_count} câu hỏi
              </span>
            )}
          </div>
          {item.preview && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-soft">{item.preview}</p>}
          {item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.tags.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-0.5 rounded-full bg-sunken px-2 py-0.5 text-[11.5px] font-medium text-ink-soft">
                  <Hash className="size-3" />
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <ChevronRight className="mt-3 size-4 shrink-0 text-line-strong transition-transform group-hover:translate-x-0.5 group-hover:text-muted" />
      </button>
    </li>
  )
}

function ListSkeleton() {
  return (
    <ul aria-busy="true" className="divide-y divide-line">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="flex gap-4 px-5 py-4">
          <div className="skeleton size-10 rounded-xl" />
          <div className="flex-1 space-y-2.5 pt-1">
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-3 w-1/3" />
            <div className="skeleton h-3.5 w-5/6" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function NotesPage({ onOpen }) {
  const toast = useToast()
  const { folders, tags, loaded: libraryLoaded } = useNoteLibrary()
  const [query, setQuery] = useState('')
  const [folderId, setFolderIdState] = useState(lastView.folderId)
  const [tagId, setTagIdState] = useState(lastView.tagId)
  const [expanded, setExpanded] = useState(() => new Set(lastView.expanded))
  const [sort, setSort] = useState(readSort)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [dialog, setDialog] = useState(null) // { kind, folder?, tag? }
  const [deleting, setDeleting] = useState(false)
  const debouncedQuery = useDebounced(query.trim())

  const setFolderId = (v) => {
    lastView.folderId = v
    setFolderIdState(v)
  }
  const setTagId = (v) => {
    lastView.tagId = v
    setTagIdState(v)
  }
  const toggleExpanded = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      lastView.expanded = next
      return next
    })

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    api
      .listNotes({ q: debouncedQuery, folderId, tagId, sort, signal: controller.signal })
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setError(err)
        setLoading(false)
      })
    return () => controller.abort()
  }, [debouncedQuery, folderId, tagId, sort, reloadKey])

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sort)
    } catch {
      /* ignore */
    }
  }, [sort])

  // Thư mục / tag đang lọc bị xoá ở nơi khác -> bỏ lọc.
  useEffect(() => {
    if (!libraryLoaded) return
    if (folderId && folderId !== 'none' && !folders.some((f) => f.id === folderId)) setFolderId('')
    if (tagId && !tags.some((t) => t.id === tagId)) setTagId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryLoaded, folders, tags])

  const tree = useMemo(() => buildFolderTree(folders), [folders])
  const items = data?.items ?? []
  const filtering = Boolean(debouncedQuery || folderId || tagId)
  const currentFolder = folders.find((f) => f.id === folderId)
  const currentTag = tags.find((t) => t.id === tagId)
  const heading = currentFolder ? folderPath(folders, currentFolder.id) : folderId === 'none' ? 'Không thuộc thư mục' : 'Tất cả ghi chú'

  const createNote = async () => {
    setCreating(true)
    try {
      const note = await api.createNote({
        folder_id: currentFolder ? currentFolder.id : null,
        tag_ids: currentTag ? [currentTag.id] : [],
      })
      if (currentFolder || currentTag) noteLibraryActions.refresh()
      onOpen(note.id)
    } catch (err) {
      toast.error(err.message)
      setCreating(false)
    }
  }

  const onFolderAction = (kind, folder) => setDialog({ kind, folder })

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      if (dialog.kind === 'delete') {
        await noteLibraryActions.deleteFolder(dialog.folder.id)
        if (folderId === dialog.folder.id) setFolderId(dialog.folder.parent_id ?? '')
        toast.success(`Đã xoá thư mục “${dialog.folder.name}”.`)
      } else {
        await noteLibraryActions.deleteTag(dialog.tag.id)
        if (tagId === dialog.tag.id) setTagId('')
        toast.success(`Đã xoá tag “${dialog.tag.name}”.`)
      }
      setDialog(null)
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const selectFolder = (id) => {
    setFolderId(id)
    // Mở rộng các thư mục cha để thấy mục đang chọn.
    let parent = folders.find((f) => f.id === id)?.parent_id
    if (parent) {
      const next = new Set(expanded)
      while (parent) {
        next.add(parent)
        parent = folders.find((f) => f.id === parent)?.parent_id
      }
      lastView.expanded = next
      setExpanded(next)
    }
  }

  const sidebar = (
    <nav aria-label="Thư mục và tag" className="space-y-5">
      <div>
        <div className="mb-1.5 flex items-center justify-between px-1">
          <h2 className="text-[11.5px] font-semibold tracking-[0.08em] text-muted uppercase">Thư mục</h2>
          <button
            type="button"
            onClick={() => setDialog({ kind: 'create-root' })}
            className="grid size-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
            aria-label="Tạo thư mục"
            title="Tạo thư mục"
          >
            <FolderPlus className="size-4" />
          </button>
        </div>
        <SidebarItem icon={NotebookPen} label="Tất cả ghi chú" active={!folderId} onClick={() => setFolderId('')} />
        <SidebarItem icon={Inbox} label="Không thuộc thư mục" active={folderId === 'none'} onClick={() => setFolderId('none')} />
        <FolderNodes nodes={tree} selected={folderId} onSelect={selectFolder} expanded={expanded} onToggle={toggleExpanded} onAction={onFolderAction} />
      </div>
      <div>
        <h2 className="mb-1.5 px-1 text-[11.5px] font-semibold tracking-[0.08em] text-muted uppercase">Tag</h2>
        {tags.length === 0 && <p className="px-1 text-[12.5px] leading-relaxed text-muted">Chưa có tag. Thêm tag trong trang ghi chú.</p>}
        {tags.map((t) => (
          <SidebarItem
            key={t.id}
            icon={Hash}
            label={t.name}
            count={t.note_count}
            active={tagId === t.id}
            onClick={() => setTagId(tagId === t.id ? '' : t.id)}
            menu={
              <RowMenu
                label={`Thao tác với tag ${t.name}`}
                items={[
                  { icon: Pencil, label: 'Đổi tên', onClick: () => setDialog({ kind: 'rename-tag', tag: t }) },
                  { icon: Trash2, label: 'Xoá tag', onClick: () => setDialog({ kind: 'delete-tag', tag: t }), danger: true },
                ]}
              />
            }
          />
        ))}
      </div>
    </nav>
  )

  return (
    <div className="grid gap-6 pb-20 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100svh-7rem)] overflow-y-auto pr-1 scroll-area">{sidebar}</div>
      </aside>

      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{heading}</h1>
            <p className="mt-1 text-[15px] text-muted">
              {data && !error ? `${data.total} ghi chú${filtering ? ' phù hợp' : ''}` : 'Ghi chú học tập theo phương pháp Cornell'}
            </p>
          </div>
          <Button variant="primary" icon={Plus} loading={creating} onClick={createNote}>
            Ghi chú mới
          </Button>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tiêu đề, câu hỏi, nội dung, tóm tắt…"
              className="h-11 w-full rounded-xl border border-line bg-surface pr-10 pl-10 text-sm text-ink shadow-card outline-none transition placeholder:text-muted/80 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 [&::-webkit-search-cancel-button]:hidden"
              aria-label="Tìm kiếm ghi chú"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Xoá tìm kiếm">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {/* Dưới lg: sidebar ẩn -> chọn thư mục bằng dropdown, cạnh đó là nút tạo / thao tác thư mục */}
            <div className="flex gap-2 lg:hidden">
              <FolderSelect
                value={folderId}
                onChange={selectFolder}
                extraOptions={[['', 'Tất cả thư mục']]}
                className="min-w-0 flex-1 sm:w-56 sm:flex-none"
                ariaLabel="Lọc theo thư mục"
              />
              <Button size="sm" icon={FolderPlus} onClick={() => setDialog({ kind: 'create-root' })} className="h-9 w-9 px-0" aria-label="Tạo thư mục" title="Tạo thư mục" />
              {currentFolder && (
                <Button
                  size="sm"
                  icon={MoreHorizontal}
                  onClick={() => setDialog({ kind: 'folder-menu', folder: currentFolder })}
                  className="h-9 w-9 px-0"
                  aria-label="Thao tác với thư mục đang chọn"
                />
              )}
            </div>
            <div className="relative sm:ml-auto sm:w-52">
              <ArrowDownUp className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sắp xếp danh sách ghi chú"
                className="h-9 w-full cursor-pointer appearance-none truncate rounded-xl border border-line bg-surface pr-9 pl-9 text-[13px] font-medium text-ink-soft shadow-card outline-none transition hover:border-line-strong focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              >
                {SORT_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {tags.length > 0 && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden">
              {tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTagId(tagId === t.id ? '' : t.id)}
                  aria-pressed={tagId === t.id}
                  className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[12.5px] font-medium transition-colors ${
                    tagId === t.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface text-ink-soft'
                  }`}
                >
                  <Hash className="size-3" />
                  {t.name}
                </button>
              ))}
            </div>
          )}
          {currentTag && (
            <div className="hidden items-center gap-2 text-[13px] text-muted lg:flex">
              Đang lọc tag
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pr-1 pl-2.5 font-medium text-brand-700">
                <Hash className="size-3" />
                {currentTag.name}
                <button onClick={() => setTagId('')} className="grid size-5 place-items-center rounded-full hover:bg-brand-100" aria-label="Bỏ lọc tag">
                  <X className="size-3" />
                </button>
              </span>
            </div>
          )}
        </div>

        <Card className="overflow-hidden">
          {error ? (
            <ErrorState title="Không tải được ghi chú" message={error.message} onRetry={() => setReloadKey((k) => k + 1)} />
          ) : loading && !data ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            filtering ? (
              <EmptyState
                icon={Search}
                title="Không có ghi chú nào"
                description={debouncedQuery ? `Không có ghi chú nào khớp với “${debouncedQuery}”.` : 'Chưa có ghi chú nào ở đây.'}
              >
                <Button variant="primary" icon={Plus} onClick={createNote} loading={creating}>
                  Tạo ghi chú ở đây
                </Button>
                <Button
                  onClick={() => {
                    setQuery('')
                    setFolderId('')
                    setTagId('')
                  }}
                >
                  Xoá bộ lọc
                </Button>
              </EmptyState>
            ) : (
              <EmptyState
                icon={NotebookPen}
                title="Chưa có ghi chú nào"
                description="Ghi chú theo phương pháp Cornell: câu hỏi gợi nhớ ở cột trái, nội dung chi tiết bên phải, tóm tắt ở cuối trang."
              >
                <Button variant="primary" icon={Plus} onClick={createNote} loading={creating}>
                  Tạo ghi chú đầu tiên
                </Button>
              </EmptyState>
            )
          ) : (
            <ul className={`divide-y divide-line transition-opacity duration-150 ${loading ? 'opacity-60' : ''}`}>
              {items.map((item) => (
                <NoteRow key={item.id} item={item} folders={folders} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <NameDialog
        open={dialog?.kind === 'create-root' || dialog?.kind === 'create-child'}
        title={dialog?.kind === 'create-child' ? `Thư mục con trong “${dialog.folder.name}”` : 'Tạo thư mục'}
        label="Tên thư mục"
        submitLabel="Tạo thư mục"
        onSubmit={async (name) => {
          const parent = dialog.kind === 'create-child' ? dialog.folder : null
          const created = await noteLibraryActions.createFolder(name, parent?.id ?? null)
          if (parent) {
            const next = new Set(expanded).add(parent.id)
            lastView.expanded = next
            setExpanded(next)
          }
          setFolderId(created.id)
        }}
        onClose={() => setDialog(null)}
      />
      <NameDialog
        open={dialog?.kind === 'rename'}
        title="Đổi tên thư mục"
        label="Tên thư mục"
        initialName={dialog?.folder?.name ?? ''}
        onSubmit={(name) => noteLibraryActions.renameFolder(dialog.folder.id, name).then(() => setReloadKey((k) => k + 1))}
        onClose={() => setDialog(null)}
      />
      <NameDialog
        open={dialog?.kind === 'rename-tag'}
        title="Đổi tên tag"
        label="Tên tag"
        maxLength={50}
        initialName={dialog?.tag?.name ?? ''}
        onSubmit={(name) => noteLibraryActions.renameTag(dialog.tag.id, name).then(() => setReloadKey((k) => k + 1))}
        onClose={() => setDialog(null)}
      />
      {dialog?.kind === 'move' && (
        <MoveFolderDialog
          folder={dialog.folder}
          onClose={() => {
            setDialog(null)
            setReloadKey((k) => k + 1)
          }}
        />
      )}
      {dialog?.kind === 'folder-menu' && (
        <Modal open title={`Thư mục “${dialog.folder.name}”`} onClose={() => setDialog(null)}>
          <div className="-mx-2 space-y-0.5">
            {[
              { icon: FolderPlus, label: 'Thêm thư mục con', kind: 'create-child' },
              { icon: Pencil, label: 'Đổi tên', kind: 'rename' },
              { icon: FolderInput, label: 'Chuyển tới…', kind: 'move' },
              { icon: Trash2, label: 'Xoá thư mục', kind: 'delete', danger: true },
            ].map((a) => (
              <button
                key={a.kind}
                onClick={() => setDialog({ kind: a.kind, folder: dialog.folder })}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${a.danger ? 'text-rec hover:bg-rec-soft' : 'hover:bg-paper'}`}
              >
                <a.icon className="size-4" /> {a.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
      <ConfirmDialog
        open={dialog?.kind === 'delete' || dialog?.kind === 'delete-tag'}
        title={dialog?.kind === 'delete-tag' ? `Xoá tag “${dialog?.tag?.name}”?` : `Xoá thư mục “${dialog?.folder?.name}”?`}
        description={
          dialog?.kind === 'delete-tag'
            ? 'Tag sẽ được gỡ khỏi mọi ghi chú. Ghi chú không bị xoá.'
            : 'Ghi chú và thư mục con bên trong sẽ được chuyển lên thư mục cha (hoặc ra ngoài cùng). Không ghi chú nào bị xoá.'
        }
        confirmLabel="Xoá"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDialog(null)}
      />
    </div>
  )
}
