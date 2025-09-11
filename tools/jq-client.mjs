#!/usr/bin/env node
// Lightweight J-Quants client with auto token refresh
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const BASE = 'https://api.jpx-jquants.com';
const ROOT = path.resolve(path.join(process.cwd(), 'tools', '.secrets'));
const TOKENS = path.join(ROOT, 'jq-token.json');

async function ensureIdToken(){
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS,'utf8'));
    if(tokens?.idToken && tokens?.idTokenExp && (tokens.idTokenExp - Date.now() > 120000)) return tokens.idToken;
  } catch {}
  // attempt refresh
  const { default: login } = await import('./jq-login.mjs');
  await login();
  const tokens2 = JSON.parse(fs.readFileSync(TOKENS,'utf8'));
  if(!tokens2?.idToken) throw new Error('Cannot obtain idToken');
  return tokens2.idToken;
}

export async function jqFetch(pathname, opts={}){
  const idToken = await ensureIdToken();
  const headers = { 'Authorization': `Bearer ${idToken}`, ...(opts.headers||{}) };
  const url = pathname.startsWith('http') ? pathname : (BASE + pathname);
  let r = await fetch(url, { ...opts, headers });
  if(r.status === 401){
    const { default: login } = await import('./jq-login.mjs');
    await login('--refresh-only');
    const id2 = await ensureIdToken();
    r = await fetch(url, { ...opts, headers: { ...headers, Authorization: `Bearer ${id2}` } });
  }
  if(!r.ok) throw new Error(`jqFetch ${pathname} http ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) return r.json();
  return r.text();
}

// Quick test: node tools/jq-client.mjs /v1/markets
if (import.meta.url === `file://${process.argv[1]}`) {
  const p = process.argv[2] || '/v1/markets';
  jqFetch(p).then(j=>{ console.log(JSON.stringify(j,null,2)); }).catch(e=>{ console.error(e?.message||e); process.exit(1); });
}
