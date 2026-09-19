import { useState } from 'react'
import Modal from '../Modal'
import { Button } from '../ui'

/** Hộp thoại nhập tên (tạo / đổi tên thư mục, tag). `onSubmit(name)` ném lỗi -> hiện lỗi, giữ hộp thoại mở. */
export default function NameDialog(props) {
  // Chỉ mount khi mở: mỗi lần mở là một state mới (tên ban đầu, không còn lỗi cũ).
  return props.open ? <NameDialogBody {...props} /> : null
}

function NameDialogBody({ title, description, label, initialName = '', maxLength = 100, submitLabel = 'Lưu', onSubmit, onClose, children }) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e?.preventDefault()
    if (!name.trim()) return setError('Tên không được để trống.')
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name.trim())
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={title}
      description={description}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">{label}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={maxLength}
            className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          />
        </label>
        {children}
        {error && (
          <p role="alert" className="text-[13px] text-rec">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
