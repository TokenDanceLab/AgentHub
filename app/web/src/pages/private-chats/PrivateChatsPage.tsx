const pageHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentHub Private Chats</title>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400,0,0" rel="stylesheet" />
    <style>
      :root {
        --surface: #eef6ff;
        --surface-2: #f7fbff;
        --ink: #172033;
        --muted: #667085;
        --line: rgba(134, 157, 190, 0.24);
        --glass: rgba(255, 255, 255, 0.72);
        --blue: #2563eb;
        --cyan: #0891b2;
        --purple: #7c3aed;
        --green: #059669;
        --shadow: 0 18px 48px rgba(26, 40, 80, 0.14);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
      }

      body {
        overflow: hidden;
        background:
          radial-gradient(circle at 14% 8%, rgba(37, 99, 235, 0.16), transparent 34%),
          radial-gradient(circle at 82% 16%, rgba(8, 145, 178, 0.12), transparent 32%),
          linear-gradient(135deg, #f8fbff 0%, var(--surface) 58%, #f5f3ff 100%);
        color: var(--ink);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
          sans-serif;
      }

      button,
      textarea,
      input {
        font: inherit;
      }

      button {
        cursor: pointer;
      }

      .material-symbols-rounded {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        line-height: 1;
        font-variation-settings: "FILL" 0, "wght" 450, "GRAD" 0, "opsz" 24;
      }

      #antigravity-particles {
        position: fixed;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        opacity: 0.72;
      }

      .shell {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 292px minmax(480px, 1fr) 336px;
        gap: 16px;
        height: 100vh;
        padding: 18px;
      }

      .glass {
        background: var(--glass);
        border: 1px solid rgba(255, 255, 255, 0.7);
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
      .context-panel,
      .chat-panel {
        display: flex;
        flex-direction: column;
      }

      .sidebar-header,
      .context-header,
      .chat-header {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 0 0 auto;
        min-height: 68px;
        padding: 14px 16px;
        border-bottom: 1px solid var(--line);
      }

      .back-button,
      .icon-button,
      .tool-button,
      .send-button,
      .chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(132, 155, 190, 0.24);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.62);
        color: var(--ink);
        box-shadow: 0 8px 20px rgba(31, 57, 102, 0.08);
      }

      .back-button {
        width: 34px;
        height: 34px;
      }

      .icon-button,
      .tool-button {
        width: 34px;
        height: 34px;
        flex: 0 0 auto;
      }

      .tool-button.active,
      .icon-button.active {
        border-color: rgba(37, 99, 235, 0.34);
        background: rgba(37, 99, 235, 0.1);
        color: var(--blue);
      }

      .brand {
        min-width: 0;
      }

      .eyebrow,
      .meta,
      .section-title {
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .brand h1,
      .chat-title h2,
      .context-title h2 {
        margin: 0;
        color: var(--ink);
        font-size: 18px;
        line-height: 1.2;
      }

      .brand p,
      .chat-title p,
      .context-title p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 12px;
      }

      .search {
        position: relative;
        padding: 12px 14px 8px;
      }

      .search .material-symbols-rounded {
        position: absolute;
        top: 21px;
        left: 25px;
        color: #7b8aa4;
        font-size: 18px;
      }

      .search input {
        width: 100%;
        height: 36px;
        border: 1px solid rgba(132, 155, 190, 0.24);
        border-radius: 8px;
        outline: 0;
        padding: 0 12px 0 34px;
        background: rgba(255, 255, 255, 0.68);
        color: var(--ink);
      }

      .section-title {
        padding: 10px 16px 8px;
      }

      .chat-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
        overflow-y: auto;
        padding: 0 10px 16px;
      }

      .chat-card {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        min-height: 64px;
        border: 1px solid transparent;
        border-radius: 12px;
        padding: 10px;
        background: rgba(255, 255, 255, 0.45);
      }

      .chat-card.active {
        border-color: rgba(37, 99, 235, 0.28);
        background: linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(8, 145, 178, 0.08));
      }

      .avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        flex: 0 0 36px;
        border-radius: 10px;
        background: linear-gradient(135deg, var(--blue), var(--cyan));
        color: #fff;
        font-size: 12px;
        font-weight: 800;
        box-shadow: 0 10px 22px rgba(37, 99, 235, 0.24);
      }

      .avatar.purple {
        background: linear-gradient(135deg, var(--purple), #0ea5e9);
      }

      .avatar.cyan {
        background: linear-gradient(135deg, var(--cyan), #22c55e);
      }

      .chat-card h3,
      .message-meta strong {
        margin: 0;
        font-size: 13px;
        line-height: 1.2;
      }

      .chat-card p {
        margin: 4px 0 0;
        overflow: hidden;
        color: var(--muted);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .time {
        color: #7f8aa3;
        font-size: 11px;
        white-space: nowrap;
      }

      .unread {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        margin-top: 6px;
        border-radius: 999px;
        background: var(--blue);
        color: #fff;
        font-size: 11px;
        font-weight: 800;
      }

      .chat-header {
        justify-content: space-between;
      }

      .chat-heading {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 24px;
        padding: 0 9px;
        border-radius: 999px;
        background: rgba(5, 150, 105, 0.1);
        color: var(--green);
        font-size: 11px;
        font-weight: 800;
      }

      .status::before {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: currentColor;
        content: "";
      }

      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .messages {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 14px;
        min-height: 0;
        overflow-y: auto;
        padding: 18px 18px 12px;
      }

      .message-row {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
        max-width: 78%;
      }

      .message-row.mine {
        align-self: flex-end;
        grid-template-columns: minmax(0, 1fr) 36px;
      }

      .message-row.mine .avatar {
        grid-column: 2;
        grid-row: 1;
        background: linear-gradient(135deg, #1d4ed8, var(--purple));
      }

      .message-row.mine .message-stack {
        grid-column: 1;
        grid-row: 1;
      }

      .message-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 6px;
        color: var(--muted);
        font-size: 11px;
      }

      .message-row.mine .message-meta {
        justify-content: flex-end;
      }

      .bubble {
        border: 1px solid rgba(255, 255, 255, 0.7);
        border-radius: 12px;
        padding: 12px 14px;
        background: rgba(255, 255, 255, 0.74);
        box-shadow: 0 10px 26px rgba(31, 57, 102, 0.09);
        color: #22304a;
        font-size: 14px;
        line-height: 1.5;
      }

      .message-row.mine .bubble {
        border-color: rgba(37, 99, 235, 0.36);
        background: linear-gradient(135deg, rgba(37, 99, 235, 0.92), rgba(8, 145, 178, 0.9));
        color: #fff;
      }

      .quote {
        margin-bottom: 10px;
        border-left: 3px solid var(--cyan);
        padding: 8px 10px;
        border-radius: 8px;
        background: rgba(8, 145, 178, 0.08);
        color: #345064;
      }

      .code-card {
        margin-top: 10px;
        overflow: hidden;
        border: 1px solid rgba(23, 32, 51, 0.1);
        border-radius: 10px;
        background: #111827;
        color: #d7e5ff;
      }

      .code-card header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 34px;
        padding: 0 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        color: #9fb4d8;
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 12px;
      }

      pre {
        margin: 0;
        overflow-x: auto;
        padding: 10px;
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 12px;
        line-height: 1.55;
      }

      .attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }

      .attachment {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        border: 1px solid rgba(132, 155, 190, 0.24);
        border-radius: 8px;
        padding: 6px 10px;
        background: rgba(255, 255, 255, 0.68);
        color: #344055;
        font-size: 12px;
      }

      .composer-wrap {
        flex: 0 0 auto;
        padding: 0 18px 18px;
      }

      .composer {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 10px;
        align-items: end;
        min-height: 88px;
        padding: 12px;
      }

      .composer-tools,
      .composer-actions {
        display: flex;
        gap: 8px;
      }

      .composer textarea {
        min-height: 58px;
        max-height: 130px;
        resize: none;
        border: 1px solid rgba(132, 155, 190, 0.2);
        border-radius: 10px;
        outline: 0;
        padding: 12px 14px;
        background: rgba(255, 255, 255, 0.64);
        color: var(--ink);
        line-height: 1.45;
      }

      .send-button {
        height: 36px;
        gap: 8px;
        padding: 0 14px;
        border-color: rgba(37, 99, 235, 0.34);
        background: linear-gradient(135deg, var(--blue), var(--cyan));
        color: #fff;
        font-weight: 800;
      }

      .context-header {
        justify-content: space-between;
      }

      .context-body {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
        overflow-y: auto;
        padding: 14px;
      }

      .mini-card {
        border: 1px solid rgba(132, 155, 190, 0.22);
        border-radius: 12px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.55);
      }

      .mini-card h3 {
        margin: 0 0 8px;
        font-size: 13px;
      }

      .mini-card p,
      .mini-card li {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }

      .mini-card p {
        margin: 0;
      }

      .mini-card ul {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .chip {
        min-height: 28px;
        padding: 0 9px;
        color: #40516f;
        font-size: 12px;
        box-shadow: none;
      }

      .progress {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(37, 99, 235, 0.1);
      }

      .progress span {
        display: block;
        width: 68%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--blue), var(--cyan), var(--purple));
      }

      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      ::-webkit-scrollbar-track {
        background: transparent;
      }

      ::-webkit-scrollbar-thumb {
        border: 2px solid transparent;
        border-radius: 999px;
        background: rgba(97, 119, 154, 0.28);
        background-clip: padding-box;
      }

      @media (max-width: 1120px) {
        .shell {
          grid-template-columns: 260px minmax(0, 1fr);
        }

        .context-panel {
          display: none;
        }

        .message-row {
          max-width: 88%;
        }
      }

      @media (max-width: 760px) {
        body {
          overflow: auto;
        }

        .shell {
          grid-template-columns: 1fr;
          height: auto;
          min-height: 100vh;
          padding: 12px;
        }

        .sidebar {
          max-height: 260px;
        }

        .chat-panel {
          min-height: 680px;
        }
      }
    </style>
  </head>
  <body>
    <canvas id="antigravity-particles" aria-hidden="true"></canvas>

    <div class="shell">
      <aside class="sidebar glass panel">
        <header class="sidebar-header">
          <button class="back-button" type="button" aria-label="Back to workspace">
            <span class="material-symbols-rounded">arrow_back</span>
          </button>
          <div class="brand">
            <div class="eyebrow">AgentHub</div>
            <h1>Private Chats</h1>
            <p>Direct coordination workspace</p>
          </div>
        </header>

        <div class="search">
          <span class="material-symbols-rounded">search</span>
          <input type="search" value="routing handoff" aria-label="Search private chats" />
        </div>

        <div class="section-title">Pinned Threads</div>
        <div class="chat-list">
          <article class="chat-card active">
            <div class="avatar">MC</div>
            <div>
              <h3>Mira Chen</h3>
              <p>Route map, guard states, and handoff notes</p>
            </div>
            <div>
              <div class="time">10:42</div>
              <div class="unread">3</div>
            </div>
          </article>

          <article class="chat-card">
            <div class="avatar purple">DX</div>
            <div>
              <h3>Devon Xu</h3>
              <p>Diff preview is ready for another pass</p>
            </div>
            <div class="time">09:58</div>
          </article>

          <article class="chat-card">
            <div class="avatar cyan">AL</div>
            <div>
              <h3>Aria Lin</h3>
              <p>Client runner smoke test notes attached</p>
            </div>
            <div class="time">09:31</div>
          </article>

          <article class="chat-card">
            <div class="avatar">QA</div>
            <div>
              <h3>QA Relay</h3>
              <p>Two assertions still need local validation</p>
            </div>
            <div class="time">Mon</div>
          </article>
        </div>
      </aside>

      <main class="chat-panel glass panel">
        <header class="chat-header">
          <div class="chat-heading">
            <div class="avatar">MC</div>
            <div class="chat-title">
              <h2>Mira Chen</h2>
              <p>Frontend page coordinator - private thread</p>
            </div>
            <span class="status">Online</span>
          </div>
          <div class="actions">
            <button class="icon-button active" type="button" aria-label="Mark thread important">
              <span class="material-symbols-rounded">star</span>
            </button>
            <button class="icon-button" type="button" aria-label="Open attachments">
              <span class="material-symbols-rounded">attach_file</span>
            </button>
            <button class="icon-button" type="button" aria-label="More actions">
              <span class="material-symbols-rounded">more_horiz</span>
            </button>
          </div>
        </header>

        <section class="messages" aria-label="Message thread">
          <article class="message-row mine">
            <div class="avatar">ME</div>
            <div class="message-stack">
              <div class="message-meta"><span>10:24</span><strong>You</strong></div>
              <div class="bubble">
                Can you sanity-check the private chat layout before I hand it to the page preview branch?
              </div>
            </div>
          </article>

          <article class="message-row">
            <div class="avatar">MC</div>
            <div class="message-stack">
              <div class="message-meta"><strong>Mira Chen</strong><span>10:26</span></div>
              <div class="bubble">
                The main issue is density. The previous shell spent too much space on generic project chrome, so I would keep the left rail focused on people, unread state, and current handoff context.
                <div class="quote">
                  <strong>Quoted decision</strong><br />
                  Keep this page as a direct-chat work surface. Route previews and real API wiring can come later.
                </div>
              </div>
            </div>
          </article>

          <article class="message-row">
            <div class="avatar">MC</div>
            <div class="message-stack">
              <div class="message-meta"><strong>Mira Chen</strong><span>10:31</span></div>
              <div class="bubble">
                I also tightened the action buttons so icons sit on a fixed 34px grid and never drift into the message title.
                <div class="attachments">
                  <span class="attachment"><span class="material-symbols-rounded">description</span>handoff-notes.md</span>
                  <span class="attachment"><span class="material-symbols-rounded">image</span>message-layout.png</span>
                </div>
              </div>
            </div>
          </article>

          <article class="message-row mine">
            <div class="avatar">ME</div>
            <div class="message-stack">
              <div class="message-meta"><span>10:38</span><strong>You</strong></div>
              <div class="bubble">
                Good. I am keeping the iframe preview static and adding a React copy for stateful interactions.
                <div class="code-card">
                  <header><span>PrivateChatsPageReact.tsx</span><span>draft</span></header>
                  <pre><code>const [activeChatId, setActiveChatId] = useState("mira");
const [attachmentsOpen, setAttachmentsOpen] = useState(false);
const [keyedMessages, setKeyedMessages] = useState(["mira-2"]);</code></pre>
                </div>
              </div>
            </div>
          </article>

          <article class="message-row">
            <div class="avatar">MC</div>
            <div class="message-stack">
              <div class="message-meta"><strong>Mira Chen</strong><span>10:42</span></div>
              <div class="bubble">
                That gives reviewers both views: the HTML shell for visual preview and a normal React component that can evolve into the real implementation.
              </div>
            </div>
          </article>
        </section>

        <div class="composer-wrap">
          <form class="composer glass">
            <div class="composer-tools">
              <button class="tool-button active" type="button" aria-label="Attach file">
                <span class="material-symbols-rounded">add</span>
              </button>
              <button class="tool-button" type="button" aria-label="Insert code">
                <span class="material-symbols-rounded">code</span>
              </button>
              <button class="tool-button" type="button" aria-label="Quote message">
                <span class="material-symbols-rounded">format_quote</span>
              </button>
            </div>
            <textarea aria-label="Message Mira" placeholder="Write a private note, paste a code fragment, or attach handoff context..."></textarea>
            <div class="composer-actions">
              <button class="tool-button" type="button" aria-label="Voice note">
                <span class="material-symbols-rounded">mic</span>
              </button>
              <button class="send-button" type="button">
                <span class="material-symbols-rounded">send</span>
                Send
              </button>
            </div>
          </form>
        </div>
      </main>

      <aside class="context-panel glass panel">
        <header class="context-header">
          <div class="context-title">
            <div class="eyebrow">Thread Context</div>
            <h2>Handoff Pack</h2>
            <p>4 linked items - 68% reviewed</p>
          </div>
          <button class="icon-button" type="button" aria-label="Open context">
            <span class="material-symbols-rounded">open_in_new</span>
          </button>
        </header>

        <div class="context-body">
          <section class="mini-card">
            <h3>Review Progress</h3>
            <div class="progress"><span></span></div>
            <p style="margin-top: 10px;">Message spacing, tool buttons, and composer states are ready for visual review.</p>
          </section>

          <section class="mini-card">
            <h3>Attachments</h3>
            <ul>
              <li>handoff-notes.md - private chat acceptance notes</li>
              <li>message-layout.png - bubble and composer spacing</li>
              <li>route-map.ts - local preview route draft</li>
            </ul>
          </section>

          <section class="mini-card">
            <h3>Code Snippets</h3>
            <div class="code-card">
              <header><span>composer-state.ts</span><span>local</span></header>
              <pre><code>sendDraft();
toggleAttachments();
markMessageKey(messageId);</code></pre>
            </div>
          </section>

          <section class="mini-card">
            <h3>Tags</h3>
            <div class="chip-row">
              <span class="chip">private-chat</span>
              <span class="chip">frontend</span>
              <span class="chip">handoff</span>
              <span class="chip">preview</span>
            </div>
          </section>
        </div>
      </aside>
    </div>

    <script>
      (() => {
        const canvas = document.getElementById("antigravity-particles");
        const context = canvas.getContext("2d");
        const particleCount = 56;
        const particles = [];
        let width = 0;
        let height = 0;
        let frameId = 0;

        const makeParticle = (index) => ({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
          radius: 1.4 + Math.random() * 1.8,
          color: index % 3 === 0 ? "37, 99, 235" : "8, 145, 178",
        });

        const resize = () => {
          const ratio = window.devicePixelRatio || 1;
          width = window.innerWidth;
          height = window.innerHeight;
          canvas.width = Math.floor(width * ratio);
          canvas.height = Math.floor(height * ratio);
          canvas.style.width = width + "px";
          canvas.style.height = height + "px";
          context.setTransform(ratio, 0, 0, ratio, 0, 0);

          if (particles.length === 0) {
            for (let index = 0; index < particleCount; index += 1) {
              particles.push(makeParticle(index));
            }
          }
        };

        const tick = () => {
          context.clearRect(0, 0, width, height);

          for (let index = 0; index < particles.length; index += 1) {
            const particle = particles[index];
            particle.x += particle.vx;
            particle.y += particle.vy;

            if (particle.x < -20) particle.x = width + 20;
            if (particle.x > width + 20) particle.x = -20;
            if (particle.y < -20) particle.y = height + 20;
            if (particle.y > height + 20) particle.y = -20;

            context.beginPath();
            context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            context.fillStyle = "rgba(" + particle.color + ", 0.28)";
            context.fill();

            for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
              const next = particles[nextIndex];
              const dx = particle.x - next.x;
              const dy = particle.y - next.y;
              const distance = Math.sqrt(dx * dx + dy * dy);

              if (distance < 128) {
                context.beginPath();
                context.moveTo(particle.x, particle.y);
                context.lineTo(next.x, next.y);
                context.strokeStyle = "rgba(37, 99, 235, " + (0.1 * (1 - distance / 128)).toFixed(3) + ")";
                context.lineWidth = 1;
                context.stroke();
              }
            }
          }

          frameId = window.requestAnimationFrame(tick);
        };

        resize();
        tick();
        window.addEventListener("resize", resize);
        window.addEventListener("beforeunload", () => window.cancelAnimationFrame(frameId));
      })();
    </script>
  </body>
</html>`;

export function PrivateChatsPage() {
  return (
    <iframe
      title="Private Chats"
      srcDoc={pageHtml}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      style={{ width: "100%", height: "100vh", border: 0, display: "block" }}
    />
  );
}

export default PrivateChatsPage;
