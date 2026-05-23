import { type ReactNode } from 'react';
import { ToastContainer } from '@/components/Toast';

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ToastContainer />
    </>
  );
}
