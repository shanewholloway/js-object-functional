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

function asFrozenFunctionalObject(host, ...options) {
  return asFunctionalObject(host, { transform: Object.freeze, transformFilter: true }, ...options);
}

function FrozenObjectFunctional() {
  return asFrozenFunctionalObject(this);
}

export { asFrozenFunctionalObject, FrozenObjectFunctional };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvemVuLm1qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9pbmRleC5qc3kiLCIuLi9jb2RlL2Zyb3plbi5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZnVuY3Rpb24gT2JqZWN0RnVuY3Rpb25hbCgpIDo6XG4gIHJldHVybiBhc0Z1bmN0aW9uYWxPYmplY3QodGhpcylcblxuLy8gLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBhc0Z1bmN0aW9uYWxPYmplY3QoaG9zdCwgLi4ub3B0aW9ucykgOjpcbiAgLy8gaW5pdGlhbGl6ZSBvcHRpb25zXG4gIG9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCAuLi5vcHRpb25zKVxuICBjb25zdCBub3RpZnkgPSBudWxsID09IG9wdGlvbnMubm90aWZ5XG4gICAgPyBiaW5kVXBkYXRlRnVuY3Rpb24oaG9zdCwgb3B0aW9ucylcbiAgICA6IG9wdGlvbnMubm90aWZ5XG5cblxuXG4gIC8vIHNldHVwIGFzQWN0aW9uIHNldHRlciBoYWNrIC0tIGluIGxpZXUgb2YgRVMgc3RhbmRhcmQgZGVjb3JhdG9yc1xuICBjb25zdCB7ZGlzcGF0Y2hBY3Rpb24sIGRlZmluZUFjdGlvbn0gPSBiaW5kQWN0aW9uRGVjbGFyYXRpb25zKG5vdGlmeSlcbiAgaWYgb3B0aW9ucy5hY3Rpb25zIDo6IGRlZmluZUFjdGlvbihvcHRpb25zLmFjdGlvbnMpXG5cbiAgY29uc3Qgc3Vic2NyaWJlID0gQHt9IHZhbHVlKC4uLmFyZ3MpIDo6IHJldHVybiBub3RpZnkuc3Vic2NyaWJlKC4uLmFyZ3MpXG4gIGNvbnN0IF9faW1wbF9wcm90b19fID0gT2JqZWN0LmNyZWF0ZSBAIE9iamVjdC5nZXRQcm90b3R5cGVPZihob3N0KSwgQHt9IHN1YnNjcmliZVxuICBjb25zdCBfX3ZpZXdfcHJvdG9fXyA9IE9iamVjdC5jcmVhdGUgQCBPYmplY3QuZ2V0UHJvdG90eXBlT2YoaG9zdCksIEB7fSBzdWJzY3JpYmVcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIGhvc3QsIEB7fVxuICAgIHN1YnNjcmliZSwgYXNBY3Rpb246IEB7fSBzZXQ6IGRlZmluZUFjdGlvblxuICAgIF9faW1wbF9wcm90b19fOiBAe30gY29uZmlndXJhYmxlOiB0cnVlLCB2YWx1ZTogX19pbXBsX3Byb3RvX19cbiAgICBfX3ZpZXdfcHJvdG9fXzogQHt9IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IF9fdmlld19wcm90b19fXG5cblxuICAvLyBpbml0aWFsaXplIHRoZSBpbnRlcm5hbCBzdGF0IHdpdGggaW5pdGlhbCB2aWV3XG4gIGRpc3BhdGNoQWN0aW9uKG5vdGlmeSwgbnVsbCwgW10sIG51bGwpXG5cbiAgLy8gcmV0dXJuIGEgZnJvemVuIGNsb25lIG9mIHRoZSBob3N0IG9iamVjdFxuICByZXR1cm4gT2JqZWN0LmZyZWV6ZSBAIE9iamVjdC5jcmVhdGUgQCBob3N0XG5cblxuICBmdW5jdGlvbiBiaW5kQWN0aW9uRGVjbGFyYXRpb25zKG5vdGlmeSkgOjpcbiAgICBsZXQgZGlzcGF0Y2hBY3Rpb25cbiAgICBpZiBudWxsICE9IG9wdGlvbnMuZGlzcGF0Y2hBY3Rpb24gOjpcbiAgICAgIGRpc3BhdGNoQWN0aW9uID0gb3B0aW9ucy5kaXNwYXRjaEFjdGlvblxuICAgICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGRpc3BhdGNoQWN0aW9uIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEV4cGVjdGVkIGEgZGlzcGF0Y2hBY3Rpb24obm90aWZ5LCBhY3Rpb25OYW1lLCBhY3Rpb25BcmdzKXvigKZ9IGZ1bmN0aW9uYClcbiAgICBlbHNlIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBob3N0Ll9fZGlzcGF0Y2hfXyA6OlxuICAgICAgZGlzcGF0Y2hBY3Rpb24gPSBmdW5jdGlvbihub3RpZnksIGFjdGlvbk5hbWUsIGFjdGlvbkFyZ3MpIDo6XG4gICAgICAgIHJldHVybiBob3N0Ll9fZGlzcGF0Y2hfXyhub3RpZnksIGFjdGlvbk5hbWUsIGFjdGlvbkFyZ3MpXG4gICAgZWxzZSA6OlxuICAgICAgZGlzcGF0Y2hBY3Rpb24gPSBzdGF0ZUFjdGlvbkRpc3BhdGNoKGhvc3QsIG9wdGlvbnMpXG5cblxuICAgIGNvbnN0IGRlZmluZUFjdGlvbiA9IChhY3Rpb25MaXN0KSA9PiA6OlxuICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGFjdGlvbkxpc3QgOjpcbiAgICAgICAgYWN0aW9uTGlzdCA9IEBbXSBAW10gYWN0aW9uTGlzdC5uYW1lLCBhY3Rpb25MaXN0XG4gICAgICBlbHNlIGlmICdzdHJpbmcnID09PSB0eXBlb2YgYWN0aW9uTGlzdCA6OlxuICAgICAgICBhY3Rpb25MaXN0ID0gQFtdIEBbXSBhY3Rpb25MaXN0LCBob3N0W2FjdGlvbkxpc3RdXG4gICAgICBlbHNlIGlmICEgQXJyYXkuaXNBcnJheSBAIGFjdGlvbkxpc3QgOjpcbiAgICAgICAgYWN0aW9uTGlzdCA9IE9iamVjdC5lbnRyaWVzKGFjdGlvbkxpc3QpXG4gICAgICBlbHNlIGlmICdzdHJpbmcnID09PSB0eXBlb2YgYWN0aW9uTGlzdFswXSA6OlxuICAgICAgICBhY3Rpb25MaXN0ID0gQFtdIGFjdGlvbkxpc3RcblxuXG4gICAgICBjb25zdCBpbXBsX3Byb3BzPXt9LCB2aWV3X3Byb3BzPXt9LCBob3N0X3Byb3BzID0ge31cbiAgICAgIGZvciBjb25zdCBbYWN0aW9uTmFtZSwgZm5BY3Rpb25dIG9mIGFjdGlvbkxpc3QgOjpcbiAgICAgICAgaWYgISBhY3Rpb25OYW1lIDo6XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBBY3Rpb24gbmFtZSBub3QgZm91bmRgXG4gICAgICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBmbkFjdGlvbiA6OlxuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgYWN0aW9uIFwiJHthY3Rpb25OYW1lfVwiIHRvIGJlIGEgZnVuY3Rpb24sIGJ1dCBmb3VuZCBcIiR7dHlwZW9mIGZuQWN0aW9ufVwiYFxuXG4gICAgICAgIGNvbnN0IGZuRGlzcGF0Y2ggPSBmdW5jdGlvbiAoLi4uYWN0aW9uQXJncykgOjpcbiAgICAgICAgICByZXR1cm4gZGlzcGF0Y2hBY3Rpb24obm90aWZ5LCBhY3Rpb25OYW1lLCBhY3Rpb25BcmdzKVxuXG4gICAgICAgIGltcGxfcHJvcHNbYWN0aW9uTmFtZV0gPSBAe30gdmFsdWU6IGZuQWN0aW9uXG4gICAgICAgIHZpZXdfcHJvcHNbYWN0aW9uTmFtZV0gPSBAe30gdmFsdWU6IGZuRGlzcGF0Y2hcbiAgICAgICAgaG9zdF9wcm9wc1thY3Rpb25OYW1lXSA9IEB7fSB2YWx1ZTogZm5EaXNwYXRjaCwgY29uZmlndXJhYmxlOiB0cnVlXG5cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgX19pbXBsX3Byb3RvX18sIGltcGxfcHJvcHNcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgX192aWV3X3Byb3RvX18sIHZpZXdfcHJvcHNcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgaG9zdCwgaG9zdF9wcm9wc1xuXG4gICAgcmV0dXJuIEB7fSBkaXNwYXRjaEFjdGlvbiwgZGVmaW5lQWN0aW9uXG5cblxuLy8gLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kVXBkYXRlRnVuY3Rpb24oKSA6OlxuICBsZXQgbm90aWZ5TGlzdCA9IFtdXG4gIGxldCBjdXJyZW50XG5cbiAgdXBkYXRlLnN1YnNjcmliZSA9IHN1YnNjcmliZVxuICByZXR1cm4gdXBkYXRlXG5cbiAgZnVuY3Rpb24gdXBkYXRlKG5leHQpIDo6XG4gICAgaWYgY3VycmVudCA9PT0gbmV4dCA6OiByZXR1cm5cblxuICAgIGN1cnJlbnQgPSBuZXh0XG4gICAgZm9yIGNvbnN0IGNiIG9mIG5vdGlmeUxpc3QgOjpcbiAgICAgIHRyeSA6OiBjYihjdXJyZW50KVxuICAgICAgY2F0Y2ggZXJyIDo6IGRpc2NhcmQoY2IpXG5cbiAgZnVuY3Rpb24gc3Vic2NyaWJlKC4uLmFyZ3MpIDo6XG4gICAgY29uc3QgY2FsbGJhY2sgPSBhcmdzLnBvcCgpXG4gICAgY29uc3Qgc2tpcEluaXRpYWxDYWxsID0gYXJnc1swXVxuXG4gICAgaWYgLTEgIT09IG5vdGlmeUxpc3QuaW5kZXhPZihjYWxsYmFjaykgOjpcbiAgICAgIHJldHVyblxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYWxsYmFjayA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBQbGVhc2Ugc3Vic2NyaWJlIHdpdGggYSBmdW5jdGlvbmBcblxuICAgIG5vdGlmeUxpc3QgPSBub3RpZnlMaXN0LmNvbmNhdCBAIFtjYWxsYmFja11cbiAgICBpZiAhIHNraXBJbml0aWFsQ2FsbCA6OlxuICAgICAgY2FsbGJhY2soY3VycmVudClcbiAgICB1bnN1YnNjcmliZS51bnN1YnNjcmliZSA9IHVuc3Vic2NyaWJlXG4gICAgcmV0dXJuIHVuc3Vic2NyaWJlXG5cbiAgICBmdW5jdGlvbiB1bnN1YnNjcmliZSgpIDo6XG4gICAgICBkaXNjYXJkKGNhbGxiYWNrKVxuXG4gIGZ1bmN0aW9uIGRpc2NhcmQoY2FsbGJhY2spIDo6XG4gICAgbm90aWZ5TGlzdCA9IG5vdGlmeUxpc3RcbiAgICAgIC5maWx0ZXIgQCBlID0+IGNhbGxiYWNrICE9PSBlXG5cbi8vIC0tLVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBzdGF0ZUFjdGlvbkRpc3BhdGNoKGhvc3QsIG9wdGlvbnM9e30pIDo6XG4gIGlmIG9wdGlvbnMudHJhbnNmb3JtIDo6XG4gICAgY29uc3QgeGZvcm0gPSBiaW5kU3RhdGVUcmFuc2Zvcm0ob3B0aW9ucy50cmFuc2Zvcm0sICd0cmFuc2Zvcm0nLCBvcHRpb25zLnRyYW5zZm9ybUZpbHRlcilcbiAgICBvcHRpb25zLmFmdGVyID0gW10uY29uY2F0IEAgb3B0aW9ucy5hZnRlciB8fCBbXSwgeGZvcm1cblxuICBpZiBvcHRpb25zLnZpZXdUcmFuc2Zvcm0gOjpcbiAgICBjb25zdCB4Zm9ybSA9IGJpbmRTdGF0ZVRyYW5zZm9ybShvcHRpb25zLnZpZXdUcmFuc2Zvcm0sICd2aWV3VHJhbnNmb3JtJywgb3B0aW9ucy52aWV3VHJhbnNmb3JtRmlsdGVyKVxuICAgIG9wdGlvbnMuY2hhbmdlZCA9IFtdLmNvbmNhdCBAIG9wdGlvbnMuY2hhbmdlZCB8fCBbXSwgeGZvcm1cblxuICBjb25zdCBpc0NoYW5nZWQgPSBvcHRpb25zLmlzQ2hhbmdlZCB8fCBob3N0Ll9faXNfY2hhbmdlZF9fIHx8IGlzT2JqZWN0Q2hhbmdlZFxuICBjb25zdCBvbl9iZWZvcmUgPSBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSBAIG9wdGlvbnMuYmVmb3JlLCBob3N0Ll9fZGlzcGF0Y2hfYmVmb3JlX18sICdiZWZvcmUnXG4gIGNvbnN0IG9uX2Vycm9yID0gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUgQCBvcHRpb25zLmVycm9yLCBob3N0Ll9fZGlzcGF0Y2hfZXJyb3JfXywgJ2Vycm9yJ1xuICBjb25zdCBvbl9hZnRlciA9IGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIEAgb3B0aW9ucy5hZnRlciwgaG9zdC5fX2Rpc3BhdGNoX2FmdGVyX18sICdhZnRlcidcbiAgY29uc3Qgb25fY2hhbmdlZCA9IGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIEAgb3B0aW9ucy5jaGFuZ2VkLCBob3N0Ll9fZGlzcGF0Y2hfY2hhbmdlZF9fLCAnY2hhbmdlZCdcbiAgY29uc3Qgb25fZnJlZXplID0gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUgQCBvcHRpb25zLmZyZWV6ZSwgaG9zdC5fX2Rpc3BhdGNoX2ZyZWV6ZV9fLCAnZnJlZXplJ1xuXG4gIGlmIHVuZGVmaW5lZCAhPT0gaXNDaGFuZ2VkICYmICdmdW5jdGlvbicgIT09IHR5cGVvZiBpc0NoYW5nZWQgOjpcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYERpc3BhdGNoIGV4cGVjdGVkICdpc0NoYW5nZWQnIG9wdGlvbiB0byBiZSBhIGZ1bmN0aW9uIGluc3RhbmNlYFxuXG4gIGxldCBzdGF0ZSA9IHt9LCBzdGF0ZV9zdW1tYXJ5LCB0aXBfdmlld1xuICByZXR1cm4gX19kaXNwYXRjaF9fXG5cbiAgZnVuY3Rpb24gX19kaXNwYXRjaF9fKG5vdGlmeSwgYWN0aW9uTmFtZSwgYWN0aW9uQXJncywgdmlldykgOjpcbiAgICBjb25zdCBwcmVfc3RhdGUgPSBzdGF0ZVxuICAgIGNvbnN0IHRndCA9IE9iamVjdC5jcmVhdGUgQCBob3N0Ll9faW1wbF9wcm90b19fXG5cbiAgICBPYmplY3QuYXNzaWduIEAgdGd0LCBzdGF0ZVxuXG4gICAgbGV0IHJlc3VsdFxuICAgIGNvbnN0IGN0eCA9IEA6IGFjdGlvbjogW2FjdGlvbk5hbWUsIGFjdGlvbkFyZ3MsIHZpZXddXG4gICAgICBwcmVfc3RhdGUsIGlzVGlwVmlldzogdGlwX3ZpZXcgPT09IHZpZXcgJiYgdmlldyAhPT0gdW5kZWZpbmVkXG5cbiAgICB0cnkgOjpcbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gb25fYmVmb3JlIDo6XG4gICAgICAgIG9uX2JlZm9yZSh0Z3QsIGN0eClcblxuICAgICAgdHJ5IDo6XG4gICAgICAgIC8vIGRpc3BhdGNoIGFjdGlvbiBtZXRob2RcbiAgICAgICAgaWYgYWN0aW9uTmFtZSA6OlxuICAgICAgICAgIHJlc3VsdCA9IHRndFthY3Rpb25OYW1lXS5hcHBseSh0Z3QsIGFjdGlvbkFyZ3MpXG4gICAgICAgICAgY3R4LnJlc3VsdCA9IHJlc3VsdFxuICAgICAgICBlbHNlIDo6XG4gICAgICAgICAgY3R4LnJlc3VsdCA9IHJlc3VsdCA9IHRpcF92aWV3ID0gdGd0XG5cbiAgICAgICAgLy8gdHJhbnNmb3JtIGZyb20gaW1wbCBkb3duIHRvIGEgdmlld1xuICAgICAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YodGd0LCBob3N0Ll9fdmlld19wcm90b19fKVxuXG4gICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgLy8gdHJhbnNmb3JtIGZyb20gaW1wbCBkb3duIHRvIGEgdmlld1xuICAgICAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YodGd0LCBob3N0Ll9fdmlld19wcm90b19fKVxuXG4gICAgICAgIC8vIGhhbmRsZSBlcnJvciBmcm9tIGFjdGlvbiBtZXRob2RcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSBvbl9lcnJvciA6OiB0aHJvdyBlcnJcblxuICAgICAgICBjb25zdCBzaG91bGRUaHJvdyA9IG9uX2Vycm9yKGVyciwgdGd0LCBjdHgpXG4gICAgICAgIGlmIGZhbHNlICE9PSBzaG91bGRUaHJvdyA6OiB0aHJvdyBlcnJcblxuICAgICAgaWYgdW5kZWZpbmVkICE9PSBvbl9hZnRlciA6OlxuICAgICAgICBvbl9hZnRlcih0Z3QsIGN0eClcblxuICAgICAgLy8gY2FwdHVyZSBzdGF0ZSBhZnRlciBkaXNwYXRjaGluZyBhY3Rpb25cbiAgICAgIGNvbnN0IHBvc3Rfc3RhdGUgPSBPYmplY3QuYXNzaWduIEAge30sIHRndFxuICAgICAgY3R4LnBvc3Rfc3RhdGUgPSBwb3N0X3N0YXRlXG5cbiAgICAgIGlmIHByZV9zdGF0ZSAhPT0gc3RhdGUgOjpcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYEFzeW5jIGNvbmZsaWN0aW5nIHVwZGF0ZSBvZiBcIiR7aG9zdC5jb25zdHJ1Y3Rvci5uYW1lfVwiIG9jY3VyZWRgXG5cbiAgICAgIGNvbnN0IGNoYW5nZV9zdW1tYXJ5ID0gaXNDaGFuZ2VkKHByZV9zdGF0ZSwgcG9zdF9zdGF0ZSwgc3RhdGVfc3VtbWFyeSwgY3R4KVxuICAgICAgaWYgY2hhbmdlX3N1bW1hcnkgOjpcbiAgICAgICAgY3R4LmNoYW5nZWQgPSB0cnVlXG4gICAgICAgIHN0YXRlID0gcG9zdF9zdGF0ZVxuICAgICAgICBzdGF0ZV9zdW1tYXJ5ID0gY2hhbmdlX3N1bW1hcnlcbiAgICAgICAgdGlwX3ZpZXcgPSB0Z3RcblxuICAgICAgICBpZiB1bmRlZmluZWQgIT09IG9uX2NoYW5nZWQgOjpcbiAgICAgICAgICBvbl9jaGFuZ2VkKHRndCwgY3R4KVxuXG4gICAgICBlbHNlIGlmIHRndCA9PT0gcmVzdWx0IDo6XG4gICAgICAgIGN0eC5yZXN1bHQgPSByZXN1bHQgPSB0aXBfdmlld1xuXG4gICAgZmluYWxseSA6OlxuICAgICAgaWYgdW5kZWZpbmVkICE9PSBvbl9mcmVlemUgOjpcbiAgICAgICAgdHJ5IDo6XG4gICAgICAgICAgb25fZnJlZXplKHRndCwgY3R4KVxuICAgICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgICBQcm9taXNlLnJlamVjdChlcnIpXG4gICAgICBPYmplY3QuZnJlZXplKHRndClcblxuICAgIG5vdGlmeSh0aXBfdmlldylcbiAgICByZXR1cm4gcmVzdWx0XG5cbi8vIC0tLVxuXG5leHBvcnQgZnVuY3Rpb24gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUoY2FsbGJhY2ssIGhvc3RfY2FsbGJhY2ssIGNhbGxiYWNrX25hbWUpIDo6XG4gIGlmIG51bGwgIT0gaG9zdF9jYWxsYmFjayA6OlxuICAgIGNhbGxiYWNrID0gW10uY29uY2F0IEAgaG9zdF9jYWxsYmFjaywgY2FsbGJhY2sgfHwgW11cbiAgZWxzZSBpZiBudWxsID09IGNhbGxiYWNrIDo6IHJldHVyblxuXG4gIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBjYWxsYmFjayA6OiByZXR1cm4gY2FsbGJhY2tcblxuICBpZiBBcnJheS5pc0FycmF5KGNhbGxiYWNrKSB8fCBjYWxsYmFja1tTeW1ib2wuaXRlcmF0b3JdIDo6XG4gICAgY29uc3QgY2FsbGJhY2tMaXN0ID0gQXJyYXkuZnJvbShjYWxsYmFjaykuZmlsdGVyKGUgPT4gbnVsbCAhPSBlKVxuXG4gICAgaWYgY2FsbGJhY2tMaXN0LnNvbWUgQCBjYiA9PiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2IgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRGlzcGF0Y2ggZXhwZWN0ZWQgJyR7Y2FsbGJhY2tfbmFtZX0nIG9wdGlvbiB0byBvbmx5IGluY2x1ZGUgZnVuY3Rpb25zIGluIGxpc3RgXG5cbiAgICBpZiBjYWxsYmFja0xpc3QubGVuZ3RoIDw9IDEgOjpcbiAgICAgIGNhbGxiYWNrID0gY2FsbGJhY2tMaXN0LnBvcCgpXG4gICAgZWxzZSA6OlxuICAgICAgY2FsbGJhY2sgPSBmdW5jdGlvbiAodGd0LCBhcmcxLCBhcmcyKSA6OlxuICAgICAgICBmb3IgY29uc3QgY2Igb2YgY2FsbGJhY2tMaXN0IDo6XG4gICAgICAgICAgdHJ5IDo6IGNiKHRndCwgYXJnMSwgYXJnMilcbiAgICAgICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgICAgIFByb21pc2UucmVqZWN0KGVycilcblxuICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2FsbGJhY2sgOjpcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYERpc3BhdGNoIGV4cGVjdGVkICcke2NhbGxiYWNrX25hbWV9JyBvcHRpb24gdG8gYmUgYSBmdW5jdGlvbiBpbnN0YW5jZSBvciBsaXN0IG9mIGZ1bmN0aW9uc2BcbiAgcmV0dXJuIGNhbGxiYWNrXG5cbi8vIC0tLVxuXG5leHBvcnQgZnVuY3Rpb24gaXNPYmplY3RDaGFuZ2VkKHByZXYsIG5leHQpIDo6XG4gIGlmIHByZXYgPT09IHVuZGVmaW5lZCA6OlxuICAgIHJldHVybiBuZXh0ICE9PSB1bmRlZmluZWRcblxuICBmb3IgY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKG5leHQpIDo6XG4gICAgaWYgISBAIGtleSBpbiBwcmV2IDo6XG4gICAgICByZXR1cm4gdHJ1ZSAvLyBhZGRlZFxuXG4gIGZvciBjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocHJldikgOjpcbiAgICBpZiBwcmV2W2tleV0gIT09IG5leHRba2V5XSA6OlxuICAgICAgcmV0dXJuIHRydWUgLy8gY2hhbmdlZFxuICAgIGlmICEgQCBrZXkgaW4gbmV4dCA6OlxuICAgICAgcmV0dXJuIHRydWUgLy8gcmVtb3ZlZFxuXG4gIHJldHVybiBmYWxzZVxuXG4vLyAtLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRTdGF0ZVRyYW5zZm9ybSh4Zm9ybSwgeGZvcm1fbmFtZSwgeGZvcm1fZmlsdGVyKSA6OlxuICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgeGZvcm0gOjpcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBFeHBlY3RlZCAke3hmb3JtX25hbWV9dG8gYmUgYSBmdW5jdGlvbmApXG5cbiAgaWYgdHJ1ZSA9PT0geGZvcm1fZmlsdGVyIHx8ICdub3QtZnJvemVuJyA6OlxuICAgIHhmb3JtX2ZpbHRlciA9IGF0dHIgPT4gISBPYmplY3QuaXNGcm96ZW4oYXR0cilcblxuICByZXR1cm4gZnVuY3Rpb24odGd0KSA6OlxuICAgIGZvciBjb25zdCBrZXkgb2YgT2JqZWN0LmtleXModGd0KSA6OlxuICAgICAgY29uc3QgYXR0ciA9IHRndFtrZXldXG4gICAgICBpZiAhIHhmb3JtX2ZpbHRlciB8fCB4Zm9ybV9maWx0ZXIoYXR0ciwga2V5KSA6OlxuICAgICAgICB0Z3Rba2V5XSA9IHhmb3JtIEAgYXR0clxuXG4iLCJpbXBvcnQge2FzRnVuY3Rpb25hbE9iamVjdH0gZnJvbSAnLi9pbmRleC5qc3knXG5cbmV4cG9ydCBmdW5jdGlvbiBhc0Zyb3plbkZ1bmN0aW9uYWxPYmplY3QoaG9zdCwgLi4ub3B0aW9ucykgOjpcbiAgcmV0dXJuIGFzRnVuY3Rpb25hbE9iamVjdCBAIGhvc3QsIHt0cmFuc2Zvcm06IE9iamVjdC5mcmVlemUsIHRyYW5zZm9ybUZpbHRlcjogdHJ1ZX0sIC4uLm9wdGlvbnNcblxuZXhwb3J0IGZ1bmN0aW9uIEZyb3plbk9iamVjdEZ1bmN0aW9uYWwoKSA6OlxuICByZXR1cm4gYXNGcm96ZW5GdW5jdGlvbmFsT2JqZWN0KHRoaXMpXG5cbiJdLCJuYW1lcyI6WyJhc0Z1bmN0aW9uYWxPYmplY3QiLCJob3N0Iiwib3B0aW9ucyIsIk9iamVjdCIsImFzc2lnbiIsIm5vdGlmeSIsImJpbmRVcGRhdGVGdW5jdGlvbiIsImRpc3BhdGNoQWN0aW9uIiwiZGVmaW5lQWN0aW9uIiwiYmluZEFjdGlvbkRlY2xhcmF0aW9ucyIsImFjdGlvbnMiLCJzdWJzY3JpYmUiLCJ2YWx1ZSIsImFyZ3MiLCJfX2ltcGxfcHJvdG9fXyIsImNyZWF0ZSIsImdldFByb3RvdHlwZU9mIiwiX192aWV3X3Byb3RvX18iLCJkZWZpbmVQcm9wZXJ0aWVzIiwiYXNBY3Rpb24iLCJzZXQiLCJjb25maWd1cmFibGUiLCJmcmVlemUiLCJUeXBlRXJyb3IiLCJfX2Rpc3BhdGNoX18iLCJhY3Rpb25OYW1lIiwiYWN0aW9uQXJncyIsInN0YXRlQWN0aW9uRGlzcGF0Y2giLCJhY3Rpb25MaXN0IiwibmFtZSIsIkFycmF5IiwiaXNBcnJheSIsImVudHJpZXMiLCJpbXBsX3Byb3BzIiwidmlld19wcm9wcyIsImhvc3RfcHJvcHMiLCJmbkFjdGlvbiIsImZuRGlzcGF0Y2giLCJub3RpZnlMaXN0IiwiY3VycmVudCIsInVwZGF0ZSIsIm5leHQiLCJjYiIsImVyciIsImNhbGxiYWNrIiwicG9wIiwic2tpcEluaXRpYWxDYWxsIiwiaW5kZXhPZiIsImNvbmNhdCIsInVuc3Vic2NyaWJlIiwiZGlzY2FyZCIsImZpbHRlciIsImUiLCJ0cmFuc2Zvcm0iLCJ4Zm9ybSIsImJpbmRTdGF0ZVRyYW5zZm9ybSIsInRyYW5zZm9ybUZpbHRlciIsImFmdGVyIiwidmlld1RyYW5zZm9ybSIsInZpZXdUcmFuc2Zvcm1GaWx0ZXIiLCJjaGFuZ2VkIiwiaXNDaGFuZ2VkIiwiX19pc19jaGFuZ2VkX18iLCJpc09iamVjdENoYW5nZWQiLCJvbl9iZWZvcmUiLCJhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSIsImJlZm9yZSIsIl9fZGlzcGF0Y2hfYmVmb3JlX18iLCJvbl9lcnJvciIsImVycm9yIiwiX19kaXNwYXRjaF9lcnJvcl9fIiwib25fYWZ0ZXIiLCJfX2Rpc3BhdGNoX2FmdGVyX18iLCJvbl9jaGFuZ2VkIiwiX19kaXNwYXRjaF9jaGFuZ2VkX18iLCJvbl9mcmVlemUiLCJfX2Rpc3BhdGNoX2ZyZWV6ZV9fIiwidW5kZWZpbmVkIiwic3RhdGUiLCJzdGF0ZV9zdW1tYXJ5IiwidGlwX3ZpZXciLCJ2aWV3IiwicHJlX3N0YXRlIiwidGd0IiwicmVzdWx0IiwiY3R4IiwiYWN0aW9uIiwiaXNUaXBWaWV3IiwiYXBwbHkiLCJzZXRQcm90b3R5cGVPZiIsInNob3VsZFRocm93IiwicG9zdF9zdGF0ZSIsIkVycm9yIiwiY29uc3RydWN0b3IiLCJjaGFuZ2Vfc3VtbWFyeSIsInJlamVjdCIsImhvc3RfY2FsbGJhY2siLCJjYWxsYmFja19uYW1lIiwiU3ltYm9sIiwiaXRlcmF0b3IiLCJjYWxsYmFja0xpc3QiLCJmcm9tIiwic29tZSIsImxlbmd0aCIsImFyZzEiLCJhcmcyIiwicHJldiIsImtleSIsImtleXMiLCJ4Zm9ybV9uYW1lIiwieGZvcm1fZmlsdGVyIiwiYXR0ciIsImlzRnJvemVuIiwiYXNGcm96ZW5GdW5jdGlvbmFsT2JqZWN0IiwiRnJvemVuT2JqZWN0RnVuY3Rpb25hbCJdLCJtYXBwaW5ncyI6IkFBR0E7O0FBRUEsQUFBTyxTQUFTQSxrQkFBVCxDQUE0QkMsSUFBNUIsRUFBa0MsR0FBR0MsT0FBckMsRUFBOEM7O1lBRXpDQyxPQUFPQyxNQUFQLENBQWMsRUFBZCxFQUFrQixHQUFHRixPQUFyQixDQUFWO1FBQ01HLFNBQVMsUUFBUUgsUUFBUUcsTUFBaEIsR0FDWEMsbUJBQW1CTCxJQUFuQixFQUF5QkMsT0FBekIsQ0FEVyxHQUVYQSxRQUFRRyxNQUZaOzs7UUFPTSxFQUFDRSxjQUFELEVBQWlCQyxZQUFqQixLQUFpQ0MsdUJBQXVCSixNQUF2QixDQUF2QztNQUNHSCxRQUFRUSxPQUFYLEVBQXFCO2lCQUFjUixRQUFRUSxPQUFyQjs7O1FBRWhCQyxZQUFZLEVBQUlDLE1BQU0sR0FBR0MsSUFBVCxFQUFlO2FBQVVSLE9BQU9NLFNBQVAsQ0FBaUIsR0FBR0UsSUFBcEIsQ0FBUDtLQUF0QixFQUFsQjtRQUNNQyxpQkFBaUJYLE9BQU9ZLE1BQVAsQ0FBZ0JaLE9BQU9hLGNBQVAsQ0FBc0JmLElBQXRCLENBQWhCLEVBQTZDLEVBQUlVLFNBQUosRUFBN0MsQ0FBdkI7UUFDTU0saUJBQWlCZCxPQUFPWSxNQUFQLENBQWdCWixPQUFPYSxjQUFQLENBQXNCZixJQUF0QixDQUFoQixFQUE2QyxFQUFJVSxTQUFKLEVBQTdDLENBQXZCOztTQUVPTyxnQkFBUCxDQUEwQmpCLElBQTFCLEVBQWdDO2FBQUEsRUFDbkJrQixVQUFVLEVBQUlDLEtBQUtaLFlBQVQsRUFEUztvQkFFZCxFQUFJYSxjQUFjLElBQWxCLEVBQXdCVCxPQUFPRSxjQUEvQixFQUZjO29CQUdkLEVBQUlPLGNBQWMsSUFBbEIsRUFBd0JULE9BQU9LLGNBQS9CLEVBSGMsRUFBaEM7OztpQkFPZVosTUFBZixFQUF1QixJQUF2QixFQUE2QixFQUE3QixFQUFpQyxJQUFqQzs7O1NBR09GLE9BQU9tQixNQUFQLENBQWdCbkIsT0FBT1ksTUFBUCxDQUFnQmQsSUFBaEIsQ0FBaEIsQ0FBUDs7V0FHU1Esc0JBQVQsQ0FBZ0NKLE1BQWhDLEVBQXdDO1FBQ2xDRSxjQUFKO1FBQ0csUUFBUUwsUUFBUUssY0FBbkIsRUFBb0M7dUJBQ2pCTCxRQUFRSyxjQUF6QjtVQUNHLGVBQWUsT0FBT0EsY0FBekIsRUFBMEM7Y0FDbEMsSUFBSWdCLFNBQUosQ0FBZSx1RUFBZixDQUFOOztLQUhKLE1BSUssSUFBRyxlQUFlLE9BQU90QixLQUFLdUIsWUFBOUIsRUFBNkM7dUJBQy9CLFVBQVNuQixNQUFULEVBQWlCb0IsVUFBakIsRUFBNkJDLFVBQTdCLEVBQXlDO2VBQ2pEekIsS0FBS3VCLFlBQUwsQ0FBa0JuQixNQUFsQixFQUEwQm9CLFVBQTFCLEVBQXNDQyxVQUF0QyxDQUFQO09BREY7S0FERyxNQUdBO3VCQUNjQyxvQkFBb0IxQixJQUFwQixFQUEwQkMsT0FBMUIsQ0FBakI7OztVQUdJTSxlQUFnQm9CLFVBQUQsSUFBZ0I7VUFDaEMsZUFBZSxPQUFPQSxVQUF6QixFQUFzQztxQkFDdkIsQ0FBSSxDQUFJQSxXQUFXQyxJQUFmLEVBQXFCRCxVQUFyQixDQUFKLENBQWI7T0FERixNQUVLLElBQUcsYUFBYSxPQUFPQSxVQUF2QixFQUFvQztxQkFDMUIsQ0FBSSxDQUFJQSxVQUFKLEVBQWdCM0IsS0FBSzJCLFVBQUwsQ0FBaEIsQ0FBSixDQUFiO09BREcsTUFFQSxJQUFHLENBQUVFLE1BQU1DLE9BQU4sQ0FBZ0JILFVBQWhCLENBQUwsRUFBa0M7cUJBQ3hCekIsT0FBTzZCLE9BQVAsQ0FBZUosVUFBZixDQUFiO09BREcsTUFFQSxJQUFHLGFBQWEsT0FBT0EsV0FBVyxDQUFYLENBQXZCLEVBQXVDO3FCQUM3QixDQUFJQSxVQUFKLENBQWI7OztZQUdJSyxhQUFXLEVBQWpCO1lBQXFCQyxhQUFXLEVBQWhDO1lBQW9DQyxhQUFhLEVBQWpEO1dBQ0ksTUFBTSxDQUFDVixVQUFELEVBQWFXLFFBQWIsQ0FBVixJQUFvQ1IsVUFBcEMsRUFBaUQ7WUFDNUMsQ0FBRUgsVUFBTCxFQUFrQjtnQkFDVixJQUFJRixTQUFKLENBQWlCLHVCQUFqQixDQUFOOztZQUNDLGVBQWUsT0FBT2EsUUFBekIsRUFBb0M7Z0JBQzVCLElBQUliLFNBQUosQ0FBaUIsb0JBQW1CRSxVQUFXLGtDQUFpQyxPQUFPVyxRQUFTLEdBQWhHLENBQU47OztjQUVJQyxhQUFhLFVBQVUsR0FBR1gsVUFBYixFQUF5QjtpQkFDbkNuQixlQUFlRixNQUFmLEVBQXVCb0IsVUFBdkIsRUFBbUNDLFVBQW5DLENBQVA7U0FERjs7bUJBR1dELFVBQVgsSUFBeUIsRUFBSWIsT0FBT3dCLFFBQVgsRUFBekI7bUJBQ1dYLFVBQVgsSUFBeUIsRUFBSWIsT0FBT3lCLFVBQVgsRUFBekI7bUJBQ1daLFVBQVgsSUFBeUIsRUFBSWIsT0FBT3lCLFVBQVgsRUFBdUJoQixjQUFjLElBQXJDLEVBQXpCOzs7YUFFS0gsZ0JBQVAsQ0FBMEJKLGNBQTFCLEVBQTBDbUIsVUFBMUM7YUFDT2YsZ0JBQVAsQ0FBMEJELGNBQTFCLEVBQTBDaUIsVUFBMUM7YUFDT2hCLGdCQUFQLENBQTBCakIsSUFBMUIsRUFBZ0NrQyxVQUFoQztLQTNCRjs7V0E2Qk8sRUFBSTVCLGNBQUosRUFBb0JDLFlBQXBCLEVBQVA7Ozs7OztBQUtKLEFBQU8sU0FBU0Ysa0JBQVQsR0FBOEI7TUFDL0JnQyxhQUFhLEVBQWpCO01BQ0lDLE9BQUo7O1NBRU81QixTQUFQLEdBQW1CQSxTQUFuQjtTQUNPNkIsTUFBUDs7V0FFU0EsTUFBVCxDQUFnQkMsSUFBaEIsRUFBc0I7UUFDakJGLFlBQVlFLElBQWYsRUFBc0I7Ozs7Y0FFWkEsSUFBVjtTQUNJLE1BQU1DLEVBQVYsSUFBZ0JKLFVBQWhCLEVBQTZCO1VBQ3ZCO1dBQU1DLE9BQUg7T0FBUCxDQUNBLE9BQU1JLEdBQU4sRUFBWTtnQkFBU0QsRUFBUjs7Ozs7V0FFUi9CLFNBQVQsQ0FBbUIsR0FBR0UsSUFBdEIsRUFBNEI7VUFDcEIrQixXQUFXL0IsS0FBS2dDLEdBQUwsRUFBakI7VUFDTUMsa0JBQWtCakMsS0FBSyxDQUFMLENBQXhCOztRQUVHLENBQUMsQ0FBRCxLQUFPeUIsV0FBV1MsT0FBWCxDQUFtQkgsUUFBbkIsQ0FBVixFQUF5Qzs7O1FBRXRDLGVBQWUsT0FBT0EsUUFBekIsRUFBb0M7WUFDNUIsSUFBSXJCLFNBQUosQ0FBaUIsa0NBQWpCLENBQU47OztpQkFFV2UsV0FBV1UsTUFBWCxDQUFvQixDQUFDSixRQUFELENBQXBCLENBQWI7UUFDRyxDQUFFRSxlQUFMLEVBQXVCO2VBQ1pQLE9BQVQ7O2dCQUNVVSxXQUFaLEdBQTBCQSxXQUExQjtXQUNPQSxXQUFQOzthQUVTQSxXQUFULEdBQXVCO2NBQ2JMLFFBQVI7Ozs7V0FFS00sT0FBVCxDQUFpQk4sUUFBakIsRUFBMkI7aUJBQ1pOLFdBQ1ZhLE1BRFUsQ0FDREMsS0FBS1IsYUFBYVEsQ0FEakIsQ0FBYjs7Ozs7OztBQU1KLEFBQU8sU0FBU3pCLG1CQUFULENBQTZCMUIsSUFBN0IsRUFBbUNDLFVBQVEsRUFBM0MsRUFBK0M7TUFDakRBLFFBQVFtRCxTQUFYLEVBQXVCO1VBQ2ZDLFFBQVFDLG1CQUFtQnJELFFBQVFtRCxTQUEzQixFQUFzQyxXQUF0QyxFQUFtRG5ELFFBQVFzRCxlQUEzRCxDQUFkO1lBQ1FDLEtBQVIsR0FBZ0IsR0FBR1QsTUFBSCxDQUFZOUMsUUFBUXVELEtBQVIsSUFBaUIsRUFBN0IsRUFBaUNILEtBQWpDLENBQWhCOzs7TUFFQ3BELFFBQVF3RCxhQUFYLEVBQTJCO1VBQ25CSixRQUFRQyxtQkFBbUJyRCxRQUFRd0QsYUFBM0IsRUFBMEMsZUFBMUMsRUFBMkR4RCxRQUFReUQsbUJBQW5FLENBQWQ7WUFDUUMsT0FBUixHQUFrQixHQUFHWixNQUFILENBQVk5QyxRQUFRMEQsT0FBUixJQUFtQixFQUEvQixFQUFtQ04sS0FBbkMsQ0FBbEI7OztRQUVJTyxZQUFZM0QsUUFBUTJELFNBQVIsSUFBcUI1RCxLQUFLNkQsY0FBMUIsSUFBNENDLGVBQTlEO1FBQ01DLFlBQVlDLDJCQUE2Qi9ELFFBQVFnRSxNQUFyQyxFQUE2Q2pFLEtBQUtrRSxtQkFBbEQsRUFBdUUsUUFBdkUsQ0FBbEI7UUFDTUMsV0FBV0gsMkJBQTZCL0QsUUFBUW1FLEtBQXJDLEVBQTRDcEUsS0FBS3FFLGtCQUFqRCxFQUFxRSxPQUFyRSxDQUFqQjtRQUNNQyxXQUFXTiwyQkFBNkIvRCxRQUFRdUQsS0FBckMsRUFBNEN4RCxLQUFLdUUsa0JBQWpELEVBQXFFLE9BQXJFLENBQWpCO1FBQ01DLGFBQWFSLDJCQUE2Qi9ELFFBQVEwRCxPQUFyQyxFQUE4QzNELEtBQUt5RSxvQkFBbkQsRUFBeUUsU0FBekUsQ0FBbkI7UUFDTUMsWUFBWVYsMkJBQTZCL0QsUUFBUW9CLE1BQXJDLEVBQTZDckIsS0FBSzJFLG1CQUFsRCxFQUF1RSxRQUF2RSxDQUFsQjs7TUFFR0MsY0FBY2hCLFNBQWQsSUFBMkIsZUFBZSxPQUFPQSxTQUFwRCxFQUFnRTtVQUN4RCxJQUFJdEMsU0FBSixDQUFpQixnRUFBakIsQ0FBTjs7O01BRUV1RCxRQUFRLEVBQVo7TUFBZ0JDLGFBQWhCO01BQStCQyxRQUEvQjtTQUNPeEQsWUFBUDs7V0FFU0EsWUFBVCxDQUFzQm5CLE1BQXRCLEVBQThCb0IsVUFBOUIsRUFBMENDLFVBQTFDLEVBQXNEdUQsSUFBdEQsRUFBNEQ7VUFDcERDLFlBQVlKLEtBQWxCO1VBQ01LLE1BQU1oRixPQUFPWSxNQUFQLENBQWdCZCxLQUFLYSxjQUFyQixDQUFaOztXQUVPVixNQUFQLENBQWdCK0UsR0FBaEIsRUFBcUJMLEtBQXJCOztRQUVJTSxNQUFKO1VBQ01DLE1BQVEsRUFBQ0MsUUFBUSxDQUFDN0QsVUFBRCxFQUFhQyxVQUFiLEVBQXlCdUQsSUFBekIsQ0FBVDtlQUFBLEVBQ0RNLFdBQVdQLGFBQWFDLElBQWIsSUFBcUJBLFNBQVNKLFNBRHhDLEVBQWQ7O1FBR0k7VUFDQ0EsY0FBY2IsU0FBakIsRUFBNkI7a0JBQ2pCbUIsR0FBVixFQUFlRSxHQUFmOzs7VUFFRTs7WUFFQzVELFVBQUgsRUFBZ0I7bUJBQ0wwRCxJQUFJMUQsVUFBSixFQUFnQitELEtBQWhCLENBQXNCTCxHQUF0QixFQUEyQnpELFVBQTNCLENBQVQ7Y0FDSTBELE1BQUosR0FBYUEsTUFBYjtTQUZGLE1BR0s7Y0FDQ0EsTUFBSixHQUFhQSxTQUFTSixXQUFXRyxHQUFqQzs7OztlQUdLTSxjQUFQLENBQXNCTixHQUF0QixFQUEyQmxGLEtBQUtnQixjQUFoQztPQVRGLENBV0EsT0FBTTBCLEdBQU4sRUFBWTs7ZUFFSDhDLGNBQVAsQ0FBc0JOLEdBQXRCLEVBQTJCbEYsS0FBS2dCLGNBQWhDOzs7WUFHRzRELGNBQWNULFFBQWpCLEVBQTRCO2dCQUFPekIsR0FBTjs7O2NBRXZCK0MsY0FBY3RCLFNBQVN6QixHQUFULEVBQWN3QyxHQUFkLEVBQW1CRSxHQUFuQixDQUFwQjtZQUNHLFVBQVVLLFdBQWIsRUFBMkI7Z0JBQU8vQyxHQUFOOzs7O1VBRTNCa0MsY0FBY04sUUFBakIsRUFBNEI7aUJBQ2pCWSxHQUFULEVBQWNFLEdBQWQ7Ozs7WUFHSU0sYUFBYXhGLE9BQU9DLE1BQVAsQ0FBZ0IsRUFBaEIsRUFBb0IrRSxHQUFwQixDQUFuQjtVQUNJUSxVQUFKLEdBQWlCQSxVQUFqQjs7VUFFR1QsY0FBY0osS0FBakIsRUFBeUI7Y0FDakIsSUFBSWMsS0FBSixDQUFhLGdDQUErQjNGLEtBQUs0RixXQUFMLENBQWlCaEUsSUFBSyxXQUFsRSxDQUFOOzs7WUFFSWlFLGlCQUFpQmpDLFVBQVVxQixTQUFWLEVBQXFCUyxVQUFyQixFQUFpQ1osYUFBakMsRUFBZ0RNLEdBQWhELENBQXZCO1VBQ0dTLGNBQUgsRUFBb0I7WUFDZGxDLE9BQUosR0FBYyxJQUFkO2dCQUNRK0IsVUFBUjt3QkFDZ0JHLGNBQWhCO21CQUNXWCxHQUFYOztZQUVHTixjQUFjSixVQUFqQixFQUE4QjtxQkFDakJVLEdBQVgsRUFBZ0JFLEdBQWhCOztPQVBKLE1BU0ssSUFBR0YsUUFBUUMsTUFBWCxFQUFvQjtZQUNuQkEsTUFBSixHQUFhQSxTQUFTSixRQUF0Qjs7S0E5Q0osU0FnRFE7VUFDSEgsY0FBY0YsU0FBakIsRUFBNkI7WUFDdkI7b0JBQ1FRLEdBQVYsRUFBZUUsR0FBZjtTQURGLENBRUEsT0FBTTFDLEdBQU4sRUFBWTtrQkFDRm9ELE1BQVIsQ0FBZXBELEdBQWY7OzthQUNHckIsTUFBUCxDQUFjNkQsR0FBZDs7O1dBRUtILFFBQVA7V0FDT0ksTUFBUDs7Ozs7O0FBSUosQUFBTyxTQUFTbkIsMEJBQVQsQ0FBb0NyQixRQUFwQyxFQUE4Q29ELGFBQTlDLEVBQTZEQyxhQUE3RCxFQUE0RTtNQUM5RSxRQUFRRCxhQUFYLEVBQTJCO2VBQ2QsR0FBR2hELE1BQUgsQ0FBWWdELGFBQVosRUFBMkJwRCxZQUFZLEVBQXZDLENBQVg7R0FERixNQUVLLElBQUcsUUFBUUEsUUFBWCxFQUFzQjs7OztNQUV4QixlQUFlLE9BQU9BLFFBQXpCLEVBQW9DO1dBQVFBLFFBQVA7OztNQUVsQ2QsTUFBTUMsT0FBTixDQUFjYSxRQUFkLEtBQTJCQSxTQUFTc0QsT0FBT0MsUUFBaEIsQ0FBOUIsRUFBMEQ7VUFDbERDLGVBQWV0RSxNQUFNdUUsSUFBTixDQUFXekQsUUFBWCxFQUFxQk8sTUFBckIsQ0FBNEJDLEtBQUssUUFBUUEsQ0FBekMsQ0FBckI7O1FBRUdnRCxhQUFhRSxJQUFiLENBQW9CNUQsTUFBTSxlQUFlLE9BQU9BLEVBQWhELENBQUgsRUFBd0Q7WUFDaEQsSUFBSW5CLFNBQUosQ0FBaUIsc0JBQXFCMEUsYUFBYyw0Q0FBcEQsQ0FBTjs7O1FBRUNHLGFBQWFHLE1BQWIsSUFBdUIsQ0FBMUIsRUFBOEI7aUJBQ2pCSCxhQUFhdkQsR0FBYixFQUFYO0tBREYsTUFFSztpQkFDUSxVQUFVc0MsR0FBVixFQUFlcUIsSUFBZixFQUFxQkMsSUFBckIsRUFBMkI7YUFDaEMsTUFBTS9ELEVBQVYsSUFBZ0IwRCxZQUFoQixFQUErQjtjQUN6QjtlQUFNakIsR0FBSCxFQUFRcUIsSUFBUixFQUFjQyxJQUFkO1dBQVAsQ0FDQSxPQUFNOUQsR0FBTixFQUFZO29CQUNGb0QsTUFBUixDQUFlcEQsR0FBZjs7O09BSk47Ozs7TUFNRCxlQUFlLE9BQU9DLFFBQXpCLEVBQW9DO1VBQzVCLElBQUlyQixTQUFKLENBQWlCLHNCQUFxQjBFLGFBQWMseURBQXBELENBQU47O1NBQ0tyRCxRQUFQOzs7OztBQUlGLEFBQU8sU0FBU21CLGVBQVQsQ0FBeUIyQyxJQUF6QixFQUErQmpFLElBQS9CLEVBQXFDO01BQ3ZDaUUsU0FBUzdCLFNBQVosRUFBd0I7V0FDZnBDLFNBQVNvQyxTQUFoQjs7O09BRUUsTUFBTThCLEdBQVYsSUFBaUJ4RyxPQUFPeUcsSUFBUCxDQUFZbkUsSUFBWixDQUFqQixFQUFxQztRQUNoQyxFQUFJa0UsT0FBT0QsSUFBWCxDQUFILEVBQXFCO2FBQ1osSUFBUCxDQURtQjs7R0FHdkIsS0FBSSxNQUFNQyxHQUFWLElBQWlCeEcsT0FBT3lHLElBQVAsQ0FBWUYsSUFBWixDQUFqQixFQUFxQztRQUNoQ0EsS0FBS0MsR0FBTCxNQUFjbEUsS0FBS2tFLEdBQUwsQ0FBakIsRUFBNkI7YUFDcEIsSUFBUCxDQUQyQjtLQUU3QixJQUFHLEVBQUlBLE9BQU9sRSxJQUFYLENBQUgsRUFBcUI7YUFDWixJQUFQLENBRG1COztHQUd2QixPQUFPLEtBQVA7Ozs7O0FBSUYsQUFBTyxTQUFTYyxrQkFBVCxDQUE0QkQsS0FBNUIsRUFBbUN1RCxVQUFuQyxFQUErQ0MsWUFBL0MsRUFBNkQ7TUFDL0QsZUFBZSxPQUFPeEQsS0FBekIsRUFBaUM7VUFDekIsSUFBSS9CLFNBQUosQ0FBZSxZQUFXc0YsVUFBVyxrQkFBckMsQ0FBTjs7O01BRUMsU0FBU0MsWUFBVCxJQUF5QixZQUE1QixFQUEyQzttQkFDMUJDLFFBQVEsQ0FBRTVHLE9BQU82RyxRQUFQLENBQWdCRCxJQUFoQixDQUF6Qjs7O1NBRUssVUFBUzVCLEdBQVQsRUFBYztTQUNmLE1BQU13QixHQUFWLElBQWlCeEcsT0FBT3lHLElBQVAsQ0FBWXpCLEdBQVosQ0FBakIsRUFBb0M7WUFDNUI0QixPQUFPNUIsSUFBSXdCLEdBQUosQ0FBYjtVQUNHLENBQUVHLFlBQUYsSUFBa0JBLGFBQWFDLElBQWIsRUFBbUJKLEdBQW5CLENBQXJCLEVBQStDO1lBQ3pDQSxHQUFKLElBQVdyRCxNQUFReUQsSUFBUixDQUFYOzs7R0FKTjs7O0FDMVFLLFNBQVNFLHdCQUFULENBQWtDaEgsSUFBbEMsRUFBd0MsR0FBR0MsT0FBM0MsRUFBb0Q7U0FDbERGLG1CQUFxQkMsSUFBckIsRUFBMkIsRUFBQ29ELFdBQVdsRCxPQUFPbUIsTUFBbkIsRUFBMkJrQyxpQkFBaUIsSUFBNUMsRUFBM0IsRUFBOEUsR0FBR3RELE9BQWpGLENBQVA7OztBQUVGLEFBQU8sU0FBU2dILHNCQUFULEdBQWtDO1NBQ2hDRCx5QkFBeUIsSUFBekIsQ0FBUDs7Ozs7In0=
