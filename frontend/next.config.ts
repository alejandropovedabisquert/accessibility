import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  output: 'standalone',
  // No generar AGENTS.md / CLAUDE.md automaticamente en cada build.
  agentRules: false,
  // El navegador nunca llama a la API directamente: todo pasa por este proxy,
  // asi el front siempre es mismo-origen y no dependemos de CORS.
  async rewrites() {
    return [{ source: '/api/backend/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
