import { memo } from 'react'
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

const base = ({ size, ...rest }: IconProps) => ({
  width: size ?? 16,
  height: size ?? 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...rest,
})

export const IconBrain = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /><path d="M17.599 6.5a3 3 0 0 0 .399-1.375" /><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" /><path d="M3.477 10.896a4 4 0 0 1 .585-.396" /><path d="M19.938 10.5a4 4 0 0 1 .585.396" /><path d="M6 18a4 4 0 0 1-1.967-.516" /><path d="M19.967 17.484A4 4 0 0 1 18 18" /></svg>
))
IconBrain.displayName = 'IconBrain'

export const IconFileText = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></svg>
))
IconFileText.displayName = 'IconFileText'

export const IconSearch = memo((p: IconProps) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
))
IconSearch.displayName = 'IconSearch'

export const IconFile = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
))
IconFile.displayName = 'IconFile'

export const IconEdit = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854Z" /></svg>
))
IconEdit.displayName = 'IconEdit'

export const IconShield = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></svg>
))
IconShield.displayName = 'IconShield'

export const IconArrowForward = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
))
IconArrowForward.displayName = 'IconArrowForward'

export const IconSubtask = memo((p: IconProps) => (
  <svg {...base(p)}><rect width="8" height="8" x="3" y="3" rx="2" /><path d="M7 11v2a2 2 0 0 0 2 2h10" /><rect width="8" height="8" x="13" y="13" rx="2" /></svg>
))
IconSubtask.displayName = 'IconSubtask'

export const IconPlayerPlay = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M5 3l14 9-14 9V3z" /></svg>
))
IconPlayerPlay.displayName = 'IconPlayerPlay'

export const IconChevronDown = memo((p: IconProps) => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
))
IconChevronDown.displayName = 'IconChevronDown'

export const IconTarget = memo((p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
))
IconTarget.displayName = 'IconTarget'

export const IconUpload = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
))
IconUpload.displayName = 'IconUpload'

export const IconChart = memo((p: IconProps) => (
  <svg {...base(p)}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
))
IconChart.displayName = 'IconChart'

export const IconDatabase = memo((p: IconProps) => (
  <svg {...base(p)}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
))
IconDatabase.displayName = 'IconDatabase'

export const IconBraces = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>
))
IconBraces.displayName = 'IconBraces'

export const IconMarkdown = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5l6.74-6.76z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>
))
IconMarkdown.displayName = 'IconMarkdown'

export const IconCss = memo((p: IconProps) => (
  <svg {...base(p)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/><path d="M7 12h10M7 16h6"/></svg>
))
IconCss.displayName = 'IconCss'

export const IconTerminal = memo((p: IconProps) => (
  <svg {...base(p)}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 8 2 2-2 2"/><path d="m12 14h6"/></svg>
))
IconTerminal.displayName = 'IconTerminal'

export const IconGitBranch = memo((p: IconProps) => (
  <svg {...base(p)}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="6" cy="3" r="2"/><circle cx="6" cy="15" r="2"/><path d="M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M18 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/><line x1="8" y1="9" x2="16" y2="9"/></svg>
))
IconGitBranch.displayName = 'IconGitBranch'
