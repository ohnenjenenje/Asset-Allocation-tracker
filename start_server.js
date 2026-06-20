const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const dotenv = require('dotenv');

if (fs.existsSync('.env')) dotenv.config({ path: '.env' });
if (fs.existsSync('.env.local')) dotenv.config({ path: '.env.local', override: true });

const dev = true;
const port = 3000;

// Omit the 0.0.0.0 hostname here so Next.js dynamically uses your phone's real IP for JavaScript files
const app = next({ dev, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  })
  .once('error', (err) => {
    console.error(err);
    process.exit(1);
  })
  // Bind to 0.0.0.0 down here at the hardware level only
  .listen(port, '0.0.0.0', () => {
    console.log(`> Ready on port ${port} (Listening on all Wi-Fi interfaces)`);
  });
}).catch(err => {
  console.error(err);
});
