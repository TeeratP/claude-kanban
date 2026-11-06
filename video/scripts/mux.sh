#!/bin/sh
# Re-mux a rendered video with its music from the WAV. Remotion's AAC track
# keeps the encoder's ~43 ms start-up padding untrimmed, so the music plays
# late; ffmpeg's mux records the padding so players skip it. A limiter keeps
# the peaks about 3 dB down before the AAC encode, whose overshoot would
# otherwise reach 0 dBFS; the encoded peaks land near -1.5 dBFS.
# Usage: scripts/mux.sh <video name in out/> <music name in public/>
set -e
ffmpeg -v error -y -i "out/kanban-$1.mp4" -i "public/$2.wav" -map 0:v -map 1:a -af alimiter=limit=0.7:attack=2:release=60:level=disabled -c:v copy -c:a aac -b:a 256k -movflags +faststart out/mux-tmp.mp4
mv out/mux-tmp.mp4 "out/kanban-$1.mp4"
