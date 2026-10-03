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
| `preview` | 悬停「已修改文件」行 500ms 后出现的 diff 预览卡片：宿主把它 `createPortal` 到 `document.body`，所以它在三栏之外（`position: fixed`）；插件从内容上的 `[data-changes-hover-preview]` 锚点向上找到**最外层 fixed 盒**（卡片本身）并给它打标——但**缩放的是卡片里的 diff 内容**（见下）。 |

`preview` 是**独立槽位**：指针停在预览上（包括卡片内边距）时 `Ctrl+滚轮` 只缩放这张预览
（在此之前事件落到浏览器，触发的是整页缩放），三栏的取值完全不受影响；卡片卸载（指针移开）时
标记随之释放，并且该槽位的值**清零**——下一张卡片从 100% 开始，而不是继承上一张的大小。
预览的内部变体（未 portal 到 `body`）退化为锚点自己的盒，插件不依赖宿主的定位选择。

两条与栏位不同的规则：

1. **只缩内容，不缩卡片**：卡片的位置、内边距、圆角、阴影都是宿主的，缩放卡片会把它从锚点上挪开。
   CSS 因此把 `zoom` 加在槽位内的 `[data-changes-hover-preview]` 上；`zoom` 同时缩放元素的布局盒，
   卡片会跟着长高把内容装进去。
2. **该槽位永远走 `zoom` 臂**（`ZOOM_ONLY_SLOTS`）：`transform` 只缩绘制结果、不占布局空间，
   在 Gecko 上会让 diff 从卡片里溢出来。
3. 它也不参与**自校准与冻结宽度补偿**（`isColumnSlot` / `COLUMN_PANES`）：那两项probe 的是宿主
   面板列的事实并发布全局 `fill`/`fixed` 模式，把一张临时卡片当栏位会让卡片的 `width: 244px`
   被当成「侧栏冻结宽度」，反过来把卡片高度撑到整个视口。

每个被标记的根同时写 `data-pane-scaling-target`（栏）与 `data-pane-scaling-slot`（槽位）；
每个槽位有自己的 `html` 内联变量（`--pane-scaling-<slot>`、`--pane-scaling-counter-<slot>`、
`--pane-scaling-origin-x|y-<slot>`）、自己的 CSS 规则和自己的存储键（`preview` 也在内，
`localStorage['dsh.plugin-scaling.v1']` 里是 `"preview"` 键）。

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

## 缩放范围与步长

范围 1%–500%，槽位状态存的是**整数百分比**（`stepToZoom(step) = step / 100`，
`zoomToStep(zoom) = round(zoom * 100)`），所以 1% 到 500% 之间每一档都可达，旧的
`{"left":1.05}` 这类文档含义不变。

每次手势移动的是**当前值的 5%（最小 1%）**，而不是固定 5 个百分点：

| 当前 | 一格 |
| --- | --- |
| 1%–20% | 1% |
| 100% | 5% |
| 500% | 25% |

固定 5% 步长在 1%–500% 上不可用：从 100% 到 1% 要按 99 次（1 分钟以上），而 500% 附近又太慢。
按比例走之后，100% 附近的手感与旧的 5% 档位完全一致（测试里仍断言 100% → 105%），
两端则分别需要约 16 次与 9 次手势。`Ctrl+0` 仍然直接回到 100%。

## 缩放机制：`zoom` 与 `transform`

栏内容默认用 `zoom` 缩放：一条声明同时缩放布局、绘制与命中测试，栅格轨道、拖拽把手、
固定浮层校准都是按它写的。但 **Gecko 的 `zoom` 不作用于 `border-image` 的九宫格几何**：
被缩放的栏里，`border-image` 仍按未缩放的边框盒排布，多出来的空间全部塞给**右（下）那一格**，
于是用对称素材画的皮肤装饰（女仆皮肤的「新会话」缎带、工作区缎带、设置框、输入框外框）
会「左端帽正常、右端帽被拉伸」，看起来就是同一份对称素材左右两边缩放不一致。
已经在 Firefox 132 / 141 复现；Blink 131 / 140 正常。

绘制结果没法从脚本里量，所以探针是**引擎能力探针**（`src/client/mechanism.ts`）：
`-moz-appearance` 是 Gecko 专有属性，命中即判定 Gecko（另留 Firefox UA 兜底）。
判定在激活时做一次，写成 `body[data-pane-scaling-mechanism='zoom' | 'transform']`，
样式表据此选臂：

| 臂 | 缩放声明 | 宽度/高度补偿 |
| --- | --- | --- |
| `zoom`（默认；Blink 等，以及会话栏） | `zoom: var(--pane-scaling-<slot>)` | 只在自校准判定 `fill='compensated'` 时补偿 |
| `transform`（opt-in，栏 ≠ 100% 时打标；含工具栏的栏打在工具栏下方的内容上） | `transform: scale(var(--pane-scaling-own))` + `transform-origin: top left` + `flex: 0 0 auto` | 恒定 `calc(100% / var(--pane-scaling-own))` |

`transform` 不参与布局，所以这一臂必须恒定补偿：根按 `1 / zoom` 排布，再整体放大回去；
左栏根上内联冻结的宽度仍由那条 `!important` 规则接管（引擎写进变量的值本来就是「冻结宽度 ÷ zoom」）。
这一臂还写了 `flex: 0 0 auto`：右栏停靠分栏的 `<section>` 宿主给的是 `flex: 1 1 auto`，
不压住 flex 算法就会把缩小的布局盒重新撑回单元格（缩小档还会被反向压缩），
结果是整栏比列宽还宽、顶栏那排按钮被挤到列外裁掉——2026-09-30 实测到的回归。

transform 臂**按栏打标**：只有「机制 = transform **且** 该栏确实不在 100%」的根才会被写上
`data-pane-scaling-transformed`，规则也只认这个标（`[data-pane-scaling-slot][data-pane-scaling-transformed]`）。
单位变换 `scale(1)` 没有任何缩放收益，却同样会建立包含块与层叠上下文：真实 Firefox 会话里
中栏停在 100%、被写上 `transform: matrix(1,0,0,1,0,0)` 后，会话头右上角的打开右栏按钮和
`对话 / 轨迹` 页签就消失了；只把该根的 `transform` 清成 `none` 即恢复。因此 100% 的栏完全不加 transform。

**打标位置会跳过工具栏**：一个栏的根如果同时含自己的工具栏（会话头，`[data-slot='conversation.header']`），
transform 就打在**工具栏下方的内容**上（`scaledElementFor`），根保持不缩放（transform 臂下由一条
`[data-pane-scaling-slot]{zoom:1}` 统一取消槽位根自己的 `zoom`）。这样：

- 会话头在结构上落在 transform 之外——它既不会被 transform 影响，也不需要反向缩放，
  右上角的按钮与页签因此稳定（此前「transform 覆盖会话栏就会让它们消失」，`scale(1)` 与 `scale(1.1)` 都复现）；
- 栏内其余部分（含女仆皮肤画在 `[data-composer-card]::before` 上的九宫格外框）由 transform 绘制，
  Gecko 下 `border-image` 的错位随之修好；
- 工具栏占的高度由引擎实测写入 `--pane-scaling-toolbar-<slot>`，内容区按
  `calc((100% - toolbar) / zoom)` 排布，视觉上正好接在工具栏下方、铺满剩余高度。

实测（真实 GUI，中栏 120%，Firefox + Chromium，两臂）：头部恒为 `1414×40`、右上角按钮恒为 `28×28`；
transform 臂下打标元素是 `DIV.SsMvdW_body`（不是根、不是头部），其视觉盒恒为 `280,40,1414,600`
即「工具栏下方、铺满」。

机制选择：默认就是引擎探针（`'auto'` 的行为），`localStorage['dsh.plugin-scaling.mechanism']`
可以把任一侧钉死：

| 值 | 行为 |
| --- | --- |
| 未设置（默认） | 引擎探针：Gecko → `transform`，其余 → `zoom` |
| `'auto'` | 同默认 |
| `'transform'` | 强制走 transform 臂 |
| `'zoom'` | 强制走 zoom 臂（即使引擎是 Gecko） |

为什么敢把 Gecko 默认成 transform：真实反馈里「transform 覆盖会话栏 → 会话头控件消失」
的触发条件已经定位清楚——单位变换同样会建立包含块与层叠上下文，而只要 transform 覆盖到
工具栏就会出问题；现在打标位置跳过工具栏（见上），`scale(1)` 不再打标，栏内其余部分照常。
用户在其环境（Firefox、左栏 0.9 / 中栏 1~1.2 / 右栏 1.3、女仆皮肤）实测通过。
两条臂在真实 GUI 下几何一致：侧栏 360px、左栏 120% 时，Firefox 修复后与 Chromium 的渲染
平均像素差 8/255（修复前 23/255），缎带左右端帽的实绘位置完全对齐。

取舍：`transform` 会建立层叠上下文与包含块（`zoom` 不会），栏内 `position: fixed` 后代因此
更接近自校准里的 `contained` 分支——判定本来就是探针在该栏内实测出来的；栏级装饰（在缩放根
之外，例如女仆皮肤的侧栏金框）不受影响。

### 会话头保持 100%

中栏顶部那一行（会话标题、视图页签、打开右栏的按钮，即宿主 `[data-slot='conversation.header']`
整块，含其下的页签行）**不跟着中栏缩放**：它是这一栏的工具栏，跟着放大只会挤掉内容。
做法是对它做一次反向缩放——

```css
body[data-dsh-plugin-scaling]
  [data-pane-scaling-slot]:not([data-pane-scaling-transformed])
  [data-slot='conversation.header'] { zoom: var(--pane-scaling-counter); }
```

反向缩放的盒子与内容会互相抵消：头部自身按 1:1 排版（字号、按钮、页签都不变），
它在栏里占的高度仍是自然高度（中栏 120% 时实测 39px，未处理前是 48px），
下方内容紧接着从那里开始；头部在横向依旧铺满整栏。该规则避开 transform 臂（那一臂缩的是
绘制结果，嵌套 `zoom` 会互相打架），因此只有 `zoom` 臂的栏会命中——中栏现在恒走 `zoom`。
实测（Firefox / Chromium，中栏 100% / 120% / 150%）：头部恒为 `1414×40`、右上角按钮恒为 `28×28`。

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
   中栏顶部的会话头（`[data-slot='conversation.header']`）也在此列：它是栏工具栏、本来就不跟着栏缩放，
   指针落在它上面时把 `Ctrl+滚轮` 交回浏览器做**整页（全局）缩放**——脚本没法驱动浏览器自身的页面缩放，
   放行是唯一办法。键盘路径沿用既有回退（没有栏在下面时仍作用上次用过的栏），与终端/预览一致。
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
