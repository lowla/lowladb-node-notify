
var Promise = require('bluebird');
var chai = require('chai');
var should = chai.should();
chai.use(require('chai-things'));
var sinon = require('sinon');
var _ = require('lodash');
var util = require('util');

var Middleware = require('../lib/middleware.js').Middleware;
var MiddlewareLogger = require('../lib/middleware.js').MiddlewareLogger;

describe('Middleware', function(){

  it('calls middleware', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};
    var middleware = new Middleware();
    middleware.use(function(one, two, three, next){
      one.name.should.equal('a');
      one.val.should.equal('aaa');
      two.name.should.equal('b');
      two.val.should.equal('bbb');
      three.name.should.equal('c');
      three.val.should.equal('ccc');
      one.val='ok';
      two.name = 'd';
      two.val='ddd';
      three = 'hi'; //this will not do anthing b/c it's byval on the current stack
      next();
    });

    middleware.use(function(one, two, three, next){
      one.name.should.equal('a');
      one.val.should.equal('ok');
      two.name.should.equal('d');
      two.val.should.equal('ddd');
      three.name.should.equal('c');
      three.val.should.equal('ccc');
      one.val='eee';
      two.val='fff';
      next();
    });

    return middleware.execute(first, second, third).then(function(args){
      first.name.should.equal('a');
      first.val.should.equal('eee');
      second.name.should.equal('d');
      second.val.should.equal('fff');
      third.name.should.equal('c');
      third.val.should.equal('ccc');
      //console.log('Done, f/s/t: ', first, second, third);
      //console.log(args);
    }).catch(function(err){
      throw err;
    });

  });


  it('handles async calling & order', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};
    var middleware = new Middleware();
    middleware.use(function(one, two, three, next){
      setTimeout(function() {
        one.name.should.equal('a');
        one.val.should.equal('aaa');
        two.name.should.equal('b');
        two.val.should.equal('bbb');
        three.name.should.equal('c');
        three.val.should.equal('ccc');
        one.val='ok';
        two.name = 'd';
        two.val='ddd';
        next();
      },800)
    });

    middleware.use(function(one, two, three, next){
      setImmediate(function(){
        one.name.should.equal('a');
        one.val.should.equal('ok');
        two.name.should.equal('d');
        two.val.should.equal('ddd');
        three.name.should.equal('c');
        three.val.should.equal('ccc');
        one.val='eee';
        two.val='fff';
        next();
      })
    });

    return middleware.execute(first, second, third).then(function(args){
      first.name.should.equal('a');
      first.val.should.equal('eee');
      second.name.should.equal('d');
      second.val.should.equal('fff');
      third.name.should.equal('c');
      third.val.should.equal('ccc');
    }).catch(function(err){
      throw err;
    });

  });


  it('throws an error aborting the chain', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};

    var middleware = new Middleware();
    middleware.use(function(one, two, three, next){
      two.val.should.equal('bbb');
      two.val='eee';
      next();
    });

    middleware.use(function(one, two, three, next){
      two.val.should.equal('eee');
      somethingThatShouldBeDefined.isNotDefined(one);
      next();
    });

    middleware.use(function(one, two, three, next){
      throw new Error('throw failed to break chain!');
    });

    return middleware.execute(first, second, third).then(function(args){
      throw new Error('did not receive expected error from chain');
    }).catch( function(err){
      err.should.be.an.instanceOf(Error);
      err.message.should.equal('somethingThatShouldBeDefined is not defined');
    });

  });


  it('throws an error and records the error function', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};


    var errFn = function(one, two, three, next){
      somethingThatShouldBeDefined.isNotDefined(one);
      next();
    };

    var middleware = new Middleware();
    middleware.use(errFn);

    return middleware.execute(first, second, third).then(function(args){
      throw new Error('did not receive expected error from chain');
    }).catch( function(err){
      err.should.be.an.instanceOf(Error);
      err.message.should.equal('somethingThatShouldBeDefined is not defined');
      err.middlewareFunction.should.equal(errFn);
    });

  });


  it('fails to call next() aborting the chain', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};

    var middleware = new Middleware();
    middleware.setTimeout(200);
    middleware.use(function(one, two, three, next){
      two.val.should.equal('bbb');
      two.val='eee';
      next();
    });

    middleware.use(function(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'eee';
      ///////////next();
    });

    middleware.use(function(one, two, three, next){
      throw new Error('timeout failed to break chain!');
    });

    return middleware.execute(first, second, third).then(function(args){
      throw new Error('did not receive expected error from chain');
    }).catch( function(err){
      err.should.be.an.instanceOf(Error);
      err.message.should.equal(middleware._timeoutMessage);
    });

  });


  it('respects per-middleware timeout', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};

    var middleware = new Middleware();
    middleware.setTimeout(500);
    middleware.use(function wontHitTimeout(one, two, three, next){
      two.val.should.equal('bbb');
      two.val='eee';
      setTimeout(function(){
        next();
      }, 475);
    });

    middleware.use(function willHitTimeout(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'eee';
      setTimeout(function(){
        next();
      }, 600);
    });

    middleware.use(function(one, two, three, next){
      throw new Error('timeout failed to break chain!');
    });

    return middleware.execute(first, second, third).then(function(args){
      throw new Error('did not receive expected error from chain');
    }).catch( function(err){
      err.should.be.an.instanceOf(Error);
      err.message.should.equal(middleware._timeoutMessage);
      err.middlewareFunction.name.should.equal('willHitTimeout');
      second.val.should.equal('eee');  //confirm the second mw ran.
    });

  });

  it('continues after per-middleware timeout if ignoreErrors', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};

    var middleware = new Middleware();
    middleware.ignoreErrors(true);
    middleware.setTimeout(500);
    middleware.use(function wontHitTimeout(one, two, three, next){
      two.val.should.equal('bbb');
      two.val='eee';
      setTimeout(function(){
        next();
      }, 475);
    });

    middleware.use(function willHitTimeout(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'eee';
      setTimeout(function(){
        next();
      }, 600);
    });

    middleware.use(function(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'fini';
      next();
    });

    return middleware.execute(first, second, third).then(function(errors){
      if(!errors){
        throw new Error('Execute failed to return error array');
      }

      errors.length.should.equal(1);
      errors[0].message.should.equal(middleware._timeoutMessage);
      errors[0].middlewareFunction.name.should.equal('willHitTimeout');

      second.val.should.equal('fini'); //confirm 3rd mw ran
    });

  });

  it('respects total timeout', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};

    var middleware = new Middleware();
    middleware.setTimeoutAll(500);
    middleware.use(function wontHitTimeout(one, two, three, next){
      two.val.should.equal('bbb');
      two.val='eee';
      setTimeout(function(){
        next();
      }, 475);
    });

    middleware.use(function willHitTimeout(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'eee';
      setTimeout(function(){
        next();
      }, 100);
    });

    middleware.use(function(one, two, three, next){
      throw new Error('timeout failed to break chain!');
    });

    return middleware.execute(first, second, third).then(function(args){
      throw new Error('did not receive expected error from chain');
    }).catch( function(err){
      err.should.be.an.instanceOf(Error);
      err.message.should.equal(middleware._timeoutAllMessage);
      should.not.exist(err.middlewareFunction);
      second.val.should.equal('eee');  //confirm the second mw ran.
    });

  });

  it('respects total timeout when ignoreErrors', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};

    var middleware = new Middleware();
    middleware.ignoreErrors(true);
    middleware.setTimeoutAll(500);
    middleware.use(function wontHitTimeout(one, two, three, next){
      two.val.should.equal('bbb');
      two.val='eee';
      setTimeout(function(){
        next();
      }, 475);
    });

    middleware.use(function willHitTimeout(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'eee';
      setTimeout(function(){
        next();
      }, 100);
    });

    middleware.use(function(one, two, three, next){
      throw new Error('timeout failed to break chain!');
    });

    return middleware.execute(first, second, third).then(function(args){
      throw new Error('did not receive expected error from chain');
    }).catch( function(err){
      err.should.be.an.instanceOf(Error);
      err.message.should.equal(middleware._timeoutAllMessage);
      should.not.exist(err.middlewareFunction);
      second.val.should.equal('eee');  //confirm the second mw ran.
    });

  });


  it('returns a value in next() aborting the chain', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};

    var middleware = new Middleware();
    middleware.use(function(one, two, three, next){
      two.val.should.equal('bbb');
      two.val='eee';
      next();
    });

    middleware.use(function(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'eee';
      next(new Error('something really bad happened'));
    });

    middleware.use(function(one, two, three, next){
      throw new Error('throw failed to break chain!');
    });

    return middleware.execute(first, second, third).then(function(args){
      throw new Error('did not receive expected error from chain');
    }).catch( function(err){
      err.should.be.an.instanceOf(Error);
      err.message.should.equal('something really bad happened');
    });

  });

  it('supports no-error-out chains', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};

    var middleware = new Middleware();
    middleware.ignoreErrors(true);
    middleware.use(function(one, two, three, next){
      two.val.should.equal('bbb');
      two.val='eee';
      next();
    });

    middleware.use(function(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'eee';
      throw new Error('something really bad happened');
    });

    middleware.use(function(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'fini';
      next();
    });

    return middleware.execute(first, second, third).then(function(errors){
      if(!errors){
        throw new Error('Execute failed to return error array')
      }

      errors.length.should.equal(1);
      errors[0].message.should.equal('something really bad happened');

      second.val.should.equal('fini');
    });

  });

  it('supports no-cancel-via-next() chains', function(){
    var first = {name:'a', val:'aaa'};  var second = {name:'b', val:'bbb'};  var third = {name:'c', val:'ccc'};

    var middleware = new Middleware();
    middleware.ignoreErrors(true);
    middleware.use(function(one, two, three, next){
      two.val.should.equal('bbb');
      two.val='eee';
      next();
    });

    middleware.use(function(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'eee';
      next(new Error('something really bad happened'));
    });

    middleware.use(function(one, two, three, next){
      two.val.should.equal('eee');
      two.val = 'fini';
      next();
    });

    return middleware.execute(first, second, third).then(function(errors){
      if(!errors){
        throw new Error('Execute failed to return error array')
      }

      errors.length.should.equal(1);
      errors[0].message.should.equal('something really bad happened');

      second.val.should.equal('fini');
    });

  });

  describe('for logging', function(){

    var objectToLog = {an:'object', withAn:{object:'in it'}};
    function functionToLog(_in){
      return ' out ' + _in;
    }

    it('logs with middleware logger', function(){
      var realLog = getTestLogger();

      var mwLog = new MiddlewareLogger();
      mwLog.useLogger(realLog);
      //mwLog.useLogger(console);

      return mwLog.debug('debug', 'one', objectToLog, 'two')
        .then(function(){
          return mwLog.error('error')
        }).then(function(){
          return mwLog.warn('warn');
        }).then(function(){
          return mwLog.debug('debug2');
        }).then(function(){
          return mwLog.info('info');
        }).then(function(){
          return mwLog.debug('debug3', 3);
        }).then(function(){
          return mwLog.debug('debug4', functionToLog, 'test', 4);
        }).then(function(){
          return mwLog.log('log');
        }).then(function(){
          realLog.debug.args[0].should.eql(['debug', 'one', objectToLog, 'two']);
          realLog.debug.args[1].should.eql(['debug2']);
          realLog.debug.args[2].should.eql(['debug3', 3]);
          realLog.debug.args[3].should.eql(['debug4', functionToLog, 'test', 4]);
          realLog.error.args[0].should.eql(['error']);
          realLog.warn.args[0].should.eql(['warn']);
          realLog.info.args[0].should.eql(['info']);
          realLog.log.args[0].should.eql(['log']);
        });
    });

    it('respects requested level', function(){
      var realLog = getTestLogger();

      var mwLog = new MiddlewareLogger();
      mwLog.useLogger(realLog, 'warn');
      //mwLog.useLogger(console, 'log');

      return mwLog.debug('debug', 'one', objectToLog, 'two')
        .then(function(){
          return mwLog.error('error')
        }).then(function(){
          return mwLog.warn('warn');
        }).then(function(){
          return mwLog.debug('debug2');
        }).then(function(){
          return mwLog.info('info');
        }).then(function(){
          return mwLog.debug('debug3', 3);
        }).then(function(){
          return mwLog.debug('debug4', functionToLog, 'test', 4);
        }).then(function(){
          return mwLog.log('log');
        }).then(function(){
          realLog.debug.args.length.should.equal(0);
          realLog.error.args[0].should.eql(['error']);
          realLog.warn.args[0].should.eql(['warn']);
          realLog.info.args.length.should.equal(0);
          realLog.log.args.length.should.equal(0);
        });
    });

    it('middleware logger maps debug to log if missing', function(){
      var realLog = getTestLogger();

      delete realLog.debug;
      var mwLog = new MiddlewareLogger();
      mwLog.useLogger(realLog);
      return mwLog.debug('aaa')
        .then(function(){
          realLog.log.args[0].should.eql(['aaa']);
        });
    });

    it('middleware logger maps log to debug if missing', function(){
      var realLog = getTestLogger();

      delete realLog.log;
      var mwLog = new MiddlewareLogger();
      mwLog.useLogger(realLog);
      return mwLog.log('aaa')
        .then(function(){
        realLog.debug.args[0].should.eql(['aaa']);
        });
    });

    it('useLogger fails gracefully if neither debug or log exist', function(){
      var realLog = getTestLogger();
      delete realLog.debug;
      delete realLog.log;
      var mwLog = new MiddlewareLogger();
      mwLog.useLogger(realLog);
      return mwLog.log('aaa')
        .then(function(){
          realLog.warn.args[0].should.eql(['MiddlewareLogger: \'debug\' not supported by logger, disabled']);
          realLog.warn.args[1].should.eql(['MiddlewareLogger: \'log\' not supported by logger, disabled']);
        });
    });



    //util

    function getTestLogger(){
      var logger = {entries:{}};
      ['debug', 'log', 'info', 'warn', 'error'].forEach(function(logLevel){
        this.entries[logLevel] = [];
        this[logLevel]=sinon.spy(function(msg){
          this.entries[logLevel].push({arguments: Array.prototype.slice.call(arguments)})
        });
      }, logger);
      return logger;
    }

  });

});



