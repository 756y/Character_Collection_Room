// Google Drive + Google Sheets adapter for Character Collection Room.
// The OAuth Client ID is public in a browser app; never put a Client Secret here.
const GOOGLE_CLIENT_ID = '1005843650437-r0lh9ppu8l68ldlqk7keoslmql3jj697.apps.googleusercontent.com'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const PROFILE_API = 'https://www.googleapis.com/oauth2/v3/userinfo'
const APP_PROPERTY_KEY = 'characterCollectionRoom'
const APP_PROPERTY_VALUE = 'personal-media-library-v1'
const SHEET_NAME = 'Characters'
const JSON_CHUNK_SIZE = 40000
const JSON_CHUNK_COUNT = 24
const UPDATED_AT_COLUMN = 'AA'
// Split JSON across multiple cells so each stays below Google Sheets' 50,000-character cell limit.
const HEADERS = ['id', 'title', ...Array.from({ length: JSON_CHUNK_COUNT }, (_, index) => `content_json_${index + 1}`), 'updated_at']
// 使用英文分頁名稱 Characters，避免非英文分頁名稱造成範圍解析疑慮。
const sheetRange = (cells) => `${SHEET_NAME}!${cells}`
// 將整個 A1 範圍編碼為 URL path segment，並額外編碼 ! 等保留字元。
const encodeSheetRange = (range) => encodeURIComponent(range).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

let accessToken = null
let currentProfile = null
let rootFolderId = null
let spreadsheetId = null
let imageFolderId = null
let tokenClient = null
let scriptPromise = null
const imageObjectUrls = new Set()

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity="true"]')
    if (existing) {
      existing.addEventListener('load', resolve, { once: true })
      existing.addEventListener('error', () => reject(new Error('無法載入 Google 登入服務，請檢查網路連線。')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleIdentity = 'true'
    script.onload = resolve
    script.onerror = () => reject(new Error('無法載入 Google 登入服務，請檢查網路連線。'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

function requestAccessToken() {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('PASTE_')) {
      reject(new Error('尚未設定 Google OAuth Client ID。請在 src/lib/googleDrive.js 最上方，將 GOOGLE_CLIENT_ID 替換成 Google Cloud 建立的「Web application」用戶端 ID。'))
      return
    }
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/spreadsheets',
      ].join(' '),
      callback: response => {
        if (response?.error) {
          reject(new Error(`Google 授權失敗：${response.error_description || response.error}`))
          return
        }
        if (!response?.access_token) {
          reject(new Error('Google 沒有回傳授權 Token，請再試一次。'))
          return
        }
        accessToken = response.access_token
        resolve(response)
      },
      error_callback: error => reject(new Error(`Google 登入視窗無法開啟：${error?.message || error?.type || '請允許彈出視窗後重試。'}`)),
    })
    tokenClient.requestAccessToken({ prompt: 'consent select_account' })
  })
}

function requireToken() {
  if (!accessToken) throw new Error('Google 登入狀態已失效，請重新登入。')
  return accessToken
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${requireToken()}`)
  let response
  try {
    response = await fetch(url, { ...options, headers })
  } catch (error) {
    throw new Error(`無法連線至 Google API：${error?.message || '網路連線失敗'}。請確認網路、OAuth 授權與網站來源設定。`)
  }
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body?.error?.message || body?.error_description || JSON.stringify(body?.error || body) || ''
    } catch { /* response may not be JSON */ }
    if (response.status === 401) {
      accessToken = null
      throw new Error('Google 授權已過期，請重新登入後再試。')
    }
    if (response.status === 403 && /SERVICE_DISABLED|has not been used|disabled/i.test(detail)) {
      throw new Error('Google Sheets API 或 Google Drive API 尚未啟用。請到 Google Cloud Console → APIs & Services → Library，確認 Google Sheets API 與 Google Drive API 都已啟用。')
    }
    if (response.status === 403 && /scope|permission|insufficient|caller does not have permission/i.test(detail)) {
      throw new Error('Google 權限不足，無法讀寫角色文字。請確認 OAuth 要求包含 https://www.googleapis.com/auth/spreadsheets，並重新登入、在授權畫面同意新增權限。原始訊息：' + detail)
    }
    throw new Error(detail || `Google API 請求失敗（${response.status}）。`)
  }
  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response.json()
  return response
}

async function listAppFiles(propertyValue, mimeType) {
  const q = `appProperties has { key='${APP_PROPERTY_KEY}' and value='${propertyValue}' } and trashed=false${mimeType ? ` and mimeType='${mimeType}'` : ''}`
  const url = new URL(`${DRIVE_API}/files`)
  url.searchParams.set('q', q)
  url.searchParams.set('pageSize', '100')
  url.searchParams.set('fields', 'files(id,name,mimeType,parents)')
  const result = await apiFetch(url)
  return result.files || []
}

async function createDriveFolder(name, propertyValue, parentId = null) {
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: { [APP_PROPERTY_KEY]: propertyValue },
  }
  if (parentId) metadata.parents = [parentId]
  return apiFetch(`${DRIVE_API}/files?fields=id,name,mimeType,parents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  })
}

async function ensureRootFolder() {
  if (rootFolderId) return rootFolderId
  const found = await listAppFiles('root-folder', 'application/vnd.google-apps.folder')
  if (found.length) {
    rootFolderId = found[0].id
    return rootFolderId
  }
  const created = await createDriveFolder('角色收藏室', 'root-folder')
  rootFolderId = created.id
  return rootFolderId
}

// Put files created by earlier versions into the new top-level library folder.
async function ensureFileInsideFolder(file, parentId) {
  if (!file?.id || !parentId) return file
  const parents = Array.isArray(file.parents) ? file.parents : []
  if (parents.includes(parentId)) return file
  const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(file.id)}`)
  url.searchParams.set('addParents', parentId)
  const removeParents = parents.filter(id => id !== parentId)
  if (removeParents.length) url.searchParams.set('removeParents', removeParents.join(','))
  url.searchParams.set('fields', 'id,name,mimeType,parents')
  return apiFetch(url, { method: 'PATCH' })
}

async function ensureImageFolder() {
  if (imageFolderId) return imageFolderId
  const rootId = await ensureRootFolder()
  const found = await listAppFiles('images', 'application/vnd.google-apps.folder')
  if (found.length) {
    const nested = await ensureFileInsideFolder(found[0], rootId)
    imageFolderId = nested.id
    return imageFolderId
  }
  const created = await createDriveFolder('圖片', 'images', rootId)
  imageFolderId = created.id
  return imageFolderId
}

async function ensureSheetTab() {
  const metadata = await apiFetch(`${SHEETS_API}/${spreadsheetId}?fields=sheets(properties(sheetId,title))`)
  const sheets = metadata.sheets || []
  const target = sheets.find(item => item.properties?.title === SHEET_NAME)
  if (target) return target.properties.sheetId

  // Keep the user's existing default tab untouched. Create a separate English tab
  // so all app reads/writes use a predictable ASCII-only A1 range.
  const result = await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] }),
  })
  const createdSheetId = result?.replies?.[0]?.addSheet?.properties?.sheetId
  if (createdSheetId == null) {
    throw new Error(`Google API 沒有成功建立「${SHEET_NAME}」分頁，請確認這份試算表可編輯後重試。`)
  }
  return createdSheetId
}

async function findSpreadsheetByNameInFolder(folderId) {
  // Files created by Apps Script or older app versions may not have our private appProperties marker.
  const q = `'${folderId}' in parents and name = '角色資料' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`
  const url = new URL(`${DRIVE_API}/files`)
  url.searchParams.set('q', q)
  url.searchParams.set('pageSize', '100')
  url.searchParams.set('orderBy', 'createdTime')
  url.searchParams.set('fields', 'files(id,name,mimeType,parents,appProperties,webViewLink,createdTime)')
  const result = await apiFetch(url)
  return result.files || []
}

async function markSpreadsheet(fileId, rootId) {
  const driveMeta = await apiFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,appProperties`)
  const patchUrl = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`)
  if (!(driveMeta.parents || []).includes(rootId)) patchUrl.searchParams.set('addParents', rootId)
  patchUrl.searchParams.set('fields', 'id,name,mimeType,parents,appProperties,webViewLink')
  return apiFetch(patchUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appProperties: { ...(driveMeta.appProperties || {}), [APP_PROPERTY_KEY]: 'spreadsheet' } }),
  })
}

async function ensureSpreadsheet() {
  const rootId = await ensureRootFolder()
  if (!spreadsheetId) {
    // Prefer the expected spreadsheet already inside this app's folder, so the
    // file being written is the same one the user opens in Drive.
    const named = await findSpreadsheetByNameInFolder(rootId)
    const marked = await listAppFiles('spreadsheet', 'application/vnd.google-apps.spreadsheet')
    if (named.length) {
      spreadsheetId = named[0].id
      await markSpreadsheet(spreadsheetId, rootId)
    } else if (marked.length) {
      const nested = await ensureFileInsideFolder(marked[0], rootId)
      spreadsheetId = nested.id
      await markSpreadsheet(spreadsheetId, rootId)
    } else {
      const created = await apiFetch(SHEETS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: { title: '角色資料' },
          sheets: [{ properties: { title: SHEET_NAME } }],
        }),
      })
      if (!created?.spreadsheetId) throw new Error('Google Sheets API 沒有回傳試算表 ID。')
      spreadsheetId = created.spreadsheetId
      await markSpreadsheet(spreadsheetId, rootId)
    }
    console.info('[Character Collection Room] Google Sheets target:', `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`)
  }

  await ensureSheetTab()
  const range = sheetRange('A1:AA1')
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeSheetRange(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [HEADERS] }),
  })
  return spreadsheetId
}

export async function signInWithGoogle() {
  await loadGoogleIdentityScript()
  await requestAccessToken()
  try {
    currentProfile = await apiFetch(PROFILE_API)
    await ensureRootFolder()
    await ensureSpreadsheet()
    await ensureImageFolder()
    return currentProfile
  } catch (error) {
    // Keep the token only for the current page session; the UI can retry or sign out.
    throw error
  }
}

export async function signOutGoogle() {
  const token = accessToken
  accessToken = null
  currentProfile = null
  rootFolderId = null
  spreadsheetId = null
  imageFolderId = null
  imageObjectUrls.forEach(url => URL.revokeObjectURL(url))
  imageObjectUrls.clear()
  if (token && window.google?.accounts?.oauth2?.revoke) {
    await new Promise(resolve => window.google.accounts.oauth2.revoke(token, () => resolve()))
  }
}

function isDataImage(value) {
  return typeof value === 'string' && /^data:image\//i.test(value)
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = dataUrl.split(',', 2)
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg'
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function extensionFor(blob) {
  const type = blob.type.toLowerCase()
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  if (type.includes('gif')) return 'gif'
  return 'jpg'
}

async function uploadImage(dataUrl, characterId, index) {
  const folderId = await ensureImageFolder()
  const blob = dataUrlToBlob(dataUrl)
  const name = `${String(characterId).replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}-${index}.${extensionFor(blob)}`
  const boundary = `character-room-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const metadata = {
    name,
    mimeType: blob.type || 'image/jpeg',
    parents: [folderId],
    appProperties: { [APP_PROPERTY_KEY]: 'image' },
  }
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${blob.type || 'image/jpeg'}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ])
  const uploaded = await apiFetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,parents`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!uploaded?.id) throw new Error(`圖片「${name}」上傳後沒有取得檔案 ID。`)
  return `drive://${uploaded.id}`
}

async function resolveImage(value) {
  if (typeof value !== 'string' || !value.startsWith('drive://')) return value
  const id = value.slice('drive://'.length)
  const response = await apiFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  imageObjectUrls.add(url)
  return url
}

async function prepareCharacter(character) {
  const copy = structuredClone(character || {})
  const legacyId = String(copy.id || copy.legacyId || `CHR-${Date.now()}`)
  copy.legacyId = legacyId
  const imageMap = copy._cloudImageMap || {}
  const preserveOrUpload = async (value, index) => {
    if (typeof value !== 'string') return value
    if (imageMap[value]) return `drive://${imageMap[value].replace(/^drive:\/\//, '')}`
    if (value.startsWith('drive://')) return value
    if (isDataImage(value)) return uploadImage(value, legacyId, index)
    return value
  }
  const images = Array.isArray(copy.images) ? copy.images : []
  copy.images = await Promise.all(images.map((image, index) => preserveOrUpload(image, index)))
  for (const field of ['portraitUrl', 'originalImageUrl']) {
    if (copy[field]) copy[field] = await preserveOrUpload(copy[field], field)
  }
  delete copy._cloudImageMap
  return copy
}

async function hydrateCharacter(row) {
  const character = { ...(row.content || {}) }
  character.id = character.legacyId || row.id
  character.cloudDbId = row.rowNumber
  character.name = character.name || row.title || '未命名角色'
  const imageMap = {}
  const resolveAndRemember = async value => {
    if (typeof value !== 'string' || !value.startsWith('drive://')) return value
    const id = value.slice('drive://'.length)
    const resolved = await resolveImage(value)
    imageMap[resolved] = id
    return resolved
  }
  if (Array.isArray(character.images)) character.images = await Promise.all(character.images.map(resolveAndRemember))
  for (const field of ['portraitUrl', 'originalImageUrl']) {
    if (character[field]) character[field] = await resolveAndRemember(character[field])
  }
  character._cloudImageMap = imageMap
  return character
}

async function getDefaultSheetId() {
  const id = await ensureSpreadsheet()
  const metadata = await apiFetch(`${SHEETS_API}/${id}?fields=sheets(properties(sheetId,title))`)
  const sheet = (metadata.sheets || []).find(item => item.properties?.title === SHEET_NAME)
  if (!sheet) throw new Error(`找不到試算表工作表「${SHEET_NAME}」。`)
  return sheet.properties.sheetId
}

async function readRows() {
  const id = await ensureSpreadsheet()
  const result = await apiFetch(`${SHEETS_API}/${id}/values/${encodeSheetRange(sheetRange('A1:AA'))}`)
  const values = result.values || []
  return values.slice(1).map((row, index) => {
    // Backward compatibility: old rows stored the entire JSON in C and timestamp in D.
    const legacyRow = /^\d{4}-\d{2}-\d{2}T/.test(String(row[3] || ''))
    const jsonText = legacyRow ? String(row[2] || '{}') : row.slice(2, 26).join('') || '{}'
    let content = {}
    try { content = JSON.parse(jsonText || '{}') } catch { content = {} }
    return {
      rowNumber: index + 2,
      id: String(row[0] || ''),
      title: row[1] || '未命名角色',
      content,
      updatedAt: legacyRow ? row[3] || '' : row[26] || '',
    }
  }).filter(row => row.id)
}

export async function listCharacters() {
  await ensureSpreadsheet()
  const rows = await readRows()
  return Promise.all(rows.map(hydrateCharacter))
}

async function saveOne(character) {
  const prepared = await prepareCharacter(character)
  const legacyId = String(prepared.legacyId || prepared.id || `CHR-${Date.now()}`)
  const id = await ensureSpreadsheet()
  const rows = await readRows()
  const existing = rows.find(row => row.id === legacyId)
  const jsonText = JSON.stringify(prepared)
  const chunks = jsonText.match(new RegExp(`.{1,${JSON_CHUNK_SIZE}}`, 'gs')) || ['{}']
  if (chunks.length > JSON_CHUNK_COUNT) {
    throw new Error(`角色資料序列化後約 ${(jsonText.length / 1024).toFixed(0)} KB，超過目前試算表分欄儲存上限。請先縮小角色資料中的超大文字或圖片內容後再儲存。`)
  }
  const values = [[legacyId, String(prepared.name || '未命名角色'), ...chunks, ...Array(Math.max(0, JSON_CHUNK_COUNT - chunks.length)).fill(''), new Date().toISOString()]]

  let writeResult
  try {
    if (existing) {
      const range = sheetRange(`A${existing.rowNumber}:AA${existing.rowNumber}`)
      writeResult = await apiFetch(`${SHEETS_API}/${id}/values/${encodeSheetRange(range)}?valueInputOption=RAW`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
    } else {
      // Avoid append endpoint/range parsing inconsistencies: read the actual used range,
      // then write the new record to an explicit row using values.update.
      const grid = await apiFetch(`${SHEETS_API}/${id}/values/${encodeSheetRange(sheetRange('A:AA'))}`)
      const nextRow = Math.max(2, (grid.values || []).length + 1)
      const range = sheetRange(`A${nextRow}:AA${nextRow}`)
      writeResult = await apiFetch(`${SHEETS_API}/${id}/values/${encodeSheetRange(range)}?valueInputOption=RAW`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      if (Number(writeResult?.updatedRows || 0) < 1) {
        throw new Error(`Google API 沒有確認寫入資料列 ${nextRow}；請確認試算表可編輯且工作表沒有保護限制。`)
      }
    }
  } catch (error) {
    throw new Error(`Google 試算表寫入失敗。圖片可能已上傳，但角色文字尚未儲存。${error?.message ? ` Google API 回覆：${error.message}` : ''}`)
  }

  const savedRows = await readRows()
  const confirmed = savedRows.find(row => row.id === legacyId)
  if (!confirmed) {
    const range = writeResult?.updates?.updatedRange || writeResult?.updatedRange || '未知範圍'
    const targetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`
    throw new Error(`Google API 回報寫入範圍「${range}」，但重新讀取時找不到角色 ID「${legacyId}」。本次實際使用的試算表是：${targetUrl}，分頁「${SHEET_NAME}」。請直接開啟這個連結，避免查看到另一份同名試算表。`)
  }
  console.info('[Character Collection Room] Verified character row:', { id: legacyId, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, sheet: SHEET_NAME, row: confirmed.rowNumber })
  if (!confirmed.content || Object.keys(confirmed.content).length === 0) {
    throw new Error(`試算表中找到角色 ID「${legacyId}」，但 content_json 欄位是空的。請確認 A:D 欄未被手動調整。`)
  }
  const hydrated = await hydrateCharacter(confirmed)
  return { ok: true, id: legacyId, character: hydrated }
}

export async function syncCharacters(action, payload, currentCharacters = []) {
  await ensureSpreadsheet()
  if (action === 'delete') {
    const legacyId = String(payload?.id || '')
    const rows = await readRows()
    const row = rows.find(item => item.id === legacyId)
    if (row) {
      const sheetId = await getDefaultSheetId()
      await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row.rowNumber - 1, endIndex: row.rowNumber } } }] }),
      })
    }
    return { ok: true }
  }
  if (action === 'import' && Array.isArray(payload)) {
    const results = []
    for (const character of payload) results.push(await saveOne(character))
    return { ok: true, count: results.length }
  }
  const character = payload?.name ? payload : currentCharacters.find(item => String(item.id) === String(payload?.id))
  if (!character) throw new Error('找不到要同步的角色資料，請重新開啟角色編輯頁。')
  return saveOne(character)
}
