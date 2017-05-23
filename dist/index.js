'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Base = exports.ObjectFunctional = undefined;
exports.asFunctionalObject = asFunctionalObject;
exports.stateUpdateObservable = stateUpdateObservable;
exports.stateActionDispatch = stateActionDispatch;
exports.isObjectChanged = isObjectChanged;

var _anyObservable = require('any-observable');

var _anyObservable2 = _interopRequireDefault(_anyObservable);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class ObjectFunctional {
  constructor() {
    return asFunctionalObject(this);
  }
}exports.ObjectFunctional = ObjectFunctional;
const Base = exports.Base = ObjectFunctional;

exports.default = asFunctionalObject;
function asFunctionalObject(host, options = {}) {
  const notify = options.notify || stateUpdateObservable();

  const view_props = {},
        host_props = {},
        impl_props = {};
  if (undefined !== notify.observable) {
    bindObservable(notify.observable);
  }

  bindActionDeclarations(notify, _asDispatchActionFunction(host, options));

  host_props.__impl_proto__ = { value() {
      return Object.create(Object.getPrototypeOf(host), impl_props);
    } };

  host_props.__view_proto__ = { value() {
      return Object.create(Object.getPrototypeOf(host), view_props);
    } };

  Object.defineProperties(host, host_props);
  return Object.freeze(Object.create(host));

  function bindObservable(observable) {
    for (const props of [view_props, host_props, impl_props]) {
      props.subscribe = { value: observable.subscribe.bind(observable) };
      props.observable = { value() {
          return observable;
        } };
      if (null != Symbol.observable) {
        props[Symbol.observable] = props.observable;
      }
    }
  }

  function bindActionDeclarations(notify, dispatchAction) {
    if ('function' !== typeof dispatchAction) {
      throw new TypeError(`Expected a dispatchAction(notify, actionName, actionArgs){…} function`);
    }

    host_props.asAction = { set: action => {
        const actionName = action.name;
        const fnAction = function (...args) {
          return dispatchAction(notify, actionName, args);
        };

        impl_props[actionName] = { value: action };
        view_props[actionName] = { value: fnAction };
        Object.defineProperty(host, actionName, { configurable: true, value: fnAction });
      } };
  }
}

function _asDispatchActionFunction(host, options) {
  if (null != options.dispatchAction) {
    return options.dispatchAction;
  }

  if ('function' === typeof host.__dispatch__) {
    return function (notify, actionName, actionArgs) {
      return host.__dispatch__(notify, actionName, actionArgs);
    };
  }

  return stateActionDispatch(host, options);
}

// ---


function stateUpdateObservable(initialState, onNotifyError) {
  const _observerColl = [];

  let lastState = initialState;
  if (null == onNotifyError) {
    onNotifyError = err => console.error("Notification error ::\n", err);
  }

  update.observable = new _anyObservable2.default(addObserver);
  return update;

  function update(state) {
    lastState = state;
    for (const ob of _observerColl) {
      try {
        ob.next(state);
      } catch (err) {
        onNotifyError(err);
      }
    }
  }

  function addObserver(observer) {
    _observerColl.push(observer);
    observer.next(lastState);
    return () => {
      const idx = _observerColl.indexOf(observer);
      if (idx >= 0) {
        _observerColl.splice(idx, 1);
      }
    };
  }
}

// ---


function stateActionDispatch(host, options = {}) {
  let initialState = options.initialState;
  const isChanged = options.isChanged || isObjectChanged;
  const on_before = options.before || host.__dispatch_before__;
  const on_error = options.error || host.__dispatch_error__;
  const on_after = options.after || host.__dispatch_after__;

  if (undefined !== isChanged && 'function' !== typeof isChanged) {
    throw new TypeError(`Dispatch expected 'isChanged' option to be a function instance`);
  }
  if (undefined !== on_before && 'function' !== typeof on_before) {
    throw new TypeError(`Dispatch expected 'before' option to be a function instance`);
  }
  if (undefined !== on_error && 'function' !== typeof on_error) {
    throw new TypeError(`Dispatch expected 'error' option to be a function instance`);
  }
  if (undefined !== on_after && 'function' !== typeof on_after) {
    throw new TypeError(`Dispatch expected 'after' option to be a function instance`);
  }

  if ('function' !== typeof initialState) {
    if ('function' === typeof host.initState) {
      initialState = host => host.initState();
    } else {
      const _init_state = Object.assign({}, initialState);
      initialState = host => _init_state;
    }
  }

  let state = undefined;
  return function (notify, actionName, actionArgs) {
    if (undefined === state) {
      state = initialState(host);
    }

    const pre_state = state;

    const tgt = Object.create(host.__impl_proto__());
    Object.assign(tgt, state);

    if (undefined !== on_before) {
      on_before(tgt, { action: [actionName, actionArgs], state: pre_state });
    }

    let post_state;
    try {
      tgt[actionName](...actionArgs);
      post_state = Object.assign({}, tgt);
    } catch (err) {
      if (undefined === on_error) {
        throw err;
      }

      on_error(err, tgt, { action: [actionName, actionArgs], pre_state });
    } finally {
      // degrade into a view-only
      Object.setPrototypeOf(tgt, host.__view_proto__());
      Object.freeze(tgt);
    }

    if (pre_state !== state) {
      throw new Error(`Async conflicting update of "${host.constructor.name}" occured`);
    }

    const changed = isChanged(pre_state, post_state);
    if (changed) {
      state = post_state;
    }

    if (undefined !== on_after) {
      on_after(tgt, { changed, action: [actionName, actionArgs], pre_state, post_state });
    }

    if (changed) {
      notify(tgt);
    }

    return tgt;
  };
}

// ---

function isObjectChanged(prev, next) {
  for (const key in prev) {
    if (prev[key] !== next[key]) {
      return true;
    }
  }

  for (const key in next) {
    if (!(key in prev)) {
      return true;
    }
  }

  return false;
}
//# sourceMappingURL=index.js.map