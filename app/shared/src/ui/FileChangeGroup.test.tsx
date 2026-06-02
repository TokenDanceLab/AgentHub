import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FileChangeGroup from './FileChangeGroup';
import type { FileChangeItem } from './FileChangeGroup';

const files: FileChangeItem[] = [
  { fileName: 'index.ts', fullPath: 'src/index.ts', insertions: 12, deletions: 3 },
  { fileName: 'utils.ts', fullPath: 'src/utils.ts', insertions: 5, deletions: 0 },
  { fileName: 'types.ts', fullPath: 'src/types.ts', insertions: 0, deletions: 8 },
];

describe('FileChangeGroup', () => {
  it('renders title and file count', () => {
    render(<FileChangeGroup title="3 files changed" files={files} />);
    expect(screen.getByText('3 files changed')).toBeDefined();
    expect(screen.getByText('3 files')).toBeDefined();
  });

  it('renders all file names', () => {
    render(<FileChangeGroup title="Changed Files" files={files} />);
    expect(screen.getByText('index.ts')).toBeDefined();
    expect(screen.getByText('utils.ts')).toBeDefined();
    expect(screen.getByText('types.ts')).toBeDefined();
  });

  it('shows insertion and deletion counts', () => {
    render(<FileChangeGroup title="Files" files={files} />);
    expect(screen.getByText('+12')).toBeDefined();
    expect(screen.getByText('-3')).toBeDefined();
    expect(screen.getByText('+5')).toBeDefined();
    expect(screen.getByText('-8')).toBeDefined();
  });

  it('renders diff buttons when onDiffClick is provided', () => {
    const onDiff = () => {};
    render(<FileChangeGroup title="Files" files={files} onDiffClick={onDiff} />);
    const diffBtns = screen.getAllByLabelText(/View diff/);
    expect(diffBtns.length).toBe(3);
  });

  it('collapses and expands on header click', () => {
    render(<FileChangeGroup title="Files" files={files} />);
    const header = screen.getByRole('button', { name: /Files/ });
    expect(screen.getByText('index.ts')).toBeDefined();
    fireEvent.click(header);
    expect(screen.queryByText('index.ts')).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText('index.ts')).toBeDefined();
  });

  it('returns null for empty files array', () => {
    const { container } = render(<FileChangeGroup title="No files" files={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('calls onFileClick when a file row is clicked', () => {
    const onFileClick = vi.fn();
    render(<FileChangeGroup title="Files" files={files} onFileClick={onFileClick} />);
    fireEvent.click(screen.getByText('index.ts'));
    expect(onFileClick).toHaveBeenCalledWith(files[0]);
  });

  it('calls onDiffClick without onFileClick', () => {
    const onDiff = vi.fn();
    render(<FileChangeGroup title="Files" files={files} onDiffClick={onDiff} />);
    const btn = screen.getAllByLabelText(/View diff/)[0];
    fireEvent.click(btn);
    expect(onDiff).toHaveBeenCalledWith(files[0]);
  });
});
