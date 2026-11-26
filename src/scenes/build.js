import { N, E, G } from './util.js';

/* ============ CMake 原理 ============ */
const cmake = {
  id: 'cmake', nav: 'CMake 原理', title: 'CMake：配置、生成、构建、安装',
  subtitle: 'catkin 和 ament_cmake 都建立在它之上，先看懂它',
  intro: `<p><b>CMake 不是编译器</b>，也不直接编译代码。它读取 <code>CMakeLists.txt</code>，<b>生成</b>真正的构建脚本（Makefile 或 build.ninja），再由 make / ninja 去调用编译器。</p>
<p>所以用 CMake 总是分两大步：先 <code>cmake</code>（配置 + 生成），再 <code>make</code>（构建）。</p>
<p>ROS 的 C++ 包本质上都是 CMake 工程，catkin 和 ament 只是在上面加了一层宏。</p>`,
  groups: [G('外部输入', 0, 3.3, 16.4, 1.9), G('四个阶段', 0, 0.9, 16.4, 1.9), G('每个阶段的产物', 0, -1.5, 16.4, 1.9)],
  nodes: [
    N('lists', 'CMakeLists.txt', -6, 3.15, { w: 3.5, kind: 'file', sub: '你写的构建描述', d: '<p>用 CMake 语言描述「有哪些目标、各自由哪些源文件组成、依赖谁」。</p><p>现代 CMake 以<b>目标（target）</b>为中心：头文件路径、编译选项、链接库都挂在目标上，并通过 <code>PUBLIC / PRIVATE</code> 决定是否传递给依赖它的目标。</p>', code: 'cmake_minimum_required(VERSION 3.16)\nproject(hello LANGUAGES CXX)\n\nfind_package(Eigen3 REQUIRED)\n\nadd_library(mathlib src/math.cpp)\ntarget_include_directories(mathlib PUBLIC include)\ntarget_link_libraries(mathlib PUBLIC Eigen3::Eigen)\n\nadd_executable(hello src/main.cpp)\ntarget_link_libraries(hello PRIVATE mathlib)\n\ninstall(TARGETS hello mathlib\n  RUNTIME DESTINATION bin\n  LIBRARY DESTINATION lib)' }),
    N('pkgs', '依赖库的 Config.cmake', -2, 3.15, { w: 3.5, kind: 'file', sub: 'find_package() 要找的文件', d: '<p><code>find_package(Foo)</code> 会在 <code>CMAKE_PREFIX_PATH</code> 列出的目录里找 <code>FooConfig.cmake</code>，这个文件告诉 CMake：Foo 的头文件在哪、库文件在哪、它又依赖谁。</p><p><b>这正是 ROS 工作空间叠加的原理</b>：<code>source setup.bash</code> 会把工作空间路径加进 <code>CMAKE_PREFIX_PATH</code>，于是别的包就能 <code>find_package</code> 到你的包。</p>', code: 'echo $CMAKE_PREFIX_PATH\n# /home/me/ws/install:/opt/ros/jazzy' }),
    N('src', '源码 .cpp / .h', 2, 3.15, { w: 3.5, kind: 'file', sub: '被编译的文件', d: '<p>CMake 会分析 <code>#include</code> 关系，生成的构建脚本知道「改了哪个头文件需要重新编译哪些源文件」，所以第二次构建只编译改动的部分。</p>' }),
    N('cc', '编译器工具链', 6, 3.15, { w: 3.5, sub: 'gcc / clang / MSVC + 链接器', kind: 'muted', d: '<p>真正干活的程序。配置阶段 CMake 会探测它们的位置和能力。</p><p>交叉编译时用「工具链文件」告诉 CMake 换一套编译器：</p>', code: 'cmake -S . -B build \\\n  -DCMAKE_TOOLCHAIN_FILE=aarch64.cmake' }),

    N('conf', '① 配置', -6, 0.75, { w: 3.5, sub: 'cmake -S . -B build', d: '<p>从头到尾<b>执行</b>一遍 CMakeLists.txt：</p><ul><li>探测编译器；</li><li>执行 <code>find_package</code> 找依赖；</li><li>记录所有目标及其属性。</li></ul><p>结果缓存到 <code>CMakeCache.txt</code>，下次不用重新探测。</p>' }),
    N('gen', '② 生成', -2, 0.75, { w: 3.5, sub: '同一条 cmake 命令内完成', d: '<p>把内存里的目标模型翻译成某种构建系统的脚本。用 <code>-G</code> 选择生成器：</p><ul><li><code>Unix Makefiles</code>（Linux 默认）；</li><li><code>Ninja</code>（更快）；</li><li><code>Visual Studio</code>、<code>Xcode</code>。</li></ul>', code: 'cmake -S . -B build -G Ninja \\\n  -DCMAKE_BUILD_TYPE=Release' }),
    N('build', '③ 构建', 2, 0.75, { w: 3.5, sub: 'cmake --build build', d: '<p>调用 make 或 ninja，它们按依赖顺序并行执行两类命令：</p><ol><li><b>编译</b>：每个 .cpp → 一个 .o 目标文件；</li><li><b>链接</b>：把 .o 和依赖库合成可执行文件或库。</li></ol>', code: 'cmake --build build -j8\n# 等价于 cd build && make -j8' }),
    N('inst', '④ 安装', 6, 0.75, { w: 3.5, sub: 'cmake --install build', d: '<p>按 <code>install()</code> 规则把成品拷到安装前缀下的标准目录。</p><p>只有安装过的文件才会被别的工程找到，所以 ROS 2 里<b>忘写 install() 规则</b>是「找不到可执行文件 / launch 文件」的头号原因。</p>', code: 'cmake --install build --prefix ~/ws/install' }),

    N('cache', 'CMakeCache.txt', -6, -1.65, { w: 3.5, kind: 'file', sub: '缓存的变量', d: '<p>保存配置结果：编译器路径、找到的库的位置、你用 <code>-D</code> 传入的选项。</p><p>改了依赖或换了编译器后构建出怪错，删掉 build 目录重新配置通常就好了。</p>' }),
    N('mk', 'Makefile / build.ninja', -2, -1.65, { w: 3.5, kind: 'file', sub: '生成的构建脚本', d: '<p>机器生成的文件，不要手改。里面是成百上千条「某文件依赖哪些文件、用什么命令生成」的规则。</p><p>顺带可以生成 <code>compile_commands.json</code>，给 clangd 等编辑器工具做代码补全。</p>', code: 'cmake -S . -B build \\\n  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON' }),
    N('obj', '.o → 可执行文件 / 库', 2, -1.65, { w: 3.5, kind: 'file', sub: '.so 动态库 · .a 静态库', d: '<p>编译产物留在 build 目录里。</p><ul><li><b>.o</b>：单个源文件编译出的机器码；</li><li><b>.a</b>：静态库，链接时拷进可执行文件；</li><li><b>.so</b>：动态库，运行时加载（ROS 的库基本都是这种）。</li></ul>' }),
    N('prefix', '安装目录', 6, -1.65, { w: 3.5, kind: 'file', sub: 'bin/ lib/ include/ share/', d: '<p>标准布局：</p><ul><li><code>bin/</code> 可执行文件；</li><li><code>lib/</code> 库（ROS 的节点可执行文件放在 <code>lib/包名/</code>）；</li><li><code>include/</code> 头文件；</li><li><code>share/包名/</code> 配置、launch 文件、Config.cmake。</li></ul>' }),
  ],
  edges: [
    E('lists', 'conf', { flow: true }), E('pkgs', 'conf', { flow: true }), E('src', 'build', { flow: true }), E('cc', 'build', { flow: true }),
    E('conf', 'gen', { flow: true }), E('gen', 'build', { flow: true }), E('build', 'inst', { flow: true }),
    E('conf', 'cache', { flow: false }), E('gen', 'mk', { flow: false }), E('build', 'obj', { flow: false }), E('inst', 'prefix', { flow: false }),
    E('mk', 'build', { flow: false, dashed: true }), E('obj', 'inst', { flow: false, dashed: true }),
  ],
  steps: [
    { title: '编写 CMakeLists.txt', text: '描述目标和依赖关系，而不是写具体的编译命令。', focus: ['lists', 'src'], edges: [] },
    { title: '① 配置', text: 'CMake 执行脚本，探测编译器，用 <code>find_package</code> 找到依赖库，结果写入缓存。', focus: ['lists', 'pkgs', 'conf', 'cache'] },
    { title: '② 生成', text: '把目标模型翻译成 Makefile 或 build.ninja。到这一步还没有编译任何代码。', focus: ['conf', 'gen', 'mk'] },
    { title: '③ 构建', text: 'make / ninja 读取生成的脚本，调用编译器把每个源文件编译成 .o，再链接成可执行文件和库。', focus: ['gen', 'mk', 'src', 'cc', 'build', 'obj'] },
    { title: '④ 安装', text: '把成品按标准目录结构拷到安装前缀下，别的工程才能通过 find_package 找到它。', focus: ['build', 'obj', 'inst', 'prefix'] },
  ],
};

/* ============ catkin（ROS 1） ============ */
const catkin = {
  id: 'catkin', nav: 'catkin（ROS 1）', title: 'ROS 1 的编译：catkin',
  subtitle: 'catkin_make 把整个工作空间合并成一个 CMake 工程',
  intro: `<p><b>catkin</b> = CMake 宏 + Python 脚本。它解决普通 CMake 不管的两件事：</p>
<ul><li>一次构建工作空间里的<b>很多个包</b>，并按依赖排好顺序；</li><li>构建完不用安装就能直接运行（<b>devel 空间</b>）。</li></ul>
<p>工作空间有四个「空间」：<code>src</code>（源码）、<code>build</code>（中间文件）、<code>devel</code>（开发用成品）、<code>install</code>（可选，发布用）。</p>`,
  groups: [G('src/ 源码空间', -7.2, 0.3, 4.4, 7.4), G('产物', 2.6, 0.3, 4.2, 7.4), G('其他构建命令', -2.3, -4.7, 5.4, 3.2)],
  nodes: [
    N('top', 'CMakeLists.txt', -7.2, 2.9, { w: 3.6, kind: 'file', sub: '→ 链接到 toplevel.cmake', d: '<p><code>catkin_init_workspace</code>（或第一次 <code>catkin_make</code>）在 <code>src/</code> 下创建的符号链接，指向 <code>/opt/ros/noetic/share/catkin/cmake/toplevel.cmake</code>。</p><p>它是整个工作空间的<b>顶层 CMake 工程</b>：找出所有包，按依赖排序，然后对每个包执行 <code>add_subdirectory()</code>。</p>' }),
    N('pm', 'robot_msgs', -7.2, 1.3, { w: 3.6, sub: '自定义消息包', d: '<p>只包含 <code>.msg / .srv</code> 文件的包。构建时由 <code>message_generation</code> 调用 gencpp、genpy 生成 C++ 头文件和 Python 模块。</p>', code: 'find_package(catkin REQUIRED COMPONENTS\n  message_generation std_msgs)\n\nadd_message_files(FILES Detection.msg)\ngenerate_messages(DEPENDENCIES std_msgs)\n\ncatkin_package(CATKIN_DEPENDS message_runtime std_msgs)' }),
    N('pa', 'robot_driver', -7.2, -0.3, { w: 3.6, sub: 'C++ 包', d: '<p>典型 C++ 包的 CMakeLists.txt。注意三个 catkin 特有的地方：<code>find_package(catkin … COMPONENTS)</code>、<code>catkin_package()</code>、<code>${catkin_LIBRARIES}</code>。</p>', code: 'cmake_minimum_required(VERSION 3.0.2)\nproject(robot_driver)\n\nfind_package(catkin REQUIRED COMPONENTS\n  roscpp std_msgs robot_msgs)\n\ncatkin_package(\n  INCLUDE_DIRS include\n  LIBRARIES robot_driver\n  CATKIN_DEPENDS roscpp std_msgs robot_msgs)\n\ninclude_directories(include ${catkin_INCLUDE_DIRS})\n\nadd_executable(driver_node src/driver_node.cpp)\ntarget_link_libraries(driver_node ${catkin_LIBRARIES})\nadd_dependencies(driver_node\n  ${catkin_EXPORTED_TARGETS})' }),
    N('pb', 'robot_tools', -7.2, -1.9, { w: 3.6, sub: 'Python 包（仍需 CMakeLists）', d: '<p>ROS 1 里纯 Python 包也必须有 CMakeLists.txt。脚本用 <code>catkin_install_python</code> 安装，Python 模块用 <code>catkin_python_setup()</code> 配合 <code>setup.py</code>。</p>', code: 'find_package(catkin REQUIRED COMPONENTS rospy)\ncatkin_python_setup()\ncatkin_package()\n\ncatkin_install_python(PROGRAMS scripts/monitor.py\n  DESTINATION ${CATKIN_PACKAGE_BIN_DESTINATION})' }),

    N('cm', 'catkin_make', -2.3, 1.3, { w: 3.8, h: 1.2, sub: '一次 cmake + 一次 make', kind: 'accent', d: '<p>它其实只是三条命令的简写：</p><p>因为所有包在<b>同一个 CMake 工程</b>里：</p><ul><li>优点：配置只跑一次，速度快；</li><li>缺点：包之间会互相污染（目标重名会冲突、一个包的变量能影响另一个包）；一个包配置失败，全部失败。</li></ul>', code: 'cd ~/catkin_ws\ncatkin_make\n\n# 等价于：\nmkdir -p build && cd build\ncmake ../src -DCATKIN_DEVEL_PREFIX=../devel \\\n             -DCMAKE_INSTALL_PREFIX=../install\nmake' }),
    N('xml', 'package.xml', -2.3, 3.4, { w: 3.8, kind: 'file', sub: '每个包的清单：名字、版本、依赖', d: '<p>catkin 靠它识别「这是一个包」，并据此算出构建顺序。<code>rosdep</code> 也读它来安装系统依赖。</p><ul><li><code>buildtool_depend</code>：构建工具（catkin）；</li><li><code>build_depend</code>：编译时需要；</li><li><code>exec_depend</code>：运行时需要；</li><li><code>depend</code>：以上都算。</li></ul>', code: '<package format="2">\n  <name>robot_driver</name>\n  <version>0.1.0</version>\n  <description>底盘驱动</description>\n  <maintainer email="me@example.com">me</maintainer>\n  <license>MIT</license>\n\n  <buildtool_depend>catkin</buildtool_depend>\n  <depend>roscpp</depend>\n  <depend>std_msgs</depend>\n  <depend>robot_msgs</depend>\n</package>' }),
    N('macro', 'catkin_package()', -2.3, -0.9, { w: 3.8, kind: 'file', sub: '生成本包的 Config.cmake', d: '<p>catkin 最核心的宏。它<b>不是</b>声明本包的依赖，而是声明「<b>别的包依赖我时需要什么</b>」，并据此生成 <code>包名Config.cmake</code>：</p><ul><li><code>INCLUDE_DIRS</code>：我导出的头文件目录；</li><li><code>LIBRARIES</code>：我导出的库；</li><li><code>CATKIN_DEPENDS</code>：用我的人也需要的 catkin 包；</li><li><code>DEPENDS</code>：用我的人也需要的系统库。</li></ul><p>必须写在 <code>add_library / add_executable</code> <b>之前</b>。</p>' }),

    N('bld', 'build/', 2.6, 2.6, { w: 3.4, kind: 'file', sub: '构建空间：中间文件', d: '<p>CMakeCache.txt、Makefile、.o 文件都在这里。可以随时整个删掉重来。</p>' }),
    N('dev', 'devel/', 2.6, 0.3, { w: 3.4, kind: 'file', sub: '开发空间：不安装就能跑', d: '<p>catkin 的特色。编译出的可执行文件和库直接放到这里，生成的消息头文件也在这里，而 launch 文件、Python 脚本等仍从 <code>src/</code> 里读取。</p><p>所以改了 Python 脚本或 launch 文件不用重新编译。</p>', code: 'devel/\n├── setup.bash\n├── lib/robot_driver/driver_node\n├── include/robot_msgs/Detection.h\n└── share/…' }),
    N('ins', 'install/', 2.6, -2.0, { w: 3.4, kind: 'file', sub: '安装空间：用于部署', d: '<p>执行 <code>catkin_make install</code> 才会生成。只包含 <code>install()</code> 规则指定的文件，不依赖源码目录，可以整体拷到机器人上。</p>' }),

    N('setup', 'source devel/setup.bash', 7.6, 0.3, { w: 4.4, sub: '把工作空间加入环境', d: '<p>设置一组环境变量，让系统找得到你的包：</p><ul><li><code>ROS_PACKAGE_PATH</code>：rospack / roslaunch 找包；</li><li><code>CMAKE_PREFIX_PATH</code>：其他工作空间 find_package；</li><li><code>LD_LIBRARY_PATH</code>、<code>PYTHONPATH</code>、<code>PATH</code>。</li></ul><p><b>叠加（overlay）</b>：新工作空间排在 <code>/opt/ros/noetic</code> 前面，同名包以你的为准。</p>', code: 'source /opt/ros/noetic/setup.bash   # 底层\nsource ~/catkin_ws/devel/setup.bash # 叠加\necho $ROS_PACKAGE_PATH' }),
    N('run', 'rosrun / roslaunch', 7.6, -2.0, { w: 4.4, sub: '按包名找到并运行', d: '<p><code>rosrun 包名 可执行文件名</code> 会在该包的 <code>lib/包名/</code> 和源码目录里找可执行文件。</p>', code: 'rosrun robot_driver driver_node\nroslaunch robot_driver bringup.launch' }),

    N('iso', 'catkin_make_isolated', -2.3, -4.2, { w: 4.4, kind: 'muted', sub: '每个包单独 cmake，串行', d: '<p>逐个包独立配置和构建，能处理工作空间里混有<b>非 catkin 的纯 CMake 包</b>的情况，但是串行执行，很慢。</p>' }),
    N('tools', 'catkin build', -2.3, -5.4, { w: 4.4, kind: 'muted', sub: 'catkin_tools：隔离 + 并行，推荐', d: '<p>独立的命令行工具（<code>python3-catkin-tools</code>）。每个包隔离构建，同时多个包<b>并行</b>，输出清晰，还能只构建指定的包。</p><p>它的思路就是后来 ROS 2 colcon 的前身。注意同一个工作空间不要混用 <code>catkin_make</code> 和 <code>catkin build</code>。</p>', code: 'catkin build                 # 全部\ncatkin build robot_driver    # 该包及其依赖\ncatkin clean' }),
  ],
  edges: [
    E('top', 'cm', { flow: true }), E('pm', 'cm', { flow: true }), E('pa', 'cm', { flow: true }), E('pb', 'cm', { flow: true }),
    E('xml', 'cm', { label: '决定构建顺序', flow: false }), E('macro', 'cm', { flow: false, arrow: false, dashed: true }),
    E('cm', 'bld', { flow: true }), E('cm', 'dev', { flow: true }), E('dev', 'ins', { label: 'make install', flow: false, dashed: true }),
    E('dev', 'setup', { flow: true }), E('setup', 'run', { flow: false }),
    E('pm', 'pa', { label: '被依赖', flow: false, dashed: true }),
  ],
  steps: [
    { title: '工作空间与包', text: '源码都放在 <code>src/</code> 下，每个带 <code>package.xml</code> 的目录是一个包。', focus: ['top', 'pm', 'pa', 'pb'], edges: [] },
    { title: 'package.xml 决定顺序', text: 'catkin 读取所有包的清单，做拓扑排序：robot_msgs 被 robot_driver 依赖，所以先处理它。', focus: ['xml', 'pm', 'pa', 'cm'], edges: ['xml>cm', 'pm>pa'] },
    { title: 'catkin_make：合并成一个工程', text: '顶层 CMakeLists.txt 把所有包用 <code>add_subdirectory</code> 拉进同一个 CMake 工程，只执行一次 cmake 和一次 make。', focus: ['top', 'pm', 'pa', 'pb', 'cm'] },
    { title: 'catkin_package() 导出信息', text: '每个包用这个宏声明自己对外提供的头文件、库和依赖，供下游包 find_package 使用。', focus: ['macro', 'cm'] },
    { title: 'build 与 devel', text: '中间文件进 <code>build/</code>；可执行文件、库和生成的消息代码直接进 <code>devel/</code>，不用安装就能运行。', focus: ['cm', 'bld', 'dev'] },
    { title: 'install（可选）', text: '需要部署时再执行 <code>catkin_make install</code>，得到不依赖源码的安装空间。', focus: ['dev', 'ins'] },
    { title: 'source 环境并运行', text: '<code>setup.bash</code> 把工作空间路径加入环境变量，之后 rosrun / roslaunch 才找得到你的包。', focus: ['dev', 'setup', 'run'] },
    { title: '另外两个构建命令', text: '<code>catkin build</code> 隔离并行构建，是 ROS 1 后期的推荐做法，也是 colcon 的思路来源。', focus: ['iso', 'tools'], edges: [] },
  ],
};

/* ============ colcon + ament（ROS 2） ============ */
const colcon = {
  id: 'colcon', nav: 'colcon + ament（ROS 2）', title: 'ROS 2 的编译：colcon + ament',
  subtitle: 'colcon 调度，每个包用自己的构建系统独立构建',
  intro: `<p>ROS 2 把 catkin 的职责拆成了两半：</p>
<ul><li><b>colcon</b>：构建<b>工具</b>。找包、排顺序、并行调度，自己不懂怎么编译；</li><li><b>ament</b>：构建<b>系统</b>。<code>ament_cmake</code> 给 C++ 包用，<code>ament_python</code> 给纯 Python 包用。</li></ul>
<p>每个包<b>完全独立</b>地构建并安装，后构建的包从 <code>install/</code> 里找前面的包。没有 devel 空间。</p>`,
  groups: [G('src/', -8.6, 0.6, 4.2, 6.0), G('每个包一个独立任务', 0.9, 0.6, 4.6, 6.0), G('产物', 5.9, 0.6, 3.8, 6.0), G('ament 提供的能力', 0, -4.6, 21.6, 2.0)],
  nodes: [
    N('s1', 'my_interfaces', -8.6, 2.4, { w: 3.4, sub: '接口包 · ament_cmake', d: '<p>ROS 2 里消息、服务、动作统称<b>接口</b>，习惯单独放一个包。接口包只能用 ament_cmake。</p>', code: 'find_package(ament_cmake REQUIRED)\nfind_package(rosidl_default_generators REQUIRED)\n\nrosidl_generate_interfaces(${PROJECT_NAME}\n  "msg/Detection.msg"\n  "srv/SetMode.srv"\n  "action/Dock.action")\n\nament_package()' }),
    N('s2', 'my_cpp_pkg', -8.6, 0.6, { w: 3.4, sub: 'C++ 包 · ament_cmake', d: '<p>基本就是一份现代 CMake，加上结尾的 <code>ament_package()</code>。</p>', code: 'cmake_minimum_required(VERSION 3.8)\nproject(my_cpp_pkg)\n\nfind_package(ament_cmake REQUIRED)\nfind_package(rclcpp REQUIRED)\nfind_package(my_interfaces REQUIRED)\n\nadd_executable(talker src/talker.cpp)\ntarget_link_libraries(talker PUBLIC\n  rclcpp::rclcpp\n  ${my_interfaces_TARGETS})\n\ninstall(TARGETS talker\n  DESTINATION lib/${PROJECT_NAME})\ninstall(DIRECTORY launch\n  DESTINATION share/${PROJECT_NAME})\n\nament_package()' }),
    N('s3', 'my_py_pkg', -8.6, -1.2, { w: 3.4, sub: 'Python 包 · ament_python', d: '<p>纯 Python 包<b>没有 CMakeLists.txt</b>，就是一个标准的 setuptools 工程。节点通过 <code>entry_points</code> 注册成可执行命令。</p>', code: 'from setuptools import setup\n\nsetup(\n    name="my_py_pkg",\n    version="0.1.0",\n    packages=["my_py_pkg"],\n    data_files=[\n        ("share/ament_index/resource_index/packages",\n         ["resource/my_py_pkg"]),\n        ("share/my_py_pkg", ["package.xml"]),\n    ],\n    entry_points={\n        "console_scripts": [\n            "listener = my_py_pkg.listener:main",\n        ],\n    },\n)' }),

    N('colcon', 'colcon build', -4, 0.6, { w: 3.6, h: 1.2, sub: '发现 → 排序 → 并行调度', kind: 'accent', d: '<p>colcon 做三件事：</p><ol><li><b>发现</b>：递归扫描 <code>src/</code>，找到带 <code>package.xml</code> 的目录，从 <code>&lt;build_type&gt;</code> 得知用哪种构建系统；</li><li><b>排序</b>：按依赖做拓扑排序；</li><li><b>执行</b>：依赖已完成的包并行构建，每个包完成后立刻安装到 <code>install/</code>。</li></ol>', code: 'colcon build\ncolcon build --symlink-install\ncolcon build --packages-select my_cpp_pkg\ncolcon build --packages-up-to my_cpp_pkg\ncolcon build --cmake-args -DCMAKE_BUILD_TYPE=Release\ncolcon test && colcon test-result --verbose' }),
    N('t1', 'cmake → make → install', 0.9, 2.4, { w: 3.8, sub: '任务：my_interfaces', d: '<p>colcon 在 <code>build/my_interfaces/</code> 里依次执行 cmake 配置、构建、安装。这一步会运行 rosidl 代码生成器，生成 C、C++、Python 的消息代码。</p>' }),
    N('t2', 'cmake → make → install', 0.9, 0.6, { w: 3.8, sub: '任务：my_cpp_pkg', d: '<p>必须等 my_interfaces 安装完才开始，因为它的 <code>find_package(my_interfaces)</code> 要到 <code>install/my_interfaces/</code> 里找 Config.cmake。</p><p>colcon 会在调用 cmake 前，把已完成包的安装路径加进这个任务的环境变量。</p>' }),
    N('t3', 'setup.py install', 0.9, -1.2, { w: 3.8, sub: '任务：my_py_pkg', d: '<p>调用 setuptools 完成构建和安装，不经过 CMake。</p><p>加上 <code>--symlink-install</code> 时，安装的是指向源码的链接，改 Python 代码后不用重新构建。</p>' }),

    N('b', 'build/', 5.9, 2.4, { w: 3.0, kind: 'file', sub: '每个包一个子目录', d: '<p><code>build/包名/</code> 存放该包的中间文件。包与包互不干扰。</p>' }),
    N('i', 'install/', 5.9, 0.6, { w: 3.0, kind: 'file', sub: '默认每个包一个子目录', d: '<p>默认是<b>隔离安装</b>：<code>install/包名/{lib,share,include}</code>。加 <code>--merge-install</code> 则所有包合并到同一套目录（路径更短，Windows 上常用）。</p>', code: 'install/\n├── setup.bash\n├── my_cpp_pkg/\n│   ├── lib/my_cpp_pkg/talker\n│   └── share/my_cpp_pkg/\n│       ├── package.xml\n│       └── launch/\n└── my_py_pkg/…' }),
    N('l', 'log/', 5.9, -1.2, { w: 3.0, kind: 'file', sub: '每次构建的完整日志', d: '<p>构建失败时到 <code>log/latest_build/包名/stdout_stderr.log</code> 看完整输出。</p>' }),

    N('setup', 'source install/setup.bash', 10.4, 0.6, { w: 4.0, sub: '叠加工作空间', d: '<p>和 ROS 1 一样是叠加机制：</p><ul><li><code>setup.bash</code>：加载本工作空间<b>以及</b>构建时它下面的那些层；</li><li><code>local_setup.bash</code>：只加载本工作空间。</li></ul><p>它设置 <code>AMENT_PREFIX_PATH</code>、<code>CMAKE_PREFIX_PATH</code>、<code>PYTHONPATH</code>、<code>LD_LIBRARY_PATH</code>、<code>PATH</code>。</p><p>建议构建和运行用<b>不同的终端</b>，避免环境互相干扰。</p>', code: 'source /opt/ros/jazzy/setup.bash\ncolcon build\nsource install/setup.bash' }),
    N('run', 'ros2 run / launch', 10.4, -1.2, { w: 4.0, sub: '从 install/ 里找', d: '<p><code>ros2 run</code> 通过 ament 索引找到包的安装位置，再到 <code>lib/包名/</code> 下找可执行文件。<b>ROS 2 只认安装后的文件</b>。</p>', code: 'ros2 run my_cpp_pkg talker\nros2 launch my_cpp_pkg demo.launch.py\nros2 pkg prefix my_cpp_pkg' }),

    N('ac', 'ament_cmake', -8.1, -4.75, { w: 4.6, sub: 'CMake 宏：ament_package() 等', d: '<p>给 CMake 包用的宏集合：</p><ul><li><code>ament_package()</code>：放在<b>最后</b>，生成 Config.cmake、注册到 ament 索引（和 catkin_package 位置相反）；</li><li><code>ament_export_targets / ament_export_dependencies</code>：声明下游需要的东西；</li><li><code>ament_add_gtest</code>、<code>ament_lint_auto</code>：测试与代码规范检查。</li></ul><p>旧代码里常见的 <code>ament_target_dependencies()</code> 正在被标准的 <code>target_link_libraries()</code> 取代。</p>' }),
    N('ap', 'ament_python', -2.7, -4.75, { w: 4.6, sub: '纯 Python 包：setup.py + setup.cfg', d: '<p>其实就是 setuptools，外加 ROS 的约定：把 <code>package.xml</code> 和索引标记文件装到 <code>share/</code> 下；<code>setup.cfg</code> 指定可执行脚本装到 <code>lib/包名/</code>。</p>', code: '# setup.cfg\n[develop]\nscript_dir=$base/lib/my_py_pkg\n[install]\ninstall_scripts=$base/lib/my_py_pkg' }),
    N('ai', 'ament 资源索引', 2.7, -4.75, { w: 4.6, sub: 'share/ament_index/resource_index/', d: '<p>ROS 1 靠扫描目录找包，慢。ROS 2 改成<b>索引</b>：每个包安装时在 <code>share/ament_index/resource_index/packages/</code> 下放一个以包名命名的空文件。</p><p>查「有哪些包」只要列一下这个目录。插件、组件也用同样的机制登记。</p>', code: 'ros2 pkg list\nls $AMENT_PREFIX_PATH/share/ament_index/resource_index/' }),
    N('xml', 'package.xml（格式 3）', 8.1, -4.75, { w: 4.6, kind: 'file', sub: '用 <build_type> 声明构建系统', d: '<p>和 ROS 1 的清单基本一样，区别是在 <code>&lt;export&gt;</code> 里声明构建类型：<code>ament_cmake</code>、<code>ament_python</code> 或 <code>cmake</code>。</p>', code: '<package format="3">\n  <name>my_cpp_pkg</name>\n  <version>0.1.0</version>\n  <description>示例</description>\n  <maintainer email="me@example.com">me</maintainer>\n  <license>Apache-2.0</license>\n\n  <buildtool_depend>ament_cmake</buildtool_depend>\n  <depend>rclcpp</depend>\n  <depend>my_interfaces</depend>\n  <test_depend>ament_lint_auto</test_depend>\n\n  <export>\n    <build_type>ament_cmake</build_type>\n  </export>\n</package>' }),
  ],
  edges: [
    E('s1', 'colcon', { flow: true }), E('s2', 'colcon', { flow: true }), E('s3', 'colcon', { flow: true }),
    E('colcon', 't1', { flow: true }), E('colcon', 't2', { flow: true }), E('colcon', 't3', { flow: true }),
    E('t1', 't2', { label: '先完成', flow: false, dashed: true }),
    E('t1', 'b', { flow: false }), E('t2', 'i', { flow: true }), E('t3', 'l', { flow: false }),
    E('i', 'setup', { flow: true }), E('setup', 'run', { flow: false }),
  ],
  steps: [
    { title: '三种包', text: '接口包、C++ 包、Python 包。每个包在 <code>package.xml</code> 里声明自己用哪种构建系统。', focus: ['s1', 's2', 's3', 'xml'], edges: [] },
    { title: 'colcon：发现与排序', text: 'colcon 扫描 src/，读取所有 package.xml，算出构建顺序。它自己不编译任何东西。', focus: ['s1', 's2', 's3', 'colcon'] },
    { title: '每个包一个独立任务', text: '按包的构建类型分别调用 CMake 或 setuptools。互不依赖的包并行，有依赖的排队。', focus: ['colcon', 't1', 't2', 't3'], edges: ['colcon>t1', 'colcon>t2', 'colcon>t3', 't1>t2'] },
    { title: 'build / install / log', text: '每个包构建完立刻安装到 <code>install/</code>，下游包从这里找它。没有 devel 空间。', focus: ['t1', 't2', 't3', 'b', 'i', 'l'], edges: ['t1>b', 't2>i', 't3>l'] },
    { title: 'ament 的角色', text: 'ament_cmake 和 ament_python 是包内部用的构建系统；资源索引让运行时能快速找到包。', focus: ['ac', 'ap', 'ai', 'xml'], edges: [] },
    { title: 'source 环境并运行', text: '加载 <code>install/setup.bash</code> 后，<code>ros2 run</code> 才能通过索引找到你的包。', focus: ['i', 'setup', 'run'] },
  ],
};

export default [cmake, catkin, colcon];
