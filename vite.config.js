import { defineConfig } from 'vite';

// 相对路径：部署在 GitHub Pages 的子目录（/仓库名/）下也能找到资源
export default defineConfig({ base: './' });
