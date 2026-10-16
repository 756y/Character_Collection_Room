import { useEffect, useState } from 'react'
import { listCharacters, resolveDriveImage, getDriveFileInfo, signInWithGoogle, signOutGoogle, syncCharacters } from './lib/googleDrive'

export default function App() {
  const [profile, setProfile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [restoringSession, setRestoringSession] = useState(true)
  const [legacyRoute, setLegacyRoute] = useState(() => {
    try {
      const saved = localStorage.getItem('ccr_legacy_route') || 'index.html'
      return /^(index\.html|character\.html(?:\?id=[A-Za-z0-9_-]+)?)$/.test(saved) ? saved : 'index.html'
    } catch { return 'index.html' }
  })

  useEffect(() => {
    let cancelled = false
    let rememberedEmail = ''
    try { rememberedEmail = localStorage.getItem('ccr_google_account_email') || '' } catch { /* storage may be unavailable */ }

    if (!rememberedEmail) {
      setRestoringSession(false)
      return () => { cancelled = true }
    }

    // Restore the last-used account immediately so a browser refresh does not
    // send the user back to the landing/login page while Google authorization
    // is being resumed.
    setProfile({ email: rememberedEmail })
    signInWithGoogle({ silent: true })
      .then(user => { if (!cancelled) setProfile(user) })
      .catch((error) => {
        // Keep the collection view visible. Google may require interaction after
        // a token expires/revocation; the remembered account remains available.
        if (!cancelled) console.info('[CCR] Google 工作階段需要重新驗證。', error?.message || '')
      })
      .finally(() => { if (!cancelled) setRestoringSession(false) })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!profile) {
      try { delete window.__characterCloud } catch { window.__characterCloud = undefined }
      return
    }
    window.__characterCloud = {
      bridgeVersion: 'drive-file-info-v1',
      email: profile.email || '',
      list: (options) => listCharacters(options),
      resolveImage: (value) => resolveDriveImage(value),
      getDriveFileInfo: (value) => getDriveFileInfo(value),
      sync: (action, payload, currentCharacters) => syncCharacters(action, payload, currentCharacters),
    }
    console.info('[CCR] 雲端連線橋接已初始化', { bridgeVersion: window.__characterCloud.bridgeVersion, hasGetDriveFileInfo: typeof window.__characterCloud.getDriveFileInfo === 'function' })
    const onMessage = async (event) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'CHARACTER_ROOM_LOGOUT') {
        await signOutGoogle()
        try { localStorage.removeItem('ccr_legacy_route') } catch { /* storage may be unavailable */ }
        setLegacyRoute('index.html')
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
            src={`${import.meta.env.BASE_URL}legacy/${legacyRoute}`}
            onLoad={(event) => {
              try {
                const url = new URL(event.currentTarget.contentWindow.location.href)
                const route = url.pathname.endsWith('/character.html')
                  ? `character.html${url.searchParams.get('id') ? `?id=${encodeURIComponent(url.searchParams.get('id'))}` : ''}`
                  : 'index.html'
                localStorage.setItem('ccr_legacy_route', route)
              } catch { /* ignore transient iframe navigation */ }
            }}
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
