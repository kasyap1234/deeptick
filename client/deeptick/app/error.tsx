"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center bg-background text-foreground">
      <span className="font-mono text-6xl mb-6 opacity-30 select-none">!</span>
      <h2 className="font-serif text-2xl mb-2">Something went wrong</h2>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-8">
        {error.digest ? `ERROR DIGEST: ${error.digest}` : "AN UNEXPECTED ERROR OCCURRED"}
      </p>
      <Button
        onClick={reset}
        variant="outline"
        className="rounded-none font-mono text-[10px] uppercase tracking-widest border-2 border-foreground px-8 py-6"
      >
        RETRY
      </Button>
    </div>
  );
}
