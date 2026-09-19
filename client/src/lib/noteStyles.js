/**
 * Giao diện riêng từng ghi chú — chọn từ bộ có sẵn (backend chỉ nhận đúng các giá trị này, xem
 * `models/note.py::NoteTheme/NoteFont/NoteFontSize`). Mỗi theme là cặp nền/chữ đã kiểm tra đủ tương phản.
 */
export const NOTE_THEMES = {
  paper: { label: 'Giấy', bg: '#fbfaf6', fg: '#1d1b18', muted: '#7a746a', line: '#e7e2d8', accent: '#2f6554', soft: '#edf5f1' },
  white: { label: 'Trắng', bg: '#ffffff', fg: '#1d1b18', muted: '#77726a', line: '#e8e5df', accent: '#2f6554', soft: '#edf5f1' },
  sepia: { label: 'Sepia', bg: '#f5ecd9', fg: '#3d2f1e', muted: '#7d6a50', line: '#e3d5b8', accent: '#8a5a1c', soft: '#ecdcbc' },
  mint: { label: 'Bạc hà', bg: '#eef6f1', fg: '#16322a', muted: '#557368', line: '#d3e6db', accent: '#1f6b52', soft: '#d5ebdf' },
  sky: { label: 'Trời', bg: '#eef4fa', fg: '#172b40', muted: '#56708a', line: '#d4e2f0', accent: '#245f93', soft: '#d8e7f5' },
  dark: { label: 'Tối', bg: '#1f1e1b', fg: '#ece8df', muted: '#a39d91', line: '#3a3833', accent: '#8fcfb4', soft: '#2c3a34' },
}

// Font có hỗ trợ tiếng Việt; font chưa có trong index.html được tải từ Google Fonts khi note dùng tới.
export const NOTE_FONTS = {
  sans: { label: 'Không chân', family: "'Be Vietnam Pro', ui-sans-serif, system-ui, sans-serif" },
  serif: { label: 'Có chân', family: "'Lora', Georgia, 'Times New Roman', serif", google: 'Lora:ital,wght@0,400;0,600;1,400' },
  mono: { label: 'Đơn cách', family: "'JetBrains Mono', ui-monospace, Consolas, monospace", google: 'JetBrains+Mono:wght@400;600' },
  hand: { label: 'Viết tay', family: "'Patrick Hand', 'Comic Sans MS', cursive", google: 'Patrick+Hand' },
}

export const NOTE_FONT_SIZES = {
  sm: { label: 'Nhỏ', px: 14 },
  md: { label: 'Vừa', px: 16 },
  lg: { label: 'Lớn', px: 18 },
  xl: { label: 'Rất lớn', px: 20 },
}

export const DEFAULT_NOTE_STYLE = { theme: 'paper', font: 'sans', font_size: 'md' }

export function resolveNoteStyle(style) {
  return {
    theme: NOTE_THEMES[style?.theme] ? style.theme : DEFAULT_NOTE_STYLE.theme,
    font: NOTE_FONTS[style?.font] ? style.font : DEFAULT_NOTE_STYLE.font,
    font_size: NOTE_FONT_SIZES[style?.font_size] ? style.font_size : DEFAULT_NOTE_STYLE.font_size,
  }
}

const loadedFonts = new Set()
function ensureFontLoaded(fontKey) {
  const font = NOTE_FONTS[fontKey]
  if (!font?.google || loadedFonts.has(fontKey)) return
  loadedFonts.add(fontKey)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`
  document.head.appendChild(link)
}

/** Biến CSS áp lên khung ghi chú (xem `.note-sheet` trong index.css). */
export function noteStyleVars(style) {
  const s = resolveNoteStyle(style)
  const t = NOTE_THEMES[s.theme]
  ensureFontLoaded(s.font)
  return {
    '--note-bg': t.bg,
    '--note-fg': t.fg,
    '--note-muted': t.muted,
    '--note-line': t.line,
    '--note-accent': t.accent,
    '--note-soft': t.soft,
    '--note-font': NOTE_FONTS[s.font].family,
    '--note-size': `${NOTE_FONT_SIZES[s.font_size].px}px`,
    colorScheme: s.theme === 'dark' ? 'dark' : 'light',
  }
}
