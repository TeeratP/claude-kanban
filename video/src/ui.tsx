// Shared look and building blocks for the kanban videos: colours, the
// terminal window with the kanban side pane, the board's rows, captions,
// keycaps, quick cuts and camera moves. The palette, type, easing and frame
// follow the next-steps-plus videos so the two read as one family. Each
// video (the 45 s intro, the 25 s teaser) is its own script built from these.
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

// A slow camera push over a scene: scales from `from` to `to`, centred on a
// point (fractions of the frame), with a smooth ease.
export const Camera: React.FC<{ len: number; from?: number; to?: number; x?: number; y?: number; children: React.ReactNode }> = ({
  len, from = 1, to = 1.1, x = 0.5, y = 0.55, children,
}) => {
  const frame = useCurrentFrame()
  const s = interpolate(frame, [0, len], [from, to], { easing: Easing.inOut(Easing.quad), extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ transform: `scale(${s})`, transformOrigin: `${x * 100}% ${y * 100}%` }}>{children}</AbsoluteFill>
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
}> = ({ chat, pane, paneTitle = 'Kanban', open = 1, top = 20, height = 800, tabGlow = 0 }) => {
  const paneWidth = 960 * open
  return (
    <div style={frameStyle(top, height, 110, 110)}>
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
          <div style={{ width: 960, padding: '16px 26px', fontFamily: MONO, fontSize: 23, lineHeight: 1.5, color: TEXT, opacity: open }}>
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

// A key being pressed: pops in at the bottom right and fades.
export const Keycap: React.FC<{ label: string; at: number }> = ({ label, at }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  if (frame < at || frame > at + 34) return null
  const s = spring({ frame: frame - at, fps, config: { damping: 10, stiffness: 220 } })
  const fade = 1 - ramp(frame, at + 24, 10)
  return (
    <div
      style={{
        position: 'absolute', right: 70, bottom: 60, minWidth: 116, height: 116, padding: '0 28px', borderRadius: 24,
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

// A key and its label, as on the pane's buttons: `r: Refresh`.
export const Btn: React.FC<{ k: string; label: string; lit?: number }> = ({ k, label, lit = 0 }) => (
  <span style={{ textShadow: lit > 0 ? `0 0 ${20 * lit}px ${ACCENT}` : 'none' }}>
    <span style={{ color: ACCENT }}>{k}</span>
    <span>: {label}</span>
  </span>
)

// The two-row toolbar: the dim status row, then the buttons.
export const Toolbar: React.FC<{ status?: string; view?: string; viewLit?: number }> = ({
  status = 'GitHub · #7 Demo board · updated just now', view = 'Mine + open', viewLit = 0,
}) => (
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
export const GroupHeader: React.FC<{ name: string; open: boolean; summary?: React.ReactNode }> = ({ name, open, summary }) => (
  <div style={{ whiteSpace: 'pre', marginTop: 6, fontWeight: 700 }}>
    <span style={{ color: ACCENT }}>{open ? '▾' : '▸'}</span> {name}
    {summary === undefined ? null : <span style={{ color: DIM, fontWeight: 400 }}>{'   '}{summary}</span>}
  </div>
)

// A section's header: name and count, a rule to the right edge, `[copy]`.
export const SectionHeader: React.FC<{ name: string; count: string; color?: string; copy?: boolean }> = ({
  name, count, color = TEXT, copy = true,
}) => (
  <div style={{ display: 'flex', alignItems: 'center', whiteSpace: 'pre', marginTop: 4 }}>
    <span style={{ color, fontWeight: 700 }}>{name}</span>
    <span style={{ color: DIM }}> {count} </span>
    <div style={{ flex: 1, borderTop: `1px solid ${LINE}`, margin: '0 12px' }} />
    {copy ? <span style={{ color: DIM }}>[copy]</span> : null}
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
  // Lifted by a drag: drawn faint in its place.
  lifted?: boolean
  // Shown only in the Everyone view.
  showOwnerName?: boolean
  // The keyboard cursor rests on it.
  cursor?: boolean
}

const NUM_W = '4ch'

// A card row: right-aligned number, title (in its owner's colour), the
// owner's name dim for someone else's card, and flush right a sync glyph and
// its age.
export const CardRow: React.FC<{ card: Card }> = ({ card }) => {
  const a = card.arrive ?? 1
  const glow = card.arrive === undefined ? 0 : 1 - ramp(a * 30, 10, 20)
  const ownerColor = card.owner === undefined ? TEXT : PEOPLE[card.owner]
  return (
    <>
      <div
        style={{
          display: 'flex', whiteSpace: 'pre', opacity: card.lifted ? 0.3 : Math.min(1, a * 1.5),
          transform: `translateX(${(1 - a) * 40}px)`, borderRadius: 6,
          background: glow > 0 ? `rgba(217,119,87,${0.22 * glow})` : card.hover || card.cursor ? '#23252e' : 'transparent',
          outline: card.cursor ? `2px solid ${ACCENT}` : 'none',
          boxShadow: glow > 0 ? `0 0 ${30 * glow}px ${ACCENT}55` : 'none',
        }}
      >
        <span style={{ width: NUM_W, textAlign: 'right', color: DIM }}>#{card.n}</span>
        <span style={{ marginLeft: '1ch', color: ownerColor }}>{card.title}</span>
        {card.owner !== undefined && card.owner !== 'You' && card.showOwnerName ? (
          <span style={{ color: DIM }}>  {card.owner}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {card.sync === undefined ? null : <span style={{ color: card.sync === '✓' ? MINT : ACCENT }}>{card.sync} </span>}
        <span style={{ color: card.hover ? ACCENT : DIM, minWidth: '6ch', textAlign: 'right' }}>{card.hover ? '[copy]' : card.age}</span>
      </div>
      {card.activity === undefined ? null : (
        <div style={{ whiteSpace: 'pre', color: DIM, paddingLeft: `calc(${NUM_W} + 1ch)`, opacity: Math.min(1, a * 1.5) }}>{card.activity}</div>
      )}
    </>
  )
}

// The room left under a section's cards: a quiet dot under the numbers.
export const SpareRow: React.FC<{ text?: string }> = ({ text }) => (
  <div style={{ display: 'flex', whiteSpace: 'pre', color: DIM }}>
    <span style={{ width: NUM_W, textAlign: 'right', opacity: text === undefined ? 0.5 : 1 }}>{text === undefined ? '·' : ''}</span>
    {text === undefined ? null : <span style={{ marginLeft: '1ch' }}>{text}</span>}
  </div>
)

// The agents' dots on a Claude card's second row: `●● Explore · idle 3m · 12m · 48k`.
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

// A section: its header, its cards, then spare rows (or the empty line)
// up to a fixed height, so nothing jumps when a card moves.
export const Section: React.FC<{
  name: string
  cards: Card[]
  rows: number
  empty: string
  color?: string
  everyone?: boolean
  // Other people's cards the view hides: the header still counts them.
  hidden?: number
}> = ({ name, cards, rows, empty, color, everyone, hidden = 0 }) => {
  const mine = cards.filter(c => c.owner === 'You').length
  const used = cards.reduce((sum, c) => sum + (c.activity === undefined ? 1 : 2), 0)
  return (
    <>
      <SectionHeader name={name} count={`${mine} mine · ${cards.length + hidden} all`} color={color} />
      {cards.map(c => (
        <CardRow key={c.n} card={{ ...c, showOwnerName: everyone }} />
      ))}
      {cards.length === 0 ? <SpareRow text={empty} /> : null}
      {Array.from({ length: Math.max(0, rows - Math.max(used, 1)) }, (_, i) => (
        <SpareRow key={i} />
      ))}
    </>
  )
}

// The last row of the list: each person in their colour, you first.
export const PeopleRow: React.FC<{ show?: number }> = ({ show = 1 }) => (
  <div style={{ whiteSpace: 'pre', opacity: show, marginTop: 6 }}>
    {(Object.keys(PEOPLE) as Person[]).map((p, i) => (
      <span key={p} style={{ color: PEOPLE[p] }}>
        {i === 0 ? '' : '  '}● {p}
      </span>
    ))}
  </div>
)

// The whole board in the pane: toolbar, Active open, Inactive folded. Ann's
// and Bo's two Backlog cards show only in the Everyone view, but count always.
export const Board: React.FC<{
  backlog: Card[]
  claude: Card[]
  me: Card[]
  inactive?: React.ReactNode
  view?: string
  viewLit?: number
  status?: string
  people?: number
  everyone?: boolean
}> = ({ backlog, claude, me, inactive = '12 Done · 2 Cancelled · 1 Suspended', view, viewLit, status, people = 0, everyone }) => (
  <>
    <Toolbar view={view} viewLit={viewLit} status={status} />
    <GroupHeader name="Active" open />
    <Section name="Backlog" cards={backlog} rows={4} empty="Nothing yet · n adds a card" everyone={everyone} hidden={everyone ? 0 : 2} />
    <Section name="Claude" cards={claude} rows={3} empty="Idle · drag a card here" color={ACCENT} everyone={everyone} />
    <Section name="Me" cards={me} rows={2} empty="✓ All clear, nothing needs you" color={AMBER} everyone={everyone} />
    <GroupHeader name="Inactive" open={false} summary={inactive} />
    {people > 0 ? <PeopleRow show={people} /> : null}
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
