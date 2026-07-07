import { useState, useEffect, useRef } from 'react'
import { Save, Plus, Trash2, Edit2, Check, X, RefreshCw, Wand2, Play, Loader2, Network, Download, Upload, ExternalLink, Lock } from 'lucide-react'
import { api } from '../lib/api.js'
import { THEMES, ACCENT_PRESETS, applyTheme, applyBgDim, applyAccent, loadTheme, saveTheme, readBgDim, saveBgDim, loadAccent, saveAccent } from '../lib/themes.js'

// ── Job definitions ───────────────────────────────────────────────────────────
const JOBS = {
  services: {
    label: 'Service Check',
    desc:  'Pings all monitored services and records their HTTP/Docker status.',
    eta:   '~10s',
    trigger: () => api.services.run(),
  },
  internet: {
    label: 'Internet Check',
    desc:  'Checks connectivity to configured hosts (e.g. 1.1.1.1) to verify your connection.',
    eta:   '~5s',
    trigger: () => api.services.runInternet(),
  },
  ping: {
    label: 'Ping Sweep',
    desc:  'Scans the local subnet for active devices using ICMP ping.',
    eta:   '~30–60s',
    trigger: () => api.network.scan(),
  },
  threats: {
    label: 'Threat Refresh',
    desc:  'Fetches the latest CVEs and security advisories from configured RSS feeds.',
    eta:   '~15–30s',
    trigger: () => api.threats.run(),
  },
  speedtest: {
    label: 'Speed Test',
    desc:  'Measures your download/upload speed and ping via Cloudflare infrastructure.',
    eta:   '~35s',
    trigger: () => {
      const sid = window.__claudette_override_speedtest_server ?? null
      try { delete window.__claudette_override_speedtest_server } catch (e) {}
      return api.reports.runSpeedtest({ server_id: sid })
    },
  },
}

// ── Schedule preset options ──────────────────────────────────────────────────
const MIN_OPTS = [
  { value: 1,  label: 'Every minute' },
  { value: 2,  label: 'Every 2 min' },
  { value: 5,  label: 'Every 5 min' },
  { value: 10, label: 'Every 10 min' },
  { value: 15, label: 'Every 15 min' },
  { value: 30, label: 'Every 30 min' },
  { value: 60, label: 'Every hour (on the dot)' },
]
const HR_OPTS = [
  { value: 1,  label: 'Every hour (on the dot)' },
  { value: 2,  label: 'Every 2 hours' },
  { value: 3,  label: 'Every 3 hours' },
  { value: 4,  label: 'Every 4 hours' },
  { value: 6,  label: 'Every 6 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Once a day' },
]
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
  if (h === 0)  return { value: 0,  label: '12:00 AM (midnight)' }
  if (h < 12)   return { value: h,  label: `${h}:00 AM` }
  if (h === 12) return { value: 12, label: '12:00 PM (noon)' }
  return { value: h, label: `${h - 12}:00 PM` }
})

// ── Toast container ───────────────────────────────────────────────────────────
function ToastContainer({ toasts }) {
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium backdrop-blur-sm ${
          t.type === 'success' ? 'bg-emerald-950/95 border-emerald-500/30 text-emerald-300'
          : t.type === 'error' ? 'bg-red-950/95 border-red-500/30 text-red-300'
          : 'bg-[#0f0f22]/95 border-[#2a2a45] text-slate-300'
        }`}>
          {t.type === 'success' && <Check className="w-4 h-4 flex-shrink-0" />}
          {t.type === 'error'   && <X className="w-4 h-4 flex-shrink-0" />}
          {t.type === 'info'    && <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />}
          {t.message}
        </div>
      ))}
    </div>
  )
}

// ── Run Job Dialog ────────────────────────────────────────────────────────────
function RunJobDialog({ jobId, onClose, onBackground }) {
  const job = JOBS[jobId]
  const [status, setStatus] = useState('running')
  const [msg, setMsg] = useState('')
  const doneRef = useRef(false)
  useEffect(() => {
    // Track if the job is done
    if (!job) return
    job.trigger().catch(err => {
      setStatus('error')
      setMsg(err.message)
    })
    const es = new EventSource('/api/events')
    es.addEventListener('job_done', e => {
      const data = JSON.parse(e.data)
      if (data.job === jobId && !doneRef.current) {
        doneRef.current = true
        setStatus('done')
        setMsg(`${job.label} completed.`)
        es.close()
      }
    })
    es.onerror = () => {}
    return () => es.close()
  }, [jobId, job])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0d0d1e] border border-[#1a1a30] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Play className="w-4 h-4 text-indigo-400" />
              <h2 className="text-base font-semibold text-white">{job?.label}</h2>
              <span className="text-[10px] bg-[#1a1a30] text-slate-400 rounded px-1.5 py-0.5 font-mono">{job?.eta}</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{job?.desc}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-[#1a1a30] rounded-full overflow-hidden mb-4">
          {status === 'running' && <div className="h-full w-1/3 bg-indigo-500 rounded-full animate-indeterminate" />}
          {status === 'done'    && <div className="h-full w-full bg-emerald-500 rounded-full transition-all duration-500" />}
          {status === 'error'   && <div className="h-full w-full bg-red-500 rounded-full" />}
        </div>

        {/* Status line */}
        <p className={`text-xs mb-5 flex items-center gap-1.5 ${status === 'done' ? 'text-emerald-400' : status === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
          {status === 'running' && <><Loader2 className="w-3 h-3 animate-spin" />Running…</>}
          {status === 'done'    && <><Check className="w-3 h-3" />{msg}</>}
          {status === 'error'   && msg}
        </p>

        <div className="flex items-center gap-2 justify-end">
          {status === 'running' && (
            <button onClick={() => onBackground(jobId)}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-[#1a1a30] hover:border-[#2a2a45] rounded-lg transition-colors">
              Run in background
            </button>
          )}
          <button onClick={onClose} disabled={status === 'running'}
            className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${
              status === 'done'  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-600/30'
              : status === 'error' ? 'bg-red-600/20 text-red-400 border border-red-500/25 hover:bg-red-600/30'
              : 'bg-[#1a1a30] text-slate-500 cursor-not-allowed'
            }`}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Unsaved-changes confirmation dialog ───────────────────────────────────────
function UnsavedChangesDialog({ saving, onSave, onDiscard, onCancel }) {
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0d0d1e] border border-[#1a1a30] rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-base font-semibold text-white mb-1.5">Unsaved Changes</h2>
        <p className="text-sm text-slate-400 mb-6">You have unsaved changes. Would you like to save them before continuing?</p>
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onCancel}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-[#1a1a30] hover:border-[#2a2a45] rounded-lg transition-colors">
            Keep editing
          </button>
          <button onClick={onDiscard}
            className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/25 hover:border-red-500/50 rounded-lg transition-colors">
            Discard
          </button>
          <button onClick={onSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
            {saving && <RefreshCw className="w-3 h-3 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function Field({ label, hint, ...props }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-400">{label}</label>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      <input {...props} className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors" />
    </div>
  )
}

function SectionHeading({ children }) {
  return <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4 pt-2">{children}</h2>
}

// ── Emoji picker ─────────────────────────────────────────────────────────────
const EMOJI_CATEGORIES = [
  { label: 'Smileys', emojis: [
    {e:'😀',n:'Grinning'},{e:'😁',n:'Beaming'},{e:'😂',n:'Joy'},{e:'🤣',n:'ROFL'},{e:'😃',n:'Big smile'},
    {e:'😄',n:'Smile'},{e:'😅',n:'Sweat smile'},{e:'😆',n:'Laughing'},{e:'😉',n:'Winking'},{e:'😊',n:'Blush'},
    {e:'😋',n:'Yum'},{e:'😎',n:'Cool'},{e:'😍',n:'Heart eyes'},{e:'🥰',n:'Smiling hearts'},{e:'😘',n:'Kiss'},
    {e:'🤩',n:'Star struck'},{e:'😏',n:'Smirk'},{e:'😒',n:'Unamused'},{e:'😞',n:'Disappointed'},{e:'😔',n:'Pensive'},
    {e:'😟',n:'Worried'},{e:'😕',n:'Confused'},{e:'🙁',n:'Slight frown'},{e:'😣',n:'Persevering'},{e:'😫',n:'Tired'},
    {e:'😩',n:'Weary'},{e:'🥺',n:'Pleading'},{e:'😢',n:'Crying'},{e:'😭',n:'Loudly crying'},{e:'😤',n:'Huffing'},
    {e:'😠',n:'Angry'},{e:'😡',n:'Pouting'},{e:'🤬',n:'Cursing'},{e:'🤯',n:'Mind blown'},{e:'😳',n:'Flushed'},
    {e:'🥵',n:'Hot'},{e:'🥶',n:'Cold'},{e:'😱',n:'Screaming'},{e:'😨',n:'Fearful'},{e:'😰',n:'Anxious'},
    {e:'🤔',n:'Thinking'},{e:'🤭',n:'Oops'},{e:'🤫',n:'Shushing'},{e:'🤥',n:'Lying'},{e:'😶',n:'No mouth'},
    {e:'😐',n:'Neutral'},{e:'😑',n:'Expressionless'},{e:'😬',n:'Grimacing'},{e:'🙄',n:'Eye roll'},{e:'😯',n:'Hushed'},
    {e:'😮',n:'Open mouth'},{e:'😲',n:'Astonished'},{e:'🥱',n:'Yawning'},{e:'😴',n:'Sleeping'},{e:'🤤',n:'Drooling'},
    {e:'😵',n:'Dizzy'},{e:'🤐',n:'Zipper mouth'},{e:'🥴',n:'Woozy'},{e:'🤢',n:'Nauseated'},{e:'🤧',n:'Sneezing'},
    {e:'🥳',n:'Partying'},{e:'🥸',n:'Disguised'},{e:'🤓',n:'Nerd'},{e:'🧐',n:'Monocle'},{e:'😈',n:'Devil smile'},
    {e:'👿',n:'Devil angry'},{e:'👹',n:'Ogre'},{e:'👺',n:'Goblin'},{e:'💀',n:'Skull'},{e:'☠️',n:'Skull crossbones'},
    {e:'👻',n:'Ghost'},{e:'👽',n:'Alien'},{e:'🤖',n:'Robot'},{e:'🤡',n:'Clown'},{e:'💩',n:'Poo'},
    {e:'🫠',n:'Melting'},{e:'🤒',n:'Thermometer face'},{e:'🤕',n:'Head bandage'},{e:'🤑',n:'Money mouth'},{e:'😇',n:'Halo'},
  ]},
  { label: 'People', emojis: [
    {e:'👋',n:'Wave'},{e:'🤚',n:'Raised back hand'},{e:'✋',n:'Raised hand'},{e:'🖐️',n:'Hand splayed'},{e:'👌',n:'OK hand'},
    {e:'🤏',n:'Pinching'},{e:'✌️',n:'Victory'},{e:'🤞',n:'Crossed fingers'},{e:'🤟',n:'Love you'},{e:'🤘',n:'Rock on'},
    {e:'🤙',n:'Call me'},{e:'👈',n:'Point left'},{e:'👉',n:'Point right'},{e:'👆',n:'Point up'},{e:'☝️',n:'Index up'},
    {e:'👇',n:'Point down'},{e:'👍',n:'Thumbs up'},{e:'👎',n:'Thumbs down'},{e:'✊',n:'Raised fist'},{e:'👊',n:'Oncoming fist'},
    {e:'🤛',n:'Left fist'},{e:'🤜',n:'Right fist'},{e:'👏',n:'Clapping'},{e:'🙌',n:'Raising hands'},{e:'👐',n:'Open hands'},
    {e:'🤲',n:'Palms up'},{e:'🤝',n:'Handshake'},{e:'🙏',n:'Folded hands'},{e:'✍️',n:'Writing hand'},{e:'💅',n:'Nail polish'},
    {e:'💪',n:'Flexed bicep'},{e:'🦾',n:'Mechanical arm'},{e:'🦵',n:'Leg'},{e:'🦶',n:'Foot'},{e:'👂',n:'Ear'},
    {e:'👃',n:'Nose'},{e:'👀',n:'Eyes'},{e:'👁️',n:'Eye'},{e:'👅',n:'Tongue'},{e:'👄',n:'Mouth'},
    {e:'🧠',n:'Brain'},{e:'🦷',n:'Tooth'},{e:'🦴',n:'Bone'},{e:'👶',n:'Baby'},{e:'🧒',n:'Child'},
    {e:'👦',n:'Boy'},{e:'👧',n:'Girl'},{e:'🧑',n:'Person'},{e:'👨',n:'Man'},{e:'👩',n:'Woman'},
    {e:'🧔',n:'Bearded person'},{e:'👴',n:'Old man'},{e:'👵',n:'Old woman'},{e:'🧓',n:'Older person'},{e:'🤦',n:'Facepalm'},
    {e:'🤷',n:'Shrug'},{e:'🧑‍💻',n:'Technologist'},{e:'👮',n:'Police'},{e:'🕵️',n:'Detective'},{e:'💂',n:'Guard'},
    {e:'🥷',n:'Ninja'},{e:'👷',n:'Construction worker'},{e:'🫡',n:'Saluting'},{e:'🧑‍🔧',n:'Mechanic'},{e:'🧑‍🚒',n:'Firefighter'},
  ]},
  { label: 'Animals', emojis: [
    {e:'🐶',n:'Dog'},{e:'🐱',n:'Cat'},{e:'🐭',n:'Mouse'},{e:'🐹',n:'Hamster'},{e:'🐰',n:'Rabbit'},
    {e:'🦊',n:'Fox'},{e:'🐻',n:'Bear'},{e:'🐼',n:'Panda'},{e:'🐨',n:'Koala'},{e:'🐯',n:'Tiger'},
    {e:'🦁',n:'Lion'},{e:'🐮',n:'Cow'},{e:'🐷',n:'Pig'},{e:'🐸',n:'Frog'},{e:'🐵',n:'Monkey'},
    {e:'🙈',n:'See no evil'},{e:'🙉',n:'Hear no evil'},{e:'🙊',n:'Speak no evil'},{e:'🐔',n:'Chicken'},{e:'🐧',n:'Penguin'},
    {e:'🐦',n:'Bird'},{e:'🐤',n:'Chick'},{e:'🦆',n:'Duck'},{e:'🦅',n:'Eagle'},{e:'🦉',n:'Owl'},
    {e:'🦇',n:'Bat'},{e:'🐺',n:'Wolf'},{e:'🐗',n:'Boar'},{e:'🐴',n:'Horse'},{e:'🦄',n:'Unicorn'},
    {e:'🐝',n:'Bee'},{e:'🐛',n:'Bug'},{e:'🦋',n:'Butterfly'},{e:'🐌',n:'Snail'},{e:'🐞',n:'Ladybug'},
    {e:'🐜',n:'Ant'},{e:'🦟',n:'Mosquito'},{e:'🦗',n:'Cricket'},{e:'🕷️',n:'Spider'},{e:'🦂',n:'Scorpion'},
    {e:'🐢',n:'Turtle'},{e:'🐍',n:'Snake'},{e:'🦎',n:'Lizard'},{e:'🦖',n:'T-Rex'},{e:'🦕',n:'Sauropod'},
    {e:'🐙',n:'Octopus'},{e:'🦑',n:'Squid'},{e:'🦐',n:'Shrimp'},{e:'🦀',n:'Crab'},{e:'🐡',n:'Blowfish'},
    {e:'🐠',n:'Tropical fish'},{e:'🐟',n:'Fish'},{e:'🐬',n:'Dolphin'},{e:'🐳',n:'Whale'},{e:'🦈',n:'Shark'},
    {e:'🦭',n:'Seal'},{e:'🐊',n:'Crocodile'},{e:'🦓',n:'Zebra'},{e:'🦍',n:'Gorilla'},{e:'🦧',n:'Orangutan'},
    {e:'🐘',n:'Elephant'},{e:'🦏',n:'Rhino'},{e:'🦛',n:'Hippo'},{e:'🦒',n:'Giraffe'},{e:'🦘',n:'Kangaroo'},
    {e:'🐃',n:'Buffalo'},{e:'🐄',n:'Cow'},{e:'🐎',n:'Racing horse'},{e:'🐖',n:'Pig'},{e:'🐏',n:'Ram'},
    {e:'🐑',n:'Sheep'},{e:'🦙',n:'Llama'},{e:'🐐',n:'Goat'},{e:'🦌',n:'Deer'},{e:'🐕',n:'Dog'},
    {e:'🐩',n:'Poodle'},{e:'🐈',n:'Cat'},{e:'🦚',n:'Peacock'},{e:'🦜',n:'Parrot'},{e:'🦢',n:'Swan'},
    {e:'🦩',n:'Flamingo'},{e:'🕊️',n:'Dove'},{e:'🐇',n:'Rabbit'},{e:'🦝',n:'Raccoon'},{e:'🦨',n:'Skunk'},
    {e:'🦡',n:'Badger'},{e:'🦫',n:'Beaver'},{e:'🦦',n:'Otter'},{e:'🦥',n:'Sloth'},{e:'🐿️',n:'Chipmunk'},
    {e:'🦔',n:'Hedgehog'},{e:'🐾',n:'Paw prints'},{e:'🦠',n:'Microbe'},{e:'🐲',n:'Dragon'},{e:'🦄',n:'Unicorn'},
  ]},
  { label: 'Food', emojis: [
    {e:'🍎',n:'Apple'},{e:'🍊',n:'Orange'},{e:'🍋',n:'Lemon'},{e:'🍇',n:'Grapes'},{e:'🍓',n:'Strawberry'},
    {e:'🫐',n:'Blueberries'},{e:'🍉',n:'Watermelon'},{e:'🍑',n:'Peach'},{e:'🍒',n:'Cherries'},{e:'🍌',n:'Banana'},
    {e:'🍍',n:'Pineapple'},{e:'🥭',n:'Mango'},{e:'🥝',n:'Kiwi'},{e:'🍅',n:'Tomato'},{e:'🥥',n:'Coconut'},
    {e:'🥑',n:'Avocado'},{e:'🍆',n:'Eggplant'},{e:'🥔',n:'Potato'},{e:'🌽',n:'Corn'},{e:'🌶️',n:'Pepper'},
    {e:'🥦',n:'Broccoli'},{e:'🧅',n:'Onion'},{e:'🧄',n:'Garlic'},{e:'🍄',n:'Mushroom'},{e:'🥜',n:'Peanuts'},
    {e:'🌰',n:'Chestnut'},{e:'🍞',n:'Bread'},{e:'🥐',n:'Croissant'},{e:'🧀',n:'Cheese'},{e:'🥚',n:'Egg'},
    {e:'🍳',n:'Cooking'},{e:'🧇',n:'Waffle'},{e:'🥞',n:'Pancakes'},{e:'🥓',n:'Bacon'},{e:'🌭',n:'Hot dog'},
    {e:'🍔',n:'Burger'},{e:'🍟',n:'Fries'},{e:'🍕',n:'Pizza'},{e:'🌮',n:'Taco'},{e:'🌯',n:'Burrito'},
    {e:'🧆',n:'Falafel'},{e:'🍜',n:'Noodles'},{e:'🍝',n:'Spaghetti'},{e:'🍛',n:'Curry'},{e:'🍣',n:'Sushi'},
    {e:'🍱',n:'Bento'},{e:'🍩',n:'Donut'},{e:'🍪',n:'Cookie'},{e:'🎂',n:'Cake'},{e:'🍰',n:'Shortcake'},
    {e:'🧁',n:'Cupcake'},{e:'🍫',n:'Chocolate'},{e:'🍬',n:'Candy'},{e:'🍭',n:'Lollipop'},{e:'☕',n:'Coffee'},
    {e:'🍵',n:'Tea'},{e:'🧃',n:'Juice box'},{e:'🥤',n:'Cup with straw'},{e:'🧋',n:'Bubble tea'},{e:'🍺',n:'Beer'},
    {e:'🍻',n:'Cheers'},{e:'🥂',n:'Champagne'},{e:'🍷',n:'Wine'},{e:'🥃',n:'Whisky'},{e:'🍸',n:'Cocktail'},
    {e:'🍹',n:'Tropical drink'},{e:'🍾',n:'Bottle pop'},{e:'🧊',n:'Ice'},{e:'🍴',n:'Fork & knife'},{e:'🥄',n:'Spoon'},
  ]},
  { label: 'Nature', emojis: [
    {e:'🌱',n:'Seedling'},{e:'🌿',n:'Herb'},{e:'🍀',n:'Four-leaf clover'},{e:'🍁',n:'Maple leaf'},{e:'🍂',n:'Fallen leaf'},
    {e:'🍃',n:'Leaves'},{e:'🌸',n:'Cherry blossom'},{e:'🌺',n:'Hibiscus'},{e:'🌻',n:'Sunflower'},{e:'🌹',n:'Rose'},
    {e:'🌷',n:'Tulip'},{e:'🌼',n:'Blossom'},{e:'🌾',n:'Wheat'},{e:'🌵',n:'Cactus'},{e:'🌴',n:'Palm tree'},
    {e:'🌲',n:'Evergreen tree'},{e:'🌳',n:'Tree'},{e:'🎋',n:'Bamboo'},{e:'🌊',n:'Wave'},{e:'🔥',n:'Fire'},
    {e:'💧',n:'Droplet'},{e:'💦',n:'Splashing'},{e:'❄️',n:'Snowflake'},{e:'⛄',n:'Snowman'},{e:'🌈',n:'Rainbow'},
    {e:'⭐',n:'Star'},{e:'🌟',n:'Glowing star'},{e:'💫',n:'Dizzy star'},{e:'✨',n:'Sparkles'},{e:'⚡',n:'Lightning'},
    {e:'🌙',n:'Crescent moon'},{e:'☀️',n:'Sun'},{e:'🌤️',n:'Partly cloudy'},{e:'⛅',n:'Cloudy'},{e:'🌧️',n:'Rain'},
    {e:'⛈️',n:'Thunderstorm'},{e:'🌩️',n:'Lightning cloud'},{e:'🌨️',n:'Snow'},{e:'🌪️',n:'Tornado'},{e:'🌫️',n:'Fog'},
    {e:'🌬️',n:'Wind'},{e:'🌍',n:'Earth Europe'},{e:'🌎',n:'Earth Americas'},{e:'🌏',n:'Earth Asia'},{e:'🗺️',n:'Map'},
    {e:'🏔️',n:'Mountain'},{e:'🌋',n:'Volcano'},{e:'🏝️',n:'Island'},{e:'🏜️',n:'Desert'},{e:'🌅',n:'Sunrise'},
    {e:'🌄',n:'Sunrise mountains'},{e:'🌠',n:'Shooting star'},{e:'🌃',n:'Night city'},{e:'🌆',n:'City at dusk'},{e:'🌉',n:'Bridge at night'},
  ]},
  { label: 'Travel', emojis: [
    {e:'🚗',n:'Car'},{e:'🚕',n:'Taxi'},{e:'🚙',n:'SUV'},{e:'🏎️',n:'Racing car'},{e:'🚓',n:'Police car'},
    {e:'🚑',n:'Ambulance'},{e:'🚒',n:'Fire engine'},{e:'🚌',n:'Bus'},{e:'🚚',n:'Truck'},{e:'🚛',n:'Semi truck'},
    {e:'🚜',n:'Tractor'},{e:'🏍️',n:'Motorcycle'},{e:'🛵',n:'Scooter'},{e:'🚲',n:'Bicycle'},{e:'🛴',n:'Kick scooter'},
    {e:'🚁',n:'Helicopter'},{e:'✈️',n:'Airplane'},{e:'🛸',n:'UFO'},{e:'🚀',n:'Rocket'},{e:'🛶',n:'Canoe'},
    {e:'⛵',n:'Sailboat'},{e:'🚤',n:'Speedboat'},{e:'🚢',n:'Ship'},{e:'🚂',n:'Train'},{e:'🚄',n:'Bullet train'},
    {e:'🚇',n:'Metro'},{e:'🚉',n:'Station'},{e:'🚊',n:'Tram'},{e:'🚝',n:'Monorail'},{e:'🚌',n:'Bus'},
    {e:'🏠',n:'House'},{e:'🏡',n:'House garden'},{e:'🏢',n:'Office building'},{e:'🏥',n:'Hospital'},{e:'🏦',n:'Bank'},
    {e:'🏨',n:'Hotel'},{e:'🏪',n:'Convenience store'},{e:'🏫',n:'School'},{e:'🏬',n:'Department store'},{e:'🏭',n:'Factory'},
    {e:'🏰',n:'Castle'},{e:'⛺',n:'Tent'},{e:'🌉',n:'Bridge'},{e:'🗿',n:'Moai'},{e:'⛽',n:'Fuel pump'},
    {e:'🚦',n:'Traffic light'},{e:'🚧',n:'Construction'},{e:'⚓',n:'Anchor'},{e:'🛤️',n:'Railway track'},{e:'🛣️',n:'Motorway'},
  ]},
  { label: 'Activities', emojis: [
    {e:'⚽',n:'Soccer'},{e:'🏀',n:'Basketball'},{e:'🏈',n:'Football'},{e:'⚾',n:'Baseball'},{e:'🎾',n:'Tennis'},
    {e:'🏐',n:'Volleyball'},{e:'🏉',n:'Rugby'},{e:'🎱',n:'Billiards'},{e:'🏓',n:'Ping pong'},{e:'🏸',n:'Badminton'},
    {e:'🥊',n:'Boxing glove'},{e:'🥋',n:'Martial arts'},{e:'⛳',n:'Golf'},{e:'🎣',n:'Fishing'},{e:'🤿',n:'Diving mask'},
    {e:'🎿',n:'Skis'},{e:'🛷',n:'Sled'},{e:'🎯',n:'Bullseye'},{e:'🎳',n:'Bowling'},{e:'🎮',n:'Video game'},
    {e:'🕹️',n:'Joystick'},{e:'🎲',n:'Dice'},{e:'♟️',n:'Chess'},{e:'🧩',n:'Puzzle'},{e:'🎨',n:'Art palette'},
    {e:'🖼️',n:'Picture frame'},{e:'🎭',n:'Theater'},{e:'🎬',n:'Clapperboard'},{e:'🎤',n:'Microphone'},{e:'🎧',n:'Headphones'},
    {e:'🎵',n:'Music note'},{e:'🎶',n:'Musical notes'},{e:'🎷',n:'Saxophone'},{e:'🎸',n:'Guitar'},{e:'🎹',n:'Piano'},
    {e:'🎺',n:'Trumpet'},{e:'🎻',n:'Violin'},{e:'🥁',n:'Drum'},{e:'🎙️',n:'Studio mic'},{e:'🏆',n:'Trophy'},
    {e:'🥇',n:'Gold medal'},{e:'🥈',n:'Silver medal'},{e:'🥉',n:'Bronze medal'},{e:'🏅',n:'Sports medal'},{e:'🎖️',n:'Military medal'},
    {e:'🎫',n:'Ticket'},{e:'🎪',n:'Circus'},{e:'🏊',n:'Swimming'},{e:'🚴',n:'Cycling'},{e:'🧘',n:'Yoga'},
    {e:'🏋️',n:'Weightlifting'},{e:'🤸',n:'Gymnastics'},{e:'🎠',n:'Carousel'},{e:'🎡',n:'Ferris wheel'},{e:'🎢',n:'Roller coaster'},
    {e:'🎆',n:'Fireworks'},{e:'🎇',n:'Sparkler'},{e:'🧨',n:'Firecracker'},{e:'🎉',n:'Party popper'},{e:'🎊',n:'Confetti'},
    {e:'🎃',n:'Jack-o-lantern'},{e:'🎄',n:'Christmas tree'},{e:'🎁',n:'Gift'},{e:'🎀',n:'Ribbon bow'},{e:'🎗️',n:'Reminder ribbon'},
  ]},
  { label: 'Objects', emojis: [
    {e:'💻',n:'Laptop'},{e:'🖥️',n:'Desktop computer'},{e:'🖨️',n:'Printer'},{e:'⌨️',n:'Keyboard'},{e:'🖱️',n:'Mouse'},
    {e:'💾',n:'Floppy disk'},{e:'💿',n:'CD'},{e:'📀',n:'DVD'},{e:'📱',n:'Mobile phone'},{e:'☎️',n:'Telephone'},
    {e:'📞',n:'Phone receiver'},{e:'📟',n:'Pager'},{e:'📡',n:'Satellite'},{e:'🔋',n:'Battery'},{e:'🔌',n:'Plug'},
    {e:'💡',n:'Light bulb'},{e:'🔦',n:'Flashlight'},{e:'🕯️',n:'Candle'},{e:'📷',n:'Camera'},{e:'📹',n:'Video camera'},
    {e:'📺',n:'Television'},{e:'📻',n:'Radio'},{e:'🧭',n:'Compass'},{e:'🔭',n:'Telescope'},{e:'🔬',n:'Microscope'},
    {e:'🧪',n:'Test tube'},{e:'🧬',n:'DNA'},{e:'🩺',n:'Stethoscope'},{e:'💊',n:'Pill'},{e:'🩹',n:'Bandage'},
    {e:'🔑',n:'Key'},{e:'🗝️',n:'Old key'},{e:'🔒',n:'Locked'},{e:'🔓',n:'Unlocked'},{e:'🔐',n:'Locked with key'},
    {e:'🛡️',n:'Shield'},{e:'🔨',n:'Hammer'},{e:'⚒️',n:'Hammer and pick'},{e:'🛠️',n:'Hammer and wrench'},{e:'⚔️',n:'Crossed swords'},
    {e:'🪚',n:'Carpentry saw'},{e:'🔧',n:'Wrench'},{e:'🪛',n:'Screwdriver'},{e:'🔩',n:'Bolt'},{e:'⚙️',n:'Gear'},
    {e:'🧲',n:'Magnet'},{e:'🔗',n:'Link'},{e:'⛓️',n:'Chain'},{e:'🪜',n:'Ladder'},{e:'🧱',n:'Brick'},
    {e:'📦',n:'Package'},{e:'📫',n:'Mailbox'},{e:'📌',n:'Pushpin'},{e:'📎',n:'Paperclip'},{e:'📏',n:'Ruler'},
    {e:'✂️',n:'Scissors'},{e:'🗃️',n:'Card box'},{e:'🗂️',n:'File dividers'},{e:'🗑️',n:'Wastebasket'},{e:'🔍',n:'Search'},
    {e:'📝',n:'Memo'},{e:'✏️',n:'Pencil'},{e:'📖',n:'Open book'},{e:'📚',n:'Books'},{e:'📋',n:'Clipboard'},
    {e:'📊',n:'Bar chart'},{e:'📈',n:'Chart up'},{e:'📉',n:'Chart down'},{e:'📁',n:'Folder'},{e:'📂',n:'Open folder'},
    {e:'🔔',n:'Bell'},{e:'🔕',n:'Bell off'},{e:'📢',n:'Loudspeaker'},{e:'📣',n:'Megaphone'},{e:'💬',n:'Speech bubble'},
    {e:'💭',n:'Thought bubble'},{e:'🧰',n:'Toolbox'},{e:'🪤',n:'Mouse trap'},{e:'🪝',n:'Hook'},{e:'🧲',n:'Magnet'},
  ]},
  { label: 'Symbols', emojis: [
    {e:'❤️',n:'Red heart'},{e:'🧡',n:'Orange heart'},{e:'💛',n:'Yellow heart'},{e:'💚',n:'Green heart'},{e:'💙',n:'Blue heart'},
    {e:'💜',n:'Purple heart'},{e:'🖤',n:'Black heart'},{e:'🤍',n:'White heart'},{e:'🤎',n:'Brown heart'},{e:'💔',n:'Broken heart'},
    {e:'❣️',n:'Heart exclamation'},{e:'💕',n:'Two hearts'},{e:'💖',n:'Sparkling heart'},{e:'💝',n:'Gift heart'},{e:'✅',n:'Check mark'},
    {e:'❌',n:'Cross mark'},{e:'❗',n:'Exclamation'},{e:'❓',n:'Question'},{e:'⚠️',n:'Warning'},{e:'🚫',n:'Prohibited'},
    {e:'🔴',n:'Red circle'},{e:'🟠',n:'Orange circle'},{e:'🟡',n:'Yellow circle'},{e:'🟢',n:'Green circle'},{e:'🔵',n:'Blue circle'},
    {e:'🟣',n:'Purple circle'},{e:'⚫',n:'Black circle'},{e:'⚪',n:'White circle'},{e:'🟤',n:'Brown circle'},{e:'🔺',n:'Red triangle up'},
    {e:'🔻',n:'Red triangle down'},{e:'💠',n:'Diamond blue'},{e:'🔷',n:'Large blue diamond'},{e:'🔹',n:'Small blue diamond'},{e:'🔶',n:'Large orange diamond'},
    {e:'🔸',n:'Small orange diamond'},{e:'▶️',n:'Play'},{e:'⏸️',n:'Pause'},{e:'⏹️',n:'Stop'},{e:'⏺️',n:'Record'},
    {e:'🔁',n:'Repeat'},{e:'🔀',n:'Shuffle'},{e:'🔃',n:'Clockwise'},{e:'🔄',n:'Counterclockwise'},{e:'⬆️',n:'Up arrow'},
    {e:'⬇️',n:'Down arrow'},{e:'⬅️',n:'Left arrow'},{e:'➡️',n:'Right arrow'},{e:'↗️',n:'Up-right arrow'},{e:'↘️',n:'Down-right arrow'},
    {e:'↕️',n:'Up-down arrow'},{e:'↔️',n:'Left-right arrow'},{e:'♻️',n:'Recycle'},{e:'💤',n:'Zzz'},{e:'♾️',n:'Infinity'},
    {e:'💯',n:'100 points'},{e:'✔️',n:'Check'},{e:'🆗',n:'OK'},{e:'🆕',n:'New'},{e:'🆓',n:'Free'},
    {e:'🏁',n:'Chequered flag'},{e:'🚩',n:'Red flag'},{e:'🎌',n:'Crossed flags'},{e:'🏴',n:'Black flag'},{e:'🏳️',n:'White flag'},
    {e:'🏷️',n:'Label tag'},{e:'🔝',n:'Top'},{e:'🔙',n:'Back'},{e:'🔛',n:'On'},{e:'🔜',n:'Soon'},
  ]},
  { label: 'Network', emojis: [
    {e:'🌐',n:'Globe / internet'},{e:'🛜',n:'Wireless'},{e:'📶',n:'Signal bars'},{e:'🔗',n:'Link'},{e:'🔐',n:'Locked with key'},
    {e:'🛡️',n:'Shield / secure'},{e:'⚡',n:'Lightning / fast'},{e:'🚀',n:'Rocket / launch'},{e:'🐛',n:'Bug'},{e:'🕷️',n:'Spider'},
    {e:'🦠',n:'Microbe / virus'},{e:'📊',n:'Bar chart'},{e:'📈',n:'Chart up'},{e:'📉',n:'Chart down'},{e:'🗂️',n:'File dividers'},
    {e:'📋',n:'Clipboard'},{e:'🗒️',n:'Notebook'},{e:'📝',n:'Memo'},{e:'✏️',n:'Pencil'},{e:'🗃️',n:'Card box'},
    {e:'🗑️',n:'Wastebasket'},{e:'📁',n:'Folder'},{e:'📂',n:'Open folder'},{e:'🔍',n:'Search'},{e:'🔎',n:'Search right'},
    {e:'🚨',n:'Alarm / alert'},{e:'🔔',n:'Bell / notification'},{e:'🔕',n:'Bell off / muted'},{e:'📢',n:'Loudspeaker'},{e:'📣',n:'Megaphone'},
    {e:'💬',n:'Speech / message'},{e:'💭',n:'Thought bubble'},{e:'💻',n:'Laptop'},{e:'🖥️',n:'Desktop'},{e:'🖨️',n:'Printer'},
    {e:'⌨️',n:'Keyboard'},{e:'🖱️',n:'Mouse'},{e:'💾',n:'Floppy disk'},{e:'💿',n:'CD/disc'},{e:'📡',n:'Satellite dish'},
    {e:'🔋',n:'Battery'},{e:'🔌',n:'Plug / power'},{e:'⚙️',n:'Gear / settings'},{e:'🔧',n:'Wrench'},{e:'🔩',n:'Bolt'},
    {e:'🧰',n:'Toolbox'},{e:'🪛',n:'Screwdriver'},{e:'🔒',n:'Locked / private'},{e:'🔓',n:'Unlocked / open'},{e:'🔑',n:'Key / auth'},
    {e:'🏠',n:'Home / local'},{e:'🏢',n:'Office / remote'},{e:'🏭',n:'Factory / server'},{e:'📦',n:'Package'},{e:'🔴',n:'Red / offline'},
    {e:'🟢',n:'Green / online'},{e:'🟡',n:'Yellow / warning'},{e:'🔵',n:'Blue / info'},{e:'⚫',n:'Black / unknown'},{e:'🟣',n:'Purple'},
    {e:'✅',n:'OK / passing'},{e:'❌',n:'Error / failing'},{e:'⚠️',n:'Warning'},{e:'🚫',n:'Blocked'},{e:'🆕',n:'New device'},
    {e:'🧑‍💻',n:'Developer'},{e:'👮',n:'Admin / security'},{e:'🕵️',n:'Monitoring'},{e:'🗺️',n:'Network map'},{e:'🌍',n:'WAN / internet'},
  ]},
]

function EmojiPicker({ value, onChange }) {
  const [open,     setOpen]     = useState(false)
  const [search,   setSearch]   = useState('')
  const [category, setCategory] = useState(0)
  const [hovered,  setHovered]  = useState(null)
  const [pos,      setPos]      = useState({ top: 0, left: 0, openUp: false })
  const btnRef    = useRef(null)
  const pickerRef = useRef(null)
  const PICKER_H  = 340

  const openPicker = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      const openUp = spaceBelow < PICKER_H && r.top > PICKER_H
      const PICKER_W = 320
      const left = Math.min(r.left, window.innerWidth - PICKER_W - 8)
      setPos({ top: openUp ? r.top : r.bottom + 4, left, openUp })
    }
    setOpen(v => !v)
  }

  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target) &&
        btnRef.current    && !btnRef.current.contains(e.target)
      ) { setOpen(false); setHovered(null) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const q = search.trim().toLowerCase()
  const emojis = q
    ? EMOJI_CATEGORIES.flatMap(c => c.emojis).filter(item => item.n.toLowerCase().includes(q) || item.e.includes(search.trim()))
    : EMOJI_CATEGORIES[category]?.emojis ?? []

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPicker}
        title="Pick an emoji icon"
        className="w-14 h-8 flex items-center justify-center text-base bg-[#080812] border border-[#1a1a30] hover:border-indigo-500/40 rounded transition-colors"
      >
        {value || <span className="text-slate-600 text-xs">🏷️</span>}
      </button>
      {open && (
        <div
          ref={pickerRef}
          style={{
            position: 'fixed',
            top:    pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
            left:   pos.left,
            zIndex: 9999,
          }}
          className="w-80 bg-[#0e0e20] border border-[#1a1a35] rounded-xl shadow-2xl p-2 flex flex-col gap-2"
        >
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search emoji names…"
            className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none"
          />
          {!q && (
            <div className="flex flex-wrap gap-1">
              {EMOJI_CATEGORIES.map((c, i) => (
                <button key={c.label} type="button" onClick={() => { setCategory(i); setHovered(null) }}
                  className={`px-2 py-0.5 rounded text-[10px] transition-colors ${i === category ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-500 hover:text-slate-300'}`}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-8 gap-0.5 max-h-44 overflow-y-auto">
            {emojis.map(item => (
              <button key={item.e + item.n} type="button"
                onClick={() => { onChange(item.e); setOpen(false); setSearch(''); setHovered(null) }}
                onMouseEnter={() => setHovered(item)}
                onMouseLeave={() => setHovered(null)}
                className="w-8 h-8 flex items-center justify-center text-xl leading-none rounded hover:bg-indigo-500/20 transition-colors">
                {item.e}
              </button>
            ))}
            {emojis.length === 0 && <p className="col-span-8 text-[11px] text-slate-600 text-center py-3">No match</p>}
          </div>
          <div className="h-5 flex items-center gap-1.5 border-t border-[#1a1a35] pt-1">
            {hovered
              ? <><span className="text-base leading-none">{hovered.e}</span><span className="text-[11px] text-slate-400">{hovered.n}</span></>
              : <span className="text-[11px] text-slate-700">Hover to preview</span>
            }
            {value && (
              <button type="button" onClick={() => { onChange(''); setOpen(false) }}
                className="ml-auto text-[10px] text-slate-600 hover:text-slate-400 transition-colors">
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── Flag row ──────────────────────────────────────────────────────────────────
function FlagRow({ flag, onSave, onDelete }) {
  const [editing, setEditing]   = useState(flag._new ?? false)
  const [form, setForm]         = useState({
    key:         flag._new ? '' : flag.key,
    label:       flag.label ?? '',
    icon:        flag.icon  ?? '',
    description: flag.description ?? '',
    sortOrder:   flag.sort_order ?? 100,
  })
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const save  = () => { onSave(flag.key, form); setEditing(false) }
  const cancel = () => { if (flag._new) onDelete(flag.key); else setEditing(false) }
  const inputCls = 'bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/40 rounded px-2 py-1 text-xs text-slate-200 outline-none w-full'

  if (flag.isSystem) {
    return (
      <tr className="border-b border-[#0f0f1a]">
        <td className="px-3 py-2.5 text-sm text-center w-10">{flag.icon || '—'}</td>
        <td className="px-3 py-2.5 text-xs text-slate-500 font-mono">{flag.key}</td>
        <td className="px-3 py-2.5 text-xs text-slate-300">{flag.label}</td>
        <td className="px-3 py-2.5 text-xs text-slate-500 italic">{flag.description || '—'}</td>
        <td className="px-3 py-2.5 text-xs text-slate-600 text-center w-16">{flag.sort_order ?? 0}</td>
        <td className="px-3 py-2.5 w-16 text-center">
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-600 border border-[#1a1a30] rounded px-1.5 py-0.5">
            <Lock className="w-2.5 h-2.5" />system
          </span>
        </td>
      </tr>
    )
  }

  if (editing) {
    return (
      <tr className="border-b border-[#0f0f1a] bg-indigo-500/5">
        <td className="px-3 py-2">
          <EmojiPicker value={form.icon} onChange={v => setForm(p => ({ ...p, icon: v }))} />
        </td>
        <td className="px-3 py-2">
          {flag._new
            ? <input className={inputCls + ' font-mono'} value={form.key} onChange={set('key')} placeholder="my_flag" maxLength={32} pattern="[a-z0-9_-]+" title="Lowercase letters, numbers, _ and - only" />
            : <span className="text-xs text-slate-500 font-mono">{flag.key}</span>
          }
        </td>
        <td className="px-3 py-2"><input className={inputCls} value={form.label} onChange={set('label')} placeholder="Label" /></td>
        <td className="px-3 py-2"><input className={inputCls} value={form.description} onChange={set('description')} placeholder="Optional description" /></td>
        <td className="px-3 py-2 w-24">
          <input className={inputCls + ' text-center'} type="number" min={0} max={9999} value={form.sortOrder} onChange={set('sortOrder')} title="Sort rank — lower numbers appear first" />
        </td>
        <td className="px-3 py-2 w-16">
          <div className="flex items-center gap-1.5">
            <button onClick={save}   title="Save" className="p-1 text-emerald-400 hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
            <button onClick={cancel} title="Cancel" className="p-1 text-slate-600 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-[#0f0f1a] hover:bg-white/[0.02] transition-colors group">
      <td className="px-3 py-2.5 text-sm text-center w-10">{flag.icon || <span className="text-slate-700">—</span>}</td>
      <td className="px-3 py-2.5 text-xs text-slate-500 font-mono">{flag.key}</td>
      <td className="px-3 py-2.5 text-xs text-slate-300">{flag.label}</td>
      <td className="px-3 py-2.5 text-xs text-slate-500">{flag.description || <span className="italic">—</span>}</td>
      <td className="px-3 py-2.5 text-xs text-slate-500 text-center w-16">{flag.sort_order ?? 0}</td>
      <td className="px-3 py-2.5 w-16">
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)} title="Edit flag"   className="p-1 text-slate-600 hover:text-indigo-400"><Edit2 className="w-3 h-3" /></button>
          <button onClick={() => onDelete(flag.key)} title="Delete flag" className="p-1 text-slate-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
        </div>
      </td>
    </tr>
  )
}

// ── Service row ───────────────────────────────────────────────────────────────
function ServiceRow({ svc, idx, onSave, onDelete }) {
  const [editing, setEditing] = useState(svc._new ?? false)
  const [form, setForm] = useState({ name: svc.name ?? '', type: svc.type ?? 'http', url: svc.url ?? '', expect_status: svc.expect_status ?? 200 })
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const save = () => { onSave(idx, form); setEditing(false) }
  const cancel = () => { if (svc._new) onDelete(idx); else setEditing(false) }
  const inputCls = 'bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/40 rounded px-2 py-1 text-xs text-slate-200 outline-none w-full'

  if (editing) {
    return (
      <tr className="border-b border-[#0f0f1a]">
        <td className="px-3 py-2"><input className={inputCls} value={form.name} onChange={set('name')} placeholder="Plex" /></td>
        <td className="px-3 py-2">
          <select className={inputCls} value={form.type} onChange={set('type')}>
            <option value="http">http</option>
            <option value="docker">docker</option>
          </select>
        </td>
        <td className="px-3 py-2"><input className={inputCls} value={form.url} onChange={set('url')} placeholder="http://192.168.1.10:32400" /></td>
        <td className="px-3 py-2 w-20"><input className={inputCls + ' text-center'} type="number" value={form.expect_status} onChange={set('expect_status')} /></td>
        <td className="px-3 py-2 w-16">
          <div className="flex items-center gap-1.5">
            <button onClick={save}   title="Save changes"  className="p-1 text-emerald-400 hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
            <button onClick={cancel} title="Cancel"        className="p-1 text-slate-600 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
          </div>
        </td>
      </tr>
    )
  }
  return (
    <tr className="border-b border-[#0f0f1a] hover:bg-white/[0.02] transition-colors group">
      <td className="px-3 py-2.5 text-xs text-slate-300">{svc.name}</td>
      <td className="px-3 py-2.5"><span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded px-1.5 py-0.5">{svc.type || 'http'}</span></td>
      <td className="px-3 py-2.5 text-xs text-slate-500 font-mono truncate max-w-xs">{svc.url}</td>
      <td className="px-3 py-2.5 text-xs text-slate-500 text-center">{svc.expect_status ?? 200}</td>
      <td className="px-3 py-2.5 w-16">
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)} title="Edit service"   className="p-1 text-slate-600 hover:text-indigo-400"><Edit2 className="w-3 h-3" /></button>
          <button onClick={() => onDelete(idx)}      title="Delete service" className="p-1 text-slate-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
        </div>
      </td>
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Settings({ onOpenWizard, configStatus, onDirtyChange }) {
  const [_per, _setPer] = useState(25) // unused per-state stub

  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState(null)

  // Run Now dialog + toasts
  const [activeJob, setActiveJob] = useState(null)
  const [bgJobs,    setBgJobs]    = useState([])
  const [toasts,    setToasts]    = useState([])
  const [uploadingTheme,   setUploadingTheme]   = useState(null)   // id of theme currently uploading
  const [photoVersions,    setPhotoVersions]    = useState({})     // {[id]: timestamp} for cache-busting after upload
  const bgJobsRef = useRef([])
  // eslint-disable-next-line react-hooks/refs
  bgJobsRef.current = bgJobs

  // ── DDNS state ────────────────────────────────────────────────────────────
  const [ddnsEnabled,         setDdnsEnabled]         = useState(false)
  const [ddnsProvider,        setDdnsProvider]        = useState('noip')
  const [ddnsInterval,        setDdnsInterval]        = useState(5)
  const [ddnsRetentionDays,   setDdnsRetentionDays]   = useState(365)
  const [ddnsNoipUser,        setDdnsNoipUser]        = useState('')
  const [ddnsNoipPass,        setDdnsNoipPass]        = useState('')
  const [ddnsNoipHost,        setDdnsNoipHost]        = useState('')
  const [ddnsDuckToken,       setDdnsDuckToken]       = useState('')
  const [ddnsDuckDomains,     setDdnsDuckDomains]     = useState('')
  const [ddnsDynuUser,        setDdnsDynuUser]        = useState('')
  const [ddnsDynuPass,        setDdnsDynuPass]        = useState('')
  const [ddnsDynuHost,        setDdnsDynuHost]        = useState('')
  const [ddnsDyndnsUser,      setDdnsDyndnsUser]      = useState('')
  const [ddnsDyndnsPass,      setDdnsDyndnsPass]      = useState('')
  const [ddnsDyndnsHost,      setDdnsDyndnsHost]      = useState('')
  const [ddnsAfraidUrl,       setDdnsAfraidUrl]       = useState('')
  const [ddnsCfToken,         setDdnsCfToken]         = useState('')
  const [ddnsCfZoneId,        setDdnsCfZoneId]        = useState('')
  const [ddnsCfRecordId,      setDdnsCfRecordId]      = useState('')
  const [ddnsCfHost,          setDdnsCfHost]          = useState('')
  const [ddnsStatus,          setDdnsStatus]          = useState(null)
  const [ddnsUpdating,        setDdnsUpdating]        = useState(false)

  // Dirty / unsaved-changes tracking
  const [isDirty,    setIsDirty]    = useState(false)
  const [pendingNav, setPendingNav] = useState(null)  // { proceed: () => void } | null
  const loadedRef = useRef(false)

  function showToast(message, type = 'success') {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  function markDirty() {
    if (loadedRef.current) setIsDirty(true)
  }

  function handleTabClick(tabId) {
    if (isDirty) {
      setPendingNav({ proceed: () => setSettingsTab(tabId) })
    } else {
      setSettingsTab(tabId)
    }
  }

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('job_done', e => {
      const data = JSON.parse(e.data)
      if (bgJobsRef.current.includes(data.job)) {
        showToast(`${JOBS[data.job]?.label ?? data.job} completed`)
        setBgJobs(prev => prev.filter(j => j !== data.job))
      }
    })
    es.onerror = () => {}
    return () => es.close()
  }, [])

  // Set loadedRef once the initial config fetch completes
  useEffect(() => {
    if (!loading) {
      const id = requestAnimationFrame(() => { loadedRef.current = true })
      return () => cancelAnimationFrame(id)
    }
  }, [loading])

  // Notify parent (App) when dirty state changes so it can guard sidebar navigation
  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  // Block browser-level navigation (close/refresh) when there are unsaved changes
  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  function handleRunNow(jobId)     { setActiveJob(jobId) }
  function handleRunNowWithServer(jobId) {
    if (jobId === 'speedtest') window.__claudette_override_speedtest_server = selectedOoklaServer || null
    if (jobId === 'vpn-speedtest') window.__claudette_override_speedtest_server = selectedOoklaServer || null
    setActiveJob(jobId)
  }
  function handleJobClose()        { setActiveJob(null) }
  function handleJobBackground(id) {
    setBgJobs(prev => [...prev.filter(j => j !== id), id])
    showToast(`${JOBS[id]?.label} running in background…`, 'info')
    setActiveJob(null)
  }

  // Config state
  const [piHost,                setPiHost]                = useState('')
  const [piUser,                setPiUser]                = useState('')
  const [sshKey,                setSshKey]                = useState('')
  const [subnets,               setSubnets]               = useState([])
  const [detecting,             setDetecting]             = useState(false)
  const [checkInterval,         setCheckInterval]         = useState(5)
  const [internetCheckInterval, setInternetCheckInterval] = useState(5)
  const [speedtestInterval,     setSpeedtestInterval]     = useState(1)
  const [vpnSpeedtestInterval,  setVpnSpeedtestInterval]  = useState(6)
  const [speedtestProvider,     setSpeedtestProvider]     = useState('cloudflare')
  const [threatInterval,        setThreatInterval]        = useState(6)
  const [pingInterval,          setPingInterval]          = useState(5)
  const [deepScanHour,          setDeepScanHour]          = useState(4)
  const [retentionDays,         setRetentionDays]         = useState(365)
  const [connectivityHosts,     setConnectivityHosts]     = useState(['1.1.1.1'])
  const [fallbackDns,           setFallbackDns]           = useState([])
  const [vpnInterface,          setVpnInterface]          = useState('')
  const [dormantAfterDays,      setDormantAfterDays]      = useState(3)
  const [skullAfterDays,        setSkullAfterDays]        = useState(7)
  const [ispName,               setIspName]               = useState('')
  const [ispConnectionType,     setIspConnectionType]     = useState('fibre')
  const [ispExpectedUptime,     setIspExpectedUptime]     = useState(100)
  const [ispPlanDown,           setIspPlanDown]           = useState(0)
  const [ispPlanUp,             setIspPlanUp]             = useState(0)
  const [ispAccountNumber,      setIspAccountNumber]      = useState('')
  const [ispSupportEmail,       setIspSupportEmail]       = useState('')
  const [ispSlaUrl,             setIspSlaUrl]             = useState('')
  const [ispSlaNotes,           setIspSlaNotes]           = useState('')
  const [infraSlaPct,           setInfraSlaPct]           = useState(0)
  const [infraName,             setInfraName]             = useState('')
  const [infraConnectionType,   setInfraConnectionType]   = useState('fibre')
  const [infraPlanDown,         setInfraPlanDown]         = useState(0)
  const [infraPlanUp,           setInfraPlanUp]           = useState(0)
  const [infraAccountNumber,    setInfraAccountNumber]    = useState('')
  const [infraSupportEmail,     setInfraSupportEmail]     = useState('')
  const [infraSlaUrl,           setInfraSlaUrl]           = useState('')
  const [infraSlaNotes,         setInfraSlaNotes]         = useState('')
  const [theme,                 setTheme]                 = useState(() => loadTheme())
  const [bgDim,                 setBgDim]                 = useState(() => readBgDim())
  const [accent,                setAccent]                = useState(() => loadAccent())
  const [services,              setServices]              = useState([])
  const [backupIntervalDays,        setBackupIntervalDays]        = useState(0)
  const [backupKeepDays,             setBackupKeepDays]             = useState(7)
  const [piConfig, setPiConfig] = useState(null)
  const [piSaving, setPiSaving] = useState(false)
  const [internetOutageCheckSecs,    setInternetOutageCheckSecs]    = useState(10)
  const [mtrBaselineHours,           setMtrBaselineHours]           = useState(1)
  const [mtrOutageRepeatMin,         setMtrOutageRepeatMin]         = useState(15)
  const [backingUp,             setBackingUp]             = useState(false)
  const [restoring,             setRestoring]             = useState(false)
  const restoreInputRef = useRef(null)
  const [settingsTab, setSettingsTab] = useState('host')
  const [flags,                 setFlags]                 = useState([])
  const [ooklaServers, setOoklaServers] = useState([])
  const [selectedOoklaServer, setSelectedOoklaServer] = useState('')
  const [interfaces, setInterfaces] = useState([])
  const [selectedInterface, setSelectedInterface] = useState('')

  useEffect(() => {
    api.config.get()
      .then(cfg => {
        setPiHost(cfg.pi?.host ?? '')
        setPiUser(cfg.pi?.ssh_user ?? '')
        setSshKey(cfg.pi?.ssh_key ?? '')
        setSubnets(cfg.network?.subnets ?? (cfg.network?.subnet ? [cfg.network.subnet] : []))
        setCheckInterval(cfg.schedule?.check_interval_minutes ?? 5)
        setInternetCheckInterval(cfg.schedule?.internet_check_minutes ?? 5)
        setSpeedtestInterval(cfg.schedule?.speedtest_interval_hours ?? 4)
        setVpnSpeedtestInterval(cfg.schedule?.vpn_speedtest_interval_hours ?? 4)
        setSpeedtestProvider(cfg.schedule?.speedtest_provider ?? 'cloudflare')
        setSelectedOoklaServer(cfg.schedule?.ookla_server_id ?? '')
        setSelectedInterface(cfg.schedule?.ookla_interface ?? '')
        setThreatInterval(cfg.schedule?.threat_interval_hours ?? 6)
        setPingInterval(cfg.schedule?.ping_interval_minutes ?? 5)
        setDeepScanHour(cfg.schedule?.deep_scan_hour ?? 4)
        setRetentionDays(cfg.retention?.days ?? 365)
        setConnectivityHosts(cfg.network?.connectivity_hosts ?? ['1.1.1.1'])
        setFallbackDns(cfg.network?.fallback_dns ?? [])
        setVpnInterface(cfg.network?.vpn_interface ?? '')
        setDormantAfterDays(cfg.network?.dormant_after_days ?? 3)
        setSkullAfterDays(cfg.network?.skull_after_days ?? 7)
        setIspName(cfg.isp?.name ?? '')
        setIspConnectionType(cfg.isp?.connection_type ?? 'fibre')
        setIspExpectedUptime(cfg.isp?.expected_uptime ?? 100)  // 0 = no independent SLA
        setIspPlanDown(cfg.isp?.plan_download_mbps ?? 0)
        setIspPlanUp(cfg.isp?.plan_upload_mbps ?? 0)
        setIspAccountNumber(cfg.isp?.account_number ?? '')
        setIspSupportEmail(cfg.isp?.support_email ?? '')
        setIspSlaUrl(cfg.isp?.sla_url ?? '')
        setIspSlaNotes(cfg.isp?.sla_notes ?? '')
        setInfraSlaPct(cfg.infra?.sla_pct ?? cfg.isp?.infra_sla_pct ?? 0)
        setInfraName(cfg.infra?.name ?? '')
        setInfraConnectionType(cfg.infra?.connection_type ?? 'fibre')
        setInfraPlanDown(cfg.infra?.plan_download_mbps ?? 0)
        setInfraPlanUp(cfg.infra?.plan_upload_mbps ?? 0)
        setInfraAccountNumber(cfg.infra?.account_number ?? '')
        setInfraSupportEmail(cfg.infra?.support_email ?? '')
        setInfraSlaUrl(cfg.infra?.sla_url ?? '')
        setInfraSlaNotes(cfg.infra?.sla_notes ?? '')
        setServices(cfg.services ?? [])
        setBackupIntervalDays(cfg.schedule?.backup_interval_days ?? 0)
        setBackupKeepDays(cfg.schedule?.backup_keep_days ?? 7)
        // load Pi config (assume id=1)
        api.pis.get(1).then(cfg => setPiConfig(cfg)).catch(() => setPiConfig(null))
        setInternetOutageCheckSecs(cfg.schedule?.internet_outage_check_seconds ?? 10)
        setMtrBaselineHours(cfg.schedule?.mtr_baseline_hours ?? 1)
        setMtrOutageRepeatMin(cfg.schedule?.mtr_outage_repeat_minutes ?? 15)
        // DDNS
        const d = cfg.ddns ?? {}
        setDdnsEnabled(d.enabled ?? false)
        setDdnsProvider(d.provider ?? 'noip')
        setDdnsInterval(d.check_interval_minutes ?? 5)
        setDdnsRetentionDays(d.history_retention_days ?? 365)
        setDdnsNoipUser(d.noip?.username ?? '')
        setDdnsNoipPass(d.noip?.password ?? '')
        setDdnsNoipHost(d.noip?.hostname ?? '')
        // load available network interfaces for Ookla discovery
        api.system.interfaces().then(list => setInterfaces(list || [])).catch(() => setInterfaces([]))
        setDdnsDuckToken(d.duckdns?.token ?? '')
        setDdnsDuckDomains(d.duckdns?.domains ?? '')
        setDdnsDynuUser(d.dynu?.username ?? '')
        setDdnsDynuPass(d.dynu?.password ?? '')
        setDdnsDynuHost(d.dynu?.hostname ?? '')
        setDdnsDyndnsUser(d.dyndns?.username ?? '')
        setDdnsDyndnsPass(d.dyndns?.password ?? '')
        setDdnsDyndnsHost(d.dyndns?.hostname ?? '')
        setDdnsAfraidUrl(d.afraid?.update_url ?? '')
        setDdnsCfToken(d.cloudflare?.api_token ?? '')
        setDdnsCfZoneId(d.cloudflare?.zone_id ?? '')
        setDdnsCfRecordId(d.cloudflare?.record_id ?? '')
        setDdnsCfHost(d.cloudflare?.hostname ?? '')
      })
      .catch(console.error)
      .finally(() => setLoading(false))
    api.ddns.status().then(setDdnsStatus).catch(() => {})
    api.network.flags.getAll().then(setFlags).catch(console.error)
  }, [])

  const addService    = () => { setServices(prev => [...prev, { name: '', type: 'http', url: '', expect_status: 200, _new: true }]); markDirty() }
  const updateService = (idx, data) => { setServices(prev => prev.map((s, i) => i === idx ? { ...data } : s)); markDirty() }
  const deleteService = (idx) => { setServices(prev => prev.filter((_, i) => i !== idx)); markDirty() }

  const schedulePayload = () => ({
    check_interval_minutes:   parseInt(checkInterval),
    internet_check_minutes:   parseInt(internetCheckInterval),
    threat_interval_hours:    parseInt(threatInterval),
    ping_interval_minutes:    parseInt(pingInterval),
    deep_scan_hour:           parseInt(deepScanHour),
    speedtest_interval_hours:     parseInt(speedtestInterval),
    vpn_speedtest_interval_hours: parseInt(vpnSpeedtestInterval),
    speedtest_provider:           speedtestProvider,
    ookla_server_id:             selectedOoklaServer || null,
    ookla_interface:             selectedInterface || null,
    backup_interval_days:          parseInt(backupIntervalDays) || 0,
    backup_keep_days:              Math.max(1, parseInt(backupKeepDays) || 7),
    internet_outage_check_seconds: Math.max(5, parseInt(internetOutageCheckSecs) || 10),
    mtr_baseline_hours:            Math.max(0, parseInt(mtrBaselineHours) || 0),
    mtr_outage_repeat_minutes:     Math.max(0, parseInt(mtrOutageRepeatMin) || 0),
  })

  const ispPayload = () => ({
    name:                ispName.trim(),
    connection_type:     ispConnectionType,
    expected_uptime:     (v => isNaN(v) ? 100 : v)(parseFloat(ispExpectedUptime)),
    plan_download_mbps:  parseFloat(ispPlanDown) || 0,
    plan_upload_mbps:    parseFloat(ispPlanUp)   || 0,
    account_number:      ispAccountNumber.trim(),
    support_email:       ispSupportEmail.trim(),
    sla_url:             ispSlaUrl.trim(),
    sla_notes:           ispSlaNotes.trim(),
  })

  const infraPayload = () => ({
    name:                infraName.trim(),
    connection_type:     infraConnectionType,
    sla_pct:             parseFloat(infraSlaPct) || 0,
    plan_download_mbps:  parseFloat(infraPlanDown) || 0,
    plan_upload_mbps:    parseFloat(infraPlanUp)   || 0,
    account_number:      infraAccountNumber.trim(),
    support_email:       infraSupportEmail.trim(),
    sla_url:             infraSlaUrl.trim(),
    sla_notes:           infraSlaNotes.trim(),
  })

  const ddnsPayload = () => ({
    enabled:  ddnsEnabled,
    provider: ddnsProvider,
    check_interval_minutes:  parseInt(ddnsInterval) || 5,
    history_retention_days:  parseInt(ddnsRetentionDays) || 365,
    noip:      { username: ddnsNoipUser,    password: ddnsNoipPass,    hostname: ddnsNoipHost },
    duckdns:   { token:    ddnsDuckToken,   domains:  ddnsDuckDomains },
    dynu:      { username: ddnsDynuUser,    password: ddnsDynuPass,    hostname: ddnsDynuHost },
    dyndns:    { username: ddnsDyndnsUser,  password: ddnsDyndnsPass,  hostname: ddnsDyndnsHost },
    afraid:    { update_url: ddnsAfraidUrl },
    cloudflare: { api_token: ddnsCfToken, zone_id: ddnsCfZoneId, record_id: ddnsCfRecordId, hostname: ddnsCfHost },
  })

  const onThemeChange = (newTheme) => {
    setTheme(newTheme)
    applyTheme(newTheme)
    saveTheme(newTheme)
  }

  const onAccentChange = (newAccent) => {
    setAccent(newAccent)
    applyAccent(newAccent)
    saveAccent(newAccent)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.config.save({
        pi: { host: piHost, ssh_user: piUser, ssh_key: sshKey },
        network: { subnets, connectivity_hosts: connectivityHosts.filter(h => h.trim()), fallback_dns: fallbackDns.filter(h => h.trim()), dormant_after_days: parseInt(dormantAfterDays) || 3, skull_after_days: parseInt(skullAfterDays) || 7, vpn_interface: vpnInterface.trim() || undefined },
        schedule: schedulePayload(),
        retention: { days: parseInt(retentionDays) },
        services: services.filter(s => s.name && s.url),
        isp: ispPayload(),
        infra: infraPayload(),
        ddns: ddnsPayload(),
      })
      setIsDirty(false)
      if (pendingNav) { pendingNav.proceed(); setPendingNav(null) }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-5 h-5 text-indigo-400/40 animate-spin" />
      </div>
    )
  }

  return (
    <>
      {activeJob && (
        <RunJobDialog jobId={activeJob} onClose={handleJobClose} onBackground={handleJobBackground} />
      )}
      {pendingNav && (
        <UnsavedChangesDialog
          saving={saving}
          onSave={save}
          onDiscard={() => { setIsDirty(false); pendingNav.proceed(); setPendingNav(null) }}
          onCancel={() => setPendingNav(null)}
        />
      )}
      <ToastContainer toasts={toasts} />

      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a30] flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-white">Settings</h1>
            <p className="text-slate-500 text-xs mt-0.5">Configure Claudette</p>
          </div>
          <div className="flex items-center gap-3">
            {isDirty && !saving && !saved && (
              <span className="flex items-center gap-1.5 text-[11px] text-amber-400/80">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />
                Unsaved changes
              </span>
            )}
            {onOpenWizard && (
              <button onClick={onOpenWizard}
                className="flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-slate-200 border border-[#1a1a30] hover:border-[#2a2a45] rounded-lg text-xs transition-colors">
                <Wand2 className="w-3.5 h-3.5" />Re-run Wizard
              </button>
            )}
            {onOpenWizard && (
              <button
                onClick={async () => {
                  if (!window.confirm('Delete config.yaml and restart the setup wizard?\n\nThis will NOT delete your scan data or audit log.')) return
                  try {
                    await api.config.reset()
                    window.location.reload()
                  } catch (e) {
                    alert('Failed to reset config: ' + e.message)
                  }
                }}
                className="flex items-center gap-2 px-3 py-2 text-red-500/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-lg text-xs transition-colors">
                <Trash2 className="w-3.5 h-3.5" />Reset Config
              </button>
            )}
            <button onClick={save} disabled={saving}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                saved   ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/25'
                : isDirty ? 'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white ring-2 ring-indigo-400/30'
                          : 'bg-indigo-600/70 hover:bg-indigo-700 disabled:opacity-50 text-white/80'
              }`}>
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">{error}</div>
        )}

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* ── Pill nav ── */}
          <div className="flex gap-1.5 flex-wrap px-6 pt-4 pb-3.5 border-b border-[#1a1a30] flex-shrink-0 bg-[#070712]">
            {[
              { id: 'host',       label: 'Host' },
              { id: 'network',    label: 'Network' },
              { id: 'schedule',   label: 'Schedule' },
              { id: 'ddns',       label: 'DDNS' },
              { id: 'infra',      label: 'Infra & SLA' },
              { id: 'isp',        label: 'ISP & SLA' },
              { id: 'services',   label: 'Services' },
              { id: 'flags',      label: 'Flags' },
              { id: 'appearance', label: 'Appearance' },
              { id: 'data',       label: 'Data' },
            ].map(t => (
              <button key={t.id} onClick={() => handleTabClick(t.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  settingsTab === t.id
                    ? 'bg-indigo-600/25 text-indigo-300 border border-indigo-500/40'
                    : 'text-slate-500 hover:text-slate-300 border border-[#1a1a30] hover:border-[#2a2a45]'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Tab content ── */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 max-w-2xl"
            onChange={() => { if (!['appearance', 'flags'].includes(settingsTab)) markDirty() }}>

          {/* HOST */}
          {settingsTab === 'host' && (<>
          <section>
            <SectionHeading>Pi / Server</SectionHeading>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <label className="block text-xs font-medium text-slate-300">Host IP</label>
                    {piHost === '192.168.1.10' && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 leading-none">example value</span>
                    )}
                  </div>
                  <button type="button" disabled={detecting} onClick={async () => {
                    setDetecting(true)
                    try {
                      const { interfaces } = await api.system.interfaces()
                      if (interfaces?.length) {
                        setPiHost(interfaces[0].ip)
                        if (subnets.length === 0) setSubnets([interfaces[0].subnet])
                        markDirty()
                      }
                    } catch { /* ignore */ } finally { setDetecting(false) }
                  }} className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors">
                    {detecting
                      ? <><span className="w-2.5 h-2.5 border border-indigo-400 border-t-transparent rounded-full animate-spin" /> Detecting…</>
                      : <><Network className="w-2.5 h-2.5" /> Auto-detect</>}
                  </button>
                </div>
                <input value={piHost} onChange={e => setPiHost(e.target.value)} placeholder="192.168.1.10"
                  className={`w-full rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors ${piHost === '192.168.1.10' ? 'bg-amber-500/5 border border-amber-500/40 focus:border-amber-400/60' : 'bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50'}`} />
              </div>
              <Field label="SSH User" value={piUser} onChange={e => setPiUser(e.target.value)} placeholder="ubuntu" />
              <div className="col-span-2">
                <Field label="SSH Key Path" hint="Optional — uses ssh-agent if left blank" value={sshKey} onChange={e => setSshKey(e.target.value)} placeholder="~/.ssh/id_rsa" />
              </div>
            </div>
          </section>
          </>)}

          {/* NETWORK */}
          {settingsTab === 'network' && (<>
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <SectionHeading>Network Scan Ranges</SectionHeading>
                {subnets.some(s => s === '192.168.1.0/24') && (
                  <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 leading-none">needs setup</span>
                )}
              </div>
              <button onClick={() => { setSubnets(p => [...p, '']); markDirty() }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors">
                <Plus className="w-3.5 h-3.5" />Add Range
              </button>
            </div>
            {subnets.length === 0 && <p className="text-xs text-slate-700 py-2">Auto-detected from host IP. Add a range to override.</p>}
            <div className="space-y-2 max-w-xs">
              {subnets.map((s, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2">
                    <input value={s} onChange={e => setSubnets(p => p.map((x, j) => j === i ? e.target.value : x))}
                      placeholder="192.168.1.0/24"
                      className={`flex-1 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono ${s === '192.168.1.0/24' ? 'bg-amber-500/5 border border-amber-500/40 focus:border-amber-400/60' : 'bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50'}`} />
                    <button onClick={() => { setSubnets(p => p.filter((_, j) => j !== i)); markDirty() }} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {s === '192.168.1.0/24' && (
                    <p className="text-[10px] text-amber-400/80 mt-0.5 ml-1">Replace with your actual network range</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <SectionHeading>Connectivity Check Hosts</SectionHeading>
              <button onClick={() => { setConnectivityHosts(p => [...p, '']); markDirty() }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors">
                <Plus className="w-3.5 h-3.5" />Add Host
              </button>
            </div>
            <p className="text-[11px] text-slate-600 mb-3">IPs to ping for internet connectivity checks. Default: 1.1.1.1.</p>
            <div className="space-y-2 max-w-xs">
              {connectivityHosts.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={h} onChange={e => setConnectivityHosts(p => p.map((x, j) => j === i ? e.target.value : x))}
                    placeholder="1.1.1.1"
                    className="flex-1 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono" />
                  <button onClick={() => { setConnectivityHosts(p => p.filter((_, j) => j !== i)); markDirty() }} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <SectionHeading>Fallback DNS</SectionHeading>
              <button onClick={() => { setFallbackDns(p => [...p, '']); markDirty() }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors">
                <Plus className="w-3.5 h-3.5" />Add Server
              </button>
            </div>
            <p className="text-[11px] text-slate-600 mb-3">
              Fallback DNS servers passed to the Docker container via <span className="font-mono">--dns</span>. Used when your primary DNS resolver is unreachable. Applied on next deploy. Up to 3 entries.
            </p>
            <div className="space-y-2 max-w-xs">
              {fallbackDns.length === 0 && (
                <p className="text-[11px] text-slate-700 italic">None configured — Docker will use the Pi&apos;s resolv.conf only.</p>
              )}
              {fallbackDns.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={h} onChange={e => setFallbackDns(p => p.map((x, j) => j === i ? e.target.value : x))}
                    placeholder="8.8.8.8"
                    className="flex-1 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono" />
                  <button onClick={() => { setFallbackDns(p => p.filter((_, j) => j !== i)); markDirty() }} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionHeading>VPN Interface</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">
              Network interface used for VPN connectivity checks and speed tests. Leave blank to disable VPN monitoring.
              Common values: <span className="font-mono text-slate-400">tun0</span> (OpenVPN),
              <span className="font-mono text-slate-400"> wg0</span> (WireGuard),
              <span className="font-mono text-slate-400"> ppp0</span> (PPP).
            </p>
            <div className="max-w-xs">
              <Field
                label="Interface name"
                value={vpnInterface}
                onChange={e => setVpnInterface(e.target.value)}
                placeholder="e.g. tun0 or wg0 — blank to disable"
              />
              {vpnInterface && (
                <p className="text-[10px] text-violet-400/80 mt-1.5">
                  VPN checks enabled — internet pings and speed tests will also run via <span className="font-mono">{vpnInterface}</span>.
                </p>
              )}
            </div>
          </section>
          </>)}

          {/* SCHEDULE */}
          {settingsTab === 'schedule' && (<>
          <section>
            <SectionHeading>Schedule</SectionHeading>
            <p className="text-[11px] text-slate-500 mb-3">Jobs run at clock-aligned times and queue up so they never overlap.</p>
            <div className="space-y-3 max-w-lg">
              {[
                { jobId: 'services', label: 'Service check',   opts: MIN_OPTS, value: checkInterval,         set: v => setCheckInterval(parseInt(v)) },
                { jobId: 'internet', label: 'Internet check',  opts: MIN_OPTS, value: internetCheckInterval, set: v => setInternetCheckInterval(parseInt(v)) },
                { jobId: 'ping',     label: 'Ping sweep',      opts: MIN_OPTS, value: pingInterval,          set: v => setPingInterval(parseInt(v)) },
                { jobId: 'threats',  label: 'Threat refresh',  opts: HR_OPTS,  value: threatInterval,        set: v => setThreatInterval(parseInt(v)) },
                { jobId: 'speedtest',    label: 'Speed test (direct)', opts: HR_OPTS,      value: speedtestInterval,    set: v => setSpeedtestInterval(parseInt(v)) },
                { jobId: 'vpn-speedtest', label: 'Speed test (VPN)',    opts: [{ value: 0, label: 'Disabled' }, ...HR_OPTS], value: vpnSpeedtestInterval, set: v => setVpnSpeedtestInterval(parseInt(v)) },
              ].map(({ jobId, label, opts, value, set }) => (
                <div key={jobId} className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
                    <select value={value} onChange={e => set(e.target.value)}
                      className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <button onClick={() => handleRunNowWithServer(jobId)}
                    className="mt-5 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 bg-indigo-500/5 hover:bg-indigo-500/10 rounded-lg transition-colors whitespace-nowrap">
                    <Play className="w-3 h-3" />Run now
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 max-w-lg">
              <label className="block text-xs font-medium text-slate-400 mb-1">Speed test provider</label>
              <select value={speedtestProvider} onChange={e => setSpeedtestProvider(e.target.value)}
                className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                <option value="cloudflare">Cloudflare (no binary, recommended)</option>
                <option value="ookla">Ookla speedtest-cli (auto-selects nearest server)</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                Ookla requires the <span className="font-mono">speedtest</span> CLI binary to be installed in the container.
                Cloudflare uses pure HTTP and works everywhere.
              </p>
              {speedtestProvider === 'ookla' && (
                <div className="mt-3">
                    <div className="flex items-center gap-2 mb-2">
                    <button onClick={async () => {
                      try {
                        const res = await api.reports.ooklaServers(selectedInterface)
                        // backend may return { servers: [...] } or array directly — normalize
                        const raw = Array.isArray(res) ? res : (res?.servers ?? [])
                        const list = Array.isArray(raw) ? raw : []
                        const sorted = list.sort((a,b) => {
                          const pa = (a.ping_ms??a.ping??99999)
                          const pb = (b.ping_ms??b.ping??99999)
                          if (pa !== pb) return pa - pb
                          const na = (a.name||a.sponsor||a.host||'').toLowerCase()
                          const nb = (b.name||b.sponsor||b.host||'').toLowerCase()
                          return na < nb ? -1 : na > nb ? 1 : 0
                        }).slice(0,10)
                        setOoklaServers(sorted)
                      } catch (err) { console.error(err); alert('Failed to discover Ookla servers: '+err.message) }
                    }}
                      className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium">Discover servers</button>
                    <p className="text-[11px] text-slate-500">Click to query Ookla and list top candidates (by ping).</p>
                  </div>
                  {ooklaServers.length > 0 && (
                    <div className="bg-[#080812] border border-[#1a1a30] rounded-lg p-3">
                      <div className="mb-3">
                        <div className="text-[12px] text-slate-400 mb-2">Select network adapter to probe from</div>
                        <select value={selectedInterface} onChange={e => { setSelectedInterface(e.target.value); markDirty() }}
                          className="w-full bg-[#080812] border border-[#1a1a30] rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                          <option value="">Auto (default)</option>
                          {interfaces.map(i => <option key={i.name || i.iface} value={i.name || i.iface}>{i.name || i.iface} {i.address ? ` — ${i.address}` : ''}</option>)}
                        </select>
                        <p className="text-[11px] text-slate-500 mt-1">Pick `eth0`, `wlan0`, `tun0`, etc. to probe via that adapter.</p>
                      </div>
                      <div className="text-[12px] text-slate-400 mb-2">Choose a preferred server (or Auto to let Ookla pick)</div>
                      <select value={selectedOoklaServer} onChange={e => { setSelectedOoklaServer(e.target.value); markDirty() }}
                        className="w-full bg-[#080812] border border-[#1a1a30] rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                        <option value="">Auto (let Ookla select fastest)</option>
                        {ooklaServers.map(s => {
                          const id = String(s.id || s.server_id || s.server || s.id_str || s.host)
                          const ping = s.ping_ms ?? s.ping ?? s.latency_ms ?? null
                          const label = `${s.sponsor || s.name || s.host} — ${s.name || s.host}`
                          return <option key={id} value={id}>{label} {ping !== null ? ` — ${ping} ms` : ''}</option>
                        })}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 max-w-lg">
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Outage fast-poll interval (seconds)
                {configStatus?.outdated && (
                  <span className="ml-2 text-[10px] font-semibold text-amber-400 uppercase tracking-wide">New in v0.0.8</span>
                )}
              </label>
              <input
                type="number" min="5" max="300" step="1"
                value={internetOutageCheckSecs}
                onChange={e => setInternetOutageCheckSecs(Math.max(5, parseInt(e.target.value) || 10))}
                className={`w-32 bg-[#080812] rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors ${
                  configStatus?.outdated
                    ? 'border border-amber-500/50 focus:border-amber-400'
                    : 'border border-[#1a1a30] focus:border-indigo-500/50'
                }`}
              />
              <p className="text-[11px] text-slate-600 mt-1">How often to ping while internet is down — switches back to normal interval once restored (min 5s)</p>
            </div>
            <div className="mt-3 max-w-lg">
              <label className="block text-xs font-medium text-slate-400 mb-1">Baseline mtr interval (hours, 0 = disabled)</label>
              <input
                type="number" min="0" max="24" step="1"
                value={mtrBaselineHours}
                onChange={e => setMtrBaselineHours(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-32 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors"
              />
              <p className="text-[11px] text-slate-600 mt-1">Run mtr to 8.8.8.8 on a schedule when internet is healthy — gives you a comparison baseline</p>
            </div>
            <div className="mt-3 max-w-lg">
              <label className="block text-xs font-medium text-slate-400 mb-1">Outage mtr repeat interval (minutes, 0 = disabled)</label>
              <input
                type="number" min="0" max="60" step="1"
                value={mtrOutageRepeatMin}
                onChange={e => setMtrOutageRepeatMin(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-32 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors"
              />
              <p className="text-[11px] text-slate-600 mt-1">Re-run mtr every N minutes while the internet is down — captures how the path degrades over time</p>
            </div>
            <div className="mt-3 max-w-lg">
              <label className="block text-xs font-medium text-slate-400 mb-1">Nightly deep scan time</label>
              <select value={deepScanHour} onChange={e => setDeepScanHour(parseInt(e.target.value))}
                className="w-56 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                {HOUR_LABELS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
              <p className="text-[11px] text-slate-600 mt-1">Full port scan of all discovered devices — runs once daily</p>
            </div>
            <div className="mt-4 max-w-xs space-y-1">
              <label className="block text-xs font-medium text-slate-400">Data retention</label>
              <select value={retentionDays} onChange={e => setRetentionDays(parseInt(e.target.value))}
                className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>1 year</option>
                <option value={730}>2 years</option>
                <option value={1095}>3 years</option>
                <option value={1825}>5 years</option>
              </select>
              <p className="text-[11px] text-slate-500">Events older than this are pruned nightly at 3 am</p>
            </div>
          </section>
          </>)}

          {/* DDNS */}
          {settingsTab === 'ddns' && (<>
          <section>
            <SectionHeading>Dynamic DNS</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">
              Keeps your hostname pointing to your current public IP. The server checks your IP every N minutes and pushes an update to your DDNS provider if it changes.
            </p>

            {/* Status card */}
            {ddnsStatus && (
              <div className="mb-5 p-3 rounded-lg border border-[#1a1a30] bg-[#060610] space-y-1.5 max-w-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Status</span>
                  <button type="button" disabled={ddnsUpdating || !ddnsStatus.enabled}
                    onClick={async () => {
                      setDdnsUpdating(true)
                      try {
                        const r = await api.ddns.update()
                        setDdnsStatus(r.status)
                        showToast('DDNS check complete')
                      } catch (e) { showToast(e.message, 'error') }
                      finally { setDdnsUpdating(false) }
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/60 bg-indigo-500/5 hover:bg-indigo-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {ddnsUpdating ? <RefreshCw size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    Check Now
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <span className="text-slate-600">Current IP</span>
                  <span className="text-slate-300 font-mono">{ddnsStatus.last_ip ?? '—'}</span>
                  <span className="text-slate-600">Last Updated</span>
                  <span className="text-slate-400">{ddnsStatus.last_updated ? new Date(ddnsStatus.last_updated).toLocaleString() : '—'}</span>
                  <span className="text-slate-600">Last Checked</span>
                  <span className="text-slate-400">{ddnsStatus.last_check ? new Date(ddnsStatus.last_check).toLocaleString() : '—'}</span>
                  {ddnsStatus.hostname && <><span className="text-slate-600">Hostname</span><span className="text-slate-300 font-mono">{ddnsStatus.hostname}</span></>}
                </div>
                {ddnsStatus.last_error && (
                  <p className="mt-1 text-[11px] text-red-400 bg-red-500/10 rounded px-2 py-1">{ddnsStatus.last_error}</p>
                )}
              </div>
            )}

            <div className="space-y-4 max-w-sm">
              {/* Enable toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className={`relative w-9 h-5 rounded-full transition-colors ${ddnsEnabled ? 'bg-indigo-600' : 'bg-[#1a1a30]'}`}
                  onClick={() => { setDdnsEnabled(v => !v); markDirty() }}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${ddnsEnabled ? 'translate-x-4' : ''}`} />
                </div>
                <span className="text-sm text-slate-300 font-medium">Enable DDNS auto-update</span>
              </label>

              {/* Provider select */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">Provider</label>
                <select value={ddnsProvider} onChange={e => { setDdnsProvider(e.target.value); markDirty() }}
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                  <option value="noip">No-IP (noip.com)</option>
                  <option value="duckdns">DuckDNS (duckdns.org)</option>
                  <option value="dynu">Dynu (dynu.com)</option>
                  <option value="dyndns">DynDNS (dyndns.com)</option>
                  <option value="afraid">Afraid.org / FreeDNS</option>
                  <option value="cloudflare">Cloudflare DNS</option>
                </select>
              </div>

              {/* Check interval */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">Check interval (minutes)</label>
                <input type="number" min="5" max="1440" step="5"
                  value={ddnsInterval} onChange={e => { setDdnsInterval(e.target.value); markDirty() }}
                  className="w-32 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors" />
                <p className="text-[11px] text-slate-600">Minimum 5 minutes. Only sends an update when your IP actually changes.</p>
              </div>

              {/* History retention */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">History retention (days)</label>
                <input type="number" min="1" max="3650" step="1"
                  value={ddnsRetentionDays} onChange={e => { setDdnsRetentionDays(e.target.value); markDirty() }}
                  className="w-32 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors" />
                <p className="text-[11px] text-slate-600">How long to keep IP change and error history. Default 365 days (1 year).</p>
              </div>

              {/* Provider-specific fields */}
              {ddnsProvider === 'noip' && (<>
                <Field label="No-IP Username / Email" value={ddnsNoipUser} onChange={e => { setDdnsNoipUser(e.target.value); markDirty() }} placeholder="you@example.com" />
                <Field label="No-IP Password" type="password" value={ddnsNoipPass} onChange={e => { setDdnsNoipPass(e.target.value); markDirty() }} placeholder="••••••••" />
                <Field label="Hostname" value={ddnsNoipHost} onChange={e => { setDdnsNoipHost(e.target.value); markDirty() }} placeholder="myhome.ddns.net" />
              </>)}

              {ddnsProvider === 'duckdns' && (<>
                <Field label="Token" type="password" value={ddnsDuckToken} onChange={e => { setDdnsDuckToken(e.target.value); markDirty() }} placeholder="your-duckdns-token" />
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-400">Domain(s)</label>
                  <input value={ddnsDuckDomains} onChange={e => { setDdnsDuckDomains(e.target.value); markDirty() }}
                    placeholder="myhome  (without .duckdns.org)"
                    className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors" />
                  <p className="text-[11px] text-slate-600">Just the subdomain part, e.g. <span className="text-slate-400">myhome</span> — not myhome.duckdns.org. Comma-separated for multiple.</p>
                </div>
              </>)}

              {ddnsProvider === 'dynu' && (<>
                <Field label="Dynu Username" value={ddnsDynuUser} onChange={e => { setDdnsDynuUser(e.target.value); markDirty() }} placeholder="username" />
                <Field label="Dynu Password" type="password" value={ddnsDynuPass} onChange={e => { setDdnsDynuPass(e.target.value); markDirty() }} placeholder="••••••••" />
                <Field label="Hostname" value={ddnsDynuHost} onChange={e => { setDdnsDynuHost(e.target.value); markDirty() }} placeholder="myhome.dynu.net" />
              </>)}

              {ddnsProvider === 'dyndns' && (<>
                <Field label="DynDNS Username" value={ddnsDyndnsUser} onChange={e => { setDdnsDyndnsUser(e.target.value); markDirty() }} placeholder="username" />
                <Field label="DynDNS Password" type="password" value={ddnsDyndnsPass} onChange={e => { setDdnsDyndnsPass(e.target.value); markDirty() }} placeholder="••••••••" />
                <Field label="Hostname" value={ddnsDyndnsHost} onChange={e => { setDdnsDyndnsHost(e.target.value); markDirty() }} placeholder="myhome.dyndns.org" />
              </>)}

              {ddnsProvider === 'afraid' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-400">Direct Update URL</label>
                  <input value={ddnsAfraidUrl} onChange={e => { setDdnsAfraidUrl(e.target.value); markDirty() }}
                    placeholder="https://freedns.afraid.org/dynamic/update.php?..."
                    className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono text-xs" />
                  <p className="text-[11px] text-slate-600">
                    Get this from afraid.org → Dynamic DNS → your record → Direct URL. Contains your unique key.
                  </p>
                </div>
              )}

              {ddnsProvider === 'cloudflare' && (<>
                <Field label="API Token" type="password" value={ddnsCfToken} onChange={e => { setDdnsCfToken(e.target.value); markDirty() }} placeholder="Cloudflare API token" />
                <Field label="Zone ID" value={ddnsCfZoneId} onChange={e => { setDdnsCfZoneId(e.target.value); markDirty() }} placeholder="abc123..." />
                <Field label="DNS Record ID" value={ddnsCfRecordId} onChange={e => { setDdnsCfRecordId(e.target.value); markDirty() }} placeholder="def456..." />
                <Field label="Hostname (A record name)" value={ddnsCfHost} onChange={e => { setDdnsCfHost(e.target.value); markDirty() }} placeholder="home.example.com" />
                <p className="text-[11px] text-slate-600">Zone ID and Record ID are in your Cloudflare dashboard. Create an API token with <em>Zone: DNS: Edit</em> permissions.</p>
              </>)}
            </div>
          </section>
          </>)}

          {/* ISP & SLA */}
          {settingsTab === 'isp' && (<>
          <section>
            <SectionHeading>ISP / Internet Provider</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">Used in outage reports and exports sent to your provider. Set the SLA targets to compare your measured uptime against what was contractually promised.</p>
            <div className="space-y-3 max-w-xs">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">ISP Name</label>
                <div className="flex gap-2">
                  <input value={ispName} onChange={e => setIspName(e.target.value)} placeholder="e.g. MetroFibre"
                    className="flex-1 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors" />
                  <button
                    type="button"
                    disabled={!ispName.trim()}
                    onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(ispName.trim() + ' broadband SLA uptime guarantee service level agreement')}`, '_blank')}
                    title="Search for this ISP's SLA document"
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 bg-indigo-500/5 hover:bg-indigo-500/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap">
                    <ExternalLink className="w-3 h-3" />Find SLA
                  </button>
                </div>
                {!ispName.trim() && <p className="text-[10px] text-slate-600">Enter ISP name to enable SLA search</p>}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">Connection Type</label>
                <select value={ispConnectionType} onChange={e => setIspConnectionType(e.target.value)}
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                  {['fibre','dsl','lte','cable','satellite','broadband'].map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <Field label="Account / Contract No." value={ispAccountNumber} onChange={e => setIspAccountNumber(e.target.value)} placeholder="optional" />
              <Field label="Support Email" type="email" value={ispSupportEmail} onChange={e => setIspSupportEmail(e.target.value)} placeholder="support@isp.example.com" />
            </div>
          </section>

          <section>
            <SectionHeading>SLA Targets</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">Enter the uptime % your ISP has contractually committed to (check your broadband terms / welcome letter). Measured uptime is compared against these targets in the Reports page.</p>
            <div className="space-y-3 max-w-xs">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">ISP Contracted Uptime %</label>
                <p className="text-[11px] text-slate-600">From your ISP&apos;s service agreement — e.g. 99.9% or 99%. Set to <span className="text-slate-400">0</span> if your ISP has no independent SLA (uptime depends on the line provider).</p>
                <input type="number" min="0" max="100" step="0.001"
                  value={ispExpectedUptime} onChange={e => setIspExpectedUptime(e.target.value)} placeholder="0 = no SLA / 100 = full"
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors" />
              </div>
              <Field label="Plan Download Speed (Mbps)" type="number" min="0" max="10000" step="1"
                value={ispPlanDown || ''} onChange={e => setIspPlanDown(e.target.value)} placeholder="e.g. 250" />
              <Field label="Plan Upload Speed (Mbps)" type="number" min="0" max="10000" step="1"
                value={ispPlanUp || ''} onChange={e => setIspPlanUp(e.target.value)} placeholder="e.g. 250" />
            </div>
          </section>

          <section>
            <SectionHeading>SLA Evidence</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">Record where you found the SLA and any relevant notes. This is included in the copied outage report for your records.</p>
            <div className="space-y-3 max-w-lg">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">SLA Document URL</label>
                <div className="flex gap-2">
                  <input value={ispSlaUrl} onChange={e => setIspSlaUrl(e.target.value)} placeholder="https://isp.example.com/terms/sla"
                    className="flex-1 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono text-xs" />
                  {ispSlaUrl.trim() && (
                    <button type="button" onClick={() => window.open(ispSlaUrl.trim(), '_blank')}
                      title="Open SLA document"
                      className="flex items-center gap-1 px-3 py-2 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors">
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">SLA Notes</label>
                <p className="text-[11px] text-slate-600">e.g. &quot;Section 4.2 — 99.9% monthly uptime, excludes scheduled maintenance&quot;</p>
                <textarea value={ispSlaNotes} onChange={e => setIspSlaNotes(e.target.value)}
                  rows={3} placeholder="Notes about what the SLA covers, exclusions, compensation terms..."
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors resize-none" />
              </div>
            </div>
          </section>

          </>)}

          {/* INFRA & SLA */}
          {settingsTab === 'infra' && (<>
          <section>
            <SectionHeading>Physical Line Provider</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">Details about your physical WAN connection — the line from your premises to the ISP (e.g. fibre loop, DSL line, cable). Used in reports to distinguish line faults from ISP-side failures.</p>
            <div className="space-y-3 max-w-xs">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">Line / Loop Provider Name</label>
                <div className="flex gap-2">
                  <input value={infraName} onChange={e => setInfraName(e.target.value)} placeholder="e.g. Openreach / Chorus"
                    className="flex-1 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors" />
                  <button
                    type="button"
                    disabled={!infraName.trim()}
                    onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(infraName.trim() + ' SLA uptime guarantee service level agreement')}`, '_blank')}
                    title="Search for this provider's SLA document"
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 bg-indigo-500/5 hover:bg-indigo-500/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap">
                    <ExternalLink className="w-3 h-3" />Find SLA
                  </button>
                </div>
                {!infraName.trim() && <p className="text-[10px] text-slate-600">Enter provider name to enable SLA search</p>}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">Connection Type</label>
                <select value={infraConnectionType} onChange={e => setInfraConnectionType(e.target.value)}
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                  {['fibre','dsl','cable','lte','satellite','leased-line','other'].map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <Field label="Account / Contract No." value={infraAccountNumber} onChange={e => setInfraAccountNumber(e.target.value)} placeholder="optional" />
              <Field label="Support Email" type="email" value={infraSupportEmail} onChange={e => setInfraSupportEmail(e.target.value)} placeholder="support@vendor.example.com" />
            </div>
          </section>

          <section>
            <SectionHeading>SLA Targets</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">Your uptime target for the physical WAN line. Used in reports to compare measured uptime against your own targets.</p>
            <div className="space-y-3 max-w-xs">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">Infrastructure Uptime Target %</label>
                <p className="text-[11px] text-slate-600">Your own target for WAN line uptime — e.g. 99.9%. Set to 0 to disable.</p>
                <input type="number" min="0" max="100" step="0.001"
                  value={infraSlaPct || ''} onChange={e => setInfraSlaPct(e.target.value)} placeholder="e.g. 99.9 — or 0 to disable"
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors" />
              </div>
              <Field label="Link Speed Down (Mbps)" type="number" min="0" max="100000" step="1"
                value={infraPlanDown || ''} onChange={e => setInfraPlanDown(e.target.value)} placeholder="e.g. 1000" />
              <Field label="Link Speed Up (Mbps)" type="number" min="0" max="100000" step="1"
                value={infraPlanUp || ''} onChange={e => setInfraPlanUp(e.target.value)} placeholder="e.g. 1000" />
            </div>
          </section>

          <section>
            <SectionHeading>SLA Evidence</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">Record where you found the SLA and any relevant notes. Included in outage reports for your records.</p>
            <div className="space-y-3 max-w-lg">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">SLA Document URL</label>
                <div className="flex gap-2">
                  <input value={infraSlaUrl} onChange={e => setInfraSlaUrl(e.target.value)} placeholder="https://vendor.example.com/terms/sla"
                    className="flex-1 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono text-xs" />
                  {infraSlaUrl.trim() && (
                    <button type="button" onClick={() => window.open(infraSlaUrl.trim(), '_blank')}
                      title="Open SLA document"
                      className="flex items-center gap-1 px-3 py-2 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors">
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">SLA Notes</label>
                <p className="text-[11px] text-slate-600">e.g. &quot;Openreach FTTP — 99.9% uptime SLA, 2-working-day fault repair&quot;</p>
                <textarea value={infraSlaNotes} onChange={e => setInfraSlaNotes(e.target.value)}
                  rows={3} placeholder="Notes about what the SLA covers, exclusions, compensation terms..."
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors resize-none" />
              </div>
            </div>
          </section>

          <section>
            <SectionHeading>Device Lifecycle</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">Thresholds for auto-managing devices that stop responding.</p>
            <div className="grid grid-cols-2 gap-4 max-w-xs">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Auto-dormant after (days)</label>
                <input type="number" min="1" max="365" step="1"
                  value={dormantAfterDays}
                  onChange={e => setDormantAfterDays(Math.max(1, parseInt(e.target.value) || 3))}
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors"
                />
                <p className="text-[11px] text-slate-600 mt-1">🌙 Moon icon — device silenced</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Skull warning after (days)</label>
                <input type="number" min="1" max="365" step="1"
                  value={skullAfterDays}
                  onChange={e => setSkullAfterDays(Math.max(1, parseInt(e.target.value) || 7))}
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors"
                />
                <p className="text-[11px] text-slate-600 mt-1">💀 Skull icon — long-term unreachable</p>
              </div>
            </div>
          </section>
          </>)}

          {/* SERVICES */}
          {settingsTab === 'services' && (<>
          <section>
            <div className="flex items-center justify-between mb-4">
              <SectionHeading>Monitored Services</SectionHeading>
              <button onClick={addService}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors">
                <Plus className="w-3.5 h-3.5" />Add Service
              </button>
            </div>
            {services.length === 0 ? (
              <p className="text-xs text-slate-700 py-4">No services configured. Add one above.</p>
            ) : (
                <div className="border border-[#1a1a30] rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-slate-600 uppercase tracking-wider border-b border-[#1a1a30] bg-[#080812]">
                      <th className="text-left px-3 py-2">Name</th>
                      <th className="text-left px-3 py-2 w-16">Type</th>
                      <th className="text-left px-3 py-2">URL</th>
                      <th className="text-center px-3 py-2 w-20">Expect</th>
                      <th className="px-3 py-2 w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((svc, idx) => (
                      <ServiceRow key={idx} svc={svc} idx={idx} onSave={updateService} onDelete={deleteService} />
                    ))}
                  </tbody>
                </table>
                {services.length > 10 && (
                  <div className="p-2 flex items-center justify-end gap-3">
                    <label className="text-xs text-slate-400">Per page:</label>
                    <select className="px-2 py-1 border rounded bg-[#071025] text-sm">
                      <option>10</option>
                      <option>20</option>
                      <option>50</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </section>
          </>)}

          {/* FLAGS */}
          {settingsTab === 'flags' && (<>
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <SectionHeading>Device Flags</SectionHeading>
                <p className="text-[11px] text-slate-600 -mt-3 mb-3">Flags can be applied to any device. System flags are built-in and cannot be changed or deleted.</p>
              </div>
              <button
                onClick={() => {
                  const key = `flag_${Date.now()}`
                  setFlags(prev => [...prev, { key, label: '', icon: '', description: '', sort_order: 100, isSystem: false, type: 'custom', _new: true }])
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors flex-shrink-0">
                <Plus className="w-3.5 h-3.5" />New Flag
              </button>
            </div>
            <div className="border border-[#1a1a30] rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-600 uppercase tracking-wider border-b border-[#1a1a30] bg-[#080812]">
                    <th className="text-center px-3 py-2 w-10">Icon</th>
                    <th className="text-left px-3 py-2 w-28">Key</th>
                    <th className="text-left px-3 py-2">Label</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-center px-3 py-2 w-16">Rank</th>
                    <th className="px-3 py-2 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {flags.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-700 text-xs italic">No flags yet</td></tr>
                  )}
                  {flags.map(flag => (
                    <FlagRow
                      key={flag.key}
                      flag={flag}
                      onSave={async (tempKey, data) => {
                        try {
                          const existing = flags.find(f => f.key === tempKey)
                          if (existing?._new) {
                            const realKey = (data.key || data.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).slice(0, 32)
                            if (!realKey) { showToast('Key is required', 'error'); return }
                            const created = await api.network.flags.create({ key: realKey, label: data.label, icon: data.icon, description: data.description, sortOrder: Number(data.sortOrder) || 100 })
                            setFlags(prev => prev.map(f => f.key === tempKey ? { ...created } : f))
                          } else {
                            const updated = await api.network.flags.update(tempKey, { label: data.label, icon: data.icon, description: data.description, sortOrder: Number(data.sortOrder) || 0 })
                            setFlags(prev => prev.map(f => f.key === tempKey ? { ...updated } : f))
                          }
                          showToast('Flag saved')
                        } catch (err) { showToast(err.message, 'error') }
                      }}
                      onDelete={async (key) => {
                        const flag = flags.find(f => f.key === key)
                        if (flag?._new) { setFlags(prev => prev.filter(f => f.key !== key)); return }
                        if (!window.confirm(`Delete flag "${flag?.label || key}"? It will be removed from all devices.`)) return
                        try {
                          await api.network.flags.remove(key)
                          setFlags(prev => prev.filter(f => f.key !== key))
                          showToast('Flag deleted')
                        } catch (err) { showToast(err.message, 'error') }
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-600 mt-2">Icon: enter any emoji character (e.g. 🔒, 📷, 💡). It will appear on devices in the network view.</p>
          </section>
          </>)}

          {/* APPEARANCE */}
          {settingsTab === 'appearance' && (<>
          <section>
            <SectionHeading>Appearance</SectionHeading>
            <div className="grid grid-cols-7 gap-2 max-w-4xl">
              {THEMES.map(t => {
                // cache-bust the preview URL after a custom upload
                const ver = photoVersions[t.id]
                const previewBg = ver && t.photo
                  ? t.preview.replace(/url\("(\/themes\/[^"]+)"\)/, `url("$1?v=${ver}")`)
                  : t.preview
                return (
                  <div key={t.id} className={`relative flex flex-col overflow-hidden rounded-xl border-2 transition-all ${
                    theme === t.id
                      ? 'border-indigo-500 shadow-lg shadow-indigo-500/20'
                      : 'border-[#1a1a30] hover:border-[#2a2a45]'
                  }`}>
                    {/* Theme select button */}
                    <button type="button" onClick={() => onThemeChange(t.id)} className="flex flex-col w-full">
                      <div className="w-full h-14 flex-shrink-0" style={{ backgroundImage: previewBg, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                      <div className={`px-2 py-1.5 text-center ${theme === t.id ? 'bg-indigo-600/15' : 'bg-[#0a0a18]'}`}>
                        <span className="text-[10px] font-medium text-slate-300 leading-tight block">{t.label}</span>
                      </div>
                    </button>
                    {/* Upload overlay — local photo themes only */}
                    {t.photo?.startsWith('/') && (
                      <label
                        title="Upload custom photo"
                        onClick={e => e.stopPropagation()}
                        className="absolute inset-x-0 top-0 h-14 flex items-center justify-center opacity-0 hover:opacity-100 pointer-events-none hover:pointer-events-auto bg-black/50 cursor-pointer transition-opacity rounded-t-xl z-10">
                        {uploadingTheme === t.id
                          ? <Loader2 size={14} className="text-white animate-spin" />
                          : <Upload size={14} className="text-white" />}
                        <input type="file" accept="image/*" className="hidden"
                          onChange={async e => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            e.target.value = ''
                            setUploadingTheme(t.id)
                            try {
                              await api.themes.upload(t.id, file)
                              setPhotoVersions(v => ({ ...v, [t.id]: Date.now() }))
                              showToast(`${t.label} photo updated`)
                            } catch (err) {
                              showToast(err.message, 'error')
                            } finally {
                              setUploadingTheme(null)
                            }
                          }} />
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-slate-600">Hover a theme and click <Upload size={10} className="inline mb-0.5" /> to swap in your own photo.</p>

            {/* Background brightness slider — photo themes only */}
            {THEMES.find(t => t.id === theme)?.photo && (
              <div className="mt-5 space-y-2 max-w-xs">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-medium text-slate-300">Background Brightness</label>
                  <span className="text-[11px] tabular-nums text-slate-500">{Math.round((1 - bgDim / 0.95) * 100)}%</span>
                </div>
                <input
                  type="range" min="0" max="0.95" step="0.01" value={0.95 - bgDim}
                  onChange={e => {
                    const v = 0.95 - parseFloat(e.target.value)
                    setBgDim(v)
                    applyBgDim(v)
                    saveBgDim(v)
                  }}
                  className="w-full h-1.5 appearance-none rounded-full cursor-pointer"
                  style={{ background: `linear-gradient(to right, #1a1a30 ${bgDim / 0.95 * 100}%, rgb(var(--ac-500)) ${bgDim / 0.95 * 100}%)` }}
                />
                <div className="flex justify-between text-[10px] text-slate-600">
                  <span>Dark</span>
                  <span>Vivid</span>
                </div>
              </div>
            )}

            {/* Accent colour override */}
            <div className="mt-6">
              <SectionHeading>Customize Theme</SectionHeading>
              <p className="text-[11px] text-slate-500 mb-3">Override the accent colour used for buttons, highlights, and active states — independently of your chosen background theme.</p>
              <div className="flex flex-wrap gap-2 max-w-4xl">
                {ACCENT_PRESETS.map(a => {
                  const active = accent === a.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      title={a.description}
                      onClick={() => onAccentChange(a.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                        active
                          ? 'border-[rgb(var(--ac-500))] bg-[rgb(var(--ac-500))]/10 text-slate-200 shadow-sm shadow-[rgb(var(--ac-500))]/20'
                          : 'border-[#1a1a30] text-slate-400 hover:border-[#2a2a45] hover:text-slate-300'
                      }`}
                    >
                      {a.swatchHex
                        ? <span className="w-3.5 h-3.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ background: a.swatchHex }} />
                        : <span className="w-3.5 h-3.5 rounded-full flex-shrink-0 ring-1 ring-white/10 bg-[conic-gradient(from_0deg,#818cf8,#38bdf8,#34d399,#fbbf24,#f87171,#a78bfa,#818cf8)]" />
                      }
                      {a.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>
          </>)}

          {/* DATA */}
          {settingsTab === 'data' && (<>
          <section>
            <SectionHeading>Data &amp; Backup</SectionHeading>
            <div className="space-y-4">
              <Field
                label="Auto-backup every N days (0 = disabled)"
                hint="Creates a .claudette.gz backup in the claudette-data Docker volume on the Pi (/app/data/backups/). Same disk as the database — useful for accidental changes, not hardware failure. For offsite copies, use Backup Now."
                type="number" min="0" max="365"
                value={backupIntervalDays}
                onChange={e => setBackupIntervalDays(e.target.value)}
                placeholder="0"
              />
              <Field
                label="Keep auto-backups for (days)"
                hint="Auto-backups older than this are deleted from the Pi. Manual downloads are not affected."
                type="number" min="1" max="365"
                value={backupKeepDays}
                onChange={e => setBackupKeepDays(e.target.value)}
                placeholder="7"
              />
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={async () => {
                    try {
                      setBackingUp(true)
                      await api.system.backup()
                      showToast('Backup downloaded')
                    } catch (err) {
                      showToast(err.message, 'error')
                    } finally {
                      setBackingUp(false)
                    }
                  }}
                  disabled={backingUp || restoring}
                  className="flex items-center gap-2 px-3 py-2 text-xs border border-[#1a1a30] text-slate-400 hover:text-slate-200 hover:border-[#2a2a45] rounded-lg transition-colors disabled:opacity-40"
                >
                  {backingUp
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Backing up…</>
                    : <><Download className="w-3.5 h-3.5" />Backup Now</>}
                </button>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".claudette.gz"
                  className="hidden"
                  onChange={async e => {
                    e.stopPropagation() // don't mark settings dirty
                    const file = e.target.files?.[0]
                    if (!file) return
                    if (!window.confirm(`Restore from "${file.name}"?\n\nThis will overwrite the current database and config. The page will reload.`)) {
                      e.target.value = ''
                      return
                    }
                    try {
                      setRestoring(true)
                      const buf = await file.arrayBuffer()
                      await api.system.restore(buf)
                      showToast('Restore complete — reloading…')
                      setTimeout(() => window.location.reload(), 1500)
                    } catch (err) {
                      showToast(err.message, 'error')
                    } finally {
                      setRestoring(false)
                      e.target.value = ''
                    }
                  }}
                />
                <button
                  onClick={() => restoreInputRef.current?.click()}
                  disabled={backingUp || restoring}
                  className="flex items-center gap-2 px-3 py-2 text-xs border border-amber-500/30 text-amber-400/80 hover:text-amber-300 hover:border-amber-500/50 rounded-lg transition-colors disabled:opacity-40"
                >
                  {restoring
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Restoring…</>
                    : <><Upload className="w-3.5 h-3.5" />Restore from File</>}
                </button>
              </div>
              <p className="text-[11px] text-slate-600">Backup files (.claudette.gz) are gzip-compressed and contain the full database and config. Keep them somewhere safe.</p>
            </div>
            <div className="mt-6">
              <SectionHeading>Pi Backups</SectionHeading>
              <div className="space-y-3 max-w-lg">
                <div className="max-w-xs">
                  <label className="block text-xs font-medium text-slate-400">Retention (days)</label>
                  <input type="number" min="0" value={piConfig?.retention_days ?? ''} onChange={e => setPiConfig(p => ({ ...(p||{}), retention_days: e.target.value }))}
                    className="w-32 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors" />
                  <p className="text-[11px] text-slate-600 mt-1">0 = keep forever. Applies to Pi backups created by the backup manager.</p>
                </div>
                <div className="max-w-lg">
                  <label className="block text-xs font-medium text-slate-400">External paths</label>
                  <p className="text-[11px] text-slate-500 mb-2">JSON array or newline-separated list of absolute paths to include in the companion files archive.</p>
                  <textarea rows={4} value={Array.isArray(piConfig?.external_paths) ? piConfig.external_paths.join('\n') : (piConfig?.external_paths ?? '')}
                    onChange={e => setPiConfig(p => ({ ...(p||{}), external_paths: e.target.value }))}
                    className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors" />
                </div>
                <div className="flex justify-end">
                  <button disabled={!piConfig || piSaving} onClick={async () => {
                    if (!piConfig) return
                    setPiSaving(true)
                    try {
                      const ext = typeof piConfig.external_paths === 'string'
                        ? (function(){ try { return JSON.parse(piConfig.external_paths) } catch { return piConfig.external_paths.split('\n').map(s=>s.trim()).filter(Boolean) } })()
                        : piConfig.external_paths
                      await api.pis.update(1, { retention_days: parseInt(piConfig.retention_days) || 0, external_paths: ext })
                      showToast('Pi backup settings saved')
                    } catch (e) { showToast(e.message, 'error') }
                    finally { setPiSaving(false) }
                  }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm">
                    {piSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Pi settings
                  </button>
                </div>
              </div>
            </div>
          </section>
          </>)}

          </div>
        </div>
      </div>
    </>
  )
}

