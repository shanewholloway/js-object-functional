const {asFunctionalObject} = require('./index')

function json_pipe(obj) ::
  return JSON.parse @ JSON.stringify @ obj

function asJSONFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: json_pipe}, ...options

function JSONObjectFunctional() ::
  return asJSONFunctionalObject(this)

function frozen_json_pipe(obj) ::
  return Object.freeze @ JSON.parse @ JSON.stringify @ obj

function asFrozenJSONFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: frozen_json_pipe}, ...options

function FrozenJSONObjectFunctional() ::
  return asFrozenJSONFunctionalObject(this)

Object.assign @ exports,
  @{} asJSONFunctionalObject, JSONObjectFunctional, json_pipe
    , asFrozenJSONFunctionalObject, FrozenJSONObjectFunctional, frozen_json_pipe
