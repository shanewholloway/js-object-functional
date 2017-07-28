const Seamless = require('seamless-immutable')
const {asFunctionalObject} = require('./index')

function asSeamlessImmutableFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: Seamless, transformfilter: true}, ...options

function SeamlessImmutableObjectFunctional() ::
  return asSeamlessImmutableFunctionalObject(this)

Object.assign @ exports,
  @{} asSeamlessImmutableFunctionalObject, asSeamlessFunctionalObject: asSeamlessImmutableFunctionalObject
    , SeamlessImmutableObjectFunctional, SeamlessObjectFunctional: SeamlessImmutableObjectFunctional
