# dsh-plugin-scaling · DSH 三栏独立缩放

给 DeepSeek Harness Web GUI 的三栏（**左栏 / 中间主窗口 / 右栏**）做互相独立的整体缩放。
纯展示层客户端插件：不注入服务、不改宿主代码、不依赖任何皮肤，只在浏览器里写自己的 DOM/CSS。

- `Ctrl`（macOS `⌘`）**+ 滚轮** → 缩放**指针所在栏**
- `Ctrl` **+ `+` / `-`** → 缩放**焦点所在栏**（回退顺序：焦点元素最近的栏 → 最近指针交互的栏 → 中栏）
- `Ctrl` **+ `0`** → 把该栏复位到 100%

档位 75%–150%、每档 5%；100% 时渲染与不装插件逐像素一致。

## 安装

包内 `lib/` 是提交型产物，安装后无需再构建。

```sh
# 本地目录
dsh plugin --profile web add /root/dsh-plugin-scaling

# 或 git 托管（lib/ 已入库，无需 prepare 构建）
dsh plugin --profile web add github:BeyondandSharp/dsh-plugin-scaling
```

安装后刷新页面，在「设置 → 插件」里可以看到本插件（已本地化的名称与说明）。
停用（不删除）即完全恢复浏览器原生缩放，且不留任何属性、样式、监听器与提示条。

## 存储

数值按浏览器存在插件自己的键里，刷新与重启页面后恢复：

| 键 | 值 |
| --- | --- |
| `localStorage['dsh.plugin-scaling.v1']` | `{"left":1,"center":1,"right":1}`（缩放倍率；左/中/右独立） |

`localStorage` 不可用（隐私模式、站点数据被禁）时退化为纯内存，功能不丢、只是不持久。
损坏的 JSON、越界值、非数字项按项忽略并夹紧到 75%–150%。

## 与宿主外观、皮肤的关系

- 只依赖宿主设计 token（`--dsw-*`，且都带兜底值）画百分比提示条；不引用任何皮肤属性或皮肤 token。
- 官方默认外观、`maid-atelier`、`orca-link` 及任何第三方皮肤下行为一致；切换/启停皮肤不会重置本插件的数值。
- 与「设置 → 通用 → 内容字号」是**相乘**关系：字号轴改文字与图标，本插件缩放整栏，两者互不覆盖。
- 插件行的 id 是 `ui-plugin-scaling`（**不以 `ui-skin-` 开头**），因此 `dsh-deep-whale` 的皮肤管理器不会托管、改写或停用它。

## 缩放对象

缩放的是每栏的**内容根**，不是栏本身，因此栅格轨道宽度、拖拽把手、右侧面板的内联宽度都不受影响：

| 栏 | 缩放对象 |
| --- | --- |
| 左栏 | `[class*='sidebarCol']` 内经插槽锚点（`display: contents` 会穿透）找到的内容根 |
| 中栏 | `[class*='centerCol']` 内包含 `[data-conversation-scroll]` 的内容根 |
| 右栏 | `[data-dockkit-host='dock']` 的可见分栏 `> section` |

## 已知取舍与限制

- **不缩放**右栏浮动面板（`[data-dockkit-float]`）与含终端（`.xterm`）的分栏：浮窗用内联坐标定位，终端画布不重排。
- 宿主自己的缩放面（文档/PDF/图片预览）仍由宿主处理 `Ctrl+滚轮`，本插件一律放行；终端同理。
- 悬停类 Tooltip 气泡由宿主渲染在栏内且不 portal，本插件在**自校准判定需要时**才补偿它的尺寸与原点。
- **Web 壳的 `Ctrl+±`/`0` 键位固定不可改**：宿主的快捷键服务把 Web 运行时上的 `Ctrl+=` 判为浏览器保留组合（`unsupported-browser`）而拒绝注册，且其物理键白名单不含小键盘 code；本插件因此在 Web 壳使用内置监听（功能完整，只是不出现在「设置 → 快捷键」里）。在 Electron 桌面壳上会注册成三条可改键命令（`pane-scaling.in` / `.out` / `.reset`）。
- 若将来有别的皮肤或插件也缩放同一批面板，两者的 `zoom` 会**相乘**。
- 宽度补偿按 **`!important` + 跟随宿主冻结宽度** 实现（全表仅三条 `!important`，各栏一条）：
  左栏内容根为了折叠动画把展开宽度**内联冻结**成 `width: <px>`（`ui-sidebar` 的 `SidebarRoot`），
  内联样式优先级高于任何作者规则，不加 `!important` 就补偿不了——表现为缩小后填不满左栏、放大后被左栏的 `overflow: hidden` 截断。
  px 宽度在任何引擎语义下都会被 `zoom` 放大，所以补偿值取**该栏自己的冻结宽度 ÷ 当前缩放**写入
  `--pane-scaling-fill-width-<栏>`，而不是取父盒的百分比；因此**拖动左栏宽度把手时内容宽度会实时跟着变**，
  折叠滑动期间也会沿用宿主自己的冻结宽度，而不是被压成轨道宽。该补偿按栏独立门控
  （`body[data-pane-scaling-fill-left|center|right]`），与自校准测得的引擎级分支互不影响。
- 数值是全局按浏览器的，不区分会话、皮肤或窗口。

## 浏览器支持与自校准

- 需要支持 CSS `zoom` 的引擎；不支持时插件**完全不激活**（不写属性、不装监听），并在控制台留一条说明。
- 首次真正改值时会在该栏内插一次不可见探针，实测两件事，然后写 `body[data-pane-scaling-fill]` / `body[data-pane-scaling-fixed]` 让对应补偿规则生效：
  1. 内容根外盒是否随缩放一起变大（`fluid` / `compensated`）；
  2. 栏内 `position: fixed` 后代是否只被缩放（`scaled`）还是连包含块也变了（`contained`）。
- 校准只跑一次，并会 `console.info('pane scaling: calibration result', …)` 打一条测量载荷。反馈问题时请附上这条日志。
- 探针自动测不出布局的环境（例如 jsdom）按「不做任何补偿」处理。

## 开发

```sh
pnpm install        # 见 pnpm-workspace.yaml：不自动安装可选的宿主 peer
pnpm test           # vitest + jsdom
pnpm run build      # tsdown → lib/index.js + lib/client.js
```

- `pnpm-workspace.yaml` 里 `autoInstallPeers: false`：`@deepseek-ai/dsh` 只是兼容性声明（运行时由 profile 提供），自动安装它会把这个独立插件仓库拖进整个 DSH 应用与一批被 pnpm 拦截的原生构建脚本。
- 不提交 lockfile（`pnpm-lock.yaml` 已在 `.gitignore` 中）。
- `.plan/` 是本地计划与调研材料，不属于发行内容。
- 浏览器探针（可选，用来人工确认自校准结论）：见 `.plan/PROBE.md`。

## 构建预设来源与许可

`build/tsdown.client.ts` 与 `build/web-platform.ts` 逐字 vendored 自
[`dsh-deep-whale/orca-link/build/`](https://github.com/Small-tailqwq/dsh-deep-whale)（MIT），
后者镜像了 [`zhu1090093659/dsh-web-ui`](https://github.com/zhu1090093659/dsh-web-ui) 的共享皮肤工程预设
（作者 Solitude）。保留原文件头注释；构建时 tsdown 对 `external` / `noExternal` 的弃用提示来自上游预设，未作改动。

## 许可

MIT，见 [LICENSE](./LICENSE)。
