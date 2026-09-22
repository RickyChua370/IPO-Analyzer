/**
 * Hoverable glossary term.
 *
 * Wraps any label on the dashboard so a first-time investor can hover (or tap,
 * or keyboard-focus) to get a plain-English explanation without leaving the
 * page. Uses fixed positioning computed from the trigger's rect so the card is
 * never clipped by a scrolling table, and flips when near a viewport edge.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { lookup } from '../lib/glossary.ts';

interface TermProps {
  /** Key into the glossary. */
  k: string;
  children: ReactNode;
  /** Render without the dotted underline (for headings that already stand out). */
  plain?: boolean;
}

const CARD_WIDTH = 330;
const GAP = 10;

export function Term({ k, children, plain }: TermProps) {
  const entry = lookup(k);
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Keep the card inside the viewport horizontally.
    let left = r.left + r.width / 2 - CARD_WIDTH / 2;
    left = Math.max(GAP, Math.min(left, window.innerWidth - CARD_WIDTH - GAP));
    // Flip above the trigger when there is not enough room below.
    const spaceBelow = window.innerHeight - r.bottom;
    const above = spaceBelow < 260 && r.top > 260;
    setPos({
      top: above ? r.top - GAP : r.bottom + GAP,
      left,
      above,
    });
  }, []);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, place]);

  // Unknown key: render the label unchanged rather than showing an empty card.
  if (!entry) return <>{children}</>;

  return (
    <span
      ref={ref}
      className={plain ? 'term term--plain' : 'term'}
      tabIndex={0}
      role="button"
      aria-label={`${entry.term}: ${entry.short}`}
      aria-expanded={open}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => {
        // Tap-to-toggle on touch devices.
        e.stopPropagation();
        if (open) hide();
        else show();
      }}
    >
      {children}
      {open && pos && (
        <span
          className="glossary-card"
          role="tooltip"
          style={{
            top: pos.top,
            left: pos.left,
            width: CARD_WIDTH,
            transform: pos.above ? 'translateY(-100%)' : undefined,
          }}
        >
          <span className="glossary-card__term">{entry.term}</span>
          <span className="glossary-card__short">{entry.short}</span>
          <span className="glossary-card__plain">{entry.plain}</span>
          <span className="glossary-card__label">Why it matters</span>
          <span className="glossary-card__body">{entry.whyItMatters}</span>
          {entry.ruleOfThumb && (
            <>
              <span className="glossary-card__label">Rough guide</span>
              <span className="glossary-card__body">{entry.ruleOfThumb}</span>
            </>
          )}
        </span>
      )}
    </span>
  );
}
