import {
  fileTypeFromPreviewName,
  type WorkbenchDocumentPreview,
} from './documentPreview';
import type { ProjectArtifact } from './pages';

export function createProjectArtifactPreview(
  projectId: string,
  artifact: ProjectArtifact,
): WorkbenchDocumentPreview {
  const name = artifact.name ?? 'artifact.txt';
  const type = fileTypeFromPreviewName(name);
  return {
    id: `project:${projectId}:${artifact.id}`,
    name,
    type,
    owner: 'AgentHub',
    sourceLabel: `项目产物 / ${projectId}`,
    content: projectArtifactContent(projectId, name, type),
    diffContent: projectArtifactDiff(name, type),
  };
}

export function projectArtifactContent(projectId: string, name: string, type: string): string {
  if (type === 'xlsx') {
    return [
      `# ${name}`,
      '',
      '| 维度 | 状态 | 备注 |',
      '|---|---|---|',
      '| 项目 | 已索引 | ' + projectId + ' |',
      '| 类型 | 表格产物 | 轻量预览先以 Markdown 表格呈现 |',
      '| 后续 | 待接入 | Sheet viewer / 导出 / provider sync |',
    ].join('\n');
  }

  if (type === 'md') {
    return [
      `# ${name}`,
      '',
      '## 项目产物',
      `- 项目：${projectId}`,
      '- 来源：Agent run / 项目归档',
      '- 浏览：当前使用 AgentHub 轻量预览，后续可接 Hub artifact store 正文。',
      '',
      '## 内容摘要',
      '这个文件已进入项目产物索引。项目页负责展示上下文，预览区负责阅读正文、源码和 Diff。',
    ].join('\n');
  }

  return [
    `// ${name}`,
    `// project: ${projectId}`,
    '// readonly artifact preview',
    '',
    'export const artifact = {',
    `  name: ${JSON.stringify(name)},`,
    `  projectId: ${JSON.stringify(projectId)},`,
    '  source: "AgentHub project artifact index",',
    '};',
  ].join('\n');
}

export function projectArtifactDiff(name: string, type: string): string | undefined {
  if (type === 'xlsx') return undefined;
  return [
    `diff --git a/${name} b/${name}`,
    `--- a/${name}`,
    `+++ b/${name}`,
    '@@ project artifact preview @@',
    `+${name}`,
    '+已接入 AgentHub 轻量项目产物预览。',
  ].join('\n');
}
