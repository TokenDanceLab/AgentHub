// 历史 barrel（#1820）：StatusBadge 已迁入 shared/ui SSOT 位置。
// 保留本 barrel 以维持 '@agenthub/shared/components' 导出面不回档；新组件一律入 shared/ui。
export { StatusBadge, getStatusVariantClassName } from '../ui/StatusBadge';
export type { StatusBadgeProps, StatusVariant } from '../ui/StatusBadge';
