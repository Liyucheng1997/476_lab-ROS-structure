import { N, E, G } from './util.js';

/* ============ 主要库 ============ */
const L = (id, label, col, row, sub, d, code) =>
  N(id, label, -7.2 + col * 4.8, 3.3 - row * 3.1 + (col % 2 ? -0.0 : 0), { w: 4.2, h: 1.15, z: 0, sub, d, code });

const libs = {
  id: 'libs', nav: '主要库与工具', title: '主要库与工具：ROS 1 → ROS 2',
  subtitle: '每个方块是一类能力，副标题是两代各自的名字',
  intro: `<p>ROS 的价值很大一部分在于现成的库。大多数库在 ROS 2 里都有对应的新版本，名字常常只是加了个「2」。</p>
<p>三行分别是：</p>
<ul><li><b>基础</b>：写任何节点都会用到；</li><li><b>机器人能力</b>：导航、机械臂、控制、感知；</li><li><b>工具</b>：看数据、录数据、启动系统、调试。</li></ul>`,
  groups: [G('基础', 0, 3.45, 19.6, 2.3), G('机器人能力', 0, 0.35, 19.6, 2.3), G('工具', 0, -2.75, 19.6, 2.3)],
  nodes: [
    L('l_client', '客户端库', 0, 0, 'roscpp / rospy → rclcpp / rclpy',
      '<p>写节点用的库。</p><table><tr><th></th><th>ROS 1</th><th>ROS 2</th></tr><tr><td>C++</td><td>roscpp</td><td>rclcpp</td></tr><tr><td>Python</td><td>rospy</td><td>rclpy</td></tr><tr><td>头文件</td><td><code>ros/ros.h</code></td><td><code>rclcpp/rclcpp.hpp</code></td></tr><tr><td>日志</td><td><code>ROS_INFO</code></td><td><code>RCLCPP_INFO</code></td></tr></table><p>ROS 2 还多了 <code>rclcpp_action</code>、<code>rclcpp_lifecycle</code>、<code>rclcpp_components</code>。</p>'),
    L('l_msgs', '标准消息', 1, 0, 'std_msgs、sensor_msgs、geometry_msgs…',
      '<p>大家约定好的通用数据类型，用它们才能和现成的工具、算法对接。</p><ul><li><b>std_msgs</b>：基本类型和 Header；</li><li><b>geometry_msgs</b>：点、位姿、速度（Twist）；</li><li><b>sensor_msgs</b>：图像、激光、点云、IMU；</li><li><b>nav_msgs</b>：里程计、地图、路径。</li></ul><p>ROS 2 里它们合称 <code>common_interfaces</code>，使用时多一层命名空间。</p>',
      '// ROS 1\n#include <geometry_msgs/Twist.h>\ngeometry_msgs::Twist cmd;\n\n// ROS 2\n#include <geometry_msgs/msg/twist.hpp>\ngeometry_msgs::msg::Twist cmd;'),
    L('l_tf', '坐标变换', 2, 0, 'tf / tf2 → tf2_ros',
      '<p>机器人上有很多坐标系：地图、底盘、相机、夹爪……<b>tf2</b> 维护一棵随时间变化的坐标系树，可以问「某时刻 A 坐标系里的点在 B 坐标系里是多少」。</p><p>变换通过 <code>/tf</code>（动态）和 <code>/tf_static</code>（静态）两个话题广播。ROS 1 早期的 <code>tf</code> 已被 tf2 取代。</p>',
      'auto t = tf_buffer->lookupTransform(\n  "map", "base_link", tf2::TimePointZero);\n\n# 命令行查看\nros2 run tf2_ros tf2_echo map base_link\nros2 run tf2_tools view_frames'),
    L('l_urdf', '机器人建模', 3, 0, 'URDF / xacro、robot_state_publisher',
      '<p><b>URDF</b> 用 XML 描述机器人的连杆、关节、外形和惯量。<b>xacro</b> 是带宏和变量的 URDF，避免重复。</p><p><code>robot_state_publisher</code> 读取 URDF 和关节角度，算出每个连杆的位姿并发布成 tf。两代用法基本一致。</p>',
      '<link name="base_link">\n  <visual>\n    <geometry><box size="0.4 0.3 0.1"/></geometry>\n  </visual>\n</link>\n<joint name="wheel_joint" type="continuous">\n  <parent link="base_link"/>\n  <child link="wheel"/>\n  <axis xyz="0 1 0"/>\n</joint>'),

    L('l_nav', '导航', 0, 1, 'navigation（move_base）→ Nav2',
      '<p>让移动机器人从 A 点自己走到 B 点：定位、全局规划、局部避障、恢复行为。</p><ul><li><b>ROS 1</b>：navigation 栈，核心是 <code>move_base</code> 一个大节点，定位用 amcl，建图常用 gmapping、cartographer；</li><li><b>ROS 2</b>：<b>Nav2</b>，拆成多个生命周期节点，用<b>行为树</b>编排任务，规划器和控制器都是插件。建图常用 slam_toolbox。</li></ul>'),
    L('l_moveit', '机械臂规划', 1, 1, 'MoveIt → MoveIt 2',
      '<p>机械臂运动规划框架：逆运动学、碰撞检测、轨迹规划（OMPL 等）、抓取。</p><p>MoveIt 2 是它在 ROS 2 上的移植，增加了实时伺服（MoveIt Servo）等能力。</p>'),
    L('l_control', '硬件控制', 2, 1, 'ros_control → ros2_control',
      '<p>在控制算法和真实硬件之间做抽象。</p><ul><li><b>硬件接口</b>：读编码器、写电机指令；</li><li><b>控制器</b>：差速底盘、关节轨迹、力控等，可插拔；</li><li><b>控制器管理器</b>：以固定频率跑「读 → 更新 → 写」的实时循环。</li></ul><p>同一套控制器既能驱动真机，也能驱动 Gazebo 里的仿真机器人。</p>'),
    L('l_percep', '感知', 3, 1, 'cv_bridge、image_transport、PCL',
      '<p>把 ROS 消息和主流视觉库接起来：</p><ul><li><b>cv_bridge</b>：<code>sensor_msgs/Image</code> ↔ OpenCV 的 <code>cv::Mat</code>；</li><li><b>image_transport</b>：图像压缩传输；</li><li><b>pcl_ros / pcl_conversions</b>：点云消息 ↔ PCL 点云库；</li><li><b>image_pipeline</b>：标定、去畸变、立体视觉。</li></ul>',
      'cv::Mat img = cv_bridge::toCvShare(msg, "bgr8")->image;'),

    L('l_viz', '可视化与调试', 0, 2, 'RViz、rqt → RViz2、rqt',
      '<p><b>RViz</b>：3D 显示机器人模型、点云、地图、路径、tf。</p><p><b>rqt</b>：一组 Qt 小工具，常用的有：</p><ul><li><code>rqt_graph</code>：节点与话题的连接图；</li><li><code>rqt_plot</code>：数值曲线；</li><li><code>rqt_console</code>：日志；</li><li><code>rqt_reconfigure</code>：在线调参。</li></ul><p>第三方的 Foxglove、PlotJuggler 也很常用。</p>'),
    L('l_sim', '仿真', 1, 2, 'Gazebo Classic → Gazebo（gz sim）',
      '<p>在物理引擎里模拟机器人和传感器，不碰真机就能测试算法。</p><ul><li><b>ROS 1</b>：Gazebo Classic，通过 <code>gazebo_ros</code> 插件连接，已停止维护；</li><li><b>ROS 2</b>：新一代 Gazebo（原名 Ignition），通过 <code>ros_gz_bridge</code> 桥接话题。</li></ul><p>其他选择还有 Webots、Isaac Sim、MuJoCo。</p>'),
    L('l_bag', '数据记录', 2, 2, 'rosbag → rosbag2',
      '<p>把话题上的消息连同时间戳录下来，之后原样回放，用来复现问题和离线调算法。</p><ul><li><b>ROS 1</b>：单个 <code>.bag</code> 文件；</li><li><b>ROS 2</b>：一个目录，存储后端可插拔，新版本默认 <b>MCAP</b>，早期是 SQLite3。</li></ul>',
      '# ROS 1\nrosbag record -a\nrosbag play data.bag\n# ROS 2\nros2 bag record -a\nros2 bag play my_bag/\nros2 bag info my_bag/'),
    L('l_cli', '命令行与启动', 3, 2, 'rosrun、roslaunch… → ros2 <命令>',
      '<p>ROS 1 是一堆独立命令，ROS 2 统一成 <code>ros2</code> 一个入口。</p><table><tr><th>ROS 1</th><th>ROS 2</th></tr><tr><td><code>roscore</code></td><td>不需要</td></tr><tr><td><code>rosrun</code></td><td><code>ros2 run</code></td></tr><tr><td><code>roslaunch</code></td><td><code>ros2 launch</code></td></tr><tr><td><code>rostopic</code></td><td><code>ros2 topic</code></td></tr><tr><td><code>rosservice</code></td><td><code>ros2 service</code></td></tr><tr><td><code>rosparam</code></td><td><code>ros2 param</code></td></tr><tr><td><code>rosnode</code></td><td><code>ros2 node</code></td></tr><tr><td><code>rosmsg</code></td><td><code>ros2 interface</code></td></tr><tr><td><code>roswtf</code></td><td><code>ros2 doctor</code></td></tr></table><p>迁移期间可以用 <code>ros1_bridge</code> 让两代节点互通。</p>'),
  ],
  edges: [],
};

/* ============ ROS 2 执行器 ============ */
const ring = (i, n = 6, rx = 6.4, ry = 3.3) => {
  const a = Math.PI / 2 - (i / n) * Math.PI * 2;
  return [Math.cos(a) * rx, Math.sin(a) * ry];
};
const R = (i, id, label, sub, d, code) => { const [x, y] = ring(i); return N(id, label, x, y, { w: 3.9, h: 1.05, sub, d, code }); };

const executor = {
  id: 'executor', nav: 'ROS 2 执行器', title: 'ROS 2 实现原理：执行器与回调',
  subtitle: 'spin() 里发生了什么：等待 → 取就绪 → 调回调，循环往复',
  intro: `<p>你写的订阅回调、定时器回调、服务回调，都不是数据一到就被调用的。它们由<b>执行器（Executor）</b>统一调度。</p>
<p><code>rclcpp::spin(node)</code> 就是创建一个单线程执行器并让它一直循环。理解这个循环，才能解释这些常见现象：</p>
<ul><li>一个回调跑得久，其他回调全被卡住；</li><li>在回调里同步等待服务结果会死锁；</li><li>换成多线程执行器后出现数据竞争。</li></ul>`,
  nodes: [
    N('exec', 'Executor', 0, 0, { w: 3.6, h: 1.4, t: 0.5, z: 0.3, sub: '执行器', kind: 'accent', d: '<p>三种常用执行器：</p><ul><li><b>SingleThreadedExecutor</b>：一个线程依次执行所有回调，<code>rclcpp::spin()</code> 默认用它；</li><li><b>MultiThreadedExecutor</b>：线程池，多个回调可以并行，是否并行由回调组决定；</li><li><b>EventsExecutor</b>：事件驱动，不用每轮重建等待集，CPU 占用更低（较新）。</li></ul>', code: 'rclcpp::executors::MultiThreadedExecutor exec;\nexec.add_node(node_a);\nexec.add_node(node_b);\nexec.spin();' }),
    R(0, 'collect', '① 收集实体', '订阅、定时器、服务、客户端', '<p>执行器遍历它管理的所有节点，把其中的订阅、定时器、服务端、客户端、可等待对象（如动作）都找出来。</p><p>ROS 1 的做法不同：每个订阅有自己的接收线程，消息先进<b>回调队列</b>，spin 只是清空队列。</p>'),
    R(1, 'waitset', '② 填入等待集', 'wait set', '<p>等待集是 rcl 提供的结构，相当于一张清单：「这些东西里只要有一个就绪，就叫醒我」。类似操作系统的 <code>select / epoll</code>。</p>'),
    R(2, 'wait', '③ 阻塞等待', 'rcl_wait → rmw_wait', '<p>线程在这里睡眠，不占 CPU。调用一路向下：<code>rcl_wait()</code> → <code>rmw_wait()</code> → DDS 的 WaitSet。</p><p>DDS 收到数据或定时器到期时把线程唤醒。</p>'),
    R(3, 'ready', '④ 取出就绪项', '定时器 → 订阅 → 服务 → 客户端', '<p>醒来后检查哪些实体就绪了，按<b>固定的类型顺序</b>挑一个执行：定时器优先，然后是订阅、服务、客户端。</p><p>这不是按到达时间排的，所以高负载下某些类型的回调可能一直排在后面。</p>'),
    R(4, 'group', '⑤ 检查回调组', '互斥 / 可重入', '<p>每个回调属于一个<b>回调组</b>：</p><ul><li><b>MutuallyExclusive（互斥）</b>：同组回调同一时刻只跑一个，默认就是这种；</li><li><b>Reentrant（可重入）</b>：同组回调可以并行。</li></ul><p>只有多线程执行器下这个区别才有意义。</p>', 'auto group = create_callback_group(\n  rclcpp::CallbackGroupType::Reentrant);\nrclcpp::SubscriptionOptions opt;\nopt.callback_group = group;\nsub_ = create_subscription<Msg>("topic", 10, cb, opt);'),
    R(5, 'run', '⑥ 取数据并执行回调', 'rmw_take → 反序列化 → 你的函数', '<p>到这一步才真正把数据从 DDS 的队列里<b>取出来</b>（<code>rcl_take</code>），反序列化成消息对象，然后调用你写的回调。</p><p>所以消息在被处理前一直存在 DDS 的历史队列里，队列深度由 QoS 的 <code>depth</code> 决定，满了就丢旧的。</p>'),
    N('dds', 'DDS 数据到达', 9.6, -4.4, { w: 3.4, sub: '或定时器到期', kind: 'muted', d: '<p>网络线程由 DDS 自己管理。数据到达后放进 DataReader 的队列，并触发条件变量唤醒正在等待的执行器线程。</p>' }),
    N('spin', 'rclcpp::spin(node)', -9.6, 4.4, { w: 3.8, kind: 'file', d: '<p>最常见的入口，等价于创建单线程执行器、加入节点、调用 <code>spin()</code>。</p><p>还有 <code>spin_some()</code>（处理完当前就绪的就返回）和 <code>spin_until_future_complete()</code>（等到某个异步结果完成）。</p>', code: 'int main(int argc, char** argv) {\n  rclcpp::init(argc, argv);\n  rclcpp::spin(std::make_shared<MyNode>());\n  rclcpp::shutdown();\n}' }),
  ],
  edges: [
    E('collect', 'waitset', { flow: true, bend: [1.0, 0.9, 0] }), E('waitset', 'wait', { flow: true, bend: [1.2, 0, 0] }),
    E('wait', 'ready', { flow: true, bend: [1.0, -0.9, 0] }), E('ready', 'group', { flow: true, bend: [-1.0, -0.9, 0] }),
    E('group', 'run', { flow: true, bend: [-1.2, 0, 0] }), E('run', 'collect', { flow: true, bend: [-1.0, 0.9, 0] }),
    E('spin', 'collect', { label: '启动循环', flow: false, dashed: true }),
    E('dds', 'wait', { label: '唤醒', flow: true, dashed: true }),
  ],
  steps: [
    { title: '① 收集实体', text: '每一轮开始，执行器先弄清楚自己要照看哪些订阅、定时器、服务和客户端。', focus: ['spin', 'exec', 'collect'], edges: ['spin>collect'] },
    { title: '② 填入等待集', text: '把这些实体登记到等待集里，告诉底层「它们任何一个就绪都要通知我」。', focus: ['exec', 'collect', 'waitset'], edges: ['collect>waitset'] },
    { title: '③ 阻塞等待', text: '线程进入睡眠，直到 DDS 收到数据或某个定时器到期。', focus: ['exec', 'waitset', 'wait', 'dds'], edges: ['waitset>wait', 'dds>wait'] },
    { title: '④ 取出就绪项', text: '被唤醒后按固定的类型顺序选出下一个要执行的回调：定时器优先。', focus: ['exec', 'wait', 'ready'], edges: ['wait>ready'] },
    { title: '⑤ 检查回调组', text: '如果它所在的互斥回调组里已有回调在运行，就先跳过，保证同组回调不并发。', focus: ['exec', 'ready', 'group'], edges: ['ready>group'] },
    { title: '⑥ 取数据并执行回调', text: '从中间件取出消息、反序列化、调用你的函数。回调返回后回到第 ① 步。回调跑多久，这个线程就被占多久。', focus: ['exec', 'group', 'run', 'collect'], edges: ['group>run', 'run>collect'] },
  ],
};

/* ============ 消息生成 ============ */
const rosidl = {
  id: 'rosidl', nav: '消息生成与序列化', title: '实现原理：从 .msg 文件到网络上的字节',
  subtitle: '接口定义 → 代码生成 → 序列化。上面是 ROS 2，下面是 ROS 1',
  intro: `<p>你只写了一个几行的 <code>.msg</code> 文件，却能在 C++ 和 Python 里直接用对应的类，还能跨机器传输。中间发生了两件事：</p>
<ul><li><b>构建时</b>：代码生成器把接口定义翻译成各语言的数据结构；</li><li><b>运行时</b>：把内存里的对象<b>序列化</b>成字节流发出去，对方再反序列化。</li></ul>
<p>两代的主要区别：ROS 1 用自己的序列化格式并靠 MD5 校验类型一致；ROS 2 先转成标准的 IDL，序列化交给 DDS 的 CDR 格式。</p>`,
  groups: [G('ROS 2 · rosidl', 0, 2.2, 21.4, 3.0), G('ROS 1 · genmsg', 0, -2.4, 21.4, 3.0)],
  nodes: [
    N('m2', '.msg / .srv / .action', -8.4, 2.0, { w: 3.6, kind: 'file', sub: '接口定义', d: '<p>ROS 2 的接口语法在 ROS 1 基础上加了默认值、有界数组、有界字符串。</p>', code: '# Detection.msg\nstd_msgs/Header header\nstring<=32 label           # 最长 32 的字符串\nfloat32 confidence 0.0     # 默认值\nfloat32[<=10] scores       # 最多 10 个元素\nuint8 STATUS_OK=0          # 常量' }),
    N('ad', 'rosidl_adapter', -4.2, 2.0, { w: 3.6, sub: '转换成标准 IDL', d: '<p>ROS 2 内部统一用 OMG 的 <b>IDL</b>（接口定义语言）作为中间格式，这是 DDS 的标准。<code>.msg</code> 只是为了兼容 ROS 1 习惯而保留的简写，也可以直接写 <code>.idl</code>。</p>' }),
    N('idl', '.idl', 0, 2.0, { w: 3.6, kind: 'file', sub: '中间表示', d: '<p>转换结果。服务会展开成 Request / Response 两个结构体，动作会展开成目标、结果、反馈以及配套的服务消息。</p>', code: 'module my_interfaces { module msg {\n  struct Detection {\n    std_msgs::msg::Header header;\n    string<32> label;\n    @default (value=0.0)\n    float confidence;\n    sequence<float, 10> scores;\n  };\n}; };' }),
    N('gen2', '代码生成器', 4.2, 2.0, { w: 3.6, sub: 'rosidl_generator_c / cpp / py', d: '<p>每种语言一个生成器，都是基于模板（EmPy）的 Python 脚本：</p><ul><li><b>rosidl_generator_c</b>：C 结构体；</li><li><b>rosidl_generator_cpp</b>：C++ 结构体模板；</li><li><b>rosidl_generator_py</b>：Python 类，底层用 C 扩展访问 C 结构体。</li></ul><p>由 CMake 里的 <code>rosidl_generate_interfaces()</code> 触发。</p>', code: '#include "my_interfaces/msg/detection.hpp"\nmy_interfaces::msg::Detection d;\n\nfrom my_interfaces.msg import Detection' }),
    N('ts', '类型支持', 8.4, 2.0, { w: 3.6, sub: 'typesupport', kind: 'accent', d: '<p>ROS 2 特有的一层。中间件拿到一个消息对象，怎么知道它有哪些字段、怎么序列化？答案就是<b>类型支持</b>，有两种：</p><ul><li><b>静态</b>（如 <code>rosidl_typesupport_fastrtps_cpp</code>）：为每个消息生成专门的序列化函数，快；</li><li><b>内省</b>（<code>rosidl_typesupport_introspection_cpp</code>）：生成字段描述表，运行时按表序列化，通用但慢一些。</li></ul><p>它是 rmw 能支持多种中间件的关键。</p>' }),
    N('cdr', 'CDR 序列化 → RTPS', 8.4, 0.2, { w: 3.6, z: 0.4, sub: '由 DDS 发送', kind: 'muted', d: '<p><b>CDR</b>（Common Data Representation）是 DDS 标准的二进制格式：字段按顺序排列并做<b>字节对齐</b>，开头有标志说明大小端。</p><p>类型一致性靠类型名（较新版本还有类型哈希）在发现阶段检查。</p>' }),

    N('m1', '.msg / .srv', -8.4, -2.6, { w: 3.6, kind: 'file', sub: '接口定义', d: '<p>ROS 1 的接口文件。<code>Header</code>、<code>time</code>、<code>duration</code> 是内置的特殊类型。</p>', code: '# Detection.msg\nHeader header\nstring label\nfloat32 confidence\nfloat32[] scores' }),
    N('genmsg', 'genmsg', -4.2, -2.6, { w: 3.6, sub: '解析并计算 MD5', d: '<p>解析接口文件，并把消息定义的文本（去掉注释，递归展开嵌套类型）做 <b>MD5</b>。</p><p>只要字段名、类型或顺序有任何改动，MD5 就会变。</p>', code: 'rosmsg show my_robot/Detection\nrosmsg md5 my_robot/Detection' }),
    N('gen1', 'gencpp / genpy', 0, -2.6, { w: 3.6, sub: '各语言的生成器', d: '<p>由 CMake 里的 <code>generate_messages()</code> 触发：</p><ul><li><b>gencpp</b>：生成一个纯头文件，放进 <code>devel/include/包名/</code>；</li><li><b>genpy</b>：生成 Python 模块；</li><li>还有 genlisp、gennodejs 等。</li></ul>', code: '#include <my_robot/Detection.h>\nmy_robot::Detection d;\n\nfrom my_robot.msg import Detection' }),
    N('hdr', '消息头文件', 4.2, -2.6, { w: 3.6, kind: 'file', sub: '结构体 + 序列化代码 + MD5', d: '<p>生成的头文件里不只有结构体，还直接包含了：</p><ul><li>序列化 / 反序列化函数（模板特化）；</li><li>类型名和 MD5 字符串；</li><li>完整的消息定义文本。</li></ul><p>所以 ROS 1 不需要单独的「类型支持」层。</p>' }),
    N('ser1', 'ros::serialization', 8.4, -2.6, { w: 3.6, sub: '紧凑排列，小端', d: '<p>ROS 1 的格式非常简单：字段按定义顺序挨个写，小端字节序，<b>不做对齐</b>；字符串和变长数组前面加 4 字节长度。</p>' }),
    N('tcp', 'TCPROS 帧', 8.4, -4.4, { w: 3.6, z: 0.4, sub: '4 字节长度 + 消息体', kind: 'muted', d: '<p>连接建立时双方在连接头里交换 MD5，不一致就断开并报错。之后每条消息就是「长度 + 字节」。</p>' }),
  ],
  edges: [
    E('m2', 'ad', { flow: true }), E('ad', 'idl', { flow: true }), E('idl', 'gen2', { flow: true }), E('gen2', 'ts', { flow: true }), E('ts', 'cdr', { flow: true }),
    E('m1', 'genmsg', { flow: true }), E('genmsg', 'gen1', { flow: true }), E('gen1', 'hdr', { flow: true }), E('hdr', 'ser1', { flow: true }), E('ser1', 'tcp', { flow: true }),
  ],
  steps: [
    { title: '接口定义', text: '两代都用几乎相同的 <code>.msg</code> 语法描述数据结构，这是所有语言共享的唯一来源。', focus: ['m1', 'm2'], edges: [] },
    { title: 'ROS 1：解析与 MD5', text: 'genmsg 解析定义并算出 MD5，作为这个消息类型的「指纹」。', focus: ['m1', 'genmsg'] },
    { title: 'ROS 1：生成代码', text: 'gencpp 生成的头文件里同时带有结构体、序列化函数和 MD5。', focus: ['genmsg', 'gen1', 'hdr'] },
    { title: 'ROS 1：序列化与传输', text: '字段紧凑排列成字节流，加上 4 字节长度，经 TCPROS 发出。', focus: ['hdr', 'ser1', 'tcp'] },
    { title: 'ROS 2：先转成 IDL', text: 'rosidl_adapter 把 .msg 转成 DDS 标准的 IDL，后面的工具只认 IDL。', focus: ['m2', 'ad', 'idl'] },
    { title: 'ROS 2：生成各语言代码', text: 'C、C++、Python 各有一个生成器，生成的只是数据结构，不含序列化逻辑。', focus: ['idl', 'gen2'] },
    { title: 'ROS 2：类型支持', text: '另外生成一份「类型支持」代码，告诉具体的中间件如何读写这个结构。换中间件只需要换这一层。', focus: ['gen2', 'ts'] },
    { title: 'ROS 2：CDR 序列化', text: '中间件通过类型支持把消息序列化成 CDR 格式，封装进 RTPS 报文发出。', focus: ['ts', 'cdr'] },
  ],
};

export default { libs, executor, rosidl };
