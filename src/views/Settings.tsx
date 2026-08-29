import { useState } from 'react'
import { useBudget } from '../store'
import { checkAccess } from '../github'

export function Settings() {
  const { github, setGithub, canEdit, dirty, discardDraft, reload, budget } = useBudget()
  const [form, setForm] = useState(github)
  const [check, setCheck] = useState<{ kind: 'idle' | 'busy' } | { kind: 'ok' | 'err'; text: string }>({ kind: 'idle' })

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (ev: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: ev.target.value }),
  })

  const apply = () => {
    setGithub(form)
    setCheck({ kind: 'idle' })
  }

  const test = async () => {
    setCheck({ kind: 'busy' })
    try {
      const info = await checkAccess(form)
      setGithub(form)
      setCheck({
        kind: 'ok',
        text: `Доступ есть: ${info.name}${info.private ? ' (приватный)' : ' (публичный)'}`,
      })
    } catch (e) {
      setCheck({ kind: 'err', text: String((e as Error).message ?? e) })
    }
  }

  return (
    <div className="page">
      <div className="headline">
        <div className="eyebrow">Только для тебя</div>
        <h1>Настройки</h1>
        <p>
          {import.meta.env.DEV
            ? 'Локальный режим: правки пишутся прямо в public/data, токен не нужен.'
            : 'Чтобы править данные с этого устройства, нужен токен GitHub. Без него приложение работает как просмотр.'}
        </p>
      </div>

      {!import.meta.env.DEV && (
        <div className="card">
          <div className="card-head"><h2>Доступ на запись</h2>
            <span className={'pill ' + (canEdit ? 'ok' : 'view')}>{canEdit ? 'правка включена' : 'только просмотр'}</span>
          </div>
          <div className="card-body">
            <div className="field">
              <label htmlFor="owner">Владелец репозитория</label>
              <input id="owner" autoCapitalize="off" autoCorrect="off" placeholder="например, DiehlWierce" {...field('owner')} />
            </div>
            <div className="field">
              <label htmlFor="repo">Репозиторий</label>
              <input id="repo" autoCapitalize="off" autoCorrect="off" placeholder="family-budget" {...field('repo')} />
            </div>
            <div className="field">
              <label htmlFor="branch">Ветка</label>
              <input id="branch" autoCapitalize="off" autoCorrect="off" placeholder="main" {...field('branch')} />
            </div>
            <div className="field">
              <label htmlFor="token">Токен</label>
              <input id="token" type="password" autoCapitalize="off" autoCorrect="off"
                placeholder="github_pat_…" {...field('token')} />
              <span className="help">
                Fine-grained token с правом Contents: Read and write только на этот репозиторий.
                Хранится в localStorage этого устройства и никуда больше не уходит.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={test} disabled={check.kind === 'busy' || !form.token}>
                {check.kind === 'busy' ? 'Проверяю…' : 'Проверить и сохранить'}
              </button>
              <button className="btn ghost" onClick={apply}>Просто сохранить</button>
            </div>
            {check.kind === 'ok' && <div className="banner" style={{ marginTop: 12 }}>{check.text}</div>}
            {check.kind === 'err' && (
              <div className="banner err" style={{ marginTop: 12 }}>
                Не получилось<pre>{check.text}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Данные</h2></div>
        <div className="card-body">
          <div className="tiny muted">
            Получек: {budget?.paychecks.length ?? 0} · строк: {budget?.entries.length ?? 0} ·
            обновлено {budget ? new Date(budget.meta.updatedAt).toLocaleString('ru-RU') : '—'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn ghost" onClick={reload}>Перечитать с сервера</button>
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
    </div>
  )
}
