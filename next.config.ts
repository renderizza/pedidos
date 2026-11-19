import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Habilita forbidden() para responder 403 com a UI de src/app/forbidden.tsx.
    authInterrupts: true,
  },
};

export default nextConfig;
