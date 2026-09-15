import { CheckCircle2, Languages, Mic, Pause, Play, RotateCcw, Save, Square, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import TranscriptView from '../components/TranscriptView'
import Waveform from '../components/Waveform'
import { Button, Card, InlineAlert, Spinner } from '../components/ui'
import { useLiveTranscription } from '../hooks/useLiveTranscription'
import { api } from '../lib/api'
import { formatClock } from '../lib/format'

const DRAFT_KEY = 'notewave:unsaved-live-session'

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY))
  } catch {
    return null
  }
}
function saveDraft(draft) {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* localStorage bị chặn */
  }
}

function RecordButton({ onClick, starting }) {
  return (
    <button
      onClick={onClick}
      disabled={starting}
      className="group relative grid size-24 place-items-center rounded-full bg-rec text-white shadow-float transition-transform duration-200 hover:scale-[1.04] active:scale-95 disabled:cursor-wait disabled:hover:scale-100 sm:size-28"
      aria-label="Bắt đầu ghi âm"
    >
      <span className="absolute inset-0 rounded-full ring-8 ring-rec/10 transition-all duration-300 group-hover:ring-[14px]" />
      {starting ? <Spinner className="size-8 text-white" /> : <Mic className="size-9 sm:size-10" strokeWidth={2.2} />}
    </button>
  )
}

export default function LivePage({ onOpenSession, onRecordingChange }) {
  const toast = useToast()
  const live = useLiveTranscription()
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState({ status: 'idle', sessionId: null, error: null })
  const [draft, setDraft] = useState(loadDraft)
  const [savingDraft, setSavingDraft] = useState(false)

  const isActive = ['starting', 'recording', 'paused', 'reconnecting', 'stopping'].includes(live.status)

  useEffect(() => {
    onRecordingChange?.(isActive)
  }, [isActive, onRecordingChange])

  // Cảnh báo khi đóng tab lúc đang ghi hoặc còn phiên chưa lưu.
  useEffect(() => {
    const unsaved = isActive || saveState.status === 'error'
    if (!unsaved) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isActive, saveState.status])

  const persist = useCallback(
    async (payload) => {
      setSaveState({ status: 'saving', sessionId: null, error: null })
      try {
        const created = await api.createSession(payload)
        saveDraft(null)
        setDraft(null)
        setSaveState({ status: 'saved', sessionId: created.id, error: null })
        toast.success('Đã lưu phiên vào lịch sử.')
      } catch (err) {
        // Giữ bản nháp trong trình duyệt để không mất transcript khi mất mạng / tải lại trang.
        saveDraft({ ...payload, saved_at: new Date().toISOString() })
        setSaveState({ status: 'error', sessionId: null, error: err.message })
      }
    },
    [toast],
  )

  const handleStop = async () => {
    await live.stop()
    const { segments, duration_ms } = live.getResult()
    if (segments.length === 0) {
      setSaveState({ status: 'empty', sessionId: null, error: null })
      return
    }
    persist({ title: title.trim() || null, source: 'live', segments, duration_ms })
  }

  // Khi SDK báo lỗi giữa chừng mà đã có transcript, hook chuyển sang 'stopped' — tự lưu phần đã có.
  useEffect(() => {
    if (live.status === 'stopped' && live.error && saveState.status === 'idle') {
      const { segments, duration_ms } = live.getResult()
      if (segments.length) persist({ title: title.trim() || null, source: 'live', segments, duration_ms })
    }
  }, [live.status, live.error]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveOldDraft = async () => {
    setSavingDraft(true)
    try {
      const { saved_at: _savedAt, ...payload } = draft
      await api.createSession(payload)
      saveDraft(null)
      setDraft(null)
      toast.success('Đã lưu phiên chưa lưu trước đó vào lịch sử.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingDraft(false)
    }
  }

  const startNew = () => {
    live.reset()
    setTitle('')
    setSaveState({ status: 'idle', sessionId: null, error: null })
  }

  const retrySave = () => {
    const { segments, duration_ms } = live.getResult()
    persist({ title: title.trim() || null, source: 'live', segments, duration_ms })
  }

  const recordingLike = ['recording', 'paused', 'reconnecting', 'stopping'].includes(live.status)
  const showTranscript = recordingLike || live.status === 'stopped'

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {draft && live.status === 'idle' && (
        <div className="mx-auto max-w-3xl">
          <InlineAlert
          tone="warn"
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => (saveDraft(null), setDraft(null))}>
                Bỏ
              </Button>
              <Button size="sm" variant="primary" icon={Save} onClick={saveOldDraft} loading={savingDraft}>
                Lưu ngay
              </Button>
            </div>
          }
        >
          Có một phiên ghi âm chưa được lưu lên máy chủ ({draft.segments.length} đoạn).
        </InlineAlert>
        </div>
      )}

      {/* ---- Màn hình bắt đầu ---- */}
      {(live.status === 'idle' || live.status === 'starting' || live.status === 'error') && (
        <Card className="mx-auto max-w-3xl animate-fade-in overflow-hidden">
          <div className="flex flex-col items-center px-6 pt-12 pb-10 text-center sm:pt-16">
            <RecordButton onClick={live.start} starting={live.status === 'starting'} />
            <h1 className="mt-8 text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
              {live.status === 'starting' ? 'Đang kết nối…' : 'Sẵn sàng ghi âm'}
            </h1>
            <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">
              {live.status === 'starting'
                ? 'Đang xin quyền micro và kết nối tới dịch vụ nhận dạng giọng nói.'
                : 'Bấm nút để bắt đầu. Lời nói sẽ hiện thành văn bản ngay khi bạn nói, như phụ đề trực tiếp.'}
            </p>

            <div className="mt-8 w-full max-w-sm">
              <label htmlFor="session-title" className="sr-only">
                Tên phiên
              </label>
              <input
                id="session-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="Đặt tên phiên (không bắt buộc)"
                className="h-11 w-full rounded-xl border border-line bg-paper px-4 text-center text-sm text-ink placeholder:text-muted/80 outline-none transition focus:border-brand-500 focus:bg-surface focus:ring-4 focus:ring-brand-100"
              />
            </div>

            {live.error && (
              <div className="mt-6 w-full max-w-md text-left">
                <InlineAlert>{live.error}</InlineAlert>
              </div>
            )}
          </div>
          <div className="grid border-t border-line bg-paper/60 text-[13px] text-muted sm:grid-cols-2">
            <div className="flex items-center gap-2.5 px-6 py-3.5">
              <Languages className="size-4 shrink-0 text-brand-600" />
              Tiếng Việt, tự nhận diện khi đổi ngôn ngữ
            </div>
            <div className="flex items-center gap-2.5 border-t border-line px-6 py-3.5 sm:border-t-0 sm:border-l">
              <Users className="size-4 shrink-0 text-brand-600" />
              Tự phân biệt nhiều người nói
            </div>
          </div>
        </Card>
      )}

      {/* ---- Thanh điều khiển khi đang ghi ---- */}
      {recordingLike && (
        <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 animate-slide-up md:top-20">
          <Card className="flex items-center gap-3 p-3 pl-4 shadow-float sm:gap-5 sm:pl-5">
            <div className="flex shrink-0 items-center gap-2.5">
              <span
                className={`size-2.5 rounded-full ${
                  live.status === 'recording' ? 'animate-rec-pulse bg-rec' : live.status === 'reconnecting' ? 'animate-pulse bg-warn' : 'bg-muted'
                }`}
              />
              <div className="leading-tight">
                <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                  {{ recording: 'Đang ghi', paused: 'Tạm dừng', reconnecting: 'Kết nối lại', stopping: 'Đang hoàn tất' }[live.status]}
                </div>
                <div className="font-mono text-lg font-medium text-ink tabular-nums">{formatClock(live.elapsedMs)}</div>
              </div>
            </div>
            <Waveform analyser={live.analyser} active={live.status === 'recording'} className="min-w-0 flex-1" />
            <div className="flex shrink-0 gap-2">
              {live.status === 'paused' ? (
                <Button icon={Play} onClick={live.resume} aria-label="Tiếp tục ghi">
                  <span className="hidden sm:inline">Tiếp tục</span>
                </Button>
              ) : (
                <Button icon={Pause} onClick={live.pause} disabled={live.status !== 'recording'} aria-label="Tạm dừng">
                  <span className="hidden sm:inline">Tạm dừng</span>
                </Button>
              )}
              <Button variant="danger" icon={Square} onClick={handleStop} loading={live.status === 'stopping'}>
                Dừng
              </Button>
            </div>
          </Card>
          {live.warning && (
            <div className="mt-3">
              <InlineAlert tone="warn">{live.warning}</InlineAlert>
            </div>
          )}
        </div>
      )}

      {/* ---- Kết quả sau khi dừng ---- */}
      {live.status === 'stopped' && (
        <div className="animate-slide-up">
          {live.error && (
            <div className="mb-4">
              <InlineAlert>{live.error} Phần transcript đã ghi được vẫn được giữ lại.</InlineAlert>
            </div>
          )}
          {saveState.status === 'saving' && (
            <Card className="flex items-center gap-3 p-4 text-sm text-ink-soft">
              <Spinner className="size-4 text-brand-600" />
              Đang lưu phiên vào lịch sử…
            </Card>
          )}
          {saveState.status === 'saved' && (
            <Card className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
              <CheckCircle2 className="size-6 shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">Đã lưu vào lịch sử</p>
                <p className="text-sm text-muted">Mở phiên để tóm tắt bằng AI, đổi tên hoặc xuất file.</p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <Button icon={RotateCcw} onClick={startNew} className="flex-1 sm:flex-none">
                  Ghi phiên mới
                </Button>
                <Button variant="primary" onClick={() => onOpenSession(saveState.sessionId)} className="flex-1 sm:flex-none">
                  Xem & tóm tắt
                </Button>
              </div>
            </Card>
          )}
          {saveState.status === 'error' && (
            <InlineAlert
              action={
                <Button size="sm" variant="primary" icon={Save} onClick={retrySave}>
                  Thử lưu lại
                </Button>
              }
            >
              Chưa lưu được phiên: {saveState.error} Transcript đã được giữ tạm trong trình duyệt.
            </InlineAlert>
          )}
          {saveState.status === 'empty' && (
            <Card className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
              <Mic className="size-6 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">Không nhận được lời nói nào</p>
                <p className="text-sm text-muted">Hãy kiểm tra micro và nói gần thiết bị hơn.</p>
              </div>
              <Button variant="primary" icon={RotateCcw} onClick={startNew}>
                Thử lại
              </Button>
            </Card>
          )}
        </div>
      )}

      {showTranscript && (
        <Card className="animate-fade-in">
          <TranscriptView
            segments={live.segments}
            interim={live.interim}
            follow={recordingLike}
            className={`px-5 py-6 sm:px-8 sm:py-8 ${recordingLike ? 'h-[calc(100svh-17rem)] min-h-72 md:h-[calc(100svh-15rem)]' : ''}`}
            placeholder={
              <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center text-muted">
                <div className="flex items-end gap-1" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-1.5 animate-bounce rounded-full bg-brand-500" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <p className="text-sm">Đang lắng nghe… hãy bắt đầu nói.</p>
              </div>
            }
          />
        </Card>
      )}
    </div>
  )
}
