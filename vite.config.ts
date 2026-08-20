import { defineConfig, type Plugin } from 'vite';
import { createVisitCounter } from './visitCounter';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/Gravity-Chess/' : '/',
  plugins: [visitCounterPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});

function visitCounterPlugin(): Plugin {
  const counter = createVisitCounter();
  return {
    name: 'gravity-chess-visit-counter',
    configureServer(server) {
      server.middlewares.use('/api/visits', async (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        try {
          if (request.method === 'GET') {
            response.end(JSON.stringify({ count: await counter.getCount() }));
            return;
          }
          if (request.method === 'POST') {
            const rawVisitId = request.headers['x-visit-id'];
            const visitId = (Array.isArray(rawVisitId) ? rawVisitId[0] : rawVisitId)?.slice(0, 128);
            response.end(JSON.stringify({ count: await counter.increment(visitId) }));
            return;
          }
          response.statusCode = 405;
          response.end(JSON.stringify({ message: 'Method not allowed' }));
        } catch {
          response.statusCode = 500;
          response.end(JSON.stringify({ message: 'Visit counter unavailable' }));
        }
      });
    }
  };
}
