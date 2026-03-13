#!/bin/bash
#
# OpenClaw Tianjun Fork 安装脚本
# 适用于全新 Deepin/Debian 系 Linux
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

# ==================== 1/5 系统依赖 ====================
title "1/5 系统依赖"

if ! command -v git &>/dev/null; then
    info "安装 git ..."
    sudo apt update -qq && sudo apt install -y git
else
    info "git 已安装: $(git --version)"
fi

# build-essential for native modules
if ! dpkg -s build-essential &>/dev/null 2>&1; then
    info "安装 build-essential ..."
    sudo apt install -y build-essential
else
    info "build-essential 已安装"
fi

# ==================== 2/5 Node.js (nvm) ====================
title "2/5 Node.js"

# 查找已有 nvm 或安装新的
NVM_FOUND=""
for nvm_candidate in "$HOME/.nvm" "$HOME/.config/nvm" "${NVM_DIR:-}"; do
    if [ -s "${nvm_candidate}/nvm.sh" ]; then
        export NVM_DIR="$nvm_candidate"
        NVM_FOUND=1
        break
    fi
done

if [ -z "$NVM_FOUND" ]; then
    info "安装 nvm ..."
    unset NVM_DIR
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    # 安装后查找实际位置
    for nvm_candidate in "$HOME/.nvm" "$HOME/.config/nvm"; do
        if [ -s "${nvm_candidate}/nvm.sh" ]; then
            export NVM_DIR="$nvm_candidate"
            break
        fi
    done
fi

# 加载 nvm
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v nvm &>/dev/null; then
    error "nvm 安装失败，请手动检查"
    exit 1
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
    npm install -g pnpm
else
    info "pnpm 已安装: $(pnpm -v)"
fi

# ==================== 4/5 Clone & Build ====================
title "4/5 Clone & Build"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$(dirname "$SOURCE_DIR")"

if [ -d "$SOURCE_DIR/.git" ]; then
    info "源码目录已存在，拉取最新 ..."
    cd "$SOURCE_DIR"
    git pull || warn "git pull 失败，使用现有代码继续"
elif [ -d "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/package.json" ]; then
    info "源码目录已存在（非 git），使用现有代码"
    cd "$SOURCE_DIR"
else
    # 优先使用本地源码包（支持 zip 和 tar.gz）
    LOCAL_ARCHIVE=""
    for candidate in \
        "${SCRIPT_DIR}/openclaw-tianjun-main.tar.gz" \
        "${SCRIPT_DIR}/openclaw-tianjun-main.zip" \
        "${SCRIPT_DIR}/openclaw-tianjun.tar.gz" \
        "${SCRIPT_DIR}/openclaw-tianjun.zip" \
        "$HOME/Downloads/openclaw-tianjun-main.tar.gz" \
        "$HOME/Downloads/openclaw-tianjun-main.zip" \
        "$HOME/Downloads/openclaw-tianjun.tar.gz" \
        "$HOME/Downloads/openclaw-tianjun.zip"; do
        if [ -f "$candidate" ]; then
            LOCAL_ARCHIVE="$candidate"
            break
        fi
    done

    if [ -n "$LOCAL_ARCHIVE" ]; then
        info "检测到本地源码包: ${LOCAL_ARCHIVE}"
        info "解压中 ..."
        mkdir -p "$SOURCE_DIR"
        case "$LOCAL_ARCHIVE" in
            *.tar.gz|*.tgz)
                tar xzf "$LOCAL_ARCHIVE" -C "$SOURCE_DIR"
                ;;
            *.zip)
                unzip -q "$LOCAL_ARCHIVE" -d "$(dirname "$SOURCE_DIR")"
                # zip 解压后目录名可能是 openclaw-tianjun-main
                EXTRACTED=$(find "$(dirname "$SOURCE_DIR")" -maxdepth 1 -name "openclaw-tianjun*" -type d ! -name "openclaw-source" | head -1 || true)
                if [ -n "$EXTRACTED" ] && [ "$EXTRACTED" != "$SOURCE_DIR" ]; then
                    mv "$EXTRACTED"/* "$SOURCE_DIR"/ 2>/dev/null || true
                    rm -rf "$EXTRACTED"
                fi
                ;;
        esac
        cd "$SOURCE_DIR"
    else
        info "克隆 ${FORK_REPO} (可用 --depth 1 加速) ..."
        git clone --depth 1 "$FORK_REPO" "$SOURCE_DIR"
        cd "$SOURCE_DIR"
    fi
fi

info "安装依赖 (pnpm install) ..."
pnpm install

info "构建 (tsdown) ..."
node scripts/tsdown-build.mjs

info "构建 UI ..."
pnpm ui:build

# ==================== 5/5 配置 ====================
title "5/5 配置 OpenClaw"

# 创建 openclaw.json
OPENCLAW_DIR="$HOME/.openclaw"
OPENCLAW_JSON="$OPENCLAW_DIR/openclaw.json"
mkdir -p "$OPENCLAW_DIR"

if [ ! -f "$OPENCLAW_JSON" ]; then
    info "生成 openclaw.json ..."
    cat > "$OPENCLAW_JSON" << 'JSONEOF'
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
            "displayName": "Qwen3 30B (NPU)",
            "contextWindow": 32768
          },
          {
            "id": "gpt-oss-20b",
            "displayName": "GPT-OSS 20B (NPU)",
            "contextWindow": 65536
          }
        ]
      }
    },
    "default": "local/qwen3-30b"
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
exec node dist/cli.mjs "\$@"
EOF
chmod +x "$LAUNCH_SCRIPT"
info "启动脚本: $LAUNCH_SCRIPT"

# ==================== 完成 ====================
title "安装完成"

echo "使用方法:"
echo "  openclaw                    # 启动 (需要 ~/.local/bin 在 PATH 中)"
echo "  node ${SOURCE_DIR}/dist/cli.mjs  # 直接启动"
echo ""
echo "切换模型:"
echo "  /model local/qwen3-30b"
echo "  /model local/gpt-oss-20b"
echo ""
echo "确保 llama-server 已启动:"
echo "  sudo systemctl start llama-server"
echo "  curl http://127.0.0.1:17701/v1/models"
