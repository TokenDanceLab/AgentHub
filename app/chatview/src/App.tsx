import Transcript from './components/Transcript'
import { transcript, transcriptGroup } from './data/mock'
import { useI18n, useTheme, locales } from './DesignSystemProvider'

function Toolbar() {
  const { locale, setLocale, t } = useI18n()
  const { theme, toggle: toggleTheme } = useTheme()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--sp-sm)',
      position: 'fixed', top: 12, right: 20, zIndex: 100,
      background: 'var(--surface)', border: '1px solid var(--bdr)',
      borderRadius: 'var(--r-md)', padding: '6px 10px',
      boxShadow: 'var(--shadow)',
    }}>
      <span style={{ font: 'var(--label-xs)', color: 'var(--text-3)', marginRight: 2 }}>{t('app.lang')}</span>
      {locales.map(l => (
        <button key={l.code} onClick={() => setLocale(l.code)} style={{
          font: 'var(--label)', padding: '2px 8px', border: 'none', cursor: 'pointer',
          borderRadius: 'var(--r-sm)',
          background: locale === l.code ? 'var(--primary)' : 'transparent',
          color: locale === l.code ? 'white' : 'var(--text-2)',
        }}>{l.label}</button>
      ))}
      <span style={{ width: 1, height: 16, background: 'var(--bdr)', margin: '0 2px' }} />
      <button onClick={toggleTheme} style={{
        font: 'var(--label)', border: '1px solid var(--bdr)', cursor: 'pointer',
        borderRadius: 'var(--r-sm)', padding: '2px 8px',
        background: 'var(--surface)', color: 'var(--text-1)',
      }}>{theme === 'light' ? '☀️' : '🌙'}</button>
    </div>
  )
}

export default function App() {
  const { t } = useI18n()

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--sp-xl) var(--sp-lg)' }}>
      <Toolbar />

      <div style={{ marginBottom: 'var(--sp-lg)' }}>
        <h1 style={{ font: '600 1.25rem/1.2 var(--font-sans)', marginBottom: 4, color: 'var(--text-1)' }}>{t('app.dm.title')}</h1>
        <p style={{ color: 'var(--text-3)', font: 'var(--body)' }}>{t('app.dm.desc')}</p>
      </div>
      <Transcript items={transcript} chatMode="dm" />

      <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: 'var(--sp-xl)', marginTop: 'var(--sp-xl)' }}>
        <div style={{ marginBottom: 'var(--sp-lg)' }}>
          <h1 style={{ font: '600 1.25rem/1.2 var(--font-sans)', marginBottom: 4, color: 'var(--text-1)' }}>{t('app.group.title')}</h1>
          <p style={{ color: 'var(--text-3)', font: 'var(--body)' }}>{t('app.group.desc')}</p>
        </div>
        <Transcript items={transcriptGroup} chatMode="group" />
      </div>
    </div>
  )
}
