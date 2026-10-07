/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // The old About page now lives on the portfolio.
      { source: '/about', destination: `${process.env.NEXT_PUBLIC_PORTFOLIO_URL || 'https://drix10.com'}`, permanent: true },
      // Page 1 of every list is the list itself.
      { source: '/archive/1', destination: '/', permanent: true },
      { source: '/categories/:category/page/1', destination: '/categories/:category', permanent: true },
    ];
  },
};

module.exports = nextConfig;
