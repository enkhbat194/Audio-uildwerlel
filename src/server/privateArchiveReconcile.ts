/**
 * Private Ahoj Česko history reconciliation.
 * READ ONLY: never invokes TTS or publishes/exports any content.
 * Source manifest is an env var, not committed into this public repository.
 */
export async function runPrivateArchiveReconcile(): Promise<void> {
  if (process.env.FREE_HOSTING_POC !== 'true' || process.env.AUDIO_ARCHIVE_ONLY !== 'true') return;
  const secret = process.env.ELEVENLABS_API_KEY;
  const raw = process.env.AHOJ_EXPECTED_MANIFEST_JSON;
  if (!secret || !raw) {
    console.log('[AHOJ_RECONCILE] skipped missing archive credentials or source registry');
    return;
  }

  type Expected = { id: string; text: string; voice_id: string };
  type HistoryItem = { history_item_id: string; text?: string; voice_id?: string; source?: string; date_unix?: number };
  let expected: Expected[];
  try {
    expected = JSON.parse(raw);
    if (!Array.isArray(expected) || expected.length !== 246 ||
        expected.some(r => !r || typeof r.id !== 'string' || typeof r.text !== 'string' || typeof r.voice_id !== 'string')) {
      throw new Error('Invalid 246 record manifest');
    }
  } catch {
    console.log('[AHOJ_RECONCILE] blocked invalid private manifest');
    return;
  }

  const key = (voice: string, text: string): string => JSON.stringify([voice, text.normalize('NFC')]);
  const expectedKeys = new Map<string, Expected>();
  for (const row of expected) {
    const k = key(row.voice_id, row.text);
    if (expectedKeys.has(k)) {
      console.log('[AHOJ_RECONCILE] blocked duplicate expected source key');
      return;
    }
    expectedKeys.set(k, row);
  }
  const historyByKey = new Map<string, HistoryItem[]>();
  const historyIds = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  try {
    for (let n = 0; n < 15; n++) {
      const u = new URL('https://api.elevenlabs.io/v1/history');
      u.searchParams.set('page_size', '100');
      u.searchParams.set('source', 'Flows');
      u.searchParams.set('date_after_unix', String(Math.floor(Date.parse('2026-11-20T00:00:00Z') / 1000)));
      if (cursor) u.searchParams.set('start_after_history_item_id', cursor);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 20000);
      let response: Response;
      try {
        response = await fetch(u, {headers: {'xi-api-key': secret}, signal: ac.signal});
      } finally {clearTimeout(timer);}
      if (!response.ok) {
        console.log('[AHOJ_RECONCILE] history_error=' + response.status);
        return;
      }
      const obj: any = await response.json();
      const arr: HistoryItem[] = Array.isArray(obj.history) ? obj.history : [];
      pages++;
      for (const item of arr) {
        if (!item || typeof item.history_item_id !== 'string' || historyIds.has(item.history_item_id)) continue;
        historyIds.add(item.history_item_id);
        if (!item.voice_id || typeof item.text !== 'string') continue;
        const k = key(item.voice_id, item.text);
        const matches = historyByKey.get(k) || [];
        matches.push(item);
        historyByKey.set(k, matches);
      }
      if (!obj.has_more) break;
      const next = obj.last_history_item_id;
      if (typeof next !== 'string' || !next || next === cursor) {
        console.log('[AHOJ_RECONCILE] blocked incomplete pagination');
        return;
      }
      cursor = next;
      if (n === 14) {
        console.log('[AHOJ_RECONCILE] blocked page_limit');
        return;
      }
    }
    const missing: string[] = [];
    const ambiguous: string[] = [];
    let matched = 0;
    for (const [k, expectedRow] of expectedKeys) {
      const hits = historyByKey.get(k) || [];
      if (hits.length === 0) missing.push(expectedRow.id);
      else if (hits.length > 1) ambiguous.push(expectedRow.id);
      else matched++;
    }
    let extraHanaJan = 0;
    for (const [k, hits] of historyByKey) {
      if (!expectedKeys.has(k) && hits.some(h=>['2qbJHyAaz7tHCfVZS6z3','KIDKfqJyZ6ASuyzsKfh5'].includes(h.voice_id || ''))) {
        extraHanaJan += hits.length;
      }
    }
    const report = {
      expected: expected.length, matched_unique: matched, missing_count: missing.length,
      ambiguous_count: ambiguous.length, additional_hana_jan_history: extraHanaJan,
      history_total_items: historyIds.size, pages, missing_ids: missing.slice(0,30),
      ambiguous_ids: ambiguous.slice(0,30), zero_tts: true, app_publish: false
    };
    console.log('[AHOJ_RECONCILE] ' + JSON.stringify(report));
  } catch (error) {
    console.log('[AHOJ_RECONCILE] runtime_error_type=' + (error instanceof Error ? error.name : 'unknown'));
  }
}
