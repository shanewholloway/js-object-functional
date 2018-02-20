import pkg from './package.json'
import {minify} from 'uglify-es'
import rpi_uglify from 'rollup-plugin-uglify'
import rpi_jsy from 'rollup-plugin-jsy-babel'

const sourcemap = 'inline'

const plugins = [rpi_jsy()]
const ugly = { compress: {warnings: false}, output: {comments: false}, sourceMap: false }
const prod_plugins = plugins.concat([rpi_uglify(ugly, minify)])

const core = [
  { input: 'code/index.jsy',
    output: [
      { file: pkg.module, format: 'es', sourcemap },
      { file: pkg.main, format: 'cjs', exports:'named', sourcemap },
      { file: 'umd/object-functional.js', format: 'umd', name: 'object-functional', exports:'named' },
    ],
    external:[], plugins },

  prod_plugins &&
    { input: 'code/index.jsy',
      output: { file: pkg.browser, format: 'umd', name: 'object-functional', exports:'named' },
      external:[], plugins: prod_plugins },
]

const adapters = [
  {name: 'deep-freeze'},
  {name: 'frozen'},
  {name: 'immu'},
  {name: 'immutable', external:['Immutable']},
  {name: 'json'},
  {name: 'seamless-immutable'},
].map(({name, external}) => (
  { input: `code/${name}.js`,
    output: [
      { file: `cjs/${name}.js`, format: 'cjs', sourcemap },
      { file: `esm/${name}.js`, format: 'es', sourcemap }],
    external:external || [name], plugins }))


export default [].concat(core, adapters)
