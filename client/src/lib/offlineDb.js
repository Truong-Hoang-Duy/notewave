import Dexie from 'dexie'

/**
 * Cơ sở dữ liệu IndexedDB của NoteWave (dùng Dexie)
 * - Lưu bản sao các ghi chú, thư mục, tag trên máy để có thể xem, tìm kiếm và sửa khi ngoại tuyến (GĐ4).
 * - Hàng đợi `pendingSync`: lưu các thay đổi phát sinh khi mất mạng (tạo, sửa, xoá), tự đồng bộ khi có mạng lại.
 */
export const db = new Dexie('notewave_offline_db')

db.version(1).stores({
  notes: 'id, title, folder_id, updated_at, created_at',
  folders: 'id, parent_id, name',
  tags: 'id, name',
  pendingSync: '++id, note_id, action, created_at',
})

// Bộ lắng nghe trạng thái đồng bộ
const syncListeners = new Set()
let syncStatus = { isSyncing: false, pendingCount: 0, lastSyncedAt: null, error: null }

function notifySync(patch) {
  syncStatus = { ...syncStatus, ...patch }
  syncListeners.forEach((fn) => fn(syncStatus))
}

export function subscribeSyncStatus(fn) {
  syncListeners.add(fn)
  fn(syncStatus)
  return () => syncListeners.delete(fn)
}

export async function getPendingCount() {
  try {
    return await db.pendingSync.count()
  } catch {
    return 0
  }
}

/** Cập nhật số lượng việc chờ đồng bộ vào status */
export async function refreshPendingCount() {
  const count = await getPendingCount()
  notifySync({ pendingCount: count })
  return count
}

/** Lưu danh sách ghi chú tải từ máy chủ vào cache IndexedDB */
export async function cacheNotes(noteItems = []) {
  if (!Array.isArray(noteItems) || !noteItems.length) return
  try {
    await db.transaction('rw', db.notes, async () => {
      for (const item of noteItems) {
        if (!item?.id) continue
        const existing = await db.notes.get(item.id)
        if (existing) {
          // Giữ lại content_json / cues nếu có sẵn trong cache chi tiết
          await db.notes.put({
            ...existing,
            ...item,
            content_json: existing.content_json ?? item.content_json,
            cues: existing.cues?.length ? existing.cues : item.cues ?? [],
          })
        } else {
          await db.notes.put(item)
        }
      }
    })
  } catch (err) {
    console.warn('[OfflineDB] cacheNotes failed:', err)
  }
}

/** Lưu chi tiết đầy đủ của một ghi chú vào cache IndexedDB */
export async function cacheNote(note) {
  if (!note?.id) return
  try {
    await db.notes.put(note)
  } catch (err) {
    console.warn('[OfflineDB] cacheNote failed:', err)
  }
}

/** Lưu danh sách thư mục vào cache IndexedDB */
export async function cacheFolders(folders = []) {
  try {
    await db.transaction('rw', db.folders, async () => {
      await db.folders.clear()
      if (folders.length) await db.folders.bulkPut(folders)
    })
  } catch (err) {
    console.warn('[OfflineDB] cacheFolders failed:', err)
  }
}

/** Lưu danh sách tag vào cache IndexedDB */
export async function cacheTags(tags = []) {
  try {
    await db.transaction('rw', db.tags, async () => {
      await db.tags.clear()
      if (tags.length) await db.tags.bulkPut(tags)
    })
  } catch (err) {
    console.warn('[OfflineDB] cacheTags failed:', err)
  }
}

/** Đọc danh sách thư mục từ cache IndexedDB */
export async function getOfflineFolders() {
  try {
    return await db.folders.toArray()
  } catch {
    return []
  }
}

/** Đọc danh sách tag từ cache IndexedDB */
export async function getOfflineTags() {
  try {
    return await db.tags.toArray()
  } catch {
    return []
  }
}

/** Đọc chi tiết một ghi chú từ cache IndexedDB */
export async function getOfflineNote(noteId) {
  try {
    return (await db.notes.get(noteId)) || null
  } catch {
    return null
  }
}

/**
 * Truy vấn danh sách ghi chú ngoại tuyến (lọc theo query, thư mục, tag và sắp xếp)
 */
export async function getOfflineNotes({ q = '', folderId = '', tagId = '', sort = 'updated_desc' } = {}) {
  try {
    let all = await db.notes.toArray()

    // 1. Lọc theo thư mục
    if (folderId === 'none') {
      all = all.filter((n) => !n.folder_id && (!n.folder || !n.folder.id))
    } else if (folderId) {
      all = all.filter((n) => n.folder_id === folderId || n.folder?.id === folderId)
    }

    // 2. Lọc theo tag
    if (tagId) {
      all = all.filter((n) => n.tags?.some((t) => t.id === tagId) || n.tag_ids?.includes(tagId))
    }

    // 3. Tìm kiếm từ khoá
    if (q) {
      const needle = q.trim().toLowerCase()
      all = all.filter((n) => {
        const title = (n.title || '').toLowerCase()
        const preview = (n.preview || '').toLowerCase()
        const summary = (n.summary || '').toLowerCase()
        const md = (n.content_md || '').toLowerCase()
        const cuesText = (n.cues || []).map((c) => c.text || '').join(' ').toLowerCase()
        return title.includes(needle) || preview.includes(needle) || summary.includes(needle) || md.includes(needle) || cuesText.includes(needle)
      })
    }

    // 4. Sắp xếp
    all.sort((a, b) => {
      if (sort === 'created_desc') return Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)
      if (sort === 'created_asc') return Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0)
      if (sort === 'title_asc') return (a.title || '').localeCompare(b.title || '', 'vi')
      if (sort === 'title_desc') return (b.title || '').localeCompare(a.title || '', 'vi')
      // Mặc định: updated_desc
      return Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0)
    })

    // Chuẩn hoá các trường hiển thị của item
    const items = all.map((n) => ({
      id: n.id,
      title: n.title || 'Ghi chú không tên',
      updated_at: n.updated_at || n.created_at || new Date().toISOString(),
      created_at: n.created_at || new Date().toISOString(),
      folder: n.folder ?? (n.folder_id ? { id: n.folder_id, name: '' } : null),
      tags: n.tags ?? [],
      cue_count: Array.isArray(n.cues) ? n.cues.length : (n.cue_count ?? 0),
      preview: n.preview || (n.content_md ? n.content_md.slice(0, 160).replace(/[#*`[\]]/g, '').trim() : ''),
      _offline: Boolean(n._offline),
    }))

    return { items, total: items.length }
  } catch (err) {
    console.warn('[OfflineDB] getOfflineNotes failed:', err)
    return { items: [], total: 0 }
  }
}

/**
 * Lưu thay đổi ghi chú khi ngoại tuyến:
 * - Cập nhật trực tiếp bản ghi trong `db.notes`
 * - Ghi vào hàng đợi `pendingSync` để gửi lên máy chủ khi có mạng
 */
export async function saveOfflineNotePatch(noteId, patch) {
  try {
    const existing = await db.notes.get(noteId)
    const now = new Date().toISOString()
    const updated = {
      ...(existing || {}),
      id: noteId,
      ...patch,
      updated_at: now,
    }
    await db.notes.put(updated)

    // Kiểm tra hàng đợi pendingSync
    await db.transaction('rw', db.pendingSync, async () => {
      const existingPending = await db.pendingSync.where('note_id').equals(noteId).first()
      if (existingPending) {
        if (existingPending.action === 'create') {
          // Ghép patch vào ghi chú đang chờ tạo
          existingPending.note = { ...existingPending.note, ...patch, updated_at: now }
          await db.pendingSync.put(existingPending)
        } else if (existingPending.action === 'update') {
          // Gộp patch vào lượt cập nhật trước đó
          existingPending.patch = { ...existingPending.patch, ...patch }
          existingPending.updated_at = now
          await db.pendingSync.put(existingPending)
        }
      } else {
        await db.pendingSync.add({
          note_id: noteId,
          action: 'update',
          patch,
          created_at: Date.now(),
        })
      }
    })

    await refreshPendingCount()
    return updated
  } catch (err) {
    console.error('[OfflineDB] saveOfflineNotePatch failed:', err)
    throw err
  }
}

/**
 * Tạo một ghi chú mới khi đang ngoại tuyến:
 * - Sinh mã ID tạm thời bắt đầu bằng "offline_"
 * - Lưu vào cache IndexedDB và thêm vào hàng đợi pendingSync
 */
export async function createOfflineNote({ folder_id = null, tag_ids = [] } = {}) {
  try {
    const offlineId = 'offline_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10))
    const now = new Date().toISOString()

    const cachedFolders = await getOfflineFolders()
    const cachedTags = await getOfflineTags()
    const folder = folder_id ? cachedFolders.find((f) => f.id === folder_id) || { id: folder_id, name: '' } : null
    const tags = tag_ids.length ? cachedTags.filter((t) => tag_ids.includes(t.id)) : []

    const note = {
      id: offlineId,
      title: 'Ghi chú không tên',
      cues: [],
      content_json: null,
      content_md: '',
      summary: '',
      style: { theme: 'classic', font: 'system', font_size: 'base' },
      folder_id: folder_id || null,
      folder,
      tags,
      tag_ids,
      created_at: now,
      updated_at: now,
      _offline: true,
    }

    await db.notes.put(note)
    await db.pendingSync.add({
      note_id: offlineId,
      action: 'create',
      note,
      created_at: Date.now(),
    })

    await refreshPendingCount()
    return note
  } catch (err) {
    console.error('[OfflineDB] createOfflineNote failed:', err)
    throw err
  }
}

/**
 * Xoá một ghi chú khi đang ngoại tuyến
 */
export async function deleteOfflineNote(noteId) {
  try {
    await db.notes.delete(noteId)

    await db.transaction('rw', db.pendingSync, async () => {
      const existing = await db.pendingSync.where('note_id').equals(noteId).first()
      if (existing) {
        if (existing.action === 'create') {
          // Chưa gửi lên máy chủ -> chỉ cần huỷ hàng đợi tạo
          await db.pendingSync.delete(existing.id)
          return
        }
        // Xoá bản ghi update cũ
        await db.pendingSync.delete(existing.id)
      }
      // Ghi hàng đợi xoá lên máy chủ
      await db.pendingSync.add({
        note_id: noteId,
        action: 'delete',
        created_at: Date.now(),
      })
    })

    await refreshPendingCount()
  } catch (err) {
    console.error('[OfflineDB] deleteOfflineNote failed:', err)
    throw err
  }
}

/**
 * Đồng bộ toàn bộ hàng đợi thay đổi lên máy chủ (khi có kết nối Internet)
 */
export async function syncPendingNotes(apiClient) {
  if (syncStatus.isSyncing) return { syncedCount: 0, errors: [] }
  notifySync({ isSyncing: true, error: null })

  let syncedCount = 0
  const errors = []

  try {
    const queue = await db.pendingSync.orderBy('id').toArray()
    if (!queue.length) {
      notifySync({ isSyncing: false, pendingCount: 0, lastSyncedAt: Date.now() })
      return { syncedCount: 0, errors: [] }
    }

    for (const item of queue) {
      try {
        if (item.action === 'create') {
          const { folder_id, tag_ids, title, cues, content_json, content_md, summary, style } = item.note
          // 1. Tạo note trên máy chủ để nhận UUID thật
          const created = await apiClient.createNote({ folder_id, tag_ids })
          const realId = created.id

          // 2. Cập nhật nội dung đầy đủ
          const patch = {}
          if (title && title !== 'Ghi chú không tên') patch.title = title
          if (cues?.length) patch.cues = cues
          if (content_json) patch.content_json = content_json
          if (content_md) patch.content_md = content_md
          if (summary) patch.summary = summary
          if (style) patch.style = style

          let finalNote = created
          if (Object.keys(patch).length > 0) {
            finalNote = await apiClient.updateNote(realId, patch)
          }

          // 3. Hoán đổi ID tạm thành ID thật trong IndexedDB
          await db.transaction('rw', [db.notes, db.pendingSync], async () => {
            await db.notes.delete(item.note_id)
            await db.notes.put({ ...finalNote, _offline: false })
            // Nếu có các item khác trong queue trỏ tới id tạm -> đổi sang realId
            const others = await db.pendingSync.where('note_id').equals(item.note_id).toArray()
            for (const other of others) {
              if (other.id !== item.id) {
                other.note_id = realId
                await db.pendingSync.put(other)
              }
            }
            await db.pendingSync.delete(item.id)
          })

          // Nếu người dùng đang mở trang note với ID tạm, chuyển hash sang ID thật
          if (typeof window !== 'undefined' && window.location.hash === `#/notes/${item.note_id}`) {
            window.location.hash = `#/notes/${realId}`
          }

          syncedCount += 1
        } else if (item.action === 'update') {
          // Nếu id vẫn là offline_, chờ bước create chạy trước
          if (item.note_id.startsWith('offline_')) {
            continue
          }
          const updated = await apiClient.updateNote(item.note_id, item.patch)
          await db.notes.put({ ...updated, _offline: false })
          await db.pendingSync.delete(item.id)
          syncedCount += 1
        } else if (item.action === 'delete') {
          if (!item.note_id.startsWith('offline_')) {
            try {
              await apiClient.deleteNote(item.note_id)
            } catch (err) {
              // 404 nghĩa là máy chủ đã xoá rồi, coi như thành công
              if (err?.status !== 404) throw err
            }
          }
          await db.pendingSync.delete(item.id)
          syncedCount += 1
        }
      } catch (itemErr) {
        console.warn(`[OfflineDB] Lỗi đồng bộ mục ${item.id} (${item.action}):`, itemErr)
        errors.push({ id: item.id, note_id: item.note_id, error: itemErr })
        // Nếu lỗi 404 / 422 không thể sửa đổi: bỏ qua mục này để không kẹt hàng đợi
        if (itemErr?.status === 404 || itemErr?.status === 422) {
          await db.pendingSync.delete(item.id)
        }
      }
    }
  } catch (err) {
    console.error('[OfflineDB] Quá trình đồng bộ gặp lỗi:', err)
    errors.push({ error: err })
  } finally {
    const remaining = await getPendingCount()
    notifySync({
      isSyncing: false,
      pendingCount: remaining,
      lastSyncedAt: Date.now(),
      error: errors.length ? errors[0].error : null,
    })
  }

  return { syncedCount, errors }
}
