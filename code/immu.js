const immu = require('immu')
const base_module = require('./index')
const {asObjectFunctionalClass} = require('./index')

const asImmuFunctionalObject = (host, ...options) => ::
  base_module.asFunctionalObject @ host, {transform: immu}, ...options

const ImmuObjectFunctional =
  base_module.asObjectFunctionalClass({transform: immu})

Object.assign @ exports,
  @{} asImmuFunctionalObject, ImmuObjectFunctional
