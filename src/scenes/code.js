import { G, tree } from './util.js';

const ros1Tree = tree(-7.9, 5.4, [
  [0, 'r1ws', 'catkin_ws/', { sub: '工作空间', h: 0.62, d: '<p>工作空间就是一个普通目录，名字随意。所有操作（<code>catkin_make</code>）都在它的根目录下执行。</p>', code: 'mkdir -p ~/catkin_ws/src\ncd ~/catkin_ws\ncatkin_make\nsource devel/setup.bash' }],
  [1, 'r1src', 'src/', { d: '<p>源码空间。你写的和从 Git 克隆的包都放这里，可以嵌套子目录。</p>' }],
  [2, 'r1top', 'CMakeLists.txt', { d: '<p>指向 catkin 的 <code>toplevel.cmake</code> 的符号链接，是整个工作空间的顶层工程。不要修改它。</p>' }],
  [2, 'r1pkg', 'my_robot/', { d: '<p>一个<b>包（package）</b>：ROS 里组织和发布代码的最小单位。判断标准是目录下有 <code>package.xml</code>。</p>', code: 'cd ~/catkin_ws/src\ncatkin_create_pkg my_robot roscpp rospy std_msgs' }],
  [3, 'r1xml', 'package.xml', { d: '<p>包清单：名字、版本、作者、许可证和依赖。</p>', code: '<package format="2">\n  <name>my_robot</name>\n  <version>0.1.0</version>\n  <description>示例包</description>\n  <maintainer email="me@example.com">me</maintainer>\n  <license>MIT</license>\n  <buildtool_depend>catkin</buildtool_depend>\n  <depend>roscpp</depend>\n  <depend>rospy</depend>\n  <depend>std_msgs</depend>\n</package>' }],
  [3, 'r1cm', 'CMakeLists.txt', { d: '<p>构建脚本。所有 ROS 1 包都必须有，包括纯 Python 包。</p>', code: 'cmake_minimum_required(VERSION 3.0.2)\nproject(my_robot)\nfind_package(catkin REQUIRED COMPONENTS\n  roscpp rospy std_msgs)\ncatkin_package()\ninclude_directories(${catkin_INCLUDE_DIRS})\nadd_executable(talker src/talker.cpp)\ntarget_link_libraries(talker ${catkin_LIBRARIES})' }],
  [3, 'r1inc', 'include/my_robot/', { d: '<p>对外公开的 C++ 头文件。多套一层包名目录，是为了让别人写 <code>#include &lt;my_robot/xxx.h&gt;</code> 时不重名。</p>' }],
  [3, 'r1cpp', 'src/talker.cpp', { d: '<p>C++ 节点源码。ROS 1 的写法是过程式的：初始化、拿到 NodeHandle、循环。</p>', code: '#include <ros/ros.h>\n#include <std_msgs/String.h>\n\nint main(int argc, char** argv) {\n  ros::init(argc, argv, "talker");\n  ros::NodeHandle nh;\n  ros::Publisher pub =\n    nh.advertise<std_msgs::String>("chatter", 10);\n\n  ros::Rate rate(10);\n  while (ros::ok()) {\n    std_msgs::String msg;\n    msg.data = "hello";\n    pub.publish(msg);\n    ros::spinOnce();\n    rate.sleep();\n  }\n  return 0;\n}' }],
  [3, 'r1py', 'scripts/listener.py', { d: '<p>Python 节点。需要 <code>chmod +x</code> 赋予可执行权限，并在首行写解释器。</p>', code: '#!/usr/bin/env python3\nimport rospy\nfrom std_msgs.msg import String\n\ndef callback(msg):\n    rospy.loginfo("收到: %s", msg.data)\n\nif __name__ == "__main__":\n    rospy.init_node("listener")\n    rospy.Subscriber("chatter", String, callback)\n    rospy.spin()' }],
  [3, 'r1msg', 'msg/  srv/  action/', { d: '<p>自定义接口定义。语法是「类型 字段名」，一行一个。</p>', code: '# msg/Detection.msg\nHeader header\nstring label\nfloat32 confidence\ngeometry_msgs/Point position' }],
  [3, 'r1launch', 'launch/demo.launch', { d: '<p>XML 格式的启动文件，一次拉起多个节点并设置参数。</p>', code: '<launch>\n  <arg name="rate" default="10"/>\n  <param name="robot_name" value="r1"/>\n\n  <node pkg="my_robot" type="talker" name="talker"\n        output="screen">\n    <remap from="chatter" to="/robot/chatter"/>\n    <param name="rate" value="$(arg rate)"/>\n  </node>\n  <node pkg="my_robot" type="listener.py"\n        name="listener"/>\n</launch>' }],
  [3, 'r1cfg', 'config/params.yaml', { d: '<p>参数文件，在 launch 里用 <code>&lt;rosparam file="…" command="load"/&gt;</code> 加载到参数服务器。</p>', code: 'max_speed: 1.5\ncamera:\n  fps: 30\n  frame_id: camera_link' }],
  [1, 'r1build', 'build/', { d: '<p>构建空间：CMake 缓存、Makefile、目标文件。自动生成，不进版本控制。</p>' }],
  [1, 'r1devel', 'devel/', { d: '<p>开发空间：编译出的可执行文件、库、生成的消息代码，以及 <code>setup.bash</code>。自动生成。</p>' }],
]);

const ros2Tree = tree(0.9, 5.4, [
  [0, 'r2ws', 'ros2_ws/', { sub: '工作空间', h: 0.62, d: '<p>结构和 ROS 1 类似，但产物目录变成了 <code>build/ install/ log/</code>。</p>', code: 'mkdir -p ~/ros2_ws/src\ncd ~/ros2_ws\ncolcon build --symlink-install\nsource install/setup.bash' }],
  [1, 'r2src', 'src/', { d: '<p>源码目录。ROS 2 习惯把 C++、Python、接口拆成不同的包。</p>' }],
  [2, 'r2cpp', 'my_cpp_pkg/', { sub: 'ament_cmake', d: '<p>C++ 包。</p>', code: 'ros2 pkg create my_cpp_pkg \\\n  --build-type ament_cmake \\\n  --dependencies rclcpp std_msgs' }],
  [3, 'r2xml', 'package.xml', { d: '<p>格式 3 的清单，在 <code>&lt;export&gt;</code> 里声明构建类型。</p>', code: '<package format="3">\n  <name>my_cpp_pkg</name>\n  <version>0.1.0</version>\n  <description>示例包</description>\n  <maintainer email="me@example.com">me</maintainer>\n  <license>Apache-2.0</license>\n  <buildtool_depend>ament_cmake</buildtool_depend>\n  <depend>rclcpp</depend>\n  <depend>std_msgs</depend>\n  <export>\n    <build_type>ament_cmake</build_type>\n  </export>\n</package>' }],
  [3, 'r2cm', 'CMakeLists.txt', { d: '<p>注意和 ROS 1 的两点不同：每个依赖单独 <code>find_package</code>；必须写 <code>install()</code>，否则 <code>ros2 run</code> 找不到。</p>', code: 'cmake_minimum_required(VERSION 3.8)\nproject(my_cpp_pkg)\n\nfind_package(ament_cmake REQUIRED)\nfind_package(rclcpp REQUIRED)\nfind_package(std_msgs REQUIRED)\n\nadd_executable(talker src/talker.cpp)\ntarget_link_libraries(talker PUBLIC\n  rclcpp::rclcpp ${std_msgs_TARGETS})\n\ninstall(TARGETS talker\n  DESTINATION lib/${PROJECT_NAME})\ninstall(DIRECTORY launch config\n  DESTINATION share/${PROJECT_NAME})\n\nament_package()' }],
  [3, 'r2talker', 'src/talker.cpp', { d: '<p>ROS 2 的写法是面向对象的：节点是一个类，用定时器代替 while 循环。</p>', code: '#include <chrono>\n#include <rclcpp/rclcpp.hpp>\n#include <std_msgs/msg/string.hpp>\nusing namespace std::chrono_literals;\n\nclass Talker : public rclcpp::Node {\npublic:\n  Talker() : Node("talker") {\n    pub_ = create_publisher<std_msgs::msg::String>(\n      "chatter", 10);\n    timer_ = create_wall_timer(100ms, [this] {\n      std_msgs::msg::String msg;\n      msg.data = "hello";\n      pub_->publish(msg);\n    });\n  }\nprivate:\n  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr pub_;\n  rclcpp::TimerBase::SharedPtr timer_;\n};\n\nint main(int argc, char** argv) {\n  rclcpp::init(argc, argv);\n  rclcpp::spin(std::make_shared<Talker>());\n  rclcpp::shutdown();\n}' }],
  [3, 'r2launch', 'launch/demo.launch.py', { d: '<p>Python 启动文件。必须定义 <code>generate_launch_description()</code>。</p>', code: 'from launch import LaunchDescription\nfrom launch_ros.actions import Node\n\ndef generate_launch_description():\n    return LaunchDescription([\n        Node(\n            package="my_cpp_pkg",\n            executable="talker",\n            name="talker",\n            parameters=[{"rate": 10}],\n            remappings=[("chatter", "/robot/chatter")],\n            output="screen",\n        ),\n        Node(package="my_py_pkg", executable="listener"),\n    ])' }],
  [3, 'r2cfg', 'config/params.yaml', { d: '<p>参数文件多了两层：节点名和固定的 <code>ros__parameters</code>，因为参数属于具体节点。</p>', code: 'talker:\n  ros__parameters:\n    rate: 10\n    max_speed: 1.5' }],
  [2, 'r2py', 'my_py_pkg/', { sub: 'ament_python', d: '<p>纯 Python 包，没有 CMakeLists.txt。</p>', code: 'ros2 pkg create my_py_pkg \\\n  --build-type ament_python \\\n  --dependencies rclpy std_msgs' }],
  [3, 'r2setup', 'setup.py  setup.cfg', { d: '<p>标准 setuptools 配置。<code>entry_points</code> 里登记的名字就是 <code>ros2 run</code> 用的可执行名。</p>', code: 'setup(\n    name="my_py_pkg",\n    packages=["my_py_pkg"],\n    data_files=[\n        ("share/ament_index/resource_index/packages",\n         ["resource/my_py_pkg"]),\n        ("share/my_py_pkg", ["package.xml"]),\n    ],\n    entry_points={"console_scripts": [\n        "listener = my_py_pkg.listener:main",\n    ]},\n)' }],
  [3, 'r2res', 'resource/my_py_pkg', { d: '<p>一个<b>空文件</b>，安装时被放进 ament 索引，作为「这个包存在」的标记。</p>' }],
  [3, 'r2node', 'my_py_pkg/listener.py', { d: '<p>Python 模块目录与包同名。节点文件需要提供 <code>main()</code> 函数。</p>', code: 'import rclpy\nfrom rclpy.node import Node\nfrom std_msgs.msg import String\n\nclass Listener(Node):\n    def __init__(self):\n        super().__init__("listener")\n        self.create_subscription(\n            String, "chatter", self.on_msg, 10)\n\n    def on_msg(self, msg):\n        self.get_logger().info(f"收到: {msg.data}")\n\ndef main():\n    rclpy.init()\n    rclpy.spin(Listener())\n    rclpy.shutdown()' }],
  [2, 'r2if', 'my_interfaces/', { sub: 'msg/ srv/ action/', d: '<p>接口单独成包，这样 C++ 包和 Python 包都能依赖它，不会循环依赖。</p><p>ROS 2 的消息没有 <code>Header</code> 这个特殊类型，要写全名 <code>std_msgs/Header</code>；字段名必须小写加下划线。</p>', code: '# msg/Detection.msg\nstd_msgs/Header header\nstring label\nfloat32 confidence 0.0     # 可以写默认值\ngeometry_msgs/Point position' }],
  [1, 'r2build', 'build/', { d: '<p>每个包一个子目录，存放中间文件。</p>' }],
  [1, 'r2install', 'install/', { d: '<p>每个包安装后的成品，以及 <code>setup.bash</code>。运行时只用这个目录。</p>' }],
  [1, 'r2log', 'log/', { d: '<p>每次 colcon 运行的日志。</p>' }],
]);

export default [{
  id: 'code-structure', nav: '工作空间与包', title: '代码结构：工作空间与包',
  subtitle: '左边 ROS 1，右边 ROS 2。点文件看示例内容',
  intro: `<p>两代的层级概念一样：<b>工作空间 → 包 → 节点</b>。</p>
<ul><li><b>工作空间</b>：一个目录，里面放一批要一起构建的包；</li><li><b>包</b>：带 <code>package.xml</code> 的目录，是复用和发布的单位；</li><li><b>节点</b>：包里的一个可执行程序。</li></ul>
<p>主要区别：</p>
<ul><li>ROS 2 的纯 Python 包没有 CMakeLists.txt；</li><li>ROS 2 没有 <code>devel/</code>，一切都要 install；</li><li>ROS 2 的节点写成类，launch 文件可以用 Python 写。</li></ul>
<p>图中越靠前（凸出）的方块，目录层级越深。</p>`,
  groups: [G('ROS 1 · catkin 工作空间', -4.5, 0.5, 7.7, 11.3), G('ROS 2 · colcon 工作空间', 4.3, 0.5, 7.7, 11.3)],
  nodes: [...ros1Tree, ...ros2Tree],
  edges: [],
}];
