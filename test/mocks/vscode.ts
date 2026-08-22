/**
 * Test double for the `vscode` module.
 *
 * The real module only exists inside the extension host, so anything that
 * `import * as vscode from "vscode"` is unreachable from Vitest without this.
 * vitest.config.ts aliases "vscode" here.
 *
 * Value types (Position, Range, Uri, EventEmitter, …) are implemented for real
 * — code under test relies on their semantics (`range.contains()` decides which
 * ref badge a click landed on). The host API surface (window, commands, …) is
 * vi.fn() spies plus recorded state, so tests can assert what the extension
 * asked VS Code to do.
 */
import { vi } from "vitest";

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
  isBefore(other: Position): boolean {
    if (this.line < other.line) return true;
    if (this.line > other.line) return false;
    return this.character < other.character;
  }
  isBeforeOrEqual(other: Position): boolean {
    return this.isBefore(other) || this.isEqual(other);
  }
  isAfter(other: Position): boolean {
    return !this.isBeforeOrEqual(other);
  }
  isAfterOrEqual(other: Position): boolean {
    return !this.isBefore(other);
  }
  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }
  translate(lineDelta = 0, characterDelta = 0): Position {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }
  with(line = this.line, character = this.character): Position {
    return new Position(line, character);
  }
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(startLine: number, startChar: number, endLine: number, endChar: number);
  constructor(start: Position, end: Position);
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    if (typeof a === "number") {
      this.start = new Position(a, b as number);
      this.end = new Position(c as number, d as number);
    } else {
      this.start = a;
      this.end = b as Position;
    }
  }
  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }
  get isSingleLine(): boolean {
    return this.start.line === this.end.line;
  }
  contains(positionOrRange: Position | Range): boolean {
    if (positionOrRange instanceof Range) {
      return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
    }
    return (
      positionOrRange.isAfterOrEqual(this.start) && positionOrRange.isBeforeOrEqual(this.end)
    );
  }
  isEqual(other: Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }
}

export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;
  constructor(anchorLine: number, anchorChar: number, activeLine: number, activeChar: number);
  constructor(anchor: Position, active: Position);
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    if (typeof a === "number") {
      super(a, b as number, c as number, d as number);
      this.anchor = new Position(a, b as number);
      this.active = new Position(c as number, d as number);
    } else {
      super(a, b as Position);
      this.anchor = a;
      this.active = b as Position;
    }
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query: string,
    readonly fragment: string
  ) {}

  static parse(value: string): Uri {
    const schemeEnd = value.indexOf(":");
    const scheme = schemeEnd >= 0 ? value.slice(0, schemeEnd) : "";
    let rest = schemeEnd >= 0 ? value.slice(schemeEnd + 1) : value;
    let fragment = "";
    const hashIdx = rest.indexOf("#");
    if (hashIdx >= 0) {
      fragment = rest.slice(hashIdx + 1);
      rest = rest.slice(0, hashIdx);
    }
    let query = "";
    const qIdx = rest.indexOf("?");
    if (qIdx >= 0) {
      query = rest.slice(qIdx + 1);
      rest = rest.slice(0, qIdx);
    }
    return new Uri(scheme, "", rest, query, fragment);
  }

  static file(fsPath: string): Uri {
    return new Uri("file", "", fsPath, "", "");
  }

  get fsPath(): string {
    return this.path;
  }

  with(change: { scheme?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }

  toString(): string {
    let out = `${this.scheme}:${this.path}`;
    if (this.query) out += `?${this.query}`;
    if (this.fragment) out += `#${this.fragment}`;
    return out;
  }
}

export class EventEmitter<T> {
  private listeners: ((e: T) => unknown)[] = [];
  readonly event = (listener: (e: T) => unknown): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    });
  };
  fire(data?: T): void {
    for (const listener of [...this.listeners]) listener(data as T);
  }
  dispose(): void {
    this.listeners = [];
  }
  get listenerCount(): number {
    return this.listeners.length;
  }
}

export class Disposable {
  disposed = false;
  constructor(private onDispose?: () => void) {}
  dispose(): void {
    this.disposed = true;
    this.onDispose?.();
  }
}

export class MarkdownString {
  value = "";
  isTrusted = false;
  supportHtml = false;
  supportThemeIcons = false;
  appendMarkdown(text: string): MarkdownString {
    this.value += text;
    return this;
  }
  appendText(text: string): MarkdownString {
    this.value += text;
    return this;
  }
}

export class Hover {
  constructor(public contents: MarkdownString | MarkdownString[], public range?: Range) {}
}

export class ThemeIcon {
  constructor(public id: string, public color?: ThemeColor) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label?: string;
  collapsibleState?: TreeItemCollapsibleState;
  iconPath?: ThemeIcon;
  contextValue?: string;
  tooltip?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
}

export enum OverviewRulerLane {
  Left = 1,
  Center = 2,
  Right = 4,
  Full = 7,
}

export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}

export enum TextEditorSelectionChangeKind {
  Keyboard = 1,
  Mouse = 2,
  Command = 3,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export class TabInputText {
  constructor(public uri: Uri) {}
}

/** A decoration type, recording the options it was created with. */
export interface FakeDecorationType {
  id: number;
  options: Record<string, unknown>;
  disposed: boolean;
  dispose(): void;
}

/** Mutable state the tests assert against. Reset with `__reset()`. */
export const __state = {
  decorationTypes: [] as FakeDecorationType[],
  configValues: new Map<string, unknown>(),
  configUpdates: [] as { section: string; key: string; value: unknown }[],
  infoMessages: [] as string[],
  errorMessages: [] as string[],
  warningMessages: [] as string[],
  statusBarMessages: [] as string[],
  clipboard: "",
  commands: new Map<string, (...args: any[]) => unknown>(),
  executedCommands: [] as { command: string; args: unknown[] }[],
  registeredContentProviders: new Map<string, unknown>(),
  documentLanguages: [] as { uri: string; language: string }[],
  /** Queued answers for showWarningMessage / showInputBox */
  nextWarningChoice: undefined as string | undefined,
  nextInputBoxValue: undefined as string | undefined,
  /** The hover provider the extension registered, so tests can invoke it. */
  hoverProvider: undefined as any,
  /** Webview view providers, in registration order. */
  webviewProviders: [] as unknown[],
  /** Tree views created, so tests can drive their visibility events. */
  treeViews: [] as any[],
};

let decorationSeq = 0;

export function __reset(): void {
  __state.decorationTypes = [];
  __state.configValues = new Map();
  __state.configUpdates = [];
  __state.infoMessages = [];
  __state.errorMessages = [];
  __state.warningMessages = [];
  __state.statusBarMessages = [];
  __state.clipboard = "";
  __state.commands = new Map();
  __state.executedCommands = [];
  __state.registeredContentProviders = new Map();
  __state.documentLanguages = [];
  __state.nextWarningChoice = undefined;
  __state.nextInputBoxValue = undefined;
  __state.hoverProvider = undefined;
  __state.webviewProviders = [];
  __state.treeViews = [];
  decorationSeq = 0;
  window.activeTextEditor = undefined;
  window.visibleTextEditors = [];
  window.tabGroups.all = [];
  workspace.workspaceFolders = undefined;
  for (const emitter of allEmitters) emitter.dispose();
  // Clear spy call history too, so `mock.results[0]` in one test can't be a
  // leftover from the previous one.
  for (const namespace of [window, workspace, commands, languages, extensions, env.clipboard]) {
    for (const value of Object.values(namespace)) {
      if (typeof value === "function" && "mockClear" in value) {
        (value as { mockClear(): void }).mockClear();
      }
    }
  }
  // mockClear keeps implementations, so anything a test stubbed out has to be
  // put back explicitly.
  extensions.getExtension.mockReset();
  extensions.getExtension.mockReturnValue(undefined);
}

/** Every emitter the fake host owns, so __reset() can clear listeners. */
const allEmitters: EventEmitter<any>[] = [];
function hostEmitter<T>(): EventEmitter<T> {
  const emitter = new EventEmitter<T>();
  allEmitters.push(emitter);
  return emitter;
}

export const __emitters = {
  onDidChangeTextEditorSelection: hostEmitter<any>(),
  onDidChangeVisibleTextEditors: hostEmitter<any>(),
  onDidChangeTabs: hostEmitter<any>(),
  onDidChangeTextDocument: hostEmitter<any>(),
  onDidChangeConfiguration: hostEmitter<any>(),
};

export const window = {
  activeTextEditor: undefined as any,
  visibleTextEditors: [] as any[],

  tabGroups: {
    all: [] as any[],
    onDidChangeTabs: __emitters.onDidChangeTabs.event,
  },

  createTextEditorDecorationType: vi.fn((options: Record<string, unknown>) => {
    const type: FakeDecorationType = {
      id: ++decorationSeq,
      options,
      disposed: false,
      dispose() {
        this.disposed = true;
      },
    };
    __state.decorationTypes.push(type);
    return type;
  }),

  showInformationMessage: vi.fn((message: string) => {
    __state.infoMessages.push(message);
    return Promise.resolve(undefined);
  }),
  showErrorMessage: vi.fn((message: string) => {
    __state.errorMessages.push(message);
    return Promise.resolve(undefined);
  }),
  showWarningMessage: vi.fn((message: string) => {
    __state.warningMessages.push(message);
    return Promise.resolve(__state.nextWarningChoice);
  }),
  showInputBox: vi.fn(() => Promise.resolve(__state.nextInputBoxValue)),
  setStatusBarMessage: vi.fn((message: string) => {
    __state.statusBarMessages.push(message);
    return new Disposable();
  }),

  createStatusBarItem: vi.fn(() => ({
    text: "",
    tooltip: "",
    command: "",
    shown: false,
    show: vi.fn(function (this: any) {
      this.shown = true;
    }),
    hide: vi.fn(function (this: any) {
      this.shown = false;
    }),
    dispose: vi.fn(),
  })),

  createTreeView: vi.fn(() => {
    const visibility = hostEmitter<any>();
    const view = {
      onDidChangeVisibility: visibility.event,
      visible: false,
      dispose: vi.fn(),
      /** Test-only: pretend the user revealed or hid this view. */
      __setVisible(visible: boolean) {
        this.visible = visible;
        visibility.fire({ visible });
      },
    };
    __state.treeViews.push(view);
    return view;
  }),

  registerWebviewViewProvider: vi.fn((_id: string, provider: unknown) => {
    __state.webviewProviders.push(provider);
    return new Disposable();
  }),

  /** Opening a document makes it the active, visible editor, as the host does. */
  showTextDocument: vi.fn((doc: any) => {
    const editor = makeFakeEditor(doc);
    window.activeTextEditor = editor;
    window.visibleTextEditors = [editor];
    return Promise.resolve(editor);
  }),
  onDidChangeTextEditorSelection: __emitters.onDidChangeTextEditorSelection.event,
  onDidChangeVisibleTextEditors: __emitters.onDidChangeVisibleTextEditors.event,
};

export const workspace = {
  workspaceFolders: undefined as any,

  getConfiguration: vi.fn((section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      const full = section ? `${section}.${key}` : key;
      return (__state.configValues.has(full) ? __state.configValues.get(full) : defaultValue) as T;
    },
    update: vi.fn((key: string, value: unknown) => {
      const full = section ? `${section}.${key}` : key;
      __state.configValues.set(full, value);
      __state.configUpdates.push({ section: section ?? "", key, value });
      return Promise.resolve();
    }),
  })),

  /**
   * Registering a provider also wires up the host's side of the contract: when
   * the provider fires onDidChange, VS Code re-reads the content and fires
   * onDidChangeTextDocument. Code under test waits on that second event.
   */
  registerTextDocumentContentProvider: vi.fn((scheme: string, provider: any) => {
    __state.registeredContentProviders.set(scheme, provider);
    const sub = provider?.onDidChange?.((uri: Uri) => {
      // Asynchronous, like the host: VS Code re-reads the content after the
      // provider signals a change, so a listener attached right after the
      // refresh call still sees the event.
      queueMicrotask(() => {
        __emitters.onDidChangeTextDocument.fire({ document: { uri } });
      });
    });
    return new Disposable(() => sub?.dispose?.());
  }),

  openTextDocument: vi.fn((uri: Uri) => {
    const provider = __state.registeredContentProviders.get(uri.scheme) as any;
    const text = provider?.provideTextDocumentContent?.(uri) ?? "";
    return Promise.resolve(makeFakeDocument(typeof text === "string" ? text : "", uri));
  }),
  onDidChangeTextDocument: __emitters.onDidChangeTextDocument.event,
  onDidChangeConfiguration: __emitters.onDidChangeConfiguration.event,
};

export const commands = {
  registerCommand: vi.fn((command: string, handler: (...args: any[]) => unknown) => {
    __state.commands.set(command, handler);
    return new Disposable();
  }),
  executeCommand: vi.fn((command: string, ...args: unknown[]) => {
    __state.executedCommands.push({ command, args });
    const handler = __state.commands.get(command);
    return Promise.resolve(handler ? handler(...args) : undefined);
  }),
};

export const languages = {
  registerHoverProvider: vi.fn((_selector: unknown, provider: unknown) => {
    __state.hoverProvider = provider;
    return new Disposable();
  }),
  setTextDocumentLanguage: vi.fn((doc: any, language: string) => {
    __state.documentLanguages.push({ uri: String(doc?.uri ?? ""), language });
    return Promise.resolve(doc);
  }),
};

export const env = {
  clipboard: {
    writeText: vi.fn((text: string) => {
      __state.clipboard = text;
      return Promise.resolve();
    }),
    readText: vi.fn(() => Promise.resolve(__state.clipboard)),
  },
};

export const extensions = {
  getExtension: vi.fn(() => undefined as any),
};

// --- fakes tests build on ---

/** A minimal TextDocument over fixed text. */
export function makeFakeDocument(text: string, uri: Uri = Uri.parse("boomergit:test")) {
  const lines = text.split("\n");
  return {
    uri,
    lineCount: lines.length,
    getText: () => text,
    lineAt: (line: number) => ({
      text: lines[line] ?? "",
      lineNumber: line,
      range: new Range(line, 0, line, (lines[line] ?? "").length),
    }),
  };
}

/**
 * A minimal TextEditor that records every setDecorations() call, so a test can
 * assert which ranges got which decoration type.
 */
export function makeFakeEditor(doc: ReturnType<typeof makeFakeDocument>) {
  const decorations = new Map<FakeDecorationType, any[]>();
  return {
    document: doc,
    selection: new Selection(0, 0, 0, 0),
    selections: [new Selection(0, 0, 0, 0)],
    visibleRanges: [new Range(0, 0, 0, 0)],
    options: {} as Record<string, unknown>,
    setDecorations: vi.fn((type: FakeDecorationType, ranges: any[]) => {
      decorations.set(type, ranges);
    }),
    revealRange: vi.fn(),
    /** Test-only accessor: every decoration currently applied. */
    __decorations: decorations,
  };
}

export type FakeEditor = ReturnType<typeof makeFakeEditor>;
export type FakeDocument = ReturnType<typeof makeFakeDocument>;
