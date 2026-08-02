(async ()=>{
  try {
    const m = await import('/app/server/routes/services.js')
    await m.checkConnectivity(null)
    console.log('checkConnectivity finished')
    process.exit(0)
  } catch (e) {
    console.error('checkConnectivity error', e && e.message)
    process.exit(2)
  }
})()
