'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var immu = _interopDefault(require('immu'));

// ---

function asFunctionalObject(host, ...options) {
  // initialize options
  options = Object.assign({}, ...options);
  const notify = null == options.notify ? bindUpdateFunction(host, options) : options.notify;

  // setup asAction setter hack -- in lieu of ES standard decorators
  const { dispatchAction, defineAction } = bindActionDeclarations(notify);
  if (options.actions) {
    defineAction(options.actions);
  }

  const subscribe = { value(...args) {
      return notify.subscribe(...args);
    } };
  const __impl_proto__ = Object.create(Object.getPrototypeOf(host), { subscribe });
  const __view_proto__ = Object.create(Object.getPrototypeOf(host), { subscribe });

  Object.defineProperties(host, {
    subscribe, asAction: { set: defineAction },
    __impl_proto__: { configurable: true, value: __impl_proto__ },
    __view_proto__: { configurable: true, value: __view_proto__ } });

  // initialize the internal stat with initial view
  dispatchAction(notify, null, [], null);

  // return a frozen clone of the host object
  return Object.freeze(Object.create(host));

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

    const defineAction = actionList => {
      if ('function' === typeof actionList) {
        actionList = [[actionList.name, actionList]];
      } else if ('string' === typeof actionList) {
        actionList = [[actionList, host[actionList]]];
      } else if (!Array.isArray(actionList)) {
        actionList = Object.entries(actionList);
      } else if ('string' === typeof actionList[0]) {
        actionList = [actionList];
      }

      const impl_props = {},
            view_props = {},
            host_props = {};
      for (const [actionName, fnAction] of actionList) {
        if (!actionName) {
          throw new TypeError(`Action name not found`);
        }
        if ('function' !== typeof fnAction) {
          throw new TypeError(`Expected action "${actionName}" to be a function, but found "${typeof fnAction}"`);
        }

        const fnDispatch = function (...actionArgs) {
          return dispatchAction(notify, actionName, actionArgs);
        };

        impl_props[actionName] = { value: fnAction };
        view_props[actionName] = { value: fnDispatch };
        host_props[actionName] = { value: fnDispatch, configurable: true };
      }

      Object.defineProperties(__impl_proto__, impl_props);
      Object.defineProperties(__view_proto__, view_props);
      Object.defineProperties(host, host_props);
    };

    return { dispatchAction, defineAction };
  }
}

// ---

function bindUpdateFunction() {
  let notifyList = [];
  let current;

  update.subscribe = subscribe;
  return update;

  function update(next) {
    if (current === next) {
      return;
    }

    current = next;
    for (const cb of notifyList) {
      try {
        cb(current);
      } catch (err) {
        discard(cb);
      }
    }
  }

  function subscribe(...args) {
    const callback = args.pop();
    const skipInitialCall = args[0];

    if (-1 !== notifyList.indexOf(callback)) {
      return;
    }
    if ('function' !== typeof callback) {
      throw new TypeError(`Please subscribe with a function`);
    }

    notifyList = notifyList.concat([callback]);
    if (!skipInitialCall) {
      callback(current);
    }
    unsubscribe.unsubscribe = unsubscribe;
    return unsubscribe;

    function unsubscribe() {
      discard(callback);
    }
  }

  function discard(callback) {
    notifyList = notifyList.filter(e => callback !== e);
  }
}

// ---


function stateActionDispatch(host, options = {}) {
  if (options.transform) {
    const xform = bindStateTransform(options.transform, 'transform', options.transformFilter);
    options.after = [].concat(options.after || [], xform);
  }

  if (options.viewTransform) {
    const xform = bindStateTransform(options.viewTransform, 'viewTransform', options.viewTransformFilter);
    options.changed = [].concat(options.changed || [], xform);
  }

  const isChanged = options.isChanged || host.__is_changed__ || isObjectChanged;
  const on_before = asDispatchCallbackPipeline(options.before, host.__dispatch_before__, 'before');
  const on_error = asDispatchCallbackPipeline(options.error, host.__dispatch_error__, 'error');
  const on_after = asDispatchCallbackPipeline(options.after, host.__dispatch_after__, 'after');
  const on_changed = asDispatchCallbackPipeline(options.changed, host.__dispatch_changed__, 'changed');
  const on_freeze = asDispatchCallbackPipeline(options.freeze, host.__dispatch_freeze__, 'freeze');

  if (undefined !== isChanged && 'function' !== typeof isChanged) {
    throw new TypeError(`Dispatch expected 'isChanged' option to be a function instance`);
  }

  let state = {},
      state_summary,
      tip_view;
  return __dispatch__;

  function __dispatch__(notify, actionName, actionArgs, view) {
    const pre_state = state;
    const tgt = Object.create(host.__impl_proto__);

    Object.assign(tgt, state);

    let result;
    const ctx = { action: [actionName, actionArgs, view],
      pre_state, isTipView: tip_view === view && view !== undefined };

    try {
      if (undefined !== on_before) {
        on_before(tgt, ctx);
      }

      try {
        // dispatch action method
        if (actionName) {
          result = tgt[actionName].apply(tgt, actionArgs);
          ctx.result = result;
        } else {
          ctx.result = result = tip_view = tgt;
        }

        // transform from impl down to a view
        Object.setPrototypeOf(tgt, host.__view_proto__);
      } catch (err) {
        // transform from impl down to a view
        Object.setPrototypeOf(tgt, host.__view_proto__);

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

      const change_summary = isChanged(pre_state, post_state, state_summary, ctx);
      if (change_summary) {
        ctx.changed = true;
        state = post_state;
        state_summary = change_summary;
        tip_view = tgt;

        if (undefined !== on_changed) {
          on_changed(tgt, ctx);
        }
      } else if (tgt === result) {
        ctx.result = result = tip_view;
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

    notify(tip_view);
    return result;
  }
}

// ---

function asDispatchCallbackPipeline(callback, host_callback, callback_name) {
  if (null != host_callback) {
    callback = [].concat(host_callback, callback || []);
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
  if (prev === undefined) {
    return next !== undefined;
  }

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

function bindStateTransform(xform, xform_name, xform_filter) {
  if ('function' !== typeof xform) {
    throw new TypeError(`Expected ${xform_name}to be a function`);
  }

  if (true === xform_filter || 'not-frozen') {
    xform_filter = attr => !Object.isFrozen(attr);
  }

  return function (tgt) {
    for (const key of Object.keys(tgt)) {
      const attr = tgt[key];
      if (!xform_filter || xform_filter(attr, key)) {
        tgt[key] = xform(attr);
      }
    }
  };
}

function asImmuFunctionalObject(host, ...options) {
  return asFunctionalObject(host, { transform: immu, transformFilter: true }, ...options);
}

function ImmuObjectFunctional() {
  return asImmuFunctionalObject(this);
}

exports.asImmuFunctionalObject = asImmuFunctionalObject;
exports.ImmuObjectFunctional = ImmuObjectFunctional;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1tdS5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9pbmRleC5qc3kiLCIuLi9jb2RlL2ltbXUuanMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIE9iamVjdEZ1bmN0aW9uYWwoKSA6OlxuICByZXR1cm4gYXNGdW5jdGlvbmFsT2JqZWN0KHRoaXMpXG5cbi8vIC0tLVxuXG5leHBvcnQgZnVuY3Rpb24gYXNGdW5jdGlvbmFsT2JqZWN0KGhvc3QsIC4uLm9wdGlvbnMpIDo6XG4gIC8vIGluaXRpYWxpemUgb3B0aW9uc1xuICBvcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgLi4ub3B0aW9ucylcbiAgY29uc3Qgbm90aWZ5ID0gbnVsbCA9PSBvcHRpb25zLm5vdGlmeVxuICAgID8gYmluZFVwZGF0ZUZ1bmN0aW9uKGhvc3QsIG9wdGlvbnMpXG4gICAgOiBvcHRpb25zLm5vdGlmeVxuXG5cblxuICAvLyBzZXR1cCBhc0FjdGlvbiBzZXR0ZXIgaGFjayAtLSBpbiBsaWV1IG9mIEVTIHN0YW5kYXJkIGRlY29yYXRvcnNcbiAgY29uc3Qge2Rpc3BhdGNoQWN0aW9uLCBkZWZpbmVBY3Rpb259ID0gYmluZEFjdGlvbkRlY2xhcmF0aW9ucyhub3RpZnkpXG4gIGlmIG9wdGlvbnMuYWN0aW9ucyA6OiBkZWZpbmVBY3Rpb24ob3B0aW9ucy5hY3Rpb25zKVxuXG4gIGNvbnN0IHN1YnNjcmliZSA9IEB7fSB2YWx1ZSguLi5hcmdzKSA6OiByZXR1cm4gbm90aWZ5LnN1YnNjcmliZSguLi5hcmdzKVxuICBjb25zdCBfX2ltcGxfcHJvdG9fXyA9IE9iamVjdC5jcmVhdGUgQCBPYmplY3QuZ2V0UHJvdG90eXBlT2YoaG9zdCksIEB7fSBzdWJzY3JpYmVcbiAgY29uc3QgX192aWV3X3Byb3RvX18gPSBPYmplY3QuY3JlYXRlIEAgT2JqZWN0LmdldFByb3RvdHlwZU9mKGhvc3QpLCBAe30gc3Vic2NyaWJlXG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBob3N0LCBAe31cbiAgICBzdWJzY3JpYmUsIGFzQWN0aW9uOiBAe30gc2V0OiBkZWZpbmVBY3Rpb25cbiAgICBfX2ltcGxfcHJvdG9fXzogQHt9IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IF9faW1wbF9wcm90b19fXG4gICAgX192aWV3X3Byb3RvX186IEB7fSBjb25maWd1cmFibGU6IHRydWUsIHZhbHVlOiBfX3ZpZXdfcHJvdG9fX1xuXG5cbiAgLy8gaW5pdGlhbGl6ZSB0aGUgaW50ZXJuYWwgc3RhdCB3aXRoIGluaXRpYWwgdmlld1xuICBkaXNwYXRjaEFjdGlvbihub3RpZnksIG51bGwsIFtdLCBudWxsKVxuXG4gIC8vIHJldHVybiBhIGZyb3plbiBjbG9uZSBvZiB0aGUgaG9zdCBvYmplY3RcbiAgcmV0dXJuIE9iamVjdC5mcmVlemUgQCBPYmplY3QuY3JlYXRlIEAgaG9zdFxuXG5cbiAgZnVuY3Rpb24gYmluZEFjdGlvbkRlY2xhcmF0aW9ucyhub3RpZnkpIDo6XG4gICAgbGV0IGRpc3BhdGNoQWN0aW9uXG4gICAgaWYgbnVsbCAhPSBvcHRpb25zLmRpc3BhdGNoQWN0aW9uIDo6XG4gICAgICBkaXNwYXRjaEFjdGlvbiA9IG9wdGlvbnMuZGlzcGF0Y2hBY3Rpb25cbiAgICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBkaXNwYXRjaEFjdGlvbiA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBFeHBlY3RlZCBhIGRpc3BhdGNoQWN0aW9uKG5vdGlmeSwgYWN0aW9uTmFtZSwgYWN0aW9uQXJncyl74oCmfSBmdW5jdGlvbmApXG4gICAgZWxzZSBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaG9zdC5fX2Rpc3BhdGNoX18gOjpcbiAgICAgIGRpc3BhdGNoQWN0aW9uID0gZnVuY3Rpb24obm90aWZ5LCBhY3Rpb25OYW1lLCBhY3Rpb25BcmdzKSA6OlxuICAgICAgICByZXR1cm4gaG9zdC5fX2Rpc3BhdGNoX18obm90aWZ5LCBhY3Rpb25OYW1lLCBhY3Rpb25BcmdzKVxuICAgIGVsc2UgOjpcbiAgICAgIGRpc3BhdGNoQWN0aW9uID0gc3RhdGVBY3Rpb25EaXNwYXRjaChob3N0LCBvcHRpb25zKVxuXG5cbiAgICBjb25zdCBkZWZpbmVBY3Rpb24gPSAoYWN0aW9uTGlzdCkgPT4gOjpcbiAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBhY3Rpb25MaXN0IDo6XG4gICAgICAgIGFjdGlvbkxpc3QgPSBAW10gQFtdIGFjdGlvbkxpc3QubmFtZSwgYWN0aW9uTGlzdFxuICAgICAgZWxzZSBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGFjdGlvbkxpc3QgOjpcbiAgICAgICAgYWN0aW9uTGlzdCA9IEBbXSBAW10gYWN0aW9uTGlzdCwgaG9zdFthY3Rpb25MaXN0XVxuICAgICAgZWxzZSBpZiAhIEFycmF5LmlzQXJyYXkgQCBhY3Rpb25MaXN0IDo6XG4gICAgICAgIGFjdGlvbkxpc3QgPSBPYmplY3QuZW50cmllcyhhY3Rpb25MaXN0KVxuICAgICAgZWxzZSBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGFjdGlvbkxpc3RbMF0gOjpcbiAgICAgICAgYWN0aW9uTGlzdCA9IEBbXSBhY3Rpb25MaXN0XG5cblxuICAgICAgY29uc3QgaW1wbF9wcm9wcz17fSwgdmlld19wcm9wcz17fSwgaG9zdF9wcm9wcyA9IHt9XG4gICAgICBmb3IgY29uc3QgW2FjdGlvbk5hbWUsIGZuQWN0aW9uXSBvZiBhY3Rpb25MaXN0IDo6XG4gICAgICAgIGlmICEgYWN0aW9uTmFtZSA6OlxuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgQWN0aW9uIG5hbWUgbm90IGZvdW5kYFxuICAgICAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZm5BY3Rpb24gOjpcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkIGFjdGlvbiBcIiR7YWN0aW9uTmFtZX1cIiB0byBiZSBhIGZ1bmN0aW9uLCBidXQgZm91bmQgXCIke3R5cGVvZiBmbkFjdGlvbn1cImBcblxuICAgICAgICBjb25zdCBmbkRpc3BhdGNoID0gZnVuY3Rpb24gKC4uLmFjdGlvbkFyZ3MpIDo6XG4gICAgICAgICAgcmV0dXJuIGRpc3BhdGNoQWN0aW9uKG5vdGlmeSwgYWN0aW9uTmFtZSwgYWN0aW9uQXJncylcblxuICAgICAgICBpbXBsX3Byb3BzW2FjdGlvbk5hbWVdID0gQHt9IHZhbHVlOiBmbkFjdGlvblxuICAgICAgICB2aWV3X3Byb3BzW2FjdGlvbk5hbWVdID0gQHt9IHZhbHVlOiBmbkRpc3BhdGNoXG4gICAgICAgIGhvc3RfcHJvcHNbYWN0aW9uTmFtZV0gPSBAe30gdmFsdWU6IGZuRGlzcGF0Y2gsIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIF9faW1wbF9wcm90b19fLCBpbXBsX3Byb3BzXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIF9fdmlld19wcm90b19fLCB2aWV3X3Byb3BzXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIGhvc3QsIGhvc3RfcHJvcHNcblxuICAgIHJldHVybiBAe30gZGlzcGF0Y2hBY3Rpb24sIGRlZmluZUFjdGlvblxuXG5cbi8vIC0tLVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFVwZGF0ZUZ1bmN0aW9uKCkgOjpcbiAgbGV0IG5vdGlmeUxpc3QgPSBbXVxuICBsZXQgY3VycmVudFxuXG4gIHVwZGF0ZS5zdWJzY3JpYmUgPSBzdWJzY3JpYmVcbiAgcmV0dXJuIHVwZGF0ZVxuXG4gIGZ1bmN0aW9uIHVwZGF0ZShuZXh0KSA6OlxuICAgIGlmIGN1cnJlbnQgPT09IG5leHQgOjogcmV0dXJuXG5cbiAgICBjdXJyZW50ID0gbmV4dFxuICAgIGZvciBjb25zdCBjYiBvZiBub3RpZnlMaXN0IDo6XG4gICAgICB0cnkgOjogY2IoY3VycmVudClcbiAgICAgIGNhdGNoIGVyciA6OiBkaXNjYXJkKGNiKVxuXG4gIGZ1bmN0aW9uIHN1YnNjcmliZSguLi5hcmdzKSA6OlxuICAgIGNvbnN0IGNhbGxiYWNrID0gYXJncy5wb3AoKVxuICAgIGNvbnN0IHNraXBJbml0aWFsQ2FsbCA9IGFyZ3NbMF1cblxuICAgIGlmIC0xICE9PSBub3RpZnlMaXN0LmluZGV4T2YoY2FsbGJhY2spIDo6XG4gICAgICByZXR1cm5cbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2FsbGJhY2sgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgUGxlYXNlIHN1YnNjcmliZSB3aXRoIGEgZnVuY3Rpb25gXG5cbiAgICBub3RpZnlMaXN0ID0gbm90aWZ5TGlzdC5jb25jYXQgQCBbY2FsbGJhY2tdXG4gICAgaWYgISBza2lwSW5pdGlhbENhbGwgOjpcbiAgICAgIGNhbGxiYWNrKGN1cnJlbnQpXG4gICAgdW5zdWJzY3JpYmUudW5zdWJzY3JpYmUgPSB1bnN1YnNjcmliZVxuICAgIHJldHVybiB1bnN1YnNjcmliZVxuXG4gICAgZnVuY3Rpb24gdW5zdWJzY3JpYmUoKSA6OlxuICAgICAgZGlzY2FyZChjYWxsYmFjaylcblxuICBmdW5jdGlvbiBkaXNjYXJkKGNhbGxiYWNrKSA6OlxuICAgIG5vdGlmeUxpc3QgPSBub3RpZnlMaXN0XG4gICAgICAuZmlsdGVyIEAgZSA9PiBjYWxsYmFjayAhPT0gZVxuXG4vLyAtLS1cblxuXG5leHBvcnQgZnVuY3Rpb24gc3RhdGVBY3Rpb25EaXNwYXRjaChob3N0LCBvcHRpb25zPXt9KSA6OlxuICBpZiBvcHRpb25zLnRyYW5zZm9ybSA6OlxuICAgIGNvbnN0IHhmb3JtID0gYmluZFN0YXRlVHJhbnNmb3JtKG9wdGlvbnMudHJhbnNmb3JtLCAndHJhbnNmb3JtJywgb3B0aW9ucy50cmFuc2Zvcm1GaWx0ZXIpXG4gICAgb3B0aW9ucy5hZnRlciA9IFtdLmNvbmNhdCBAIG9wdGlvbnMuYWZ0ZXIgfHwgW10sIHhmb3JtXG5cbiAgaWYgb3B0aW9ucy52aWV3VHJhbnNmb3JtIDo6XG4gICAgY29uc3QgeGZvcm0gPSBiaW5kU3RhdGVUcmFuc2Zvcm0ob3B0aW9ucy52aWV3VHJhbnNmb3JtLCAndmlld1RyYW5zZm9ybScsIG9wdGlvbnMudmlld1RyYW5zZm9ybUZpbHRlcilcbiAgICBvcHRpb25zLmNoYW5nZWQgPSBbXS5jb25jYXQgQCBvcHRpb25zLmNoYW5nZWQgfHwgW10sIHhmb3JtXG5cbiAgY29uc3QgaXNDaGFuZ2VkID0gb3B0aW9ucy5pc0NoYW5nZWQgfHwgaG9zdC5fX2lzX2NoYW5nZWRfXyB8fCBpc09iamVjdENoYW5nZWRcbiAgY29uc3Qgb25fYmVmb3JlID0gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUgQCBvcHRpb25zLmJlZm9yZSwgaG9zdC5fX2Rpc3BhdGNoX2JlZm9yZV9fLCAnYmVmb3JlJ1xuICBjb25zdCBvbl9lcnJvciA9IGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIEAgb3B0aW9ucy5lcnJvciwgaG9zdC5fX2Rpc3BhdGNoX2Vycm9yX18sICdlcnJvcidcbiAgY29uc3Qgb25fYWZ0ZXIgPSBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSBAIG9wdGlvbnMuYWZ0ZXIsIGhvc3QuX19kaXNwYXRjaF9hZnRlcl9fLCAnYWZ0ZXInXG4gIGNvbnN0IG9uX2NoYW5nZWQgPSBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSBAIG9wdGlvbnMuY2hhbmdlZCwgaG9zdC5fX2Rpc3BhdGNoX2NoYW5nZWRfXywgJ2NoYW5nZWQnXG4gIGNvbnN0IG9uX2ZyZWV6ZSA9IGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIEAgb3B0aW9ucy5mcmVlemUsIGhvc3QuX19kaXNwYXRjaF9mcmVlemVfXywgJ2ZyZWV6ZSdcblxuICBpZiB1bmRlZmluZWQgIT09IGlzQ2hhbmdlZCAmJiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgaXNDaGFuZ2VkIDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBEaXNwYXRjaCBleHBlY3RlZCAnaXNDaGFuZ2VkJyBvcHRpb24gdG8gYmUgYSBmdW5jdGlvbiBpbnN0YW5jZWBcblxuICBsZXQgc3RhdGUgPSB7fSwgc3RhdGVfc3VtbWFyeSwgdGlwX3ZpZXdcbiAgcmV0dXJuIF9fZGlzcGF0Y2hfX1xuXG4gIGZ1bmN0aW9uIF9fZGlzcGF0Y2hfXyhub3RpZnksIGFjdGlvbk5hbWUsIGFjdGlvbkFyZ3MsIHZpZXcpIDo6XG4gICAgY29uc3QgcHJlX3N0YXRlID0gc3RhdGVcbiAgICBjb25zdCB0Z3QgPSBPYmplY3QuY3JlYXRlIEAgaG9zdC5fX2ltcGxfcHJvdG9fX1xuXG4gICAgT2JqZWN0LmFzc2lnbiBAIHRndCwgc3RhdGVcblxuICAgIGxldCByZXN1bHRcbiAgICBjb25zdCBjdHggPSBAOiBhY3Rpb246IFthY3Rpb25OYW1lLCBhY3Rpb25BcmdzLCB2aWV3XVxuICAgICAgcHJlX3N0YXRlLCBpc1RpcFZpZXc6IHRpcF92aWV3ID09PSB2aWV3ICYmIHZpZXcgIT09IHVuZGVmaW5lZFxuXG4gICAgdHJ5IDo6XG4gICAgICBpZiB1bmRlZmluZWQgIT09IG9uX2JlZm9yZSA6OlxuICAgICAgICBvbl9iZWZvcmUodGd0LCBjdHgpXG5cbiAgICAgIHRyeSA6OlxuICAgICAgICAvLyBkaXNwYXRjaCBhY3Rpb24gbWV0aG9kXG4gICAgICAgIGlmIGFjdGlvbk5hbWUgOjpcbiAgICAgICAgICByZXN1bHQgPSB0Z3RbYWN0aW9uTmFtZV0uYXBwbHkodGd0LCBhY3Rpb25BcmdzKVxuICAgICAgICAgIGN0eC5yZXN1bHQgPSByZXN1bHRcbiAgICAgICAgZWxzZSA6OlxuICAgICAgICAgIGN0eC5yZXN1bHQgPSByZXN1bHQgPSB0aXBfdmlldyA9IHRndFxuXG4gICAgICAgIC8vIHRyYW5zZm9ybSBmcm9tIGltcGwgZG93biB0byBhIHZpZXdcbiAgICAgICAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRndCwgaG9zdC5fX3ZpZXdfcHJvdG9fXylcblxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIC8vIHRyYW5zZm9ybSBmcm9tIGltcGwgZG93biB0byBhIHZpZXdcbiAgICAgICAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRndCwgaG9zdC5fX3ZpZXdfcHJvdG9fXylcblxuICAgICAgICAvLyBoYW5kbGUgZXJyb3IgZnJvbSBhY3Rpb24gbWV0aG9kXG4gICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gb25fZXJyb3IgOjogdGhyb3cgZXJyXG5cbiAgICAgICAgY29uc3Qgc2hvdWxkVGhyb3cgPSBvbl9lcnJvcihlcnIsIHRndCwgY3R4KVxuICAgICAgICBpZiBmYWxzZSAhPT0gc2hvdWxkVGhyb3cgOjogdGhyb3cgZXJyXG5cbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gb25fYWZ0ZXIgOjpcbiAgICAgICAgb25fYWZ0ZXIodGd0LCBjdHgpXG5cbiAgICAgIC8vIGNhcHR1cmUgc3RhdGUgYWZ0ZXIgZGlzcGF0Y2hpbmcgYWN0aW9uXG4gICAgICBjb25zdCBwb3N0X3N0YXRlID0gT2JqZWN0LmFzc2lnbiBAIHt9LCB0Z3RcbiAgICAgIGN0eC5wb3N0X3N0YXRlID0gcG9zdF9zdGF0ZVxuXG4gICAgICBpZiBwcmVfc3RhdGUgIT09IHN0YXRlIDo6XG4gICAgICAgIHRocm93IG5ldyBFcnJvciBAIGBBc3luYyBjb25mbGljdGluZyB1cGRhdGUgb2YgXCIke2hvc3QuY29uc3RydWN0b3IubmFtZX1cIiBvY2N1cmVkYFxuXG4gICAgICBjb25zdCBjaGFuZ2Vfc3VtbWFyeSA9IGlzQ2hhbmdlZChwcmVfc3RhdGUsIHBvc3Rfc3RhdGUsIHN0YXRlX3N1bW1hcnksIGN0eClcbiAgICAgIGlmIGNoYW5nZV9zdW1tYXJ5IDo6XG4gICAgICAgIGN0eC5jaGFuZ2VkID0gdHJ1ZVxuICAgICAgICBzdGF0ZSA9IHBvc3Rfc3RhdGVcbiAgICAgICAgc3RhdGVfc3VtbWFyeSA9IGNoYW5nZV9zdW1tYXJ5XG4gICAgICAgIHRpcF92aWV3ID0gdGd0XG5cbiAgICAgICAgaWYgdW5kZWZpbmVkICE9PSBvbl9jaGFuZ2VkIDo6XG4gICAgICAgICAgb25fY2hhbmdlZCh0Z3QsIGN0eClcblxuICAgICAgZWxzZSBpZiB0Z3QgPT09IHJlc3VsdCA6OlxuICAgICAgICBjdHgucmVzdWx0ID0gcmVzdWx0ID0gdGlwX3ZpZXdcblxuICAgIGZpbmFsbHkgOjpcbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gb25fZnJlZXplIDo6XG4gICAgICAgIHRyeSA6OlxuICAgICAgICAgIG9uX2ZyZWV6ZSh0Z3QsIGN0eClcbiAgICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgICAgUHJvbWlzZS5yZWplY3QoZXJyKVxuICAgICAgT2JqZWN0LmZyZWV6ZSh0Z3QpXG5cbiAgICBub3RpZnkodGlwX3ZpZXcpXG4gICAgcmV0dXJuIHJlc3VsdFxuXG4vLyAtLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lKGNhbGxiYWNrLCBob3N0X2NhbGxiYWNrLCBjYWxsYmFja19uYW1lKSA6OlxuICBpZiBudWxsICE9IGhvc3RfY2FsbGJhY2sgOjpcbiAgICBjYWxsYmFjayA9IFtdLmNvbmNhdCBAIGhvc3RfY2FsbGJhY2ssIGNhbGxiYWNrIHx8IFtdXG4gIGVsc2UgaWYgbnVsbCA9PSBjYWxsYmFjayA6OiByZXR1cm5cblxuICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgY2FsbGJhY2sgOjogcmV0dXJuIGNhbGxiYWNrXG5cbiAgaWYgQXJyYXkuaXNBcnJheShjYWxsYmFjaykgfHwgY2FsbGJhY2tbU3ltYm9sLml0ZXJhdG9yXSA6OlxuICAgIGNvbnN0IGNhbGxiYWNrTGlzdCA9IEFycmF5LmZyb20oY2FsbGJhY2spLmZpbHRlcihlID0+IG51bGwgIT0gZSlcblxuICAgIGlmIGNhbGxiYWNrTGlzdC5zb21lIEAgY2IgPT4gJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNiIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYERpc3BhdGNoIGV4cGVjdGVkICcke2NhbGxiYWNrX25hbWV9JyBvcHRpb24gdG8gb25seSBpbmNsdWRlIGZ1bmN0aW9ucyBpbiBsaXN0YFxuXG4gICAgaWYgY2FsbGJhY2tMaXN0Lmxlbmd0aCA8PSAxIDo6XG4gICAgICBjYWxsYmFjayA9IGNhbGxiYWNrTGlzdC5wb3AoKVxuICAgIGVsc2UgOjpcbiAgICAgIGNhbGxiYWNrID0gZnVuY3Rpb24gKHRndCwgYXJnMSwgYXJnMikgOjpcbiAgICAgICAgZm9yIGNvbnN0IGNiIG9mIGNhbGxiYWNrTGlzdCA6OlxuICAgICAgICAgIHRyeSA6OiBjYih0Z3QsIGFyZzEsIGFyZzIpXG4gICAgICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgICAgICBQcm9taXNlLnJlamVjdChlcnIpXG5cbiAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNhbGxiYWNrIDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBEaXNwYXRjaCBleHBlY3RlZCAnJHtjYWxsYmFja19uYW1lfScgb3B0aW9uIHRvIGJlIGEgZnVuY3Rpb24gaW5zdGFuY2Ugb3IgbGlzdCBvZiBmdW5jdGlvbnNgXG4gIHJldHVybiBjYWxsYmFja1xuXG4vLyAtLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzT2JqZWN0Q2hhbmdlZChwcmV2LCBuZXh0KSA6OlxuICBpZiBwcmV2ID09PSB1bmRlZmluZWQgOjpcbiAgICByZXR1cm4gbmV4dCAhPT0gdW5kZWZpbmVkXG5cbiAgZm9yIGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhuZXh0KSA6OlxuICAgIGlmICEgQCBrZXkgaW4gcHJldiA6OlxuICAgICAgcmV0dXJuIHRydWUgLy8gYWRkZWRcblxuICBmb3IgY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHByZXYpIDo6XG4gICAgaWYgcHJldltrZXldICE9PSBuZXh0W2tleV0gOjpcbiAgICAgIHJldHVybiB0cnVlIC8vIGNoYW5nZWRcbiAgICBpZiAhIEAga2V5IGluIG5leHQgOjpcbiAgICAgIHJldHVybiB0cnVlIC8vIHJlbW92ZWRcblxuICByZXR1cm4gZmFsc2VcblxuLy8gLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kU3RhdGVUcmFuc2Zvcm0oeGZvcm0sIHhmb3JtX25hbWUsIHhmb3JtX2ZpbHRlcikgOjpcbiAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHhmb3JtIDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgRXhwZWN0ZWQgJHt4Zm9ybV9uYW1lfXRvIGJlIGEgZnVuY3Rpb25gKVxuXG4gIGlmIHRydWUgPT09IHhmb3JtX2ZpbHRlciB8fCAnbm90LWZyb3plbicgOjpcbiAgICB4Zm9ybV9maWx0ZXIgPSBhdHRyID0+ICEgT2JqZWN0LmlzRnJvemVuKGF0dHIpXG5cbiAgcmV0dXJuIGZ1bmN0aW9uKHRndCkgOjpcbiAgICBmb3IgY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHRndCkgOjpcbiAgICAgIGNvbnN0IGF0dHIgPSB0Z3Rba2V5XVxuICAgICAgaWYgISB4Zm9ybV9maWx0ZXIgfHwgeGZvcm1fZmlsdGVyKGF0dHIsIGtleSkgOjpcbiAgICAgICAgdGd0W2tleV0gPSB4Zm9ybSBAIGF0dHJcblxuIiwiaW1wb3J0IGltbXUgZnJvbSAnaW1tdSdcbmltcG9ydCB7YXNGdW5jdGlvbmFsT2JqZWN0fSBmcm9tICcuL2luZGV4LmpzeSdcblxuZXhwb3J0IGZ1bmN0aW9uIGFzSW1tdUZ1bmN0aW9uYWxPYmplY3QoaG9zdCwgLi4ub3B0aW9ucykgOjpcbiAgcmV0dXJuIGFzRnVuY3Rpb25hbE9iamVjdCBAIGhvc3QsIHt0cmFuc2Zvcm06IGltbXUsIHRyYW5zZm9ybUZpbHRlcjogdHJ1ZX0sIC4uLm9wdGlvbnNcblxuZXhwb3J0IGZ1bmN0aW9uIEltbXVPYmplY3RGdW5jdGlvbmFsKCkgOjpcbiAgcmV0dXJuIGFzSW1tdUZ1bmN0aW9uYWxPYmplY3QodGhpcylcblxuIl0sIm5hbWVzIjpbImFzRnVuY3Rpb25hbE9iamVjdCIsImhvc3QiLCJvcHRpb25zIiwiT2JqZWN0IiwiYXNzaWduIiwibm90aWZ5IiwiYmluZFVwZGF0ZUZ1bmN0aW9uIiwiZGlzcGF0Y2hBY3Rpb24iLCJkZWZpbmVBY3Rpb24iLCJiaW5kQWN0aW9uRGVjbGFyYXRpb25zIiwiYWN0aW9ucyIsInN1YnNjcmliZSIsInZhbHVlIiwiYXJncyIsIl9faW1wbF9wcm90b19fIiwiY3JlYXRlIiwiZ2V0UHJvdG90eXBlT2YiLCJfX3ZpZXdfcHJvdG9fXyIsImRlZmluZVByb3BlcnRpZXMiLCJhc0FjdGlvbiIsInNldCIsImNvbmZpZ3VyYWJsZSIsImZyZWV6ZSIsIlR5cGVFcnJvciIsIl9fZGlzcGF0Y2hfXyIsImFjdGlvbk5hbWUiLCJhY3Rpb25BcmdzIiwic3RhdGVBY3Rpb25EaXNwYXRjaCIsImFjdGlvbkxpc3QiLCJuYW1lIiwiQXJyYXkiLCJpc0FycmF5IiwiZW50cmllcyIsImltcGxfcHJvcHMiLCJ2aWV3X3Byb3BzIiwiaG9zdF9wcm9wcyIsImZuQWN0aW9uIiwiZm5EaXNwYXRjaCIsIm5vdGlmeUxpc3QiLCJjdXJyZW50IiwidXBkYXRlIiwibmV4dCIsImNiIiwiZXJyIiwiY2FsbGJhY2siLCJwb3AiLCJza2lwSW5pdGlhbENhbGwiLCJpbmRleE9mIiwiY29uY2F0IiwidW5zdWJzY3JpYmUiLCJkaXNjYXJkIiwiZmlsdGVyIiwiZSIsInRyYW5zZm9ybSIsInhmb3JtIiwiYmluZFN0YXRlVHJhbnNmb3JtIiwidHJhbnNmb3JtRmlsdGVyIiwiYWZ0ZXIiLCJ2aWV3VHJhbnNmb3JtIiwidmlld1RyYW5zZm9ybUZpbHRlciIsImNoYW5nZWQiLCJpc0NoYW5nZWQiLCJfX2lzX2NoYW5nZWRfXyIsImlzT2JqZWN0Q2hhbmdlZCIsIm9uX2JlZm9yZSIsImFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIiwiYmVmb3JlIiwiX19kaXNwYXRjaF9iZWZvcmVfXyIsIm9uX2Vycm9yIiwiZXJyb3IiLCJfX2Rpc3BhdGNoX2Vycm9yX18iLCJvbl9hZnRlciIsIl9fZGlzcGF0Y2hfYWZ0ZXJfXyIsIm9uX2NoYW5nZWQiLCJfX2Rpc3BhdGNoX2NoYW5nZWRfXyIsIm9uX2ZyZWV6ZSIsIl9fZGlzcGF0Y2hfZnJlZXplX18iLCJ1bmRlZmluZWQiLCJzdGF0ZSIsInN0YXRlX3N1bW1hcnkiLCJ0aXBfdmlldyIsInZpZXciLCJwcmVfc3RhdGUiLCJ0Z3QiLCJyZXN1bHQiLCJjdHgiLCJhY3Rpb24iLCJpc1RpcFZpZXciLCJhcHBseSIsInNldFByb3RvdHlwZU9mIiwic2hvdWxkVGhyb3ciLCJwb3N0X3N0YXRlIiwiRXJyb3IiLCJjb25zdHJ1Y3RvciIsImNoYW5nZV9zdW1tYXJ5IiwicmVqZWN0IiwiaG9zdF9jYWxsYmFjayIsImNhbGxiYWNrX25hbWUiLCJTeW1ib2wiLCJpdGVyYXRvciIsImNhbGxiYWNrTGlzdCIsImZyb20iLCJzb21lIiwibGVuZ3RoIiwiYXJnMSIsImFyZzIiLCJwcmV2Iiwia2V5Iiwia2V5cyIsInhmb3JtX25hbWUiLCJ4Zm9ybV9maWx0ZXIiLCJhdHRyIiwiaXNGcm96ZW4iLCJhc0ltbXVGdW5jdGlvbmFsT2JqZWN0IiwiaW1tdSIsIkltbXVPYmplY3RGdW5jdGlvbmFsIl0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUdBOztBQUVBLEFBQU8sU0FBU0Esa0JBQVQsQ0FBNEJDLElBQTVCLEVBQWtDLEdBQUdDLE9BQXJDLEVBQThDOztZQUV6Q0MsT0FBT0MsTUFBUCxDQUFjLEVBQWQsRUFBa0IsR0FBR0YsT0FBckIsQ0FBVjtRQUNNRyxTQUFTLFFBQVFILFFBQVFHLE1BQWhCLEdBQ1hDLG1CQUFtQkwsSUFBbkIsRUFBeUJDLE9BQXpCLENBRFcsR0FFWEEsUUFBUUcsTUFGWjs7O1FBT00sRUFBQ0UsY0FBRCxFQUFpQkMsWUFBakIsS0FBaUNDLHVCQUF1QkosTUFBdkIsQ0FBdkM7TUFDR0gsUUFBUVEsT0FBWCxFQUFxQjtpQkFBY1IsUUFBUVEsT0FBckI7OztRQUVoQkMsWUFBWSxFQUFJQyxNQUFNLEdBQUdDLElBQVQsRUFBZTthQUFVUixPQUFPTSxTQUFQLENBQWlCLEdBQUdFLElBQXBCLENBQVA7S0FBdEIsRUFBbEI7UUFDTUMsaUJBQWlCWCxPQUFPWSxNQUFQLENBQWdCWixPQUFPYSxjQUFQLENBQXNCZixJQUF0QixDQUFoQixFQUE2QyxFQUFJVSxTQUFKLEVBQTdDLENBQXZCO1FBQ01NLGlCQUFpQmQsT0FBT1ksTUFBUCxDQUFnQlosT0FBT2EsY0FBUCxDQUFzQmYsSUFBdEIsQ0FBaEIsRUFBNkMsRUFBSVUsU0FBSixFQUE3QyxDQUF2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
