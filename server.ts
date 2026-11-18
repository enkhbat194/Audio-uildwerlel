import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './src/server/appFactory';

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', createApiRouter());

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ahoj Česko — Audio Factory server listening on http://localhost:${PORT}`);
  });
}

startServer();
