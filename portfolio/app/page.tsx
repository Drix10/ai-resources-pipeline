import type { ReactNode } from 'react';
import NameSwarm from '@/components/NameSwarm';
import Work from '@/components/Work';
import OpenSource from '@/components/OpenSource';
import GitHubActivity from '@/components/GitHubActivity';
import Writing from '@/components/Writing';
import ContactEmail from '@/components/ContactEmail';
import { getGitHubProfile, USERNAME } from '@/lib/github';
import { PERSON_ID, jsonLd } from '@/lib/site';
import { EDUCATION, HACKATHONS, NOW_BUILDING, ROLES, SKILLS } from '@/lib/profile';

// Projects, stars, activity and open-source work are read from GitHub; rebuild hourly.
export const revalidate = 3600;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="relative border-t border-rule">
      <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-32">
        <h2 className="section-title">
          {title}
          <span className="slash" aria-hidden />
        </h2>
        <div className="mt-10 min-w-0 sm:mt-16">{children}</div>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const gh = await getGitHubProfile();
  // Throwing keeps the previous version of the page being served during revalidation and fails a
  // build loudly, instead of caching an empty "GitHub did not answer" page for an hour.
  if (!gh && process.env.NODE_ENV === 'production') throw new Error('GitHub data unavailable');
  const featured = gh?.selection.featured ?? [];
  const more = gh?.selection.more ?? [];
  const hasProjects = featured.length + more.length > 0;

  const projectList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Projects by Drishtant Ghosh',
    itemListElement: [...featured, ...more].map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'SoftwareSourceCode',
        name: r.name,
        description: r.description || undefined,
        codeRepository: r.url,
        url: r.homepage || r.url,
        programmingLanguage: r.language || undefined,
        author: { '@id': PERSON_ID },
      },
    })),
  };

  return (
    <>
      {hasProjects && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(projectList) }} />}
      <section aria-labelledby="name" className="relative isolate overflow-hidden">
        <NameSwarm />
        <div className="relative mx-auto flex min-h-[calc(100svh-3.5rem)] max-w-[1200px] flex-col justify-center px-5 pb-14 pt-10 sm:px-8 sm:pb-20">
          <h1
            id="name"
            className="swarm-name max-w-[11ch] font-sans text-[clamp(3.6rem,15.5vw,11rem)] font-extrabold leading-[0.86] tracking-[-0.035em] text-ink lg:max-w-none lg:text-[clamp(5rem,13vw,13rem)]"
            style={{ fontVariationSettings: "'wdth' 78" }}
          >
            Drishtant Ghosh
            <span className="sr-only"> (Drix10), AI systems engineer and serial founder in Bengaluru</span>
          </h1>

          <div className="mt-10 grid gap-x-16 gap-y-8 sm:mt-14 lg:grid-cols-[1.25fr_1fr]">
            <p className="prose-text max-w-[34rem] text-[1.3125rem] sm:text-[1.5rem] sm:leading-[1.5]">
              Serial founder and AI systems engineer in Bengaluru, building since 2019. I ran ReeF from its first commit to an acquisition, and now build agent infrastructure and research systems.
            </p>
            <div className="max-w-[30rem]">
              <p className="text-[1.0625rem] text-body">
                <span className="font-semibold text-ink">Building now: </span>
                {NOW_BUILDING.map((n, i) => (
                  <span key={n.name}>
                    <a href={n.href} target="_blank" rel="noreferrer" className="link">
                      {n.name}
                    </a>
                    {i < NOW_BUILDING.length - 1 ? ', ' : '.'}
                  </span>
                ))}
              </p>
              <ul className="mt-5 flex flex-wrap gap-x-7 gap-y-3 text-[1.0625rem]">
                <li><a className="link" href="mailto:ggdrishtant@gmail.com">Email</a></li>
                <li><a className="link" href="https://github.com/Drix10" target="_blank" rel="me noreferrer">GitHub</a></li>
                <li><a className="link" href="https://www.linkedin.com/in/drix10" target="_blank" rel="me noreferrer">LinkedIn</a></li>
                <li><a className="link" href="https://x.com/DrishtantGhosh" target="_blank" rel="me noreferrer">X</a></li>
                <li><a className="link" href="https://blogs.drix10.com" target="_blank" rel="noreferrer">Blog</a></li>
              </ul>
              <p className="mt-6 text-[0.9375rem] text-faint">
                The name is a swarm of agents. An owl crosses it on its own and whatever it scares runs, then returns: the{' '}
                <a href="https://github.com/Drix10/ml-videos" target="_blank" rel="noreferrer" className="link">
                  Night-Hunt
                </a>{' '}
                experiment.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Section id="work" title="Work">
        {hasProjects ? (
          <>
            <p className="prose-text mb-10">
              Read from GitHub, so the descriptions, stars and dates here are the ones on the repositories. Pin a repository on my profile and it appears in this list.
            </p>
            <Work featured={featured} more={more} pinned={gh?.source === 'graphql'} />
          </>
        ) : (
          <p className="prose-text">
            Projects load from GitHub and it did not answer just now. They are all at{' '}
            <a className="link" href={`https://github.com/${USERNAME}`} target="_blank" rel="noreferrer">
              github.com/{USERNAME}
            </a>
            .
          </p>
        )}
        {gh?.calendar && (
          <div className="mt-16">
            <GitHubActivity total={gh.calendar.total} weeks={gh.calendar.weeks} pullRequests={gh.totals?.pullRequests} username={USERNAME} />
          </div>
        )}
      </Section>

      {gh && gh.openSource.length > 0 && (
        <Section id="open-source" title="Open source">
          <p className="prose-text mb-8">
            Pull requests I have sent to other people&rsquo;s projects over the past year, with the state GitHub reports for each.
          </p>
          <OpenSource repos={gh.openSource} />
        </Section>
      )}

      <Section id="experience" title="Experience">
        <ol className="space-y-12">
          {ROLES.map((r) => (
            <li key={r.org} className="row-slash grid gap-2 border-l-2 border-rule py-1 pl-5 sm:grid-cols-[11rem_1fr] sm:gap-8 sm:pl-8">
              <p className="pt-1 text-[0.9375rem] tabular-nums text-faint">{r.when}</p>
              <div>
                <h3 className="text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-tight tracking-tight text-ink" style={{ fontVariationSettings: "'wdth' 80" }}>
                  {r.title}, {r.org}
                </h3>
                <p className="mt-0.5 text-[0.9375rem] text-faint">{r.where}</p>
                <p className="prose-text mt-3">{r.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-16 border-t border-rule pt-10">
          <h3 className="mb-4 font-semibold text-ink">Hackathons</h3>
          <ul className="divide-y divide-rule border-y border-rule">
            {HACKATHONS.map((h) => (
              <li key={`${h.event}-${h.project}`} className="grid gap-x-8 gap-y-1 py-4 sm:grid-cols-[10.5rem_1fr]">
                <p className="text-[0.9375rem] tabular-nums text-faint">{h.when}</p>
                <p className="text-ink">
                  <span className="font-semibold">{h.event}</span>, {h.project}
                  <span className="block font-serif text-[1.0625rem] text-body">{h.result}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-16 grid gap-10 border-t border-rule pt-10 sm:grid-cols-2">
          {EDUCATION.map((e) => (
            <div key={e.name}>
              <h3 className="font-semibold text-ink">{e.name}</h3>
              <p className="text-[0.9375rem] tabular-nums text-faint">{e.when}</p>
              <p className="mt-2 font-serif text-[1.0625rem] leading-relaxed text-body">{e.line}</p>
            </div>
          ))}
        </div>

        <dl className="mt-16 grid gap-x-10 gap-y-8 border-t border-rule pt-10 sm:grid-cols-2">
          {SKILLS.map((s) => (
            <div key={s.group}>
              <dt className="font-semibold text-ink">{s.group}</dt>
              <dd className="mt-1.5 font-serif text-[1.0625rem] leading-relaxed text-body">{s.items}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="writing" title="Writing">
        <Writing />
      </Section>

      <Section id="contact" title="Contact">
        <p className="prose-text mb-8">
          Open to founding-engineer roles, agent infrastructure, security and research systems, and to collaborations. Email is the quickest way to reach me.
        </p>
        <ContactEmail />
      </Section>
    </>
  );
}
