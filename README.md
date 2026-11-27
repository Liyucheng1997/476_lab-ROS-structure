# ROS 图解

这个仓库里有两样东西：

1. **图解**（`src/`）：用 Three.js 把 ROS 1 和 ROS 2 的架构、通信、编译系统、代码结构和实现原理画成可交互的 3D 图。
2. **实机运行页**（`src/lab/`）：把下面这套 ROS 2 原样搬进浏览器里跑，带网页终端，实时画出每个数据包、每个进程的启动过程和消息的序列化。见[「实机运行页」](#实机运行页)。
3. **一个能跑的 ROS 2**（`ros2/`）：按 ROS 2 的分层架构用 Node.js 从头实现，不依赖任何第三方库。见下文[「能跑的 ROS 2」](#能跑的-ros-2)。

## 图解：运行

```powershell
npm install
npm run dev
```

浏览器打开终端里显示的地址。`npm run build` 生成静态文件到 `dist/`。

## 图解：内容

| 分组 | 场景 |
| --- | --- |
| 实机运行 | 终端与实时通信（见下文） |
| 架构 | 总览对照、ROS 1 架构、ROS 2 架构 |
| 通信 | 四种通信方式、ROS 1 话题建立过程、ROS 2 发现与传输 |
| 编译 | CMake 原理、catkin（ROS 1）、colcon + ament（ROS 2） |
| 代码结构 | 工作空间与包、主要库与工具 |
| 实现原理 | ROS 2 执行器、消息生成与序列化 |

操作：拖动旋转，滚轮缩放，右键平移；点击方块看说明和示例代码；带「分步讲解」的场景可以用按钮或左右方向键逐步播放。

## 实机运行页

导航里的「终端与实时通信」。页面下方的终端运行的是 `ros2/` 目录里**原封不动的代码**，不是录好的动画：

- 每条 `ros2` 命令启动一个独立进程（一个 Web Worker），入口和真机一样是 `ros2/cli/ros2.js`；
- 页面扮演操作系统和网络：进程的 UDP 套接字在这里登记端口，数据包由这里转发，所以每个包都能被看到；
- 能用的命令和真机相同：`ros2 run / launch / topic / service / param / action / node / interface / doctor`，`Ctrl+C` 结束进程，小乌龟可以用方向键遥控。

能看到什么：

| 位置 | 内容 |
| --- | --- |
| 3D 画面 | 上排是进程，下排是话题、服务、动作。飞过的小点是真实的数据包，按种类上色：数据、发现、实体列表、心跳、应答，半路消失的是被丢掉的包。点方块看细节 |
| 「数据包」 | 每个转发的 UDP 包一行。点开能看到解出来的消息内容和按段着色的原始字节 |
| 「启动过程」 | 一条 `ros2 run` 从回车到开始通信的每一步：加载可执行文件、抢端口、加入多播组、解析接口文件、创建节点和读者写者、发现对方、匹配成功 |
| 「序列化」 | 选一个接口，改消息内容，实时看到它怎么变成 CDR 字节：每个字段占哪几个字节、哪里是对齐填充 |
| 终端上方 | 「演示」一键跑通话题、服务、动作、参数、launch 等场景；「延迟」让数据包飞慢一点；「丢包」调高后能看到心跳和应答怎么把丢的消息补回来 |

真实的 ROS 2 有编译这一步（colcon 把接口文件生成成代码），原理在「编译」分组的几张图里。这里的实现改成了运行时解析接口文件，所以没有编译过程，对应的步骤出现在「启动过程」和「序列化」里。

实现在 `src/lab/`：`kernel.js` 是进程表和虚拟网络，`shims/` 是 Node 内置模块（`dgram`、`fs`、`child_process` 等）在浏览器里的替身，`proc.worker.js` 是进程入口，`terminal.js` 是终端，`lab.js` 是界面。`ros2/` 里的代码不知道自己跑在浏览器里。

和真机的差别：虚拟网络里只有一台机器；页面切到后台时浏览器会放慢画面刷新。

## 图解：代码结构

- `src/engine.js`：3D 舞台。把场景数据渲染成方块、连线、流动的小点，处理镜头、点击和主题。
- `src/main.js`：导航、右侧详情面板、分步讲解条。
- `src/scenes/*.js`：各场景的数据（节点、分组、连线、步骤），内容都在这里。
- `src/style.css`：界面样式。

新增场景：在 `src/scenes/` 里按现有格式写一个对象，再加到 `src/scenes/index.js` 的 `sections` 里。

## 能跑的 ROS 2

`ros2/` 目录是一套真正能用的 ROS 2：节点是独立进程，互相自动发现，通过 UDP 点对点收发消息，没有中心节点。不用安装任何依赖（在 Node.js 24 上测试过）。

### 试一下

先把 `ros2` 命令装到全局（只需一次）：

```powershell
npm link
```

然后开几个终端，分别运行：

```powershell
ros2 run demo_nodes talker
```

```powershell
ros2 run demo_nodes listener
```

```powershell
ros2 topic echo /chatter
```

不想装全局命令的话，把 `ros2` 换成 `node ros2/cli/ros2.js` 即可。第一次运行时 Windows 防火墙可能会询问是否允许 Node.js 联网，同一台机器上的节点不受它影响；要跨机器通信需要允许。

更多可以试的：

| 想看什么 | 命令 |
| --- | --- |
| 计算图 | `ros2 node list`、`ros2 node info /talker`、`ros2 topic list -t`、`ros2 topic info -v /chatter`、`ros2 topic hz /chatter` |
| 服务 | `ros2 run demo_nodes add_two_ints_server`，然后 `ros2 service call /add_two_ints "{a: 40, b: 2}"` |
| 参数 | `ros2 param list /talker`、`ros2 param set /talker greeting 你好`、`ros2 param dump /talker` |
| 动作 | `ros2 run demo_nodes fibonacci_action_server`，然后 `ros2 action send_goal -f /fibonacci example_interfaces/action/Fibonacci "{order: 8}"` |
| 小乌龟 | `ros2 run turtlesim turtlesim_node`，另开终端 `ros2 run turtlesim turtle_teleop_key`，再开一个 `ros2 topic echo /turtle1/pose` |
| 一次启动多个节点 | `ros2 launch demo_nodes/talker_listener.launch.js` |
| 改名、重映射、参数初值 | `ros2 run demo_nodes talker --ros-args -r __node:=bob -r chatter:=/news -p period_ms:=200` |
| 接口定义 | `ros2 interface list`、`ros2 interface show geometry_msgs/msg/Twist` |
| 环境 | `ros2 doctor` |

环境变量和 ROS 2 同名：`ROS_DOMAIN_ID`（不同域号互相看不见）、`ROS_LOCALHOST_ONLY=1`（只在本机通信）、`ROS_STATIC_PEERS`（多播不通时手动指定对方的 IP）、`ROS_PACKAGE_PATH`（额外的包目录）。

### 写一个节点

在 `ros2/packages/<包名>/` 下新建一个 `.js` 文件，它就是一个可执行文件，用 `ros2 run <包名> <文件名>` 运行。

```js
import * as rcl from '#rcljs';

await rcl.init();
const node = new rcl.Node('my_node');

const pub = node.createPublisher('std_msgs/msg/String', 'chatter', 10);
node.createSubscription('std_msgs/msg/String', 'chatter', msg => node.getLogger().info(msg.data), 10);
node.createTimer(1000, () => pub.publish({ data: 'hello' }));

node.createService('example_interfaces/srv/AddTwoInts', 'add', (req, res) => { res.sum = req.a + req.b; return res; });
const rate = node.declareParameter('rate', 10);

await rcl.spin(node);
```

自定义接口放在包目录的 `msg/`、`srv/`、`action/` 里，写法和 ROS 2 的 `.msg` 文件一样，不需要编译（参考 `ros2/packages/turtlesim/`）。

### 分层

和 ROS 2 一样，每层只依赖下一层：

| 目录 | 对应 ROS 2 的 | 做什么 |
| --- | --- | --- |
| `ros2/packages/` | 应用层 | 示例包：`demo_nodes`、`turtlesim` |
| `ros2/cli/` | ros2cli、launch | `ros2` 命令行，自己也是一个隐藏节点 |
| `ros2/rcljs/` | rclcpp / rclpy | 写节点时导入的客户端库 |
| `ros2/rcl/` | rcl、rcl_action | 节点、名字解析与重映射、参数、日志、动作、执行器与回调组 |
| `ros2/rosidl/`、`ros2/interfaces/` | rosidl、common_interfaces | 解析 `.msg / .srv / .action`，CDR 序列化 |
| `ros2/rmw/` | rmw + rmw 实现 | 中间件抽象接口；名字改写（`/chatter` → `rt/chatter`）、用两个话题拼出服务、还原计算图 |
| `ros2/dds/` | DDS（如 Fast DDS） | 无中心发现、QoS 匹配、心跳 + 应答的可靠传输、大消息分片 |

几个和真实 ROS 2 做法一致的地方：消息体是标准的 CDR 字节布局；发现端口按 `7400 + 250 × 域号` 计算；服务是一对请求 / 应答话题；动作是 3 个服务加 2 个话题；参数通过 `/节点名/get_parameters` 等服务读写；日志发布到 `/rosout`；不 `spin` 回调就不会执行。

### 和真实 ROS 2 的差别

- **不能和真实的 ROS 2 节点互通。** 消息体格式一致，但发现和传输的线上协议是自己定的，不是 RTPS。
- QoS 只实现了可靠性（reliable / best_effort）、持久性（volatile / transient_local）和历史深度；deadline、lifespan、liveliness 没有。
- 没有做：生命周期节点、组件容器、进程内零拷贝、仿真时间、安全加密（SROS 2）、`ros2 bag`、tf2。
- 接口在运行时解析，不生成代码；不支持 `wstring`。
- 一个进程里的读者写者总数受单个 UDP 包大小限制（大约三百个）。

### 测试

```powershell
npm test
```

15 项测试在同一个进程里开两个独立的上下文，经过真实的 UDP 发现和传输，覆盖：CDR 字节布局、30% 丢包下可靠传输不丢不乱、2 MB 消息分片、QoS 匹配与历史补发、服务、参数、动作（反馈 / 取消）、执行器、节点下线感知。
