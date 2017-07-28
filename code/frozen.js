const {asFunctionalObject} = require('./index')

function asFrozenFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: Object.freeze, transformFilter: true}, ...options

function FrozenObjectFunctional() ::
  return asFrozenFunctionalObject(this)

Object.assign @ exports,
  @{} asFrozenFunctionalObject, FrozenObjectFunctional
