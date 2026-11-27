// node:url、node:os、node:crypto 的替身
// 打包之后源文件的位置没有意义了，统一当作在虚拟文件系统的 /ros2/ 下
export const fileURLToPath = () => '/ros2/rosidl/idl.js';
export const pathToFileURL = p => ({ href: p });

export const networkInterfaces = () => ({});

export const randomBytes = n => {
  const b = Buffer.alloc(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};

export default { fileURLToPath, pathToFileURL, networkInterfaces, randomBytes };
