'use client';

import { useEffect, useRef } from 'react';

interface Agent {
  x: number;
  y: number;
  a: number; // heading, radians
  s: number; // speed, px per frame at 60fps
  turn: number; // wander drift
}

const FLEE_RADIUS = 150;

// A small flock that scatters from the cursor (the "owl"), after the evolving-mice
// simulation in Night-Hunt. Decorative: hidden from assistive tech, paused offscreen
// or in a background tab, and drawn once without motion when reduced motion is on.
export default function AgentField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let dpr = 1;
    let agents: Agent[] = [];
    let raf = 0;
    let last = 0;
    let running = false;
    let visible = true;
    const owl = { x: -9999, y: -9999, on: false };
    const colors = { ink: '15,27,45', accent: '23,54,245' };

    const readColors = () => {
      const css = getComputedStyle(document.documentElement);
      const triplet = (name: string, fallback: string) => {
        const v = css.getPropertyValue(name).trim().split(/\s+/).join(',');
        return v || fallback;
      };
      colors.ink = triplet('--ink', colors.ink);
      colors.accent = triplet('--accent', colors.accent);
    };

    const seed = () => {
      const count = Math.max(22, Math.min(64, Math.round((width * height) / 9500)));
      agents = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        a: Math.random() * Math.PI * 2,
        s: 0.5 + Math.random() * 0.5,
        turn: (Math.random() - 0.5) * 0.04,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      draw();
    };

    const step = (dt: number) => {
      for (const p of agents) {
        // Wander: drift the heading a little each frame.
        p.a += p.turn + (Math.random() - 0.5) * 0.05;
        let ax = Math.cos(p.a);
        let ay = Math.sin(p.a);
        let speed = p.s;

        // Keep a little distance from close neighbours so the flock stays loose.
        for (const q of agents) {
          if (q === p) continue;
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 0 && d2 < 520) {
            ax += (dx / Math.sqrt(d2)) * 0.35;
            ay += (dy / Math.sqrt(d2)) * 0.35;
          }
        }

        // Flee the owl: stronger and faster the closer it is.
        if (owl.on) {
          const dx = p.x - owl.x;
          const dy = p.y - owl.y;
          const d = Math.hypot(dx, dy);
          if (d < FLEE_RADIUS && d > 0.01) {
            const force = 1 - d / FLEE_RADIUS;
            ax += (dx / d) * force * 4;
            ay += (dy / d) * force * 4;
            speed += force * 2.6;
          }
        }

        p.a = Math.atan2(ay, ax);
        p.x += Math.cos(p.a) * speed * dt;
        p.y += Math.sin(p.a) * speed * dt;

        // Wrap around the edges.
        if (p.x < -10) p.x = width + 10;
        else if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        else if (p.y > height + 10) p.y = -10;
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const p of agents) {
        const near = owl.on && Math.hypot(p.x - owl.x, p.y - owl.y) < FLEE_RADIUS * 1.15;
        ctx.fillStyle = near ? `rgba(${colors.accent},0.9)` : `rgba(${colors.ink},0.38)`;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-4, 3.2);
        ctx.lineTo(-2.2, 0);
        ctx.lineTo(-4, -3.2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      if (owl.on) {
        ctx.strokeStyle = `rgba(${colors.accent},0.55)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(owl.x, owl.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    // Speeds are tuned for 60fps; scale by elapsed time so 120Hz screens move at the same pace.
    const frame = (now: number) => {
      const dt = last ? Math.min(3, (now - last) / 16.667) : 1;
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running || reduced.matches || !visible || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return; // a finger has no hover; touch never summons the owl
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      owl.on = x >= -40 && x <= rect.width + 40 && y >= -40 && y <= rect.height + 40;
      owl.x = x;
      owl.y = y;
    };
    const onLeave = () => {
      owl.on = false;
    };

    readColors();
    resize();
    start();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      visible ? start() : stop();
    });
    intersection.observe(canvas);
    const themeObserver = new MutationObserver(() => {
      readColors();
      if (!running) draw();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      readColors();
      if (!running) draw();
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onMotion = () => {
      stop();
      reduced.matches ? draw() : start();
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    scheme.addEventListener('change', onScheme);
    reduced.addEventListener('change', onMotion);

    return () => {
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      scheme.removeEventListener('change', onScheme);
      reduced.removeEventListener('change', onMotion);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}
