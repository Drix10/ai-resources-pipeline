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
      {
        source: '/blog',
        destination: 'https://blogs.drix10.com',
        permanent: true,
      },
      {
        source: '/blogs',
        destination: 'https://blogs.drix10.com',
        permanent: true,
      },
      {
        source: '/articles/:path*',
        destination: 'https://blogs.drix10.com/articles/:path*',
        permanent: true,
      },
      {
        source: '/categories/:path*',
        destination: 'https://blogs.drix10.com/categories/:path*',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
