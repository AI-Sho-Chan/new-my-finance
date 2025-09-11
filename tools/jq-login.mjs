#!/usr/bin/env node
// Login to J-Quants and manage tokens
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const BASE = 'https://api.jpx-jquants.com';
const ROOT = path.resolve(path.join(process.cwd(), 'tools', '.secrets'));
const CREDS = path.join(ROOT, 'jq-credentials.json');
const TOKENS = path.join(ROOT, 'jq-token.json');

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

async function loginWithPassword(){
  ensureDir(ROOT);
  if(!fs.existsSync(CREDS)) throw new Error(`Missing credentials file: ${CREDS}`);
  const { email, mailaddress, password } = JSON.parse(fs.readFileSync(CREDS,'utf8'));
  const body = { mailaddress: email || mailaddress, password };
  const r = await fetch(BASE + '/v1/token/auth_user', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if(!r.ok) throw new Error(`auth_user http ${r.status}`);
  const j = await r.json();
  const refreshToken = j.refreshToken || j.refreshtoken || j.refresh_token;
  if(!refreshToken) throw new Error('no refreshToken');
  const t = await refreshIdToken(refreshToken);
  return { refreshToken, ...t };
}

async function refreshIdToken(refreshToken){
  const r = await fetch(BASE + '/v1/token/auth_refresh', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ refreshToken }) });
  if(!r.ok) throw new Error(`auth_refresh http ${r.status}`);
  const j = await r.json();
  const idToken = j.idToken || j.id_token;
  if(!idToken) throw new Error('no idToken');
  const idTokenExp = Date.now() + 25*60*1000; // assume ~25min
  return { idToken, idTokenExp };
}

async function main(){
  const arg = process.argv.slice(2).join(' ');
  ensureDir(ROOT);
  let tokens = null;
  try { tokens = JSON.parse(fs.readFileSync(TOKENS,'utf8')); } catch {}
  try {
    if(arg.includes('--refresh-only')){
      if(!tokens?.refreshToken) throw new Error('no refreshToken stored');
      const t = await refreshIdToken(tokens.refreshToken);
      tokens = { ...tokens, ...t };
    } else if(!tokens?.refreshToken) {
      tokens = await loginWithPassword();
    } else if(!tokens?.idToken || !tokens?.idTokenExp || tokens.idTokenExp - Date.now() < 120000){
      const t = await refreshIdToken(tokens.refreshToken);
      tokens = { ...tokens, ...t };
    }
    fs.writeFileSync(TOKENS, JSON.stringify(tokens,null,2), 'utf8');
    console.log('JQ tokens updated');
    process.exit(0);
  } catch(e){
    console.error('JQ login error:', e?.message || e);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
