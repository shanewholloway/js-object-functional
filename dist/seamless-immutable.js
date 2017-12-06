'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var Seamless = _interopDefault(require('seamless-immutable'));

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

function asSeamlessImmutableFunctionalObject(host, ...options) {
  return asFunctionalObject(host, { transform: Seamless, transformfilter: true }, ...options);
}

function SeamlessImmutableObjectFunctional() {
  return asSeamlessImmutableFunctionalObject(this);
}

exports.asSeamlessImmutableFunctionalObject = asSeamlessImmutableFunctionalObject;
exports.SeamlessImmutableObjectFunctional = SeamlessImmutableObjectFunctional;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhbWxlc3MtaW1tdXRhYmxlLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL2luZGV4LmpzeSIsIi4uL2NvZGUvc2VhbWxlc3MtaW1tdXRhYmxlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBPYmplY3RGdW5jdGlvbmFsKCkgOjpcbiAgcmV0dXJuIGFzRnVuY3Rpb25hbE9iamVjdCh0aGlzKVxuXG4vLyAtLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGFzRnVuY3Rpb25hbE9iamVjdChob3N0LCAuLi5vcHRpb25zKSA6OlxuICAvLyBpbml0aWFsaXplIG9wdGlvbnNcbiAgb3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIC4uLm9wdGlvbnMpXG4gIGNvbnN0IG5vdGlmeSA9IG51bGwgPT0gb3B0aW9ucy5ub3RpZnlcbiAgICA/IGJpbmRVcGRhdGVGdW5jdGlvbihob3N0LCBvcHRpb25zKVxuICAgIDogb3B0aW9ucy5ub3RpZnlcblxuXG5cbiAgLy8gc2V0dXAgYXNBY3Rpb24gc2V0dGVyIGhhY2sgLS0gaW4gbGlldSBvZiBFUyBzdGFuZGFyZCBkZWNvcmF0b3JzXG4gIGNvbnN0IHtkaXNwYXRjaEFjdGlvbiwgZGVmaW5lQWN0aW9ufSA9IGJpbmRBY3Rpb25EZWNsYXJhdGlvbnMobm90aWZ5KVxuICBpZiBvcHRpb25zLmFjdGlvbnMgOjogZGVmaW5lQWN0aW9uKG9wdGlvbnMuYWN0aW9ucylcblxuICBjb25zdCBzdWJzY3JpYmUgPSBAe30gdmFsdWUoLi4uYXJncykgOjogcmV0dXJuIG5vdGlmeS5zdWJzY3JpYmUoLi4uYXJncylcbiAgY29uc3QgX19pbXBsX3Byb3RvX18gPSBPYmplY3QuY3JlYXRlIEAgT2JqZWN0LmdldFByb3RvdHlwZU9mKGhvc3QpLCBAe30gc3Vic2NyaWJlXG4gIGNvbnN0IF9fdmlld19wcm90b19fID0gT2JqZWN0LmNyZWF0ZSBAIE9iamVjdC5nZXRQcm90b3R5cGVPZihob3N0KSwgQHt9IHN1YnNjcmliZVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgaG9zdCwgQHt9XG4gICAgc3Vic2NyaWJlLCBhc0FjdGlvbjogQHt9IHNldDogZGVmaW5lQWN0aW9uXG4gICAgX19pbXBsX3Byb3RvX186IEB7fSBjb25maWd1cmFibGU6IHRydWUsIHZhbHVlOiBfX2ltcGxfcHJvdG9fX1xuICAgIF9fdmlld19wcm90b19fOiBAe30gY29uZmlndXJhYmxlOiB0cnVlLCB2YWx1ZTogX192aWV3X3Byb3RvX19cblxuXG4gIC8vIGluaXRpYWxpemUgdGhlIGludGVybmFsIHN0YXQgd2l0aCBpbml0aWFsIHZpZXdcbiAgZGlzcGF0Y2hBY3Rpb24obm90aWZ5LCBudWxsLCBbXSwgbnVsbClcblxuICAvLyByZXR1cm4gYSBmcm96ZW4gY2xvbmUgb2YgdGhlIGhvc3Qgb2JqZWN0XG4gIHJldHVybiBPYmplY3QuZnJlZXplIEAgT2JqZWN0LmNyZWF0ZSBAIGhvc3RcblxuXG4gIGZ1bmN0aW9uIGJpbmRBY3Rpb25EZWNsYXJhdGlvbnMobm90aWZ5KSA6OlxuICAgIGxldCBkaXNwYXRjaEFjdGlvblxuICAgIGlmIG51bGwgIT0gb3B0aW9ucy5kaXNwYXRjaEFjdGlvbiA6OlxuICAgICAgZGlzcGF0Y2hBY3Rpb24gPSBvcHRpb25zLmRpc3BhdGNoQWN0aW9uXG4gICAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZGlzcGF0Y2hBY3Rpb24gOjpcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgRXhwZWN0ZWQgYSBkaXNwYXRjaEFjdGlvbihub3RpZnksIGFjdGlvbk5hbWUsIGFjdGlvbkFyZ3Mpe+KApn0gZnVuY3Rpb25gKVxuICAgIGVsc2UgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGhvc3QuX19kaXNwYXRjaF9fIDo6XG4gICAgICBkaXNwYXRjaEFjdGlvbiA9IGZ1bmN0aW9uKG5vdGlmeSwgYWN0aW9uTmFtZSwgYWN0aW9uQXJncykgOjpcbiAgICAgICAgcmV0dXJuIGhvc3QuX19kaXNwYXRjaF9fKG5vdGlmeSwgYWN0aW9uTmFtZSwgYWN0aW9uQXJncylcbiAgICBlbHNlIDo6XG4gICAgICBkaXNwYXRjaEFjdGlvbiA9IHN0YXRlQWN0aW9uRGlzcGF0Y2goaG9zdCwgb3B0aW9ucylcblxuXG4gICAgY29uc3QgZGVmaW5lQWN0aW9uID0gKGFjdGlvbkxpc3QpID0+IDo6XG4gICAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgYWN0aW9uTGlzdCA6OlxuICAgICAgICBhY3Rpb25MaXN0ID0gQFtdIEBbXSBhY3Rpb25MaXN0Lm5hbWUsIGFjdGlvbkxpc3RcbiAgICAgIGVsc2UgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBhY3Rpb25MaXN0IDo6XG4gICAgICAgIGFjdGlvbkxpc3QgPSBAW10gQFtdIGFjdGlvbkxpc3QsIGhvc3RbYWN0aW9uTGlzdF1cbiAgICAgIGVsc2UgaWYgISBBcnJheS5pc0FycmF5IEAgYWN0aW9uTGlzdCA6OlxuICAgICAgICBhY3Rpb25MaXN0ID0gT2JqZWN0LmVudHJpZXMoYWN0aW9uTGlzdClcbiAgICAgIGVsc2UgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBhY3Rpb25MaXN0WzBdIDo6XG4gICAgICAgIGFjdGlvbkxpc3QgPSBAW10gYWN0aW9uTGlzdFxuXG5cbiAgICAgIGNvbnN0IGltcGxfcHJvcHM9e30sIHZpZXdfcHJvcHM9e30sIGhvc3RfcHJvcHMgPSB7fVxuICAgICAgZm9yIGNvbnN0IFthY3Rpb25OYW1lLCBmbkFjdGlvbl0gb2YgYWN0aW9uTGlzdCA6OlxuICAgICAgICBpZiAhIGFjdGlvbk5hbWUgOjpcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEFjdGlvbiBuYW1lIG5vdCBmb3VuZGBcbiAgICAgICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGZuQWN0aW9uIDo6XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCBhY3Rpb24gXCIke2FjdGlvbk5hbWV9XCIgdG8gYmUgYSBmdW5jdGlvbiwgYnV0IGZvdW5kIFwiJHt0eXBlb2YgZm5BY3Rpb259XCJgXG5cbiAgICAgICAgY29uc3QgZm5EaXNwYXRjaCA9IGZ1bmN0aW9uICguLi5hY3Rpb25BcmdzKSA6OlxuICAgICAgICAgIHJldHVybiBkaXNwYXRjaEFjdGlvbihub3RpZnksIGFjdGlvbk5hbWUsIGFjdGlvbkFyZ3MpXG5cbiAgICAgICAgaW1wbF9wcm9wc1thY3Rpb25OYW1lXSA9IEB7fSB2YWx1ZTogZm5BY3Rpb25cbiAgICAgICAgdmlld19wcm9wc1thY3Rpb25OYW1lXSA9IEB7fSB2YWx1ZTogZm5EaXNwYXRjaFxuICAgICAgICBob3N0X3Byb3BzW2FjdGlvbk5hbWVdID0gQHt9IHZhbHVlOiBmbkRpc3BhdGNoLCBjb25maWd1cmFibGU6IHRydWVcblxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBfX2ltcGxfcHJvdG9fXywgaW1wbF9wcm9wc1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBfX3ZpZXdfcHJvdG9fXywgdmlld19wcm9wc1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBob3N0LCBob3N0X3Byb3BzXG5cbiAgICByZXR1cm4gQHt9IGRpc3BhdGNoQWN0aW9uLCBkZWZpbmVBY3Rpb25cblxuXG4vLyAtLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRVcGRhdGVGdW5jdGlvbigpIDo6XG4gIGxldCBub3RpZnlMaXN0ID0gW11cbiAgbGV0IGN1cnJlbnRcblxuICB1cGRhdGUuc3Vic2NyaWJlID0gc3Vic2NyaWJlXG4gIHJldHVybiB1cGRhdGVcblxuICBmdW5jdGlvbiB1cGRhdGUobmV4dCkgOjpcbiAgICBpZiBjdXJyZW50ID09PSBuZXh0IDo6IHJldHVyblxuXG4gICAgY3VycmVudCA9IG5leHRcbiAgICBmb3IgY29uc3QgY2Igb2Ygbm90aWZ5TGlzdCA6OlxuICAgICAgdHJ5IDo6IGNiKGN1cnJlbnQpXG4gICAgICBjYXRjaCBlcnIgOjogZGlzY2FyZChjYilcblxuICBmdW5jdGlvbiBzdWJzY3JpYmUoLi4uYXJncykgOjpcbiAgICBjb25zdCBjYWxsYmFjayA9IGFyZ3MucG9wKClcbiAgICBjb25zdCBza2lwSW5pdGlhbENhbGwgPSBhcmdzWzBdXG5cbiAgICBpZiAtMSAhPT0gbm90aWZ5TGlzdC5pbmRleE9mKGNhbGxiYWNrKSA6OlxuICAgICAgcmV0dXJuXG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNhbGxiYWNrIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYFBsZWFzZSBzdWJzY3JpYmUgd2l0aCBhIGZ1bmN0aW9uYFxuXG4gICAgbm90aWZ5TGlzdCA9IG5vdGlmeUxpc3QuY29uY2F0IEAgW2NhbGxiYWNrXVxuICAgIGlmICEgc2tpcEluaXRpYWxDYWxsIDo6XG4gICAgICBjYWxsYmFjayhjdXJyZW50KVxuICAgIHVuc3Vic2NyaWJlLnVuc3Vic2NyaWJlID0gdW5zdWJzY3JpYmVcbiAgICByZXR1cm4gdW5zdWJzY3JpYmVcblxuICAgIGZ1bmN0aW9uIHVuc3Vic2NyaWJlKCkgOjpcbiAgICAgIGRpc2NhcmQoY2FsbGJhY2spXG5cbiAgZnVuY3Rpb24gZGlzY2FyZChjYWxsYmFjaykgOjpcbiAgICBub3RpZnlMaXN0ID0gbm90aWZ5TGlzdFxuICAgICAgLmZpbHRlciBAIGUgPT4gY2FsbGJhY2sgIT09IGVcblxuLy8gLS0tXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHN0YXRlQWN0aW9uRGlzcGF0Y2goaG9zdCwgb3B0aW9ucz17fSkgOjpcbiAgaWYgb3B0aW9ucy50cmFuc2Zvcm0gOjpcbiAgICBjb25zdCB4Zm9ybSA9IGJpbmRTdGF0ZVRyYW5zZm9ybShvcHRpb25zLnRyYW5zZm9ybSwgJ3RyYW5zZm9ybScsIG9wdGlvbnMudHJhbnNmb3JtRmlsdGVyKVxuICAgIG9wdGlvbnMuYWZ0ZXIgPSBbXS5jb25jYXQgQCBvcHRpb25zLmFmdGVyIHx8IFtdLCB4Zm9ybVxuXG4gIGlmIG9wdGlvbnMudmlld1RyYW5zZm9ybSA6OlxuICAgIGNvbnN0IHhmb3JtID0gYmluZFN0YXRlVHJhbnNmb3JtKG9wdGlvbnMudmlld1RyYW5zZm9ybSwgJ3ZpZXdUcmFuc2Zvcm0nLCBvcHRpb25zLnZpZXdUcmFuc2Zvcm1GaWx0ZXIpXG4gICAgb3B0aW9ucy5jaGFuZ2VkID0gW10uY29uY2F0IEAgb3B0aW9ucy5jaGFuZ2VkIHx8IFtdLCB4Zm9ybVxuXG4gIGNvbnN0IGlzQ2hhbmdlZCA9IG9wdGlvbnMuaXNDaGFuZ2VkIHx8IGhvc3QuX19pc19jaGFuZ2VkX18gfHwgaXNPYmplY3RDaGFuZ2VkXG4gIGNvbnN0IG9uX2JlZm9yZSA9IGFzRGlzcGF0Y2hDYWxsYmFja1BpcGVsaW5lIEAgb3B0aW9ucy5iZWZvcmUsIGhvc3QuX19kaXNwYXRjaF9iZWZvcmVfXywgJ2JlZm9yZSdcbiAgY29uc3Qgb25fZXJyb3IgPSBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSBAIG9wdGlvbnMuZXJyb3IsIGhvc3QuX19kaXNwYXRjaF9lcnJvcl9fLCAnZXJyb3InXG4gIGNvbnN0IG9uX2FmdGVyID0gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUgQCBvcHRpb25zLmFmdGVyLCBob3N0Ll9fZGlzcGF0Y2hfYWZ0ZXJfXywgJ2FmdGVyJ1xuICBjb25zdCBvbl9jaGFuZ2VkID0gYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUgQCBvcHRpb25zLmNoYW5nZWQsIGhvc3QuX19kaXNwYXRjaF9jaGFuZ2VkX18sICdjaGFuZ2VkJ1xuICBjb25zdCBvbl9mcmVlemUgPSBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZSBAIG9wdGlvbnMuZnJlZXplLCBob3N0Ll9fZGlzcGF0Y2hfZnJlZXplX18sICdmcmVlemUnXG5cbiAgaWYgdW5kZWZpbmVkICE9PSBpc0NoYW5nZWQgJiYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGlzQ2hhbmdlZCA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRGlzcGF0Y2ggZXhwZWN0ZWQgJ2lzQ2hhbmdlZCcgb3B0aW9uIHRvIGJlIGEgZnVuY3Rpb24gaW5zdGFuY2VgXG5cbiAgbGV0IHN0YXRlID0ge30sIHN0YXRlX3N1bW1hcnksIHRpcF92aWV3XG4gIHJldHVybiBfX2Rpc3BhdGNoX19cblxuICBmdW5jdGlvbiBfX2Rpc3BhdGNoX18obm90aWZ5LCBhY3Rpb25OYW1lLCBhY3Rpb25BcmdzLCB2aWV3KSA6OlxuICAgIGNvbnN0IHByZV9zdGF0ZSA9IHN0YXRlXG4gICAgY29uc3QgdGd0ID0gT2JqZWN0LmNyZWF0ZSBAIGhvc3QuX19pbXBsX3Byb3RvX19cblxuICAgIE9iamVjdC5hc3NpZ24gQCB0Z3QsIHN0YXRlXG5cbiAgICBsZXQgcmVzdWx0XG4gICAgY29uc3QgY3R4ID0gQDogYWN0aW9uOiBbYWN0aW9uTmFtZSwgYWN0aW9uQXJncywgdmlld11cbiAgICAgIHByZV9zdGF0ZSwgaXNUaXBWaWV3OiB0aXBfdmlldyA9PT0gdmlldyAmJiB2aWV3ICE9PSB1bmRlZmluZWRcblxuICAgIHRyeSA6OlxuICAgICAgaWYgdW5kZWZpbmVkICE9PSBvbl9iZWZvcmUgOjpcbiAgICAgICAgb25fYmVmb3JlKHRndCwgY3R4KVxuXG4gICAgICB0cnkgOjpcbiAgICAgICAgLy8gZGlzcGF0Y2ggYWN0aW9uIG1ldGhvZFxuICAgICAgICBpZiBhY3Rpb25OYW1lIDo6XG4gICAgICAgICAgcmVzdWx0ID0gdGd0W2FjdGlvbk5hbWVdLmFwcGx5KHRndCwgYWN0aW9uQXJncylcbiAgICAgICAgICBjdHgucmVzdWx0ID0gcmVzdWx0XG4gICAgICAgIGVsc2UgOjpcbiAgICAgICAgICBjdHgucmVzdWx0ID0gcmVzdWx0ID0gdGlwX3ZpZXcgPSB0Z3RcblxuICAgICAgICAvLyB0cmFuc2Zvcm0gZnJvbSBpbXBsIGRvd24gdG8gYSB2aWV3XG4gICAgICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0Z3QsIGhvc3QuX192aWV3X3Byb3RvX18pXG5cbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICAvLyB0cmFuc2Zvcm0gZnJvbSBpbXBsIGRvd24gdG8gYSB2aWV3XG4gICAgICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0Z3QsIGhvc3QuX192aWV3X3Byb3RvX18pXG5cbiAgICAgICAgLy8gaGFuZGxlIGVycm9yIGZyb20gYWN0aW9uIG1ldGhvZFxuICAgICAgICBpZiB1bmRlZmluZWQgPT09IG9uX2Vycm9yIDo6IHRocm93IGVyclxuXG4gICAgICAgIGNvbnN0IHNob3VsZFRocm93ID0gb25fZXJyb3IoZXJyLCB0Z3QsIGN0eClcbiAgICAgICAgaWYgZmFsc2UgIT09IHNob3VsZFRocm93IDo6IHRocm93IGVyclxuXG4gICAgICBpZiB1bmRlZmluZWQgIT09IG9uX2FmdGVyIDo6XG4gICAgICAgIG9uX2FmdGVyKHRndCwgY3R4KVxuXG4gICAgICAvLyBjYXB0dXJlIHN0YXRlIGFmdGVyIGRpc3BhdGNoaW5nIGFjdGlvblxuICAgICAgY29uc3QgcG9zdF9zdGF0ZSA9IE9iamVjdC5hc3NpZ24gQCB7fSwgdGd0XG4gICAgICBjdHgucG9zdF9zdGF0ZSA9IHBvc3Rfc3RhdGVcblxuICAgICAgaWYgcHJlX3N0YXRlICE9PSBzdGF0ZSA6OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IgQCBgQXN5bmMgY29uZmxpY3RpbmcgdXBkYXRlIG9mIFwiJHtob3N0LmNvbnN0cnVjdG9yLm5hbWV9XCIgb2NjdXJlZGBcblxuICAgICAgY29uc3QgY2hhbmdlX3N1bW1hcnkgPSBpc0NoYW5nZWQocHJlX3N0YXRlLCBwb3N0X3N0YXRlLCBzdGF0ZV9zdW1tYXJ5LCBjdHgpXG4gICAgICBpZiBjaGFuZ2Vfc3VtbWFyeSA6OlxuICAgICAgICBjdHguY2hhbmdlZCA9IHRydWVcbiAgICAgICAgc3RhdGUgPSBwb3N0X3N0YXRlXG4gICAgICAgIHN0YXRlX3N1bW1hcnkgPSBjaGFuZ2Vfc3VtbWFyeVxuICAgICAgICB0aXBfdmlldyA9IHRndFxuXG4gICAgICAgIGlmIHVuZGVmaW5lZCAhPT0gb25fY2hhbmdlZCA6OlxuICAgICAgICAgIG9uX2NoYW5nZWQodGd0LCBjdHgpXG5cbiAgICAgIGVsc2UgaWYgdGd0ID09PSByZXN1bHQgOjpcbiAgICAgICAgY3R4LnJlc3VsdCA9IHJlc3VsdCA9IHRpcF92aWV3XG5cbiAgICBmaW5hbGx5IDo6XG4gICAgICBpZiB1bmRlZmluZWQgIT09IG9uX2ZyZWV6ZSA6OlxuICAgICAgICB0cnkgOjpcbiAgICAgICAgICBvbl9mcmVlemUodGd0LCBjdHgpXG4gICAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICAgIFByb21pc2UucmVqZWN0KGVycilcbiAgICAgIE9iamVjdC5mcmVlemUodGd0KVxuXG4gICAgbm90aWZ5KHRpcF92aWV3KVxuICAgIHJldHVybiByZXN1bHRcblxuLy8gLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBhc0Rpc3BhdGNoQ2FsbGJhY2tQaXBlbGluZShjYWxsYmFjaywgaG9zdF9jYWxsYmFjaywgY2FsbGJhY2tfbmFtZSkgOjpcbiAgaWYgbnVsbCAhPSBob3N0X2NhbGxiYWNrIDo6XG4gICAgY2FsbGJhY2sgPSBbXS5jb25jYXQgQCBob3N0X2NhbGxiYWNrLCBjYWxsYmFjayB8fCBbXVxuICBlbHNlIGlmIG51bGwgPT0gY2FsbGJhY2sgOjogcmV0dXJuXG5cbiAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGNhbGxiYWNrIDo6IHJldHVybiBjYWxsYmFja1xuXG4gIGlmIEFycmF5LmlzQXJyYXkoY2FsbGJhY2spIHx8IGNhbGxiYWNrW1N5bWJvbC5pdGVyYXRvcl0gOjpcbiAgICBjb25zdCBjYWxsYmFja0xpc3QgPSBBcnJheS5mcm9tKGNhbGxiYWNrKS5maWx0ZXIoZSA9PiBudWxsICE9IGUpXG5cbiAgICBpZiBjYWxsYmFja0xpc3Quc29tZSBAIGNiID0+ICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYiA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBEaXNwYXRjaCBleHBlY3RlZCAnJHtjYWxsYmFja19uYW1lfScgb3B0aW9uIHRvIG9ubHkgaW5jbHVkZSBmdW5jdGlvbnMgaW4gbGlzdGBcblxuICAgIGlmIGNhbGxiYWNrTGlzdC5sZW5ndGggPD0gMSA6OlxuICAgICAgY2FsbGJhY2sgPSBjYWxsYmFja0xpc3QucG9wKClcbiAgICBlbHNlIDo6XG4gICAgICBjYWxsYmFjayA9IGZ1bmN0aW9uICh0Z3QsIGFyZzEsIGFyZzIpIDo6XG4gICAgICAgIGZvciBjb25zdCBjYiBvZiBjYWxsYmFja0xpc3QgOjpcbiAgICAgICAgICB0cnkgOjogY2IodGd0LCBhcmcxLCBhcmcyKVxuICAgICAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICAgICAgUHJvbWlzZS5yZWplY3QoZXJyKVxuXG4gIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYWxsYmFjayA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRGlzcGF0Y2ggZXhwZWN0ZWQgJyR7Y2FsbGJhY2tfbmFtZX0nIG9wdGlvbiB0byBiZSBhIGZ1bmN0aW9uIGluc3RhbmNlIG9yIGxpc3Qgb2YgZnVuY3Rpb25zYFxuICByZXR1cm4gY2FsbGJhY2tcblxuLy8gLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBpc09iamVjdENoYW5nZWQocHJldiwgbmV4dCkgOjpcbiAgaWYgcHJldiA9PT0gdW5kZWZpbmVkIDo6XG4gICAgcmV0dXJuIG5leHQgIT09IHVuZGVmaW5lZFxuXG4gIGZvciBjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMobmV4dCkgOjpcbiAgICBpZiAhIEAga2V5IGluIHByZXYgOjpcbiAgICAgIHJldHVybiB0cnVlIC8vIGFkZGVkXG5cbiAgZm9yIGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhwcmV2KSA6OlxuICAgIGlmIHByZXZba2V5XSAhPT0gbmV4dFtrZXldIDo6XG4gICAgICByZXR1cm4gdHJ1ZSAvLyBjaGFuZ2VkXG4gICAgaWYgISBAIGtleSBpbiBuZXh0IDo6XG4gICAgICByZXR1cm4gdHJ1ZSAvLyByZW1vdmVkXG5cbiAgcmV0dXJuIGZhbHNlXG5cbi8vIC0tLVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFN0YXRlVHJhbnNmb3JtKHhmb3JtLCB4Zm9ybV9uYW1lLCB4Zm9ybV9maWx0ZXIpIDo6XG4gIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiB4Zm9ybSA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEV4cGVjdGVkICR7eGZvcm1fbmFtZX10byBiZSBhIGZ1bmN0aW9uYClcblxuICBpZiB0cnVlID09PSB4Zm9ybV9maWx0ZXIgfHwgJ25vdC1mcm96ZW4nIDo6XG4gICAgeGZvcm1fZmlsdGVyID0gYXR0ciA9PiAhIE9iamVjdC5pc0Zyb3plbihhdHRyKVxuXG4gIHJldHVybiBmdW5jdGlvbih0Z3QpIDo6XG4gICAgZm9yIGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyh0Z3QpIDo6XG4gICAgICBjb25zdCBhdHRyID0gdGd0W2tleV1cbiAgICAgIGlmICEgeGZvcm1fZmlsdGVyIHx8IHhmb3JtX2ZpbHRlcihhdHRyLCBrZXkpIDo6XG4gICAgICAgIHRndFtrZXldID0geGZvcm0gQCBhdHRyXG5cbiIsImltcG9ydCBTZWFtbGVzcyBmcm9tICdzZWFtbGVzcy1pbW11dGFibGUnXG5pbXBvcnQge2FzRnVuY3Rpb25hbE9iamVjdH0gZnJvbSAnLi9pbmRleC5qc3knXG5cbmV4cG9ydCBmdW5jdGlvbiBhc1NlYW1sZXNzSW1tdXRhYmxlRnVuY3Rpb25hbE9iamVjdChob3N0LCAuLi5vcHRpb25zKSA6OlxuICByZXR1cm4gYXNGdW5jdGlvbmFsT2JqZWN0IEAgaG9zdCwge3RyYW5zZm9ybTogU2VhbWxlc3MsIHRyYW5zZm9ybWZpbHRlcjogdHJ1ZX0sIC4uLm9wdGlvbnNcblxuZXhwb3J0IGZ1bmN0aW9uIFNlYW1sZXNzSW1tdXRhYmxlT2JqZWN0RnVuY3Rpb25hbCgpIDo6XG4gIHJldHVybiBhc1NlYW1sZXNzSW1tdXRhYmxlRnVuY3Rpb25hbE9iamVjdCh0aGlzKVxuXG4iXSwibmFtZXMiOlsiYXNGdW5jdGlvbmFsT2JqZWN0IiwiaG9zdCIsIm9wdGlvbnMiLCJPYmplY3QiLCJhc3NpZ24iLCJub3RpZnkiLCJiaW5kVXBkYXRlRnVuY3Rpb24iLCJkaXNwYXRjaEFjdGlvbiIsImRlZmluZUFjdGlvbiIsImJpbmRBY3Rpb25EZWNsYXJhdGlvbnMiLCJhY3Rpb25zIiwic3Vic2NyaWJlIiwidmFsdWUiLCJhcmdzIiwiX19pbXBsX3Byb3RvX18iLCJjcmVhdGUiLCJnZXRQcm90b3R5cGVPZiIsIl9fdmlld19wcm90b19fIiwiZGVmaW5lUHJvcGVydGllcyIsImFzQWN0aW9uIiwic2V0IiwiY29uZmlndXJhYmxlIiwiZnJlZXplIiwiVHlwZUVycm9yIiwiX19kaXNwYXRjaF9fIiwiYWN0aW9uTmFtZSIsImFjdGlvbkFyZ3MiLCJzdGF0ZUFjdGlvbkRpc3BhdGNoIiwiYWN0aW9uTGlzdCIsIm5hbWUiLCJBcnJheSIsImlzQXJyYXkiLCJlbnRyaWVzIiwiaW1wbF9wcm9wcyIsInZpZXdfcHJvcHMiLCJob3N0X3Byb3BzIiwiZm5BY3Rpb24iLCJmbkRpc3BhdGNoIiwibm90aWZ5TGlzdCIsImN1cnJlbnQiLCJ1cGRhdGUiLCJuZXh0IiwiY2IiLCJlcnIiLCJjYWxsYmFjayIsInBvcCIsInNraXBJbml0aWFsQ2FsbCIsImluZGV4T2YiLCJjb25jYXQiLCJ1bnN1YnNjcmliZSIsImRpc2NhcmQiLCJmaWx0ZXIiLCJlIiwidHJhbnNmb3JtIiwieGZvcm0iLCJiaW5kU3RhdGVUcmFuc2Zvcm0iLCJ0cmFuc2Zvcm1GaWx0ZXIiLCJhZnRlciIsInZpZXdUcmFuc2Zvcm0iLCJ2aWV3VHJhbnNmb3JtRmlsdGVyIiwiY2hhbmdlZCIsImlzQ2hhbmdlZCIsIl9faXNfY2hhbmdlZF9fIiwiaXNPYmplY3RDaGFuZ2VkIiwib25fYmVmb3JlIiwiYXNEaXNwYXRjaENhbGxiYWNrUGlwZWxpbmUiLCJiZWZvcmUiLCJfX2Rpc3BhdGNoX2JlZm9yZV9fIiwib25fZXJyb3IiLCJlcnJvciIsIl9fZGlzcGF0Y2hfZXJyb3JfXyIsIm9uX2FmdGVyIiwiX19kaXNwYXRjaF9hZnRlcl9fIiwib25fY2hhbmdlZCIsIl9fZGlzcGF0Y2hfY2hhbmdlZF9fIiwib25fZnJlZXplIiwiX19kaXNwYXRjaF9mcmVlemVfXyIsInVuZGVmaW5lZCIsInN0YXRlIiwic3RhdGVfc3VtbWFyeSIsInRpcF92aWV3IiwidmlldyIsInByZV9zdGF0ZSIsInRndCIsInJlc3VsdCIsImN0eCIsImFjdGlvbiIsImlzVGlwVmlldyIsImFwcGx5Iiwic2V0UHJvdG90eXBlT2YiLCJzaG91bGRUaHJvdyIsInBvc3Rfc3RhdGUiLCJFcnJvciIsImNvbnN0cnVjdG9yIiwiY2hhbmdlX3N1bW1hcnkiLCJyZWplY3QiLCJob3N0X2NhbGxiYWNrIiwiY2FsbGJhY2tfbmFtZSIsIlN5bWJvbCIsIml0ZXJhdG9yIiwiY2FsbGJhY2tMaXN0IiwiZnJvbSIsInNvbWUiLCJsZW5ndGgiLCJhcmcxIiwiYXJnMiIsInByZXYiLCJrZXkiLCJrZXlzIiwieGZvcm1fbmFtZSIsInhmb3JtX2ZpbHRlciIsImF0dHIiLCJpc0Zyb3plbiIsImFzU2VhbWxlc3NJbW11dGFibGVGdW5jdGlvbmFsT2JqZWN0IiwiU2VhbWxlc3MiLCJ0cmFuc2Zvcm1maWx0ZXIiLCJTZWFtbGVzc0ltbXV0YWJsZU9iamVjdEZ1bmN0aW9uYWwiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBR0E7O0FBRUEsQUFBTyxTQUFTQSxrQkFBVCxDQUE0QkMsSUFBNUIsRUFBa0MsR0FBR0MsT0FBckMsRUFBOEM7O1lBRXpDQyxPQUFPQyxNQUFQLENBQWMsRUFBZCxFQUFrQixHQUFHRixPQUFyQixDQUFWO1FBQ01HLFNBQVMsUUFBUUgsUUFBUUcsTUFBaEIsR0FDWEMsbUJBQW1CTCxJQUFuQixFQUF5QkMsT0FBekIsQ0FEVyxHQUVYQSxRQUFRRyxNQUZaOzs7UUFPTSxFQUFDRSxjQUFELEVBQWlCQyxZQUFqQixLQUFpQ0MsdUJBQXVCSixNQUF2QixDQUF2QztNQUNHSCxRQUFRUSxPQUFYLEVBQXFCO2lCQUFjUixRQUFRUSxPQUFyQjs7O1FBRWhCQyxZQUFZLEVBQUlDLE1BQU0sR0FBR0MsSUFBVCxFQUFlO2FBQVVSLE9BQU9NLFNBQVAsQ0FBaUIsR0FBR0UsSUFBcEIsQ0FBUDtLQUF0QixFQUFsQjtRQUNNQyxpQkFBaUJYLE9BQU9ZLE1BQVAsQ0FBZ0JaLE9BQU9hLGNBQVAs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
