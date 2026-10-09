import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/newsreader';
import React, { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';

/** Holds every frame until the brand faces are decoded, so no frame ever shows a fallback font. */
export const FontGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([
      document.fonts.load('700 64px "Bricolage Grotesque Variable"'),
      document.fonts.load('400 32px "Bricolage Grotesque Variable"'),
      document.fonts.load('400 32px "Newsreader Variable"'),
      document.fonts.load('400 32px "JetBrains Mono Variable"'),
    ])
      .then(() => document.fonts.ready)
      .then(() => {
        setReady(true);
        requestAnimationFrame(() => continueRender(handle));
      })
      .catch(() => continueRender(handle));
  }, [handle]);
  return ready ? <>{children}</> : null;
};
