import { useEffect, useRef, useState, type DragEvent } from 'react'
import { checkChartFile, useChartUrls } from '../lib/charts'

/** Full-screen view of one image; click anywhere or press Esc to close. */
export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="lightbox" onClick={(e) => (e.stopPropagation(), onClose())}>
      <img src={src} alt="Chart" />
    </div>
  )
}

interface Thumb {
  key: string
  src: string | undefined
  onRemove?: () => void
}

function Thumbs({ items }: { items: Thumb[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="chart-thumbs">
      {items.map((t) => (
        <div key={t.key} className="chart-thumb">
          {t.src ? (
            <img src={t.src} alt="Chart" onClick={() => setOpen(t.src!)} />
          ) : (
            <span className="muted">Loading…</span>
          )}
          {t.onRemove && (
            <button type="button" className="remove" title="Remove" onClick={t.onRemove}>
              ×
            </button>
          )}
        </div>
      ))}
      {open && <Lightbox src={open} onClose={() => setOpen(null)} />}
    </div>
  )
}


export interface PendingChart {
  file: File
  preview: string
}

interface PickerProps {
  saved: string[]
  pending: PendingChart[]
  onRemoveSaved: (path: string) => void
  onAdd: (files: PendingChart[]) => void
  onRemovePending: (p: PendingChart) => void
}

/** Thumbnails + file picker / drop zone / paste target used inside the trade form. */
export function ChartPicker({ saved, pending, onRemoveSaved, onAdd, onRemovePending }: PickerProps) {
  const { urls, error: urlError } = useChartUrls(saved)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  function add(files: File[]) {
    const ok: PendingChart[] = []
    const problems: string[] = []
    for (const file of files) {
      const problem = checkChartFile(file)
      if (problem) problems.push(problem)
      else ok.push({ file, preview: URL.createObjectURL(file) })
    }
    setError(problems.join(' '))
    if (ok.length) onAdd(ok)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    add([...e.dataTransfer.files])
  }

  // Pasting a screenshot anywhere while the form is open adds it. Text pastes are left alone.
  const addRef = useRef(add)
  useEffect(() => {
    addRef.current = add
  })
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        e.preventDefault()
        addRef.current(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const items: Thumb[] = [
    ...saved.map((p) => ({ key: p, src: urls[p], onRemove: () => onRemoveSaved(p) })),
    ...pending.map((p) => ({ key: p.preview, src: p.preview, onRemove: () => onRemovePending(p) })),
  ]

  return (
    <div className="wide chart-picker">
      <span className="field-label">Charts</span>
      {items.length > 0 && <Thumbs items={items} />}
      <div
        className={`drop ${over ? 'over' : ''}`}
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span className="on-pointer">Click to upload, drop images here, or paste a screenshot (Ctrl+V)</span>
        <span className="on-touch">Tap to add chart images</span>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          add([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      {(error || urlError) && <div className="error">{error || urlError}</div>}
    </div>
  )
}
