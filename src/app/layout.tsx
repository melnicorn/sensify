import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { Lato } from 'next/font/google'
import './globals.css'

const lato = Lato({ subsets: ['latin'], weight: ['400', '700'] })

export const metadata: Metadata = {
  title: 'Sensify',
  description: 'Sensor data dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={lato.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
