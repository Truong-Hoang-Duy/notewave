import { Component } from 'react'
import { Button, Card, ErrorState } from './ui'

/**
 * Lưới an toàn: lỗi JS trong một component (kể cả trong effect cleanup) sẽ làm React gỡ toàn bộ cây và người dùng
 * thấy trang trắng. Bọc app lại để hiện thông báo + nút tải lại thay vì màn hình trống.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Lỗi giao diện:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <ErrorState
            title="Giao diện gặp sự cố"
            message="Đã có lỗi khiến màn hình không hiển thị được. Dữ liệu đã lưu vẫn an toàn trong Lịch sử."
          >
            <Button variant="primary" onClick={() => window.location.reload()}>
              Tải lại trang
            </Button>
          </ErrorState>
          <p className="border-t border-line px-6 py-3 font-mono text-[12px] break-words text-muted">
            {String(this.state.error?.message || this.state.error)}
          </p>
        </Card>
      </div>
    )
  }
}
