'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.asObjectFunctionalClass = asObjectFunctionalClass;
exports.asFunctionalObjectOptions = asFunctionalObjectOptions;
exports.asStateTransform = asStateTransform;
exports.asFunctionalObject = asFunctionalObject;
exports.updateObservable = updateObservable;
exports.stateActionDispatch = stateActionDispatch;
exports.isObjectChanged = isObjectChanged;
exports.asDispatchCallbackPipeline = asDispatchCallbackPipeline;
const g_Observable = require('any-observable');
//const g_Observable = 'undefined' !== typeof Observable ? Observable : require('any-observable')

exports.default = asObjectFunctionalClass;
function asObjectFunctionalClass(...options) {
  if (options.useInitialValue) {
    return function (initialValue) {
      return asFunctionalObject(this, ...options, { initialValue });
    };
  } else {
    return function () {
      return asFunctionalObject(this, ...options);
    };
  }
}const ObjectFunctional = exports.ObjectFunctional = asObjectFunctionalClass();

// ---

function asFunctionalObjectOptions(...options) {
  options = Object.assign({}, ...options);

  if (options.transform) {
    const xform = asStateTransform(options.transform, 'transform');
    options.after = [].concat(options.after || [], xform);
  }

  if (options.viewTransform) {
    const xform = asStateTransform(options.viewTransform, 'viewTransform');
    options.freeze = [].concat(options.freeze || [], xform);
  }

  if (null == options.notify) {
    options.notify = updateObservable(options);
  }

  return options;
}

// ---

function asStateTransform(xform, xform_name) {
  if ('function' !== typeof xform) {
    throw new TypeError(`Expected ${xform_name}to be a function`);
  }

  return function (view) {
    for (const key of Object.keys(view)) {
      view[key] = xform(view[key]);
    }
  };
}

// ---

function asFunctionalObject(host, ...options) {
  options = asFunctionalObjectOptions(...options);

  const notify = options.notify;
  const view_props = {},
        host_props = {},
        impl_props = {};
  {
    const Observable = options.Observable || g_Observable;
    const observable = Observable.from(notify.observable || notify);
    if (null == observable || 'function' !== typeof observable.subscribe) {
      throw new TypeError(`Notify option is expected to be ES Observable compatible`);
    }

    bindObservable(observable);
  }

  const defineAction = bindActionDeclarations(notify);
  if (options.injectActions) {
    _injectActions(defineAction, options.injectActions);
  }

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

  function bindActionDeclarations(notify) {
    const dispatchAction = _asDispatchActionFunction(host, options);
    if ('function' !== typeof dispatchAction) {
      throw new TypeError(`Expected a dispatchAction(notify, actionName, actionArgs){…} function`);
    }

    const defineAction = (action, fnActionImpl) => {
      const actionName = action.name;
      const fnActionDispatch = function (...actionArgs) {
        return dispatchAction(notify, actionName, actionArgs);
      };

      impl_props[actionName] = { value: fnActionImpl || action };
      view_props[actionName] = { value: fnActionDispatch };
      Object.defineProperty(host, actionName, { configurable: true, value: fnActionDispatch });
    };

    host_props.asAction = { set: defineAction };
    return defineAction;
  }
}

// ---

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

function _injectActions(defineAction, injectActions) {
  // allow injecting actions for time traveling debugging, etc.
  for (const name of Object.keys(injectActions)) {
    const fnActionImpl = injectActions[name];
    if ('function' !== typeof fnActionImpl) {
      throw TypeError(`Overlay action "${name}" expected function, not "${typeof fnActionImpl}"`);
    }

    defineAction({ name }, fnActionImpl);
  }
}

// ---


function updateObservable(options = {}) {
  {
    const Observable = options.Observable || g_Observable;
    const observable = new Observable(addObserver);
    update.observable = observable;
    if (Symbol.observable) {
      Object.defineProperty(update, Symbol.observable, { value() {
          return observable;
        } });
    }
  }

  const _observerColl = [];
  let current = options.initial;
  return update;

  function update(next) {
    current = next;
    for (const observer of _observerColl.slice()) {
      try {
        observer.next(current);
      } catch (err) {
        removeObserver(observer);
        observer.error(err);
      }
    }
  }

  function addObserver(observer) {
    _observerColl.push(observer);
    observer.next(current);
    return () => {
      removeObserver(observer);
    };
  }

  function removeObserver(observer) {
    const idx = _observerColl.indexOf(observer);
    if (idx < 0) {
      return false;
    }
    _observerColl.splice(idx, 1);
    return true;
  }
}

// ---


function stateActionDispatch(host, options = {}) {
  let initialState = options.initialState;
  const isChanged = options.isChanged || isObjectChanged;
  const on_before = asDispatchCallbackPipeline(options.before || host.__dispatch_before__, 'before');
  const on_error = asDispatchCallbackPipeline(options.error || host.__dispatch_error__, 'error');
  const on_after = asDispatchCallbackPipeline(options.after || host.__dispatch_after__, 'after');
  const on_finish = asDispatchCallbackPipeline(options.freeze || host.__dispatch_freeze__, 'finish');
  const on_freeze = asDispatchCallbackPipeline(options.freeze || host.__dispatch_freeze__, 'freeze');

  if (undefined !== isChanged && 'function' !== typeof isChanged) {
    throw new TypeError(`Dispatch expected 'isChanged' option to be a function instance`);
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
  return __dispatch__;

  function __dispatch__(notify, actionName, actionArgs) {
    let changed;
    if (undefined === state) {
      state = initialState(host);
      changed = true;
    }

    const pre_state = state;
    const tgt = Object.create(host.__impl_proto__());
    Object.assign(tgt, pre_state);

    const ctx = { action: [actionName, actionArgs], pre_state };
    try {
      if (undefined !== on_before) {
        on_before(tgt, ctx);
      }

      try {
        // dispatch action method
        tgt[actionName].apply(tgt, actionArgs);
        // transform from impl down to a view
        Object.setPrototypeOf(tgt, host.__view_proto__());
      } catch (err) {
        // transform from impl down to a view
        Object.setPrototypeOf(tgt, host.__view_proto__());

        // handle error from action method
        if (undefined === on_error) {
          throw err;
        }

        const shouldThrow = on_error(err, tgt, ctx);
        if (false !== shouldThrow) {
          throw err;
        }
      }

      if (undefined !== on_after) {
        on_after(tgt, ctx);
      }

      // capture state after dispatching action
      const post_state = Object.assign({}, tgt);
      ctx.post_state = post_state;

      if (pre_state !== state) {
        throw new Error(`Async conflicting update of "${host.constructor.name}" occured`);
      }

      changed = changed || isChanged(pre_state, post_state);
      ctx.changed = changed;
      if (changed) {
        state = post_state;
      }

      if (undefined !== on_finish) {
        on_finish(tgt, ctx);
      }
    } finally {
      if (undefined !== on_freeze) {
        try {
          on_freeze(tgt, ctx);
        } catch (err) {
          Promise.reject(err);
        }
      }
      Object.freeze(tgt);
    }

    if (changed) {
      notify(tgt);
    }
    return tgt;
  }
}

// ---

function isObjectChanged(prev, next) {
  for (const key of Object.keys(prev)) {
    if (prev[key] !== next[key]) {
      return true;
    }
  }

  for (const key of Object.keys(prev)) {
    if (!(key in prev)) {
      return true;
    }
  }

  return false;
}

// ---

function asDispatchCallbackPipeline(callback, callback_name) {
  if (null == callback) {
    return;
  }

  if ('function' === typeof callback) {
    return callback;
  }

  if (Array.isArray(callback) || callback[Symbol.iterator]) {
    callback = Array.from(callback);
    if (callback.every(fn => 'function' === typeof fn)) {
      return (tgt, arg1, arg2) => {
        for (const fn of callback) {
          try {
            fn(tgt, arg1, arg2);
          } catch (err) {
            Promise.reject(err);
          }
        }
      };
    }
  }

  throw new TypeError(`Dispatch expected '${callback_name}' option to be a function instance or list of functions`);
}
//# sourceMappingURL=index.js.map