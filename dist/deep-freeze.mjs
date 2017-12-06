import deepFreeze from 'deep-freeze';

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

function asDeepFreezeFunctionalObject(host, ...options) {
  return asFunctionalObject(host, { transform: deepFreeze, transformFilter: true }, ...options);
}

function DeepFreezeObjectFunctional() {
  return asDeepFreezeFunctionalObject(this);
}

export { asDeepFreezeFunctionalObject, DeepFreezeObjectFunctional };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVlcC1mcmVlemUubWpzIiwic291cmNlcyI6WyIuLi9jb2RlL2luZGV4LmpzeSIsIi4uL2NvZGUvZGVlcC1mcmVlemUuanMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIE9iamVjdEZ1bmN0aW9uYWwoKSA6OlxuICByZXR1cm4gYXNGdW5jdGlvbmFsT2JqZWN0KHRoaXMpXG5cbi8vIC0tLVxuXG5leHBvcnQgZnVuY3Rpb24gYXNGdW5jdGlvbmFsT2JqZWN0KGhvc3QsIC4uLm9wdGlvbnMpIDo6XG4gIC8vIGluaXRpYWxpemUgb3B0aW9uc1xuICBvcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgLi4ub3B0aW9ucylcbiAgY29uc3Qgbm90aWZ5ID0gbnVsbCA9PSBvcHRpb25zLm5vdGlmeVxuICAgID8gYmluZFVwZGF0ZUZ1bmN0aW9uKGhvc3QsIG9wdGlvbnMpXG4gICAgOiBvcHRpb25zLm5vdGlmeVxuXG5cblxuICAvLyBzZXR1cCBhc0FjdGlvbiBzZXR0ZXIgaGFjayAtLSBpbiBsaWV1IG9mIEVTIHN0YW5kYXJkIGRlY29yYXRvcnNcbiAgY29uc3Qge2Rpc3BhdGNoQWN0aW9uLCBkZWZpbmVBY3Rpb259ID0gYmluZEFjdGlvbkRlY2xhcmF0aW9ucyhub3RpZnkpXG4gIGlmIG9wdGlvbnMuYWN0aW9ucyA6OiBkZWZpbmVBY3Rpb24ob3B0aW9ucy5hY3Rpb25zKVxuXG4gIGNvbnN0IHN1YnNjcmliZSA9IEB7fSB2YWx1ZSguLi5hcmdzKSA6OiByZXR1cm4gbm90aWZ5LnN1YnNjcmliZSguLi5hcmdzKVxuICBjb25zdCBfX2ltcGxfcHJvdG9fXyA9IE9iamVjdC5jcmVhdGUgQCBPYmplY3QuZ2V0UHJvdG90eXBlT2YoaG9zdCksIEB7fSBzdWJzY3JpYmVcbiAgY29uc3QgX192aWV3X3Byb3RvX18gPSBPYmplY3QuY3JlYXRlIEAgT2JqZWN0LmdldFByb3RvdHlwZU9mKGhvc3QpLCBAe30gc3Vic2NyaWJlXG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBob3N0LCBAe31cbiAgICBzdWJzY3JpYmUsIGFzQWN0aW9uOiBAe30gc2V0OiBkZWZpbmVBY3Rpb25cbiAgICBfX2ltcGxfcHJvdG9fXzogQHt9IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IF9faW1wbF9wcm90b19fXG4gICAgX192aWV3X3Byb3RvX186IEB7fSBjb25maWd1cmFibGU6IHRydWUsIHZhbHVlOiBfX3ZpZXdfcHJvdG9fX1xuXG5cbiAgLy8gaW5pdGlhbGl6ZSB0aGUgaW50ZXJuYWwgc3RhdCB3aXRoIGluaXRpYWwgdmlld1xuICBkaXNwYXRjaEFjdGlvbihub3RpZnksIG51bGwsIFtdLCBudWxsKVxuXG4gIC8vIHJldHVybiBhIGZyb3plbiBjbG9uZSBvZiB0aGUgaG9zdCBvYmplY3RcbiAgcmV0dXJuIE9iamVjdC5mcmVlemUgQCBPYmplY3QuY3JlYXRlIEAgaG9zdFxuXG5cbiAgZnVuY3Rpb24gYmluZEFjdGlvbkRlY2xhcmF0aW9ucyhub3RpZnkpIDo6XG4gICAgbGV0IGRpc3BhdGNoQWN0aW9uXG4gICAgaWYgbnVsbCAhPSBvcHRpb25zLmRpc3BhdGNoQWN0aW9uIDo6XG4gICAgICBkaXNwYXRjaEFjdGlvbiA9IG9wdGlvbnMuZGlzcGF0Y2hBY3Rpb25cbiAgICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBkaXNwYXRjaEFjdGlvbiA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBFeHBlY3RlZCBhIGRpc3BhdGNoQWN0aW9uKG5vdGlmeSwgYWN0aW9uTmFtZSwgYWN0aW9uQXJncyl74oCmfSBmdW5jdGlvbmApXG4gICAgZWxzZSBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaG9zdC5fX2Rpc3BhdGNoX18gOjpcbiAgICAgIGRpc3BhdGNoQWN0aW9uID0gZnVuY3Rpb24obm90aWZ5LCBhY3Rpb25OYW1lLCBhY3Rpb25BcmdzKSA6OlxuICAgICAgICByZXR1cm4gaG9zdC5fX2Rpc3BhdGNoX18obm90aWZ5LCBhY3Rpb25OYW1lLCBhY3Rpb25BcmdzKVxuICAgIGVsc2UgOjpcbiAgICAgIGRpc3BhdGNoQWN0aW9uID0gc3RhdGVBY3Rpb25EaXNwYXRjaChob3N0LCBvcHRpb25zKVxuXG5cbiAgICBjb25zdCBkZWZpbmVBY3Rpb24gPSAoYWN0aW9uTGlzdCkgPT4gOjpcbiAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBhY3Rpb25MaXN0IDo6XG4gICAgICAgIGFjdGlvbkxpc3QgPSBAW10gQFtdIGFjdGlvbkxpc3QubmFtZSwgYWN0aW9uTGlzdFxuICAgICAgZWxzZSBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGFjdGlvbkxpc3QgOjpcbiAgICAgICAgYWN0aW9uTGlzdCA9IEBbXSBAW10gYWN0aW9uTGlzdCwgaG9zdFthY3Rpb25MaXN0XVxuICAgICAgZWxzZSBpZiAhIEFycmF5LmlzQXJyYXkgQCBhY3Rpb25MaXN0IDo6XG4gICAgICAgIGFjdGlvbkxpc3QgPSBPYmplY3QuZW50cmllcyhhY3Rpb25MaXN0KVxuICAgICAgZWxzZSBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGFjdGlvbkxpc3RbMF0gOjpcbiAgICAgICAgYWN0aW9uTGlzdCA9IEBbXSBhY3Rpb25MaXN0XG5cblxuICAgICAgY29uc3QgaW1wbF9wcm9wcz17fSwgdmlld19wcm9wcz17fSwgaG9zdF9wcm9wcyA9IHt9XG4gICAgICBmb3IgY29uc3QgW2FjdGlvbk5hbWUsIGZuQWN0aW9uXSBvZiBhY3Rpb25MaXN0IDo6XG4gICAgICAgIGlmICEgYWN0aW9uTmFtZSA6OlxuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgQWN0aW9uIG5hbWUgbm90IGZvdW5kYFxuICAgICAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZm5BY3Rpb24gOjpcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkIGFjdGlvbiBcIiR7YWN0aW9uTmFtZX1cIiB0byBiZSBhIGZ1bmN0aW9uLCBidXQgZm91bmQgXCIke3R5cGVvZiBmbkFjdGlvbn1cImBcblxuICAgICAgICBjb25zdCBmbkRpc3BhdGNoID0gZnVuY3Rpb24gKC4uLmFjdGlvbkFyZ3MpIDo6XG4gICAgICAgICAgcmV0dXJuIGRpc3BhdGNoQWN0aW9uKG5vdGlmeSwgYWN0aW9uTmFtZSwgYWN0aW9uQXJncylcblxuICAgICAgICBpbXBsX3Byb3BzW2FjdGlvbk5hbWVdID0gQHt9IHZhbHVlOiBmbkFjdGlvblxuICAgICAgICB2aWV3X3Byb3BzW2FjdGlvbk5hbWVdID0gQHt9IHZhbHVlOiBmbkRpc3BhdGNoXG4gICAgICAgIGhvc3RfcHJvcHNbYWN0aW9uTmFtZV0gPSBAe30gdmFsdWU6IGZuRGlzcGF0Y2gsIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIF9faW1wbF9wcm90b19fLCBpbXBsX3Byb3BzXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIF9fdmlld19wcm90b19fLCB2aWV3X3Byb3BzXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIGhvc3QsIGhvc3RfcHJvcHNcblxuICAgIHJldHVybiBAe30gZGlzcGF0Y2hBY3Rpb24sIGRlZmluZUFjdGlvblxuXG5cbi8vIC0tLVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFVwZGF0ZUZ1bmN0aW9uKCkgOjpcbiAgbGV0IG5vdGlmeUxpc3QgPSBbXVxuICBsZXQgY3VycmVudFxuXG4gIHVwZGF0ZS5zdWJzY3JpYmUgPSBzdWJzY3JpYmVcbiAgcmV0dXJuIHVwZGF0ZVxuXG4gIGZ1bmN0aW9uIHVwZGF0ZShuZXh0KSA6OlxuICAgIGlmIGN1cnJlbnQgPT09IG5leHQgOjogcmV0dXJuXG5cbiAgICBjdXJyZW50ID0gbmV4dFxuICAgIGZvciBjb25zdCBjYiBvZiBub3RpZnlMaXN0IDo6XG4gICAgICB0cnkgOjogY2IoY3VycmVudClcbiAgICAgIGNhdGNoIGVyciA6OiBkaXNjYXJkKGNiKVxuXG4gIGZ1bmN0aW9uIHN1YnNjcmliZSguLi5hcmdzKSA6OlxuICAgIGNvbnN0IGNhbGxiYWNrID0gYXJncy5wb3AoKVxuICAgIGNvbnN0IHNraXBJbml0aWFsQ2FsbCA9IGFyZ3NbMF1cblxuICAgIGlmIC0xICE9PSBub3RpZnlMaXN0LmluZGV4T2YoY2FsbGJhY2spIDo6XG4gICAgICByZXR1cm5cbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2FsbGJhY2sgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgUGxlYXNlIHN1YnNjcmliZSB3aXRoIGEgZnVuY3Rpb25gXG5cbiAgICBub3RpZnlMaXN0ID0gbm90aWZ5TGlzdC5jb25jYXQgQCBbY2FsbGJhY2tdXG4gICAgaWYgISBza2lwSW5pdGlhbENhbGwgOjpcbiAgICAgIGNhbGxiYWNrKGN1cnJlbnQpXG4gICAgdW5zdWJzY3JpYmUudW5zdWJzY3JpYmUgPSB1bnN1YnNjcmliZVxuICAgIHJldHVybiB1bnN1YnNjcmliZVxuXG4gICAgZnVuY3Rpb24gdW5zdWJzY3JpYmUoKSA6OlxuICAgICAgZGlzY2FyZChjYWxsYmFjaylcblxuICBmdW5jdGlvbiBkaXNjYXJkKGNhbGxiYWNrKSA6OlxuICAgIG5vdGlmeUxpc3QgPSBub3RpZnlMaXN0XG4gICAgICAuZmlsdGVyIEAgZSA9PiBjYWxsYmFjayAhPT0gZVxuXG4vLyAtLS1cblxuXG5leHBvcnQgZnVuY3Rpb24gc3RhdGVBY3Rpb25EaXNwYXRjaChob3N0LCBvcHRpb25zPXt9KSA6OlxuICBpZiBvcHRpb25zLnRyYW5zZm9ybSA6OlxuICAgIGNvbnN0IHhmb3JtID0gYmluZFN0YXRlVHJhbnNmb3JtKG9wdGlvbnMudHJhbnNmb3JtLCAndHJhbnNmb3JtJywgb3B0aW9ucy50cmFuc2Zvcm1GaWx0ZXIpXG4gICAgb3B0aW9ucy5hZnRlciA9IFtdLmNvbmNhdCBAIG9wdGlvbnMuYWZ0ZXIgfHwgW10sIHhmb3JtXG5cbiAgaWYgb3B0aW9ucy52aWV3VHJhbnNmb3JtIDo6XG4gICAgY29uc3QgeGZvcm0gPSBiaW5kU3RhdGVUcmFuc2Zvcm0ob3B0aW9ucy52aWV3VHJhbnNmb3JtLCAndmlld1RyYW5zZm9ybScsIG9wdGlvbnMudmlld1RyYW5zZm9ybUZpbHRlcilcbiAgICBvcHRpb25zLmNoYW5nZWQgPSBbXS5jb25jYXQgQCBvcHRpb25zLmNoYW5nZWQgfHwgW10sIHhmb3JtXG5cbiAgY29uc3QgaXNDaGFuZ2VkID0gb3B0aW9ucy5pc0NoYW5nZWQgfHwgaG9zdC5fX2lzX2NoYW5nZWRfXyB8fCBpc09iamVjdENoYW5nZWRcbiAgY29uc3Qgb25fYmVmb3JlID0gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUgQCBvcHRpb25zLmJlZm9yZSwgaG9zdC5fX2Rpc3BhdGNoX2JlZm9yZV9fLCAnYmVmb3JlJ1xuICBjb25zdCBvbl9lcnJvciA9IGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIEAgb3B0aW9ucy5lcnJvciwgaG9zdC5fX2Rpc3BhdGNoX2Vycm9yX18sICdlcnJvcidcbiAgY29uc3Qgb25fYWZ0ZXIgPSBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSBAIG9wdGlvbnMuYWZ0ZXIsIGhvc3QuX19kaXNwYXRjaF9hZnRlcl9fLCAnYWZ0ZXInXG4gIGNvbnN0IG9uX2NoYW5nZWQgPSBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSBAIG9wdGlvbnMuY2hhbmdlZCwgaG9zdC5fX2Rpc3BhdGNoX2NoYW5nZWRfXywgJ2NoYW5nZWQnXG4gIGNvbnN0IG9uX2ZyZWV6ZSA9IGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIEAgb3B0aW9ucy5mcmVlemUsIGhvc3QuX19kaXNwYXRjaF9mcmVlemVfXywgJ2ZyZWV6ZSdcblxuICBpZiB1bmRlZmluZWQgIT09IGlzQ2hhbmdlZCAmJiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgaXNDaGFuZ2VkIDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBEaXNwYXRjaCBleHBlY3RlZCAnaXNDaGFuZ2VkJyBvcHRpb24gdG8gYmUgYSBmdW5jdGlvbiBpbnN0YW5jZWBcblxuICBsZXQgc3RhdGUgPSB7fSwgc3RhdGVfc3VtbWFyeSwgdGlwX3ZpZXdcbiAgcmV0dXJuIF9fZGlzcGF0Y2hfX1xuXG4gIGZ1bmN0aW9uIF9fZGlzcGF0Y2hfXyhub3RpZnksIGFjdGlvbk5hbWUsIGFjdGlvbkFyZ3MsIHZpZXcpIDo6XG4gICAgY29uc3QgcHJlX3N0YXRlID0gc3RhdGVcbiAgICBjb25zdCB0Z3QgPSBPYmplY3QuY3JlYXRlIEAgaG9zdC5fX2ltcGxfcHJvdG9fX1xuXG4gICAgT2JqZWN0LmFzc2lnbiBAIHRndCwgc3RhdGVcblxuICAgIGxldCByZXN1bHRcbiAgICBjb25zdCBjdHggPSBAOiBhY3Rpb246IFthY3Rpb25OYW1lLCBhY3Rpb25BcmdzLCB2aWV3XVxuICAgICAgcHJlX3N0YXRlLCBpc1RpcFZpZXc6IHRpcF92aWV3ID09PSB2aWV3ICYmIHZpZXcgIT09IHVuZGVmaW5lZFxuXG4gICAgdHJ5IDo6XG4gICAgICBpZiB1bmRlZmluZWQgIT09IG9uX2JlZm9yZSA6OlxuICAgICAgICBvbl9iZWZvcmUodGd0LCBjdHgpXG5cbiAgICAgIHRyeSA6OlxuICAgICAgICAvLyBkaXNwYXRjaCBhY3Rpb24gbWV0aG9kXG4gICAgICAgIGlmIGFjdGlvbk5hbWUgOjpcbiAgICAgICAgICByZXN1bHQgPSB0Z3RbYWN0aW9uTmFtZV0uYXBwbHkodGd0LCBhY3Rpb25BcmdzKVxuICAgICAgICAgIGN0eC5yZXN1bHQgPSByZXN1bHRcbiAgICAgICAgZWxzZSA6OlxuICAgICAgICAgIGN0eC5yZXN1bHQgPSByZXN1bHQgPSB0aXBfdmlldyA9IHRndFxuXG4gICAgICAgIC8vIHRyYW5zZm9ybSBmcm9tIGltcGwgZG93biB0byBhIHZpZXdcbiAgICAgICAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRndCwgaG9zdC5fX3ZpZXdfcHJvdG9fXylcblxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIC8vIHRyYW5zZm9ybSBmcm9tIGltcGwgZG93biB0byBhIHZpZXdcbiAgICAgICAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRndCwgaG9zdC5fX3ZpZXdfcHJvdG9fXylcblxuICAgICAgICAvLyBoYW5kbGUgZXJyb3IgZnJvbSBhY3Rpb24gbWV0aG9kXG4gICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gb25fZXJyb3IgOjogdGhyb3cgZXJyXG5cbiAgICAgICAgY29uc3Qgc2hvdWxkVGhyb3cgPSBvbl9lcnJvcihlcnIsIHRndCwgY3R4KVxuICAgICAgICBpZiBmYWxzZSAhPT0gc2hvdWxkVGhyb3cgOjogdGhyb3cgZXJyXG5cbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gb25fYWZ0ZXIgOjpcbiAgICAgICAgb25fYWZ0ZXIodGd0LCBjdHgpXG5cbiAgICAgIC8vIGNhcHR1cmUgc3RhdGUgYWZ0ZXIgZGlzcGF0Y2hpbmcgYWN0aW9uXG4gICAgICBjb25zdCBwb3N0X3N0YXRlID0gT2JqZWN0LmFzc2lnbiBAIHt9LCB0Z3RcbiAgICAgIGN0eC5wb3N0X3N0YXRlID0gcG9zdF9zdGF0ZVxuXG4gICAgICBpZiBwcmVfc3RhdGUgIT09IHN0YXRlIDo6XG4gICAgICAgIHRocm93IG5ldyBFcnJvciBAIGBBc3luYyBjb25mbGljdGluZyB1cGRhdGUgb2YgXCIke2hvc3QuY29uc3RydWN0b3IubmFtZX1cIiBvY2N1cmVkYFxuXG4gICAgICBjb25zdCBjaGFuZ2Vfc3VtbWFyeSA9IGlzQ2hhbmdlZChwcmVfc3RhdGUsIHBvc3Rfc3RhdGUsIHN0YXRlX3N1bW1hcnksIGN0eClcbiAgICAgIGlmIGNoYW5nZV9zdW1tYXJ5IDo6XG4gICAgICAgIGN0eC5jaGFuZ2VkID0gdHJ1ZVxuICAgICAgICBzdGF0ZSA9IHBvc3Rfc3RhdGVcbiAgICAgICAgc3RhdGVfc3VtbWFyeSA9IGNoYW5nZV9zdW1tYXJ5XG4gICAgICAgIHRpcF92aWV3ID0gdGd0XG5cbiAgICAgICAgaWYgdW5kZWZpbmVkICE9PSBvbl9jaGFuZ2VkIDo6XG4gICAgICAgICAgb25fY2hhbmdlZCh0Z3QsIGN0eClcblxuICAgICAgZWxzZSBpZiB0Z3QgPT09IHJlc3VsdCA6OlxuICAgICAgICBjdHgucmVzdWx0ID0gcmVzdWx0ID0gdGlwX3ZpZXdcblxuICAgIGZpbmFsbHkgOjpcbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gb25fZnJlZXplIDo6XG4gICAgICAgIHRyeSA6OlxuICAgICAgICAgIG9uX2ZyZWV6ZSh0Z3QsIGN0eClcbiAgICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgICAgUHJvbWlzZS5yZWplY3QoZXJyKVxuICAgICAgT2JqZWN0LmZyZWV6ZSh0Z3QpXG5cbiAgICBub3RpZnkodGlwX3ZpZXcpXG4gICAgcmV0dXJuIHJlc3VsdFxuXG4vLyAtLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lKGNhbGxiYWNrLCBob3N0X2NhbGxiYWNrLCBjYWxsYmFja19uYW1lKSA6OlxuICBpZiBudWxsICE9IGhvc3RfY2FsbGJhY2sgOjpcbiAgICBjYWxsYmFjayA9IFtdLmNvbmNhdCBAIGhvc3RfY2FsbGJhY2ssIGNhbGxiYWNrIHx8IFtdXG4gIGVsc2UgaWYgbnVsbCA9PSBjYWxsYmFjayA6OiByZXR1cm5cblxuICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgY2FsbGJhY2sgOjogcmV0dXJuIGNhbGxiYWNrXG5cbiAgaWYgQXJyYXkuaXNBcnJheShjYWxsYmFjaykgfHwgY2FsbGJhY2tbU3ltYm9sLml0ZXJhdG9yXSA6OlxuICAgIGNvbnN0IGNhbGxiYWNrTGlzdCA9IEFycmF5LmZyb20oY2FsbGJhY2spLmZpbHRlcihlID0+IG51bGwgIT0gZSlcblxuICAgIGlmIGNhbGxiYWNrTGlzdC5zb21lIEAgY2IgPT4gJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNiIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYERpc3BhdGNoIGV4cGVjdGVkICcke2NhbGxiYWNrX25hbWV9JyBvcHRpb24gdG8gb25seSBpbmNsdWRlIGZ1bmN0aW9ucyBpbiBsaXN0YFxuXG4gICAgaWYgY2FsbGJhY2tMaXN0Lmxlbmd0aCA8PSAxIDo6XG4gICAgICBjYWxsYmFjayA9IGNhbGxiYWNrTGlzdC5wb3AoKVxuICAgIGVsc2UgOjpcbiAgICAgIGNhbGxiYWNrID0gZnVuY3Rpb24gKHRndCwgYXJnMSwgYXJnMikgOjpcbiAgICAgICAgZm9yIGNvbnN0IGNiIG9mIGNhbGxiYWNrTGlzdCA6OlxuICAgICAgICAgIHRyeSA6OiBjYih0Z3QsIGFyZzEsIGFyZzIpXG4gICAgICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgICAgICBQcm9taXNlLnJlamVjdChlcnIpXG5cbiAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNhbGxiYWNrIDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBEaXNwYXRjaCBleHBlY3RlZCAnJHtjYWxsYmFja19uYW1lfScgb3B0aW9uIHRvIGJlIGEgZnVuY3Rpb24gaW5zdGFuY2Ugb3IgbGlzdCBvZiBmdW5jdGlvbnNgXG4gIHJldHVybiBjYWxsYmFja1xuXG4vLyAtLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzT2JqZWN0Q2hhbmdlZChwcmV2LCBuZXh0KSA6OlxuICBpZiBwcmV2ID09PSB1bmRlZmluZWQgOjpcbiAgICByZXR1cm4gbmV4dCAhPT0gdW5kZWZpbmVkXG5cbiAgZm9yIGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhuZXh0KSA6OlxuICAgIGlmICEgQCBrZXkgaW4gcHJldiA6OlxuICAgICAgcmV0dXJuIHRydWUgLy8gYWRkZWRcblxuICBmb3IgY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHByZXYpIDo6XG4gICAgaWYgcHJldltrZXldICE9PSBuZXh0W2tleV0gOjpcbiAgICAgIHJldHVybiB0cnVlIC8vIGNoYW5nZWRcbiAgICBpZiAhIEAga2V5IGluIG5leHQgOjpcbiAgICAgIHJldHVybiB0cnVlIC8vIHJlbW92ZWRcblxuICByZXR1cm4gZmFsc2VcblxuLy8gLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kU3RhdGVUcmFuc2Zvcm0oeGZvcm0sIHhmb3JtX25hbWUsIHhmb3JtX2ZpbHRlcikgOjpcbiAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHhmb3JtIDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgRXhwZWN0ZWQgJHt4Zm9ybV9uYW1lfXRvIGJlIGEgZnVuY3Rpb25gKVxuXG4gIGlmIHRydWUgPT09IHhmb3JtX2ZpbHRlciB8fCAnbm90LWZyb3plbicgOjpcbiAgICB4Zm9ybV9maWx0ZXIgPSBhdHRyID0+ICEgT2JqZWN0LmlzRnJvemVuKGF0dHIpXG5cbiAgcmV0dXJuIGZ1bmN0aW9uKHRndCkgOjpcbiAgICBmb3IgY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHRndCkgOjpcbiAgICAgIGNvbnN0IGF0dHIgPSB0Z3Rba2V5XVxuICAgICAgaWYgISB4Zm9ybV9maWx0ZXIgfHwgeGZvcm1fZmlsdGVyKGF0dHIsIGtleSkgOjpcbiAgICAgICAgdGd0W2tleV0gPSB4Zm9ybSBAIGF0dHJcblxuIiwiaW1wb3J0IGRlZXBGcmVlemUgZnJvbSAnZGVlcC1mcmVlemUnXG5pbXBvcnQge2FzRnVuY3Rpb25hbE9iamVjdH0gZnJvbSAnLi9pbmRleC5qc3knXG5cbmV4cG9ydCBmdW5jdGlvbiBhc0RlZXBGcmVlemVGdW5jdGlvbmFsT2JqZWN0KGhvc3QsIC4uLm9wdGlvbnMpIDo6XG4gIHJldHVybiBhc0Z1bmN0aW9uYWxPYmplY3QgQCBob3N0LCB7dHJhbnNmb3JtOiBkZWVwRnJlZXplLCB0cmFuc2Zvcm1GaWx0ZXI6IHRydWV9LCAuLi5vcHRpb25zXG5cbmV4cG9ydCBmdW5jdGlvbiBEZWVwRnJlZXplT2JqZWN0RnVuY3Rpb25hbCgpIDo6XG4gIHJldHVybiBhc0RlZXBGcmVlemVGdW5jdGlvbmFsT2JqZWN0KHRoaXMpXG5cbiJdLCJuYW1lcyI6WyJhc0Z1bmN0aW9uYWxPYmplY3QiLCJob3N0Iiwib3B0aW9ucyIsIk9iamVjdCIsImFzc2lnbiIsIm5vdGlmeSIsImJpbmRVcGRhdGVGdW5jdGlvbiIsImRpc3BhdGNoQWN0aW9uIiwiZGVmaW5lQWN0aW9uIiwiYmluZEFjdGlvbkRlY2xhcmF0aW9ucyIsImFjdGlvbnMiLCJzdWJzY3JpYmUiLCJ2YWx1ZSIsImFyZ3MiLCJfX2ltcGxfcHJvdG9fXyIsImNyZWF0ZSIsImdldFByb3RvdHlwZU9mIiwiX192aWV3X3Byb3RvX18iLCJkZWZpbmVQcm9wZXJ0aWVzIiwiYXNBY3Rpb24iLCJzZXQiLCJjb25maWd1cmFibGUiLCJmcmVlemUiLCJUeXBlRXJyb3IiLCJfX2Rpc3BhdGNoX18iLCJhY3Rpb25OYW1lIiwiYWN0aW9uQXJncyIsInN0YXRlQWN0aW9uRGlzcGF0Y2giLCJhY3Rpb25MaXN0IiwibmFtZSIsIkFycmF5IiwiaXNBcnJheSIsImVudHJpZXMiLCJpbXBsX3Byb3BzIiwidmlld19wcm9wcyIsImhvc3RfcHJvcHMiLCJmbkFjdGlvbiIsImZuRGlzcGF0Y2giLCJub3RpZnlMaXN0IiwiY3VycmVudCIsInVwZGF0ZSIsIm5leHQiLCJjYiIsImVyciIsImNhbGxiYWNrIiwicG9wIiwic2tpcEluaXRpYWxDYWxsIiwiaW5kZXhPZiIsImNvbmNhdCIsInVuc3Vic2NyaWJlIiwiZGlzY2FyZCIsImZpbHRlciIsImUiLCJ0cmFuc2Zvcm0iLCJ4Zm9ybSIsImJpbmRTdGF0ZVRyYW5zZm9ybSIsInRyYW5zZm9ybUZpbHRlciIsImFmdGVyIiwidmlld1RyYW5zZm9ybSIsInZpZXdUcmFuc2Zvcm1GaWx0ZXIiLCJjaGFuZ2VkIiwiaXNDaGFuZ2VkIiwiX19pc19jaGFuZ2VkX18iLCJpc09iamVjdENoYW5nZWQiLCJvbl9iZWZvcmUiLCJhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSIsImJlZm9yZSIsIl9fZGlzcGF0Y2hfYmVmb3JlX18iLCJvbl9lcnJvciIsImVycm9yIiwiX19kaXNwYXRjaF9lcnJvcl9fIiwib25fYWZ0ZXIiLCJfX2Rpc3BhdGNoX2FmdGVyX18iLCJvbl9jaGFuZ2VkIiwiX19kaXNwYXRjaF9jaGFuZ2VkX18iLCJvbl9mcmVlemUiLCJfX2Rpc3BhdGNoX2ZyZWV6ZV9fIiwidW5kZWZpbmVkIiwic3RhdGUiLCJzdGF0ZV9zdW1tYXJ5IiwidGlwX3ZpZXciLCJ2aWV3IiwicHJlX3N0YXRlIiwidGd0IiwicmVzdWx0IiwiY3R4IiwiYWN0aW9uIiwiaXNUaXBWaWV3IiwiYXBwbHkiLCJzZXRQcm90b3R5cGVPZiIsInNob3VsZFRocm93IiwicG9zdF9zdGF0ZSIsIkVycm9yIiwiY29uc3RydWN0b3IiLCJjaGFuZ2Vfc3VtbWFyeSIsInJlamVjdCIsImhvc3RfY2FsbGJhY2siLCJjYWxsYmFja19uYW1lIiwiU3ltYm9sIiwiaXRlcmF0b3IiLCJjYWxsYmFja0xpc3QiLCJmcm9tIiwic29tZSIsImxlbmd0aCIsImFyZzEiLCJhcmcyIiwicHJldiIsImtleSIsImtleXMiLCJ4Zm9ybV9uYW1lIiwieGZvcm1fZmlsdGVyIiwiYXR0ciIsImlzRnJvemVuIiwiYXNEZWVwRnJlZXplRnVuY3Rpb25hbE9iamVjdCIsImRlZXBGcmVlemUiLCJEZWVwRnJlZXplT2JqZWN0RnVuY3Rpb25hbCJdLCJtYXBwaW5ncyI6Ijs7QUFHQTs7QUFFQSxBQUFPLFNBQVNBLGtCQUFULENBQTRCQyxJQUE1QixFQUFrQyxHQUFHQyxPQUFyQyxFQUE4Qzs7WUFFekNDLE9BQU9DLE1BQVAsQ0FBYyxFQUFkLEVBQWtCLEdBQUdGLE9BQXJCLENBQVY7UUFDTUcsU0FBUyxRQUFRSCxRQUFRRyxNQUFoQixHQUNYQyxtQkFBbUJMLElBQW5CLEVBQXlCQyxPQUF6QixDQURXLEdBRVhBLFFBQVFHLE1BRlo7OztRQU9NLEVBQUNFLGNBQUQsRUFBaUJDLFlBQWpCLEtBQWlDQyx1QkFBdUJKLE1BQXZCLENBQXZDO01BQ0dILFFBQVFRLE9BQVgsRUFBcUI7aUJBQWNSLFFBQVFRLE9BQXJCOzs7UUFFaEJDLFlBQVksRUFBSUMsTUFBTSxHQUFHQyxJQUFULEVBQWU7YUFBVVIsT0FBT00sU0FBUCxDQUFpQixHQUFHRSxJQUFwQixDQUFQO0tBQXRCLEVBQWxCO1FBQ01DLGlCQUFpQlgsT0FBT1ksTUFBUCxDQUFnQlosT0FBT2EsY0FBUCxDQUFzQmYsSUFBdEIsQ0FBaEIsRUFBNkMsRUFBSVUsU0FBSixFQUE3QyxDQUF2QjtRQUNNTSxpQkFBaUJkLE9BQU9ZLE1BQVAs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
