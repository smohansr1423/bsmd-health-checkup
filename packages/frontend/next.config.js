/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@health-checkup/shared'],
  // Exclude .test.ts files from being treated as Next.js pages
  pageExtensions: ['page.tsx', 'page.ts'],
  // Output standalone build for Docker deployment
  output: 'standalone',
  // API proxy to backend service
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
