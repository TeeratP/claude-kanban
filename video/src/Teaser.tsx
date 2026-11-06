// The 25 s claude-kanban teaser: a
// 3 s hook, the logo on the drop, one continuous hero shot (a card goes to
// Claude, Claude works it live, hands it to you, you approve), a fast montage
// of the rest, and the end card. 120 BPM: a beat is 15 frames. All timing
// lives in timing.json, which scripts/music.py reads too: the logo slams in
// on the drop, keys land on beats, the music slows on the end card. The
// board is a made-up demo board.
import React from 'react'
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import {
  ACCENT, Activity, Board, Cam, Caption, Card, CrossFade, DIM, Detail, EXPLORE, KanbanMark, Keycap, LINE, Line, MINT, MONO,
  PANE_ROW, PANEL, Pointer, PromptBox, ROW, Reel, SceneProps, Shot, Split, Stage, TEXT, Terminal, Toast, UI, View,
  WINDOW_MID, ramp, reelFrames,
} from './ui'
import timing from './timing.json'

const T = timing.teaser

// The demo board (made up): yours, nobody's, and Ann's and Bo's. Mine + open
// shows yours and nobody's; the headers count every card in the section.
const C11: Card = { n: 11, title: 'Check the pricing page copy', age: '1d', owner: 'Ann' }
const C12: Card = { n: 12, title: 'Fix login redirect', age: '2d' }
const C13: Card = { n: 13, title: 'Add retries to webhooks', age: '3h', owner: 'Bo' }
const C14: Card = { n: 14, title: 'Add dark mode toggle', age: '5h', owner: 'You' }
const C15: Card = { n: 15, title: 'Cache search results', age: '1d' }
const C16: Card = { n: 16, title: 'Update onboarding copy', age: '3h', owner: 'You' }
const C17: Card = { n: 17, title: 'Retry failed uploads', age: '4h', owner: 'Ann' }
const C18: Card = { n: 18, title: 'Speed up the CI cache', age: '6h', owner: 'Bo' }
const C19: Card = { n: 19, title: 'Add CSV export', age: '2d' }
const C20: Card = { n: 20, title: 'Pin the lint version', age: '1h', owner: 'You' }
const C21: Card = { n: 21, title: 'Show unread count in tab', age: '4d' }
const C22: Card = { n: 22, title: 'Tidy the settings page', age: '5d', owner: 'Ann' }
const C23: Card = { n: 23, title: 'Lazy-load profile images', age: '1w' }
const C24: Card = { n: 24, title: 'Fix date picker on Safari', age: '6d' }
const C25: Card = { n: 25, title: 'Add a keyboard help sheet', age: '2w' }
// Backlog under its top card (#12, then #14 in the montage), in board order.
const REST = [C17, C15, C16, C18, C19, C22, C21, C23, C24, C25]
const DONE_13 = '13 Done · 2 Cancelled · 1 Suspended'

// The calm camera: the hero opens on the whole window and pushes in once,
// slowly, to HELD, centred on the window; the montage holds that framing.
// It never zooms back out. The window stays whole inside the Stage at HELD.
const HELD: Shot = { f: 0, s: 1.06, ...WINDOW_MID }

// 0-3 s. The hook: where does the work stand? One command.
const Hook: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame()
  const [press] = T.keys.hook
  const typed = '/kanban'.slice(0, Math.max(0, Math.floor((frame - 26) / 4)))
  return (
    <AbsoluteFill>
      <Caption title="Who holds the ball?" at={2} />
      <Terminal top={250} height={500}>
        <Line dim>⏺ Done. Fixed the typo in the footer.</Line>
        <Line />
        <Line show={ramp(frame, 4, 8)}>{'> what is next, and what waits on me?'}</Line>
        <Line dim show={ramp(frame, 10, 8)}>⏺ Checking the issues, the board, TODO.md</Line>
        <Line dim show={ramp(frame, 14, 8)}>{'  and yesterday’s chat…'}</Line>
        <PromptBox>{typed}</PromptBox>
      </Terminal>
      <Keycap label="Enter" at={press} />
    </AbsoluteFill>
  )
}

// 3-5 s. The drop: flash, the mark slams in, the promise.
const Slam: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame, fps, config: { damping: 9, stiffness: 200 } })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: UI }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 45%, ${ACCENT}bb 0%, transparent 55%)`, opacity: 1 - ramp(frame, 0, 8) }} />
      <KanbanMark size={300} style={{ transform: `scale(${2.4 - 1.4 * s})`, opacity: Math.min(1, s * 1.6) }} />
      <div style={{ marginTop: 40, fontSize: 64, fontWeight: 800, color: TEXT, opacity: ramp(frame, 14, 8), letterSpacing: -1 }}>
        Who holds the ball, <span style={{ color: ACCENT }}>at a glance.</span>
      </div>
    </AbsoluteFill>
  )
}

// 5-13 s. One continuous shot: m c sends #12 to Claude, Claude works it
// live, hands it to you (Kanban · 1), you open it and press a: Done. The
// camera opens on the whole window and pushes in once, slowly, over the
// whole scene; the cursor, the lit rows and the toasts point at the action.
const Hero: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const [m, c, approve] = T.keys.hero
  const moved = frame >= c
  const handed = 132
  const detailAt = 152
  const done = frame >= approve + 10
  const inMe = frame >= handed && !done
  // The second row follows the chat: each step shows a few frames after its
  // chat line (Explore c + 16, Edit 98, Bash 118).
  const activity =
    frame < 102 ? (
      <Activity dots={[ACCENT, EXPLORE]} who="Explore" doing="⟳ Grep redirect" time="1m" tok="12k" />
    ) : frame < 122 ? (
      <Activity dots={[ACCENT, EXPLORE]} who="Claude" doing="⟳ Edit src/auth.ts" time="4m" tok="31k" />
    ) : (
      <Activity dots={[ACCENT, EXPLORE]} who="Claude" doing="⟳ Bash npm test" time="7m" tok="48k" />
    )
  const live: Card = {
    ...C12, owner: 'You', age: 'now', arrive: ramp(frame, c, 12),
    sync: frame < c + 12 ? '⟳' : frame < c + 30 ? '✓' : undefined,
    activity: frame >= c + 20 ? activity : undefined,
  }
  const backlog = moved ? [C14, ...REST] : [{ ...C12, cursor: frame >= 10 }, C14, ...REST]
  const doneGlow = done ? 1 - ramp(frame, approve + 10, 40) : 0
  const phase = done ? 'done' : frame >= handed ? 'handoff' : 'take'
  const captions = {
    take: { title: 'A card goes to Claude', sub: 'm c: Claude starts the work, and you see it live', at: 4 },
    handoff: { title: 'Claude hands it to you', sub: 'a handoff: what it did, how to check it, what it needs', at: handed },
    done: { title: 'Approve. Done.', sub: 'the issue closes on GitHub', at: approve + 10 },
  }[phase]
  const work = (from: number) => ramp(frame, from, 8)
  const approved = frame >= approve ? 1 - ramp(frame, approve, 20) * 0.5 : 0
  // The live board; the detail fades in over it, and the board after Approve
  // over the detail, so the pane is never empty.
  const board = (
    <Board
      backlog={backlog}
      claude={[...(moved && !inMe ? [live] : []), C20, C13]}
      me={[...(inMe ? [{ ...C12, owner: 'You' as const, age: 'now', arrive: ramp(frame, handed, 12) }] : []), C11]}
    />
  )
  const shots: Shot[] = [{ ...HELD, f: 0, s: 1 }, { ...HELD, f: len }]
  return (
    <AbsoluteFill>
      <Caption key={phase} title={captions.title} sub={captions.sub} at={captions.at} />
      <Stage>
        <Cam shots={shots}>
          <Split
            paneTitle={inMe ? 'Kanban · 1' : 'Kanban'}
            tabGlow={inMe ? 1 - ramp(frame, handed, 40) * 0.5 : 0}
            chat={
              <>
                <Line dim>⏺ Kanban pane opened.</Line>
                <Line show={work(c + 4)}>⏺ kanban_show(card: 12)</Line>
                <Line show={work(c + 16)}>⏺ Explore(Find the redirect code)</Line>
                <Line show={work(98)}>⏺ Edit(src/auth.ts)</Line>
                <Line show={work(118)}>⏺ Bash(npm test)</Line>
                <Line dim show={work(124)}>{'  ⎿ 42 passed'}</Line>
                <Line show={work(128)}>⏺ kanban_handoff(card: 12, …)</Line>
                <Line show={work(handed)}>⏺ kanban_move(card: 12, to: "human")</Line>
                <Toast show={frame >= handed + 4 && frame < detailAt + 8 ? ramp(frame, handed + 4, 8) * (1 - ramp(frame, detailAt, 8)) : 0}>
                  Waiting on you: #12 Fix login redirect
                </Toast>
              </>
            }
            pane={
              frame < detailAt ? (
                board
              ) : !done ? (
                <CrossFade t={ramp(frame, detailAt, 6)} from={board} to={<Detail approve={approved} />} />
              ) : (
                <CrossFade
                  t={ramp(frame, approve + 10, 6)}
                  from={<Detail approve={approved} />}
                  to={
                    <Board
                      backlog={[C14, ...REST]}
                      claude={[C20, C13]}
                      me={[C11]}
                      inactive={
                        <span>
                          <span style={{ color: MINT, textShadow: `0 0 ${24 * doneGlow}px ${MINT}` }}>13 Done</span> · 2 Cancelled · 1 Suspended
                        </span>
                      }
                    />
                  }
                />
              )
            }
          />
        </Cam>
      </Stage>
      <Keycap label="m" at={m} />
      <Keycap label="c" at={c} />
      <Keycap label="a" at={approve} />
    </AbsoluteFill>
  )
}

// 13-19 s. Three quick beats, two bars each, of what else it does, each on
// the whole board, held still at the hero's last framing; the pointer and
// the lit rows show where to look. 1: drag #14 into Claude. 2: v steps to
// Everyone (Ann's and Bo's cards, their names, the people row). 3: [copy].
const Montage: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const beat = Math.floor(len / 3)
  const i = Math.min(2, Math.floor(frame / beat))
  const local = frame - i * beat
  // The montage's keys, as frames inside their own beat.
  const [dropAt, vAt, copyAt] = T.keys.montage
  const drop = dropAt
  const v = vAt - beat
  const copy = copyAt - 2 * beat
  // Beat 1: the pointer takes #14 (Backlog's first card) to Claude's header.
  const grab = 10
  const dragging = i === 0 && local >= grab && local < drop
  const dropped = i > 0 || local >= drop
  const rowTop = (r: number) => r * PANE_ROW
  const fromY = rowTop(ROW.backlog + 1)
  const toY = rowTop(ROW.claude)
  const t = interpolate(local, [grab, drop - 2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) })
  const tipY = local < grab ? interpolate(local, [0, grab], [fromY + 90, fromY + 8], { extrapolateRight: 'clamp' }) : fromY + 8 + (toY - fromY) * t
  const tipRow = Math.floor(tipY / PANE_ROW)
  const target: React.ComponentProps<typeof Board>['drop'] = !dragging
    ? undefined
    : tipRow >= ROW.claude
      ? { section: 'claude', lineAfter: -1 }
      : tipRow > ROW.backlog + 1
        ? { section: 'backlog', lineAfter: tipRow - ROW.backlog - 1 }
        : undefined
  const everyone = i === 2 || (i === 1 && local >= v + 3)
  const view: View = everyone ? 'Everyone' : 'Mine + open'
  const hover = i === 2 && local >= 12
  // Ann's and Bo's cards slide in as the view widens.
  const theirs = (card: Card, k: number): Card =>
    i === 1 && card.owner !== undefined && card.owner !== 'You' ? { ...card, arrive: ramp(local, v + 3 + k * 2, 12) } : card
  const backlog: Card[] = [
    ...(dropped ? [] : [{ ...C14, lifted: dragging }]),
    ...REST.map((c, k) => (c.n === 15 ? { ...theirs(c, k), hover } : theirs(c, k))),
  ]
  const claude: Card[] = [
    ...(dropped
      ? [{
          ...C14, age: 'now', arrive: i === 0 ? ramp(local, drop, 12) : undefined,
          sync: i === 0 ? (local < drop + 14 ? '⟳' : '✓') : undefined,
          activity: i > 0 || local >= drop + 12 ? <Activity dots={[ACCENT]} who="Claude" doing="⟳ Read src/theme.ts" time="1m" tok="6k" /> : undefined,
        }]
      : []),
    C20,
    theirs(C13, 4),
  ]
  const titles = ['Drag and drop, or keys', 'Whose card is whose', '[copy] on hover']
  // Each beat fades in from the last, a quick deliberate cut.
  const pop = ramp(local, 0, 6)
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute', top: 56, left: 0, right: 0, textAlign: 'center', fontFamily: UI, fontSize: 80, fontWeight: 800,
          color: TEXT, letterSpacing: -1, opacity: pop, transform: `scale(${0.92 + 0.08 * pop})`, zIndex: 2,
        }}
      >
        {titles[i]}
      </div>
      <Stage>
        <AbsoluteFill style={{ opacity: pop }}>
          <Cam shots={[HELD]}>
            <Split
              chat={
                <>
                  <Line dim>⏺ #12 is Done.</Line>
                  <Line show={dropped ? (i === 0 ? ramp(local, drop + 6) : 1) : 0}>⏺ kanban_show(card: 14)</Line>
                  <Line dim show={dropped ? (i === 0 ? ramp(local, drop + 12) : 1) : 0}>⏺ Read(src/theme.ts)</Line>
                  <Toast show={i === 2 && local >= copy ? ramp(local, copy, 8) : 0} color={MINT}>
                    Copied 1 card.
                  </Toast>
                </>
              }
              pane={
                <div style={{ position: 'relative' }}>
                  <Board
                    backlog={backlog}
                    claude={claude}
                    me={[theirs(C11, 5)]}
                    view={view}
                    viewLit={i === 1 && local >= v ? 1 - ramp(local, v, 30) : 0}
                    peopleLit={i === 1 && local >= 40 ? 1 - ramp(local, 40, 20) : 0}
                    drop={target}
                    inactive={DONE_13}
                  />
                  {i === 0 ? <Pointer x={220} y={tipY - 2} show={local < drop + 8 ? 1 : 1 - ramp(local, drop + 8, 8)} /> : null}
                  {i === 2 ? <Pointer x={560} y={rowTop(ROW.backlog + 2) + 8} show={ramp(local, 6, 6) * (1 - ramp(local, 44, 8))} /> : null}
                </div>
              }
            />
          </Cam>
        </AbsoluteFill>
      </Stage>
      <Keycap label="v" at={vAt} />
    </AbsoluteFill>
  )
}

// 19-25 s. The call to action only (the features were just shown): mark,
// tagline, install line, credit, each on a slowing beat of the outro; the
// credit and a glow on the mark land with the final chord.
const End: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const [, tagline, install, final] = T.outro
  const logo = spring({ frame, fps, config: { damping: 12 } })
  const ring = frame >= final ? 1 - ramp(frame, final, 45) : 0
  return (
    <AbsoluteFill style={{ fontFamily: UI, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
        <KanbanMark
          size={170}
          style={{ transform: `scale(${logo * (1 + 0.06 * ring)})`, filter: `drop-shadow(0 0 ${50 * ring}px ${ACCENT})` }}
        />
        <div style={{ fontSize: 80, fontWeight: 800, color: TEXT, opacity: ramp(frame, 6), letterSpacing: -1.5 }}>claude-kanban</div>
      </div>
      <div style={{ marginTop: 36, fontSize: 54, fontWeight: 800, color: TEXT, opacity: ramp(frame, tagline, 8), letterSpacing: -1 }}>
        Who holds the ball, <span style={{ color: ACCENT }}>at a glance.</span>
      </div>
      <div
        style={{
          marginTop: 50, fontFamily: MONO, fontSize: 34, color: TEXT, background: PANEL, border: `1px solid ${LINE}`,
          borderRadius: 16, padding: '22px 36px', opacity: ramp(frame, install, 8),
          transform: `translateY(${(1 - ramp(frame, install, 8)) * 16}px)`, boxShadow: `0 0 80px ${ACCENT}1f`,
        }}
      >
        <span style={{ color: ACCENT }}>/plugin install</span> kanban --marketplace TeeratP/claude-kanban
      </div>
      <div style={{ marginTop: 26, fontSize: 26, color: DIM, opacity: ramp(frame, final, 10) }}>
        a Claude Code mod · needs the gh CLI
      </div>
    </AbsoluteFill>
  )
}

const SCENES: Array<[React.FC<SceneProps>, number]> = [
  [Hook, T.scenes.hook],
  [Slam, T.scenes.logo],
  [Hero, T.scenes.hero],
  [Montage, T.scenes.montage],
  [End, T.scenes.end],
]

export const TEASER_FRAMES = reelFrames(SCENES)
export const Teaser: React.FC = () => <Reel music="music-25.wav" scenes={SCENES} />
