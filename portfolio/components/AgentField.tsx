'use client';

import { useEffect, useRef } from 'react';

// The hero background is the "night hunt" simulation from Drix10/ml-videos: a school of mice that
// have learned to run from an owl. Mice, owl, trails and the catch burst are drawn after that
// project's own sprites (visualizer.py). The owl is the cursor; with no cursor (touch, or the
// pointer elsewhere) it hunts the nearest mouse by itself, as in the video. Always moving, hidden
// from assistive tech, and paused only while offscreen or in a background tab.

interface Mouse {
  x: number;
  y: number;
  a: number; // heading, radians
  wander: number; // slow random drift in heading
  trail: { x: number; y: number }[];
  deadFor: number; // frames until it respawns after a catch, 0 = alive
}

interface Spark {
  x: number;
  y: number;
  life: number;
}

// Speeds are in px per frame at 60fps, kept in the video's ratios (owl is about 0.73x a mouse).
const MOUSE_SPEED = 1.7;
const FLEE_BOOST = 0.9;
const TURN_RATE = 0.06;
const OWL_SPEED = 1.25;
const OWL_TURN = 0.06;
const OWL_CHASE_SPEED = 2.4; // the cursor owl hurries to keep up with a hand
const SENSE_RADIUS = 190;
const CATCH_RADIUS = 11;
const WALL = 46;
const MAX_TRAIL = 6;
const OWL_TRAIL = 20;
const MOUSE_SCALE = 1.5; // the sprites are 16px long in the video; larger reads better behind a headline

const wrapAngle = (d: number) => ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const steer = (from: number, to: number, limit: number) => from + Math.max(-limit, Math.min(limit, wrapAngle(to - from)));

export default function AgentField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let mice: Mouse[] = [];
    const sparks: Spark[] = [];
    const owl = { x: 0, y: 0, a: 0, trail: [] as { x: number; y: number }[] };
    const cursor = { x: 0, y: 0, on: false };
    let flash = 0; // frames of catch ring left
    let raf = 0;
    let last = 0;
    let running = false;
    let visible = true;
    const colors = { ink: '15,27,45', accent: '23,54,245' };

    const readColors = () => {
      const css = getComputedStyle(document.documentElement);
      const triplet = (name: string, fallback: string) => css.getPropertyValue(name).trim().split(/\s+/).join(',') || fallback;
      colors.ink = triplet('--ink', colors.ink);
      colors.accent = triplet('--accent', colors.accent);
    };

    const spawn = (away?: { x: number; y: number }): Mouse => {
      let x = 0;
      let y = 0;
      for (let i = 0; i < 20; i++) {
        x = WALL + Math.random() * Math.max(1, width - WALL * 2);
        y = WALL + Math.random() * Math.max(1, height - WALL * 2);
        if (!away || Math.hypot(x - away.x, y - away.y) > 140) break;
      }
      return { x, y, a: Math.random() * Math.PI * 2, wander: 0, trail: [], deadFor: 0 };
    };

    const seed = () => {
      const count = Math.max(20, Math.min(52, Math.round((width * height) / 17000)));
      mice = Array.from({ length: count }, () => spawn());
      owl.x = width / 2;
      owl.y = height / 2;
      owl.a = 0;
      owl.trail = [];
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
      // The owl: follows the cursor when there is one, otherwise hunts the nearest mouse.
      let target: { x: number; y: number } | null = null;
      if (cursor.on) target = cursor;
      else {
        let best = Infinity;
        for (const m of mice) {
          if (m.deadFor) continue;
          const d = (m.x - owl.x) ** 2 + (m.y - owl.y) ** 2;
          if (d < best) {
            best = d;
            target = m;
          }
        }
      }
      let owlSpeed = OWL_SPEED;
      if (target) {
        const dist = Math.hypot(target.x - owl.x, target.y - owl.y);
        owl.a = steer(owl.a, Math.atan2(target.y - owl.y, target.x - owl.x), OWL_TURN * dt);
        if (cursor.on) owlSpeed = Math.min(OWL_CHASE_SPEED, 0.6 + dist * 0.02);
      }
      owl.x += Math.cos(owl.a) * owlSpeed * dt;
      owl.y += Math.sin(owl.a) * owlSpeed * dt;
      if (owl.x < 14 || owl.x > width - 14) {
        owl.a = Math.PI - owl.a;
        owl.x = Math.min(Math.max(owl.x, 14), width - 14);
      }
      if (owl.y < 14 || owl.y > height - 14) {
        owl.a = -owl.a;
        owl.y = Math.min(Math.max(owl.y, 14), height - 14);
      }
      owl.trail.push({ x: owl.x, y: owl.y });
      if (owl.trail.length > OWL_TRAIL) owl.trail.shift();

      for (const m of mice) {
        if (m.deadFor) {
          m.deadFor -= dt;
          if (m.deadFor <= 0) Object.assign(m, spawn(owl));
          continue;
        }
        // The learned reflex: run from the owl, bend away from walls, otherwise drift.
        m.wander += (Math.random() - 0.5) * 0.02 * dt;
        m.wander *= 0.97;
        let desired = m.a + m.wander;
        let speed = MOUSE_SPEED;
        const dx = m.x - owl.x;
        const dy = m.y - owl.y;
        const d = Math.hypot(dx, dy);
        if (d < SENSE_RADIUS) {
          const urgency = 1 - d / SENSE_RADIUS;
          // Run directly away, with the path bent toward open space so they do not pin to an edge.
          let ax = dx / (d || 1);
          let ay = dy / (d || 1);
          ax += (width / 2 - m.x) * 0.0006;
          ay += (height / 2 - m.y) * 0.0006;
          desired = Math.atan2(ay, ax);
          speed += urgency * FLEE_BOOST;
        }
        let wx = 0;
        let wy = 0;
        if (m.x < WALL) wx = 1;
        else if (m.x > width - WALL) wx = -1;
        if (m.y < WALL) wy = 1;
        else if (m.y > height - WALL) wy = -1;
        if (wx || wy) desired = Math.atan2(Math.sin(desired) + wy * 1.4, Math.cos(desired) + wx * 1.4);

        m.a = steer(m.a, desired, TURN_RATE * dt);
        m.x += Math.cos(m.a) * speed * dt;
        m.y += Math.sin(m.a) * speed * dt;
        if (m.x < 7 || m.x > width - 7) {
          m.a = Math.PI - m.a;
          m.x = Math.min(Math.max(m.x, 7), width - 7);
        }
        if (m.y < 7 || m.y > height - 7) {
          m.a = -m.a;
          m.y = Math.min(Math.max(m.y, 7), height - 7);
        }
        m.trail.push({ x: m.x, y: m.y });
        if (m.trail.length > MAX_TRAIL) m.trail.shift();

        if (d < CATCH_RADIUS) {
          m.deadFor = 140;
          m.trail = [];
          flash = 20;
          for (let i = 0; i < 6; i++) sparks.push({ x: m.x, y: m.y, life: 1 });
        }
      }
      if (flash > 0) flash -= dt;
      for (const s of sparks) s.life -= 0.04 * dt;
      while (sparks.length && sparks[0].life <= 0) sparks.shift();
    };

    // A pointed-oval body, two ears and a tail, oriented to the heading (visualizer.py draw_arena).
    const drawMouse = (m: Mouse, near: boolean) => {
      const fill = near ? `rgba(${colors.accent},0.95)` : `rgba(${colors.ink},0.6)`;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.a);
      ctx.scale(MOUSE_SCALE, MOUSE_SCALE);
      ctx.fillStyle = fill;
      ctx.strokeStyle = fill;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(2, -3);
      ctx.lineTo(-5, -2.5);
      ctx.lineTo(-5, 2.5);
      ctx.lineTo(2, 3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(3, -3.5, 2, 0, Math.PI * 2);
      ctx.arc(3, 3.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-5, 0);
      ctx.lineTo(-11, 3);
      ctx.stroke();
      ctx.restore();
    };

    const drawOwl = () => {
      ctx.save();
      ctx.translate(owl.x, owl.y);
      ctx.rotate(owl.a);
      ctx.scale(1.25, 1.25);
      ctx.fillStyle = `rgba(${colors.ink},0.92)`;
      const poly = (pts: number[][]) => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
        ctx.closePath();
        ctx.fill();
      };
      poly([[-2, -10], [-14, -22], [-9, -8]]); // tucked wings
      poly([[-2, 10], [-14, 22], [-9, 8]]);
      poly([[-18, 0], [-27, -6], [-27, 6]]); // short wedge tail
      poly([[22, 0], [9, -11], [-11, -12], [-19, -4], [-19, 4], [-11, 12], [9, 11]]); // body
      ctx.fillStyle = `rgba(${colors.accent},1)`;
      poly([[22, 0], [27, 2], [22, 4]]); // beak
      ctx.restore();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineCap = 'round';

      // Faint motion ribbons behind the mice, the owl's longer flight trail beneath.
      if (owl.trail.length > 1) {
        for (let i = 1; i < owl.trail.length; i++) {
          ctx.strokeStyle = `rgba(${colors.ink},${(0.04 + 0.12 * (i / owl.trail.length)).toFixed(3)})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(owl.trail[i - 1].x, owl.trail[i - 1].y);
          ctx.lineTo(owl.trail[i].x, owl.trail[i].y);
          ctx.stroke();
        }
      }
      ctx.lineWidth = 1.6;
      for (const m of mice) {
        if (m.deadFor || m.trail.length < 2) continue;
        ctx.strokeStyle = `rgba(${colors.ink},0.16)`;
        ctx.beginPath();
        ctx.moveTo(m.trail[0].x, m.trail[0].y);
        for (const p of m.trail.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      for (const m of mice) {
        if (m.deadFor) continue;
        drawMouse(m, Math.hypot(m.x - owl.x, m.y - owl.y) < SENSE_RADIUS * 0.45);
      }

      if (flash > 0) {
        ctx.strokeStyle = `rgba(${colors.accent},${Math.min(1, flash / 20).toFixed(2)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(owl.x, owl.y, 16 + (20 - flash) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const s of sparks) {
        ctx.fillStyle = `rgba(${colors.accent},${Math.max(0, s.life).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(0.5, 3 * s.life), 0, Math.PI * 2);
        ctx.fill();
      }
      drawOwl();
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
      if (running || !visible || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return; // a finger has no hover; the owl hunts on its own
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      cursor.on = x >= -40 && x <= rect.width + 40 && y >= -40 && y <= rect.height + 40;
      cursor.x = x;
      cursor.y = y;
    };
    const onLeave = () => {
      cursor.on = false;
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

    window.addEventListener('pointermove', onPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    scheme.addEventListener('change', onScheme);

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
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}
