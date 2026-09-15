import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../lib/api'

/**
 * Kho nhóm tài liệu dùng chung toàn app (trang Lịch sử, chi tiết phiên, hộp thoại gộp/quản lý nhóm)
 * để khi tạo/đổi tên/xoá nhóm ở một nơi, mọi nơi khác cập nhật theo.
 */
let state = { groups: [], loaded: false, loading: false, error: null }
const listeners = new Set()
let inflight = null

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

export function refreshGroups() {
  if (inflight) return inflight
  setState({ loading: true, error: null })
  inflight = api
    .listGroups()
    .then((groups) => setState({ groups, loaded: true, loading: false }))
    .catch((error) => setState({ error, loading: false }))
    .finally(() => {
      inflight = null
    })
  return inflight
}

export const groupActions = {
  async create(name) {
    const group = await api.createGroup(name)
    await refreshGroups()
    return group
  },
  async rename(id, name) {
    await api.renameGroup(id, name)
    await refreshGroups()
  },
  async remove(id) {
    await api.deleteGroup(id)
    await refreshGroups()
  },
  async assign(sessionIds, groupId) {
    const res = await api.assignGroup(sessionIds, groupId)
    await refreshGroups()
    return res
  },
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useGroups() {
  const snapshot = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (!state.loaded && !state.loading) refreshGroups()
  }, [])
  return snapshot
}
