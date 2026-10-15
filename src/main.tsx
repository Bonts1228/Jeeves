import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ensureSeeded } from './db/seed'
import './index.css'
import { setupPwaUpdates } from './lib/pwa-update'
import { Backlog } from './screens/Backlog'
import { Brief } from './screens/Brief'
import { Inbox } from './screens/Inbox'
import { GoalScreen, ProjectScreen } from './screens/ListScreens'
import { Plan } from './screens/Plan'
import { Settings } from './screens/Settings'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Plan /> },
      { path: '/backlog', element: <Backlog /> },
      { path: '/inbox', element: <Inbox /> },
    ],
  },
  { path: '/brief', element: <Brief /> },
  { path: '/settings', element: <Settings /> },
  { path: '/goals/:id', element: <GoalScreen /> },
  { path: '/projects/:id', element: <ProjectScreen /> },
])

setupPwaUpdates()

ensureSeeded().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
})
