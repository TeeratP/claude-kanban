#!/bin/sh
# Re-mux a rendered video with its music from the WAV. Remotion's AAC track
# keeps the encoder's ~43 ms start-up padding untrimmed, so the music plays
# late; ffmpeg's mux records the padding so players skip it.
# Usage: scripts/mux.sh <video name in out/> <music name in public/>
set -e
ffmpeg -v error -y -i "out/kanban-$1.mp4" -i "public/$2.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart out/mux-tmp.mp4
mv out/mux-tmp.mp4 "out/kanban-$1.mp4"
