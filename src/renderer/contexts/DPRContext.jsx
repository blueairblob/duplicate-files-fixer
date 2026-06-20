import React, { createContext, useContext } from 'react';
import { useDPRValue } from '../hooks/useDPR.js';

const DPRContext = createContext(null);

export function DPRProvider({ children }) {
  const value = useDPRValue();
  return <DPRContext.Provider value={value}>{children}</DPRContext.Provider>;
}

/**
 * Returns { dpr, tier, factor, scale }. Call scale(px) on any design value
 * (fontSize, padding, gap, width, height, radius, ...) that was authored at the
 * 13px/1.0 baseline, and it'll come back correctly sized for the user's display.
 */
export function useDPR() {
  const ctx = useContext(DPRContext);
  if (!ctx) {
    throw new Error('useDPR() must be called inside <DPRProvider>');
  }
  return ctx;
}
