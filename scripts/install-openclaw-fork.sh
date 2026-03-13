#!/bin/bash
#
# OpenClaw Tianjun Fork 安装脚本
# 适用于 Deepin/Debian 系 Linux，自动检测网络环境选择最快源
#
set -euo pipefail

RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; CYAN='\033[36m'; BOLD='\033[1m'; RESET='\033[0m'
info()  { echo -e "${GREEN}[INFO]${RESET} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET} $1"; }
error() { echo -e "${RED}[ERROR]${RESET} $1" >&2; }
title() { echo -e "\n${BOLD}${CYAN}=== $1 ===${RESET}\n"; }

trap 'error "第 $LINENO 行执行失败"' ERR

FORK_REPO="https://github.com/DexterSLamb/openclaw-tianjun.git"
SOURCE_DIR="$HOME/Downloads/openclaw-source"
NODE_VERSION="22"
# Release 下载路径（精简包，32MB，比 archive zip 80MB 小很多）
RELEASE_PATH="/DexterSLamb/openclaw-tianjun/releases/download/tianjun-v1.0.0/openclaw-tianjun-main.tar.gz"

# GitHub 镜像列表（按优先级，测速自动选最快）
GH_MIRRORS=(
    "https://gh-proxy.com/https://github.com"
    "https://mirror.ghproxy.com/https://github.com"
    "https://github.com"
    "https://ghfast.top/https://github.com"
)

# ==================== 0/5 网络测速 ====================
title "0/5 网络环境检测"

# 测试 URL 响应时间（秒），超时返回 99
test_speed() {
    curl -so /dev/null -w '%{time_total}' --connect-timeout 3 --max-time 5 "$1" 2>/dev/null || echo "99"
}

# 浮点比较：a < b 返回 0（true）
float_lt() {
    if command -v bc &>/dev/null; then
        (( $(echo "$1 < $2" | bc -l 2>/dev/null || echo 0) ))
    else
        local a_int=${1%%.*} b_int=${2%%.*}
        [ "${a_int:-99}" -lt "${b_int:-99}" ] 2>/dev/null
    fi
}

# 从镜像 URL 提取显示标签
mirror_label() {
    case "$1" in
        https://github.com) echo "github.com(direct)" ;;
        *) echo "$1" | sed 's|https://||; s|/https://github.com||' ;;
    esac
}

# npm registry 测速
info "测试 npm registry 速度 ..."
NPM_TIME=$(test_speed "https://registry.npmjs.org/pnpm/latest")
MIRROR_TIME=$(test_speed "https://registry.npmmirror.com/pnpm/latest")
info "  npmjs.org: ${NPM_TIME}s | npmmirror.com: ${MIRROR_TIME}s"

NPM_REGISTRY="https://registry.npmjs.org"
if float_lt "$MIRROR_TIME" "$NPM_TIME"; then
    NPM_REGISTRY="https://registry.npmmirror.com"
fi
info "选择 npm registry: ${NPM_REGISTRY}"

# GitHub 测速，按速度排序
info "测试 GitHub 速度 ..."
declare -A GH_SPEEDS
for mirror in "${GH_MIRRORS[@]}"; do
    t=$(test_speed "${mirror}/DexterSLamb/openclaw-tianjun")
    label=$(mirror_label "$mirror")
    info "  ${label}: ${t}s"
    GH_SPEEDS["$mirror"]="$t"
done

# 按速度排序镜像列表（最快的排前面）
SORTED_MIRRORS=()
for mirror in "${GH_MIRRORS[@]}"; do
    SORTED_MIRRORS+=("${GH_SPEEDS[$mirror]}|$mirror")
done
IFS=$'\n' SORTED_MIRRORS=($(sort -t'|' -k1 -g <<<"${SORTED_MIRRORS[*]}")); unset IFS
GH_MIRRORS_SORTED=()
for entry in "${SORTED_MIRRORS[@]}"; do
    GH_MIRRORS_SORTED+=("${entry#*|}")
done

BEST_GH="${GH_MIRRORS_SORTED[0]:-https://github.com}"
info "最快 GitHub 源: $(mirror_label "$BEST_GH")"

# nvm 安装源（镜像代理 raw.githubusercontent.com 路径不可靠，统一用直连）
NVM_SOURCE="https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh"

# ==================== 1/5 系统依赖 ====================
title "1/5 系统依赖"

if ! command -v git &>/dev/null; then
    info "安装 git ..."
    sudo apt update -qq && sudo apt install -y git
else
    info "git 已安装: $(git --version)"
fi

if ! dpkg -s build-essential &>/dev/null 2>&1; then
    info "安装 build-essential ..."
    sudo apt install -y build-essential
else
    info "build-essential 已安装"
fi

if ! command -v unzip &>/dev/null; then
    info "安装 unzip ..."
    sudo apt install -y unzip
else
    info "unzip 已安装"
fi

# ==================== 2/5 Node.js (nvm) ====================
title "2/5 Node.js"

# 查找已有 nvm
NVM_FOUND=""
for nvm_candidate in "$HOME/.nvm" "$HOME/.config/nvm" "${NVM_DIR:-}"; do
    if [ -n "$nvm_candidate" ] && [ -s "${nvm_candidate}/nvm.sh" ]; then
        export NVM_DIR="$nvm_candidate"
        NVM_FOUND=1
        break
    fi
done

if [ -z "$NVM_FOUND" ]; then
    info "安装 nvm ..."
    unset NVM_DIR 2>/dev/null || true
    curl -o- "$NVM_SOURCE" | bash
    for nvm_candidate in "$HOME/.nvm" "$HOME/.config/nvm"; do
        if [ -s "${nvm_candidate}/nvm.sh" ]; then
            export NVM_DIR="$nvm_candidate"
            break
        fi
    done
fi

# 加载 nvm
if [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
fi

if ! command -v nvm &>/dev/null; then
    error "nvm 安装失败，请手动检查"
    exit 1
fi

# 如果淘宝镜像更快，设置 nvm 镜像
if [ "$NPM_REGISTRY" = "https://registry.npmmirror.com" ]; then
    export NVM_NODEJS_ORG_MIRROR="https://npmmirror.com/mirrors/node"
fi

if ! node -v 2>/dev/null | grep -q "v${NODE_VERSION}"; then
    info "安装 Node.js ${NODE_VERSION} ..."
    nvm install "$NODE_VERSION"
    nvm use "$NODE_VERSION"
else
    info "Node.js 已安装: $(node -v)"
fi

# ==================== 3/5 pnpm ====================
title "3/5 pnpm"

if ! command -v pnpm &>/dev/null; then
    info "安装 pnpm ..."
    npm install -g pnpm --registry "$NPM_REGISTRY"
else
    info "pnpm 已安装: $(pnpm -v)"
fi

# 设置 pnpm registry
pnpm config set registry "$NPM_REGISTRY" 2>/dev/null || true
info "pnpm registry: ${NPM_REGISTRY}"

# ==================== 4/5 Clone & Build ====================
title "4/5 Clone & Build"

mkdir -p "$(dirname "$SOURCE_DIR")"

if [ -d "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/package.json" ]; then
    info "源码目录已存在，使用现有代码"
    cd "$SOURCE_DIR"
else
    TAR_FILE="/tmp/openclaw-tianjun-main-$$.tar.gz"
    DOWNLOADED=0

    # 逐个镜像尝试下载 Release 包（32MB，按测速排序，最快优先）
    for mirror in "${GH_MIRRORS_SORTED[@]}"; do
        DL_URL="${mirror}${RELEASE_PATH}"
        label=$(mirror_label "$mirror")
        info "尝试下载: ${label} ..."
        info "  URL: ${DL_URL}"
        # 每次换镜像清除旧文件（不同镜像 Content-Length 可能不同，续传会损坏）
        rm -f "$TAR_FILE"
        # --retry-all-errors: 超时(28)、连接重置(92)等也重试（默认只重试 5xx）
        # --max-time 900: 单次 15 分钟，45KB/s 可下约 40MB，足够完成 32MB
        # 注意: 部分镜像不支持 Range 续传，-C - 可能无效
        if curl -fL -C - --retry 3 --retry-all-errors --retry-delay 5 \
             --connect-timeout 10 --max-time 900 \
             --progress-bar -o "$TAR_FILE" "$DL_URL"; then
            # 验证文件完整性
            if tar tzf "$TAR_FILE" &>/dev/null; then
                DOWNLOADED=1
                break
            else
                warn "  ${label} 下载的文件已损坏，尝试下一个 ..."
                rm -f "$TAR_FILE"
            fi
        else
            warn "  ${label} 下载失败，尝试下一个 ..."
            rm -f "$TAR_FILE"
        fi
    done

    if [ "$DOWNLOADED" -eq 1 ]; then
        info "解压中 ..."
        mkdir -p "$SOURCE_DIR"
        tar xzf "$TAR_FILE" -C "$SOURCE_DIR"
        rm -f "$TAR_FILE"
    else
        error "所有镜像均下载失败"
        info "请手动下载: https://github.com${RELEASE_PATH}"
        info "放到 ${SOURCE_DIR} 目录后重新运行本脚本"
        exit 1
    fi
    cd "$SOURCE_DIR"
fi

info "安装依赖 (pnpm install) ..."
pnpm install

info "构建 (tsdown) ..."
node scripts/tsdown-build.mjs

info "构建 UI ..."
pnpm ui:build

# ==================== 5/5 配置 ====================
title "5/5 配置 OpenClaw"

OPENCLAW_DIR="$HOME/.openclaw"
OPENCLAW_JSON="$OPENCLAW_DIR/openclaw.json"
mkdir -p "$OPENCLAW_DIR"

if [ ! -f "$OPENCLAW_JSON" ]; then
    info "生成 openclaw.json ..."
    cat > "$OPENCLAW_JSON" << JSONEOF
{
  "models": {
    "providers": {
      "local": {
        "baseUrl": "http://127.0.0.1:17701/v1",
        "apiKey": "no-key",
        "api": "openai-completions",
        "models": [
          {
            "id": "qwen3-30b",
            "name": "Qwen3 30B (NPU)",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 32768,
            "maxTokens": 8192
          },
          {
            "id": "gpt-oss-20b",
            "name": "GPT-OSS 20B (NPU)",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 65536,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "local/qwen3-30b",
      "workspace": "$HOME/.openclaw/workspace"
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "openclaw-local-token"
    }
  }
}
JSONEOF
else
    warn "openclaw.json 已存在，跳过（请手动检查 local provider 配置）"
fi

# 创建启动脚本
LAUNCH_SCRIPT="$HOME/.local/bin/openclaw"
mkdir -p "$(dirname "$LAUNCH_SCRIPT")"
cat > "$LAUNCH_SCRIPT" << EOF
#!/bin/bash
cd "$SOURCE_DIR"
exec node openclaw.mjs "\$@"
EOF
chmod +x "$LAUNCH_SCRIPT"
info "启动脚本: $LAUNCH_SCRIPT"

# ==================== 完成 ====================
title "安装完成"

echo "使用方法:"
echo "  openclaw                    # 启动 (需要 ~/.local/bin 在 PATH 中)"
echo "  node ${SOURCE_DIR}/openclaw.mjs  # 直接启动"
echo ""
echo "切换模型:"
echo "  /model local/qwen3-30b"
echo "  /model local/gpt-oss-20b"
echo ""
echo "确保 llama-server 已启动:"
echo "  sudo systemctl start llama-server"
echo "  curl http://127.0.0.1:17701/v1/models"
