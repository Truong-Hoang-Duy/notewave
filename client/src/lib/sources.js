import { FileAudio, Mic, ScanText } from 'lucide-react'

/** Icon + màu riêng cho từng nguồn phiên (nhãn chữ ở `SOURCE_LABELS` trong format.js). */
export const SOURCE_META = {
  live: { icon: Mic, tone: 'bg-brand-50 text-brand-700', iconTone: 'bg-brand-50 text-brand-600' },
  upload: { icon: FileAudio, tone: 'bg-[#efedf9] text-[#4a44a8]', iconTone: 'bg-[#efedf9] text-[#4a44a8]' },
  ocr: { icon: ScanText, tone: 'bg-[#e5f0f6] text-[#1f5f88]', iconTone: 'bg-[#e5f0f6] text-[#27709f]' },
}
