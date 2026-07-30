import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Impede o Turbopack de tentar bundlar pdf-parse/pdfjs-dist no server-side.
  // Esses pacotes usam web workers e precisam rodar como módulos Node.js nativos.
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
};

export default nextConfig;
