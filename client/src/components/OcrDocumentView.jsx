import { memo, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PartDivider from './PartDivider'

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Plugin remark: bọc các từ đang có đề xuất sửa (chưa quyết định) thành <mark data-correction-id> —
 * khớp nguyên từ giống backend, bỏ qua code. Chỉ để hiển thị, không đổi nội dung.
 */
function remarkHighlightCorrections({ corrections = [] } = {}) {
  return (tree) => {
    if (!corrections.length) return
    const sorted = [...corrections].sort((a, b) => b.original.length - a.original.length)
    const byOriginal = new Map(sorted.map((c) => [c.original, c]))
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])(${sorted.map((c) => escapeRegExp(c.original)).join('|')})(?![\\p{L}\\p{N}\\p{M}_])`, 'gu')

    const walk = (node) => {
      if (!node.children || node.type === 'code' || node.type === 'inlineCode') return
      const next = []
      for (const child of node.children) {
        if (child.type !== 'text') {
          walk(child)
          next.push(child)
          continue
        }
        let last = 0
        for (const match of child.value.matchAll(pattern)) {
          if (match.index > last) next.push({ type: 'text', value: child.value.slice(last, match.index) })
          const correction = byOriginal.get(match[0])
          next.push({
            type: 'emphasis',
            data: { hName: 'mark', hProperties: { dataCorrectionId: correction.id } },
            children: [{ type: 'text', value: match[0] }],
          })
          last = match.index + match[0].length
        }
        if (last === 0) next.push(child)
        else if (last < child.value.length) next.push({ type: 'text', value: child.value.slice(last) })
      }
      node.children = next
    }
    walk(tree)
  }
}

function buildComponents(corrections, onOpenCorrection) {
  const byId = new Map(corrections.map((c) => [c.id, c]))
  return {
    h1: (p) => <h2 className="mt-7 mb-3 text-xl font-semibold tracking-tight text-ink first:mt-0" {...strip(p)} />,
    h2: (p) => <h3 className="mt-6 mb-2.5 text-lg font-semibold text-ink first:mt-0" {...strip(p)} />,
    h3: (p) => <h4 className="mt-5 mb-2 text-base font-semibold text-ink first:mt-0" {...strip(p)} />,
    h4: (p) => <h5 className="mt-4 mb-2 text-[15px] font-semibold text-ink first:mt-0" {...strip(p)} />,
    h5: (p) => <h6 className="mt-4 mb-2 text-sm font-semibold text-ink-soft first:mt-0" {...strip(p)} />,
    h6: (p) => <h6 className="mt-4 mb-2 text-sm font-semibold text-muted first:mt-0" {...strip(p)} />,
    p: (p) => <p className="my-3 text-[16px] leading-[1.8] text-pretty break-words text-ink first:mt-0 last:mb-0 sm:text-[16.5px]" {...strip(p)} />,
    ul: (p) => <ul className="my-3 list-disc space-y-1 pl-6 text-[16px] leading-[1.75] text-ink marker:text-brand-500" {...strip(p)} />,
    ol: (p) => <ol className="my-3 list-decimal space-y-1 pl-6 text-[16px] leading-[1.75] text-ink marker:text-muted" {...strip(p)} />,
    li: (p) => <li className="pl-1 break-words" {...strip(p)} />,
    blockquote: (p) => <blockquote className="my-4 border-l-2 border-line-strong pl-4 text-ink-soft" {...strip(p)} />,
    hr: () => <hr className="my-6 border-line" />,
    a: (p) => <a className="text-brand-600 underline decoration-brand-200 underline-offset-2" target="_blank" rel="noopener noreferrer" {...strip(p)} />,
    img: () => null, // Không lấy ảnh từ OCR
    table: (p) => (
      <div className="my-4 overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-left text-sm" {...strip(p)} />
      </div>
    ),
    th: (p) => <th className="border-b border-line bg-paper px-3 py-2 font-semibold whitespace-nowrap text-ink" {...strip(p)} />,
    td: (p) => <td className="border-t border-line px-3 py-2 align-top text-ink" {...strip(p)} />,
    pre: (p) => <pre className="my-4 overflow-x-auto rounded-xl border border-line bg-paper p-4 font-mono text-[13px] leading-relaxed" {...strip(p)} />,
    code: ({ className, ...p }) => <code className={`rounded bg-sunken px-1 py-0.5 font-mono text-[0.88em] ${className ?? ''}`} {...strip(p)} />,
    mark: ({ node, children }) => {
      const correction = byId.get(node?.properties?.dataCorrectionId)
      if (!correction) return children
      return (
        <button
          type="button"
          onClick={() => onOpenCorrection?.(correction.id)}
          title={`Đề xuất sửa thành “${correction.corrected}” — bấm để xem`}
          className="rounded-[4px] bg-warn-soft px-0.5 text-inherit underline decoration-warn decoration-dotted decoration-2 underline-offset-4 transition-colors hover:bg-[#f6e3c2]"
        >
          {children}
        </button>
      )
    },
  }
}

// react-markdown truyền kèm `node` (cây hast) — không đưa xuống DOM.
function strip(props) {
  const rest = { ...props }
  delete rest.node
  return rest
}

// Markdown thô không được render (an toàn XSS) nên thẻ <br> Mistral hay chèn trong ô bảng sẽ hiện nguyên văn — đổi thành khoảng trắng.
const normalizeMarkdown = (text) => text.replace(/<br\s*\/?>/gi, ' ')

const Page = memo(function Page({ text, corrections, onOpenCorrection }) {
  const remarkPlugins = useMemo(() => [remarkGfm, [remarkHighlightCorrections, { corrections }]], [corrections])
  const components = useMemo(() => buildComponents(corrections, onOpenCorrection), [corrections, onOpenCorrection])
  return (
    <Markdown remarkPlugins={remarkPlugins} components={components}>
      {normalizeMarkdown(text)}
    </Markdown>
  )
})

const EMPTY = []

/** Nội dung phiên quét tài liệu: mỗi segment là một trang Markdown. Phiên gộp nhiều file: nhãn trang kèm tên file gốc. */
export default function OcrDocumentView({ segments, corrections = EMPTY, files = EMPTY, onOpenCorrection, placeholder }) {
  const pendingByPage = useMemo(() => {
    const map = new Map()
    for (const c of corrections) {
      if (c.status !== 'pending') continue
      map.set(c.page, [...(map.get(c.page) ?? []), c])
    }
    return map
  }, [corrections])

  if (!segments.length) return placeholder
  const multiPage = new Set(segments.map((s) => s.page).filter((p) => p != null)).size > 1
  const sourceFiles = files.filter((f) => f.first_page != null)
  const fileOfPage = (page) =>
    sourceFiles.length > 1 ? sourceFiles.find((f) => page >= f.first_page && page < f.first_page + f.page_count) : null

  return (
    <div className="space-y-6">
      {segments.map((seg, i) => (
        <section key={`${seg.page ?? 'x'}-${i}`} aria-label={seg.page != null ? `Trang ${seg.page}` : undefined}>
          {multiPage && seg.page != null && (
            <div className="mb-4">
              <PartDivider title={fileOfPage(seg.page) ? `Trang ${seg.page} · ${fileOfPage(seg.page).filename}` : `Trang ${seg.page}`} />
            </div>
          )}
          <Page text={seg.text} corrections={pendingByPage.get(seg.page) ?? EMPTY} onOpenCorrection={onOpenCorrection} />
        </section>
      ))}
    </div>
  )
}
