import process from "node:process";

import {
  assertDesktopRuntime,
  capture,
  desktopBinaryPath,
  fail,
  interfaceDir,
  repoRoot,
  run,
} from "./lib/utils.mjs";

const args = process.argv.slice(2);
const withSmoke = args.includes("--smoke");
const binaryFlagIndex = args.indexOf("--binary");
const binaryPath =
  binaryFlagIndex >= 0 && args[binaryFlagIndex + 1] ? args[binaryFlagIndex + 1] : desktopBinaryPath();

assertDesktopRuntime({ requireHarness: true });

run("node", ["--check", "infra/scripts/release/desktop-local-auto-update-smoke.mjs"], {
  cwd: repoRoot,
});
run("node", ["--test", "infra/scripts/release/desktop-frontend-assets-validate.test.mjs"], {
  cwd: repoRoot,
});
run("node", ["--test", "infra/scripts/release/prepare-desktop-sidecar.test.mjs"], {
  cwd: repoRoot,
});
run("node", ["infra/scripts/release/prepare-desktop-sidecar.mjs", "--check"], {
  cwd: repoRoot,
});
run("npm", ["ci"], { cwd: interfaceDir });
run("node", ["infra/scripts/release/prepare-desktop-sidecar.mjs"], { cwd: repoRoot });
run("npm", ["run", "build"], { cwd: interfaceDir });
run("node", ["infra/scripts/release/desktop-frontend-assets-validate.mjs", "--dist", "interface/dist"], {
  cwd: repoRoot,
});
const cargoArgs = [
  "build",
  "--release",
  "--no-default-features",
  "--features",
  "stable-channel",
  "--package",
  "aura-os-desktop",
];

if (process.env.AURA_CARGO_TIMINGS === "1") {
  cargoArgs.push("--timings");
}

run("cargo", cargoArgs, {
  cwd: repoRoot,
  env: {
    ...process.env,
    AURA_DESKTOP_USE_PREBUILT_FRONTEND: "1",
  },
});

// End-to-end guard against the Dev-in-disguise regression: invoke the
// just-built stable binary with `--print-channel` and confirm it reports
// `channel=Stable`. Cargo feature unification used to silently activate
// `aura-os-core/dev-channel` here through transitive library deps, making
// the published installer's "AURA" run with the Dev mutex / data dir /
// window title. If a future change re-introduces that path, this assertion
// will fail the release build instead of shipping another disguised Dev
// binary. We deliberately call the binary directly (not via `cargo run`)
// to test the artefact that will be packaged.
const channelReport = capture(binaryPath, ["--print-channel"]);
if (!channelReport.startsWith("channel=Stable ")) {
  fail(
    `stable-channel build produced a binary that self-identifies as ${channelReport}. ` +
      "This means Cargo feature unification re-activated `aura-os-core/dev-channel` " +
      "through a transitive dependency. Audit every `aura-os-core = { path = \"...\" }` " +
      "line and make sure each one carries `default-features = false`, then re-run.",
  );
}
console.log(`\n> ${binaryPath} --print-channel\n${channelReport}`);

if (withSmoke) {
  run("node", ["infra/scripts/release/desktop-ci-smoke.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AURA_DESKTOP_BINARY: binaryPath,
    },
  });
}
