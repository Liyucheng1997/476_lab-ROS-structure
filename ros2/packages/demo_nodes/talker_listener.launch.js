// ros2 launch demo_nodes/talker_listener.launch.js
// 两个 talker 各说各的话题，再用重映射让 listener 去听其中一个。
export default [
  { package: 'demo_nodes', executable: 'talker', name: 'talker_cn', parameters: { greeting: '你好', period_ms: 500 } },
  { package: 'demo_nodes', executable: 'talker', name: 'talker_en', remappings: [['chatter', 'chatter_en']] },
  { package: 'demo_nodes', executable: 'listener', remappings: [['chatter', 'chatter_en']] },
];
