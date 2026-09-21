import { ListPlus, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { formatDateTime } from '../../lib/format'
import { Button, Spinner } from '../ui'

function Section({ title, children }) {
  return (
    <section className="mt-3.5 first:mt-0">
      <h3 className="text-[11.5px] font-semibold tracking-[0.06em] text-[var(--note-muted)] uppercase">{title}</h3>
      {children}
    </section>
  )
}

/**
 * Tab "AI" của dải tóm tắt: tóm tắt do `note_summary_agent` tạo — ý chính, khái niệm cần nhớ, câu hỏi ôn tập.
 * Nằm ở cột riêng với tóm tắt người học tự viết, chỉ chạy khi bấm nút (không bao giờ tự gọi LLM).
 */
export default function NoteAiPanel({ summary, outdated, loading, onGenerate, onAddQuestion, onAddAllQuestions }) {
  if (loading)
    return (
      <div className="flex flex-col items-center gap-2.5 py-6 text-center">
        <Spinner />
        <p className="text-[13px] text-[var(--note-muted)]">Đang đọc ghi chú và tóm tắt…</p>
      </div>
    )

  if (!summary)
    return (
      <div className="flex flex-col items-start gap-2.5 py-1">
        <p className="text-[13px] leading-relaxed text-[var(--note-muted)]">
          AI đọc phần nội dung và tóm tắt lại thành ý chính, khái niệm cần nhớ và câu hỏi ôn tập. Phần “Tóm tắt của bạn”
          không bị thay đổi.
        </p>
        <Button size="sm" icon={Sparkles} onClick={onGenerate}>
          Tạo tóm tắt AI
        </Button>
      </div>
    )

  const questions = summary.review_questions ?? []
  return (
    <div className="text-[0.95em]">
      {outdated && (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-[#7a4a0c]">
          Nội dung đã thay đổi sau lần tóm tắt này.
          <button type="button" onClick={onGenerate} className="font-semibold underline underline-offset-2">
            Tạo lại
          </button>
        </p>
      )}

      <Section title="Tóm tắt">
        <p className="mt-1 leading-relaxed">{summary.summary}</p>
      </Section>

      {summary.key_points?.length > 0 && (
        <Section title="Ý chính">
          <ul className="mt-1 space-y-1">
            {summary.key_points.map((point, i) => (
              <li key={i} className="flex gap-2 leading-relaxed">
                <span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-[var(--note-accent)]" aria-hidden="true" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {summary.concepts?.length > 0 && (
        <Section title="Khái niệm cần nhớ">
          <dl className="mt-1 space-y-1">
            {summary.concepts.map((c, i) => (
              <div key={i} className="leading-relaxed">
                <dt className="inline font-semibold">{c.term}</dt>
                <dd className="inline"> — {c.meaning}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {questions.length > 0 && (
        <Section title="Câu hỏi ôn tập">
          <ul className="mt-1 space-y-0.5">
            {questions.map((q, i) => (
              <li key={i} className="group flex items-start gap-1.5">
                <span className="flex-1 leading-relaxed">{q}</span>
                <button
                  type="button"
                  onClick={() => onAddQuestion(q)}
                  title="Thêm vào cột câu hỏi"
                  aria-label={`Thêm câu hỏi “${q}” vào cột câu hỏi`}
                  className="mt-[0.15em] grid size-6 shrink-0 place-items-center rounded-md text-[var(--note-muted)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--note-soft)] hover:text-[var(--note-accent)]"
                >
                  <Plus className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" icon={ListPlus} className="mt-1.5 -ml-2" onClick={() => onAddAllQuestions(questions)}>
            Thêm tất cả vào cột câu hỏi
          </Button>
        </Section>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--note-line)] pt-2.5 text-[11.5px] text-[var(--note-muted)]">
        <span>
          Tạo lúc {formatDateTime(summary.generated_at)} · {summary.model}
        </span>
        <button type="button" onClick={onGenerate} className="inline-flex items-center gap-1 hover:text-[var(--note-fg)]">
          <RefreshCw className="size-3" /> Tạo lại
        </button>
      </div>
    </div>
  )
}
