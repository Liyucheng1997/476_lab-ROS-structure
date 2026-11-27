import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const shim = name => fileURLToPath(new URL(`./src/lab/shims/${name}.js`, import.meta.url));

/** 命令行入口文件开头的 #! 行在浏览器里是语法错误，打包时去掉 */
const stripShebang = {
  name: 'strip-shebang',
  enforce: 'pre',
  transform(code, id) {
    if (id.includes('/ros2/cli/') && code.startsWith('#!')) return { code: code.replace(/^#!.*/, ''), map: null };
  },
};

export default defineConfig({
  plugins: [stripShebang],
  // 相对路径：部署在 GitHub Pages 的子目录（/仓库名/）下也能找到资源
  base: './',
  // 「实机运行」页把 ros2/ 目录的代码原样搬进浏览器跑，这里把它用到的 Node 内置模块换成浏览器里的替身
  resolve: {
    alias: {
      'node:fs': shim('fs'),
      'node:path': shim('path'),
      'node:url': shim('misc'),
      'node:os': shim('misc'),
      'node:crypto': shim('misc'),
      'node:dgram': shim('dgram'),
      'node:events': shim('events'),
      'node:child_process': shim('child_process'),
      '#rcljs': fileURLToPath(new URL('./ros2/rcljs/index.js', import.meta.url)),
    },
  },
  build: { target: 'es2022' },            // 节点脚本用了顶层 await
  worker: { format: 'es', plugins: () => [stripShebang] },   // 进程（Web Worker）里要按需加载模块
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
