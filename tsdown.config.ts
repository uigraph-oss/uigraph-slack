import { defineConfig } from 'tsdown'
import packageJSON from './package.json' with { type: 'json' }

export default defineConfig({
  entry: {
    index: './src/index.ts',
  },

  outDir: './dist',
  tsconfig: './tsconfig.json',

  dts: false,
  format: 'esm',
  sourcemap: false,

  target: 'ES6',
  minify: 'dce-only',

  deps: {
    neverBundle: [
      /node:/gim,
      ...getExternal((packageJSON as any).dependencies),
    ],
  },
})

function getExternal(dependencies: unknown) {
  return Object.keys((dependencies ?? {}) as Record<string, string>).map(
    (dep) => new RegExp(`(^${dep}$)|(^${dep}/)`)
  )
}
