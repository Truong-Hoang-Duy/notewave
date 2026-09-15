import { FileText, ScanText } from 'lucide-react'
import FileIngestPage from '../components/FileIngestPage'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'

// Giới hạn của Mistral OCR API cho mỗi file + giới hạn mỗi lần tải của NoteWave (backend kiểm tra lại, kể cả tổng số
// trang tối đa 1000 của một tài liệu).
const MAX_OCR_MB = 50
const MAX_FILES = 20
const MAX_BATCH_MB = 200
const ACCEPTED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff']

function validateFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !ACCEPTED_EXTENSIONS.includes(ext)) return `Định dạng “.${ext ?? '?'}” không được hỗ trợ (dùng PDF hoặc ảnh JPG, PNG, WEBP…).`
  if (file.size === 0) return 'File rỗng.'
  if (file.size > MAX_OCR_MB * 1024 * 1024) return `File lớn ${formatBytes(file.size)}, vượt giới hạn ${MAX_OCR_MB} MB.`
  return null
}

const CONFIG = {
  storageKey: 'notewave:active-scan',
  heading: 'Quét tài liệu',
  description:
    'Chụp hoặc tải lên biên bản viết tay, bảng trắng, tài liệu giấy hay file PDF — NoteWave trích xuất nội dung thành văn bản và rà soát các từ tiếng Anh viết sai. Chọn nhiều ảnh/PDF để gộp thành một tài liệu.',
  accept: `image/*,application/pdf,${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',')}`,
  dropHint: `PDF, JPG, PNG, WEBP… · mỗi file tối đa ${MAX_OCR_MB} MB`,
  validate: validateFile,
  maxFiles: MAX_FILES,
  maxTotalBytes: MAX_BATCH_MB * 1024 * 1024,
  fileIcon: FileText,
  fileIconTone: 'bg-[#e5f0f6] text-[#27709f]',
  camera: true,
  thumbnails: true,
  reorderable: true,
  batchHint: (count) =>
    count > 1 ? `${count} file sẽ được gộp thành 1 tài liệu theo thứ tự trên (tối đa 1000 trang).` : 'Tối đa 1000 trang.',
  submitLabel: (count) => (count > 1 ? `Trích xuất ${count} file thành 1 tài liệu` : 'Trích xuất nội dung'),
  sendingLabel: 'Đang gửi tới máy chủ…',
  upload: api.ocrExtract,
  fetchStatus: api.ocrStatus,
  processing: {
    title: 'Đang đọc tài liệu và rà soát từ tiếng Anh…',
    icon: ScanText,
    hint: 'Tài liệu nhiều trang / nhiều file có thể mất vài phút. Bạn có thể rời trang — kết quả sẽ nằm trong Lịch sử.',
  },
  doneMessage: (label) => `Đã trích xuất xong “${label}”. Phiên đã được lưu vào Lịch sử.`,
  resetLabel: 'Quét tài liệu khác',
  failedTitle: 'Không trích xuất được tài liệu',
  defaultFailure: 'Không đọc được nội dung tài liệu này.',
}

export default function ScanPage({ onOpenHistory, onOpenSession }) {
  return <FileIngestPage config={CONFIG} onOpenHistory={onOpenHistory} onOpenSession={onOpenSession} />
}
