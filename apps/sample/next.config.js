/** @type {import('next').NextConfig} */

const API_URL = process.env.API_URL || "http://127.0.0.1:5328";

const nextConfig = {
  reactStrictMode: true,
  compiler: {
    styledComponents: true,
  },
  env: {
    // Expose the transport selector to the browser bundle. Defaults to the mock
    // server transport when the app is started via `dev:default-mock`.
    DMK_CONFIG_TRANSPORT:
      process.env.DMK_CONFIG_TRANSPORT ||
      (process.env.npm_lifecycle_event === "dev:default-mock"
        ? "mockserver"
        : ""),
  },
  rewrites: async () => {
    return [
      {
        source: "/api/:path*",
        destination:
          process.env.NODE_ENV === "development"
            ? `${API_URL}/api/:path*`
            : "/api/",
      },
    ];
  },
};

module.exports = nextConfig;
