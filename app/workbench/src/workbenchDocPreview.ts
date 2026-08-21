import {
  fileTypeFromPreviewName,
  previewFilenameFromTitle,
  type WorkbenchDocumentPreview,
} from './documentPreview';
import type { DocRow } from './pages';

export function createDocPreview(doc: DocRow): WorkbenchDocumentPreview {
  const filename = previewFilenameFromTitle(doc.title);
  const tagLine = doc.tag ? `- 标签：${doc.tag}` : '- 标签：未标记';
  return {
    id: `doc:${doc.id}`,
    name: filename,
    type: fileTypeFromPreviewName(filename),
    owner: doc.owner,
    sourceLabel: doc.location,
    content: [
      `# ${doc.title}`,
      '',
      '## 文档信息',
      `- 所有者：${doc.owner}`,
      `- 位置：${doc.location}`,
      `- 创建时间：${doc.time}`,
      tagLine,
      '',
      '## 摘要',
      '这是 AgentHub 轻量文档预览。当前内容来自文档索引，后续可由 Hub artifact store、workspace 文件或外部文档 provider 提供正文。',
      '',
      '## 下一步',
      '- 接入全文搜索与项目归档索引。',
      '- 将外部云文档 provider 映射为同一预览合同。',
      '- 对 Markdown、Diff、表格和链接产物使用统一只读预览。',
    ].join('\n'),
  };
}
