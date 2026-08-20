import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

const uvx = process.env.UVX_PATH || join(process.env.USERPROFILE, ".local", "bin", "uvx.exe");
const child = spawn(uvx, ["--python", "3.11", "blender-mcp"], {
  env: {
    ...process.env,
    BLENDER_HOST: "127.0.0.1",
    BLENDER_PORT: "9876",
    DISABLE_TELEMETRY: "true",
    UV_PYTHON_PREFERENCE: "only-managed",
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let stdoutBuffer = "";
let stderr = "";
let finished = false;

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function finish(error, result) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  child.stdin.end();
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill();
  }

  if (error) {
    console.error(JSON.stringify({ ok: false, error, stderr: stderr.slice(-4000) }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

function handleMessage(message) {
  if (message.id === 1) {
    if (message.error) return finish(`initialize failed: ${message.error.message}`);
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    return;
  }

  if (message.id === 2) {
    if (message.error) return finish(`tools/list failed: ${message.error.message}`);
    const tools = message.result?.tools || [];
    if (!tools.some((tool) => tool.name === "get_scene_info")) {
      return finish("get_scene_info was not advertised by the MCP server");
    }
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_scene_info",
        arguments: { user_prompt: "Local connectivity check" },
      },
    });
    return;
  }

  if (message.id === 3) {
    if (message.error) return finish(`get_scene_info failed: ${message.error.message}`);
    const text = message.result?.content?.find((item) => item.type === "text")?.text || "";
    if (message.result?.isError || /Error getting scene info/i.test(text)) {
      return finish(`Blender tool call failed: ${text || "unknown error"}`);
    }
    finish(null, { tool: "get_scene_info", response: text });
  }
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  const lines = stdoutBuffer.split(/\r?\n/);
  stdoutBuffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch {
      stderr += `Non-JSON stdout: ${line}\n`;
    }
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

child.on("error", (error) => finish(`could not start uvx: ${error.message}`));
child.on("exit", (code) => {
  if (!finished) finish(`MCP server exited before verification completed (code ${code})`);
});

const timeout = setTimeout(() => finish("MCP verification timed out after 120 seconds"), 120_000);

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "gravity-chess-mcp-check", version: "1.0.0" },
  },
});
