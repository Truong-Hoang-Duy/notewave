import { formatClock } from '../lib/format'

/** Đường phân cách giữa các phiên gốc trong một phiên đã gộp. */
export default function PartDivider({ title, offsetMs }) {
  return (
    <div className="flex items-center gap-3 pt-2 first:pt-0" role="separator">
      <span className="h-px flex-1 bg-line" />
      <span className="max-w-[70%] truncate rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium text-ink-soft">
        {title}
        {offsetMs != null && <span className="ml-1.5 font-mono text-muted tabular-nums">{formatClock(offsetMs)}</span>}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
