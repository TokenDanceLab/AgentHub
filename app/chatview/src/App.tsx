import Transcript from './components/Transcript'
import ChatViewTranscript from './ChatViewTranscript'
import { transcript, transcriptGroup } from './data/mock'
import { demoBlocks } from './data/demoAgentHub'
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
          transition: 'all var(--dur) var(--ease)',
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

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 'var(--sp-lg)' }}>
        <h1 style={{ font: '600 1.25rem/1.2 var(--font-sans)', marginBottom: 4, color: 'var(--text-1)' }}>{title}</h1>
        <p style={{ color: 'var(--text-3)', font: 'var(--body)' }}>{desc}</p>
      </div>
      {children}
    </div>
  )
}

export default function App() {
  const { t } = useI18n()

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 'var(--sp-xl) var(--sp-lg)' }}>
      <Toolbar />

      {/* Section 1: ChatView Native — DM */}
      <Section title={t('app.dm.title')} desc={t('app.dm.desc')}>
        <Transcript items={transcript} chatMode="dm" />
      </Section>

      <div style={{ borderTop: '1px solid var(--bdr)', margin: 'var(--sp-xl) 0' }} />

      {/* Section 2: ChatView Native — Group */}
      <Section title={t('app.group.title')} desc={t('app.group.desc')}>
        <Transcript items={transcriptGroup} chatMode="group" />
      </Section>

      <div style={{ borderTop: '2px dashed var(--bdr-strong)', margin: 'var(--sp-xl) 0' }} />

      {/* Section 3: AgentHub Adapter — TranscriptBlock[] → ChatView */}
      <Section title="AgentHub 适配器" desc="TranscriptBlock[] → blocksToTranscript() → ChatView Transcript">
        <ChatViewTranscript blocks={demoBlocks} chatMode="group" />
      </Section>
    </div>
  )
}
