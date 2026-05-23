const pageHtml = String.raw`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AgentHub Project Workspace</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #eef6ff;
        --bg-2: #f8fbff;
        --text: #172033;
        --muted: #667085;
        --line: rgba(255, 255, 255, 0.7);
        --panel: rgba(255, 255, 255, 0.72);
        --blue: #2563eb;
        --cyan: #0891b2;
        --purple: #7c3aed;
        --green: #059669;
        --amber: #d97706;
        --red: #dc2626;
        --shadow: 0 18px 48px rgba(26, 40, 80, 0.14);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        background:
          radial-gradient(circle at 12% 18%, rgba(37, 99, 235, 0.18), transparent 30%),
          radial-gradient(circle at 86% 4%, rgba(8, 145, 178, 0.15), transparent 28%),
          linear-gradient(135deg, var(--bg) 0%, var(--bg-2) 100%);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }

      button,
      input {
        font: inherit;
      }

      button {
        border: 0;
        cursor: pointer;
      }

      .workspace {
        position: relative;
        min-height: 100vh;
        overflow: hidden;
      }

      #antigravity-canvas {
        position: fixed;
        inset: 0;
        z-index: 0;
        pointer-events: none;
      }

      .shell {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 260px minmax(0, 1fr);
        min-height: 100vh;
        padding: 18px;
        gap: 18px;
      }

      .glass {
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.7);
        border-radius: 12px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(28px) saturate(160%);
        -webkit-backdrop-filter: blur(28px) saturate(160%);
      }

      .sidebar {
        display: flex;
        flex-direction: column;
        min-height: calc(100vh - 36px);
        padding: 18px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        padding-bottom: 18px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      }

      .brand-mark {
        display: grid;
        width: 42px;
        height: 42px;
        place-items: center;
        border-radius: 12px;
        color: white;
        font-weight: 800;
        background: linear-gradient(135deg, var(--blue), var(--cyan));
        box-shadow: 0 12px 28px rgba(37, 99, 235, 0.25);
      }

      .brand-title {
        margin: 0;
        font-size: 18px;
        line-height: 1.2;
      }

      .brand-subtitle {
        margin: 2px 0 0;
        color: var(--muted);
        font-size: 12px;
      }

      .nav {
        display: grid;
        gap: 8px;
        margin: 22px 0;
      }

      .nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 11px 12px;
        color: #334155;
        border-radius: 8px;
        text-decoration: none;
      }

      .nav-item.active {
        color: var(--blue);
        background: rgba(37, 99, 235, 0.1);
        box-shadow: inset 3px 0 0 var(--blue);
      }

      .nav-icon,
      .button-icon,
      .metric-icon {
        display: inline-grid;
        place-items: center;
        width: 22px;
        height: 22px;
        flex: 0 0 auto;
      }

      .sidebar-note {
        margin-top: auto;
        padding: 14px;
        background: rgba(37, 99, 235, 0.08);
        border: 1px solid rgba(37, 99, 235, 0.12);
        border-radius: 12px;
      }

      .sidebar-note strong {
        display: block;
        margin-bottom: 6px;
        font-size: 13px;
      }

      .sidebar-note span {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }

      .main {
        min-width: 0;
        max-height: calc(100vh - 36px);
        overflow: auto;
        padding-right: 2px;
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 4;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 18px;
        margin-bottom: 18px;
      }

      .search {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: min(420px, 100%);
        padding: 10px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.58);
        border: 1px solid rgba(148, 163, 184, 0.22);
      }

      .search input {
        width: 100%;
        min-width: 0;
        border: 0;
        outline: 0;
        color: var(--text);
        background: transparent;
      }

      .top-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .icon-button {
        display: inline-grid;
        width: 38px;
        height: 38px;
        place-items: center;
        border-radius: 8px;
        color: #334155;
        background: rgba(255, 255, 255, 0.58);
        border: 1px solid rgba(148, 163, 184, 0.22);
      }

      .avatar {
        display: grid;
        width: 38px;
        height: 38px;
        place-items: center;
        border-radius: 50%;
        color: white;
        font-size: 13px;
        font-weight: 800;
        background: linear-gradient(135deg, var(--purple), var(--blue));
      }

      .content {
        display: grid;
        gap: 18px;
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 300px;
        gap: 18px;
        padding: 22px;
      }

      .eyebrow {
        margin: 0 0 8px;
        color: var(--cyan);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1,
      h2,
      h3,
      p {
        margin-top: 0;
      }

      h1 {
        max-width: 720px;
        margin-bottom: 8px;
        font-size: 34px;
        line-height: 1.12;
        letter-spacing: 0;
      }

      .hero-copy {
        max-width: 700px;
        margin-bottom: 18px;
        color: var(--muted);
        line-height: 1.55;
      }

      .button-row,
      .tabs,
      .card-header,
      .project-row,
      .status-row {
        display: flex;
        align-items: center;
      }

      .button-row {
        flex-wrap: wrap;
        gap: 10px;
      }

      .primary-button,
      .secondary-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 38px;
        padding: 10px 14px;
        border-radius: 8px;
        font-weight: 700;
      }

      .primary-button {
        color: white;
        background: linear-gradient(135deg, var(--blue), var(--cyan));
        box-shadow: 0 12px 28px rgba(37, 99, 235, 0.24);
      }

      .secondary-button {
        color: #1f3a63;
        background: rgba(255, 255, 255, 0.64);
        border: 1px solid rgba(148, 163, 184, 0.25);
      }

      .hero-side {
        display: grid;
        gap: 12px;
      }

      .progress-card {
        padding: 14px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.52);
        border: 1px solid rgba(255, 255, 255, 0.62);
      }

      .status-row {
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }

      .status-row strong {
        font-size: 20px;
      }

      .meter {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.08);
      }

      .meter span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--blue), var(--cyan));
      }

      .metric-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 18px;
      }

      .metric {
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        padding: 16px;
      }

      .metric-icon {
        width: 42px;
        height: 42px;
        border-radius: 12px;
        color: var(--blue);
        background: rgba(37, 99, 235, 0.1);
      }

      .metric strong {
        display: block;
        font-size: 22px;
        line-height: 1.1;
      }

      .metric span {
        color: var(--muted);
        font-size: 12px;
      }

      .layout-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.85fr);
        gap: 18px;
      }

      .card {
        padding: 18px;
      }

      .card-header {
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }

      .card-header h2,
      .card-header h3 {
        margin: 0;
        font-size: 18px;
      }

      .tabs {
        gap: 6px;
        padding: 4px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.06);
      }

      .tab {
        padding: 8px 10px;
        color: var(--muted);
        border-radius: 8px;
        background: transparent;
        font-weight: 700;
      }

      .tab.active {
        color: var(--blue);
        background: rgba(255, 255, 255, 0.72);
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
      }

      .project-list,
      .task-list,
      .file-list,
      .run-list,
      .milestone-list,
      .risk-list {
        display: grid;
        gap: 10px;
      }

      .project-row,
      .task-row,
      .file-row,
      .run-row,
      .milestone-row,
      .risk-row {
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.62);
      }

      .project-row {
        justify-content: space-between;
        gap: 14px;
        padding: 14px;
      }

      .project-title {
        display: flex;
        gap: 12px;
        align-items: center;
        min-width: 0;
      }

      .project-badge {
        display: grid;
        width: 38px;
        height: 38px;
        place-items: center;
        flex: 0 0 auto;
        color: white;
        border-radius: 12px;
        background: linear-gradient(135deg, var(--blue), var(--purple));
      }

      .project-title strong,
      .task-row strong,
      .file-row strong,
      .run-row strong {
        display: block;
        margin-bottom: 4px;
      }

      .project-title span,
      .task-row span,
      .file-row span,
      .run-row span,
      .milestone-row span,
      .risk-row span {
        color: var(--muted);
        font-size: 12px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 26px;
        padding: 5px 9px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 800;
      }

      .pill.blue {
        color: var(--blue);
        background: rgba(37, 99, 235, 0.1);
      }

      .pill.cyan {
        color: var(--cyan);
        background: rgba(8, 145, 178, 0.1);
      }

      .pill.purple {
        color: var(--purple);
        background: rgba(124, 58, 237, 0.1);
      }

      .pill.green {
        color: var(--green);
        background: rgba(5, 150, 105, 0.1);
      }

      .pill.amber {
        color: var(--amber);
        background: rgba(217, 119, 6, 0.12);
      }

      .task-row,
      .file-row,
      .run-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        padding: 12px;
      }

      .check,
      .file-icon,
      .run-icon {
        display: grid;
        width: 34px;
        height: 34px;
        place-items: center;
        border-radius: 10px;
        background: rgba(37, 99, 235, 0.1);
        color: var(--blue);
      }

      .task-row.done .check {
        color: var(--green);
        background: rgba(5, 150, 105, 0.1);
      }

      .milestone-row {
        display: grid;
        grid-template-columns: 14px minmax(0, 1fr) auto;
        gap: 12px;
        align-items: start;
        padding: 12px;
      }

      .dot {
        width: 10px;
        height: 10px;
        margin-top: 5px;
        border-radius: 50%;
        background: var(--blue);
        box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.1);
      }

      .dot.cyan {
        background: var(--cyan);
        box-shadow: 0 0 0 5px rgba(8, 145, 178, 0.1);
      }

      .dot.purple {
        background: var(--purple);
        box-shadow: 0 0 0 5px rgba(124, 58, 237, 0.1);
      }

      .side-stack {
        display: grid;
        gap: 18px;
      }

      .risk-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        padding: 12px;
        border-color: rgba(217, 119, 6, 0.18);
      }

      .panel {
        display: none;
      }

      .panel.active {
        display: block;
      }

      .empty-state {
        display: none;
        margin-top: 12px;
        padding: 12px;
        color: var(--blue);
        background: rgba(37, 99, 235, 0.08);
        border: 1px solid rgba(37, 99, 235, 0.16);
        border-radius: 12px;
      }

      .empty-state.visible {
        display: block;
      }

      @media (max-width: 1040px) {
        .shell {
          grid-template-columns: 1fr;
        }

        .sidebar {
          min-height: auto;
        }

        .nav {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .hero,
        .layout-grid {
          grid-template-columns: 1fr;
        }

        .metric-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 720px) {
        body {
          overflow: auto;
        }

        .shell {
          padding: 12px;
        }

        .main {
          max-height: none;
          overflow: visible;
        }

        .topbar,
        .project-row,
        .card-header {
          align-items: stretch;
          flex-direction: column;
        }

        .search {
          min-width: 0;
        }

        .metric-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="workspace">
      <canvas id="antigravity-canvas" aria-hidden="true"></canvas>
      <div class="shell">
        <aside class="sidebar glass" aria-label="Project navigation">
          <div class="brand">
            <div class="brand-mark">AH</div>
            <div>
              <h1 class="brand-title">AgentHub</h1>
              <p class="brand-subtitle">Project workspace</p>
            </div>
          </div>

          <nav class="nav">
            <a class="nav-item active" href="#"><span class="nav-icon">▦</span>Overview</a>
            <a class="nav-item" href="#"><span class="nav-icon">✓</span>Tasks</a>
            <a class="nav-item" href="#"><span class="nav-icon">◇</span>Milestones</a>
            <a class="nav-item" href="#"><span class="nav-icon">□</span>Files</a>
          </nav>

          <div class="sidebar-note">
            <strong>Project signal</strong>
            <span>Edge relay, preview review, and approval copy are staged for design validation only.</span>
          </div>
        </aside>

        <main class="main">
          <header class="topbar glass">
            <label class="search">
              <span>⌕</span>
              <input aria-label="Search projects" placeholder="Search projects, tasks, files..." />
            </label>
            <div class="top-actions">
              <button class="icon-button" type="button" aria-label="Notifications">○</button>
              <button class="icon-button" type="button" aria-label="Settings">⚙</button>
              <div class="avatar" aria-label="Current user">PM</div>
            </div>
          </header>

          <div class="content">
            <section class="hero glass">
              <div>
                <p class="eyebrow">Project detail</p>
                <h1>Workspace Preview Foundation</h1>
                <p class="hero-copy">
                  Coordinate frontend preview pages, project milestones, task readiness, design files, and dry-run records before real API integration.
                </p>
                <div class="button-row">
                  <button class="primary-button" id="sync-button" type="button">
                    <span class="button-icon">↻</span>Simulate sync
                  </button>
                  <button class="secondary-button" id="risk-button" type="button">
                    <span class="button-icon">!</span>Mark risk reviewed
                  </button>
                </div>
                <div class="empty-state" id="sync-state">Sync queued locally. No remote API was called.</div>
              </div>

              <div class="hero-side">
                <div class="progress-card">
                  <div class="status-row">
                    <span>Delivery progress</span>
                    <strong>68%</strong>
                  </div>
                  <div class="meter" aria-label="Delivery progress 68 percent"><span style="width: 68%"></span></div>
                </div>
                <div class="progress-card">
                  <div class="status-row">
                    <span>Open risks</span>
                    <strong id="risk-count">3</strong>
                  </div>
                  <div class="meter" aria-label="Risk review progress 42 percent"><span style="width: 42%; background: linear-gradient(90deg, var(--purple), var(--blue))"></span></div>
                </div>
              </div>
            </section>

            <section class="metric-grid">
              <article class="metric glass">
                <span class="metric-icon">▣</span>
                <div><strong>12</strong><span>Active tasks</span></div>
              </article>
              <article class="metric glass">
                <span class="metric-icon">◌</span>
                <div><strong>4</strong><span>Milestones</span></div>
              </article>
              <article class="metric glass">
                <span class="metric-icon">□</span>
                <div><strong>18</strong><span>Shared files</span></div>
              </article>
              <article class="metric glass">
                <span class="metric-icon">▶</span>
                <div><strong>7</strong><span>Dry runs</span></div>
              </article>
            </section>

            <div class="layout-grid">
              <section class="card glass">
                <div class="card-header">
                  <h2>Project board</h2>
                  <div class="tabs" role="tablist" aria-label="Project board sections">
                    <button class="tab active" data-panel="overview" type="button">Overview</button>
                    <button class="tab" data-panel="tasks" type="button">Tasks</button>
                    <button class="tab" data-panel="files" type="button">Files</button>
                  </div>
                </div>

                <div class="panel active" id="overview">
                  <div class="project-list">
                    <div class="project-row">
                      <div class="project-title">
                        <span class="project-badge">FP</span>
                        <div>
                          <strong>Frontend page preview</strong>
                          <span>Page coordination, visual QA, and route-level polish.</span>
                        </div>
                      </div>
                      <span class="pill blue">In progress</span>
                    </div>
                    <div class="project-row">
                      <div class="project-title">
                        <span class="project-badge" style="background: linear-gradient(135deg, var(--cyan), var(--blue))">IM</span>
                        <div>
                          <strong>Group workspace shell</strong>
                          <span>Shared panels, message rhythm, and preview entry points.</span>
                        </div>
                      </div>
                      <span class="pill cyan">Review</span>
                    </div>
                    <div class="project-row">
                      <div class="project-title">
                        <span class="project-badge" style="background: linear-gradient(135deg, var(--purple), var(--blue))">ED</span>
                        <div>
                          <strong>Edge dry-run console</strong>
                          <span>Local-only runner states and command transcript framing.</span>
                        </div>
                      </div>
                      <span class="pill purple">Queued</span>
                    </div>
                  </div>
                </div>

                <div class="panel" id="tasks">
                  <div class="task-list">
                    <div class="task-row done">
                      <span class="check">✓</span>
                      <div><strong>Align glass card tokens</strong><span>Blur, border, radius, and shadow applied consistently.</span></div>
                      <span class="pill green">Done</span>
                    </div>
                    <div class="task-row">
                      <span class="check">•</span>
                      <div><strong>Build project detail copy</strong><span>Overview, milestone, file, and run copy are present.</span></div>
                      <span class="pill blue">Active</span>
                    </div>
                    <div class="task-row">
                      <span class="check">•</span>
                      <div><strong>Prepare React landing copy</strong><span>No API dependency; visible state transitions only.</span></div>
                      <span class="pill amber">Next</span>
                    </div>
                  </div>
                </div>

                <div class="panel" id="files">
                  <div class="file-list">
                    <div class="file-row">
                      <span class="file-icon">TS</span>
                      <div><strong>ProjectPage.tsx</strong><span>Iframe shell preview and antigravity background.</span></div>
                      <span class="pill blue">Edited</span>
                    </div>
                    <div class="file-row">
                      <span class="file-icon">RX</span>
                      <div><strong>ProjectPageReact.tsx</strong><span>React landing copy for later integration.</span></div>
                      <span class="pill purple">New</span>
                    </div>
                    <div class="file-row">
                      <span class="file-icon">MD</span>
                      <div><strong>acceptance-notes.md</strong><span>Suggested validation notes for the frontend track.</span></div>
                      <span class="pill cyan">Draft</span>
                    </div>
                  </div>
                </div>
              </section>

              <div class="side-stack">
                <section class="card glass">
                  <div class="card-header">
                    <h3>Milestones</h3>
                    <span class="pill blue">M1</span>
                  </div>
                  <div class="milestone-list">
                    <div class="milestone-row">
                      <span class="dot"></span>
                      <div><strong>Preview shell locked</strong><span>Route preview and project page layout stabilized.</span></div>
                      <span class="pill green">Done</span>
                    </div>
                    <div class="milestone-row">
                      <span class="dot cyan"></span>
                      <div><strong>Stateful React copy</strong><span>Tab, panel, risk, and sync states are visible.</span></div>
                      <span class="pill blue">Active</span>
                    </div>
                    <div class="milestone-row">
                      <span class="dot purple"></span>
                      <div><strong>Real API pass</strong><span>Deferred until contract and backend mocks settle.</span></div>
                      <span class="pill purple">Later</span>
                    </div>
                  </div>
                </section>

                <section class="card glass">
                  <div class="card-header">
                    <h3>Run records</h3>
                    <span class="pill cyan">Local</span>
                  </div>
                  <div class="run-list">
                    <div class="run-row">
                      <span class="run-icon">▶</span>
                      <div><strong>visual-preview-042</strong><span>Layout scan completed in local preview mode.</span></div>
                      <span class="pill green">Pass</span>
                    </div>
                    <div class="run-row">
                      <span class="run-icon">↻</span>
                      <div><strong>typecheck-next</strong><span>Recommended command: corepack.cmd pnpm typecheck.</span></div>
                      <span class="pill amber">Ready</span>
                    </div>
                  </div>
                </section>

                <section class="card glass">
                  <div class="card-header">
                    <h3>Risks</h3>
                    <span class="pill amber" id="risk-label">Needs review</span>
                  </div>
                  <div class="risk-list">
                    <div class="risk-row">
                      <div><strong>No live API yet</strong><span>All data is static and safe for design validation.</span></div>
                      <span class="pill amber">Open</span>
                    </div>
                    <div class="risk-row">
                      <div><strong>Parallel page edits</strong><span>Scope is limited to the project page directory.</span></div>
                      <span class="pill blue">Tracked</span>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>

    <script>
      const tabs = Array.from(document.querySelectorAll(".tab"));
      const panels = Array.from(document.querySelectorAll(".panel"));
      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          const target = tab.getAttribute("data-panel");
          tabs.forEach((item) => item.classList.toggle("active", item === tab));
          panels.forEach((panel) => panel.classList.toggle("active", panel.id === target));
        });
      });

      const syncButton = document.getElementById("sync-button");
      const syncState = document.getElementById("sync-state");
      syncButton.addEventListener("click", () => {
        syncState.classList.add("visible");
        syncButton.innerHTML = '<span class="button-icon">✓</span>Sync simulated';
      });

      const riskButton = document.getElementById("risk-button");
      const riskCount = document.getElementById("risk-count");
      const riskLabel = document.getElementById("risk-label");
      riskButton.addEventListener("click", () => {
        riskCount.textContent = "2";
        riskLabel.textContent = "Reviewed";
        riskLabel.className = "pill green";
        riskButton.innerHTML = '<span class="button-icon">✓</span>Risk reviewed';
      });

      const canvas = document.getElementById("antigravity-canvas");
      const ctx = canvas.getContext("2d");
      const particles = [];
      const particleCount = 56;

      function resizeCanvas() {
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(window.innerWidth * ratio);
        canvas.height = Math.floor(window.innerHeight * ratio);
        canvas.style.width = window.innerWidth + "px";
        canvas.style.height = window.innerHeight + "px";
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      function createParticle() {
        return {
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          vx: (Math.random() - 0.5) * 0.18,
          vy: -0.16 - Math.random() * 0.22,
          radius: 1.2 + Math.random() * 2.2,
          alpha: 0.18 + Math.random() * 0.24,
          hue: Math.random() > 0.45 ? "37, 99, 235" : "8, 145, 178",
        };
      }

      function resetParticles() {
        particles.length = 0;
        for (let index = 0; index < particleCount; index += 1) {
          particles.push(createParticle());
        }
      }

      function draw() {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        for (let index = 0; index < particles.length; index += 1) {
          const particle = particles[index];
          particle.x += particle.vx;
          particle.y += particle.vy;

          if (particle.y < -16) {
            particle.y = window.innerHeight + 16;
            particle.x = Math.random() * window.innerWidth;
          }

          if (particle.x < -16) particle.x = window.innerWidth + 16;
          if (particle.x > window.innerWidth + 16) particle.x = -16;

          ctx.beginPath();
          ctx.fillStyle = "rgba(" + particle.hue + ", " + particle.alpha + ")";
          ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
          ctx.fill();

          for (let inner = index + 1; inner < particles.length; inner += 1) {
            const other = particles[inner];
            const distance = Math.hypot(particle.x - other.x, particle.y - other.y);
            if (distance < 118) {
              ctx.beginPath();
              ctx.strokeStyle = "rgba(37, 99, 235, " + (0.055 * (1 - distance / 118)) + ")";
              ctx.lineWidth = 1;
              ctx.moveTo(particle.x, particle.y);
              ctx.lineTo(other.x, other.y);
              ctx.stroke();
            }
          }
        }

        requestAnimationFrame(draw);
      }

      window.addEventListener("resize", () => {
        resizeCanvas();
        resetParticles();
      });

      resizeCanvas();
      resetParticles();
      draw();
    </script>
  </body>
</html>`;

export function ProjectPage() {
  return (
    <iframe
      title="Project"
      srcDoc={pageHtml}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      style={{ width: "100%", height: "100vh", border: 0, display: "block" }}
    />
  );
}

export default ProjectPage;
