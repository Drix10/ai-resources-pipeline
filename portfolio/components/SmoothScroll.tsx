'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';

// Eases mouse-wheel scrolling (the stepped jumps of a notched wheel are what read as choppy).
// Lenis scrolls the real page, so sticky, anchors, find-in-page and the scroll-linked animations
// all keep working. Touch scrolling is left to the browser: its own momentum is already the best
// available, and smoothing it only adds lag.
export default function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.11, smoothWheel: true, wheelMultiplier: 1, anchors: true, autoRaf: true });
    return () => lenis.destroy();
  }, []);
  return null;
}
