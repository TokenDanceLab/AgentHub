import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getI18n } from 'react-i18next';
import {
  desktopPathsToComposerAttachments,
  type ComposerAttachment,
} from '@shared/composer';

export async function pickDesktopComposerAttachments(): Promise<ComposerAttachment[]> {
  const selected = await open({
    directory: false,
    multiple: true,
    title: getI18n()?.t('attachments.pickTitle') ?? '选择附件',
  });
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];

  return desktopPathsToComposerAttachments(paths, (path) => invoke<string>('read_file', { path }));
}
