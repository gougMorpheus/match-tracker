// Compile browser TypeScript locally with Vite's installed esbuild. No network,
// no React renderer dependency; hook adapter lets tests call the real store API.
const { buildSync } = require('esbuild');
const Module = require('node:module');
const path = require('node:path');
exports.loadBrowserModule = (entry, mocks = {}) => {
  const { outputFiles } = buildSync({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react', 'react/jsx-runtime'], define: { 'import.meta.env': JSON.stringify({ DEV: false,
      VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-key' }) } });
  const module = new Module(path.resolve(entry));
  module.filename = path.resolve(entry);
  module.paths = Module._nodeModulePaths(process.cwd());
  const realRequire = module.require.bind(module);
  module.require = (name) => mocks[name] ?? realRequire(name);
  module._compile(outputFiles[0].text, module.filename);
  return module.exports;
};
