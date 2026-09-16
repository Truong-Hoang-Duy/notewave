import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { isPdf } from '../lib/files'
import { formatBytes } from '../lib/format'
import Modal from './Modal'
import { Button, Spinner } from './ui'

// pdf.js chỉ tải khi người dùng thực sự mở xem trước một file PDF.
const PdfPreview = lazy(() => import('./PdfPreview'))

/**
 * Xem trước file đã chọn (trước khi gửi lên): ảnh hiển thị full-size, PDF vẽ từng trang bằng pdf.js.
 * Có thể chuyển qua lại giữa các file trong danh sách và bỏ file ngay tại đây.
 */
export default function FilePreviewDialog({ items, index, previews, onIndexChange, onRemove, onClose }) {
  const item = index == null ? null : items[index]
  if (!item) return null

  const { file } = item
  const pdf = isPdf(file)
  const url = previews?.get(item.id)

  return (
    <Modal
      open
      size="xl"
      fill
      onClose={onClose}
      title={file.name}
      description={`${formatBytes(file.size)}${items.length > 1 ? ` · file ${index + 1}/${items.length}` : ''}`}
      footer={
        <>
          {onRemove && (
            <Button variant="danger-ghost" icon={Trash2} onClick={() => onRemove(item.id)}>
              Bỏ file này
            </Button>
          )}
          {items.length > 1 && (
            <div className="mr-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={() => onIndexChange(index - 1)} disabled={index === 0} aria-label="File trước" />
              <Button
                size="sm"
                variant="ghost"
                icon={ChevronRight}
                onClick={() => onIndexChange(index + 1)}
                disabled={index === items.length - 1}
                aria-label="File sau"
              />
            </div>
          )}
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </>
      }
    >
      {pdf ? (
        <Suspense
          fallback={
            <div className="grid min-h-[12rem] w-full place-items-center">
              <Spinner />
            </div>
          }
        >
          <PdfPreview file={file} />
        </Suspense>
      ) : url ? (
        // Ảnh co vừa vùng còn lại của hộp thoại (không cuộn), giữ đúng tỉ lệ.
        <img src={url} alt={file.name} className="m-auto max-h-full max-w-full rounded-xl border border-line bg-paper object-contain" />
      ) : (
        <p className="m-auto py-10 text-center text-sm text-muted">Không xem trước được file này.</p>
      )}
    </Modal>
  )
}
