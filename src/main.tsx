import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ensureSeeded } from './db/seed'
import './index.css'
import { Backlog } from './screens/Backlog'
import { Plan } from './screens/Plan'
import { Settings } from './screens/Settings'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Plan /> },
      { path: '/backlog', element: <Backlog /> },
    ],
  },
  { path: '/settings', element: <Settings /> },
])

ensureSeeded().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
})
