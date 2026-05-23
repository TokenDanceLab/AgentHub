const pageHtml: string = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentHub | Group Workspace</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #edf6ff;
      --bg-2: #f7fbff;
      --ink: #172033;
      --muted: #647084;
      --line: rgba(143, 160, 190, 0.22);
      --blue: #1769e8;
      --cyan: #08a7cf;
      --purple: #7457e8;
      --teal: #0f9f9a;
      --green: #1f9b64;
      --orange: #d97817;
      --glass: rgba(255, 255, 255, 0.72);
      --glass-border: rgba(255, 255, 255, 0.7);
      --shadow: 0 18px 48px rgba(26, 40, 80, 0.14);
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      min-width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      color: var(--ink);
      background:
        radial-gradient(circle at 18% 12%, rgba(8, 167, 207, 0.16), transparent 28%),
        radial-gradient(circle at 82% 8%, rgba(116, 87, 232, 0.14), transparent 30%),
        linear-gradient(135deg, var(--bg-2), var(--bg));
      font-family: "Hanken Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button,
    input,
    textarea {
      font: inherit;
    }

    button {
      cursor: pointer;
    }

    #particle-canvas {
      position: fixed;
      inset: 0;
      z-index: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
    }

    .page {
      position: relative;
      z-index: 1;
      height: 100vh;
      padding: 22px;
    }

    .workspace {
      display: grid;
      grid-template-columns: 248px minmax(0, 1fr) 340px;
      gap: 18px;
      max-width: 1440px;
      height: calc(100vh - 44px);
      margin: 0 auto;
    }

    .glass {
      background: var(--glass);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(28px) saturate(160%);
      -webkit-backdrop-filter: blur(28px) saturate(160%);
    }

    .panel {
      min-height: 0;
      overflow: hidden;
    }

    .sidebar,
    .rightbar,
    .main {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .sidebar,
    .rightbar {
      padding: 18px;
      gap: 16px;
    }

    .main {
      gap: 16px;
      overflow: hidden;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 18px 20px;
      min-height: 96px;
    }

    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .eyebrow {
      margin: 0 0 4px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    h1,
    h2,
    h3,
    p {
      margin: 0;
    }

    h1 {
      font-size: 24px;
      line-height: 1.15;
      letter-spacing: 0;
    }

    h2 {
      font-size: 15px;
      line-height: 1.25;
    }

    h3 {
      font-size: 13px;
      line-height: 1.25;
    }

    .muted {
      color: var(--muted);
    }

    .tiny {
      font-size: 11px;
      line-height: 1.35;
    }

    .small {
      font-size: 12px;
      line-height: 1.45;
    }

    .material-symbols-outlined {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      overflow: hidden;
      font-size: 18px;
      line-height: 1;
      vertical-align: middle;
      font-variation-settings: "FILL" 0, "wght" 500, "GRAD" 0, "opsz" 24;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line);
    }

    .brand-mark,
    .icon-tile,
    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
    }

    .brand-mark {
      width: 38px;
      height: 38px;
      color: #fff;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      box-shadow: 0 10px 22px rgba(23, 105, 232, 0.24);
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 24px;
      padding: 5px 9px;
      border: 1px solid rgba(23, 105, 232, 0.13);
      border-radius: 999px;
      background: rgba(23, 105, 232, 0.08);
      color: #1459c7;
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
    }

    .pill.cyan {
      border-color: rgba(8, 167, 207, 0.18);
      background: rgba(8, 167, 207, 0.1);
      color: #087f9e;
    }

    .pill.purple {
      border-color: rgba(116, 87, 232, 0.18);
      background: rgba(116, 87, 232, 0.1);
      color: #6044d7;
    }

    .pill.green {
      border-color: rgba(31, 155, 100, 0.2);
      background: rgba(31, 155, 100, 0.11);
      color: #15744b;
    }

    .nav-list,
    .member-list,
    .file-list,
    .activity-list,
    .check-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }

    .nav-item,
    .member-row,
    .file-row,
    .activity-row,
    .check-row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: 10px;
      border: 1px solid transparent;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.44);
    }

    .nav-item.active {
      border-color: rgba(23, 105, 232, 0.2);
      background: rgba(23, 105, 232, 0.1);
      color: #1459c7;
    }

    .icon-tile {
      width: 32px;
      height: 32px;
      color: var(--blue);
      border-radius: 9px;
      background: rgba(23, 105, 232, 0.1);
    }

    .icon-tile.cyan {
      color: #087f9e;
      background: rgba(8, 167, 207, 0.11);
    }

    .icon-tile.purple {
      color: #6044d7;
      background: rgba(116, 87, 232, 0.11);
    }

    .icon-tile.green {
      color: #15744b;
      background: rgba(31, 155, 100, 0.11);
    }

    .avatar {
      position: relative;
      width: 34px;
      height: 34px;
      color: #fff;
      border: 2px solid rgba(255, 255, 255, 0.82);
      border-radius: 50%;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      font-size: 12px;
      font-weight: 800;
      box-shadow: 0 8px 20px rgba(23, 105, 232, 0.16);
    }

    .avatar.purple {
      background: linear-gradient(135deg, var(--purple), #a06bff);
    }

    .avatar.teal {
      background: linear-gradient(135deg, var(--teal), var(--cyan));
    }

    .avatar.blue {
      background: linear-gradient(135deg, #2857e8, #46b8ff);
    }

    .avatar::after {
      content: "";
      position: absolute;
      right: -1px;
      bottom: 0;
      width: 9px;
      height: 9px;
      border: 2px solid #fff;
      border-radius: 50%;
      background: #25c06d;
    }

    .avatar.away::after {
      background: #d99a24;
    }

    .truncate {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .spacer {
      flex: 1 1 auto;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 36px;
      padding: 9px 12px;
      border: 1px solid rgba(23, 105, 232, 0.14);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.62);
      color: var(--ink);
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
      box-shadow: 0 8px 18px rgba(26, 40, 80, 0.08);
    }

    .button.primary {
      border-color: transparent;
      color: #fff;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      box-shadow: 0 10px 22px rgba(23, 105, 232, 0.23);
    }

    .button.ghost {
      box-shadow: none;
    }

    .button-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .search {
      display: flex;
      align-items: center;
      gap: 8px;
      width: min(320px, 100%);
      padding: 9px 11px;
      border: 1px solid rgba(255, 255, 255, 0.68);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.58);
      color: var(--muted);
    }

    .search input {
      width: 100%;
      min-width: 0;
      padding: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ink);
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(92px, 1fr));
      gap: 10px;
    }

    .stat {
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.5);
    }

    .stat strong {
      display: block;
      margin-bottom: 4px;
      font-size: 20px;
      line-height: 1;
    }

    .content-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(290px, 0.75fr);
      gap: 16px;
      min-height: 0;
      overflow: hidden;
    }

    .column,
    .feed {
      min-height: 0;
      overflow: hidden;
      padding: 16px;
    }

    .board {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      height: calc(100% - 34px);
      min-height: 0;
    }

    .lane {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
      min-height: 0;
      padding: 12px;
      border: 1px solid rgba(143, 160, 190, 0.14);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.4);
    }

    .lane-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .task-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.68);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.68);
      box-shadow: 0 10px 26px rgba(26, 40, 80, 0.08);
    }

    .task-meta,
    .mini-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }

    .progress {
      width: 100%;
      height: 7px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(23, 105, 232, 0.11);
    }

    .progress span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--blue), var(--cyan), var(--purple));
    }

    .feed {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .activity-list {
      overflow: auto;
      padding-right: 4px;
    }

    .activity-row {
      align-items: flex-start;
      background: rgba(255, 255, 255, 0.52);
    }

    .activity-copy {
      min-width: 0;
      flex: 1;
    }

    .activity-copy p {
      margin-top: 4px;
    }

    .composer {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: auto;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.68);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.56);
    }

    .composer-tools {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .tool-buttons {
      display: flex;
      gap: 6px;
    }

    .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 1px solid rgba(23, 105, 232, 0.11);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.7);
      color: var(--muted);
    }

    textarea {
      width: 100%;
      min-height: 54px;
      resize: none;
      padding: 10px;
      border: 1px solid rgba(143, 160, 190, 0.18);
      border-radius: 10px;
      outline: 0;
      background: rgba(255, 255, 255, 0.48);
      color: var(--ink);
    }

    .rightbar {
      overflow: auto;
    }

    .approval {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
      border: 1px solid rgba(23, 105, 232, 0.16);
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(23, 105, 232, 0.1), rgba(8, 167, 207, 0.08));
    }

    .sync-card {
      padding: 14px;
      border: 1px solid rgba(255, 255, 255, 0.68);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.52);
    }

    .file-row {
      align-items: flex-start;
      padding: 11px;
      background: rgba(255, 255, 255, 0.5);
    }

    .check-row {
      align-items: flex-start;
      padding: 9px 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    .check-row + .check-row {
      border-top: 1px solid var(--line);
    }

    .status-dot {
      display: inline-flex;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 0 4px rgba(31, 155, 100, 0.12);
    }

    .status-dot.cyan {
      background: var(--cyan);
      box-shadow: 0 0 0 4px rgba(8, 167, 207, 0.13);
    }

    .status-dot.purple {
      background: var(--purple);
      box-shadow: 0 0 0 4px rgba(116, 87, 232, 0.13);
    }

    @media (max-width: 1160px) {
      .workspace {
        grid-template-columns: 220px minmax(0, 1fr);
      }

      .rightbar {
        display: none;
      }

      .content-grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    @media (max-width: 840px) {
      body {
        overflow: auto;
      }

      .page {
        height: auto;
        min-height: 100vh;
        padding: 14px;
      }

      .workspace {
        display: flex;
        flex-direction: column;
        height: auto;
      }

      .sidebar,
      .rightbar {
        display: flex;
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      .stats,
      .board {
        grid-template-columns: 1fr;
      }

      .column,
      .feed,
      .rightbar {
        overflow: visible;
      }
    }
  </style>
</head>
<body>
  <canvas id="particle-canvas" aria-hidden="true"></canvas>
  <div class="page">
    <div class="workspace">
      <aside class="sidebar panel glass">
        <div class="brand">
          <div class="brand-mark"><span class="material-symbols-outlined">hub</span></div>
          <div class="truncate">
            <p class="eyebrow">AgentHub</p>
            <h2>Group Workspace</h2>
          </div>
        </div>

        <div>
          <div class="section-title">
            <h3>Spaces</h3>
            <span class="pill cyan"><span class="status-dot cyan"></span>Live</span>
          </div>
          <div class="nav-list">
            <div class="nav-item active">
              <div class="icon-tile"><span class="material-symbols-outlined">sync_alt</span></div>
              <div class="truncate">
                <strong class="small">Legacy Migration</strong>
                <p class="tiny muted truncate">Cross-system sync</p>
              </div>
            </div>
            <div class="nav-item">
              <div class="icon-tile purple"><span class="material-symbols-outlined">rule</span></div>
              <div class="truncate">
                <strong class="small">Mapping Review</strong>
                <p class="tiny muted truncate">2 approvals open</p>
              </div>
            </div>
            <div class="nav-item">
              <div class="icon-tile cyan"><span class="material-symbols-outlined">folder_shared</span></div>
              <div class="truncate">
                <strong class="small">Shared Files</strong>
                <p class="tiny muted truncate">12 documents</p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">
            <h3>Members</h3>
            <span class="tiny muted">4 online</span>
          </div>
          <div class="member-list">
            <div class="member-row">
              <div class="avatar blue">DA</div>
              <div class="truncate">
                <strong class="small">DataAgent Alpha</strong>
                <p class="tiny muted truncate">Schema extraction ready</p>
              </div>
            </div>
            <div class="member-row">
              <div class="avatar purple">CS</div>
              <div class="truncate">
                <strong class="small">CodeSmith</strong>
                <p class="tiny muted truncate">Parser tests running</p>
              </div>
            </div>
            <div class="member-row">
              <div class="avatar teal">SC</div>
              <div class="truncate">
                <strong class="small">Security-Core</strong>
                <p class="tiny muted truncate">PII guard enabled</p>
              </div>
            </div>
            <div class="member-row">
              <div class="avatar away">XM</div>
              <div class="truncate">
                <strong class="small">Xavier</strong>
                <p class="tiny muted truncate">Reviewing changes</p>
              </div>
            </div>
          </div>
        </div>

        <div class="spacer"></div>
        <div class="sync-card">
          <div class="mini-row">
            <span class="eyebrow">Workspace Health</span>
            <span class="pill green">Stable</span>
          </div>
          <p class="small muted">All visible states are local preview data. No API is connected.</p>
        </div>
      </aside>

      <main class="main">
        <header class="topbar glass">
          <div>
            <p class="eyebrow">Legacy Migration Room</p>
            <h1>Shared operations cockpit</h1>
            <p class="small muted">Members, tasks, files, approvals, and sync status stay visible in one working surface.</p>
          </div>
          <div class="button-group">
            <label class="search">
              <span class="material-symbols-outlined">search</span>
              <input aria-label="Search workspace" placeholder="Search tasks, files, members" />
            </label>
            <button class="button ghost" type="button"><span class="material-symbols-outlined">ios_share</span>Export</button>
            <button class="button primary" type="button"><span class="material-symbols-outlined">group_work</span>Coordinate</button>
          </div>
        </header>

        <section class="stats">
          <div class="stat glass">
            <strong>4</strong>
            <span class="small muted">Online members</span>
          </div>
          <div class="stat glass">
            <strong>7</strong>
            <span class="small muted">Shared tasks</span>
          </div>
          <div class="stat glass">
            <strong>12</strong>
            <span class="small muted">Workspace files</span>
          </div>
          <div class="stat glass">
            <strong>82%</strong>
            <span class="small muted">Sync readiness</span>
          </div>
        </section>

        <section class="content-grid">
          <div class="column glass">
            <div class="section-title">
              <div>
                <p class="eyebrow">Shared Task Board</p>
                <h2>Current coordination plan</h2>
              </div>
              <span class="pill purple"><span class="material-symbols-outlined">bolt</span>Auto assigned</span>
            </div>
            <div class="board">
              <div class="lane">
                <div class="lane-head">
                  <h3>Backlog</h3>
                  <span class="pill">2</span>
                </div>
                <article class="task-card">
                  <div class="task-meta">
                    <span class="pill cyan">File mapping</span>
                    <span class="tiny muted">Due today</span>
                  </div>
                  <h3>Confirm legacy field aliases</h3>
                  <p class="small muted">Resolve conflicting aliases before parser merge.</p>
                  <div class="mini-row">
                    <span class="tiny muted">Owner: DataAgent</span>
                    <span class="avatar blue">DA</span>
                  </div>
                </article>
                <article class="task-card">
                  <div class="task-meta">
                    <span class="pill purple">Docs</span>
                    <span class="tiny muted">Queued</span>
                  </div>
                  <h3>Update handoff notes</h3>
                  <p class="small muted">Add accepted masking rules to shared notes.</p>
                </article>
              </div>

              <div class="lane">
                <div class="lane-head">
                  <h3>In progress</h3>
                  <span class="pill cyan">3</span>
                </div>
                <article class="task-card">
                  <div class="task-meta">
                    <span class="pill purple">Script</span>
                    <span class="tiny muted">45 min</span>
                  </div>
                  <h3>Generate masked parser</h3>
                  <p class="small muted">CodeSmith is applying PII rules from Security-Core.</p>
                  <div class="progress"><span style="width: 68%"></span></div>
                  <div class="mini-row">
                    <span class="tiny muted">Owner: CodeSmith</span>
                    <span class="avatar purple">CS</span>
                  </div>
                </article>
                <article class="task-card">
                  <div class="task-meta">
                    <span class="pill green">Sync</span>
                    <span class="tiny muted">Running</span>
                  </div>
                  <h3>Stage dry-run snapshot</h3>
                  <p class="small muted">Preview channel has the latest schema payload.</p>
                </article>
              </div>

              <div class="lane">
                <div class="lane-head">
                  <h3>Review</h3>
                  <span class="pill green">2</span>
                </div>
                <article class="task-card">
                  <div class="task-meta">
                    <span class="pill">Approval</span>
                    <span class="tiny muted">Waiting</span>
                  </div>
                  <h3>Approve parser v2</h3>
                  <p class="small muted">Diff is ready with masking checks and sample output.</p>
                  <button class="button primary" type="button"><span class="material-symbols-outlined">verified</span>Approve preview</button>
                </article>
                <article class="task-card">
                  <div class="task-meta">
                    <span class="pill cyan">Security</span>
                    <span class="tiny muted">Passed</span>
                  </div>
                  <h3>Validate redaction policy</h3>
                  <p class="small muted">Email and phone extension fields are masked.</p>
                </article>
              </div>
            </div>
          </div>

          <aside class="feed glass">
            <div class="section-title">
              <div>
                <p class="eyebrow">Activity Flow</p>
                <h2>Workspace pulse</h2>
              </div>
              <span class="pill green"><span class="status-dot"></span>Synced</span>
            </div>
            <div class="activity-list">
              <div class="activity-row">
                <div class="icon-tile cyan"><span class="material-symbols-outlined">dataset</span></div>
                <div class="activity-copy">
                  <strong class="small">DataAgent Alpha added legacy_schema.json</strong>
                  <p class="small muted">Schema map is attached to the shared file area.</p>
                  <span class="tiny muted">10:42</span>
                </div>
              </div>
              <div class="activity-row">
                <div class="icon-tile purple"><span class="material-symbols-outlined">code_blocks</span></div>
                <div class="activity-copy">
                  <strong class="small">CodeSmith generated parser_v2.py</strong>
                  <p class="small muted">The task card moved to review after test output arrived.</p>
                  <span class="tiny muted">10:47</span>
                </div>
              </div>
              <div class="activity-row">
                <div class="icon-tile green"><span class="material-symbols-outlined">policy</span></div>
                <div class="activity-copy">
                  <strong class="small">Security-Core approved masking rules</strong>
                  <p class="small muted">PII fields are flagged before any sync action is exposed.</p>
                  <span class="tiny muted">10:51</span>
                </div>
              </div>
              <div class="activity-row">
                <div class="icon-tile"><span class="material-symbols-outlined">assignment_ind</span></div>
                <div class="activity-copy">
                  <strong class="small">Xavier assigned final review</strong>
                  <p class="small muted">Approval card is now visible in the right rail.</p>
                  <span class="tiny muted">10:55</span>
                </div>
              </div>
            </div>

            <div class="composer">
              <div class="composer-tools">
                <div class="tool-buttons">
                  <button class="icon-button" type="button" aria-label="Mention"><span class="material-symbols-outlined">alternate_email</span></button>
                  <button class="icon-button" type="button" aria-label="Attach file"><span class="material-symbols-outlined">attach_file</span></button>
                  <button class="icon-button" type="button" aria-label="Create task"><span class="material-symbols-outlined">add_task</span></button>
                </div>
                <span class="pill cyan">@group</span>
              </div>
              <textarea aria-label="Workspace message" placeholder="Send a coordination note to this workspace..."></textarea>
              <div class="mini-row">
                <span class="tiny muted">Draft command only. No backend call.</span>
                <button class="button primary" type="button"><span class="material-symbols-outlined">send</span>Send</button>
              </div>
            </div>
          </aside>
        </section>
      </main>

      <aside class="rightbar panel glass">
        <section>
          <div class="section-title">
            <div>
              <p class="eyebrow">Approval</p>
              <h2>Parser v2 ready</h2>
            </div>
            <span class="pill purple">Review</span>
          </div>
          <div class="approval">
            <div class="mini-row">
              <strong class="small">Visible state: Awaiting approval</strong>
              <span class="pill">Open</span>
            </div>
            <p class="small muted">Parser diff is staged, security checks passed, and sync remains locked until approval.</p>
            <div class="button-group">
              <button class="button ghost" type="button"><span class="material-symbols-outlined">edit_note</span>Request edits</button>
              <button class="button primary" type="button"><span class="material-symbols-outlined">check_circle</span>Approve</button>
            </div>
          </div>
        </section>

        <section>
          <div class="section-title">
            <div>
              <p class="eyebrow">Sync Status</p>
              <h2>Shared snapshot</h2>
            </div>
            <span class="pill green">82%</span>
          </div>
          <div class="sync-card">
            <div class="mini-row">
              <span class="small muted">Dry-run readiness</span>
              <strong class="small">82%</strong>
            </div>
            <div class="progress" style="margin: 10px 0 12px"><span style="width: 82%"></span></div>
            <div class="check-list">
              <div class="check-row">
                <span class="status-dot cyan"></span>
                <div>
                  <strong class="small">Files indexed</strong>
                  <p class="tiny muted">12 workspace files available.</p>
                </div>
              </div>
              <div class="check-row">
                <span class="status-dot purple"></span>
                <div>
                  <strong class="small">Assignments visible</strong>
                  <p class="tiny muted">Owners are shown on task cards.</p>
                </div>
              </div>
              <div class="check-row">
                <span class="status-dot"></span>
                <div>
                  <strong class="small">Security passed</strong>
                  <p class="tiny muted">Masking guard is active.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div class="section-title">
            <div>
              <p class="eyebrow">Shared Files</p>
              <h2>Workspace documents</h2>
            </div>
            <button class="icon-button" type="button" aria-label="Add file"><span class="material-symbols-outlined">add</span></button>
          </div>
          <div class="file-list">
            <div class="file-row">
              <div class="icon-tile cyan"><span class="material-symbols-outlined">description</span></div>
              <div class="truncate">
                <strong class="small truncate">legacy_schema.json</strong>
                <p class="tiny muted truncate">Added by DataAgent Alpha</p>
              </div>
              <span class="tiny muted">1.2 MB</span>
            </div>
            <div class="file-row">
              <div class="icon-tile purple"><span class="material-symbols-outlined">code</span></div>
              <div class="truncate">
                <strong class="small truncate">parser_v2.py</strong>
                <p class="tiny muted truncate">Generated by CodeSmith</p>
              </div>
              <span class="tiny muted">4 KB</span>
            </div>
            <div class="file-row">
              <div class="icon-tile green"><span class="material-symbols-outlined">shield</span></div>
              <div class="truncate">
                <strong class="small truncate">masking_rules.md</strong>
                <p class="tiny muted truncate">Approved by Security-Core</p>
              </div>
              <span class="tiny muted">18 KB</span>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </div>

  <script>
    (function () {
      var canvas = document.getElementById("particle-canvas");
      var ctx = canvas.getContext("2d");
      var particles = [];
      var particleCount = 56;
      var width = 0;
      var height = 0;
      var frame = 0;

      function resize() {
        var ratio = window.devicePixelRatio || 1;
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      function makeParticle(index) {
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: 1.6 + Math.random() * 2.6,
          vx: -0.18 + Math.random() * 0.36,
          vy: -0.18 - Math.random() * 0.48,
          hue: index % 3 === 0 ? 196 : 210,
          alpha: 0.18 + Math.random() * 0.2
        };
      }

      function seed() {
        particles = [];
        for (var i = 0; i < particleCount; i += 1) {
          particles.push(makeParticle(i));
        }
      }

      function draw() {
        frame = window.requestAnimationFrame(draw);
        ctx.clearRect(0, 0, width, height);

        for (var i = 0; i < particles.length; i += 1) {
          var p = particles[i];
          p.x += p.vx;
          p.y += p.vy;
          if (p.y < -16) {
            p.y = height + 16;
            p.x = Math.random() * width;
          }
          if (p.x < -16) {
            p.x = width + 16;
          }
          if (p.x > width + 16) {
            p.x = -16;
          }

          ctx.beginPath();
          ctx.fillStyle = "hsla(" + p.hue + ", 84%, 48%, " + p.alpha + ")";
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();

          for (var j = i + 1; j < particles.length; j += 1) {
            var q = particles[j];
            var dx = p.x - q.x;
            var dy = p.y - q.y;
            var distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 126) {
              ctx.beginPath();
              ctx.strokeStyle = "rgba(23, 105, 232, " + ((1 - distance / 126) * 0.07) + ")";
              ctx.lineWidth = 1;
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(q.x, q.y);
              ctx.stroke();
            }
          }
        }
      }

      resize();
      seed();
      draw();
      window.addEventListener("resize", function () {
        window.cancelAnimationFrame(frame);
        resize();
        seed();
        draw();
      });
    })();
  </script>
</body>
</html>
`;

export function GroupWorkspacePage() {
  return (
    <iframe
      title="Group Workspace"
      srcDoc={pageHtml}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      style={{ width: "100%", height: "100vh", border: 0, display: "block" }}
    />
  );
}

export default GroupWorkspacePage;
