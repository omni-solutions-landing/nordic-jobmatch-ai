/**
 * Active-CV succession — pure helper for choosing which CV becomes active
 * after the currently active one is deleted.
 */

export interface CvCandidate {
  readonly id: string;
  readonly updated_at: string;
}

/**
 * Picks the most recently updated CV from the remaining candidates, or null
 * when none remain. Most-recent wins because it is the closest proxy for
 * "the CV the user currently cares about".
 */
export function pickNextActiveCv(
  candidates: readonly CvCandidate[],
): CvCandidate | null {
  let best: CvCandidate | null = null;
  for (const candidate of candidates) {
    if (!best || Date.parse(candidate.updated_at) > Date.parse(best.updated_at)) {
      best = candidate;
    }
  }
  return best;
}
