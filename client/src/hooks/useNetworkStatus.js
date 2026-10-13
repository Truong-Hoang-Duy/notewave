import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { refreshPendingCount, subscribeSyncStatus, syncPendingNotes } from '../lib/offlineDb'

/**
 * Hook theo dõi trạng thái mạng (online/offline) và tiến trình đồng bộ IndexedDB (GĐ4)
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const [syncState, setSyncState] = useState({ isSyncing: false, pendingCount: 0, lastSyncedAt: null, error: null })

  useEffect(() => {
    const unsub = subscribeSyncStatus(setSyncState)
    refreshPendingCount()

    const onOnline = () => {
      setIsOnline(true)
      // Khi có mạng lại, tự động đẩy hàng đợi pendingSync lên máy chủ
      syncPendingNotes(api)
    }

    const onOffline = () => {
      setIsOnline(false)
      refreshPendingCount()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    // Kiểm tra và đồng bộ ngay nếu đang online mà còn mục chờ
    if (navigator.onLine) {
      syncPendingNotes(api)
    }

    return () => {
      unsub()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const triggerSync = () => syncPendingNotes(api)

  return {
    isOnline,
    ...syncState,
    triggerSync,
  }
}
