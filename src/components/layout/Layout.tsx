import { ReactNode } from 'react'
import { Header } from './Header'
import { BottomNav } from './BottomNav'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="pt-14 pb-20">
        <div className="max-w-4xl mx-auto px-4 py-4 md:py-6">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
