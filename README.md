# MyFantasyFootball

An ESPN Fantasy Football-style stats tracker for any league that isn't the NFL: high school, flag football, rec leagues, and so on. Create a league, add players with photos, log weekly stat lines, and the site calculates fantasy points using scoring rules you control.

## Features

- **Leagues:** create any number of leagues, each with a name, sport/type, season, optional logo, and its own scoring settings. Everything is editable later in the league's **Settings** tab, which also holds league deletion.
- **Accounts and sharing:** users sign up and sign in with email/password. Owners share leagues with invite links; members can view league data, while only the owner can edit it.
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

## Configure Supabase

Accounts and shared league data use Supabase Auth and Postgres. Before running or deploying the site:

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql) to create tables, invite functions, and row-level security policies.
3. Copy the project's **Project URL** and **anon/public key** from Project Settings → API into `supabaseUrl` and `supabaseAnonKey` in [`public/config.js`](public/config.js). The anon key is intended to be public; never put a service-role key in frontend code.
4. In Authentication → URL Configuration, set the Site URL to `https://nolanprice10.github.io/MyFantasyFootball/` and add that exact URL to Redirect URLs. Add your local development origin there too if testing locally. Signup sends confirmations back to the current app URL and resumes the session after confirmation. Set a 12-character minimum and require uppercase, lowercase, numbers, and symbols if those password options are available. Enable email confirmation and leaked-password protection if available.
5. In Authentication's **Rate Limits**, retain the server-side limits or tune them for your users. CAPTCHA requires adding a provider token to the app first; enabling it without that integration will block sign-in/sign-up.

Email/password signup requires at least 12 characters, uppercase and lowercase letters, a number, and a symbol; a live meter shows strength. Repeated failed sign-ins also trigger an escalating per-browser cooldown. That cooldown is only a convenience and can be cleared or bypassed; Supabase Auth rate limits and CAPTCHA are the server-side protections. A confirmed, signed-in account owns leagues it creates. Owners can create or rotate a share link; signed-in users who open it join as read-only members. Only the owner can change league settings, players, teams, or stats. These data restrictions are enforced by Postgres row-level security, not only by hiding controls.

## Run locally

After configuring Supabase, serve `public/` from any static web server. For example, with Python installed:

```sh
python3 -m http.server 8000 --directory public
```

Open http://localhost:8000. Add `http://localhost:8000` to Supabase's allowed site and redirect URLs. Do not use `npm start` for this authenticated version; the old Express JSON API is not the shared database.

## Deploy to GitHub Pages

Push to the `main` branch and select **Settings → Pages → Build and deployment → GitHub Actions**. The workflow in `.github/workflows/pages.yml` publishes `public/` on each push. Configure the Pages URL as the Supabase site URL and add it to the allowed redirect URLs. `public/config.js` is deployed with the site and contains only the public anon key.

## Tech and remaining scope

- Frontend: dependency-free single-page app in `public/` using hash routing and Supabase Auth/PostgREST.
- Database: Supabase Postgres tables and RLS policies defined in `supabase/schema.sql`.
- Photos and logos are stored as compressed data URLs in database rows.
- There are no fantasy owners, drafts, matchups, or member-specific roles yet; league members have view access and the league owner has edit access. Anyone with an active invite link can join until the owner rotates it.

---

Built by Nolan Price (nolangp10@icloud.com).
