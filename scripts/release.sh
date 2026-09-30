#!/usr/bin/env bash
#
# npm release for @beyondandsharp/dsh-plugin-scaling.
#
#   version check -> tests + build -> commit + tag -> push upstream
#     -> npm publish --dry-run -> your confirmation -> npm publish (2FA link)
#     -> verify the version is live
#
# The tag and the upstream push happen before the publish, as requested: if the
# registry then refuses the version, the script prints the exact rollback.
# Nothing is written before the version is validated as strictly newer, and the
# real publish only runs after an explicit confirmation at the prompt.

set -euo pipefail

readonly SCRIPT_NAME=${0##*/}

BUMP=''
DRY_RUN=0
DO_PUBLISH=1
DO_PUSH=1
ASSUME_YES=0
ALLOW_DIRTY=0
DIST_TAG=''
PREID='rc'
OTP=''

usage() {
  cat <<'EOF'
用法: scripts/release.sh <版本号|patch|minor|major|prerelease> [选项]

版本号:
  <x.y.z>                直接指定，例如 0.2.0（必须**大于**当前版本，也会和 npm 上已发布的最新版比对）
  patch | minor | major  按语义化版本自增
  prerelease             预发布自增，预发布标识用 --preid（默认 rc）

选项:
  --otp <code>    一次性验证码（没有网页二次验证时用）
  --tag <name>    npm dist-tag（默认：正式版 latest，预发布版 next）
  --preid <id>    prerelease 的预发布标识（默认 rc）
  --dry-run       全流程演练：校验、测试、构建、打包预览、`npm publish --dry-run`，不提交/打标签/推送/发布
  --no-push       跳过同步上游（本地提交与标签仍会创建）
  --no-publish    跳过 npm 发布（到此为止）
  --allow-dirty   允许工作区有未提交的已跟踪改动（默认拒绝）
  --yes, -y       跳过二次确认（自动化用；正常发版请留空以便人工确认）
  -h, --help      显示本帮助

示例:
  scripts/release.sh 0.2.0            # 推荐：显式版本号
  scripts/release.sh patch            # 0.1.1 -> 0.1.2
  scripts/release.sh 0.2.0-rc.1 --tag next
  scripts/release.sh 0.2.0 --dry-run  # 只看会发布什么
EOF
}

log() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# Strict semver precedence, enough for release ordering (major.minor.patch plus
# dot-separated prerelease identifiers). Exits 0 when $1 > $2.
SEMVER_GT='
function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  return m === null ? null : { M: +m[1], m: +m[2], p: +m[3], pre: m[4] };
}
function cmp(a, b) {
  if (a.M !== b.M) return a.M - b.M;
  if (a.m !== b.m) return a.m - b.m;
  if (a.p !== b.p) return a.p - b.p;
  if (a.pre === undefined && b.pre === undefined) return 0;
  if (a.pre === undefined) return 1;
  if (b.pre === undefined) return -1;
  const as = a.pre.split("."), bs = b.pre.split(".");
  for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
    const x = as[i], y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) { const d = +x - +y; if (d !== 0) return d; }
    else if (xn) return -1;
    else if (yn) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
const a = parse(process.argv[1]), b = parse(process.argv[2]);
if (a === null || b === null) process.exit(3);
process.exit(cmp(a, b) > 0 ? 0 : 1);
'

semver_gt() { node -e "$SEMVER_GT" "$1" "$2"; }

# --- arguments ---------------------------------------------------------------

while (($# > 0)); do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    --no-publish) DO_PUBLISH=0 ;;
    --no-push) DO_PUSH=0 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    --tag)
      shift
      (($# > 0)) || die '--tag 需要一个值'
      DIST_TAG=$1
      ;;
    --preid)
      shift
      (($# > 0)) || die '--preid 需要一个值'
      PREID=$1
      ;;
    --otp)
      shift
      (($# > 0)) || die '--otp 需要一个值'
      OTP=$1
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die "未知选项: $1（--help 查看用法）" ;;
    *)
      [[ -z $BUMP ]] || die "只能给一个版本参数（已有：$BUMP）"
      BUMP=$1
      ;;
  esac
  shift
done

if [[ -z $BUMP ]]; then
  if [[ -t 0 && $ASSUME_YES -eq 0 ]]; then
    read -r -p "版本号或自增方式（patch/minor/major/prerelease/<x.y.z>）: " BUMP
  fi
  [[ -n $BUMP ]] || die "缺少版本参数（--help 查看用法）"
fi

# --- repository preflight ----------------------------------------------------

command -v git >/dev/null || die '找不到 git'
ROOT=$(git rev-parse --show-toplevel) || die '当前目录不在 git 仓库里'
cd "$ROOT"
[[ -f package.json ]] || die "仓库根目录没有 package.json：$ROOT"
command -v node >/dev/null || die '找不到 node'

if command -v pnpm >/dev/null; then PM=pnpm; elif command -v npm >/dev/null; then PM=npm; else die '找不到 pnpm 或 npm'; fi
if command -v npm >/dev/null; then NPM=npm; elif command -v pnpm >/dev/null; then NPM=pnpm; else die '找不到 npm 或 pnpm'; fi

read_field() {
  node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));process.stdout.write(String(p$1))"
}

NAME=$(read_field '.name')
CURRENT=$(read_field '.version')
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ $BRANCH != HEAD ]] || die '处于 detached HEAD 状态，先切回分支'

step "预检"
log "包名      $NAME"
log "当前版本  $CURRENT"
log "分支      $BRANCH（$PM / $NPM）"
[[ $BRANCH == main || $BRANCH == master ]] || warn "当前分支不是 main/master：$BRANCH"

if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  git status --short --untracked-files=no >&2
  ((ALLOW_DIRTY == 1)) || die '工作区有未提交的已跟踪改动：先提交它们（发版提交只应包含版本号），或用 --allow-dirty 跳过此检查'
  warn '工作区有未提交改动（--allow-dirty）'
fi

untracked=$(git ls-files --others --exclude-standard || true)
[[ -z $untracked ]] || warn "有未跟踪文件（不会被打包/提交）：$(echo "$untracked" | paste -sd' ' -)"

if ((DO_PUSH == 1)); then
  git remote get-url origin >/dev/null 2>&1 || die '没有名为 origin 的远端；用 --no-push 或先配置远端'
  if [[ -z $(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null) ]]; then
    warn "分支 $BRANCH 还没有上游，推送时会新建远端分支"
  fi
fi

# --- version check -----------------------------------------------------------

step "版本校验"

# pnpm's `version` refuses a dirty tree unless asked not to; npm has no such check.
bump_version() {
  local args=(version)
  if [[ $1 == prerelease ]]; then args+=(prerelease --preid="$PREID"); else args+=("$1"); fi
  args+=(--no-git-tag-version --silent)
  [[ $NPM == pnpm ]] && args+=(--no-git-checks)
  "$NPM" "${args[@]}"
}

if [[ $BUMP != patch && $BUMP != minor && $BUMP != major && $BUMP != prerelease ]]; then
  [[ $BUMP =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "无效版本号: $BUMP（需要 x.y.z 或 x.y.z-pre）"
fi
if ! bump_output=$(bump_version "$BUMP" 2>&1); then
  echo "$bump_output" >&2
  die '版本自增失败'
fi
# Read the result back from package.json: npm prints the bare version, pnpm
# prints a human sentence, and only the file is authoritative for both.
VERSION=$(read_field '.version')
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "版本号解析异常: $VERSION（自增输出：$bump_output）"

committed=0
rollback() {
  local code=$?
  if ((code != 0)) && ((committed == 0)); then
    git checkout -- package.json 2>/dev/null && warn "已把 package.json 回滚回 $CURRENT"
  fi
}
trap rollback EXIT

semver_gt "$VERSION" "$CURRENT" || die "版本号必须大于当前版本：$VERSION 不大于 $CURRENT"
ok "$CURRENT → $VERSION（严格大于当前版本）"

if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
  die "本地已存在标签 $VERSION（先 git tag -d $VERSION，或换一个版本号）"
fi

if PUBLISHED_LATEST=$("$NPM" view "$NAME" version 2>/dev/null); then
  PUBLISHED_LATEST=${PUBLISHED_LATEST//[[:space:]]/}
  if [[ -n $PUBLISHED_LATEST ]]; then
    semver_gt "$VERSION" "$PUBLISHED_LATEST" || die "版本号必须大于 npm 上已发布的最新版：$VERSION 不大于 $PUBLISHED_LATEST"
    log "npm 最新版 $PUBLISHED_LATEST → 本次 $VERSION"
    if semver_gt "$PUBLISHED_LATEST" "$CURRENT"; then
      warn "本地 package.json（$CURRENT）落后于 npm（$PUBLISHED_LATEST）"
    fi
  fi
  if "$NPM" view "$NAME@$VERSION" version >/dev/null 2>&1; then
    die "npm 上已存在 $NAME@$VERSION"
  fi
else
  warn '查询 npm 失败（未登录或离线），只做了本地版本比对'
fi

if [[ -z $DIST_TAG ]]; then
  case $VERSION in
    *-*) DIST_TAG=next ;;
    *) DIST_TAG=latest ;;
  esac
fi
log "dist-tag  $DIST_TAG"

# --- tests and build ---------------------------------------------------------

step "测试与构建"
if [[ $PM == pnpm ]]; then pnpm test && pnpm run build; else npm test && npm run build; fi
ok '测试与构建通过'

for artifact in lib/index.js lib/client.js cordis.patch.yml; do
  [[ -f $artifact ]] || die "缺少构建产物：$artifact"
done

step "打包内容预览"
packed=$("$NPM" pack --dry-run 2>&1)
echo "$packed" | sed 's/^/  /'
for required in 'lib/index.js' 'lib/client.js' 'package.json' 'README.md' 'LICENSE'; do
  echo "$packed" | grep -q "$required" || die "打包内容缺少 $required（检查 package.json 的 files）"
done
# npm prefixes its notices and prints sizes; pnpm prints bare relative paths.
entry_count=$(echo "$packed" | awk '/Tarball Contents/{f=1;next} /Tarball Details/{f=0} f && NF' | wc -l | tr -d ' ')
ok "打包内容完整（$entry_count 个文件）"

# --- rehearsal ---------------------------------------------------------------

# Flags shared by the rehearsal and the real publish. pnpm refuses to publish
# from an unclean tree, and the rehearsal itself leaves package.json bumped.
publish_base=(publish --access public --tag "$DIST_TAG")
[[ $NPM == pnpm ]] && publish_base+=(--no-git-checks)

if ((DRY_RUN == 1)); then
  step "演练：git 与 npm publish --dry-run"
  log "将要提交：chore(pkg): bump version to $VERSION"
  log "将要打标签：$VERSION"
  ((DO_PUSH == 1)) && log "将要推送：origin $BRANCH + 标签 $VERSION"
  "$NPM" "${publish_base[@]}" --dry-run
  git checkout -- package.json
  ok "演练完成：未提交、未打标签、未推送、未发布（package.json 回到 $CURRENT）"
  exit 0
fi

# --- commit, tag, push -------------------------------------------------------

last_tag=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [[ -n $last_tag ]]; then
  step "自 $last_tag 以来的提交"
  git log --oneline "$last_tag..HEAD" | sed 's/^/  /'
fi

step "提交与打标签"
git add package.json
[[ -z $(git diff --cached --name-only | grep -v '^package.json$' || true) ]] || die '暂存区出现了 package.json 之外的文件，已中止'
git commit -m "chore(pkg): bump version to $VERSION"
committed=1
git tag -a "$VERSION" -m "$NAME@$VERSION"
ok "已提交并打标签 $VERSION"

if ((DO_PUSH == 1)); then
  step "同步上游"
  git push origin "HEAD:refs/heads/$BRANCH"
  git push origin "refs/tags/$VERSION"
  ok "已推送分支 $BRANCH 与标签 $VERSION"
else
  warn '按 --no-push 跳过同步上游'
fi

if ((DO_PUBLISH == 0)); then
  step "完成"
  warn '按 --no-publish 跳过 npm 发布'
  exit 0
fi

# --- publish -----------------------------------------------------------------

step "npm publish --dry-run（不写 registry）"
"$NPM" "${publish_base[@]}" --dry-run
ok 'dry-run 通过，registry 上没有写入任何东西'

step "二次确认"
log "即将正式发布 $NAME@$VERSION（dist-tag=$DIST_TAG）"
if [[ -n $OTP ]]; then
  log '使用 --otp 提供的验证码'
else
  log 'npm 会给出二次验证链接：在浏览器完成授权后脚本会自动继续'
fi
if ((ASSUME_YES == 0)); then
  [[ -t 0 ]] || die '需要交互终端做二次确认（自动化请加 --yes）'
  read -r -p "确认发布？[y/N] " answer
  [[ $answer == y || $answer == Y ]] || die '已取消（提交/标签/推送已保留）'
fi

step "发布到 npm"
"$NPM" whoami >/dev/null 2>&1 || die 'npm 未登录：先 npm login（提交、标签、推送已保留）'
if [[ -z $OTP && ! -t 0 ]]; then
  warn '当前不是交互终端，npm 的网页二次验证可能无法完成'
fi

publish_args=("${publish_base[@]}")
[[ -n $OTP ]] && publish_args+=(--otp "$OTP")
# Output is not captured: npm prints the 2FA verification link and keeps polling
# while the maintainer approves it in the browser.
if ! "$NPM" "${publish_args[@]}"; then
  warn 'npm publish 失败。提交、标签、推送都已存在，处理完后单条重试：'
  warn "  $NPM publish --access public --tag $DIST_TAG"
  warn "  （整条回滚：git tag -d $VERSION && git push origin :refs/tags/$VERSION && git reset --hard HEAD~1 && git push origin HEAD --force-with-lease）"
  exit 1
fi
ok 'npm publish 命令没有报错'

step "校验 registry"
verified=''
for attempt in 1 2 3 4 5 6; do
  verified=$("$NPM" view "$NAME@$VERSION" version 2>/dev/null | tr -d '[:space:]' || true)
  [[ $verified == "$VERSION" ]] && break
  if ((attempt < 6)); then
    log "第 $attempt 次查询还没同步（registry 有延迟），2s 后重试"
    sleep 2
  fi
done
if [[ $verified != "$VERSION" ]]; then
  die "发布命令没有报错，但 registry 上还查不到 $NAME@$VERSION：到 https://www.npmjs.com/package/$NAME 确认（可能仍在同步，或二次验证链接未完成）"
fi
ok "registry 已确认 $NAME@$VERSION"

tag_points=$("$NPM" view "$NAME" dist-tags --json 2>/dev/null | tr -d '[:space:]' || true)
case $tag_points in
  *"\"$DIST_TAG\":\"$VERSION\""*) ok "dist-tag $DIST_TAG → $VERSION" ;;
  *) warn "dist-tag 还没指向 $VERSION（当前：${tag_points:-查询失败}）" ;;
esac

step "完成"
log "$NAME@$VERSION · dist-tag=$DIST_TAG"
log "https://www.npmjs.com/package/$NAME/v/$VERSION"
log "提交 chore(pkg): bump version to $VERSION · 标签 $VERSION"
ok '发布流程结束'
