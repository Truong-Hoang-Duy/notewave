import { ArrowDown, ArrowUp, Camera, GripVertical, UploadCloud, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatBytes } from '../lib/format'
import { Button, InlineAlert } from './ui'

let nextId = 0
const fileKey = (file) => `${file.name}:${file.size}:${file.lastModified}`

/**
 * Chọn nhiều file: kéo thả / chọn từ thiết bị / (tuỳ chọn) chụp ảnh, xem danh sách, xoá từng file,
 * (tuỳ chọn) sắp xếp thứ tự bằng kéo thả hoặc nút mũi tên. Dùng chung cho "Tải file lên" và "Quét tài liệu".
 * `items`: [{ id, file }] — component cha giữ state.
 */
export default function FilePicker({
  items,
  onChange,
  accept,
  validate,
  maxFiles = 20,
  dropHint,
  fileIcon: FileIcon,
  fileIconTone,
  reorderable = false,
  camera = false,
  thumbnails = false,
  disabled = false,
  children,
}) {
  const inputRef = useRef(null)
  const cameraRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState([]) // [{ name, reason }]
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const previews = usePreviews(items, thumbnails)

  const add = (fileList) => {
    const incoming = [...(fileList ?? [])]
    if (!incoming.length) return
    const seen = new Set(items.map((i) => fileKey(i.file)))
    const accepted = []
    const errors = []
    for (const file of incoming) {
      const reason = validate(file)
      if (reason) errors.push({ name: file.name, reason })
      else if (seen.has(fileKey(file))) errors.push({ name: file.name, reason: 'Đã có trong danh sách.' })
      else if (items.length + accepted.length >= maxFiles) errors.push({ name: file.name, reason: `Vượt quá ${maxFiles} file mỗi lần.` })
      else {
        seen.add(fileKey(file))
        accepted.push({ id: `f${++nextId}`, file })
      }
    }
    setRejected(errors)
    if (accepted.length) onChange([...items, ...accepted])
  }

  const move = (from, to) => {
    if (to < 0 || to >= items.length || from === to) return
    const next = [...items]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  const remove = (id) => {
    setRejected([])
    onChange(items.filter((i) => i.id !== id))
  }

  const openPicker = () => !disabled && inputRef.current?.click()
  const totalBytes = items.reduce((sum, i) => sum + i.file.size, 0)
  const full = items.length >= maxFiles

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || full}
        onClick={openPicker}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openPicker())}
        onDragOver={(e) => {
          // Chỉ phản ứng khi kéo file từ máy vào (không phải kéo sắp xếp trong danh sách).
          if (disabled || !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (disabled || !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragging(false)
          add(e.dataTransfer.files)
        }}
        className={`flex animate-fade-in flex-col items-center rounded-2xl border-2 border-dashed px-6 text-center transition-[background-color,border-color,padding] duration-200 ${
          items.length ? 'py-8' : 'py-14 sm:py-16'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${
          dragging ? 'border-brand-500 bg-brand-50' : 'border-line-strong bg-surface hover:border-brand-200 hover:bg-brand-50/40'
        }`}
      >
        <div className={`grid size-14 place-items-center rounded-2xl transition-transform duration-200 ${dragging ? 'scale-110 bg-brand-100 text-brand-700' : 'bg-brand-50 text-brand-600'}`}>
          <UploadCloud className="size-7" />
        </div>
        <p className="mt-5 font-medium text-ink">
          <span className="hidden sm:inline">Kéo thả {items.length ? 'thêm ' : ''}file vào đây hoặc </span>
          <span className="text-brand-600 underline decoration-brand-200 underline-offset-4">
            {items.length ? 'chọn thêm file' : 'chọn file từ thiết bị'}
          </span>
        </p>
        <p className="mt-1.5 text-[13px] text-muted">
          {dropHint} · tối đa {maxFiles} file mỗi lần
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept={accept}
          onChange={(e) => {
            add(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {camera && (
        // Chỉ hiện trên thiết bị cảm ứng: mở thẳng camera sau, mỗi lần chụp thêm 1 trang vào danh sách.
        <div className="hidden pointer-coarse:block">
          <Button icon={Camera} className="w-full" size="lg" disabled={disabled || full} onClick={() => cameraRef.current?.click()}>
            {items.length ? 'Chụp thêm trang' : 'Chụp ảnh tài liệu'}
          </Button>
          <input
            ref={cameraRef}
            type="file"
            className="hidden"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              add(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {rejected.length > 0 && (
        <InlineAlert tone="warn">
          <p className="font-medium">Bỏ qua {rejected.length} file:</p>
          <ul className="mt-1 space-y-0.5 text-[13px]">
            {rejected.slice(0, 5).map((r, i) => (
              <li key={i} className="break-words">
                <span className="font-medium">{r.name}</span> — {r.reason}
              </li>
            ))}
            {rejected.length > 5 && <li>…và {rejected.length - 5} file khác.</li>}
          </ul>
        </InlineAlert>
      )}

      {items.length > 0 && (
        <div className="animate-slide-up overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="text-[13px] text-muted">
              <span className="font-semibold text-ink">{items.length} file</span> · {formatBytes(totalBytes)}
              {reorderable && items.length > 1 && <span className="hidden sm:inline"> · kéo thả hoặc dùng mũi tên để sắp xếp thứ tự</span>}
            </p>
            <Button size="sm" variant="ghost" onClick={() => (setRejected([]), onChange([]))} disabled={disabled}>
              Bỏ chọn tất cả
            </Button>
          </div>
          <ol className="max-h-[26rem] divide-y divide-line overflow-y-auto overscroll-contain">
            {items.map((item, index) => (
              <li
                key={item.id}
                draggable={reorderable && !disabled && items.length > 1}
                onDragStart={(e) => {
                  setDragIndex(index)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', item.id)
                }}
                onDragOver={(e) => {
                  if (dragIndex === null) return
                  e.preventDefault()
                  setOverIndex(index)
                }}
                onDrop={(e) => {
                  if (dragIndex === null) return
                  e.preventDefault()
                  move(dragIndex, index)
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                className={`flex items-center gap-3 px-3 py-2.5 transition-colors sm:px-4 ${dragIndex === index ? 'opacity-40' : ''} ${
                  overIndex === index && dragIndex !== index ? 'bg-brand-50' : ''
                }`}
              >
                {reorderable && items.length > 1 && (
                  <GripVertical className="hidden size-4 shrink-0 cursor-grab text-muted sm:block" aria-hidden="true" />
                )}
                {reorderable && (
                  <span className="w-5 shrink-0 text-center font-mono text-[12px] text-muted tabular-nums">{index + 1}</span>
                )}
                {previews.get(item.id) ? (
                  <img src={previews.get(item.id)} alt="" className="size-11 shrink-0 rounded-lg border border-line object-cover" />
                ) : (
                  <div className={`grid size-11 shrink-0 place-items-center rounded-lg ${fileIconTone}`}>
                    <FileIcon className="size-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.file.name}</p>
                  <p className="text-[12.5px] text-muted">{formatBytes(item.file.size)}</p>
                </div>
                <div className="flex shrink-0 items-center">
                  {reorderable && items.length > 1 && (
                    <>
                      <IconButton label="Chuyển lên" icon={ArrowUp} onClick={() => move(index, index - 1)} disabled={disabled || index === 0} />
                      <IconButton label="Chuyển xuống" icon={ArrowDown} onClick={() => move(index, index + 1)} disabled={disabled || index === items.length - 1} />
                    </>
                  )}
                  <IconButton label={`Bỏ ${item.file.name}`} icon={X} onClick={() => remove(item.id)} disabled={disabled} danger />
                </div>
              </li>
            ))}
          </ol>
          {children && <div className="border-t border-line bg-paper/60 px-4 py-3">{children}</div>}
        </div>
      )}
    </div>
  )
}

function IconButton({ label, icon: Icon, onClick, disabled, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid size-9 place-items-center rounded-lg text-muted transition-colors disabled:pointer-events-none disabled:opacity-30 ${
        danger ? 'hover:bg-rec-soft hover:text-rec' : 'hover:bg-sunken hover:text-ink'
      }`}
    >
      <Icon className="size-4" />
    </button>
  )
}

/** Ảnh thu nhỏ (object URL) cho file ảnh; tự thu hồi URL khi file bị bỏ khỏi danh sách hoặc unmount. */
function usePreviews(items, enabled) {
  const [previews, setPreviews] = useState(() => new Map())
  const latestRef = useRef(previews)

  useEffect(() => {
    if (!enabled) return
    setPreviews((prev) => {
      const ids = new Set(items.map((i) => i.id))
      const next = new Map()
      let changed = false
      for (const [id, url] of prev) {
        if (ids.has(id)) next.set(id, url)
        else {
          URL.revokeObjectURL(url)
          changed = true
        }
      }
      for (const item of items) {
        if (!next.has(item.id) && item.file.type.startsWith('image/')) {
          next.set(item.id, URL.createObjectURL(item.file))
          changed = true
        }
      }
      latestRef.current = changed ? next : prev
      return latestRef.current
    })
  }, [items, enabled])

  useEffect(
    () => () => {
      for (const url of latestRef.current.values()) URL.revokeObjectURL(url)
    },
    [],
  )

  return previews
}
