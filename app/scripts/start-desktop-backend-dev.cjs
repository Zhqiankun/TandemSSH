// Keep Electron development on the same runtime path as the packaged desktop.
// Server development uses `dev:backend` and retains server-mode defaults.
process.env.ELECTRON_EMBEDDED = "true";

import("../dist/backend/backend/starter.js").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
