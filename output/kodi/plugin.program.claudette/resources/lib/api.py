"""
Claudette API client — pure stdlib, no third-party deps required.
Works on LibreELEC / Kodi Python 3.

Each Kodi page load is a new Python process; the client logs in on each
instantiation (one POST) and holds the session cookie in memory for the
duration of that page request.
"""

import json
import http.cookiejar
import urllib.request
import urllib.error
import urllib.parse


class ClaudetteAPI:
    def __init__(self, base_url, timeout=10):
        self.base    = base_url.rstrip('/') + '/api'
        self.timeout = timeout
        self._jar    = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._jar)
        )

    # ── Auth ──────────────────────────────────────────────────────────────────

    def status(self):
        """GET /api/auth/status → {registered, authenticated, username} or None."""
        return self._get('/auth/status')

    def login(self, username, password):
        """POST /api/auth/login. Returns (True, None) or (False, error_string).
        Raises on connection failure."""
        body = json.dumps({'username': username, 'password': password, 'remember': False}).encode()
        req  = urllib.request.Request(
            self.base + '/auth/login', data=body,
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
            method='POST',
        )
        try:
            with self._opener.open(req, timeout=self.timeout):
                return True, None
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode()).get('error', 'HTTP {0}'.format(e.code))
            except Exception:
                msg = 'HTTP {0}'.format(e.code)
            return False, msg

    def register(self, username, password):
        """POST /api/auth/register. Returns (True, username) or (False, error_string)."""
        body = json.dumps({'username': username, 'password': password}).encode()
        req  = urllib.request.Request(
            self.base + '/auth/register', data=body,
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
            method='POST',
        )
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode())
                return True, data.get('username')
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode()).get('error', str(e))
            except Exception:
                msg = str(e)
            return False, msg

    # ── Network ───────────────────────────────────────────────────────────────

    def get_network(self):
        """GET /api/network/scan → {devices, lastScan, scanning, gateway}"""
        return self._get('/network/scan')

    def trigger_scan(self):
        """POST /api/network/scan → {started: true}"""
        return self._post('/network/scan')

    def trigger_deep_scan(self):
        """POST /api/network/deep-scan → {started: true}"""
        return self._post('/network/deep-scan')

    def get_myip(self):
        """GET /api/network/myip → {ip}"""
        return self._get('/network/myip')

    # ── Services ──────────────────────────────────────────────────────────────

    def get_services(self):
        """GET /api/services → {results: [{name, ok, message, ms, ts}]}"""
        return self._get('/services')

    def get_service_history(self):
        """GET /api/services/history → {<name>: [{ok, ms, ts}]}"""
        return self._get('/services/history')

    def refresh_services(self):
        """POST /api/services/run → triggers an immediate check cycle."""
        return self._post('/services/run')

    # ── Internet / connectivity ───────────────────────────────────────────────

    def get_internet(self):
        """GET /api/services/internet → {ok, results, vpn_up, vpn_ok, vpn_meta}"""
        return self._get('/services/internet')

    def run_internet_check(self):
        """POST /api/services/internet/run → triggers an immediate connectivity check."""
        return self._post('/services/internet/run')

    # ── Threats ───────────────────────────────────────────────────────────────

    def get_threats(self):
        """GET /api/threats → {threats: [{title, severity, package, url, date, summary}], lastRefresh}"""
        return self._get('/threats')

    def refresh_threats(self):
        """POST /api/threats/refresh → triggers an immediate feed refresh."""
        return self._post('/threats/refresh')

    # ── System ────────────────────────────────────────────────────────────────

    def get_stats(self):
        """GET /api/system/stats → {cpu, memory, disk, network, os}"""
        return self._get('/system/stats')

    # ── Reports ───────────────────────────────────────────────────────────────

    def get_internet_report(self, days=7):
        """GET /api/reports/internet?days=<n> → {outages, summary, internetStats, ispConfig, daily, …}"""
        return self._get('/reports/internet?days={0}'.format(days))

    def get_speedtest_report(self, limit=10, via='direct'):
        """GET /api/reports/speedtest?limit=<n>&via=<via> → {speedtests, summary, …}"""
        return self._get('/reports/speedtest?limit={0}&via={1}'.format(limit, via))

    def run_speedtest(self):
        """POST /api/reports/speedtest → triggers an immediate direct speed test."""
        return self._post('/reports/speedtest')

    def run_vpn_speedtest(self):
        """POST /api/reports/speedtest/vpn → triggers an immediate VPN speed test."""
        return self._post('/reports/speedtest/vpn')

    def get_vpn_speedtest_report(self, limit=10):
        """GET /api/reports/speedtest?limit=<n>&via=vpn → {speedtests, summary, …}"""
        return self._get('/reports/speedtest?limit={0}&via=vpn'.format(limit))

    def get_reports(self, limit=50, offset=0):
        """GET /api/reports → {events, summary, total, from, to}"""
        return self._get('/reports?limit={0}&offset={1}'.format(limit, offset))

    # ── Logs ──────────────────────────────────────────────────────────────────

    def get_logs(self, limit=100, level=None):
        """GET /api/logs?limit=<n>[&level=<level>] → {logs: [{ts, level, msg, ...}]}"""
        path = '/logs?limit={0}'.format(limit)
        if level and level != 'debug':
            path += '&level={0}'.format(level)
        return self._get(path)

    # ── Audit log ─────────────────────────────────────────────────────────────

    def get_audit(self, limit=50, offset=0):
        """GET /api/audit → {entries: [{ts, event, actor, payload}], total}"""
        return self._get('/audit?limit={0}&offset={1}'.format(limit, offset))

    # ── DDNS ──────────────────────────────────────────────────────────────────

    def get_ddns_status(self):
        """GET /api/ddns/status → {enabled, provider, hostname, last_ip, last_updated, last_check, last_error}"""
        return self._get('/ddns/status')

    def get_ddns_history(self, limit=20):
        """GET /api/ddns/history → [{ts, event, ip, hostname, ok}] (newest first)"""
        result = self._get('/ddns/history')
        if isinstance(result, list):
            return result[:limit]
        return []

    def force_ddns_update(self):
        """POST /api/ddns/update → triggers an immediate DDNS IP update."""
        return self._post('/ddns/update')

    # ── Internal ──────────────────────────────────────────────────────────────

    def _get(self, path):
        req = urllib.request.Request(
            self.base + path,
            headers={'Accept': 'application/json'},
        )
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except (urllib.error.URLError, urllib.error.HTTPError, OSError):
            return None

    def _post(self, path, body=None):
        data = json.dumps(body or {}).encode('utf-8')
        req  = urllib.request.Request(
            self.base + path, data=data,
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
            method='POST',
        )
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except (urllib.error.URLError, urllib.error.HTTPError, OSError):
            return None

