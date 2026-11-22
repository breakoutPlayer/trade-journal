import { useRef, useState, type ReactNode } from 'react'

const TEMPLATE_KEY = 'tidemark.noteTemplates'
interface Template { name: string; body: string }
function loadTemplates(): Template[] {
  try {
    return JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]')
  } catch {
    return []
  }
}
function storeTemplates(list: Template[]) {
  try {
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: templates just won't persist */
  }
}

interface Props {
  value: string | null
  /** Persist the text (null when empty). Resolve true when it saved. */
  onSave: (text: string | null) => Promise<boolean>
  placeholder?: string
}

/**
 * Plain-text notes with a Markdown toolbar, preview, undo/redo and reusable templates.
 * Saves on blur or with the Save button. Give it a `key` per record so switching records resets it.
 */
export function NoteEditor({ value, onSave, placeholder }: Props) {
  const [text, setText] = useState(value ?? '')
  const [status, setStatus] = useState<'' | 'saving' | 'saved'>('')
  const [preview, setPreview] = useState(false)
  const [templates, setTemplates] = useState(loadTemplates)
  const [menu, setMenu] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const ta = useRef<HTMLTextAreaElement>(null)
  const dirty = text !== (value ?? '')

  async function commit() {
    if (!dirty) return
    setStatus('saving')
    const ok = await onSave(text.trim() ? text : null)
    setStatus(ok ? 'saved' : '')
  }

  // Insert through execCommand so the browser's undo/redo history keeps working.
  function insert(s: number, e: number, str: string, selectInner?: [number, number]) {
    const el = ta.current
    if (!el) return
    el.focus()
    el.setSelectionRange(s, e)
    if (!document.execCommand('insertText', false, str)) {
      const v = el.value.slice(0, s) + str + el.value.slice(e)
      setText(v)
    } else setText(el.value)
    if (selectInner) requestAnimationFrame(() => el.setSelectionRange(s + selectInner[0], s + selectInner[1]))
  }
  function wrap(mark: string) {
    const el = ta.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e, value } = el
    const sel = value.slice(s, e) || 'text'
    insert(s, e, mark + sel + mark, [mark.length, mark.length + sel.length])
  }
  function list(ordered: boolean) {
    const el = ta.current
    if (!el) return
    const { value } = el
    const s = value.lastIndexOf('\n', el.selectionStart - 1) + 1
    let e = value.indexOf('\n', el.selectionEnd)
    if (e < 0) e = value.length
    const lines = value.slice(s, e).split('\n')
    const already = lines.every((l) => (ordered ? /^\d+\. / : /^- /).test(l))
    const out = lines.map((l, i) => (already ? l.replace(ordered ? /^\d+\. / : /^- /, '') : `${ordered ? `${i + 1}. ` : '- '}${l}`)).join('\n')
    insert(s, e, out)
  }
  function history(cmd: 'undo' | 'redo') {
    ta.current?.focus()
    document.execCommand(cmd)
    if (ta.current) setText(ta.current.value)
  }
  function applyTemplate(t: Template) {
    setMenu(false)
    setPreview(false)
    requestAnimationFrame(() => {
      const el = ta.current
      if (!el) return
      const pre = el.value && !el.value.endsWith('\n') ? '\n' : ''
      insert(el.value.length, el.value.length, pre + t.body)
    })
  }
  function saveTemplate() {
    const n = name.trim()
    if (!n || !text.trim()) return setNaming(false)
    const next = [...templates.filter((t) => t.name !== n), { name: n, body: text }]
    setTemplates(next)
    storeTemplates(next)
    setNaming(false)
    setName('')
  }
  function deleteTemplate(n: string) {
    const next = templates.filter((t) => t.name !== n)
    setTemplates(next)
    storeTemplates(next)
  }

  return (
    <div className="nt">
        <div className="nt-bar" onMouseDown={(e) => (e.target as HTMLElement).closest('button') && e.preventDefault()}>
          <button className={preview ? 'active' : ''} title="Preview formatting" onClick={() => setPreview(!preview)}>Aa</button>
          <button title="Bold" disabled={preview} onClick={() => wrap('**')}><b>B</b></button>
          <button title="Italic" disabled={preview} onClick={() => wrap('_')}><i>I</i></button>
          <button title="Strikethrough" disabled={preview} onClick={() => wrap('~~')}><s>S</s></button>
          <button title="Bulleted list" aria-label="Bulleted list" disabled={preview} onClick={() => list(false)}><Icon d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></button>
          <button title="Numbered list" aria-label="Numbered list" disabled={preview} onClick={() => list(true)}><Icon d="M10 6h10M10 12h10M10 18h10M4 4v4M3 14h3l-3 4h3" /></button>
          <span className="spacer" />
          <button title="Undo" aria-label="Undo" disabled={preview} onClick={() => history('undo')}><Icon d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></button>
          <button title="Redo" aria-label="Redo" disabled={preview} onClick={() => history('redo')}><Icon d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /></button>
          <span className="nt-sep" />
          <div className="nt-menu-wrap">
            <button title="Insert template" onClick={() => setMenu(!menu)}>+</button>
            {menu && (
              <div className="nt-menu">
                {templates.length === 0 && <div className="muted nt-empty">No templates yet. Write a note and use "Save as new template".</div>}
                {templates.map((t) => (
                  <div key={t.name} className="nt-item">
                    <button onClick={() => applyTemplate(t)}>{t.name}</button>
                    <button aria-label={`Delete template ${t.name}`} onClick={() => deleteTemplate(t.name)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {preview ? (
          <div className="nt-preview">{text.trim() ? <Markdown text={text} /> : <span className="muted">Nothing written yet.</span>}</div>
        ) : (
          <textarea ref={ta} className="nt-text" value={text} placeholder={placeholder ?? 'Type your notes here…'} onChange={(e) => { setText(e.target.value); setStatus('') }} onBlur={commit} />
        )}
        <div className="nt-foot">
          {naming ? (
            <form className="chip-add" onSubmit={(e) => { e.preventDefault(); saveTemplate() }}>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" onKeyDown={(e) => e.key === 'Escape' && setNaming(false)} />
              <button className="chip-btn">Save</button>
            </form>
          ) : (
            <button className="link-muted" disabled={!text.trim()} onClick={() => setNaming(true)}>⧉ Save as new template</button>
          )}
          <span className="spacer" />
          <span className="muted nt-status">{status === 'saving' ? 'Saving…' : status === 'saved' && !dirty ? 'Saved' : dirty ? 'Unsaved' : ''}</span>
          <button className="chip-btn" disabled={!dirty || status === 'saving'} onClick={commit}>Save</button>
        </div>
    </div>
  )
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block', margin: '0 auto' }}>
      <path d={d} />
    </svg>
  )
}

/** Minimal, safe Markdown: **bold**, _italic_, ~~strike~~, "- " and "1. " lists. Rendered as React nodes, never raw HTML. */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|~~[^~]+~~|_[^_]+_)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b>
      : part.startsWith('~~') && part.endsWith('~~') && part.length > 4 ? <s key={i}>{part.slice(2, -2)}</s>
      : part.startsWith('_') && part.endsWith('_') && part.length > 2 ? <i key={i}>{part.slice(1, -1)}</i>
      : part,
    )
  const blocks: ReactNode[] = []
  let items: string[] = []
  let ordered = false
  const flush = () => {
    if (!items.length) return
    const lis = items.map((t, i) => <li key={i}>{inline(t)}</li>)
    blocks.push(ordered ? <ol key={blocks.length}>{lis}</ol> : <ul key={blocks.length}>{lis}</ul>)
    items = []
  }
  for (const line of text.split('\n')) {
    const ul = /^- (.*)/.exec(line)
    const ol = /^\d+\. (.*)/.exec(line)
    if (ul || ol) {
      if (items.length && ordered !== Boolean(ol)) flush()
      ordered = Boolean(ol)
      items.push((ul ?? ol)![1])
    } else {
      flush()
      blocks.push(line.trim() ? <p key={blocks.length}>{inline(line)}</p> : <br key={blocks.length} />)
    }
  }
  flush()
  return <>{blocks}</>
}

