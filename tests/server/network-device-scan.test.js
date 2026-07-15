import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { EventEmitter } from 'node:events'

const { spawnMock, scanPortsMock, upsertDeviceMock, getAllDevicesMock, setDeviceFlagMock } = vi.hoisted(() => {
  const createProc = (stdoutText = '', stderrText = '', exitCode = 0) => {
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    setImmediate(() => {
      if (stdoutText) proc.stdout.emit('data', stdoutText)
      if (stderrText) proc.stderr.emit('data', stderrText)
      proc.emit('close', exitCode)
    })
    return proc
  }
  return {
    spawnMock: vi.fn((bin, args = []) => {
      const argString = Array.isArray(args) ? args.join(' ') : String(args)
      if (argString.includes('nbstat.nse') && argString.includes('192.168.1.50')) {
        return createProc(
          'Nmap scan report for 192.168.1.50\nHost is up (0.0010s latency).\nHost script results:\n| nbstat:\n| NetBIOS name: KITCHEN-TV\n',
        )
      }
      if (argString.includes('nbstat.nse') && argString.includes('192.168.1.51')) {
        return createProc('Nmap scan report for 192.168.1.51\nHost is up (0.0010s latency).\n')
      }
      return createProc('', '', 0)
    }),
    scanPortsMock: vi.fn(),
    upsertDeviceMock: vi.fn(),
    getAllDevicesMock: vi.fn(),
    setDeviceFlagMock: vi.fn(),
  }
})

vi.mock('child_process', () => ({
  spawn: spawnMock,
  exec: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
}))

vi.mock('../../server/config.js', () => ({
  loadConfig: vi.fn(() => ({ network: { subnets: ['192.168.1.0/24'] } })),
}))

vi.mock('../../server/utils/ddns.js', () => ({
  scanPorts: scanPortsMock,
}))

vi.mock('../../server/db.js', () => ({
  audit: vi.fn(),
  auditDevice: vi.fn(),
  upsertDevice: upsertDeviceMock,
  markOffline: vi.fn(() => []),
  getAllDevices: getAllDevicesMock,
  getAllFlags: vi.fn(() => []),
  createFlag: vi.fn(),
  updateFlag: vi.fn(),
  deleteFlag: vi.fn(),
  clearAllDevices: vi.fn(),
  clearPhantomDevices: vi.fn(),
  clearDevicePorts: vi.fn(),
  setDeviceLabel: vi.fn(),
  setDeviceFlag: setDeviceFlagMock,
  toggleDeviceFlag: vi.fn(),
  toggleFavorite: vi.fn(),
  toggleFlagged: vi.fn(),
  toggleDormant: vi.fn(),
  autoDormantStale: vi.fn(() => 0),
}))

import networkRouter, { runScheduledDeepScan } from '../../server/routes/network.js'

const app = express()
app.use(express.json())
app.use('/api/network', networkRouter)

beforeEach(() => {
  getAllDevicesMock.mockReturnValue([
    { ip: '192.168.1.50', mac: 'AA:BB:CC:DD:EE:FF', status: 'offline' },
  ])
  scanPortsMock.mockResolvedValue({
    ts: 1234567890,
    ip: '192.168.1.50',
    results: [
      { port: 22, protocol: 'tcp', open: true, service: 'SSH' },
      { port: 53, protocol: 'udp', open: false, service: 'DNS' },
      { port: 80, protocol: 'tcp', open: false, service: 'HTTP' },
      { port: 5900, protocol: 'tcp', open: true, service: 'VNC' },
    ],
  })
  scanPortsMock.mockClear()
  upsertDeviceMock.mockReset()
  setDeviceFlagMock.mockReset()
})

describe('network device port scan', () => {
  it('uses the protocol-aware probe helper and persists ports on the real device row', async () => {
    const res = await request(app).get('/api/network/device/192.168.1.50')

    expect(res.status).toBe(200)
    expect(scanPortsMock).toHaveBeenCalled()
    expect(upsertDeviceMock).toHaveBeenCalledWith(expect.objectContaining({
      ip: '192.168.1.50',
      mac: 'AA:BB:CC:DD:EE:FF',
      overwritePorts: true,
      status: 'offline',
      ports: expect.arrayContaining([
        expect.objectContaining({ port: 22, protocol: 'tcp', state: 'open' }),
        expect.objectContaining({ port: 5900, protocol: 'tcp', state: 'open' }),
      ]),
    }))
    expect(res.body.ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ port: 22, protocol: 'tcp', state: 'open' }),
      expect.objectContaining({ port: 5900, protocol: 'tcp', state: 'open' }),
    ]))
    expect(setDeviceFlagMock).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', 'icmp_blocked', false)
    expect(setDeviceFlagMock).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', 'dodgy', false)
  })

  it('marks a device filtered only when udp evidence is present', async () => {
    getAllDevicesMock.mockReturnValue([
      { ip: '192.168.1.51', mac: 'AA:BB:CC:DD:EE:11', status: 'offline' },
    ])
    scanPortsMock.mockResolvedValue({
      ts: 1234567892,
      ip: '192.168.1.51',
      results: [
        { port: 53, protocol: 'udp', open: true, service: 'DNS' },
        { port: 22, protocol: 'tcp', open: false, service: 'SSH' },
      ],
    })

    const res = await request(app).get('/api/network/device/192.168.1.51')

    expect(res.status).toBe(200)
    expect(upsertDeviceMock).toHaveBeenCalledWith(expect.objectContaining({
      ip: '192.168.1.51',
      status: 'filtered',
      ports: expect.arrayContaining([
        expect.objectContaining({ port: 53, protocol: 'udp', state: 'open' }),
      ]),
    }))
    expect(setDeviceFlagMock).toHaveBeenCalledWith('AA:BB:CC:DD:EE:11', 'icmp_blocked', true)
    expect(setDeviceFlagMock).toHaveBeenCalledWith('AA:BB:CC:DD:EE:11', 'dodgy', true)
  })

  it('keeps the device offline when tcp ports answer but udp evidence is missing', async () => {
    getAllDevicesMock.mockReturnValue([
      { ip: '192.168.1.51', mac: 'AA:BB:CC:DD:EE:11', status: 'offline' },
    ])
    scanPortsMock.mockResolvedValue({
      ts: 1234567892,
      ip: '192.168.1.51',
      results: [
        { port: 22, protocol: 'tcp', open: true, service: 'SSH' },
        { port: 53, protocol: 'udp', open: false, service: 'DNS' },
        { port: 80, protocol: 'tcp', open: false, service: 'HTTP' },
      ],
    })

    const res = await request(app).get('/api/network/device/192.168.1.51')

    expect(res.status).toBe(200)
    expect(upsertDeviceMock).toHaveBeenCalledWith(expect.objectContaining({
      ip: '192.168.1.51',
      status: 'offline',
    }))
    expect(setDeviceFlagMock).toHaveBeenCalledWith('AA:BB:CC:DD:EE:11', 'icmp_blocked', false)
    expect(setDeviceFlagMock).toHaveBeenCalledWith('AA:BB:CC:DD:EE:11', 'dodgy', false)
  })

  it('deep scan reuses the TCP probe path for known devices', async () => {
    const broadcast = vi.fn()

    await runScheduledDeepScan(broadcast)

    expect(scanPortsMock).toHaveBeenCalledTimes(1)
    expect(scanPortsMock).toHaveBeenCalledWith('192.168.1.50', expect.any(Array))
    expect(upsertDeviceMock).toHaveBeenCalledWith(expect.objectContaining({
      ip: '192.168.1.50',
      overwritePorts: true,
    }))
    expect(setDeviceFlagMock).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', 'icmp_blocked', false)
    expect(setDeviceFlagMock).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', 'dodgy', false)
    expect(broadcast.mock.calls[0]).toEqual(['deep_scan_started', expect.objectContaining({ phase: 'portscan', total: 1 })])
    expect(broadcast.mock.calls.some(call => call[0] === 'deep_scan_complete')).toBe(true)
  })

  it('does not set the icmp_blocked flag when a device is just offline with no open ports', async () => {
    getAllDevicesMock.mockReturnValue([
      { ip: '192.168.1.51', mac: 'AA:BB:CC:DD:EE:11', status: 'offline' },
    ])
    scanPortsMock.mockResolvedValue({
      ts: 1234567891,
      ip: '192.168.1.51',
      results: [
        { port: 22, open: false, service: 'SSH' },
        { port: 80, open: false, service: 'HTTP' },
      ],
    })

    const res = await request(app).get('/api/network/device/192.168.1.51')

    expect(res.status).toBe(200)
    expect(setDeviceFlagMock).toHaveBeenCalledWith('AA:BB:CC:DD:EE:11', 'icmp_blocked', false)
    expect(setDeviceFlagMock).toHaveBeenCalledWith('AA:BB:CC:DD:EE:11', 'dodgy', false)
  })
})