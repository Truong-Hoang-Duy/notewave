import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  Clock,
  FileAudio,
  FolderInput,
  FolderOpen,
  History,
  Layers,
  ArrowDownUp,
  Loader2,
  Mic,
  ScanText,
  Search,
  Settings2,
  Sparkles,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import GroupManagerDialog from '../components/GroupManagerDialog'
import GroupSelect from '../components/GroupSelect'
import MergeDialog from '../components/MergeDialog'
import { useToast } from '../components/Toast'
import { Button, Card, EmptyState, ErrorState } from '../components/ui'
import { groupActions, useGroups } from '../hooks/useGroups'
import { api } from '../lib/api'
import { formatDateTime, formatDuration, SOURCE_LABELS } from '../lib/format'
import { SOURCE_META } from '../lib/sources'

// Sắp xếp do backend làm (ORDER BY) để đúng với phân trang; lựa chọn được nhớ giữa các lần mở trang.
const SORT_OPTIONS = [
  ['created_desc', 'Mới nhất trước'],
  ['created_asc', 'Cũ nhất trước'],
  ['title_asc', 'Tên A → Z'],
  ['title_desc', 'Tên Z → A'],
  ['updated_desc', 'Sửa gần đây nhất'],
  ['duration_desc', 'Thời lượng dài nhất'],
  ['duration_asc', 'Thời lượng ngắn nhất'],
]
const SORT_KEY = 'notewave:history-sort'
const DEFAULT_SORT = 'created_desc'

function readSort() {
  try {
    const saved = localStorage.getItem(SORT_KEY)
    return SORT_OPTIONS.some(([value]) => value === saved) ? saved : DEFAULT_SORT
  } catch {
    return DEFAULT_SORT
  }
}

const SOURCE_FILTERS = [
  { value: '', label: 'Tất cả', short: 'Tất cả' },
  { value: 'live', label: 'Ghi âm trực tiếp', short: 'Ghi âm' },
  { value: 'upload', label: 'File tải lên', short: 'Tải lên' },
  { value: 'ocr', label: 'Tài liệu quét', short: 'Quét' },
]

function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

function Checkbox({ checked, onChange, label, disabled }) {
  return (
    <label className={`relative grid size-11 shrink-0 place-items-center ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={onChange} disabled={disabled} aria-label={label} />
      <span
        className={`grid size-[18px] place-items-center rounded-[5px] border-[1.5px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2 ${
          checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface hover:border-muted'
        }`}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
    </label>
  )
}

function SessionRow({ item, selected, selectable, onToggle, onOpen, onRestore, restoring }) {
  const meta = SOURCE_META[item.source] ?? SOURCE_META.upload
  const Icon = meta.icon
  const sourceLabel = SOURCE_LABELS[item.source] ?? item.source
  const duration = formatDuration(item.duration_ms)
  return (
    <li className={`flex items-start transition-colors ${selected ? 'bg-brand-50/50' : ''}`}>
      {selectable && (
        <div className="pt-3.5 pl-1.5 sm:pl-2">
          <Checkbox checked={selected} onChange={() => onToggle(item)} label={`Chọn phiên ${item.title}`} />
        </div>
      )}
      <button
        onClick={() => onOpen(item.id)}
        className={`group flex min-w-0 flex-1 items-start gap-4 py-4 pr-4 text-left transition-colors hover:bg-paper/70 sm:pr-5 ${selectable ? 'pl-1' : 'pl-4 sm:pl-5'}`}
      >
        <div
          className={`mt-0.5 hidden size-10 shrink-0 place-items-center rounded-xl sm:grid ${meta.iconTone}`}
          title={sourceLabel}
        >
          <Icon className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 truncate font-medium text-ink">{item.title}</h3>
            {item.merged_count > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                <Layers className="size-3" />
                Gộp {item.merged_count} phiên
              </span>
            )}
            {item.status === 'processing' && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                <Loader2 className="size-3 animate-spin" />
                Đang xử lý
              </span>
            )}
            {item.status === 'failed' && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rec-soft px-2 py-0.5 text-[11px] font-medium text-rec">
                <TriangleAlert className="size-3" />
                Lỗi
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1">
              <Icon className="size-3 sm:hidden" />
              {sourceLabel}
            </span>
            <span>{formatDateTime(item.created_at)}</span>
            {duration && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {duration}
              </span>
            )}
            {item.speaker_count > 1 && (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" />
                {item.speaker_count} người nói
              </span>
            )}
            {item.group && (
              <span className="inline-flex max-w-48 items-center gap-1 truncate font-medium text-brand-700">
                <FolderOpen className="size-3 shrink-0" />
                <span className="truncate">{item.group.name}</span>
              </span>
            )}
            {item.has_summary && (
              <span className="inline-flex items-center gap-1 text-brand-600">
                <Sparkles className="size-3" />
                Đã tóm tắt
              </span>
            )}
          </div>
          {item.preview && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-soft">{item.preview}</p>}
        </div>
        {!onRestore && <ChevronRight className="mt-3 size-4 shrink-0 text-line-strong transition-transform group-hover:translate-x-0.5 group-hover:text-muted" />}
      </button>
      {onRestore && (
        <div className="py-4 pr-4 sm:pr-5">
          <Button size="sm" icon={ArchiveRestore} onClick={() => onRestore(item)} loading={restoring}>
            <span className="hidden sm:inline">Khôi phục</span>
          </Button>
        </div>
      )}
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

function AssignMenu({ onAssign, busy }) {
  const { groups } = useGroups()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" variant="inverse" icon={FolderInput} loading={busy} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="hidden sm:inline">Gán nhóm</span>
      </Button>
      {open && (
        <div role="menu" className="absolute bottom-full left-1/2 mb-3 max-h-72 w-56 -translate-x-1/2 animate-slide-up overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-ink shadow-float">
          {groups.length === 0 && <p className="px-2.5 py-2 text-[13px] text-muted">Chưa có nhóm nào — tạo ở “Quản lý nhóm”.</p>}
          {groups.map((g) => (
            <button
              key={g.id}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onAssign(g.id)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-paper"
            >
              <FolderOpen className="size-4 shrink-0 text-brand-600" />
              <span className="truncate">{g.name}</span>
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onAssign(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted hover:bg-paper hover:text-ink"
          >
            <X className="size-4 shrink-0" />
            Gỡ khỏi nhóm
          </button>
        </div>
      )}
    </div>
  )
}

export default function HistoryPage({ onOpen, onNavigate }) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [groupId, setGroupId] = useState('')
  const [archived, setArchived] = useState(false)
  const [sort, setSort] = useState(readSort)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState(() => new Map()) // id -> item
  const [managerOpen, setManagerOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [restoringId, setRestoringId] = useState(null)
  const { groups } = useGroups()
  const debouncedQuery = useDebounced(query.trim())

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    api
      .listSessions({ q: debouncedQuery, source, groupId, archived, sort, signal: controller.signal })
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
  }, [debouncedQuery, source, groupId, archived, sort, reloadKey])

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sort)
    } catch {
      /* ignore */
    }
  }, [sort])

  // Bộ lọc thay đổi -> bỏ chọn để tránh thao tác lên phiên không còn nhìn thấy.
  useEffect(() => {
    setSelected(new Map())
  }, [debouncedQuery, source, groupId, archived])

  // Nhóm đang lọc bị xoá ở hộp thoại quản lý -> quay về "Tất cả nhóm".
  useEffect(() => {
    if (groupId && groupId !== 'none' && groups.length && !groups.some((g) => g.id === groupId)) setGroupId('')
  }, [groups, groupId])

  const hasProcessing = data?.items.some((i) => i.status === 'processing')
  useEffect(() => {
    if (!hasProcessing) return
    const id = setInterval(() => setReloadKey((k) => k + 1), 8000)
    return () => clearInterval(id)
  }, [hasProcessing])

  const filtering = Boolean(debouncedQuery || source || groupId)
  const items = useMemo(() => data?.items ?? [], [data])
  const selectedItems = [...selected.values()]
  const canMerge = selectedItems.length >= 2 && selectedItems.every((i) => i.status === 'completed')
  const allVisibleSelected = items.length > 0 && items.every((i) => selected.has(i.id))

  const toggle = (item) =>
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.set(item.id, item)
      return next
    })

  const toggleAll = () => setSelected(allVisibleSelected ? new Map() : new Map(items.map((i) => [i.id, i])))

  const assign = async (targetGroupId) => {
    setAssigning(true)
    try {
      await groupActions.assign([...selected.keys()], targetGroupId)
      const name = groups.find((g) => g.id === targetGroupId)?.name
      toast.success(targetGroupId ? `Đã chuyển ${selected.size} phiên vào “${name}”.` : `Đã gỡ ${selected.size} phiên khỏi nhóm.`)
      setSelected(new Map())
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAssigning(false)
    }
  }

  const restore = async (item) => {
    setRestoringId(item.id)
    try {
      await api.restoreSession(item.id)
      toast.success(`Đã khôi phục “${item.title}”.`)
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{archived ? 'Phiên đã lưu trữ' : 'Lịch sử ghi chú'}</h1>
          <p className="mt-1 text-[15px] text-muted">
            {data && !error
              ? `${data.total} phiên${filtering ? ' phù hợp' : ''}`
              : archived
                ? 'Các phiên gốc đã được gộp vào phiên khác'
                : 'Tất cả phiên ghi âm và file đã chuyển thành văn bản'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={archived ? 'primary' : 'ghost'} icon={Archive} onClick={() => setArchived((a) => !a)} aria-pressed={archived}>
            Đã lưu trữ
          </Button>
          <Button size="sm" icon={Settings2} onClick={() => setManagerOpen(true)}>
            Quản lý nhóm
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tên hoặc nội dung transcript…"
            className="h-11 w-full rounded-xl border border-line bg-surface pr-10 pl-10 text-sm text-ink shadow-card outline-none transition placeholder:text-muted/80 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 [&::-webkit-search-cancel-button]:hidden"
            aria-label="Tìm kiếm phiên ghi chú"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Xoá tìm kiếm">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex rounded-xl border border-line bg-sunken/60 p-1" role="tablist" aria-label="Lọc theo nguồn">
            {SOURCE_FILTERS.map((f) => (
              <button
                key={f.value}
                role="tab"
                aria-selected={source === f.value}
                onClick={() => setSource(f.value)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-all duration-150 sm:flex-none ${
                  source === f.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
                }`}
              >
                <span className="sm:hidden">{f.short}</span>
                <span className="hidden sm:inline">{f.label}</span>
              </button>
            ))}
          </div>
          <GroupSelect
            value={groupId}
            onChange={setGroupId}
            extraOptions={[
              ['', 'Tất cả nhóm'],
              ['none', 'Chưa phân nhóm'],
            ]}
            className="sm:w-52"
            ariaLabel="Lọc theo nhóm"
          />
          <div className="relative sm:w-52">
            <ArrowDownUp className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sắp xếp danh sách"
              className="h-10 w-full cursor-pointer appearance-none truncate rounded-xl border border-line bg-surface pr-9 pl-9 text-[13px] font-medium text-ink-soft shadow-card outline-none transition hover:border-line-strong focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
            >
              {SORT_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <svg className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden">
        {!archived && items.length > 0 && !error && (
          <div className="flex items-center border-b border-line bg-paper/50 pr-4 pl-1.5 text-[13px] text-muted sm:pl-2">
            <Checkbox checked={allVisibleSelected} onChange={toggleAll} label="Chọn tất cả phiên đang hiển thị" />
            <span className="pl-1">{selected.size ? `Đã chọn ${selected.size} phiên` : 'Chọn nhiều phiên để gộp hoặc gán nhóm'}</span>
          </div>
        )}
        {error ? (
          <ErrorState title="Không tải được lịch sử" message={error.message} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : loading && !data ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          archived ? (
            <EmptyState icon={Archive} title="Không có phiên lưu trữ nào" description="Khi gộp phiên và chọn “Lưu trữ bản gốc”, các phiên gốc sẽ nằm ở đây.">
              <Button onClick={() => setArchived(false)}>Về lịch sử</Button>
            </EmptyState>
          ) : filtering ? (
            <EmptyState
              icon={Search}
              title="Không tìm thấy phiên nào"
              description={debouncedQuery ? `Không có phiên nào khớp với “${debouncedQuery}”.` : 'Chưa có phiên nào khớp bộ lọc này.'}
            >
              <Button
                onClick={() => {
                  setQuery('')
                  setSource('')
                  setGroupId('')
                }}
              >
                Xoá bộ lọc
              </Button>
            </EmptyState>
          ) : (
            <EmptyState icon={History} title="Chưa có phiên ghi chú nào" description="Ghi âm cuộc họp, tải lên file ghi âm hoặc quét tài liệu — nội dung sẽ được lưu tại đây.">
              <Button variant="primary" icon={Mic} onClick={() => onNavigate('live')}>
                Bắt đầu ghi âm
              </Button>
              <Button icon={FileAudio} onClick={() => onNavigate('upload')}>
                Tải audio
              </Button>
              <Button icon={ScanText} onClick={() => onNavigate('scan')}>
                Quét tài liệu
              </Button>
            </EmptyState>
          )
        ) : (
          <ul className={`divide-y divide-line transition-opacity duration-150 ${loading ? 'opacity-60' : ''}`}>
            {items.map((item) => (
              <SessionRow
                key={item.id}
                item={item}
                selectable={!archived}
                selected={selected.has(item.id)}
                onToggle={toggle}
                onOpen={onOpen}
                onRestore={archived ? restore : undefined}
                restoring={restoringId === item.id}
              />
            ))}
          </ul>
        )}
      </Card>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6">
          <div role="toolbar" aria-label="Thao tác với phiên đã chọn" className="flex animate-slide-up items-center gap-1 rounded-2xl bg-ink py-1.5 pr-1.5 pl-4 text-white shadow-float">
            <span className="mr-2 text-sm font-medium whitespace-nowrap tabular-nums">{selected.size} đã chọn</span>
            <AssignMenu onAssign={assign} busy={assigning} />
            <Button
              size="sm"
              variant="primary"
              icon={Layers}
              onClick={() => setMergeOpen(true)}
              disabled={!canMerge}
              title={canMerge ? 'Gộp các phiên đã chọn' : 'Chọn ít nhất 2 phiên đã có transcript hoàn chỉnh'}
            >
              Gộp
            </Button>
            <button onClick={() => setSelected(new Map())} className="ml-1 rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Bỏ chọn tất cả">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <GroupManagerDialog
        open={managerOpen}
        onClose={() => {
          setManagerOpen(false)
          setReloadKey((k) => k + 1)
        }}
      />
      <MergeDialog
        open={mergeOpen}
        items={selectedItems}
        onClose={() => setMergeOpen(false)}
        onMerged={(merged) => {
          setMergeOpen(false)
          setSelected(new Map())
          toast.success(`Đã gộp thành “${merged.title}”.`)
          onOpen(merged.id)
        }}
      />
    </div>
  )
}
