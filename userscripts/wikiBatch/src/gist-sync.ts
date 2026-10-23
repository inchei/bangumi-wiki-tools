import GM_fetch from '@trim21/gm-fetch';

const GITHUB_CLIENT_ID = 'Ov23lifi6y3LGaJ8A53e'
const GIST_FILE = 'wikiBatch-sync.json'
const GIST_DESC = 'wikiBatch 跨设备同步数据'

interface SyncData {
  version: 1
  csvData: string
  currentIndex: number
  retryCount: string
  previousItem: string | null
  entityType: string
  totalItems: number
}

function syncData(): SyncData {
  return {
    version: 1,
    csvData: localStorage.getItem('bgmCsvData') || 'null',
    currentIndex: parseInt(localStorage.getItem('bgmCurrentIndex') || '0'),
    retryCount: GM_getValue('bgmRetryCount') || '{}',
    previousItem: localStorage.getItem('bgmPreviousItem'),
    entityType: localStorage.getItem('bgmEntityType') || 'subject',
    totalItems: parseInt(localStorage.getItem('bgmTotalItems') || '0'),
  }
}

function applySyncData(data: SyncData): void {
  try {
    localStorage.setItem('bgmCsvData', data.csvData)
    localStorage.setItem('bgmCurrentIndex', data.currentIndex.toString())
    localStorage.setItem('bgmEntityType', data.entityType)
    localStorage.setItem('bgmTotalItems', data.totalItems.toString())
  } catch {
    throw new Error('同步数据过大，超出本地存储配额')
  }
  GM_setValue('bgmRetryCount', data.retryCount)
  if (data.previousItem) localStorage.setItem('bgmPreviousItem', data.previousItem)
  else localStorage.removeItem('bgmPreviousItem')
}

// Device Flow
interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const resp = await GM_fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'gist' }),
  })
  return resp.json()
}

async function pollToken(deviceCode: string, interval: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let currentInterval = interval
    const poll = async () => {
      const resp = await GM_fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      })
      const data: TokenResponse = await resp.json()
      if (data.access_token) {
        resolve(data.access_token)
      } else if (data.error === 'authorization_pending') {
        setTimeout(poll, currentInterval * 1000)
      } else if (data.error === 'slow_down') {
        currentInterval += 5
        setTimeout(poll, currentInterval * 1000)
      } else {
        reject(new Error(data.error_description || data.error || '授权失败'))
      }
    }
    poll()
  })
}

export async function authorizeWithGitHub(statusEl: HTMLElement): Promise<void> {
  statusEl.textContent = '正在获取设备码...'
  let deviceResp: DeviceCodeResponse
  try {
    deviceResp = await requestDeviceCode()
  } catch {
    statusEl.textContent = '网络错误，无法连接 GitHub'
    return
  }

  statusEl.innerHTML = `请在打开的页面中输入码: <strong>${deviceResp.user_code}</strong>`
  GM_openInTab(deviceResp.verification_uri)

  try {
    const token = await pollToken(deviceResp.device_code, deviceResp.interval)
    GM_setValue('bgmGistToken', token)
    statusEl.textContent = '授权成功'
  } catch (e) {
    statusEl.textContent = (e as Error).message
  }
}

// Gist API
function getGistId(): string | null {
  return GM_getValue('bgmGistId') || null
}

function setGistId(id: string): void {
  GM_setValue('bgmGistId', id)
}

function getToken(): string | null {
  return GM_getValue('bgmGistToken') || null
}

async function createGist(content: string): Promise<string> {
  const token = getToken()
  if (!token) throw new Error('未授权')
  const resp = await GM_fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: GIST_DESC,
      public: false,
      files: { [GIST_FILE]: { content } },
    }),
  })
  const result = await resp.json()
  return result.id
}

async function updateGist(gistId: string, content: string): Promise<void> {
  const token = getToken()
  if (!token) throw new Error('未授权')
  await GM_fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files: { [GIST_FILE]: { content } } }),
  })
}

async function findGistId(): Promise<string | null> {
  const token = getToken()
  if (!token) return null
  const resp = await GM_fetch('https://api.github.com/gists?per_page=100', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
    },
  })
  const gists: any[] = await resp.json()
  const target = gists.find((g: any) => g.description === GIST_DESC && g.files?.[GIST_FILE])
  return target?.id || null
}

async function readGist(gistId: string): Promise<string> {
  const token = getToken()
  if (!token) throw new Error('未授权')
  const resp = await GM_fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
    },
  })
  const result = await resp.json()
  const file = result.files?.[GIST_FILE]
  if (!file) throw new Error('Gist 中未找到同步数据')

  console.log('[wikiBatch] gist read:', {
    size: file.size,
    truncated: file.truncated,
    hasContent: typeof file.content === 'string',
  })

  if (file.truncated && file.raw_url) {
    console.log('[wikiBatch] gist content truncated, fetching raw_url...')
    const rawResp = await GM_fetch(file.raw_url, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (!rawResp.ok) throw new Error(`读取原始文件失败: HTTP ${rawResp.status}`)
    const raw = await rawResp.text()
    console.log('[wikiBatch] gist raw content length:', raw.length)
    return raw
  }

  return file.content
}

export async function uploadToGist(): Promise<void> {
  const data = syncData()
  const content = JSON.stringify(data)

  let gistId = getGistId()
  if (!gistId) {
    gistId = await findGistId()
    if (gistId) setGistId(gistId)
  }

  if (gistId) {
    await updateGist(gistId, content)
  } else {
    gistId = await createGist(content)
    setGistId(gistId)
  }
}

export async function downloadFromGist(): Promise<void> {
  let gistId = getGistId()
  if (!gistId) {
    gistId = await findGistId()
    if (!gistId) throw new Error('未找到同步 Gist，请先在另一设备上传')
    setGistId(gistId)
  }

  const content = await readGist(gistId)
  console.log('[wikiBatch] parsed content length:', content.length)
  let data: SyncData
  try {
    data = JSON.parse(content)
  } catch (e) {
    console.error('[wikiBatch] JSON.parse failed, content head:', content.slice(0, 200))
    console.error('[wikiBatch] JSON.parse failed, content tail:', content.slice(-200))
    throw new Error('同步数据解析失败', { cause: e })
  }
  applySyncData(data)
}

export function clearGistAuth(): void {
  GM_deleteValue('bgmGistToken')
  GM_deleteValue('bgmGistId')
}

export function hasGistToken(): boolean {
  return !!getToken()
}
