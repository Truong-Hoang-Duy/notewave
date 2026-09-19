import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../lib/api'

/**
 * Kho thư mục + tag của Ghi chú, dùng chung toàn app (danh sách note, trang chi tiết, bộ chọn thư mục/tag)
 * — cùng mẫu với `useGroups`: tạo/đổi tên/xoá ở một nơi thì mọi nơi cập nhật theo.
 */
let state = { folders: [], tags: [], loaded: false, loading: false, error: null }
const listeners = new Set()
let inflight = null

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

export function refreshNoteLibrary() {
  if (inflight) return inflight
  setState({ loading: true, error: null })
  inflight = Promise.all([api.listNoteFolders(), api.listTags()])
    .then(([folders, tags]) => setState({ folders, tags, loaded: true, loading: false }))
    .catch((error) => setState({ error, loading: false }))
    .finally(() => {
      inflight = null
    })
  return inflight
}

async function mutate(promise) {
  const result = await promise
  await refreshNoteLibrary()
  return result
}

export const noteLibraryActions = {
  createFolder: (name, parentId = null) => mutate(api.createNoteFolder(name, parentId)),
  renameFolder: (id, name) => mutate(api.updateNoteFolder(id, { name })),
  moveFolder: (id, parentId) => mutate(api.updateNoteFolder(id, { parent_id: parentId })),
  deleteFolder: (id) => mutate(api.deleteNoteFolder(id)),
  createTag: (name) => mutate(api.createTag(name)),
  renameTag: (id, name) => mutate(api.renameTag(id, name)),
  deleteTag: (id) => mutate(api.deleteTag(id)),
  refresh: refreshNoteLibrary,
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useNoteLibrary() {
  const snapshot = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (!state.loaded && !state.loading) refreshNoteLibrary()
  }, [])
  return snapshot
}

/** Dựng cây từ danh sách phẳng (kèm parent_id). Trả về node gốc: { children: [{ folder, children, depth }] }. */
export function buildFolderTree(folders) {
  const byParent = new Map()
  for (const f of folders) {
    const key = f.parent_id ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(f)
  }
  const ids = new Set(folders.map((f) => f.id))
  const build = (parentId, depth) =>
    (byParent.get(parentId) ?? []).map((folder) => ({ folder, depth, children: build(folder.id, depth + 1) }))
  // Thư mục có parent_id trỏ tới thư mục không còn tồn tại -> coi như ở gốc (phòng dữ liệu lệch).
  const orphans = folders.filter((f) => f.parent_id && !ids.has(f.parent_id)).map((folder) => ({ folder, depth: 0, children: build(folder.id, 1) }))
  return [...build(null, 0), ...orphans]
}

/** Làm phẳng cây theo thứ tự hiển thị (dùng cho <select> thụt lề). */
export function flattenFolderTree(tree) {
  const out = []
  const walk = (nodes) =>
    nodes.forEach((n) => {
      out.push(n)
      walk(n.children)
    })
  walk(tree)
  return out
}

/** Đường dẫn "Cha / Con" của một thư mục. */
export function folderPath(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const parts = []
  const seen = new Set()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parts.unshift(current.name)
    current = current.parent_id ? byId.get(current.parent_id) : null
  }
  return parts.join(' / ')
}
