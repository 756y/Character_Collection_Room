import { useEffect, useState } from 'react'
import { listCharacters, signInWithGoogle, signOutGoogle, syncCharacters } from './lib/googleDrive'

export default function App() {
  const [profile, setProfile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [restoringSession, setRestoringSession] = useState(true)

  useEffect(() => {
    let cancelled = false
    let rememberedEmail = ''
    try { rememberedEmail = localStorage.getItem('ccr_google_account_email') || '' } catch { /* storage may be unavailable */ }
    if (!rememberedEmail) {
      setRestoringSession(false)
      return () => { cancelled = true }
    }
    // Try to renew a short-lived Google access token without asking the user to
    // choose the same account or consent again. If Google requires interaction,
    // fall back to the normal login button.
    signInWithGoogle({ silent: true })
      .then(user => { if (!cancelled) setProfile(user) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setRestoringSession(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!profile) {
      try { delete window.__characterCloud } catch { window.__characterCloud = undefined }
      return
    }
    window.__characterCloud = {
      email: profile.email || '',
      list: () => listCharacters(),
      sync: (action, payload, currentCharacters) => syncCharacters(action, payload, currentCharacters),
    }
    const onMessage = async (event) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'CHARACTER_ROOM_LOGOUT') {
        await signOutGoogle()
        setProfile(null)
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      try { delete window.__characterCloud } catch { window.__characterCloud = undefined }
    }
  }, [profile])

  async function handleGoogleLogin() {
    setBusy(true)
    setMessage('')
    try {
      const user = await signInWithGoogle()
      setProfile(user)
    } catch (error) {
      setMessage(error?.message || 'Google 登入失敗，請稍後再試。')
    } finally {
      setBusy(false)
    }
  }

  if (profile) {
    return (
      <main className="room-shell">
        <section className="legacy-frame-wrap">
          <iframe
            className="collection-frame"
            title="角色收藏室"
            src={`${import.meta.env.BASE_URL}legacy/index.html`}
            allow="clipboard-read; clipboard-write"
          />
        </section>
      </main>
    )
  }

  return (
    <main className="auth-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="auth-card">
        <div className="auth-illustration" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="star star-one">✦</div><div className="star star-two">✧</div>
          <div className="book-shape"><span /><span /><span /></div>
          <div className="tiny-spark spark-one">✧</div><div className="tiny-spark spark-two">·</div>
        </div>
        <div className="auth-content">
          <div className="brand"><div className="brand-mark"><span>✦</span></div><div className="brand-copy"><strong>Character Collection Room</strong><span>角色收藏室</span></div></div>
          <div className="eyebrow">專屬於你的角色天地</div>
          <h1>故事，從這裡繼續。</h1>
          <p className="lead">使用 Google 帳號登入，將角色資料與圖片儲存在你自己的 Google Drive。</p>
          <button className="submit-button" type="button" onClick={handleGoogleLogin} disabled={busy || restoringSession}>
            {restoringSession || busy ? '正在恢復 Google 登入…' : (localStorage.getItem('ccr_google_account_email') ? `繼續使用 ${localStorage.getItem('ccr_google_account_email')}` : '使用 Google 帳號登入')} <span aria-hidden="true">↗</span>
          </button>
          {message && <div className="message-box error" role="alert">{message}</div>}
          <div className="auth-footer"><span className="footer-lock">◇</span> 角色文字儲存於 Google 試算表，圖片儲存於 Google Drive</div>
        </div>
      </section>
      <p className="page-caption">角色收藏室 <span>·</span> 珍藏每一段故事</p>
    </main>
  )
}
