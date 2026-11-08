// Backup API keys. Any key setting in .env can hold several keys separated
// by commas, e.g. GROQ_API_KEY=gsk_main,gsk_backup
// A call goes out on the first key that isn't resting; if it hits its limit
// (429) or is rejected (401/403), that key rests and the same call is
// retried straight away on the next one — no break in the service.
const RATE_LIMIT_REST_MS = 10 * 60000;     // limit reached: try it again in 10 minutes
const REJECTED_REST_MS = 24 * 60 * 60000;  // bad/revoked key: leave it for a day

const restingUntil = new Map(); // key -> timestamp

function list(envName) {
  return String(process.env[envName] || '').split(',').map(k => k.trim()).filter(Boolean);
}

function available(envName) {
  const now = Date.now();
  return list(envName).filter(k => !(restingUntil.get(k) > now));
}

// Runs fn(key) with each usable key in turn until one succeeds
async function withKey(envName, fn) {
  const all = list(envName);
  if (!all.length) {
    const err = new Error(`${envName} is not set`);
    err.code = 'NO_KEY';
    throw err;
  }
  // If every key is resting, try them anyway: a limit may have reset early
  const keys = available(envName).length ? available(envName) : all;
  let lastErr;
  for (const key of keys) {
    try {
      return await fn(key);
    } catch (err) {
      lastErr = err;
      const status = err.status;
      if (status !== 429 && status !== 401 && status !== 403) throw err; // not a key problem
      restingUntil.set(key, Date.now() + (status === 429 ? RATE_LIMIT_REST_MS : REJECTED_REST_MS));
      if (keys.length > 1) console.log(`[Keys] ${envName} key …${key.slice(-4)} ${status === 429 ? 'hit its limit' : 'was rejected'} — using the next key`);
    }
  }
  throw lastErr;
}

module.exports = { withKey, list, available, _reset: () => restingUntil.clear() };
