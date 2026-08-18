/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  async headers() {
    const isDev = process.env.NODE_ENV !== 'production'
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const supabaseWs = supabaseUrl.replace(/^https:/, 'wss:')

    // App Router streams RSC payloads to the client via inline <script>
    // tags (self.__next_f.push(...)) — without middleware-based nonce
    // injection, script-src needs 'unsafe-inline' or hydration breaks.
    // 'unsafe-eval' is added only in dev, where webpack HMR requires eval()
    // for source maps — it must never ship in the production header.
    const csp = [
      `default-src 'self'`,
      `img-src 'self' https://images.unsplash.com ${supabaseUrl} blob: data:`,
      `connect-src 'self' ${supabaseUrl} ${supabaseWs}`,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src 'self' https://fonts.gstatic.com data:`,
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      `frame-ancestors 'none'`,
      `object-src 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
    ].join('; ')

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ]
  },
}
module.exports = nextConfig
