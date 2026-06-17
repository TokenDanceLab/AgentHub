import { IconGitBranch } from './Icons'
import type { RowItem as RowItemType } from '../types'
import { roleColor, roleInitial } from '../design/roles'
import type { AgentRole } from '../design/roles'

interface DagNode {
  id: string; agent: string; role: AgentRole
  task: string; status: 'pending'|'running'|'ok'|'fail'; dependsOn?: string[]
}

/** Topological sort into layers. Layer 0 = no unmet deps, layer N = deps in layers <N. */
function buildLayers(nodes: DagNode[]): DagNode[][] {
  const remaining = new Set(nodes.map(n=>n.id))
  const layers: DagNode[][] = []
  while (remaining.size) {
    const layer: DagNode[] = []
    for (const id of remaining) {
      const node = nodes.find(n=>n.id===id)!
      const unmet = (node.dependsOn||[]).filter(d=>remaining.has(d))
      if (!unmet.length) layer.push(node)
    }
    if (!layer.length) break // cycle — push rest as-is
    for (const n of layer) remaining.delete(n.id)
    layers.push(layer)
  }
  return layers
}

// ── Node dimensions (matching row-hd scale) ──
const NW=108, NH=28, CG=48, RG=8, P=12

function NodeEl({n,x,y}:{n:DagNode;x:number;y:number}){
  const sc=n.status==='ok'?'var(--state-success)':n.status==='running'?'var(--state-running)':n.status==='fail'?'var(--state-failed)':'var(--state-waiting)'
  const cy=y+NH/2
  return <g>
    <title>{n.agent} — {n.task}</title>
    <rect x={x} y={y} width={NW} height={NH} rx={6} fill="var(--surface)" stroke="var(--bdr)" strokeWidth={1}/>
    <circle cx={x+15} cy={cy} r={9} fill={roleColor[n.role]||'var(--text-2)'}/>
    <text x={x+15} y={cy+3.5} textAnchor="middle" fill="white" fontFamily="var(--font-sans)" fontSize={8} fontWeight={700}>{roleInitial[n.role]||n.agent[0]}</text>
    <text x={x+28} y={cy+3.5} fill="var(--text-1)" fontFamily="var(--font-sans)" fontSize={10} fontWeight={500}>@{n.agent}</text>
    <circle cx={x+NW-12} cy={cy} r={3.5} fill={sc} className={n.status==='running'?'dag-pulse':''}/>
  </g>
}

export default function OrchestratorCard({item}:{item:RowItemType}){
  const nodes: DagNode[]=item.orchAgents||[]
  if (!nodes.length) return null

  const layers = buildLayers(nodes)
  const nLayers = layers.length

  // Compute SVG dimensions
  const colW = NW + CG  // width per column step (node + gap)
  const sw = nLayers * NW + (nLayers - 1) * CG + P * 2
  const maxColRows = Math.max(...layers.map(l=>l.length), 1)
  const colH = (r:number)=>r*NH+(r-1)*RG
  const sh = colH(maxColRows) + P * 2

  // Y-position for a row within a column of height colH(rows)
  const gy = (i:number, rows:number)=>P+(colH(maxColRows)-colH(rows))/2+i*(NH+RG)

  // Build a lookup: node id → {layer index, row index}
  const pos = new Map<string,{li:number;ri:number}>()
  layers.forEach((layer,li)=>{layer.forEach((n,ri)=>{pos.set(n.id,{li,ri})})})

  return <div className="row-item route standalone open">
    <div className="row-hd">
      <IconGitBranch className="row-icon" size={16}/>
      <span className="row-label">{item.label}</span>
    </div>
    <div className="row-bd orch-body">
      {item.content&&<div className="orch-plan-text">{item.content}</div>}
      <svg viewBox={`0 0 ${sw} ${sh}`} className="orch-dag">
        <defs>
          <marker id="ah" viewBox="0 0 10 7" refX={9} refY={3.5} markerWidth={5} markerHeight={4} orient="auto-start-reverse">
            <polygon points="0 0, 10 3.5, 0 7" fill="var(--bdr-strong)"/>
          </marker>
        </defs>
        {/* Edges — from each node to dependents in next layer */}
        {nodes.map(src=>{
          const sp=pos.get(src.id); if(!sp)return null
          return (src.dependsOn||[]).map(depId=>{
            const dp=pos.get(depId); if(!dp)return null
            const x1=P+dp.li*colW+NW
            const y1=gy(dp.ri,layers[dp.li]!.length)+NH/2
            const x2=P+sp.li*colW
            const y2=gy(sp.ri,layers[sp.li]!.length)+NH/2
            const mx=(x1+x2)/2
            return <path key={`${depId}-${src.id}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="var(--bdr-strong)" strokeWidth={1.2} markerEnd="url(#ah)"/>
          })
        })}
        {/* Nodes */}
        {layers.map((layer,li)=>layer.map((n,ri)=>
          <NodeEl key={n.id} n={n} x={P+li*colW} y={gy(ri,layer.length)}/>
        ))}
      </svg>
      {item.orchNote&&<div className="orch-note">{item.orchNote}</div>}
    </div>
  </div>
}
