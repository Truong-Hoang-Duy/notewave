import { useCallback, useState } from 'react'

/** Theo dõi vùng cuộn nội bộ đã rời khỏi đầu hay chưa — dùng để hiện bóng/viền dưới header cố định. */
export function useScrolled(threshold = 4) {
  const [scrolled, setScrolled] = useState(false)
  const onScroll = useCallback((e) => setScrolled(e.currentTarget.scrollTop > threshold), [threshold])
  return [scrolled, onScroll]
}
