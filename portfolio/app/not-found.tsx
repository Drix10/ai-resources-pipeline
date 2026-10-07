import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[1100px] px-5 py-24 sm:px-8 sm:py-32">
      <h1 className="text-[clamp(2.4rem,8vw,5rem)] font-bold leading-[1.02] tracking-[-0.03em] text-ink" style={{ fontVariationSettings: "'wdth' 92" }}>
        That page is not here
      </h1>
      <p className="prose-text mt-6">The address may be mistyped or the page may have moved. The whole site is one page, so start from the top.</p>
      <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
        <Link href="/" className="link">Back to the portfolio</Link>
        <a href="https://blogs.drix10.com" className="link">Read the blog</a>
      </p>
    </div>
  );
}
