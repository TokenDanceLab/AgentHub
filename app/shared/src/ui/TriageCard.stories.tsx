import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ArrowRight, Clock3, ShieldAlert } from 'lucide-react';
import { TriageCard } from './TriageCard';

const meta: Meta<typeof TriageCard> = {
  title: 'UI/TriageCard',
  component: TriageCard,
};

export default meta;
type Story = StoryObj<typeof TriageCard>;

export const ReviewShortcut: Story = {
  args: {
    eyebrow: 'Next review',
    title: 'Run run_mobi',
    meta: <><Clock3 size={12} /> May 27</>,
    icon: <ShieldAlert size={18} />,
    actionIcon: <ArrowRight size={17} />,
  },
};
