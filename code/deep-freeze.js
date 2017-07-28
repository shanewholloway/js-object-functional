const deepFreeze = require('deep-freeze')
const {asFunctionalObject} = require('./index')

function asDeepFreezeFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: deepFreeze, transformFilter: true}, ...options

function DeepFreezeObjectFunctional() ::
  return asDeepFreezeFunctionalObject(this)

Object.assign @ exports,
  @{} asDeepFreezeFunctionalObject, DeepFreezeObjectFunctional
