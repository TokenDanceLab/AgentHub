import { useEffect, useMemo, useRef, useState } from 'react';

type Accent = 'blue' | 'cyan' | 'purple';

type Attachment = {
  name: string;
  detail: string;
};

type CodeBlock = {
  file: string;
  lines: string[];
};

type QuoteBlock = {
  title: string;
  body: string;
};

type Message = {
  id: string;
  author: string;
  role: string;
  time: string;
  side: 'left' | 'right';
  body: string;
  accent?: Accent;
  attachments?: Attachment[];
  code?: CodeBlock;
  quote?: QuoteBlock;
  isDraft?: boolean;
};

type Conversation = {
  id: string;
  name: string;
  initials: string;
  role: string;
  time: string;
  summary: string;
  unread: number;
  accent: Accent;
  messages: Message[];
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
};

const conversations: Conversation[] = [
  {
    id: 'mira',
    name: 'Mira Chen',
    initials: 'MC',
    role: 'Frontend page coordinator',
    time: '10:42',
    summary: 'Route map, guard states, and handoff notes',
    unread: 3,
    accent: 'blue',
    messages: [
      {
        id: 'mira-1',
        author: 'You',
        role: 'Owner',
        time: '10:24',
        side: 'right',
        body: 'Can you sanity-check the private chat layout before I hand it to the page preview branch?',
      },
      {
        id: 'mira-2',
        author: 'Mira Chen',
        role: 'Coordinator',
        time: '10:26',
        side: 'left',
        accent: 'blue',
        body: 'The main issue is density. Keep the left rail focused on people, unread state, and current handoff context.',
        quote: {
          title: 'Quoted decision',
          body: 'Keep this page as a direct-chat work surface. Route previews and real API wiring can come later.',
        },
      },
      {
        id: 'mira-3',
        author: 'Mira Chen',
        role: 'Coordinator',
        time: '10:31',
        side: 'left',
        accent: 'blue',
        body: 'I tightened the action buttons so icons sit on a fixed grid and never drift into the message title.',
        attachments: [
          { name: 'handoff-notes.md', detail: '12 KB' },
          { name: 'message-layout.png', detail: 'Preview' },
        ],
      },
      {
        id: 'mira-4',
        author: 'You',
        role: 'Owner',
        time: '10:38',
        side: 'right',
        body: 'Good. I am keeping the iframe preview static and adding a React copy for stateful interactions.',
        code: {
          file: 'PrivateChatsPageReact.tsx',
          lines: [
            'const [activeChatId, setActiveChatId] = useState("mira");',
            'const [attachmentsOpen, setAttachmentsOpen] = useState(false);',
            'const [keyedMessages, setKeyedMessages] = useState(["mira-2"]);',
          ],
        },
      },
    ],
  },
  {
    id: 'devon',
    name: 'Devon Xu',
    initials: 'DX',
    role: 'Diff reviewer',
    time: '09:58',
    summary: 'Diff preview is ready for another pass',
    unread: 0,
    accent: 'purple',
    messages: [
      {
        id: 'devon-1',
        author: 'Devon Xu',
        role: 'Reviewer',
        time: '09:49',
        side: 'left',
        accent: 'purple',
        body: 'The preview diff now keeps file headers sticky and line gutters aligned. I attached the snippet for the sidebar tabs.',
        code: {
          file: 'diff-tabs.tsx',
          lines: [
            'const tabs = ["Files", "Diff", "Preview", "Logs"];',
            'const activeTab = tabs.find((tab) => tab === selectedTab);',
          ],
        },
      },
      {
        id: 'devon-2',
        author: 'You',
        role: 'Owner',
        time: '09:58',
        side: 'right',
        body: 'Looks good. I will keep this private chat page visually aligned with those tighter tab controls.',
      },
    ],
  },
  {
    id: 'aria',
    name: 'Aria Lin',
    initials: 'AL',
    role: 'Client worker',
    time: '09:31',
    summary: 'Client runner smoke test notes attached',
    unread: 1,
    accent: 'cyan',
    messages: [
      {
        id: 'aria-1',
        author: 'Aria Lin',
        role: 'Client worker',
        time: '09:12',
        side: 'left',
        accent: 'cyan',
        body: 'Runner smoke test notes are attached. No API dependency is needed for the page preview pass.',
        attachments: [
          { name: 'runner-smoke.md', detail: '5 checks' },
          { name: 'edge-local.log', detail: 'redacted' },
        ],
      },
      {
        id: 'aria-2',
        author: 'You',
        role: 'Owner',
        time: '09:31',
        side: 'right',
        body: 'Acknowledged. The React copy will keep all state local for now.',
      },
    ],
  },
];

const pageStyles = `
  @import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400,0,0");

  .pc-page {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    background:
      radial-gradient(circle at 14% 8%, rgba(37, 99, 235, 0.16), transparent 34%),
      radial-gradient(circle at 82% 16%, rgba(8, 145, 178, 0.12), transparent 32%),
      linear-gradient(135deg, #f8fbff 0%, #eef6ff 58%, #f5f3ff 100%);
    color: #172033;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .pc-particles {
    position: fixed;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    opacity: 0.72;
  }

  .pc-symbol {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: "Material Symbols Rounded";
    font-size: 20px;
    font-style: normal;
    font-weight: 400;
    line-height: 1;
    font-variation-settings: "FILL" 0, "wght" 450, "GRAD" 0, "opsz" 24;
  }

  .pc-shell {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 292px minmax(480px, 1fr) 336px;
    gap: 16px;
    min-height: 100vh;
    padding: 18px;
  }

  .pc-glass {
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(26, 40, 80, 0.14);
    backdrop-filter: blur(28px) saturate(160%);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
  }

  .pc-panel {
    display: flex;
    min-height: 0;
    overflow: hidden;
    flex-direction: column;
  }

  .pc-header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 68px;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(134, 157, 190, 0.24);
  }

  .pc-chat-header,
  .pc-context-header {
    justify-content: space-between;
  }

  .pc-title h1,
  .pc-title h2 {
    margin: 0;
    color: #172033;
    font-size: 18px;
    line-height: 1.2;
  }

  .pc-title p {
    margin: 4px 0 0;
    color: #667085;
    font-size: 12px;
  }

  .pc-eyebrow,
  .pc-section-title,
  .pc-meta {
    color: #667085;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .pc-icon-button,
  .pc-tool-button,
  .pc-back-button,
  .pc-send-button,
  .pc-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(132, 155, 190, 0.24);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.62);
    color: #172033;
    box-shadow: 0 8px 20px rgba(31, 57, 102, 0.08);
    cursor: pointer;
  }

  .pc-back-button,
  .pc-icon-button,
  .pc-tool-button {
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    padding: 0;
  }

  .pc-icon-button.is-active,
  .pc-tool-button.is-active {
    border-color: rgba(37, 99, 235, 0.34);
    background: rgba(37, 99, 235, 0.1);
    color: #2563eb;
  }

  .pc-search {
    position: relative;
    padding: 12px 14px 8px;
  }

  .pc-search span {
    position: absolute;
    top: 21px;
    left: 25px;
    color: #7b8aa4;
    font-size: 18px;
  }

  .pc-search input {
    width: 100%;
    height: 36px;
    border: 1px solid rgba(132, 155, 190, 0.24);
    border-radius: 8px;
    outline: 0;
    padding: 0 12px 0 34px;
    background: rgba(255, 255, 255, 0.68);
    color: #172033;
  }

  .pc-section-title {
    padding: 10px 16px 8px;
  }

  .pc-chat-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    overflow-y: auto;
    padding: 0 10px 16px;
  }

  .pc-chat-card {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-height: 64px;
    border: 1px solid transparent;
    border-radius: 12px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.45);
    text-align: left;
  }

  .pc-chat-card.is-active {
    border-color: rgba(37, 99, 235, 0.28);
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(8, 145, 178, 0.08));
  }

  .pc-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    border-radius: 10px;
    background: linear-gradient(135deg, #2563eb, #0891b2);
    color: #fff;
    font-size: 12px;
    font-weight: 800;
    box-shadow: 0 10px 22px rgba(37, 99, 235, 0.24);
  }

  .pc-avatar.cyan {
    background: linear-gradient(135deg, #0891b2, #22c55e);
  }

  .pc-avatar.purple {
    background: linear-gradient(135deg, #7c3aed, #0ea5e9);
  }

  .pc-chat-card h3,
  .pc-message-meta strong {
    margin: 0;
    font-size: 13px;
    line-height: 1.2;
  }

  .pc-chat-card p {
    margin: 4px 0 0;
    overflow: hidden;
    color: #667085;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pc-time {
    color: #7f8aa3;
    font-size: 11px;
    white-space: nowrap;
  }

  .pc-unread {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    margin-top: 6px;
    border-radius: 999px;
    background: #2563eb;
    color: #fff;
    font-size: 11px;
    font-weight: 800;
  }

  .pc-chat-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .pc-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    background: rgba(5, 150, 105, 0.1);
    color: #059669;
    font-size: 11px;
    font-weight: 800;
  }

  .pc-status::before {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: currentColor;
    content: "";
  }

  .pc-actions,
  .pc-composer-tools,
  .pc-composer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pc-messages {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 18px 12px;
  }

  .pc-message-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    max-width: 78%;
  }

  .pc-message-row.is-mine {
    align-self: flex-end;
    grid-template-columns: minmax(0, 1fr) 36px;
  }

  .pc-message-row.is-mine .pc-avatar {
    grid-column: 2;
    grid-row: 1;
    background: linear-gradient(135deg, #1d4ed8, #7c3aed);
  }

  .pc-message-row.is-mine .pc-message-stack {
    grid-column: 1;
    grid-row: 1;
  }

  .pc-message-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 6px;
    color: #667085;
    font-size: 11px;
  }

  .pc-message-row.is-mine .pc-message-meta {
    justify-content: flex-end;
  }

  .pc-key-button {
    border: 0;
    border-radius: 7px;
    padding: 3px 7px;
    background: rgba(124, 58, 237, 0.1);
    color: #6d28d9;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
  }

  .pc-key-button.is-active {
    background: rgba(124, 58, 237, 0.18);
    color: #4c1d95;
  }

  .pc-bubble {
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 12px;
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.74);
    box-shadow: 0 10px 26px rgba(31, 57, 102, 0.09);
    color: #22304a;
    font-size: 14px;
    line-height: 1.5;
  }

  .pc-message-row.is-mine .pc-bubble {
    border-color: rgba(37, 99, 235, 0.36);
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.92), rgba(8, 145, 178, 0.9));
    color: #fff;
  }

  .pc-bubble.is-draft {
    border-style: dashed;
  }

  .pc-quote {
    margin-bottom: 10px;
    border-left: 3px solid #0891b2;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(8, 145, 178, 0.08);
    color: #345064;
  }

  .pc-code-card {
    margin-top: 10px;
    overflow: hidden;
    border: 1px solid rgba(23, 32, 51, 0.1);
    border-radius: 10px;
    background: #111827;
    color: #d7e5ff;
  }

  .pc-code-card header {
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

  .pc-code-card pre {
    margin: 0;
    overflow-x: auto;
    padding: 10px;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
  }

  .pc-code-card code {
    display: block;
    white-space: pre;
  }

  .pc-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .pc-attachment {
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

  .pc-composer-wrap {
    flex: 0 0 auto;
    padding: 0 18px 18px;
  }

  .pc-attachment-tray {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
    padding: 10px;
  }

  .pc-composer {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: end;
    min-height: 88px;
    padding: 12px;
  }

  .pc-composer textarea {
    min-height: 58px;
    max-height: 130px;
    resize: none;
    border: 1px solid rgba(132, 155, 190, 0.2);
    border-radius: 10px;
    outline: 0;
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.64);
    color: #172033;
    line-height: 1.45;
  }

  .pc-send-button {
    height: 36px;
    gap: 8px;
    padding: 0 14px;
    border-color: rgba(37, 99, 235, 0.34);
    background: linear-gradient(135deg, #2563eb, #0891b2);
    color: #fff;
    font-weight: 800;
  }

  .pc-context-body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    padding: 14px;
  }

  .pc-mini-card {
    border: 1px solid rgba(132, 155, 190, 0.22);
    border-radius: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.55);
  }

  .pc-mini-card h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }

  .pc-mini-card p,
  .pc-mini-card li {
    color: #667085;
    font-size: 12px;
    line-height: 1.45;
  }

  .pc-mini-card p {
    margin: 0;
  }

  .pc-mini-card ul {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .pc-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .pc-chip {
    min-height: 28px;
    padding: 0 9px;
    color: #40516f;
    font-size: 12px;
    box-shadow: none;
  }

  .pc-progress {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(37, 99, 235, 0.1);
  }

  .pc-progress span {
    display: block;
    width: 68%;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #2563eb, #0891b2, #7c3aed);
  }

  .pc-empty {
    align-self: center;
    border-radius: 12px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.55);
    color: #667085;
    font-size: 13px;
  }

  @media (max-width: 1120px) {
    .pc-shell {
      grid-template-columns: 260px minmax(0, 1fr);
    }

    .pc-context-panel {
      display: none;
    }

    .pc-message-row {
      max-width: 88%;
    }
  }

  @media (max-width: 760px) {
    .pc-page {
      overflow: auto;
    }

    .pc-shell {
      grid-template-columns: 1fr;
      min-height: auto;
      padding: 12px;
    }

    .pc-sidebar {
      max-height: 260px;
    }

    .pc-chat-panel {
      min-height: 680px;
    }

    .pc-composer {
      grid-template-columns: 1fr;
    }
  }
`;

function Avatar({ initials, accent = 'blue' }: { initials: string; accent?: Accent }) {
  return <span className={`pc-avatar ${accent}`}>{initials}</span>;
}

function Icon({ name }: { name: string }) {
  return (
    <span className="pc-symbol" aria-hidden="true">
      {name}
    </span>
  );
}

export function PrivateChatsPageReact() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeChatId, setActiveChatId] = useState(conversations[0].id);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [keyOnly, setKeyOnly] = useState(false);
  const [keyedMessages, setKeyedMessages] = useState<string[]>(['mira-2']);
  const [draft, setDraft] = useState('');
  const [localMessages, setLocalMessages] = useState<Record<string, Message[]>>({});

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeChatId) ?? conversations[0],
    [activeChatId],
  );

  const messages = useMemo(() => {
    const merged = [
      ...activeConversation.messages,
      ...(localMessages[activeConversation.id] ?? []),
    ];

    if (!keyOnly) {
      return merged;
    }

    return merged.filter((message) => keyedMessages.includes(message.id));
  }, [activeConversation, keyOnly, keyedMessages, localMessages]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const particleCount = 56;
    const particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let frameId = 0;

    const makeParticle = (index: number): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      radius: 1.4 + Math.random() * 1.8,
      color: index % 3 === 0 ? '37, 99, 235' : '8, 145, 178',
    });

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      if (particles.length === 0) {
        for (let index = 0; index < particleCount; index += 1) {
          particles.push(makeParticle(index));
        }
      }
    };

    const tick = () => {
      context.clearRect(0, 0, width, height);

      particles.forEach((particle, index) => {
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.x < -20) {
          particle.x = width + 20;
        }

        if (particle.x > width + 20) {
          particle.x = -20;
        }

        if (particle.y < -20) {
          particle.y = height + 20;
        }

        if (particle.y > height + 20) {
          particle.y = -20;
        }

        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${particle.color}, 0.28)`;
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
            context.strokeStyle = `rgba(37, 99, 235, ${(0.1 * (1 - distance / 128)).toFixed(3)})`;
            context.lineWidth = 1;
            context.stroke();
          }
        }
      });

      frameId = window.requestAnimationFrame(tick);
    };

    resize();
    tick();
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const toggleKeyedMessage = (messageId: string) => {
    setKeyedMessages((current) =>
      current.includes(messageId)
        ? current.filter((currentMessageId) => currentMessageId !== messageId)
        : [...current, messageId],
    );
  };

  const sendDraft = () => {
    const text = draft.trim();

    if (!text) {
      return;
    }

    const message: Message = {
      id: `local-${activeConversation.id}-${Date.now()}`,
      author: 'You',
      role: 'Local draft',
      time: 'Now',
      side: 'right',
      body: text,
      isDraft: true,
      attachments: attachmentsOpen
        ? [
            { name: 'local-context.md', detail: 'queued' },
            { name: 'selection.tsx', detail: 'snippet' },
          ]
        : undefined,
    };

    setLocalMessages((current) => ({
      ...current,
      [activeConversation.id]: [...(current[activeConversation.id] ?? []), message],
    }));
    setDraft('');
  };

  return (
    <div className="pc-page">
      <style>{pageStyles}</style>
      <canvas ref={canvasRef} className="pc-particles" aria-hidden="true" />

      <div className="pc-shell">
        <aside className="pc-sidebar pc-panel pc-glass">
          <header className="pc-header">
            <button className="pc-back-button" type="button" aria-label="Back to workspace">
              <Icon name="arrow_back" />
            </button>
            <div className="pc-title">
              <div className="pc-eyebrow">AgentHub</div>
              <h1>Private Chats</h1>
              <p>Direct coordination workspace</p>
            </div>
          </header>

          <div className="pc-search">
            <Icon name="search" />
            <input aria-label="Search private chats" defaultValue="routing handoff" type="search" />
          </div>

          <div className="pc-section-title">Pinned Threads</div>
          <div className="pc-chat-list">
            {conversations.map((conversation) => (
              <button
                className={`pc-chat-card ${conversation.id === activeConversation.id ? 'is-active' : ''}`}
                key={conversation.id}
                onClick={() => setActiveChatId(conversation.id)}
                type="button"
              >
                <Avatar initials={conversation.initials} accent={conversation.accent} />
                <span>
                  <h3>{conversation.name}</h3>
                  <p>{conversation.summary}</p>
                </span>
                <span>
                  <span className="pc-time">{conversation.time}</span>
                  {conversation.unread > 0 ? <span className="pc-unread">{conversation.unread}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="pc-chat-panel pc-panel pc-glass">
          <header className="pc-header pc-chat-header">
            <div className="pc-chat-heading">
              <Avatar initials={activeConversation.initials} accent={activeConversation.accent} />
              <div className="pc-title">
                <h2>{activeConversation.name}</h2>
                <p>{activeConversation.role} - private thread</p>
              </div>
              <span className="pc-status">Online</span>
            </div>

            <div className="pc-actions">
              <button
                className={`pc-icon-button ${keyOnly ? 'is-active' : ''}`}
                onClick={() => setKeyOnly((current) => !current)}
                type="button"
                aria-pressed={keyOnly}
                aria-label="Show key messages only"
              >
                <Icon name="star" />
              </button>
              <button
                className={`pc-icon-button ${attachmentsOpen ? 'is-active' : ''}`}
                onClick={() => setAttachmentsOpen((current) => !current)}
                type="button"
                aria-expanded={attachmentsOpen}
                aria-label="Open attachments"
              >
                <Icon name="attach_file" />
              </button>
              <button className="pc-icon-button" type="button" aria-label="More actions">
                <Icon name="more_horiz" />
              </button>
            </div>
          </header>

          <section className="pc-messages" aria-label="Message thread">
            {messages.length > 0 ? (
              messages.map((message) => {
                const isKeyed = keyedMessages.includes(message.id);

                return (
                  <article
                    className={`pc-message-row ${message.side === 'right' ? 'is-mine' : ''}`}
                    key={message.id}
                  >
                    <Avatar
                      initials={message.side === 'right' ? 'ME' : activeConversation.initials}
                      accent={message.side === 'right' ? 'purple' : message.accent ?? activeConversation.accent}
                    />
                    <div className="pc-message-stack">
                      <div className="pc-message-meta">
                        <strong>{message.author}</strong>
                        <span>{message.time}</span>
                        <span>{message.role}</span>
                        <button
                          className={`pc-key-button ${isKeyed ? 'is-active' : ''}`}
                          onClick={() => toggleKeyedMessage(message.id)}
                          type="button"
                          aria-pressed={isKeyed}
                        >
                          {isKeyed ? 'Keyed' : 'Mark key'}
                        </button>
                      </div>

                      <div className={`pc-bubble ${message.isDraft ? 'is-draft' : ''}`}>
                        {message.quote ? (
                          <div className="pc-quote">
                            <strong>{message.quote.title}</strong>
                            <br />
                            {message.quote.body}
                          </div>
                        ) : null}
                        {message.body}

                        {message.attachments ? (
                          <div className="pc-attachments">
                            {message.attachments.map((attachment) => (
                              <span className="pc-attachment" key={`${message.id}-${attachment.name}`}>
                                <Icon name="description" />
                                <span>
                                  {attachment.name} - {attachment.detail}
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {message.code ? (
                          <div className="pc-code-card">
                            <header>
                              <span>{message.code.file}</span>
                              <span>snippet</span>
                            </header>
                            <pre>
                              {message.code.lines.map((line, index) => (
                                <code key={`${message.id}-line-${index}`}>{line}</code>
                              ))}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="pc-empty">No keyed messages in this conversation yet.</div>
            )}
          </section>

          <div className="pc-composer-wrap">
            {attachmentsOpen ? (
              <div className="pc-attachment-tray pc-glass" aria-label="Attachment panel">
                <span className="pc-attachment"><Icon name="description" /> local-context.md - queued</span>
                <span className="pc-attachment"><Icon name="code" /> selection.tsx - snippet</span>
                <span className="pc-attachment"><Icon name="tag" /> handoff checklist - note</span>
              </div>
            ) : null}

            <div className="pc-composer pc-glass">
              <div className="pc-composer-tools">
                <button
                  className={`pc-tool-button ${attachmentsOpen ? 'is-active' : ''}`}
                  onClick={() => setAttachmentsOpen((current) => !current)}
                  type="button"
                  aria-label="Toggle attachment panel"
                >
                  <Icon name="add" />
                </button>
                <button className="pc-tool-button" type="button" aria-label="Insert code">
                  <Icon name="code" />
                </button>
                <button className="pc-tool-button" type="button" aria-label="Quote selected message">
                  <Icon name="format_quote" />
                </button>
              </div>

              <textarea
                aria-label={`Message ${activeConversation.name}`}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a private note, paste a code fragment, or attach handoff context..."
                value={draft}
              />

              <div className="pc-composer-actions">
                <button className="pc-tool-button" type="button" aria-label="Voice note">
                  <Icon name="mic" />
                </button>
                <button className="pc-send-button" onClick={sendDraft} type="button">
                  <Icon name="send" />
                  Send
                </button>
              </div>
            </div>
          </div>
        </main>

        <aside className="pc-context-panel pc-panel pc-glass">
          <header className="pc-header pc-context-header">
            <div className="pc-title">
              <div className="pc-eyebrow">Thread Context</div>
              <h2>Handoff Pack</h2>
              <p>4 linked items - 68% reviewed</p>
            </div>
            <button className="pc-icon-button" type="button" aria-label="Open context">
              <Icon name="open_in_new" />
            </button>
          </header>

          <div className="pc-context-body">
            <section className="pc-mini-card">
              <h3>Review Progress</h3>
              <div className="pc-progress"><span /></div>
              <p style={{ marginTop: 10 }}>
                Message spacing, tool buttons, and composer states are ready for visual review.
              </p>
            </section>

            <section className="pc-mini-card">
              <h3>Attachments</h3>
              <ul>
                <li>handoff-notes.md - private chat acceptance notes</li>
                <li>message-layout.png - bubble and composer spacing</li>
                <li>route-map.ts - local preview route draft</li>
              </ul>
            </section>

            <section className="pc-mini-card">
              <h3>Code Snippets</h3>
              <div className="pc-code-card">
                <header>
                  <span>composer-state.ts</span>
                  <span>local</span>
                </header>
                <pre>
                  <code>sendDraft();</code>
                  <code>toggleAttachments();</code>
                  <code>markMessageKey(messageId);</code>
                </pre>
              </div>
            </section>

            <section className="pc-mini-card">
              <h3>Visible State</h3>
              <div className="pc-chip-row">
                <span className="pc-chip">chat: {activeConversation.name}</span>
                <span className="pc-chip">attachments: {attachmentsOpen ? 'open' : 'closed'}</span>
                <span className="pc-chip">filter: {keyOnly ? 'keyed' : 'all'}</span>
                <span className="pc-chip">drafts: {(localMessages[activeConversation.id] ?? []).length}</span>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default PrivateChatsPageReact;
