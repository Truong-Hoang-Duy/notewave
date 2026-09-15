import { Check, FolderOpen, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { groupActions, useGroups } from '../hooks/useGroups'
import Modal from './Modal'
import { useToast } from './Toast'
import { Button, InlineAlert, Spinner } from './ui'

function GroupRow({ group }) {
  const toast = useToast()
  const [mode, setMode] = useState('view') // view | edit | confirm-delete
  const [name, setName] = useState(group.name)
  const [busy, setBusy] = useState(false)

  const run = async (fn, successMessage) => {
    setBusy(true)
    try {
      await fn()
      if (successMessage) toast.success(successMessage)
      setMode('view')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'edit') {
    return (
      <li className="py-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const next = name.trim()
            if (!next || next === group.name) return setMode('view')
            run(() => groupActions.rename(group.id, next), 'Đã đổi tên nhóm.')
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setName(group.name), setMode('view'))}
            className="h-9 min-w-0 flex-1 rounded-lg border border-brand-500 px-3 text-sm outline-none ring-4 ring-brand-100"
            aria-label="Tên nhóm"
            disabled={busy}
          />
          <Button type="submit" size="sm" variant="primary" icon={Check} loading={busy} aria-label="Lưu" />
          <Button size="sm" variant="ghost" icon={X} onClick={() => setMode('view')} disabled={busy} aria-label="Huỷ" />
        </form>
      </li>
    )
  }

  if (mode === 'confirm-delete') {
    return (
      <li className="py-2">
        <div className="rounded-xl bg-rec-soft px-3 py-2.5 text-[13px] text-[#8f2a2e]">
          <p>
            Xoá nhóm <strong>“{group.name}”</strong>? {group.session_count > 0 && `${group.session_count} phiên trong nhóm sẽ chuyển về “Chưa phân nhóm”, không bị xoá.`}
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setMode('view')} disabled={busy}>
              Huỷ
            </Button>
            <Button size="sm" variant="danger" loading={busy} onClick={() => run(() => groupActions.remove(group.id), 'Đã xoá nhóm.')}>
              Xoá nhóm
            </Button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <li className="group/row flex items-center gap-3 py-2.5">
      <FolderOpen className="size-4 shrink-0 text-brand-600" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{group.name}</span>
      <span className="shrink-0 text-xs text-muted tabular-nums">{group.session_count} phiên</span>
      <div className="flex shrink-0 gap-0.5">
        <button onClick={() => (setName(group.name), setMode('edit'))} className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink" aria-label={`Đổi tên nhóm ${group.name}`}>
          <Pencil className="size-3.5" />
        </button>
        <button onClick={() => setMode('confirm-delete')} className="rounded-md p-1.5 text-muted hover:bg-rec-soft hover:text-rec" aria-label={`Xoá nhóm ${group.name}`}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  )
}

export default function GroupManagerDialog({ open, onClose }) {
  const { groups, loading, error } = useGroups()
  const toast = useToast()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const create = async (e) => {
    e.preventDefault()
    const next = name.trim()
    if (!next) return
    setCreating(true)
    try {
      await groupActions.create(next)
      setName('')
      toast.success(`Đã tạo nhóm “${next}”.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Quản lý nhóm tài liệu" description="Nhóm các phiên theo dự án, khách hàng, tuần… Mỗi phiên thuộc tối đa một nhóm.">
      <form onSubmit={create} className="flex gap-2">
        <input
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tên nhóm mới"
          className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3.5 text-sm outline-none transition focus:border-brand-500 focus:bg-surface focus:ring-4 focus:ring-brand-100"
          aria-label="Tên nhóm mới"
        />
        <Button type="submit" variant="primary" icon={Plus} loading={creating} disabled={!name.trim()}>
          Tạo
        </Button>
      </form>

      <div className="mt-4">
        {error && <InlineAlert>{error.message}</InlineAlert>}
        {loading && groups.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Chưa có nhóm nào. Tạo nhóm đầu tiên ở ô phía trên.</p>
        ) : (
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <GroupRow key={`${g.id}-${g.name}`} group={g} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
