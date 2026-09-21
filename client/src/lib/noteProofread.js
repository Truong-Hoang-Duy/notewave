/**
 * Áp dụng đề xuất sửa chính tả (backend `note_proofread_agent`) vào nội dung editor.
 *
 * Backend chỉ ĐỀ XUẤT; nội dung thật nằm trong tài liệu Tiptap nên việc thay chữ làm ở đây, trong MỘT transaction
 * (Ctrl+Z một lần là hoàn tác được tất cả). Không đụng vào khối code, code trong dòng và công thức (node riêng,
 * không phải text node) — đúng như phần backend đã loại trừ khi đếm số lần xuất hiện.
 */

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Chỉ khớp nguyên từ/cụm từ, có nhận biết chữ có dấu (JS `\w` chỉ tính ASCII nên phải dùng \p{L}\p{N}). */
function wordPattern(original) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(original)}(?![\\p{L}\\p{N}_])`, 'gu')
}

/** Số lần một đề xuất sẽ được thay trong nội dung hiện tại (0 = chữ đã đổi, đề xuất không còn áp dụng được). */
export function countOccurrences(editor, original) {
  return collectReplacements(editor, [{ original, corrected: '' }]).length
}

function collectReplacements(editor, suggestions) {
  const replacements = []
  editor?.state.doc.descendants((node, pos, parent) => {
    if (!node.isText) return true
    if (parent?.type.name === 'codeBlock') return false
    if (node.marks.some((m) => m.type.name === 'code')) return false
    for (const s of suggestions) {
      const pattern = wordPattern(s.original)
      let match
      while ((match = pattern.exec(node.text)) !== null) {
        replacements.push({ from: pos + match.index, to: pos + match.index + match[0].length, text: s.corrected })
      }
    }
    return false
  })
  return replacements
}

/** Thay mọi chỗ khớp của các đề xuất đã chọn. Trả số chỗ đã thay. */
export function applyProofreadSuggestions(editor, suggestions) {
  const replacements = collectReplacements(editor, suggestions)
  if (!replacements.length) return 0
  // Thay từ cuối tài liệu ngược lên đầu -> vị trí của các chỗ phía trước không bị lệch.
  replacements.sort((a, b) => b.from - a.from)
  const tr = editor.state.tr
  for (const r of replacements) tr.insertText(r.text, r.from, r.to)
  editor.view.dispatch(tr)
  return replacements.length
}
