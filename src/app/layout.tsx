import type {Metadata} from 'next'
import type {ReactNode} from 'react'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://www.tomvanz.com'),
  title: 'Tom Vanz',
  description: 'Tom Vanz: a map of trips, routes, and places, plus a video compressor for making drone videos smaller before you send them.',
}

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
