const pageHtml: string = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentHub | Agent Square</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #edf6ff;
      --bg-soft: #f7fbff;
      --ink: #172033;
      --muted: #5f6f86;
      --line: rgba(133, 153, 184, 0.22);
      --blue: #1769e8;
      --cyan: #08a7cf;
      --purple: #7457e8;
      --green: #1d9b67;
      --amber: #d98718;
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
      height: 100%;
      margin: 0;
      overflow: hidden;
      color: var(--ink);
      background:
        radial-gradient(circle at 14% 10%, rgba(8, 167, 207, 0.16), transparent 28%),
        radial-gradient(circle at 78% 4%, rgba(116, 87, 232, 0.14), transparent 30%),
        linear-gradient(135deg, var(--bg-soft), var(--bg));
      font-family: "Hanken Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button,
    input,
    select {
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
      grid-template-columns: 232px minmax(0, 1fr) 316px;
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

    .sidebar,
    .main,
    .drawer {
      display: flex;
      min-height: 0;
      flex-direction: column;
    }

    .sidebar,
    .drawer {
      gap: 16px;
      overflow: auto;
      padding: 18px;
    }

    .main {
      gap: 16px;
      overflow: hidden;
    }

    h1,
    h2,
    h3,
    p {
      margin: 0;
    }

    h1 {
      font-size: 27px;
      line-height: 1.1;
      letter-spacing: 0;
    }

    h2 {
      font-size: 16px;
      line-height: 1.25;
      letter-spacing: 0;
    }

    h3 {
      font-size: 15px;
      line-height: 1.25;
      letter-spacing: 0;
    }

    .muted {
      color: var(--muted);
    }

    .tiny {
      font-size: 11px;
      line-height: 1.35;
      letter-spacing: 0;
    }

    .small {
      font-size: 12px;
      line-height: 1.45;
      letter-spacing: 0;
    }

    .label {
      font-size: 11px;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: 0;
      text-transform: uppercase;
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
    .agent-logo,
    .avatar,
    .icon-button {
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

    .truncate {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sidebar-section,
    .drawer-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .section-head,
    .mini-row,
    .card-head,
    .card-actions,
    .topbar,
    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .section-head,
    .mini-row,
    .topbar {
      justify-content: space-between;
    }

    .nav-list,
    .category-list,
    .activity-list,
    .tool-list,
    .agent-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }

    .nav-item,
    .category-button,
    .activity-row,
    .tool-row,
    .metric-card {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: 10px;
      border: 1px solid transparent;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.46);
      color: var(--ink);
    }

    .nav-item.active,
    .category-button.active {
      border-color: rgba(23, 105, 232, 0.2);
      background: rgba(23, 105, 232, 0.1);
      color: #1459c7;
    }

    .category-button {
      width: 100%;
      justify-content: space-between;
      text-align: left;
    }

    .icon-tile,
    .agent-logo {
      width: 34px;
      height: 34px;
      color: var(--blue);
      border-radius: 10px;
      background: rgba(23, 105, 232, 0.1);
    }

    .icon-tile.cyan,
    .agent-logo.cyan {
      color: #087f9e;
      background: rgba(8, 167, 207, 0.11);
    }

    .icon-tile.purple,
    .agent-logo.purple {
      color: #6044d7;
      background: rgba(116, 87, 232, 0.11);
    }

    .icon-tile.green,
    .agent-logo.green {
      color: #15744b;
      background: rgba(29, 155, 103, 0.11);
    }

    .avatar {
      width: 34px;
      height: 34px;
      color: #fff;
      border: 2px solid rgba(255, 255, 255, 0.82);
      border-radius: 50%;
      background: linear-gradient(135deg, var(--purple), var(--cyan));
      font-size: 12px;
      font-weight: 800;
      box-shadow: 0 8px 20px rgba(23, 105, 232, 0.16);
    }

    .pill,
    .tag {
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

    .pill.cyan,
    .tag.cyan {
      border-color: rgba(8, 167, 207, 0.18);
      background: rgba(8, 167, 207, 0.1);
      color: #087f9e;
    }

    .pill.purple,
    .tag.purple {
      border-color: rgba(116, 87, 232, 0.18);
      background: rgba(116, 87, 232, 0.1);
      color: #6044d7;
    }

    .pill.green,
    .tag.green {
      border-color: rgba(29, 155, 103, 0.2);
      background: rgba(29, 155, 103, 0.11);
      color: #15744b;
    }

    .status-dot {
      display: inline-flex;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 0 4px rgba(29, 155, 103, 0.12);
    }

    .topbar {
      padding: 18px 20px;
      min-height: 104px;
    }

    .toolbar {
      justify-content: flex-end;
      flex-wrap: wrap;
      margin-left: auto;
    }

    .search {
      display: flex;
      align-items: center;
      gap: 8px;
      width: min(340px, 100%);
      min-height: 38px;
      padding: 8px 11px;
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

    .select {
      min-height: 38px;
      padding: 8px 34px 8px 11px;
      border: 1px solid rgba(255, 255, 255, 0.68);
      border-radius: 8px;
      outline: 0;
      background: rgba(255, 255, 255, 0.62);
      color: var(--ink);
      font-size: 12px;
      font-weight: 800;
    }

    .button,
    .icon-button {
      border: 1px solid rgba(23, 105, 232, 0.14);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.62);
      color: var(--ink);
      box-shadow: 0 8px 18px rgba(26, 40, 80, 0.08);
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 38px;
      padding: 9px 12px;
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
      white-space: nowrap;
    }

    .button.primary {
      border-color: transparent;
      color: #fff;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      box-shadow: 0 10px 22px rgba(23, 105, 232, 0.23);
    }

    .button.ghost,
    .icon-button {
      box-shadow: none;
    }

    .icon-button {
      width: 34px;
      height: 34px;
      padding: 0;
    }

    .icon-button.is-favorite,
    .icon-button.is-favorite .material-symbols-outlined {
      color: #fff;
      border-color: transparent;
      background: linear-gradient(135deg, var(--purple), var(--blue));
      font-variation-settings: "FILL" 1, "wght" 600, "GRAD" 0, "opsz" 24;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(120px, 1fr));
      gap: 10px;
    }

    .metric-card {
      align-items: flex-start;
      padding: 12px;
    }

    .metric-card strong {
      display: block;
      margin-bottom: 4px;
      font-size: 20px;
      line-height: 1;
    }

    .market {
      display: flex;
      min-height: 0;
      flex-direction: column;
      gap: 12px;
      overflow: hidden;
      padding: 16px;
    }

    .market-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-width: 0;
    }

    .agent-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(230px, 1fr));
      gap: 14px;
      overflow: auto;
      padding: 2px 4px 6px 2px;
    }

    .agent-card {
      display: flex;
      min-height: 238px;
      flex-direction: column;
      gap: 12px;
      padding: 15px;
      border-radius: 12px;
      transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
    }

    .agent-card:hover {
      transform: translateY(-2px);
      border-color: rgba(23, 105, 232, 0.24);
      box-shadow: 0 22px 54px rgba(26, 40, 80, 0.16);
    }

    .card-head {
      justify-content: space-between;
      align-items: flex-start;
    }

    .card-title {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 10px;
    }

    .card-copy {
      min-height: 58px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .tag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .card-actions {
      justify-content: space-between;
      margin-top: auto;
    }

    .card-actions .button {
      flex: 1;
    }

    .agent-card.installed {
      border-color: rgba(29, 155, 103, 0.28);
    }

    .drawer {
      position: relative;
    }

    .drawer-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line);
    }

    .drawer-hero {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .drawer-hero .agent-logo {
      width: 44px;
      height: 44px;
    }

    .tool-row,
    .activity-row {
      align-items: flex-start;
      background: rgba(255, 255, 255, 0.52);
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

    .confirm-bar {
      position: fixed;
      left: 50%;
      bottom: 22px;
      z-index: 5;
      display: none;
      align-items: center;
      gap: 12px;
      width: min(520px, calc(100vw - 44px));
      padding: 12px 14px;
      transform: translateX(-50%);
    }

    .confirm-bar.show {
      display: flex;
    }

    .spacer {
      flex: 1 1 auto;
    }

    @media (max-width: 1180px) {
      .workspace {
        grid-template-columns: 220px minmax(0, 1fr);
      }

      .drawer {
        display: none;
      }

      .agent-grid {
        grid-template-columns: repeat(2, minmax(230px, 1fr));
      }
    }

    @media (max-width: 820px) {
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
        height: auto;
        flex-direction: column;
      }

      .topbar,
      .market-head {
        align-items: flex-start;
        flex-direction: column;
      }

      .toolbar,
      .search {
        width: 100%;
      }

      .stats,
      .agent-grid {
        grid-template-columns: 1fr;
      }

      .market,
      .agent-grid {
        overflow: visible;
      }
    }
  </style>
</head>
<body>
  <canvas id="particle-canvas" aria-hidden="true"></canvas>
  <div class="page">
    <div class="workspace">
      <aside class="sidebar glass">
        <div class="brand">
          <div class="brand-mark"><span class="material-symbols-outlined">hub</span></div>
          <div class="truncate">
            <p class="label muted">AgentHub</p>
            <h2>Agent Square</h2>
          </div>
        </div>

        <section class="sidebar-section">
          <div class="section-head">
            <h3>Navigation</h3>
            <span class="pill cyan"><span class="status-dot"></span>Local</span>
          </div>
          <div class="nav-list">
            <div class="nav-item active">
              <div class="icon-tile"><span class="material-symbols-outlined">storefront</span></div>
              <div class="truncate">
                <strong class="small">Marketplace</strong>
                <p class="tiny muted truncate">Browse installable agents</p>
              </div>
            </div>
            <div class="nav-item">
              <div class="icon-tile cyan"><span class="material-symbols-outlined">dashboard</span></div>
              <div class="truncate">
                <strong class="small">Workspace</strong>
                <p class="tiny muted truncate">4 agents added</p>
              </div>
            </div>
            <div class="nav-item">
              <div class="icon-tile purple"><span class="material-symbols-outlined">bookmark</span></div>
              <div class="truncate">
                <strong class="small">Favorites</strong>
                <p class="tiny muted truncate">Saved for review</p>
              </div>
            </div>
          </div>
        </section>

        <section class="sidebar-section">
          <div class="section-head">
            <h3>Categories</h3>
            <span class="tiny muted">Preview filters</span>
          </div>
          <div class="category-list" id="category-list">
            <button class="category-button active" data-category="All" type="button"><span>All agents</span><span class="pill">6</span></button>
            <button class="category-button" data-category="Engineering" type="button"><span>Engineering</span><span class="pill cyan">2</span></button>
            <button class="category-button" data-category="Design" type="button"><span>Design</span><span class="pill purple">1</span></button>
            <button class="category-button" data-category="Operations" type="button"><span>Operations</span><span class="pill green">2</span></button>
            <button class="category-button" data-category="Research" type="button"><span>Research</span><span class="pill">1</span></button>
          </div>
        </section>

        <div class="spacer"></div>
        <section class="sidebar-section glass" style="padding: 12px;">
          <div class="mini-row">
            <span class="label muted">Workspace slots</span>
            <strong class="small">4 / 8</strong>
          </div>
          <div class="progress"><span style="width: 50%"></span></div>
          <p class="small muted">Static preview state only. Install buttons do not call a backend.</p>
        </section>
      </aside>

      <main class="main">
        <header class="topbar glass">
          <div>
            <p class="label muted">Agent market</p>
            <h1>Find the right specialist before a run starts</h1>
            <p class="small muted">Search, compare, favorite, and stage agents for the workspace without leaving the workbench.</p>
          </div>
          <div class="toolbar">
            <label class="search">
              <span class="material-symbols-outlined">search</span>
              <input id="agent-search" aria-label="Search agents" placeholder="Search agents or skills" />
            </label>
            <select class="select" id="sort-select" aria-label="Sort agents">
              <option value="popular">Most installed</option>
              <option value="rating">Highest rated</option>
              <option value="recent">Recently updated</option>
            </select>
            <button class="button ghost" type="button"><span class="material-symbols-outlined">tune</span>Filters</button>
          </div>
        </header>

        <section class="stats">
          <div class="metric-card glass">
            <div class="icon-tile"><span class="material-symbols-outlined">smart_toy</span></div>
            <div>
              <strong>6</strong>
              <span class="small muted">Curated agents</span>
            </div>
          </div>
          <div class="metric-card glass">
            <div class="icon-tile cyan"><span class="material-symbols-outlined">download_done</span></div>
            <div>
              <strong>4</strong>
              <span class="small muted">Workspace ready</span>
            </div>
          </div>
          <div class="metric-card glass">
            <div class="icon-tile purple"><span class="material-symbols-outlined">favorite</span></div>
            <div>
              <strong id="favorite-count">1</strong>
              <span class="small muted">Favorites</span>
            </div>
          </div>
          <div class="metric-card glass">
            <div class="icon-tile green"><span class="material-symbols-outlined">verified</span></div>
            <div>
              <strong>98%</strong>
              <span class="small muted">Policy checks</span>
            </div>
          </div>
        </section>

        <section class="market glass">
          <div class="market-head">
            <div>
              <p class="label muted">Agent catalog</p>
              <h2>Installable specialists</h2>
            </div>
            <span class="pill cyan" id="result-count">Showing 6 agents</span>
          </div>

          <div class="agent-grid" id="agent-grid">
            <article class="agent-card glass installed" data-agent="refactor" data-category="Engineering" data-title="Code Refactor Pro" data-search="code refactor pro engineering typescript react performance architecture" data-installs="14820" data-rating="4.9" data-updated="6">
              <div class="card-head">
                <div class="card-title">
                  <div class="agent-logo"><span class="material-symbols-outlined">code_blocks</span></div>
                  <div class="truncate">
                    <h3 class="truncate">Code Refactor Pro</h3>
                    <p class="tiny muted truncate">Engineering</p>
                  </div>
                </div>
                <button class="icon-button is-favorite" data-favorite="refactor" type="button" aria-label="Toggle favorite"><span class="material-symbols-outlined">favorite</span></button>
              </div>
              <p class="card-copy">Modernizes front-end and Go service modules while keeping reviewable diffs and local style rules visible.</p>
              <div class="tag-row">
                <span class="tag">TypeScript</span>
                <span class="tag cyan">Go</span>
                <span class="tag purple">Review</span>
              </div>
              <div class="mini-row">
                <span class="small muted">4.9 rating</span>
                <span class="small muted">14.8k installs</span>
              </div>
              <div class="card-actions">
                <button class="button primary" data-install="refactor" type="button"><span class="material-symbols-outlined">check_circle</span>Added</button>
                <button class="button ghost" data-detail="refactor" type="button"><span class="material-symbols-outlined">open_in_new</span>Details</button>
              </div>
            </article>

            <article class="agent-card glass" data-agent="designer" data-category="Design" data-title="Interface Critic" data-search="interface critic design accessibility figma layout states" data-installs="9360" data-rating="4.8" data-updated="3">
              <div class="card-head">
                <div class="card-title">
                  <div class="agent-logo purple"><span class="material-symbols-outlined">palette</span></div>
                  <div class="truncate">
                    <h3 class="truncate">Interface Critic</h3>
                    <p class="tiny muted truncate">Design</p>
                  </div>
                </div>
                <button class="icon-button" data-favorite="designer" type="button" aria-label="Toggle favorite"><span class="material-symbols-outlined">favorite</span></button>
              </div>
              <p class="card-copy">Audits tool surfaces for visual hierarchy, responsive density, component states, and accessibility issues.</p>
              <div class="tag-row">
                <span class="tag purple">UI audit</span>
                <span class="tag">A11y</span>
                <span class="tag cyan">Layout</span>
              </div>
              <div class="mini-row">
                <span class="small muted">4.8 rating</span>
                <span class="small muted">9.3k installs</span>
              </div>
              <div class="card-actions">
                <button class="button primary" data-install="designer" type="button"><span class="material-symbols-outlined">add</span>Add</button>
                <button class="button ghost" data-detail="designer" type="button"><span class="material-symbols-outlined">open_in_new</span>Details</button>
              </div>
            </article>

            <article class="agent-card glass" data-agent="qa" data-category="Engineering" data-title="QA Flow Builder" data-search="qa flow builder engineering playwright unit tests smoke checks" data-installs="12840" data-rating="4.7" data-updated="9">
              <div class="card-head">
                <div class="card-title">
                  <div class="agent-logo cyan"><span class="material-symbols-outlined">fact_check</span></div>
                  <div class="truncate">
                    <h3 class="truncate">QA Flow Builder</h3>
                    <p class="tiny muted truncate">Engineering</p>
                  </div>
                </div>
                <button class="icon-button" data-favorite="qa" type="button" aria-label="Toggle favorite"><span class="material-symbols-outlined">favorite</span></button>
              </div>
              <p class="card-copy">Creates targeted smoke checks and regression plans for UI flows, command output, and API contracts.</p>
              <div class="tag-row">
                <span class="tag cyan">Playwright</span>
                <span class="tag">Unit tests</span>
                <span class="tag green">Smoke</span>
              </div>
              <div class="mini-row">
                <span class="small muted">4.7 rating</span>
                <span class="small muted">12.8k installs</span>
              </div>
              <div class="card-actions">
                <button class="button primary" data-install="qa" type="button"><span class="material-symbols-outlined">add</span>Add</button>
                <button class="button ghost" data-detail="qa" type="button"><span class="material-symbols-outlined">open_in_new</span>Details</button>
              </div>
            </article>

            <article class="agent-card glass" data-agent="ops" data-category="Operations" data-title="Runbook Operator" data-search="runbook operator operations incident checklist deploy monitor" data-installs="8700" data-rating="4.6" data-updated="2">
              <div class="card-head">
                <div class="card-title">
                  <div class="agent-logo green"><span class="material-symbols-outlined">terminal</span></div>
                  <div class="truncate">
                    <h3 class="truncate">Runbook Operator</h3>
                    <p class="tiny muted truncate">Operations</p>
                  </div>
                </div>
                <button class="icon-button" data-favorite="ops" type="button" aria-label="Toggle favorite"><span class="material-symbols-outlined">favorite</span></button>
              </div>
              <p class="card-copy">Turns incident notes into stepwise commands, checkpoints, rollback prompts, and operator handoff notes.</p>
              <div class="tag-row">
                <span class="tag green">Runbook</span>
                <span class="tag">Deploy</span>
                <span class="tag cyan">Monitor</span>
              </div>
              <div class="mini-row">
                <span class="small muted">4.6 rating</span>
                <span class="small muted">8.7k installs</span>
              </div>
              <div class="card-actions">
                <button class="button primary" data-install="ops" type="button"><span class="material-symbols-outlined">add</span>Add</button>
                <button class="button ghost" data-detail="ops" type="button"><span class="material-symbols-outlined">open_in_new</span>Details</button>
              </div>
            </article>

            <article class="agent-card glass" data-agent="research" data-category="Research" data-title="Evidence Synthesizer" data-search="evidence synthesizer research citations source analysis summary" data-installs="10320" data-rating="4.9" data-updated="5">
              <div class="card-head">
                <div class="card-title">
                  <div class="agent-logo purple"><span class="material-symbols-outlined">travel_explore</span></div>
                  <div class="truncate">
                    <h3 class="truncate">Evidence Synthesizer</h3>
                    <p class="tiny muted truncate">Research</p>
                  </div>
                </div>
                <button class="icon-button" data-favorite="research" type="button" aria-label="Toggle favorite"><span class="material-symbols-outlined">favorite</span></button>
              </div>
              <p class="card-copy">Groups sources into claims, caveats, contradictions, and concise handoff notes for project decisions.</p>
              <div class="tag-row">
                <span class="tag purple">Sources</span>
                <span class="tag">Citations</span>
                <span class="tag cyan">Summary</span>
              </div>
              <div class="mini-row">
                <span class="small muted">4.9 rating</span>
                <span class="small muted">10.3k installs</span>
              </div>
              <div class="card-actions">
                <button class="button primary" data-install="research" type="button"><span class="material-symbols-outlined">add</span>Add</button>
                <button class="button ghost" data-detail="research" type="button"><span class="material-symbols-outlined">open_in_new</span>Details</button>
              </div>
            </article>

            <article class="agent-card glass" data-agent="release" data-category="Operations" data-title="Release Steward" data-search="release steward operations changelog validation branch pr checklist" data-installs="7600" data-rating="4.5" data-updated="8">
              <div class="card-head">
                <div class="card-title">
                  <div class="agent-logo"><span class="material-symbols-outlined">rocket_launch</span></div>
                  <div class="truncate">
                    <h3 class="truncate">Release Steward</h3>
                    <p class="tiny muted truncate">Operations</p>
                  </div>
                </div>
                <button class="icon-button" data-favorite="release" type="button" aria-label="Toggle favorite"><span class="material-symbols-outlined">favorite</span></button>
              </div>
              <p class="card-copy">Collects branch status, validation commands, changelog points, and merge readiness into one release card.</p>
              <div class="tag-row">
                <span class="tag">PR</span>
                <span class="tag cyan">Validation</span>
                <span class="tag green">Changelog</span>
              </div>
              <div class="mini-row">
                <span class="small muted">4.5 rating</span>
                <span class="small muted">7.6k installs</span>
              </div>
              <div class="card-actions">
                <button class="button primary" data-install="release" type="button"><span class="material-symbols-outlined">add</span>Add</button>
                <button class="button ghost" data-detail="release" type="button"><span class="material-symbols-outlined">open_in_new</span>Details</button>
              </div>
            </article>
          </div>
        </section>
      </main>

      <aside class="drawer glass" id="detail-drawer">
        <div class="drawer-header">
          <div>
            <p class="label muted">Agent detail</p>
            <h2 id="drawer-title">Code Refactor Pro</h2>
          </div>
          <button class="icon-button" id="drawer-close" type="button" aria-label="Close detail"><span class="material-symbols-outlined">close</span></button>
        </div>

        <section class="drawer-section">
          <div class="drawer-hero">
            <div class="agent-logo" id="drawer-logo"><span class="material-symbols-outlined">code_blocks</span></div>
            <div>
              <span class="pill cyan" id="drawer-category">Engineering</span>
              <p class="small muted" id="drawer-short">Modernizes code with project rules.</p>
            </div>
          </div>
          <p class="small muted" id="drawer-description">Modernizes front-end and Go service modules while keeping reviewable diffs and local style rules visible.</p>
          <div class="mini-row">
            <span class="small muted">Rating</span>
            <strong class="small" id="drawer-rating">4.9 / 5</strong>
          </div>
          <div class="mini-row">
            <span class="small muted">Installs</span>
            <strong class="small" id="drawer-installs">14.8k</strong>
          </div>
        </section>

        <section class="drawer-section">
          <div class="section-head">
            <h3>Expected output</h3>
            <span class="pill purple">Preview</span>
          </div>
          <div class="tool-list" id="drawer-tools">
            <div class="tool-row">
              <div class="icon-tile"><span class="material-symbols-outlined">difference</span></div>
              <div>
                <strong class="small">Reviewable patch</strong>
                <p class="tiny muted">Scoped diff with local conventions respected.</p>
              </div>
            </div>
            <div class="tool-row">
              <div class="icon-tile cyan"><span class="material-symbols-outlined">checklist</span></div>
              <div>
                <strong class="small">Validation notes</strong>
                <p class="tiny muted">Commands and residual risk are surfaced.</p>
              </div>
            </div>
          </div>
        </section>

        <section class="drawer-section">
          <div class="section-head">
            <h3>Visible states</h3>
            <span class="pill green"><span class="status-dot"></span>Ready</span>
          </div>
          <div class="activity-list">
            <div class="activity-row">
              <div class="icon-tile purple"><span class="material-symbols-outlined">favorite</span></div>
              <div>
                <strong class="small">Favorite state</strong>
                <p class="tiny muted">Heart buttons toggle the saved visual state.</p>
              </div>
            </div>
            <div class="activity-row">
              <div class="icon-tile green"><span class="material-symbols-outlined">download_done</span></div>
              <div>
                <strong class="small">Workspace add state</strong>
                <p class="tiny muted">Install buttons reveal a confirmation bar.</p>
              </div>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </div>

  <div class="confirm-bar glass" id="confirm-bar">
    <div class="icon-tile green"><span class="material-symbols-outlined">download_done</span></div>
    <div class="truncate">
      <strong class="small" id="confirm-title">Agent added to workspace</strong>
      <p class="tiny muted truncate">This is a local preview state. No API request was sent.</p>
    </div>
  </div>

  <script>
    (function () {
      var agentData = {
        refactor: {
          title: "Code Refactor Pro",
          category: "Engineering",
          icon: "code_blocks",
          tone: "",
          short: "Modernizes code with project rules.",
          description: "Modernizes front-end and Go service modules while keeping reviewable diffs and local style rules visible.",
          rating: "4.9 / 5",
          installs: "14.8k",
          tools: [
            ["difference", "Reviewable patch", "Scoped diff with local conventions respected.", ""],
            ["checklist", "Validation notes", "Commands and residual risk are surfaced.", "cyan"]
          ]
        },
        designer: {
          title: "Interface Critic",
          category: "Design",
          icon: "palette",
          tone: "purple",
          short: "Reviews layout, states, and accessibility.",
          description: "Audits tool surfaces for visual hierarchy, responsive density, component states, and accessibility issues.",
          rating: "4.8 / 5",
          installs: "9.3k",
          tools: [
            ["layers", "Hierarchy pass", "Flags unclear grouping and nested card problems.", "purple"],
            ["accessibility_new", "Accessibility pass", "Checks labels, contrast, and keyboard-visible states.", ""]
          ]
        },
        qa: {
          title: "QA Flow Builder",
          category: "Engineering",
          icon: "fact_check",
          tone: "cyan",
          short: "Builds targeted checks for risky flows.",
          description: "Creates targeted smoke checks and regression plans for UI flows, command output, and API contracts.",
          rating: "4.7 / 5",
          installs: "12.8k",
          tools: [
            ["rule", "Test plan", "Maps visible UI states to focused checks.", "cyan"],
            ["play_circle", "Smoke steps", "Keeps manual verification steps concise.", "green"]
          ]
        },
        ops: {
          title: "Runbook Operator",
          category: "Operations",
          icon: "terminal",
          tone: "green",
          short: "Turns incidents into safe operating steps.",
          description: "Turns incident notes into stepwise commands, checkpoints, rollback prompts, and operator handoff notes.",
          rating: "4.6 / 5",
          installs: "8.7k",
          tools: [
            ["terminal", "Command plan", "Sequences routine commands with checkpoints.", "green"],
            ["undo", "Rollback prompts", "Keeps recovery steps visible before execution.", ""]
          ]
        },
        research: {
          title: "Evidence Synthesizer",
          category: "Research",
          icon: "travel_explore",
          tone: "purple",
          short: "Condenses sources into decision notes.",
          description: "Groups sources into claims, caveats, contradictions, and concise handoff notes for project decisions.",
          rating: "4.9 / 5",
          installs: "10.3k",
          tools: [
            ["format_quote", "Claim map", "Separates evidence from inference.", "purple"],
            ["source", "Source trail", "Keeps citation context attached.", "cyan"]
          ]
        },
        release: {
          title: "Release Steward",
          category: "Operations",
          icon: "rocket_launch",
          tone: "",
          short: "Collects release readiness into one card.",
          description: "Collects branch status, validation commands, changelog points, and merge readiness into one release card.",
          rating: "4.5 / 5",
          installs: "7.6k",
          tools: [
            ["merge", "Merge summary", "Highlights branch and validation state.", ""],
            ["newspaper", "Changelog draft", "Turns work notes into release bullets.", "cyan"]
          ]
        }
      };

      var canvas = document.getElementById("particle-canvas");
      var ctx = canvas.getContext("2d");
      var particles = [];
      var particleCount = 56;
      var width = 0;
      var height = 0;
      var frame = 0;

      function resizeCanvas() {
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
          r: 1.4 + Math.random() * 2.4,
          vx: -0.16 + Math.random() * 0.32,
          vy: -0.14 - Math.random() * 0.42,
          hue: index % 2 === 0 ? 196 : 211,
          alpha: 0.16 + Math.random() * 0.18
        };
      }

      function seedParticles() {
        particles = [];
        for (var i = 0; i < particleCount; i += 1) {
          particles.push(makeParticle(i));
        }
      }

      function drawParticles() {
        frame = window.requestAnimationFrame(drawParticles);
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
            if (distance < 124) {
              ctx.beginPath();
              ctx.strokeStyle = "rgba(23, 105, 232, " + ((1 - distance / 124) * 0.06) + ")";
              ctx.lineWidth = 1;
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(q.x, q.y);
              ctx.stroke();
            }
          }
        }
      }

      function setDrawer(agentId) {
        var agent = agentData[agentId];
        if (!agent) {
          return;
        }
        var logo = document.getElementById("drawer-logo");
        document.getElementById("drawer-title").textContent = agent.title;
        document.getElementById("drawer-category").textContent = agent.category;
        document.getElementById("drawer-short").textContent = agent.short;
        document.getElementById("drawer-description").textContent = agent.description;
        document.getElementById("drawer-rating").textContent = agent.rating;
        document.getElementById("drawer-installs").textContent = agent.installs;
        logo.className = "agent-logo " + agent.tone;
        logo.innerHTML = '<span class="material-symbols-outlined">' + agent.icon + "</span>";

        var tools = document.getElementById("drawer-tools");
        tools.innerHTML = "";
        agent.tools.forEach(function (tool) {
          var row = document.createElement("div");
          row.className = "tool-row";
          row.innerHTML = '<div class="icon-tile ' + tool[3] + '"><span class="material-symbols-outlined">' + tool[0] + '</span></div><div><strong class="small">' + tool[1] + '</strong><p class="tiny muted">' + tool[2] + '</p></div>';
          tools.appendChild(row);
        });
      }

      function updateFavoriteCount() {
        document.getElementById("favorite-count").textContent = String(document.querySelectorAll("[data-favorite].is-favorite").length);
      }

      function showConfirmation(title) {
        var bar = document.getElementById("confirm-bar");
        document.getElementById("confirm-title").textContent = title + " added to workspace";
        bar.classList.add("show");
        window.clearTimeout(showConfirmation.timer);
        showConfirmation.timer = window.setTimeout(function () {
          bar.classList.remove("show");
        }, 2600);
      }

      function applyFilters() {
        var activeCategory = document.querySelector(".category-button.active").getAttribute("data-category");
        var query = document.getElementById("agent-search").value.trim().toLowerCase();
        var grid = document.getElementById("agent-grid");
        var cards = Array.prototype.slice.call(grid.querySelectorAll(".agent-card"));
        var sortValue = document.getElementById("sort-select").value;
        var visible = 0;

        cards.sort(function (a, b) {
          if (sortValue === "rating") {
            return Number(b.getAttribute("data-rating")) - Number(a.getAttribute("data-rating"));
          }
          if (sortValue === "recent") {
            return Number(a.getAttribute("data-updated")) - Number(b.getAttribute("data-updated"));
          }
          return Number(b.getAttribute("data-installs")) - Number(a.getAttribute("data-installs"));
        });

        cards.forEach(function (card) {
          var matchesCategory = activeCategory === "All" || card.getAttribute("data-category") === activeCategory;
          var matchesQuery = !query || card.getAttribute("data-search").indexOf(query) >= 0;
          var shouldShow = matchesCategory && matchesQuery;
          card.style.display = shouldShow ? "flex" : "none";
          if (shouldShow) {
            visible += 1;
          }
          grid.appendChild(card);
        });

        document.getElementById("result-count").textContent = "Showing " + visible + " agents";
      }

      document.querySelectorAll("[data-favorite]").forEach(function (button) {
        button.addEventListener("click", function () {
          button.classList.toggle("is-favorite");
          updateFavoriteCount();
        });
      });

      document.querySelectorAll("[data-install]").forEach(function (button) {
        button.addEventListener("click", function () {
          var card = button.closest(".agent-card");
          var title = card.getAttribute("data-title");
          card.classList.add("installed");
          button.innerHTML = '<span class="material-symbols-outlined">check_circle</span>Added';
          showConfirmation(title);
        });
      });

      document.querySelectorAll("[data-detail]").forEach(function (button) {
        button.addEventListener("click", function () {
          setDrawer(button.getAttribute("data-detail"));
        });
      });

      document.querySelectorAll(".category-button").forEach(function (button) {
        button.addEventListener("click", function () {
          document.querySelectorAll(".category-button").forEach(function (item) {
            item.classList.remove("active");
          });
          button.classList.add("active");
          applyFilters();
        });
      });

      document.getElementById("agent-search").addEventListener("input", applyFilters);
      document.getElementById("sort-select").addEventListener("change", applyFilters);
      document.getElementById("drawer-close").addEventListener("click", function () {
        setDrawer("refactor");
      });

      resizeCanvas();
      seedParticles();
      drawParticles();
      window.addEventListener("resize", function () {
        window.cancelAnimationFrame(frame);
        resizeCanvas();
        seedParticles();
        drawParticles();
      });
    })();
  </script>
</body>
</html>
`;

export function AgentSquarePage() {
  return (
    <iframe
      title="Agent Square"
      srcDoc={pageHtml}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      style={{ width: "100%", height: "100vh", border: 0, display: "block" }}
    />
  );
}

export default AgentSquarePage;
