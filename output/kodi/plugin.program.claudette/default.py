"""
Claudette — Kodi plugin entry point.

Sections
--------
  Main menu            — live status summary of all areas
  Network Devices      — full device list with detail panel
  Internet             — folder: current status / outage history / run check
  Services             — health per service + refresh action
  Threats              — grouped by package, filterable by severity
  Speed Tests          — history + ISP plan comparison + run action
  System Stats         — CPU/memory/disk/network
  Audit Log            — paginated event log
  Activity Report      — device + system events (paginated)
  DDNS                 — status + history + force-update
"""

import sys
import json
import datetime
import xbmc
import xbmcgui
import xbmcplugin
import xbmcaddon

from urllib.parse import parse_qsl, urlencode
from resources.lib.api import ClaudetteAPI

ADDON        = xbmcaddon.Addon()
ADDON_URL    = sys.argv[0]
ADDON_HANDLE = int(sys.argv[1])
ADDON_ARGS   = dict(parse_qsl(sys.argv[2][1:]))

SEV_COLOR = {'critical': 'FF4444', 'high': 'FF8800', 'medium': 'FFCC00', 'low': '44AAFF'}
SEV_RANK  = {'low': 1, 'medium': 2, 'high': 3, 'critical': 4}
PORT_RISK_COLOR = {
    'critical': 'FF4444', 'high': 'FF8800', 'medium': 'FFCC00',
    'low': '44AAFF', 'none': '555555',
}
EVENT_COLOR = {
    'scan.complete': '6666FF', 'scan.started': '8888FF', 'scan.error': 'FF4444',
    'service.check': '888888', 'service.down': 'FF4444', 'service.up': '44FF88',
    'threat.refresh': 'FFAA00', 'config.saved': '44AAFF',
    'auth.login': '44FF88', 'auth.register': '44AAFF', 'auth.login_failed': 'FF4444',
    'internet.check': '888888', 'internet.down': 'FF4444', 'internet.up': '44FF88',
    'device.online': '44FF88', 'device.offline': '555555', 'device.new': '44AAFF',
    'device.port.open': '8888FF', 'ddns.updated': '44AAFF',
}


# -- Colour / text helpers -----------------------------------------------------

def c(color, text):
    """Wrap text in a Kodi COLOR tag.  color may be 6- or 8-char hex."""
    if len(color) == 6:
        color = 'FF' + color
    return '[COLOR {0}]{1}[/COLOR]'.format(color, text)

def dim(text):     return c('666666', text)
def muted(text):   return c('888888', text)
def head(text):    return c('DDDDDD', text)
def good(text):    return c('44FF88', text)
def warn(text):    return c('FFCC00', text)
def bad(text):     return c('FF4444', text)
def info_c(text):  return c('44AAFF', text)
def accent(text):  return c('AA66FF', text)

def pct_color(pct):
    if pct >= 90: return 'FF4444'
    if pct >= 75: return 'FF8800'
    if pct >= 50: return 'FFCC00'
    return '44FF88'

def pct_bar(pct, width=10):
    filled = int(round(pct / 100 * width))
    bar    = chr(0x2588) * filled + chr(0x2591) * (width - filled)
    return '[{0}] {1}%'.format(bar, int(pct))

def status_dot(status):
    return {'online': good('●'), 'filtered': warn('●'), 'offline': dim('●')}.get(status, dim('●'))

def ok_dot(ok):
    return good('●') if ok else bad('●')


# -- URL / item helpers --------------------------------------------------------

def url(**kwargs):
    return '{0}?{1}'.format(ADDON_URL, urlencode(kwargs))

def add_item(label, item_url='', is_folder=False, info=None):
    li = xbmcgui.ListItem(label=label)
    if info:
        li.setInfo('video', info)
    xbmcplugin.addDirectoryItem(ADDON_HANDLE, item_url, li, is_folder)

def end_dir(content='files'):
    xbmcplugin.setContent(ADDON_HANDLE, content)
    xbmcplugin.endOfDirectory(ADDON_HANDLE)

def err_dialog(title, msg):
    xbmcgui.Dialog().ok('Claudette — ' + title, msg)

def notify(msg, duration=3000):
    xbmcgui.Dialog().notification('Claudette', msg, xbmcgui.NOTIFICATION_INFO, duration)

def sep(label=''):
    text = dim('── ' + label + ' ' + '─' * max(0, 34 - len(label))) if label else dim('─' * 40)
    add_item(text, info={'title': label or '─', 'plot': ''})


# -- Formatting ----------------------------------------------------------------

def fmt_bytes(b):
    if b is None: return '?'
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if b < 1024: return '{0:.1f} {1}'.format(b, unit)
        b /= 1024
    return '{0:.1f} PB'.format(b)

def fmt_uptime(secs):
    if secs is None: return '?'
    secs = int(secs)
    d, r = divmod(secs, 86400)
    h, r = divmod(r, 3600)
    m = r // 60
    if d: return '{0}d {1}h {2}m'.format(d, h, m)
    if h: return '{0}h {1}m'.format(h, m)
    return '{0}m'.format(m)

def fmt_dur_ms(ms):
    if ms is None: return '?'
    secs = int(ms / 1000)
    if secs < 60:   return '{0}s'.format(secs)
    if secs < 3600: return '{0}m {1}s'.format(secs // 60, secs % 60)
    h, r = divmod(secs, 3600)
    return '{0}h {1}m'.format(h, r // 60)

def fmt_ts(ts):
    if not ts: return '--'
    try:    return datetime.datetime.fromtimestamp(ts / 1000).strftime('%d %b %H:%M')
    except: return str(ts)

def fmt_ts_long(ts):
    if not ts: return '--'
    try:    return datetime.datetime.fromtimestamp(ts / 1000).strftime('%Y-%m-%d %H:%M:%S')
    except: return str(ts)

def fmt_date(s):
    if not s: return ''
    try:
        dt = datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
        return dt.strftime('%d %b %Y')
    except: return s[:10]


# -- Auth ----------------------------------------------------------------------

def get_api():
    server   = ADDON.getSetting('server_url').strip() or 'http://192.168.1.1:7654'
    timeout  = int(ADDON.getSetting('timeout') or 10)
    username = ADDON.getSetting('username').strip()
    password = ADDON.getSetting('password')

    if not username or not password:
        return None

    api = ClaudetteAPI(server, timeout)
    try:
        srv = api.status()
    except Exception as e:
        err_dialog('Connection Error',
                   'Cannot reach server:\n{0}\n\nError: {1}\n\nCheck Settings.'.format(server, e))
        return None

    if srv is None:
        err_dialog('Connection Error',
                   'No response from:\n{0}\n\nIs the server running?'.format(server))
        return None

    if not srv.get('registered'):
        ok, info = api.register(username, password)
        if not ok:
            err_dialog('Registration Failed', str(info))
            return None
        return api

    ok, login_err = api.login(username, password)
    if not ok:
        err_dialog('Login Failed',
                   'Login failed for: {0}\nServer said: {1}\n\n'
                   'Use the same credentials as the web UI.'.format(
                       username, login_err or 'Invalid credentials'))
        return None

    return api


# -- Main menu -----------------------------------------------------------------

def _isp_plan_dl():
    try: return float(ADDON.getSetting('isp_plan_dl') or '0') or None
    except: return None

def _isp_plan_ul():
    try: return float(ADDON.getSetting('isp_plan_ul') or '0') or None
    except: return None


def main_menu():
    username = ADDON.getSetting('username').strip()
    password = ADDON.getSetting('password')
    server   = ADDON.getSetting('server_url').strip() or 'http://192.168.1.1:7654'

    api = get_api()
    if api is None:
        if not username or not password:
            add_item(warn('Not configured') + dim('  — tap to open Settings'),
                     url(action='open_settings'),
                     info={'title': 'Configure Claudette',
                           'plot': 'Enter your server URL, username and password in Settings.'})
        else:
            add_item(bad('Cannot reach server') + dim('  ' + server),
                     url(action='open_settings'),
                     info={'title': 'Server unreachable',
                           'plot': 'Cannot connect to:\n{0}\n\nTap to open Settings.'.format(server)})
            add_item(info_c('Retry'), ADDON_URL,
                     info={'title': 'Retry', 'plot': 'Try connecting again.'})
        add_item(dim('Settings'), url(action='open_settings'),
                 info={'title': 'Settings', 'plot': 'Change server URL, username or password.'})
        end_dir()
        return

    net          = api.get_network()         or {}
    svc_raw      = api.get_services()        or {}
    thr_raw      = api.get_threats()         or {}
    sys_raw      = api.get_stats()           or {}
    internet_raw = api.get_internet()        or {}
    ddns_raw     = api.get_ddns_status()     or {}
    spd_raw      = api.get_speedtest_report(limit=1) or {}

    devices  = net.get('devices', [])
    online   = sum(1 for d in devices if d.get('status') == 'online')
    filtered = sum(1 for d in devices if d.get('status') == 'filtered')
    scanning = net.get('scanning', False)
    last_scan = fmt_ts(net.get('lastScan'))

    svc_list  = svc_raw.get('results', [])
    svc_ok    = sum(1 for s in svc_list if s.get('ok'))
    svc_total = len(svc_list)
    svc_down  = [s for s in svc_list if not s.get('ok')]

    threats  = thr_raw.get('threats', [])
    thr_crit = sum(1 for t in threats if t.get('severity') == 'critical')
    thr_high = sum(1 for t in threats if t.get('severity') == 'high')

    cpu_pct  = sys_raw.get('cpu', {}).get('load', 0)
    mem_pct  = sys_raw.get('memory', {}).get('percent', 0)
    uptime   = fmt_uptime(sys_raw.get('os', {}).get('uptime'))
    hostname = sys_raw.get('os', {}).get('hostname', 'Claudette')

    inet_ok  = internet_raw.get('ok')
    vpn_up   = internet_raw.get('vpn_up', False)
    vpn_ok   = internet_raw.get('vpn_ok')

    spd_tests = spd_raw.get('speedtests', [])
    last_spd  = spd_tests[0] if spd_tests else None

    # Header
    scan_tag = muted('  [scanning...]') if scanning else ''
    cpu_str  = c(pct_color(cpu_pct), 'CPU {0}%'.format(int(cpu_pct)))
    mem_str  = c(pct_color(mem_pct), 'MEM {0}%'.format(int(mem_pct)))
    add_item(
        c('6688FF', 'CLAUDETTE') + dim('  ') + head(hostname) + scan_tag,
        url(action='system'),
        info={'title': 'Claudette — ' + hostname,
              'plot': 'Server: {0}\nLast scan: {1}\nUptime: {2}'.format(server, last_scan, uptime)})
    add_item(
        cpu_str + dim('  ') + mem_str + dim('  up ') + muted(uptime),
        url(action='system'),
        info={'title': 'System Stats',
              'plot': 'CPU: {0}%\nMemory: {1}%\nUptime: {2}\n\nTap to view full system stats.'.format(
                  int(cpu_pct), int(mem_pct), uptime)})

    sep('Network')

    net_dot = good('●') if online else dim('●')
    net_sub = '{0} online'.format(online)
    if filtered: net_sub += ', {0} filtered'.format(filtered)
    if devices:  net_sub += ', {0} total'.format(len(devices))
    add_item(
        '{0}  {1}  {2}'.format(net_dot, head('Devices'), dim(net_sub)),
        url(action='devices'), is_folder=True,
        info={'title': 'Network Devices',
              'plot': '{0} devices online  ({1} total)\nLast scan: {2}{3}'.format(
                  online, len(devices), last_scan,
                  '\n[Scanning in progress]' if scanning else '')})

    if inet_ok is None:
        inet_dot, inet_sub = dim('●'), dim('no data yet')
    elif inet_ok:
        ok_res   = [r for r in internet_raw.get('results', []) if r.get('ok')]
        avg_ms   = int(sum(r.get('ms', 0) for r in ok_res) / len(ok_res)) if ok_res else 0
        inet_dot = good('●')
        inet_sub = good('ONLINE') + dim('  {0}ms'.format(avg_ms))
        if vpn_up and vpn_ok:
            inet_sub += '  ' + accent('VPN')
    else:
        inet_dot, inet_sub = bad('●'), bad('OFFLINE')

    add_item(
        '{0}  {1}  {2}'.format(inet_dot, head('Internet'), inet_sub),
        url(action='internet'), is_folder=True,
        info={'title': 'Internet',
              'plot': 'Status: {0}{1}'.format(
                  'ONLINE' if inet_ok else ('OFFLINE' if inet_ok is False else 'Unknown'),
                  '\nVPN: {0}'.format('OK' if vpn_ok else 'UP (degraded)') if vpn_up else '')})

    if svc_total:
        svc_pct   = int(svc_ok / svc_total * 100)
        svc_color = '44FF88' if svc_ok == svc_total else ('FF8800' if svc_pct >= 50 else 'FF4444')
        svc_dot   = c(svc_color, '●')
        svc_sub   = c(svc_color, '{0}/{1}'.format(svc_ok, svc_total)) + dim(' healthy')
        if svc_down:
            svc_sub += dim('  DOWN: ') + bad(', '.join(s.get('name', '?') for s in svc_down[:3]))
    else:
        svc_dot, svc_sub = dim('●'), dim('none configured')
    add_item(
        '{0}  {1}  {2}'.format(svc_dot, head('Services'), svc_sub),
        url(action='services'), is_folder=True,
        info={'title': 'Services',
              'plot': '{0}/{1} services healthy\n\n{2}'.format(
                  svc_ok, svc_total,
                  '\n'.join('{0} {1}'.format('OK' if s.get('ok') else 'DOWN', s.get('name', ''))
                            for s in svc_list[:10]))})

    sep('Intelligence')

    if thr_crit:
        thr_dot = bad('●')
        thr_sub = bad('{0} critical'.format(thr_crit))
        if thr_high: thr_sub += dim('  ') + warn('{0} high'.format(thr_high))
    elif thr_high:
        thr_dot = warn('●')
        thr_sub = warn('{0} high'.format(thr_high))
    elif threats:
        thr_dot, thr_sub = muted('●'), dim('{0} threats'.format(len(threats)))
    else:
        thr_dot, thr_sub = good('●'), good('clean')
    thr_plot = '{0} total threats'.format(len(threats))
    for sev in ('critical', 'high', 'medium', 'low'):
        n = sum(1 for t in threats if t.get('severity') == sev)
        if n: thr_plot += '\n  {0}: {1}'.format(sev.upper(), n)
    add_item(
        '{0}  {1}  {2}'.format(thr_dot, head('Threats'), thr_sub),
        url(action='threats'), is_folder=True,
        info={'title': 'Threats', 'plot': thr_plot or 'No threats detected.'})

    cfg_dl = _isp_plan_dl()
    cfg_ul = _isp_plan_ul()
    if last_spd:
        spd_dl   = last_spd.get('download_mbps') or 0
        spd_ul   = last_spd.get('upload_mbps') or 0
        spd_ping = last_spd.get('ping_ms') or 0
        dl_col   = pct_color(spd_dl / cfg_dl * 100) if cfg_dl else ('44FF88' if spd_dl >= 50 else 'FFCC00')
        ul_col   = pct_color(spd_ul / cfg_ul * 100) if cfg_ul else ('44AAFF' if spd_ul >= 20 else 'FFCC00')
        spd_sub  = (c(dl_col, chr(0x25BC) + ' {0:.0f}'.format(spd_dl)) + dim(' Mbps  ') +
                    c(ul_col, chr(0x25B2) + ' {0:.0f}'.format(spd_ul)) + dim(' Mbps  ') +
                    dim('ping {0}ms'.format(int(spd_ping))))
        spd_plot = 'Last test: {0}\nDown: {1:.1f} Mbps\nUp: {2:.1f} Mbps\nPing: {3}ms'.format(
            fmt_ts(last_spd.get('ts')), spd_dl, spd_ul, int(spd_ping))
        if cfg_dl: spd_plot += '\n\nISP plan: {0}/{1} Mbps'.format(int(cfg_dl), int(cfg_ul) if cfg_ul else '?')
    else:
        spd_sub  = dim('no results yet')
        spd_plot = 'No speed test results yet.\n\nTap to view and run a test.'
    add_item(
        dim('●') + '  ' + head('Speed Tests') + '  ' + spd_sub,
        url(action='speedtest'), is_folder=True,
        info={'title': 'Speed Tests', 'plot': spd_plot})

    if ddns_raw.get('enabled'):
        ddns_err = ddns_raw.get('last_error')
        ddns_dot = bad('●') if ddns_err else good('●')
        ddns_hn  = ddns_raw.get('hostname') or ''
        ddns_ip  = ddns_raw.get('last_ip') or '--'
        ddns_sub = dim(ddns_hn + '  ') + muted(ddns_ip) if ddns_hn else muted(ddns_ip)
        if ddns_err: ddns_sub += '  ' + bad('ERR')
        add_item(
            '{0}  {1}  {2}'.format(ddns_dot, head('DDNS'), ddns_sub),
            url(action='ddns'), is_folder=True,
            info={'title': 'DDNS',
                  'plot': 'Hostname: {0}\nCurrent IP: {1}\nLast updated: {2}{3}'.format(
                      ddns_hn, ddns_ip, fmt_ts(ddns_raw.get('last_updated')),
                      '\nError: ' + ddns_err if ddns_err else '')})

    sep('Actions')
    add_item(info_c('>') + '  ' + muted('Scan Network'),
             url(action='trigger_scan'),
             info={'title': 'Scan Network', 'plot': 'Start a fresh network scan.\nLast scan: {0}'.format(last_scan)})
    add_item(info_c('>') + '  ' + muted('Deep Scan  (port scan all devices)'),
             url(action='trigger_deep_scan'),
             info={'title': 'Deep Scan', 'plot': 'Run nmap port scan on all online devices.\nThis takes a few minutes.'})
    add_item(accent('>') + '  ' + muted('Refresh Services'),
             url(action='refresh_services_action'),
             info={'title': 'Refresh Services', 'plot': 'Run all service health checks now.'})
    add_item(warn('>') + '  ' + muted('Refresh Threats'),
             url(action='refresh_threats_action'),
             info={'title': 'Refresh Threats', 'plot': 'Fetch the latest vulnerability feed.'})
    add_item(muted('=') + '  ' + muted('Audit Log'),
             url(action='audit'), is_folder=True,
             info={'title': 'Audit Log', 'plot': 'Full timestamped record of all system events.'})
    add_item(muted('=') + '  ' + muted('Activity Report'),
             url(action='reports'), is_folder=True,
             info={'title': 'Activity Report', 'plot': 'Device, service, and system activity.'})
    add_item(dim('=') + '  ' + dim('Settings'),
             url(action='open_settings'),
             info={'title': 'Settings', 'plot': 'Configure server URL, credentials, and display options.'})

    end_dir()


# -- Devices -------------------------------------------------------------------

def show_devices():
    api  = get_api()
    if api is None: return
    data = api.get_network()
    if data is None:
        err_dialog('Network', 'Could not reach server.'); return

    devices      = data.get('devices', [])
    show_offline = ADDON.getSetting('show_offline_devices') != 'false'
    last_scan    = fmt_ts(data.get('lastScan'))
    scanning     = data.get('scanning', False)

    online  = sum(1 for d in devices if d.get('status') == 'online')
    filt    = sum(1 for d in devices if d.get('status') == 'filtered')
    offline = len(devices) - online - filt

    summary = good(str(online)) + dim(' online')
    if filt:         summary += dim('  ') + warn(str(filt)) + dim(' filtered')
    if show_offline: summary += dim('  ') + muted(str(offline)) + dim(' offline')
    if scanning:     summary += muted('  [scanning]')
    add_item(
        summary + dim('  last scan ') + muted(last_scan),
        url(action='trigger_scan'),
        info={'title': 'Network — {0} online'.format(online),
              'plot': '{0} online, {1} filtered, {2} offline\nLast scan: {3}\n\nTap to trigger a new scan.'.format(
                  online, filt, offline, last_scan)})

    if not devices:
        add_item(dim('No devices found — trigger a scan first')); end_dir(); return

    def sort_key(d):
        fav  = not d.get('favorited', False)
        stat = {'online': 0, 'filtered': 1}.get(d.get('status'), 2)
        try:   octet = int((d.get('ip') or '0').split('.')[-1])
        except ValueError: octet = 0
        return (fav, stat, octet)

    for d in sorted(devices, key=sort_key):
        status = d.get('status', 'offline')
        if status not in ('online', 'filtered') and not show_offline:
            continue

        ip       = d.get('ip', '')
        label    = d.get('label') or ''
        hostname = d.get('hostname') or ''
        name     = label or hostname or ip
        vendor   = d.get('vendor') or ''
        latency  = d.get('latency')
        ports    = [p for p in d.get('ports', []) if p.get('state') == 'open']
        fav      = d.get('favorited', False)
        flagged  = d.get('flagged', False)
        dormant  = d.get('dormant', False)
        mac      = d.get('mac') or ''

        dot      = status_dot(status)
        prefix   = (warn('★ ') if fav else '') + (bad('! ') if flagged else '')
        name_col = 'FFFFFF' if status == 'online' else ('666666' if status == 'offline' else 'FFCC88')
        row      = '{0}  {1}{2}'.format(dot, prefix, c(name_col, name))
        if label and hostname and hostname != label:
            row += dim('  ' + hostname)
        elif not label and ip != name:
            row += dim('  ' + ip)
        if status == 'online' and latency is not None:
            row += dim('  {0}ms'.format(latency))
        if ports:
            row += dim('  {0}p'.format(len(ports)))
        if dormant:
            row += dim('  [dormant]')

        plot_parts = ['IP: {0}'.format(ip)]
        if mac:     plot_parts.append('MAC: {0}'.format(mac))
        if vendor:  plot_parts.append('Vendor: {0}'.format(vendor))
        if d.get('os'): plot_parts.append('OS: {0}'.format(d['os']))
        if latency is not None: plot_parts.append('Latency: {0}ms'.format(latency))
        if ports:
            plot_parts.append('Open ports:\n  ' + '\n  '.join(
                '{0}/{1} ({2})'.format(p.get('port'), p.get('protocol', 'tcp'), p.get('service', ''))
                for p in ports[:20]))
        if status == 'offline':
            plot_parts.append('Last seen: {0}'.format(fmt_ts(d.get('lastSeen'))))

        add_item(row, url(action='device_detail', ip=ip), is_folder=True,
                 info={'title': name, 'plot': '\n'.join(plot_parts)})

    end_dir()


def show_device_detail():
    ip  = ADDON_ARGS.get('ip', '')
    api = get_api()
    if api is None: return
    data = api.get_network()
    if not data:
        err_dialog('Network', 'Could not reach server.'); return

    device = next((d for d in data.get('devices', []) if d.get('ip') == ip), None)
    if not device:
        err_dialog('Not Found', 'Device {0} not found.'.format(ip)); return

    label    = device.get('label') or ''
    hostname = device.get('hostname') or ''
    name     = label or hostname or ip
    status   = device.get('status', 'offline')
    latency  = device.get('latency')
    vendor   = device.get('vendor') or 'Unknown'
    mac      = device.get('mac') or '--'
    ports    = [p for p in device.get('ports', []) if p.get('state') == 'open']
    hscripts = device.get('hostScripts') or device.get('host_scripts') or []
    route    = device.get('traceroute') or []
    fav      = device.get('favorited', False)
    flagged  = device.get('flagged', False)
    dormant  = device.get('dormant', False)

    prefix = (warn('★ ') if fav else '') + (bad('! ') if flagged else '')
    add_item(
        '{0}  {1}{2}  {3}'.format(status_dot(status), prefix, head(name), dim(ip)),
        info={'title': name,
              'plot': 'IP: {0}\nMAC: {1}\nVendor: {2}\nOS: {3}\nStatus: {4}{5}'.format(
                  ip, mac, vendor, device.get('os') or 'Unknown', status,
                  '\nLatency: {0}ms'.format(latency) if latency is not None else '')})

    sep('Info')
    rows = [('IP', ip), ('MAC', mac), ('Vendor', vendor),
            ('OS', device.get('os') or 'Unknown'), ('Hostname', hostname or '--'), ('Status', status)]
    if latency is not None: rows.append(('Latency', '{0}ms'.format(latency)))
    rows.append(('First seen', fmt_ts(device.get('firstSeen'))))
    rows.append(('Last seen',  fmt_ts(device.get('lastSeen') or device.get('last_online'))))
    if dormant: rows.append(('Note', '[Marked dormant]'))
    for k, v in rows:
        add_item(dim('{0:<12}'.format(k + ':')) + '  ' + head(str(v)),
                 info={'title': k, 'plot': '{0}: {1}'.format(k, v)})

    sep('Open Ports ({0})'.format(len(ports)))
    if not ports:
        add_item(dim('No open ports detected — run a deep scan'))
    else:
        for p in ports:
            port_num = p.get('port', '?')
            proto    = p.get('protocol', 'tcp')
            svc      = p.get('service', '')
            version  = p.get('version', '')
            scripts  = p.get('scripts') or []
            risk     = p.get('risk', 'none')
            risk_col = PORT_RISK_COLOR.get(risk, '555555')
            banner   = scripts[0][:60] if scripts else (version[:60] if version else '')
            row = c(risk_col, str(port_num)) + dim('/{0}'.format(proto))
            if svc:     row += '  ' + head(svc)
            if risk and risk != 'none': row += '  ' + c(risk_col, '[{0}]'.format(risk.upper()))
            if banner:  row += '  ' + dim(banner)
            plot = '{0}/{1}  {2}\nRisk: {3}'.format(port_num, proto, svc, risk)
            if version: plot += '\nVersion: ' + version
            if scripts: plot += '\n\n' + '\n'.join(scripts[:5])
            add_item(row, info={'title': '{0}/{1} {2}'.format(port_num, proto, svc), 'plot': plot})

    if hscripts:
        sep('Host Scripts')
        for line in (hscripts if isinstance(hscripts, list) else [hscripts])[:15]:
            add_item(dim(str(line)[:120]), info={'title': 'Script', 'plot': str(line)})

    if route:
        sep('Network Path ({0} hops)'.format(len(route)))
        for hop in route:
            rtts  = hop.get('rtt') or []
            valid = [r for r in rtts if r is not None] if isinstance(rtts, list) else []
            rtt_s = '{0}ms'.format(round(sum(valid) / len(valid), 1)) if valid else ('*' if not rtts else '{0}ms'.format(rtts))
            add_item(
                dim('Hop {0:<3}'.format(hop.get('hop', '?'))) +
                '  ' + c('AAAACC', hop.get('address') or hop.get('ip') or '*') +
                '  ' + dim(rtt_s),
                info={'title': 'Hop {0}'.format(hop.get('hop')),
                      'plot': 'Address: {0}\nRTT: {1}'.format(hop.get('address') or '*', rtt_s)})

    end_dir()


# -- Services ------------------------------------------------------------------

def show_services():
    api  = get_api()
    if api is None: return
    data = api.get_services()
    if data is None:
        err_dialog('Services', 'Could not reach server.'); return

    results = data.get('results', [])
    if not results:
        add_item(dim('No services configured — add them in the web UI'))
        end_dir(); return

    ok_count = sum(1 for s in results if s.get('ok'))
    total    = len(results)
    pct      = int(ok_count / total * 100) if total else 0
    hdr_col  = '44FF88' if ok_count == total else ('FF8800' if pct >= 50 else 'FF4444')
    add_item(
        c(hdr_col, '{0}/{1} healthy'.format(ok_count, total)) + dim('  ({0}%)'.format(pct)),
        info={'title': 'Services',
              'plot': '{0}/{1} services healthy ({2}%)'.format(ok_count, total, pct)})

    for svc in sorted(results, key=lambda r: (r.get('ok', False), r.get('name', '').lower())):
        ok      = svc.get('ok', False)
        name    = svc.get('name', 'Unknown')
        message = svc.get('message', '')
        ms      = svc.get('ms')
        uptime  = svc.get('uptime_pct')

        row = ok_dot(ok) + '  ' + c('FFFFFF' if ok else 'FF8888', name) + '  ' + (good('OK') if ok else bad('DOWN'))
        if ms is not None: row += dim('  {0}ms'.format(ms))
        if uptime is not None: row += '  ' + c(pct_color(uptime), '{0:.1f}%'.format(uptime))

        plot = 'Status: {0}'.format('OK' if ok else 'DOWN')
        if message:        plot += '\nMessage: {0}'.format(message)
        if ms is not None: plot += '\nResponse: {0}ms'.format(ms)
        if uptime:         plot += '\nUptime: {0:.1f}%'.format(uptime)

        add_item(row, info={'title': name, 'plot': plot.strip()})

    sep()
    add_item(accent('>') + '  ' + muted('Refresh Services Now'),
             url(action='refresh_services_action'),
             info={'title': 'Refresh', 'plot': 'Run all service health checks immediately.'})
    end_dir()


# -- Threats -------------------------------------------------------------------

def show_threats():
    api  = get_api()
    if api is None: return
    data = api.get_threats()
    if data is None:
        err_dialog('Threats', 'Could not reach server.'); return

    raw_sev = ADDON.getSetting('threat_min_severity') or '1'
    if raw_sev.lstrip('-').isdigit():
        min_sev_str = ['low', 'medium', 'high', 'critical'][min(int(raw_sev), 3)]
    else:
        min_sev_str = raw_sev.lower() if raw_sev.lower() in SEV_RANK else 'medium'
    min_level   = SEV_RANK[min_sev_str]
    all_threats = data.get('threats', [])
    threats     = [t for t in all_threats if SEV_RANK.get(t.get('severity', 'low'), 1) >= min_level]
    last_refresh = fmt_ts(data.get('lastRefresh'))

    counts = {}
    for sev in ('critical', 'high', 'medium', 'low'):
        n = sum(1 for t in all_threats if t.get('severity') == sev)
        if n: counts[sev] = n
    hdr = '  '.join(c(SEV_COLOR[sev], '{0} {1}'.format(n, sev)) for sev, n in counts.items()) \
          if counts else good('No threats')
    add_item(
        hdr + dim('  refreshed ') + muted(last_refresh),
        info={'title': 'Threat Feed',
              'plot': 'Total: {0}\nShowing: {1}+\nLast refresh: {2}'.format(
                  len(all_threats), min_sev_str, last_refresh)})

    if not threats:
        add_item(dim('No threats at {0} severity or above'.format(min_sev_str)))
        end_dir(); return

    groups = {}
    for t in threats:
        key = t.get('package') or t.get('source') or 'Other'
        groups.setdefault(key, []).append(t)

    def worst_rank(ts):
        return max(SEV_RANK.get(t.get('severity', 'low'), 1) for t in ts)

    for pkg_name, pkg_threats in sorted(groups.items(), key=lambda kv: -worst_rank(kv[1])):
        w        = worst_rank(pkg_threats)
        sev_name = {1: 'low', 2: 'medium', 3: 'high', 4: 'critical'}[w]
        color    = SEV_COLOR.get(sev_name, '888888')
        count    = len(pkg_threats)
        add_item(
            c(color, '[{0}]'.format(sev_name.upper())) + '  ' + head(pkg_name) +
            dim('  {0} issue{1}'.format(count, 's' if count != 1 else '')),
            url(action='threat_group', package=pkg_name), is_folder=True,
            info={'title': pkg_name,
                  'plot': '{0} vulnerabilities\nWorst severity: {1}\n\n{2}'.format(
                      count, sev_name.upper(),
                      '\n'.join(t.get('title', '') for t in pkg_threats[:5]))})

    sep()
    add_item(warn('>') + '  ' + muted('Refresh Threat Feed Now'),
             url(action='refresh_threats_action'),
             info={'title': 'Refresh', 'plot': 'Fetch the latest vulnerability intelligence feed.'})
    end_dir()


def show_threat_group():
    pkg  = ADDON_ARGS.get('package', '')
    api  = get_api()
    if api is None: return
    data = api.get_threats()
    if not data:
        err_dialog('Threats', 'Could not reach server.'); return

    threats = [t for t in data.get('threats', [])
               if (t.get('package') or t.get('source') or 'Other') == pkg]
    if not threats:
        add_item(dim('No threats for: ' + pkg)); end_dir(); return

    add_item(head(pkg) + dim('  {0} issue{1}'.format(len(threats), 's' if len(threats) != 1 else '')),
             info={'title': pkg, 'plot': '{0} vulnerabilities in {1}'.format(len(threats), pkg)})

    for t in sorted(threats, key=lambda x: -SEV_RANK.get(x.get('severity', 'low'), 1)):
        sev   = t.get('severity', 'low')
        color = SEV_COLOR.get(sev, '888888')
        title = t.get('title', 'Unknown')
        date  = fmt_date(t.get('date', ''))
        row   = c(color, '[{0}]'.format(sev.upper())) + '  ' + c('DDDDDD', title[:90])
        if date: row += dim('  ' + date)
        plot  = title + '\nSeverity: ' + sev.upper()
        if t.get('summary'): plot += '\n\n' + t['summary']
        if t.get('source'):  plot += '\n\nSource: ' + t['source']
        if date:             plot += '\nDate: ' + date
        if t.get('url'):     plot += '\n\n' + t['url']
        add_item(row, info={'title': title, 'plot': plot})

    end_dir()


# -- Internet (folder) ---------------------------------------------------------

def show_internet():
    api  = get_api()
    if api is None: return
    data = api.get_internet()
    if data is None:
        err_dialog('Internet', 'Could not reach server.'); return

    ok          = data.get('ok')
    results     = data.get('results', [])
    vpn_up      = data.get('vpn_up', False)
    vpn_ok      = data.get('vpn_ok')
    vpn_meta    = data.get('vpn_meta') or {}
    vpn_results = data.get('vpn_results', [])

    if ok is None:
        stat_str  = dim('no data yet')
        stat_plot = 'No internet checks have run yet.'
    elif ok:
        ok_r      = [r for r in results if r.get('ok')]
        avg_ms    = int(sum(r.get('ms', 0) for r in ok_r) / len(ok_r)) if ok_r else 0
        stat_str  = good('ONLINE') + dim('  {0}ms avg'.format(avg_ms))
        stat_plot = 'All connectivity probes passing.\nAverage latency: {0}ms'.format(avg_ms)
    else:
        stat_str  = bad('OFFLINE')
        stat_plot = 'All connectivity probes are failing.'

    add_item(head('Internet') + '  ' + stat_str,
             info={'title': 'Internet', 'plot': stat_plot})

    if results:
        sep('Probes')
        for r in results:
            host = r.get('host', '?')
            ok_r = r.get('ok', False)
            ms   = r.get('ms')
            add_item(
                ok_dot(ok_r) + '  ' + head(host) + dim(
                    '  {0}ms'.format(ms) if ms is not None else '  timeout'),
                info={'title': host,
                      'plot': 'Host: {0}\nStatus: {1}{2}'.format(
                          host, 'OK' if ok_r else 'FAILED',
                          '\nLatency: {0}ms'.format(ms) if ms is not None else '')})

    if vpn_up:
        sep('VPN')
        vpn_ok_r = [r for r in vpn_results if r.get('ok')]
        vpn_avg  = int(sum(r.get('ms', 0) for r in vpn_ok_r) / len(vpn_ok_r)) if vpn_ok_r else None
        vpn_str  = good('UP') if vpn_ok else warn('DEGRADED')
        if vpn_avg: vpn_str += dim('  {0}ms'.format(vpn_avg))
        vpn_plot = 'VPN: {0}'.format('OK' if vpn_ok else 'Degraded')
        for key in ('client_ip', 'client_isp', 'client_city', 'client_country'):
            val = vpn_meta.get(key)
            if val: vpn_plot += '\n{0}: {1}'.format(
                key.replace('client_', '').replace('_', ' ').title(), val)
        add_item(accent('VPN') + '  ' + vpn_str, info={'title': 'VPN', 'plot': vpn_plot})
        for r in vpn_results:
            host = r.get('host', '?')
            ok_r = r.get('ok', False)
            ms   = r.get('ms')
            add_item(
                accent('○') + '  ' + head(host) + dim(
                    '  {0}ms'.format(ms) if ms is not None else '  timeout'),
                info={'title': host, 'plot': 'VPN probe {0}: {1}'.format(host, 'OK' if ok_r else 'FAILED')})

    sep()
    for days in (7, 30, 90):
        add_item(
            muted('=') + '  ' + head('Outage History') + dim('  last {0} days'.format(days)),
            url(action='internet_outages', days=days), is_folder=True,
            info={'title': 'Outage History — {0}d'.format(days),
                  'plot': 'Show internet outage history for the last {0} days.'.format(days)})
    add_item(info_c('>') + '  ' + muted('Run Connectivity Check Now'),
             url(action='run_internet_check'),
             info={'title': 'Run Check', 'plot': 'Trigger an immediate internet connectivity check.'})
    end_dir()


def show_internet_outages():
    api  = get_api()
    if api is None: return
    days = int(ADDON_ARGS.get('days', 7))
    data = api.get_internet_report(days=days)
    if data is None:
        err_dialog('Outage History', 'Could not reach server.'); return

    summary        = data.get('summary') or data.get('internetStats') or {}
    outages        = data.get('outages', [])
    isp_cfg        = data.get('ispConfig') or {}
    total_checks   = summary.get('totalChecks', 0)
    down_checks    = summary.get('downChecks', 0)
    uptime_pct     = summary.get('uptimePct') or summary.get('uptimePercent')
    if uptime_pct is None and total_checks > 0:
        uptime_pct = round((1 - down_checks / total_checks) * 100, 2)
    total_downtime = summary.get('totalDowntimeMs') or summary.get('totalDowntime', 0)
    outage_count   = len(outages)
    isp_target     = isp_cfg.get('expected_uptime') or isp_cfg.get('expectedUptime')

    sla_str = ''
    if isp_target and uptime_pct is not None:
        met     = uptime_pct >= float(isp_target)
        sla_str = '  ' + c('44FF88' if met else 'FF4444', 'SLA {0}'.format('PASS' if met else 'FAIL')) + \
                  dim('  target {0}%'.format(isp_target))

    up_col = '44FF88' if (uptime_pct or 0) >= 99 else ('FFCC00' if (uptime_pct or 0) >= 95 else 'FF4444')
    add_item(
        head('Last {0} days'.format(days)) + '  ' + c(up_col, '{0:.2f}%'.format(uptime_pct or 0)) +
        dim(' uptime') + sla_str,
        info={'title': 'Outage summary — {0}d'.format(days),
              'plot': 'Period: last {0} days\nUptime: {1:.2f}%\nOutages: {2}\nTotal downtime: {3}{4}'.format(
                  days, uptime_pct or 0, outage_count, fmt_dur_ms(total_downtime),
                  '\nISP target: {0}%'.format(isp_target) if isp_target else '')})

    isp_name = isp_cfg.get('name', '')
    add_item(
        dim('{0} outage{1}   total down: '.format(outage_count, 's' if outage_count != 1 else '')) +
        muted(fmt_dur_ms(total_downtime)) +
        (dim('   ISP: ') + muted(isp_name) if isp_name else ''),
        info={'title': 'Stats',
              'plot': 'Outages: {0}\nTotal downtime: {1}\nISP: {2}'.format(
                  outage_count, fmt_dur_ms(total_downtime), isp_name or '--')})

    if not outages:
        sep()
        add_item(good('No outages in the last {0} days'.format(days)))
        end_dir(); return

    sep('Outages ({0}) — longest first'.format(outage_count))

    for o in sorted(outages, key=lambda x: -(x.get('duration_ms') or x.get('durationMs') or 0)):
        start_ts = o.get('start') or o.get('started_at') or o.get('startTs')
        end_ts   = o.get('end')   or o.get('ended_at')   or o.get('endTs')
        dur_ms   = o.get('duration_ms') or o.get('durationMs') or 0
        otype    = o.get('type', 'full')
        dur_str  = fmt_dur_ms(dur_ms)
        sev_col  = 'FF4444' if dur_ms > 30 * 60 * 1000 else ('FF8800' if dur_ms > 5 * 60 * 1000 else 'FFCC00')
        row = bad('●') + '  ' + c(sev_col, dur_str) + dim('   ') + muted(fmt_ts_long(start_ts)[:16])
        if otype not in ('full', ''): row += dim('  [partial]')
        add_item(row, info={'title': dur_str + ' outage',
                            'plot': 'Started:  {0}\nEnded:    {1}\nDuration: {2}\nType: {3}'.format(
                                fmt_ts_long(start_ts), fmt_ts_long(end_ts) if end_ts else 'ongoing',
                                dur_str, otype or 'full')})

    end_dir()


# -- Speed Tests ---------------------------------------------------------------

def show_speedtest():
    api   = get_api()
    if api is None: return
    limit = int(ADDON.getSetting('speedtest_limit') or 10)
    data  = api.get_speedtest_report(limit=limit)
    if data is None:
        err_dialog('Speed Tests', 'Could not reach server.'); return

    tests   = data.get('speedtests', [])
    summary = data.get('summary', {})
    cfg_dl  = _isp_plan_dl()
    cfg_ul  = _isp_plan_ul()
    avg_dl  = summary.get('avg_download_mbps') or 0
    avg_ul  = summary.get('avg_upload_mbps') or 0
    avg_ms  = summary.get('avg_ping_ms') or 0

    if tests:
        dl_col = pct_color(avg_dl / cfg_dl * 100) if cfg_dl else '44FF88'
        ul_col = pct_color(avg_ul / cfg_ul * 100) if cfg_ul else '44AAFF'
        hdr = (c(dl_col, chr(0x25BC) + ' {0:.0f}'.format(avg_dl)) + dim(' Mbps  ') +
               c(ul_col, chr(0x25B2) + ' {0:.0f}'.format(avg_ul)) + dim(' Mbps  ') +
               dim('ping {0:.0f}ms avg'.format(avg_ms)))
        hdr_plot = 'Average of {0} tests\nDown: {1:.1f} Mbps\nUp: {2:.1f} Mbps\nPing: {3:.0f}ms'.format(
            len(tests), avg_dl, avg_ul, avg_ms)
        if cfg_dl:
            dl_pct = avg_dl / cfg_dl * 100
            ul_pct = (avg_ul / cfg_ul * 100) if cfg_ul else None
            hdr_plot += '\n\nISP plan: {0}/{1} Mbps\nDown: {2:.0f}% of plan'.format(
                int(cfg_dl), int(cfg_ul) if cfg_ul else '?', dl_pct)
            if ul_pct: hdr_plot += '   Up: {0:.0f}% of plan'.format(ul_pct)
    else:
        hdr      = dim('No results yet — tap to run a test')
        hdr_plot = 'No speed test results.\n\nTap below to run a test.'

    add_item(hdr, info={'title': 'Speed Test Summary', 'plot': hdr_plot})

    if cfg_dl and tests:
        dl_pct = avg_dl / cfg_dl * 100
        ul_pct = (avg_ul / cfg_ul * 100) if cfg_ul else None
        plan_row = (dim('ISP plan: ') +
                    head('{0}/{1}'.format(int(cfg_dl), int(cfg_ul) if cfg_ul else '?')) +
                    dim(' Mbps   avg: ') +
                    c(pct_color(dl_pct), '{0:.0f}%'.format(dl_pct)) + dim(' down'))
        if ul_pct:
            plan_row += dim(' / ') + c(pct_color(ul_pct), '{0:.0f}%'.format(ul_pct)) + dim(' up')
        add_item(plan_row, info={'title': 'vs ISP plan',
                                 'plot': 'ISP plan: {0}/{1} Mbps\nAvg down: {2:.0f}% of plan\nAvg up: {3}'.format(
                                     cfg_dl, cfg_ul, dl_pct,
                                     '{0:.0f}% of plan'.format(ul_pct) if ul_pct else '--')})

    if not tests:
        add_item(info_c('>') + '  ' + muted('Run Speed Test Now'), url(action='run_speedtest'),
                 info={'title': 'Run Speed Test', 'plot': 'Takes about 20-30 seconds.'})
        end_dir(); return

    sep('Results (newest first)')
    for t in tests:
        ts   = fmt_ts(t.get('ts'))
        dl   = t.get('download_mbps') or 0
        ul   = t.get('upload_mbps') or 0
        ping = t.get('ping_ms') or 0
        isp  = t.get('client_isp') or ''
        srv  = t.get('server_name') or ''
        via  = t.get('via', 'direct')

        dl_col  = pct_color(dl / cfg_dl * 100) if cfg_dl else ('44FF88' if dl >= 50 else ('FFCC00' if dl >= 10 else 'FF4444'))
        ul_col  = pct_color(ul / cfg_ul * 100) if cfg_ul else ('44AAFF' if ul >= 20 else ('FFCC00' if ul >= 5 else 'FF8800'))
        row = (dim(ts) + '   ' +
               c(dl_col, chr(0x25BC) + ' {0:.1f}'.format(dl)) + dim(' Mbps  ') +
               c(ul_col, chr(0x25B2) + ' {0:.1f}'.format(ul)) + dim(' Mbps') +
               dim('  ping {0}ms'.format(int(ping))) +
               (dim(' [VPN]') if via and via != 'direct' else ''))
        plot = 'Date: {0}\nDown: {1:.1f} Mbps\nUp: {2:.1f} Mbps\nPing: {3}ms'.format(ts, dl, ul, int(ping))
        if srv: plot += '\nServer: ' + srv
        if isp: plot += '\nISP: '    + isp
        if via != 'direct': plot += '\nVia: ' + via
        if cfg_dl:
            plot += '\n\nVs plan: {0:.0f}% down'.format(dl / cfg_dl * 100)
            if cfg_ul: plot += ' / {0:.0f}% up'.format(ul / cfg_ul * 100)

        add_item(row, info={'title': ts, 'plot': plot})

    sep()
    add_item(info_c('>') + '  ' + muted('Run Speed Test Now'), url(action='run_speedtest'),
             info={'title': 'Run Speed Test', 'plot': 'Trigger an immediate speed test. Takes ~30 seconds.'})
    end_dir()


# -- System Stats --------------------------------------------------------------

def show_system():
    api  = get_api()
    if api is None: return
    data = api.get_stats()
    if data is None:
        err_dialog('System', 'Could not reach server.'); return

    cpu   = data.get('cpu', {})
    mem   = data.get('memory', {})
    disks = data.get('disk', [])
    nets  = data.get('network', [])
    os_d  = data.get('os', {})

    hostname = os_d.get('hostname', '')
    distro   = '{0} {1}'.format(os_d.get('distro', ''), os_d.get('release', '')).strip()
    arch     = os_d.get('arch', '')
    uptime   = fmt_uptime(os_d.get('uptime'))

    add_item(head(hostname or 'System') + dim('  ' + distro + '  ' + arch),
             info={'title': 'System',
                   'plot': 'Host: {0}\nOS: {1}\nArch: {2}\nKernel: {3}\nUptime: {4}'.format(
                       hostname, distro, arch, os_d.get('kernel', ''), uptime)})
    add_item(dim('Uptime:  ') + c('AAAAFF', uptime),
             info={'title': 'Uptime', 'plot': 'System uptime: ' + uptime})

    sep('CPU')
    cpu_pct  = cpu.get('load', 0)
    per_core = cpu.get('perCore', [])
    add_item(
        dim('Load:  ') + c(pct_color(cpu_pct), pct_bar(cpu_pct)) +
        dim('  {0} core{1}'.format(cpu.get('cores', 1), 's' if cpu.get('cores', 1) != 1 else '')),
        info={'title': 'CPU', 'plot': 'Load: {0}%\nModel: {1}\nCores: {2}'.format(
            cpu_pct, cpu.get('model', '?'), cpu.get('cores', 1))})
    add_item(dim('Model: ') + head((cpu.get('model') or '?')[:70]),
             info={'title': 'CPU Model', 'plot': cpu.get('model', '')})
    if per_core:
        core_str = '  '.join(c(pct_color(p), 'C{0}:{1}%'.format(i, p)) for i, p in enumerate(per_core))
        add_item(dim('Cores: ') + core_str,
                 info={'title': 'Per-core',
                       'plot': '\n'.join('Core {0}: {1}%'.format(i, p) for i, p in enumerate(per_core))})

    sep('Memory')
    mem_pct = mem.get('percent', 0)
    add_item(
        dim('Used:  ') + c(pct_color(mem_pct), pct_bar(mem_pct)) +
        dim('  {0} / {1}'.format(fmt_bytes(mem.get('used', 0)), fmt_bytes(mem.get('total', 0)))),
        info={'title': 'Memory',
              'plot': 'Used: {0}\nFree: {1}\nTotal: {2}'.format(
                  fmt_bytes(mem.get('used', 0)), fmt_bytes(mem.get('free', 0)),
                  fmt_bytes(mem.get('total', 0)))})
    if mem.get('swapTotal', 0) > 0:
        add_item(dim('Swap:  ') + muted('{0} / {1}'.format(
                     fmt_bytes(mem.get('swapUsed', 0)), fmt_bytes(mem.get('swapTotal', 0)))),
                 info={'title': 'Swap',
                       'plot': 'Swap: {0} used / {1} total'.format(
                           fmt_bytes(mem.get('swapUsed', 0)), fmt_bytes(mem.get('swapTotal', 0)))})

    if disks:
        sep('Disk')
        for d in disks:
            pct   = d.get('use', 0)
            mount = d.get('mount', '?')
            add_item(
                c(pct_color(pct), pct_bar(pct, 8)) + dim('  ') +
                head(mount) + dim('  {0} / {1}  {2}'.format(
                    fmt_bytes(d.get('used', 0)), fmt_bytes(d.get('size', 0)), d.get('type', ''))),
                info={'title': mount,
                      'plot': 'Mount: {0}\nType: {1}\nUsed: {2}\nTotal: {3}\nUsage: {4}%'.format(
                          mount, d.get('type', ''),
                          fmt_bytes(d.get('used', 0)), fmt_bytes(d.get('size', 0)), pct)})

    if nets:
        sep('Network')
        for n in nets:
            iface = n.get('iface', '?')
            add_item(
                c('AAAACC', iface) + dim('  ') +
                good(chr(0x25BC) + ' ' + fmt_bytes(n.get('rx_sec', 0)) + '/s') + dim('  ') +
                info_c(chr(0x25B2) + ' ' + fmt_bytes(n.get('tx_sec', 0)) + '/s') +
                dim('  rx {0}  tx {1}'.format(
                    fmt_bytes(n.get('rx_bytes', 0)), fmt_bytes(n.get('tx_bytes', 0)))),
                info={'title': iface,
                      'plot': 'Interface: {0}\nDown: {1}/s  (total {2})\nUp: {3}/s  (total {4})'.format(
                          iface, fmt_bytes(n.get('rx_sec', 0)), fmt_bytes(n.get('rx_bytes', 0)),
                          fmt_bytes(n.get('tx_sec', 0)), fmt_bytes(n.get('tx_bytes', 0)))})

    end_dir()


# -- Audit Log -----------------------------------------------------------------

def show_audit():
    api   = get_api()
    if api is None: return
    limit = int(ADDON.getSetting('audit_limit') or 50)
    page  = int(ADDON_ARGS.get('page', 0))
    data  = api.get_audit(limit=limit, offset=page * limit)
    if data is None:
        err_dialog('Audit Log', 'Could not reach server.'); return

    entries = data.get('entries', [])
    total   = data.get('total', 0)
    pages   = max(1, (total + limit - 1) // limit)

    add_item(
        head('Audit Log') + dim('  {0} events  p{1}/{2}'.format(total, page + 1, pages)),
        info={'title': 'Audit Log',
              'plot': '{0} total events\nPage {1} of {2}'.format(total, page + 1, pages)})

    if not entries:
        add_item(dim('No audit events yet')); end_dir(); return

    for e in entries:
        event   = e.get('event', '')
        ts      = fmt_ts_long(e.get('ts'))
        actor   = e.get('actor', 'system')
        payload = e.get('payload') or {}
        color   = EVENT_COLOR.get(event, '777777')

        parts = []
        if payload.get('devices_found') is not None: parts.append('{0} devices'.format(payload['devices_found']))
        if payload.get('subnet'):     parts.append(payload['subnet'])
        if payload.get('name'):       parts.append(payload['name'])
        if payload.get('new_count'):  parts.append('{0} new'.format(payload['new_count']))
        if payload.get('up') is not None:
            parts.append('{0} up/{1} down'.format(payload['up'], payload.get('down', 0)))
        if payload.get('error'):      parts.append(payload['error'][:40])
        detail = '  ' + dim(' / '.join(str(p) for p in parts)) if parts else ''

        row = dim(ts[:16]) + '  ' + c(color, event) + detail
        if actor and actor != 'system': row += '  ' + muted(actor)

        plot = 'Event: {0}\nActor: {1}\nTime: {2}'.format(event, actor, ts)
        if payload: plot += '\n\n' + json.dumps(payload, indent=2)[:400]

        add_item(row, info={'title': event, 'plot': plot})

    sep()
    if page > 0:
        add_item(info_c('< Previous page'),
                 url(action='audit', page=page - 1), is_folder=True,
                 info={'title': 'Previous', 'plot': 'Page {0}'.format(page)})
    if page < pages - 1:
        add_item(info_c('Next page >'),
                 url(action='audit', page=page + 1), is_folder=True,
                 info={'title': 'Next', 'plot': 'Page {0}'.format(page + 2)})
    end_dir()


# -- Activity Report -----------------------------------------------------------

REPORT_EVENT_COLOR = {
    'device.new': '44FF88',    'device.online': '44AAFF',
    'device.offline': '555555','device.port.open': '8888FF',
    'service.down': 'FF4444',  'service.up': '44FF88',
    'internet.down': 'FF4444', 'internet.up': '44FF88',
    'internet.check': '666666','scan.complete': '6666FF',
    'scan.started': '8888FF',  'threat.found': 'FFAA00',
}


def show_reports():
    api   = get_api()
    if api is None: return
    page  = int(ADDON_ARGS.get('page', 0))
    limit = int(ADDON.getSetting('audit_limit') or 50)
    data  = api.get_reports(limit=limit, offset=page * limit)
    if data is None:
        err_dialog('Reports', 'Could not reach server.'); return

    summary = data.get('summary', {})
    events  = data.get('events', [])
    total   = data.get('total', 0)
    pages   = max(1, (total + limit - 1) // limit)
    from_ts = data.get('from', 0)
    to_ts   = data.get('to', 0)

    period = '{0} – {1}'.format(fmt_ts(from_ts), fmt_ts(to_ts))
    add_item(
        head('Activity Report') + dim('  ' + period + '  p{0}/{1}'.format(page + 1, pages)),
        info={'title': 'Activity Report',
              'plot': 'Period: {0}\n{1} total events'.format(period, total)})

    new_dev  = summary.get('newDevices', 0)
    scans    = summary.get('scansRun', 0)
    svc_down = summary.get('serviceDown', 0)
    add_item(
        good(str(new_dev)) + dim(' new  ') +
        c('6666FF', str(scans)) + dim(' scans  ') +
        (bad(str(svc_down)) if svc_down else good('0')) + dim(' svc down'),
        info={'title': 'Summary',
              'plot': 'New devices: {0}\nScans: {1}\nService outages: {2}\n'
                      'Port discoveries: {3}\nOnline events: {4}\nOffline events: {5}'.format(
                          new_dev, scans, svc_down,
                          summary.get('portFinds', 0),
                          summary.get('onlineEvents', 0),
                          summary.get('offlineEvents', 0))})

    if not events:
        sep(); add_item(dim('No events in this period')); end_dir(); return

    sep('Events')
    for e in events:
        event    = e.get('event', '')
        ts       = fmt_ts_long(e.get('ts'))
        ip       = e.get('ip') or ''
        hostname = e.get('hostname') or ''
        payload  = e.get('payload') or {}
        color    = REPORT_EVENT_COLOR.get(event, '777777')

        identity = hostname or ip
        if hostname and ip and hostname != ip:
            identity = '{0} ({1})'.format(hostname, ip)

        parts = []
        if payload.get('port'):                       parts.append('port {0}'.format(payload['port']))
        if payload.get('name'):                       parts.append(payload['name'])
        if payload.get('devices_found') is not None: parts.append('{0} devices'.format(payload['devices_found']))
        if payload.get('up') is not None:             parts.append('{0} up/{1} down'.format(payload['up'], payload.get('down', 0)))
        if payload.get('error'):                      parts.append(payload['error'][:40])
        detail = ' / '.join(str(p) for p in parts)

        row = dim(ts[:16]) + '  ' + c(color, event)
        if identity: row += '  ' + head(identity)
        if detail:   row += '  ' + dim(detail)

        plot = 'Event: {0}\nTime: {1}'.format(event, ts)
        if ip:       plot += '\nIP: ' + ip
        if e.get('mac'):      plot += '\nMAC: ' + e['mac']
        if hostname: plot += '\nHostname: ' + hostname
        if payload:  plot += '\n\n' + json.dumps(payload, indent=2)[:400]

        add_item(row, info={'title': event, 'plot': plot})

    sep()
    if page > 0:
        add_item(info_c('< Previous page'),
                 url(action='reports', page=page - 1), is_folder=True,
                 info={'title': 'Previous', 'plot': 'Page {0}'.format(page)})
    if page < pages - 1:
        add_item(info_c('Next page >'),
                 url(action='reports', page=page + 1), is_folder=True,
                 info={'title': 'Next', 'plot': 'Page {0}'.format(page + 2)})
    end_dir()


# -- DDNS ----------------------------------------------------------------------

def show_ddns():
    api     = get_api()
    if api is None: return
    status  = api.get_ddns_status()
    history = api.get_ddns_history(limit=int(ADDON.getSetting('ddns_history_limit') or 15))
    if status is None:
        err_dialog('DDNS', 'Could not reach server.'); return

    enabled  = status.get('enabled', False)
    provider = status.get('provider', 'Unknown')
    hostname = status.get('hostname', '--')
    last_ip  = status.get('last_ip', '--')
    updated  = fmt_ts(status.get('last_updated'))
    checked  = fmt_ts(status.get('last_check'))
    last_err = status.get('last_error')

    if not enabled:   stat_str = dim('disabled')
    elif last_err:    stat_str = bad('ERROR')
    else:             stat_str = good('OK')

    add_item(
        head('DDNS') + '  ' + stat_str + dim('  ' + hostname),
        info={'title': 'DDNS',
              'plot': 'Provider: {0}\nHostname: {1}\nIP: {2}\nLast update: {3}\nLast check: {4}{5}'.format(
                  provider, hostname, last_ip, updated, checked,
                  '\nError: ' + last_err if last_err else '')})

    sep('Status')
    rows = [('Provider', provider), ('Hostname', hostname), ('Current IP', last_ip),
            ('Last update', updated), ('Last check', checked)]
    if last_err: rows.append(('Error', bad(last_err[:80])))
    for k, v in rows:
        add_item(dim('{0:<14}'.format(k + ':')) + '  ' + head(str(v)),
                 info={'title': k, 'plot': '{0}: {1}'.format(k, v)})

    if history:
        sep('History ({0})'.format(len(history)))
        for h in history:
            ts    = fmt_ts(h.get('ts'))
            event = h.get('event', '')
            ip    = h.get('ip', '')
            ok_h  = h.get('ok', True)
            row   = dim(ts) + '  ' + (good(event) if ok_h else bad(event))
            if ip: row += dim('  ' + ip)
            add_item(row, info={'title': event,
                                'plot': 'Event: {0}\nIP: {1}\nTime: {2}\nStatus: {3}'.format(
                                    event, ip, ts, 'OK' if ok_h else 'FAILED')})

    sep()
    add_item(info_c('>') + '  ' + muted('Force DDNS Update Now'),
             url(action='force_ddns_update'),
             info={'title': 'Force Update', 'plot': 'Force an immediate DDNS IP check and update.'})
    end_dir()


# -- Actions -------------------------------------------------------------------

def trigger_scan():
    api  = get_api()
    if api is None: return
    if not xbmcgui.Dialog().yesno('Claudette', 'Start a network scan now?'):
        return
    resp = api.trigger_scan()
    if resp and resp.get('started'):
        notify('Network scan started')
    else:
        err_dialog('Scan', 'Could not start scan.')
    xbmc.executebuiltin('Container.Refresh')


def trigger_deep_scan():
    api  = get_api()
    if api is None: return
    if not xbmcgui.Dialog().yesno('Claudette',
                                   'Start a deep port scan of all online devices?\n'
                                   'This runs nmap on every device and takes several minutes.'):
        return
    resp = api.trigger_deep_scan()
    if resp and resp.get('started'):
        notify('Deep scan started — check back in a few minutes', 4000)
    else:
        err_dialog('Deep Scan', 'Could not start deep scan.')
    xbmc.executebuiltin('Container.Refresh')


def refresh_services_action():
    api  = get_api()
    if api is None: return
    resp = api.refresh_services()
    if resp is not None:
        notify('Service checks refreshed')
    else:
        err_dialog('Services', 'Could not refresh services.')
    xbmc.executebuiltin('Container.Refresh')


def refresh_threats_action():
    api  = get_api()
    if api is None: return
    resp = api.refresh_threats()
    if resp is not None:
        notify('Threat feed refresh triggered')
    else:
        err_dialog('Threats', 'Could not refresh threats.')
    xbmc.executebuiltin('Container.Refresh')


def run_internet_check():
    api  = get_api()
    if api is None: return
    resp = api.run_internet_check()
    if resp is not None:
        notify('Connectivity check started')
    else:
        err_dialog('Internet', 'Could not run check.')
    xbmc.executebuiltin('Container.Refresh')


def run_speedtest_action():
    api  = get_api()
    if api is None: return
    if not xbmcgui.Dialog().yesno('Claudette',
                                   'Run a speed test now?\nThis will take about 30 seconds.'):
        return
    resp = api.run_speedtest()
    if resp is not None:
        notify('Speed test started — check back in ~30s', 4000)
    else:
        err_dialog('Speed Test', 'Could not start speed test.')
    xbmc.executebuiltin('Container.Refresh')


def force_ddns_update():
    api  = get_api()
    if api is None: return
    resp = api.force_ddns_update()
    if resp is not None:
        notify('DDNS update triggered')
    else:
        err_dialog('DDNS', 'Could not trigger update.')
    xbmc.executebuiltin('Container.Refresh')


def open_settings():
    ADDON.openSettings()
    xbmc.executebuiltin('Container.Update({0},replace)'.format(ADDON_URL))


# -- Router --------------------------------------------------------------------

ROUTES = {
    'devices':                  show_devices,
    'device_detail':            show_device_detail,
    'services':                 show_services,
    'threats':                  show_threats,
    'threat_group':             show_threat_group,
    'internet':                 show_internet,
    'internet_outages':         show_internet_outages,
    'speedtest':                show_speedtest,
    'system':                   show_system,
    'audit':                    show_audit,
    'reports':                  show_reports,
    'ddns':                     show_ddns,
    'trigger_scan':             trigger_scan,
    'trigger_deep_scan':        trigger_deep_scan,
    'refresh_services_action':  refresh_services_action,
    'refresh_threats_action':   refresh_threats_action,
    'run_internet_check':       run_internet_check,
    'run_speedtest':            run_speedtest_action,
    'force_ddns_update':        force_ddns_update,
    'open_settings':            open_settings,
}

action = ADDON_ARGS.get('action')
if action and action in ROUTES:
    ROUTES[action]()
else:
    main_menu()