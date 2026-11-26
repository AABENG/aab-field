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
- **Clearing** and **Earthwork** areas: tap the corners of the ground cleared, or where dirt work went on, that day; tap the first corner (or Finish) to close it. Clearing adds up to a running total of cleared acres (overlaps counted once) and only counts inside the project's limits of clearing, if one is set; earthwork shows only where dirt work is going on that day (no running total).
- CO logins only reach this page: they land on a list of active jobs that opens straight into each daily log.
- With no signal, the page still opens (once it has been opened on that phone) and saves go into a waiting list on the phone that uploads when signal returns.

### Limits of clearing
On the design setup page (step 3), pick the DXF layer with the limits of clearing. Closed polylines are used; pieces drawn end to end are joined. Save it with the design, or with **Save clearing limits only**, which also works after field logging has started (the setup page still loads the DXF for this). The phone shows the limits dashed, cuts clearing to them, and shows the percent of the limits cleared.

## Release 1, step 4 (weekly reports)

- **Sunday evening** a cPanel cron job calls `/cron/weekly`. From Sunday 6 PM Central it builds the reports for the Mon–Sat week that just ended (one per active project with logs) and emails every reviewer (Joe) a summary, the draft PDFs, and a link to **Reports** to review them. It runs hourly and only acts once; a missed run catches up on the next one.
- **Review**: Joe opens each PDF, adds optional notes for the owner, and approves. Approving freezes the PDF and locks that week's logs (Joe can reopen until it's sent).
- **Owners**: each project has an owner (client contact with one or more emails). When every report for an owner that week is approved, the owner gets **one email** with a short summary of the work on all of their projects and each report attached. Joe is copied and replies go to him.
- **The PDF**: progress table (design, this week, to date, % complete), Joe's notes, daily log, a progress exhibit (this week solid, earlier faded, remaining gray; clearing cut to the limits; earthwork areas this week), and the week's photos.
- **Data for analytics**: everything lives in the `cm` MySQL database. Home page → **Export data** downloads every daily log and every day-by-day quantity (one row per project, day and item) as CSV for Excel or Power BI.

### Step 4 settings
| Variable | Value |
|---|---|
| `CRON_KEY` | a long random string; also goes in the cron job's URL |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | the "AAB Field reports" app registration in Microsoft Entra (see below) |
| `MAIL_FROM` | reports@aabeng.com |
| (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) | only if not using Microsoft 365 |
| `PUBLIC_URL` | https://cm.aabeng.com (default) |

Email goes through Microsoft Graph, because Microsoft is switching off password sign-in for SMTP. The app registration gets **no** Graph permissions in Entra; instead Exchange's RBAC for Applications lets it send (and draft, for big attachments) only from reports@aabeng.com:

```powershell
Connect-ExchangeOnline
New-ServicePrincipal -AppId <client id> -ObjectId <enterprise app object id> -DisplayName "AAB Field reports"
New-ManagementScope -Name "AAB reports mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'reports@aabeng.com'"
New-ManagementRoleAssignment -App <client id> -Role "Application Mail.Send" -CustomResourceScope "AAB reports mailbox"
New-ManagementRoleAssignment -App <client id> -Role "Application Mail.ReadWrite" -CustomResourceScope "AAB reports mailbox"
Test-ServicePrincipalAuthorization -Identity <client id> -Resource reports@aabeng.com
```
Then **Reports → Send test email to me**. The client secret expires (24 months max); put a reminder on the calendar.

cPanel → **Cron Jobs**, every hour: `curl -s "https://cm.aabeng.com/cron/weekly?key=YOUR_CRON_KEY" > /dev/null`

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
