import type { Meta, StoryObj } from '@storybook/react';
// Side-effect import initializes the desktop i18next instance (real locale
// resources) so the overlay renders actual zh/en copy in Storybook.
import '../i18n';
import { OnboardingOverlay } from './OnboardingOverlay';

const meta: Meta<typeof OnboardingOverlay> = {
  title: 'Desktop/OnboardingOverlay',
  component: OnboardingOverlay,
  args: {
    onFinish: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof OnboardingOverlay>;

export const FirstStep: Story = {};
