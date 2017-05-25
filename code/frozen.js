const {asFunctionalObject} = require('./index')

function asFrozenFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: Object.freeze}, ...options

function FrozenObjectFunctional() ::
  return asFrozenFunctionalObject(this)

Object.assign @ exports,
  @{} asFrozenFunctionalObject, FrozenObjectFunctional
