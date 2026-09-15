import { ArrowDown } from 'lucide-react'
import { Fragment, memo, useLayoutEffect, useRef, useState } from 'react'
import { formatClock, speakerColor, speakerLabel } from '../lib/format'
import { partStartAt } from '../lib/segments'
import PartDivider from './PartDivider'

const Segment = memo(function Segment({ segment, interimText, showSpeakerColumn }) {
  const color = segment.speaker ? speakerColor(segment.speaker) : null
  return (
    <article className="grid animate-fade-in gap-x-6 gap-y-1 md:grid-cols-[7.5rem_minmax(0,1fr)]">
      <div className="flex items-baseline gap-2 md:flex-col md:gap-0.5 md:pt-[3px]">
        {showSpeakerColumn && segment.speaker && (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color }}>
            <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
            {speakerLabel(segment.speaker)}
          </span>
        )}
        {segment.start_ms != null && (
          <span className="font-mono text-[11.5px] tracking-tight text-muted tabular-nums">{formatClock(segment.start_ms)}</span>
        )}
      </div>
      <p className="text-[16.5px] leading-[1.8] text-pretty break-words text-ink sm:text-[17px]">
        {segment.text}
        {interimText && <span className="text-muted/80">{interimText}</span>}
      </p>
    </article>
  )
})

/**
 * Hiển thị transcript theo từng lượt người nói. Dùng chung cho ghi âm trực tiếp, file tải lên và lịch sử.
 * - `interim`: các segment chưa final (chữ nhạt, sẽ còn thay đổi).
 * - `follow`: tự cuộn xuống đoạn mới nhất khi người dùng đang ở cuối danh sách.
 */
export default function TranscriptView({ segments, interim = [], follow = false, className = '', placeholder, partsById }) {
  const containerRef = useRef(null)
  const stickRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const showSpeakerColumn = segments.some((s) => s.speaker) || interim.some((s) => s.speaker)

  // Nếu đoạn interim đầu tiên cùng người nói với segment cuối, nối liền vào cùng khối.
  const last = segments[segments.length - 1]
  const mergeFirst = last && interim[0] && interim[0].speaker === last.speaker
  const trailingInterim = mergeFirst ? interim.slice(1) : interim

  useLayoutEffect(() => {
    if (!follow) return
    const el = containerRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  })

  const onScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64
    stickRef.current = atBottom
    setShowJump(!atBottom)
  }

  const jumpToLatest = () => {
    const el = containerRef.current
    if (!el) return
    stickRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setShowJump(false)
  }

  const isEmpty = segments.length === 0 && interim.length === 0

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onScroll={follow ? onScroll : undefined}
        className={`${follow ? 'overflow-y-auto overscroll-contain' : ''} ${className}`}
      >
        {isEmpty ? (
          placeholder
        ) : (
          <div className="space-y-6">
            {segments.map((seg, i) => {
              const part = partStartAt(segments, i, partsById)
              return (
                <Fragment key={i}>
                  {part && <PartDivider title={part.title} offsetMs={part.offset_ms} />}
                  <Segment
                    segment={seg}
                    showSpeakerColumn={showSpeakerColumn}
                    interimText={i === segments.length - 1 && mergeFirst ? interim[0].text : null}
                  />
                </Fragment>
              )
            })}
            {trailingInterim.map((seg, i) => (
              <div key={`interim-${i}`} className="opacity-70">
                <Segment segment={seg} showSpeakerColumn={showSpeakerColumn} />
              </div>
            ))}
          </div>
        )}
      </div>
      {follow && showJump && !isEmpty && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 animate-slide-up items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white shadow-float hover:bg-ink-soft"
        >
          <ArrowDown className="size-3.5" />
          Mới nhất
        </button>
      )}
    </div>
  )
}
