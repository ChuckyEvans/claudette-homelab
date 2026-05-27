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
- Network Devices   live list of discovered hosts, online/offline status,
                    open ports, vendor, OS, latency, traceroute
- Services          health status of all monitored HTTP/Docker services
- Threat Feed       CVE advisories grouped by affected project/package
- Audit Log         timestamped record of all system events
- Trigger Scan      kick off a fresh nmap scan from your TV remote


SETTINGS
---------
  Server URL            full URL of the Claudette server, e.g.
                        http://192.168.8.10:7654
  Request Timeout       seconds before a request is abandoned (default 10)
  Show offline devices  toggle whether offline devices appear in the list
  Minimum threat sev.   hide threats below a certain severity
  Audit events to show  how many audit rows to fetch


REQUIREMENTS
-------------
- Kodi 19 (Matrix) or later  — Python 3
- Claudette server reachable on the LAN
