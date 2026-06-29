import React from 'react'
import { render } from '@testing-library/react'
import ThreatsPanel from '../../src/components/ThreatsPanel.jsx'
import { describe, test, expect, vi } from 'vitest'

describe('ThreatsPanel', () => {
  test('renders without key warnings for duplicate MACs', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const devices = [
      { mac: 'AA:BB:CC', ip: '192.168.1.2', ports: [] },
      { mac: 'AA:BB:CC', ip: '192.168.1.3', ports: [] },
    ]
    render(<ThreatsPanel networkScan={{ devices }} />)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
