import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="max-w-[40rem] py-10">
      <h1 className="display text-[clamp(2.2rem,6vw,3.5rem)] font-bold leading-[1.05] text-ink">That page is not here</h1>
      <p className="mt-5 font-serif text-[1.25rem] leading-[1.6] text-body">
        The digest may have been renamed or removed. Search the archive, or browse by topic.
      </p>
      <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
        <Link href="/" className="link">Search all digests</Link>
        <Link href="/categories" className="link">Browse topics</Link>
      </p>
    </div>
  );
}
