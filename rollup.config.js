import { createRollupConfig } from 'rollup-library-template';
import define from 'rollup-plugin-define';

const config = createRollupConfig({
  input: './src/worker.ts',
  output: {
    dir: `./dist`,
    sourcemap: true,
    format: 'es',
  },
  minify: true,
  nodeResolve: {
    browser: false,
  },
});

config.plugins.unshift(
  define({
    replacements: {
      'process.env.NODE_ENV': '"development"',
    },
  })
);

// Roll up configs
export default [config];
