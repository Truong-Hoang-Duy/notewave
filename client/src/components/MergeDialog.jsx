import { ArchiveRestore, ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import { formatClock, formatDateTime } from '../lib/format'
import GroupSelect from './GroupSelect'
import Modal from './Modal'
import { Button, InlineAlert, SourceBadge } from './ui'

function initialOrder(items) {
  return [...items].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
}

function MergeForm({ items, onClose, onMerged }) {
  const [order, setOrder] = useState(() => initialOrder(items))
  const [title, setTitle] = useState('')
  const commonGroup = items.every((i) => i.group?.id === items[0].group?.id) ? (items[0].group?.id ?? '') : ''
  const [groupId, setGroupId] = useState(commonGroup)
  const [deleteOriginals, setDeleteOriginals] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const move = (index, delta) => {
    setOrder((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      next.splice(index + delta, 0, item)
      return next
    })
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const merged = await api.mergeSessions({
        session_ids: order.map((i) => i.id),
        title: title.trim() || null,
        group_id: groupId || null,
        delete_originals: deleteOriginals,
      })
      onMerged(merged)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const starts = order.map((_, index) => order.slice(0, index).reduce((sum, i) => sum + (i.duration_ms || 0), 0))
  const totalMs = order.reduce((sum, i) => sum + (i.duration_ms || 0), 0)

  return (
    <Modal
      open
      size="lg"
      busy={busy}
      onClose={onClose}
      title={`Gộp ${order.length} phiên thành một`}
      description="Transcript được nối theo thứ tự bên dưới; mốc thời gian của phiên sau được cộng dồn, nhãn người nói giữ nguyên như bản gốc."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button variant={deleteOriginals ? 'danger' : 'primary'} onClick={submit} loading={busy}>
            {deleteOriginals ? 'Gộp và xoá bản gốc' : 'Gộp phiên'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Thứ tự nối</h3>
            {totalMs > 0 && <span className="text-xs text-muted">Tổng: {formatClock(totalMs)}</span>}
          </div>
          <ol className="space-y-2">
            {order.map((item, index) => {
              const start = starts[index]
              return (
                <li key={item.id} className="flex items-center gap-3 rounded-xl border border-line bg-paper/60 px-3 py-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-xs font-semibold text-ink-soft shadow-card tabular-nums">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                      <SourceBadge source={item.source} compact />
                      <span>{formatDateTime(item.created_at)}</span>
                      <span className="font-mono tabular-nums">bắt đầu tại {formatClock(start)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col">
                    <button onClick={() => move(index, -1)} disabled={index === 0 || busy} className="rounded p-1 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30" aria-label="Chuyển lên">
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === order.length - 1 || busy}
                      className="rounded p-1 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30"
                      aria-label="Chuyển xuống"
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">Tên phiên gộp</span>
            <input
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${order[0]?.title} (gộp ${order.length} phiên)`}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm shadow-card outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              disabled={busy}
            />
          </label>
          <div>
            <span className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">Nhóm</span>
            <GroupSelect value={groupId} onChange={setGroupId} allowCreate extraOptions={[['', 'Chưa phân nhóm']]} disabled={busy} />
          </div>
        </section>

        <fieldset>
          <legend className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Phiên gốc sau khi gộp</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              [false, ArchiveRestore, 'Lưu trữ bản gốc', 'Ẩn khỏi danh sách, xem lại ở mục “Đã lưu trữ” và khôi phục được.'],
              [true, Trash2, 'Xoá vĩnh viễn', 'Không hoàn tác được. Bản tóm tắt của phiên gốc cũng bị xoá.'],
            ].map(([value, Icon, label, hint]) => (
              <label
                key={label}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${
                  deleteOriginals === value ? (value ? 'border-rec bg-rec-soft/60' : 'border-brand-500 bg-brand-50/60') : 'border-line hover:border-line-strong'
                }`}
              >
                <input type="radio" name="originals" className="sr-only" checked={deleteOriginals === value} onChange={() => setDeleteOriginals(value)} disabled={busy} />
                <Icon className={`mt-0.5 size-4 shrink-0 ${value ? 'text-rec' : 'text-brand-600'}`} />
                <span>
                  <span className="block text-sm font-medium text-ink">{label}</span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <InlineAlert>{error}</InlineAlert>}
      </div>
    </Modal>
  )
}

/** Mount lại form mỗi lần mở để thứ tự/tuỳ chọn luôn khởi tạo từ danh sách đang chọn. */
export default function MergeDialog({ open, items, onClose, onMerged }) {
  if (!open) return null
  return <MergeForm items={items} onClose={onClose} onMerged={onMerged} />
}
