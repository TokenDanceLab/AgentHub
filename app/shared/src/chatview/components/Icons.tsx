// Chatview card icons — single source of truth: lucide-react.
//
// These re-exports keep the historic Icon* export names stable for consumers
// (RowItem / AgentGroup / OrchestratorCard) while removing the duplicated
// hand-written SVG set that previously mirrored lucide paths.
export { Search as IconSearch } from 'lucide-react'
export { Pencil as IconEdit } from 'lucide-react'
export { FileText as IconFileText } from 'lucide-react'
export { File as IconFile } from 'lucide-react'
export { Shield as IconShield } from 'lucide-react'
// lucide-react 1.16.0 has no ArrowForward; ArrowRight is the direct equivalent.
export { ArrowRight as IconArrowForward } from 'lucide-react'
// lucide-react has no Subtask icon; ListTree (nested list tree) is the closest semantic match.
export { ListTree as IconSubtask } from 'lucide-react'
export { Play as IconPlayerPlay } from 'lucide-react'
export { ChevronDown as IconChevronDown } from 'lucide-react'
export { Target as IconTarget } from 'lucide-react'
export { Upload as IconUpload } from 'lucide-react'
export { BarChart3 as IconChart } from 'lucide-react'
export { Database as IconDatabase } from 'lucide-react'
export { Braces as IconBraces } from 'lucide-react'
// lucide-react 1.16.0 has no Markdown icon; FileType (file with type glyph) is the closest for .md file-type indicators.
export { FileType as IconMarkdown } from 'lucide-react'
// lucide-react has no CSS icon; FileCode2 (file with code glyph) is the closest for .css file-type indicators.
export { FileCode2 as IconCss } from 'lucide-react'
export { Terminal as IconTerminal } from 'lucide-react'
export { GitBranch as IconGitBranch } from 'lucide-react'
export { Brain as IconBrain } from 'lucide-react'
export { Globe as IconGlobe } from 'lucide-react'
// Checkpoint timeline card (#1968): snapshot-in-time semantics.
export { History as IconHistory } from 'lucide-react'
// Media attachment row icons (#1939) — mirror the #1938 kind-driven icon routing.
export { Music as IconMusic } from 'lucide-react'
export { Video as IconVideo } from 'lucide-react'
