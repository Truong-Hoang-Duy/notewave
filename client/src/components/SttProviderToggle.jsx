import { STT_PROVIDERS, useSttProvider } from '../hooks/useSttProvider'

/**
 * Nút gạt chọn công cụ Speech-to-Text: Deepgram hoặc Gladia.
 * Đồng bộ toàn ứng dụng (Header, Ghi âm trực tiếp, Tải file lên, Ghi âm nhanh trong Ghi chú).
 */
export default function SttProviderToggle({ size = 'md', disabled = false, showLabel = false, className = '' }) {
  const { provider, available, setProvider } = useSttProvider()
  const compact = size === 'sm'

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {showLabel && (
        <span className="text-xs font-medium text-muted select-none">Nhận dạng:</span>
      )}
      <div
        role="radiogroup"
        aria-label="Chọn dịch vụ nhận dạng giọng nói"
        className={`inline-flex items-center rounded-xl border border-line bg-sunken/70 p-0.5 ${
          disabled ? 'opacity-60' : ''
        }`}
      >
        {STT_PROVIDERS.map((item) => {
          const active = provider === item.id
          const configured = available.includes(item.id)
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => setProvider(item.id)}
              title={
                configured
                  ? `Dùng ${item.label} (${item.detail}) cho ghi âm & tải file`
                  : `${item.label} (chưa thấy key trên máy chủ — kiểm tra .env)`
              }
              className={`relative flex cursor-pointer items-center gap-1.5 rounded-[9px] font-medium transition-all duration-150 select-none disabled:cursor-not-allowed ${
                compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs sm:text-[13px]'
              } ${
                active
                  ? 'bg-surface text-brand-700 shadow-card ring-1 ring-line/60'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <span
                className={`size-1.5 rounded-full transition-colors ${
                  active ? 'bg-brand-600' : configured ? 'bg-muted/40' : 'bg-warn/60'
                }`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
              {!compact && (
                <span className={`hidden text-[11px] sm:inline ${active ? 'text-brand-600/80' : 'text-muted/70'}`}>
                  {item.detail}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

