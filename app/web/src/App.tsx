import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import styles from '@/App.module.css';

function LoadingFallback() {
  return (
    <main className={styles.preview}>
      <p>Loading...</p>
    </main>
  );
}

export default function App() {
  return (
    <div className={styles.root}>
      <Suspense fallback={<LoadingFallback />}>
        <RouterProvider router={router} />
      </Suspense>
    </div>
  );
}
