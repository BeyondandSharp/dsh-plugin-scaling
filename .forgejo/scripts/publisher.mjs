// publisher.mjs — which CLI performs the login and the publish, and how.
//
// npm is the default, but pnpm works too and needs no PTY either:
//   * `pnpm login` (v11+) prints the authorisation URL without a terminal since
//     v11.19.0 and then polls, exactly like npm;
//   * since pnpm 12.5.1 a write that needs a second factor reports `authUrl` and
//     `doneUrl` in its `--json` error, mirroring npm >= 11.9.0;
//   * `pnpm publish --otp <token>` accepts the token the `doneUrl` poll returns.
//
// The differences that matter are the command shape (`--no-git-checks`, because
// pnpm refuses to publish from a dirty worktree and the release rewrites
// package.json) and the minimum version that exposes the URLs.

/** Minimum version of each tool that exposes authUrl/doneUrl without a TTY. */
export const MIN_VERSION = {
  npm: [11, 9, 0],
  pnpm: [12, 5, 1],
};

export const PUBLISHERS = ['npm', 'pnpm'];

/** Parse "11.19.0" / "12.5.1" (tolerating a leading v) into numbers. */
export function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Is `version` at least `floor`? Unknown versions fail open (we try anyway). */
export function versionAtLeast(version, floor) {
  const found = Array.isArray(version) ? version : parseVersion(version);
  if (!found) return true;
  for (let index = 0; index < floor.length; index += 1) {
    const a = found[index] ?? 0;
    const b = floor[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

/**
 * Choose the CLI: `NPM_PUBLISH_BINARY` when set, otherwise npm.
 * `installed` lets a caller prefer pnpm only when it is actually present.
 */
export function choosePublisher(env = process.env, { installed = PUBLISHERS } = {}) {
  const configured = String(env.NPM_PUBLISH_BINARY || '').trim().toLowerCase();
  if (configured) {
    if (!PUBLISHERS.includes(configured)) {
      throw new Error(`NPM_PUBLISH_BINARY 只支持 ${PUBLISHERS.join(' / ')}，收到：${configured}`);
    }
    return configured;
  }
  return installed.includes('npm') ? 'npm' : installed[0];
}

/**
 * Does this tool/version expose the authorisation URLs to a non-TTY process?
 * When it does not, a PTY (script(1)) is the only remaining way to see them.
 */
export function supportsNonInteractiveAuth(binary, version) {
  const floor = MIN_VERSION[binary];
  if (!floor) return false;
  return versionAtLeast(version, floor);
}

/** Reason a tool cannot be used, or '' when it is fine. */
export function unsupportedReason(binary, version) {
  const floor = MIN_VERSION[binary];
  if (!floor) return `不支持的发版工具：${binary}`;
  if (versionAtLeast(version, floor)) return '';
  const needed = floor.join('.');
  return `${binary} ${version || '(版本未知)'} 低于 ${needed}：该版本在无终端时不会暴露授权链接。`;
}

/** The publish arguments for the chosen CLI. */
export function publishArgs(binary, { distTag = 'latest', access = 'public', dryRun = false, otp = '' } = {}) {
  const args = ['publish', '--access', access, '--tag', distTag];
  if (binary === 'pnpm') {
    // pnpm refuses to publish from a dirty worktree and the release aligns
    // package.json's version before packing.
    args.push('--no-git-checks');
  }
  args.push('--json');
  if (dryRun) args.push('--dry-run');
  if (otp) args.push('--otp', otp);
  return args;
}

/** The login arguments for the chosen CLI. */
export function loginArgs(binary, { registry = '' } = {}) {
  if (binary === 'pnpm') {
    // pnpm's web login is the default; --registry pins a self-hosted registry.
    const args = ['login'];
    if (registry) args.push('--registry', registry);
    return args;
  }
  const args = ['login', '--auth-type=web'];
  if (registry) args.push('--registry', registry);
  return args;
}

/** Arguments that report the authenticated identity. */
export function whoamiArgs() {
  return ['whoami'];
}

/** Where pnpm keeps the token it writes on login (v12.1+ uses config.yaml). */
export const PNPM_AUTH_NOTE =
  'pnpm 12.1+ 把凭据写入全局 config.yaml（11.25 写入 auth.ini），npm 写入 ~/.npmrc；两者互不读取，' +
  '因此该 job 内的 login 与 publish 必须用同一个工具。';
