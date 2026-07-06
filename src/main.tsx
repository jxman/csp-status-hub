import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './botid.ts'
import './index.css'
import App from './App.tsx'
import { ManagePage } from './components/ManagePage.tsx'
import { AdminPage } from './components/AdminPage.tsx'

const ROUTES: Record<string, () => JSX.Element> = {
  '/manage': ManagePage,
  '/admin': AdminPage,
};

const RootView = ROUTES[window.location.pathname] ?? App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootView />
  </StrictMode>,
)
