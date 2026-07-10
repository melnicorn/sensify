import Link from 'next/link'
import { Activity, Settings, BookOpen } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="flex-none h-14 border-b border-border flex items-center justify-between px-4 sm:px-6 shrink-0 bg-header">
        <div className="flex flex-col">
          <span className="text-xl font-light text-foreground tracking-wide">Sensify</span>
          <span className="text-xs font-light text-muted-foreground tracking-wide">
            Sensor data dashboard
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Activity size={16} />
            <span className="hidden sm:inline">Sensors</span>
          </Link>
          <Link
            href="/settings"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings size={16} />
            <span className="hidden sm:inline">Settings</span>
          </Link>
          <Link
            href="/docs"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <BookOpen size={16} />
            <span className="hidden sm:inline">API Docs</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 overflow-auto overscroll-contain p-4 sm:p-6">{children}</main>
      <footer className="flex-none h-10 border-t border-border flex items-center justify-center px-4 text-xs text-muted-foreground bg-footer">
        <span>
          POST sensor data to{' '}
          <code className="font-mono bg-muted px-1 rounded">/api/v1/readings</code>
          {' '}·{' '}
          <Link href="/docs" className="underline hover:no-underline">
            view API docs
          </Link>
        </span>
      </footer>
    </div>
  )
}
