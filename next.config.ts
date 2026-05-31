import type { NextConfig } from "next";

// Security headers applied to every route. Kept conservative so the Leaflet
// map tiles (CARTO) and the external geo/weather APIs the app calls still work.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // Production builds must fail on type errors. `next lint` was removed in
  // Next 16, so linting runs via the ESLint CLI (`npm run lint`) — there is no
  // `eslint` key in next.config anymore.
  typescript: { ignoreBuildErrors: false },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
