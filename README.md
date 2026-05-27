# Claudette

A self-hosted home network monitoring dashboard. Runs in Docker on a Raspberry Pi (or any Linux host) and gives you a live view of every device on your network, monitored services, internet health, speed history, CVE threat intelligence, and a full audit trail — all from a browser or Kodi.

---

## Features

| Area | What it does |
|---|---|
| **Network scan** | nmap ping-sweep discovers every device on your LAN. Shows IP, hostname, MAC, vendor, OS, open ports, latency, traceroute. |
| **Deep scan** | Sequential port scan of all devices — runs nightly at 4 am or on demand. |
| **Services** | HTTP/Docker health checks on a configurable schedule. Tracks uptime history. |
| **Threats** | CVE feed filtered to your keywords (e.g. `pihole`, `docker`, `python flask`). |
| **Internet / outage** | Pings configurable hosts every N minutes. Pairs outages, calculates downtime, generates ISP SLA reports. |
| **Speed test** | Scheduled download/upload/ping tests. Exportable to PDF or CSV. |
| **System stats** | CPU, memory, disk, network usage of the host running Claudette. |
| **Audit log** | Every scan, device change, and user action timestamped to the second. |
| **Backup / restore** | Download a `.claudette` bundle (config + SQLite db). Auto-backup every N days. |
| **Reports** | PDF and CSV exports for outages, speed history, device inventory. Persistent filter bars on every tab. |
| **Auth** | Single-user login with bcrypt passwords and JWT session cookies. |
| **Kodi addon** | Optional Python addon for LibreELEC / Kodi — browse the dashboard from your TV. |

---

## Requirements

| Requirement | Notes |
|---|---|
| Docker | Desktop (Windows/macOS) or Engine (Linux). Needed to build and run the app. |
| Docker Buildx | Included in Docker Desktop. Required for cross-compiling ARM64 images. |
| nmap | Installed **inside** the Docker image automatically — not needed on the host. |
| SSH access to your Pi | For the `deploy-pi` scripts. Key-based auth recommended. |
| Node.js 20+ | Only needed for local development (not for Docker deployment). |

The app runs well on a Raspberry Pi 4 (2 GB+) or any x86-64 Linux host.

---

## Quick start — Docker (local machine)

```bash
# 1. Copy and edit the example config
cp config.example.yaml config.yaml
# Edit config.yaml with your subnet, services, ISP details, etc.

# 2. Build and run locally (Windows)
.\deploy-win.ps1

# 2. Build and run locally (Linux / macOS)
./scripts/linux/restart.sh

# 3. Open in browser
open http://localhost:7654
```

On first launch the setup wizard runs — create an admin account and confirm your config.

---

## Deploy to a Raspberry Pi

The recommended setup is to run Claudette on a Pi that stays on 24/7.

### Windows → Pi

```powershell
# Full build + deploy
.\deploy-pi.ps1

# Skip the Docker build (reuse last image)
.\deploy-pi.ps1 -SkipBuild

# Override the Pi IP
.\deploy-pi.ps1 -PiHost 192.168.1.50
```

### Linux / macOS → Pi

```bash
chmod +x scripts/linux/deploy-pi.sh   # one-time

./scripts/linux/deploy-pi.sh
./scripts/linux/deploy-pi.sh --skip-build
./scripts/linux/deploy-pi.sh --host 192.168.1.50
```

The script:
1. Cross-compiles a `linux/arm64` Docker image via `docker buildx`
2. Copies the image tarball to the Pi over SCP
3. Loads and starts the container on the Pi

The container requires `--network host` so nmap can reach the full LAN. Persistent data (SQLite, backups) is stored in a Docker volume at `/app/data`.

### SSH config tip

Add this to `~/.ssh/config` to avoid typing the Pi address repeatedly:

```
Host pi
  HostName 192.168.1.10
  User ubuntu
  IdentityFile ~/.ssh/id_rsa
```

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
  check_interval_minutes: 5     # Service health check frequency
  internet_check_minutes: 5     # Internet connectivity check frequency
  ping_interval_minutes: 5      # Lightweight device ping-sweep frequency
  speedtest_interval_hours: 1   # Speed test frequency
  threat_interval_hours: 6      # CVE feed refresh frequency
  deep_scan_hour: 4             # Hour (0–23) for the nightly full port scan
  backup_interval_days: 7       # Auto-backup frequency (0 = disabled)

isp:
  name: MyISP
  connection_type: fibre        # fibre / dsl / lte / cable / satellite
  expected_uptime: 100          # % for SLA reports
  plan_download_mbps: 250
  plan_upload_mbps: 250

threats:
  keywords:                     # CVEs matching these keywords will be shown
    - docker
    - python
    - pihole
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

All data lives in a SQLite database at `/app/data/state.db` inside the container. The Docker volume `claudette-data` persists this across container restarts.

**Manual backup**: Settings → Backup & Restore → *Backup Now* — downloads a `.claudette` file (JSON bundle containing the config YAML and a base64-encoded SQLite binary).

**Restore**: Settings → Backup & Restore → *Restore from File* — upload a `.claudette` file. The server validates and replaces the database and config, then restarts cleanly.

**Auto-backup**: set `backup_interval_days` in config. Backups are saved to `/app/data/backups/` and files older than 7 days are pruned automatically.

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
| Backend | Node.js 20, Express 4, ESM modules |
| Database | SQLite via `node-sqlite3-wasm` (no native bindings — works on any arch) |
| Auth | bcryptjs passwords, JWT session cookies, rate-limited login |
| Container | Docker, multi-stage build, `linux/amd64` + `linux/arm64` via buildx |

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
│       ├── themes.js     Theme definitions
│       └── threatMatch.js CVE keyword matching
├── tests/                Vitest test suite
│   ├── server/           Server-side unit tests
│   └── lib/              Frontend utility tests
├── output/kodi/          Kodi addon source + build scripts
├── scripts/
│   ├── windows/          PowerShell deploy scripts
│   └── linux/            Bash deploy scripts
├── Dockerfile            Multi-stage Docker build
├── config.example.yaml   Config template (commit this, not config.yaml)
└── deploy-pi.ps1         Windows shortcut → scripts/windows/deploy-pi.ps1
```

### Tests

```bash
npm test
```

Tests live in `tests/` and are run with Vitest. Coverage includes auth middleware, config sanitisation, IP utilities, outage pairing, report helpers, threat matching, and theme utilities.

---

## Security notes

- **No cloud dependency** — everything runs on your own hardware
- Passwords are hashed with bcrypt (cost factor 12)
- JWTs are `httpOnly` + `sameSite: strict` cookies — not accessible from JavaScript
- Login is rate-limited (20 attempts / 15 min per IP)
- All API routes except `/auth/*` require a valid session
- `config.yaml` is excluded from Git — never contains committed secrets
- The container uses `--network host` which is required for raw socket scanning; do not expose port 7654 to the internet

---

## License

MIT — see [LICENSE](LICENSE) for details.
