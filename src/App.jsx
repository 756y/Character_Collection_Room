import { useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from './lib/supabase'
import { listCharacters, migrateLocalCharacters, syncCharacters } from './lib/characterCloud'

export default function App() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('info')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setAuthReady(true)
      return
    }

    let alive = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return
      if (error) showMessage('無法載入登入狀態，請重新整理頁面。', 'error')
      setSession(data?.session ?? null)
      setAuthReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session || !supabase) {
      try { delete window.__characterCloud } catch { window.__characterCloud = undefined }
      return
    }
    window.__characterCloud = {
      list: () => listCharacters(),
      sync: (action, payload, currentCharacters) => syncCharacters(action, payload, currentCharacters),
      migrate: (localCharacters) => migrateLocalCharacters(localCharacters),
    }
    return () => { try { delete window.__characterCloud } catch { window.__characterCloud = undefined } }
  }, [session?.user?.id])

  useEffect(() => {
    function handleRoomMessage(event) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'CHARACTER_ROOM_LOGOUT') handleLogout()
    }
    window.addEventListener('message', handleRoomMessage)
    return () => window.removeEventListener('message', handleRoomMessage)
  }, [session?.user?.id, busy])

  function showMessage(text, type = 'info') {
    setMessage(text)
    setMessageType(type)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!supabaseConfigured || !supabase) {
      showMessage('請先在 .env.local 填入 Supabase 專案網址與公開金鑰，再重新啟動網站。', 'error')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error

        if (data.session) {
          showMessage('註冊成功，已自動登入。', 'success')
        } else {
          showMessage('已寄出驗證郵件。請開啟電子郵件並點擊驗證連結，再回到這裡登入。若未收到，請檢查垃圾郵件匣。', 'success')
          setMode('login')
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) throw error
        if (!data.session) showMessage('登入尚未完成，請先確認電子郵件是否已驗證。', 'error')
        else showMessage('登入成功，正在開啟你的角色收藏室。', 'success')
      }
    } catch (error) {
      const friendly = {
        'Invalid login credentials': '電子郵件或密碼不正確，請確認後再試。',
        'Email not confirmed': '這個電子郵件地址尚未驗證。請先開啟驗證郵件，再回來登入。',
        'User already registered': '這個電子郵件地址已經註冊，請切換至登入模式。',
        'Password should be at least 6 characters.': '密碼至少需要 6 個字元。',
      }
      showMessage(friendly[error.message] || '發生錯誤，請稍後再試；若問題持續，請檢查 Supabase 設定。', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function resendConfirmation() {
    if (!supabase || !email.trim()) {
      showMessage('請先輸入註冊時使用的電子郵件地址。', 'error')
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) throw error
      showMessage('已重新寄送驗證郵件，請檢查收件匣與垃圾郵件匣。', 'success')
    } catch (error) {
      showMessage('無法重新寄送驗證郵件，請稍後再試。', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout() {
    if (!supabase) return
    setBusy(true)
    const { error } = await supabase.auth.signOut()
    if (error) showMessage('登出失敗，請稍後再試。', 'error')
    setBusy(false)
  }

  if (!authReady) {
    return <main className="loading-screen"><div className="loading-mark">✦</div><p>正在開啟角色收藏室…</p></main>
  }

  if (!supabaseConfigured) {
    return (
      <main className="auth-shell">
        <section className="auth-card setup-card">
          <Brand />
          <div className="eyebrow">只差一步</div>
          <h1>連線至 Supabase</h1>
          <p className="lead">React 網站已準備就緒。填入 Supabase 專案網址與公開金鑰，就能開始測試電子郵件註冊與驗證。</p>
          <ol className="setup-steps">
            <li>在專案根目錄建立 <code>.env.local</code></li>
            <li>填入 <code>VITE_SUPABASE_URL</code></li>
            <li>填入 <code>VITE_SUPABASE_PUBLISHABLE_KEY</code></li>
            <li>儲存後，在終端機重新執行 <code>npm run dev</code></li>
          </ol>
          <p className="security-note">僅使用公開金鑰（Publishable Key）。請勿將資料庫密碼、service_role 或 Secret Key 放入前端。</p>
        </section>
      </main>
    )
  }

  if (session) {
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
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="star star-one">✦</div>
          <div className="star star-two">✧</div>
          <div className="book-shape"><span /><span /><span /></div>
          <div className="tiny-spark spark-one">✧</div>
          <div className="tiny-spark spark-two">·</div>
        </div>

        <div className="auth-content">
          <Brand />
          <div className="eyebrow">{mode === 'signup' ? '開始收藏' : '專屬於你的角色天地'}</div>
          <h1>{mode === 'signup' ? '建立你的收藏室' : '故事，從這裡繼續。'}</h1>
          <p className="lead">
            {mode === 'signup'
              ? '建立一個帳號，好好收藏你的角色與冒險。'
              : '登入後回到你的角色收藏室，讓每段故事都有自己的位置。'}
          </p>

          <div className="mode-tabs" role="tablist" aria-label="帳號操作">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'mode-tab active' : 'mode-tab'} onClick={() => { setMode('login'); setMessage('') }}>登入</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'mode-tab active' : 'mode-tab'} onClick={() => { setMode('signup'); setMessage('') }}>註冊帳號</button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label htmlFor="email">電子郵件地址</label>
            <div className="input-wrap">
              <span className="input-icon" aria-hidden="true">✉</span>
              <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" required />
            </div>

            <div className="password-label-row">
              <label htmlFor="password">密碼</label>
              <span className="field-hint">至少 6 個字元</span>
            </div>
            <div className="input-wrap">
              <span className="input-icon lock-icon" aria-hidden="true">◇</span>
              <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="輸入你的密碼" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={6} required />
              <button className="show-password" type="button" onClick={() => setShowPassword(v => !v)}>{showPassword ? '隱藏' : '顯示'}</button>
            </div>

            <button className="submit-button" type="submit" disabled={busy}>
              {busy ? <><span className="button-spinner" /> 請稍候…</> : mode === 'signup' ? '建立帳號並驗證電子郵件' : '進入我的收藏室'}
              {!busy && <span aria-hidden="true">↗</span>}
            </button>
          </form>

          {message && <div className={`message-box ${messageType}`} role="status">{message}</div>}

          {mode === 'login' && (
            <button className="resend-link" type="button" onClick={resendConfirmation} disabled={busy}>
              還沒收到驗證信？重新寄送
            </button>
          )}

          <div className="auth-footer"><span className="footer-lock">◇</span> 你的帳號由 Supabase 安全管理 <span className="footer-dot">·</span> 電子郵件驗證</div>
        </div>
      </section>
      <p className="page-caption">角色收藏室 <span>·</span> 珍藏每一段故事</p>
    </main>
  )
}

function Brand({ compact = false }) {
  return (
    <div className={compact ? 'brand brand-compact' : 'brand'}>
      <div className="brand-mark"><span>✦</span></div>
      <div className="brand-copy">
        <strong>Character Collection Room</strong>
        <span>角色收藏室</span>
      </div>
    </div>
  )
}
