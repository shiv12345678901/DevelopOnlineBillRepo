/**
 * BillForUs Apple Shortcuts trigger.
 * Deploy to: netlify/functions/shortcut-sync.mjs
 * URL: https://billforus.netlify.app/.netlify/functions/shortcut-sync
 *
 * Required Netlify Functions environment variables:
 * BILLFORUS_SHORTCUT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * INSTABOX_API_KEY, INSTABOX_MACHINE_ID
 *
 * Reuses the production service-role-only Supabase scheduled enqueue RPC
 * and existing InstaBox wake client. No direct receipt or settlement writes.
 */
import { timingSafeEqual } from 'node:crypto';
import { createInstaBoxClient } from './lib/instabox.mjs';

const COOLDOWN_SECONDS = 45;
const RESPONSE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const respond = (statusCode, payload, extraHeaders = {}) => ({
  statusCode,
  headers: { ...RESPONSE_HEADERS, ...extraHeaders },
  body: JSON.stringify(payload),
});

function authorized(header, configuredToken) {
  if (typeof configuredToken !== 'string' || configuredToken.length < 32) return false;
  const match = /^Bearer ([^\s]+)$/.exec(String(header || ''));
  if (!match) return false;
  const supplied = Buffer.from(match[1], 'utf8');
  const expected = Buffer.from(configuredToken, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function supabaseRequest(path, { method = 'GET', body } = {}) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

async function latestJob() {
  const path = 'sync_requests?select=id,status,created_at&requested_by=eq.netlify-app&order=created_at.desc&limit=1';
  const items = await supabaseRequest(path);
  return items?.[0] || null;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST required' }, { Allow: 'POST' });
  if (!authorized(event.headers?.authorization || event.headers?.Authorization, process.env.BILLFORUS_SHORTCUT_TOKEN)) {
    return respond(401, { error: 'Unauthorized' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY ||
      !process.env.INSTABOX_API_KEY || !process.env.INSTABOX_MACHINE_ID) {
    return respond(503, { error: 'Server configuration incomplete' });
  }
  try {
    const before = await latestJob();
    const alreadyActive = before && ['pending', 'processing'].includes(before.status);
    const recent = before && Number.isFinite(Date.parse(before.created_at)) &&
      Date.now() - Date.parse(before.created_at) < COOLDOWN_SECONDS * 1000;

    // Do not requeue after a scan which may still be propagating WhatsApp media.
    // The normal 20-minute cron remains a backstop.
    if (!alreadyActive && recent) {
      return respond(202, { accepted: true, reused: true, reason: 'cooldown' });
    }

    if (!alreadyActive) {
      // Production RPC is service-role-only and already deduplicates active jobs.
      await supabaseRequest('rpc/billforus_enqueue_scheduled_sync', { method: 'POST', body: {} });
    }

    let job = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      job = await latestJob();
      if (job && ['pending', 'processing'].includes(job.status)) break;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!job || !['pending', 'processing'].includes(job.status)) {
      return respond(503, { error: 'No active sync job was confirmed' });
    }

    try {
      const wake = await createInstaBoxClient({ apiKey: process.env.INSTABOX_API_KEY }).wakeMachine({
        machineId: process.env.INSTABOX_MACHINE_ID,
        requestId: job.id,
      });
      return respond(202, {
        accepted: true,
        reused: Boolean(alreadyActive),
        wake: wake.status,
        requestId: job.id,
      });
    } catch {
      // Queue remains pending; an existing scheduler or later request can retry wake-up.
      return respond(202, { accepted: true, reused: Boolean(alreadyActive), wake: 'delayed', requestId: job.id });
    }
  } catch {
    return respond(503, { error: 'Could not queue shortcut sync' });
  }
}
