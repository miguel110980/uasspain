// Synthetic provider for the isolated Compose project only. Never Google proof.
import http from 'node:http';
import { generateKeyPairSync, createHash, randomUUID, sign } from 'node:crypto';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-google-key', use: 'sig', alg: 'RS256' };
const tickets = new Map();
const clientId = '1234-uasspain-fixture.apps.googleusercontent.com';
const clientSecret = 'synthetic-google-oauth-secret'; // pragma: allowlist secret - isolated provider
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = claims => { const input = `${b64({ alg: 'RS256', kid: jwk.kid })}.${b64(claims)}`; return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`; };
http.createServer(async (req, res) => {
  const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  let body = ''; for await (const part of req) { body += part; if (body.length > 32768) { reply(413, { error: 'size' }); return; } }
  try {
    if (req.method === 'GET' && req.url === '/health') return reply(200, { synthetic: true });
    if (req.method === 'GET' && req.url === '/certs') return reply(200, { keys: [jwk] });
    if (req.method === 'POST' && req.url === '/fixtures/issue') {
      const input = JSON.parse(body); const u = new URL(input.authorization_url);
      if (u.origin !== 'https://accounts.google.com' || u.searchParams.get('code_challenge_method') !== 'S256') return reply(400, { error: 'authorization_invalid' });
      const code = randomUUID(); tickets.set(code, { challenge: u.searchParams.get('code_challenge'), redirect: u.searchParams.get('redirect_uri'), nonce: u.searchParams.get('nonce'), subject: input.subject || randomUUID(), claims: input.claims || {}, used: false });
      return reply(200, { code, state: u.searchParams.get('state'), redirect_uri: u.searchParams.get('redirect_uri') });
    }
    if (req.method === 'POST' && req.url === '/token') {
      const form = new URLSearchParams(body), ticket = tickets.get(form.get('code'));
      if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) return reply(401, { error: 'invalid_client' });
      if (!ticket || ticket.used || form.get('grant_type') !== 'authorization_code' || form.get('redirect_uri') !== ticket.redirect || createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') !== ticket.challenge) return reply(400, { error: 'invalid_grant' });
      ticket.used = true; const now = Math.floor(Date.now() / 1000);
      const claims = { iss: 'https://accounts.google.com', aud: clientId, sub: ticket.subject, nonce: ticket.nonce, exp: now + 300, iat: now, email_verified: true, email: 'synthetic-google@example.invalid', hd: 'example.invalid', ...ticket.claims };
      return reply(200, { id_token: jwt(claims), token_type: 'Bearer', expires_in: 300 });
    }
    return reply(404, { error: 'not_found' });
  } catch { return reply(400, { error: 'invalid_request' }); }
}).listen(8080, '0.0.0.0');
