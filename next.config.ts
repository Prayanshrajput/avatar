import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server.js and only the traced
  // node_modules, which is what the Space's Dockerfile ships.
  output: "standalone",

  // Dev-only. Next 16 blocks cross-origin /_next/* and the HMR websocket unless the
  // Origin host is listed here (server/lib/router-utils/block-cross-site-dev.ts), and
  // for a ws upgrade it answers on a raw socket -- cloudflared then reports
  // 'malformed HTTP response "Unauthorized"'. Restart `next dev` after editing this.
  allowedDevOrigins: [
    "*.trycloudflare.com", // quick tunnels (hostname changes every run)
    "*.local", // mDNS, e.g. macbook.local
    // LAN IP is DHCP-assigned and changes; a /16-ish net has no wildcard form here,
    // so add the current one when testing over Wi-Fi: `ipconfig getifaddr en0`.
    "192.168.7.190",
  ],
};

export default nextConfig;
