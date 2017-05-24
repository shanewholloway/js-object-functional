'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ObjectFunctional = ObjectFunctional;
exports.asFunctionalObject = asFunctionalObject;
exports.updateObservable = updateObservable;
exports.stateActionDispatch = stateActionDispatch;
exports.asDispatchCallbackPipeline = asDispatchCallbackPipeline;
exports.isObjectChanged = isObjectChanged;
exports.bindStateTransform = bindStateTransform;
function ObjectFunctional() {
  return asFunctionalObject(this);
}

// ---

function asFunctionalObject(host, ...options) {
  {
    // initialize options
    options = Object.assign({}, ...options);

    if (null == options.notify) {
      options.notify = updateObservable(options);
    }
  }

  // setup notification, observable, and props
  const notify = options.notify;
  const view_props = {}; // properties for immutable views -- where actions are grafted on
  const host_props = {}; // properties to overlay on `host` paramter; uses immutable view actions dispatch
  const impl_props = {}; // properties for mutable clones -- where actions use specified implementation
  {
    const Observable = _findUsableObservable(options);
    const observable = Observable.from(notify.observable || notify);
    if (null == observable || 'function' !== typeof observable.subscribe) {
      throw new TypeError(`Notify option is expected to be ES Observable compatible`);
    }

    bindObservable(observable);
  }

  // setup asAction setter hack -- in lieu of ES standard decorators
  const defineAction = bindActionDeclarations(notify);
  if (options.injectActions) {
    // allow injecting actions for time traveling debugging, etc.
    for (const name of Object.keys(options.injectActions)) {
      const fnActionImpl = options.injectActions[name];
      if ('function' !== typeof fnActionImpl) {
        throw TypeError(`Overlay action "${name}" expected as function, not "${typeof fnActionImpl}"`);
      }

      defineAction({ name }, fnActionImpl);
    }
  }

  {
    // view/impl prototype definitions and host prototype update 
    host_props.__impl_proto__ = { value() {
        return Object.create(Object.getPrototypeOf(host), impl_props);
      } };

    host_props.__view_proto__ = { value() {
        return Object.create(Object.getPrototypeOf(host), view_props);
      } };

    Object.defineProperties(host, host_props);
  }

  // return a frozen clone of the host object
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
    let dispatchAction;
    if (null != options.dispatchAction) {
      dispatchAction = options.dispatchAction;
      if ('function' !== typeof dispatchAction) {
        throw new TypeError(`Expected a dispatchAction(notify, actionName, actionArgs){…} function`);
      }
    } else if ('function' === typeof host.__dispatch__) {
      dispatchAction = function (notify, actionName, actionArgs) {
        return host.__dispatch__(notify, actionName, actionArgs);
      };
    } else {
      dispatchAction = stateActionDispatch(host, options);
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

function updateObservable(options = {}) {
  {
    const Observable = _findUsableObservable(options);
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
  if (options.transform) {
    const xform = bindStateTransform(options.transform, 'transform');
    options.after = [].concat(options.after || [], xform);
  }

  if (options.viewTransform) {
    const xform = bindStateTransform(options.viewTransform, 'viewTransform');
    options.finish = [].concat(options.finish || [], xform);
  }

  const isChanged = options.isChanged || isObjectChanged;
  const on_before = asDispatchCallbackPipeline(options.before, host.__dispatch_before__, 'before');
  const on_error = asDispatchCallbackPipeline(options.error, host.__dispatch_error__, 'error');
  const on_after = asDispatchCallbackPipeline(options.after, host.__dispatch_after__, 'after');
  const on_finish = asDispatchCallbackPipeline(options.finish, host.__dispatch_freeze__, 'finish');
  const on_freeze = asDispatchCallbackPipeline(options.freeze, host.__dispatch_freeze__, 'freeze');

  if (undefined !== isChanged && 'function' !== typeof isChanged) {
    throw new TypeError(`Dispatch expected 'isChanged' option to be a function instance`);
  }

  let initialState = options.initialState;
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

function asDispatchCallbackPipeline(callback, host_callback, callback_name) {
  if (null != host_callback) {
    callback = [].conact(callback || [], host_callback);
  } else if (null == callback) {
    return;
  }

  if ('function' === typeof callback) {
    return callback;
  }

  if (Array.isArray(callback) || callback[Symbol.iterator]) {
    const callbackList = Array.from(callback).filter(e => null != e);

    if (callbackList.some(cb => 'function' !== typeof cb)) {
      throw new TypeError(`Dispatch expected '${callback_name}' option to only include functions in list`);
    }

    if (callbackList.length <= 1) {
      callback = callbackList.pop();
    } else {
      callback = function (tgt, arg1, arg2) {
        for (const cb of callbackList) {
          try {
            cb(tgt, arg1, arg2);
          } catch (err) {
            Promise.reject(err);
          }
        }
      };
    }
  }

  if ('function' !== typeof callback) {
    throw new TypeError(`Dispatch expected '${callback_name}' option to be a function instance or list of functions`);
  }
  return callback;
}

// ---

function isObjectChanged(prev, next) {
  for (const key of Object.keys(next)) {
    if (!(key in prev)) {
      return true; // added
    }
  }for (const key of Object.keys(prev)) {
    if (prev[key] !== next[key]) {
      return true; // changed
    }if (!(key in next)) {
      return true; // removed
    }
  }return false;
}

// ---

function bindStateTransform(xform, xform_name) {
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

function _findUsableObservable(options) {
  if (undefined !== options.Observable) {
    return options.Observable;
  }
  if (undefined !== asFunctionalObject.Observable) {
    return asFunctionalObject.Observable;
  }
  if ('undefined' !== typeof window && undefined !== window.Observable) {
    return window.Observable;
  }
  if ('undefined' !== typeof global && undefined !== global.Observable) {
    return global.Observable;
  }
  throw new TypeError(`Unable to locate an ES Observable implementation`);
}
//# sourceMappingURL=index.js.map