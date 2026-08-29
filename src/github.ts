import type { GithubConfig } from './types'

const API = 'https://api.github.com'

const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function call(cfg: GithubConfig, path: string, init?: RequestInit) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    let hint = ''
    if (res.status === 401) hint = ' — токен не принят, проверь, что он не истёк'
    if (res.status === 403) hint = ' — у токена нет прав Contents: write на этот репозиторий'
    if (res.status === 404) hint = ' — репозиторий или ветка не найдены, проверь владельца и название'
    throw new Error(`GitHub ${res.status}${hint}\n${body.slice(0, 300)}`)
  }
  return res.json()
}

/**
 * Пишет несколько файлов одним коммитом через Git Data API,
 * чтобы деплой запускался один раз, а не по разу на файл.
 */
export async function commitFiles(
  cfg: GithubConfig,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  const base = `/repos/${cfg.owner}/${cfg.repo}`
  const ref = await call(cfg, `${base}/git/ref/heads/${cfg.branch}`)
  const headSha: string = ref.object.sha
  const headCommit = await call(cfg, `${base}/git/commits/${headSha}`)

  const tree = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const blob = await call(cfg, `${base}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: toBase64(content), encoding: 'base64' }),
      })
      return { path, mode: '100644', type: 'blob', sha: blob.sha }
    }),
  )

  const newTree = await call(cfg, `${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
  })
  const commit = await call(cfg, `${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }),
  })
  await call(cfg, `${base}/git/refs/heads/${cfg.branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  })
  return commit.sha
}

export async function checkAccess(cfg: GithubConfig) {
  const repo = await call(cfg, `/repos/${cfg.owner}/${cfg.repo}`)
  await call(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${cfg.branch}`)
  return { name: repo.full_name as string, private: repo.private as boolean }
}
