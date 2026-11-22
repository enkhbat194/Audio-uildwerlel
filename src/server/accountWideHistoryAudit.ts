/**
 * ElevenLabs account-wide history inventory.
 * Read-only GET requests; no text, IDs, URLs or credentials printed.
 * Runs only on isolated private Audio Factory POC.
 * Counts archived Flows subset separately; does NOT claim all records are audible until downloaded.
 */
export async function runAccountWideHistoryAudit(): Promise<void> {
  if (process.env.FREE_HOSTING_POC !== 'true' || process.env.AUDIO_ARCHIVE_ONLY !== 'true') return;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) { console.log('[AHOJ_ACCOUNT_HISTORY] skipped_missing_secret'); return; }

  type History = { history_item_id?: string; voice_id?: string; source?: string; date_unix?: number; };
  const counts: Record<string, number> = Object.create(null);
  const byMonth: Record<string, number> = Object.create(null);
  const byVoice = { hana: 0, jan: 0, other: 0 };
  let all = 0, flAfter = 0, oldest: number | null = null, newest: number | null = null, pages = 0;
  let cursor: string | undefined;
  const seen = new Set<string>();
  let complete = false, failure: string | null = null;
  try {
    for (let page = 0; page < 100; page++) {
      // No source filter and NO date filter: all accessible account history.
      const url = new URL('https://api.elevenlabs.io/v1/history');
      url.searchParams.set('page_size', '100');
      if (cursor) url.searchParams.set('start_after_history_item_id', cursor);
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 25000);
      let response: Response;
      try {
        response = await fetch(url, { headers: { 'xi-api-key': apiKey }, signal: ac.signal });
      } finally { clearTimeout(timeout); }
      if (!response.ok) { failure = 'history_http_' + response.status; break; }
      const body: any = await response.json();
      const batch: History[] = Array.isArray(body.history) ? body.history : [];
      pages++;
      for (const item of batch) {
        if (!item?.history_item_id || seen.has(item.history_item_id)) continue;
        seen.add(item.history_item_id);
        all++;
        const src = typeof item.source === 'string' && item.source ? item.source : '(unknown)';
        counts[src] = (counts[src] || 0) + 1;
        if (item.voice_id === '2qbJHyAaz7tHCfVZS6z3') byVoice.hana++;
        else if (item.voice_id === 'KIDKfqJyZ6ASuyzsKfh5') byVoice.jan++;
        else byVoice.other++;
        if (typeof item.date_unix === 'number' && Number.isFinite(item.date_unix)) {
          if (oldest === null || item.date_unix < oldest) oldest = item.date_unix;
          if (newest === null || item.date_unix > newest) newest = item.date_unix;
          const month = new Date(item.date_unix * 1000).toISOString().slice(0, 7);
          byMonth[month] = (byMonth[month] || 0) + 1;
          if (src.toLowerCase() === 'flows' && item.date_unix >= 1795132800) flAfter++;
        }
      }
      if (!body.has_more) { complete = true; break; }
      const next = body.last_history_item_id;
      if (typeof next !== 'string' || !next || next === cursor) {
        failure = 'pagination_cursor_invalid'; break;
      }
      cursor = next;
    }
    const report = {
      complete, pages, total_accessible: all, by_source: counts, by_voice: byVoice,
      by_month: byMonth, oldest_utc: oldest === null ? null : new Date(oldest * 1000).toISOString().slice(0, 10),
      newest_utc: newest === null ? null : new Date(newest * 1000).toISOString().slice(0, 10),
      flows_since_2026_11_20: flAfter, previous_archived_flows: 276,
      not_in_previous_276_by_count: complete ? all - flAfter : null,
      failure, read_only: true, tts_calls: 0, published: false
    };
    console.log('[AHOJ_ACCOUNT_HISTORY] ' + JSON.stringify(report));
  } catch (e) {
    console.log('[AHOJ_ACCOUNT_HISTORY] error_type=' + (e instanceof Error ? e.name : 'unknown') + ' pages=' + pages + ' read_only=true');
  }
}
