import { CalendarClock, Check, CheckSquare, Copy, Gavel, ListChecks, RotateCw, Sparkles, TriangleAlert, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useScrolled } from '../hooks/useScrolled'
import { copyText } from '../lib/clipboard'
import { summaryToMarkdown } from '../lib/summary'
import { useToast } from './Toast'
import { Button, Card, CollapseToggle, InlineAlert } from './ui'

function Section({ icon: Icon, title, children }) {
  return (
    <section className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h4 className="mb-2.5 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        <Icon className="size-3.5" />
        {title}
      </h4>
      {children}
    </section>
  )
}

/**
 * Nút sao chép tóm tắt. Bấm → icon chuyển thành dấu tick khoảng 1,8 giây.
 * Từ sm tới dưới xl có chữ "Sao chép"/"Đã chép" (2 nhãn chồng lên nhau để giữ nguyên bề rộng, không xô layout);
 * ở sidebar hẹp (xl) và mobile chỉ còn icon, phản hồi "Đã chép" hiện dạng bong bóng nổi bên dưới nút.
 */
function CopyButton({ getText }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const copy = async () => {
    try {
      await copyText(getText())
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      toast.error(err.message || 'Không sao chép được bản tóm tắt.')
    }
  }

  const swap = (visible) => `transition-[opacity,scale] duration-200 ease-out ${visible ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        title="Sao chép tóm tắt (Markdown)"
        aria-label={copied ? 'Đã chép tóm tắt' : 'Sao chép tóm tắt'}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.94] sm:px-3 xl:px-2 ${
          copied ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-sunken hover:text-ink'
        }`}
      >
        <span className="grid size-4 place-items-center" aria-hidden="true">
          <Copy className={`col-start-1 row-start-1 size-4 ${swap(!copied)}`} />
          <Check className={`col-start-1 row-start-1 size-4 ${swap(copied)}`} strokeWidth={2.5} />
        </span>
        <span className="hidden sm:grid xl:hidden" aria-hidden="true">
          <span className={`col-start-1 row-start-1 transition-opacity duration-200 ${copied ? 'opacity-0' : ''}`}>Sao chép</span>
          <span className={`col-start-1 row-start-1 transition-opacity duration-200 ${copied ? '' : 'opacity-0'}`}>Đã chép</span>
        </span>
      </button>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-full left-1/2 z-20 mt-1.5 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium whitespace-nowrap text-white shadow-float transition-[opacity,translate] duration-200 sm:hidden xl:block ${
          copied ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        Đã chép
      </span>
      <span role="status" className="sr-only">
        {copied ? 'Đã chép bản tóm tắt vào bộ nhớ tạm' : ''}
      </span>
    </div>
  )
}

export default function SummaryPanel({ title, summary, outdated, loading, error, disabled, collapsed = false, onToggleCollapse, onSummarize }) {
  const [scrolled, onScroll] = useScrolled()

  if (loading) {
    return (
      <Card className="p-5" aria-busy="true">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-brand-700">
          <Sparkles className="size-4 animate-pulse" />
          AI đang đọc transcript và tóm tắt…
        </div>
        <div className="space-y-2.5">
          <div className="skeleton h-3.5 w-full" />
          <div className="skeleton h-3.5 w-11/12" />
          <div className="skeleton h-3.5 w-4/6" />
          <div className="skeleton mt-5 h-3.5 w-3/5" />
          <div className="skeleton h-3.5 w-2/5" />
        </div>
      </Card>
    )
  }

  if (!summary) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Sparkles className="size-4.5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">Tóm tắt bằng AI</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Tạo bản tóm tắt ngắn, các ý chính, việc cần làm và quyết định từ transcript.
            </p>
          </div>
        </div>
        {error && (
          <div className="mt-4">
            <InlineAlert>{error}</InlineAlert>
          </div>
        )}
        <Button variant="primary" icon={Sparkles} className="mt-4 w-full" onClick={onSummarize} disabled={disabled}>
          {error ? 'Thử tóm tắt lại' : 'Tóm tắt cuộc họp'}
        </Button>
      </Card>
    )
  }

  return (
    <Card className="animate-fade-in xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden">
      <div
        className={`relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b px-5 pt-5 pb-3 transition-[border-color,box-shadow] duration-200 ${
          scrolled ? 'border-line shadow-[0_10px_18px_-14px_rgb(29_27_24/0.28)]' : 'border-transparent'
        }`}
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles className="size-4 text-brand-600" />
          Tóm tắt bằng AI
        </h3>
        <div className="-mr-1.5 flex items-center gap-1">
          <CopyButton getText={() => summaryToMarkdown(summary, title)} />
          <Button variant="ghost" size="sm" icon={RotateCw} onClick={onSummarize} disabled={disabled} title="Tạo lại bản tóm tắt">
            Tạo lại
          </Button>
          {onToggleCollapse && <CollapseToggle collapsed={collapsed} onToggle={onToggleCollapse} controls="ai-summary-body" label="tóm tắt AI" />}
        </div>
      </div>
      <div
        id="ai-summary-body"
        onScroll={onScroll}
        className={`scroll-area px-5 pt-1 pb-5 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain ${collapsed ? 'hidden xl:block' : ''}`}
      >
        {error && (
          <div className="mb-4">
            <InlineAlert>{error}</InlineAlert>
          </div>
        )}
        {outdated && !error && (
          <div role="status" className="mb-4 rounded-xl border border-[#f0dcb8] bg-warn-soft p-3.5 text-[13px] leading-relaxed text-[#7a4a0c]">
            <p className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              Transcript đã được chỉnh sửa sau lần tóm tắt này, bản tóm tắt có thể không còn khớp.
            </p>
            <Button size="sm" variant="secondary" icon={RotateCw} onClick={onSummarize} disabled={disabled} className="mt-3 w-full">
              Tóm tắt lại
            </Button>
          </div>
        )}
        <div className={`space-y-4 ${outdated ? 'opacity-75' : ''}`}>
          <p className="text-[15px] leading-relaxed text-ink">{summary.summary}</p>

          {summary.key_points?.length > 0 && (
            <Section icon={ListChecks} title="Ý chính">
              <ul className="space-y-1.5 text-sm leading-relaxed text-ink-soft">
                {summary.key_points.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-brand-500" />
                    {p}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section icon={CheckSquare} title="Việc cần làm">
            {summary.action_items?.length ? (
              <ul className="space-y-2">
                {summary.action_items.map((item, i) => (
                  <li key={i} className="rounded-xl bg-paper px-3 py-2.5">
                    <p className="text-sm leading-relaxed text-ink">{item.task}</p>
                    {(item.owner || item.due) && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.owner && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11.5px] font-medium text-brand-700">
                            <User className="size-3" />
                            {item.owner}
                          </span>
                        )}
                        {item.due && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11.5px] font-medium text-warn">
                            <CalendarClock className="size-3" />
                            {item.due}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Không có việc cần làm nào được nhắc tới.</p>
            )}
          </Section>

          <Section icon={Gavel} title="Quyết định">
            {summary.decisions?.length ? (
              <ul className="space-y-1.5 text-sm leading-relaxed text-ink-soft">
                {summary.decisions.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-warn" />
                    {d}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Chưa ghi nhận quyết định nào.</p>
            )}
          </Section>
        </div>
      </div>
    </Card>
  )
}
