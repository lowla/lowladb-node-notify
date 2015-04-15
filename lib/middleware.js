
'use strict';
var Promise = require('bluebird');
var _ = require("lodash");

// Public APIs

//basic
Middleware.prototype.use = use;
Middleware.prototype.execute = execute;
Middleware.prototype.setTimeout = setTimeout;
Middleware.prototype.setTimeoutAll = setTimeoutAll;
Middleware.prototype.ignoreErrors = ignoreErrors;

exports.Middleware = Middleware;

//as a logger
MiddlewareLogger.prototype = _.create(Middleware.prototype, {
  'constructor': MiddlewareLogger
});
MiddlewareLogger.prototype.useLogger = useLogger;
exports.MiddlewareLogger = MiddlewareLogger;

// Private APIs

/////////////////


function Middleware() {
  this._handlers = [];
  this._timeout = 45 * 1000;  //default timeout per middleware
  this._timeoutAll = 300 * 1000;  //default timeout for entire chain
  this._timeoutMessage = 'Middleware: middleware operation exceeded time limit!'
  this._timeoutAllMessage = 'Middleware: middleware chain exceeded time limit for all operations!'
  this._ignoreErrors = false;
}


function setTimeout(msTimeOut){
  this._timeout = msTimeOut;
}

function setTimeoutAll(msTimeOut){
  this._timeoutAll = msTimeOut;
}

function ignoreErrors(boolval){
  this._ignoreErrors = boolval;
}

function use(fn, context){
  // register a middleware and optional 'this' context
  var middleware = this;
  middleware._handlers.push({fn:fn, ctx:context});
}


function execute(){
  // execute all middleware, passing whatever args are given
  var middleware = this;
  var errors = [];

  //make room for next() function // ++ manually bump the length property (after use) since it's merely 'array-like'
  // could use Array.prototype.slice.call(arguments); -- less efficient?
  arguments[arguments.length++]=false;

  return middleware._handlers.reduce(
    function(promiseChain, fnDef) {
      // for each 'use' fn, chain another promise resolved by the 'use' fn calling the 'next()' fn passed as final arg
      return promiseChain.then(function(args){
        return new Promise(function(resolve, reject){
          // the next() function passed as last arg to fn
          args[args.length-1] = function(err){
            if (err) {
              reject(err);
            } else {
              resolve(args);
            }
          };
          // apply the 'use' fn with the updated args
          fnDef.fn.apply(fnDef.ctx, args);
        }).timeout(middleware._timeout, middleware._timeoutMessage)  //per mw timeout
        .then(function(args){
            //todo this could be an 'after' hook
            //  console.log("FINISHED: ", fnDef.fn)
            //results.push()
            return args;
          },
        function(error){
          if(undefined === error.middlewareFunction){
            error.middlewareFunction = fnDef.fn
          }
          if(middleware._ignoreErrors){
            console.warn("returning args");
            errors.push(error);
            return args;
          }else{
            throw error;
          }
        });
      });
    }
    , Promise.resolve(arguments)  // seed value for ._handlers.reduce()
  ).then(function(args){
      if(0<errors.length){
        return errors;
      }else{
        return false;
      }
    }
  ).timeout(middleware._timeoutAll, middleware._timeoutAllMessage);
}


// as logger

function MiddlewareLogger(){
  Middleware.call(this);
  var middlewareLogger = this;
  middlewareLogger._ignoreErrors = true;
  middlewareLogger._timeout = 15 * 1000;

  ['debug', 'log', 'info', 'warn', 'error'].forEach(function(logLevel){
    middlewareLogger[logLevel] = function(){
      return middlewareLogger.execute.call(middlewareLogger, logLevel, arguments) ; //Array.prototype.slice.call(arguments) );
    }
  });
}

function useLogger(log){
  var middlewareLogger = this;
  var logger = {};
  ['debug', 'log', 'info', 'warn', 'error'].forEach(function(logLevel){
    if(typeof(log[logLevel]) === 'function'){
      this[logLevel]=log[logLevel].bind(log);
    }else{
      //map debug/log if its missing otherwise warn.
      if(logLevel==='debug' && typeof(log['log']) === 'function'){
        this[logLevel] = log['log'].bind(log);
      }else if(logLevel==='log' && typeof(log['debug']) === 'function'){
        this[logLevel] = log['debug'].bind(log);
      }else{
        log.warn('MiddlewareLogger: \'' + logLevel + '\' not supported by logger, disabled')
        this[logLevel]=function(){};
      }
    }
  }, logger);
  middlewareLogger.use(
    function(level, args, next){
      var a = Array.prototype.slice.call(arguments);
      if (typeof(this[level]) === "function") {
        this[level].apply(this, args);
      }
      next();
    }.bind(logger)  //bind logger to 'this'!
  )
}
