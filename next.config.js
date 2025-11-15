/**
 * @type {import('next').NextConfig}
 */
module.exports = {
  env: {
    commitTag: process.env.COMMIT_TAG || 'local',
  },
  images: {
    domains: ['image.tmdb.org'],
  },
  webpack(config, { isServer }) {
    config.module.rules.push({
      test: /\.svg$/,
      issuer: /\.(js|ts)x?$/,
      use: ['@svgr/webpack'],
    });

    // Fix for Konva in Next.js client-side bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }

    return config;
  },
  transpilePackages: ['konva', 'react-konva'],
  experimental: {
    scrollRestoration: true,
    largePageDataBytes: 256000,
  },
};
