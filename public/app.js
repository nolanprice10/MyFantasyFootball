const $app = document.getElementById('app');
const $sub = document.getElementById('subnav');
const $top = document.getElementById('topnav');
let meta;
const DEFAULT_SCORING = { passYd: 0.04, passTd: 4, int: -2, rushYd: 0.1, rushTd: 6, rec: 1, recYd: 0.1, recTd: 6, fumLost: -2, twoPt: 2 };
const STAT_KEYS = ['passAtt', 'passCmp', 'passYd', 'passTd', 'int', 'rushAtt', 'rushYd', 'rushTd', 'tgt', 'rec', 'recYd', 'recTd', 'fumLost', 'twoPt'];
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const APP_CONFIG = window.APP_CONFIG || {};
const AUTH_STORAGE_KEY = 'myfantasyfootball-auth-v1';
const AUTH_GUARD_KEY = 'myfantasyfootball-auth-guard-v1';
let session = null;
let currentUser = null;
let authMode = 'login';
let authNotice = '';
let inviteUrl = '';
const snake = (value) => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const camel = (value) => value.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
const dbObject = (value) => Object.fromEntries(Object.entries(value).map(([key, item]) => [snake(key), item]));
const appObject = (value) => Object.fromEntries(Object.entries(value).map(([key, item]) => [camel(key), item]));
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function configured() {
  return Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey);
}

function apiHeaders(accessToken = session?.access_token) {
  return { apikey: APP_CONFIG.supabaseAnonKey, Authorization: `Bearer ${accessToken || APP_CONFIG.supabaseAnonKey}` };
}

async function authRequest(path, body) {
  const response = await fetch(`${APP_CONFIG.supabaseUrl}/auth/v1/${path}`, {
    method: 'POST', headers: { ...apiHeaders(null), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || 'Authentication failed');
  return data;
}

function saveSession(nextSession) {
  session = nextSession;
  currentUser = nextSession?.user || null;
  if (session) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(AUTH_STORAGE_KEY);
}

async function restoreSession() {
  try { session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null'); } catch { session = null; }
  if (!session) return;
  if (session.expires_at && session.expires_at < Date.now() / 1000 + 60) {
    try {
      const refreshed = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
      saveSession({ ...refreshed, expires_at: Date.now() / 1000 + refreshed.expires_in });
    } catch { saveSession(null); return; }
  }
  const response = await fetch(`${APP_CONFIG.supabaseUrl}/auth/v1/user`, { headers: apiHeaders() });
  if (!response.ok) { saveSession(null); return; }
  currentUser = await response.json();
  session.user = currentUser;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

async function signIn(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const attempts = JSON.parse(localStorage.getItem(AUTH_GUARD_KEY) || '{}');
  const guard = attempts[normalizedEmail];
  if (guard?.cooldownUntil > Date.now()) {
    const seconds = Math.ceil((guard.cooldownUntil - Date.now()) / 1000);
    throw new Error(`Too many sign-in attempts. Try again in ${seconds} seconds.`);
  }
  try {
    const data = await authRequest('token?grant_type=password', { email: normalizedEmail, password });
    delete attempts[normalizedEmail];
    localStorage.setItem(AUTH_GUARD_KEY, JSON.stringify(attempts));
    saveSession({ ...data, expires_at: Date.now() / 1000 + data.expires_in });
  } catch (error) {
    const failures = (guard?.failures || 0) + 1;
    const cooldown = failures >= 5 ? 5 * 60_000 : failures >= 4 ? 60_000 : failures >= 3 ? 30_000 : 0;
    attempts[normalizedEmail] = { failures, cooldownUntil: Date.now() + cooldown };
    localStorage.setItem(AUTH_GUARD_KEY, JSON.stringify(attempts));
    throw error;
  }
}

async function signUp(email, password) {
  if (!passwordChecks(password).every(Boolean)) throw new Error('Use at least 12 characters with uppercase, lowercase, a number, and a symbol.');
  const redirectTo = new URL(location.href);
  redirectTo.hash = '';
  redirectTo.search = '';
  const data = await authRequest(`signup?redirect_to=${encodeURIComponent(redirectTo.href)}`, { email, password });
  if (data.access_token) saveSession({ ...data, expires_at: Date.now() / 1000 + (data.expires_in || 3600) });
  else authNotice = 'Check your email to confirm your account, then sign in.';
}

async function completeAuthRedirect() {
  const params = new URLSearchParams(location.hash.slice(1));
  const queryParams = new URLSearchParams(location.search);
  const errorDescription = params.get('error_description') || queryParams.get('error_description');
  if (errorDescription) {
    authNotice = errorDescription.replaceAll('+', ' ');
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return;
  }
  const accessToken = params.get('access_token') || queryParams.get('access_token');
  const refreshToken = params.get('refresh_token') || queryParams.get('refresh_token');
  if (!accessToken || !refreshToken) return;
  const response = await fetch(`${APP_CONFIG.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: APP_CONFIG.supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Email confirmation succeeded, but sign-in could not be completed. Please sign in.');
  const user = await response.json();
  const expiresIn = Number(params.get('expires_in') || queryParams.get('expires_in')) || 3600;
  saveSession({ access_token: accessToken, refresh_token: refreshToken, token_type: params.get('token_type') || queryParams.get('token_type') || 'bearer',
    expires_in: expiresIn, expires_at: Number(params.get('expires_at') || queryParams.get('expires_at')) || Date.now() / 1000 + expiresIn, user });
  history.replaceState(null, '', location.pathname);
}

function passwordChecks(password) {
  return [password.length >= 12, /[a-z]/.test(password) && /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)];
}

function passwordStrength(password) {
  const score = passwordChecks(password).filter(Boolean).length;
  const label = !password ? 'Password strength' : score < 2 ? 'Weak' : score < 4 ? 'Fair' : 'Strong';
  return { score, label, valid: score === 4 };
}

async function signOut() {
  if (session) await fetch(`${APP_CONFIG.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: apiHeaders() });
  saveSession(null);
  location.hash = '#/';
  await route();
}

async function dbRequest(tablePath, method = 'GET', body, prefer = '') {
  if (session?.expires_at && session.expires_at < Date.now() / 1000 + 60) {
    try {
      const refreshed = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
      saveSession({ ...refreshed, user: refreshed.user || currentUser, expires_at: Date.now() / 1000 + refreshed.expires_in });
    } catch {
      saveSession(null);
      throw new Error('Your session expired. Sign in again.');
    }
  }
  const response = await fetch(`${APP_CONFIG.supabaseUrl}/rest/v1/${tablePath}`, {
    method,
    headers: { ...apiHeaders(), 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (['PGRST202', 'PGRST205'].includes(data?.code)) {
      throw new Error('Supabase database setup is missing. Run supabase/schema.sql in your project SQL Editor, then reload the site.');
    }
    throw new Error(data?.message || data?.details || data?.hint || 'Database request failed');
  }
  return data;
}

function fromLeague(row) {
  return { ...appObject(row), isOwner: row.owner_id === currentUser?.id,
    scoring: { ...DEFAULT_SCORING, ...(row.scoring || {}) } };
}

function pointsFor(stat, scoring) {
  return Math.round(Object.keys(DEFAULT_SCORING).reduce((sum, key) => sum + numeric(stat[key]) * numeric(scoring[key]), 0) * 100) / 100;
}

function scorePlayer(player, games, team, league) {
  const totals = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
  let points = 0;
  games.forEach((game) => {
    STAT_KEYS.forEach((key) => { totals[key] += numeric(game[key]); });
    points += pointsFor(game, league.scoring);
  });
  return { ...player, team: team || null, gp: games.length, totals, points: Math.round(points * 100) / 100,
    avg: games.length ? Math.round(points / games.length * 100) / 100 : 0 };
}

async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  const body = opts.body || {};
  if (path === '/meta') return { positions: POSITIONS, statKeys: STAT_KEYS, defaultScoring: DEFAULT_SCORING,
    sortKeys: ['points', 'avg', 'passYd', 'rushYd', 'recYd', 'totalYd', 'rec', 'tgt', 'td', 'name'] };
  if (!session) throw new Error('Sign in to access league data.');

  if (path === '/leagues' && method === 'GET') {
    return (await dbRequest('leagues?select=*&order=created_at.desc')).map(fromLeague);
  }
  if (path === '/leagues' && method === 'POST') {
    const row = { ...dbObject(body), owner_id: currentUser.id };
    return fromLeague((await dbRequest('leagues?select=*', 'POST', row, 'return=representation'))[0]);
  }
  if (path === '/leagues/join' && method === 'POST') {
    return dbRequest('rpc/join_league', 'POST', { invite: body.inviteCode });
  }
  const inviteMatch = path.match(/^\/leagues\/([^/]+)\/invite$/);
  if (inviteMatch && method === 'POST') {
    const code = await dbRequest('rpc/rotate_league_invite', 'POST', { target_league: inviteMatch[1] });
    return { url: `${location.origin}${location.pathname}#/join/${code}` };
  }
  const leagueMatch = path.match(/^\/leagues\/([^/]+)(?:\/(teams|players))?$/);
  if (leagueMatch) {
    const [, leagueId, section] = leagueMatch;
    if (!section && method === 'PUT') {
      const patch = dbObject(body);
      delete patch.remove_logo;
      if (!body.logo && !body.removeLogo) delete patch.logo;
      if (body.removeLogo) patch.logo = null;
      return fromLeague((await dbRequest(`leagues?id=eq.${leagueId}&select=*`, 'PATCH', patch, 'return=representation'))[0]);
    }
    if (!section && method === 'DELETE') {
      await dbRequest(`leagues?id=eq.${leagueId}`, 'DELETE');
      return null;
    }
    if (section === 'teams' && method === 'GET') return (await dbRequest(`teams?league_id=eq.${leagueId}&select=*&order=name`)).map(appObject);
    if (section === 'teams' && method === 'POST') {
      return appObject((await dbRequest('teams?select=*', 'POST', dbObject({ ...body, leagueId }), 'return=representation'))[0]);
    }
    if (section === 'players' && method === 'GET') {
      const playerRows = await dbRequest(`players?league_id=eq.${leagueId}&select=*&order=name`);
      if (!playerRows.length) return [];
      const playerIds = playerRows.map((player) => player.id);
      const [teamRows, statRows, leagueRows] = await Promise.all([
        dbRequest(`teams?league_id=eq.${leagueId}&select=*`),
        dbRequest(`stats?player_id=in.(${playerIds.join(',')})&select=*`),
        dbRequest(`leagues?id=eq.${leagueId}&select=*`),
      ]);
      const league = fromLeague(leagueRows[0]);
      return playerRows.map((row) => {
        const player = appObject(row);
        const games = statRows.filter((game) => game.player_id === player.id).map(appObject);
        const team = teamRows.find((item) => item.id === row.team_id);
        return scorePlayer(player, games, team ? appObject(team) : null, league);
      });
    }
    if (section === 'players' && method === 'POST') {
      const player = { ...body, leagueId, teamId: body.teamId || null };
      return appObject((await dbRequest('players?select=*', 'POST', dbObject(player), 'return=representation'))[0]);
    }
  }
  const playerStatsMatch = path.match(/^\/players\/([^/]+)\/stats$/);
  if (playerStatsMatch && method === 'POST') {
    const row = dbObject({ ...body, playerId: playerStatsMatch[1] });
    return appObject((await dbRequest('stats?on_conflict=player_id%2Cweek&select=*', 'POST', row, 'resolution=merge-duplicates,return=representation'))[0]);
  }
  const playerMatch = path.match(/^\/players\/([^/]+)$/);
  if (playerMatch) {
    const playerId = playerMatch[1];
    if (method === 'DELETE') { await dbRequest(`players?id=eq.${playerId}`, 'DELETE'); return null; }
    if (method === 'PUT') {
      const patch = { ...body };
      if (patch.teamId !== undefined) patch.teamId = patch.teamId || null;
      return appObject((await dbRequest(`players?id=eq.${playerId}&select=*`, 'PATCH', dbObject(patch), 'return=representation'))[0]);
    }
    const rows = await dbRequest(`players?id=eq.${playerId}&select=*`);
    if (!rows.length) throw new Error('Player not found');
    const player = appObject(rows[0]);
    const [leagueRows, gameRows, teamRows] = await Promise.all([
      dbRequest(`leagues?id=eq.${player.leagueId}&select=*`),
      dbRequest(`stats?player_id=eq.${playerId}&select=*&order=week`),
      dbRequest(`teams?league_id=eq.${player.leagueId}&select=*`),
    ]);
    const league = fromLeague(leagueRows[0]);
    const games = gameRows.map((game) => ({ ...appObject(game), points: pointsFor(appObject(game), league.scoring) }));
    return { ...scorePlayer(player, games, appObject(teamRows.find((team) => team.id === rows[0].team_id) || {}), league),
      team: teamRows.find((team) => team.id === rows[0].team_id) ? appObject(teamRows.find((team) => team.id === rows[0].team_id)) : null,
      games, league };
  }
  const statMatch = path.match(/^\/stats\/([^/]+)$/);
  if (statMatch && method === 'DELETE') { await dbRequest(`stats?id=eq.${statMatch[1]}`, 'DELETE'); return null; }
  throw new Error('Request not found');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve(null);
  const r = new FileReader();
  r.onload = () => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 640 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const webp = canvas.toDataURL('image/webp', 0.8);
      resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.8));
    };
    image.onerror = () => reject(new Error('Could not read that image.'));
    image.src = r.result;
  };
  r.onerror = reject;
  r.readAsDataURL(file);
});

const photo = (p, cls = '') => p.photo
  ? `<img class="avatar ${cls}" src="${esc(p.photo)}" alt="">`
  : `<span class="avatar ${cls}" style="display:inline-flex;align-items:center;justify-content:center;font-weight:700;color:#fff;background:${esc(p.team?.color || '#888')}">${esc(p.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>`;

const logoImg = (o, size = 28) => o.logo ? `<img src="${esc(o.logo)}" alt="" style="width:${size}px;height:${size}px;border-radius:4px;object-fit:cover;background:#fff">` : '';

const teamTag = (t) => t ? `<span class="tag" style="background:${esc(t.color)}">${esc(t.abbr)}</span>` : '<span class="psub">&mdash;</span>';

function setNav(league, active) {
  $top.innerHTML = currentUser ? `<span class="account-email">${esc(currentUser.email)}</span><button class="btn small secondary" id="signout">Sign out</button>` : '';
  document.getElementById('signout')?.addEventListener('click', signOut);
  if (!league) { $sub.innerHTML = ''; return; }
  const tabs = [['players', 'Players'], ['leaders', 'Leaders'], ['teams', 'Teams']];
  if (league.isOwner) tabs.push(['add', 'Add Player'], ['settings', 'Settings']);
  $sub.innerHTML = `<span class="league-name">${logoImg(league, 26)}&nbsp;${esc(league.name)}</span>` +
    tabs.map(([k, l]) => `<a href="#/league/${league.id}/${k}" class="${active === k ? 'active' : ''}">${l}</a>`).join('');
}

function viewSetup() {
  setNav(null);
  $app.innerHTML = `<div class="card"><h2>Connect Supabase</h2><div class="card-body">
    <p>Add your Supabase project URL and public anon key to <code>public/config.js</code>, then reload.</p>
    <p>The public anon key is intended for browser use. Database access is protected by the row-level security policies in <code>supabase/schema.sql</code>.</p>
  </div></div>`;
}

function viewAuth() {
  setNav(null);
  const isSignup = authMode === 'signup';
  $app.innerHTML = `<div class="card auth-card"><h2>${isSignup ? 'Create account' : 'Sign in'}</h2><div class="card-body">
    ${authNotice ? `<p class="psub">${esc(authNotice)}</p>` : ''}
    <form id="authform"><div class="row"><label>Email<input type="email" name="email" autocomplete="email" required></label>
      <label>Password<input id="authPassword" type="password" name="password" minlength="${isSignup ? '12' : '8'}" autocomplete="${isSignup ? 'new-password' : 'current-password'}" required></label>
      ${isSignup ? '<div class="password-help"><div class="password-meter" role="progressbar" aria-label="Password strength" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0"><span id="passwordMeterFill"></span></div><span id="passwordStrengthLabel">Password strength</span><span class="psub">Use 12+ characters with uppercase, lowercase, a number, and a symbol.</span></div>' : ''}</div>
      <div class="auth-actions"><button class="btn">${isSignup ? 'Create account' : 'Sign in'}</button>
      <button class="btn secondary" type="button" id="authswitch">${isSignup ? 'I already have an account' : 'Create an account'}</button></div>
    </form></div></div>`;
  document.getElementById('authswitch').onclick = () => { authMode = isSignup ? 'login' : 'signup'; authNotice = ''; viewAuth(); };
  if (isSignup) {
    const passwordInput = document.getElementById('authPassword');
    const updateMeter = () => {
      const strength = passwordStrength(passwordInput.value);
      const fill = document.getElementById('passwordMeterFill');
      const meter = fill.parentElement;
      fill.style.width = `${strength.score * 25}%`;
      fill.dataset.level = strength.score;
      meter.setAttribute('aria-valuenow', strength.score);
      document.getElementById('passwordStrengthLabel').textContent = strength.label;
    };
    passwordInput.addEventListener('input', updateMeter);
  }
  document.getElementById('authform').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = event.currentTarget.querySelector('button[type="submit"],button:not([type])');
    submit.disabled = true;
    try {
      if (isSignup) await signUp(form.get('email'), form.get('password'));
      else await signIn(form.get('email'), form.get('password'));
      if (session) { authNotice = ''; await route(); }
      else viewAuth();
    } catch (error) { showError(event.currentTarget, error.message); }
    finally { submit.disabled = false; }
  };
}

async function joinLeague(code) {
  await api('/leagues/join', { method: 'POST', body: { inviteCode: code } });
  location.hash = '#/';
  await route();
}

function showError(form, msg) {
  let e = form.querySelector('.err');
  if (!e) { e = document.createElement('div'); e.className = 'err'; form.prepend(e); }
  e.textContent = msg;
}

/* ---------- Leagues ---------- */
async function viewLeagues() {
  setNav(null);
  const leagues = await api('/leagues');
  const s = meta.defaultScoring;
  $app.innerHTML = `
    <div class="card"><h2>My Leagues</h2>
      ${leagues.length ? `<div class="grid card-body">${leagues.map((l) => `
        <a class="card league-card" href="#/league/${l.id}/players"><h3>${logoImg(l, 36)} ${esc(l.name)}</h3>
        <span class="psub">${esc(l.sport)} &middot; ${esc(l.season)} ${l.isOwner ? '&middot; Owner' : '&middot; Shared with you'}</span></a>`).join('')}</div>`
        : '<div class="empty">No leagues yet. Create one below.</div>'}
    </div>
    <div class="card"><h2>Create a League</h2><div class="card-body">
      <form id="lform">
        <div class="row">
          <label>League name<input name="name" required maxlength="80" placeholder="Lincoln High Varsity"></label>
          <label>Sport / type<input name="sport" maxlength="80" placeholder="Flag Football"></label>
          <label>Season<input name="season" maxlength="20" placeholder="2026"></label>
          <label>Logo (optional)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/gif"></label>
        </div>
        <details style="margin-bottom:12px"><summary><b>Scoring settings (optional)</b></summary>
        <div class="row" style="margin-top:10px">${Object.entries(s).map(([k, v]) => `<label>${esc(k)}<input type="number" step="any" name="s_${k}" value="${v}"></label>`).join('')}</div></details>
        <button class="btn">Create League</button>
      </form></div></div>`;
  document.getElementById('lform').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const scoring = {};
    for (const k of Object.keys(s)) scoring[k] = fd.get('s_' + k);
    try {
      const logo = await fileToDataUrl(fd.get('logo'));
      const l = await api('/leagues', { method: 'POST', body: { name: fd.get('name'), sport: fd.get('sport'), season: fd.get('season'), scoring, logo } });
      location.hash = `#/league/${l.id}/add`;
    } catch (err) { showError(e.target, err.message); }
  };
}

/* ---------- Players table ---------- */
const COLS = [
  ['points', 'FPTS'], ['avg', 'AVG'], ['passYd', 'PYD'], ['passTd', 'PTD'], ['int', 'INT'],
  ['rushAtt', 'CAR'], ['rushYd', 'RYD'], ['rushTd', 'RTD'], ['tgt', 'TGT'], ['rec', 'REC'], ['recYd', 'REYD'], ['recTd', 'RETD'],
];
const SORT_OPTIONS = [['points', 'Overall rank (fantasy points)'], ['avg', 'Fantasy points per game'], ['totalYd', 'Total yards'], ['passYd', 'Passing yards'],
  ['rushYd', 'Rushing yards'], ['recYd', 'Receiving yards'], ['rec', 'Receptions'], ['tgt', 'Targets'], ['td', 'Total touchdowns'], ['name', 'Name (A-Z)']];
const colVal = (p, k) => {
  if (k === 'points' || k === 'avg') return p[k];
  if (k === 'totalYd') return p.totals.passYd + p.totals.rushYd + p.totals.recYd;
  if (k === 'td') return p.totals.passTd + p.totals.rushTd + p.totals.recTd;
  return p.totals[k];
};
const cmpPlayers = (k) => k === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => colVal(b, k) - colVal(a, k);

async function viewPlayers(league) {
  const players = await api(`/leagues/${league.id}/players`);
  let pos = 'ALL', sortKey = league.defaultSort || 'points', q = '';
  setNav(league, 'players');
  $app.innerHTML = `<div class="card">
    <div class="card-head">Players <span><select id="sortsel">${SORT_OPTIONS.map(([k, l]) => `<option value="${k}">Sort: ${l}</option>`).join('')}</select> <input id="q" placeholder="Search name..." style="width:180px"></span></div>
    <div class="filters" id="chips"></div>
    <div class="scroll"><table><thead id="thead"></thead><tbody id="tbody"></tbody></table></div></div>`;
  const render = () => {
    document.getElementById('chips').innerHTML = ['ALL', ...meta.positions].map((p) => `<button class="chip ${p === pos ? 'active' : ''}" data-p="${p}">${p}</button>`).join('');
    document.getElementById('thead').innerHTML = `<tr><th class="left rank">#</th><th class="left">Player</th><th>Team</th><th>GP</th>` +
      COLS.map(([k, l]) => `<th class="sortable" data-k="${k}">${l}${k === sortKey ? ' ▼' : ''}</th>`).join('') + '</tr>';
    const rows = players.filter((p) => (pos === 'ALL' || p.position === pos) && p.name.toLowerCase().includes(q))
      .sort(cmpPlayers(sortKey));
    document.getElementById('tbody').innerHTML = rows.length ? rows.map((p, i) => `<tr>
      <td class="left rank">${i + 1}</td>
      <td class="left"><div class="pcell">${photo(p)}<div><a class="pname" href="#/player/${p.id}">${esc(p.name)}</a>
        <span class="psub"><span class="pos pos-${p.position}">${p.position}</span> ${p.number ? '#' + esc(p.number) : ''}</span></div></div></td>
      <td>${teamTag(p.team)}</td><td>${p.gp}</td>
      ${COLS.map(([k]) => `<td class="${k === 'points' ? 'pts' : ''}">${k === 'points' || k === 'avg' ? f1(colVal(p, k)) : colVal(p, k)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${COLS.length + 4}" class="empty">${league.isOwner ? `No players. <a href="#/league/${league.id}/add">Add one</a>.` : 'No players have been added yet.'}</td></tr>`;
  };
  $app.onclick = (e) => {
    if (e.target.dataset.p) { pos = e.target.dataset.p; render(); }
    if (e.target.dataset.k) { sortKey = e.target.dataset.k; document.getElementById('sortsel').value = sortKey; render(); }
  };
  const sel = document.getElementById('sortsel');
  sel.value = sortKey;
  sel.onchange = () => { sortKey = sel.value; render(); };
  document.getElementById('q').oninput = (e) => { q = e.target.value.toLowerCase(); render(); };
  render();
}

/* ---------- Leaders ---------- */
async function viewLeaders(league) {
  const players = await api(`/leagues/${league.id}/players`);
  setNav(league, 'leaders');
  const boards = [['Fantasy Points', 'points', f1], ['Passing Yards', 'passYd'], ['Rushing Yards', 'rushYd'], ['Receiving Yards', 'recYd'],
    ['Receptions', 'rec'], ['Targets', 'tgt'], ['Total TDs', 'td']];
  const val = (p, k) => k === 'points' ? p.points : k === 'td' ? p.totals.passTd + p.totals.rushTd + p.totals.recTd : p.totals[k];
  $app.innerHTML = `<div class="grid">${boards.map(([title, k, fmt = (x) => x]) => {
    const top = [...players].sort((a, b) => val(b, k) - val(a, k)).filter((p) => val(p, k) > 0).slice(0, 5);
    return `<div class="card"><h2>${title}</h2>${top.length ? `<table><tbody>${top.map((p, i) => `<tr>
      <td class="left rank">${i + 1}</td><td class="left"><div class="pcell">${photo(p)}<a class="pname" href="#/player/${p.id}">${esc(p.name)}</a></div></td>
      <td class="pts">${fmt(val(p, k))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No data yet</div>'}</div>`;
  }).join('')}</div>`;
}

/* ---------- Teams ---------- */
async function viewTeams(league) {
  const [teams, players] = await Promise.all([api(`/leagues/${league.id}/teams`), api(`/leagues/${league.id}/players`)]);
  setNav(league, 'teams');
  $app.innerHTML = `<div class="card"><h2>Teams</h2>${teams.length ? `<table><thead><tr><th class="left">Team</th><th>Players</th><th>Total FPTS</th></tr></thead><tbody>
    ${teams.map((t) => { const ps = players.filter((p) => p.teamId === t.id); return `<tr><td class="left">${logoImg(t)} ${teamTag(t)} <b>${esc(t.name)}</b></td><td>${ps.length}</td><td class="pts">${f1(ps.reduce((a, p) => a + p.points, 0))}</td></tr>`; }).join('')}
    </tbody></table>` : '<div class="empty">No teams yet.</div>'}</div>
    ${league.isOwner ? `<div class="card"><h2>Add Team</h2><div class="card-body"><form id="tform"><div class="row">
      <label>Name<input name="name" required maxlength="80"></label>
      <label>Abbr<input name="abbr" maxlength="4"></label>
      <label>Color<input type="color" name="color" value="#c8102e"></label>
        <label>Logo (optional)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/gif"></label></div><button class="btn">Add Team</button></form></div></div>` : ''}`;
      if (!league.isOwner) return;
  document.getElementById('tform').onsubmit = async (e) => {
    e.preventDefault();
    const raw = new FormData(e.target);
    const fd = Object.fromEntries([...raw].filter(([k]) => k !== 'logo'));
    try {
      fd.logo = await fileToDataUrl(raw.get('logo'));
      await api(`/leagues/${league.id}/teams`, { method: 'POST', body: fd });
      viewTeams(league);
    } catch (err) { showError(e.target, err.message); }
  };
}

/* ---------- League settings ---------- */
function viewSettings(league) {
  if (!league.isOwner) { location.hash = `#/league/${league.id}/players`; return; }
  inviteUrl = '';
  setNav(league, 'settings');
  $app.innerHTML = `<div class="card"><h2>League Settings</h2><div class="card-body"><form id="setform">
    <div class="row">
      <label>League name<input name="name" required maxlength="80" value="${esc(league.name)}"></label>
      <label>Sport / type<input name="sport" maxlength="80" value="${esc(league.sport)}"></label>
      <label>Season<input name="season" maxlength="20" value="${esc(league.season)}"></label>
      <label>Default player sort<select name="defaultSort">${SORT_OPTIONS.map(([k, l]) => `<option value="${k}" ${k === (league.defaultSort || 'points') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Logo<input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/gif"></label>
    </div>
    ${league.logo ? `<p>${logoImg(league, 48)} <label style="display:inline-flex;flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="removeLogo"> Remove logo</label></p>` : ''}
    <h4>Scoring</h4>
    <div class="row">${Object.entries(league.scoring).map(([k, v]) => `<label>${esc(k)}<input type="number" step="any" name="s_${k}" value="${v}"></label>`).join('')}</div>
    <button class="btn">Save Settings</button> <span class="psub">Scoring changes recalculate all fantasy points.</span>
  </form></div></div>
  <div class="card"><h2>Share League</h2><div class="card-body"><p>People with this invite link can view this league. Only you can edit it.</p>
    <button class="btn" id="makeinvite">Create / rotate invite link</button><div id="inviteoutput">${inviteUrl ? `<input readonly value="${esc(inviteUrl)}" aria-label="League invite link"> <button class="btn small secondary" id="copyinvite">Copy</button>` : ''}</div>
    <p class="psub">Rotating the link disables previous links.</p></div></div>
  <div class="card"><h2>Danger Zone</h2><div class="card-body"><button class="btn danger" id="dell">Delete League</button> <span class="psub">Removes the league, its teams, players and stats.</span></div></div>`;
  document.getElementById('dell').onclick = async () => {
    if (!confirm(`Delete league "${league.name}" and all its players?`)) return;
    await api(`/leagues/${league.id}`, { method: 'DELETE' });
    location.hash = '#/';
  };
  document.getElementById('makeinvite').onclick = async () => {
    try {
      const result = await api(`/leagues/${league.id}/invite`, { method: 'POST' });
      inviteUrl = result.url;
      document.getElementById('inviteoutput').innerHTML = `<input id="invitefield" readonly value="${esc(inviteUrl)}" aria-label="League invite link"> <button class="btn small secondary" id="copyinvite">Copy</button>`;
      document.getElementById('copyinvite').onclick = () => navigator.clipboard.writeText(inviteUrl);
    } catch (error) { showError(document.getElementById('inviteoutput'), error.message); }
  };
  document.getElementById('copyinvite')?.addEventListener('click', () => navigator.clipboard.writeText(inviteUrl));
  document.getElementById('setform').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const scoring = {};
    for (const k of Object.keys(league.scoring)) scoring[k] = fd.get('s_' + k);
    try {
      const logo = await fileToDataUrl(fd.get('logo'));
      await api(`/leagues/${league.id}`, { method: 'PUT', body: {
        name: fd.get('name'), sport: fd.get('sport'), season: fd.get('season'), defaultSort: fd.get('defaultSort'),
        scoring, logo, removeLogo: fd.get('removeLogo') === 'on' } });
      location.hash = `#/league/${league.id}/players`;
    } catch (err) { showError(e.target, err.message); }
  };
}

/* ---------- Add player ---------- */
async function viewAdd(league) {
  if (!league.isOwner) { location.hash = `#/league/${league.id}/players`; return; }
  const teams = await api(`/leagues/${league.id}/teams`);
  setNav(league, 'add');
  $app.innerHTML = `<div class="card"><h2>Add Player</h2><div class="card-body"><p class="psub">Step 1: create the player. Step 2: you'll add their stats on the next screen.</p><form id="pform">
    <div class="row">
      <label>Name<input name="name" required maxlength="80"></label>
      <label>Position<select name="position">${meta.positions.map((p) => `<option>${p}</option>`).join('')}</select></label>
      <label>Jersey #<input name="number" maxlength="3"></label>
      ${teams.length ? `<label>Team (optional)<select name="teamId"><option value="">No team</option>${teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>` : ''}
      <label>Photo<input type="file" name="photo" accept="image/png,image/jpeg,image/webp,image/gif"></label>
    </div>
    <label style="margin-bottom:12px">Bio<textarea name="bio" maxlength="300" rows="2"></textarea></label>
    <button class="btn">Create Player</button></form></div></div>`;
  document.getElementById('pform').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries([...fd].filter(([k]) => k !== 'photo'));
    try {
      body.photo = await fileToDataUrl(fd.get('photo'));
      const p = await api(`/leagues/${league.id}/players`, { method: 'POST', body });
      location.hash = `#/player/${p.id}`;
    } catch (err) { showError(e.target, err.message); }
  };
}

/* ---------- Player detail ---------- */
const GAME_COLS = [['passAtt', 'ATT'], ['passCmp', 'CMP'], ['passYd', 'PYD'], ['passTd', 'PTD'], ['int', 'INT'], ['rushAtt', 'CAR'], ['rushYd', 'RYD'], ['rushTd', 'RTD'],
  ['tgt', 'TGT'], ['rec', 'REC'], ['recYd', 'REYD'], ['recTd', 'RETD'], ['fumLost', 'FUML'], ['twoPt', '2PT']];

async function viewPlayer(pid) {
  const p = await api(`/players/${pid}`);
  const owner = p.league.isOwner;
  const teams = owner ? await api(`/leagues/${p.leagueId}/teams`) : [];
  setNav(p.league, 'players');
  const nextWeek = p.games.length ? Math.max(...p.games.map((g) => g.week)) + 1 : 1;
  $app.innerHTML = `
    <div class="hero">${photo(p, 'lg')}<div><h1>${esc(p.name)}</h1>
      <div><span class="pos pos-${p.position}">${p.position}</span> ${p.number ? '#' + esc(p.number) : ''} ${teamTag(p.team)}</div>
      <p>${esc(p.bio)}</p></div>
      <div class="stats"><div><b>${f1(p.points)}</b><span>Fantasy Pts</span></div><div><b>${f1(p.avg)}</b><span>Avg</span></div><div><b>${p.gp}</b><span>Games</span></div></div></div>
    ${owner ? `<div class="card"><div class="card-body"><details><summary><b>Edit Player</b></summary><form id="editp" style="margin-top:12px">
      <div class="row"><label>Name<input name="name" required maxlength="80" value="${esc(p.name)}"></label>
      <label>Position<select name="position">${POSITIONS.map((position) => `<option ${position === p.position ? 'selected' : ''}>${position}</option>`).join('')}</select></label>
      <label>Jersey #<input name="number" maxlength="3" value="${esc(p.number)}"></label>
      <label>Team (optional)<select name="teamId"><option value="">No team</option>${teams.map((team) => `<option value="${team.id}" ${team.id === p.teamId ? 'selected' : ''}>${esc(team.name)}</option>`).join('')}</select></label>
      <label>Replace photo<input type="file" name="photo" accept="image/png,image/jpeg,image/webp,image/gif"></label></div>
      ${p.photo ? '<label style="display:inline-flex;flex-direction:row;align-items:center;gap:6px;margin-bottom:12px"><input type="checkbox" name="removePhoto"> Remove current photo</label>' : ''}
      <label style="margin-bottom:12px">Bio<textarea name="bio" maxlength="300" rows="2">${esc(p.bio)}</textarea></label>
      <button class="btn">Save Player</button></form></details></div></div>` : ''}
    <div class="card"><h2>Game Log</h2>${p.games.length ? `<div class="scroll"><table><thead><tr><th class="left">Wk</th><th class="left">Opp</th>
      ${GAME_COLS.map(([, l]) => `<th>${l}</th>`).join('')}<th>FPTS</th>${owner ? '<th></th>' : ''}</tr></thead><tbody>
      ${p.games.map((g) => `<tr><td class="left">${g.week}</td><td class="left">${esc(g.opponent) || '-'}</td>${GAME_COLS.map(([k]) => `<td>${g[k]}</td>`).join('')}
        <td class="pts">${f1(g.points)}</td>${owner ? `<td><button class="btn small danger" data-del="${g.id}">✕</button></td>` : ''}</tr>`).join('')}
      <tr><td class="left" colspan="2"><b>Total</b></td>${GAME_COLS.map(([k]) => `<td><b>${p.totals[k]}</b></td>`).join('')}<td class="pts">${f1(p.points)}</td>${owner ? '<td></td>' : ''}</tr>
      </tbody></table></div>` : '<div class="empty">No stat lines yet.</div>'}</div>
    ${owner ? `<div class="card"><div class="card-head">Add / Update Stat Line <a class="btn small" href="#/league/${p.leagueId}/add">+ Add Another Player</a></div><div class="card-body"><form id="sform">
      <div class="row"><label>Week<input type="number" name="week" min="1" max="99" value="${nextWeek}" required></label>
      <label>Opponent<input name="opponent" maxlength="30"></label></div>
      <div class="row">${GAME_COLS.map(([k, l]) => `<label>${l}<input type="number" name="${k}" value="0" step="1"></label>`).join('')}</div>
      <button class="btn">Save Stat Line</button> <span class="psub">Saving an existing week replaces it.</span></form></div></div>
    <button class="btn danger" id="delp">Delete Player</button>` : '<p class="psub">Shared view · only the league owner can edit player details or stats.</p>'}`;
  if (!owner) return;
  document.getElementById('editp').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries([...fd].filter(([key]) => !['photo', 'removePhoto'].includes(key)));
    body.teamId = fd.get('teamId') || null;
    try {
      const image = fd.get('photo');
      if (image?.size) body.photo = await fileToDataUrl(image);
      else if (fd.get('removePhoto')) body.photo = null;
      else delete body.photo;
      await api(`/players/${pid}`, { method: 'PUT', body });
      viewPlayer(pid);
    } catch (error) { showError(e.target, error.message); }
  };
  document.getElementById('sform').onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/players/${pid}/stats`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); viewPlayer(pid); } catch (err) { showError(e.target, err.message); }
  };
  $app.onclick = async (e) => {
    if (e.target.dataset.del) { await api(`/stats/${e.target.dataset.del}`, { method: 'DELETE' }); viewPlayer(pid); }
  };
  document.getElementById('delp').onclick = async () => {
    if (!confirm(`Delete ${p.name}?`)) return;
    await api(`/players/${pid}`, { method: 'DELETE' });
    location.hash = `#/league/${p.leagueId}/players`;
  };
}

/* ---------- Router ---------- */
async function route() {
  $app.onclick = null;
  try {
    if (!configured()) { viewSetup(); return; }
    if (!session) { viewAuth(); return; }
    if (!meta) meta = await api('/meta');
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    if (parts[0] === 'join' && parts[1]) { await joinLeague(parts[1]); return; }
    if (parts[0] === 'league' && parts[1]) {
      const league = (await api('/leagues')).find((l) => l.id === parts[1]);
      if (!league) return (location.hash = '#/');
      const view = { players: viewPlayers, leaders: viewLeaders, teams: viewTeams, add: viewAdd, settings: viewSettings }[parts[2] || 'players'] || viewPlayers;
      await view(league);
    } else if (parts[0] === 'player' && parts[1]) {
      await viewPlayer(parts[1]);
    } else {
      await viewLeagues();
    }
  } catch (err) {
    $app.innerHTML = `<div class="err">${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
async function initialize() {
  if (!configured()) { viewSetup(); return; }
  try { await completeAuthRedirect(); } catch (error) { authNotice = error.message; }
  try { await restoreSession(); } catch (error) { authNotice = error.message; }
  await route();
}
initialize();
