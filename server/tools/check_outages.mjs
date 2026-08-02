#!/usr/bin/env node

async function main(){
  try{
    const res = await fetch('http://localhost:7654/api/reports/debug/outages')
    const j = await res.json()
    const outages = j.outages || []
    const total = j.totalOutages ?? j.total ?? outages.length
    const sample = outages.slice(0,5)
    console.log(JSON.stringify({ total, sample }))
  } catch(e){
    console.error(JSON.stringify({ error: String(e) }))
    process.exit(2)
  }
}
main()
