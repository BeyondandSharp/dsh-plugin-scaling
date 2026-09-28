# 设计说明与取舍

面向维护者的细节。日常使用只需要看 [README](../README.md)。

## 缩放对象

缩放的是每栏的**内容根**，不是栏本身，因此栅格轨道宽度、拖拽把手、右侧面板的内联宽度都不受影响：

| 栏 / 槽位 | 缩放对象 |
| --- | --- |
| `left` | `[class*='sidebarCol']` 内包含 `[data-slot='sidebar.settings']` / `[data-slot='sidebar.panellist']` 等插槽锚点（`display: contents` 会穿透）的内容根 |
| `center` | `[class*='centerCol']` 内包含 `[data-conversation-scroll]` 的内容根 |
| `right` | `[data-dockkit-host='dock']` 第一列的可见分栏 `> section` |
| `right-1` | 同上，第二列（`ui-dockkit` 最多两列：`TabLayout` 对其它形状直接抛错） |

每个被标记的根同时写 `data-pane-scaling-target`（栏）与 `data-pane-scaling-slot`（槽位）；
每个槽位有自己的 `html` 内联变量（`--pane-scaling-<slot>`、`--pane-scaling-counter-<slot>`、
`--pane-scaling-origin-x|y-<slot>`）、自己的 CSS 规则和自己的存储键。

## 与宿主外观、皮肤的关系

- 只依赖宿主设计 token（`--dsw-*`，都带兜底值）画百分比提示条；不引用任何皮肤属性或皮肤 token。
- 官方默认外观、`maid-atelier`、`orca-link` 及任何第三方皮肤下行为一致；切换/启停皮肤不会重置数值。
- 与「设置 → 通用 → 内容字号」是**相乘**关系：字号轴改文字与图标，本插件缩放整栏，两者互不覆盖。
- 插件行 id 是 `ui-plugin-scaling`（**不以 `ui-skin-` 开头**），因此 `dsh-deep-whale` 的皮肤管理器不会托管、改写或停用它。

### 皮肤栏级装饰（已处理）

`maid-atelier` 会把装饰挂在**列内、内容根之外**：`decorateSidebar()` 把小女仆与角饰 `prepend` 进
`.sidebarCol > div`（也就是 `[data-slot='sidebar']` 这个 `display: contents` 插槽锚点），
`ensureChatAreaStage()` 把立绘舞台 `prepend` 进 `.centerCol`。为此：

- 穿透 `display: contents` 锚点时，沿**锚点自己的路径**下降到有盒的元素，而不是取第一个有盒的子节点（否则会把装饰当成缩放对象）；左栏锚点用真正的内容锚点，插槽锚点仅作最后兜底。
- 手势归属先看「是否在已标记的内容根内」，**再回退到「是否在该栏的列内」**（`paneOfColumn`）。指针落在栏级装饰上仍然缩放该栏，而不是放行给浏览器造成整页缩放；portal 到 `body` 的弹窗/菜单/提示不在任何列内，一律不接管。

## 已知取舍与限制

- **不缩放**右栏浮动面板（`[data-dockkit-float]`）与含终端（`.xterm`）的分栏：浮窗用内联坐标定位，终端画布不重排（分栏里只有含终端的那一列退出，另一列照常）。
- 宿主自己的缩放面（文档 / PDF / 图片预览）仍由宿主处理 `Ctrl+滚轮`，本插件一律放行。
- 悬停类 Tooltip 气泡由宿主渲染在栏内且不 portal，本插件在**自校准判定需要时**才补偿它的尺寸与原点。
- Web 壳的 `Ctrl+±`/`0` 键位固定不可改：宿主快捷键服务把 Web 运行时上的 `Ctrl+=` 判为浏览器保留组合
  （`unsupported-browser`）而拒绝注册，且其物理键白名单不含小键盘 code。Web 壳因此使用内置监听
  （功能完整，只是不出现在「设置 → 快捷键」里）；Electron 桌面壳会注册成三条可改键命令
  （`pane-scaling.in` / `.out` / `.reset`）。
- 若将来有别的皮肤或插件也缩放同一批面板，两者的 `zoom` 会**相乘**。
- 数值是全局按浏览器的，不区分会话、皮肤或窗口；存储不可用或损坏时退化为内存 / 按项夹紧。

### 宽度补偿为什么带 `!important`

全表只有三条 `!important`（每栏一条，门控 `body[data-pane-scaling-fill-left|center|right]`）。
左栏内容根为了折叠动画把展开宽度**内联冻结**成 `width: <px>`（`ui-sidebar` 的 `SidebarRoot`），
内联样式优先级高于任何作者规则，不加 `!important` 就补偿不了——表现为缩小后填不满左栏、
放大后被左栏的 `overflow: hidden` 截断。px 宽度在任何引擎语义下都会被 `zoom` 放大，
所以补偿值取**该栏自己的冻结宽度 ÷ 当前缩放**写入 `--pane-scaling-fill-width-<栏>`，
而不是取父盒的百分比；因此拖动左栏宽度把手时内容宽度实时跟随，折叠滑动期间也沿用宿主自己的冻结宽度。
该补偿与自校准测得的引擎级分支（`data-pane-scaling-fill`）相互独立。

## 浏览器支持与自校准

- 需要支持 CSS `zoom` 的引擎；不支持时插件**完全不激活**（不写属性、不装监听），并在控制台留一条说明。
- 首次真正改值时会在该栏内插一次不可见探针，实测两件事，然后写 `body[data-pane-scaling-fill]` /
  `body[data-pane-scaling-fixed]` 让对应补偿规则生效：
  1. 内容根外盒是否随缩放一起变大（`fluid` / `compensated`）；
  2. 栏内 `position: fixed` 后代是否只被缩放（`scaled`）还是连包含块也变了（`contained`）。
- 校准只跑一次，并会 `console.info('pane scaling: calibration result', …)` 打一条测量载荷；反馈问题时请附上这条日志。
- 探针测不出布局的环境（例如 jsdom）按「不做任何补偿」处理。

## 手势归属

1. 排除面（`.xterm`、`[data-dockkit-float]`、`[data-document-zoom-*]`）→ 一律放行。
2. 已标记的内容根 → 用它的槽位（右栏分栏即在此分开）。
3. 栏级装饰等未标记元素 → 所属列；右栏分栏分隔条用「该列最近一次用过的槽位」。
4. 都不匹配 → 放行（浏览器原生缩放）。

`Ctrl+滚轮` 命中时才 `preventDefault()`，但**不** `stopPropagation`；滚轮累计余数在切换槽位或 200ms 空闲后清零。

## 构建预设来源与许可

`build/tsdown.client.ts` 与 `build/web-platform.ts` 逐字 vendored 自
[`dsh-deep-whale/orca-link/build/`](https://github.com/Small-tailqwq/dsh-deep-whale)（MIT），
后者镜像了 [`zhu1090093659/dsh-web-ui`](https://github.com/zhu1090093659/dsh-web-ui) 的共享皮肤工程预设
（作者 Solitude）。保留原文件头注释；构建时 tsdown 对 `external` / `noExternal` 的弃用提示来自上游预设，未作改动。

## 仓库约定

- `lib/` 是提交型产物；`.gitignore` 忽略 `node_modules/`、`*.js.map`、`pnpm-lock.yaml`。
- `pnpm-workspace.yaml` 里 `autoInstallPeers: false`：`@deepseek-ai/dsh` 只是兼容性声明（运行时由 profile 提供），
  自动安装它会把整个 DSH 应用与一批被 pnpm 拦截的原生构建脚本拖进这个独立插件仓库。
- `.plan/` 是本地计划与调研材料，不随包分发。
