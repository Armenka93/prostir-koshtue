import type { Metadata, Viewport } from 'next'
import './globals.css'
import ClientOnly from '@/components/ClientOnly'

export const metadata: Metadata = {
  title: 'Простір Коштує',
  description: 'Оренда комерційної нерухомості — офіси, рітейл, склади, кафе та гнучкі простори в Одесі',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Простір Коштує',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#FF6B1A',
  viewportFit: 'cover',
  // Makes 100dvh resize when the keyboard opens so position:fixed
  // containers correctly shrink to the visible area above the keyboard.
  interactiveWidget: 'resizes-visual',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/logo-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          minHeight: '100dvh',
          background: '#060810',
        }}>
          <div style={{
            width: '100%',
            maxWidth: 430,
            background: '#0F1117',
            minHeight: '100dvh',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <ClientOnly>{children}</ClientOnly>
          </div>
        </div>
      </body>
    </html>
  )
}
