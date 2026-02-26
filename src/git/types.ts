export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  refs: Ref[];
}

export interface Ref {
  name: string;
  type: "branch" | "tag" | "remote" | "head" | "stash";
}

export function parseRefs(raw: string): Ref[] {
  if (!raw.trim()) return [];
  const refs: Ref[] = [];
  for (const r of raw.split(",")) {
    const name = r.trim();
    if (!name) continue;
    if (name.startsWith("HEAD -> ")) {
      refs.push({ name: "HEAD", type: "head" });
      refs.push({ name: name.slice(8), type: "branch" });
    } else if (name === "HEAD") {
      refs.push({ name, type: "head" });
    } else if (name.startsWith("tag: ")) {
      refs.push({ name: name.slice(5), type: "tag" });
    } else if (name.includes("/")) {
      refs.push({ name, type: "remote" });
    } else {
      refs.push({ name, type: "branch" });
    }
  }
  return refs;
}
