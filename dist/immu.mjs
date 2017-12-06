import immu from 'immu';

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

export { asImmuFunctionalObject, ImmuObjectFunctional };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1tdS5tanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvaW5kZXguanN5IiwiLi4vY29kZS9pbW11LmpzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBPYmplY3RGdW5jdGlvbmFsKCkgOjpcbiAgcmV0dXJuIGFzRnVuY3Rpb25hbE9iamVjdCh0aGlzKVxuXG4vLyAtLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGFzRnVuY3Rpb25hbE9iamVjdChob3N0LCAuLi5vcHRpb25zKSA6OlxuICAvLyBpbml0aWFsaXplIG9wdGlvbnNcbiAgb3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIC4uLm9wdGlvbnMpXG4gIGNvbnN0IG5vdGlmeSA9IG51bGwgPT0gb3B0aW9ucy5ub3RpZnlcbiAgICA/IGJpbmRVcGRhdGVGdW5jdGlvbihob3N0LCBvcHRpb25zKVxuICAgIDogb3B0aW9ucy5ub3RpZnlcblxuXG5cbiAgLy8gc2V0dXAgYXNBY3Rpb24gc2V0dGVyIGhhY2sgLS0gaW4gbGlldSBvZiBFUyBzdGFuZGFyZCBkZWNvcmF0b3JzXG4gIGNvbnN0IHtkaXNwYXRjaEFjdGlvbiwgZGVmaW5lQWN0aW9ufSA9IGJpbmRBY3Rpb25EZWNsYXJhdGlvbnMobm90aWZ5KVxuICBpZiBvcHRpb25zLmFjdGlvbnMgOjogZGVmaW5lQWN0aW9uKG9wdGlvbnMuYWN0aW9ucylcblxuICBjb25zdCBzdWJzY3JpYmUgPSBAe30gdmFsdWUoLi4uYXJncykgOjogcmV0dXJuIG5vdGlmeS5zdWJzY3JpYmUoLi4uYXJncylcbiAgY29uc3QgX19pbXBsX3Byb3RvX18gPSBPYmplY3QuY3JlYXRlIEAgT2JqZWN0LmdldFByb3RvdHlwZU9mKGhvc3QpLCBAe30gc3Vic2NyaWJlXG4gIGNvbnN0IF9fdmlld19wcm90b19fID0gT2JqZWN0LmNyZWF0ZSBAIE9iamVjdC5nZXRQcm90b3R5cGVPZihob3N0KSwgQHt9IHN1YnNjcmliZVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgaG9zdCwgQHt9XG4gICAgc3Vic2NyaWJlLCBhc0FjdGlvbjogQHt9IHNldDogZGVmaW5lQWN0aW9uXG4gICAgX19pbXBsX3Byb3RvX186IEB7fSBjb25maWd1cmFibGU6IHRydWUsIHZhbHVlOiBfX2ltcGxfcHJvdG9fX1xuICAgIF9fdmlld19wcm90b19fOiBAe30gY29uZmlndXJhYmxlOiB0cnVlLCB2YWx1ZTogX192aWV3X3Byb3RvX19cblxuXG4gIC8vIGluaXRpYWxpemUgdGhlIGludGVybmFsIHN0YXQgd2l0aCBpbml0aWFsIHZpZXdcbiAgZGlzcGF0Y2hBY3Rpb24obm90aWZ5LCBudWxsLCBbXSwgbnVsbClcblxuICAvLyByZXR1cm4gYSBmcm96ZW4gY2xvbmUgb2YgdGhlIGhvc3Qgb2JqZWN0XG4gIHJldHVybiBPYmplY3QuZnJlZXplIEAgT2JqZWN0LmNyZWF0ZSBAIGhvc3RcblxuXG4gIGZ1bmN0aW9uIGJpbmRBY3Rpb25EZWNsYXJhdGlvbnMobm90aWZ5KSA6OlxuICAgIGxldCBkaXNwYXRjaEFjdGlvblxuICAgIGlmIG51bGwgIT0gb3B0aW9ucy5kaXNwYXRjaEFjdGlvbiA6OlxuICAgICAgZGlzcGF0Y2hBY3Rpb24gPSBvcHRpb25zLmRpc3BhdGNoQWN0aW9uXG4gICAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZGlzcGF0Y2hBY3Rpb24gOjpcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgRXhwZWN0ZWQgYSBkaXNwYXRjaEFjdGlvbihub3RpZnksIGFjdGlvbk5hbWUsIGFjdGlvbkFyZ3Mpe+KApn0gZnVuY3Rpb25gKVxuICAgIGVsc2UgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGhvc3QuX19kaXNwYXRjaF9fIDo6XG4gICAgICBkaXNwYXRjaEFjdGlvbiA9IGZ1bmN0aW9uKG5vdGlmeSwgYWN0aW9uTmFtZSwgYWN0aW9uQXJncykgOjpcbiAgICAgICAgcmV0dXJuIGhvc3QuX19kaXNwYXRjaF9fKG5vdGlmeSwgYWN0aW9uTmFtZSwgYWN0aW9uQXJncylcbiAgICBlbHNlIDo6XG4gICAgICBkaXNwYXRjaEFjdGlvbiA9IHN0YXRlQWN0aW9uRGlzcGF0Y2goaG9zdCwgb3B0aW9ucylcblxuXG4gICAgY29uc3QgZGVmaW5lQWN0aW9uID0gKGFjdGlvbkxpc3QpID0+IDo6XG4gICAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgYWN0aW9uTGlzdCA6OlxuICAgICAgICBhY3Rpb25MaXN0ID0gQFtdIEBbXSBhY3Rpb25MaXN0Lm5hbWUsIGFjdGlvbkxpc3RcbiAgICAgIGVsc2UgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBhY3Rpb25MaXN0IDo6XG4gICAgICAgIGFjdGlvbkxpc3QgPSBAW10gQFtdIGFjdGlvbkxpc3QsIGhvc3RbYWN0aW9uTGlzdF1cbiAgICAgIGVsc2UgaWYgISBBcnJheS5pc0FycmF5IEAgYWN0aW9uTGlzdCA6OlxuICAgICAgICBhY3Rpb25MaXN0ID0gT2JqZWN0LmVudHJpZXMoYWN0aW9uTGlzdClcbiAgICAgIGVsc2UgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBhY3Rpb25MaXN0WzBdIDo6XG4gICAgICAgIGFjdGlvbkxpc3QgPSBAW10gYWN0aW9uTGlzdFxuXG5cbiAgICAgIGNvbnN0IGltcGxfcHJvcHM9e30sIHZpZXdfcHJvcHM9e30sIGhvc3RfcHJvcHMgPSB7fVxuICAgICAgZm9yIGNvbnN0IFthY3Rpb25OYW1lLCBmbkFjdGlvbl0gb2YgYWN0aW9uTGlzdCA6OlxuICAgICAgICBpZiAhIGFjdGlvbk5hbWUgOjpcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEFjdGlvbiBuYW1lIG5vdCBmb3VuZGBcbiAgICAgICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGZuQWN0aW9uIDo6XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCBhY3Rpb24gXCIke2FjdGlvbk5hbWV9XCIgdG8gYmUgYSBmdW5jdGlvbiwgYnV0IGZvdW5kIFwiJHt0eXBlb2YgZm5BY3Rpb259XCJgXG5cbiAgICAgICAgY29uc3QgZm5EaXNwYXRjaCA9IGZ1bmN0aW9uICguLi5hY3Rpb25BcmdzKSA6OlxuICAgICAgICAgIHJldHVybiBkaXNwYXRjaEFjdGlvbihub3RpZnksIGFjdGlvbk5hbWUsIGFjdGlvbkFyZ3MpXG5cbiAgICAgICAgaW1wbF9wcm9wc1thY3Rpb25OYW1lXSA9IEB7fSB2YWx1ZTogZm5BY3Rpb25cbiAgICAgICAgdmlld19wcm9wc1thY3Rpb25OYW1lXSA9IEB7fSB2YWx1ZTogZm5EaXNwYXRjaFxuICAgICAgICBob3N0X3Byb3BzW2FjdGlvbk5hbWVdID0gQHt9IHZhbHVlOiBmbkRpc3BhdGNoLCBjb25maWd1cmFibGU6IHRydWVcblxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBfX2ltcGxfcHJvdG9fXywgaW1wbF9wcm9wc1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBfX3ZpZXdfcHJvdG9fXywgdmlld19wcm9wc1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBob3N0LCBob3N0X3Byb3BzXG5cbiAgICByZXR1cm4gQHt9IGRpc3BhdGNoQWN0aW9uLCBkZWZpbmVBY3Rpb25cblxuXG4vLyAtLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRVcGRhdGVGdW5jdGlvbigpIDo6XG4gIGxldCBub3RpZnlMaXN0ID0gW11cbiAgbGV0IGN1cnJlbnRcblxuICB1cGRhdGUuc3Vic2NyaWJlID0gc3Vic2NyaWJlXG4gIHJldHVybiB1cGRhdGVcblxuICBmdW5jdGlvbiB1cGRhdGUobmV4dCkgOjpcbiAgICBpZiBjdXJyZW50ID09PSBuZXh0IDo6IHJldHVyblxuXG4gICAgY3VycmVudCA9IG5leHRcbiAgICBmb3IgY29uc3QgY2Igb2Ygbm90aWZ5TGlzdCA6OlxuICAgICAgdHJ5IDo6IGNiKGN1cnJlbnQpXG4gICAgICBjYXRjaCBlcnIgOjogZGlzY2FyZChjYilcblxuICBmdW5jdGlvbiBzdWJzY3JpYmUoLi4uYXJncykgOjpcbiAgICBjb25zdCBjYWxsYmFjayA9IGFyZ3MucG9wKClcbiAgICBjb25zdCBza2lwSW5pdGlhbENhbGwgPSBhcmdzWzBdXG5cbiAgICBpZiAtMSAhPT0gbm90aWZ5TGlzdC5pbmRleE9mKGNhbGxiYWNrKSA6OlxuICAgICAgcmV0dXJuXG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNhbGxiYWNrIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYFBsZWFzZSBzdWJzY3JpYmUgd2l0aCBhIGZ1bmN0aW9uYFxuXG4gICAgbm90aWZ5TGlzdCA9IG5vdGlmeUxpc3QuY29uY2F0IEAgW2NhbGxiYWNrXVxuICAgIGlmICEgc2tpcEluaXRpYWxDYWxsIDo6XG4gICAgICBjYWxsYmFjayhjdXJyZW50KVxuICAgIHVuc3Vic2NyaWJlLnVuc3Vic2NyaWJlID0gdW5zdWJzY3JpYmVcbiAgICByZXR1cm4gdW5zdWJzY3JpYmVcblxuICAgIGZ1bmN0aW9uIHVuc3Vic2NyaWJlKCkgOjpcbiAgICAgIGRpc2NhcmQoY2FsbGJhY2spXG5cbiAgZnVuY3Rpb24gZGlzY2FyZChjYWxsYmFjaykgOjpcbiAgICBub3RpZnlMaXN0ID0gbm90aWZ5TGlzdFxuICAgICAgLmZpbHRlciBAIGUgPT4gY2FsbGJhY2sgIT09IGVcblxuLy8gLS0tXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHN0YXRlQWN0aW9uRGlzcGF0Y2goaG9zdCwgb3B0aW9ucz17fSkgOjpcbiAgaWYgb3B0aW9ucy50cmFuc2Zvcm0gOjpcbiAgICBjb25zdCB4Zm9ybSA9IGJpbmRTdGF0ZVRyYW5zZm9ybShvcHRpb25zLnRyYW5zZm9ybSwgJ3RyYW5zZm9ybScsIG9wdGlvbnMudHJhbnNmb3JtRmlsdGVyKVxuICAgIG9wdGlvbnMuYWZ0ZXIgPSBbXS5jb25jYXQgQCBvcHRpb25zLmFmdGVyIHx8IFtdLCB4Zm9ybVxuXG4gIGlmIG9wdGlvbnMudmlld1RyYW5zZm9ybSA6OlxuICAgIGNvbnN0IHhmb3JtID0gYmluZFN0YXRlVHJhbnNmb3JtKG9wdGlvbnMudmlld1RyYW5zZm9ybSwgJ3ZpZXdUcmFuc2Zvcm0nLCBvcHRpb25zLnZpZXdUcmFuc2Zvcm1GaWx0ZXIpXG4gICAgb3B0aW9ucy5jaGFuZ2VkID0gW10uY29uY2F0IEAgb3B0aW9ucy5jaGFuZ2VkIHx8IFtdLCB4Zm9ybVxuXG4gIGNvbnN0IGlzQ2hhbmdlZCA9IG9wdGlvbnMuaXNDaGFuZ2VkIHx8IGhvc3QuX19pc19jaGFuZ2VkX18gfHwgaXNPYmplY3RDaGFuZ2VkXG4gIGNvbnN0IG9uX2JlZm9yZSA9IGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIEAgb3B0aW9ucy5iZWZvcmUsIGhvc3QuX19kaXNwYXRjaF9iZWZvcmVfXywgJ2JlZm9yZSdcbiAgY29uc3Qgb25fZXJyb3IgPSBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSBAIG9wdGlvbnMuZXJyb3IsIGhvc3QuX19kaXNwYXRjaF9lcnJvcl9fLCAnZXJyb3InXG4gIGNvbnN0IG9uX2FmdGVyID0gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUgQCBvcHRpb25zLmFmdGVyLCBob3N0Ll9fZGlzcGF0Y2hfYWZ0ZXJfXywgJ2FmdGVyJ1xuICBjb25zdCBvbl9jaGFuZ2VkID0gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUgQCBvcHRpb25zLmNoYW5nZWQsIGhvc3QuX19kaXNwYXRjaF9jaGFuZ2VkX18sICdjaGFuZ2VkJ1xuICBjb25zdCBvbl9mcmVlemUgPSBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSBAIG9wdGlvbnMuZnJlZXplLCBob3N0Ll9fZGlzcGF0Y2hfZnJlZXplX18sICdmcmVlemUnXG5cbiAgaWYgdW5kZWZpbmVkICE9PSBpc0NoYW5nZWQgJiYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGlzQ2hhbmdlZCA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRGlzcGF0Y2ggZXhwZWN0ZWQgJ2lzQ2hhbmdlZCcgb3B0aW9uIHRvIGJlIGEgZnVuY3Rpb24gaW5zdGFuY2VgXG5cbiAgbGV0IHN0YXRlID0ge30sIHN0YXRlX3N1bW1hcnksIHRpcF92aWV3XG4gIHJldHVybiBfX2Rpc3BhdGNoX19cblxuICBmdW5jdGlvbiBfX2Rpc3BhdGNoX18obm90aWZ5LCBhY3Rpb25OYW1lLCBhY3Rpb25BcmdzLCB2aWV3KSA6OlxuICAgIGNvbnN0IHByZV9zdGF0ZSA9IHN0YXRlXG4gICAgY29uc3QgdGd0ID0gT2JqZWN0LmNyZWF0ZSBAIGhvc3QuX19pbXBsX3Byb3RvX19cblxuICAgIE9iamVjdC5hc3NpZ24gQCB0Z3QsIHN0YXRlXG5cbiAgICBsZXQgcmVzdWx0XG4gICAgY29uc3QgY3R4ID0gQDogYWN0aW9uOiBbYWN0aW9uTmFtZSwgYWN0aW9uQXJncywgdmlld11cbiAgICAgIHByZV9zdGF0ZSwgaXNUaXBWaWV3OiB0aXBfdmlldyA9PT0gdmlldyAmJiB2aWV3ICE9PSB1bmRlZmluZWRcblxuICAgIHRyeSA6OlxuICAgICAgaWYgdW5kZWZpbmVkICE9PSBvbl9iZWZvcmUgOjpcbiAgICAgICAgb25fYmVmb3JlKHRndCwgY3R4KVxuXG4gICAgICB0cnkgOjpcbiAgICAgICAgLy8gZGlzcGF0Y2ggYWN0aW9uIG1ldGhvZFxuICAgICAgICBpZiBhY3Rpb25OYW1lIDo6XG4gICAgICAgICAgcmVzdWx0ID0gdGd0W2FjdGlvbk5hbWVdLmFwcGx5KHRndCwgYWN0aW9uQXJncylcbiAgICAgICAgICBjdHgucmVzdWx0ID0gcmVzdWx0XG4gICAgICAgIGVsc2UgOjpcbiAgICAgICAgICBjdHgucmVzdWx0ID0gcmVzdWx0ID0gdGlwX3ZpZXcgPSB0Z3RcblxuICAgICAgICAvLyB0cmFuc2Zvcm0gZnJvbSBpbXBsIGRvd24gdG8gYSB2aWV3XG4gICAgICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0Z3QsIGhvc3QuX192aWV3X3Byb3RvX18pXG5cbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICAvLyB0cmFuc2Zvcm0gZnJvbSBpbXBsIGRvd24gdG8gYSB2aWV3XG4gICAgICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0Z3QsIGhvc3QuX192aWV3X3Byb3RvX18pXG5cbiAgICAgICAgLy8gaGFuZGxlIGVycm9yIGZyb20gYWN0aW9uIG1ldGhvZFxuICAgICAgICBpZiB1bmRlZmluZWQgPT09IG9uX2Vycm9yIDo6IHRocm93IGVyclxuXG4gICAgICAgIGNvbnN0IHNob3VsZFRocm93ID0gb25fZXJyb3IoZXJyLCB0Z3QsIGN0eClcbiAgICAgICAgaWYgZmFsc2UgIT09IHNob3VsZFRocm93IDo6IHRocm93IGVyclxuXG4gICAgICBpZiB1bmRlZmluZWQgIT09IG9uX2FmdGVyIDo6XG4gICAgICAgIG9uX2FmdGVyKHRndCwgY3R4KVxuXG4gICAgICAvLyBjYXB0dXJlIHN0YXRlIGFmdGVyIGRpc3BhdGNoaW5nIGFjdGlvblxuICAgICAgY29uc3QgcG9zdF9zdGF0ZSA9IE9iamVjdC5hc3NpZ24gQCB7fSwgdGd0XG4gICAgICBjdHgucG9zdF9zdGF0ZSA9IHBvc3Rfc3RhdGVcblxuICAgICAgaWYgcHJlX3N0YXRlICE9PSBzdGF0ZSA6OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IgQCBgQXN5bmMgY29uZmxpY3RpbmcgdXBkYXRlIG9mIFwiJHtob3N0LmNvbnN0cnVjdG9yLm5hbWV9XCIgb2NjdXJlZGBcblxuICAgICAgY29uc3QgY2hhbmdlX3N1bW1hcnkgPSBpc0NoYW5nZWQocHJlX3N0YXRlLCBwb3N0X3N0YXRlLCBzdGF0ZV9zdW1tYXJ5LCBjdHgpXG4gICAgICBpZiBjaGFuZ2Vfc3VtbWFyeSA6OlxuICAgICAgICBjdHguY2hhbmdlZCA9IHRydWVcbiAgICAgICAgc3RhdGUgPSBwb3N0X3N0YXRlXG4gICAgICAgIHN0YXRlX3N1bW1hcnkgPSBjaGFuZ2Vfc3VtbWFyeVxuICAgICAgICB0aXBfdmlldyA9IHRndFxuXG4gICAgICAgIGlmIHVuZGVmaW5lZCAhPT0gb25fY2hhbmdlZCA6OlxuICAgICAgICAgIG9uX2NoYW5nZWQodGd0LCBjdHgpXG5cbiAgICAgIGVsc2UgaWYgdGd0ID09PSByZXN1bHQgOjpcbiAgICAgICAgY3R4LnJlc3VsdCA9IHJlc3VsdCA9IHRpcF92aWV3XG5cbiAgICBmaW5hbGx5IDo6XG4gICAgICBpZiB1bmRlZmluZWQgIT09IG9uX2ZyZWV6ZSA6OlxuICAgICAgICB0cnkgOjpcbiAgICAgICAgICBvbl9mcmVlemUodGd0LCBjdHgpXG4gICAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICAgIFByb21pc2UucmVqZWN0KGVycilcbiAgICAgIE9iamVjdC5mcmVlemUodGd0KVxuXG4gICAgbm90aWZ5KHRpcF92aWV3KVxuICAgIHJldHVybiByZXN1bHRcblxuLy8gLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZShjYWxsYmFjaywgaG9zdF9jYWxsYmFjaywgY2FsbGJhY2tfbmFtZSkgOjpcbiAgaWYgbnVsbCAhPSBob3N0X2NhbGxiYWNrIDo6XG4gICAgY2FsbGJhY2sgPSBbXS5jb25jYXQgQCBob3N0X2NhbGxiYWNrLCBjYWxsYmFjayB8fCBbXVxuICBlbHNlIGlmIG51bGwgPT0gY2FsbGJhY2sgOjogcmV0dXJuXG5cbiAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGNhbGxiYWNrIDo6IHJldHVybiBjYWxsYmFja1xuXG4gIGlmIEFycmF5LmlzQXJyYXkoY2FsbGJhY2spIHx8IGNhbGxiYWNrW1N5bWJvbC5pdGVyYXRvcl0gOjpcbiAgICBjb25zdCBjYWxsYmFja0xpc3QgPSBBcnJheS5mcm9tKGNhbGxiYWNrKS5maWx0ZXIoZSA9PiBudWxsICE9IGUpXG5cbiAgICBpZiBjYWxsYmFja0xpc3Quc29tZSBAIGNiID0+ICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYiA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBEaXNwYXRjaCBleHBlY3RlZCAnJHtjYWxsYmFja19uYW1lfScgb3B0aW9uIHRvIG9ubHkgaW5jbHVkZSBmdW5jdGlvbnMgaW4gbGlzdGBcblxuICAgIGlmIGNhbGxiYWNrTGlzdC5sZW5ndGggPD0gMSA6OlxuICAgICAgY2FsbGJhY2sgPSBjYWxsYmFja0xpc3QucG9wKClcbiAgICBlbHNlIDo6XG4gICAgICBjYWxsYmFjayA9IGZ1bmN0aW9uICh0Z3QsIGFyZzEsIGFyZzIpIDo6XG4gICAgICAgIGZvciBjb25zdCBjYiBvZiBjYWxsYmFja0xpc3QgOjpcbiAgICAgICAgICB0cnkgOjogY2IodGd0LCBhcmcxLCBhcmcyKVxuICAgICAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICAgICAgUHJvbWlzZS5yZWplY3QoZXJyKVxuXG4gIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYWxsYmFjayA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRGlzcGF0Y2ggZXhwZWN0ZWQgJyR7Y2FsbGJhY2tfbmFtZX0nIG9wdGlvbiB0byBiZSBhIGZ1bmN0aW9uIGluc3RhbmNlIG9yIGxpc3Qgb2YgZnVuY3Rpb25zYFxuICByZXR1cm4gY2FsbGJhY2tcblxuLy8gLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBpc09iamVjdENoYW5nZWQocHJldiwgbmV4dCkgOjpcbiAgaWYgcHJldiA9PT0gdW5kZWZpbmVkIDo6XG4gICAgcmV0dXJuIG5leHQgIT09IHVuZGVmaW5lZFxuXG4gIGZvciBjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMobmV4dCkgOjpcbiAgICBpZiAhIEAga2V5IGluIHByZXYgOjpcbiAgICAgIHJldHVybiB0cnVlIC8vIGFkZGVkXG5cbiAgZm9yIGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhwcmV2KSA6OlxuICAgIGlmIHByZXZba2V5XSAhPT0gbmV4dFtrZXldIDo6XG4gICAgICByZXR1cm4gdHJ1ZSAvLyBjaGFuZ2VkXG4gICAgaWYgISBAIGtleSBpbiBuZXh0IDo6XG4gICAgICByZXR1cm4gdHJ1ZSAvLyByZW1vdmVkXG5cbiAgcmV0dXJuIGZhbHNlXG5cbi8vIC0tLVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFN0YXRlVHJhbnNmb3JtKHhmb3JtLCB4Zm9ybV9uYW1lLCB4Zm9ybV9maWx0ZXIpIDo6XG4gIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiB4Zm9ybSA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEV4cGVjdGVkICR7eGZvcm1fbmFtZX10byBiZSBhIGZ1bmN0aW9uYClcblxuICBpZiB0cnVlID09PSB4Zm9ybV9maWx0ZXIgfHwgJ25vdC1mcm96ZW4nIDo6XG4gICAgeGZvcm1fZmlsdGVyID0gYXR0ciA9PiAhIE9iamVjdC5pc0Zyb3plbihhdHRyKVxuXG4gIHJldHVybiBmdW5jdGlvbih0Z3QpIDo6XG4gICAgZm9yIGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyh0Z3QpIDo6XG4gICAgICBjb25zdCBhdHRyID0gdGd0W2tleV1cbiAgICAgIGlmICEgeGZvcm1fZmlsdGVyIHx8IHhmb3JtX2ZpbHRlcihhdHRyLCBrZXkpIDo6XG4gICAgICAgIHRndFtrZXldID0geGZvcm0gQCBhdHRyXG5cbiIsImltcG9ydCBpbW11IGZyb20gJ2ltbXUnXG5pbXBvcnQge2FzRnVuY3Rpb25hbE9iamVjdH0gZnJvbSAnLi9pbmRleC5qc3knXG5cbmV4cG9ydCBmdW5jdGlvbiBhc0ltbXVGdW5jdGlvbmFsT2JqZWN0KGhvc3QsIC4uLm9wdGlvbnMpIDo6XG4gIHJldHVybiBhc0Z1bmN0aW9uYWxPYmplY3QgQCBob3N0LCB7dHJhbnNmb3JtOiBpbW11LCB0cmFuc2Zvcm1GaWx0ZXI6IHRydWV9LCAuLi5vcHRpb25zXG5cbmV4cG9ydCBmdW5jdGlvbiBJbW11T2JqZWN0RnVuY3Rpb25hbCgpIDo6XG4gIHJldHVybiBhc0ltbXVGdW5jdGlvbmFsT2JqZWN0KHRoaXMpXG5cbiJdLCJuYW1lcyI6WyJhc0Z1bmN0aW9uYWxPYmplY3QiLCJob3N0Iiwib3B0aW9ucyIsIk9iamVjdCIsImFzc2lnbiIsIm5vdGlmeSIsImJpbmRVcGRhdGVGdW5jdGlvbiIsImRpc3BhdGNoQWN0aW9uIiwiZGVmaW5lQWN0aW9uIiwiYmluZEFjdGlvbkRlY2xhcmF0aW9ucyIsImFjdGlvbnMiLCJzdWJzY3JpYmUiLCJ2YWx1ZSIsImFyZ3MiLCJfX2ltcGxfcHJvdG9fXyIsImNyZWF0ZSIsImdldFByb3RvdHlwZU9mIiwiX192aWV3X3Byb3RvX18iLCJkZWZpbmVQcm9wZXJ0aWVzIiwiYXNBY3Rpb24iLCJzZXQiLCJjb25maWd1cmFibGUiLCJmcmVlemUiLCJUeXBlRXJyb3IiLCJfX2Rpc3BhdGNoX18iLCJhY3Rpb25OYW1lIiwiYWN0aW9uQXJncyIsInN0YXRlQWN0aW9uRGlzcGF0Y2giLCJhY3Rpb25MaXN0IiwibmFtZSIsIkFycmF5IiwiaXNBcnJheSIsImVudHJpZXMiLCJpbXBsX3Byb3BzIiwidmlld19wcm9wcyIsImhvc3RfcHJvcHMiLCJmbkFjdGlvbiIsImZuRGlzcGF0Y2giLCJub3RpZnlMaXN0IiwiY3VycmVudCIsInVwZGF0ZSIsIm5leHQiLCJjYiIsImVyciIsImNhbGxiYWNrIiwicG9wIiwic2tpcEluaXRpYWxDYWxsIiwiaW5kZXhPZiIsImNvbmNhdCIsInVuc3Vic2NyaWJlIiwiZGlzY2FyZCIsImZpbHRlciIsImUiLCJ0cmFuc2Zvcm0iLCJ4Zm9ybSIsImJpbmRTdGF0ZVRyYW5zZm9ybSIsInRyYW5zZm9ybUZpbHRlciIsImFmdGVyIiwidmlld1RyYW5zZm9ybSIsInZpZXdUcmFuc2Zvcm1GaWx0ZXIiLCJjaGFuZ2VkIiwiaXNDaGFuZ2VkIiwiX19pc19jaGFuZ2VkX18iLCJpc09iamVjdENoYW5nZWQiLCJvbl9iZWZvcmUiLCJhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSIsImJlZm9yZSIsIl9fZGlzcGF0Y2hfYmVmb3JlX18iLCJvbl9lcnJvciIsImVycm9yIiwiX19kaXNwYXRjaF9lcnJvcl9fIiwib25fYWZ0ZXIiLCJfX2Rpc3BhdGNoX2FmdGVyX18iLCJvbl9jaGFuZ2VkIiwiX19kaXNwYXRjaF9jaGFuZ2VkX18iLCJvbl9mcmVlemUiLCJfX2Rpc3BhdGNoX2ZyZWV6ZV9fIiwidW5kZWZpbmVkIiwic3RhdGUiLCJzdGF0ZV9zdW1tYXJ5IiwidGlwX3ZpZXciLCJ2aWV3IiwicHJlX3N0YXRlIiwidGd0IiwicmVzdWx0IiwiY3R4IiwiYWN0aW9uIiwiaXNUaXBWaWV3IiwiYXBwbHkiLCJzZXRQcm90b3R5cGVPZiIsInNob3VsZFRocm93IiwicG9zdF9zdGF0ZSIsIkVycm9yIiwiY29uc3RydWN0b3IiLCJjaGFuZ2Vfc3VtbWFyeSIsInJlamVjdCIsImhvc3RfY2FsbGJhY2siLCJjYWxsYmFja19uYW1lIiwiU3ltYm9sIiwiaXRlcmF0b3IiLCJjYWxsYmFja0xpc3QiLCJmcm9tIiwic29tZSIsImxlbmd0aCIsImFyZzEiLCJhcmcyIiwicHJldiIsImtleSIsImtleXMiLCJ4Zm9ybV9uYW1lIiwieGZvcm1fZmlsdGVyIiwiYXR0ciIsImlzRnJvemVuIiwiYXNJbW11RnVuY3Rpb25hbE9iamVjdCIsImltbXUiLCJJbW11T2JqZWN0RnVuY3Rpb25hbCJdLCJtYXBwaW5ncyI6Ijs7QUFHQTs7QUFFQSxBQUFPLFNBQVNBLGtCQUFULENBQTRCQyxJQUE1QixFQUFrQyxHQUFHQyxPQUFyQyxFQUE4Qzs7WUFFekNDLE9BQU9DLE1BQVAsQ0FBYyxFQUFkLEVBQWtCLEdBQUdGLE9BQXJCLENBQVY7UUFDTUcsU0FBUyxRQUFRSCxRQUFRRyxNQUFoQixHQUNYQyxtQkFBbUJMLElBQW5CLEVBQXlCQyxPQUF6QixDQURXLEdBRVhBLFFBQVFHLE1BRlo7OztRQU9NLEVBQUNFLGNBQUQsRUFBaUJDLFlBQWpCLEtBQWlDQyx1QkFBdUJKLE1BQXZCLENBQXZDO01BQ0dILFFBQVFRLE9BQVgsRUFBcUI7aUJBQWNSLFFBQVFRLE9BQXJCOzs7UUFFaEJDLFlBQVksRUFBSUMsTUFBTSxHQUFHQyxJQUFULEVBQWU7YUFBVVIsT0FBT00sU0FBUCxDQUFpQixHQUFHRSxJQUFwQixDQUFQO0tBQXRCLEVBQWxCO1FBQ01DLGlCQUFpQlgsT0FBT1ksTUFBUCxDQUFnQlosT0FBT2EsY0FBUCxDQUFzQmYsSUFBdEIsQ0FBaEIsRUFBNkMsRUFBSVUsU0FBSixFQUE3QyxDQUF2QjtRQUNNTSxpQkFBaUJkLE9BQU9ZLE1BQVAsQ0FBZ0JaLE9BQU9hLGNBQVAsQ0FBc0JmLElBQXRCLENBQWhCLEVBQTZDLEVBQUlVLFNBQUosRUFBN0MsQ0FBdkI7O1NB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