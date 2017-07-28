import {fromJS} from 'Immutable'
import {asFunctionalObject} from './index'

function asImmutableFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: fromJS, transformFilter: true}, ...options

function ImmutableObjectFunctional() ::
  return asImmutableFunctionalObject(this)

Object.assign @ exports,
  @{} asImmutableFunctionalObject, ImmutableObjectFunctional
