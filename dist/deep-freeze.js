'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var deepFreeze = _interopDefault(require('deep-freeze'));

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

exports.asDeepFreezeFunctionalObject = asDeepFreezeFunctionalObject;
exports.DeepFreezeObjectFunctional = DeepFreezeObjectFunctional;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVlcC1mcmVlemUuanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvaW5kZXguanN5IiwiLi4vY29kZS9kZWVwLWZyZWV6ZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZnVuY3Rpb24gT2JqZWN0RnVuY3Rpb25hbCgpIDo6XG4gIHJldHVybiBhc0Z1bmN0aW9uYWxPYmplY3QodGhpcylcblxuLy8gLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBhc0Z1bmN0aW9uYWxPYmplY3QoaG9zdCwgLi4ub3B0aW9ucykgOjpcbiAgLy8gaW5pdGlhbGl6ZSBvcHRpb25zXG4gIG9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCAuLi5vcHRpb25zKVxuICBjb25zdCBub3RpZnkgPSBudWxsID09IG9wdGlvbnMubm90aWZ5XG4gICAgPyBiaW5kVXBkYXRlRnVuY3Rpb24oaG9zdCwgb3B0aW9ucylcbiAgICA6IG9wdGlvbnMubm90aWZ5XG5cblxuXG4gIC8vIHNldHVwIGFzQWN0aW9uIHNldHRlciBoYWNrIC0tIGluIGxpZXUgb2YgRVMgc3RhbmRhcmQgZGVjb3JhdG9yc1xuICBjb25zdCB7ZGlzcGF0Y2hBY3Rpb24sIGRlZmluZUFjdGlvbn0gPSBiaW5kQWN0aW9uRGVjbGFyYXRpb25zKG5vdGlmeSlcbiAgaWYgb3B0aW9ucy5hY3Rpb25zIDo6IGRlZmluZUFjdGlvbihvcHRpb25zLmFjdGlvbnMpXG5cbiAgY29uc3Qgc3Vic2NyaWJlID0gQHt9IHZhbHVlKC4uLmFyZ3MpIDo6IHJldHVybiBub3RpZnkuc3Vic2NyaWJlKC4uLmFyZ3MpXG4gIGNvbnN0IF9faW1wbF9wcm90b19fID0gT2JqZWN0LmNyZWF0ZSBAIE9iamVjdC5nZXRQcm90b3R5cGVPZihob3N0KSwgQHt9IHN1YnNjcmliZVxuICBjb25zdCBfX3ZpZXdfcHJvdG9fXyA9IE9iamVjdC5jcmVhdGUgQCBPYmplY3QuZ2V0UHJvdG90eXBlT2YoaG9zdCksIEB7fSBzdWJzY3JpYmVcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIGhvc3QsIEB7fVxuICAgIHN1YnNjcmliZSwgYXNBY3Rpb246IEB7fSBzZXQ6IGRlZmluZUFjdGlvblxuICAgIF9faW1wbF9wcm90b19fOiBAe30gY29uZmlndXJhYmxlOiB0cnVlLCB2YWx1ZTogX19pbXBsX3Byb3RvX19cbiAgICBfX3ZpZXdfcHJvdG9fXzogQHt9IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IF9fdmlld19wcm90b19fXG5cblxuICAvLyBpbml0aWFsaXplIHRoZSBpbnRlcm5hbCBzdGF0IHdpdGggaW5pdGlhbCB2aWV3XG4gIGRpc3BhdGNoQWN0aW9uKG5vdGlmeSwgbnVsbCwgW10sIG51bGwpXG5cbiAgLy8gcmV0dXJuIGEgZnJvemVuIGNsb25lIG9mIHRoZSBob3N0IG9iamVjdFxuICByZXR1cm4gT2JqZWN0LmZyZWV6ZSBAIE9iamVjdC5jcmVhdGUgQCBob3N0XG5cblxuICBmdW5jdGlvbiBiaW5kQWN0aW9uRGVjbGFyYXRpb25zKG5vdGlmeSkgOjpcbiAgICBsZXQgZGlzcGF0Y2hBY3Rpb25cbiAgICBpZiBudWxsICE9IG9wdGlvbnMuZGlzcGF0Y2hBY3Rpb24gOjpcbiAgICAgIGRpc3BhdGNoQWN0aW9uID0gb3B0aW9ucy5kaXNwYXRjaEFjdGlvblxuICAgICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGRpc3BhdGNoQWN0aW9uIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEV4cGVjdGVkIGEgZGlzcGF0Y2hBY3Rpb24obm90aWZ5LCBhY3Rpb25OYW1lLCBhY3Rpb25BcmdzKXvigKZ9IGZ1bmN0aW9uYClcbiAgICBlbHNlIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBob3N0Ll9fZGlzcGF0Y2hfXyA6OlxuICAgICAgZGlzcGF0Y2hBY3Rpb24gPSBmdW5jdGlvbihub3RpZnksIGFjdGlvbk5hbWUsIGFjdGlvbkFyZ3MpIDo6XG4gICAgICAgIHJldHVybiBob3N0Ll9fZGlzcGF0Y2hfXyhub3RpZnksIGFjdGlvbk5hbWUsIGFjdGlvbkFyZ3MpXG4gICAgZWxzZSA6OlxuICAgICAgZGlzcGF0Y2hBY3Rpb24gPSBzdGF0ZUFjdGlvbkRpc3BhdGNoKGhvc3QsIG9wdGlvbnMpXG5cblxuICAgIGNvbnN0IGRlZmluZUFjdGlvbiA9IChhY3Rpb25MaXN0KSA9PiA6OlxuICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGFjdGlvbkxpc3QgOjpcbiAgICAgICAgYWN0aW9uTGlzdCA9IEBbXSBAW10gYWN0aW9uTGlzdC5uYW1lLCBhY3Rpb25MaXN0XG4gICAgICBlbHNlIGlmICdzdHJpbmcnID09PSB0eXBlb2YgYWN0aW9uTGlzdCA6OlxuICAgICAgICBhY3Rpb25MaXN0ID0gQFtdIEBbXSBhY3Rpb25MaXN0LCBob3N0W2FjdGlvbkxpc3RdXG4gICAgICBlbHNlIGlmICEgQXJyYXkuaXNBcnJheSBAIGFjdGlvbkxpc3QgOjpcbiAgICAgICAgYWN0aW9uTGlzdCA9IE9iamVjdC5lbnRyaWVzKGFjdGlvbkxpc3QpXG4gICAgICBlbHNlIGlmICdzdHJpbmcnID09PSB0eXBlb2YgYWN0aW9uTGlzdFswXSA6OlxuICAgICAgICBhY3Rpb25MaXN0ID0gQFtdIGFjdGlvbkxpc3RcblxuXG4gICAgICBjb25zdCBpbXBsX3Byb3BzPXt9LCB2aWV3X3Byb3BzPXt9LCBob3N0X3Byb3BzID0ge31cbiAgICAgIGZvciBjb25zdCBbYWN0aW9uTmFtZSwgZm5BY3Rpb25dIG9mIGFjdGlvbkxpc3QgOjpcbiAgICAgICAgaWYgISBhY3Rpb25OYW1lIDo6XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBBY3Rpb24gbmFtZSBub3QgZm91bmRgXG4gICAgICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBmbkFjdGlvbiA6OlxuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgYWN0aW9uIFwiJHthY3Rpb25OYW1lfVwiIHRvIGJlIGEgZnVuY3Rpb24sIGJ1dCBmb3VuZCBcIiR7dHlwZW9mIGZuQWN0aW9ufVwiYFxuXG4gICAgICAgIGNvbnN0IGZuRGlzcGF0Y2ggPSBmdW5jdGlvbiAoLi4uYWN0aW9uQXJncykgOjpcbiAgICAgICAgICByZXR1cm4gZGlzcGF0Y2hBY3Rpb24obm90aWZ5LCBhY3Rpb25OYW1lLCBhY3Rpb25BcmdzKVxuXG4gICAgICAgIGltcGxfcHJvcHNbYWN0aW9uTmFtZV0gPSBAe30gdmFsdWU6IGZuQWN0aW9uXG4gICAgICAgIHZpZXdfcHJvcHNbYWN0aW9uTmFtZV0gPSBAe30gdmFsdWU6IGZuRGlzcGF0Y2hcbiAgICAgICAgaG9zdF9wcm9wc1thY3Rpb25OYW1lXSA9IEB7fSB2YWx1ZTogZm5EaXNwYXRjaCwgY29uZmlndXJhYmxlOiB0cnVlXG5cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgX19pbXBsX3Byb3RvX18sIGltcGxfcHJvcHNcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgX192aWV3X3Byb3RvX18sIHZpZXdfcHJvcHNcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgaG9zdCwgaG9zdF9wcm9wc1xuXG4gICAgcmV0dXJuIEB7fSBkaXNwYXRjaEFjdGlvbiwgZGVmaW5lQWN0aW9uXG5cblxuLy8gLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kVXBkYXRlRnVuY3Rpb24oKSA6OlxuICBsZXQgbm90aWZ5TGlzdCA9IFtdXG4gIGxldCBjdXJyZW50XG5cbiAgdXBkYXRlLnN1YnNjcmliZSA9IHN1YnNjcmliZVxuICByZXR1cm4gdXBkYXRlXG5cbiAgZnVuY3Rpb24gdXBkYXRlKG5leHQpIDo6XG4gICAgaWYgY3VycmVudCA9PT0gbmV4dCA6OiByZXR1cm5cblxuICAgIGN1cnJlbnQgPSBuZXh0XG4gICAgZm9yIGNvbnN0IGNiIG9mIG5vdGlmeUxpc3QgOjpcbiAgICAgIHRyeSA6OiBjYihjdXJyZW50KVxuICAgICAgY2F0Y2ggZXJyIDo6IGRpc2NhcmQoY2IpXG5cbiAgZnVuY3Rpb24gc3Vic2NyaWJlKC4uLmFyZ3MpIDo6XG4gICAgY29uc3QgY2FsbGJhY2sgPSBhcmdzLnBvcCgpXG4gICAgY29uc3Qgc2tpcEluaXRpYWxDYWxsID0gYXJnc1swXVxuXG4gICAgaWYgLTEgIT09IG5vdGlmeUxpc3QuaW5kZXhPZihjYWxsYmFjaykgOjpcbiAgICAgIHJldHVyblxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYWxsYmFjayA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBQbGVhc2Ugc3Vic2NyaWJlIHdpdGggYSBmdW5jdGlvbmBcblxuICAgIG5vdGlmeUxpc3QgPSBub3RpZnlMaXN0LmNvbmNhdCBAIFtjYWxsYmFja11cbiAgICBpZiAhIHNraXBJbml0aWFsQ2FsbCA6OlxuICAgICAgY2FsbGJhY2soY3VycmVudClcbiAgICB1bnN1YnNjcmliZS51bnN1YnNjcmliZSA9IHVuc3Vic2NyaWJlXG4gICAgcmV0dXJuIHVuc3Vic2NyaWJlXG5cbiAgICBmdW5jdGlvbiB1bnN1YnNjcmliZSgpIDo6XG4gICAgICBkaXNjYXJkKGNhbGxiYWNrKVxuXG4gIGZ1bmN0aW9uIGRpc2NhcmQoY2FsbGJhY2spIDo6XG4gICAgbm90aWZ5TGlzdCA9IG5vdGlmeUxpc3RcbiAgICAgIC5maWx0ZXIgQCBlID0+IGNhbGxiYWNrICE9PSBlXG5cbi8vIC0tLVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBzdGF0ZUFjdGlvbkRpc3BhdGNoKGhvc3QsIG9wdGlvbnM9e30pIDo6XG4gIGlmIG9wdGlvbnMudHJhbnNmb3JtIDo6XG4gICAgY29uc3QgeGZvcm0gPSBiaW5kU3RhdGVUcmFuc2Zvcm0ob3B0aW9ucy50cmFuc2Zvcm0sICd0cmFuc2Zvcm0nLCBvcHRpb25zLnRyYW5zZm9ybUZpbHRlcilcbiAgICBvcHRpb25zLmFmdGVyID0gW10uY29uY2F0IEAgb3B0aW9ucy5hZnRlciB8fCBbXSwgeGZvcm1cblxuICBpZiBvcHRpb25zLnZpZXdUcmFuc2Zvcm0gOjpcbiAgICBjb25zdCB4Zm9ybSA9IGJpbmRTdGF0ZVRyYW5zZm9ybShvcHRpb25zLnZpZXdUcmFuc2Zvcm0sICd2aWV3VHJhbnNmb3JtJywgb3B0aW9ucy52aWV3VHJhbnNmb3JtRmlsdGVyKVxuICAgIG9wdGlvbnMuY2hhbmdlZCA9IFtdLmNvbmNhdCBAIG9wdGlvbnMuY2hhbmdlZCB8fCBbXSwgeGZvcm1cblxuICBjb25zdCBpc0NoYW5nZWQgPSBvcHRpb25zLmlzQ2hhbmdlZCB8fCBob3N0Ll9faXNfY2hhbmdlZF9fIHx8IGlzT2JqZWN0Q2hhbmdlZFxuICBjb25zdCBvbl9iZWZvcmUgPSBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSBAIG9wdGlvbnMuYmVmb3JlLCBob3N0Ll9fZGlzcGF0Y2hfYmVmb3JlX18sICdiZWZvcmUnXG4gIGNvbnN0IG9uX2Vycm9yID0gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUgQCBvcHRpb25zLmVycm9yLCBob3N0Ll9fZGlzcGF0Y2hfZXJyb3JfXywgJ2Vycm9yJ1xuICBjb25zdCBvbl9hZnRlciA9IGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIEAgb3B0aW9ucy5hZnRlciwgaG9zdC5fX2Rpc3BhdGNoX2FmdGVyX18sICdhZnRlcidcbiAgY29uc3Qgb25fY2hhbmdlZCA9IGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIEAgb3B0aW9ucy5jaGFuZ2VkLCBob3N0Ll9fZGlzcGF0Y2hfY2hhbmdlZF9fLCAnY2hhbmdlZCdcbiAgY29uc3Qgb25fZnJlZXplID0gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUgQCBvcHRpb25zLmZyZWV6ZSwgaG9zdC5fX2Rpc3BhdGNoX2ZyZWV6ZV9fLCAnZnJlZXplJ1xuXG4gIGlmIHVuZGVmaW5lZCAhPT0gaXNDaGFuZ2VkICYmICdmdW5jdGlvbicgIT09IHR5cGVvZiBpc0NoYW5nZWQgOjpcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYERpc3BhdGNoIGV4cGVjdGVkICdpc0NoYW5nZWQnIG9wdGlvbiB0byBiZSBhIGZ1bmN0aW9uIGluc3RhbmNlYFxuXG4gIGxldCBzdGF0ZSA9IHt9LCBzdGF0ZV9zdW1tYXJ5LCB0aXBfdmlld1xuICByZXR1cm4gX19kaXNwYXRjaF9fXG5cbiAgZnVuY3Rpb24gX19kaXNwYXRjaF9fKG5vdGlmeSwgYWN0aW9uTmFtZSwgYWN0aW9uQXJncywgdmlldykgOjpcbiAgICBjb25zdCBwcmVfc3RhdGUgPSBzdGF0ZVxuICAgIGNvbnN0IHRndCA9IE9iamVjdC5jcmVhdGUgQCBob3N0Ll9faW1wbF9wcm90b19fXG5cbiAgICBPYmplY3QuYXNzaWduIEAgdGd0LCBzdGF0ZVxuXG4gICAgbGV0IHJlc3VsdFxuICAgIGNvbnN0IGN0eCA9IEA6IGFjdGlvbjogW2FjdGlvbk5hbWUsIGFjdGlvbkFyZ3MsIHZpZXddXG4gICAgICBwcmVfc3RhdGUsIGlzVGlwVmlldzogdGlwX3ZpZXcgPT09IHZpZXcgJiYgdmlldyAhPT0gdW5kZWZpbmVkXG5cbiAgICB0cnkgOjpcbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gb25fYmVmb3JlIDo6XG4gICAgICAgIG9uX2JlZm9yZSh0Z3QsIGN0eClcblxuICAgICAgdHJ5IDo6XG4gICAgICAgIC8vIGRpc3BhdGNoIGFjdGlvbiBtZXRob2RcbiAgICAgICAgaWYgYWN0aW9uTmFtZSA6OlxuICAgICAgICAgIHJlc3VsdCA9IHRndFthY3Rpb25OYW1lXS5hcHBseSh0Z3QsIGFjdGlvbkFyZ3MpXG4gICAgICAgICAgY3R4LnJlc3VsdCA9IHJlc3VsdFxuICAgICAgICBlbHNlIDo6XG4gICAgICAgICAgY3R4LnJlc3VsdCA9IHJlc3VsdCA9IHRpcF92aWV3ID0gdGd0XG5cbiAgICAgICAgLy8gdHJhbnNmb3JtIGZyb20gaW1wbCBkb3duIHRvIGEgdmlld1xuICAgICAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YodGd0LCBob3N0Ll9fdmlld19wcm90b19fKVxuXG4gICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgLy8gdHJhbnNmb3JtIGZyb20gaW1wbCBkb3duIHRvIGEgdmlld1xuICAgICAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YodGd0LCBob3N0Ll9fdmlld19wcm90b19fKVxuXG4gICAgICAgIC8vIGhhbmRsZSBlcnJvciBmcm9tIGFjdGlvbiBtZXRob2RcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSBvbl9lcnJvciA6OiB0aHJvdyBlcnJcblxuICAgICAgICBjb25zdCBzaG91bGRUaHJvdyA9IG9uX2Vycm9yKGVyciwgdGd0LCBjdHgpXG4gICAgICAgIGlmIGZhbHNlICE9PSBzaG91bGRUaHJvdyA6OiB0aHJvdyBlcnJcblxuICAgICAgaWYgdW5kZWZpbmVkICE9PSBvbl9hZnRlciA6OlxuICAgICAgICBvbl9hZnRlcih0Z3QsIGN0eClcblxuICAgICAgLy8gY2FwdHVyZSBzdGF0ZSBhZnRlciBkaXNwYXRjaGluZyBhY3Rpb25cbiAgICAgIGNvbnN0IHBvc3Rfc3RhdGUgPSBPYmplY3QuYXNzaWduIEAge30sIHRndFxuICAgICAgY3R4LnBvc3Rfc3RhdGUgPSBwb3N0X3N0YXRlXG5cbiAgICAgIGlmIHByZV9zdGF0ZSAhPT0gc3RhdGUgOjpcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYEFzeW5jIGNvbmZsaWN0aW5nIHVwZGF0ZSBvZiBcIiR7aG9zdC5jb25zdHJ1Y3Rvci5uYW1lfVwiIG9jY3VyZWRgXG5cbiAgICAgIGNvbnN0IGNoYW5nZV9zdW1tYXJ5ID0gaXNDaGFuZ2VkKHByZV9zdGF0ZSwgcG9zdF9zdGF0ZSwgc3RhdGVfc3VtbWFyeSwgY3R4KVxuICAgICAgaWYgY2hhbmdlX3N1bW1hcnkgOjpcbiAgICAgICAgY3R4LmNoYW5nZWQgPSB0cnVlXG4gICAgICAgIHN0YXRlID0gcG9zdF9zdGF0ZVxuICAgICAgICBzdGF0ZV9zdW1tYXJ5ID0gY2hhbmdlX3N1bW1hcnlcbiAgICAgICAgdGlwX3ZpZXcgPSB0Z3RcblxuICAgICAgICBpZiB1bmRlZmluZWQgIT09IG9uX2NoYW5nZWQgOjpcbiAgICAgICAgICBvbl9jaGFuZ2VkKHRndCwgY3R4KVxuXG4gICAgICBlbHNlIGlmIHRndCA9PT0gcmVzdWx0IDo6XG4gICAgICAgIGN0eC5yZXN1bHQgPSByZXN1bHQgPSB0aXBfdmlld1xuXG4gICAgZmluYWxseSA6OlxuICAgICAgaWYgdW5kZWZpbmVkICE9PSBvbl9mcmVlemUgOjpcbiAgICAgICAgdHJ5IDo6XG4gICAgICAgICAgb25fZnJlZXplKHRndCwgY3R4KVxuICAgICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgICBQcm9taXNlLnJlamVjdChlcnIpXG4gICAgICBPYmplY3QuZnJlZXplKHRndClcblxuICAgIG5vdGlmeSh0aXBfdmlldylcbiAgICByZXR1cm4gcmVzdWx0XG5cbi8vIC0tLVxuXG5leHBvcnQgZnVuY3Rpb24gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUoY2FsbGJhY2ssIGhvc3RfY2FsbGJhY2ssIGNhbGxiYWNrX25hbWUpIDo6XG4gIGlmIG51bGwgIT0gaG9zdF9jYWxsYmFjayA6OlxuICAgIGNhbGxiYWNrID0gW10uY29uY2F0IEAgaG9zdF9jYWxsYmFjaywgY2FsbGJhY2sgfHwgW11cbiAgZWxzZSBpZiBudWxsID09IGNhbGxiYWNrIDo6IHJldHVyblxuXG4gIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBjYWxsYmFjayA6OiByZXR1cm4gY2FsbGJhY2tcblxuICBpZiBBcnJheS5pc0FycmF5KGNhbGxiYWNrKSB8fCBjYWxsYmFja1tTeW1ib2wuaXRlcmF0b3JdIDo6XG4gICAgY29uc3QgY2FsbGJhY2tMaXN0ID0gQXJyYXkuZnJvbShjYWxsYmFjaykuZmlsdGVyKGUgPT4gbnVsbCAhPSBlKVxuXG4gICAgaWYgY2FsbGJhY2tMaXN0LnNvbWUgQCBjYiA9PiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2IgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRGlzcGF0Y2ggZXhwZWN0ZWQgJyR7Y2FsbGJhY2tfbmFtZX0nIG9wdGlvbiB0byBvbmx5IGluY2x1ZGUgZnVuY3Rpb25zIGluIGxpc3RgXG5cbiAgICBpZiBjYWxsYmFja0xpc3QubGVuZ3RoIDw9IDEgOjpcbiAgICAgIGNhbGxiYWNrID0gY2FsbGJhY2tMaXN0LnBvcCgpXG4gICAgZWxzZSA6OlxuICAgICAgY2FsbGJhY2sgPSBmdW5jdGlvbiAodGd0LCBhcmcxLCBhcmcyKSA6OlxuICAgICAgICBmb3IgY29uc3QgY2Igb2YgY2FsbGJhY2tMaXN0IDo6XG4gICAgICAgICAgdHJ5IDo6IGNiKHRndCwgYXJnMSwgYXJnMilcbiAgICAgICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgICAgIFByb21pc2UucmVqZWN0KGVycilcblxuICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2FsbGJhY2sgOjpcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYERpc3BhdGNoIGV4cGVjdGVkICcke2NhbGxiYWNrX25hbWV9JyBvcHRpb24gdG8gYmUgYSBmdW5jdGlvbiBpbnN0YW5jZSBvciBsaXN0IG9mIGZ1bmN0aW9uc2BcbiAgcmV0dXJuIGNhbGxiYWNrXG5cbi8vIC0tLVxuXG5leHBvcnQgZnVuY3Rpb24gaXNPYmplY3RDaGFuZ2VkKHByZXYsIG5leHQpIDo6XG4gIGlmIHByZXYgPT09IHVuZGVmaW5lZCA6OlxuICAgIHJldHVybiBuZXh0ICE9PSB1bmRlZmluZWRcblxuICBmb3IgY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKG5leHQpIDo6XG4gICAgaWYgISBAIGtleSBpbiBwcmV2IDo6XG4gICAgICByZXR1cm4gdHJ1ZSAvLyBhZGRlZFxuXG4gIGZvciBjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocHJldikgOjpcbiAgICBpZiBwcmV2W2tleV0gIT09IG5leHRba2V5XSA6OlxuICAgICAgcmV0dXJuIHRydWUgLy8gY2hhbmdlZFxuICAgIGlmICEgQCBrZXkgaW4gbmV4dCA6OlxuICAgICAgcmV0dXJuIHRydWUgLy8gcmVtb3ZlZFxuXG4gIHJldHVybiBmYWxzZVxuXG4vLyAtLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRTdGF0ZVRyYW5zZm9ybSh4Zm9ybSwgeGZvcm1fbmFtZSwgeGZvcm1fZmlsdGVyKSA6OlxuICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgeGZvcm0gOjpcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBFeHBlY3RlZCAke3hmb3JtX25hbWV9dG8gYmUgYSBmdW5jdGlvbmApXG5cbiAgaWYgdHJ1ZSA9PT0geGZvcm1fZmlsdGVyIHx8ICdub3QtZnJvemVuJyA6OlxuICAgIHhmb3JtX2ZpbHRlciA9IGF0dHIgPT4gISBPYmplY3QuaXNGcm96ZW4oYXR0cilcblxuICByZXR1cm4gZnVuY3Rpb24odGd0KSA6OlxuICAgIGZvciBjb25zdCBrZXkgb2YgT2JqZWN0LmtleXModGd0KSA6OlxuICAgICAgY29uc3QgYXR0ciA9IHRndFtrZXldXG4gICAgICBpZiAhIHhmb3JtX2ZpbHRlciB8fCB4Zm9ybV9maWx0ZXIoYXR0ciwga2V5KSA6OlxuICAgICAgICB0Z3Rba2V5XSA9IHhmb3JtIEAgYXR0clxuXG4iLCJpbXBvcnQgZGVlcEZyZWV6ZSBmcm9tICdkZWVwLWZyZWV6ZSdcbmltcG9ydCB7YXNGdW5jdGlvbmFsT2JqZWN0fSBmcm9tICcuL2luZGV4LmpzeSdcblxuZXhwb3J0IGZ1bmN0aW9uIGFzRGVlcEZyZWV6ZUZ1bmN0aW9uYWxPYmplY3QoaG9zdCwgLi4ub3B0aW9ucykgOjpcbiAgcmV0dXJuIGFzRnVuY3Rpb25hbE9iamVjdCBAIGhvc3QsIHt0cmFuc2Zvcm06IGRlZXBGcmVlemUsIHRyYW5zZm9ybUZpbHRlcjogdHJ1ZX0sIC4uLm9wdGlvbnNcblxuZXhwb3J0IGZ1bmN0aW9uIERlZXBGcmVlemVPYmplY3RGdW5jdGlvbmFsKCkgOjpcbiAgcmV0dXJuIGFzRGVlcEZyZWV6ZUZ1bmN0aW9uYWxPYmplY3QodGhpcylcblxuIl0sIm5hbWVzIjpbImFzRnVuY3Rpb25hbE9iamVjdCIsImhvc3QiLCJvcHRpb25zIiwiT2JqZWN0IiwiYXNzaWduIiwibm90aWZ5IiwiYmluZFVwZGF0ZUZ1bmN0aW9uIiwiZGlzcGF0Y2hBY3Rpb24iLCJkZWZpbmVBY3Rpb24iLCJiaW5kQWN0aW9uRGVjbGFyYXRpb25zIiwiYWN0aW9ucyIsInN1YnNjcmliZSIsInZhbHVlIiwiYXJncyIsIl9faW1wbF9wcm90b19fIiwiY3JlYXRlIiwiZ2V0UHJvdG90eXBlT2YiLCJfX3ZpZXdfcHJvdG9fXyIsImRlZmluZVByb3BlcnRpZXMiLCJhc0FjdGlvbiIsInNldCIsImNvbmZpZ3VyYWJsZSIsImZyZWV6ZSIsIlR5cGVFcnJvciIsIl9fZGlzcGF0Y2hfXyIsImFjdGlvbk5hbWUiLCJhY3Rpb25BcmdzIiwic3RhdGVBY3Rpb25EaXNwYXRjaCIsImFjdGlvbkxpc3QiLCJuYW1lIiwiQXJyYXkiLCJpc0FycmF5IiwiZW50cmllcyIsImltcGxfcHJvcHMiLCJ2aWV3X3Byb3BzIiwiaG9zdF9wcm9wcyIsImZuQWN0aW9uIiwiZm5EaXNwYXRjaCIsIm5vdGlmeUxpc3QiLCJjdXJyZW50IiwidXBkYXRlIiwibmV4dCIsImNiIiwiZXJyIiwiY2FsbGJhY2siLCJwb3AiLCJza2lwSW5pdGlhbENhbGwiLCJpbmRleE9mIiwiY29uY2F0IiwidW5zdWJzY3JpYmUiLCJkaXNjYXJkIiwiZmlsdGVyIiwiZSIsInRyYW5zZm9ybSIsInhmb3JtIiwiYmluZFN0YXRlVHJhbnNmb3JtIiwidHJhbnNmb3JtRmlsdGVyIiwiYWZ0ZXIiLCJ2aWV3VHJhbnNmb3JtIiwidmlld1RyYW5zZm9ybUZpbHRlciIsImNoYW5nZWQiLCJpc0NoYW5nZWQiLCJfX2lzX2NoYW5nZWRfXyIsImlzT2JqZWN0Q2hhbmdlZCIsIm9uX2JlZm9yZSIsImFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIiwiYmVmb3JlIiwiX19kaXNwYXRjaF9iZWZvcmVfXyIsIm9uX2Vycm9yIiwiZXJyb3IiLCJfX2Rpc3BhdGNoX2Vycm9yX18iLCJvbl9hZnRlciIsIl9fZGlzcGF0Y2hfYWZ0ZXJfXyIsIm9uX2NoYW5nZWQiLCJfX2Rpc3BhdGNoX2NoYW5nZWRfXyIsIm9uX2ZyZWV6ZSIsIl9fZGlzcGF0Y2hfZnJlZXplX18iLCJ1bmRlZmluZWQiLCJzdGF0ZSIsInN0YXRlX3N1bW1hcnkiLCJ0aXBfdmlldyIsInZpZXciLCJwcmVfc3RhdGUiLCJ0Z3QiLCJyZXN1bHQiLCJjdHgiLCJhY3Rpb24iLCJpc1RpcFZpZXciLCJhcHBseSIsInNldFByb3RvdHlwZU9mIiwic2hvdWxkVGhyb3ciLCJwb3N0X3N0YXRlIiwiRXJyb3IiLCJjb25zdHJ1Y3RvciIsImNoYW5nZV9zdW1tYXJ5IiwicmVqZWN0IiwiaG9zdF9jYWxsYmFjayIsImNhbGxiYWNrX25hbWUiLCJTeW1ib2wiLCJpdGVyYXRvciIsImNhbGxiYWNrTGlzdCIsImZyb20iLCJzb21lIiwibGVuZ3RoIiwiYXJnMSIsImFyZzIiLCJwcmV2Iiwia2V5Iiwia2V5cyIsInhmb3JtX25hbWUiLCJ4Zm9ybV9maWx0ZXIiLCJhdHRyIiwiaXNGcm96ZW4iLCJhc0RlZXBGcmVlemVGdW5jdGlvbmFsT2JqZWN0IiwiZGVlcEZyZWV6ZSIsIkRlZXBGcmVlemVPYmplY3RGdW5jdGlvbmFsIl0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUdBOztBQUVBLEFBQU8sU0FBU0Esa0JBQVQsQ0FBNEJDLElBQTVCLEVBQWtDLEdBQUdDLE9BQXJDLEVBQThDOztZQUV6Q0MsT0FBT0MsTUFBUCxDQUFjLEVBQWQsRUFBa0IsR0FBR0YsT0FBckIsQ0FBVjtRQUNNRyxTQUFTLFFBQVFILFFBQVFHLE1BQWhCLEdBQ1hDLG1CQUFtQkwsSUFBbkIsRUFBeUJDLE9BQXpCLENBRFcsR0FFWEEsUUFBUUcsTUFGWjs7O1FBT00sRUFBQ0UsY0FBRCxFQUFpQkMsWUFBakIsS0FBaUNDLHVCQUF1QkosTUFBdkIsQ0FBdkM7TUFDR0gsUUFBUVEsT0FBWCxFQUFxQjtpQkFBY1IsUUFBUVEsT0FBckI7OztRQUVoQkMsWUFBWSxFQUFJQyxNQUFNLEdBQUdDLElBQVQsRUFBZTthQUFVUixPQUFPTSxTQUFQLENBQWlCLEdBQUdFLElBQXBCLENBQVA7S0FBdEIsRUFBbEI7UUFDTUMsaUJBQWlCWCxPQUFPWSxNQUFQLENBQWdCWixPQUFPYSxjQUFQLENBQXNCZixJQUF0QixDQUFoQixFQUE2QyxFQUFJVSxTQUFKLEVBQTdDLENBQXZCO1FBQ01NLGlCQUFpQmQsT0FBT1ks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
