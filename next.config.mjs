/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
// build: 1742342400
