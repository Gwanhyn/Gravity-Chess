# Gravity Chess 重力棋

一个基于 Connect Four 玩法扩展的本地网页游戏。棋子按列落下，默认棋盘为 5 行 7 列，玩家可以调整棋盘尺寸、连珠数量、空间联通、计时、炸弹、障碍、重力反转和 AI 对战。

根路径是 Gravity Chess 的 3D 首页演示，点击“开始游戏”进入 `/play`。游戏页首次进入默认使用 3D 棋盘；用户主动切换到
2D 或 3D 后，选择会保存在当前浏览器中。2D 和 3D 共享同一局棋局状态，切换不会重开对局。

首页 Showcase 使用独立的逻辑棋盘和状态机：每次只生成一枚合法落子，等待落稳后再继续；清除底行时会暂停生成，压实后的棋子全部完成下落和稳定后才恢复。该演示状态不会写入正式对局引擎。

## 功能

- 默认 5 行 x 7 列，支持自定义棋盘尺寸、连珠数量和红方/金方先手。
- 可切换 Canvas 2D / Three.js 3D 棋盘；共享同一规则状态、列命中、复盘和联机同步。移动端以棋盘和底部核心操作为优先。
- 3D 模式加载 Blender MCP 制作并导出的 GLB，专注普通落子、列高亮、拓扑边界提示和胜利连线；落子动画与静态棋子共用同一模型。
- 3D 保留左右/上下联通的规则判定，但不显示拓扑镜像；开启障碍、炸弹、重力反转、手动查胜或拓扑透视时自动切换到 2D。
- 胜利判定支持横、竖、左斜、右斜，并可开启左右联通和上下联通。
- 自动查胜默认开启；关闭后使用“查胜”按钮，按钮只检查当前行动方是否获胜，结果无论成功或失败都算作一次行动。
- 可开启“拓扑透视”：在左右/上下联通规则下，主棋盘周围会显示半透明镜像棋盘，帮助观察跨边界连珠。
- 支持悔棋、复盘、单步限时、对局总时长。
- 可选特殊规则：炸弹棋子、随机障碍、重力反转。
- 支持本地双人和简单/中等/困难 AI。
- 支持同一局域网双人联机：一台电脑开房，另一位玩家输入房间码加入。

## 手动查胜规则

关闭“自动查胜”后，系统不会在落子、炸弹或反转后自动结束对局。

当前行动方可以点击“查胜”：

- 若当前行动方已经达成连珠，则当前行动方获胜。
- 若当前行动方没有达成连珠，则记录一次“查胜未中”，并切换到另一方。
- 查胜不会检查对手是否获胜。
- 查胜本身计入棋谱，也可以悔棋。

## 重力反转

开启“重力反转”后，每名玩家每局可使用一次。使用后棋盘会上下翻转，障碍也会一起翻转，随后所有棋子重新向下沉降并贴合底部或障碍块。

## 拓扑透视

开启“拓扑透视”后，Canvas 会根据当前联通规则显示镜像参考：

- 开启左右联通时，主棋盘左右两侧显示半透明镜像。
- 开启上下联通时，主棋盘上下两侧显示半透明镜像。
- 同时开启左右和上下联通时，显示 3x3 九宫格视野。
- 只有中央主棋盘接受点击和落点预览，镜像棋盘只用于观察局势。

## 运行

```bash
npm install
npm run dev
```

开发服务器默认运行在：

```text
http://127.0.0.1:5173/
```

## 局域网联机

在作为房主的电脑上运行：


```bash
npm run dev:lan
```

终端会打印本机地址和局域网地址，例如：

```text
Gravity Chess LAN server running at http://127.0.0.1:5173/
LAN: http://192.168.1.23:5173/
```

联机流程：

- 房主打开局域网地址，点击“创建”，获得 4 位房间码；房主默认执红，先手可在设置中选择红方或金方。
- 另一位玩家在同一局域网内打开同一个地址，输入房间码，点击“加入”。
- 房主是红方，加入者是金方；更多连接会作为观战者进入。
- 联机时棋局由房主电脑上的服务器统一同步，只有当前行动方可以操作。
- 房主可以应用设置或重开；联机悔棋需要先向对方发出请求，对方同意后才会回退。
- 房间内无人后默认保留 5 分钟重连窗口，超时会自动从内存销毁；可用 `ROOM_EMPTY_TTL_MS` 调整时长。

如果另一台设备无法访问：

- 确认两台设备在同一个 Wi-Fi 或局域网。
- 使用终端打印的 `LAN: http://...` 地址，不要使用 `127.0.0.1`。
- 检查房主电脑防火墙是否允许 Node.js 访问局域网。

生产构建：

```bash
npm run build
```

生产构建后启动局域网服务：

```bash
npm run start:lan
```

访问次数按“页面访问”统计：页面每次加载成功后记一次，刷新或重新打开会再次计数；同一次请求的网络重试不会重复计数。数据默认保存在 `data/view-count.json`。使用版本目录发布时，应通过 `GRAVITY_CHESS_VIEW_COUNT_FILE` 指向版本目录之外的持久化位置，避免换版时清零，例如 `/var/www/gravity-chess/shared/view-count.json`。该数字不是实时在线人数，也不是独立用户数。

## GitHub Pages 部署

仓库地址为 `Gwanhyn/Gravity-Chess` 时，GitHub Pages 的项目路径是 `/Gravity-Chess/`。

本项目已经配置好 Pages 专用构建脚本：

```bash
npm run build:pages
```

确认构建成功后，可以发布到 `gh-pages` 分支：

```bash
npm run deploy
```

首次发布后，在 GitHub 仓库中进入 `Settings -> Pages`，将 Source 设为 `Deploy from a branch`，Branch 选择 `gh-pages`，目录选择 `/(root)`。

注意：GitHub Pages 只托管静态文件。网页的本地双人和 AI 模式可以直接展示；局域网联机房间功能依赖 `server.ts` 提供的 Socket.IO 后端，不能仅靠 GitHub Pages 运行。

## 项目结构

```text
src/
  core/
    Board.ts          # 棋盘数据、落子、联通胜负判定、重力沉降
    GameEngine.ts     # 回合、计时、悔棋、AI、特殊动作、棋谱
    types.ts          # 类型与默认设置
  render/
    CanvasRenderer.ts # Canvas 绘制与动画
    ThreeRenderer.ts  # Three.js、GLB 资产、3D 命中与动画
    types.ts          # 2D/3D 共用只读渲染协议
  network/
    types.ts          # Socket.IO 联机协议类型
  main.ts             # UI 事件、设置面板、复盘和引擎粘合
  style.css           # 页面样式
server.ts             # 局域网联机服务器
```

## 技术栈

- Vite
- TypeScript
- HTML5 Canvas
- Three.js / WebGL / glTF
- Tailwind CSS
- Lucide icons
- Socket.IO

## Blender MCP（Codex）

完整的 3D 架构审计、规则边界、状态映射、动画契约和验收记录见 [docs/gravity-chess-3d-architecture.md](docs/gravity-chess-3d-architecture.md)。

项目级配置位于 `.codex/config.toml`，使用 Blender MCP 的本地端口 `9876`，并默认关闭第三方遥测。Codex 只会在项目被标记为可信时加载该配置。

使用前：

- 首次安装或更新 Blender 插件时，在项目目录运行 `powershell -ExecutionPolicy Bypass -File scripts/install-blender-mcp.ps1`。
- 打开 Blender，在 `编辑 -> 偏好设置 -> 插件` 中确认 `Blender MCP` 已启用。
- 在 3D 视图按 `N` 打开侧栏，进入 `BlenderMCP`，确认显示 `Running on port 9876`；若未启动，点击 `Connect to MCP server`。
- 重启 Codex 桌面应用或新建本地任务，使项目级 MCP 配置生效；可用 `/mcp` 查看连接状态。

Blender 运行且端口已启动时，可运行 `node scripts/check-blender-mcp.mjs` 检查 MCP 初始化、工具发现和场景读取链路。

Blender MCP 包含执行 Blender Python 的高权限工具，本项目将工具审批模式设为 `prompt`。执行修改场景、下载资源或运行代码的工具前，应检查调用内容并先保存 `.blend` 文件。
