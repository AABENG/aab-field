// Startup file for cPanel's Node.js app (Passenger). Keep this name: the
// cPanel "Application startup file" setting points at app.js.
const { start } = require('./src/server');

start().catch((err) => {
  console.error('Failed to start AAB Field:', err);
  process.exit(1);
});
