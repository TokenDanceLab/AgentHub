import { createRoot } from 'react-dom/client'
import DesignSystemProvider from './DesignSystemProvider'
import App from './App'
import './design/global.css'
import './theme/tokens-dark.css'

createRoot(document.getElementById('root')!).render(
  <DesignSystemProvider>
    <App />
  </DesignSystemProvider>
)
