import React from 'react'
import { Composition } from 'remotion'
import { INTRO_FRAMES, Intro } from './Intro'
import { TEASER_FRAMES, Teaser } from './Teaser'

// Two separate videos, each its own script: the 45 s intro and the 25 s teaser.
export const Root: React.FC = () => (
  <>
    <Composition id="Intro" component={Intro} durationInFrames={INTRO_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="Teaser" component={Teaser} durationInFrames={TEASER_FRAMES} fps={30} width={1920} height={1080} />
  </>
)
