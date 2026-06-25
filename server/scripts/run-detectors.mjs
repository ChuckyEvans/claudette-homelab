import detectors from '../lib/detectors.js'

async function runAll() {
  const results = {}
  // larger sweep for one-off run
  const BIG = 1000
  if (detectors.persistIpClashes) results.ip_clashes = await detectors.persistIpClashes(BIG)
  if (detectors.persistMacIpChurn) results.mac_ip_churn = await detectors.persistMacIpChurn(BIG)
  if (detectors.persistPortScans) results.port_scans = await detectors.persistPortScans(BIG)
  if (detectors.persistBeacons) results.beacons = await detectors.persistBeacons(BIG)
  if (detectors.persistAuthFailures) results.auth_failures = await detectors.persistAuthFailures(BIG)
  if (detectors.persistThreatMatches) results.threat_matches = await detectors.persistThreatMatches(BIG)
  console.log('detectors persisted', Object.fromEntries(Object.entries(results).map(([k,v])=>[k, Array.isArray(v)?v.length:0])))
}

runAll().catch(e=>{console.error('detector run failed', e && e.message); process.exit(1)})
