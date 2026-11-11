import { CloudOff, FileAudio, History, MessageSquareText, Mic, NotebookPen, RefreshCw, ScanText, ServerCog } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import SessionDetail from './components/SessionDetail'
import { Spinner } from './components/ui'
import { purgeExpiredChatThreads } from './hooks/useChatStore'
import { useNetworkStatus } from './hooks/useNetworkStatus'
import { api, subscribeSlowRequests } from './lib/api'
import HistoryPage from './pages/HistoryPage'
import LivePage from './pages/LivePage'
import ScanPage from './pages/ScanPage'
import UploadPage from './pages/UploadPage'

// Ghi chú & Hỏi đáp là chunk riêng: chỉ tải khi người dùng mở tab tương ứng.
const NotesPage = lazy(() => import('./pages/NotesPage'))
const NoteDetail = lazy(() => import('./components/notes/NoteDetail'))
const ChatPage = lazy(() => import('./pages/ChatPage'))

const TABS = [
  { id: 'live', label: 'Ghi âm trực tiếp', short: 'Ghi âm', icon: Mic },
  { id: 'upload', label: 'Tải audio · video', short: 'Audio', icon: FileAudio },
  { id: 'scan', label: 'Quét tài liệu', short: 'Quét', icon: ScanText },
  { id: 'notes', label: 'Ghi chú', short: 'Ghi chú', icon: NotebookPen },
  { id: 'chat', label: 'Hỏi đáp AI', short: 'Hỏi đáp', icon: MessageSquareText },
  { id: 'history', label: 'Lịch sử', short: 'Lịch sử', icon: History },
]

/** Router tối giản dựa trên hash: #/live, #/upload, #/scan, #/notes, #/notes/<id>, #/history, #/history/<id> */
function parseHash() {
  const [, tab, id] = window.location.hash.replace(/^#/, '').split('/')
  return { tab: TABS.some((t) => t.id === tab) ? tab : 'live', id: tab === 'history' || tab === 'notes' ? id || null : null }
}

function PageFallback() {
  return (
    <div className="grid place-items-center py-24">
      <Spinner />
    </div>
  )
}

function useHashRoute() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = useCallback((path) => {
    window.location.hash = `/${path}`
  }, [])
  return [route, navigate]
}

function Logo() {
  return (
    <a href="#/live" className="flex items-center gap-2.5 rounded-lg" aria-label="NoteWave — trang chủ">
      <span className="grid size-8 place-items-center rounded-[10px] bg-brand-600 shadow-card">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="#f6f4ef" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M5 10.5v3M9 7.5v9M13 4.5v15M17 8.5v7M21 11v2" />
        </svg>
      </span>
      <span className="text-[17px] font-semibold tracking-tight text-ink">NoteWave</span>
    </a>
  )
}

export default function App() {
  const [route, navigate] = useHashRoute()
  const [recording, setRecording] = useState(false)
  const [serverSlow, setServerSlow] = useState(false)
  const { isOnline, isSyncing, pendingCount, triggerSync } = useNetworkStatus()

  useEffect(() => {
    // Dọn lịch sử chat localStorage đã quá hạn TTL ngay khi mở app và định kỳ mỗi 5 phút.
    purgeExpiredChatThreads()
    // Đánh thức backend (Render free ngủ sau 15 phút) ngay khi mở app và ping định kỳ giữ ấm khi tab mở.
    api.health().catch(() => {})
    const keepAliveTimer = setInterval(() => {
      purgeExpiredChatThreads()
      if (document.visibilityState === 'visible') {
        api.health().catch(() => {})
      }
    }, 5 * 60 * 1000)

    const unsubscribe = subscribeSlowRequests(setServerSlow)
    return () => {
      clearInterval(keepAliveTimer)
      unsubscribe()
    }
  }, [])

  const openSession = useCallback((id) => navigate(`history/${id}`), [navigate])

  return (
    <div className="min-h-svh pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[96rem] items-center justify-between gap-2 px-3 sm:h-16 sm:gap-4 sm:px-6 lg:px-8">
          <Logo />
          <nav className="hidden rounded-xl border border-line bg-sunken/60 p-1 md:flex" aria-label="Điều hướng chính">
            {TABS.map((tab) => {
              const active = route.tab === tab.id
              return (
                <a
                  key={tab.id}
                  href={`#/${tab.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all duration-150 ${
                    active ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
                  }`}
                >
                  <tab.icon className="size-4" />
                  {/* 6 tab: từ md tới dưới lg dùng nhãn ngắn để không tràn header. */}
                  <span className="lg:hidden">{tab.short}</span>
                  <span className="hidden lg:inline">{tab.label}</span>
                  {tab.id === 'live' && recording && <span className="size-2 animate-rec-pulse rounded-full bg-rec" aria-label="đang ghi" />}
                </a>
              )
            })}
          </nav>
          <div className="flex items-center gap-2">
            {!isOnline && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">
                <CloudOff className="size-3.5" />
                <span className="hidden sm:inline">Ngoại tuyến</span>
              </span>
            )}
            {isOnline && isSyncing && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                <RefreshCw className="size-3.5 animate-spin" />
                <span className="hidden sm:inline">Đang đồng bộ</span>
              </span>
            )}
            {recording && route.tab !== 'live' && (
              <a href="#/live" className="flex items-center gap-1.5 rounded-full bg-rec-soft px-2.5 py-1 text-xs font-semibold text-rec">
                <span className="size-2 animate-rec-pulse rounded-full bg-rec" />
                <span className="hidden xs:inline">Đang ghi</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {!isOnline && (
        <div role="status" className="animate-fade-in border-b border-[#f0dcb8] bg-warn-soft">
          <div className="mx-auto flex max-w-[96rem] items-center justify-between gap-3 px-4 py-2 text-[13px] text-[#7a4a0c] sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <CloudOff className="size-4 shrink-0 text-warn" />
              <span>Chế độ ngoại tuyến: Bạn vẫn có thể xem, tạo và chỉnh sửa ghi chú. Dữ liệu sẽ tự động đồng bộ khi có mạng.</span>
            </div>
            {pendingCount > 0 && (
              <span className="shrink-0 font-medium tabular-nums text-warn">
                {pendingCount} thay đổi chờ đồng bộ
              </span>
            )}
          </div>
        </div>
      )}

      {isOnline && isSyncing && (
        <div role="status" className="animate-fade-in border-b border-brand-100 bg-brand-50">
          <div className="mx-auto flex max-w-[96rem] items-center gap-2.5 px-4 py-2 text-[13px] text-brand-700 sm:px-6 lg:px-8">
            <RefreshCw className="size-3.5 shrink-0 animate-spin" />
            <span>Đang đồng bộ dữ liệu ghi chú lên máy chủ…</span>
          </div>
        </div>
      )}

      {isOnline && !isSyncing && pendingCount > 0 && (
        <div role="status" className="animate-fade-in border-b border-line bg-paper">
          <div className="mx-auto flex max-w-[96rem] items-center justify-between gap-2.5 px-4 py-2 text-[13px] text-ink-soft sm:px-6 lg:px-8">
            <span className="tabular-nums">Có {pendingCount} thay đổi ghi chú chưa tải lên máy chủ.</span>
            <button
              type="button"
              onClick={triggerSync}
              className="cursor-pointer font-medium text-brand-600 hover:text-brand-700 underline"
            >
              Đồng bộ ngay
            </button>
          </div>
        </div>
      )}

      {serverSlow && (
        <div role="status" className="animate-fade-in border-b border-[#f0dcb8] bg-warn-soft">
          <div className="mx-auto flex max-w-[96rem] items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#7a4a0c] sm:px-6 lg:px-8">
            <ServerCog className="size-4 shrink-0 animate-pulse" />
            Máy chủ đang khởi động lại sau thời gian không hoạt động, có thể mất tới một phút. Vui lòng chờ…
          </div>
        </div>
      )}

      <main
        className={`mx-auto max-w-[96rem] ${
          route.tab === 'chat'
            ? 'px-2.5 py-2.5 sm:px-6 sm:py-6 lg:px-8'
            : 'px-4 py-5 sm:px-6 sm:py-10 lg:px-8'
        }`}
      >
        {/* Luôn giữ LivePage, UploadPage & ScanPage được mount để việc ghi âm / tải lên không bị ngắt khi chuyển tab. */}
        {/* Mỗi trang tự giới hạn bề rộng phần form; transcript được dùng toàn bộ chiều ngang. */}
        <div hidden={route.tab !== 'live'}>
          <LivePage onOpenSession={openSession} onRecordingChange={setRecording} />
        </div>
        <div hidden={route.tab !== 'upload'}>
          <UploadPage onOpenHistory={() => navigate('history')} onOpenSession={openSession} />
        </div>
        <div hidden={route.tab !== 'scan'}>
          <ScanPage onOpenHistory={() => navigate('history')} onOpenSession={openSession} />
        </div>
        {route.tab === 'notes' && (
          <Suspense fallback={<PageFallback />}>
            {route.id ? (
              <NoteDetail key={route.id} noteId={route.id} onBack={() => navigate('notes')} onDeleted={() => navigate('notes')} />
            ) : (
              <NotesPage onOpen={(id) => navigate(`notes/${id}`)} />
            )}
          </Suspense>
        )}
        {route.tab === 'chat' && (
          <Suspense fallback={<PageFallback />}>
            <ChatPage onOpenSession={openSession} onOpenNote={(id) => navigate(`notes/${id}`)} />
          </Suspense>
        )}
        {route.tab === 'history' &&
          (route.id ? (
            <SessionDetail
              key={route.id}
              sessionId={route.id}
              onBack={() => navigate('history')}
              onDeleted={() => navigate('history')}
              onOpenSession={openSession}
            />
          ) : (
            <div className="mx-auto max-w-4xl">
              <HistoryPage onOpen={openSession} onNavigate={navigate} />
            </div>
          ))}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        aria-label="Điều hướng chính"
      >
        <div className="grid grid-cols-6">
          {TABS.map((tab) => {
            const active = route.tab === tab.id
            return (
              <a
                key={tab.id}
                href={`#/${tab.id}`}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-w-0 flex-col items-center gap-0.5 py-2 text-[10.5px] leading-tight font-medium transition-colors ${active ? 'text-brand-700' : 'text-muted'}`}
              >
                <span className={`grid h-6 w-10 place-items-center rounded-full transition-colors duration-200 ${active ? 'bg-brand-50' : ''}`}>
                  <tab.icon className="size-[17px]" />
                </span>
                <span className="max-w-full truncate px-0.5">{tab.short}</span>
                {tab.id === 'live' && recording && <span className="absolute top-1.5 right-[calc(50%-1rem)] size-2 animate-rec-pulse rounded-full bg-rec" />}
              </a>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
