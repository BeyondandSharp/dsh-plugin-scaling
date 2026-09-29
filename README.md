# dsh-plugin-scaling

给 DSH Web GUI 的三栏（左栏 / 中间主窗口 / 右栏）做**各自独立**的整体缩放：75%–150%、每档 5%。
纯前端插件：不改宿主、不依赖皮肤，数值存在插件自己的 `localStorage` 里。

## 用法

| 操作 | 作用 |
| --- | --- |
| `Ctrl` / `⌘` + 滚轮 | 缩放**指针所在栏** |
| `Ctrl` / `⌘` + `+` / `-` | 缩放**焦点所在栏** |
| `Ctrl` / `⌘` + `0` | 把该栏复位到 100% |

右栏拆成两列后，两列各算一栏、各自独立缩放。每次变化右下角会显示一下「栏名 + 百分比」。

<img width="2022" alt="20260929040325_rec_" src="https://github.com/user-attachments/assets/d915849f-2cad-4f00-bdc0-835780c0ca0d" />
<img width="2022" alt="20260929040203_rec_" src="https://github.com/user-attachments/assets/4efbcfff-05f3-44eb-b999-35ac1bd3f1bf" />


## 安装

包内 `lib/` 已入库，安装后不需要再构建：

```sh
# 本地安装
dsh plugin --profile web add /root/dsh-plugin-scaling
# 从npm安装
dsh plugin --profile web add @beyondandsharp/dsh-plugin-scaling
# 或从 git 安装
dsh plugin --profile web add github:BeyondandSharp/dsh-plugin-scaling
```

装完刷新页面即可用。在「设置 → 插件」里可以停用：停用即完全恢复浏览器原生缩放，不留任何属性、样式、监听器或提示条。

## 存储

数值按浏览器保存，刷新/重启后恢复：

```
localStorage['dsh.plugin-scaling.v1'] = {"left":1,"center":1,"right":1,"right-1":1}
```

`right` 是第一列、`right-1` 是右栏第二列。存储不可用（隐私模式等）时退化为纯内存；损坏或越界的项按项忽略并夹紧到 75%–150%。

## 说明

- 官方默认外观与大多数皮肤（`maid-atelier`、`orca-link` …）下行为一致，只使用宿主设计 token；与「设置 → 通用 → 内容字号」是相乘关系。
- **Web 壳的 `Ctrl+±`/`0` 键位固定**（宿主快捷键服务把 `Ctrl+=` 判为浏览器保留组合而拒绝注册）；Electron 桌面壳上会注册成三条可改键命令，出现在「设置 → 快捷键」。
- 更细的取舍与实现说明（自校准、皮肤栏级装饰、宽度补偿等）见 [docs/DESIGN.md](./docs/DESIGN.md)。

## 开发

```sh
pnpm install        # 见 pnpm-workspace.yaml：不自动安装可选的宿主 peer
pnpm test           # vitest + jsdom
pnpm run build      # tsdown → lib/index.js + lib/client.js
```

## 许可

MIT，见 [LICENSE](./LICENSE)。`build/` 下的两个构建预设逐字 vendored 自
[dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)（上游是 [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 的共享皮肤工程预设），同许可，署名见 [docs/DESIGN.md](./docs/DESIGN.md)。
