"""Synthesize the claude-kanban teaser's track that follows the picture: upbeat electronic,
120 BPM, A minor.

Usage: music.py OUT.wav

The timing comes from src/timing.json, the same file the video reads, so the
music and the picture can't drift apart. The energy follows the video:
  - before the drop (the hook): a quiet pad and a filtered 8th-note arp;
  - the drop (start of the 'logo' scene): impact, then a half-time groove;
  - 'full' (the features, fast): four-on-the-floor, 16th arp, hats, bass;
  - 'end' (logo, tagline, install): the drums stop and the tempo slows
    (ritardando) on the 'outro' beats, landing on a final A minor chord that
    rings out to silence.
Every keypress in the video gets a soft key click; the Approve press gets an
impact. Bars count from the drop, so the drop is a downbeat.
"""
import json
import pathlib
import sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter

OUT = sys.argv[1]
TIMING = json.loads((pathlib.Path(__file__).parent.parent / 'src' / 'timing.json').read_text())['teaser']
FPS = 30
SR = 44100
BEAT = 0.5
BAR = 4 * BEAT

# Scene starts in seconds, in order.
starts, at = {}, 0
for name, frames in TIMING['scenes'].items():
    starts[name] = at / FPS
    at += frames
LENGTH = at / FPS
assert abs(LENGTH - TIMING['seconds']) < 1e-6, f'scenes add up to {LENGTH}s, not {TIMING["seconds"]}s'
DROP = starts['logo']
FULL = starts[TIMING['full']]
OUTRO = starts['end']
OUTRO_BEATS = [OUTRO + f / FPS for f in TIMING['outro']]
FINAL = OUTRO_BEATS[-1]
CLICKS = [starts[scene] + f / FPS for scene, frames in TIMING['keys'].items() for f in frames]
IMPACT = starts[TIMING['impact'][0]] + TIMING['impact'][1] / FPS

N = int(SR * LENGTH)
rng = np.random.default_rng(7)
mix = np.zeros((N, 2))


def t_arr(sec):
    return np.arange(int(SR * sec)) / SR


def add(sig, at, gain=1.0, pan=0.0):
    i = int(round(at * SR))
    if i >= N or i < 0:
        return
    sig = sig[: N - i]
    left, right = gain * (1 - pan) / 2 * 2 ** 0.5, gain * (1 + pan) / 2 * 2 ** 0.5
    mix[i:i + len(sig), 0] += sig * left
    mix[i:i + len(sig), 1] += sig * right


def filt(sig, kind, cutoff, order=2):
    b, a = butter(order, np.asarray(cutoff) / (SR / 2), btype=kind)
    return lfilter(b, a, sig)


def kick(sec=0.4, decay=9):
    t = t_arr(sec)
    freq = 45 + 95 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * decay)


def clap():
    t = t_arr(0.25)
    return filt(rng.standard_normal(len(t)), 'band', [900, 3500]) * np.exp(-t * 22) * 0.9


def hat(open_=False):
    t = t_arr(0.18 if open_ else 0.05)
    return filt(rng.standard_normal(len(t)), 'high', 7000) * np.exp(-t * (18 if open_ else 70))


def crash(sec=1.6, decay=2.5):
    t = t_arr(sec)
    return filt(rng.standard_normal(len(t)), 'high', 3000) * np.exp(-t * decay)


def saw(freq, sec, harmonics=12):
    t = t_arr(sec)
    return sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, harmonics + 1)) * (2 / np.pi)


def pluck(freq, sec=0.22):
    t = t_arr(sec)
    sq = np.sign(np.sin(2 * np.pi * freq * t)) * 0.5 + np.sin(2 * np.pi * freq * 2 * t) * 0.2
    return filt(sq, 'low', 3200) * np.exp(-t * 14)


def bell(freq, sec=2.5, decay=2.2):
    t = t_arr(sec)
    tone = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2.01 * t) * np.exp(-t * 3) \
        + 0.15 * np.sin(2 * np.pi * freq * 3.0 * t) * np.exp(-t * 6)
    return tone * np.exp(-t * decay) * np.minimum(1, t / 0.004)


def key_click():
    t = t_arr(0.06)
    return filt(rng.standard_normal(len(t)), 'band', [1800, 6000]) * np.exp(-t * 90) \
        + np.sin(2 * np.pi * 1600 * t) * np.exp(-t * 120) * 0.4


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


# A minor: Am, F, C, G, one chord per bar; bars count from the drop.
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
ROOTS = [33, 29, 36, 31]


def bar_of(at):
    return int(np.floor((at - DROP) / BAR + 1e-9)) % 4


# Pad, one chord per bar, until the outro; quieter before the drop.
b = int(np.floor(-DROP / BAR))
while DROP + b * BAR < OUTRO:
    start = max(0.0, DROP + b * BAR)
    sec = min(DROP + (b + 1) * BAR, OUTRO) - start
    chord = CHORDS[b % 4]
    pad = sum(saw(hz(m), sec, 6) + saw(hz(m) * 1.004, sec, 6) for m in chord)
    env = np.minimum(1, t_arr(sec) / 0.3) * np.minimum(1, (sec - t_arr(sec)) / 0.3)
    add(filt(pad, 'low', 900 if start < DROP else 1400) * env * (0.07 if start < DROP else 0.05), start)
    b += 1

# Arp: 8ths, filtered, before the full groove; open 16ths in it.
at, i = 0.0, 0
while at < OUTRO - 1e-9:
    full = at >= FULL - 1e-9
    step = BEAT / 4 if full else BEAT / 2
    chord = CHORDS[bar_of(at)]
    note = chord[i % 3] + (12 if (i // 3) % 2 else 0)
    p = pluck(hz(note), 0.22 if full else 0.35)
    if at < DROP:
        p = filt(p, 'low', 800) * 0.7
    elif not full:
        p = filt(p, 'low', 1600) * 0.85
    add(p * 0.16, at, pan=0.35 if i % 2 else -0.35)
    at += step
    i += 1

# Riser into the drop, then the impact.
t = t_arr(2.0)
add(filt(rng.standard_normal(len(t)), 'band', [1500, 6000]) * (t / 2.0) ** 2 * 0.35, DROP - 2.0)
add(kick() * 1.3, DROP)
add(crash() * 0.35, DROP)

# Small riser into the full groove.
t = t_arr(1.0)
add(filt(rng.standard_normal(len(t)), 'band', [2000, 7000]) * (t / 1.0) ** 2 * 0.2, FULL - 1.0)

# Drums and bass from the drop to the outro: half-time, then full.
duck = np.ones(N)
k = 0
while DROP + k * BEAT < OUTRO - 1e-9:
    at = DROP + k * BEAT
    full = at >= FULL - 1e-9
    in_bar = k % 4
    root = ROOTS[bar_of(at)]
    if full or in_bar in (0, 2):
        add(kick(), at, 0.95)
        i = int(at * SR)
        d = 1 - 0.6 * np.exp(-t_arr(BEAT) * 10)
        duck[i:i + len(d)] = np.minimum(duck[i:i + len(d)], d[: max(0, N - i)])
    if (full and k % 2 == 1) or (not full and in_bar == 2):
        add(clap(), at, 0.55)
    add(hat(), at + BEAT / 2, 0.22 if full else 0.16, pan=0.2)
    if full:
        add(hat(), at + BEAT / 4, 0.1, pan=-0.2)
        add(hat(), at + 3 * BEAT / 4, 0.1, pan=-0.2)
        if k % 8 == 7:
            add(hat(True), at + BEAT / 2, 0.18)
        for e in range(2):
            add(filt(saw(hz(root), BEAT / 2 * 0.9, 8), 'low', 600) * np.exp(-t_arr(BEAT / 2 * 0.9) * 3) * 0.32, at + e * BEAT / 2)
    elif in_bar in (0, 2):
        add(filt(saw(hz(root), BEAT * 1.8, 8), 'low', 500) * np.exp(-t_arr(BEAT * 1.8) * 1.5) * 0.3, at)
    k += 1

# Sidechain: everything but the kick ducks a little on each beat (approximate).
mix *= duck[:, None] ** 0.5

# The outro: the groove stops, a soft swoosh down, then one bell note per
# slowing beat over a held pad, falling to B and resolving on A minor.
t = t_arr(1.2)
add(filt(rng.standard_normal(len(t)), 'low', 2500) * np.exp(-t * 3) * np.minimum(1, t / 0.02) * 0.18, OUTRO)
add(kick(0.8, 4) * 0.8, OUTRO)
line = [79, 77, 76, 74, 72, 71][-(len(OUTRO_BEATS) - 1):]
for n, (at, note) in enumerate(zip(OUTRO_BEATS[:-1], line)):
    soft = 1 - 0.5 * n / max(1, len(line) - 1)
    add(bell(hz(note), 1.6, 2.6) * 0.22 * soft, at, pan=-0.2 if n % 2 else 0.2)
    add(kick(0.5, 7) * 0.35 * soft, at)
for chord, start, end in ((CHORDS[1], OUTRO, (OUTRO + FINAL) / 2), (CHORDS[3], (OUTRO + FINAL) / 2, FINAL)):
    sec = end - start
    pad = sum(saw(hz(m), sec, 6) + saw(hz(m) * 1.004, sec, 6) for m in chord)
    env = np.minimum(1, t_arr(sec) / 0.25) * np.minimum(1, (sec - t_arr(sec)) / 0.15)
    add(filt(pad, 'low', 1100) * env * 0.045, start)
    add(filt(saw(hz(ROOTS[CHORDS.index(chord)]), sec, 8), 'low', 400) * env * 0.12, start)

# The final chord, on the last outro beat: A minor rings out to silence.
tail = LENGTH - FINAL
for m in (45, 57, 64, 69, 72, 76):
    add(bell(hz(m), tail, 1.4) * 0.12, FINAL)
pad = sum(saw(hz(m), tail, 6) + saw(hz(m) * 1.004, tail, 6) for m in (57, 60, 64))
add(filt(pad, 'low', 1200) * np.exp(-t_arr(tail) * 1.3) * np.minimum(1, t_arr(tail) / 0.01) * 0.06, FINAL)
add(kick(1.2, 2.5) * 1.1, FINAL)
add(crash(tail, 1.6) * 0.22, FINAL)

# Key clicks on each keypress, an impact on the Approve press.
for at in CLICKS:
    add(key_click() * 0.5, at)
add(kick(0.6, 6) * 0.7, IMPACT)
add(crash(1.2, 3) * 0.3, IMPACT)
t = t_arr(0.5)
add(filt(rng.standard_normal(len(t)), 'band', [800, 5000]) * (t / 0.5) ** 2 * 0.25, IMPACT - 0.5)

mix = np.tanh(mix * 1.4)
mix /= np.max(np.abs(mix)) * 1.05
# Make sure the last moment is silent.
f = int(0.4 * SR)
mix[-f:] *= np.linspace(1, 0, f)[:, None] ** 2
wavfile.write(OUT, SR, (mix * 32767).astype(np.int16))
print(f'wrote {OUT}: {LENGTH:.1f}s; drop {DROP}s, full {FULL}s, outro {OUTRO}s, final chord {FINAL:.2f}s; '
      f'clicks {[round(c, 2) for c in CLICKS]}, impact {IMPACT:.2f}s')
