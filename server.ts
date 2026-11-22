import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './src/server/appFactory';
import { runPrivateArchiveReconcile } from './src/server/privateArchiveReconcile';
import { runAccountWideHistoryAudit } from './src/server/accountWideHistoryAudit';


/**
 * PRIVATE READ-ONLY ElevenLabs history audit.
 * Never triggers TTS or writes/deletes anything. Never prints credentials or source texts.
 * Runs only on the isolated free-hosting proof service when explicitly enabled.
 */
async function runElevenLabsPrivateHistoryProbe() {
  if (process.env.AUDIO_ARCHIVE_ONLY !== 'true') return;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || process.env.FREE_HOSTING_POC !== 'true') {
    console.log('[AHOJ_HISTORY_PROBE] skipped: archive key or read-only isolation missing');
    return;
  }
  const expectedVoices = new Set([
    '2qbJHyAaz7tHCfVZS6z3',  // Hana
    'KIDKfqJyZ6ASuyzsKfh5'  // Jan
  ]);
  const counts = { total: 0, hana: 0, jan: 0, other: 0, pages: 0 };
  const sampleHistoryIds: string[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  try {
    for (let page = 0; page < 12; page++) {
      const u = new URL('https://api.elevenlabs.io/v1/history');
      u.searchParams.set('page_size', '100');
      u.searchParams.set('source', 'Flows');
      u.searchParams.set('date_after_unix', String(Math.floor(Date.parse('2026-11-20T00:00:00Z') / 1000)));
      if (cursor) u.searchParams.set('start_after_history_item_id', cursor);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      let response: Response;
      try {
        response = await fetch(u, { headers: { 'xi-api-key': apiKey }, signal: controller.signal });
      } finally { clearTimeout(timeout); }
      if (!response.ok) {
        console.log('[AHOJ_HISTORY_PROBE] request_failed status=' + response.status + ' (no key shown)');
        return;
      }
      const result: any = await response.json();
      const history: any[] = Array.isArray(result.history) ? result.history : [];
      counts.pages++;
      for (const item of history) {
        if (typeof item.history_item_id !== 'string' || seen.has(item.history_item_id)) continue;
        seen.add(item.history_item_id);
        if (expectedVoices.has(item.voice_id) && sampleHistoryIds.length < 2) sampleHistoryIds.push(item.history_item_id);
        counts.total++;
        if (item.voice_id === '2qbJHyAaz7tHCfVZS6z3') counts.hana++;
        else if (item.voice_id === 'KIDKfqJyZ6ASuyzsKfh5') counts.jan++;
        else counts.other++;
      }
      if (!result.has_more || !result.last_history_item_id || result.last_history_item_id === cursor) break;
      cursor = result.last_history_item_id;
    }
    console.log('[AHOJ_HISTORY_PROBE] completed=' + JSON.stringify(counts) + ' expected_hana_jan=246 private=true no_tts=true');
    if (sampleHistoryIds.length === 2) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch('https://api.elevenlabs.io/v1/history/download', {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({ history_item_ids: sampleHistoryIds }),
          signal: controller.signal,
        });
        if (!response.ok) {
          console.log('[AHOJ_HISTORY_DOWNLOAD_PROBE] request_failed status=' + response.status);
        } else {
          const binary = new Uint8Array(await response.arrayBuffer());
          const zipValid = binary.length > 4 && binary[0] === 0x50 && binary[1] === 0x4b;
          console.log('[AHOJ_HISTORY_DOWNLOAD_PROBE] status=' + (zipValid ? 'zip_verified' : 'invalid_zip') + ' items_requested=2 bytes=' + binary.length + ' no_tts=true no_publishing=true');
        }
      } catch (error) {
        console.log('[AHOJ_HISTORY_DOWNLOAD_PROBE] error=' + (error instanceof Error ? error.name : 'unknown'));
      } finally { clearTimeout(timeout); }
    }

  } catch (error) {
    console.log('[AHOJ_HISTORY_PROBE] network_or_parse_error type=' + (error instanceof Error ? error.name : 'unknown'));
  }
}

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
    void runElevenLabsPrivateHistoryProbe();
    void runPrivateArchiveReconcile();
    void runAccountWideHistoryAudit();
  });
}

startServer();
