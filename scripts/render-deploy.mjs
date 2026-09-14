// Create or update the Render web service for this repo via the Render API.
// Usage: RENDER_API_KEY=... node scripts/render-deploy.mjs [--supabase-url URL --service-key KEY --secret S]
// Reads missing values from .env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COLLEGE_TRIGGER_SECRET, RENDER_API_KEY).
import { readFileSync, existsSync } from 'node:fs';

const env = existsSync('.env') ? Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])) : {};
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : [])).filter((x) => x.length));
const KEY = process.env.RENDER_API_KEY || env.RENDER_API_KEY;
if (!KEY) { console.error('RENDER_API_KEY missing'); process.exit(1); }
const NAME = args.name || 'plaibook-college-scraper';
const REPO = args.repo || 'https://github.com/Hoosier-AI/CollegeScraper';
const supabaseUrl = args['supabase-url'] || process.env.DEMO_SUPABASE_URL || env.DEMO_SUPABASE_URL;
const serviceKey = args['service-key'] || process.env.DEMO_SUPABASE_SERVICE_KEY || env.DEMO_SUPABASE_SERVICE_KEY;
const secret = args.secret || process.env.DEMO_TRIGGER_SECRET || env.DEMO_TRIGGER_SECRET;
if (!supabaseUrl || !serviceKey || !secret) { console.error('need --supabase-url, --service-key, --secret (or DEMO_* in .env)'); process.exit(1); }

const api = async (path, init = {}) => {
  const r = await fetch(`https://api.render.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) } });
  const text = await r.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${r.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
};

const owners = await api('/owners?limit=20');
const owner = (owners.map((o) => o.owner)).find((o) => o.type === 'team') || owners[0].owner;
console.log('owner', owner.name, owner.id);

const envVars = [
  { key: 'SUPABASE_URL', value: supabaseUrl }, { key: 'SUPABASE_SERVICE_ROLE_KEY', value: serviceKey }, { key: 'COLLEGE_TRIGGER_SECRET', value: secret },
  { key: 'CONTACT_EMAIL', value: env.CONTACT_EMAIL || 'hoosieraisolutions@gmail.com' }, { key: 'COLLEGE_ALLOW_PROD', value: '1' }, { key: 'SCHEDULER_ENABLED', value: '1' },
  { key: 'LOG_LEVEL', value: 'info' }, { key: 'PORT', value: '8080' },
];

const existing = (await api(`/services?name=${encodeURIComponent(NAME)}&limit=10`)).map((s) => s.service).find((s) => s.name === NAME);
let service;
if (existing) {
  console.log('updating existing service', existing.id);
  await api(`/services/${existing.id}/env-vars`, { method: 'PUT', body: JSON.stringify(envVars) });
  service = existing;
} else {
  service = await api('/services', { method: 'POST', body: JSON.stringify({
    type: 'web_service', name: NAME, ownerId: owner.id, repo: REPO, branch: 'main', autoDeploy: 'yes', rootDir: '.',
    serviceDetails: { env: 'docker', plan: 'starter', region: 'oregon', healthCheckPath: '/health', envSpecificDetails: { dockerfilePath: './Dockerfile' } },
    envVars,
  }) });
  service = service.service || service;
  console.log('created service', service.id);
}
// Creation auto-starts a build; an explicit deploy is only needed on update (the API may answer with an empty body).
const deploy = existing ? await api(`/services/${service.id}/deploys`, { method: 'POST', body: JSON.stringify({ clearCache: 'do_not_clear' }) }) : null;
if (deploy) console.log('deploy', deploy.id, deploy.status);
console.log('url', service.serviceDetails?.url || `https://${NAME}.onrender.com`);
