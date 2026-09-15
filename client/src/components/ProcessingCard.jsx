import { AudioLines } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatClock } from '../lib/format'
import { Card, InlineAlert } from './ui'

export default function ProcessingCard({ title = 'Đang chuyển giọng nói thành văn bản…', filename, connectionIssue, startedAt }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <Card className="animate-fade-in p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <AudioLines className="size-6 animate-pulse" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">{title}</h3>
          {filename && <p className="mt-0.5 truncate text-sm text-muted">{filename}</p>}
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div className="h-full w-2/5 animate-indeterminate rounded-full bg-brand-500" />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
            <span>File dài có thể mất vài phút. Bạn có thể rời trang — kết quả sẽ nằm trong Lịch sử.</span>
            {startedAt && <span className="font-mono tabular-nums">{formatClock(now - startedAt)}</span>}
          </div>
        </div>
      </div>
      {connectionIssue && (
        <div className="mt-5">
          <InlineAlert tone="warn">Đang gặp sự cố kết nối tới máy chủ, NoteWave sẽ tự thử lại…</InlineAlert>
        </div>
      )}
    </Card>
  )
}
