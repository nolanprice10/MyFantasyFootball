# MyFantasyFootball

An ESPN Fantasy Football-style stats tracker for any league that isn't the NFL: high school, flag football, rec leagues, and so on. Create a league, add players with photos, log weekly stat lines, and the site calculates fantasy points using scoring rules you control.

## Features

- **Leagues:** create any number of leagues, each with a name, sport/type, season, optional logo, and its own scoring settings. Everything is editable later in the league's **Settings** tab, which also holds league deletion.
- **Teams (optional):** add real teams (name, abbreviation, color, optional logo). Players can belong to a team or have none; leagues work fine with no teams at all.
- **Players:** created one at a time with name, position (QB, RB, WR, TE, K, DEF), jersey number, bio, optional team, and optional photo. Players without a photo show team-colored initials.
- **Stat lines:** each player gets weekly lines covering passing (attempts, completions, yards, TDs, INTs), rushing (carries, yards, TDs), receiving (targets, receptions, yards, TDs), fumbles lost, and 2-point conversions. Saving a week that already exists replaces it.
- **Fantasy scoring:** points are computed live from the league's scoring settings (default is PPR: 0.04/passing yd, 4/passing TD, -2/INT, 0.1/rush or rec yd, 6/rush or rec TD, 1/reception, -2/fumble lost, 2/2-pt). Changing scoring recalculates every player instantly.
- **Players table:** ESPN-style sortable, searchable table with position filters. Sort by overall rank (fantasy points), points per game, total yards, passing/rushing/receiving yards, receptions, targets, total TDs, or name. Each league has a configurable default sort.
- **Leaders:** top-5 boards for fantasy points, yardage categories, receptions, targets, and touchdowns.
- **Player pages:** hero header, season totals, per-game log with fantasy points, stat entry form, and delete.

## Typical flow

1. Create a league (scoring is optional, defaults apply).
2. Add a player, then add their stat lines on the next screen. Repeat for each player.
3. View rankings on Players and Leaders; tweak scoring or sorting in Settings.

## Run it

Requires Node.js.

```sh
npm install
npm start
```

Open http://localhost:3000 (set `PORT` to change it).

## Deploy to GitHub Pages

The site can run as a static app on GitHub Pages. Push the repository to GitHub's `main` branch and enable **Settings → Pages → Build and deployment → GitHub Actions**. The workflow in `.github/workflows/pages.yml` publishes the `public/` directory on each push; `server.js` and Node are not used on Pages.

In static mode, leagues, players, stats, and uploaded images are stored in the current browser's local storage. They are not shared with other people or synced across devices. Use **Export backup** and **Import backup** in the notice above the app to move or protect the data. Anyone opening the Pages site starts with their own browser data. For shared league data, run the app with the Express server instead.

## Tech and storage

- Backend: Node + Express (`server.js`) exposing a JSON API under `/api`.
- Frontend: dependency-free single-page app in `public/` (`index.html`, `app.js`, `style.css`) using hash routing.
- Server mode data: stored in `data/db.json`; uploaded images in `uploads/` (PNG, JPEG, WebP, GIF, max 5 MB). Both are git-ignored.
- GitHub Pages mode data: stored in browser local storage and portable through JSON backups.

## Limitations

No user accounts or authentication. On GitHub Pages, data is per-browser and is not shared or synced; on the Express server, anyone who can reach it can edit all data. There are no fantasy owners, drafts, or matchups yet; "teams" are the real teams in a league.

---

Built by Nolan Price (nolangp10@icloud.com).
