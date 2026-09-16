/** File có thể xem trước ngay trong app trước khi gửi lên (ảnh hoặc PDF). */
export const isPreviewable = (file) => file.type.startsWith('image/') || isPdf(file)

export const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
