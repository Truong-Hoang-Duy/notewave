/**
 * Chuyển bản tóm tắt (MeetingSummary) sang Markdown để sao chép: heading cho từng mục, bullet cho danh sách,
 * việc cần làm dạng checklist. Thứ tự và tên mục giống bảng tóm tắt trên UI và file xuất.
 */
export function summaryToMarkdown(summary, title) {
  const lines = []
  if (title) lines.push(`# ${title}`, '')

  lines.push('## Tóm tắt', summary.summary?.trim() ?? '', '')

  if (summary.key_points?.length) {
    lines.push('## Ý chính', ...summary.key_points.map((p) => `- ${p}`), '')
  }

  lines.push('## Việc cần làm')
  if (summary.action_items?.length) {
    for (const item of summary.action_items) {
      const meta = [item.owner && `Phụ trách: ${item.owner}`, item.due && `Hạn: ${item.due}`].filter(Boolean).join(' · ')
      lines.push(`- [ ] ${item.task}${meta ? ` — ${meta}` : ''}`)
    }
  } else {
    lines.push('Không có việc cần làm nào được nhắc tới.')
  }
  lines.push('')

  lines.push('## Quyết định')
  if (summary.decisions?.length) lines.push(...summary.decisions.map((d) => `- ${d}`))
  else lines.push('Chưa ghi nhận quyết định nào.')

  return lines.join('\n').trim() + '\n'
}
