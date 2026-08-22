/**
 * How many characters of a commit hash to show.
 *
 * Eight is what the graph column is sized for, and it's unambiguous well past
 * the size of repository this extension is used on.
 */
export const SHORT_HASH_LEN = 8;

/** A commit hash abbreviated for display. */
export function shortHash(hash: string): string {
  return hash.slice(0, SHORT_HASH_LEN);
}
