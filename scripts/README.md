# Deployment Scripts

## Cross-platform scripts (recommended)

These Node.js scripts work on **Windows, macOS, and Linux** — no extra dependencies beyond Node.js 22+ and OpenSSH.

```
scripts/
├── deploy-pi.mjs     — deploy to Raspberry Pi (all platforms)
├── run-docker.mjs    — build & run locally via Docker (all platforms)
├── windows/
│   ├── deploy-pi.ps1   — PowerShell wrapper (calls deploy-pi.mjs)
│   ├── deploy-win.ps1  — legacy: build & run locally on Windows (Docker Desktop)
│   ├── run-local.ps1   — run locally on Windows without Docker (native Node.js + nmap)
│   ├── kodi-setup.ps1  — install / configure the Kodi addon on a LibreELEC Pi
│   └── kodi-check.ps1  — verify Kodi addon status via JSON-RPC
└── linux/
    ├── deploy-pi.sh    — bash wrapper (calls deploy-pi.mjs)
    └── restart.sh      — legacy: build & run locally on Linux or macOS (Docker)
```

## Quick reference — npm scripts (easiest)

```bash
npm run deploy                  # full deploy: upload source, build on Pi, restart
npm run deploy -- --quick       # fast path: sync server/ only (~5 s, no rebuild)
npm run deploy -- --pre-built   # ship local dist/, skip npm build on Pi (~2× faster)
npm run deploy -- --skip-build  # reuse existing image on Pi (restart only)

npm run docker:rebuild          # build & run locally via Docker
npm run docker:rebuild:skip     # restart local Docker container without rebuilding
```

## Quick reference — direct script invocation

| Task | Any platform | Windows PowerShell | Linux / macOS |
|---|---|---|---|
| Deploy to Pi (full) | `node scripts/deploy-pi.mjs` | `.\scripts\windows\deploy-pi.ps1` | `./scripts/linux/deploy-pi.sh` |
| Deploy to Pi (quick) | `node scripts/deploy-pi.mjs --quick` | `.\deploy-pi.ps1 -Quick` | `./deploy-pi.sh --quick` |
| Deploy to Pi (skip build) | `node scripts/deploy-pi.mjs --skip-build` | `.\deploy-pi.ps1 -SkipBuild` | `./deploy-pi.sh --skip-build` |
| Run locally (Docker) | `node scripts/run-docker.mjs` | `.\scripts\windows\deploy-win.ps1` | `./scripts/linux/restart.sh` |
| Run locally (no Docker) | `npm run dev` | `.\scripts\windows\run-local.ps1` | `npm run dev` |
| Kodi addon setup | — | `.\scripts\windows\kodi-setup.ps1` | — |

## Flags

| Flag | Description |
|---|---|
| `--quick` | Sync `server/` files into running container, restart (~5 s). No Docker rebuild. |
| `--pre-built` | Upload local `dist/` + `server/`, build image on Pi without running `npm build`. |
| `--skip-build` | Skip Docker build entirely, reuse existing image already on the Pi. |
| `--pi-host X` | Override Pi IP / hostname (default: reads `config.yaml`) |
| `--pi-user X` | Override SSH user (default: reads `config.yaml`) |
| `--ssh-key X` | Override SSH key path (default: reads `config.yaml`) |
| `--kodi-host X` | Also deploy Kodi addon to this LibreELEC host |
| `--kodi-user X` | SSH user for Kodi host (default: `root`) |

## Configuration

Deploy scripts read `config.yaml` in the repo root. Override values with flags:

```yaml
host:     192.168.1.10   # Pi IP or hostname
ssh_user: ubuntu         # SSH username
ssh_key:  ~/.ssh/id_rsa  # optional; omit to use SSH agent
fallback_dns:
  - 8.8.8.8
  - 1.1.1.1
```

## How deploy-pi works

1. **Upload** — tars the project source and copies it to the Pi via `scp`
2. **Build on Pi** — runs `docker build` natively on the Pi ARM64 hardware (no cross-compilation needed)
3. **Restart** — stops the old container and starts a fresh one with:
   - `--network host` (required for nmap and ARP scanning)
   - `--cap-add NET_ADMIN --cap-add NET_RAW` (required for raw socket access)
   - `-v claudette-data:/app/data` (persistent SQLite database)
   - DHCP leases mount (auto-detected from `/var/lib/misc/dnsmasq.leases` or `/etc/pihole/dhcp.leases`)
   - DNS flags from the Pi's `/etc/resolv.conf` and `fallback_dns` in `config.yaml`

## First-time macOS/Linux setup

```bash
# Make scripts executable (one-time)
chmod +x scripts/linux/deploy-pi.sh scripts/linux/restart.sh
```
