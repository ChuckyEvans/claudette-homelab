import React from 'react'

export default function Toast({ children }) {
  return (
    <div className="fixed top-4 right-4 bg-slate-800 text-white px-4 py-2 rounded shadow">{children}</div>
  )
}
