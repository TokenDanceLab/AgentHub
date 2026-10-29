import { getPinMapStore } from '@shared/transcript';
import { getAgentActivityStore } from '@shared/transcript/agentActivity';
import { getMessageDelegationStore, getSubagentStreamStore } from '@agenthub/workbench';
import { queryClient } from '@/api/queryClient';
import { useConnectionStore } from '@/stores/connectionStore';

export function clearWebSessionData(): void {
  void queryClient.cancelQueries();
  queryClient.clear();
  getPinMapStore().reset();
  getAgentActivityStore().reset();
  getMessageDelegationStore().reset();
  getSubagentStreamStore().reset();
  useConnectionStore.setState({ isConnected: false, reconnecting: false, lastEventSeq: {}, recoveryState: 'idle', recoveryError: null });
  try {
    const cachedKeys = Object.keys(localStorage).filter((key) => key.startsWith('agenthub.settings.'));
    cachedKeys.forEach((key) => localStorage.removeItem(key));
  } catch { /* storage disabled */ }
}
