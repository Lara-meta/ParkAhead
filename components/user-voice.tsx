"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
export function UserVoice() {
  const [quote, setQuote] = useState<string | null>(null);
  useEffect(() => {
    api<{ quote: string }>("demo/story")
      .then((r) => setQuote(r.quote))
      .catch(() => {});
  }, []);
  return (
    <section className="panel bg-[#e9efdf]">
      <span className="eyebrow">
        Illustrative user statement — not a research interview
      </span>
      <blockquote className="my-5 text-2xl leading-9">
        {quote
          ? `“${quote}”`
          : "Illustrative statement unavailable. Configure the database to load the editable demo quote."}
      </blockquote>
      <p className="text-xs muted">
        Editable by an authorized admin in Demo controls. No participant,
        interview or validated research is implied.
      </p>
    </section>
  );
}
