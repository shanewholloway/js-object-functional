import pkg from './package.json'
import {minify} from 'uglify-es'
import rpi_uglify from 'rollup-plugin-uglify'
import rpi_babel from 'rollup-plugin-babel'

const sourcemap = 'inline'

const plugins = [jsy_plugin()]
const ugly = { compress: {warnings: false}, output: {comments: false}, sourceMap: false }
const prod_plugins = plugins.concat([rpi_uglify(ugly, minify)])

const core = [
	{ input: 'code/index.jsy',
		output: [
      { file: pkg.main, format: 'cjs', exports:'named' },
      { file: pkg.module, format: 'es' }],
    sourcemap, external:[], plugins },

	{ input: 'code/index.jsy',
		output: { file: pkg.browser, format: 'amd', exports:'named' },
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
      { file: `dist/${name}.js`, format: 'cjs' },
      { file: `dist/${name}.mjs`, format: 'es' }],
    sourcemap, external:external || [name], plugins }))


export default [].concat(core, adapters)


function jsy_plugin() {
  const jsy_preset = [ 'jsy/lean', {
    no_stage_3: true, modules: false,
    targets: { node: "7.1", browsers: "> 5%" }} ]
  return rpi_babel({
    exclude: 'node_modules/**',
    presets: [ jsy_preset ],
    plugins: [],
    babelrc: false }) }

