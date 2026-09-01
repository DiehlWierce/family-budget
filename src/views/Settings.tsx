import { useState } from 'react'
import { useBudget } from '../store'
import { checkAccess } from '../github'
import { Categories } from './Categories'
import { BUILT_AT, COMMIT, VERSION } from '../version'
import { today } from '../format'
import type { Budget, GithubConfig } from '../types'

/**
 * Выгрузка всех данных одним файлом: страховка на случай, если доступ
 * к репозиторию пропадёт. Обратно раскладывается по `public/data` руками.
 */
function download(budget: Budget) {
  const blob = new Blob([JSON.stringify(budget, null, 2) + '\n'], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `budget-${today()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Владельца и репозиторий берём из адреса: приложение живёт на
 * https://<владелец>.github.io/<репозиторий>/ — спрашивать их незачем.
 */
export function detectRepo(): { owner: string; repo: string } | null {
  if (typeof location === 'undefined') return null
  const m = location.hostname.match(/^([^.]+)\.github\.io$/)
  if (!m) return null
  const repo = location.pathname.split('/').filter(Boolean)[0]
  if (!repo) return null
  return { owner: m[1], repo }
}

type Check =
  | { kind: 'idle' | 'busy' }
  | { kind: 'ok'; text: string }
  | { kind: 'err'; text: string }

export function Settings() {
  const { github, setGithub, canEdit, dirty, discardDraft, reload, budget } = useBudget()
  const detected = detectRepo()
  const [token, setToken] = useState('')
  const [manual, setManual] = useState<GithubConfig>(github)
  const [showManual, setShowManual] = useState(false)
  const [check, setCheck] = useState<Check>({ kind: 'idle' })

  const target = detected ?? { owner: manual.owner, repo: manual.repo }
  const tokenUrl = `https://github.com/settings/personal-access-tokens/new`

  const connect = async () => {
    const cfg: GithubConfig = {
      owner: target.owner,
      repo: target.repo,
      branch: manual.branch || 'main',
      token: token.trim(),
    }
    setCheck({ kind: 'busy' })
    try {
      const info = await checkAccess(cfg)
      setGithub(cfg)
      setToken('')
      setCheck({ kind: 'ok', text: `Готово. Правки уходят в ${info.name}, больше спрашивать не буду.` })
    } catch (e) {
      setCheck({ kind: 'err', text: String((e as Error).message ?? e) })
    }
  }

  const disconnect = () => {
    setGithub({ ...github, token: '' })
    setCheck({ kind: 'idle' })
  }

  return (
    <div className="page">
      <div className="headline">
        <div className="eyebrow">Только для тебя</div>
        <h1>Настройки</h1>
        <p>
          {import.meta.env.DEV
            ? 'Локальный режим: правки пишутся прямо в public/data, ничего подключать не нужно.'
            : 'Правки всегда сохраняются на этом устройстве сразу. Чтобы они попали на сайт и их увидела жена, устройство нужно подключить один раз.'}
        </p>
      </div>

      {!import.meta.env.DEV && (
        canEdit ? (
          <div className="card">
            <div className="card-head"><h2>Устройство подключено</h2>
              <span className="pill ok">правка включена</span>
            </div>
            <div className="card-body">
              <div className="tiny muted">
                Репозиторий {github.owner}/{github.repo}, ветка {github.branch}.
                Кнопка «Опубликовать» наверху отправляет правки на сайт.
              </div>
              <button className="btn ghost" style={{ marginTop: 14 }} onClick={disconnect}>
                Отключить это устройство
              </button>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-head"><h2>Подключить это устройство</h2></div>
            <div className="card-body">
              <div className="tiny muted" style={{ marginBottom: 4 }}>
                Один раз на каждом устройстве, где будешь править. Занимает минуту.
              </div>

              <ol className="steps-list">
                <li>
                  <b>Открой страницу ключа.</b>
                  <a className="btn" style={{ display: 'inline-block', marginTop: 8, textDecoration: 'none' }}
                    href={tokenUrl} target="_blank" rel="noreferrer">Открыть GitHub</a>
                </li>
                <li>
                  <b>Repository access</b> → выбери <b>Only select repositories</b> →
                  в списке найди <b>{target.repo || 'свой репозиторий'}</b>.
                </li>
                <li>
                  <b>Permissions</b> → <b>Repository permissions</b> → строка <b>Contents</b> →
                  поставь <b>Read and write</b>. Больше ничего трогать не надо.
                </li>
                <li>
                  Внизу <b>Generate token</b>. Скопируй строку — она начинается на <span className="mono">github_pat_</span>.
                </li>
              </ol>

              <div className="field" style={{ marginTop: 16 }}>
                <label htmlFor="token">Вставь ключ сюда</label>
                <input
                  id="token" type="password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  placeholder="github_pat_…" value={token}
                  onChange={(ev) => setToken(ev.target.value)}
                />
                <span className="help">
                  Ключ остаётся в памяти этого браузера. На телефон жены его вводить не надо —
                  без ключа приложение просто показывает.
                </span>
              </div>

              <button className="btn" onClick={connect} disabled={check.kind === 'busy' || token.trim().length < 10}>
                {check.kind === 'busy' ? 'Проверяю…' : 'Подключить'}
              </button>

              {check.kind === 'ok' && <div className="banner" style={{ marginTop: 12 }}>{check.text}</div>}
              {check.kind === 'err' && (
                <div className="banner err" style={{ marginTop: 12 }}>
                  Не получилось<pre>{check.text}</pre>
                </div>
              )}

              <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setShowManual(!showManual)}>
                {showManual ? 'Скрыть' : 'Указать репозиторий вручную'}
              </button>
              {showManual && (
                <div style={{ marginTop: 12 }}>
                  <div className="field">
                    <label htmlFor="owner">Владелец</label>
                    <input id="owner" value={manual.owner}
                      onChange={(ev) => setManual({ ...manual, owner: ev.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="repo">Репозиторий</label>
                    <input id="repo" value={manual.repo}
                      onChange={(ev) => setManual({ ...manual, repo: ev.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="branch">Ветка</label>
                    <input id="branch" value={manual.branch}
                      onChange={(ev) => setManual({ ...manual, branch: ev.target.value })} />
                  </div>
                  <div className="tiny muted">
                    {detected
                      ? `Из адреса определилось: ${detected.owner}/${detected.repo}. Заполнять это нужно, только если что-то не так.`
                      : 'Из адреса определить не удалось — заполни вручную.'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      )}

      <Categories />

      <div className="card">
        <div className="card-head"><h2>Данные</h2></div>
        <div className="card-body">
          <div className="tiny muted">
            Получек: {budget?.paychecks.length ?? 0} · строк: {budget?.entries.length ?? 0} ·
            шаблонов: {budget?.templates.length ?? 0} ·
            обновлено {budget ? new Date(budget.meta.updatedAt).toLocaleString('ru-RU') : '—'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn ghost" onClick={reload}>Перечитать с сервера</button>
            <button className="btn ghost" onClick={() => budget && download(budget)}
              disabled={!budget}>
              Скачать все данные
            </button>
            <button className="btn ghost" onClick={discardDraft} disabled={!dirty}>
              Отменить несохранённые правки
            </button>
          </div>
          {dirty && (
            <div className="banner" style={{ marginTop: 12 }}>
              Есть несохранённые правки. Пока не нажмёшь «Опубликовать», они живут только на этом устройстве.
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>На домашний экран</h2></div>
        <div className="card-body">
          <div className="tiny muted">
            На айфоне: Safari → «Поделиться» → «На экран Домой». Приложение откроется без адресной строки,
            как обычная иконка.
          </div>
        </div>
      </div>

      <div className="tiny muted" style={{ textAlign: 'center', padding: '18px 0 4px' }}>
        Версия {VERSION} · {COMMIT} · собрано {new Date(BUILT_AT).toLocaleString('ru-RU')}
      </div>
    </div>
  )
}
