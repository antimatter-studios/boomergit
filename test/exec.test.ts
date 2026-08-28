import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * execFile is mocked at the module boundary: these tests are about how the
 * wrapper turns git's exit status into a resolve or a reject, not about git.
 *
 * Note the block bodies on beforeEach — a concise arrow would return the mock
 * (mockReset returns it), and Vitest calls a value returned from a hook as a
 * teardown function, which shows up as a bogus zero-argument execFile call.
 */
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { gitRun, gitQuery, gitQueryTrimmed, GIT_MAX_BUFFER } = await import("../src/git/exec.js");

type Callback = (err: Error | null, stdout: Buffer, stderr: Buffer) => void;

/** Make execFile succeed with `stdout`. */
function succeedsWith(stdout: string): void {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb: Callback) => {
    cb(null, Buffer.from(stdout), Buffer.from(""));
  });
}

/** Make execFile fail with `message`, and optionally git's own `stderr`. */
function failsWith(message: string, stderr = ""): void {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb: Callback) => {
    cb(new Error(message), Buffer.from(""), Buffer.from(stderr));
  });
}

describe("gitRun", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("invokes git with the given args and cwd", async () => {
    succeedsWith("");
    await gitRun(["status", "--short"], "/repo");
    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe("git");
    expect(args).toEqual(["status", "--short"]);
    expect(opts.cwd).toBe("/repo");
  });

  it("resolves stdout decoded as utf8", async () => {
    succeedsWith("on branch main\n");
    await expect(gitRun(["status"], "/repo")).resolves.toBe("on branch main\n");
  });

  it("preserves multi-byte characters", async () => {
    succeedsWith("café ✓ 日本語");
    await expect(gitRun(["log"], "/repo")).resolves.toBe("café ✓ 日本語");
  });

  it("rejects with git's stderr when the command fails", async () => {
    failsWith("Command failed", "fatal: not a git repository\n");
    await expect(gitRun(["status"], "/repo")).rejects.toThrow("fatal: not a git repository");
  });

  it("falls back to the error message when stderr is empty", async () => {
    failsWith("spawn ENOENT", "");
    await expect(gitRun(["status"], "/repo")).rejects.toThrow("spawn ENOENT");
  });

  it("does not leak trailing whitespace from stderr into the message", async () => {
    failsWith("Command failed", "  fatal: bad revision  \n\n");
    await expect(gitRun(["show"], "/repo")).rejects.toThrow(/^fatal: bad revision$/);
  });

  it("applies the shared max buffer", async () => {
    succeedsWith("");
    await gitRun(["log"], "/repo");
    expect(execFileMock.mock.calls[0][2].maxBuffer).toBe(GIT_MAX_BUFFER);
  });

  it("reads output as a buffer rather than a decoded stream", async () => {
    succeedsWith("");
    await gitRun(["show"], "/repo");
    expect(execFileMock.mock.calls[0][2].encoding).toBe("buffer");
  });
});

describe("gitQuery", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("resolves stdout on success", async () => {
    succeedsWith("abc123\n");
    await expect(gitQuery(["rev-parse", "HEAD"], "/repo")).resolves.toBe("abc123\n");
  });

  it("resolves empty string instead of rejecting on failure", async () => {
    failsWith("Command failed", "fatal: ambiguous argument 'HEAD'");
    await expect(gitQuery(["rev-parse", "HEAD"], "/repo")).resolves.toBe("");
  });

  it("logs the failure it is swallowing, with git's own reason", async () => {
    // "" is a legitimate answer here — an empty repo has no HEAD — so the
    // result cannot carry the failure. Without the log, a broken repository
    // renders as missing data with no sign that git refused.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    failsWith("Command failed", "fatal: ambiguous argument 'HEAD'");
    await gitQuery(["rev-parse", "HEAD"], "/repo");

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("rev-parse");
    expect(message).toContain("fatal: ambiguous argument 'HEAD'");
    warn.mockRestore();
  });

  it("stays quiet when git succeeds, including on empty output", async () => {
    // A command that legitimately returns nothing must not look like a failure.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    succeedsWith("");
    await expect(gitQuery(["for-each-ref"], "/repo")).resolves.toBe("");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("preserves interior whitespace exactly", async () => {
    succeedsWith("a\tb\nc\td\n");
    await expect(gitQuery(["for-each-ref"], "/repo")).resolves.toBe("a\tb\nc\td\n");
  });
});

describe("gitQueryTrimmed", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("strips surrounding whitespace", async () => {
    succeedsWith("  main\n\n");
    await expect(gitQueryTrimmed(["rev-parse", "--abbrev-ref", "HEAD"], "/repo")).resolves.toBe(
      "main"
    );
  });

  it("resolves empty string on failure", async () => {
    failsWith("Command failed");
    await expect(gitQueryTrimmed(["rev-parse"], "/repo")).resolves.toBe("");
  });

  it("leaves interior newlines intact", async () => {
    succeedsWith("\nrefs/heads/a\nrefs/heads/b\n");
    await expect(gitQueryTrimmed(["for-each-ref"], "/repo")).resolves.toBe(
      "refs/heads/a\nrefs/heads/b"
    );
  });
});
