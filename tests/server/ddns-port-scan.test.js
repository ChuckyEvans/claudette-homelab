import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import net from 'node:net'

const execFileMock = vi.hoisted(() => vi.fn((bin, args, cb) => {
  cb(null, {
    stdout: [
      'Nmap scan report for 192.168.1.1',
      '53/udp open domain',
      '161/udp open snmp',
    ].join('\n'),
    stderr: '',
  })
}))

const createSocket = (open) => {
  const socket = new EventEmitter()
  socket.setTimeout = vi.fn()
  socket.destroy = vi.fn()
  setImmediate(() => {
    if (open) socket.emit('connect')
    else socket.emit('error', new Error('connect refused'))
  })
  return socket
}

const createConnectionMock = vi.hoisted(() => vi.fn((opts) => createSocket(opts.port === 22)))

vi.mock('child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('../../server/db.js', () => ({
  getDataDir: vi.fn(() => 'C:\\Temp'),
}))

import { scanPorts } from '../../server/utils/ddns.js'

beforeEach(() => {
  vi.restoreAllMocks()
  execFileMock.mockClear()
  createConnectionMock.mockClear()
  vi.spyOn(net, 'createConnection').mockImplementation(createConnectionMock)
})

describe('DDNS port scans', () => {
  it('returns protocol-aware tcp and udp results', async () => {
    const scan = await scanPorts('192.168.1.1', [22, 53, { port: 161, protocol: 'udp' }])

    expect(createConnectionMock).toHaveBeenCalledWith(expect.objectContaining({ host: '192.168.1.1', port: 22 }))
    expect(execFileMock).toHaveBeenCalled()
    expect(scan.results).toEqual([
      expect.objectContaining({ port: 22, protocol: 'tcp', open: true }),
      expect.objectContaining({ port: 53, protocol: 'udp', open: true, service: 'domain' }),
      expect.objectContaining({ port: 161, protocol: 'udp', open: true, service: 'snmp' }),
    ])
  })
})