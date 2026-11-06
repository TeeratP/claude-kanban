// Shared look and building blocks for the kanban teaser: colours, the
// terminal window with the kanban side pane, the board's rows, captions,
// keycaps, quick cuts and camera moves. The palette, type, easing and frame
// follow the next-steps-plus videos so the two read as one family.
import React from 'react'
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion'

export const BG = '#0d0e12'
export const PANEL = '#16171d'
export const LINE = '#262832'
export const TEXT = '#ececf0'
export const DIM = '#8a8f9b'
export const ACCENT = '#d97757'
export const MINT = '#5ee0aa'
// What needs you: the Me section's mark.
export const AMBER = '#e8c468'
export const MONO = '"SF Mono", Menlo, monospace'
export const UI = '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif'

// One colour per person on the demo board (made-up names), the same everywhere.
export const PEOPLE = { You: '#6cb6ff', Ann: '#c792ea', Bo: '#a6e22e' } as const
export type Person = keyof typeof PEOPLE
// A subagent's dot: never Claude's colour, never the one for what needs you.
export const EXPLORE = '#4fd6be'

export type SceneProps = { len: number }

// 0 → 1 over [from, from + length] frames, eased.
export function ramp(frame: number, from: number, length = 12): number {
  return interpolate(frame, [from, from + length], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  })
}

// Quick cuts: a scene snaps in (scale and fade) and out at its edges.
export const SceneCut: React.FC<{ len: number; children: React.ReactNode }> = ({ len, children }) => {
  const frame = useCurrentFrame()
  const inT = ramp(frame, 0, 8)
  const outT = ramp(frame, len - 7, 7)
  return (
    <AbsoluteFill style={{ opacity: Math.min(inT, 1 - outT), transform: `scale(${0.97 + 0.03 * inT + 0.04 * outT})` }}>
      {children}
    </AbsoluteFill>
  )
}

// The camera: a list of shots, each a frame, a zoom and the point (in the
// Stage's pixels) it centres on; between shots it eases. A zoom of 1 on the
// Stage's centre is the wide shot. It moves live DOM text with a CSS
// transform, so the text is laid out and drawn at the zoomed size, never a
// scaled bitmap. `from`: the frame the shots count from.
export type Shot = { f: number; s: number; x: number; y: number }
export const STAGE_W = 1920
export const STAGE_H = 1080 - 220
export const WIDE = { s: 1, x: STAGE_W / 2, y: STAGE_H / 2 }

export const Cam: React.FC<{ shots: Shot[]; from?: number; children: React.ReactNode }> = ({ shots, from = 0, children }) => {
  const frame = useCurrentFrame() - from
  const next = shots.findIndex(one => one.f > frame)
  const a = shots[next === -1 ? shots.length - 1 : Math.max(0, next - 1)] ?? { f: 0, ...WIDE }
  const b = next <= 0 ? a : (shots[next] ?? a)
  const t = b.f === a.f ? 0 : Easing.inOut(Easing.cubic)(Math.min(1, Math.max(0, (frame - a.f) / (b.f - a.f))))
  const s = a.s + (b.s - a.s) * t
  const x = a.x + (b.x - a.x) * t
  const y = a.y + (b.y - a.y) * t
  return (
    <AbsoluteFill
      style={{ transform: `translate(${STAGE_W / 2 - x * s}px, ${STAGE_H / 2 - y * s}px) scale(${s})`, transformOrigin: '0 0' }}
    >
      {children}
    </AbsoluteFill>
  )
}

// The camera's view starts under the caption, so a zoomed window never
// slides up behind it.
export const Stage: React.FC<{ children: React.ReactNode; top?: number }> = ({ children, top = 220 }) => (
  <div style={{ position: 'absolute', top, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>{children}</div>
)

// Big caption at the top, with an optional smaller line under it.
export const Caption: React.FC<{ title: React.ReactNode; sub?: React.ReactNode; at?: number }> = ({ title, sub, at = 4 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: frame - at, fps, config: { damping: 15, stiffness: 180 } })
  return (
    <div style={{ position: 'absolute', top: 56, left: 0, right: 0, textAlign: 'center', fontFamily: UI, zIndex: 2 }}>
      <div style={{ fontSize: 68, fontWeight: 800, color: TEXT, opacity: s, transform: `translateY(${(1 - s) * 40}px)`, letterSpacing: -1 }}>
        {title}
      </div>
      {sub === undefined ? null : (
        <div style={{ fontSize: 30, color: DIM, marginTop: 10, opacity: ramp(frame, at + 8, 12) }}>{sub}</div>
      )}
    </div>
  )
}

const Dots: React.FC = () => (
  <>
    {['#ff5f56', '#ffbd2e', '#27c93f'].map(c => (
      <div key={c} style={{ width: 15, height: 15, borderRadius: 8, background: c }} />
    ))}
  </>
)

const frameStyle = (top: number, height: number, left: number, right: number): React.CSSProperties => ({
  position: 'absolute', left, right, top, height, background: PANEL, borderRadius: 22,
  border: `1px solid ${LINE}`, boxShadow: `0 40px 140px rgba(0,0,0,0.6), 0 0 80px ${ACCENT}14`, overflow: 'hidden',
})

// A plain terminal window: title dots, then whatever is inside.
export const Terminal: React.FC<{ children: React.ReactNode; top?: number; height?: number }> = ({ children, top = 280, height = 660 }) => (
  <div style={frameStyle(top, height, 250, 250)}>
    <div style={{ height: 52, display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 22, borderBottom: `1px solid ${LINE}` }}>
      <Dots />
      <div style={{ marginLeft: 18, color: DIM, fontFamily: MONO, fontSize: 20 }}>claude</div>
    </div>
    <div style={{ padding: '26px 40px', fontFamily: MONO, fontSize: 27, lineHeight: 1.55, color: TEXT }}>{children}</div>
  </div>
)

// The kanban pane's text: 18 px on a 24.5 px terminal row, so the whole
// board (29 rows) fits the pane. The chat keeps its larger type.
export const PANE_FONT = 18
export const PANE_ROW = 24.5
const PANE_W = 960
const PANE_PAD = 16
const SPLIT_LEFT = 110
const SPLIT_TOP = 20
// The pane's first row's top is at SPLIT_TOP + 53 + PANE_PAD (89 px).
// The Split window's middle in the Stage (it is 800 px tall at SPLIT_TOP).
export const WINDOW_MID = { x: STAGE_W / 2, y: SPLIT_TOP + 400 }

// The terminal with the kanban side pane: the chat on the left, the pane on
// the right with its own tab title (`Kanban`, `Kanban · N`). `open` slides
// the pane in (0 → 1).
export const Split: React.FC<{
  chat: React.ReactNode
  pane: React.ReactNode
  paneTitle?: string
  open?: number
  top?: number
  height?: number
  tabGlow?: number
}> = ({ chat, pane, paneTitle = 'Kanban', open = 1, top = SPLIT_TOP, height = 800, tabGlow = 0 }) => {
  const paneWidth = PANE_W * open
  return (
    <div style={frameStyle(top, height, SPLIT_LEFT, SPLIT_LEFT)}>
      <div style={{ height: 52, display: 'flex', alignItems: 'center', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 22, flex: 1 }}>
          <Dots />
          <div style={{ marginLeft: 18, color: DIM, fontFamily: MONO, fontSize: 20 }}>claude</div>
        </div>
        <div
          style={{
            width: paneWidth, overflow: 'hidden', height: 52, display: 'flex', alignItems: 'center', paddingLeft: open > 0 ? 24 : 0,
            borderLeft: open > 0 ? `1px solid ${LINE}` : 'none', fontFamily: MONO, fontSize: 20, whiteSpace: 'pre',
            color: tabGlow > 0 ? AMBER : DIM, textShadow: tabGlow > 0 ? `0 0 ${18 * tabGlow}px ${AMBER}` : 'none',
          }}
        >
          {paneTitle}
        </div>
      </div>
      <div style={{ display: 'flex', height: height - 53 }}>
        <div style={{ flex: 1, padding: '22px 30px', fontFamily: MONO, fontSize: 23, lineHeight: 1.55, color: TEXT, overflow: 'hidden', position: 'relative' }}>
          {chat}
        </div>
        <div
          style={{
            width: paneWidth, overflow: 'hidden', borderLeft: open > 0 ? `1px solid ${LINE}` : 'none', background: '#14151a',
          }}
        >
          <div style={{ width: PANE_W, padding: `${PANE_PAD}px 26px`, fontFamily: MONO, fontSize: PANE_FONT, lineHeight: `${PANE_ROW}px`, color: TEXT, opacity: open }}>
            {pane}
          </div>
        </div>
      </div>
    </div>
  )
}

// One terminal or pane line; `show` slides it in from the left.
export const Line: React.FC<{ children?: React.ReactNode; dim?: boolean; show?: number; indent?: number; color?: string }> = ({
  children, dim, show = 1, indent = 0, color,
}) => (
  <div
    style={{
      color: color ?? (dim ? DIM : TEXT), opacity: show, transform: `translateX(${(1 - show) * -30}px)`,
      whiteSpace: 'pre', paddingLeft: indent, overflow: 'hidden', textOverflow: 'ellipsis',
    }}
  >
    {children ?? ' '}
  </div>
)

// The prompt box at the bottom of the chat; `glow` lights its border.
export const PromptBox: React.FC<{ children?: React.ReactNode; faint?: boolean; glow?: number }> = ({ children, faint, glow = 0 }) => (
  <div
    style={{
      marginTop: 22, border: `1px solid ${glow > 0 ? ACCENT : LINE}`, borderRadius: 12, padding: '14px 20px', minHeight: 44,
      boxShadow: `0 0 ${40 * glow}px ${ACCENT}66`,
    }}
  >
    <span style={{ color: ACCENT }}>{'> '}</span>
    <span style={{ color: faint ? DIM : TEXT, fontStyle: faint ? 'italic' : 'normal', whiteSpace: 'pre-wrap' }}>{children}</span>
  </div>
)

// A key being pressed: pops in over the empty lower part of the chat,
// above the toast lane and far left of the pane, so it is always whole in
// the frame and never covers the board's (or the chat's) text; it fades.
export const Keycap: React.FC<{ label: string; at: number }> = ({ label, at }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  if (frame < at || frame > at + 34) return null
  const s = spring({ frame: frame - at, fps, config: { damping: 10, stiffness: 220 } })
  const fade = 1 - ramp(frame, at + 24, 10)
  return (
    <div
      style={{
        position: 'absolute', left: 170, bottom: 150, minWidth: 116, height: 116, padding: '0 28px', borderRadius: 24,
        background: '#24262f', border: `3px solid ${ACCENT}`, color: TEXT, fontFamily: UI, fontSize: 54, fontWeight: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.5 + 0.5 * s})`, opacity: fade,
        boxShadow: `0 0 60px ${ACCENT}77`, zIndex: 3,
      }}
    >
      {label}
    </div>
  )
}

// A toast in the chat's corner, like the ones the mod raises.
export const Toast: React.FC<{ children: React.ReactNode; show: number; color?: string }> = ({ children, show, color = AMBER }) => (
  <div
    style={{
      position: 'absolute', left: 30, right: 30, bottom: 24, padding: '14px 20px', borderRadius: 12, background: '#1f2028',
      border: `1px solid ${color}`, boxShadow: `0 0 40px ${color}33`, color: TEXT, fontSize: 22, whiteSpace: 'pre',
      opacity: show, transform: `translateY(${(1 - show) * 30}px)`, overflow: 'hidden',
    }}
  >
    {children}
  </div>
)

// The claude-kanban mark, drawn in code: three columns with cards, the
// middle one (Claude's) lit in the accent.
export const KanbanMark: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => {
  const u = size / 100
  const cols: Array<{ x: number; cards: number[]; color: string }> = [
    { x: 16, cards: [22, 42, 62], color: '#3a3d4a' },
    { x: 40, cards: [22, 42], color: ACCENT },
    { x: 64, cards: [22], color: MINT },
  ]
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 24 * u, background: 'linear-gradient(160deg, #23252f 0%, #15161c 100%)',
        border: `${Math.max(1, 1.5 * u)}px solid #343744`, position: 'relative', boxShadow: `0 ${10 * u}px ${40 * u}px rgba(0,0,0,0.5)`,
        ...style,
      }}
    >
      {cols.map(col => (
        <React.Fragment key={col.x}>
          <div style={{ position: 'absolute', left: col.x * u, top: 12 * u, width: 20 * u, height: 4 * u, borderRadius: 2 * u, background: col.color, opacity: 0.9 }} />
          {col.cards.map(y => (
            <div
              key={y}
              style={{
                position: 'absolute', left: col.x * u, top: y * u, width: 20 * u, height: 15 * u, borderRadius: 4 * u,
                background: col.color, opacity: col.color === '#3a3d4a' ? 1 : 0.95,
                boxShadow: col.color === ACCENT ? `0 0 ${12 * u}px ${ACCENT}88` : 'none',
              }}
            />
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}

// ── The board's rows, as the pane draws them ────────────────────────────
// Every row is one terminal row (PANE_ROW px) with no margins, and every
// column is counted in cells (`ch`), as in hooks/layout.ts and
// hooks/board-rows.ts: a 2-cell indent, the number right-aligned in the
// number column, a space, the title; ages are 3 cells flush right.

// Cells before a card's number, and the width of the number column (`#25`).
const INDENT = 2
const NUM = 3
// The cell a card's title starts at: titles, empty lines, second rows and
// `more` rows all start here.
const TITLE_AT = INDENT + NUM + 1
const AGE = 3
// Someone else's name beside a title takes at most this many cells.
const OWNER_CELLS = 8
const ch = (n: number) => `${n}ch`

// A key and its label, as on the pane's buttons: `r: Refresh`.
export const Btn: React.FC<{ k: string; label: string; lit?: number }> = ({ k, label, lit = 0 }) => (
  <span style={{ textShadow: lit > 0 ? `0 0 ${20 * lit}px ${ACCENT}` : 'none' }}>
    <span style={{ color: ACCENT }}>{k}</span>
    <span>: {label}</span>
  </span>
)

// The two-row toolbar: the dim status row, then the buttons.
const Toolbar: React.FC<{ status: string; view: View; viewLit: number }> = ({ status, view, viewLit }) => (
  <>
    <div style={{ display: 'flex', color: DIM, whiteSpace: 'pre' }}>
      <span style={{ flex: 1 }}>{status}</span>
      <span>s: Settings</span>
    </div>
    <div style={{ whiteSpace: 'pre' }}>
      <Btn k="r" label="Refresh" />{'   '}<Btn k="n" label="New" />{'   '}<Btn k="v" label={view} lit={viewLit} />{'   '}<Btn k="f" label="Find" />
    </div>
  </>
)

// A group's header: `▾ Active`, or a folded one with what it holds.
const GroupHeader: React.FC<{ name: string; open: boolean; summary?: React.ReactNode }> = ({ name, open, summary }) => (
  <div style={{ whiteSpace: 'pre', fontWeight: 700 }}>
    <span style={{ color: ACCENT }}>{open ? '▾' : '▸'}</span> {name}
    {summary === undefined ? null : <span style={{ color: DIM, fontWeight: 400 }}>{'   '}{summary}</span>}
  </div>
)

// The insertion line a drag draws under the row the card would land after:
// the terminal's underline, run to the pane's edge.
const INSERT_LINE = `inset 0 -2px 0 ${TEXT}`

// A section's header: indent, name, `N mine · M all`, a rule to the right
// edge, `[copy]`. `lit`: a dragged card would land in this section, so its
// name is drawn inverse; `line`: the drop's insertion line runs under it.
const SectionHeader: React.FC<{ name: string; count: string; color: string; lit: boolean; line: boolean }> = ({
  name, count, color, lit, line,
}) => (
  <div style={{ display: 'flex', alignItems: 'center', whiteSpace: 'pre', paddingLeft: ch(INDENT), boxShadow: line ? INSERT_LINE : 'none' }}>
    <span style={{ color: lit ? BG : color, background: lit ? color : 'transparent', fontWeight: 700 }}>{name}</span>
    <span style={{ color: DIM }}> {count} </span>
    <div style={{ flex: 1, borderTop: `1px solid ${LINE}` }} />
    <span style={{ color: DIM }}> [copy]</span>
  </div>
)

export type Card = {
  n: number
  title: string
  age: string
  owner?: Person
  // The dim second row under a card in Claude.
  activity?: React.ReactNode
  // 0 → 1: the card slides in and glows (just arrived).
  arrive?: number
  // The pointer rests on it: `[copy]` in place of its age.
  hover?: boolean
  // A `⟳` or `✓` sync glyph before the age.
  sync?: string
  // Being dragged: stays in its place, dim and slanted, with a `›` in front.
  lifted?: boolean
  // The keyboard cursor rests on it.
  cursor?: boolean
}

// A card row: the number right-aligned in its column, the title in its
// owner's colour, someone else's name dim after it (not in Mine), and flush
// right a sync glyph and the age, or `[copy]` under the pointer.
const CardRow: React.FC<{ card: Card; named: boolean; line: boolean }> = ({ card, named, line }) => {
  const lifted = card.lifted === true
  const a = card.arrive ?? 1
  const glow = card.arrive === undefined ? 0 : 1 - ramp(a * 30, 10, 20)
  const ownerColor = card.owner === undefined ? TEXT : PEOPLE[card.owner]
  const owner = named && card.owner !== undefined && card.owner !== 'You' ? card.owner.slice(0, OWNER_CELLS) : ''
  return (
    <>
      <div
        style={{
          display: 'flex', whiteSpace: 'pre', opacity: lifted ? 0.5 : Math.min(1, a * 1.5), fontStyle: lifted ? 'italic' : 'normal',
          transform: `translateX(${(1 - a) * 40}px)`, borderRadius: 4,
          background: glow > 0 ? `rgba(217,119,87,${0.22 * glow})` : card.hover || card.cursor ? '#23252e' : 'transparent',
          outline: card.cursor ? `2px solid ${ACCENT}` : 'none',
          boxShadow: glow > 0 ? `0 0 ${30 * glow}px ${ACCENT}55` : line ? INSERT_LINE : 'none',
        }}
      >
        <span style={{ width: ch(INDENT), color: TEXT, fontWeight: 700, fontStyle: 'normal', textAlign: 'right' }}>{lifted ? '› ' : ''}</span>
        <span style={{ width: ch(NUM), textAlign: 'right', color: DIM }}>#{card.n}</span>
        <span style={{ marginLeft: '1ch', color: ownerColor }}>{card.title}</span>
        {owner === '' ? null : <span style={{ color: DIM }}> {owner}</span>}
        <span style={{ flex: 1, minWidth: '2ch' }} />
        {card.hover ? (
          <span style={{ color: ACCENT }}>[copy]</span>
        ) : (
          <>
            {card.sync === undefined ? null : <span style={{ color: card.sync === '✓' ? MINT : ACCENT }}>{card.sync} </span>}
            <span style={{ color: DIM, width: ch(AGE), textAlign: 'right' }}>{card.age}</span>
          </>
        )}
      </div>
      {card.activity === undefined ? null : (
        <div style={{ whiteSpace: 'pre', color: DIM, paddingLeft: ch(TITLE_AT), opacity: Math.min(1, a * 1.5) }}>{card.activity}</div>
      )}
    </>
  )
}

// A spare row in a section: a quiet dot under the number column's last cell.
const SlotRow: React.FC = () => (
  <div style={{ whiteSpace: 'pre', color: DIM, paddingLeft: ch(TITLE_AT - 2), opacity: 0.5 }}>·</div>
)

// A dim row that starts at the title cell: `↓ 3 more`, a section's empty line.
const TextRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ whiteSpace: 'pre', color: DIM, paddingLeft: ch(TITLE_AT) }}>{children}</div>
)

// The agents' dots on a Claude card's second row: `●● Explore · ⟳ Grep redirect · 1m · 12k`.
export const Activity: React.FC<{ dots: string[]; who: string; doing: string; time: string; tok: string }> = ({ dots, who, doing, time, tok }) => (
  <span>
    {dots.map((c, i) => (
      <span key={i} style={{ color: c }}>●</span>
    ))}
    {` ${who} · `}
    <span style={{ color: doing.startsWith('⟳') ? TEXT : DIM }}>{doing}</span>
    {` · ${time} · ${tok}`}
  </span>
)

// The pane's views, as `v` steps through them.
export type View = 'Mine + open' | 'Everyone'

// What a view lets through: Mine + open shows your cards and nobody's.
const shows = (view: View, card: Card) => view === 'Everyone' || card.owner === undefined || card.owner === 'You'

// Rows under each section's header, the same for all three sections.
export const SECTION_BODY = 7

// A section: its header (counting every card in it, shown or not), then a
// window of SECTION_BODY rows: the cards that fit, a `↓ N more` row when
// some do not, and dotted spare rows (or the empty line) after them.
const Section: React.FC<{
  name: string
  cards: Card[]
  view: View
  empty: React.ReactNode
  color: string
  drop?: number
}> = ({ name, cards, view, empty, color, drop }) => {
  const shown = cards.filter(c => shows(view, c))
  const sizes = shown.map(c => (c.activity === undefined ? 1 : 2))
  const fits = sizes.reduce((s, n) => s + n, 0) <= SECTION_BODY
  let used = 0
  let taken = 0
  if (fits) {
    taken = shown.length
    used = sizes.reduce((s, n) => s + n, 0)
  } else {
    while (taken < shown.length && used + (sizes[taken] ?? 1) <= SECTION_BODY - 1) used += sizes[taken++] ?? 1
  }
  const below = shown.length - taken
  const rows = used + (below > 0 ? 1 : 0) + (shown.length === 0 ? 1 : 0)
  const mine = cards.filter(c => c.owner === 'You').length
  return (
    <>
      <SectionHeader name={name} count={`${mine} mine · ${cards.length} all`} color={color} lit={drop !== undefined} line={drop === -1} />
      {shown.slice(0, taken).map((c, i) => (
        <CardRow key={c.n} card={c} named line={drop === i} />
      ))}
      {below > 0 ? <TextRow>↓ {below} more</TextRow> : null}
      {shown.length === 0 ? <TextRow>{empty}</TextRow> : null}
      {Array.from({ length: Math.max(0, SECTION_BODY - rows) }, (_, i) =>
        shown.length === 0 ? <div key={i}>{'\u00a0'}</div> : <SlotRow key={i} />,
      )}
    </>
  )
}

// The last row of the list: each person in their colour, you first.
const PeopleRow: React.FC<{ lit?: number }> = ({ lit = 0 }) => (
  <div style={{ whiteSpace: 'pre', paddingLeft: ch(INDENT) }}>
    {(Object.keys(PEOPLE) as Person[]).map((p, i) => (
      <span key={p} style={{ color: PEOPLE[p], textShadow: lit > 0 ? `0 0 ${18 * lit}px ${PEOPLE[p]}` : 'none' }}>
        {i === 0 ? '' : '  '}● {p}
      </span>
    ))}
  </div>
)

// The rows the board takes, top to bottom, and where a row sits in the
// pane, so a camera or a pointer can find it: the toolbar (0, 1), Active (2),
// Backlog's header (3), Claude's (11), Me's (19), Inactive (27), people (28).
export const ROW = {
  backlog: 3,
  claude: 3 + SECTION_BODY + 1,
  me: 3 + 2 * (SECTION_BODY + 1),
  inactive: 3 + 3 * (SECTION_BODY + 1),
  people: 4 + 3 * (SECTION_BODY + 1),
}

// The whole board in the pane: toolbar, Active open, Inactive folded, the
// people row. Sections get every card they hold; the view picks which show,
// and the headers count them all.
export const Board: React.FC<{
  backlog: Card[]
  claude: Card[]
  me: Card[]
  inactive?: React.ReactNode
  view?: View
  viewLit?: number
  status?: string
  peopleLit?: number
  // Where a dragged card would land: its section, and the row it goes under
  // (-1: under the header).
  drop?: { section: 'backlog' | 'claude' | 'me'; lineAfter: number }
}> = ({
  backlog, claude, me, inactive = '12 Done · 2 Cancelled · 1 Suspended', view = 'Mine + open', viewLit = 0,
  status = 'GitHub · #7 Demo board · updated just now', peopleLit, drop,
}) => (
  <>
    <Toolbar view={view} viewLit={viewLit} status={status} />
    <GroupHeader name="Active" open />
    <Section name="Backlog" cards={backlog} view={view} empty="Nothing yet · n adds a card" color={TEXT} drop={drop?.section === 'backlog' ? drop.lineAfter : undefined} />
    <Section name="Claude" cards={claude} view={view} empty="Idle · drag a card here" color={ACCENT} drop={drop?.section === 'claude' ? drop.lineAfter : undefined} />
    <Section
      name="Me"
      cards={me}
      view={view}
      empty={<><span style={{ color: MINT }}>✓ </span>All clear, nothing needs you</>}
      color={AMBER}
      drop={drop?.section === 'me' ? drop.lineAfter : undefined}
    />
    <GroupHeader name="Inactive" open={false} summary={inactive} />
    <PeopleRow lit={peopleLit} />
  </>
)

// The card's detail view in Me: nav, where it stands, the actions, Claude's
// handoff with its Run check button, the feedback box.
export const Detail: React.FC<{ approve: number }> = ({ approve }) => (
  <>
    <div style={{ display: 'flex', whiteSpace: 'pre' }}>
      <Btn k="b" label="← Board" />
      <span style={{ flex: 1 }} />
      <Btn k="k" label="‹ Prev" />
      <span style={{ color: DIM }}>{'  1/1  '}</span>
      <Btn k="n" label="Next ›" />
    </div>
    <div style={{ marginTop: 14, fontSize: 28, fontWeight: 700, fontFamily: UI }}>#12 Fix login redirect</div>
    <div style={{ color: DIM, whiteSpace: 'pre' }}>
      <span style={{ color: AMBER }}>Me</span> · in review · updated just now · <span style={{ textDecoration: 'underline' }}>GitHub</span>
    </div>
    <div style={{ marginTop: 14, whiteSpace: 'pre' }}>
      <span
        style={{
          padding: '4px 10px', borderRadius: 8, border: `1px solid ${approve > 0 ? MINT : LINE}`,
          boxShadow: approve > 0 ? `0 0 ${30 * approve}px ${MINT}` : 'none', background: approve > 0 ? `${MINT}22` : 'transparent',
        }}
      >
        <Btn k="a" label="Approve" />
      </span>
      {'   '}
      <Btn k="s" label="Send back" />
      {'   '}
      <Btn k="p" label="Park" />
    </div>
    <div style={{ marginTop: 18, fontWeight: 700 }}>
      <span style={{ color: ACCENT }}>Claude's</span> handoff
    </div>
    {(
      [
        ['Did', 'Fixed the redirect after sign-in; added a test.'],
        ['Check', ''],
        ['Changed', 'src/auth.ts, tests/auth.test.ts'],
        ['Need', 'Your OK on the new redirect.'],
      ] as const
    ).map(([k, v]) => (
      <div key={k} style={{ display: 'flex', whiteSpace: 'pre' }}>
        <span style={{ width: '9ch', color: DIM }}>{k}</span>
        {k === 'Check' ? (
          <span style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '0 10px', background: '#1f2129' }}>Run check: npm test</span>
        ) : (
          <span>{v}</span>
        )}
      </div>
    ))}
    <div style={{ marginTop: 16, color: DIM }}>Feedback</div>
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 14px', color: DIM, fontStyle: 'italic' }}>
      What should Claude change?
    </div>
  </>
)

// Swaps one pane view for another: `to` fades in over `from`, so the pane is
// never empty between them. `t` runs 0 → 1.
export const CrossFade: React.FC<{ t: number; from: React.ReactNode; to: React.ReactNode }> = ({ t, from, to }) => (
  <div style={{ position: 'relative' }}>
    {t < 1 ? <div style={{ position: 'absolute', top: 0, left: 0, right: 0, opacity: 1 - t }}>{from}</div> : null}
    <div style={{ opacity: t }}>{to}</div>
  </div>
)

// A mouse pointer, drawn in code.
export const Pointer: React.FC<{ x: number; y: number; show: number }> = ({ x, y, show }) => (
  <svg width="34" height="44" viewBox="0 0 17 22" style={{ position: 'absolute', left: x, top: y, opacity: show, zIndex: 4, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.6))' }}>
    <path d="M1 1 L1 17 L5.5 13 L8.5 20 L11 19 L8 12 L14 12 Z" fill="#ffffff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
)

// Plays scenes back to back over a music track.
export const Reel: React.FC<{ music: string; scenes: Array<[React.FC<SceneProps>, number]> }> = ({ music, scenes }) => {
  let from = 0
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 30%, #1a1c24 0%, ${BG} 70%)` }}>
      <Audio src={staticFile(music)} />
      {scenes.map(([Scene, len], i) => {
        const start = from
        from += len
        return (
          <Sequence key={i} from={start} durationInFrames={len}>
            <SceneCut len={len}>
              <Scene len={len} />
            </SceneCut>
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

export function reelFrames(scenes: Array<[unknown, number]>): number {
  return scenes.reduce((sum, [, len]) => sum + len, 0)
}
