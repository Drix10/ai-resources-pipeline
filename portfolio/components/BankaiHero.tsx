'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { NOW_BUILDING } from '@/lib/profile';
import './bankai.css';

// A pinned, scroll-linked opening. All motion is CSS (see bankai.css): the browser plays it on the
// compositor from the scroll position, so it stays smooth without any per-frame JavaScript. This
// component only draws the scene and tells the header when it is over the dark stage.
//
// The scene is an original illustration of "sealed blade, then released". The captions are the real
// timeline: first commit 2019, ReeF acquired 2024, agents now.

const FLAMES = 26;
// Flames lean out from straight up (-84 to 84 degrees), so the pressure reads as a plume, not a star.
const angle = (i: number) => -84 + (168 * i) / (FLAMES - 1);
const length = (i: number) => (0.45 + 0.55 * Math.abs(Math.sin(i * 2.17))) * (0.55 + 0.45 * Math.cos((angle(i) * Math.PI) / 180));
const FLAME_FILL = ['#ff3a24', '#a5120b', '#1a0605'];

const BLADE = 'M-14 0 L-14 -440 Q-14 -468 -2 -490 L14 -446 L14 0 Z';
const EDGE = 'M-14 0 L-14 -440 Q-14 -468 -2 -490';

const LINK = 'border-b border-[#f4f1ea]/40 hover:border-[#ff3a24]';

export default function BankaiHero() {
  const wrapRef = useRef<HTMLDivElement>(null);

  // The header turns dark while the scene is on screen. One observer, no scroll listener.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof IntersectionObserver === 'undefined') return;
    const root = document.documentElement;
    root.dataset.onHero = '1';
    const io = new IntersectionObserver(
      ([entry]) => {
        root.dataset.onHero = entry.isIntersecting ? '1' : '0';
      },
      { rootMargin: '-56px 0px 0px 0px' }
    );
    io.observe(wrap);
    return () => {
      io.disconnect();
      delete root.dataset.onHero;
    };
  }, []);

  return (
    <div ref={wrapRef} className="bankai relative" aria-labelledby="name">
      <div className="bk-stage">
        <div className="bk-glow bk-a" />
        <div className="bk-tone" aria-hidden="true" />

        {/* Impact: speed lines burst out of the blade at the moment of release */}
        <div className="bk-impact bk-a" aria-hidden="true">
          <svg viewBox="-500 -500 1000 1000">
            {Array.from({ length: 56 }, (_, i) => {
              const a = (i / 56) * Math.PI * 2 + Math.sin(i * 12.9) * 0.04;
              const r0 = 150 + ((i * 37) % 70);
              const r1 = 330 + ((i * 53) % 170);
              const w = 1.2 + ((i * 29) % 5) * 0.9;
              return <line key={i} x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * r1} y2={Math.sin(a) * r1} stroke={i % 5 === 0 ? '#ff3a24' : '#f4f1ea'} strokeWidth={w} strokeLinecap="round" />;
            })}
          </svg>
        </div>

        {/* The sword, drawn in separate pieces so each one is its own composited layer. */}
        <div className="bk-shake bk-a pointer-events-none absolute inset-0">
          <div className="bk-sword bk-a">
            <div className="bk-rings">
              <div className="bk-ring r1 bk-a" />
              <div className="bk-ring r2 bk-a" />
            </div>
            <div className="bk-flames">
              {Array.from({ length: FLAMES }, (_, i) => (
                <div key={i} className="bk-flame bk-a" style={{ '--a': `${angle(i).toFixed(2)}deg`, '--l': length(i).toFixed(3) } as CSSProperties}>
                  <svg viewBox="-40 -300 80 300" aria-hidden="true">
                    <path
                      d="M0 0 C 22 -70, -10 -150, 12 -300 C -14 -190, -30 -90, 0 0 Z"
                      fill={FLAME_FILL[i % 3]}
                      stroke={i % 3 === 2 ? '#ff3a24' : 'none'}
                      strokeWidth="1.2"
                    />
                  </svg>
                </div>
              ))}
            </div>
            <div className="bk-ribbon bk-a">
              <svg viewBox="-60 170 120 210" aria-hidden="true">
                <path d="M0 176 C -30 230, 40 250, 6 300 C -10 322, 20 340, 0 372" fill="none" stroke="#ff3a24" strokeWidth="3" strokeLinecap="round" />
                <path d="M-6 176 C -46 228, 22 262, -14 310" fill="none" stroke="#7a0f0a" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="bk-hilt">
              <svg viewBox="-40 0 80 190" aria-hidden="true">
                <rect x="-10" y="8" width="20" height="160" rx="3" fill="#131314" stroke="#f4f1ea" strokeOpacity="0.55" strokeWidth="1.2" />
                {Array.from({ length: 9 }, (_, i) => (
                  <path key={i} d={`M-10 ${14 + i * 17} L0 ${24 + i * 17} L10 ${14 + i * 17}`} fill="none" stroke="#f4f1ea" strokeOpacity="0.28" strokeWidth="1" />
                ))}
                <ellipse cx="0" cy="3" rx="34" ry="8" fill="#0b0b0c" stroke="#f4f1ea" strokeOpacity="0.8" strokeWidth="1.6" />
                <circle cx="0" cy="174" r="12" fill="#0b0b0c" stroke="#ff3a24" strokeWidth="2" />
              </svg>
            </div>
            <div className="bk-blade bk-a">
              <div className="bk-glint bk-a" />
              <svg className="bk-sealed bk-a" viewBox="-40 -500 80 500" aria-hidden="true">
                <path d={BLADE} fill="#8c8a84" stroke="#d9d5cb" strokeWidth="1.6" />
                <path d="M0 0 L0 -440" stroke="#5e5c57" strokeWidth="1.4" />
              </svg>
              <svg className="bk-true bk-a" viewBox="-40 -500 80 500" aria-hidden="true">
                <path d={BLADE} fill="#050505" stroke="#f4f1ea" strokeOpacity="0.9" strokeWidth="1.4" />
                <path d={EDGE} fill="none" stroke="#ff3a24" strokeWidth="5" strokeOpacity="0.35" />
                <path d={EDGE} fill="none" stroke="#ff6a52" strokeWidth="1.6" />
                <path d="M-2 -14 L-2 -440" stroke="#f4f1ea" strokeOpacity="0.3" strokeWidth="1" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bk-flash bk-a" />
        <div className="bk-grain" aria-hidden="true" />

        {/* Captions: the real timeline */}
        <div className="pointer-events-none absolute inset-x-0 top-[22%] mx-auto max-w-[1200px] px-5 sm:px-8">
          <p className="bk-cap bk-c1 bk-a font-sans text-[clamp(1.6rem,4.6vw,3.4rem)] font-bold leading-[1.02]" style={{ fontVariationSettings: "'wdth' 80" }}>
            2019. A Discord bot and a first commit.
          </p>
          <p className="bk-cap bk-c2 bk-a font-sans text-[clamp(1.6rem,4.6vw,3.4rem)] font-bold leading-[1.02]" style={{ fontVariationSettings: "'wdth' 80" }}>
            Five million interactions. Acquired in 2024.
          </p>
          <p className="bk-cap bk-c3 bk-a font-sans text-[clamp(1.6rem,4.6vw,3.4rem)] font-bold leading-[1.02]" style={{ fontVariationSettings: "'wdth' 80" }}>
            Now: agents that run unattended.
          </p>
        </div>

        {/* The name, cut into the page */}
        <div className="absolute inset-0 mx-auto flex max-w-[1200px] flex-col justify-center px-5 sm:px-8">
          <div className="bk-namewrap w-fit">
            <h1
              id="name"
              className="bk-name bk-a max-w-[11ch] font-sans text-[clamp(3.6rem,15.5vw,11rem)] font-extrabold leading-[0.86] tracking-[-0.035em]"
              style={{ fontVariationSettings: "'wdth' 78" }}
            >
              Drishtant Ghosh
              <span className="sr-only"> (Drix10), AI systems engineer and serial founder in Bengaluru</span>
            </h1>
            <div className="bk-slash bk-a" aria-hidden="true">
              <svg viewBox="0 0 40 400" preserveAspectRatio="none">
                <path d="M17 0 L27 0 L40 96 L31 210 L36 400 L24 400 L12 280 L18 150 L6 70 Z" fill="#ff3a24" />
                <path d="M20 0 L24 0 L33 120 L27 250 L29 400 L25 400 L17 260 L22 140 Z" fill="#fff" />
              </svg>
            </div>
          </div>
          <div className="bk-role bk-a mt-7 max-w-[30rem] sm:mt-9">
            <p className="font-serif text-[clamp(1.2rem,2.2vw,1.55rem)] leading-[1.45] text-[#d9d5cb]">
              Serial founder and AI systems engineer in Bengaluru. I ran ReeF from its first commit to an acquisition, and now build agent infrastructure and research systems.
            </p>
            <p className="mt-4 text-[1rem] text-[#a8a49a]">
              <span className="font-semibold text-[#f4f1ea]">Building now: </span>
              {NOW_BUILDING.map((n, i) => (
                <span key={n.name}>
                  <a href={n.href} target="_blank" rel="noreferrer" className="border-b border-[#ff3a24]/70 text-[#f4f1ea] hover:text-[#ff6a52]">
                    {n.name}
                  </a>
                  {i < NOW_BUILDING.length - 1 ? ', ' : '.'}
                </span>
              ))}
            </p>
            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[1rem]">
              <li><a className={LINK} href="mailto:ggdrishtant@gmail.com">Email</a></li>
              <li><a className={LINK} href="https://github.com/Drix10" target="_blank" rel="me noreferrer">GitHub</a></li>
              <li><a className={LINK} href="https://www.linkedin.com/in/drix10" target="_blank" rel="me noreferrer">LinkedIn</a></li>
              <li><a className={LINK} href="https://x.com/DrishtantGhosh" target="_blank" rel="me noreferrer">X</a></li>
              <li><a className={LINK} href="https://blogs.drix10.com" target="_blank" rel="noreferrer">Blog</a></li>
            </ul>
          </div>
        </div>

        <div className="bk-hint bk-a pointer-events-none absolute bottom-8 left-5 flex items-center gap-3 text-[0.9375rem] text-[#a8a49a] sm:left-[max(2rem,calc((100vw-1200px)/2+2rem))]">
          <span>Scroll</span>
          <span className="block h-px w-12 bg-gradient-to-r from-[#ff3a24] to-transparent" />
        </div>

        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[#f4f1ea]/10">
          <div className="bk-bar bk-a h-full bg-[#ff3a24]" />
        </div>
      </div>
    </div>
  );
}
