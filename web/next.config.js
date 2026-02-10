/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@pulumi/pulumi'],
  },
};

module.exports = nextConfig;
