import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TranscriptUserItem } from '../transcript-item';
import type { RowItem } from '../types';
import { UserMessage } from './UserMessage';
import { useTestI18nLanguage } from '../../testing/i18n';
import {
  registerAttachmentImageUrlResolver,
  getAttachmentImageUrlResolver,
} from '../../platform/attachmentImagePort';

describe('UserMessage rendering', () => {
  it('renders user markdown tables through the shared markdown renderer', () => {
    const item: TranscriptUserItem = {
      type: 'user',
      name: 'Ding',
      text: '| Scope | Status |\n| --- | --- |\n| Desktop/Web | aligned |',
    };

    const { container, getByText } = render(<UserMessage item={item} chatMode="dm" />);

    expect(container.querySelector('table')).not.toBeNull();
    expect(getByText('Desktop/Web')).toBeInTheDocument();
    expect(getByText('aligned')).toBeInTheDocument();
  });

  it('renders Hub message display metadata on user input cards', () => {
    const item: TranscriptUserItem = {
      type: 'user',
      name: 'Ding',
      text: '@Reviewer 帮我复核这个改动',
      displayTitle: 'Group @Agent',
      displayDetail: 'IM project_group · mentions @Reviewer · task task-reviewer-1',
      badgeLabel: '@Agent queued',
      badgeVariant: 'primary',
    };

    const { getByText } = render(<UserMessage item={item} chatMode="group" />);

    expect(getByText('Group @Agent')).toBeInTheDocument();
    expect(getByText('IM project_group · mentions @Reviewer · task task-reviewer-1')).toBeInTheDocument();
    expect(getByText('@Agent queued')).toBeInTheDocument();
    expect(getByText('@Reviewer 帮我复核这个改动')).toBeInTheDocument();
  });

  // #1821: text bubbles were the only transcript cards without a selectable
  // identity or a context-menu entry point — tool rows carried both via
  // RowItem. The user bubble now matches that contract.
  it('carries the selectable identity and fires the context-menu handler', () => {
    const item: TranscriptUserItem = {
      type: 'user',
      id: 'hub-message-1',
      name: 'Ding',
      text: '来自 Hub 的消息',
    };
    const onContextMenu = vi.fn();

    const { container } = render(
      <UserMessage item={item} chatMode="group" onContextMenu={onContextMenu} />,
    );

    const bubble = container.querySelector('[data-selectable-card="hub-message-1"]');
    expect(bubble).not.toBeNull();
    expect(bubble).toHaveAttribute('data-block-id', 'hub-message-1');

    fireEvent.contextMenu(bubble!);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0]?.[0]).toBe('hub-message-1');
  });

  it('stays inert without a block id or without a context-menu handler', () => {
    const noId: TranscriptUserItem = { type: 'user', text: '无 id 的消息' };
    const onContextMenu = vi.fn();
    const { container } = render(
      <UserMessage item={noId} chatMode="dm" onContextMenu={onContextMenu} />,
    );
    expect(container.querySelector('[data-selectable-card]')).toBeNull();

    const noHandler: TranscriptUserItem = { type: 'user', id: 'hub-message-2', text: '有 id 的消息' };
    const { container: bare } = render(<UserMessage item={noHandler} chatMode="dm" />);
    expect(bare.querySelector('[data-selectable-card]')).toBeNull();
  });
});

// ── #1957: the sender's own attachments render inline in the user bubble ──
// Same conventions as ImageAttachment.test.tsx: assertions use the en
// chatview literals, and the image URL resolver goes through the shared
// platform port (register per test, unregister in afterEach).
describe('UserMessage attachments (#1957)', () => {
  beforeAll(async () => {
    await useTestI18nLanguage('en');
  });

  let unregister: (() => void) | undefined;
  afterEach(() => {
    unregister?.();
    unregister = undefined;
  });

  const imageAttachmentRef = {
    id: 'att-1', name: 'photo.png', size: 2048, mime_type: 'image/png',
  };

  function imageRow(): RowItem {
    return {
      id: 'blk-att-1', type: 'attachment', label: 'photo.png', status: 'ok',
      collapsible: false, standalone: true,
      fileName: 'photo.png', fileSize: '2 KB',
      attachmentKind: 'image', attachmentRef: imageAttachmentRef,
    };
  }

  function fileRow(): RowItem {
    return {
      id: 'blk-att-2', type: 'attachment', label: 'notes.md', status: 'ok',
      collapsible: false, standalone: true,
      fileName: 'notes.md', fileSize: '2 KB', attachmentKind: 'file',
    };
  }

  it('renders an image attachment thumbnail through the shared platform port', async () => {
    unregister = registerAttachmentImageUrlResolver(async () => 'blob:user-upload');
    const item: TranscriptUserItem = {
      type: 'user', id: 'u1', name: 'Ding', text: '', attachments: [imageRow()],
    };

    const { container } = render(<UserMessage item={item} chatMode="dm" />);

    const img = await screen.findByAltText('photo.png');
    expect(img).toHaveAttribute('src', 'blob:user-upload');
    // Name + size subtitle rides under the thumbnail.
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();

    // The attachment list carries the accessible label and is the bubble's
    // only child — attachment-only items skip the markdown node entirely.
    const list = container.querySelector('.user-att-list');
    expect(list).not.toBeNull();
    expect(list).toHaveAttribute('aria-label', 'Attachments');
    const bubble = container.querySelector('.user-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble!.children).toHaveLength(1);
    expect(bubble!.firstElementChild).toBe(list);
  });

  it('degrades to the chip notice when no surface registered a resolver', async () => {
    expect(getAttachmentImageUrlResolver()).toBeUndefined();
    const item: TranscriptUserItem = {
      type: 'user', id: 'u1', name: 'Ding', text: '', attachments: [imageRow()],
    };

    render(<UserMessage item={item} chatMode="dm" />);

    expect(await screen.findByText('Image preview unavailable')).toBeInTheDocument();
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders non-image attachments as file chips without touching the port', () => {
    expect(getAttachmentImageUrlResolver()).toBeUndefined();
    const item: TranscriptUserItem = {
      type: 'user', id: 'u1', name: 'Ding', text: '', attachments: [fileRow()],
    };

    const { container } = render(<UserMessage item={item} chatMode="group" />);

    expect(screen.getByText('notes.md')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(container.querySelector('.user-att-list .att-row')).not.toBeNull();
  });

  it('renders text and attachments together when both are present', async () => {
    unregister = registerAttachmentImageUrlResolver(async () => 'blob:user-upload');
    const item: TranscriptUserItem = {
      type: 'user', id: 'u1', name: 'Ding', text: 'here is the screenshot',
      attachments: [imageRow()],
    };

    const { container } = render(<UserMessage item={item} chatMode="group" />);

    expect(screen.getByText('here is the screenshot')).toBeInTheDocument();
    expect(await screen.findByAltText('photo.png')).toBeInTheDocument();
    const bubble = container.querySelector('.user-bubble');
    expect(bubble!.children).toHaveLength(2);
  });
});

describe('UserMessage fenced code (#1971)', () => {
  it('renders Hub-delivered fenced code as a code block, not plain text', () => {
    const item: TranscriptUserItem = {
      type: 'user',
      name: 'partner',
      text: 'partner fenced probe\n```python\nprint("hello fenced")\n```\n',
    };

    const { container, getByText } = render(<UserMessage item={item} chatMode="dm" />);

    expect(getByText('partner fenced probe')).toBeInTheDocument();
    expect(getByText('print("hello fenced")')).toBeInTheDocument();
    expect(container.querySelectorAll('pre, code, [class*="codeBlockWrapper"]').length).toBeGreaterThan(0);
  });
});
