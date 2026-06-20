import { useEffect, useState, useCallback } from 'react';

// Scaling table from PLAN.md §3.1. Base font is what <body> gets at each tier;
// `factor` is derived from it (tier.baseFont / REFERENCE_FONT) and is what the
// scale() helper multiplies every other design value by, so a single source of
// truth (base font px) drives both the global body font-size and every inline
// fontSize/padding/gap/radius value across the app.
const REFERENCE_FONT = 13; // the "1.0 / standard 1080p" baseline every component was authored against

const DPR_TIERS = [
  { max: 1.0,  dpr: 1.0,  baseFont: 13, label: 'Standard 1080p' },
  { max: 1.25, dpr: 1.25, baseFont: 12, label: '125% Windows scaling' },
  { max: 1.5,  dpr: 1.5,  baseFont: 11, label: '150% / 2K screens' },
  { max: Infinity, dpr: 2.0, baseFont: 10, label: 'Retina / 4K' },
];

function resolveTier(dpr) {
  // devicePixelRatio in the renderer reflects OS scaling directly (1.0, 1.25, 1.5,
  // 1.75, 2.0, ...). Each tier's `max` is an upper bound, so a dpr is bucketed
  // into the first tier whose ceiling it doesn't exceed (e.g. 1.1 -> 1.25 tier,
  // 1.4 -> 1.5 tier). Anything above 1.5 — including in-between values like
  // 1.75 — falls through to the final Retina/4K tier.
  if (dpr <= 1.0) return DPR_TIERS[0];
  if (dpr <= 1.25) return DPR_TIERS[1];
  if (dpr <= 1.5) return DPR_TIERS[2];
  return DPR_TIERS[3];
}

/**
 * Reads window.devicePixelRatio and exposes:
 *  - dpr: the raw devicePixelRatio reported by the OS/browser
 *  - tier: the matched entry from the scaling table (dpr, baseFont, label)
 *  - scale(px): multiplies a design value (authored at the 13px/1.0 baseline)
 *    by the current tier's factor — use this for fontSize, padding, gap, width,
 *    height, and radius values in inline styles instead of raw numbers.
 *
 * Also writes the resolved values to CSS custom properties on the document root
 * (--dpr-base-font, --dpr-scale) so plain CSS rules in index.css can react too,
 * without every component needing to re-derive them.
 */
export function useDPRValue() {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);

  useEffect(() => {
    // devicePixelRatio doesn't fire a change event itself; the documented way to
    // detect a change (e.g. window dragged to a different-DPI monitor) is a
    // matchMedia query tied to the current ratio, re-subscribed each time it fires.
    let mql;
    const handleChange = () => setDpr(window.devicePixelRatio || 1);

    function subscribe() {
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mql.addEventListener('change', onChange);
    }
    function onChange() {
      handleChange();
      mql.removeEventListener('change', onChange);
      subscribe();
    }
    subscribe();

    return () => mql?.removeEventListener('change', onChange);
  }, []);

  const tier = resolveTier(dpr);
  const factor = tier.baseFont / REFERENCE_FONT;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--dpr-base-font', `${tier.baseFont}px`);
    root.style.setProperty('--dpr-scale', String(factor));
  }, [tier.baseFont, factor]);

  const scale = useCallback((px) => Math.round(px * factor * 100) / 100, [factor]);

  return { dpr, tier, factor, scale };
}
