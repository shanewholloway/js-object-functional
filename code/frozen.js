import {asFunctionalObject} from './index.jsy'

export function asFrozenFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: Object.freeze, transformFilter: true}, ...options

export function FrozenObjectFunctional() ::
  return asFrozenFunctionalObject(this)

