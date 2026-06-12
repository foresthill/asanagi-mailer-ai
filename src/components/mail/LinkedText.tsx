"use client";

import { Fragment } from "react";

/**
 * Plain text with live http(s) links. Trailing punctuation (Japanese
 * brackets, periods, …) is kept as text so 「https://example.com」 doesn't
 * produce a broken URL. http(s) only — no javascript:/data: schemes.
 */
const URL_RE = /(https?:\/\/[^\s<>"'「」『』（）()]+)/g;
const TRAILING = /[.,;:!?。、）)\]］>»…]+$/;

export function LinkedText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        // split() with a capture group alternates text / match.
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const trail = part.match(TRAILING)?.[0] ?? "";
        const url = trail ? part.slice(0, -trail.length) : part;
        return (
          <Fragment key={i}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="break-all underline decoration-current/40 underline-offset-2 hover:decoration-current"
            >
              {url}
            </a>
            {trail}
          </Fragment>
        );
      })}
    </>
  );
}
