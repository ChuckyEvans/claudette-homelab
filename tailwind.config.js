export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ── App surface hierarchy ────────────────────────────────────────────
        surface: {
          DEFAULT: '#0f0f20',   // cards, sidebars, panels
          deep:    '#080812',   // page background layer
          input:   '#0a0a18',   // text inputs, code areas
          card:    '#0d0d1a',   // raised card backgrounds
        },
        // ── App border hierarchy ─────────────────────────────────────────────
        border: {
          DEFAULT: '#1a1a30',   // standard dividers and outlines
          sub:     '#2a2a45',   // subtle inset borders
          focus:   '#6366f1',   // indigo-500 — focused inputs
        },
      }
    }
  },
  plugins: []
}
