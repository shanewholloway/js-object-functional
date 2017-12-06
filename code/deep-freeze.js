import deepFreeze from 'deep-freeze'
import {asFunctionalObject} from './index.jsy'

export function asDeepFreezeFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: deepFreeze, transformFilter: true}, ...options

export function DeepFreezeObjectFunctional() ::
  return asDeepFreezeFunctionalObject(this)

