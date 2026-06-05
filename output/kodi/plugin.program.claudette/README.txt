Claudette — Kodi Addon
======================

Monitors your homelab from Kodi/LibreELEC.
Connects to a running Claudette server on your network.


INSTALL ON WINDOWS (for testing)
---------------------------------
1. Install Kodi for Windows from https://kodi.tv/download/
2. Copy the folder  plugin.program.claudette/
   to  %APPDATA%\Kodi\addons\
3. Open Kodi → Settings → System → Add-ons → enable "Unknown sources"
4. My Add-ons → Program add-ons → Claudette → Configure
5. Set Server URL to http://localhost:7654  (if Claudette runs on the same PC)


INSTALL ON LIBREELEC / KODI PI
--------------------------------
Option A — SSH copy:
  scp -r plugin.program.claudette  root@<pi-ip>:/storage/.kodi/addons/
  Then in Kodi: Settings → Add-ons → My Add-ons → Program add-ons → Claudette

Option B — Zip install:
  1. Zip the plugin.program.claudette folder
  2. Copy zip to a USB stick
  3. In Kodi: Settings → Add-ons → Install from zip file

After install, configure the Server URL in addon settings to point at
whichever machine is running the Claudette Node.js server.


FEATURES
---------
- Network Devices      live list with online/offline status, open ports,
                       vendor, OS, latency, traceroute, host scripts
- Internet             current status, per-probe latency, VPN status,
                       outage history (7 / 30 / 90 days), SLA compliance
- Services             HTTP/Docker service health + uptime %
- Speed Tests          direct + VPN test history, ISP plan comparison,
                       provider badge (Cloudflare / Ookla), run-now action
- Threats              CVE feed grouped by package, severity filter
- System Stats         CPU, memory, disk, network, uptime
- DDNS                 status, current IP, history, force-update action
- Server Logs          live rolling log buffer with level filter
- Audit Log            paginated timestamped system event record
- Activity Report      device + service activity summary
- Actions              trigger scan, deep scan, refresh services/threats,
                       run speed test (direct + VPN), run connectivity check


SETTINGS
---------
  Server URL               full URL of the Claudette server, e.g.
                           http://192.168.8.10:7654  or
                           https://mypi.hopto.org:7443
  Request Timeout          seconds before a request is abandoned (default 10)
  Show offline devices     toggle whether offline devices appear in the list
  Minimum threat severity  hide threats below this severity (Low/Medium/High/Critical)
  Direct speed test limit  how many direct test results to show
  VPN speed test limit     how many VPN test results to show
  ISP plan Mbps            set down/up to enable SLA compliance colouring
  Audit events per page    rows fetched per page in the audit log
  DDNS history entries     rows shown in DDNS event history


REQUIREMENTS
-------------
- Kodi 19 (Matrix) or later  — Python 3
- Claudette server reachable on the LAN
