import { describe, it, expect, beforeEach, vi } from "vitest";
import { Uri, __reset } from "./mocks/vscode.js";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { GitFileContentProvider, FILE_SCHEME, fileUri } = await import(
  "../src/providers/gitFileContentProvider.js"
);

type Callback = (err: Error | null, stdout: Buffer, stderr: Buffer) => void;

function gitReturns(stdout: string): void {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb: Callback) => {
    cb(null, Buffer.from(stdout), Buffer.from(""));
  });
}

beforeEach(() => {
  __reset();
  execFileMock.mockReset();
});

describe("fileUri", () => {
  it("uses the extension's file scheme", () => {
    expect(fileUri("src/a.ts", "HEAD", "/repo", "Commit abc").scheme).toBe(FILE_SCHEME);
  });

  it("puts the path in the uri path", () => {
    expect(fileUri("src/a.ts", "HEAD", "/repo", "L").path).toBe("/src/a.ts");
  });

  it("carries ref, cwd and label as a JSON query", () => {
    const uri = fileUri("src/a.ts", "abc123", "/repo", "Parent abc123");
    expect(JSON.parse(uri.query)).toEqual({
      ref: "abc123",
      cwd: "/repo",
      label: "Parent abc123",
    });
  });
});

describe("GitFileContentProvider", () => {
  it("shows a file at a given ref", async () => {
    gitReturns("file contents\n");
    const provider = new GitFileContentProvider();
    const content = await provider.provideTextDocumentContent(
      fileUri("src/a.ts", "abc123", "/repo", "L") as never
    );
    expect(content).toBe("file contents\n");
    expect(execFileMock.mock.calls[0][1]).toEqual(["show", "abc123:src/a.ts"]);
  });

  it("runs git in the repository the uri names", async () => {
    gitReturns("");
    const provider = new GitFileContentProvider();
    await provider.provideTextDocumentContent(
      fileUri("a.ts", "HEAD", "/some/repo", "L") as never
    );
    expect(execFileMock.mock.calls[0][2].cwd).toBe("/some/repo");
  });

  it("resolves blank for the 'empty' sentinel without calling git", async () => {
    const provider = new GitFileContentProvider();
    const content = await provider.provideTextDocumentContent(
      fileUri("src/new.ts", "empty", "/repo", "New File") as never
    );
    expect(content).toBe("");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("resolves blank when the file isn't in that commit", async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb: Callback) => {
      cb(new Error("failed"), Buffer.from(""), Buffer.from("fatal: path does not exist"));
    });
    const provider = new GitFileContentProvider();
    await expect(
      provider.provideTextDocumentContent(fileUri("gone.ts", "abc", "/repo", "L") as never)
    ).resolves.toBe("");
  });

  it("strips the leading slash before handing the path to git", async () => {
    gitReturns("");
    const provider = new GitFileContentProvider();
    await provider.provideTextDocumentContent(
      fileUri("deep/nested/file.ts", "HEAD", "/repo", "L") as never
    );
    expect(execFileMock.mock.calls[0][1][1]).toBe("HEAD:deep/nested/file.ts");
  });

  it("decodes multi-byte file content correctly", async () => {
    gitReturns("héllo — wörld ✓");
    const provider = new GitFileContentProvider();
    await expect(
      provider.provideTextDocumentContent(fileUri("a.ts", "HEAD", "/repo", "L") as never)
    ).resolves.toBe("héllo — wörld ✓");
  });

  it("preserves an empty file as empty content", async () => {
    gitReturns("");
    const provider = new GitFileContentProvider();
    await expect(
      provider.provideTextDocumentContent(fileUri("empty.ts", "HEAD", "/repo", "L") as never)
    ).resolves.toBe("");
  });
});

describe("GitFileContentProvider — uris not built by fileUri", () => {
  it("handles a path with no leading slash", async () => {
    gitReturns("contents");
    const provider = new GitFileContentProvider();
    const uri = Uri.parse(`${FILE_SCHEME}:src/a.ts`).with({
      query: JSON.stringify({ ref: "HEAD", cwd: "/repo", label: "L" }),
    });
    await provider.provideTextDocumentContent(uri as never);
    expect(execFileMock.mock.calls[0][1][1]).toBe("HEAD:src/a.ts");
  });

  it("treats a missing ref as empty rather than throwing", async () => {
    gitReturns("");
    const provider = new GitFileContentProvider();
    const uri = Uri.parse(`${FILE_SCHEME}:/a.ts`).with({ query: JSON.stringify({}) });
    await expect(provider.provideTextDocumentContent(uri as never)).resolves.toBe("");
  });

  it("treats a missing cwd as empty rather than throwing", async () => {
    gitReturns("x");
    const provider = new GitFileContentProvider();
    const uri = Uri.parse(`${FILE_SCHEME}:/a.ts`).with({
      query: JSON.stringify({ ref: "HEAD" }),
    });
    await provider.provideTextDocumentContent(uri as never);
    expect(execFileMock.mock.calls[0][2].cwd).toBe("");
  });
});
