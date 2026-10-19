import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentTitle,
} from './attachment';
import { Bubble, BubbleContent } from './bubble';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from './input-group';
import { Message, MessageContent } from './message';

describe('shadcn chat primitives', () => {
  it('renders a message row with alignment and content slots', () => {
    const { container } = render(
      <Message align="end">
        <MessageContent>Hello</MessageContent>
      </Message>,
    );

    expect(container.querySelector('[data-slot="message"]')).toHaveAttribute('data-align', 'end');
    expect(screen.getByText('Hello')).toHaveAttribute('data-slot', 'message-content');
  });

  it('renders user bubbles with the brand variant and forwarded selectable attributes', () => {
    const { container } = render(
      <Bubble align="end" variant="default">
        <BubbleContent data-selectable-card="message-1">Ship it</BubbleContent>
      </Bubble>,
    );

    const bubble = container.querySelector('[data-slot="bubble"]');
    const content = container.querySelector('[data-slot="bubble-content"]');
    expect(bubble).toHaveAttribute('data-variant', 'default');
    expect(bubble).toHaveAttribute('data-align', 'end');
    expect(content).toHaveAttribute('data-selectable-card', 'message-1');
  });

  it('renders attachment chrome with state, title, description and actions', () => {
    const { container } = render(
      <Attachment state="uploading" size="xs">
        <AttachmentContent>
          <AttachmentTitle>notes.md</AttachmentTitle>
          <AttachmentDescription>42%</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <button type="button">Remove</button>
        </AttachmentActions>
      </Attachment>,
    );

    expect(container.querySelector('[data-slot="attachment"]')).toHaveAttribute(
      'data-state',
      'uploading',
    );
    expect(screen.getByText('notes.md')).toHaveAttribute('data-slot', 'attachment-title');
    expect(screen.getByText('42%')).toHaveAttribute('data-slot', 'attachment-description');
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('composes an input group with a textarea and toolbar addon', () => {
    const { container } = render(
      <InputGroup>
        <InputGroupTextarea aria-label="Prompt" />
        <InputGroupAddon align="block-end">
          <button type="button">Send</button>
        </InputGroupAddon>
      </InputGroup>,
    );

    expect(screen.getByLabelText('Prompt')).toHaveAttribute(
      'data-slot',
      'input-group-control',
    );
    expect(container.querySelector('[data-slot="input-group-addon"]')).toHaveAttribute(
      'data-align',
      'block-end',
    );
  });
});
