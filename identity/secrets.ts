// Secret accessor — macOS Keychain, not .env.
//
// WHY: a plaintext credential in .env is one `git add -f`, one stray `cat .env` in a shared
// terminal, or one dependency that walks the CWD away from being disclosed. The Keychain is
// already on the machine, is encrypted at rest, is unlocked by the login session, and never
// puts the value in a file inside the repo. Zero dependencies — `security` ships with macOS.
//
// ONE-TIME SETUP (run these yourself; they prompt for the value so it never hits shell history):
//   security add-generic-password -a "$USER" -s ccp_cb_username -w
//   security add-generic-password -a "$USER" -s ccp_cb_password -w
//
// Then delete CB_USERNAME / CB_PASSWORD from .env.
//
// FALLBACK: if the Keychain entry is missing we fall back to the env var and warn loudly, so an
// existing setup keeps working rather than breaking silently on a harvest run.

const isDarwin = process.platform === "darwin";

/** Read one secret from the login Keychain. Returns null if absent or not on macOS. */
export function keychainGet(service: string): string | null {
  if (!isDarwin) return null;
  try {
    const p = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-w"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode !== 0) return null;
    const v = new TextDecoder().decode(p.stdout).trim();
    return v || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a secret: Keychain first, env var second (with a warning), null if neither.
 * `envName` is kept only as a migration path — new secrets should be Keychain-only.
 */
export function getSecret(service: string, envName: string): string | null {
  const fromKeychain = keychainGet(service);
  if (fromKeychain) return fromKeychain;

  const fromEnv = process.env[envName];
  if (fromEnv) {
    console.warn(
      `⚠ ${envName} is being read from the environment. Move it into the Keychain:\n` +
        `    security add-generic-password -a "$USER" -s ${service} -w\n` +
        `  then remove ${envName} from .env.`,
    );
    return fromEnv;
  }
  return null;
}

export const CB_SERVICE_USERNAME = "ccp_cb_username";
export const CB_SERVICE_PASSWORD = "ccp_cb_password";

/** College Board BigFuture login, used only by the local browser harvester. */
export function collegeBoardCredentials(): { username: string | null; password: string | null } {
  return {
    username: getSecret(CB_SERVICE_USERNAME, "CB_USERNAME"),
    password: getSecret(CB_SERVICE_PASSWORD, "CB_PASSWORD"),
  };
}
