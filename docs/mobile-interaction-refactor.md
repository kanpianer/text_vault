# 移动端文本选中与空行光标交互重构设计

## 背景

当前编辑器在移动端已经接入了 `visualViewport`、键盘偏移与工具栏重算逻辑，但实现分散在多个 `useEffect`、状态字段与条件渲染中，导致两类核心交互仍不稳定：

1. 文本选中后，工具栏只有在“键盘已判定弹出”时才固定到底部，未弹键盘时仍跟随内容绝对定位，不满足统一吸附规则。
2. 空行工具栏依赖一次性缓存的 `DOMRect`，页面滚动或视口缩放后会复用过期坐标，出现错位。
3. 选中文本行和空行光标的“可见性保障”逻辑只做了简单的下边界修正，未统一考虑：
   - 顶部不可见
   - 固定工具栏占位
   - 键盘弹出压缩后的可用视口
   - `visualViewport` 缺失时的降级行为

## 重构目标

1. 在移动端统一规则：只要“有文本选中”或“光标落在无内容空行”，工具栏就固定吸附在浏览器可视区底部。
2. 保障目标内容始终可见：
   - 文本选中时，保证选中目标区域位于当前可视区内；
   - 空行聚焦时，保证光标所在空行可见；
   - 键盘弹出时，目标内容与工具栏都不能被遮挡。
3. 兼容主流移动浏览器：
   - 优先使用 `window.visualViewport`
   - 缺失时回退到 `window.innerHeight` 与 `scrollY`
   - 监听 `resize` / `scroll` 组合，兼容 iOS Safari、Android Chrome、微信内置浏览器

## 现状痛点

### 1. 工具栏显示规则不统一

- 文本选中工具栏与空行工具栏都使用“桌面绝对定位 + 移动端键盘弹出时 fixed”的混合逻辑。
- 用户在移动端即便没有打开键盘，只要发生选中/空行聚焦，也要求工具栏固定在视口底部；当前实现不符合。

### 2. 空行定位基于过期坐标

- `emptyLineRect` 直接把 `getBoundingClientRect()` 的结果存入 state。
- 这类矩形是瞬时视口坐标，发生滚动、键盘弹出、地址栏伸缩后会立即过期。
- 结果是空行工具栏位置和滚动修正依据失真。

### 3. 可视范围保障只覆盖部分场景

- 当前仅在移动端 `selectionchange` 后尝试把光标下边缘滚进视口。
- 未覆盖“顶部超出可视区”的情况。
- 未把固定工具栏高度和键盘高度纳入同一套安全区域计算。
- 对文本选中场景没有统一的整块区域可见性策略。

## 核心方案

## 视口模型

新增移动视口计算模块，统一输出以下数据：

- `viewportTop`: 当前可视区顶部在布局视口中的绝对坐标
- `viewportHeight`: 当前可视区高度
- `viewportBottom`: `viewportTop + viewportHeight`
- `keyboardInset`: 键盘或浏览器底部 UI 挤压出的底部占位
- `isKeyboardOpen`: 是否可判定为键盘弹出

优先路径：

1. 读取 `window.visualViewport.height`
2. 读取 `window.visualViewport.offsetTop`
3. 使用 `window.innerHeight - visualViewport.height - visualViewport.offsetTop` 估算底部遮挡高度

降级路径：

1. `viewportTop = window.scrollY`
2. `viewportHeight = window.innerHeight`
3. `keyboardInset = 0`

## 键盘状态检测

使用“底部占位阈值 + `visualViewport` 存在”判定：

- 当 `keyboardInset > 80px` 时视为键盘打开
- 该阈值可过滤 iOS/微信地址栏伸缩带来的轻微波动
- 同时保留连续监听，避免键盘动画过程中的工具栏跳动

## 统一工具栏策略

移动端出现以下任一场景时，都使用固定底部工具栏：

1. 存在非折叠文本选区
2. 光标位于无内容空行

工具栏底部定位公式：

`bottom = max(baseGap, keyboardInset + baseGap)`

其中：

- `baseGap` 为基础安全间距，用于避开系统手势区域与页面底边
- `keyboardInset` 来自 `visualViewport` 计算结果

桌面端仍保留原有“贴近文本/空行”的绝对定位逻辑。

## 目标区域实时解析

避免在 state 中缓存瞬时 `DOMRect`，改为缓存“可重新解析的目标”：

- 文本选中：缓存 `Range`
- 空行聚焦：缓存空行块级元素 `HTMLElement`

每次需要定位或可见性校验时，实时调用：

- `range.getClientRects()` / `range.getBoundingClientRect()`
- `emptyLineElement.getBoundingClientRect()`

这样滚动、视口变化、键盘弹出后都能拿到最新坐标。

## 滚动可见性保障

新增统一滚动计算函数，输入：

- 目标矩形 `targetRect`
- 当前视口信息 `viewportMetrics`
- 固定工具栏高度 `toolbarHeight`
- 上下安全边距 `padding`

输出：

- 需要执行的 `scrollBy` 偏移量

安全可视区：

- `safeTop = viewportTop + padding`
- `safeBottom = viewportBottom - toolbarHeight - bottomGap - padding`

规则：

1. 当目标顶部高于 `safeTop`，向上滚动
2. 当目标底部低于 `safeBottom`，向下滚动
3. 选择“最小足够偏移”，避免过度跳动

文本选中场景使用“选区可见矩形”：

- 优先使用 `range.getClientRects()` 的首尾行合并范围
- 回退到 `range.getBoundingClientRect()`

空行场景使用空行块级元素实时矩形。

## 监听策略

统一监听以下事件来刷新视口数据与触发可见性修正：

- `window.resize`
- `window.scroll`
- `document.selectionchange`
- `visualViewport.resize`
- `visualViewport.scroll`
- 编辑器 `compositionstart` / `compositionend`

其中：

- 视口数据更新负责维护键盘状态和底部固定工具栏偏移
- 交互目标可见性修正使用 `requestAnimationFrame + setTimeout(0~50ms)` 节流，等待键盘/选区布局稳定后执行

## 浏览器兼容性

### iOS Safari

- `visualViewport.offsetTop` 会随地址栏和键盘动画变化
- 使用实时监听 `resize + scroll`，避免只在 `resize` 时更新

### Chrome for Android

- `visualViewport.height` 变化稳定，可直接用于键盘压缩后的可视高度计算

### 微信内置浏览器

- 可能出现 `visualViewport` 行为延迟或不完整
- 使用 `window.innerHeight` 回退，保证至少不出现工具栏完全被遮挡

## 测试策略

新增纯函数测试，覆盖：

1. 不同滚动位置下的安全可视区计算
2. 不同键盘高度下的底部固定偏移
3. 选区矩形、空行矩形的滚动修正方向与距离
4. `visualViewport` 可用与不可用两种兼容路径

同时保留原有工具栏定位测试，确保桌面模式绝对定位行为不回退。

## 实施步骤

1. 新增移动视口与滚动修正工具模块
2. 将空行状态从 `DOMRect` 改为块级元素引用
3. 将移动端工具栏统一为固定底部定位
4. 接入统一可视性保障 effect
5. 补充单元测试并执行 `vitest` 与 TypeScript 诊断
