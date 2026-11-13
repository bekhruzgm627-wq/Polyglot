'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const PORT = Number(process.env.PORT || 3000);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ROOT = path.join(__dirname, 'public');
const DB = path.join(__dirname, 'data', 'users.json');

fs.mkdirSync(path.dirname(DB), { recursive: true });

let users = [];
try {
  users = JSON.parse(fs.readFileSync(DB, 'utf8'));
} catch {}

const sessions = new Map();

function googleKeys() {
  return new Promise((resolve, reject) => {
    https
      .get('https://www.googleapis.com/oauth2/v3/certs', (r) => {
        let data = '';
        r.on('data', (chunk) => (data += chunk));
        r.on('end', () => {
          try {
            resolve(JSON.parse(data).keys);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function verifyGoogle(credential) {
  if (!GOOGLE_CLIENT_ID) throw Error('Google вход не настроен');

  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw Error('Неверный Google токен');

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

  if (header.alg !== 'RS256' || !header.kid) throw Error('Недопустимая подпись');
  if (
    payload.aud !== GOOGLE_CLIENT_ID ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
    Number(payload.exp) * 1000 < Date.now() ||
    !payload.email_verified ||
    !payload.sub
  ) {
    throw Error('Google токен не прошёл проверку');
  }

  const keys = await googleKeys();
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) throw Error('Ключ Google не найден');

  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(parts[0] + '.' + parts[1]),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url')
  );

  if (!verified) throw Error('Неверная подпись Google');
  return payload;
}

function persist() {
  const tmp = DB + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB);
}

function reply(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function hash(pass, salt) {
  return crypto.scryptSync(pass, salt, 64).toString('hex');
}

function token(user) {
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, user.id);
  return t;
}

function authed(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const id = sessions.get(t);
  return users.find((u) => u.id === id);
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100000) throw Error('Слишком большой запрос');
  }
  return JSON.parse(raw || '{}');
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'GET' && url.pathname === '/api/config') {
        return reply(res, 200, { googleClientId: GOOGLE_CLIENT_ID });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/google') {
        const d = await body(req);
        let claims;
        try {
          claims = await verifyGoogle(d.credential);
        } catch (e) {
          return reply(res, 401, { error: e.message });
        }

        const email = String(claims.email).toLowerCase();
        let u = users.find((x) => x.googleSub === claims.sub);

        if (!u) {
          u = users.find((x) => x.email === email);
          if (u && u.googleSub && u.googleSub !== claims.sub) {
            return reply(res, 409, { error: 'Email уже связан с другим Google аккаунтом' });
          }

          if (u) {
            u.googleSub = claims.sub;
          } else {
            u = {
              id: crypto.randomUUID(),
              email,
              name: String(claims.name || email.split('@')[0]).slice(0, 40),
              googleSub: claims.sub,
              progress: {
                vocabulary: {},
                xp: 0,
                course: 'es',
                name: String(claims.name || 'Ученик').slice(0, 40)
              }
            };
            users.push(u);
          }
          persist();
        }

        return reply(res, 200, { token: token(u), email: u.email });
      }

      if (req.method === 'POST' && url.pathname === '/api/register') {
        const d = await body(req);
        const email = String(d.email || '').trim().toLowerCase();
        const pass = String(d.password || '');
        const name = String(d.name || '').trim();

        if (!/^\S+@\S+\.\S+$/.test(email) || pass.length < 6 || name.length < 2) {
          return reply(res, 400, {
            error: 'Проверь имя, email и пароль (минимум 6 символов)'
          });
        }

        if (users.some((u) => u.email === email)) {
          return reply(res, 409, {
            error: 'Такой email уже зарегистрирован. Используй «Войти в аккаунт».'
          });
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const u = {
          id: crypto.randomUUID(),
          email,
          name,
          salt,
          passwordHash: hash(pass, salt),
          progress: { vocabulary: {}, xp: 0, course: 'es', name }
        };

        users.push(u);
        persist();
        return reply(res, 201, { token: token(u) });
      }

      if (req.method === 'POST' && url.pathname === '/api/login') {
        const d = await body(req);
        const u = users.find((u) => u.email === String(d.email || '').trim().toLowerCase());

        if (
          !u ||
          !u.passwordHash ||
          !u.salt ||
          !crypto.timingSafeEqual(
            Buffer.from(u.passwordHash, 'hex'),
            Buffer.from(hash(String(d.password || ''), u.salt), 'hex')
          )
        ) {
          return reply(res, 401, { error: 'Неверный email или пароль' });
        }

        return reply(res, 200, { token: token(u) });
      }

      const u = authed(req);
      if (!u) return reply(res, 401, { error: 'Сначала войди в аккаунт' });

      if (req.method === 'GET' && url.pathname === '/api/progress') {
        return reply(res, 200, u.progress);
      }

      if (req.method === 'PUT' && url.pathname === '/api/progress') {
        const d = await body(req);
        if (typeof d.vocabulary !== 'object' || Array.isArray(d.vocabulary) || !d.vocabulary) {
          return reply(res, 400, { error: 'Неверный формат прогресса' });
        }

        if (Object.keys(d.vocabulary).length > 5000) {
          return reply(res, 400, { error: 'Слишком много слов' });
        }

        u.progress = {
          vocabulary: d.vocabulary,
          xp: Math.max(0, Math.min(1e8, Number(d.xp) || 0)),
          course: String(d.course || 'es').slice(0, 8),
          name: u.name
        };

        persist();
        return reply(res, 200, { ok: true });
      }

      return reply(res, 404, { error: 'Маршрут не найден' });
    }

    const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.resolve(ROOT, '.' + decodeURIComponent(requestPath));

    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
      return reply(res, 403, { error: 'Доступ запрещён' });
    }

    const stat = fs.statSync(file);
    if (!stat.isFile()) return reply(res, 404, { error: 'Не найдено' });

    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });

    fs.createReadStream(file).pipe(res);
  } catch (e) {
    const status = e instanceof SyntaxError ? 400 : 500;
    const message = e instanceof SyntaxError ? 'Неверный JSON' : 'Ошибка сервера';
    reply(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log('Polyglot: http://localhost:' + PORT);
});
