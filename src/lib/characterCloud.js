import { supabase } from './supabase'

const TABLE = 'characters'
const BUCKET = 'character-images'
const SIGNED_URL_SECONDS = 60 * 60

function isDataImage(value) {
  return typeof value === 'string' && /^data:image\//i.test(value)
}

function extensionFor(dataUrl) {
  const mime = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)?.[1]?.toLowerCase()
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'jpg'
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = dataUrl.split(',', 2)
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg'
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function currentUser() {
  if (!supabase) throw new Error('Supabase 尚未設定，請檢查 .env.local。')
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('登入狀態已失效，請重新登入。')
  return data.user
}

async function uploadImageIfNeeded(value, userId, characterId, index) {
  if (!isDataImage(value)) return value
  const ext = extensionFor(value)
  const path = `${userId}/${characterId}/${Date.now()}-${index}.${ext}`
  const blob = dataUrlToBlob(value)
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type,
    upsert: true,
  })
  if (error) throw new Error(`圖片上傳失敗：${error.message}`)
  return `storage://${path}`
}

async function resolveImage(value) {
  if (typeof value !== 'string' || !value.startsWith('storage://')) return value
  const path = value.slice('storage://'.length)
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS)
  if (error) throw new Error(`圖片讀取失敗：${error.message}`)
  return data.signedUrl
}

async function prepareCharacter(character, userId) {
  const copy = structuredClone(character || {})
  const legacyId = String(copy.id || copy.legacyId || `CHR-${Date.now()}`)
  copy.legacyId = legacyId
  const imageMap = copy._cloudImageMap || {}
  const preserveOrUpload = async (value, index) => {
    if (typeof value === 'string' && imageMap[value]) return `storage://${imageMap[value]}`
    return uploadImageIfNeeded(value, userId, legacyId, index)
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
  character.cloudDbId = row.id
  character.name = character.name || row.title || '未命名角色'
  const imageMap = {}
  const resolveAndRemember = async value => {
    if (typeof value !== 'string' || !value.startsWith('storage://')) return value
    const path = value.slice('storage://'.length)
    const signedUrl = await resolveImage(value)
    imageMap[signedUrl] = path
    return signedUrl
  }
  if (Array.isArray(character.images)) {
    character.images = await Promise.all(character.images.map(resolveAndRemember))
  }
  for (const field of ['portraitUrl', 'originalImageUrl']) {
    if (character[field]) character[field] = await resolveAndRemember(character[field])
  }
  character._cloudImageMap = imageMap
  return character
}

async function saveOne(character) {
  const user = await currentUser()
  const prepared = await prepareCharacter(character, user.id)
  const legacyId = String(prepared.legacyId)
  const { data: existing, error: lookupError } = await supabase
    .from(TABLE).select('id').eq('user_id', user.id).eq('content->>legacyId', legacyId).maybeSingle()
  if (lookupError) throw lookupError

  const payload = {
    user_id: user.id,
    title: String(prepared.name || '未命名角色'),
    content: prepared,
    image_path: (prepared.images || []).find(x => typeof x === 'string' && x.startsWith('storage://'))?.slice('storage://'.length) || null,
    updated_at: new Date().toISOString(),
  }
  let result
  if (existing?.id) {
    result = await supabase.from(TABLE).update(payload).eq('id', existing.id).eq('user_id', user.id).select('id').single()
  } else {
    result = await supabase.from(TABLE).insert(payload).select('id').single()
  }
  if (result.error) throw result.error
  const { data: savedRow, error: readError } = await supabase.from(TABLE)
    .select('id,title,content,image_path,created_at,updated_at').eq('id', result.data.id).eq('user_id', user.id).single()
  if (readError) throw readError
  return { ok: true, id: legacyId, cloudDbId: result.data.id, character: await hydrateCharacter(savedRow) }
}

export async function listCharacters() {
  const user = await currentUser()
  const { data, error } = await supabase.from(TABLE).select('id,title,content,image_path,created_at,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false })
  if (error) throw error
  return Promise.all((data || []).map(hydrateCharacter))
}

export async function syncCharacters(action, payload, currentCharacters = []) {
  const user = await currentUser()
  if (action === 'delete') {
    const legacyId = String(payload?.id || '')
    const { data: row, error: findError } = await supabase.from(TABLE).select('id').eq('user_id', user.id).eq('content->>legacyId', legacyId).maybeSingle()
    if (findError) throw findError
    if (row?.id) {
      const { error } = await supabase.from(TABLE).delete().eq('id', row.id).eq('user_id', user.id)
      if (error) throw error
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

export async function migrateLocalCharacters(localCharacters = []) {
  const cloudCharacters = await listCharacters()
  const cloudIds = new Set(cloudCharacters.map(character => String(character.id)))
  const missingLocalCharacters = localCharacters.filter(character => character?.id && !cloudIds.has(String(character.id)))
  let count = 0
  for (const character of missingLocalCharacters) {
    await saveOne(character)
    count += 1
  }
  return { migrated: count > 0, characters: await listCharacters(), count }
}
