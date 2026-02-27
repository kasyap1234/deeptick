"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "monospace", background: "#090909", color: "#E6E4DD" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem", textAlign: "center" }}>
          <span style={{ fontSize: "4rem", marginBottom: "1.5rem", opacity: 0.3 }}>!</span>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Critical Error</h2>
          <p style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.6, marginBottom: "2rem" }}>
            {error.digest ? `DIGEST: ${error.digest}` : "AN UNEXPECTED ERROR OCCURRED"}
          </p>
          <button
            onClick={reset}
            style={{ padding: "0.75rem 2rem", border: "2px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer", fontFamily: "monospace", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.15em" }}
          >
            RETRY
          </button>
        </div>
      </body>
    </html>
  );
}
