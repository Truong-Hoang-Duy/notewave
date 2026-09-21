import { ArrowDownLeft, ArrowUpRight, FolderClosed } from 'lucide-react'

function Group({ icon: Icon, title, notes }) {
  if (!notes.length) return null
  return (
    <div className="mt-2 first:mt-0">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-[var(--note-muted)] uppercase">
        <Icon className="size-3" /> {title} ({notes.length})
      </h3>
      <ul className="mt-1 space-y-0.5">
        {notes.map((n) => (
          <li key={n.id}>
            <a
              href={`#/notes/${n.id}`}
              className="block truncate rounded-md px-1.5 py-1 text-[13px] text-[var(--note-fg)] hover:bg-[var(--note-soft)]"
              title={n.folder ? `${n.folder.name} / ${n.title}` : n.title}
            >
              {n.title}
              {n.folder && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-[11px] text-[var(--note-muted)]">
                  <FolderClosed className="size-2.5" />
                  {n.folder.name}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Liên kết của ghi chú, đặt dưới cột câu hỏi: ghi chú nào trỏ tới đây (backlink) và ghi chú này trỏ tới đâu.
 * Danh sách do backend tính lại mỗi lần nội dung được lưu (`GET /api/notes/{id}/links`).
 */
export default function NoteLinksPanel({ links }) {
  const incoming = links?.incoming ?? []
  const outgoing = links?.outgoing ?? []
  return (
    <div className="mt-auto border-t border-[var(--note-line)] px-4 py-3">
      {!incoming.length && !outgoing.length ? (
        <p className="text-[12px] leading-relaxed text-[var(--note-muted)]">
          Gõ <code className="rounded bg-[var(--note-soft)] px-1">[[</code> trong phần nội dung để liên kết tới một ghi chú khác.
        </p>
      ) : (
        <>
          <Group icon={ArrowDownLeft} title="Trỏ tới ghi chú này" notes={incoming} />
          <Group icon={ArrowUpRight} title="Ghi chú này trỏ tới" notes={outgoing} />
        </>
      )}
    </div>
  )
}
