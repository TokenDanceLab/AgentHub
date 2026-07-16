export type MainchainStatusKind = 'done' | 'active' | 'waiting' | 'blocked' | 'empty';

export interface MainchainNode {
  id: string;
  label: string;
  detail: string;
  state: MainchainStatusKind;
}

export interface MainchainSummary {
  nodes: MainchainNode[];
  exportEnabled: boolean;
  exportLabel: string;
  exportDetail: string;
}
