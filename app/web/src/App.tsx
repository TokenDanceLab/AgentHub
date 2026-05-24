import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import styles from '@/App.module.css';

function LoadingFallback() {
  return (
    <div className={styles.root}>
      <main className={styles.preview}>
        <p>Loading...</p>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
