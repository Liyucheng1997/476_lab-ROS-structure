# ROS 图解

用 Three.js 把 ROS 1 和 ROS 2 的架构、通信、编译系统、代码结构和实现原理画成可交互的 3D 图。

## 运行

```powershell
npm install
npm run dev
```

浏览器打开终端里显示的地址。`npm run build` 生成静态文件到 `dist/`。

## 内容

| 分组 | 场景 |
| --- | --- |
| 架构 | 总览对照、ROS 1 架构、ROS 2 架构 |
| 通信 | 四种通信方式、ROS 1 话题建立过程、ROS 2 发现与传输 |
| 编译 | CMake 原理、catkin（ROS 1）、colcon + ament（ROS 2） |
| 代码结构 | 工作空间与包、主要库与工具 |
| 实现原理 | ROS 2 执行器、消息生成与序列化 |

操作：拖动旋转，滚轮缩放，右键平移；点击方块看说明和示例代码；带「分步讲解」的场景可以用按钮或左右方向键逐步播放。

## 代码结构

- `src/engine.js`：3D 舞台。把场景数据渲染成方块、连线、流动的小点，处理镜头、点击和主题。
- `src/main.js`：导航、右侧详情面板、分步讲解条。
- `src/scenes/*.js`：各场景的数据（节点、分组、连线、步骤），内容都在这里。
- `src/style.css`：界面样式。

新增场景：在 `src/scenes/` 里按现有格式写一个对象，再加到 `src/scenes/index.js` 的 `sections` 里。
