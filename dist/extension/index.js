// package.json
var package_default = {
  name: "@hfrancisla/pi-session-viewer",
  version: "0.5.3",
  description: "Local, read-only Pi session and system-prompt inspector",
  type: "module",
  license: "MIT",
  keywords: [
    "pi-package",
    "pi",
    "session-viewer",
    "observability",
    "system-prompt"
  ],
  files: [
    "dist",
    "README.md",
    "README.zh-CN.md",
    "LICENSE"
  ],
  repository: {
    type: "git",
    url: "https://github.com/hfrancisla/pi-session-viewer.git"
  },
  homepage: "https://github.com/hfrancisla/pi-session-viewer",
  bugs: {
    url: "https://github.com/hfrancisla/pi-session-viewer/issues"
  },
  author: "hfrancisla",
  publishConfig: {
    access: "public"
  },
  peerDependencies: {
    "@earendil-works/pi-coding-agent": "^1.6.0"
  },
  engines: {
    node: ">=20"
  },
  pi: {
    extensions: [
      "./dist/extension/index.js"
    ],
    image: "https://raw.githubusercontent.com/hfrancisla/pi-session-viewer/main/assets/gallery-preview.webp"
  },
  scripts: {
    dev: "npm run dev:web",
    "dev:web": "tsx server/dev-server.ts",
    "dev:extension": "node scripts/build-extension.mjs --watch",
    build: "npm run clean && npm run build:web && npm run build:extension && npm run build:standalone",
    "build:web": "tsc --noEmit && vite build --outDir dist/web",
    "build:extension": "node scripts/build-extension.mjs",
    "build:standalone": "node scripts/build-server.mjs",
    start: "node dist/standalone/index.js",
    test: "vitest run --fileParallelism=false",
    "test:ui": "playwright test",
    "test:package": "node scripts/test-package.mjs",
    "check:sessions": "tsx scripts/check-real-sessions.ts",
    "fixtures:refresh": "node scripts/refresh-fixtures.mjs",
    verify: "npm run test && npm run build && npm run test:package",
    clean: "node scripts/clean.mjs",
    prepack: "npm run test && npm run build"
  },
  devDependencies: {
    "@earendil-works/pi-coding-agent": "^1.6.0",
    "@fontsource/ibm-plex-mono": "^5.3.0",
    "@fontsource/ibm-plex-sans": "^5.3.0",
    "@playwright/test": "^1.63.0",
    "@types/express": "^5.0.0",
    "@types/node": "^24.13.4",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^6.1.1",
    esbuild: "^0.28.2",
    express: "^5.2.1",
    "lucide-react": "^1.46.0",
    react: "^19.3.0",
    "react-dom": "^19.3.0",
    "react-virtuoso": "^4.18.19",
    tsx: "^4.19.2",
    typescript: "^5.7.2",
    vite: "^8.3.0",
    vitest: "^5.0.1"
  }
};

// src/extension/index.ts
import { fileURLToPath } from "node:url";

// src/extension/commands.ts
var SESSION_VIEWER_COMMAND = "session-viewer";
var SESSION_VIEWER_USAGE = "Usage: /session-viewer on | off";
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function registerSessionViewerCommand(pi, controller) {
  pi.registerCommand(SESSION_VIEWER_COMMAND, {
    description: "Start or stop the local Pi session viewer panel (defaults to on)",
    handler: async (args, ctx) => {
      const command = (args ?? "").trim().toLowerCase();
      if (command === "on" || command === "") {
        try {
          const panel = await controller.start(ctx.cwd);
          ctx.ui.notify(`Viewer started at: ${panel.url}`, "info");
        } catch (error) {
          ctx.ui.notify(`Failed to start viewer: ${errorMessage(error)}`, "error");
        }
        return;
      }
      if (command === "off") {
        try {
          await controller.stop();
          ctx.ui.notify("Viewer stopped.", "info");
        } catch (error) {
          ctx.ui.notify(`Failed to stop viewer: ${errorMessage(error)}`, "error");
        }
        return;
      }
      ctx.ui.notify(SESSION_VIEWER_USAGE, "warning");
    }
  });
}

// src/extension/prompt-capture.ts
import { createHash } from "node:crypto";

// src/core/tool-provenance.ts
function sanitizeToolForApi(tool) {
  const result = { name: tool.name };
  if (tool.description !== void 0) {
    result.description = tool.description;
  }
  if (tool.parameters !== void 0) {
    result.parameters = tool.parameters;
  }
  return result;
}

// src/server/pi-runtime.ts
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
var PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
function packageJson(packageDir) {
  const file = path.join(packageDir, "package.json");
  if (!existsSync(file)) return void 0;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return void 0;
  }
}
function isPiPackage(packageDir) {
  return packageJson(packageDir)?.name === PI_PACKAGE_NAME;
}
function resolvePiPackageDir() {
  const entry = process.argv[1];
  if (entry) {
    try {
      let realDirectory = path.dirname(realpathSync(entry));
      while (true) {
        if (isPiPackage(realDirectory)) return realDirectory;
        const parent = path.dirname(realDirectory);
        if (parent === realDirectory) break;
        realDirectory = parent;
      }
    } catch {
    }
    let directory2 = path.dirname(path.resolve(entry));
    while (true) {
      if (isPiPackage(directory2)) return directory2;
      const parent = path.dirname(directory2);
      if (parent === directory2) break;
      directory2 = parent;
    }
  }
  let directory = path.resolve(process.cwd());
  while (true) {
    const candidate = path.join(directory, "node_modules", ...PI_PACKAGE_NAME.split("/"));
    if (isPiPackage(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return void 0;
}
function resolvePiVersion() {
  const directory = resolvePiPackageDir();
  return directory ? packageJson(directory)?.version : void 0;
}
async function importFromPi(relativePath, isValid) {
  const directory = resolvePiPackageDir();
  if (!directory) return void 0;
  const target = path.join(directory, relativePath);
  if (!existsSync(target)) return void 0;
  try {
    const loaded = await import(pathToFileURL(target).href);
    return isValid(loaded) ? loaded : void 0;
  } catch {
    return void 0;
  }
}

// src/extension/prompt-capture.ts
var SYSTEM_PROMPT_ENTRY_TYPE = "pi-session-viewer.system-prompt";
function promptHash(prompt) {
  return createHash("sha256").update(prompt).digest("hex");
}
function toolDefinitionsHash(tools) {
  const apiTools = tools.map(sanitizeToolForApi).sort((a, b) => a.name.localeCompare(b.name));
  return createHash("sha256").update(JSON.stringify(apiTools)).digest("hex");
}
function compositionFingerprint(composition) {
  const { toolDefinitions: _toolDefinitions, ...metadata } = composition;
  return createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
}
function serializeOptions(options) {
  return {
    customPrompt: options.customPrompt,
    forceSystemPrompt: options.forceSystemPrompt,
    hiddenTools: [...options.hiddenTools ?? []],
    toolGuidelines: Object.fromEntries(Object.entries(options.toolGuidelines ?? {}).map(([name, rules]) => [name, [...rules]])),
    selectedTools: [...options.selectedTools ?? []],
    toolSnippets: { ...options.toolSnippets ?? {} },
    promptGuidelines: [...options.promptGuidelines ?? []],
    appendSystemPrompt: options.appendSystemPrompt,
    cwd: options.cwd,
    contextFiles: (options.contextFiles ?? []).map((file) => ({ path: file.path, content: file.content })),
    skills: (options.skills ?? []).map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
      baseDir: skill.baseDir,
      disableModelInvocation: skill.disableModelInvocation
    })),
    sections: options.sections ? { ...options.sections } : void 0
  };
}
function latestUserEntryId(entries) {
  if (!Array.isArray(entries)) return void 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && typeof entry === "object" && "type" in entry && entry.type === "message" && "message" in entry && entry.message && typeof entry.message === "object" && "role" in entry.message && entry.message.role === "user" && "id" in entry && typeof entry.id === "string") {
      return entry.id;
    }
  }
  return void 0;
}
function recordPrompt(ctx, pi, pending, captureStage, forceReference, knownPromptHashes, knownCompositions, sequence, lastRecordedHash, targetUserEntryId) {
  if (!pending) return;
  const prompt = ctx.getSystemPrompt();
  const hash = promptHash(prompt);
  const options = serializeOptions(pending.options);
  const allTools = pi.getAllTools();
  const activeToolNames = pi.getActiveTools();
  const activeToolNameSet = new Set(activeToolNames);
  const hiddenToolNameSet = new Set(options.hiddenTools);
  const toolDefinitions = allTools.filter((tool) => activeToolNameSet.has(tool.name) && !hiddenToolNameSet.has(tool.name)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    promptGuidelines: tool.promptGuidelines,
    sourceInfo: tool.sourceInfo
  }));
  const definitionsHash = toolDefinitionsHash(toolDefinitions);
  const composition = { ...options, selectedTools: activeToolNames, toolDefinitions };
  const compositionHash = compositionFingerprint(composition);
  const compositionChanged = knownCompositions.get(hash) !== compositionHash;
  if (!forceReference && hash === lastRecordedHash.value && definitionsHash === lastRecordedHash.toolDefinitionsHash && !compositionChanged) return;
  const isNewSnapshot = !knownPromptHashes.has(hash);
  sequence.value += 1;
  const capturedComposition = isNewSnapshot || compositionChanged ? composition : { toolDefinitions };
  pi.appendEntry(SYSTEM_PROMPT_ENTRY_TYPE, {
    schemaVersion: 1,
    recordType: isNewSnapshot ? "snapshot" : "reference",
    captureStage,
    promptHash: hash,
    prompt: isNewSnapshot ? prompt : void 0,
    promptLength: prompt.length,
    composition: capturedComposition,
    promptBeforeFinalExtensions: isNewSnapshot && pending.promptAtCapture !== prompt ? pending.promptAtCapture : void 0,
    targetUserEntryId,
    messageType: pending.messageType,
    sequence: sequence.value,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : void 0,
    piVersion: resolvePiVersion()
  });
  if (isNewSnapshot) knownPromptHashes.add(hash);
  knownCompositions.set(hash, compositionHash);
  lastRecordedHash.value = hash;
  lastRecordedHash.toolDefinitionsHash = definitionsHash;
}
function systemPromptCapture(pi) {
  const knownPromptHashes = /* @__PURE__ */ new Set();
  const knownCompositions = /* @__PURE__ */ new Map();
  const sequence = { value: 0 };
  const lastRecordedHash = {};
  let pending;
  pi.on("session_start", (_event, ctx) => {
    knownPromptHashes.clear();
    knownCompositions.clear();
    sequence.value = 0;
    pending = void 0;
    lastRecordedHash.value = void 0;
    lastRecordedHash.toolDefinitionsHash = void 0;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== SYSTEM_PROMPT_ENTRY_TYPE) continue;
      const data = entry.data;
      if (!data || typeof data !== "object") continue;
      if ("promptHash" in data && typeof data.promptHash === "string" && "prompt" in data && typeof data.prompt === "string") {
        knownPromptHashes.add(data.promptHash);
      }
      if ("promptHash" in data && typeof data.promptHash === "string" && "composition" in data && data.composition && typeof data.composition === "object" && "selectedTools" in data.composition) {
        knownCompositions.set(data.promptHash, compositionFingerprint(data.composition));
      }
      if ("sequence" in data && typeof data.sequence === "number") sequence.value = Math.max(sequence.value, data.sequence);
    }
  });
  pi.on("before_agent_start", (event) => {
    pending = {
      messageType: event.messageType === "custom" ? "custom" : "user",
      options: event.systemPromptOptions,
      promptAtCapture: event.systemPrompt,
      recordedInitial: false
    };
  });
  pi.on("before_provider_request", (_event, ctx) => {
    if (!pending) return;
    if (!pending.recordedInitial) {
      const userEntryId = pending.messageType === "user" ? latestUserEntryId(ctx.sessionManager.getBranch()) : void 0;
      recordPrompt(
        ctx,
        pi,
        pending,
        "agent_start",
        true,
        knownPromptHashes,
        knownCompositions,
        sequence,
        lastRecordedHash,
        userEntryId
      );
      pending.recordedInitial = true;
      return;
    }
    recordPrompt(
      ctx,
      pi,
      pending,
      "provider_request_update",
      false,
      knownPromptHashes,
      knownCompositions,
      sequence,
      lastRecordedHash,
      void 0
    );
  });
  pi.on("agent_end", () => {
    pending = void 0;
    lastRecordedHash.value = void 0;
    lastRecordedHash.toolDefinitionsHash = void 0;
  });
}

// src/extension/open-browser.ts
import { spawn } from "node:child_process";
function openDefaultBrowser(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

// src/extension/server-controller.ts
import { randomBytes } from "node:crypto";

// src/server/http-server.ts
import { createServer } from "node:http";
import { promises as fs3 } from "node:fs";

// src/server/security.ts
function hostnameFromHeader(value) {
  if (!value) return void 0;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("[")) {
    const closingBracket = normalized.indexOf("]");
    return closingBracket > 0 ? normalized.slice(1, closingBracket) : void 0;
  }
  return normalized.split(":", 1)[0];
}
function isAllowedHost(value) {
  const hostname = hostnameFromHeader(value);
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}
function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && isAllowedHost(parsed.host) && parsed.host.toLowerCase() === request.headers.host?.toLowerCase();
  } catch {
    return false;
  }
}
function hasValidBearerToken(request, expectedToken) {
  const authorization = request.headers.authorization;
  return authorization === `Bearer ${expectedToken}`;
}

// src/server/session-discovery.ts
import { promises as fs, readFileSync as readFileSync2 } from "node:fs";
import os from "node:os";
import path2 from "node:path";

// src/core/format.ts
var clockFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});
var WHITESPACE = /\s/;
function compactPrefix(value, max) {
  const length = value.length;
  let index = 0;
  while (index < length && WHITESPACE.test(value[index])) index += 1;
  let compact = "";
  while (index < length) {
    if (WHITESPACE.test(value[index])) {
      while (index < length && WHITESPACE.test(value[index])) index += 1;
      if (index < length) compact += " ";
    } else {
      compact += value[index];
      index += 1;
    }
    if (compact.length > max) return compact;
  }
  return compact;
}
function truncate(value, max = 92) {
  const compact = compactPrefix(value, max);
  if (!compact) return "No text content";
  return compact.length > max ? `${compact.slice(0, max)}\u2026` : compact;
}

// src/core/session-parser.ts
var KNOWN_ENTRY_TYPES = /* @__PURE__ */ new Set([
  "message",
  "model_change",
  "thinking_level_change",
  "compaction",
  "branch_summary",
  "context_edit",
  "usage",
  "custom",
  "custom_message",
  "label",
  "session_info"
]);
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue(value) {
  return typeof value === "string" ? value : void 0;
}
function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (!isObject(block)) return "";
    if (block.type === "text") return stringValue(block.text) ?? "";
    if (block.type === "thinking") return stringValue(block.thinking) ?? "";
    if (block.type === "image") return `[Image ${stringValue(block.mimeType) ?? "unknown format"}]`;
    return "";
  }).filter(Boolean).join("\n\n");
}
function getPath(entries, leafId, warnings) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path4 = [];
  const seen = /* @__PURE__ */ new Set();
  let cursor = byId.get(leafId);
  while (cursor) {
    if (seen.has(cursor.id)) {
      if (warnings && !warnings.some((warning) => warning.code === "cycle" && warning.line === cursor?.line)) {
        warnings.push({ code: "cycle", line: cursor.line, message: `Cycle detected at line ${cursor.line} on parentId; path stopped here.` });
      }
      break;
    }
    seen.add(cursor.id);
    path4.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : void 0;
  }
  const orderedPath = [];
  for (let index = path4.length - 1; index >= 0; index -= 1) orderedPath.push(path4[index]);
  return orderedPath;
}
function buildBranches(entries, currentLeafId) {
  if (!entries.length) return [];
  const parentIds = new Set(entries.map((entry) => entry.parentId).filter((value) => Boolean(value)));
  const leaves = entries.filter((entry) => !parentIds.has(entry.id));
  const labelByTarget = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (entry.type === "label") {
      const targetId = stringValue(entry.raw.targetId);
      const label = stringValue(entry.raw.label);
      if (targetId && label) labelByTarget.set(targetId, label);
    }
  }
  const ordered = leaves.sort((a, b) => {
    if (a.id === currentLeafId) return -1;
    if (b.id === currentLeafId) return 1;
    return (b.timestamp ?? "").localeCompare(a.timestamp ?? "");
  });
  return ordered.map((leaf, index) => {
    const path4 = getPath(entries, leaf.id);
    let named;
    for (let pathIndex = path4.length - 1; pathIndex >= 0 && !named; pathIndex -= 1) {
      named = labelByTarget.get(path4[pathIndex].id);
    }
    const isCurrent = leaf.id === currentLeafId;
    let label = named;
    if (!label) label = isCurrent ? "Current branch" : `Historical branch ${index + (currentLeafId ? 0 : 1)}`;
    return {
      leafId: leaf.id,
      label,
      timestamp: leaf.timestamp,
      isCurrent
    };
  });
}
function parseSessionJsonl(content, sourceName = "Local file") {
  const warnings = [];
  const entries = [];
  const seenIds = /* @__PURE__ */ new Set();
  let header = null;
  for (const [lineIndex, sourceLine] of content.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line) continue;
    const lineNumber = lineIndex + 1;
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      warnings.push({ code: "invalid-json", line: lineNumber, message: `Line ${lineNumber} is not valid JSON; skipped.` });
      continue;
    }
    if (!isObject(raw)) {
      warnings.push({ code: "invalid-entry", line: lineNumber, message: `Line ${lineNumber} is not a JSON object; skipped.` });
      continue;
    }
    if (!header && raw.type === "session") {
      header = raw;
      continue;
    }
    const id = stringValue(raw.id);
    const type = stringValue(raw.type);
    if (!id || !type) {
      warnings.push({ code: "invalid-entry", line: lineNumber, message: `Line ${lineNumber} is missing id or type; skipped.` });
      continue;
    }
    if (seenIds.has(id)) {
      warnings.push({ code: "duplicate-id", line: lineNumber, message: `Duplicate id "${id}" at line ${lineNumber}; skipped.` });
      continue;
    }
    seenIds.add(id);
    if (!KNOWN_ENTRY_TYPES.has(type)) {
      warnings.push({ code: "unknown-type", line: lineNumber, message: `Unknown event type "${type}" at line ${lineNumber}; preserved.` });
    }
    entries.push({
      id,
      parentId: raw.parentId === null ? null : stringValue(raw.parentId) ?? null,
      type,
      timestamp: stringValue(raw.timestamp),
      line: lineNumber,
      raw
    });
  }
  if (!header) {
    warnings.unshift({ code: "invalid-header", message: "Missing session header entry; parsed remaining entries." });
  }
  const ids = new Set(entries.map((entry) => entry.id));
  for (const entry of entries) {
    if (entry.parentId && !ids.has(entry.parentId)) {
      warnings.push({
        code: "missing-parent",
        line: entry.line,
        message: `Line ${entry.line} references non-existent parentId "${entry.parentId}".`
      });
    }
  }
  const currentLeafId = entries.at(-1)?.id ?? null;
  if (currentLeafId) getPath(entries, currentLeafId, warnings);
  const branches = buildBranches(entries, currentLeafId);
  return {
    sourceName,
    header,
    entries,
    warnings,
    branches,
    currentLeafId
  };
}
function getSessionTitle(session) {
  let name;
  for (let index = session.entries.length - 1; index >= 0 && !name; index -= 1) {
    const entry = session.entries[index];
    if (entry.type === "session_info") name = stringValue(entry.raw.name);
  }
  if (name) return name;
  if (!session.currentLeafId) return session.sourceName;
  for (const entry of getPath(session.entries, session.currentLeafId)) {
    if (entry.type !== "message") continue;
    const message = isObject(entry.raw.message) ? entry.raw.message : {};
    if (message.role !== "user") continue;
    return truncate(contentText(message.content));
  }
  return session.sourceName;
}

// src/core/session-token.ts
function encodeSessionToken(relativePath) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(relativePath, "utf8").toString("base64url");
  }
  const bytes = new TextEncoder().encode(relativePath);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeSessionToken(token) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(token, "base64url").toString("utf8");
  }
  let base64 = token.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// src/core/subagent-detector.ts
var PI_SUBAGENT_RUN_ID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
var PI_SUBAGENT_RUN_ID_REGEX = new RegExp(`^${PI_SUBAGENT_RUN_ID_PATTERN}$`, "i");
var SUBAGENT_TRANSCRIPT_REGEX = new RegExp(`^(${PI_SUBAGENT_RUN_ID_PATTERN})_(.+)_transcript\\.jsonl$`, "i");
function subagentTargetCandidates(targetFile, parentSourcePath) {
  const clean = (value) => value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  const target = clean(targetFile);
  if (!target) return [];
  const transcript = SUBAGENT_TRANSCRIPT_REGEX.exec(target.split("/").pop() ?? "");
  if (!transcript) return [target];
  const candidates = [];
  const runId = transcript[1];
  const artifactDir = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
  const projectDir = artifactDir.includes("subagent-artifacts") ? artifactDir.slice(0, artifactDir.lastIndexOf("subagent-artifacts")).replace(/\/+$/, "") : artifactDir;
  const parentStem = parentSourcePath ? clean(parentSourcePath).split("/").pop()?.replace(/\.jsonl$/, "") : void 0;
  const runSession = (base) => base ? `${base}/${runId}/run-0/session.jsonl` : `${runId}/run-0/session.jsonl`;
  if (parentStem) candidates.push(runSession(projectDir ? `${projectDir}/${parentStem}` : parentStem));
  candidates.push(runSession(projectDir));
  candidates.push(target);
  return [...new Set(candidates.filter(Boolean))];
}

// src/core/lru-cache.ts
function createLruCache(options) {
  const { maxEntries, maxWeight, weigh = () => 1 } = options;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("maxEntries must be a positive integer");
  }
  if (maxWeight !== void 0 && (!Number.isFinite(maxWeight) || maxWeight < 0)) {
    throw new RangeError("maxWeight must be a non-negative number");
  }
  const entries = /* @__PURE__ */ new Map();
  let weight = 0;
  const remove = (key) => {
    const existing = entries.get(key);
    if (!existing) return;
    entries.delete(key);
    weight -= existing.weight;
  };
  return {
    get(key) {
      const existing = entries.get(key);
      if (!existing) return void 0;
      entries.delete(key);
      entries.set(key, existing);
      return existing.value;
    },
    set(key, value) {
      remove(key);
      const entryWeight = weigh(value);
      if (maxWeight !== void 0 && entryWeight > maxWeight) return;
      entries.set(key, { value, weight: entryWeight });
      weight += entryWeight;
      while (entries.size > maxEntries || maxWeight !== void 0 && weight > maxWeight) {
        const oldest = entries.keys().next().value;
        if (oldest === void 0) break;
        remove(oldest);
      }
    },
    clear() {
      entries.clear();
      weight = 0;
    },
    get size() {
      return entries.size;
    },
    get weight() {
      return weight;
    }
  };
}

// src/core/path.ts
function normalizePath(cwd) {
  if (!cwd) return "";
  return cwd.replace(/\\/g, "/").replace(/\/+$/, "");
}

// src/server/session-discovery.ts
var SUBAGENT_DIRECTORY_NAMES = /* @__PURE__ */ new Set(["subagent-artifacts", "subagents"]);
var RUN_IDENTIFIER = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{4,}|run-\d+)$/i;
var RUN_DIRECTORY = /^run-\d+$/;
function sessionPathSegments(relativePath) {
  return relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
}
function isSubagentPathSegment(segment) {
  return SUBAGENT_DIRECTORY_NAMES.has(segment);
}
function hasSubagentPathSegment(segments) {
  return segments.some(isSubagentPathSegment);
}
function isSessionCatalogSubtreeExcluded(relativePath) {
  return hasSubagentPathSegment(sessionPathSegments(relativePath));
}
function isRunnableSubagentSession(segments) {
  const runIdentifier = segments.at(-3);
  return Boolean(runIdentifier && RUN_IDENTIFIER.test(runIdentifier)) && segments.at(-1) === "session.jsonl" && RUN_DIRECTORY.test(segments.at(-2) ?? "");
}
function isSessionCatalogPathMember(relativePath) {
  const segments = sessionPathSegments(relativePath);
  if (hasSubagentPathSegment(segments)) return false;
  if (segments.at(-1)?.endsWith("_transcript.jsonl")) return false;
  return !isRunnableSubagentSession(segments);
}
function isSessionCatalogMember(session) {
  if (session.parentSession?.trim()) return false;
  if (session.id.toLowerCase().startsWith("subagent-")) return false;
  return isSessionCatalogPathMember(session.relativePath);
}
function projectName(cwd) {
  if (!cwd || cwd === "Unknown working directory") return "Unknown Project";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? cwd;
}
function disambiguateProjectNames(cwds) {
  const result = /* @__PURE__ */ new Map();
  const parsed = cwds.map((cwd) => {
    const norm = normalizePath(cwd);
    const segments = norm.split("/").filter(Boolean);
    return { cwd, norm, segments };
  });
  for (const item of parsed) {
    if (!item.norm || item.norm === "Unknown working directory") {
      result.set(item.norm, "Unknown Project");
      continue;
    }
    let depth = 1;
    while (depth <= item.segments.length) {
      const candidate = item.segments.slice(-depth).join("/");
      const collision = parsed.some((other) => {
        if (other.norm === item.norm) return false;
        const otherCandidate = other.segments.slice(-depth).join("/");
        return otherCandidate === candidate;
      });
      if (!collision || depth === item.segments.length) {
        result.set(item.norm, candidate);
        break;
      }
      depth += 1;
    }
  }
  return result;
}
function buildProjectSummaries(sessions) {
  const map = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    const key = normalizePath(session.cwd) || "Unknown working directory";
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        cwd: session.cwd,
        count: 1,
        latestModifiedAt: session.modifiedAt
      });
    } else {
      existing.count += 1;
      if (session.modifiedAt.localeCompare(existing.latestModifiedAt) > 0) {
        existing.latestModifiedAt = session.modifiedAt;
      }
    }
  }
  const distinctCwds = Array.from(map.values()).map((item) => item.cwd);
  const disambiguatedNames = disambiguateProjectNames(distinctCwds);
  const projects = Array.from(map.values()).map((item) => ({
    ...item,
    name: disambiguatedNames.get(normalizePath(item.cwd)) ?? projectName(item.cwd)
  })).sort((a, b) => b.latestModifiedAt.localeCompare(a.latestModifiedAt));
  return { projects, projectNames: disambiguatedNames };
}
var SESSION_PREFIX_LIMIT = 256 * 1024;
var metadataCache = createLruCache({ maxEntries: 4096 });
function expandHome(value) {
  return value === "~" || value.startsWith("~/") ? path2.join(os.homedir(), value.slice(2)) : value;
}
function configuredSessionRootSync(env = process.env) {
  if (env.PI_CODING_AGENT_SESSION_DIR) {
    return path2.resolve(expandHome(env.PI_CODING_AGENT_SESSION_DIR));
  }
  try {
    const settingsPath = path2.join(os.homedir(), ".pi", "agent", "settings.json");
    const settings = JSON.parse(readFileSync2(settingsPath, "utf8"));
    if (typeof settings.sessionDir === "string" && settings.sessionDir.trim()) {
      return path2.resolve(expandHome(settings.sessionDir));
    }
  } catch {
  }
  return path2.join(os.homedir(), ".pi", "agent", "sessions");
}
function isSessionCandidate(entry, name) {
  return entry.isFile() && name.endsWith(".jsonl") && name !== "events.jsonl";
}
async function walkSessionCandidates(root) {
  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path2.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (isSessionCatalogSubtreeExcluded(path2.relative(root, absolute))) continue;
        await visit(absolute);
      } else if (isSessionCandidate(entry, entry.name) && isSessionCatalogPathMember(path2.relative(root, absolute))) {
        files.push(absolute);
      }
    }
  }
  await visit(root);
  return files;
}
async function readPrefix(filePath, limit = SESSION_PREFIX_LIMIT) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
async function sessionMetadata(root, filePath) {
  const stat = await fs.stat(filePath);
  const cacheKey = `${filePath}\0${stat.mtimeMs}\0${stat.size}`;
  const cached = metadataCache.get(cacheKey);
  if (cached !== void 0) return cached;
  const item = await readSessionMetadata(root, filePath, stat);
  metadataCache.set(cacheKey, item);
  return item;
}
async function readSessionMetadata(root, filePath, stat) {
  const prefix = await readPrefix(filePath);
  const firstLine = prefix.split(/\r?\n/, 1)[0];
  try {
    const header = JSON.parse(firstLine);
    if (!isValidPiSessionHeader(header)) return null;
    const relativePath = path2.relative(root, filePath);
    const item = {
      token: encodeSessionToken(relativePath),
      id: header.id,
      title: "",
      cwd: header.cwd,
      timestamp: header.timestamp,
      modifiedAt: stat.mtime.toISOString(),
      relativePath,
      parentSession: header.parentSession
    };
    if (!isSessionCatalogMember(item)) return null;
    const parsed = parseSessionJsonl(prefix, path2.basename(filePath));
    return { ...item, title: getSessionTitle(parsed) };
  } catch {
    return null;
  }
}
function isValidPiSessionHeader(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const header = value;
  return header.type === "session" && typeof header.id === "string" && header.id.trim().length > 0 && typeof header.timestamp === "string" && header.timestamp.trim().length > 0 && typeof header.cwd === "string" && (header.version === void 0 || typeof header.version === "number") && (header.parentSession === void 0 || typeof header.parentSession === "string");
}
async function discoverSessionCatalog(root, currentCwd) {
  const warnings = [];
  try {
    const rootRealPath = await fs.realpath(root);
    const files = await walkSessionCandidates(rootRealPath);
    const sessions = [];
    for (let index = 0; index < files.length; index += 32) {
      const batch = await Promise.all(files.slice(index, index + 32).map(async (filePath) => {
        try {
          return await sessionMetadata(rootRealPath, filePath);
        } catch {
          warnings.push(`Failed to read ${path2.relative(rootRealPath, filePath)}`);
          return null;
        }
      }));
      sessions.push(...batch.filter((item) => item !== null));
      await new Promise((resolve) => setImmediate(resolve));
    }
    sessions.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    const { projects, projectNames } = buildProjectSummaries(sessions);
    for (const session of sessions) {
      session.projectName = projectNames.get(normalizePath(session.cwd)) ?? projectName(session.cwd);
    }
    let initialSessionToken;
    if (currentCwd) {
      const normTarget = normalizePath(currentCwd);
      const matched = sessions.find((s) => normalizePath(s.cwd) === normTarget);
      initialSessionToken = matched?.token ?? sessions[0]?.token;
    } else {
      initialSessionToken = sessions[0]?.token;
    }
    return { root: rootRealPath, currentCwd, projects, sessions, initialSessionToken, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { root, currentCwd, projects: [], sessions: [], warnings: [`Failed to scan Pi session directory: ${message}`] };
  }
}
var listSessions = discoverSessionCatalog;
async function resolveAllowedSessionPath(root, relative) {
  const rootRealPath = await fs.realpath(root);
  if (!relative || !relative.endsWith(".jsonl") || path2.isAbsolute(relative)) {
    throw new Error("Invalid session file identifier.");
  }
  const candidate = path2.resolve(rootRealPath, relative);
  const absolute = await fs.realpath(candidate);
  if (absolute !== rootRealPath && !absolute.startsWith(`${rootRealPath}${path2.sep}`)) {
    throw new Error("Requested file is outside allowed directory.");
  }
  const name = path2.basename(absolute);
  if (name === "events.jsonl") {
    throw new Error("Reading this session file is not permitted.");
  }
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error("Requested session file is invalid.");
  return { absolute, relative: path2.relative(rootRealPath, absolute) };
}
async function resolveAllowedSessionFile(root, token) {
  const relative = decodeSessionToken(token);
  return resolveAllowedSessionPath(root, relative);
}
async function resolveSessionTarget(root, targetFile, parentRelative) {
  const candidates = subagentTargetCandidates(targetFile, parentRelative);
  let sawTranscriptOnly = false;
  for (const candidate of candidates) {
    let resolved;
    try {
      resolved = await resolveAllowedSessionPath(root, candidate);
    } catch {
      continue;
    }
    try {
      const prefix = await readPrefix(resolved.absolute, 4096);
      const firstLine = prefix.split(/\r?\n/, 1)[0];
      const header = JSON.parse(firstLine);
      if (isValidPiSessionHeader(header)) {
        return {
          kind: "resolved",
          absolute: resolved.absolute,
          relative: resolved.relative,
          token: encodeSessionToken(resolved.relative)
        };
      }
      sawTranscriptOnly = true;
    } catch {
      sawTranscriptOnly = true;
    }
  }
  if (sawTranscriptOnly) {
    return { kind: "transcript-only" };
  }
  return { kind: "not-found" };
}

// src/server/context-projection.ts
var CONTEXT_PRODUCING_TYPES = /* @__PURE__ */ new Set(["message", "custom_message"]);
var MAX_PROJECTED_LEAVES = 8;
var cachedApi;
var PI_CONTEXT_API_MODULE = "dist/core/session-manager.js";
function isPiContextApi(module) {
  if (!module || typeof module !== "object") return false;
  const candidate = module;
  return typeof candidate.buildSessionProjection === "function" && typeof candidate.parseSessionEntries === "function";
}
function loadPiContextApi() {
  if (!cachedApi) {
    cachedApi = importFromPi(PI_CONTEXT_API_MODULE, isPiContextApi);
  }
  return cachedApi;
}
function collectExclusions(projected, editIdByTarget) {
  const excluded = {};
  for (const entry of projected) {
    const id = entry.sourceEntry.id;
    const type = entry.sourceEntry.type;
    if (!id || !type || !CONTEXT_PRODUCING_TYPES.has(type)) continue;
    if (entry.messages.length > 0) continue;
    const editId = editIdByTarget.get(id);
    excluded[id] = editId ? { state: "omitted", editId } : { state: "not-in-context" };
  }
  return excluded;
}
function omittedTargets(content) {
  const byTarget = /* @__PURE__ */ new Map();
  for (const line of content.split("\n")) {
    if (!line.includes('"context_edit"')) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.type !== "context_edit") continue;
    if (typeof parsed.id !== "string" || typeof parsed.targetId !== "string") continue;
    if (parsed.replacement === null || parsed.replacement === void 0) {
      byTarget.set(parsed.targetId, parsed.id);
    } else {
      byTarget.delete(parsed.targetId);
    }
  }
  return byTarget;
}
async function computeContextProjections(content, sourceName = "session") {
  const api = await loadPiContextApi();
  if (!api) return void 0;
  let entries;
  try {
    entries = api.parseSessionEntries(content);
  } catch {
    return void 0;
  }
  const parsed = parseSessionJsonl(content, sourceName);
  const leafIds = parsed.branches.map((branch) => branch.leafId);
  const cappedLeaves = leafIds.slice(0, MAX_PROJECTED_LEAVES);
  if (parsed.currentLeafId && !cappedLeaves.includes(parsed.currentLeafId)) {
    cappedLeaves.unshift(parsed.currentLeafId);
  }
  const editIdByTarget = omittedTargets(content);
  const piVersion = resolvePiVersion();
  const projections = {};
  for (const leafId of cappedLeaves) {
    let projection;
    try {
      projection = api.buildSessionProjection(entries, leafId);
    } catch {
      continue;
    }
    const messageCount = projection.entries.reduce((total, entry) => total + entry.messages.length, 0);
    projections[leafId] = {
      leafId,
      messageCount,
      contextEntryCount: projection.entries.length,
      excluded: collectExclusions(projection.entries, editIdByTarget),
      piVersion
    };
  }
  return Object.keys(projections).length > 0 ? projections : void 0;
}

// src/server/static-assets.ts
import { promises as fs2 } from "node:fs";
import path3 from "node:path";
var MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};
async function containedFile(root, relativePath) {
  const candidate = path3.resolve(root, relativePath);
  try {
    const absolute = await fs2.realpath(candidate);
    if (absolute !== root && !absolute.startsWith(`${root}${path3.sep}`)) return null;
    const stat = await fs2.stat(absolute);
    if (!stat.isFile()) return null;
    return { absolute, relative: path3.relative(root, absolute) };
  } catch {
    return null;
  }
}
async function readStaticAsset(webRoot, requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (!decodedPath.startsWith("/")) return null;
  let root;
  try {
    root = await fs2.realpath(webRoot);
  } catch {
    return null;
  }
  const requestedRelative = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const requestedCandidate = path3.resolve(root, requestedRelative);
  if (requestedCandidate !== root && !requestedCandidate.startsWith(`${root}${path3.sep}`)) return null;
  const exactFile = await containedFile(root, requestedRelative);
  let selectedFile = exactFile;
  if (!selectedFile && !path3.extname(requestedRelative)) {
    try {
      await fs2.lstat(requestedCandidate);
      return null;
    } catch {
      selectedFile = await containedFile(root, "index.html");
    }
  }
  if (!selectedFile) return null;
  return {
    body: await fs2.readFile(selectedFile.absolute),
    contentType: MIME_TYPES[path3.extname(selectedFile.relative).toLowerCase()] ?? "application/octet-stream",
    cacheControl: selectedFile.relative === "index.html" ? "no-store" : "public, max-age=31536000, immutable"
  };
}

// src/server/http-server.ts
var CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
function setSecurityHeaders(response) {
  response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}
function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}
var SESSION_BODY_CACHE_WEIGHT = 64 * 1024 * 1024;
function sendCachedJson(response, body) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
}
async function sendSessionPayload(response, sessionBodies, absolute, relative, token) {
  const stat = await fs3.stat(absolute);
  const cacheKey = `${relative}\0${stat.mtimeMs}\0${stat.size}`;
  const cached = sessionBodies.get(cacheKey);
  if (cached !== void 0) {
    sendCachedJson(response, cached);
    return;
  }
  const content = await fs3.readFile(absolute, "utf8");
  const contextProjections = await computeContextProjections(content, relative);
  const payload = {
    token,
    relativePath: relative,
    modifiedAt: stat.mtime.toISOString(),
    content,
    ...contextProjections ? { contextProjections } : {}
  };
  const body = JSON.stringify(payload);
  sessionBodies.set(cacheKey, body);
  sendCachedJson(response, body);
}
async function handleRequest(request, response, options, sessionBodies) {
  setSecurityHeaders(response);
  if (!isAllowedHost(request.headers.host)) {
    sendJson(response, 403, { error: "Only local loopback access is allowed." });
    return;
  }
  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { error: "Cross-origin request rejected." });
    return;
  }
  const pathname = (request.url ?? "/").split("?", 1)[0] || "/";
  if (pathname.startsWith("/api/") && !hasValidBearerToken(request, options.token)) {
    sendJson(response, 401, { error: "Valid access token required." });
    return;
  }
  if (pathname.startsWith("/api/") && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "Only read-only GET requests are supported." });
    return;
  }
  if (pathname === "/api/health") {
    sendJson(response, 200, { status: "ok", version: options.version ?? "unknown" });
    return;
  }
  if (pathname === "/api/sessions") {
    sendJson(response, 200, await listSessions(options.sessionRoot, options.currentCwd));
    return;
  }
  if (pathname === "/api/resolve") {
    const searchParams = new URL(request.url ?? "/", "http://127.0.0.1").searchParams;
    const target = searchParams.get("target");
    const parent = searchParams.get("parent") ?? void 0;
    if (!target) {
      sendJson(response, 400, { error: "Target session identifier is required." });
      return;
    }
    try {
      const result = await resolveSessionTarget(options.sessionRoot, target, parent);
      if (result.kind === "transcript-only") {
        sendJson(response, 422, {
          error: "Subagent transcript is not a runnable session.",
          code: "subagent-transcript-only"
        });
        return;
      }
      if (result.kind === "not-found") {
        sendJson(response, 404, { error: `No session file found for ${target}` });
        return;
      }
      await sendSessionPayload(response, sessionBodies, result.absolute, result.relative, result.token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    }
    return;
  }
  const sessionPathPrefix = "/api/sessions/";
  if (pathname.startsWith(sessionPathPrefix)) {
    let token;
    try {
      token = decodeURIComponent(pathname.slice(sessionPathPrefix.length));
    } catch {
      sendJson(response, 400, { error: "Invalid session file identifier." });
      return;
    }
    try {
      const { absolute, relative } = await resolveAllowedSessionFile(options.sessionRoot, token);
      await sendSessionPayload(response, sessionBodies, absolute, relative, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 404, { error: message });
    }
    return;
  }
  if (request.method === "GET") {
    const asset = await readStaticAsset(options.webRoot, pathname);
    if (asset) {
      response.statusCode = 200;
      response.setHeader("Content-Type", asset.contentType);
      response.setHeader("Cache-Control", asset.cacheControl);
      response.end(asset.body);
      return;
    }
  }
  sendJson(response, 404, { error: "Requested resource not found." });
}
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
async function startSessionHttpServer(options) {
  const host = options.host ?? "127.0.0.1";
  const sessionBodies = createLruCache({
    maxEntries: 8,
    maxWeight: SESSION_BODY_CACHE_WEIGHT,
    weigh: (body) => body.length
  });
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, options, sessionBodies);
  });
  const port = await listen(httpServer, host, options.port ?? 0);
  return {
    host,
    port,
    token: options.token,
    url: `http://${host}:${port}`,
    close: () => close(httpServer)
  };
}

// src/extension/server-controller.ts
function defaultToken() {
  return randomBytes(32).toString("base64url");
}
function panelFromServer(server, cwd, serverCwd) {
  const hash = new URLSearchParams({ token: server.token });
  if (cwd && cwd !== serverCwd) hash.set("cwd", cwd);
  return {
    host: server.host,
    port: server.port,
    token: server.token,
    url: `${server.url}/#${hash.toString()}`
  };
}
function createServerController(options) {
  const startServer = options.startServer ?? startSessionHttpServer;
  const createToken = options.createToken ?? defaultToken;
  let state = "stopped";
  let server;
  let panel;
  let serverCwd;
  let activeCwd = options.currentCwd;
  let startPromise;
  let stopPromise;
  const stopRunningServer = async () => {
    const activeServer = server;
    server = void 0;
    panel = void 0;
    serverCwd = void 0;
    if (!activeServer) return;
    await activeServer.close();
  };
  const start = async (cwd) => {
    if (cwd) activeCwd = cwd;
    if (panel && state === "running" && server) return panelFromServer(server, activeCwd, serverCwd);
    if (startPromise) return startPromise;
    if (stopPromise) await stopPromise;
    state = "starting";
    startPromise = (async () => {
      try {
        const serverCwdAtStart = activeCwd;
        const started = await startServer({
          sessionRoot: options.sessionRoot,
          webRoot: options.webRoot,
          token: createToken(),
          host: options.host,
          port: options.port,
          version: options.version,
          currentCwd: serverCwdAtStart
        });
        server = started;
        serverCwd = serverCwdAtStart;
        panel = panelFromServer(started, activeCwd, serverCwd);
        state = "running";
        if (options.openBrowser) {
          try {
            await options.openBrowser(panel.url);
          } catch {
          }
        }
        return panel;
      } catch (error) {
        state = "stopped";
        throw error;
      } finally {
        startPromise = void 0;
      }
    })();
    return startPromise;
  };
  const stop = async () => {
    if (stopPromise) return stopPromise;
    if (startPromise) {
      try {
        await startPromise;
      } catch {
        return;
      }
    }
    if (!server) {
      state = "stopped";
      return;
    }
    state = "stopping";
    stopPromise = stopRunningServer().finally(() => {
      state = "stopped";
      stopPromise = void 0;
    });
    return stopPromise;
  };
  return {
    start,
    stop,
    getState: () => state
  };
}

// src/extension/index.ts
var packageVersion = typeof package_default.version === "string" ? package_default.version : "unknown";
function registerExtension(pi, dependencies = {}) {
  systemPromptCapture(pi);
  const controller = dependencies.controller ?? createServerController({
    sessionRoot: dependencies.sessionRoot ?? configuredSessionRootSync(),
    webRoot: dependencies.webRoot ?? fileURLToPath(new URL("../web/", import.meta.url)),
    version: packageVersion,
    openBrowser: dependencies.openBrowser ?? openDefaultBrowser
  });
  registerSessionViewerCommand(pi, controller);
  pi.on("session_shutdown", async () => {
    await controller.stop();
  });
}
function extension(pi) {
  registerExtension(pi);
}
export {
  extension as default,
  registerExtension
};
//# sourceMappingURL=index.js.map
