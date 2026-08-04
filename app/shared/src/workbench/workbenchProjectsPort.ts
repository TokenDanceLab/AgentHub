import type { ProjectDraft, ProjectInfo } from './pages';

/**
 * One page of workspace projects returned by the projects port.
 * `nextCursor` is an opaque continuation token: pass it back as
 * `pageCursor` in the next `listProjects` call to fetch the following page.
 */
export interface WorkbenchProjectsPage {
  items: ProjectInfo[];
  nextCursor?: string | undefined;
  /** Whether more pages are available after this one. */
  hasMore: boolean;
}

/**
 * Narrow domain port for workspace project data (#1546).
 *
 * The shared Workbench consumes only this port — it never sees a concrete
 * hub transport client. Web/Desktop composition roots implement the port
 * around their own transport and inject it via `projectsPort`;
 * demo/fixture shells can inject an in-memory implementation without knowing
 * anything about the Hub API.
 *
 * The port speaks workbench domain types (`ProjectInfo` / `ProjectDraft`);
 * transport DTO mapping and default-name normalization live in the app layer.
 */
export interface WorkbenchProjectsPort {
  /** First page (or next page when `pageCursor` is given). */
  listProjects(params?: { pageSize?: number; pageCursor?: string }): Promise<WorkbenchProjectsPage>;
  createProject(draft: ProjectDraft): Promise<ProjectInfo>;
  updateProject(projectId: string, draft: ProjectDraft): Promise<ProjectInfo>;
}
