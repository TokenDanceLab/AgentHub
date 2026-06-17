/* ═══════════════════════════════════════════════════════════════════════
   SHARED ROLE CONFIG — single source of truth for agent role display
   Used by: OrchestratorCard.tsx, AgentGroup.tsx
   AgentRole is string-based so consumers define their own set.
   ══════════════════════════════════════════════════════════════════════ */

/** Agent role: any string. Every consumer can define its own mapping. */
export type AgentRole = string

/** Role display helpers — consumer-provided.
 *  If a role is not in these maps, the component falls back to the first
 *  letter of the role string. */
export const roleColor: Record<string, string> = {
  builder: 'var(--role-builder)',
  reviewer: 'var(--role-reviewer)',
  deployer: 'var(--role-deployer)',
  researcher: 'var(--role-researcher)',
  orch: 'var(--role-orch)',
  shield: 'var(--warning)',
}

export const roleInitial: Record<string, string> = {
  builder: 'B',
  reviewer: 'R',
  deployer: 'D',
  researcher: 'Rs',
  orch: 'O',
  shield: 'S',
}
