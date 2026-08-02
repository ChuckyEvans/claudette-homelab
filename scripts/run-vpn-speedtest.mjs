import { runVpnSpeedTest } from '../server/utils/speedtest.js'

async function main(){
  try {
    const r = await runVpnSpeedTest(null)
    console.log('vpn speedtest result:', r)
  } catch (e) {
    console.error('vpn speedtest failed:', e.message)
    process.exit(2)
  }
}

main()
