# Deployment Scripts

Scripts are split by host platform — pick the folder matching the machine you're running the script **from**, not the machine you're deploying to.

```
scripts/
├── windows/
│   ├── deploy-pi.ps1   — deploy to Raspberry Pi from Windows (PowerShell + Docker buildx)
│   └── kodi-check.ps1  — verify Kodi addon status via JSON-RPC
└── linux/
    ├── deploy-pi.sh    — deploy to Raspberry Pi from Linux or macOS (bash + Docker buildx)
    └── restart.sh      — build & run locally on Linux or macOS (bash + Docker)
```

## Quick reference

| Task | Windows | Linux / macOS |
|---|---|---|
| Run locally | `.\deploy-win.ps1` | `./scripts/linux/restart.sh` |
| Deploy to Pi | `.\deploy-pi.ps1` | `./scripts/linux/deploy-pi.sh` |
| Deploy to Pi (skip build) | `.\deploy-pi.ps1 -SkipBuild` | `./scripts/linux/deploy-pi.sh --skip-build` |
| Override Pi host | `.\deploy-pi.ps1 -PiHost 192.168.1.50` | `./scripts/linux/deploy-pi.sh --host 192.168.1.50` |

## Configuration

Both deploy scripts read `config.yaml` in the repo root. Override values with flags or set them in the file:

```yaml
host:     192.168.1.10   # Pi IP or hostname
ssh_user: ubuntu         # SSH username
ssh_key:  ~/.ssh/id_rsa  # optional; omit to use SSH agent
```

## First-time Linux/macOS setup

```bash
# Make scripts executable (one-time)
chmod +x scripts/linux/deploy-pi.sh scripts/linux/restart.sh
```

## How deploy-pi works

1. **Build** — cross-compiles a `linux/arm64` Docker image using `docker buildx`
2. **Copy** — transfers the image tarball to the Pi via `scp`
3. **Load** — runs `docker load` on the Pi over SSH
4. **Restart** — stops the old container and starts a fresh one with:
   - `--network host` (required for nmap and ARP scanning)
   - `--cap-add NET_ADMIN --cap-add NET_RAW` (required for raw socket access)
   - `-v claudette-data:/app/data` (persistent SQLite database)
   - DHCP leases mount (auto-detected from `/etc/pihole/dhcp.leases` or `/var/lib/misc/dnsmasq.leases`)
