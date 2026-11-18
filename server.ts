import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './src/server/appFactory';

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Isolated free-hosting proof: never allow mutation, including billable TTS,
  // QA writes, Firestore sync or Drive sync. This guard is enabled ONLY on the
  // experimental service by FREE_HOSTING_POC=true; production remains unchanged.
  if (process.env.FREE_HOSTING_POC === 'true') {
    app.use('/api', (req, res, next) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        res.status(403).json({
          code: 'FREE_HOSTING_READ_ONLY',
          error: 'Free-hosting туршилт зөвхөн унших горимтой. Бодит TTS болон өгөгдлийн өөрчлөлт хаалттай.',
        });
        return;
      }
      next();
    });
  }

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
