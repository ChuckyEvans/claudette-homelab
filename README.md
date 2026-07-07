# Claudette

Home network monitoring and diagnostics for small deployments (Raspberry Pi friendly).

This README gives new contributors an easy path to get the project running locally, run tests, build, and deploy to a Raspberry Pi for real-device testing.

Prerequisites
- Node.js 20+ (tested with Node 22)
- npm (bundled with Node) or yarn
- Git
- Optional for deployment: SSH access to a Raspberry Pi (ubuntu user), with an SSH key configured

Quickstart — run locally
1. Clone the repo:

   git clone https://github.com/ChuckyEvans/claudette-homelab.git
   cd claudette-homelab

2. Install dependencies:

   npm ci

3. Run tests (Vitest):

   npm test

4. Start the server (development):

   npm run dev

   - Frontend: Vite dev server on http://localhost:5173 by default
   - Backend: server/index.js (Express) on configured port (see `config.yaml`)

Build for production

1. Build frontend and server artifacts:

   npm run build

2. Result: `dist/` will contain the built frontend; server files are left in `server/` for packaging.

Deploy to Raspberry Pi (quick)

This project includes `scripts/deploy-pi.mjs` to upload and run a build on a Pi. The deploy process uploads a tarball to `/tmp/claudette-build` and runs `/tmp/claudette-deploy.sh` on the Pi.

- Ensure SSH key access to `ubuntu@<pi-ip>` and enough space in `/tmp` (it's typically a small ram-disk).
- From your workstation run:

  node scripts/deploy-pi.mjs

Common options you may use when developing locally:
- `--no-progress` : skip progress streaming during deploy
- `--skip-tests` / `--skip-lint` : used by convenience scripts (not recommended for CI)

Configuration
- `config.example.yaml` shows available settings. Copy to `config.yaml` and edit values that matter (ports, credentials, etc.).
- `data/` holds runtime state and `claudette.db` (SQLite). For tests, per-worker DB files are used.

Testing notes
- Tests use Vitest and create per-worker SQLite DBs to avoid file locks.
- If you see "unable to open database file" failures, re-run tests — the code includes retries and per-worker DB paths.

Troubleshooting
- Remote deploy logs: when running on the Pi, logs live under `/tmp/claudette-build/build.log`. If files are root-owned, run `sudo chown -R ubuntu:ubuntu /tmp/claudette-build` or re-run deploy as `ubuntu` to recreate the directory.
- Pi `/tmp` is small: consider building locally and uploading the `dist/` tarball if builds fail due to disk/swap.

Contributing
- Create a branch from `feature/` or `main`, run tests locally, and open a PR targeting `main`.

Where to look next
- Backend: `server/` — Express routes, DB helpers.
- Frontend: `src/` — React + Vite.
- Scripts: `scripts/` — deployment, codemods, utilities.

Help
- If you get stuck, open an issue or contact the repository owner.
# Claudette

A self-hosted home network monitoring dashboard. Runs in Docker on a Raspberry Pi (or any Linux host) and gives you a live view of every device on your network, monitored services, internet health, speed history, CVE threat intelligence, and a full audit trail — all from a browser or Kodi.

---

## Features

| Area | What it does |
|---|---|
| **Network scan** | nmap ping-sweep discovers every device on your LAN. Shows IP, hostname, MAC, vendor, OS, open ports, latency, traceroute. |
| **Deep scan** | Sequential port scan of all devices — runs nightly at 4 am or on demand. |
| **Services** | HTTP/Docker health checks on a configurable schedule. Tracks uptime history. |
| **Threats** | CVE feed filtered to your keywords (e.g. `nginx`, `docker`, `python flask`). |
| **Internet / outage** | Pings configurable hosts every N minutes. Pairs outages, calculates downtime, generates ISP SLA reports. |
| **Speed test** | Scheduled download/upload/ping tests. Exportable to PDF or CSV. |
| **System stats** | CPU, memory, disk, network usage of the host running Claudette. |
| **Audit log** | Every scan, device change, and user action timestamped to the second. |
| **Backup / restore** | Download a `.claudette.gz` bundle (gzip-compressed config + SQLite db). Auto-backup every N days with configurable retention. |
| **Reports** | PDF and CSV exports for outages, speed history, device inventory. Persistent filter bars on every tab. |
| **Auth** | Single-user login with bcrypt passwords and JWT session cookies. |
| **Kodi addon** | Optional Python addon for LibreELEC / Kodi — browse the dashboard from your TV. |

---

## Screenshots

### Network — device list with detail panel
![Network scan showing 38 devices, device detail with MAC, vendor, OS, ports, traceroute](docs/screenshots/network.png)

### Dashboard — live status overview
![Dashboard showing service health, threat count, CPU/memory/disk/uptime tiles and recent CVE feed](docs/screenshots/dashboard.png)

### Exposure — open port risk assessment
![Exposure page showing per-device port risk scoring](docs/screenshots/exposure.png)

### System — host hardware stats
![System page showing CPU per-core load, memory usage, disk and network I/O](docs/screenshots/system.png)

### Reports — internet outage history
![Reports internet tab showing outage timeline, downtime totals and ISP SLA tracking](docs/screenshots/reports-internet.png)

### Reports — speed test history
![Reports speed test tab showing download/upload/ping charts over time](docs/screenshots/reports-speed.png)

### Reports — overview
![Reports overview tab](docs/screenshots/reports-overview.png)

### Audit log — full event history
![Audit log showing timestamped events for scans, device changes and user actions](docs/screenshots/audit-log.png)

### Logs — live server console
![Logs page showing server output with level filtering and search](docs/screenshots/logs.png)

### Settings — configuration editor
![Settings page with tabs for host, network, schedule, DDNS, services, appearance and data](docs/screenshots/settings.png)

---

## Platform setup

Jump to your platform:

- [Windows](#windows)
- [macOS](#macos)
- [Linux / Raspberry Pi](#linux--raspberry-pi)

---

## Windows

### Prerequisites

| Tool | How to get it | Notes |
|---|---|---|
| **Docker Desktop** | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) | Required to run Claudette locally. Enable WSL2 backend during install. |
| **OpenSSH client** | Built into Windows 10+ | Run `ssh -V` to verify. |
| **Node.js 22+** | [nodejs.org](https://nodejs.org) | Only needed for development; not required for deploy-only. |

> **WSL2 note:** Docker Desktop on Windows runs containers inside a WSL2 VM. Two things behave differently from a native Linux install:
> - **Speedtest results** read ~40–60% of your actual line speed due to VM networking overhead.
> - **Device vendor/hostname info** from nmap is limited — ARP scanning only reaches the VM's virtual NIC, not your physical LAN.
 - **Speedtest provider**: Claudette prefers the Ookla Speedtest CLI by default (it selects the best test server by ping time). You can change this in `config.yaml` (`schedule.speedtest_provider`: `ookla` or `cloudflare`). The Docker image installs the Ookla CLI so scheduled tests work out-of-the-box.
>
> For accurate speed and full device discovery, deploy to a Raspberry Pi or Linux machine.

### Run locally (Windows)

```powershell
# 1. Copy the example config and edit it
copy config.example.yaml config.yaml
# Edit config.yaml — set your subnet, ISP details, etc.

# 2. Build and start the container
.\scripts\windows\deploy-win.mjs

# 3. Open in browser
Start-Process http://localhost:7654
```

The setup wizard runs on first launch — create an admin account and confirm your config.

### Deploy to a Raspberry Pi (Windows → Pi)

No Docker Desktop needed on your workstation for Pi deploys — just OpenSSH.

> **Pi first-time setup:** before your first deploy, SSH into the Pi and run `setup-pi.sh` to install Docker, nginx, certbot, UFW, and fail2ban in one shot. See [Pi first-time setup](#pi-first-time-setup) in the Linux section below.

```powershell
# Full deploy — builds natively on the Pi, restarts container
npm run deploy

# Or using the PowerShell script directly:
.\scripts\windows\deploy-pi.mjs

# Quick deploy — skips Docker rebuild, syncs only server/ files (~5 s)
npm run deploy:quick

# Skip build — restart the container using the image already on the Pi
npm run deploy:skip-build
```

### Development (Windows)

```powershell
npm install
npm run dev        # hot-reload frontend + backend
npm test           # run test suite
npm run build      # production build
```

---

## macOS

### Prerequisites

| Tool | How to get it | Notes |
|---|---|---|
| **Docker Desktop** | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) | Required to run Claudette locally and for Pi cross-compilation. |
| **Docker Buildx** | Included with Docker Desktop | Verify: `docker buildx version` |
| **OpenSSH client** | Built into macOS | Run `ssh -V` to verify. |
| **Node.js 22+** | [nodejs.org](https://nodejs.org) or `brew install node` | Only needed for development. |

### Run locally (macOS)

**Option A — Docker** (recommended; ARP scanning limited by Docker VM on macOS):

```bash
cp config.example.yaml config.yaml   # edit subnet, ISP details, etc.
./scripts/linux/restart.sh           # build + start container
open http://localhost:7654
```

**Option B — Native Node.js** (no Docker required; full network access):

```bash
chmod +x scripts/linux/run-local.sh  # one-time
./scripts/linux/run-local.sh         # hot-reload dev server
./scripts/linux/run-local.sh --prod  # production build + server
./scripts/linux/run-local.sh --stop  # stop the server
```

Requires: `brew install node nmap`

### Deploy to a Raspberry Pi (macOS → Pi)

The macOS deploy script cross-compiles a `linux/arm64` image on your Mac via Docker Buildx, then ships it to the Pi.

> **Pi first-time setup:** before your first deploy, SSH into the Pi and run `setup-pi.sh` to install Docker, nginx, certbot, UFW, and fail2ban in one shot. See [Pi first-time setup](#pi-first-time-setup) in the Linux section below.

```bash
chmod +x scripts/linux/deploy-pi.sh   # one-time

# Full build + deploy
./scripts/linux/deploy-pi.sh

# Skip the Docker build (reuse last image tarball)
./scripts/linux/deploy-pi.sh --skip-build

# Override the Pi address for a one-off deploy
./scripts/linux/deploy-pi.sh --host 192.168.1.50
```

Or via npm scripts:

```bash
npm run deploy           # full deploy
npm run deploy:quick     # server-only sync (~5 s)
npm run deploy:skip-build
```

### Development (macOS)

```bash
npm install
npm run dev     # hot-reload frontend + backend
npm test        # run test suite
npm run build   # production build
```

---

## Linux / Raspberry Pi

### Prerequisites

#### Workstation (Linux desktop / laptop)

| Tool | How to get it | Notes |
|---|---|---|
| **Docker Engine** | `curl -fsSL https://get.docker.com \| sudo sh` | Required to run Claudette locally. |
| **Docker Buildx** | Included with Docker Engine 23+ | Verify: `docker buildx version` |
| **OpenSSH client** | `sudo apt install openssh-client` | Usually pre-installed. |
| **Node.js 22+** | [nodejs.org](https://nodejs.org) or `nvm` | Only needed for development. |

#### Raspberry Pi (deploy target)

| Requirement | Notes |
|---|---|
| **Raspberry Pi OS or Ubuntu** | 64-bit (arm64). Pi 4 (2 GB+) recommended; Pi 3B+ works. |
| **Docker on the Pi** | Installed automatically by `setup-pi.sh` — see [Pi first-time setup](#pi-first-time-setup) below. |
| **Key-based SSH auth** | Required — deploy scripts use `BatchMode=yes` and will not prompt for a password. |

### Pi first-time setup

Run `scripts/linux/setup-pi.sh` **once on the Pi** (not from your workstation). It installs and configures everything in one shot:

```bash
# Copy the script to the Pi
scp scripts/linux/setup-pi.sh ubuntu@<pi-ip>:~/

# SSH in and run it
ssh ubuntu@<pi-ip>
chmod +x setup-pi.sh
sudo ./setup-pi.sh --domain mypi.hopto.org --user ubuntu
```

**What the script does:**

| Step | Action |
|---|---|
| 1 | Installs Docker (official repo) + adds your user to the `docker` group |
| 2 | Installs nginx, certbot, UFW firewall, fail2ban |
| 3 | Configures UFW — deny inbound by default; allow 22/80/443/7443/8443 |
| 4 | Writes nginx config with rate-limiting and security headers |
| 5 | Obtains a Let's Encrypt TLS certificate (HTTP-01 challenge) |
| 6 | Configures fail2ban jails for SSH, nginx rate-limits, and Claudette login |
| 7 | Enables certbot auto-renewal timer and runs a dry-run to verify it |

**Options:**

```bash
sudo ./setup-pi.sh --domain mypi.hopto.org   # public HTTPS (recommended)
sudo ./setup-pi.sh --skip-certbot            # LAN-only, no TLS
sudo ./setup-pi.sh --no-ha                   # skip Home Assistant (8443) block
sudo ./setup-pi.sh --skip-firewall           # skip UFW (if you manage firewall separately)
```

> **Note:** After the script runs, log out and back in as `ubuntu` so the docker group takes effect.

**1. Set up SSH key access** *(the script does not do this — do it first)*

```bash
# Generate a key on your workstation if you don't have one
ssh-keygen -t ed25519 -C "claudette-deploy"

# Copy the public key to the Pi (Linux / macOS)
ssh-copy-id ubuntu@<pi-ip>

# Windows PowerShell alternative:
# Get-Content ~/.ssh/id_ed25519.pub | ssh ubuntu@<pi-ip> "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Test it — this should print `ok` with no password prompt:

```bash
ssh ubuntu@<pi-ip> echo ok
```

**2. Configure `config.yaml`** *(on your workstation, before deploying)*

```yaml
pi:
  host: 192.168.1.10          # Your Pi's IP address
  ssh_user: ubuntu            # SSH username (default on Pi OS / Ubuntu)
  # ssh_key: ~/.ssh/id_ed25519  # Optional — omit to use ssh-agent
```

### Deploy to Pi (Linux → Pi)

```bash
chmod +x scripts/linux/deploy-pi.sh   # one-time

# Full build + deploy
./scripts/linux/deploy-pi.sh

# Skip the Docker build
./scripts/linux/deploy-pi.sh --skip-build

# Override the Pi address
./scripts/linux/deploy-pi.sh --host 192.168.1.50
```

Or via npm:

```bash
npm run deploy
npm run deploy:quick
npm run deploy:skip-build
```

**What the deploy does:**

1. Cross-compiles a `linux/arm64` Docker image via `docker buildx` (Linux/macOS workstation builds)  
   *— or —* packages the source as a tarball, uploads it via SCP, and builds natively on the Pi (Windows)
2. Stops the old container and starts a fresh one with `--network host`, `--restart unless-stopped`, and the correct Linux capabilities (`NET_ADMIN`, `NET_RAW`)
3. Persistent data lives in `/app/data` on the Pi — it survives container updates

### Run locally on Linux

**Option A — Docker** (recommended; full network access via `--network host`):

```bash
cp config.example.yaml config.yaml   # edit subnet, ISP details, etc.
./scripts/linux/restart.sh           # build + start container
```

**Option B — Native Node.js** (no Docker required; also full network access):

```bash
chmod +x scripts/linux/run-local.sh  # one-time
./scripts/linux/run-local.sh         # hot-reload dev server
./scripts/linux/run-local.sh --prod  # production build + server
./scripts/linux/run-local.sh --stop  # stop the server
```

Requires: `sudo apt install nodejs nmap`

Open in browser: `xdg-open http://localhost:7654`

### Development (Linux)

```bash
npm install
npm run dev     # hot-reload frontend + backend
npm test        # run test suite
npm run build   # production build
```

### SSH config tip

Add this to `~/.ssh/config` on your workstation to avoid repeating the Pi address:

```
Host pi
  HostName 192.168.1.10
  User ubuntu
  IdentityFile ~/.ssh/id_ed25519
```

Then use `--host pi` (Linux/macOS) or `-PiHost pi` (Windows) in the deploy scripts.

---

## Configuration

Copy `config.example.yaml` to `config.yaml` and edit it. The file is excluded from Git — never commit your real config.

```yaml
pi:
  host: 192.168.1.10        # IP of your Pi / server
  ssh_user: ubuntu

network:
  subnet: 192.168.1.0/24    # Subnet to scan
  # Multiple subnets:
  # subnets:
  #   - 192.168.1.0/24
  #   - 192.168.68.0/24
  connectivity_hosts:
    - 1.1.1.1               # Hosts to ping for internet health checks
    - 9.9.9.9

schedule:
  check_interval_minutes: 5           # Service health check frequency
  internet_check_minutes: 5           # Internet connectivity check frequency
  internet_outage_check_seconds: 10   # Fast-poll interval (seconds) during an outage
  ping_interval_minutes: 5            # Lightweight device ping-sweep frequency
  speedtest_interval_hours: 4         # Direct speed test frequency
  vpn_speedtest_interval_hours: 4     # VPN speed test frequency (0 = disabled)
  speedtest_provider: cloudflare      # cloudflare or ookla
  threat_interval_hours: 6            # CVE feed refresh frequency
  deep_scan_hour: 4                   # Hour (0–23) for the nightly full port scan
  backup_interval_days: 0             # Auto-backup frequency in days (0 = disabled)
  backup_keep_days: 7                 # Days of auto-backups to retain
  mtr_baseline_hours: 1               # MTR baseline run interval in hours (0 = disabled)
  mtr_outage_repeat_minutes: 15       # Re-run MTR every N minutes during an outage

isp:
  name: MyISP
  connection_type: fibre        # fibre / dsl / lte / cable / satellite
  expected_uptime: 100          # % for SLA reports
  plan_download_mbps: 250
  plan_upload_mbps: 250
  sla_url: ""                   # URL to ISP SLA document
  sla_notes: ""                 # Free-text SLA notes

infra:
  name: ""                      # Local device name (router, firewall, etc.)
  connection_type: router       # router / firewall / switch / wireless-ap / vpn / server / other
  sla_pct: 0                    # Infra uptime target % (0 = disabled)
  plan_download_mbps: 0
  plan_upload_mbps: 0
  sla_url: ""                   # URL to SLA or warranty document
  sla_notes: ""

threats:
  keywords:                     # CVEs matching these keywords will be shown
    - docker
    - python
    - nginx
  severity_threshold: medium    # low / medium / high / critical
```

### Monitored services

Services are configured through the UI (Settings → Services) or directly in the database. Each service has:

| Field | Description |
|---|---|
| `name` | Display name |
| `url` | HTTP URL to check (e.g. `http://192.168.1.10:8080`) |
| `type` | `http` (default) or `docker` |
| `expected_status` | Expected HTTP status code (default `200`) |

---

## Data & backups

All data lives in a SQLite database at `/app/data/claudette.db` inside the container. The Docker volume `claudette-data` persists this across container restarts.

**Manual backup**: Settings → Backup & Restore → *Backup Now* — downloads a `.claudette.gz` file (gzip-compressed JSON bundle containing the config YAML and base64-encoded SQLite binary; typically 85–90% smaller than the raw data).

**Restore**: Settings → Backup & Restore → *Restore from File* — upload a `.claudette.gz` file. The server validates and replaces the database and config, then restarts cleanly.

**Auto-backup**: set `backup_interval_days` in config (0 = disabled). Backups are saved to `/app/data/backups/` as `.claudette.gz` files. Set `backup_keep_days` to control how long they are kept (default 7 days).

---

## Kodi addon

An optional addon is available for LibreELEC / Kodi. Find it in `output/kodi/plugin.program.claudette/`.

See [`output/kodi/plugin.program.claudette/README.txt`](output/kodi/plugin.program.claudette/README.txt) for install instructions.

Build a distributable zip:

```powershell
# Windows
.\output\kodi\build-addon.ps1

# Then deploy to a Kodi host
.\output\kodi\deploy-addon.ps1 -KodiHost 192.168.1.20
```

---

## Development

```bash
# Install dependencies
npm install

# Start dev server (hot-reload frontend + Node backend)
npm run dev

# Run tests
npm test

# Build production assets
npm run build
```

### Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5, Tailwind CSS, Recharts, Lucide icons |
| Backend | Node.js 22, Express 4, ESM modules |
| Database | SQLite via `node-sqlite3-wasm` (no native bindings — works on any arch) |
| Auth | bcryptjs passwords, JWT session cookies, rate-limited login |
| Container | Docker, multi-stage build (`linux/amd64` locally; `linux/arm64` on Pi natively or via buildx) |

### Project structure

```
├── server/               Node.js backend
│   ├── index.js          App entry point, cron jobs, SSE broadcast
│   ├── db.js             SQLite helpers
│   ├── config.js         YAML config loader
│   ├── middleware/
│   │   └── auth.js       JWT auth middleware
│   ├── utils/
│   │   └── schedule.js   Cron expression helpers (minutesToCron / hoursToCron)
│   └── routes/
│       ├── network.js    nmap scanning, mDNS, ARP, port scanning
│       ├── services.js   HTTP / Docker health checks
│       ├── threats.js    CVE / NVD threat feed
│       ├── system.js     Stats, backup, restore
│       ├── reports.js    Outage + speed report queries
│       ├── audit.js      Audit log queries
│       ├── config.js     Config read/write API
│       └── auth.js       Login, logout, register
├── src/                  React frontend
│   ├── App.jsx           Root component, SSE listener, global state
│   ├── components/       Page components (Dashboard, NetworkScan, etc.)
│   └── lib/
│       ├── api.js        Fetch wrappers + SSE helper
│       ├── themes.js     Theme definitions, persistence helpers
│       ├── threatMatch.js CVE keyword matching
│       └── uiPrefs.js    UI preference helpers
├── tests/                Vitest test suite
│   ├── server/           Server-side unit tests
│   └── lib/              Frontend utility tests
├── output/kodi/          Kodi addon source + build scripts
├── scripts/
│   ├── windows/          PowerShell deploy scripts
│   └── linux/            Bash deploy scripts
├── Dockerfile            Multi-stage Docker build
└── config.example.yaml   Config template (commit this, not config.yaml)
```

### Tests

```bash
npm test
```

Tests live in `tests/` and are run with Vitest. The suite covers auth middleware logic, config sanitisation, IP utilities, outage pairing, report helpers, schedule utilities, threat matching, theme definitions and persistence helpers, accent presets, background dim helpers, and UI preferences — 241+ tests across 10 suites.

---

## Security notes

- **No cloud dependency** — everything runs on your own hardware
- Passwords are hashed with bcrypt (cost factor 12)
- JWTs are `httpOnly` + `sameSite: strict` cookies — not accessible from JavaScript
- nginx rate-limits the login endpoint to 5 attempts/min per IP; fail2ban bans after 8 failures
- All API routes except `/auth/*` require a valid session
- `config.yaml` is excluded from Git — never contains committed secrets
- The container uses `--network host` which is required for raw socket scanning; do not expose port 7654 directly to the internet — put it behind a reverse proxy (nginx, Caddy, etc.)

---

## License

MIT — see [LICENSE](LICENSE) for details.
