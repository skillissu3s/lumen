# Brief 10 — email codes: sign in with a code, two-step for admins, password reset, invite emails

Read `AGENTS.md`, `docs/API.md`, and the server: `server/config.js`, `server/db.js`, `server/auth.js`, `server/api.js`, `server/server.test.js`. Change ONLY files under `server/`, plus `docs/API.md` and `.env.example`. `nodemailer` (v10) is installed. Server only — no client/UI work (the owner writes the screens against the API below).

## Configuration (`server/config.js`)
- `SMTP_URL` (e.g. `smtps://user:pass@host`) or `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (default: true when port is 465), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (default: SMTP_USER).
- `MAIL_LOG_CODES=1` (development): with no SMTP configured, "send" by printing the email (to, subject, text) to the server log.
- `MAIL_CAPTURE_FILE=<path>` (tests): also append every email as one JSON line `{ to, subject, text, code? }` to that file.
- Email is **on** when SMTP is configured or `MAIL_LOG_CODES=1`. Always **off** in desktop mode.

## `server/mail.js`
`mailEnabled()`, `sendMail({ to, subject, text, html })` (nodemailer transport created once; errors logged and rethrown as `HttpError(502, 'Couldn’t send the email. Try again in a minute.')`), and three message builders with plain-text + simple HTML (system font, one short paragraph, the code in large monospace or a button for the link, the app name from `APP_NAME`):
- `codeMail(code, purpose)` — subject `Your Lumen code: 123456` (purpose `login`/`admin`) or `Reset your Lumen password` (`reset`); says the code expires in 10 minutes and to ignore the email if it wasn't them.
- `inviteMail(url, inviterName)` — subject `<name> invited you to Lumen`, the link, expires in INVITE_DAYS days.
On startup log one line: `[mail] smtp <host>`, `[mail] logging to console`, or `[mail] off`.

## Codes — `server/codes.js` + a `codes` table in db.js
`codes (id TEXT PK, email TEXT, purpose TEXT, code_hash TEXT, challenge_hash TEXT NULL, user_id TEXT NULL, attempts INT DEFAULT 0, created_at INT, expires_at INT, used_at INT NULL)`.
- `issueCode({ email, purpose, userId, challenge })`: 6 digits from `crypto.randomInt(0, 1e6)` zero-padded; store `sha256(SECRET + code)` (use `config.SECRET`); expires in 10 minutes; issuing a new code for the same email+purpose invalidates older unused ones. Returns the code.
- `checkCode({ email | challenge, purpose, code })`: the newest unused, unexpired code; constant-time compare; each wrong try increments `attempts`; after 5 wrong tries the code is dead. On success mark `used_at`. Throws `HttpError(400, 'That code is wrong or has expired.')` for every failure (never say which).
- Rate limits (in memory is fine): at most 5 codes per email per 15 minutes and 20 per IP per hour → `HttpError(429, 'Too many codes requested. Wait a few minutes.')`.

## API (add to `server/api.js`, document in `docs/API.md`)
- `GET /api/info` → add `mail: boolean`.
- `POST /api/login` `{ email, password }` — unchanged for members. **For admins when mail is on**: after the password is right, don't sign in; issue an `admin` code to their email bound to a new random challenge (store its sha256 in `challenge_hash` + `user_id`) and answer `{ needsCode: true, challenge, email: masked }` (mask like `ni…@gmail.com`). When mail is off, admins sign in with the password as today.
- `POST /api/login/verify` `{ challenge, code }` → checks the `admin` code for that challenge → signs in → `{ user }`.
- `POST /api/login/code` `{ email }` — passwordless sign-in for members: if mail is on and an enabled **member** account has that email, issue a `login` code and send it. **Always** answer `{ sent: true }` (don't reveal accounts). 404 `{ error }` only if mail is off.
- `POST /api/login/code/verify` `{ email, code }` → checks the `login` code → signs in → `{ user }`. Admins can never sign in this way (their codes are only issued as `admin`).
- `POST /api/password/forgot` `{ email }` — if mail is on and an enabled account (any role) has that email, issue a `reset` code. Always `{ sent: true }`.
- `POST /api/password/reset` `{ email, code, password }` → checks the `reset` code, validates and sets the password, ends all that user's sessions, then: members are signed in (`{ user }`); admins get `{ ok: true }` and sign in normally (password + code).
- `POST /api/admin/invites` — when mail is on and the invite has an email, also send `inviteMail`; add `emailed: true|false` to the response (a send failure must not fail the invite: `emailed: false` + `emailError`).
- All new routes go through the existing CSRF/JSON middleware and the same error mapping; login rate limiting continues to apply to `/login`.

## Tests (`server/server.test.js`, extend the existing harness)
Start the test server with `MAIL_LOG_CODES=1` and `MAIL_CAPTURE_FILE=<temp file>`; read codes back from that file. Cover: info shows `mail: true`; member passwordless login (request → code → verify → `/api/me` works); wrong code ×5 kills it; unknown email still gets `{ sent: true }` and no email captured; admin login returns `needsCode` and no cookie, verify signs in; admin can't use `/login/code`; forgot/reset for a member (old sessions ended, can log in with the new password); invite with email is emailed; rate limit returns 429. Keep every existing test passing (the existing admin login test may need to go through the code step now — update it).

Done when `npm test` passes and `node server/index.js` with `MAIL_LOG_CODES=1` prints `[mail] logging to console`. Report the exact request/response shapes you implemented.
