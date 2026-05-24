const pageHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentHub Workbench Preview</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
    <style>
      :root {
        color-scheme: light;
        --ink: #142033;
        --muted: #61708c;
        --line: rgba(139, 156, 188, 0.24);
        --blue: #1967ff;
        --cyan: #00adc7;
        --purple: #7a4dff;
        --green: #12a67a;
        --amber: #c78313;
        --glass-bg: rgba(255, 255, 255, 0.72);
        --glass-border: rgba(255, 255, 255, 0.7);
        --glass-shadow: 0 18px 48px rgba(26, 40, 80, 0.14);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        min-height: 100%;
      }

      body {
        margin: 0;
        overflow: hidden;
        font-family: "Hanken Grotesk", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          linear-gradient(135deg, rgba(247, 251, 255, 0.96), rgba(235, 242, 255, 0.92)),
          linear-gradient(90deg, rgba(25, 103, 255, 0.06) 1px, transparent 1px),
          linear-gradient(0deg, rgba(0, 173, 199, 0.05) 1px, transparent 1px);
        background-size: auto, 44px 44px, 44px 44px;
      }

      button,
      input {
        font: inherit;
      }

      button {
        border: 0;
      }

      .material-symbols-outlined {
        font-size: 20px;
        line-height: 1;
        font-variation-settings: "FILL" 0, "wght" 500, "GRAD" 0, "opsz" 24;
      }

      .particle-canvas {
        position: fixed;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        opacity: 0.7;
      }

      .app-frame {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 260px minmax(0, 1fr);
        gap: 16px;
        width: 100vw;
        height: 100vh;
        padding: 18px;
      }

      .glass {
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        border-radius: 12px;
        box-shadow: var(--glass-shadow);
        backdrop-filter: blur(28px) saturate(160%);
        -webkit-backdrop-filter: blur(28px) saturate(160%);
      }

      .sidebar {
        display: flex;
        min-height: 0;
        flex-direction: column;
        padding: 16px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 4px 2px 18px;
      }

      .brand-mark {
        display: grid;
        width: 42px;
        height: 42px;
        place-items: center;
        border-radius: 12px;
        color: #fff;
        font-weight: 800;
        letter-spacing: 0;
        background: linear-gradient(135deg, var(--blue), var(--cyan) 58%, var(--purple));
        box-shadow: 0 12px 24px rgba(25, 103, 255, 0.22);
      }

      .brand-title {
        margin: 0;
        font-size: 18px;
        font-weight: 800;
      }

      .brand-subtitle {
        margin: 2px 0 0;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .primary-button,
      .secondary-button,
      .icon-button,
      .tab-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 36px;
        border-radius: 8px;
        cursor: pointer;
        transition: transform 160ms ease, background 160ms ease, color 160ms ease, border-color 160ms ease;
      }

      .primary-button {
        width: 100%;
        color: #fff;
        font-weight: 800;
        background: linear-gradient(135deg, var(--blue), var(--cyan));
        box-shadow: 0 14px 28px rgba(25, 103, 255, 0.2);
      }

      .secondary-button {
        color: #253552;
        background: rgba(255, 255, 255, 0.62);
        border: 1px solid rgba(255, 255, 255, 0.76);
      }

      .icon-button {
        width: 36px;
        height: 36px;
        color: #334563;
        background: rgba(255, 255, 255, 0.58);
        border: 1px solid rgba(255, 255, 255, 0.72);
      }

      .primary-button:hover,
      .secondary-button:hover,
      .icon-button:hover,
      .tab-button:hover {
        transform: translateY(-1px);
      }

      .nav-list,
      .session-list,
      .agent-list,
      .timeline,
      .check-list {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .nav-list {
        margin-top: 16px;
      }

      .nav-item,
      .session-item,
      .agent-card,
      .message,
      .file-row,
      .preview-row,
      .approval-row {
        border: 1px solid rgba(255, 255, 255, 0.7);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.48);
      }

      .nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 42px;
        padding: 0 12px;
        color: #485976;
        font-size: 14px;
        font-weight: 700;
      }

      .nav-item.active {
        color: var(--blue);
        background: rgba(25, 103, 255, 0.1);
        border-color: rgba(25, 103, 255, 0.16);
      }

      .sidebar-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 22px 2px 10px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .session-item {
        display: grid;
        gap: 8px;
        padding: 12px;
      }

      .session-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .session-title,
      .agent-name,
      .message-title,
      .panel-title {
        font-weight: 800;
      }

      .small-text,
      .session-meta,
      .agent-role,
      .message-copy,
      .file-meta,
      .preview-copy {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.45;
      }

      .status-pill,
      .tiny-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 24px;
        border-radius: 999px;
        padding: 0 9px;
        font-size: 12px;
        font-weight: 800;
      }

      .status-pill {
        color: #075f7a;
        background: rgba(0, 173, 199, 0.12);
        border: 1px solid rgba(0, 173, 199, 0.22);
      }

      .tiny-pill {
        color: #354765;
        background: rgba(255, 255, 255, 0.62);
      }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--green);
        box-shadow: 0 0 0 5px rgba(18, 166, 122, 0.11);
      }

      .main-area {
        display: grid;
        min-width: 0;
        min-height: 0;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 16px;
      }

      .topbar {
        display: grid;
        grid-template-columns: minmax(240px, 1fr) auto;
        align-items: center;
        gap: 16px;
        min-height: 66px;
        padding: 12px 14px;
      }

      .search {
        position: relative;
        min-width: 0;
      }

      .search .material-symbols-outlined {
        position: absolute;
        left: 13px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--muted);
      }

      .search input {
        width: 100%;
        height: 42px;
        border: 1px solid rgba(255, 255, 255, 0.78);
        border-radius: 8px;
        outline: 0;
        padding: 0 14px 0 42px;
        color: var(--ink);
        background: rgba(255, 255, 255, 0.58);
      }

      .topbar-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .work-grid {
        display: grid;
        min-height: 0;
        grid-template-columns: minmax(420px, 1fr) minmax(360px, 430px);
        gap: 16px;
      }

      .conversation,
      .inspector {
        min-height: 0;
        overflow: hidden;
      }

      .conversation {
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr) auto;
        gap: 14px;
        padding: 18px;
      }

      .task-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }

      .task-title {
        margin: 0;
        font-size: 28px;
        line-height: 1.14;
        letter-spacing: 0;
      }

      .task-copy {
        max-width: 680px;
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.55;
      }

      .metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .metric {
        padding: 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.46);
        border: 1px solid rgba(255, 255, 255, 0.62);
      }

      .metric-value {
        display: block;
        color: #102449;
        font-size: 22px;
        font-weight: 800;
      }

      .metric-label {
        display: block;
        margin-top: 3px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
      }

      .agent-list {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .agent-card {
        padding: 12px;
      }

      .agent-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .avatar {
        display: grid;
        width: 34px;
        height: 34px;
        place-items: center;
        border-radius: 10px;
        color: #fff;
        font-weight: 800;
        background: linear-gradient(135deg, var(--blue), var(--purple));
      }

      .agent-card:nth-child(2) .avatar {
        background: linear-gradient(135deg, var(--cyan), var(--blue));
      }

      .agent-card:nth-child(3) .avatar {
        background: linear-gradient(135deg, var(--purple), #b666ff);
      }

      .progress {
        height: 6px;
        margin-top: 12px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(91, 111, 148, 0.16);
      }

      .progress span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--blue), var(--cyan));
      }

      .timeline {
        min-height: 0;
        overflow: auto;
        padding-right: 2px;
      }

      .message {
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr);
        gap: 12px;
        padding: 13px;
      }

      .message-icon {
        display: grid;
        width: 38px;
        height: 38px;
        place-items: center;
        border-radius: 12px;
        color: var(--blue);
        background: rgba(25, 103, 255, 0.09);
      }

      .composer {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.72);
      }

      .composer input {
        flex: 1;
        min-width: 0;
        height: 38px;
        border: 0;
        outline: 0;
        color: var(--ink);
        background: transparent;
      }

      .inspector {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
      }

      .inspector-head {
        display: grid;
        gap: 12px;
        padding: 16px 16px 12px;
        border-bottom: 1px solid var(--line);
      }

      .panel-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .tabs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        padding: 4px;
        border-radius: 12px;
        background: rgba(91, 111, 148, 0.1);
      }

      .tab-button {
        min-height: 34px;
        color: #50617e;
        font-size: 13px;
        font-weight: 800;
        background: transparent;
      }

      .tab-button.active {
        color: var(--blue);
        background: rgba(255, 255, 255, 0.78);
        box-shadow: 0 8px 20px rgba(26, 40, 80, 0.08);
      }

      .panel-body {
        min-height: 0;
        overflow: auto;
        padding: 16px;
      }

      [data-panel-content] {
        display: none;
      }

      [data-panel-content].active {
        display: grid;
        gap: 12px;
      }

      .preview-card {
        overflow: hidden;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.72);
        background: rgba(255, 255, 255, 0.55);
      }

      .preview-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        padding: 0 10px;
        border-bottom: 1px solid var(--line);
      }

      .window-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--blue);
        opacity: 0.55;
      }

      .window-dot:nth-child(2) {
        background: var(--cyan);
      }

      .window-dot:nth-child(3) {
        background: var(--purple);
      }

      .preview-stage {
        display: grid;
        gap: 10px;
        padding: 14px;
      }

      .preview-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px;
      }

      .file-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        padding: 11px 12px;
      }

      .diff-block {
        overflow: hidden;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.72);
        background: rgba(22, 33, 56, 0.9);
        color: #e9f0ff;
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        font-size: 12px;
        line-height: 1.65;
      }

      .diff-line {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        gap: 10px;
        padding: 0 12px;
      }

      .diff-line.add {
        background: rgba(0, 173, 199, 0.13);
      }

      .diff-line.remove {
        background: rgba(122, 77, 255, 0.13);
      }

      .approval-row {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr);
        gap: 10px;
        padding: 12px;
      }

      .check {
        display: grid;
        width: 22px;
        height: 22px;
        place-items: center;
        border-radius: 8px;
        color: #fff;
        background: linear-gradient(135deg, var(--green), var(--cyan));
      }

      .confirm-bar {
        display: none;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 4px;
        padding: 12px;
        border-radius: 12px;
        color: #143251;
        background: rgba(0, 173, 199, 0.12);
        border: 1px solid rgba(0, 173, 199, 0.2);
      }

      .confirm-bar.visible {
        display: flex;
      }

      .command-overlay {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: none;
        place-items: start center;
        padding-top: 92px;
        background: rgba(24, 38, 64, 0.18);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      .command-overlay.visible {
        display: grid;
      }

      .command-panel {
        width: min(620px, calc(100vw - 32px));
        padding: 14px;
      }

      .command-input {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 46px;
        padding: 0 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.64);
        border: 1px solid rgba(255, 255, 255, 0.76);
      }

      .command-input input {
        flex: 1;
        border: 0;
        outline: 0;
        background: transparent;
      }

      .command-actions {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }

      .command-actions button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 42px;
        padding: 0 12px;
        border-radius: 8px;
        color: #253552;
        background: rgba(255, 255, 255, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.7);
        cursor: pointer;
      }

      @media (max-width: 1120px) {
        body {
          overflow: auto;
        }

        .app-frame {
          height: auto;
          min-height: 100vh;
          grid-template-columns: 1fr;
        }

        .sidebar {
          display: none;
        }

        .work-grid {
          grid-template-columns: 1fr;
        }

        .inspector {
          min-height: 560px;
        }
      }

      @media (max-width: 760px) {
        .app-frame {
          padding: 10px;
        }

        .topbar,
        .task-header {
          grid-template-columns: 1fr;
        }

        .topbar-actions,
        .task-header {
          flex-wrap: wrap;
        }

        .metrics,
        .agent-list {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <canvas class="particle-canvas" id="particle-canvas" aria-hidden="true"></canvas>

    <div class="app-frame">
      <aside class="sidebar glass" aria-label="Workbench navigation">
        <div class="brand">
          <div class="brand-mark">AH</div>
          <div>
            <h1 class="brand-title">AgentHub</h1>
            <p class="brand-subtitle">Workbench</p>
          </div>
        </div>

        <button class="primary-button" type="button" id="open-command-sidebar">
          <span class="material-symbols-outlined">add_task</span>
          New work item
        </button>

        <nav class="nav-list" aria-label="Primary">
          <a class="nav-item active" href="#"><span class="material-symbols-outlined">view_quilt</span>Workbench</a>
          <a class="nav-item" href="#"><span class="material-symbols-outlined">forum</span>Sessions</a>
          <a class="nav-item" href="#"><span class="material-symbols-outlined">account_tree</span>Agent graph</a>
          <a class="nav-item" href="#"><span class="material-symbols-outlined">folder_open</span>Projects</a>
        </nav>

        <div class="sidebar-label">
          <span>Active sessions</span>
          <span>4</span>
        </div>
        <ul class="session-list">
          <li class="session-item">
            <div class="session-top">
              <span class="session-title">Workbench polish</span>
              <span class="dot"></span>
            </div>
            <span class="session-meta">UI worker and tester active</span>
          </li>
          <li class="session-item">
            <div class="session-top">
              <span class="session-title">Preview bridge</span>
              <span class="tiny-pill">Paused</span>
            </div>
            <span class="session-meta">Waiting on interface notes</span>
          </li>
          <li class="session-item">
            <div class="session-top">
              <span class="session-title">Approval queue</span>
              <span class="tiny-pill">3 items</span>
            </div>
            <span class="session-meta">Ready for owner review</span>
          </li>
        </ul>
      </aside>

      <section class="main-area">
        <header class="topbar glass">
          <label class="search">
            <span class="material-symbols-outlined">search</span>
            <input type="search" placeholder="Search tasks, files, agents" />
          </label>
          <div class="topbar-actions">
            <span class="status-pill"><span class="dot"></span>Local preview only</span>
            <button class="icon-button" type="button" aria-label="Open command palette" id="open-command">
              <span class="material-symbols-outlined">keyboard_command_key</span>
            </button>
            <button class="icon-button" type="button" aria-label="Notifications">
              <span class="material-symbols-outlined">notifications</span>
            </button>
            <button class="secondary-button" type="button" id="show-confirm">
              <span class="material-symbols-outlined">verified</span>
              Request review
            </button>
          </div>
        </header>

        <div class="work-grid">
          <main class="conversation glass">
            <div class="task-header">
              <div>
                <span class="status-pill">Frontend coordination</span>
                <h2 class="task-title">Shape the multi-agent workbench surface</h2>
                <p class="task-copy">
                  A focused planning surface for parallel workers: sessions stay visible, agent progress is explicit, and review panels sit beside the work instead of hiding behind navigation.
                </p>
              </div>
              <button class="secondary-button" type="button" id="show-confirm-secondary">
                <span class="material-symbols-outlined">play_arrow</span>
                Stage handoff
              </button>
            </div>

            <div class="metrics" aria-label="Task metrics">
              <div class="metric">
                <span class="metric-value">6</span>
                <span class="metric-label">Open UI tasks</span>
              </div>
              <div class="metric">
                <span class="metric-value">3</span>
                <span class="metric-label">Agents active</span>
              </div>
              <div class="metric">
                <span class="metric-value">12m</span>
                <span class="metric-label">Last update</span>
              </div>
            </div>

            <ul class="agent-list" aria-label="Agent collaboration status">
              <li class="agent-card">
                <div class="agent-head">
                  <div class="avatar">CW</div>
                  <span class="tiny-pill">Coding</span>
                </div>
                <div class="agent-name">Workbench worker</div>
                <div class="agent-role">Refining layout and state affordances</div>
                <div class="progress"><span style="width: 72%"></span></div>
              </li>
              <li class="agent-card">
                <div class="agent-head">
                  <div class="avatar">VT</div>
                  <span class="tiny-pill">Visual QA</span>
                </div>
                <div class="agent-name">Preview tester</div>
                <div class="agent-role">Checking responsive surfaces</div>
                <div class="progress"><span style="width: 48%"></span></div>
              </li>
              <li class="agent-card">
                <div class="agent-head">
                  <div class="avatar">CR</div>
                  <span class="tiny-pill">Review</span>
                </div>
                <div class="agent-name">Coordinator</div>
                <div class="agent-role">Watching write boundaries</div>
                <div class="progress"><span style="width: 86%"></span></div>
              </li>
            </ul>

            <ol class="timeline" aria-label="Session activity">
              <li class="message">
                <div class="message-icon"><span class="material-symbols-outlined">design_services</span></div>
                <div>
                  <div class="message-title">UI worker tightened the page hierarchy</div>
                  <div class="message-copy">Cards now separate navigation, conversation, and review work without stacking decorative containers inside each other.</div>
                </div>
              </li>
              <li class="message">
                <div class="message-icon"><span class="material-symbols-outlined">hub</span></div>
                <div>
                  <div class="message-title">Coordinator pinned the page contract</div>
                  <div class="message-copy">No real API calls, no new package dependency, and all changes stay under the workbench page directory.</div>
                </div>
              </li>
              <li class="message">
                <div class="message-icon"><span class="material-symbols-outlined">rule</span></div>
                <div>
                  <div class="message-title">Tester prepared review checks</div>
                  <div class="message-copy">Diff, preview, and approval affordances are visible at the same time as session progress.</div>
                </div>
              </li>
            </ol>

            <form class="composer">
              <span class="material-symbols-outlined">bolt</span>
              <input aria-label="Draft instruction" placeholder="Draft an instruction for the next worker..." />
              <button class="secondary-button" type="button">Queue</button>
            </form>
          </main>

          <aside class="inspector glass" aria-label="Review panel">
            <div class="inspector-head">
              <div class="panel-heading">
                <div>
                  <div class="panel-title">Diff / Preview / Approval</div>
                  <div class="small-text">Static local UI states for the workbench shell</div>
                </div>
                <span class="tiny-pill">No API</span>
              </div>
              <div class="tabs" role="tablist" aria-label="Review views">
                <button class="tab-button active" type="button" data-panel="preview">Preview</button>
                <button class="tab-button" type="button" data-panel="diff">Diff</button>
                <button class="tab-button" type="button" data-panel="approval">Approval</button>
              </div>
            </div>

            <div class="panel-body">
              <section class="active" data-panel-content="preview">
                <div class="preview-card">
                  <div class="preview-toolbar">
                    <span class="window-dot"></span>
                    <span class="window-dot"></span>
                    <span class="window-dot"></span>
                    <span class="small-text">localhost preview</span>
                  </div>
                  <div class="preview-stage">
                    <div class="preview-row">
                      <div>
                        <div class="panel-title">Workbench shell</div>
                        <div class="preview-copy">Top bar, sessions, collaboration status, and review panel stay in one scan path.</div>
                      </div>
                      <span class="material-symbols-outlined" style="color: var(--blue)">web_asset</span>
                    </div>
                    <div class="preview-row">
                      <div>
                        <div class="panel-title">Glass tokens aligned</div>
                        <div class="preview-copy">Cards share one blur, shadow, radius, and border recipe.</div>
                      </div>
                      <span class="material-symbols-outlined" style="color: var(--cyan)">auto_awesome</span>
                    </div>
                  </div>
                </div>
                <button class="secondary-button" type="button" id="preview-confirm">
                  <span class="material-symbols-outlined">task_alt</span>
                  Mark preview checked
                </button>
              </section>

              <section data-panel-content="diff">
                <div class="file-row">
                  <div>
                    <div class="panel-title">WorkbenchPage.tsx</div>
                    <div class="file-meta">HTML shell layout and particle pass</div>
                  </div>
                  <span class="tiny-pill">edited</span>
                </div>
                <div class="file-row">
                  <div>
                    <div class="panel-title">WorkbenchPageReact.tsx</div>
                    <div class="file-meta">React landing copy with local UI states</div>
                  </div>
                  <span class="tiny-pill">new</span>
                </div>
                <div class="diff-block" aria-label="Illustrative diff">
                  <div class="diff-line remove"><span>-</span><span>oversized marketing cards and broken copy</span></div>
                  <div class="diff-line add"><span>+</span><span>task surface, agent status, review tabs</span></div>
                  <div class="diff-line add"><span>+</span><span>56 subtle blue and cyan particles with faint links</span></div>
                  <div class="diff-line add"><span>+</span><span>visible command palette and confirmation bar states</span></div>
                </div>
              </section>

              <section data-panel-content="approval">
                <ul class="check-list">
                  <li class="approval-row">
                    <span class="check material-symbols-outlined">check</span>
                    <div>
                      <div class="panel-title">Write scope respected</div>
                      <div class="small-text">Only workbench page files are represented.</div>
                    </div>
                  </li>
                  <li class="approval-row">
                    <span class="check material-symbols-outlined">check</span>
                    <div>
                      <div class="panel-title">No production calls</div>
                      <div class="small-text">Buttons change local visual state only.</div>
                    </div>
                  </li>
                  <li class="approval-row">
                    <span class="check material-symbols-outlined">check</span>
                    <div>
                      <div class="panel-title">Review ready</div>
                      <div class="small-text">Preview, diff, and approval states are reachable.</div>
                    </div>
                  </li>
                </ul>
                <button class="primary-button" type="button" id="approval-confirm">
                  <span class="material-symbols-outlined">verified</span>
                  Approve visual direction
                </button>
                <div class="confirm-bar" id="confirm-bar">
                  <span><strong>Queued:</strong> visual review handoff is ready.</span>
                  <button class="secondary-button" type="button" id="hide-confirm">Dismiss</button>
                </div>
              </section>
            </div>
          </aside>
        </div>
      </section>
    </div>

    <div class="command-overlay" id="command-overlay" aria-hidden="true">
      <section class="command-panel glass" role="dialog" aria-label="Command palette">
        <label class="command-input">
          <span class="material-symbols-outlined">terminal</span>
          <input placeholder="Type a command or route work to an agent" />
        </label>
        <div class="command-actions">
          <button type="button"><span>Route visual QA to tester</span><span class="tiny-pill">V</span></button>
          <button type="button"><span>Create approval checkpoint</span><span class="tiny-pill">A</span></button>
          <button type="button"><span>Open diff panel</span><span class="tiny-pill">D</span></button>
        </div>
      </section>
    </div>

    <script>
      (function () {
        const canvas = document.getElementById("particle-canvas");
        const ctx = canvas.getContext("2d");
        const particles = [];
        const count = 56;
        let frameId = 0;
        let width = 0;
        let height = 0;

        function resize() {
          const ratio = window.devicePixelRatio || 1;
          width = window.innerWidth;
          height = window.innerHeight;
          canvas.width = Math.floor(width * ratio);
          canvas.height = Math.floor(height * ratio);
          canvas.style.width = width + "px";
          canvas.style.height = height + "px";
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          particles.length = 0;

          for (let i = 0; i < count; i += 1) {
            particles.push({
              x: Math.random() * width,
              y: Math.random() * height,
              radius: 1.2 + Math.random() * 2.2,
              vx: (Math.random() - 0.5) * 0.18,
              vy: -0.1 - Math.random() * 0.32,
              hue: Math.random() > 0.48 ? "0, 173, 199" : "25, 103, 255",
              alpha: 0.18 + Math.random() * 0.22
            });
          }
        }

        function animate() {
          ctx.clearRect(0, 0, width, height);

          for (let i = 0; i < particles.length; i += 1) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;

            if (p.y < -18) {
              p.y = height + 18;
              p.x = Math.random() * width;
            }

            if (p.x < -18) p.x = width + 18;
            if (p.x > width + 18) p.x = -18;

            ctx.beginPath();
            ctx.fillStyle = "rgba(" + p.hue + "," + p.alpha + ")";
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();

            for (let j = i + 1; j < particles.length; j += 1) {
              const n = particles[j];
              const dx = p.x - n.x;
              const dy = p.y - n.y;
              const distance = Math.sqrt(dx * dx + dy * dy);

              if (distance < 118) {
                ctx.beginPath();
                ctx.strokeStyle = "rgba(25, 103, 255," + (0.055 * (1 - distance / 118)) + ")";
                ctx.lineWidth = 1;
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(n.x, n.y);
                ctx.stroke();
              }
            }
          }

          frameId = window.requestAnimationFrame(animate);
        }

        window.addEventListener("resize", resize);
        resize();
        animate();

        const tabButtons = Array.from(document.querySelectorAll("[data-panel]"));
        const panels = Array.from(document.querySelectorAll("[data-panel-content]"));
        const confirmBar = document.getElementById("confirm-bar");
        const overlay = document.getElementById("command-overlay");

        function setPanel(panelName) {
          tabButtons.forEach(function (button) {
            button.classList.toggle("active", button.dataset.panel === panelName);
          });
          panels.forEach(function (panel) {
            panel.classList.toggle("active", panel.dataset.panelContent === panelName);
          });
        }

        tabButtons.forEach(function (button) {
          button.addEventListener("click", function () {
            setPanel(button.dataset.panel);
          });
        });

        function showConfirm() {
          setPanel("approval");
          confirmBar.classList.add("visible");
        }

        function showCommand() {
          overlay.classList.add("visible");
          overlay.setAttribute("aria-hidden", "false");
          const input = overlay.querySelector("input");
          if (input) input.focus();
        }

        function hideCommand() {
          overlay.classList.remove("visible");
          overlay.setAttribute("aria-hidden", "true");
        }

        ["show-confirm", "show-confirm-secondary", "preview-confirm", "approval-confirm"].forEach(function (id) {
          const button = document.getElementById(id);
          if (button) button.addEventListener("click", showConfirm);
        });

        ["open-command", "open-command-sidebar"].forEach(function (id) {
          const button = document.getElementById(id);
          if (button) button.addEventListener("click", showCommand);
        });

        document.getElementById("hide-confirm").addEventListener("click", function () {
          confirmBar.classList.remove("visible");
        });

        overlay.addEventListener("click", function (event) {
          if (event.target === overlay) hideCommand();
        });

        document.addEventListener("keydown", function (event) {
          if (event.key === "Escape") hideCommand();
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            showCommand();
          }
        });
      })();
    </script>
  </body>
</html>`;

export function WorkbenchPage() {
  return (
    <iframe
      title="Workbench"
      srcDoc={pageHtml}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      style={{ width: "100%", height: "100vh", border: 0, display: "block" }}
    />
  );
}

export default WorkbenchPage;
