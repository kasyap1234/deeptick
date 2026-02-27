import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center bg-background text-foreground">
      <span className="font-mono text-8xl mb-4 opacity-20 select-none">404</span>
      <h2 className="font-serif text-3xl mb-2">Page Not Found</h2>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-8">
        THE REQUESTED RESOURCE DOES NOT EXIST
      </p>
      <Link
        href="/"
        className="inline-flex items-center justify-center rounded-none font-mono text-[10px] uppercase tracking-widest border-2 border-foreground px-8 py-4 hover:bg-foreground hover:text-background transition-colors"
      >
        RETURN TO BASE
      </Link>
    </div>
  );
}
