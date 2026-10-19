// Hub exposes no authoritative project lifecycle, so the Projects nav does not
// classify or filter by lifecycle status: Hub-style status labels render as-is
// and no Running/Completed/Archived filter controls are shown.
import { render, screen } from "../../__tests__/setup";
import { describe, expect, it } from "vitest";
import type { ProjectInfo } from "./types";
import { ProjectNav } from "./ProjectNav";

function project(id: string, status: string): ProjectInfo {
  return {
    id,
    name: `Proj ${id}`,
    description: `${id} description`,
    status,
    meta: "Hub",
    members: [],
    announcement: "",
    runs: [],
    artifacts: [],
    feed: [],
  };
}

describe("ProjectNav hub-style status without lifecycle filtering", () => {
  it("shows Hub-style projects as rows and renders no Running/Completed/Archived filter controls", () => {
    render(
      <ProjectNav
        projects={[project("a", "Hub"), project("b", "Active")]}
        activeProjectId={null}
        onProjectSelect={() => undefined}
        canCreateProject={false}
        onStartCreate={() => undefined}
      />,
    );

    expect(screen.getByText("Proj a")).toBeInTheDocument();
    expect(screen.getByText("Hub")).toBeInTheDocument();
    expect(screen.getByText("Proj b")).toBeInTheDocument();

    // No lifecycle filter chips remain in the nav.
    expect(document.querySelectorAll("[data-filter-id]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Running|Completed|Archived/ })).toBeNull();
  });
});
