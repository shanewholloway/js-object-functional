const immu = require('immu')
const base_module = require('./index')
import asObjectFunctionalClass from './index'

const ImmuObjectFunctional = base_module.asObjectFunctionalClass({transform: immu})
const Base = ImmuObjectFunctional

Object.assign @ exports, @{} ImmuObjectFunctional, Base
