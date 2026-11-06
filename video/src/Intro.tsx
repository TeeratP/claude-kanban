// The 45 s claude-kanban intro: the problem first, the logo on the drop, the
// pane opening, then the loop with the most time (Claude takes a card, works
// it live, hands it to you, you approve), then moving cards, whose cards,
// and an end card with the feature list, install line and logo. 120 BPM:
// scene changes and keypresses land on beats (15 frames). All timing lives
// in timing.json, which scripts/music.py reads too, so the music follows
// the cut. The board is a made-up demo board.
import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion'
import {
  ACCENT, Activity, Board, Camera, Caption, Card, DIM, Detail, EXPLORE, KanbanMark, Keycap, LINE, Line, MINT, MONO,
  PANEL, Pointer, PromptBox, Reel, SceneProps, Split, Stage, TEXT, Terminal, Toast, UI, ramp, reelFrames,
} from './ui'
import timing from './timing.json'

const T = timing.intro

// The demo board's cards (made up).
const C12: Card = { n: 12, title: 'Fix login redirect', age: '2d' }
const C14: Card = { n: 14, title: 'Add dark mode toggle', age: '5h', owner: 'You' }
const C15: Card = { n: 15, title: 'Cache search results', age: '1d' }
const C16: Card = { n: 16, title: 'Update onboarding copy', age: '3h', owner: 'You' }
const C17: Card = { n: 17, title: 'Retry failed uploads', age: '4h', owner: 'Ann' }
const C18: Card = { n: 18, title: 'Speed up the CI cache', age: '6h', owner: 'Bo' }

// 1. The problem: where does the work stand, and who has it?
const ProblemScene: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const [enter] = T.keys.problem
  const typed = '/kanban'.slice(0, Math.max(0, Math.floor((frame - 56) / 4)))
  return (
    <AbsoluteFill>
      <Caption title="Who holds the ball?" sub="tasks spread over chats, issues and TODO files" />
      <Camera len={len} from={1} to={1.05}>
        <Terminal height={520}>
          <Line dim>⏺ Done. Fixed the typo in the footer.</Line>
          <Line />
          <Line show={ramp(frame, len * 0.1)}>{'> what is next, and what waits on me?'}</Line>
          <Line dim show={ramp(frame, len * 0.2)}>⏺ Checking the issues, the board, TODO.md</Line>
          <Line dim show={ramp(frame, len * 0.25)}>{'  and yesterday’s chat…'}</Line>
          <PromptBox>{typed}</PromptBox>
        </Terminal>
      </Camera>
      <Keycap label="Enter" at={enter} />
    </AbsoluteFill>
  )
}

// 2. claude-kanban crashes in on the drop: flash, the mark slams, tagline.
const LogoScene: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame, fps, config: { damping: 9, stiffness: 160 } })
  const flash = 1 - ramp(frame, 0, 10)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: UI }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 45%, ${ACCENT}aa 0%, transparent 55%)`, opacity: flash }} />
      <KanbanMark size={300} style={{ transform: `scale(${2.2 - 1.2 * s}) rotate(${(1 - s) * -8}deg)`, opacity: Math.min(1, s * 1.5) }} />
      <div style={{ marginTop: 50, fontSize: 70, fontWeight: 800, color: TEXT, opacity: ramp(frame, len * 0.2), letterSpacing: -1 }}>
        claude-kanban
      </div>
      <div style={{ marginTop: 14, fontSize: 38, color: DIM, opacity: ramp(frame, len * 0.35) }}>
        Who holds the ball, <span style={{ color: ACCENT, fontWeight: 700 }}>at a glance.</span>
      </div>
    </AbsoluteFill>
  )
}

// 3. The pane opens beside the chat and the board loads.
const PaneScene: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const open = interpolate(frame, [6, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) })
  const loaded = frame >= 40
  const arrive = (i: number) => (loaded ? ramp(frame, 40 + i * 5, 14) : 0)
  const backlog = [C12, C14, C15, C16].map((c, i) => ({ ...c, arrive: arrive(i) }))
  return (
    <AbsoluteFill>
      <Caption title="A board beside Claude" sub="your GitHub Issues + a Projects board · found from git and gh, zero config" />
      <Stage>
        <Camera len={len} from={1} to={1.04} x={0.72} y={0.1}>
          <Split
            open={open}
            chat={
              <>
                <Line>{'> /kanban'}</Line>
                <Line dim show={ramp(frame, 20)}>⏺ Kanban pane opened.</Line>
              </>
            }
            pane={
              <Board
                status={loaded ? 'GitHub · #7 Demo board · updated just now' : 'GitHub · loading…'}
                backlog={loaded ? backlog : []}
                claude={[]}
                me={[]}
              />
            }
          />
        </Camera>
      </Stage>
    </AbsoluteFill>
  )
}

// 4. The loop, part one: Claude takes the top card and works it, live.
const PickScene: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const [lift, land] = T.keys.pick
  const moved = frame >= lift
  const work = (from: number) => ramp(frame, from, 10)
  const activity =
    frame < 100 ? (
      <Activity dots={[ACCENT, EXPLORE]} who="Explore" doing="⟳ Grep redirect" time="1m" tok="12k" />
    ) : frame < 150 ? (
      <Activity dots={[ACCENT, EXPLORE]} who="Claude" doing="⟳ Edit src/auth.ts" time="4m" tok="31k" />
    ) : (
      <Activity dots={[ACCENT, EXPLORE]} who="Claude" doing="⟳ Bash npm test" time="7m" tok="48k" />
    )
  const live: Card = {
    ...C12, owner: 'You', age: 'now', arrive: ramp(frame, lift, 14),
    sync: frame < land ? '⟳' : frame < land + 40 ? '✓' : undefined,
    activity: frame >= land + 10 ? activity : undefined,
  }
  const flip = 105
  return (
    <AbsoluteFill>
      <Caption
        key={frame >= flip ? 'live' : 'take'}
        title={frame >= flip ? 'You see it work, live' : 'Claude takes the top card'}
        sub={frame >= flip ? 'a second row: its agents, what runs, time and tokens' : 'Backlog → Claude, before it writes any code'}
        at={frame >= flip ? flip : 4}
      />
      <Stage>
        <Camera len={len} from={1} to={1.06} x={0.72} y={0.35}>
          <Split
            chat={
              <>
                <Line>{'> work the backlog'}</Line>
                <Line dim show={work(10)}>⏺ kanban_list()</Line>
                <Line show={work(30)}>⏺ kanban_move(card: 12, to: "claude")</Line>
                <Line dim show={work(lift + 4)}>{'  ⎿ Moved #12 to Claude (syncing).'}</Line>
                <Line show={work(75)}>⏺ Explore(Find the redirect code)</Line>
                <Line show={work(100)}>⏺ Edit(src/auth.ts)</Line>
                <Line show={work(150)}>⏺ Bash(npm test)</Line>
                <Line dim show={work(175)}>{'  ⎿ 42 passed'}</Line>
              </>
            }
            pane={<Board backlog={moved ? [C14, C15, C16] : [C12, C14, C15, C16]} claude={moved ? [live] : []} me={[]} />}
          />
        </Camera>
      </Stage>
    </AbsoluteFill>
  )
}

// 5. The loop, part two: Claude hands the card to you; you approve; Done.
const HandoffScene: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const [press] = T.keys.handoff
  const detailAt = 75
  const done = frame >= press + 12
  const inDetail = frame >= detailAt && !done
  const tab = frame >= 15 && !done
  const toast = frame >= 20 && frame < detailAt + 10 ? ramp(frame, 20, 10) * (1 - ramp(frame, detailAt, 10)) : 0
  const approved = frame >= press ? 1 - ramp(frame, press, 20) * 0.5 : 0
  const doneGlow = done ? 1 - ramp(frame, press + 12, 40) : 0
  return (
    <AbsoluteFill>
      <Caption
        key={done ? 'done' : 'handoff'}
        title={done ? 'Approve. Done.' : 'Claude hands it to you'}
        sub={done ? 'the issue closes on GitHub' : 'a handoff: what it did, how to check it, what it needs'}
        at={done ? press + 3 : 4}
      />
      <Stage>
        <Camera len={len} from={1.02} to={1.07} x={0.72} y={0.3}>
          <Split
            paneTitle={tab ? 'Kanban · 1' : 'Kanban'}
            tabGlow={tab ? 1 - ramp(frame, 15, 40) * 0.5 : 0}
            chat={
              <>
                <Line dim>⏺ Bash(npm test)</Line>
                <Line dim>{'  ⎿ 42 passed'}</Line>
                <Line show={ramp(frame, 2)}>⏺ kanban_handoff(card: 12, …)</Line>
                <Line show={ramp(frame, 8)}>⏺ kanban_move(card: 12, to: "human")</Line>
                <Line dim show={ramp(frame, 14)}>{'  ⎿ Moved #12 to Human (syncing).'}</Line>
                <Toast show={toast}>Waiting on you: #12 Fix login redirect</Toast>
              </>
            }
            pane={
              inDetail ? (
                <div style={{ opacity: ramp(frame, detailAt, 8) }}>
                  <Detail approve={approved} />
                </div>
              ) : done ? (
                <div style={{ opacity: ramp(frame, press + 12, 8) }}>
                  <Board
                    backlog={[C14, C15, C16]}
                    claude={[]}
                    me={[]}
                    inactive={
                      <span>
                        <span style={{ color: MINT, textShadow: `0 0 ${24 * doneGlow}px ${MINT}` }}>13 Done</span> · 2 Cancelled · 1 Suspended
                      </span>
                    }
                  />
                </div>
              ) : (
                <Board
                  backlog={[C14, C15, C16]}
                  claude={[]}
                  me={[{ ...C12, owner: 'You', age: 'now', arrive: ramp(frame, 12, 14) }]}
                />
              )
            }
          />
        </Camera>
      </Stage>
      <Keycap label="a" at={press} />
    </AbsoluteFill>
  )
}

// 6. Moving cards: drag #14 into Claude, then m s sets #16 aside.
const MovesScene: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const [grab, drop, m, s] = T.keys.moves
  const dragging = frame >= grab && frame < drop
  const dropped = frame >= drop
  const suspended = frame >= s
  // Pane-relative rows: Backlog's first card, Claude's first row.
  const fromY = 150
  const toY = 323
  const t = interpolate(frame, [grab, drop - 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) })
  const ghostY = fromY + (toY - fromY) * t
  const pointerY = interpolate(frame, [0, grab], [400, fromY + 10], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const py = frame < grab ? pointerY : dropped ? toY + 10 : ghostY + 10
  const backlog: Card[] = [
    ...(dropped ? [] : [{ ...C14, lifted: dragging }]),
    C15,
    ...(suspended ? [] : [{ ...C16, cursor: frame >= 100 }]),
  ]
  const claude: Card[] = dropped
    ? [{
        ...C14, age: 'now', arrive: ramp(frame, drop, 14), sync: frame < drop + 20 ? '⟳' : frame < drop + 50 ? '✓' : undefined,
        activity: frame >= drop + 30 ? <Activity dots={[ACCENT]} who="Claude" doing="⟳ Read src/theme.ts" time="1m" tok="6k" /> : undefined,
      }]
    : []
  return (
    <AbsoluteFill>
      <Caption
        key={frame >= 100 ? 'keys' : 'drag'}
        title={frame >= 100 ? 'Or by keyboard' : 'Drag and drop'}
        sub={frame >= 100 ? 'm, then b c h d x s: Backlog, Claude, Me, Done, Cancelled, Suspended' : 'drop a card on any section; a move to Claude starts the work'}
        at={frame >= 100 ? 100 : 4}
      />
      <Stage>
        <Camera len={len} from={1} to={1.04} x={0.72} y={0.3}>
          <Split
            chat={
              <>
                <Line dim>⏺ #12 is Done.</Line>
                <Line show={ramp(frame, drop + 6)}>⏺ kanban_show(card: 14)</Line>
                <Line dim show={ramp(frame, drop + 30)}>⏺ Read(src/theme.ts)</Line>
              </>
            }
            pane={
              <div style={{ position: 'relative' }}>
                <Board
                  backlog={backlog}
                  claude={claude}
                  me={[]}
                  inactive={suspended ? '13 Done · 2 Cancelled · 2 Suspended' : '13 Done · 2 Cancelled · 1 Suspended'}
                />
                {dragging ? (
                  <div
                    style={{
                      position: 'absolute', left: 0, right: 0, top: ghostY - 16, background: PANEL, border: `1px solid ${ACCENT}`,
                      borderRadius: 8, boxShadow: `0 16px 40px rgba(0,0,0,0.6), 0 0 30px ${ACCENT}55`, transform: 'rotate(-1.2deg)',
                    }}
                  >
                    <div style={{ display: 'flex', whiteSpace: 'pre', color: '#6cb6ff' }}>
                      <span style={{ width: '4ch', textAlign: 'right', color: DIM }}>#14</span>
                      <span style={{ marginLeft: '1ch' }}>Add dark mode toggle</span>
                    </div>
                  </div>
                ) : null}
                <Pointer x={300} y={py - 16} show={frame < 95 ? 1 - ramp(frame, 85, 10) : 0} />
              </div>
            }
          />
        </Camera>
      </Stage>
      <Keycap label="m" at={m} />
      <Keycap label="s" at={s} />
    </AbsoluteFill>
  )
}

// 7. Whose cards: v steps to Everyone, owner colours, the people row; [copy].
const MineScene: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const [v, copy] = T.keys.mine
  const everyone = frame >= v + 3
  const hover = frame >= copy - 20
  const backlog: Card[] = everyone
    ? [{ ...C15, hover }, { ...C17, arrive: ramp(frame, v + 3, 12) }, { ...C18, arrive: ramp(frame, v + 7, 12) }]
    : [{ ...C15, hover }]
  const claude: Card[] = [{ ...C14, age: '2m', activity: <Activity dots={[ACCENT]} who="Claude" doing="⟳ Edit src/theme.ts" time="3m" tok="14k" /> }]
  return (
    <AbsoluteFill>
      <Caption title="Whose card is whose" sub="Mine + open by default · v steps the view · titles in each owner's colour" />
      <Stage>
        <Camera len={len} from={1} to={1.05} x={0.72} y={0.3}>
          <Split
            chat={
              <>
                <Line dim>⏺ Edit(src/theme.ts)</Line>
                <Toast show={frame >= copy ? ramp(frame, copy, 8) : 0} color={MINT}>Copied 1 card.</Toast>
              </>
            }
            pane={
              <Board
                backlog={backlog}
                claude={claude}
                me={[]}
                everyone={everyone}
                view={everyone ? 'Everyone' : 'Mine + open'}
                viewLit={frame >= v ? 1 - ramp(frame, v, 30) : 0}
                inactive="13 Done · 2 Cancelled · 2 Suspended"
                people={everyone ? ramp(frame, v + 10, 12) : 0}
              />
            }
          />
        </Camera>
      </Stage>
      <Keycap label="v" at={v} />
      {frame >= copy - 20 && frame < copy + 40 ? (
        <div style={{ position: 'absolute', right: 70, bottom: 200, fontFamily: UI, fontSize: 30, color: DIM, opacity: ramp(frame, copy - 20, 8) }}>
          hover a card: <span style={{ color: ACCENT, fontFamily: MONO }}>[copy]</span>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

// 8. What the mod does, the install line, the mark. The music slows down
// here: the heading and each line land on a slowing beat, and the install
// line, mark and link land with the final chord.
const EndScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const adds = [
    'Your GitHub Issues as a board, beside the chat',
    'Claude takes a card and shows its work, live',
    'Handoffs to you: Approve, Send back or Park',
    'Drag and drop, or keys; whose card is whose',
    'Zero config: found from git and gh',
  ]
  const beats = T.outro
  const final = beats[beats.length - 1]
  const logo = spring({ frame: frame - final, fps, config: { damping: 12 } })
  return (
    <AbsoluteFill style={{ fontFamily: UI, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 58, fontWeight: 800, color: TEXT, opacity: ramp(frame, beats[0]), letterSpacing: -1 }}>
        A kanban board for Claude Code:
      </div>
      <div style={{ marginTop: 34, fontSize: 36, lineHeight: 1.65 }}>
        {adds.map((a, i) => (
          <div key={a} style={{ color: TEXT, opacity: ramp(frame, beats[i + 1], 8), transform: `translateX(${(1 - ramp(frame, beats[i + 1], 8)) * 40}px)` }}>
            <span style={{ color: MINT, marginRight: 18 }}>✓</span>
            {a}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 30 }}>
        <KanbanMark size={110} style={{ transform: `scale(${logo})`, opacity: logo }} />
        <div
          style={{
            fontFamily: MONO, fontSize: 30, color: TEXT, background: PANEL, border: `1px solid ${LINE}`,
            borderRadius: 14, padding: '18px 30px', opacity: ramp(frame, final, 8),
          }}
        >
          <span style={{ color: ACCENT }}>/plugin install</span> kanban --marketplace TeeratP/claude-kanban
        </div>
      </div>
      <div style={{ marginTop: 24, fontSize: 24, color: DIM, opacity: ramp(frame, final + 8) }}>
        github.com/TeeratP/claude-kanban · a Claude Code mod · needs the gh CLI
      </div>
    </AbsoluteFill>
  )
}

const SCENES: Array<[React.FC<SceneProps>, number]> = [
  [ProblemScene, T.scenes.problem],
  [LogoScene, T.scenes.logo],
  [PaneScene, T.scenes.pane],
  [PickScene, T.scenes.pick],
  [HandoffScene, T.scenes.handoff],
  [MovesScene, T.scenes.moves],
  [MineScene, T.scenes.mine],
  [EndScene, T.scenes.end],
]

export const INTRO_FRAMES = reelFrames(SCENES)
export const Intro: React.FC = () => <Reel music="music.wav" scenes={SCENES} />
