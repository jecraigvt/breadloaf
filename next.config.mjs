/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "@prisma/client"],
  images: { localPatterns: [{ pathname: "/photos/**" }, { pathname: "/icon-*.png" }, { pathname: "/apple-touch-icon.png" }] },
  async redirects() {
    // Keep old www bookmarks on the same origin as sign-in links and forms.
    return [{ source: "/:path*", has: [{ type: "host", value: "www\\.breadloafhill\\.com" }], destination: "https://breadloafhill.com/:path*", permanent: true }];
  },
  async headers() {
    const policy = ["default-src 'self'", `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "media-src 'self' blob:",
      "connect-src 'self' https://api.open-meteo.com", "frame-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" }, { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" }, { key: "Content-Security-Policy", value: policy },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
    ] }, { source: "/login/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] }];
  },
};

export default nextConfig;
// build: 1742342400
