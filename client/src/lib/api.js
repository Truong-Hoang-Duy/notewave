const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

/** Sau ngưỡng này mà request chưa xong, coi như backend (Render free) đang "thức dậy". */
const SLOW_REQUEST_MS = 4000

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// ---- Theo dõi request chậm để hiển thị banner "máy chủ đang khởi động" ----
let slowCount = 0
const slowListeners = new Set()
function setSlow(delta) {
  slowCount = Math.max(0, slowCount + delta)
  slowListeners.forEach((fn) => fn(slowCount > 0))
}
export function subscribeSlowRequests(fn) {
  slowListeners.add(fn)
  return () => slowListeners.delete(fn)
}

function trackSlow() {
  let flagged = false
  const timer = setTimeout(() => {
    flagged = true
    setSlow(1)
  }, SLOW_REQUEST_MS)
  return () => {
    clearTimeout(timer)
    if (flagged) setSlow(-1)
  }
}

function detailToMessage(detail, status) {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length) return 'Dữ liệu gửi lên không hợp lệ.'
  if (status === 404) return 'Không tìm thấy dữ liệu.'
  if (status >= 500) return 'Máy chủ gặp sự cố. Vui lòng thử lại sau.'
  return `Yêu cầu thất bại (mã ${status}).`
}

const NETWORK_ERROR_MESSAGE = 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.'

async function request(path, { method = 'GET', json, signal, raw = false, keepalive = false } = {}) {
  const done = trackSlow()
  let response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal,
      keepalive,
      headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: json !== undefined ? JSON.stringify(json) : undefined,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0)
  } finally {
    done()
  }
  if (!response.ok) {
    let detail
    try {
      detail = (await response.json()).detail
    } catch {
      /* body không phải JSON */
    }
    throw new ApiError(detailToMessage(detail, response.status), response.status)
  }
  if (raw) return response
  if (response.status === 204) return null
  return response.json()
}

export const api = {
  health: () => request('/api/health'),
  getTemporaryKey: () => request('/api/temporary-key', { method: 'POST' }),

  listSessions: ({ q, source, groupId, archived, sort, signal } = {}) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (source) params.set('source', source)
    if (sort) params.set('sort', sort)
    if (groupId) params.set('group_id', groupId)
    if (archived) params.set('archived', 'true')
    const qs = params.toString()
    return request(`/api/sessions${qs ? `?${qs}` : ''}`, { signal })
  },
  getSession: (id, { signal } = {}) => request(`/api/sessions/${id}`, { signal }),
  createSession: (payload) => request('/api/sessions', { method: 'POST', json: payload }),
  renameSession: (id, title) => request(`/api/sessions/${id}`, { method: 'PATCH', json: { title } }),
  deleteSession: (id) => request(`/api/sessions/${id}`, { method: 'DELETE' }),
  updateSegments: (id, segments) => request(`/api/sessions/${id}/segments`, { method: 'PUT', json: { segments } }),
  restoreSession: (id) => request(`/api/sessions/${id}/restore`, { method: 'POST' }),
  mergeSessions: (payload) => request('/api/sessions/merge', { method: 'POST', json: payload }),
  assignGroup: (sessionIds, groupId) =>
    request('/api/sessions/assign-group', { method: 'POST', json: { session_ids: sessionIds, group_id: groupId } }),

  listGroups: () => request('/api/groups'),
  createGroup: (name) => request('/api/groups', { method: 'POST', json: { name } }),
  renameGroup: (id, name) => request(`/api/groups/${id}`, { method: 'PATCH', json: { name } }),
  deleteGroup: (id) => request(`/api/groups/${id}`, { method: 'DELETE' }),

  listNotes: ({ q, folderId, tagId, sort, signal } = {}) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (folderId) params.set('folder_id', folderId)
    if (tagId) params.set('tag_id', tagId)
    if (sort) params.set('sort', sort)
    params.set('limit', '200')
    return request(`/api/notes?${params}`, { signal })
  },
  getNote: (id, { signal } = {}) => request(`/api/notes/${id}`, { signal }),
  createNote: (payload = {}) => request('/api/notes', { method: 'POST', json: payload }),
  /** Autosave: chỉ gửi field đã đổi. `keepalive` dùng khi đóng tab (giới hạn body ~64KB của trình duyệt). */
  updateNote: (id, patch, { keepalive = false } = {}) => request(`/api/notes/${id}`, { method: 'PATCH', json: patch, keepalive }),
  deleteNote: (id) => request(`/api/notes/${id}`, { method: 'DELETE' }),

  listNoteFolders: () => request('/api/note-folders'),
  createNoteFolder: (name, parentId = null) => request('/api/note-folders', { method: 'POST', json: { name, parent_id: parentId } }),
  updateNoteFolder: (id, patch) => request(`/api/note-folders/${id}`, { method: 'PATCH', json: patch }),
  deleteNoteFolder: (id) => request(`/api/note-folders/${id}`, { method: 'DELETE' }),

  listTags: () => request('/api/tags'),
  createTag: (name) => request('/api/tags', { method: 'POST', json: { name } }),
  renameTag: (id, name) => request(`/api/tags/${id}`, { method: 'PATCH', json: { name } }),
  deleteTag: (id) => request(`/api/tags/${id}`, { method: 'DELETE' }),

  summarizeSession: (id) => request(`/api/sessions/${id}/summarize`, { method: 'POST' }),
  uploadStatus: (id, { signal } = {}) => request(`/api/upload-transcribe/${id}/status`, { signal }),
  ocrStatus: (id, { signal } = {}) => request(`/api/ocr-extract/${id}/status`, { signal }),
  /** Chấp nhận / bỏ qua đề xuất sửa từ tiếng Anh của phiên quét tài liệu. */
  decideOcrCorrections: (id, { accept = [], reject = [] }) =>
    request(`/api/sessions/${id}/ocr-corrections`, { method: 'POST', json: { accept, reject } }),

  async exportSession(id, format) {
    const response = await request(`/api/sessions/${id}/export?format=${format}`, { raw: true })
    const blob = await response.blob()
    const filename = parseFilename(response.headers.get('Content-Disposition')) || `notewave.${format}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },

  /** Upload 1 file audio -> Soniox Async API (1 request = 1 phiên; tải nhiều file = nhiều request). */
  uploadAudio: (file, { groupId, ...options } = {}) =>
    uploadWithProgress('/api/upload-transcribe', { file, group_id: groupId }, options),
  /** Upload 1 hoặc nhiều ảnh / PDF -> gộp thành 1 phiên, Mistral OCR + rà soát từ tiếng Anh (xử lý nền). */
  ocrExtract: (files, options) => uploadWithProgress('/api/ocr-extract', { files: [].concat(files) }, options),
}

/**
 * Upload multipart kèm tiến trình (fetch chưa hỗ trợ upload progress nên dùng XHR).
 * `fields`: { tên field: giá trị | File | File[] } — mảng được gửi lặp lại cùng tên field; bỏ qua giá trị rỗng.
 * @returns {{ promise: Promise<object>, abort: () => void }}
 */
function uploadWithProgress(path, fields, { title, onProgress } = {}) {
  const xhr = new XMLHttpRequest()
  const promise = new Promise((resolve, reject) => {
    const form = new FormData()
    for (const [name, value] of Object.entries({ ...fields, title })) {
      for (const v of [].concat(value)) if (v != null && v !== '') form.append(name, v)
    }
    xhr.open('POST', `${BASE_URL}${path}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body)
      else reject(new ApiError(detailToMessage(body?.detail, xhr.status), xhr.status))
    }
    xhr.onerror = () => reject(new ApiError(NETWORK_ERROR_MESSAGE, 0))
    xhr.onabort = () => reject(new DOMException('Đã huỷ', 'AbortError'))
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}

function parseFilename(disposition) {
  if (!disposition) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star) return decodeURIComponent(star[1])
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1] : null
}
