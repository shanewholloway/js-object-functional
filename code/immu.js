const immu = require('immu')
const {asFunctionalObject} = require('./index')

function asImmuFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: immu}, ...options

function ImmuObjectFunctional() ::
  return asImmuFunctionalObject(this)

Object.assign @ exports,
  @{} asImmuFunctionalObject, ImmuObjectFunctional
