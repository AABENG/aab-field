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

## Release 1, step 3 (daily log on the phone)

- **Daily log** button on each project opens the field page: pick a day in the week (Mon–Sat), fill conditions, equipment, work, notes.
- Conditions fill in from the nearest National Weather Service station, and 24-hour rain (ending at check-in) from the Iowa Environmental Mesonet's radar-plus-gauge service read at the site itself; the CO can overwrite them and the log shows that it was edited.
- Progress: pick an item and drag a finger along the line. Structures and fittings on that stretch are counted automatically. Undo and erase are there for mistakes.
- Paving is three items on the street centerline — subgrade, curb (if the project has curb), paving — and each has to sit on the one before it. The phone clips a highlight to what's allowed and the server refuses anything out of order.
- Photos are shrunk on the phone to about 1600 px and tagged with the time and location. Uploaded photos are stored outside the web folder (`UPLOAD_DIR`, default `../aab-field-uploads`).
- **Clearing** and **Earthwork** areas: tap the corners of the ground cleared, or where dirt work went on, that day; tap the first corner (or Finish) to close it. Clearing adds up to a running total of cleared acres (overlaps counted once); earthwork shows only where dirt work is going on that day (no running total).
- CO logins only reach this page: they land on a list of active jobs that opens straight into each daily log.
- With no signal, the page still opens (once it has been opened on that phone) and saves go into a waiting list on the phone that uploads when signal returns.

## Maps

- Drawings are assumed to be Oklahoma state plane, NAD83, US survey feet (North zone by default, South selectable in design setup). Converted with proj4.
- The site location fills in from the drawing's center when the design is saved (or is picked on a Google map when the project is created).
- Plan views have a **satellite** button (design lined up on Google's aerial; checked to about 0.1 ft against the projection) and a **my location** button (phone GPS dot, good to roughly 10–15 ft).

## Settings (cPanel → Setup Node.js App → Environment variables)

| Name | Value |
|---|---|
| `DB_NAME` | `cm` |
| `DB_USER` | `cmapp` |
| `DB_PASSWORD` | the `cmapp` password |
| `SESSION_SECRET` | 32+ random characters |
| `NODE_ENV` | `production` |
| `GOOGLE_MAPS_KEY` | Google Maps JavaScript API key, restricted to `cm.aabeng.com/*` (optional: turns on the map picker and satellite layer) |

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
