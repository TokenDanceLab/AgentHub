import { formatComposerAttachmentContext } from './attachments';
import type { ComposerAttachment, ComposerMention } from './types';

export function formatComposerMentionContext(mentions: ComposerMention[]): string {
  if (mentions.length === 0) return '';

  const lines = ['Mentioned agents:'];
  mentions.forEach((mention, index) => {
    lines.push(`${index + 1}. ${mention.label} (id: ${mention.id})`);
    if (mention.description) lines.push(`   Description: ${mention.description}`);
    if (mention.provider) lines.push(`   Provider: ${mention.provider}`);
    if (mention.runtimeId) lines.push(`   Runtime: ${mention.runtimeId}`);
    if (mention.model) lines.push(`   Model: ${mention.model}`);
    if (mention.status) lines.push(`   Status: ${mention.status}`);
  });

  return lines.join('\n');
}

export function formatComposerPromptWithContext(
  text: string,
  attachments: ComposerAttachment[],
  mentions: ComposerMention[],
): string {
  const trimmed = text.trim();
  const contextBlocks = [
    formatComposerMentionContext(mentions),
    formatComposerAttachmentContext(attachments),
  ].filter(Boolean);

  if (contextBlocks.length === 0) return trimmed;
  const context = contextBlocks.join('\n\n');
  return trimmed ? `${trimmed}\n\n${context}` : context;
}
