import {fromJS} from 'Immutable'
import {asFunctionalObject} from './index.jsy'

export function asImmutableFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: fromJS, transformFilter: true}, ...options

export function ImmutableObjectFunctional() ::
  return asImmutableFunctionalObject(this)

