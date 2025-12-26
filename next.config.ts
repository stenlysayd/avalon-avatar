import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Cari path absolut ke folder node_modules utama
    const rootNodeModules = path.join(process.cwd(), 'node_modules');

    // Paksa Webpack untuk selalu mengambil paket @pixi dari folder utama
    // Ini mencegah 'Dual Package Hazard' (konflik versi ganda)
    config.resolve.alias = {
      ...config.resolve.alias,
      'pixi.js': path.join(rootNodeModules, 'pixi.js'),
      '@pixi/core': path.join(rootNodeModules, '@pixi/core'),
      '@pixi/display': path.join(rootNodeModules, '@pixi/display'),
      '@pixi/ticker': path.join(rootNodeModules, '@pixi/ticker'),
      '@pixi/math': path.join(rootNodeModules, '@pixi/math'),
      '@pixi/utils': path.join(rootNodeModules, '@pixi/utils'),
      '@pixi/events': path.join(rootNodeModules, '@pixi/events'),
      '@pixi/sprite': path.join(rootNodeModules, '@pixi/sprite'),
      '@pixi/assets': path.join(rootNodeModules, '@pixi/assets'),
    };

    return config;
  },
};

export default nextConfig;