const $app = document.getElementById('app');
const $sub = document.getElementById('subnav');
const $top = document.getElementById('topnav');
let meta;
const DEFAULT_SCORING = { passYd: 0.04, passTd: 4, int: -2, rushYd: 0.1, rushTd: 6, rec: 1, recYd: 0.1, recTd: 6, fumLost: -2, twoPt: 2 };
const STAT_KEYS = ['passAtt', 'passCmp', 'passYd', 'passTd', 'int', 'rushAtt', 'rushYd', 'rushTd', 'tgt', 'rec', 'recYd', 'recTd', 'fumLost', 'twoPt'];
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const USE_SERVER_API = !new URLSearchParams(location.search).has('static') && ['localhost', '127.0.0.1'].includes(location.hostname) && Boolean(location.port);
const STORAGE_KEY = 'myfantasyfootball-data-v1';

const loadLocalDb = () => {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { leagues: data.leagues || [], teams: data.teams || [], players: data.players || [], stats: data.stats || [] };
  } catch {
    return { leagues: [], teams: [], players: [], stats: [] };
  }
};

function saveLocalDb(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    throw new Error('Browser storage is full. Export a backup or use smaller photos.');
  }
}

const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const cleanString = (value, max = 80) => String(value ?? '').trim().slice(0, max);
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function localPoints(stat, scoring) {
  return Math.round(Object.keys(DEFAULT_SCORING).reduce((sum, key) => sum + numeric(stat[key]) * numeric(scoring[key]), 0) * 100) / 100;
}

function localPlayer(player, db, league) {
  const games = db.stats.filter((stat) => stat.playerId === player.id);
  const totals = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
  let points = 0;
  games.forEach((game) => {
    STAT_KEYS.forEach((key) => { totals[key] += numeric(game[key]); });
    points += localPoints(game, league.scoring);
  });
  const team = db.teams.find((item) => item.id === player.teamId);
  return { ...player, team: team || null, gp: games.length, totals,
    points: Math.round(points * 100) / 100, avg: games.length ? Math.round(points / games.length * 100) / 100 : 0 };
}

function localApi(path, opts) {
  const db = loadLocalDb();
  const method = opts.method || 'GET';
  const body = opts.body || {};
  const leagueMatch = path.match(/^\/leagues\/([^/]+)(?:\/(teams|players))?$/);
  const playerMatch = path.match(/^\/players\/([^/]+)(?:\/stats)?$/);
  const statsMatch = path.match(/^\/stats\/([^/]+)$/);
  let result;
  const leagueById = (id) => db.leagues.find((item) => item.id === id);
  const playerById = (id) => db.players.find((item) => item.id === id);
  const requireLeague = (id) => {
    const league = leagueById(id);
    if (!league) throw new Error('League not found');
    return league;
  };
  const requirePlayer = (id) => {
    const player = playerById(id);
    if (!player) throw new Error('Player not found');
    return player;
  };

  if (path === '/meta' && method === 'GET') {
    return { positions: POSITIONS, statKeys: STAT_KEYS, defaultScoring: DEFAULT_SCORING,
      sortKeys: ['points', 'avg', 'passYd', 'rushYd', 'recYd', 'totalYd', 'rec', 'tgt', 'td', 'name'] };
  }
  if (path === '/leagues' && method === 'GET') return db.leagues;
  if (path === '/leagues' && method === 'POST') {
    const name = cleanString(body.name);
    if (!name) throw new Error('Name required');
    result = { id: makeId(), name, sport: cleanString(body.sport) || 'Flag Football', season: cleanString(body.season, 20) || String(new Date().getFullYear()),
      scoring: { ...DEFAULT_SCORING, ...Object.fromEntries(Object.keys(DEFAULT_SCORING).map((key) => [key, numeric(body.scoring?.[key] ?? DEFAULT_SCORING[key])])) },
      logo: body.logo || null, defaultSort: body.defaultSort || 'points' };
    db.leagues.push(result);
  } else if (leagueMatch) {
    const [, leagueId, section] = leagueMatch;
    const league = requireLeague(leagueId);
    if (!section && method === 'PUT') {
      if (body.name !== undefined) league.name = cleanString(body.name) || league.name;
      if (body.sport !== undefined) league.sport = cleanString(body.sport) || league.sport;
      if (body.season !== undefined) league.season = cleanString(body.season, 20) || league.season;
      if (body.defaultSort) league.defaultSort = body.defaultSort;
      if (body.scoring) Object.keys(DEFAULT_SCORING).forEach((key) => { if (key in body.scoring) league.scoring[key] = numeric(body.scoring[key]); });
      if (body.removeLogo) league.logo = null;
      if (body.logo) league.logo = body.logo;
      result = league;
    } else if (!section && method === 'DELETE') {
      const playerIds = new Set(db.players.filter((player) => player.leagueId === leagueId).map((player) => player.id));
      db.leagues = db.leagues.filter((item) => item.id !== leagueId);
      db.teams = db.teams.filter((item) => item.leagueId !== leagueId);
      db.players = db.players.filter((item) => item.leagueId !== leagueId);
      db.stats = db.stats.filter((item) => !playerIds.has(item.playerId));
    } else if (section === 'teams' && method === 'GET') {
      return db.teams.filter((team) => team.leagueId === leagueId);
    } else if (section === 'teams' && method === 'POST') {
      const name = cleanString(body.name);
      if (!name) throw new Error('Name required');
      result = { id: makeId(), leagueId, name, abbr: cleanString(body.abbr, 4).toUpperCase() || name.slice(0, 3).toUpperCase(),
        color: /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#c8102e', logo: body.logo || null };
      db.teams.push(result);
    } else if (section === 'players' && method === 'GET') {
      return db.players.filter((player) => player.leagueId === leagueId).map((player) => localPlayer(player, db, league));
    } else if (section === 'players' && method === 'POST') {
      const name = cleanString(body.name);
      if (!name || !POSITIONS.includes(body.position)) throw new Error('Name and valid position required');
      result = { id: makeId(), leagueId, name, position: body.position, number: cleanString(body.number, 3),
        teamId: db.teams.some((team) => team.id === body.teamId && team.leagueId === leagueId) ? body.teamId : null,
        photo: body.photo || null, bio: cleanString(body.bio, 300) };
      db.players.push(result);
      result = localPlayer(result, db, league);
    } else {
      throw new Error('Request not found');
    }
  } else if (playerMatch) {
    const [, playerId] = playerMatch;
    const player = requirePlayer(playerId);
    const league = requireLeague(player.leagueId);
    if (path.endsWith('/stats') && method === 'POST') {
      const week = Math.floor(numeric(body.week));
      if (week < 1 || week > 99) throw new Error('Week must be 1-99');
      result = { id: makeId(), playerId, week, opponent: cleanString(body.opponent, 30) };
      STAT_KEYS.forEach((key) => { result[key] = Math.max(['passYd', 'rushYd', 'recYd'].includes(key) ? -999 : 0, numeric(body[key])); });
      db.stats = db.stats.filter((stat) => !(stat.playerId === playerId && stat.week === week));
      db.stats.push(result);
    } else if (path === `/players/${playerId}` && method === 'GET') {
      const games = db.stats.filter((stat) => stat.playerId === playerId).sort((a, b) => a.week - b.week).map((stat) => ({ ...stat, points: localPoints(stat, league.scoring) }));
      result = { ...localPlayer(player, db, league), games, league };
    } else if (path === `/players/${playerId}` && method === 'PUT') {
      if (body.name !== undefined) player.name = cleanString(body.name) || player.name;
      if (body.position && POSITIONS.includes(body.position)) player.position = body.position;
      if (body.number !== undefined) player.number = cleanString(body.number, 3);
      if (body.bio !== undefined) player.bio = cleanString(body.bio, 300);
      if (body.teamId !== undefined) player.teamId = db.teams.some((team) => team.id === body.teamId && team.leagueId === league.id) ? body.teamId : null;
      if (body.photo) player.photo = body.photo;
      result = localPlayer(player, db, league);
    } else if (path === `/players/${playerId}` && method === 'DELETE') {
      db.players = db.players.filter((item) => item.id !== playerId);
      db.stats = db.stats.filter((item) => item.playerId !== playerId);
    } else {
      throw new Error('Request not found');
    }
  } else if (statsMatch && method === 'DELETE') {
    db.stats = db.stats.filter((stat) => stat.id !== statsMatch[1]);
  } else {
    throw new Error('Request not found');
  }

  if (method !== 'GET') saveLocalDb(db);
  return result ?? null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);

async function api(path, opts = {}) {
  if (!USE_SERVER_API) return localApi(path, opts);
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function downloadBackup() {
  const backup = { format: 'myfantasyfootball-backup', version: 1, exportedAt: new Date().toISOString(), ...loadLocalDb() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `myfantasyfootball-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.format !== 'myfantasyfootball-backup' || !['leagues', 'teams', 'players', 'stats'].every((key) => Array.isArray(data[key]))) {
    throw new Error('That file is not a valid MyFantasyFootball backup.');
  }
  saveLocalDb({ leagues: data.leagues, teams: data.teams, players: data.players, stats: data.stats });
  location.hash = '#/';
  await route();
}

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve(null);
  const r = new FileReader();
  r.onload = () => {
    if (USE_SERVER_API) return resolve(r.result);
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
  $top.innerHTML = '';
  if (!league) { $sub.innerHTML = ''; return; }
  const tabs = [['players', 'Players'], ['leaders', 'Leaders'], ['teams', 'Teams'], ['add', 'Add Player'], ['settings', 'Settings']];
  $sub.innerHTML = `<span class="league-name">${logoImg(league, 26)}&nbsp;${esc(league.name)}</span>` +
    tabs.map(([k, l]) => `<a href="#/league/${league.id}/${k}" class="${active === k ? 'active' : ''}">${l}</a>`).join('');
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
        <span class="psub">${esc(l.sport)} &middot; ${esc(l.season)}</span></a>`).join('')}</div>`
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
      : `<tr><td colspan="${COLS.length + 4}" class="empty">No players. <a href="#/league/${league.id}/add">Add one</a>.</td></tr>`;
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
    <div class="card"><h2>Add Team</h2><div class="card-body"><form id="tform"><div class="row">
      <label>Name<input name="name" required maxlength="80"></label>
      <label>Abbr<input name="abbr" maxlength="4"></label>
      <label>Color<input type="color" name="color" value="#c8102e"></label>
      <label>Logo (optional)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/gif"></label></div><button class="btn">Add Team</button></form></div></div>`;
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
  <div class="card"><h2>Danger Zone</h2><div class="card-body"><button class="btn danger" id="dell">Delete League</button> <span class="psub">Removes the league, its teams, players and stats.</span></div></div>`;
  document.getElementById('dell').onclick = async () => {
    if (!confirm(`Delete league "${league.name}" and all its players?`)) return;
    await api(`/leagues/${league.id}`, { method: 'DELETE' });
    location.hash = '#/';
  };
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
  setNav(p.league, 'players');
  const nextWeek = p.games.length ? Math.max(...p.games.map((g) => g.week)) + 1 : 1;
  $app.innerHTML = `
    <div class="hero">${photo(p, 'lg')}<div><h1>${esc(p.name)}</h1>
      <div><span class="pos pos-${p.position}">${p.position}</span> ${p.number ? '#' + esc(p.number) : ''} ${teamTag(p.team)}</div>
      <p>${esc(p.bio)}</p></div>
      <div class="stats"><div><b>${f1(p.points)}</b><span>Fantasy Pts</span></div><div><b>${f1(p.avg)}</b><span>Avg</span></div><div><b>${p.gp}</b><span>Games</span></div></div></div>
    <div class="card"><h2>Game Log</h2>${p.games.length ? `<div class="scroll"><table><thead><tr><th class="left">Wk</th><th class="left">Opp</th>
      ${GAME_COLS.map(([, l]) => `<th>${l}</th>`).join('')}<th>FPTS</th><th></th></tr></thead><tbody>
      ${p.games.map((g) => `<tr><td class="left">${g.week}</td><td class="left">${esc(g.opponent) || '-'}</td>${GAME_COLS.map(([k]) => `<td>${g[k]}</td>`).join('')}
        <td class="pts">${f1(g.points)}</td><td><button class="btn small danger" data-del="${g.id}">✕</button></td></tr>`).join('')}
      <tr><td class="left" colspan="2"><b>Total</b></td>${GAME_COLS.map(([k]) => `<td><b>${p.totals[k]}</b></td>`).join('')}<td class="pts">${f1(p.points)}</td><td></td></tr>
      </tbody></table></div>` : '<div class="empty">No stat lines yet.</div>'}</div>
    <div class="card"><div class="card-head">Add / Update Stat Line <a class="btn small" href="#/league/${p.leagueId}/add">+ Add Another Player</a></div><div class="card-body"><form id="sform">
      <div class="row"><label>Week<input type="number" name="week" min="1" max="99" value="${nextWeek}" required></label>
      <label>Opponent<input name="opponent" maxlength="30"></label></div>
      <div class="row">${GAME_COLS.map(([k, l]) => `<label>${l}<input type="number" name="${k}" value="0" step="1"></label>`).join('')}</div>
      <button class="btn">Save Stat Line</button> <span class="psub">Saving an existing week replaces it.</span></form></div></div>
    <button class="btn danger" id="delp">Delete Player</button>`;
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
  if (!meta) meta = await api('/meta');
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  try {
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
if (!USE_SERVER_API) {
  document.getElementById('staticNotice').hidden = false;
  document.getElementById('exportData').onclick = downloadBackup;
  document.getElementById('importData').onchange = async (event) => {
    const file = event.target.files[0];
    if (!file || !confirm('Importing a backup replaces the data saved in this browser. Continue?')) return;
    try { await importBackup(file); } catch (error) { alert(error.message); }
    event.target.value = '';
  };
}
route();
