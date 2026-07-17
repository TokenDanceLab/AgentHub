/* ═══════════════════════════════════════════════════════════════════════
   Projects detail / chrome subviews — public re-export shell.

   Phase 17 strangler slice #562 originally lived here.
   Residual chrome/panels extracted for Phase 22 #618 into:
     - ProjectChromeViews.tsx (nav row, filters, tabs, editor)
     - ProjectPanelViews.tsx  (ProjectDetail shell)
   Residual thin (Phase 23 #626) further splits panels/tabs:
     - ProjectPanelParts.tsx  (presentational panels)
     - ProjectTabViews.tsx    (tab bodies)
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export {
  ProjectNavRow,
  FilterList,
  ProjectTabs,
  ProjectEditor,
} from './ProjectChromeViews';

export { ProjectDetail } from './ProjectPanelViews';
