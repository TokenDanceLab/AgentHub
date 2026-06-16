import type { AgentBlock as AgentBlockType } from '../data/mock'
import RunGroup from './RunGroup'
import RowItem from './RowItem'
import OrchestratorCard from './OrchestratorCard'
import { IconShield } from './Icons'
import { roleInitial } from '../design/roles'
import type { AgentRole } from '../design/roles'

interface Props { block: AgentBlockType; chatMode: 'dm' | 'group' }

export default function AgentGroup({ block, chatMode }: Props) {
  const initial = roleInitial[block.role as AgentRole] ?? block.agent[0]
  const avatar = (
    <div className={`ag-av ${block.role}`}>
      {block.role === 'shield' ? <IconShield size={14} /> : initial}
    </div>
  )

  const body = (
    <>
      {chatMode === 'group' && (
        <div className="agent-meta">
          <span className="ag-name">{block.agent}</span>
          {block.time && <span className="ag-time">{block.time}</span>}
        </div>
      )}
      {/* Flat rows — merged into continuous card stack */}
      {block.rows.length > 0 && (
        <div className="card-stack">
          {block.rows.map((row) => (
            row.type === 'route' && row.orchAgents?.length
              ? <OrchestratorCard key={row.id} item={row} />
              : <RowItem key={row.id} item={row} />
          ))}
        </div>
      )}
      {/* RunGroups — for subagent nesting only */}
      {block.runs.map((run) => <RunGroup key={run.id} group={run} />)}
      {block.standaloneRows.length > 0 && (
        <div className="card-stack">
          {block.standaloneRows.map((row) => (
            row.type === 'route' && row.orchAgents?.length
              ? <OrchestratorCard key={row.id} item={row} />
              : <RowItem key={row.id} item={row} />
          ))}
        </div>
      )}
      {block.bubbles.map((text, i) => {
        const parts = text.split(/(`[^`]+`)/g)
        return (
          <div key={i} className="agent-bubble">
            {parts.map((part, j) =>
              part.startsWith('`') && part.endsWith('`')
                ? <code key={j}>{part.slice(1, -1)}</code>
                : part
            )}
          </div>
        )
      })}
    </>
  )

  if (chatMode === 'dm') {
    return (
      <div className="grp-row">
        <div className="dm-avatar">{avatar}</div>
        <div className="grp-content">{body}</div>
        <div className="dm-avatar" style={{ visibility: 'hidden' }}><div className="ag-av"> </div></div>
      </div>
    )
  }

  return (
    <div className="grp-row">
      <div className="dm-avatar">{avatar}</div>
      <div className="grp-content">{body}</div>
      <div className="dm-avatar" style={{ visibility: 'hidden' }}><div className="ag-av"> </div></div>
    </div>
  )
}
