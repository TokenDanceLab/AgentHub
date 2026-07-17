/* ═══════════════════════════════════════════════════════════════════════
   Projects detail / chrome subviews — public re-export shell.

   Phase 17 strangler slice #562 originally lived here.
   Residual chrome/panels extracted for Phase 22 #618 into:
     - ProjectChromeViews.tsx (nav row, filters, tabs, editor)
     - ProjectPanelViews.tsx  (detail panels + tab bodies + ProjectDetail)
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export {
  ProjectNavRow,
  FilterList,
  ProjectTabs,
  ProjectEditor,
} from './ProjectChromeViews';

export { ProjectDetail } from './ProjectPanelViews';
