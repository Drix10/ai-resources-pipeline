export default function NotFound() {
  return (
    <div className="max-w-md mx-auto py-20 text-center space-y-4">
      <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-lg flex items-center justify-center mx-auto">
        404
      </div>
      <h1 className="text-xl font-bold text-zinc-100">Article or Topic Not Found</h1>
      <p className="text-xs text-zinc-400">
        The requested technical breakdown or folder does not exist or has been moved.
      </p>
      <a
        href="/"
        className="inline-block px-4 py-2 rounded-md bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-zinc-200 transition-colors"
      >
        ← Back to Knowledge Hub
      </a>
    </div>
  );
}
