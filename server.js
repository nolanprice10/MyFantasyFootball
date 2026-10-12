const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DEFAULT_SCORING = {
  passYd: 0.04, passTd: 4, int: -2,
  rushYd: 0.1, rushTd: 6,
  rec: 1, recYd: 0.1, recTd: 6,
  fumLost: -2, twoPt: 2,
};
const STAT_KEYS = ['passAtt', 'passCmp', 'passYd', 'passTd', 'int', 'rushAtt', 'rushYd', 'rushTd',
  'tgt', 'rec', 'recYd', 'recTd', 'fumLost', 'twoPt'];
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

let db = { leagues: [], teams: [], players: [], stats: [] };
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const save = () => {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
};
const id = () => crypto.randomUUID();
const str = (v, max = 80) => String(v ?? '').trim().slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function points(stat, scoring) {
  let p = 0;
  for (const k of Object.keys(DEFAULT_SCORING)) p += num(stat[k]) * num(scoring[k]);
  return Math.round(p * 100) / 100;
}

function saveImage(dataUrl) {
  const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) return null;
  const name = `${id()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}

function removeImage(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  fs.rm(path.join(UPLOAD_DIR, path.basename(url)), { force: true }, () => {});
}

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const api = express.Router();
const findLeague = (req, res) => {
  const l = db.leagues.find((x) => x.id === req.params.lid);
  if (!l) res.status(404).json({ error: 'League not found' });
  return l;
};

api.get('/meta', (_req, res) => res.json({ positions: POSITIONS, statKeys: STAT_KEYS, defaultScoring: DEFAULT_SCORING }));

api.get('/leagues', (_req, res) => res.json(db.leagues));
api.post('/leagues', (req, res) => {
  const name = str(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const scoring = { ...DEFAULT_SCORING };
  for (const k of Object.keys(scoring)) if (req.body.scoring && k in req.body.scoring) scoring[k] = num(req.body.scoring[k]);
  const league = { id: id(), name, sport: str(req.body.sport) || 'Flag Football', season: str(req.body.season, 20) || String(new Date().getFullYear()), scoring };
  db.leagues.push(league);
  save();
  res.status(201).json(league);
});
api.delete('/leagues/:lid', (req, res) => {
  const l = findLeague(req, res); if (!l) return;
  db.players.filter((p) => p.leagueId === l.id).forEach((p) => removeImage(p.photo));
  const pids = new Set(db.players.filter((p) => p.leagueId === l.id).map((p) => p.id));
  db.stats = db.stats.filter((s) => !pids.has(s.playerId));
  db.players = db.players.filter((p) => p.leagueId !== l.id);
  db.teams = db.teams.filter((t) => t.leagueId !== l.id);
  db.leagues = db.leagues.filter((x) => x.id !== l.id);
  save();
  res.status(204).end();
});

api.get('/leagues/:lid/teams', (req, res) => {
  if (!findLeague(req, res)) return;
  res.json(db.teams.filter((t) => t.leagueId === req.params.lid));
});
api.post('/leagues/:lid/teams', (req, res) => {
  if (!findLeague(req, res)) return;
  const name = str(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : '#c8102e';
  const team = { id: id(), leagueId: req.params.lid, name, abbr: str(req.body.abbr, 4).toUpperCase() || name.slice(0, 3).toUpperCase(), color };
  db.teams.push(team);
  save();
  res.status(201).json(team);
});

function withTotals(player, league) {
  const games = db.stats.filter((s) => s.playerId === player.id);
  const totals = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
  let pts = 0;
  for (const g of games) {
    for (const k of STAT_KEYS) totals[k] += num(g[k]);
    pts += points(g, league.scoring);
  }
  const team = db.teams.find((t) => t.id === player.teamId);
  return { ...player, team: team || null, gp: games.length, totals, points: Math.round(pts * 100) / 100,
    avg: games.length ? Math.round((pts / games.length) * 100) / 100 : 0 };
}

api.get('/leagues/:lid/players', (req, res) => {
  const l = findLeague(req, res); if (!l) return;
  res.json(db.players.filter((p) => p.leagueId === l.id).map((p) => withTotals(p, l)));
});
api.post('/leagues/:lid/players', (req, res) => {
  const l = findLeague(req, res); if (!l) return;
  const name = str(req.body.name);
  if (!name || !POSITIONS.includes(req.body.position)) return res.status(400).json({ error: 'Name and valid position required' });
  const teamId = db.teams.some((t) => t.id === req.body.teamId && t.leagueId === l.id) ? req.body.teamId : null;
  const player = { id: id(), leagueId: l.id, name, position: req.body.position, number: str(req.body.number, 3), teamId,
    photo: saveImage(req.body.photo), bio: str(req.body.bio, 300) };
  db.players.push(player);
  save();
  res.status(201).json(withTotals(player, l));
});

const findPlayer = (req, res) => {
  const p = db.players.find((x) => x.id === req.params.pid);
  if (!p) res.status(404).json({ error: 'Player not found' });
  return p;
};
api.get('/players/:pid', (req, res) => {
  const p = findPlayer(req, res); if (!p) return;
  const l = db.leagues.find((x) => x.id === p.leagueId);
  const games = db.stats.filter((s) => s.playerId === p.id).sort((a, b) => a.week - b.week)
    .map((s) => ({ ...s, points: points(s, l.scoring) }));
  res.json({ ...withTotals(p, l), games, league: l });
});
api.put('/players/:pid', (req, res) => {
  const p = findPlayer(req, res); if (!p) return;
  const l = db.leagues.find((x) => x.id === p.leagueId);
  if (req.body.name !== undefined) p.name = str(req.body.name) || p.name;
  if (POSITIONS.includes(req.body.position)) p.position = req.body.position;
  if (req.body.number !== undefined) p.number = str(req.body.number, 3);
  if (req.body.bio !== undefined) p.bio = str(req.body.bio, 300);
  if (req.body.teamId !== undefined) p.teamId = db.teams.some((t) => t.id === req.body.teamId && t.leagueId === l.id) ? req.body.teamId : null;
  if (req.body.photo) {
    const url = saveImage(req.body.photo);
    if (url) { removeImage(p.photo); p.photo = url; }
  }
  save();
  res.json(withTotals(p, l));
});
api.delete('/players/:pid', (req, res) => {
  const p = findPlayer(req, res); if (!p) return;
  removeImage(p.photo);
  db.stats = db.stats.filter((s) => s.playerId !== p.id);
  db.players = db.players.filter((x) => x.id !== p.id);
  save();
  res.status(204).end();
});

api.post('/players/:pid/stats', (req, res) => {
  const p = findPlayer(req, res); if (!p) return;
  const week = Math.floor(num(req.body.week));
  if (week < 1 || week > 99) return res.status(400).json({ error: 'Week must be 1-99' });
  const line = { id: id(), playerId: p.id, week, opponent: str(req.body.opponent, 30) };
  for (const k of STAT_KEYS) line[k] = Math.max(k === 'passYd' || k === 'rushYd' || k === 'recYd' ? -999 : 0, num(req.body[k]));
  db.stats = db.stats.filter((s) => !(s.playerId === p.id && s.week === week));
  db.stats.push(line);
  save();
  res.status(201).json(line);
});
api.delete('/stats/:sid', (req, res) => {
  db.stats = db.stats.filter((s) => s.id !== req.params.sid);
  save();
  res.status(204).end();
});

app.use('/api', api);
app.listen(PORT, () => console.log(`MyFantasyFootball running on http://localhost:${PORT}`));
