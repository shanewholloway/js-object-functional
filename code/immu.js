import immu from 'immu'
import {asFunctionalObject} from './index.jsy'

export function asImmuFunctionalObject(host, ...options) ::
  return asFunctionalObject @ host, {transform: immu, transformFilter: true}, ...options

export function ImmuObjectFunctional() ::
  return asImmuFunctionalObject(this)

