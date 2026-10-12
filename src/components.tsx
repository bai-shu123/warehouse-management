import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Boxes, X } from 'lucide-react'
import { supabase } from './lib/supabase'
import type { Locale, Translator } from './types'

export function AuthScreen({ locale, setLocale, t }: { locale: Locale; setLocale: (locale: Locale) => void; t: Translator }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    setMessage('')
    const result = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: displayName.trim() } } })
    if (result.error) setError(result.error.message)
    else if (mode === 'signup' && !result.data.session) {
      setMessage(t('signupSuccess'))
      setMode('signin')
    }
    setBusy(false)
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><span><Boxes size={24} aria-hidden="true" /></span><div><strong>{t('appName')}</strong><small>{t('appSub')}</small></div></div>
        <div className="auth-language">
          <select name="locale" value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label="Language">
            <option value="zh-CN">中文</option><option value="ru">Русский</option><option value="kk">Қазақша</option>
          </select>
        </div>
        <h1>{mode === 'signin' ? t('signIn') : t('signUp')}</h1>
        <p>{mode === 'signin' ? t('signInHint') : t('signUpHint')}</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && <label>{t('displayName')}<input name="displayName" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>}
          <label>{t('email')}<input name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>{t('password')}<input name="password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <div className="inline-alert error" role="alert">{error}</div>}
          {message && <div className="inline-alert success" role="status">{message}</div>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? t('loading') : mode === 'signin' ? t('signIn') : t('signUp')}</button>
        </form>
        <button className="text-button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setMessage('') }}>
          {mode === 'signin' ? t('switchToSignUp') : t('switchToSignIn')}
        </button>
      </section>
    </main>
  )
}

export function Modal({ title, children, onClose, wide = false, danger = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; danger?: boolean }) {
  const titleId = useId()
  const modalRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [])
    focusable()[0]?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = originalOverflow
      previouslyFocused?.focus()
    }
  }, [])

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={modalRef} className={`modal ${wide ? 'modal-wide' : ''} ${danger ? 'modal-danger' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-heading"><div><h2 id={titleId}>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label={`Close: ${title}`}><X size={18} aria-hidden="true" /></button></header>
        {children}
      </section>
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <div className="empty-state"><Boxes size={24} aria-hidden="true" /><span>{text}</span></div>
}

export function FormActions({ cancel, submit, busy, danger = false }: { cancel: string; submit: string; busy: boolean; danger?: boolean }) {
  return <footer className="modal-footer"><span /><div><button type="button" className="button button-quiet" onClick={() => history.back()} style={{ display: 'none' }}>{cancel}</button><button className={`button ${danger ? 'button-danger' : 'button-primary'}`} disabled={busy}>{busy ? '…' : submit}</button></div></footer>
}
