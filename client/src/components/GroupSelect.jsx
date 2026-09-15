import { Check, FolderOpen, X } from 'lucide-react'
import { useState } from 'react'
import { groupActions, useGroups } from '../hooks/useGroups'
import { useToast } from './Toast'
import { Button } from './ui'

const CREATE_VALUE = '__create__'

/**
 * Chọn nhóm cho một phiên (hoặc làm bộ lọc).
 * - `allowCreate`: thêm mục "Tạo nhóm mới…" — chọn mục này sẽ đổi ô chọn thành ô nhập tên ngay tại chỗ.
 * - `extraOptions`: các lựa chọn đặt trước danh sách nhóm, dạng [value, label].
 */
export default function GroupSelect({ value, onChange, allowCreate = false, extraOptions = [], disabled, className = '', ariaLabel = 'Nhóm tài liệu' }) {
  const { groups } = useGroups()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const next = name.trim()
    if (!next) return
    setSaving(true)
    try {
      const group = await groupActions.create(next)
      toast.success(`Đã tạo nhóm “${group.name}”.`)
      setCreating(false)
      setName('')
      onChange(group.id)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (creating) {
    return (
      <div className={`flex gap-1.5 ${className}`}>
        <input
          autoFocus
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setCreating(false)
            }
          }}
          placeholder="Tên nhóm mới"
          aria-label="Tên nhóm mới"
          disabled={saving}
          className="h-10 min-w-0 flex-1 rounded-xl border border-brand-500 bg-surface px-3 text-[13px] outline-none ring-4 ring-brand-100"
        />
        <Button variant="primary" icon={Check} onClick={submit} loading={saving} disabled={!name.trim()} aria-label="Tạo nhóm" />
        <Button variant="ghost" icon={X} onClick={() => setCreating(false)} disabled={saving} aria-label="Huỷ tạo nhóm" />
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      <FolderOpen className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <select
        value={value}
        onChange={(e) => (e.target.value === CREATE_VALUE ? setCreating(true) : onChange(e.target.value))}
        disabled={disabled}
        aria-label={ariaLabel}
        className="h-10 w-full cursor-pointer appearance-none truncate rounded-xl border border-line bg-surface pr-9 pl-9 text-[13px] font-medium text-ink-soft shadow-card outline-none transition hover:border-line-strong focus:border-brand-500 focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {extraOptions.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
        {allowCreate && <option value={CREATE_VALUE}>＋ Tạo nhóm mới…</option>}
      </select>
      <svg className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
      </svg>
    </div>
  )
}
