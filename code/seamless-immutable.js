import Seamless from 'seamless-immutable'
import {asFunctionalObject} from './index.jsy'

export function asSeamlessImmutableFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: Seamless, transformfilter: true}, ...options

export function SeamlessImmutableObjectFunctional() ::
  return asSeamlessImmutableFunctionalObject(this)

