# Casino Server — Agent Guide

## Entrypoints

| Component | Path | Start command |
|-----------|------|---------------|
| **Slot server** (admin, slot game, cloud streaming, balances) | `slot/server.js` | `cd slot && node server.js` |
| **Game server** (poker, blackjack, chip ledger) | `server/index.js` | `cd server && node index.js` |
| **Production (root Dockerfile)** | `/Dockerfile` | Symlinks `slot/` into `server/slot` and `sugar-rush-clone/frontend/dist` into `server/sugar-rush`, runs `server/index.js` on port 3001 |

All game logic (poker tables, blackjack, slot math) lives in `server/games/`.

## Map Editor

- **Single file**: `slot/admin-ui.html` — all Three.js editor code (~1800 lines). Three.js loaded from CDN via importmap.
- **Config**: `slot/casino-config.json` (default) or `slot/data/casino-config.json` (runtime override, gitignored).
- **Model parts** (`machine.modelParts`): per-mesh position/rotation/scale deltas stored as `{ name: { position, rotation, scale } }`. Identity transforms omitted. Edit via "Model Düzenle" toggle button.
- **Shape/size**: old `radius` scalar → `size` [X,Y,Z] 3-vector + `shape` selector (box/sphere/cylinder/cone/torus). Migration happens in form render, not in storage.
- **Auth**: `ADMIN_PASSWORD` env var; auto-generated if unset and logged to console.

## Deploy

- `dokploy.json` deploys from `/Dockerfile` on port 3001.
- `slot/docker-compose.yml` runs the slot server standalone via Traefik, port mapped as `PUBLISHED_PORT:3101 → PORT:3001`.
- Runtime persistence: `slot/data/` (gitignored) — mounts via Docker volume.
- Admin password and API token are env-only; no config file for secrets.

## Monorepo Boundaries

- **`slot/`** — Active dev area. Server, admin, map editor, cloud streaming, Phaser slot game, Godot client.
- **`server/`** — Game logic server. Not started independently in dev (root Dockerfile handles it).
- **`sugar-rush-clone/`** — Vendored clone repo (math engine + frontend). Frontend built to `frontend/dist/` in Docker.
- **`slot/godot-client/`** — Godot 4 project. Not part of Node runtime. Open `project.godot` in Godot 4.x.
- **`slot/sugar-rush/`** — Fallback vendored distributable of sugar-rush (`books_base.jsonl` + `dist/`).

## Environment Variables

| Var | Where | Purpose |
|-----|-------|---------|
| `PORT` | slot/server | HTTP port (default 3001) |
| `ADMIN_PASSWORD` | slot | Admin panel login (auto-gen if unset) |
| `API_TOKEN` | server | REST chip API auth |
| `CLIENT_RENDER_SECRET` | slot | CEF renderer launch secret |
| `SUGAR_RUSH_DIR` | slot | Override sugar-rush dist path |
| `SUGAR_BOOKS_FILE` | slot | Override books_base.jsonl path |
| `PUBLISHED_PORT` | docker-compose | External port mapping |

## Caveats

- No tests, no linter, no typechecking — manual verification only.
- `slot/build.js` is a vendored PIXI.js bundle (not a build tool; ignore it).
- `slot/godot-web-editor/` and `slot/.claude/` are gitignored/tooling-only.
- Git: nested `.git/` dirs were removed from `slot/` and `sugar-rush-clone/` — do not re-init submodules.

## Hot Reload (Config Live Sync)

Admin panel config changes (`PUT /admin/api/config`) broadcast `{ type: "config:updated" }` to **all** connected WebSocket clients. Godot clients re-fetch the config and rebuild the lobby (machines cleared/re-created) automatically.

- **Server**: `slot/server.js` — `broadcastConfigUpdate()` iterates `wsSessions`
- **Admin**: `slot/admin.js` — calls `ctx.onConfigSaved()` after writing config
- **Client**: `slot/godot-client/scripts/main.gd` — `_poll_balance_socket()` catches `type === "config:updated"`, calls `_hot_reload_config()`
- Player pose is preserved; old machines are `queue_free()`'d before new ones load.
