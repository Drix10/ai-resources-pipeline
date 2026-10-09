import React from 'react';
import { Composition, Still } from 'remotion';
import { POST, REEL } from './brand';
import { CarouselSlideComp } from './Carousel';
import { Reel, reelDuration } from './Reel';
import { SAMPLE } from './sample';
import type { Storyboard } from './schema';

export const Root: React.FC = () => (
  <>
    <Composition
      id="Reel"
      component={Reel as unknown as React.FC<Record<string, unknown>>}
      width={REEL.w}
      height={REEL.h}
      fps={REEL.fps}
      durationInFrames={reelDuration(SAMPLE)}
      defaultProps={{ storyboard: SAMPLE }}
      calculateMetadata={({ props }) => ({ durationInFrames: reelDuration((props as { storyboard: Storyboard }).storyboard) })}
    />
    <Still
      id="Slide"
      component={CarouselSlideComp as unknown as React.FC<Record<string, unknown>>}
      width={POST.w}
      height={POST.h}
      defaultProps={{ storyboard: SAMPLE, slide: 0 }}
    />
  </>
);
