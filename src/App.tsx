import { Routes, Route } from 'react-router'
import EditorPage from '@/pages/EditorPage'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EditorPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
