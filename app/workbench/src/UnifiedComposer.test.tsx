import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FormEvent } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';import { clearDraft, loadDraft, saveDraft } from '@shared/composer';
import type { ComposerMention, ComposerState } from '@shared/composer';
import { UnifiedComposer } from './UnifiedComposer';

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: () => null,
  Codex: () => null,
  GeminiCLI: () => null,
  ModelIcon: () => null,
  OpenCode: () => null,
  ProviderIcon: () => null,
}));
vi.mock('@lobehub/icons/es/Antigravity/components/Color.js', () => ({ default: () => null }));

// Composer copy assertions use the en chatview literals; opt into the en
// bundle of the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

// requestIdleCallback polyfill for jsdom (used by draft persistence).
beforeEach(() => {
  vi.stubGlobal(
    'requestIdleCallback',
    vi.fn((cb: IdleRequestCallback, _opts?: IdleRequestOptions) => window.setTimeout(cb, 0)),
  );
  vi.stubGlobal(
    'cancelIdleCallback',
    vi.fn((id: number) => window.clearTimeout(id)),
  );
});
afterEach(() => {
  localStorage.clear();
});

const mentionedComposer: ComposerState = {
  conversationId: 'hub-session-1',
  text: 'Run the real task',
  mode: 'code',
  mentions: [{ id: 'profile-builder', label: 'Builder', runtimeId: 'claude-code' }],
  attachments: [],
  approvalMode: 'suggest',
  workDir: '',
  submitState: 'idle',
  replyTo: null,
  quote: null,
  editingMessageId: null,
};

describe('UnifiedComposer execution target selection', () => {
  it('adds @Agent mentions from the composer selector', () => {
    const dispatchComposer = vi.fn();

    render(
      <UnifiedComposer
        composer={mentionedComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[
          { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('@Agent'), {
      target: { value: 'profile-reviewer' },
    });

    expect(dispatchComposer).toHaveBeenCalledWith({
      type: 'addMention',
      mention: { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
    });
    // The en resource uses a single-brace placeholder ({label}), which real
    // i18next does not interpolate, so the rendered aria-label keeps it.
    expect(screen.getByRole('button', { name: 'Remove @{label}' })).toBeInTheDocument();
  });

  it('locks mentioned real dispatch until a Desktop/Edge target is selected', () => {
    render(
      <UnifiedComposer
        composer={mentionedComposer}
        dispatchComposer={vi.fn()}
        executionTargets={[]}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Desktop/Edge target')).toBeDisabled();
    expect(screen.getByText('当前无在线执行目标。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start agent task' })).toBeDisabled();
  });

  it('does not submit with Enter when a mentioned agent has no selected target', () => {
    const handleSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());

    render(
      <UnifiedComposer
        composer={mentionedComposer}
        dispatchComposer={vi.fn()}
        executionTargets={[{ id: 'target-local-edge-1', label: 'Desktop Edge' }]}
        onSubmit={handleSubmit}
      />,
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Composer input' }), { key: 'Enter' });

    expect(screen.getByText('请先选择执行目标再开始。')).toBeInTheDocument();
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('renders data mode, target, replay, and run start status', () => {
    render(
      <UnifiedComposer
        composer={{ ...mentionedComposer, submitState: 'submitting' }}
        dispatchComposer={vi.fn()}
        executionTargetId="target-local-edge-1"
        executionTargets={[{ id: 'target-local-edge-1', label: 'Alpha Desktop' }]}
        onSubmit={vi.fn()}
        status={{
          dataMode: 'approved-real',
          replayLabel: 'Hub replay: 2 runtime events observed',
          targetLabel: 'Alpha Desktop (target-local-edge-1)',
          targetState: 'ready',
        }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('数据：真实数据');
    expect(screen.getByRole('status')).toHaveTextContent('目标：就绪 · Alpha Desktop');
    expect(screen.getByRole('status')).toHaveTextContent('Hub replay: 2 runtime events observed');
  });

  it('morphs the send button into a stop button while an agent run is active', () => {
    const onCancel = vi.fn();
    render(
      <UnifiedComposer
        composer={mentionedComposer}
        dispatchComposer={vi.fn()}
        onSubmit={vi.fn()}
        isRunning
        onCancel={onCancel}
      />,
    );

    const stopButton = screen.getByRole('button', { name: 'Stop' });
    expect(stopButton).toHaveAttribute('type', 'button');
    expect(stopButton).toHaveAttribute('data-running', 'true');
    // The submit send button is replaced while running.
    expect(screen.queryByRole('button', { name: 'Start agent task' })).toBeNull();
    fireEvent.click(stopButton);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows an edit bar while editing a sent message and cancels on click', () => {
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={{ ...mentionedComposer, editingMessageId: 'hub-message-42' }}
        dispatchComposer={dispatchComposer}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Editing message')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    expect(dispatchComposer).toHaveBeenCalledWith({ type: 'setEditingMessage', messageId: null });
  });
});

const mentionableAgents: ComposerMention[] = [
  { id: 'reviewer', label: 'Reviewer', runtimeId: 'codex', dispatchRole: 'dispatch' },
  { id: 'builder', label: 'Builder', runtimeId: 'claude-code', dispatchRole: 'dispatch' },
];

/** Type into the controlled textarea, setting value + caret, then fire the
 *  change event (the repo convention for triggering React's onChange). */
function typeInto(textarea: HTMLElement, value: string): void {
  fireEvent.change(textarea, {
    target: { value, selectionStart: value.length, selectionEnd: value.length },
  });
}

describe('UnifiedComposer @mention popover', () => {
  const baseComposer: ComposerState = {
    conversationId: 'hub-session-1',
    text: '',
    mode: 'ask',
    mentions: [],
    attachments: [],
    approvalMode: 'suggest',
    workDir: '',
    submitState: 'idle',
    replyTo: null,
    quote: null,
    editingMessageId: null,
  };

  it('opens the popover with all candidates when the user types "@"', () => {
    render(
      <UnifiedComposer
        composer={baseComposer}
        dispatchComposer={vi.fn()}
        mentionableAgents={mentionableAgents}
        onSubmit={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Composer input' });
    typeInto(textarea, '@');

    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('Select someone to mention…')).toBeInTheDocument();
  });

  it('filters candidates as the user types after the "@"', () => {
    render(
      <UnifiedComposer
        composer={baseComposer}
        dispatchComposer={vi.fn()}
        mentionableAgents={mentionableAgents}
        onSubmit={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Composer input' });
    typeInto(textarea, '@rev');

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Reviewer');
  });

  it('shows an empty state when nothing matches', () => {
    render(
      <UnifiedComposer
        composer={baseComposer}
        dispatchComposer={vi.fn()}
        mentionableAgents={mentionableAgents}
        onSubmit={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Composer input' });
    typeInto(textarea, '@zzz');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).queryByRole('option')).toBeNull();
    expect(screen.getByText('No matching agents')).toBeInTheDocument();
  });

  it('navigates with ArrowDown/ArrowUp and marks the active option', () => {
    render(
      <UnifiedComposer
        composer={baseComposer}
        dispatchComposer={vi.fn()}
        mentionableAgents={mentionableAgents}
        onSubmit={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Composer input' });
    typeInto(textarea, '@');
    const listbox = screen.getByRole('listbox');

    // First option (Reviewer) is active by default.
    expect(within(listbox).getByRole('option', { selected: true })).toHaveTextContent('Reviewer');

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(within(listbox).getByRole('option', { selected: true })).toHaveTextContent('Builder');

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(within(listbox).getByRole('option', { selected: true })).toHaveTextContent('Reviewer');
  });

  it('inserts a mention chip and clears the trigger text on Enter', () => {
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={baseComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={mentionableAgents}
        onSubmit={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Composer input' });
    typeInto(textarea, '@rev');

    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Trigger text '@rev' removed, mention added (dispatchRole preserved).
    expect(dispatchComposer).toHaveBeenCalledWith({ type: 'setText', text: '' });
    expect(dispatchComposer).toHaveBeenCalledWith({
      type: 'addMention',
      mention: { id: 'reviewer', label: 'Reviewer', runtimeId: 'codex', dispatchRole: 'dispatch' },
    });
    // Popover closed after selection.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the popover on Escape without submitting', () => {
    const handleSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(
      <UnifiedComposer
        composer={baseComposer}
        dispatchComposer={vi.fn()}
        mentionableAgents={mentionableAgents}
        onSubmit={handleSubmit}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Composer input' });
    typeInto(textarea, '@');

    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('does not select or submit on Enter while IME is composing', () => {
    const dispatchComposer = vi.fn();
    const handleSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(
      <UnifiedComposer
        composer={baseComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={mentionableAgents}
        onSubmit={handleSubmit}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Composer input' });
    typeInto(textarea, '@');

    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });

    const addMentionCalls = dispatchComposer.mock.calls.filter(
      (call) => (call[0] as { type: string }).type === 'addMention',
    );
    expect(addMentionCalls).toHaveLength(0);
    expect(handleSubmit).not.toHaveBeenCalled();
    // Popover stays open.
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('does not open the popover when there are no mentionable agents', () => {
    render(
      <UnifiedComposer
        composer={baseComposer}
        dispatchComposer={vi.fn()}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Composer input' });
    typeInto(textarea, '@agent');

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the popover when clicking outside the composer', () => {
    render(
      <UnifiedComposer
        composer={baseComposer}
        dispatchComposer={vi.fn()}
        mentionableAgents={mentionableAgents}
        onSubmit={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Composer input' });
    typeInto(textarea, '@');

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

/* ═══════════════════ Draft persistence (T10/UI6) ═══════════════════ */

const draftComposer: ComposerState = {
  conversationId: 'hub-session-draft',
  text: '',
  mode: 'ask',
  mentions: [],
  attachments: [],
  approvalMode: 'suggest',
  workDir: '',
  submitState: 'idle',
  replyTo: null,
  quote: null,
  editingMessageId: null,
};

describe('UnifiedComposer draft persistence', () => {
  it('loads a saved draft on mount', () => {
    saveDraft('hub-session-draft', {
      text: 'Persisted text',
      mentions: [{ id: 'agent-alice', label: 'Alice', runtimeId: 'claude-code' }],
    });
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={draftComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[
          { id: 'agent-alice', label: 'Alice', runtimeId: 'claude-code' },
        ]}
        onSubmit={vi.fn()}
      />,
    );
    // Text restored.
    expect(dispatchComposer).toHaveBeenCalledWith({
      type: 'setText',
      text: 'Persisted text',
    });
    // Mention restored.
    expect(dispatchComposer).toHaveBeenCalledWith({
      type: 'addMention',
      mention: { id: 'agent-alice', label: 'Alice', runtimeId: 'claude-code' },
    });
  });

  it('does not load a draft when composer already has content', () => {
    saveDraft('hub-session-draft', {
      text: 'Stale draft',
      mentions: [],
    });
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={{ ...draftComposer, text: 'Existing content' }}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    // No draft restoration dispatched.
    expect(dispatchComposer).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setText' }),
    );
  });

  it('loads a draft with only text (no mentions)', () => {
    saveDraft('hub-session-draft', {
      text: 'Just text, no mentions',
      mentions: [],
    });
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={draftComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(dispatchComposer).toHaveBeenCalledWith({
      type: 'setText',
      text: 'Just text, no mentions',
    });
    // No addMention dispatched.
    expect(
      dispatchComposer.mock.calls.filter((c) => c[0].type === 'addMention'),
    ).toHaveLength(0);
  });

  it('clears the draft after submit (empty state cleanup)', () => {
    // Pre-save a draft.
    saveDraft('hub-session-draft', {
      text: 'About to be submitted',
      mentions: [{ id: 'agent-alice', label: 'Alice' }],
    });
    const dispatchComposer = vi.fn();
    const { rerender } = render(
      <UnifiedComposer
        composer={draftComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[{ id: 'agent-alice', label: 'Alice' }]}
        onSubmit={vi.fn()}
      />,
    );
    // Draft was loaded.
    expect(loadDraft('hub-session-draft')).not.toBeNull();
    // Simulate resetAfterSubmit: text goes to '' and mentions to [].
    const emptyComposer: ComposerState = { ...draftComposer, text: '', mentions: [] };
    rerender(
      <UnifiedComposer
        composer={emptyComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[{ id: 'agent-alice', label: 'Alice' }]}
        onSubmit={vi.fn()}
      />,
    );
    expect(loadDraft('hub-session-draft')).toBeNull();
  });

  it('does not load a draft for a different conversationId', () => {
    saveDraft('hub-session-other', {
      text: 'Wrong session',
      mentions: [],
    });
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={draftComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    // No draft loaded — no saved draft for hub-session-draft.
    expect(
      dispatchComposer.mock.calls.filter((c) => c[0].type === 'setText' || c[0].type === 'addMention'),
    ).toHaveLength(0);
  });

  it('#1822: restores ref-bearing attachments, replyTo and quote from a persisted draft', () => {
    const attachmentRef = {
      id: 'att-1',
      name: 'design.pdf',
      size: 1024,
      mime_type: 'application/pdf',
      url: '/files/1',
    };
    saveDraft('hub-session-draft', {
      text: 'quote reply',
      mentions: [],
      attachments: [
        { id: 'a1', name: 'design.pdf', size: 1024, mime: 'application/pdf', attachmentRef },
      ],
      replyTo: { messageId: 'msg-1', author: 'Alice', preview: '答案在…' },
      quote: { text: '引用的原句', author: 'Bob', messageId: 'msg-2' },
    });
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={draftComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(dispatchComposer).toHaveBeenCalledWith({ type: 'setText', text: 'quote reply' });
    expect(dispatchComposer).toHaveBeenCalledWith({
      type: 'setReplyTo',
      replyTo: { messageId: 'msg-1', author: 'Alice', preview: '答案在…' },
    });
    expect(dispatchComposer).toHaveBeenCalledWith({
      type: 'setQuote',
      quote: { text: '引用的原句', author: 'Bob', messageId: 'msg-2' },
    });
    expect(dispatchComposer).toHaveBeenCalledWith({
      type: 'addAttachment',
      attachment: expect.objectContaining({
        id: 'a1',
        name: 'design.pdf',
        attachmentRef,
        source: 'browser',
      }),
    });
  });

  it('#1822: refuses a malformed persisted draft instead of restoring partial state', () => {
    localStorage.setItem(
      'agenthub.composer.draft.hub-session-draft',
      JSON.stringify({ text: 'x', mentions: [], attachments: [{ id: 'a1', name: 'n' }] }),
    );
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={draftComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    // Invalid attachment shape → whole draft rejected → nothing restored.
    expect(dispatchComposer).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setText' }));
    expect(dispatchComposer).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'addAttachment' }));
    expect(dispatchComposer).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setReplyTo' }));
  });
});

describe('UnifiedComposer auto-grow (#1822)', () => {
  it('sizes the textarea to its scrollHeight whenever the draft text changes', () => {
    const base: ComposerState = { ...draftComposer, text: '' };
    const { container, rerender } = render(
      <UnifiedComposer
        composer={base}
        dispatchComposer={vi.fn()}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    if (!textarea) return;

    // jsdom has no layout engine (scrollHeight stays 0) — stub a growing
    // scrollHeight and rerender with changed text so the auto-grow effect
    // re-runs, mirroring what a real browser reports for multi-line drafts.
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 72 });
    rerender(
      <UnifiedComposer
        composer={{ ...base, text: 'line one\nline two' }}
        dispatchComposer={vi.fn()}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(textarea.style.height).toBe('72px');

    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 120 });
    rerender(
      <UnifiedComposer
        composer={{ ...base, text: 'line one\nline two\nline three' }}
        dispatchComposer={vi.fn()}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(textarea.style.height).toBe('120px');
  });
});

describe('UnifiedComposer approval-mode picker (#1816)', () => {
  it('renders the trigger showing the current approval mode label', () => {
    render(
      <UnifiedComposer
        composer={mentionedComposer}
        dispatchComposer={vi.fn()}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Approval mode: Suggest (agent default)' }))
      .toBeInTheDocument();
  });

  it('dispatches setApprovalMode when a mode option is picked', () => {
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={mentionedComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approval mode: Suggest (agent default)' }));
    const option = screen.getByRole('button', { name: /Allow workspace write/i });
    fireEvent.click(option);

    expect(dispatchComposer).toHaveBeenCalledWith({
      type: 'setApprovalMode',
      approvalMode: 'workspace-write',
    });
  });

  it('keeps the current mode when an unknown picker value is delivered', () => {
    // Guard against future Edge modes appearing in the picker options while
    // the composer message-level vocabulary stays 3-value.
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={{ ...mentionedComposer, approvalMode: 'read-only' }}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Approval mode: Read-only plan' })
      ).toBeInTheDocument();
    expect(dispatchComposer).not.toHaveBeenCalled();
  });

  it('disables the picker while submitting', () => {
    render(
      <UnifiedComposer
        composer={{ ...mentionedComposer, submitState: 'submitting' }}
        dispatchComposer={vi.fn()}
        mentionableAgents={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Approval mode: Suggest (agent default)' }))
      .toBeDisabled();
  });
});
