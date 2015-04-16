var Promise = require('bluebird');
var chai = require('chai');
var should = chai.should();
chai.use(require('chai-things'));
chai.use(require('chai-datetime'));
var sinon = require('sinon');
var _ = require('lodash');

var Notifier = require('../lib/notifications').Notifier;
var Device = require('apn').Device;
var events = require('events');
var util = require('util');

Promise.longStackTraces();

describe('Notification Tests', function(){

  var notifier;
  var datastore;
  var sandbox;
  var apn;

  var deviceNs = 'lowlasync.NotifyApnDevices$'

  function setup(){
    //called at more local levels below to allow tests that need spies to wire them first
    datastore = createMockDatastore();
    apn = createMockApn();
    notifier = new Notifier({datastore:datastore, apnConnection:apn, apnFeedback:apn});
  }

  beforeEach(function(){
    sandbox = sinon.sandbox.create();
  });
  afterEach(function(){
    sandbox.restore();
  });

  describe('device registration', function(){

    beforeEach(function(){setup();});

    it('registers', function(){
      var start = (new Date()).getTime() - 1
      var ret = 'nada';
      var stub = sandbox.stub(datastore, 'updateDocumentByOperations');
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.reject({isDeleted:true}) );
      stub.returns( Promise.resolve(ret));
      return notifier.registerDevice('12345678').then(function(result){
        result.should.eql(ret);
        var args = stub.firstCall.args;
        stub.firstCall.args[0].should.equal(deviceNs + '12345678');
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.true;
        upd.$set.created.should.be.above(start);
        upd.$set.modified.should.be.above(start);
        upd.$inc.registered.should.equal(1);
      });
    });

    it('registers - request/response', function(){
      var req = {body:{apntoken:'12345678'}};
      var res = {
        done:false,
        body:false,
        set: function(){return this;},
        status: function(){return this;},
        send:function(value){this.body=value; this.done=true;}
      };
      res.set = sandbox.spy(res, 'set');
      res.status = sandbox.spy(res, 'status');
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.reject({isDeleted:true}) );
      stubUpdate.returns( Promise.resolve({}));
      notifier.register(req, res)
      return waitFor(function(){return res.done;}).then(function(result){
        stubUpdate.firstCall.args[0].should.equal(deviceNs + '12345678');
        res.body.should.eql({status:'ok'})
      });
    });

    it('re-registers preserving creation time', function(){
      var start = (new Date()).getTime() - 1;
      var ret = 'nada';
      var stub = sandbox.stub(datastore, 'updateDocumentByOperations');
      stub.returns( Promise.resolve(ret));
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.onCall(0).returns( Promise.reject({isDeleted:true}) );
      stubGetDoc.onCall(1).returns( Promise.resolve({_id:'12345678', enabled:'true'}) );
      return notifier.registerDevice('12345678').then(function(result){
        result.should.eql(ret);
        var args = stub.firstCall.args;
        stub.firstCall.args[0].should.equal(deviceNs + '12345678');
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.true;
        upd.$set.modified.should.be.above(start);
        upd.$set.created.should.be.above(start);
        upd.$inc.registered.should.equal(1);
        var created = upd.$set.created;
        return new Promise(function(resolve, reject){
          setTimeout(function(){resolve(true);}, 1)
        }).then(function(){
            return notifier.registerDevice('12345678').then(function(result){
              result.should.eql(ret);
              var args = stub.secondCall.args;
              args[0].should.equal(deviceNs + '12345678');
              var upd = args[2];
              upd.$set.status.should.equal('ok');
              upd.$set.enabled.should.be.true;
              upd.$set.modified.should.be.above(created);
              should.not.exist(upd.$set.created)
              upd.$inc.registered.should.equal(1);
            });
          });
      });
    });


    it('re-registers providing expired apn token', function(){
      var start = (new Date()).getTime() - 1;
      var ret = 'nada';
      var newToken = '12345678';
      var oldToken = '99887766';
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.withArgs(deviceNs + newToken).returns( Promise.reject({isDeleted:true}) );
      stubUpdate.withArgs(deviceNs + newToken).returns(Promise.resolve(ret));
      stubGetDoc.withArgs(deviceNs + oldToken).returns( Promise.resolve({_id:oldToken, enabled:'true'}) );
      stubUpdate.withArgs(deviceNs + oldToken).returns(Promise.resolve(ret));
      return notifier.registerDevice(newToken, oldToken).then(function(result){
        result.should.eql(ret);
        stubGetDoc.firstCall.args[0].should.equal(deviceNs + newToken);
        stubGetDoc.secondCall.args[0].should.equal(deviceNs + oldToken);
        //first call to update disables old device document
        stubUpdate.firstCall.args[0].should.equal(deviceNs + oldToken);
        var args = stubUpdate.firstCall.args;
        args[0].should.equal(deviceNs + oldToken);
        args[2].$set.enabled.should.equal(false);
        args[2].$set.expired.should.equal(true);
        args[2].$set.replacedByToken.should.equal(newToken);
        //second call creates new device.
        stubUpdate.secondCall.args[0].should.equal(deviceNs + newToken);
        args = stubUpdate.secondCall.args;
        args[0].should.equal(deviceNs + newToken);
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.true;
        upd.$set.created.should.be.above(start);
        upd.$set.modified.should.be.above(start);
        upd.$inc.registered.should.equal(1);
      });
    });

    it('registers adding fields to device record.', function(){
      var start = (new Date()).getTime() - 1
      var ret = 'nada';
      var stub = sandbox.stub(datastore, 'updateDocumentByOperations');
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.reject({isDeleted:true}) );
      stub.returns( Promise.resolve(ret));

      notifier.onRegisterUse(function(token, update, oldDoc, next){
        should.not.exist(oldDoc);
        update.$set.setByMiddleware = 'test';
        next();
      });
      notifier.onRegisterUse(function(token, update, oldDoc, next){
        update.$set.setByMiddleware.should.equal('test');
        update.$set.setByMiddleware = 'pass';
        next();
      });
      return notifier.registerDevice('12345678').then(function(result){
        result.should.eql(ret);
        var args = stub.firstCall.args;
        stub.firstCall.args[0].should.equal(deviceNs + '12345678');
        args[2].$set.setByMiddleware.should.equal('pass');
      });
    });

    it('de-registers adding fields to device record.', function(){
      var start = (new Date()).getTime() - 1
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.resolve({_id:'12345678', enabled:'true', username:'bob'}) );
      stubUpdate.returns( Promise.resolve({_id:'12345678', enabled:'false', username:'bob'}));

      notifier.onDeregisterUse(function(token, update, next){
        update.$set.setByMiddleware = 'test';
        next();
      });
      notifier.onDeregisterUse(function(token, update, next){
        update.$set.setByMiddleware.should.equal('test');
        update.$set.setByMiddleware = 'pass';
        next();
      });
      return notifier.deregisterDevice('12345678').then(function(result){
        result.should.eql({_id:'12345678', enabled:'false', username:'bob'});
        var args = stubUpdate.firstCall.args;
        stubUpdate.firstCall.args[0].should.equal(deviceNs + '12345678');
        args[2].$set.setByMiddleware.should.equal('pass');
      });
    });

    it('re-registers providing expired apn token and adding to new device doc', function(){
      var start = (new Date()).getTime() - 1;
      var newToken = '12345678';
      var oldToken = '99887766';
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.withArgs(deviceNs + newToken).returns( Promise.reject({isDeleted:true}) );
      stubUpdate.withArgs(deviceNs + newToken).returns(Promise.resolve({}));
      stubGetDoc.withArgs(deviceNs + oldToken).returns( Promise.resolve({_id:oldToken, enabled:'true', username:'bob'}) );
      stubUpdate.withArgs(deviceNs + oldToken).returns(Promise.resolve(Promise.resolve({_id:oldToken, enabled:'true', username:'bob'})));

      notifier.onRegisterUse(function(token, update, oldDoc, next){
        should.exist(oldDoc);
        update.$set.username = oldDoc.username;
        update.$set.olddevice = oldDoc._id;
        next();
      });

      return notifier.registerDevice(newToken, oldToken).then(function(result){
        stubGetDoc.firstCall.args[0].should.equal(deviceNs + newToken);
        stubGetDoc.secondCall.args[0].should.equal(deviceNs + oldToken);
        //first call to update disables old device document
        stubUpdate.firstCall.args[0].should.equal(deviceNs + oldToken);
        var args = stubUpdate.firstCall.args;
        args[0].should.equal(deviceNs + oldToken);
        args[2].$set.enabled.should.equal(false);
        args[2].$set.expired.should.equal(true);
        args[2].$set.replacedByToken.should.equal(newToken);
        //second call creates new device.
        stubUpdate.secondCall.args[0].should.equal(deviceNs + newToken);
        args = stubUpdate.secondCall.args;
        args[0].should.equal(deviceNs + newToken);
        var upd = args[2];
        upd.$set.olddevice.should.equal(oldToken);
        upd.$set.username.should.equal('bob')

      });
    });

    it('handles error during update of expired apn token', function(){
      var start = (new Date()).getTime() - 1;
      var ret = 'nada';
      var newToken = '12345678';
      var oldToken = '99887766';
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.withArgs(deviceNs + newToken).returns( Promise.reject({isDeleted:true}) );
      stubUpdate.withArgs(deviceNs + newToken).returns(Promise.resolve(ret));
      stubGetDoc.withArgs(deviceNs + oldToken).returns( Promise.resolve({_id:oldToken, enabled:'true'}) );
      stubUpdate.withArgs(deviceNs + oldToken).throws(new Error('Fail!'));
      return notifier.registerDevice(newToken, oldToken).then(function(result){
        result.should.eql(ret);
        stubGetDoc.firstCall.args[0].should.equal(deviceNs + newToken);
        stubGetDoc.secondCall.args[0].should.equal(deviceNs + oldToken);
        //first call to update disables old device document
        stubUpdate.firstCall.args[0].should.equal(deviceNs + oldToken);
        //second call creates new device.
        stubUpdate.secondCall.args[0].should.equal(deviceNs + newToken);
        args = stubUpdate.secondCall.args;
        args[0].should.equal(deviceNs + newToken);
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.true;
        upd.$set.created.should.be.above(start);
        upd.$set.modified.should.be.above(start);
        upd.$inc.registered.should.equal(1);
      });
    });

    it('handles rejection during update of expired apn token', function(){
      var start = (new Date()).getTime() - 1;
      var ret = 'nada';
      var newToken = '12345678';
      var oldToken = '99887766';
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.withArgs(deviceNs + newToken).returns( Promise.reject({isDeleted:true}) );
      stubUpdate.withArgs(deviceNs + newToken).returns(Promise.resolve(ret));
      stubGetDoc.withArgs(deviceNs + oldToken).returns( Promise.resolve({_id:oldToken, enabled:'true'}) );
      stubUpdate.withArgs(deviceNs + oldToken).returns(Promise.reject(new Error('Fail!')));
      return notifier.registerDevice(newToken, oldToken).then(function(result){
        result.should.eql(ret);
        stubGetDoc.firstCall.args[0].should.equal(deviceNs + newToken);
        stubGetDoc.secondCall.args[0].should.equal(deviceNs + oldToken);
        //first call to update disables old device document
        stubUpdate.firstCall.args[0].should.equal(deviceNs + oldToken);
        //second call creates new device.
        stubUpdate.secondCall.args[0].should.equal(deviceNs + newToken);
        args = stubUpdate.secondCall.args;
        args[0].should.equal(deviceNs + newToken);
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.true;
        upd.$set.created.should.be.above(start);
        upd.$set.modified.should.be.above(start);
        upd.$inc.registered.should.equal(1);
      });
    });


    it('de-registers', function(){
      var ret = 'nada';
      var stub = sandbox.stub(datastore, 'updateDocumentByOperations');
      stub.returns( Promise.resolve(ret));
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.resolve({}) );
      return notifier.deregisterDevice('12345678').then(function(result){
        result.should.eql(ret);
        var args = stub.firstCall.args;
        stub.firstCall.args[0].should.equal(deviceNs + '12345678');
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.false;
        upd.$inc.registered.should.equal(1);
      });
    });

    it('de-registers a non-existent device', function(){
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      stubUpdate.returns( Promise.resolve({}));
      stubGetDoc.returns( Promise.reject({isDeleted:true}) );
      return notifier.deregisterDevice('12345678').then(function(result){
        stubUpdate.called.should.equal(false);
        stubGetDoc.firstCall.args[0].should.equal(deviceNs + '12345678');
      });
    });

    it('deregisters - request/response', function(){
      var req = {body:{apntoken:'12345678'}};
      var res = {
        done:false,
        body:false,
        set: function(){return this;},
        status: function(){return this;},
        send:function(value){this.body=value; this.done=true;}
      };
      res.set = sandbox.spy(res, 'set');
      res.status = sandbox.spy(res, 'status');
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.resolve({}) );
      stubUpdate.returns( Promise.resolve({}));
      notifier.deregister(req, res);
      return waitFor(function(){return res.done;}).then(function(result){
        stubUpdate.firstCall.args[0].should.equal(deviceNs + '12345678');
        res.body.should.eql({status:'ok'})
      });
    });

    it('deregisters nonexistent - request/response', function(){
      var req = {body:{apntoken:'12345678'}};
      var res = {
        done:false,
        body:false,
        set: function(){return this;},
        status: function(){return this;},
        send:function(value){this.body=value, this.done=true;}
      };
      res.set = sandbox.spy(res, 'set');
      res.status = sandbox.spy(res, 'status');
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.reject({isDeleted:true}) );
      stubUpdate.returns( Promise.resolve({}));
      notifier.deregister(req, res);
      return waitFor(function(){return res.done;}).then(function(result){
        stubUpdate.called.should.equal(false);
        stubGetDoc.firstCall.args[0].should.equal(deviceNs + '12345678');
      });
    });

  });  //device registration


  describe('notification', function(){

    beforeEach(function(){setup();});

    it('notifies', function(){
      var stub_findAll = sandbox.stub(datastore, 'findAll', function(collection, query){
        return Promise.resolve([{_id:'12345678', status:'ok', enabled:true}, {_id:'87654321', status:'ok', enabled:true}]);
      });
      var stub_pushNotification = sandbox.stub(apn, 'pushNotification', function(notification, device){
        //console.log('pushNotification:  ', device, notification);
      });
      return notifier.notify().then(function(result){
        var args = stub_pushNotification.firstCall.args;
        args[1].toString().should.equal('12345678');
        args[0].payload.should.eql({LowlaDB:{}});
        args[0].contentAvailable.should.equal('1');
        args[0].priority.should.equal(5);  //required on silent/content-available
        args[0].expiry.should.be.above(toUnixEpochSeconds(Date.now()));
        args = stub_pushNotification.secondCall.args;
        args[1].toString().should.equal('87654321');
        args[0].payload.should.eql({LowlaDB:{}});
        args[0].contentAvailable.should.equal('1');
        args[0].priority.should.equal(5);  //required on silent/content-available
        args[0].expiry.should.be.above(toUnixEpochSeconds(Date.now()));
        return result;
      })
    })

  });  //notification


  describe('feedback', function(){
    /*
     Feedback:  { time: 1423407355,
     device: { token: <Buffer 88 53 c7 0b d1 73 4a 4c d2 1d ce 3b 1c 71 94 0c b3 3e 6a c6 aa 65 08 93 aa fc 75 54 1b 58 46 8f> } }
     */
    beforeEach(function() {
      //init spies prior to setup where objects are created
      sandbox.spy(Notifier.prototype, '_onFeedback');
      sandbox.spy(Notifier.prototype, '_onFeedbackError');
      sandbox.spy(Notifier.prototype, '_onFeedbackConnectionError');
      setup();
    });

    it('mock feedback event fires', function(){
      var feedbackResult = [{time:123, device:new Device('4567')}];
      return apn.fireEvent('feedback', 1, [feedbackResult]).then(function(){
        notifier._onFeedback.firstCall.args[0].should.eql(feedbackResult);
      });
    });

    it('mock feedback error event fires', function(){
      var feedbackErr = new Error('something went wrong');
      return apn.fireEvent('feedbackError', 1, feedbackErr).then(function(){
        notifier._onFeedbackError.firstCall.args[0].should.eql(feedbackErr);
      });
    });

    it('mock feedback connection error event fires', function(){
      var feedbackErr = new Error('something went wrong');
      return apn.fireEvent('error', 1, feedbackErr).then(function(){
        notifier._onFeedbackConnectionError.firstCall.args[0].should.eql(feedbackErr);
      });
    });

    it('feedback deregisters device', function(){
      var ret = 'nada!';
      var tsLastReg = new Date(1427031118651);
      var tsFeedback = toUnixEpochSeconds(tsLastReg.getTime()) + 1;
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      stubUpdate.returns( Promise.resolve(ret));
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.resolve({_id:'12345678', status:'ok', enabled:'true', modified:tsLastReg.getTime(), registered:9}) );
      var feedbackResult = [{time:tsFeedback, device:new Device('12345678')}];
      return apn.fireEvent('feedback', 1, [feedbackResult]).then(function(){
        notifier._onFeedback.firstCall.args[0].should.eql(feedbackResult);
        return waitFor(function(){return stubUpdate.calledOnce;}, 100, 5000).then(function(){
          var args = stubUpdate.firstCall.args;
          args[0].should.equal(deviceNs + '12345678');
          var upd = args[2];
          //console.log('reg: ' + tsLastReg.getTime());
          //console.log('fbk: ' + tsFeedback);
          upd.$set.status.should.equal('ok');
          upd.$set.enabled.should.be.false;
          upd.$set.lastfeedback.should.equal(tsFeedback * 1000);
          upd.$inc.registered.should.equal(1);
          upd.$inc.feedbacked.should.equal(1);
        })
      });
    });

    it('feedback doesn\'t deregister if registered since', function(){
      var ret = 'nada';
      var tsLastReg = new Date(1427031118651);
      var tsFeedback = toUnixEpochSeconds(tsLastReg.getTime()) - 1;
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      stubUpdate.returns( Promise.resolve(ret));
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.resolve({_id:'12345678', status:'ok', enabled:'true', modified:tsLastReg, registered:9, feedback:2}) )
      var feedbackResult = [{time:tsFeedback, device:new Device('12345678')}];
      return apn.fireEvent('feedback', 1, [feedbackResult]).then(function(){
        notifier._onFeedback.firstCall.args[0].should.eql(feedbackResult);
        return waitFor(function(){return stubUpdate.calledOnce;}, 100, 5000).then(function() {
          var args = stubUpdate.firstCall.args;
          stubUpdate.firstCall.args[0].should.equal(deviceNs + '12345678');
          var upd = args[2];
          upd.$set.status.should.equal('ok');
          upd.$set.enabled.should.be.true;
          upd.$set.lastfeedback.should.equal(tsFeedback * 1000);
          upd.$inc.registered.should.equal(1);
          upd.$inc.feedbacked.should.equal(1);
        });
      });
    });

    it('feedback doesn\'t deregister if registered same time', function(){
      var ret = 'nada';
      var ts = new Date(1427030958618000); //must end 000 since feedback deals in seconds
      var stubUpdate = sandbox.stub(datastore, 'updateDocumentByOperations');
      stubUpdate.returns( Promise.resolve(ret));
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.resolve({_id:'12345678', status:'ok', enabled:'true', modified:ts, registered:9, feedback:2}) )
      var feedbackResult = [{time:toUnixEpochSeconds(ts.getTime()), device:new Device('12345678')}];
      return apn.fireEvent('feedback', 1, [feedbackResult]).then(function(){
        notifier._onFeedback.firstCall.args[0].should.eql(feedbackResult);
        return waitFor(function(){return stubUpdate.calledOnce;}, 100, 5000).then(function() {
          var args = stubUpdate.firstCall.args;
          stubUpdate.firstCall.args[0].should.equal(deviceNs + '12345678');
          var upd = args[2];
          upd.$set.status.should.equal('ok');
          upd.$set.enabled.should.be.true;
          upd.$set.lastfeedback.should.equal(ts.getTime());
          upd.$inc.registered.should.equal(1);
          upd.$inc.feedbacked.should.equal(1);
        });
      });
    });

  });  //feedback

//utility

  function waitFor(testFunction,  msInterval, msTimeout, maxTimes){
    msInterval = msInterval || 300;
    if(testFunction()){
      return Promise.resolve(true);
    }else{
      if(undefined !== msTimeout && 0!== msTimeout){
        return _getDelayedPromise(0).timeout(msTimeout);
      }else{
        return _getDelayedPromise(0);
      }
    }
    function _getDelayedPromise(cnt){
      ++cnt;
      if(undefined!==maxTimes && maxTimes < cnt){
        throw new Error('waitFor exceeded maxLoops: ' + maxTimes);
      }
      return Promise.delay(msInterval).then(function(){
        if(testFunction()){
          return true;
        }else {
          return _getDelayedPromise(cnt);
        }
      });
    }
  }

  function toUnixEpochSeconds(ms){
    return Math.floor(ms/1000);
  }

  function createMockDatastore() {
    return {
      decodeSpecialTypes: function(obj) { return obj; },
      encodeSpecialTypes: function(obj) { return obj; },
      namespaceFromId: function(id) { return id.substring(0, id.indexOf('$')); },
      idFromComponents: function(ns, id) { return ns + '$' + id; },
      getAllDocuments: function() { return Promise.reject(new Error('getAllDocuments() not implemented')); },
      getDocument: function() {return Promise.reject(new Error('getDocument() not implemented'));},
      removeDocument: function() { return Promise.reject(new Error('removeDocument() not implemented')); },
      updateDocumentByOperations: function() { return Promise.reject(new Error('updateDocumentByOperations() not implemented')); },
      findAll: function(){return Promise.reject(new Error('findAll() not implemented'));}
    };
  }

  function createMockApn(){
    function _apn(){
      events.EventEmitter.call(this);
    }
    util.inherits(_apn, events.EventEmitter);
    _apn.prototype.pushNotification = function(notification, deviceId){
      throw new Error('pushNotification not implemented');
    };
    _apn.prototype.fireEvent= function(name, msDelay, argArray){
      var thisapn = this;
      return new Promise(function(resolve, reject){
        var _args = [name].concat(argArray); //unshift evt name into first arg
        setTimeout(function() {
          thisapn.emit.apply(thisapn, _args)
          resolve(true);
        }, msDelay);
      });
    };
    return new _apn();  // @ end - after inherits;
  }

  var createOutputStream = function(){
    var out = '';
    var Writable = require('stream').Writable;
    var outStream = Writable();
    outStream._write = function (chunk, enc, next) {
      out += chunk;
      next();
    };
    outStream.getOutput = function(){return(JSON.parse(out)); };
    outStream.getOutputAsText = function(){return out; };
    return outStream;
  };

  var createMockResponse = function(){
    var mockResponse = createOutputStream();
    mockResponse.headers = {};
    mockResponse.getBody = mockResponse.getOutput;
    mockResponse.getBodyAsText = mockResponse.getOutputAsText;
    mockResponse.setHeader = function(header, value){this.headers[header] = value;};
    return mockResponse;
  };

  var createMockRequest = function(headers, body){
    return {
      headers:headers,
      body:body,
      get:function(name){
        return headers[name];
      }
    }
  }

});
