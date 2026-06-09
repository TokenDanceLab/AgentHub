import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { vi } from 'vitest';

const LobeIconMock = (props: { className?: string; title?: string }) =>
  React.createElement('span', {
    className: props.className,
    'data-testid': 'mock-lobe-icon',
    title: props.title,
  });

vi.mock('@lobehub/icons', () =>
  new Proxy(
    { __esModule: true, default: LobeIconMock },
    {
      get(target, property) {
        if (property in target) {
          return target[property as keyof typeof target];
        }
        return LobeIconMock;
      },
    },
  ),
);

vi.mock('@lobehub/icons/es/features/ProviderIcon/index.js', () => ({ default: LobeIconMock }));
vi.mock('@lobehub/icons/es/Antigravity/components/Color.js', () => ({ default: LobeIconMock }));
