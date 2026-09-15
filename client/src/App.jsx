import { FileAudio, History, Mic, ServerCog } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import SessionDetail from './components/SessionDetail'
import { api, subscribeSlowRequests } from './lib/api'
import HistoryPage from './pages/HistoryPage'
import LivePage from './pages/LivePage'
import UploadPage from './pages/UploadPage'

const TABS = [
  { id: 'live', label: 'Ghi âm trực tiếp', short: 'Ghi âm', icon: Mic },
  { id: 'upload', label: 'Tải file lên', short: 'Tải lên', icon: FileAudio },
  { id: 'history', label: 'Lịch sử', short: 'Lịch sử', icon: History },
]

/** Router tối giản dựa trên hash: #/live, #/upload, #/history, #/history/<id> */
function parseHash() {
  const [, tab, id] = window.location.hash.replace(/^#/, '').split('/')
  return { tab: TABS.some((t) => t.id === tab) ? tab : 'live', id: tab === 'history' ? id || null : null }
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

  useEffect(() => {
    // Đánh thức backend (Render free ngủ sau 15 phút) ngay khi mở app.
    api.health().catch(() => {})
    return subscribeSlowRequests(setServerSlow)
  }, [])

  const openSession = useCallback((id) => navigate(`history/${id}`), [navigate])

  return (
    <div className="min-h-svh pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[96rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
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
                  {tab.label}
                  {tab.id === 'live' && recording && <span className="size-2 animate-rec-pulse rounded-full bg-rec" aria-label="đang ghi" />}
                </a>
              )
            })}
          </nav>
          {recording && route.tab !== 'live' && (
            <a href="#/live" className="flex items-center gap-2 rounded-full bg-rec-soft px-3 py-1.5 text-xs font-semibold text-rec md:hidden">
              <span className="size-2 animate-rec-pulse rounded-full bg-rec" />
              Đang ghi
            </a>
          )}
        </div>
      </header>

      {serverSlow && (
        <div role="status" className="animate-fade-in border-b border-[#f0dcb8] bg-warn-soft">
          <div className="mx-auto flex max-w-[96rem] items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#7a4a0c] sm:px-6 lg:px-8">
            <ServerCog className="size-4 shrink-0 animate-pulse" />
            Máy chủ đang khởi động lại sau thời gian không hoạt động, có thể mất tới một phút. Vui lòng chờ…
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        {/* Luôn giữ LivePage & UploadPage được mount để việc ghi âm / tải lên không bị ngắt khi chuyển tab. */}
        {/* Mỗi trang tự giới hạn bề rộng phần form; transcript được dùng toàn bộ chiều ngang. */}
        <div hidden={route.tab !== 'live'}>
          <LivePage onOpenSession={openSession} onRecordingChange={setRecording} />
        </div>
        <div hidden={route.tab !== 'upload'}>
          <UploadPage onOpenHistory={() => navigate('history')} onOpenSession={openSession} />
        </div>
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
        <div className="grid grid-cols-3">
          {TABS.map((tab) => {
            const active = route.tab === tab.id
            return (
              <a
                key={tab.id}
                href={`#/${tab.id}`}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${active ? 'text-brand-700' : 'text-muted'}`}
              >
                <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors duration-200 ${active ? 'bg-brand-50' : ''}`}>
                  <tab.icon className="size-[18px]" />
                </span>
                {tab.short}
                {tab.id === 'live' && recording && <span className="absolute top-2 right-[calc(50%-1.25rem)] size-2 animate-rec-pulse rounded-full bg-rec" />}
              </a>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
