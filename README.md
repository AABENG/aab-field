# AAB Field

AAB Engineering's field reporting app. Construction observation staff log each day on site, highlight installed pipe and paving on the design linework, and the weekly construction management report builds itself for Joe's approval.

Runs at **https://cm.aabeng.com** on the GoDaddy cPanel account, as a cPanel Node.js app with a MySQL database.

## What's in Release 1, step 1 (foundation)

- Sign-in with roles: owner, reviewer (approves reports), admin, construction observation, contractor
- First-time setup page that creates the owner account, then turns itself off
- Users page (owner and admin): add people, change roles, deactivate, reset passwords
- Database tables for projects, design linework, structures, daily logs, highlighted progress, photos and weekly reports (`migrations/`), applied automatically on start
- `/health` returns `{"ok":true}` when the app and database are up

## Release 1, step 2 (project setup)

- **New project** (owner, admin, reviewer): job number, name, client, report emails, site latitude/longitude for weather
- **Load design from DXF**: the plan DXF is read in the browser (files of 300 MB are fine); only tagged linework is sent to the server
  - Profile, contour, grid, drainage-area and calc layers are skipped automatically
  - Pick the boundary layer; lines outside it (plus a margin) are ignored, which keeps profile views out
  - Tag layers as waterline, sanitary, storm, street centerline or background; symbols as manholes, storm structures, hydrants or valves. Guesses come from layer names
  - Options per layer: double-line pipe (collapsed to one line down the middle), skip service stubs, centerlines only (keeps the stretches midway between tagged curb lines)
  - Click any line in the preview to leave it out
  - The DXF is the 100% quantity. Structures are tied to the nearest line of their utility (within 10 ft) with a station, so they count as done when that stretch is highlighted
- **Project page**: design quantities and the plan

## Settings (cPanel → Setup Node.js App → Environment variables)

| Name | Value |
|---|---|
| `DB_NAME` | `cm` |
| `DB_USER` | `cmapp` |
| `DB_PASSWORD` | the `cmapp` password |
| `SESSION_SECRET` | 32+ random characters |
| `NODE_ENV` | `production` |

`DB_HOST` defaults to `localhost`, which is right on cPanel.

## Deploying an update

1. cPanel → **Git Version Control** → Manage `aab-field` → **Pull or Deploy** → **Update from Remote**.
2. cPanel → **Setup Node.js App** → `cm.aabeng.com` → **Run NPM Install** (only when `package.json` changed) → **Restart**.

## Running tests locally

Needs MySQL or MariaDB with an empty test database:

```
npm install
DB_NAME=cm_test DB_PASSWORD=... npm test
```
