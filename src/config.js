// All settings come from environment variables, set in cPanel under
// Setup Node.js App -> Environment variables. Nothing secret lives in the code.
const env = process.env;

module.exports = {
  port: Number(env.PORT) || 3000,
  production: env.NODE_ENV === 'production',
  db: {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    database: env.DB_NAME || 'cm',
    user: env.DB_USER || 'cmapp',
    password: env.DB_PASSWORD || '',
  },
  // A long random string; sessions are signed with it.
  sessionSecret: env.SESSION_SECRET || '',
  // Behind GoDaddy's proxy the app sees http; trust the proxy so secure
  // cookies work once SSL is on.
  trustProxy: env.TRUST_PROXY !== '0',
  // Google Maps JavaScript API key (restricted to cm.aabeng.com). Optional:
  // without it the map picker and satellite layer are hidden.
  mapsKey: env.GOOGLE_MAPS_KEY || '',
};
