import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  desktopPathsToComposerAttachments,
  type ComposerAttachment,
} from '@shared/composer';

export async function pickDesktopComposerAttachments(): Promise<ComposerAttachment[]> {
  const selected = await open({
    directory: false,
    multiple: true,
    title: '选择附件',
  });
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];

  return desktopPathsToComposerAttachments(paths, (path) => invoke<string>('read_file', { path }));
}
