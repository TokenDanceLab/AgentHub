import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <div />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
