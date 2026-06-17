import './lib/buffer-polyfill' // MUST be first — runelib/bitcoinjs need a global Buffer
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { WalletProvider } from './wallet/WalletProvider'
import { ErrorBoundary } from './components/app/ErrorBoundary'
import '@fontsource-variable/pixelify-sans/index.css'
import '@fontsource-variable/inter/index.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <WalletProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </WalletProvider>
    </HashRouter>
  </StrictMode>,
)
