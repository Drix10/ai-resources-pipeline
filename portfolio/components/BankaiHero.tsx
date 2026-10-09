'use client';

import { useEffect, useRef } from 'react';
import { NOW_BUILDING } from '@/lib/profile';

// A scroll-driven opening, in the way Apple's product pages are: the stage is pinned and scroll
// position is the playhead. Nothing animates on its own, so it costs nothing while idle, and every
// frame is a handful of CSS transforms (no video, no canvas, no libraries).
//
// The scene is an original homage to the "sealed blade, then released" idea of shonen swordsmen:
// a short plain blade, rising pressure, a flash, and the true blade with the name cut into the page.
// The captions are the real timeline: first commit 2019, ReeF acquired 2024, agents now.

type Key = [number, number];

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
// Piecewise value between keyframes, eased inside each segment.
const kf = (p: number, keys: Key[]) => {
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const [p0, v0] = keys[i - 1];
      const [p1, v1] = keys[i];
      return v0 + (v1 - v0) * smooth((p - p0) / (p1 - p0));
    }
  }
  return keys[keys.length - 1][1];
};
// 0 -> 1 -> 0 window, for captions.
const window4 = (p: number, a: number, b: number, c: number, d: number) => smooth(clamp((p - a) / (b - a))) * (1 - smooth(clamp((p - c) / (d - c))));

const TONGUES = 26;
// Flames lean out from straight up (-84 to 84 degrees), so the pressure reads as a plume, not a star.
const tongueAngle = (i: number) => -84 + (168 * i) / (TONGUES - 1);
const tongueLen = (i: number) => (0.45 + 0.55 * Math.abs(Math.sin(i * 2.17))) * (0.55 + 0.45 * Math.cos((tongueAngle(i) * Math.PI) / 180));
const RINGS = 3;

export default function BankaiHero() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const swordRef = useRef<HTMLDivElement>(null);
  const bladeRef = useRef<SVGGElement>(null);
  const sealedRef = useRef<SVGGElement>(null);
  const trueBladeRef = useRef<SVGGElement>(null);
  const auraRef = useRef<SVGGElement>(null);
  const ribbonRef = useRef<SVGGElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const slashRef = useRef<HTMLDivElement>(null);
  const ch1 = useRef<HTMLParagraphElement>(null);
  const ch2 = useRef<HTMLParagraphElement>(null);
  const ch3 = useRef<HTMLParagraphElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    if (!wrap || !stage) return;
    const root = document.documentElement;

    let raf = 0;
    let lastP = -1;
    let onHero = true;
    let w = 0;
    let h = 0;
    let wide = true;
    // Phones get half the flames: the same look for half the painting.
    const lean = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 819px)').matches;
    const tongues = Array.from(auraRef.current?.querySelectorAll<SVGPathElement>('[data-tongue]') ?? []).filter((t, i) => {
      if (lean && i % 2 === 1) {
        t.style.display = 'none';
        return false;
      }
      return true;
    });
    const rings = Array.from(auraRef.current?.querySelectorAll<SVGCircleElement>('[data-ring]') ?? []);

    const measure = () => {
      w = stage.clientWidth;
      h = stage.clientHeight;
      wide = w >= 820;
    };

    const paint = (p: number) => {
      const sword = swordRef.current;
      if (!sword) return;
      const aura = kf(p, [[0.2, 0], [0.5, 1], [0.6, 1], [0.66, 0.12], [0.8, 0.08], [1, 0.22]]);
      const awaken = kf(p, [[0.3, 0], [0.56, 1]]);
      const flash = Math.max(0, 1 - Math.abs(p - 0.605) / 0.022);
      const shake = (flash > 0 ? 10 : aura * 2.2) * (p > 0.2 && p < 0.7 ? 1 : 0);
      const sx = Math.sin(p * 311) * shake;
      const sy = Math.cos(p * 277) * shake;

      // Sword: tilts and slides right as it is released.
      const rot = kf(p, [[0, 0], [0.3, 0], [0.55, -3], [0.63, -16], [0.8, -40], [1, -54]]);
      const tx = kf(p, [[0, 0], [0.62, 0], [0.88, wide ? 0.27 : 0.13]]) * w;
      const ty = kf(p, [[0, -0.03], [0.6, 0], [1, wide ? 0.08 : 0.2]]) * h;
      const scale = kf(p, [[0, 0.92], [0.5, 1.02], [0.62, 1.14], [1, wide ? 0.98 : 0.86]]);
      // On a narrow screen the finished sword sits behind the text, so it steps back.
      sword.style.opacity = wide ? '1' : (1 - 0.5 * smooth(clamp((p - 0.8) / 0.12))).toFixed(2);
      sword.style.transform = `translate3d(${(tx + sx).toFixed(1)}px, ${(ty + sy).toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;

      // Blade: short and broad while sealed, long and slim once released.
      const bsy = kf(p, [[0, 0.44], [0.25, 0.5], [0.55, 0.62], [0.63, 1.04], [0.72, 1]]);
      const bsx = kf(p, [[0, 1.8], [0.55, 1.85], [0.63, 0.72], [0.72, 0.66]]);
      bladeRef.current?.setAttribute('transform', `scale(${bsx.toFixed(3)} ${bsy.toFixed(3)})`);
      sealedRef.current?.style.setProperty('opacity', (1 - awaken).toFixed(3));
      trueBladeRef.current?.style.setProperty('opacity', awaken.toFixed(3));
      ribbonRef.current?.setAttribute('transform', `rotate(${(Math.sin(p * 40) * 7 * (0.3 + awaken)).toFixed(2)} 0 170)`);

      // Pressure: red tongues grow from the blade, rings travel outward.
      tongues.forEach((t, i) => {
        const flicker = 0.82 + 0.18 * Math.sin(p * 60 + i * 1.7);
        const len = aura * tongueLen(i) * flicker;
        const lean = tongueAngle(i) + Math.sin(p * 9 + i) * 3;
        t.setAttribute('transform', `rotate(${lean.toFixed(2)}) scale(${(0.5 + len * 0.7).toFixed(3)} ${(len * 1.5).toFixed(3)})`);
        t.style.opacity = (0.2 + aura * 0.8).toFixed(3);
      });
      rings.forEach((r, i) => {
        const t = (((p - 0.2) * 3.2 + i / RINGS) % 1 + 1) % 1;
        r.setAttribute('r', (30 + t * 520).toFixed(1));
        r.style.opacity = (aura * (1 - t) * 0.75).toFixed(3);
      });
      glowRef.current?.style.setProperty('opacity', (aura * 0.9).toFixed(3));
      flashRef.current?.style.setProperty('opacity', (flash * 0.8).toFixed(3));

      // The cut: a diagonal slash wipes across, and the name is revealed behind it.
      const cut = smooth(clamp((p - 0.66) / 0.14));
      if (slashRef.current) {
        slashRef.current.style.opacity = (cut > 0 && cut < 1 ? 1 : 0).toString();
        slashRef.current.style.transform = `translate3d(${((cut - 0.5) * 140).toFixed(1)}%, 0, 0) skewX(-28deg)`;
      }
      if (nameRef.current) {
        const edge = cut * 130 - 15; // % of width the wipe has reached
        nameRef.current.style.clipPath = `polygon(0 0, ${edge.toFixed(1)}% 0, ${(edge - 14).toFixed(1)}% 100%, 0 100%)`;
        nameRef.current.style.opacity = cut > 0 ? '1' : '0';
      }
      roleRef.current?.style.setProperty('opacity', smooth(clamp((p - 0.8) / 0.1)).toFixed(3));
      roleRef.current?.style.setProperty('transform', `translate3d(0, ${((1 - smooth(clamp((p - 0.8) / 0.1))) * 24).toFixed(1)}px, 0)`);
      hintRef.current?.style.setProperty('opacity', (1 - smooth(clamp(p / 0.06))).toFixed(3));
      ch1.current?.style.setProperty('opacity', window4(p, 0.05, 0.11, 0.19, 0.25).toFixed(3));
      ch2.current?.style.setProperty('opacity', window4(p, 0.27, 0.33, 0.42, 0.48).toFixed(3));
      ch3.current?.style.setProperty('opacity', window4(p, 0.47, 0.51, 0.55, 0.585).toFixed(3));
      if (barRef.current) barRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
    };

    const tick = () => {
      raf = 0;
      const r = wrap.getBoundingClientRect();
      const range = r.height - window.innerHeight;
      const p = range > 0 ? clamp(-r.top / range) : 0;
      const now = r.bottom > 64 && r.top < window.innerHeight;
      if (now !== onHero) {
        onHero = now;
        root.dataset.onHero = now ? '1' : '0';
      }
      if (!now || Math.abs(p - lastP) < 0.0004) return;
      lastP = p;
      paint(p);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onResize = () => {
      measure();
      lastP = -1;
      schedule();
    };

    measure();
    root.dataset.onHero = '1';
    tick();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', onResize);
      delete root.dataset.onHero;
    };
  }, []);

  return (
    <div ref={wrapRef} className="bankai relative h-[430vh] md:h-[470vh]" aria-labelledby="name">
      <div ref={stageRef} className="sticky top-0 h-[100svh] overflow-hidden bg-[#070708] text-[#f4f1ea]">
        {/* Pressure glow behind everything */}
        <div ref={glowRef} className="pointer-events-none absolute inset-0 opacity-0 will-change-[opacity]" style={{ background: 'radial-gradient(60% 60% at 50% 50%, rgba(255,48,26,0.55), rgba(120,10,6,0.25) 45%, transparent 75%)' }} />

        {/* The sword. Drawn once; scroll only moves, scales and fades its parts. */}
        <div ref={swordRef} className="pointer-events-none absolute left-1/2 top-1/2 will-change-transform" style={{ width: 'min(92vmin, 760px)', height: 'min(92vmin, 760px)', marginLeft: 'calc(min(92vmin, 760px) / -2)', marginTop: 'calc(min(92vmin, 760px) / -2)', transform: 'translate3d(0,0,0) scale(0.92)' }}>
          <svg viewBox="-300 -620 600 900" className="h-full w-full overflow-visible" aria-hidden="true">
            <g ref={auraRef} transform="translate(0 -270)">
              {Array.from({ length: RINGS }, (_, i) => (
                <circle key={`r${i}`} data-ring r="40" fill="none" stroke="#ff3a24" strokeWidth="2" opacity="0" />
              ))}
              {Array.from({ length: TONGUES }, (_, i) => (
                <path
                  key={`t${i}`}
                  data-tongue
                  d="M0 0 C 22 -70, -10 -150, 12 -300 C -14 -190, -30 -90, 0 0 Z"
                  fill={i % 3 === 0 ? '#ff3a24' : i % 3 === 1 ? '#a5120b' : '#1a0605'}
                  stroke={i % 3 === 2 ? '#ff3a24' : 'none'}
                  strokeWidth="1.2"
                  opacity="0"
                />
              ))}
            </g>

            {/* Ribbon from the pommel */}
            <g ref={ribbonRef}>
              <path d="M0 176 C -30 230, 40 250, 6 300 C -10 322, 20 340, 0 372" fill="none" stroke="#ff3a24" strokeWidth="3" strokeLinecap="round" />
              <path d="M-6 176 C -46 228, 22 262, -14 310" fill="none" stroke="#7a0f0a" strokeWidth="2.2" strokeLinecap="round" />
            </g>

            {/* Hilt: wrapped grip, guard, pommel */}
            <g>
              <rect x="-10" y="8" width="20" height="160" rx="3" fill="#131314" stroke="#f4f1ea" strokeOpacity="0.55" strokeWidth="1.2" />
              {Array.from({ length: 9 }, (_, i) => (
                <path key={i} d={`M-10 ${14 + i * 17} L0 ${24 + i * 17} L10 ${14 + i * 17}`} fill="none" stroke="#f4f1ea" strokeOpacity="0.28" strokeWidth="1" />
              ))}
              <ellipse cx="0" cy="3" rx="34" ry="8" fill="#0b0b0c" stroke="#f4f1ea" strokeOpacity="0.8" strokeWidth="1.6" />
              <circle cx="0" cy="174" r="12" fill="#0b0b0c" stroke="#ff3a24" strokeWidth="2" />
            </g>

            {/* Blade: both versions live in one scaled group so the morph is a single transform */}
            <g ref={bladeRef} transform="scale(1.8 0.44)">
              <g ref={sealedRef}>
                <path d="M-14 0 L-14 -440 Q-14 -468 -2 -490 L14 -446 L14 0 Z" fill="#8c8a84" stroke="#d9d5cb" strokeWidth="1.6" />
                <path d="M0 0 L0 -440" stroke="#5e5c57" strokeWidth="1.4" />
              </g>
              <g ref={trueBladeRef} opacity="0">
                <path d="M-14 0 L-14 -440 Q-14 -468 -2 -490 L14 -446 L14 0 Z" fill="#050505" stroke="#f4f1ea" strokeOpacity="0.9" strokeWidth="1.4" />
                <path d="M-14 0 L-14 -440 Q-14 -468 -2 -490" fill="none" stroke="#ff3a24" strokeWidth="5" strokeOpacity="0.35" />
                <path d="M-14 0 L-14 -440 Q-14 -468 -2 -490" fill="none" stroke="#ff6a52" strokeWidth="1.6" />
                <path d="M-2 -14 L-2 -440" stroke="#f4f1ea" strokeOpacity="0.3" strokeWidth="1" />
              </g>
            </g>
          </svg>
        </div>

        {/* Flash and slash */}
        <div ref={flashRef} className="pointer-events-none absolute inset-0 bg-[#ffe9e3] opacity-0 will-change-[opacity]" />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-full overflow-hidden" aria-hidden="true">
          <div ref={slashRef} className="absolute inset-y-[-10%] left-[-20%] w-[26%] opacity-0 will-change-transform" style={{ background: 'linear-gradient(90deg, transparent, #ff3a24 35%, #fff 50%, #ff3a24 65%, transparent)', mixBlendMode: 'screen' }} />
        </div>

        {/* Captions: the real timeline */}
        <div className="pointer-events-none absolute inset-x-0 top-[22%] mx-auto max-w-[1100px] px-5 sm:px-8">
          <p ref={ch1} className="absolute max-w-[18ch] font-sans text-[clamp(1.6rem,4.6vw,3.4rem)] font-bold leading-[1.02] opacity-0" style={{ fontVariationSettings: "'wdth' 80" }}>
            2019. A Discord bot and a first commit.
          </p>
          <p ref={ch2} className="absolute max-w-[18ch] font-sans text-[clamp(1.6rem,4.6vw,3.4rem)] font-bold leading-[1.02] opacity-0" style={{ fontVariationSettings: "'wdth' 80" }}>
            Five million interactions. Acquired in 2024.
          </p>
          <p ref={ch3} className="absolute max-w-[18ch] font-sans text-[clamp(1.6rem,4.6vw,3.4rem)] font-bold leading-[1.02] opacity-0" style={{ fontVariationSettings: "'wdth' 80" }}>
            Now: agents that run unattended.
          </p>
        </div>

        {/* The name, cut into the page */}
        <div className="absolute inset-x-0 bottom-0 top-0 mx-auto flex max-w-[1200px] flex-col justify-center px-5 sm:px-8">
          <h1
            id="name"
            ref={nameRef}
            data-name
            className="max-w-[11ch] font-sans text-[clamp(3.6rem,15.5vw,11rem)] font-extrabold leading-[0.86] tracking-[-0.035em] opacity-0"
            style={{ fontVariationSettings: "'wdth' 78", clipPath: 'polygon(0 0, 0 0, -14% 100%, 0 100%)' }}
          >
            Drishtant Ghosh
            <span className="sr-only"> (Drix10), AI systems engineer and serial founder in Bengaluru</span>
          </h1>
          <div ref={roleRef} className="mt-7 max-w-[30rem] opacity-0 sm:mt-9">
            <p className="font-serif text-[clamp(1.2rem,2.2vw,1.55rem)] leading-[1.45] text-[#d9d5cb]">
              Serial founder and AI systems engineer in Bengaluru. I ran ReeF from its first commit to an acquisition, and now build agent infrastructure and research systems.
            </p>
            <p className="mt-4 text-[1rem] text-[#a8a49a]">
              <span className="font-semibold text-[#f4f1ea]">Building now: </span>
              {NOW_BUILDING.map((n, i) => (
                <span key={n.name}>
                  <a href={n.href} target="_blank" rel="noreferrer" className="pointer-events-auto border-b border-[#ff3a24]/70 text-[#f4f1ea] hover:text-[#ff6a52]">
                    {n.name}
                  </a>
                  {i < NOW_BUILDING.length - 1 ? ', ' : '.'}
                </span>
              ))}
            </p>
            <ul className="pointer-events-auto mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[1rem]">
              <li><a className="border-b border-[#f4f1ea]/40 hover:border-[#ff3a24]" href="mailto:ggdrishtant@gmail.com">Email</a></li>
              <li><a className="border-b border-[#f4f1ea]/40 hover:border-[#ff3a24]" href="https://github.com/Drix10" target="_blank" rel="me noreferrer">GitHub</a></li>
              <li><a className="border-b border-[#f4f1ea]/40 hover:border-[#ff3a24]" href="https://www.linkedin.com/in/drix10" target="_blank" rel="me noreferrer">LinkedIn</a></li>
              <li><a className="border-b border-[#f4f1ea]/40 hover:border-[#ff3a24]" href="https://x.com/DrishtantGhosh" target="_blank" rel="me noreferrer">X</a></li>
              <li><a className="border-b border-[#f4f1ea]/40 hover:border-[#ff3a24]" href="https://blogs.drix10.com" target="_blank" rel="noreferrer">Blog</a></li>
            </ul>
          </div>
        </div>

        <div ref={hintRef} className="pointer-events-none absolute bottom-8 left-5 flex items-center gap-3 text-[0.9375rem] text-[#a8a49a] sm:left-[max(2rem,calc((100vw-1200px)/2+2rem))]">
          <span>Scroll</span>
          <span className="block h-px w-12 animate-pulse bg-gradient-to-r from-[#ff3a24] to-transparent" />
        </div>

        {/* Progress: a thin red line along the bottom edge of the stage */}
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[#f4f1ea]/10">
          <div ref={barRef} className="h-full origin-left bg-[#ff3a24]" style={{ transform: 'scaleX(0)' }} />
        </div>
      </div>
      <noscript>
        <style>{`.bankai [data-name]{opacity:1 !important;clip-path:none !important}`}</style>
      </noscript>
    </div>
  );
}
