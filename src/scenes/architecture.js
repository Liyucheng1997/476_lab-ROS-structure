import { N, E, G } from './util.js';

/* ============ 总览：ROS 1 与 ROS 2 逐项对照 ============ */
const rows = [
  ['build', '构建系统', 'catkin', 'catkin_make / catkin build', 'colcon + ament', 'ament_cmake / ament_python',
    '<p>catkin 是一套 CMake 宏加 Python 脚本，<code>catkin_make</code> 把整个工作空间当成<b>一个</b> CMake 工程来构建。</p><p>它只支持 CMake 包，Python 包也得写 CMakeLists.txt。</p>',
    '<p>ROS 2 把「构建工具」和「构建系统」拆开了：</p><ul><li><b>colcon</b> 负责找包、排依赖顺序、逐个调用构建；</li><li><b>ament_cmake / ament_python</b> 是每个包自己用的构建系统。</li></ul><p>每个包独立构建，纯 Python 包直接走 setuptools，不需要 CMake。</p>'],
  ['mw', '通信中间件', 'TCPROS / UDPROS', 'ROS 自己实现的协议', 'DDS / RTPS', '通过 rmw 接口接入，可替换',
    '<p>ROS 1 自己定义了传输协议：消息默认走 TCP 长连接（TCPROS），也可以选 UDP（UDPROS）。</p><p>没有服务质量配置，只有队列长度和 <code>latch</code> 等少量选项。</p>',
    '<p>ROS 2 不再自己造传输层，而是用工业标准 <b>DDS</b>（线上协议叫 RTPS，默认走 UDP）。</p><p>中间隔着一层 <b>rmw</b> 抽象接口，所以 Fast DDS、Cyclone DDS、Connext、Zenoh 可以互换，用环境变量 <code>RMW_IMPLEMENTATION</code> 选择。</p>'],
  ['disc', '节点发现', 'ROS Master', '中心化，必须先开 roscore', '分布式自动发现', '没有中心节点',
    '<p>所有节点启动后都要向 <b>Master</b> 登记自己发布、订阅了什么。Master 像电话簿，负责介绍双方认识。</p><p>Master 不转发数据，但它一挂，新节点就没法互相找到了，是单点故障。</p>',
    '<p>节点启动时通过 UDP 多播喊一声「我在这」，同一个 <code>ROS_DOMAIN_ID</code> 里的其他节点听到后直接交换信息。</p><p>不需要 roscore，任何一个节点退出都不影响别人。</p>'],
  ['rcl', '客户端库', 'roscpp / rospy', '两套各自独立的实现', 'rclcpp / rclpy', '共用同一个 C 核心 rcl',
    '<p>roscpp（C++）和 rospy（Python）是两套完全独立写出来的库，功能和行为有细微差别，新增功能要写两遍。</p>',
    '<p>所有语言的库都是薄薄的一层，底下共用 C 语言写的 <b>rcl</b>。行为一致，支持新语言也更容易（Rust、Node.js、Java 等都有社区实现）。</p>'],
  ['param', '参数', '全局参数服务器', '集成在 Master 里', '节点自己的参数', '每个节点自带参数服务',
    '<p>参数存在 Master 里的一棵全局字典树上，任何节点都能读写任何参数，没有类型约束，也收不到变更通知（需要 dynamic_reconfigure）。</p>',
    '<p>参数属于节点自己，必须先声明才能用，带类型和范围描述。修改时节点可以通过回调拒绝；变更会发布到 <code>/parameter_events</code>。</p>'],
  ['launch', '启动系统', 'roslaunch', 'XML 文件', 'launch', 'Python / XML / YAML',
    '<p><code>.launch</code> 是 XML 文件，一次启动多个节点、设置参数和重映射。它会自动拉起 roscore。</p>',
    '<p>启动文件可以用 Python 写（最灵活，能写条件和事件处理），也可以用 XML 或 YAML。支持生命周期节点的状态切换、组件加载等。</p>'],
  ['node', '节点模型', '一个进程一个节点', 'nodelet 是后补的方案', '组件 + 生命周期', '一个进程可装多个节点',
    '<p>通常一个可执行文件就是一个节点。想在同进程内零拷贝传数据要改用 nodelet，写法和普通节点不一样。</p>',
    '<p>节点写成类，可以编译成<b>组件</b>动态加载进同一个进程，进程内通信免序列化。</p><p><b>生命周期节点</b>有「未配置 → 未激活 → 激活 → 结束」的状态机，方便有序启动整套系统。</p>'],
  ['rt', '平台与可靠性', 'Linux（Ubuntu）为主', '无实时与安全机制', 'Linux / Windows / macOS / RTOS', 'QoS、实时、SROS 2 加密',
    '<p>官方只完整支持 Ubuntu。设计时假设网络可靠、单机器人、实验室环境，没有加密和认证。</p><p>最后一个版本 Noetic 已于 2025 年 5 月停止维护。</p>',
    '<p>面向产品化设计：多平台、多机器人、不可靠网络。</p><ul><li><b>QoS</b>：可靠 / 尽力而为、历史深度、持久性、截止时间等；</li><li><b>实时</b>：可配合实时内核与自定义内存分配；</li><li><b>SROS 2</b>：基于 DDS-Security 的认证、加密、访问控制。</li></ul>'],
];

const overview = {
  id: 'overview', nav: '总览对照', title: 'ROS 1 与 ROS 2 总览对照',
  subtitle: '同一件事，两代系统分别怎么做',
  intro: `<p><b>ROS</b>（Robot Operating System）不是真正的操作系统，而是跑在 Linux 等系统之上的<b>机器人软件框架</b>：它提供进程间通信、构建工具、常用库和调试工具。</p>
<p>ROS 1 诞生于 2007 年，面向实验室里的单台机器人。ROS 2 从 2014 年开始重新设计，目标是能用在产品上：多机器人、不稳定网络、实时控制、安全加密。</p>
<p>左列是 ROS 1，右列是 ROS 2，中间的标签是对比的维度。</p>`,
  groups: [G('ROS 1（最后一版 Noetic）', -4.3, -0.42, 5.4, 10.6), G('ROS 2（Humble / Jazzy 等）', 4.3, -0.42, 5.4, 10.6)],
  nodes: rows.flatMap(([id, , l, ls, r, rs, ld, rd], i) => {
    const y = 3.7 - i * 1.2;
    return [
      N(`l_${id}`, l, -4.3, y, { w: 4.6, sub: ls, d: ld }),
      N(`r_${id}`, r, 4.3, y, { w: 4.6, sub: rs, d: rd }),
    ];
  }),
  edges: rows.map(([id, aspect]) => E(`l_${id}`, `r_${id}`, { label: aspect, flow: true })),
};

/* ============ ROS 1 架构 ============ */
const ros1 = {
  id: 'ros1-arch', nav: 'ROS 1 架构', title: 'ROS 1 架构：以 Master 为中心',
  subtitle: '节点 → 客户端库 → 自研传输协议，所有节点都向 Master 登记',
  intro: `<p>ROS 1 可以从上到下分成五层。最关键的是 <b>roscore</b> 这一层：它启动 Master、参数服务器和 rosout 三样东西，任何 ROS 1 程序运行前都必须先有它。</p>
<p>节点之间的数据是<b>点对点直连</b>的，Master 只负责登记和介绍，不经手数据。</p>`,
  groups: [
    G('应用层：节点', 0, 3.4, 13.4, 1.9), G('客户端库', 0, 1.3, 13.4, 1.9), G('通信层', 0, -0.8, 13.4, 1.9),
    G('roscore', 0, -2.9, 13.4, 1.9), G('操作系统', 0, -5.0, 13.4, 1.9),
  ],
  nodes: [
    N('a1', '相机驱动节点', -4.2, 3.25, { w: 3.4, sub: '发布 /image_raw', d: '<p>节点（Node）是 ROS 里最小的运行单位，就是一个普通进程。</p><p>这个节点读取相机，把图像发布到话题 <code>/image_raw</code>。它不知道也不关心谁在订阅。</p>' }),
    N('a2', '目标检测节点', 0, 3.25, { w: 3.4, sub: '订阅图像，发布检测结果', d: '<p>订阅 <code>/image_raw</code>，处理后把结果发布到另一个话题。</p><p>节点之间只通过话题名和消息类型耦合，可以用不同语言写、跑在不同机器上。</p>' }),
    N('a3', '运动控制节点', 4.2, 3.25, { w: 3.4, sub: '发布 /cmd_vel', d: '<p>根据检测结果计算速度指令，发布到 <code>/cmd_vel</code>，底盘驱动节点订阅它来驱动电机。</p>' }),
    N('roscpp', 'roscpp', -4.2, 1.15, { w: 3.4, sub: 'C++ 客户端库', d: '<p>ROS 1 的 C++ 库，性能最好，功能最全。核心概念：</p><ul><li><code>ros::NodeHandle</code>：创建发布者、订阅者、服务；</li><li><code>ros::spin()</code>：进入回调循环；</li><li>回调队列 + spinner 线程处理到达的消息。</li></ul>', code: 'ros::init(argc, argv, "talker");\nros::NodeHandle nh;\nauto pub = nh.advertise<std_msgs::String>("chatter", 10);\nros::spin();' }),
    N('rospy', 'rospy', 0, 1.15, { w: 3.4, sub: 'Python 客户端库', d: '<p>纯 Python 实现，和 roscpp 没有共用代码。写起来快，适合原型、脚本和上层逻辑。</p><p>每个订阅在独立线程里收数据，受 GIL 限制，不适合高频大数据。</p>', code: 'rospy.init_node("listener")\nrospy.Subscriber("chatter", String, callback)\nrospy.spin()' }),
    N('roslisp', '其他语言', 4.2, 1.15, { w: 3.4, sub: 'roslisp、rosjava、roslibjs…', kind: 'muted', d: '<p>其他语言各自重新实现了一遍协议，功能完整度参差不齐。这是 ROS 2 改成「共用 rcl 核心」的原因之一。</p>' }),
    N('xmlrpc', 'XML-RPC', -4.2, -0.95, { w: 3.4, sub: '登记与协商（控制通道）', d: '<p>基于 HTTP 的远程调用协议。ROS 1 用它做所有「控制面」的事：</p><ul><li>节点 → Master：登记发布者、订阅者、服务；</li><li>节点 → 节点：订阅者向发布者询问数据通道地址。</li></ul><p>每个节点内部都跑着一个小的 XML-RPC 服务器。</p>' }),
    N('tcpros', 'TCPROS', 0, -0.95, { w: 3.4, sub: '默认数据通道（TCP 长连接）', d: '<p>真正传消息的协议。建立 TCP 连接后先交换一个「连接头」（话题名、消息类型、MD5 校验值），之后就是一帧一帧的数据：4 字节长度 + 序列化后的消息体。</p><p>可靠、有序，但网络差时会因重传而卡顿。</p>' }),
    N('udpros', 'UDPROS', 4.2, -0.95, { w: 3.4, sub: '可选：低延迟，允许丢包', kind: 'muted', d: '<p>基于 UDP 的传输，适合遥操作这类「宁可丢也不要迟到」的数据。只有 roscpp 支持，用得很少。</p>', code: 'nh.subscribe("chatter", 10, cb,\n  ros::TransportHints().udp());' }),
    N('master', 'ROS Master', -4.2, -3.05, { w: 3.4, sub: '名字服务，默认端口 11311', kind: 'accent', d: '<p>整个系统的「电话簿」。记录每个话题有哪些发布者和订阅者、每个服务由谁提供。</p><p>节点通过环境变量 <code>ROS_MASTER_URI</code> 找到它。多机通信时所有机器都要指向同一个 Master。</p><p>它<b>不转发消息</b>：介绍完双方后，数据走节点间的直连。</p>', code: 'export ROS_MASTER_URI=http://192.168.1.10:11311\nexport ROS_IP=192.168.1.20' }),
    N('paramsrv', '参数服务器', 0, -3.05, { w: 3.4, sub: '全局共享的配置字典', d: '<p>运行在 Master 进程内的一棵字典树，同样通过 XML-RPC 访问。适合存启动时读一次的配置，不适合高频读写。</p>', code: 'rosparam set /camera/fps 30\nrosparam get /camera/fps' }),
    N('rosout', 'rosout', 4.2, -3.05, { w: 3.4, sub: '日志汇总节点', d: '<p>所有节点的 <code>ROS_INFO</code> 等日志都会发布到 <code>/rosout</code> 话题，rosout 节点把它们汇总到 <code>/rosout_agg</code> 并写入日志文件，供 rqt_console 查看。</p>' }),
    N('os', 'Ubuntu Linux', 0, -5.15, { w: 11.8, sub: '进程、线程、TCP/IP 协议栈、文件系统', kind: 'muted', d: '<p>ROS 1 官方只完整支持 Ubuntu，每个 ROS 版本绑定一个 Ubuntu 版本（Noetic 对应 20.04）。</p><p>ROS 本身不管进程调度和硬件驱动，这些都交给 Linux。</p>' }),
  ],
  edges: [
    E('a1', 'a2', { label: '话题', flow: true }), E('a2', 'a3', { label: '话题', flow: true }),
    E('a1', 'roscpp', { flow: false }), E('a2', 'rospy', { flow: false }), E('a3', 'roslisp', { flow: false }),
    E('roscpp', 'xmlrpc', { flow: false }), E('roscpp', 'tcpros', { flow: false }), E('rospy', 'tcpros', { flow: false }),
    E('xmlrpc', 'master', { label: '登记', flow: false }), E('xmlrpc', 'paramsrv', { flow: false }),
  ],
  steps: [
    { title: '应用层：节点', text: '每个功能写成一个独立进程，叫节点。节点之间通过话题名约定来收发消息，互相不直接依赖。', focus: ['a1', 'a2', 'a3'] },
    { title: '客户端库', text: '节点通过客户端库使用 ROS。roscpp 和 rospy 是两套独立实现，这带来了行为不一致的问题。', focus: ['roscpp', 'rospy', 'roslisp'] },
    { title: '通信层', text: 'XML-RPC 负责登记和协商，TCPROS 负责真正传数据。两条通道分工明确。', focus: ['xmlrpc', 'tcpros', 'udpros'] },
    { title: 'roscore', text: '运行 <code>roscore</code> 会同时启动 Master、参数服务器和 rosout。没有它，节点启动时会一直等待。', focus: ['master', 'paramsrv', 'rosout'] },
    { title: '操作系统', text: 'ROS 1 构建在 Ubuntu 之上，进程调度、网络、驱动都由 Linux 提供。', focus: ['os'] },
  ],
};

/* ============ ROS 2 架构 ============ */
const ros2 = {
  id: 'ros2-arch', nav: 'ROS 2 架构', title: 'ROS 2 架构：分层与可替换的中间件',
  subtitle: '用户代码 → 语言库 → rcl → rmw → DDS，每层只依赖下一层的接口',
  intro: `<p>ROS 2 最重要的设计是<b>分层</b>。越往上越贴近用户，越往下越贴近网络。</p>
<p>中间的 <b>rmw</b>（ROS MiddleWare interface）是一条分界线：它上面的代码完全不知道底下用的是哪家 DDS，所以换中间件不用改一行应用代码。</p>
<p>没有 Master，也没有 roscore。</p>`,
  groups: [
    G('应用层', 0, 5.55, 15.6, 1.75), G('客户端库（各语言）', 0, 3.7, 15.6, 1.75), G('rcl：C 语言核心', 0, 1.85, 15.6, 1.75),
    G('rmw：中间件抽象接口', 0, 0, 15.6, 1.75), G('rmw 实现（适配层）', 0, -1.85, 15.6, 1.75),
    G('中间件', 0, -3.7, 15.6, 1.75), G('操作系统', 0, -5.55, 15.6, 1.75),
  ],
  nodes: [
    N('u1', 'C++ 节点', -5, 5.4, { w: 4.2, sub: '继承 rclcpp::Node', d: '<p>ROS 2 推荐把节点写成一个类。发布者、订阅者、定时器都是成员，在构造函数里创建。</p>', code: 'class Talker : public rclcpp::Node {\npublic:\n  Talker() : Node("talker") {\n    pub_ = create_publisher<String>("chatter", 10);\n  }\n};' }),
    N('u2', 'Python 节点', 0, 5.4, { w: 4.2, sub: '继承 rclpy.node.Node', d: '<p>写法和 C++ 版几乎一一对应，因为两者底下是同一个 rcl。</p>', code: 'class Listener(Node):\n    def __init__(self):\n        super().__init__("listener")\n        self.create_subscription(\n            String, "chatter", self.cb, 10)' }),
    N('u3', '组件容器', 5, 5.4, { w: 4.2, sub: '一个进程里装多个节点', d: '<p>把节点编译成动态库（组件），运行时加载进同一个容器进程。同进程内的节点传消息可以直接传指针，省掉序列化和拷贝。</p>', code: 'ros2 run rclcpp_components component_container\nros2 component load /ComponentManager \\\n  my_pkg my_pkg::Talker' }),
    N('rclcpp', 'rclcpp', -5, 3.55, { w: 4.2, sub: 'C++ 库：执行器、回调组、智能指针', d: '<p>在 rcl 之上提供符合 C++ 习惯的接口，并自己实现了<b>执行器</b>（决定哪个回调在哪个线程跑）、进程内通信、组件等。</p>' }),
    N('rclpy', 'rclpy', 0, 3.55, { w: 4.2, sub: 'Python 库：通过 C 扩展调用 rcl', d: '<p>Python 接口。底层通过 pybind11 写的 C 扩展直接调用 rcl，所以和 rclcpp 行为一致。</p>' }),
    N('rclx', '社区语言库', 5, 3.55, { w: 4.2, sub: 'rclrs（Rust）、rclnodejs、rcljava…', kind: 'muted', d: '<p>因为核心逻辑都在 rcl 里，支持一门新语言只需要写一层绑定，不用重新实现协议。</p>' }),
    N('rcl', 'rcl', -5.6, 1.7, { w: 3.2, sub: '节点、话题、服务、定时器', d: '<p>ROS Client Library，用 C 写的公共核心。实现所有语言都需要的逻辑：节点与命名空间、话题名解析与重映射、参数、时间、日志、等待集（wait set）。</p><p>它自己不做网络通信，全部转给 rmw。</p>' }),
    N('rclaction', 'rcl_action', -1.9, 1.7, { w: 3.2, sub: '动作：服务 + 话题的组合', d: '<p>动作（Action）不是 DDS 的原生概念，rcl_action 用 3 个服务和 2 个话题把它拼出来，并管理目标的状态机。</p>' }),
    N('rcllife', 'rcl_lifecycle', 1.9, 1.7, { w: 3.2, sub: '生命周期状态机', d: '<p>实现受管理节点的状态机：未配置 → 未激活 → 激活 → 已结束，以及中间的过渡状态。</p>' }),
    N('rosidl', 'rosidl', 5.6, 1.7, { w: 3.2, sub: '消息类型支持', d: '<p>把 <code>.msg</code> 接口文件变成各语言的数据结构，并提供「类型支持」让中间件知道怎么序列化它们。详见「消息生成」一节。</p>' }),
    N('rmw', 'rmw 接口', 0, -0.15, { w: 14.2, sub: '一组 C 函数声明：rmw_create_publisher、rmw_publish、rmw_take、rmw_wait…', kind: 'accent', d: '<p>rmw 只是一组 C 头文件，规定了「一个中间件必须提供哪些函数」。</p><p>rcl 只调用这些函数。运行时加载哪个实现由环境变量决定：</p>', code: 'export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp\nros2 doctor --report | grep middleware' }),
    N('rf', 'rmw_fastrtps_cpp', -5.6, -2.0, { w: 3.2, sub: '默认实现', d: '<p>把 rmw 接口翻译成 Fast DDS 的调用。多数 ROS 2 版本的默认选择。</p>' }),
    N('rc', 'rmw_cyclonedds_cpp', -1.9, -2.0, { w: 3.2, sub: '轻量、稳定', d: '<p>对接 Eclipse Cyclone DDS。代码量小，很多导航和多机场景偏好用它。</p>' }),
    N('rx', 'rmw_connextdds', 1.9, -2.0, { w: 3.2, sub: '商业 DDS', d: '<p>对接 RTI Connext，商业授权，在航空、军工、医疗领域有认证。</p>' }),
    N('rz', 'rmw_zenoh_cpp', 5.6, -2.0, { w: 3.2, sub: '非 DDS 的新选择', d: '<p>对接 Zenoh。它不是 DDS，用路由器做发现，更适合 Wi-Fi、跨网段和广域网场景。这说明 rmw 抽象的并不只是 DDS。</p>' }),
    N('fast', 'Fast DDS', -5.6, -3.85, { w: 3.2, sub: 'eProsima', d: '<p>开源的 DDS 实现，功能完整，支持共享内存传输和发现服务器。</p>' }),
    N('cyc', 'Cyclone DDS', -1.9, -3.85, { w: 3.2, sub: 'Eclipse', d: '<p>开源 DDS 实现，配合 iceoryx 可以做零拷贝共享内存传输。</p>' }),
    N('conn', 'RTI Connext', 1.9, -3.85, { w: 3.2, sub: 'RTI', d: '<p>历史最久的商业 DDS 产品。</p>' }),
    N('zen', 'Zenoh', 5.6, -3.85, { w: 3.2, sub: 'Eclipse', d: '<p>发布订阅 + 查询的统一协议，线上开销很小。</p>' }),
    N('os2', 'Linux / Windows / macOS / RTOS', 0, -5.7, { w: 14.2, sub: 'UDP、共享内存、线程调度', kind: 'muted', d: '<p>ROS 2 官方支持 Ubuntu、Windows 和 macOS，RHEL 等也有支持。</p><p>在微控制器上可以用 <b>micro-ROS</b>，它跑在 FreeRTOS、Zephyr 等实时系统上，通过代理接入 ROS 2 网络。</p>' }),
  ],
  edges: [
    E('u1', 'rclcpp', { flow: false }), E('u2', 'rclpy', { flow: false }), E('u3', 'rclcpp', { flow: false }),
    E('rclcpp', 'rcl', { flow: false }), E('rclpy', 'rcl', { flow: false }), E('rclx', 'rcl', { flow: false }),
    E('rf', 'fast', { flow: false }), E('rc', 'cyc', { flow: false }), E('rx', 'conn', { flow: false }), E('rz', 'zen', { flow: false }),
  ],
  steps: [
    { title: '应用层', text: '你写的节点。可以是独立进程，也可以作为组件加载进同一个进程。', focus: ['u1', 'u2', 'u3'] },
    { title: '客户端库', text: 'rclcpp、rclpy 把 rcl 包装成各语言习惯的写法，执行器和回调调度也在这一层。', focus: ['rclcpp', 'rclpy', 'rclx'] },
    { title: 'rcl：C 语言核心', text: '所有语言共用的逻辑都在这里，保证不同语言写的节点行为一致。', focus: ['rcl', 'rclaction', 'rcllife', 'rosidl'] },
    { title: 'rmw：中间件抽象接口', text: '一组 C 函数声明。它上面的所有代码都不知道底下是哪家中间件。', focus: ['rmw'] },
    { title: 'rmw 实现', text: '每个中间件厂商提供一个适配包，把 rmw 函数翻译成自家 API。', focus: ['rf', 'rc', 'rx', 'rz'] },
    { title: '中间件', text: '真正负责发现、序列化后的数据传输、QoS 和可靠性。', focus: ['fast', 'cyc', 'conn', 'zen'] },
    { title: '操作系统', text: '跨平台，小到微控制器上的实时系统也能接入。', focus: ['os2'] },
  ],
};

export default [overview, ros1, ros2];
