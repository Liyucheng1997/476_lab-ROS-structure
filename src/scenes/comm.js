import { N, E, G } from './util.js';

/* ============ ROS 1 话题建立全过程 ============ */
const ros1Topic = {
  id: 'ros1-topic', nav: 'ROS 1 话题建立', title: 'ROS 1 实现原理：一条话题是怎么连上的',
  subtitle: 'Master 负责介绍，数据由发布者直接发给订阅者',
  intro: `<p>以经典的 talker / listener 为例。两个节点从启动到数据流动，要经过 7 步握手。</p>
<p>注意两种通道：</p>
<ul><li><b>XML-RPC</b>（第 1–5 步）：登记、询问地址，都是一问一答；</li><li><b>TCPROS</b>（第 6–7 步）：真正的数据长连接。</li></ul>
<p>连接建立后 Master 就不再参与，即使关掉 roscore，已连上的话题仍然能继续传数据。</p>`,
  nodes: [
    N('master', 'ROS Master', 0, 3.6, { w: 3.6, h: 1.1, sub: 'XML-RPC 服务器 · 端口 11311', kind: 'accent', d: '<p>Master 内部维护几张表：</p><ul><li>话题 → 发布者列表；</li><li>话题 → 订阅者列表；</li><li>服务 → 提供者地址。</li></ul><p>它提供的主要方法：<code>registerPublisher</code>、<code>registerSubscriber</code>、<code>registerService</code>、<code>lookupService</code>、<code>lookupNode</code>。</p>', code: 'rosnode list     # 问 Master 有哪些节点\nrostopic list    # 问 Master 有哪些话题\nrostopic info /chatter' }),
    N('talker', 'talker', -5.6, -1.2, { w: 3.6, h: 1.4, sub: '发布者 · 话题 /chatter', d: '<p>调用 <code>nh.advertise()</code> 时，roscpp 做三件事：</p><ol><li>打开一个 TCP 监听端口，准备接受订阅者连接；</li><li>启动节点自己的 XML-RPC 服务器；</li><li>向 Master 登记。</li></ol><p><code>publish()</code> 只是把消息序列化后放进每条连接的发送队列，由后台线程发出。</p>', code: 'ros::Publisher pub =\n  nh.advertise<std_msgs::String>("chatter", 10);\n\nstd_msgs::String msg;\nmsg.data = "hello";\npub.publish(msg);' }),
    N('listener', 'listener', 5.6, -1.2, { w: 3.6, h: 1.4, sub: '订阅者 · 话题 /chatter', d: '<p>调用 <code>nh.subscribe()</code> 后向 Master 登记，拿到发布者列表，再逐个去连。</p><p>收到的数据先反序列化，放进<b>回调队列</b>；<code>ros::spin()</code> 所在的线程从队列里取出来执行你的回调函数。</p>', code: 'void cb(const std_msgs::String::ConstPtr& msg) {\n  ROS_INFO("%s", msg->data.c_str());\n}\n\nros::Subscriber sub = nh.subscribe("chatter", 10, cb);\nros::spin();' }),
  ],
  edges: [
    { ...E('talker', 'master', { label: '① registerPublisher', bend: [-1.6, 0.6, 0] }), id: 'e1' },
    { ...E('listener', 'master', { label: '② registerSubscriber', bend: [2.4, 1.2, 0], at: 0.42 }), id: 'e2' },
    { ...E('master', 'listener', { label: '③ 返回发布者地址', bend: [0.5, 0.4, 0], dashed: true }), id: 'e3' },
    { ...E('listener', 'talker', { label: '④ requestTopic（XML-RPC）', bend: [0, 2.6, 0] }), id: 'e4' },
    { ...E('talker', 'listener', { label: '⑤ 返回 TCPROS 地址和端口', bend: [0, 0.9, 0], dashed: true }), id: 'e5' },
    { ...E('listener', 'talker', { label: '⑥ TCP 连接 + 连接头握手', bend: [0, -1.0, 0], bidir: true }), id: 'e6' },
    { ...E('talker', 'listener', { label: '⑦ 消息数据流（TCPROS）', bend: [0, -3.0, 0.8], flow: true }), id: 'e7' },
  ],
  steps: [
    { title: '① 发布者登记', text: 'talker 调用 Master 的 <code>registerPublisher</code>，告诉它「我发布 /chatter，类型是 std_msgs/String，我的 XML-RPC 地址是…」。', focus: ['talker', 'master'], edges: ['e1'] },
    { title: '② 订阅者登记', text: 'listener 调用 <code>registerSubscriber</code>，告诉 Master 自己想订阅 /chatter。', focus: ['listener', 'master'], edges: ['e2'] },
    { title: '③ Master 返回发布者地址', text: 'Master 查表，把 /chatter 现有发布者的 XML-RPC 地址返回。如果发布者后启动，Master 会主动调用订阅者的 <code>publisherUpdate</code> 通知它。', focus: ['listener', 'master'], edges: ['e3'] },
    { title: '④ 订阅者直接询问发布者', text: 'listener 用拿到的地址调用 talker 的 <code>requestTopic</code>，并说明自己支持的传输协议（一般是 TCPROS）。', focus: ['talker', 'listener'], edges: ['e4'] },
    { title: '⑤ 发布者返回数据通道', text: 'talker 回复：用 TCPROS，连我的这个 IP 和这个端口。到这里 XML-RPC 的工作就结束了。', focus: ['talker', 'listener'], edges: ['e5'] },
    { title: '⑥ 建立 TCP 连接并握手', text: '双方交换连接头：话题名、消息类型和 <b>MD5 值</b>。MD5 由消息定义算出，两边不一致就拒绝连接，防止用错误的结构解析数据。', focus: ['talker', 'listener'], edges: ['e6'] },
    { title: '⑦ 数据开始流动', text: '每条消息是「4 字节长度 + 序列化内容」。从这以后不再经过 Master，关掉 roscore 也不影响这条连接。', focus: ['talker', 'listener'], edges: ['e7'] },
  ],
};

/* ============ ROS 2 发现与通信 ============ */
const pInfo = '<p>DDS 里的<b>域参与者</b>，代表一个进程加入了某个域。ROS 2 里通常一个进程（Context）对应一个参与者，进程内所有节点共用它。</p><p>域由 <code>ROS_DOMAIN_ID</code> 决定（默认 0）。不同域用不同的 UDP 端口，所以互相看不见。</p>';
const ros2Disc = {
  id: 'ros2-discovery', nav: 'ROS 2 发现与传输', title: 'ROS 2 实现原理：没有 Master 怎么互相找到',
  subtitle: 'DDS 用 UDP 多播自动发现，匹配 QoS 后直接传数据',
  intro: `<p>ROS 2 的通信由 DDS 完成。DDS 的线上协议叫 <b>RTPS</b>，默认跑在 UDP 上。</p>
<p>发现分两个阶段：</p>
<ul><li><b>SPDP</b>（参与者发现）：往多播地址广播「我是谁、我的地址」；</li><li><b>SEDP</b>（端点发现）：两个参与者一对一交换各自有哪些读者和写者。</li></ul>
<p>话题名、类型、QoS 三者都对得上，才会建立连接。</p>`,
  groups: [G('进程 A', -6.2, -0.5, 4.6, 6.2), G('进程 B', 6.2, -0.5, 4.6, 6.2)],
  nodes: [
    N('mc', '多播组 239.255.0.1', 0, 3.6, { w: 4.2, h: 1.0, sub: '域 0 的发现端口 7400', kind: 'muted', d: '<p>RTPS 规定的默认多播地址。同一局域网、同一个域里的所有参与者都会监听它。</p><p>发现端口 = <code>7400 + 250 × 域号</code>，所以域 0 是 7400，域 1 是 7650。</p><p>有些网络（Wi-Fi、云主机、Docker）不通多播，这时要改用 Fast DDS 的发现服务器，或者换 Zenoh。</p>', code: 'export ROS_DOMAIN_ID=5        # 隔离不同机器人\nexport ROS_LOCALHOST_ONLY=1   # 只在本机通信（旧版本）' }),
    N('ta', 'talker 节点', -6.2, 1.4, { w: 3.6, sub: 'create_publisher("chatter")', d: '<p>ROS 2 的节点在 DDS 里没有直接对应物。创建发布者时，rmw 层会创建一个 DDS 的 DataWriter，话题名会加上前缀变成 <code>rt/chatter</code>。</p>', code: 'pub_ = create_publisher<std_msgs::msg::String>(\n  "chatter", rclcpp::QoS(10).reliable());' }),
    N('pa', 'DomainParticipant', -6.2, -0.4, { w: 3.6, sub: '域参与者', d: pInfo }),
    N('wa', 'DataWriter', -6.2, -2.2, { w: 3.6, sub: '写者 · 带 QoS', d: '<p>负责把序列化后的数据（CDR 格式）发出去，并按 QoS 保留历史数据。</p><p>可靠模式下它会定期发 <b>HEARTBEAT</b> 告诉读者「我已经发到第几号了」。</p>' }),
    N('lb', 'listener 节点', 6.2, 1.4, { w: 3.6, sub: 'create_subscription("chatter")', d: '<p>创建订阅时，rmw 层创建一个 DataReader。数据到达后会唤醒执行器，由执行器调用你的回调。</p>', code: 'sub_ = create_subscription<std_msgs::msg::String>(\n  "chatter", 10,\n  [this](const std_msgs::msg::String& msg) {\n    RCLCPP_INFO(get_logger(), "%s", msg.data.c_str());\n  });' }),
    N('pb', 'DomainParticipant', 6.2, -0.4, { w: 3.6, sub: '域参与者', d: pInfo }),
    N('rb', 'DataReader', 6.2, -2.2, { w: 3.6, sub: '读者 · 带 QoS', d: '<p>接收数据并放入自己的队列。可靠模式下发现序号有缺口时，回复 <b>ACKNACK</b> 请求重发。</p><p><b>QoS 必须兼容</b>才能匹配，最常见的坑：发布者用「尽力而为」，订阅者要求「可靠」，结果连不上且不报错。</p>', code: 'ros2 topic info /chatter --verbose   # 查看两端 QoS' }),
  ],
  edges: [
    E('ta', 'pa', { flow: false }), E('pa', 'wa', { flow: false }), E('lb', 'pb', { flow: false }), E('pb', 'rb', { flow: false }),
    { ...E('pa', 'mc', { label: '① SPDP 多播', bidir: true, flow: 'both', bend: [-1.2, 1.0, 0] }), id: 'spdpA' },
    { ...E('pb', 'mc', { label: '① SPDP 多播', bidir: true, flow: 'both', bend: [1.2, 1.0, 0] }), id: 'spdpB' },
    { ...E('pa', 'pb', { label: '② SEDP：交换读者 / 写者信息（单播）', bidir: true, flow: 'both' }), id: 'sedp' },
    { ...E('wa', 'rb', { label: '④ RTPS 数据（UDP 单播）', flow: true }), id: 'data' },
    { ...E('rb', 'wa', { label: '⑤ ACKNACK 确认 / 请求重发', dashed: true, bend: [0, -2.4, 0], flow: true }), id: 'ack' },
  ],
  steps: [
    { title: '创建 DDS 实体', text: '节点创建发布者或订阅者时，rmw 在底下创建对应的 DataWriter / DataReader，挂在进程的域参与者下。', focus: ['ta', 'pa', 'wa', 'lb', 'pb', 'rb'], edges: ['ta>pa', 'pa>wa', 'lb>pb', 'pb>rb'] },
    { title: '① 参与者发现（SPDP）', text: '每个参与者周期性地往多播地址发一条公告，包含自己的 ID 和单播地址。新来的和先到的都能互相听到。', focus: ['pa', 'pb', 'mc'], edges: ['spdpA', 'spdpB'] },
    { title: '② 端点发现（SEDP）', text: '两个参与者认识后，一对一交换自己有哪些读者、写者，以及各自的话题名、类型和 QoS。', focus: ['pa', 'pb'], edges: ['sedp'] },
    { title: '③ 匹配', text: '话题名相同、类型相同、QoS 兼容，写者和读者才算匹配成功。任何一项不满足都不会连接。', focus: ['wa', 'rb'], edges: [] },
    { title: '④ 传输数据', text: '消息按 CDR 格式序列化，封装成 RTPS 报文，用 UDP 直接发给对方。同一台机器上可以改走共享内存。', focus: ['wa', 'rb'], edges: ['data'] },
    { title: '⑤ 可靠性保证', text: 'UDP 本身会丢包。可靠 QoS 下，写者发心跳告知已发序号，读者用 ACKNACK 说明缺了哪些，写者再补发。', focus: ['wa', 'rb'], edges: ['data', 'ack'] },
  ],
};

/* ============ 四种通信方式 ============ */
const patterns = {
  id: 'comm-patterns', nav: '四种通信方式', title: '通信方式：话题、服务、动作、参数',
  subtitle: '根据「要不要回复」「要多久」来选',
  intro: `<table><tr><th>方式</th><th>特点</th><th>典型用途</th></tr>
<tr><td><b>话题</b></td><td>单向、持续、多对多</td><td>传感器数据、速度指令</td></tr>
<tr><td><b>服务</b></td><td>一问一答、很快返回</td><td>查询状态、切换模式</td></tr>
<tr><td><b>动作</b></td><td>耗时长、有进度、可取消</td><td>导航到某点、抓取</td></tr>
<tr><td><b>参数</b></td><td>节点的配置项</td><td>最大速度、话题名</td></tr></table>
<p>这四种在 ROS 1 和 ROS 2 里概念相同，底层实现不同。点开每个方块可以看到两代的区别。</p>`,
  groups: [
    G('话题 Topic', 0, 4.5, 15, 2.0), G('服务 Service', 0, 1.9, 15, 2.5),
    G('动作 Action', 0, -1.3, 15, 3.2), G('参数 Parameter', 0, -4.5, 15, 2.5),
  ],
  nodes: [
    N('pub', '发布者', -4.8, 4.35, { w: 3.4, sub: 'Publisher', d: '<p>只管往话题上发消息，不关心有没有人收、有几个人收。</p><h3>ROS 1</h3><p>每个订阅者一条 TCP 连接。<code>latch=true</code> 可以让新订阅者拿到最后一条消息。</p><h3>ROS 2</h3><p>对应 DDS 的 DataWriter。用 QoS 控制可靠性、历史深度、持久性（相当于 latch 的是 <code>transient_local</code>）。</p>', code: '# ROS 1\nrostopic pub /cmd_vel geometry_msgs/Twist ...\n# ROS 2\nros2 topic pub /cmd_vel geometry_msgs/msg/Twist ...' }),
    N('sub', '订阅者', 4.8, 4.35, { w: 3.4, sub: 'Subscriber', d: '<p>注册一个回调函数，每来一条消息被调用一次。</p><p>处理不过来时，超出队列长度的旧消息会被丢弃，所以话题适合「最新值最重要」的数据。</p>', code: '# ROS 1\nrostopic echo /scan\nrostopic hz /scan\n# ROS 2\nros2 topic echo /scan\nros2 topic hz /scan' }),
    N('cli', '客户端', -4.8, 1.7, { w: 3.4, sub: 'Client', d: '<p>发出请求并等待回复。</p><h3>ROS 1</h3><p><code>client.call(srv)</code> 是<b>同步阻塞</b>的。先向 Master 查服务地址（<code>lookupService</code>），再直连服务端。</p><h3>ROS 2</h3><p>调用是<b>异步</b>的，<code>async_send_request</code> 返回一个 future。在回调里同步等结果容易死锁，这是常见的坑。</p>', code: '# ROS 2\nros2 service call /add_two_ints \\\n  example_interfaces/srv/AddTwoInts "{a: 1, b: 2}"' }),
    N('srv', '服务端', 4.8, 1.7, { w: 3.4, sub: 'Server', d: '<p>收到请求后执行回调，填好回复返回。一个服务名只能有一个服务端。</p><p>服务应该很快返回。要跑几秒以上的任务请用动作。</p><h3>ROS 2 的实现</h3><p>底层是一对话题：请求话题 <code>rq/…Request</code> 和回复话题 <code>rr/…Reply</code>，用序号把请求和回复对上。</p>' }),
    N('ac', '动作客户端', -4.8, -1.5, { w: 3.4, sub: 'Action Client', d: '<p>发送一个目标，然后可以持续收到进度反馈，最后拿到结果；中途可以取消。</p><h3>ROS 1（actionlib）</h3><p>用 <b>5 个话题</b>拼出来：<code>goal</code>、<code>cancel</code>、<code>status</code>、<code>feedback</code>、<code>result</code>。</p><h3>ROS 2</h3><p>用 <b>3 个服务 + 2 个话题</b>：<code>send_goal</code>、<code>cancel_goal</code>、<code>get_result</code> 是服务，<code>feedback</code>、<code>status</code> 是话题。</p>', code: '# ROS 2\nros2 action send_goal /navigate_to_pose \\\n  nav2_msgs/action/NavigateToPose "{...}" --feedback' }),
    N('as', '动作服务器', 4.8, -1.5, { w: 3.4, sub: 'Action Server', d: '<p>接受或拒绝目标，在执行过程中周期性发布反馈，结束时给出结果（成功 / 中止 / 已取消）。</p><p>接口用 <code>.action</code> 文件定义，分三段：目标、结果、反馈。</p>', code: '# Fibonacci.action\nint32 order\n---\nint32[] sequence\n---\nint32[] partial_sequence' }),
    N('pc', '使用参数的一方', -4.8, -4.7, { w: 3.4, sub: '节点或命令行工具', d: '<h3>ROS 1</h3><p>任何节点都能读写全局参数服务器上的任何键。</p><h3>ROS 2</h3><p>要改别的节点的参数，实际是调用那个节点提供的参数服务。</p>', code: '# ROS 1\nrosparam set /max_speed 1.5\n# ROS 2\nros2 param set /controller max_speed 1.5\nros2 param dump /controller' }),
    N('ps', '参数存放处', 4.8, -4.7, { w: 3.4, sub: 'ROS 1：Master　ROS 2：节点自身', d: '<h3>ROS 1</h3><p>参数服务器是 Master 的一部分，一棵全局字典树。</p><h3>ROS 2</h3><p>每个节点自动提供 6 个参数服务（<code>get_parameters</code>、<code>set_parameters</code>、<code>list_parameters</code>、<code>describe_parameters</code> 等），参数必须先 <code>declare_parameter</code>，修改会广播到 <code>/parameter_events</code>。</p>', code: 'declare_parameter("max_speed", 1.0);\ndouble v = get_parameter("max_speed").as_double();' }),
  ],
  edges: [
    E('pub', 'sub', { label: '消息（单向，持续）', flow: true }),
    { ...E('cli', 'srv', { label: '请求', bend: [0, 0.9, 0], flow: true }), id: 'req' },
    { ...E('srv', 'cli', { label: '回复', bend: [0, -0.9, 0], flow: true, dashed: true }), id: 'res' },
    { ...E('ac', 'as', { label: '目标', bend: [0, 1.5, 0], flow: true }), id: 'goal' },
    { ...E('as', 'ac', { label: '反馈（持续）', flow: true }), id: 'fb' },
    { ...E('as', 'ac', { label: '结果', bend: [0, -1.5, 0], flow: true, dashed: true }), id: 'result' },
    { ...E('pc', 'ps', { label: '读取 / 设置', bend: [0, 0.9, 0], flow: true }), id: 'pset' },
    { ...E('ps', 'pc', { label: '值 / 变更通知', bend: [0, -0.9, 0], flow: true, dashed: true }), id: 'pget' },
  ],
  steps: [
    { title: '话题：广播式的数据流', text: '发布者不停地发，订阅者来了就收。双方互不等待，一个话题可以有多个发布者和多个订阅者。', focus: ['pub', 'sub'] },
    { title: '服务：一问一答', text: '客户端发请求，服务端处理后回复。适合「马上就有结果」的操作。', focus: ['cli', 'srv'], edges: ['req', 'res'] },
    { title: '动作：带进度的长任务', text: '发出目标后，服务器持续汇报进度，结束时返回结果，客户端随时可以取消。', focus: ['ac', 'as'], edges: ['goal', 'fb', 'result'] },
    { title: '参数：节点的配置', text: 'ROS 1 的参数是全局共享的；ROS 2 的参数归每个节点自己所有，修改要经过该节点同意。', focus: ['pc', 'ps'], edges: ['pset', 'pget'] },
  ],
};

export default [ros1Topic, ros2Disc, patterns];
