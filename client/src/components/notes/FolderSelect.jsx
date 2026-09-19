import { FolderTree } from 'lucide-react'
import { useMemo } from 'react'
import { buildFolderTree, flattenFolderTree, useNoteLibrary } from '../../hooks/useNoteLibrary'

/** <select> thư mục dạng cây (thụt lề theo cấp). `value` = id thư mục hoặc '' (không thuộc thư mục). */
export default function FolderSelect({ value, onChange, rootLabel = 'Không thuộc thư mục', extraOptions = [], excludeId, className = '', ariaLabel = 'Thư mục' }) {
  const { folders } = useNoteLibrary()
  const rows = useMemo(() => {
    const flat = flattenFolderTree(buildFolderTree(folders))
    if (!excludeId) return flat
    // Khi chọn thư mục cha mới cho một thư mục: bỏ chính nó và toàn bộ nhánh con của nó.
    const out = []
    let skipDepth = null
    for (const row of flat) {
      if (skipDepth !== null && row.depth > skipDepth) continue
      skipDepth = null
      if (row.folder.id === excludeId) {
        skipDepth = row.depth
        continue
      }
      out.push(row)
    }
    return out
  }, [folders, excludeId])

  return (
    <div className={`relative ${className}`}>
      <FolderTree className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="h-9 w-full cursor-pointer appearance-none truncate rounded-xl border border-line bg-surface pr-8 pl-9 text-[13px] font-medium text-ink-soft shadow-card outline-none transition hover:border-line-strong focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
      >
        {extraOptions.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        <option value={extraOptions.some(([v]) => v === '') ? 'none' : ''}>{rootLabel}</option>
        {rows.map(({ folder, depth }) => (
          <option key={folder.id} value={folder.id}>
            {`${'   '.repeat(depth)}${depth ? '└ ' : ''}${folder.name}`}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
      </svg>
    </div>
  )
}
