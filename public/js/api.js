const CREDS_KEY = 'webxr-meetup:creds';

export function loadCreds() {
  try {
    const creds = JSON.parse(localStorage.getItem(CREDS_KEY));
    return creds && creds.id && creds.token ? creds : null;
  } catch {
    return null;
  }
}

export function saveCreds(creds) {
  try {
    localStorage.setItem(CREDS_KEY, JSON.stringify(creds));
  } catch {
    /* private mode: the session just won't be remembered */
  }
}

export function clearCreds() {
  try {
    localStorage.removeItem(CREDS_KEY);
  } catch {
    /* ignore */
  }
}

async function call(path, { method = 'GET', body, auth } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${auth.id}.${auth.token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  meta: () => call('/meta'),
  rooms: () => call('/rooms'),
  createRoom: (auth, name) => call('/rooms', { method: 'POST', body: { name }, auth }),
  register: (profile) => call('/players', { method: 'POST', body: profile }),
  me: (auth) => call('/players/me', { auth }),
  updateMe: (auth, profile) => call('/players/me', { method: 'PATCH', body: profile, auth }),
};
