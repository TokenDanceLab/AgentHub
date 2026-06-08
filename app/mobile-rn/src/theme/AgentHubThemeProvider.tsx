import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';

import type { MobileThemeMode } from '@/types';

import { getAgentHubTheme, type AgentHubThemeTokens } from './tokens';

interface AgentHubThemeContextValue {
  mode: MobileThemeMode;
  setMode: (mode: MobileThemeMode) => void;
  tokens: AgentHubThemeTokens;
}

const AgentHubThemeContext = createContext<AgentHubThemeContextValue | undefined>(undefined);

export function AgentHubThemeProvider({ children }: PropsWithChildren): React.ReactElement {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<MobileThemeMode>('system');
  const tokens = useMemo(
    () => getAgentHubTheme(mode, systemScheme === 'dark'),
    [mode, systemScheme],
  );
  const value = useMemo(
    () => ({ mode, setMode, tokens }),
    [mode, tokens],
  );

  return (
    <AgentHubThemeContext.Provider value={value}>
      {children}
    </AgentHubThemeContext.Provider>
  );
}

export function useAgentHubTheme(): AgentHubThemeContextValue {
  const context = useContext(AgentHubThemeContext);

  if (!context) {
    throw new Error('useAgentHubTheme must be used inside AgentHubThemeProvider');
  }

  return context;
}
