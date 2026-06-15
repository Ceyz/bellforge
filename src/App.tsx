import { Routes, Route } from 'react-router-dom'
import { Landing } from './pages/Landing'
import { AppLayout } from './components/app/AppLayout'
import { Portfolio } from './pages/Portfolio'
import { Mint } from './pages/Mint'
import { Trade } from './pages/Trade'
import { Pools } from './pages/Pools'
import { Lend } from './pages/Lend'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<AppLayout />}>
        <Route index element={<Portfolio />} />
        <Route path="mint" element={<Mint />} />
        <Route path="trade" element={<Trade />} />
        <Route path="pools" element={<Pools />} />
        <Route path="lend" element={<Lend />} />
      </Route>
      <Route path="*" element={<Landing />} />
    </Routes>
  )
}
