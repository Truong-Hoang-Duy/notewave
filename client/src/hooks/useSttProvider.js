import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'notewave:stt-provider'
const VALID_PROVIDERS = ['deepgram', 'gladia']

export const STT_PROVIDERS = [
  { id: 'deepgram', label: 'Deepgram', detail: 'Nova-3' },
  { id: 'gladia', label: 'Gladia', detail: 'v2' },
]

function loadStoredProvider() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (VALID_PROVIDERS.includes(saved)) return { provider: saved, hasUserChoice: true }
  } catch {
    /* localStorage bị chặn */
  }
  return { provider: 'deepgram', hasUserChoice: false }
}

const initial = loadStoredProvider()
let state = {
  provider: initial.provider,
  hasUserChoice: initial.hasUserChoice,
  available: VALID_PROVIDERS,
}

const listeners = new Set()

function emit() {
  listeners.forEach((fn) => fn())
}

export function getSttProvider() {
  return state.provider
}

export function setSttProvider(next) {
  if (!VALID_PROVIDERS.includes(next)) return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* localStorage bị chặn */
  }
  if (state.provider === next && state.hasUserChoice) return
  state = { ...state, provider: next, hasUserChoice: true }
  emit()
}

export function syncSttFromHealth(health) {
  if (!health || typeof health !== 'object') return
  const available = Array.isArray(health.stt_providers) && health.stt_providers.length
    ? health.stt_providers.filter((p) => VALID_PROVIDERS.includes(p))
    : state.available
  let nextProvider = state.provider
  // Nếu người dùng chưa tự chọn hoặc provider đang chọn chưa cấu hình key trên server, tự chuyển sang provider sẵn sàng.
  if (available.length && (!available.includes(nextProvider) || (!state.hasUserChoice && health.stt_provider && VALID_PROVIDERS.includes(health.stt_provider)))) {
    nextProvider = available.includes(health.stt_provider) ? health.stt_provider : available[0]
  }
  if (nextProvider !== state.provider || available.join(',') !== state.available.join(',')) {
    state = { ...state, provider: nextProvider, available }
    emit()
  }
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useSttProvider() {
  const snapshot = useSyncExternalStore(subscribe, () => state)
  return {
    provider: snapshot.provider,
    available: snapshot.available,
    setProvider: setSttProvider,
  }
}

