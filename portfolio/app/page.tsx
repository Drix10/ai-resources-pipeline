import type { ReactNode } from 'react';
import AgentField from '@/components/AgentField';
import BankaiHero from '@/components/BankaiHero';
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
      <BankaiHero />

      <section aria-labelledby="hunt" className="relative overflow-hidden border-t border-rule bg-sunk">
        <AgentField />
        <div className="relative mx-auto max-w-[1200px] px-5 py-28 sm:px-8 sm:py-44">
          <h2
            id="hunt"
            data-quiet
            className="max-w-[13ch] font-sans text-[clamp(2.8rem,9vw,7rem)] font-extrabold leading-[0.88] tracking-[-0.035em] text-ink"
            style={{ fontVariationSettings: "'wdth' 78" }}
          >
            Small brains, big learning curves.
          </h2>
          <p data-quiet className="prose-text mt-8">
            The mice behind this page run from an owl, a school that learned to survive over many generations. It is{' '}
            <a href="https://github.com/Drix10/ml-videos" target="_blank" rel="noreferrer" className="link">
              Night-Hunt
            </a>
            , one of my evolving-agent experiments, running live in your browser.
          </p>
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
