import {asFunctionalObject} from './index.jsy'

export function json_pipe(obj) ::
  return JSON.parse @ JSON.stringify @ obj

export function asJSONFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: json_pipe}, ...options

export function JSONObjectFunctional() ::
  return asJSONFunctionalObject(this)

export function frozen_json_pipe(obj) ::
  return Object.freeze @ JSON.parse @ JSON.stringify @ obj

export function asFrozenJSONFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: frozen_json_pipe}, ...options

export function FrozenJSONObjectFunctional() ::
  return asFrozenJSONFunctionalObject(this)

