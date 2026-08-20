# Gravity Chess 3D 化架构与实施记录

> 本文记录架构评估、Blender MCP 原型和第一版 Three.js 接入。实施没有改变游戏规则、AI 或线上协议；Blender 只负责制作和导出资产，TypeScript 仍是运行时唯一规则权威。

## 结论摘要

- 现有规则可以与视觉渲染分离，核心复用价值很高。
- `Board` 和 `GameEngine` 没有导入 Canvas 或 DOM；`CanvasRenderer` 通过只读上下文读取状态，已经是可替换渲染器的雏形。
- 当前入口不是 Vue，而是 Vite + 原生 TypeScript + HTML/CSS。第一版应在现有入口旁增加 Three.js 渲染器，不应为了 3D 先迁移框架。
- 建议保留 2D/3D 双模式：Canvas 作为稳定回退和低性能设备方案，Three.js 作为可选的沉浸式视图。
- 当前的“左右联通 / 上下联通 / 全联通”是胜负判断的拓扑环绕，不是重力方向。产品范围已收敛为：3D 只支持普通向下落子和拓扑判定，不支持障碍、炸弹、重力反转、手动查胜或拓扑镜像；这些设置开启时由 UI 自动切回 2D。

## 2026-08-16 视觉精修

- 运行时棋盘改为复用低面数几何与共享材质的程序化组件，不再下载仅作原型参考的 GLB；3D 动态分包的 gzip 体积由约 167 KB 降至约 140 KB。
- 棋盘是薄型圆角金属外框加石墨内衬，没有底座或支架；每个槽位由深色内凹面和独立金属内圈组成，棋子统一从同一世界坐标映射落在内圈前方的安全间隙中。
- 重力改为活动边缘上的低亮度光带与小箭头，拓扑提示统一为低饱和冷色内嵌轨，不再混用蓝、粉、白色外置辅助几何。
- 3D 交互使用不可见棋盘命中面映射列坐标，不依赖每个圆形槽位的曲面命中；落子动画在 `requestAnimationFrame` 降速时有短定时回退，保证落子能结算。

## 现有代码审计

### 1. 游戏状态与棋盘

`src/core/types.ts` 定义了游戏的可序列化状态契约：

- `GameSettings`：尺寸、连珠数、水平/垂直环绕、障碍、炸弹、重力反转、计时、AI/联机设置。
- `Cell = 0 | -1 | 1 | 2`：空格、障碍、红方、金方。
- `EngineSnapshot`：悔棋所需的矩阵、当前玩家、状态、胜者、胜线、重力、道具次数和棋步。
- `ReplayFrame`：复盘所需的矩阵、当前玩家、重力、状态、胜者、胜线和标签。
- `SerializedGameState`：线上同步和持久化边界，包含设置、当前矩阵、棋谱、日志、复盘帧和历史深度。

`src/core/Board.ts` 是规则数据结构，核心字段为 `rows`、`cols`、`winLength`、`wrapHorizontal`、`wrapVertical` 与 `matrix`。它提供：

- `findDropRow()` / `dropPiece()`：按 `down` 或 `up` 查找落点并写入矩阵。
- `detonateAtColumn()`：物理 3x3 爆炸，之后调用 `settlePieces()`；环绕不会扩大爆炸范围。
- `flipGravity()` / `settlePieces()`：按障碍分段，重新堆叠棋子。
- `checkWin()` / `scanForWinner()` / `scanPlayerWinner()`：横、竖、两条斜线和拓扑环绕胜负判断。
- `clone()` / `cloneMatrix()` / `setMatrix()`：AI 搜索、悔棋和导入状态使用。

### 2. 落子、胜负和特殊动作

`src/core/GameEngine.ts` 负责回合编排而不是绘制：

- `drop()` 先保存快照，再由 `Board` 求落点、落子、查胜、记录棋步、判断平局和切换回合。
- `useBomb()` 先求投放中心，再清理 3x3、沉降、查胜并记录被移除位置。
- `checkWinManually()` 支持关闭自动查胜后的“查胜也算一步”规则。
- `flipGravity()` 当前执行 `this.gravity = 'down'`、`board.flipGravity('down')`，因此它是“矩阵反转后重新向下沉降”的一次性特殊动作，而不是持久的 `up` 状态切换。
- `finishAction()` 统一处理胜利、全盘查胜、平局和回合推进。

### 3. AI 依赖边界

AI 只依赖 `GameEngine` 内的 `Board`：

- 使用 `getAvailableColumns()`、`clone()`、`dropPiece()`、`checkWin()`、`scanPlayerWinner()`、`matrix` 和拓扑解析。
- 困难度搜索使用候选列排序、时间预算、Alpha-Beta、转置缓存和启发式威胁评分。
- 没有 DOM、Canvas、Three.js 或 Blender 依赖，因此可以原样复用。

3D 渲染器不得把网格对象、世界坐标或动画状态写回 `Board`；AI 也不应知道任何 3D 坐标。

### 4. 棋谱、悔棋、复盘和联机

- 每个改变状态的动作先进入 `history`，快照只保存规则状态，不保存渲染变换。
- `moves` 是动作记录，`logEntries` 是包含悔棋请求/回应等 UI 日志的记录。
- `replayFrames` 保存每一步之后的完整矩阵，因此复盘可以不依赖历史动画。
- `undo()` 恢复最近一个 `EngineSnapshot`，再追加一个“悔棋”复盘帧。
- 联机服务器在 `server.ts` 中持有 `GameEngine`，通过 `exportState()` 和 `MoveOutcome` 广播；客户端收到状态后先 `importState()`，再播放 outcome 动画。

这意味着 3D 只需要同步“当前状态”和“动作前后差异”，不需要保存 Blender 或 Three.js 的中间姿态。

### 5. 现有 2D Renderer 与 UI 耦合

`src/render/CanvasRenderer.ts` 当前已经有清晰的可替换边界：

- 依赖 `Board` 的尺寸、矩阵和 `findDropRow()`。
- 通过 `RenderContext` 读取当前玩家、重力、状态、胜线、动作模式、拓扑透视和评分偏移。
- 对外提供 `setBoard()`、`setReplayFrame()`、`getColumnFromEvent()`、`animateMove()` 与 `animateFlash()`。
- 内部只维护 hover、落子/炸弹/闪光动画和复盘帧，不修改引擎状态。
- 拓扑透视用 2D 镜像偏移显示 1x3、3x1 或 3x3 参考棋盘，中央棋盘才接受点击。

`src/main.ts` 仍是粘合层：它持有单例 `engine` 和 `renderer`，在落子、AI、线上同步、悔棋、重开、设置预览和复盘路径上直接调用 renderer。这是中等程度耦合，但不是规则与视觉的耦合；可以先加一个渲染器接口，再逐步收拢调用点。

## 推荐运行时架构

```text
GameEngine / Board / SerializedGameState
              |
       RenderState Adapter
              |
      +-------+--------+
      |                |
 CanvasRenderer   ThreeRenderer
      |                |
   2D canvas       WebGL canvas
```

第一版只引入一个只读的 `RenderState` 适配层，不改 `Board` 和 `GameEngine`：

```ts
interface RenderState {
  matrix: Cell[][];
  rows: number;
  cols: number;
  currentPlayer: Player;
  gravity: GravityDirection;
  status: GameStatus;
  winner: Player | null;
  winLine: Position[];
  wrapHorizontal: boolean;
  wrapVertical: boolean;
  topologyPerspectiveEnabled: boolean;
}

interface GameRenderer {
  setBoard(board: Board): void;
  sync(state: RenderState): void;
  setReplayFrame(frame: ReplayFrame | null): void;
  getColumnFromEvent(event: PointerEvent | MouseEvent): number | null;
  animateMove(outcome: MoveOutcome, before?: RenderState, after?: RenderState): Promise<void>;
  animateFlash(): Promise<void>;
  destroy(): void;
}
```

保留现有 `CanvasRenderer` 的公开方法作为兼容适配；`ThreeRenderer` 只在 UI 层被选择。这样 AI、服务器、棋谱和规则测试不需要感知渲染器。

## 3D 坐标与状态映射

Blender 原型使用 `X=列、Z=行、Y=景深`，棋盘正面朝负 Y，行 0 是视觉顶部。glTF 导入 Three.js 后会转换为 Y-up；运行时统一使用 `X=列、Y=行、Z=景深`。两侧契约分别是：

```text
Blender:
  x = (col - (cols - 1) / 2) * spacing
  z = centerZ + ((rows - 1) / 2 - row) * spacing
  y = pieceFrontDepth

Three.js local board space:
  x = (col - (cols - 1) / 2) * spacing
  y = ((rows - 1) / 2 - row) * spacing
  z = pieceFrontDepth
  Board.position.y = centerY
```

运行时棋盘尺寸仍可为 4..12；Blender 的 5x7 资产只作为原型参考，不应成为规则尺寸上限。动态尺寸用共享的低面数槽位、内圈和棋子几何排布。

### 普通落子

- 3D 中棋子只沿 Blender 负 Z / Three.js 局部负 Y 方向进入目标槽位。
- 动画棋子和落定棋子调用同一个 `createPiece()`，共享程序化几何和材质；落地帧显式归一化位置、旋转和缩放，避免可见跳变。
- 落地帧显式归一化位置、旋转和缩放；不再添加会在最后一帧跳变的倾斜旋转。
- 重力反转仍保留在规则引擎和 2D Renderer 中，不进入 3D 的支持范围。

### 拓扑联通

联通不是物理穿越：

- 标准：只显示中央棋盘。
- 左右联通：3D 仅在左右边界显示成对的蓝色边界轨，胜负扫描仍可跨左右边界。
- 上下联通：3D 仅在上下边界显示成对的粉色边界轨，胜负扫描仍可跨上下边界。
- 全联通：同时显示两组边界轨，不复制 3x3 棋盘；拓扑判定仍完全由 `Board` 完成。
- 拓扑镜像是 2D 专属辅助视图；开启该选项会自动退出 3D。

因此“全联通”应表达为多个可能的胜负邻接方向，而不是多个同时生效的物理重力方向。

## 3D 动画契约

渲染器不应从单个 `MoveOutcome` 猜测所有位移。协调层在动作前捕获 `before = engine.exportState()`，动作完成后捕获 `after = engine.exportState()`，再把两者交给动画器：

```text
before.matrix -> after.matrix
before.gravity -> after.gravity
MoveOutcome (kind, position, removed, win)
```

- `drop`：新棋子从棋盘上方向目标 `Position` 下落；其他棋子不动，动画和静态阶段共享同一套程序化几何与材质。
- `bomb` / `flip` / 手动 `check`：3D 不处理；相应设置开启时先切到 2D，再由原有 Canvas 动画和规则执行。
- `undo`：直接同步快照矩阵，不重新调用 AI 或规则，也不保存渲染中间态。
- `replay`：`ReplayFrame` 是确定性输入；逐帧 `sync`，若要动画则仅对相邻帧做矩阵差异动画。
- `win`：按 `winLine` 生成跨槽位连线；拓扑边界处拆成不连续的可见段，避免在视觉上画一条穿过不存在空间的直线。

## Blender 原型资产

由 `scripts/create-blender-prototype.mjs` 通过 Blender MCP 的 `execute_blender_code` 实际生成，并在 2026-08-16 再次通过 MCP 读取、清理集合、保存和导出：

- [gravity-chess-3d-prototype.blend](../prototype/gravity-chess-3d-prototype.blend)：1.6 MB，可继续在 Blender 中编辑。
- [gravity-chess-3d-prototype.glb](../prototype/gravity-chess-3d-prototype.glb)：454 KB，glTF 2.0，作为 Blender 原型交换文件保留，不参与当前网页运行时下载。
- [gravity-chess-3d-preview.png](../prototype/gravity-chess-3d-preview.png)：1,200x900 的渲染预览。
- 场景统计：69 个对象、59 个网格、10 个材质、约 14,906 个三角形；35 个 `Cell_*`、两类模板棋子、障碍、重力指示器、相机和三盏灯均已按名称核验。

关键节点和分组：

```text
GravityChess_Prototype
├── Board
│   ├── Board_BackPlate / Board_Frame_* / Board_Base / Board_Support_*
│   └── Cells / Cell_00_00 ... Cell_04_06
├── Pieces
│   ├── Piece_Player1 / Piece_Player2
│   ├── Piece_Demo_Player*_*
│   └── Piece_Obstacle
├── GravityIndicator
│   ├── GravityIndicator_Shaft
│   ├── GravityIndicator_Head
│   └── GravityIndicator_Halo
├── TopologyIndicators
│   └── TopologyPortal_Horizontal_* / TopologyPortal_Vertical_*
├── Camera
└── Light_Key / Light_Fill / Light_Rim
```

材质沿用现有红方/金方语义：石墨棋盘、铝色边框、红方、金方、青绿色重力指示器、蓝/粉拓扑门户和灰色障碍。模型保持低复杂度，棋子为带倒角的圆柱，棋盘格为浅凹槽，便于后续拆分和实例化。

导出时 Blender 日志提示 Area Light 不进入标准 glTF。`.blend` 仍保留三盏灯用于美术预览；网页端应在 Three.js 中创建 `HemisphereLight`/`DirectionalLight`/`PointLight` 等运行时灯光，不依赖 GLB 灯光节点。

## Three.js 接入方案

1. **几何复用**：棋盘、槽位内圈和棋子由 Three.js 共享几何与材质生成；Blender GLB 仅保留为美术原型，避免页面下载未使用资源。
2. **动态棋盘**：根据 `rows/cols` 在运行时排布槽位与棋子；5x7 原型不限制 4..12 的设置。动态槽位复用低面数几何，避免为每个尺寸创建高模资产。
3. **交互**：为中央可交互棋盘格建立 `userData = { row, col }`，用 `Raycaster` 将指针命中转换为列号；拓扑边界轨不进入命中列表。
4. **摄像机**：使用受限 OrbitControls 的透视相机表现模型景深；拓扑模式不复制棋盘，移动端自动拉远以保持中央棋盘可读。
5. **灯光**：Three.js 场景自建低成本灯光；阴影只给棋盘和棋子开启，必要时降低 shadow map 分辨率。
6. **回退**：WebGL 初始化失败、低端设备或用户选择 2D 时继续使用 CanvasRenderer；UI 状态和游戏输入不变。
7. **动画时钟**：ThreeRenderer 使用自己的 requestAnimationFrame/Clock，但不替代引擎的 `tick()`；计时、AI 和线上状态仍由现有入口驱动。

## 是否保留 2D/3D 双模式

建议保留，而且第一版默认 2D：

- 2D 继续作为已验证的主模式、无 WebGL 回退和低带宽入口。
- 3D 作为普通落子的沉浸视图，不改变规则和操作语义；特殊规则与拓扑镜像保留在 2D。
- `main.ts` 集中判断 3D 兼容性；设置预览、应用设置和线上导入状态都通过同一个自动回退入口。
- 两个 renderer 共享 `RenderState`、列命中语义、动作前后状态和复盘帧。
- 2D/3D 切换时直接从 `engine.exportState()` 重建视觉，不复制或迁移渲染中间状态。

## 实施状态与后续顺序

1. **已完成：审计与资产**。规则/视觉边界确认；Blender MCP 原型 `.blend`/`.glb`/预览生成并实机复核。
2. **已完成：渲染接口**。`RenderState` 与 `GameRenderer` 已成为 2D/3D 共用边界，Board、GameEngine、AI 和网络协议未引入渲染依赖。
3. **已完成：Three.js 基础**。按需加载 ThreeRenderer，复用程序化棋格/内圈/棋子几何；运行时灯光、棋盘命中面、OrbitControls 与 2D 回退已接通。
4. **已完成：普通落子动画**。drop 入场和落定共用同一 `createPiece()`；短定时回退保证受限帧率下也会落定。特殊动作保持 2D。
5. **已完成：复盘/联机边界**。`ReplayFrame` 与 `room:state + outcome` 使用相同 renderer 协议，视觉中间态不进入序列化状态。
6. **已完成：拓扑判定表现**。左右/上下边界轨由 Three.js 生成，不创建镜像棋盘；跨边界胜线使用分段高亮，中央棋盘是唯一命中面。
7. **已完成：能力边界**。障碍、炸弹、重力反转、手动查胜或生效中的拓扑透视会禁用 3D；若已在 3D，则自动切回 2D。
8. **下一步：性能与体验加固**。继续对 4..12 棋盘、低端移动 GPU、WebGL context loss、在线观战和长棋谱做压力测试；规则层无须为 3D 改造。

## 当前网页验收

- `npm run build` 通过；ThreeRenderer 保持动态拆包，不增加首屏 Canvas 的同步初始化成本。
- `npm run bench:ai` 通过标准、横向环绕、环面与 8x9 场景，证明 AI 仍只依赖规则状态。
- 浏览器在 1280x900 与 390x844 下验证了 WebGL 非空画布、点击落子、落子结算和移动端无横向溢出。
- 动画棋子与落定棋子共享程序化几何；当前页面不下载原型 GLB。
- 标准棋盘与左右跨边界各完成一局真实 7 手红方四连胜；2D/3D 均显示连续高亮，3D 生成 4 个棋子光环，跨边界胜线拆成朝向成对边界轨的可见段。
- 左右联通在关闭拓扑透视时保持 3D；开启炸弹或生效中的拓扑透视后，界面自动切回 2D 并禁用 3D 入口。
- 手机窄屏会自动拉远摄像机，棋盘和重力指示器保持在画布内；`prefers-reduced-motion` 下仍可直接同步确定状态。
- Blender MCP 再次读取当前场景及关键节点：69 个对象、10 个材质；`Board`、`Cell_00_00`、`Piece_Player1`、`Piece_Player2`、`GravityIndicator`、`Camera` 与三盏 `Light_*` 均存在且命名正确。

## 验收重点

- `npm run build` 仍通过，现有 Canvas 行为和 AI 基准不回归。
- 标准、左右联通、上下联通、全联通四种设置下，命中列、落点、胜线和复盘帧一致。
- Blender 原型可独立导出并保留其 Board/Cell/Piece/GravityIndicator 节点；网页不依赖这些节点完成运行时渲染。
- WebGL 不可用时 2D 自动可用；切换模式不改变 `SerializedGameState`。
- 线上客户端先同步服务端状态，再播放动作；乱序或重复消息不会写入规则状态。
- 悔棋和复盘只由引擎快照/复盘帧决定，动画中断后重新同步仍能得到同一棋盘。
