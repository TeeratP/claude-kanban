import React from 'react'
import { Composition } from 'remotion'
import { TEASER_FRAMES, Teaser } from './Teaser'

// The 25 s teaser.
export const Root: React.FC = () => (
  <Composition id="Teaser" component={Teaser} durationInFrames={TEASER_FRAMES} fps={30} width={1920} height={1080} />
)
