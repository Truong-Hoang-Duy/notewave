import { CircleAlert, Loader2, RotateCw } from 'lucide-react'
import { SOURCE_LABELS } from '../lib/format'
import { SOURCE_META } from '../lib/sources'

const BUTTON_VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-card',
  secondary: 'bg-surface text-ink-soft border border-line hover:border-line-strong hover:text-ink shadow-card',
  ghost: 'text-ink-soft hover:bg-sunken hover:text-ink',
  danger: 'bg-rec text-white hover:bg-rec-600 shadow-card',
  'danger-ghost': 'text-rec hover:bg-rec-soft',
  inverse: 'text-white/85 hover:bg-white/10 hover:text-white',
}
const BUTTON_SIZES = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
}

export function Button({ variant = 'secondary', size = 'md', loading = false, icon: Icon, className = '', children, disabled, ...props }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  )
}

export function SourceBadge({ source, compact = false }) {
  const meta = SOURCE_META[source] ?? SOURCE_META.upload
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ${meta.tone} ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}>
      <Icon className={compact ? 'size-3' : 'size-3.5'} />
      {SOURCE_LABELS[source]}
    </span>
  )
}

export function Spinner({ className = 'size-5 text-brand-600' }) {
  return <Loader2 className={`animate-spin ${className}`} />
}

export function EmptyState({ icon: Icon, title, description, children }) {
  return (
    <div className="flex animate-fade-in flex-col items-center px-6 py-16 text-center">
      <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
        <Icon className="size-6" />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{description}</p>}
      {children && <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Có lỗi xảy ra', message, onRetry, children }) {
  return (
    <div role="alert" className="flex animate-fade-in flex-col items-center px-6 py-14 text-center">
      <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-rec-soft text-rec">
        <CircleAlert className="size-6" />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {message && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{message}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button icon={RotateCw} onClick={onRetry}>
            Thử lại
          </Button>
        )}
        {children}
      </div>
    </div>
  )
}

export function InlineAlert({ tone = 'error', children, action }) {
  const tones = {
    error: 'bg-rec-soft text-[#8f2a2e] border-[#f3cfd0]',
    warn: 'bg-warn-soft text-[#7a4a0c] border-[#f0dcb8]',
    info: 'bg-brand-50 text-brand-700 border-brand-100',
  }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex animate-fade-in flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      <CircleAlert className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
      {action}
    </div>
  )
}

export function Card({ className = '', children, ...props }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface shadow-card ${className}`} {...props}>
      {children}
    </div>
  )
}
