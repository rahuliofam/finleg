/**
 * Shared UI primitives for intranet `[tab]` sub-views.
 *
 * These extract the patterns that were copy-pasted across 3+ sub-views in
 * the bookkeeping, files, howto, and zeni tab clusters. Keep this surface
 * deliberately small — components go here only when they replace duplicated
 * markup in three or more call sites.
 */
export { TabHeader, type TabHeaderProps } from "./tab-header";
export { TabErrorBanner, type TabErrorBannerProps } from "./tab-error-banner";
export { TabEmptyState, TabNotFound, type TabEmptyStateProps } from "./tab-empty-state";
export { StatCard, type StatCardAccent, type StatCardProps } from "./stat-card";
export {
  FilterPills,
  type FilterPillOption,
  type FilterPillsProps,
  type FilterPillVariant,
} from "./filter-pills";
