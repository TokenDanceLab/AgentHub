/**
 * Shared pure helpers for chatview demo transcript fixtures.
 * Peel companion of chatviewFixtures (#1132). Pure only; zero behavior change.
 */

export const T = (offsetMin: number) => {
  const d = new Date('2026-06-17T14:30:00+08:00')
  d.setMinutes(d.getMinutes() + offsetMin)
  return d.toISOString()
}

export const B = (id: string, name = 'Builder') => ({ id, name, role: 'agent' as const })
export const U = (id: string, name = 'Alice') => ({ id, name, role: 'human' as const })
