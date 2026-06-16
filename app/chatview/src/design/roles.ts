/* ═══════════════════════════════════════════════════════════════════════
   SHARED ROLE CONFIG — single source of truth for agent role display
   Used by: OrchestratorCard.tsx, AgentGroup.tsx
   ══════════════════════════════════════════════════════════════════════ */

export type AgentRole = 'builder' | 'reviewer' | 'deployer' | 'researcher' | 'orch' | 'shield'

/** CSS custom property for role avatar background */
export const roleColor: Record<AgentRole, string> = {
  builder: 'var(--role-builder)',
  reviewer: 'var(--role-reviewer)',
  deployer: 'var(--role-deployer)',
  researcher: 'var(--role-researcher)',
  orch: 'var(--role-orch)',
  shield: 'var(--warning)',
}

/** Single-letter initial for role avatar */
export const roleInitial: Record<AgentRole, string> = {
  builder: 'B', reviewer: 'R', deployer: 'D',
  researcher: 'Rs', orch: 'O', shield: 'S',
}
