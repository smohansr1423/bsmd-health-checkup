/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@health-checkup/shared'],
  // Exclude .test.ts files from being treated as Next.js pages
  pageExtensions: ['page.tsx', 'page.ts'],
};

module.exports = nextConfig;
