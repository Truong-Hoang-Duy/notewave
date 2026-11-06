import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'notewave:chat-state'
const MAX_THREADS = 12
const MAX_MESSAGES = 40

export const TTL_OPTIONS = [
  { hours: 2, label: '2 giờ' },
  { hours: 24, label: '24 giờ' },
  { hours: 72, label: '3 ngày' },
]

function makeId() {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function createEmptyThread(ttlHours = 24, patch = {}) {
  const now = Date.now()
  return {
    id: makeId(),
    title: 'Cuộc trò chuyện mới',
    sessionIds: [],
    noteIds: [],
    messages: [],
    createdAt: now,
    updatedAt: now,
    expiresAt: now + ttlHours * 3600 * 1000,
    ...patch,
  }
}

function loadInitialState() {
  const now = Date.now()
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (raw && typeof raw === 'object') {
      const ttlHours = TTL_OPTIONS.some((o) => o.hours === raw.ttlHours) ? raw.ttlHours : 24
      const validThreads = Array.isArray(raw.threads)
        ? raw.threads.filter((t) => t && typeof t === 'object' && (!t.expiresAt || t.expiresAt > now)).slice(0, MAX_THREADS)
        : []
      if (validThreads.length > 0) {
        const activeId = validThreads.some((t) => t.id === raw.activeThreadId)
          ? raw.activeThreadId
          : validThreads[0].id
        return { ttlHours, threads: validThreads, activeThreadId: activeId }
      }
      const first = createEmptyThread(ttlHours)
      return { ttlHours, threads: [first], activeThreadId: first.id }
    }
  } catch {
    /* localStorage lỗi hoặc bị chặn */
  }
  const first = createEmptyThread(24)
  return { ttlHours: 24, threads: [first], activeThreadId: first.id }
}

let state = loadInitialState()
const listeners = new Set()

function persistState(nextState) {
  state = nextState
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* localStorage đầy hoặc bị chặn */
  }
  listeners.forEach((fn) => fn())
}

/** Tự động quét và xoá các cuộc trò chuyện đã quá hạn TTL trên localStorage. */
export function purgeExpiredChatThreads() {
  const now = Date.now()
  const valid = state.threads.filter((t) => !t.expiresAt || t.expiresAt > now)
  if (valid.length === state.threads.length) return
  if (valid.length === 0) {
    const fresh = createEmptyThread(state.ttlHours)
    persistState({ ...state, threads: [fresh], activeThreadId: fresh.id })
    return
  }
  const activeThreadId = valid.some((t) => t.id === state.activeThreadId) ? state.activeThreadId : valid[0].id
  persistState({ ...state, threads: valid, activeThreadId })
}

export const chatActions = {
  setTtlHours(hours) {
    if (!TTL_OPTIONS.some((o) => o.hours === hours)) return
    const now = Date.now()
    const threads = state.threads.map((t) => ({
      ...t,
      expiresAt: now + hours * 3600 * 1000,
    }))
    persistState({ ...state, ttlHours: hours, threads })
  },

  selectThread(id) {
    if (!state.threads.some((t) => t.id === id)) return
    persistState({ ...state, activeThreadId: id })
  },

  createThread(patch = {}) {
    purgeExpiredChatThreads()
    const next = createEmptyThread(state.ttlHours, patch)
    const threads = [next, ...state.threads].slice(0, MAX_THREADS)
    persistState({ ...state, threads, activeThreadId: next.id })
    return next.id
  },

  deleteThread(id) {
    const remaining = state.threads.filter((t) => t.id !== id)
    if (remaining.length === 0) {
      const fresh = createEmptyThread(state.ttlHours)
      persistState({ ...state, threads: [fresh], activeThreadId: fresh.id })
      return
    }
    const activeThreadId = state.activeThreadId === id ? remaining[0].id : state.activeThreadId
    persistState({ ...state, threads: remaining, activeThreadId })
  },

  clearAll() {
    const fresh = createEmptyThread(state.ttlHours)
    persistState({ ...state, threads: [fresh], activeThreadId: fresh.id })
  },

  updateActiveThread(updater) {
    const now = Date.now()
    const ttlMs = state.ttlHours * 3600 * 1000
    const threads = state.threads.map((t) => {
      if (t.id !== state.activeThreadId) return t
      const patch = typeof updater === 'function' ? updater(t) : updater
      return {
        ...t,
        ...patch,
        updatedAt: now,
        expiresAt: now + ttlMs,
      }
    })
    persistState({ ...state, threads })
  },

  toggleSession(sessionId) {
    this.updateActiveThread((t) => {
      const exists = t.sessionIds.includes(sessionId)
      const sessionIds = exists ? t.sessionIds.filter((id) => id !== sessionId) : [...t.sessionIds, sessionId]
      return { sessionIds }
    })
  },

  toggleNote(noteId) {
    this.updateActiveThread((t) => {
      const exists = t.noteIds.includes(noteId)
      const noteIds = exists ? t.noteIds.filter((id) => id !== noteId) : [...t.noteIds, noteId]
      return { noteIds }
    })
  },

  setSources({ sessionIds, noteIds }) {
    this.updateActiveThread((t) => ({
      sessionIds: sessionIds !== undefined ? sessionIds : t.sessionIds,
      noteIds: noteIds !== undefined ? noteIds : t.noteIds,
    }))
  },

  appendMessage(message) {
    this.updateActiveThread((t) => {
      const messages = [...t.messages, { id: makeId(), createdAt: Date.now(), ...message }].slice(-MAX_MESSAGES)
      const isFirstUser = t.messages.length === 0 && message.role === 'user'
      const title = isFirstUser ? message.content.trim().slice(0, 60) : t.title
      return { messages, title }
    })
  },

  /** Mở tab Hỏi đáp (#/chat) và đính kèm sẵn một phiên hoặc một ghi chú cụ thể. */
  openWithSource({ sessionId, noteId, title }) {
    purgeExpiredChatThreads()
    const active = state.threads.find((t) => t.id === state.activeThreadId)
    if (active && active.messages.length === 0) {
      this.updateActiveThread({
        title: title ? `Hỏi về: ${title.slice(0, 45)}` : active.title,
        sessionIds: sessionId ? [sessionId] : [],
        noteIds: noteId ? [noteId] : [],
      })
    } else {
      this.createThread({
        title: title ? `Hỏi về: ${title.slice(0, 45)}` : 'Cuộc trò chuyện mới',
        sessionIds: sessionId ? [sessionId] : [],
        noteIds: noteId ? [noteId] : [],
      })
    }
    window.location.hash = '/chat'
  },
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useChatStore() {
  const snapshot = useSyncExternalStore(subscribe, () => state)
  const activeThread = snapshot.threads.find((t) => t.id === snapshot.activeThreadId) || snapshot.threads[0]
  return {
    ttlHours: snapshot.ttlHours,
    threads: snapshot.threads,
    activeThread,
  }
}
