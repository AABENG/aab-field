# AAB Field

AAB Engineering's field reporting app. Construction observation staff log each day on site, highlight installed pipe and paving on the design linework, and the weekly construction management report builds itself for Joe's approval.

Runs at **https://cm.aabeng.com** on the GoDaddy cPanel account, as a cPanel Node.js app with a MySQL database.

## What's in Release 1, step 1 (foundation)

- Sign-in with roles: owner, reviewer (approves reports), admin, construction observation, contractor
- First-time setup page that creates the owner account, then turns itself off
- Users page (owner and admin): add people, change roles, deactivate, reset passwords
- Database tables for projects, design linework, structures, daily logs, highlighted progress, photos and weekly reports (`migrations/`), applied automatically on start
- `/health` returns `{"ok":true}` when the app and database are up

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
