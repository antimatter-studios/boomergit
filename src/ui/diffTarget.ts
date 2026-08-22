import { shortHash } from "../git/format.js";
import type { ChangedFile } from "../providers/changedFilesProvider.js";

/**
 * The sentinel ref meaning "no content on this side" — used for a file that
 * didn't exist yet, one that's been deleted, and the parent side of a root
 * commit. The file content provider resolves it to a blank document.
 */
export const EMPTY_REF = "empty";

export interface DiffTarget {
  leftRef: string;
  rightRef: string;
  leftPath: string;
  rightPath: string;
  leftLabel: string;
  rightLabel: string;
  title: string;
}

/**
 * Work out what to put on each side of a file diff.
 *
 * An added file has nothing on the left, a deleted file has nothing on the
 * right, and a rename has a different path on each side.
 */
export function computeDiffTarget(
  file: ChangedFile,
  commitHash: string,
  parentHash: string
): DiffTarget {
  const isAdded = file.status === "A";
  const leftRef = isAdded || !parentHash ? EMPTY_REF : parentHash;
  const rightRef = file.status === "D" ? EMPTY_REF : commitHash;

  const leftPath = file.oldPath ?? file.path;
  const rightPath = file.path;

  const leftLabel = leftRef === EMPTY_REF ? "New File" : `Parent ${shortHash(parentHash)}`;
  const rightLabel = rightRef === EMPTY_REF ? "Deleted" : `Commit ${shortHash(commitHash)}`;

  const basename = rightPath.split("/").pop() || rightPath;

  return {
    leftRef,
    rightRef,
    leftPath,
    rightPath,
    leftLabel,
    rightLabel,
    title: `${basename} (${leftLabel} ↔ ${rightLabel})`,
  };
}
