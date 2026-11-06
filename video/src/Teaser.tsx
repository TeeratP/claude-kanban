// The 25 s claude-kanban teaser, its own script (not a cut of the intro): a
// 3 s hook, the logo on the drop, one continuous hero shot (a card goes to
// Claude, Claude works it live, hands it to you, you approve), a fast montage
// of the rest, and the end card. 120 BPM: a beat is 15 frames. All timing
// lives in timing.json, which scripts/music.py reads too: the logo slams in
// on the drop, keys land on beats, the music slows on the end card. The
// board is a made-up demo board.
import React from 'react'
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import {
  ACCENT, Activity, Board, Btn, Camera, Caption, Card, CardRow, DIM, Detail, EXPLORE, KanbanMark, Keycap, LINE, Line,
  MINT, MONO, PANEL, PeopleRow, PromptBox, Reel, SceneProps, SectionHeader, Split, Stage, TEXT, Terminal, Toast, UI,
  ramp, reelFrames,
} from './ui'
import timing from './timing.json'

const T = timing.teaser

// The demo board's cards (made up), the same as the intro's.
const C12: Card = { n: 12, title: 'Fix login redirect', age: '2d' }
const C14: Card = { n: 14, title: 'Add dark mode toggle', age: '5h', owner: 'You' }
const C15: Card = { n: 15, title: 'Cache search results', age: '1d' }
const C16: Card = { n: 16, title: 'Update onboarding copy', age: '3h', owner: 'You' }
const C17: Card = { n: 17, title: 'Retry failed uploads', age: '4h', owner: 'Ann' }
const C18: Card = { n: 18, title: 'Speed up the CI cache', age: '6h', owner: 'Bo' }

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
// live, hands it to you (Kanban · 1), you open it and press a: Done.
const Hero: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const [m, c, approve] = T.keys.hero
  const moved = frame >= c
  const handed = 132
  const detailAt = 152
  const done = frame >= approve + 10
  const inMe = frame >= handed && !done
  const inDetail = frame >= detailAt && !done
  const activity =
    frame < 98 ? (
      <Activity dots={[ACCENT, EXPLORE]} who="Explore" doing="⟳ Grep redirect" time="1m" tok="12k" />
    ) : frame < 118 ? (
      <Activity dots={[ACCENT, EXPLORE]} who="Claude" doing="⟳ Edit src/auth.ts" time="4m" tok="31k" />
    ) : (
      <Activity dots={[ACCENT, EXPLORE]} who="Claude" doing="⟳ Bash npm test" time="7m" tok="48k" />
    )
  const live: Card = {
    ...C12, owner: 'You', age: 'now', arrive: ramp(frame, c, 12),
    sync: frame < c + 12 ? '⟳' : frame < c + 30 ? '✓' : undefined,
    activity: frame >= c + 18 ? activity : undefined,
  }
  const backlog = moved ? [C14, C15, C16] : [{ ...C12, cursor: frame >= 10 }, C14, C15, C16]
  const doneGlow = done ? 1 - ramp(frame, approve + 10, 40) : 0
  const phase = done ? 'done' : frame >= handed ? 'handoff' : 'take'
  const captions = {
    take: { title: 'A card goes to Claude', sub: 'm c: Claude starts the work, and you see it live', at: 4 },
    handoff: { title: 'Claude hands it to you', sub: 'a handoff: what it did, how to check it, what it needs', at: handed },
    done: { title: 'Approve. Done.', sub: 'the issue closes on GitHub', at: approve + 10 },
  }[phase]
  const work = (from: number) => ramp(frame, from, 8)
  return (
    <AbsoluteFill>
      <Caption key={phase} title={captions.title} sub={captions.sub} at={captions.at} />
      <Stage>
        <Camera len={len} from={1} to={1.05} x={0.72} y={0.3}>
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
              inDetail ? (
                <div style={{ opacity: ramp(frame, detailAt, 6) }}>
                  <Detail approve={frame >= approve ? 1 - ramp(frame, approve, 20) * 0.5 : 0} />
                </div>
              ) : done ? (
                <div style={{ opacity: ramp(frame, approve + 10, 6) }}>
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
                  backlog={backlog}
                  claude={moved && !inMe ? [live] : []}
                  me={inMe ? [{ ...C12, owner: 'You', age: 'now', arrive: ramp(frame, handed, 12) }] : []}
                />
              )
            }
          />
        </Camera>
      </Stage>
      <Keycap label="m" at={m} />
      <Keycap label="c" at={c} />
      <Keycap label="a" at={approve} />
    </AbsoluteFill>
  )
}

// 13-19 s. Three quick beats, two bars each, of what else it does, one card each.
const Montage: React.FC<SceneProps> = ({ len }) => {
  const frame = useCurrentFrame()
  const card = Math.floor(len / 3)
  const i = Math.min(2, Math.floor(frame / card))
  const local = frame - i * card
  const cards: Array<{ title: string; body: React.ReactNode }> = [
    {
      title: 'Drag and drop, or keys',
      body: (
        <>
          <SectionHeader name="Claude" count="1 mine · 1 all" color={ACCENT} />
          <CardRow card={{ ...C14, age: 'now', sync: '⟳', arrive: ramp(local, 4, 12) }} />
          <Line dim>m, then b c h d x s: any section</Line>
        </>
      ),
    },
    {
      title: 'Whose card is whose',
      body: (
        <>
          <div style={{ whiteSpace: 'pre' }}>
            <Btn k="v" label="Everyone" lit={1 - ramp(local, 0, 30)} />
          </div>
          <CardRow card={{ ...C16, showOwnerName: true }} />
          <CardRow card={{ ...C17, showOwnerName: true }} />
          <CardRow card={{ ...C18, showOwnerName: true }} />
          <PeopleRow />
        </>
      ),
    },
    {
      title: '[copy] on hover',
      body: (
        <>
          <SectionHeader name="Backlog" count="2 mine · 4 all" />
          <CardRow card={{ ...C15, hover: local >= 12 }} />
          <CardRow card={C16} />
          <div style={{ marginTop: 12, color: MINT, opacity: ramp(local, 26, 6) }}>Copied 1 card.</div>
        </>
      ),
    },
  ]
  const pop = ramp(local, 0, 6)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: UI }}>
      <div style={{ opacity: pop, transform: `scale(${0.92 + 0.08 * pop})`, textAlign: 'center' }}>
        <div style={{ fontSize: 80, fontWeight: 800, color: TEXT, letterSpacing: -1 }}>{cards[i]?.title}</div>
        <div
          style={{
            marginTop: 40, width: 1000, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 18, padding: '26px 40px',
            fontFamily: MONO, fontSize: 30, lineHeight: 1.6, textAlign: 'left', color: TEXT, boxShadow: `0 0 80px ${ACCENT}1f`,
          }}
        >
          {cards[i]?.body}
        </div>
      </div>
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
        for the Claude Code terminal · zero config: found from git and gh
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
