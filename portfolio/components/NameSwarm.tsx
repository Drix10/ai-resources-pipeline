'use client';

import { useEffect, useRef } from 'react';

// The hero is the name itself, built out of a swarm. Each dot is an agent with a home position in
// a letter and a spring pulling it there. An owl crosses the page on its own, and whatever it
// scares breaks away as a running mouse (the Night-Hunt experiment) before settling back into
// place. The h1 stays in the DOM for search engines, screen readers and selection; it only turns
// transparent once the swarm is drawing the same words.

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hx: number;
  hy: number;
}

const TARGET_DOTS = { wide: 1500, narrow: 650 };
const OWL_RADIUS = 140;
const OWL_SPEED = 2.8;
const OWL_TURN = 0.05;
const SPRING = 0.018;
const DAMPING = 0.9;
const RUN_DISTANCE = 22; // beyond this from home, a dot is drawn as a running mouse

const steer = (from: number, to: number, limit: number) => {
  const d = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + Math.max(-limit, Math.min(limit, d));
};

export default function NameSwarm() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const heading = document.getElementById('name');
    if (!canvas || !ctx || !heading) return;
    const root = document.documentElement;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let size = 4; // dot size in css px
    let textBox = { x: 0, y: 0, w: 0, h: 0 };
    let dots: Dot[] = [];
    const owl = { x: -60, y: 0, a: 0, tx: 0, ty: 0, until: 0 };
    let raf = 0;
    let last = 0;
    let running = false;
    let visible = true;
    let ready = false;
    let resizeTimer = 0;
    let disposed = false;
    const colors = { ink: '15,15,16', accent: '205,30,18' };

    const readColors = () => {
      const css = getComputedStyle(root);
      const triplet = (name: string, fallback: string) => css.getPropertyValue(name).trim().split(/\s+/).join(',') || fallback;
      colors.ink = triplet('--ink', colors.ink);
      colors.accent = triplet('--accent', colors.accent);
    };

    // Turn the heading's words into home positions by drawing them on an offscreen canvas and
    // keeping a grid of the filled pixels. The grid is coarsened until the count fits the budget.
    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const box = heading.getBoundingClientRect();
      const style = getComputedStyle(heading);
      const words = (heading.firstChild?.textContent || 'Drishtant Ghosh').trim().split(/\s+/).slice(0, 2);
      let fs = parseFloat(style.fontSize) || 120;
      const lineHeight = fs * 0.86;
      // The heading wraps to two lines on narrow screens and sits on one line on wide ones.
      const lines = box.height > lineHeight * 1.5 ? words : [words.join(' ')];
      const x0 = box.left - rect.left;
      const y0 = box.top - rect.top;

      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(width));
      off.height = Math.max(1, Math.round(height));
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) return false;
      const font = (px: number) => `800 ${px}px ${style.fontFamily}`;
      octx.font = font(fs);
      if ('fontStretch' in octx) (octx as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = 'semi-condensed';
      // Scale the swarm's letters to the width the real heading takes, so both are the same size.
      const range = document.createRange();
      if (heading.firstChild) range.selectNodeContents(heading.firstChild);
      const domWidth = Math.max(0, ...Array.from(range.getClientRects()).map((r) => r.width));
      const widest = Math.max(...lines.map((w) => octx.measureText(w).width));
      const room = width - x0 - 8;
      const wanted = Math.min(room, domWidth > 0 ? domWidth : room);
      if (Math.abs(widest - wanted) > 2) {
        fs *= wanted / widest;
        octx.font = font(fs);
        if ('fontStretch' in octx) (octx as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = 'semi-condensed';
      }
      octx.fillStyle = '#fff';
      octx.textBaseline = 'alphabetic';
      lines.forEach((w, i) => octx.fillText(w, x0, y0 + i * lineHeight + fs * 0.74));
      const pixels = octx.getImageData(0, 0, off.width, off.height).data;

      const top = Math.max(0, Math.floor(y0));
      const bottom = Math.min(off.height, Math.ceil(y0 + lines.length * lineHeight));
      const left = Math.max(0, Math.floor(x0));
      const right = Math.min(off.width, Math.ceil(x0 + Math.max(...lines.map((w) => octx.measureText(w).width)) + 4));
      const budget = width >= 820 ? TARGET_DOTS.wide : TARGET_DOTS.narrow;
      const sample = (step: number) => {
        const pts: [number, number][] = [];
        for (let y = top; y < bottom; y += step) {
          for (let x = left; x < right; x += step) {
            const px = Math.min(off.width - 1, Math.round(x + step / 2));
            const py = Math.min(off.height - 1, Math.round(y + step / 2));
            if (pixels[(py * off.width + px) * 4 + 3] > 140) pts.push([px, py]);
          }
        }
        return pts;
      };
      let step = Math.max(4, fs / 22);
      let points = sample(step);
      for (let i = 0; i < 4 && points.length > budget * 1.12; i++) {
        step *= Math.sqrt(points.length / budget);
        points = sample(step);
      }
      if (points.length < 20) return false;

      size = Math.min(5, Math.max(2.2, step * 0.62));
      textBox = { x: left, y: top, w: right - left, h: bottom - top };
      // Reuse existing dots so a resize re-settles them instead of restarting the scene.
      const next: Dot[] = points.map(([hx, hy], i) => {
        const d = dots[i];
        if (d) {
          d.hx = hx;
          d.hy = hy;
          return d;
        }
        return { x: Math.random() * width, y: Math.random() * height, vx: 0, vy: 0, hx, hy };
      });
      dots = next;
      return true;
    };

    const pickTarget = (now: number) => {
      // The owl works the name and a margin around it, not the copy below.
      const pad = Math.random() < 0.8 ? 0 : 70;
      owl.tx = textBox.x - pad + Math.random() * (textBox.w + pad * 2);
      owl.ty = textBox.y - pad + Math.random() * (textBox.h + pad * 2);
      owl.until = now + 2500 + Math.random() * 2500;
    };

    const step = (dt: number, now: number) => {
      if (now > owl.until || Math.hypot(owl.tx - owl.x, owl.ty - owl.y) < 36) pickTarget(now);
      owl.a = steer(owl.a, Math.atan2(owl.ty - owl.y, owl.tx - owl.x), OWL_TURN * dt);
      owl.x += Math.cos(owl.a) * OWL_SPEED * dt;
      owl.y += Math.sin(owl.a) * OWL_SPEED * dt;
      const damp = Math.pow(DAMPING, dt);
      for (const d of dots) {
        d.vx += (d.hx - d.x) * SPRING * dt + (Math.random() - 0.5) * 0.05 * dt;
        d.vy += (d.hy - d.y) * SPRING * dt + (Math.random() - 0.5) * 0.05 * dt;
        const ox = d.x - owl.x;
        const oy = d.y - owl.y;
        const dist = Math.hypot(ox, oy);
        if (dist < OWL_RADIUS && dist > 0.01) {
          const force = (1 - dist / OWL_RADIUS) ** 2 * 3.4;
          d.vx += (ox / dist) * force * dt;
          d.vy += (oy / dist) * force * dt;
        }
        d.vx *= damp;
        d.vy *= damp;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
    };

    const drawMouse = (x: number, y: number, a: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.scale(1.1, 1.1);
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
      poly([[-2, -10], [-14, -22], [-9, -8]]);
      poly([[-2, 10], [-14, 22], [-9, 8]]);
      poly([[-18, 0], [-27, -6], [-27, 6]]);
      poly([[22, 0], [9, -11], [-11, -12], [-19, -4], [-19, 4], [-11, 12], [9, 11]]);
      ctx.fillStyle = `rgb(${colors.accent})`;
      poly([[22, 0], [27, 2], [22, 4]]);
      ctx.restore();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const rest = `rgba(${colors.ink},0.95)`;
      const run = `rgba(${colors.accent},0.95)`;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = run;
      const half = size / 2;
      ctx.fillStyle = rest;
      const runners: Dot[] = [];
      for (const d of dots) {
        if ((d.x - d.hx) ** 2 + (d.y - d.hy) ** 2 > RUN_DISTANCE * RUN_DISTANCE) runners.push(d);
        else ctx.fillRect(d.x - half, d.y - half, size, size);
      }
      ctx.fillStyle = run;
      for (const d of runners) drawMouse(d.x, d.y, Math.atan2(d.vy, d.vx));
      drawOwl();
    };

    const frame = (now: number) => {
      const dt = last ? Math.min(3, (now - last) / 16.667) : 1;
      last = now;
      step(dt, now);
      draw();
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running || !ready || !visible || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const build = () => {
      if (disposed) return;
      readColors();
      if (layout()) {
        ready = true;
        root.classList.add('swarm-on');
        if (!owl.until) {
          owl.x = -60;
          owl.y = textBox.y + textBox.h / 2;
          pickTarget(performance.now());
        }
        if (!running) draw();
        start();
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(build, 150);
    });
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      visible ? start() : stop();
    });
    const themeObserver = new MutationObserver(() => {
      readColors();
      if (!running) draw();
    });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      readColors();
      if (!running) draw();
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    // Wait for the display font so the swarm is built from the real letter shapes.
    const family = getComputedStyle(heading).fontFamily;
    const fontReady = Promise.race([document.fonts.load(`800 100px ${family}`), new Promise((r) => window.setTimeout(r, 1500))]);
    fontReady.then(() => {
      if (disposed) return;
      build();
      resizeObserver.observe(canvas);
    });
    intersection.observe(canvas);
    themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    scheme.addEventListener('change', onScheme);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      stop();
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      scheme.removeEventListener('change', onScheme);
      document.removeEventListener('visibilitychange', onVisibility);
      root.classList.remove('swarm-on');
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}
