#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const os = require("os");

const binName = os.platform() === "win32" ? "neohtop-cli.exe" : "neohtop-cli";
const binPath = path.join(__dirname, binName);

// Bun blocks postinstall scripts by default, so the binary may not have been
// downloaded at install time. Fall back to running the installer on first use.
function binaryMissing() {
  try {
    return fs.statSync(binPath).size <= 1024;
  } catch {
    return true;
  }
}

if (binaryMissing()) {
  const installer = path.join(__dirname, "..", "install.js");
  try {
    // process.execPath is node under npm and bun under bun — both run install.js
    execFileSync(process.execPath, [installer], { stdio: "inherit" });
  } catch {
    process.exit(1);
  }
}

try {
  execFileSync(binPath, process.argv.slice(2), { stdio: "inherit" });
} catch (err) {
  if (err.status !== null) {
    process.exit(err.status);
  }
  console.error(`neohtop-cli: failed to run binary at ${binPath}`);
  console.error("Run 'bun install -g neohtop-cli' (or npm) to reinstall.");
  process.exit(1);
}
