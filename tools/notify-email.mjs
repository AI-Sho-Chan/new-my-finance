#!/usr/bin/env node
// Send a simple email via SMTP if nodemailer is available; otherwise print instructions
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONF = path.join(ROOT, 'tools', '.secrets', 'smtp.json');

async function main(){
  const title = process.argv[2] || 'Signal Alert';
  const message = process.argv.slice(3).join(' ') || 'Hello from MyFinance';
  const cfg = JSON.parse(fs.readFileSync(CONF,'utf8'));
  let nodemailer;
  try { nodemailer = await import('nodemailer'); } catch { nodemailer = null; }
  if (!nodemailer) {
    console.error('nodemailer not installed. Run: npm -C tools i nodemailer');
    console.log(`[EMAIL Fallback] ${title}: ${message}`);
    process.exit(0);
  }
  const transporter = nodemailer.default.createTransport({
    host: cfg.host,
    port: cfg.port || 587,
    secure: !!cfg.secure,
    auth: cfg.auth || undefined,
  });
  await transporter.sendMail({ from: cfg.from, to: cfg.to, subject: title, text: message });
  console.log('Email sent');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e=>{ console.error(e?.message||e); process.exit(1); });
}

export default main;

