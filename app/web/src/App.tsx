import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import WebLayout from '@/layouts/WebLayout';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WebLayout />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
