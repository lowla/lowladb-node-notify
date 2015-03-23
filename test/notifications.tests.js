var Promise = require('bluebird')
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

  function setup(){
    //called at more local levels below to allow tests that need spies to wire them first
    datastore = createMockDatastore();
    apn = createMockApn();
    notifier = new Notifier({datastore:datastore, apnConnection:apn, apnFeedback:apn}); //, log:console});
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
      var ret = "nada";
      var stub = sandbox.stub(datastore, "updateDocumentByOperations");
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.reject({isDeleted:true}) );
      stub.returns( Promise.resolve(ret));
      return notifier.registerDevice('12345678').then(function(result){
        result.should.eql(ret);
        var args = stub.firstCall.args;
        console.log(args)
        stub.firstCall.args[0].should.equal('lowlasync.NotifyApnDevices$12345678');
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.true;
        upd.$set.created.should.be.above(start);
        upd.$set.modified.should.be.above(start);
        upd.$inc.registered.should.equal(1);
      });
    });

    it('re-registers preserving creation time', function(){
      var start = (new Date()).getTime() - 1
      var ret = "nada";
      var stub = sandbox.stub(datastore, "updateDocumentByOperations");
      stub.returns( Promise.resolve(ret));
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.onCall(0).returns( Promise.reject({isDeleted:true}) );
      stubGetDoc.onCall(1).returns( Promise.resolve({_id:'12345678', enabled:'true'}) );
      return notifier.registerDevice('12345678').then(function(result){
        result.should.eql(ret);
        var args = stub.firstCall.args;
        console.log(args)
        stub.firstCall.args[0].should.equal('lowlasync.NotifyApnDevices$12345678');
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.true;
        upd.$set.modified.should.be.above(start);
        upd.$set.created.should.be.above(start);
        upd.$inc.registered.should.equal(1);

        var created = upd.$set.created;
        console.log(created);

        return new Promise(function(resolve, reject){
          setTimeout(function(){resolve(true);}, 1)
        }).then(function(){
            return notifier.registerDevice('12345678').then(function(result){
              result.should.eql(ret);
              var args = stub.secondCall.args;
              console.log(args)
              args[0].should.equal('lowlasync.NotifyApnDevices$12345678');
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


    it.skip('re-registers providing expired apn token', function(){
      var start = (new Date()).getTime() - 1
      var ret = "nada";
      var stubUpdate = sandbox.stub(datastore, "updateDocumentByOperations");
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.resolve({_id:'99887766', enabled:'true'}) );
      stubUpdate.returns( Promise.resolve(ret));
      return notifier.registerDevice('12345678', '99887766').then(function(result){
        result.should.eql(ret);
        var args = stubUpdate.firstCall.args;
        console.log(args)
        stubUpdate.firstCall.args[0].should.equal('lowlasync.NotifyApnDevices$12345678');
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.true;
        upd.$set.created.should.be.above(start);
        upd.$set.modified.should.be.above(start);
        upd.$inc.registered.should.equal(1);
      });
    });


    it('de-registers', function(){
      var ret = "nada";
      var stub = sandbox.stub(datastore, "updateDocumentByOperations");
      stub.returns( Promise.resolve(ret));
      return notifier.deregisterDevice('12345678').then(function(result){
        result.should.eql(ret);
        var args = stub.firstCall.args;
        console.log(args)
        stub.firstCall.args[0].should.equal('lowlasync.NotifyApnDevices$12345678');
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.false;
        upd.$inc.registered.should.equal(1);
      });
    });

    //todo call through res, resp, next function and verify results.


  });  //device registration


  describe('notification', function(){

    beforeEach(function(){setup();});

    it('notifies', function(){
      var stub_findAll = sandbox.stub(datastore, "findAll", function(collection, query){
        return Promise.resolve([{_id:'12345678', status:'ok', enabled:true}, {_id:'87654321', status:'ok', enabled:true}]);
      });
      var stub_pushNotification = sandbox.stub(apn, "pushNotification", function(notification, device){
        console.log(device, notification);
      });
      //todo validate args etc.

      return notifier.notify().then(function(result){
        console.log(result);
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
      sandbox.spy(Notifier.prototype, "_onFeedback");
      sandbox.spy(Notifier.prototype, "_onFeedbackError");
      sandbox.spy(Notifier.prototype, "_onFeedbackConnectionError");
      setup();
    });

    it('mock feedback event fires', function(){
      var feedbackResult = [{time:123, device:new Device('4567')}];
      return apn.fireEvent("feedback", 1, [feedbackResult]).then(function(){
          console.log(notifier._onFeedback.firstCall.args)
          notifier._onFeedback.firstCall.args[0].should.eql(feedbackResult);
        });
    });

    it('mock feedback error event fires', function(){
      var feedbackErr = new Error("something went wrong")
      return apn.fireEvent("feedbackError", 1, feedbackErr).then(function(){
        console.log(notifier._onFeedbackError.firstCall.args)
        notifier._onFeedbackError.firstCall.args[0].should.eql(feedbackErr);
      });
    });

    it('mock feedback connection error event fires', function(){
      var feedbackErr = new Error("something went wrong")
      return apn.fireEvent("error", 1, feedbackErr).then(function(){
        console.log(notifier._onFeedbackConnectionError.firstCall.args)
        notifier._onFeedbackConnectionError.firstCall.args[0].should.eql(feedbackErr);
      });
    });

    it('feedback deregisters device', function(){
      var ret = "nada";
      var tsLastReg = new Date(1427031118651);
      var tsFeedback = toUnixEpochSeconds(tsLastReg.getTime()) + 1;
      var stubUpdate = sandbox.stub(datastore, "updateDocumentByOperations");
      stubUpdate.returns( Promise.resolve(ret));
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.resolve({_id:'12345678', status:'ok', enabled:'true', modified:tsLastReg.getTime(), registered:9}) );
      var feedbackResult = [{time:tsFeedback, device:new Device('12345678')}];
      return apn.fireEvent("feedback", 1, [feedbackResult]).then(function(){
        console.log(notifier._onFeedback.firstCall.args)
        notifier._onFeedback.firstCall.args[0].should.eql(feedbackResult);

        var args = stubUpdate.firstCall.args;
        console.log(args)
        stubUpdate.firstCall.args[0].should.equal('lowlasync.NotifyApnDevices$12345678');
        var upd = args[2];

        console.log('reg: ' + tsLastReg.getTime());
        console.log('fbk: ' + tsFeedback);

        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.false;
        upd.$set.lastfeedback.should.equal(tsFeedback * 1000);
        upd.$inc.registered.should.equal(1);
        upd.$inc.feedbacked.should.equal(1);
      });
    });

    it('feedback doesn\'t deregister if registered since', function(){
      var ret = "nada";
      var tsLastReg = new Date(1427031118651);
      var tsFeedback = toUnixEpochSeconds(tsLastReg.getTime()) - 1;
      var stubUpdate = sandbox.stub(datastore, "updateDocumentByOperations");
      stubUpdate.returns( Promise.resolve(ret));
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.resolve({_id:'12345678', status:'ok', enabled:'true', modified:tsLastReg, registered:9, feedback:2}) )
      var feedbackResult = [{time:tsFeedback, device:new Device('12345678')}];
      return apn.fireEvent("feedback", 1, [feedbackResult]).then(function(){
        console.log(notifier._onFeedback.firstCall.args)
        notifier._onFeedback.firstCall.args[0].should.eql(feedbackResult);

        var args = stubUpdate.firstCall.args;
        console.log(args)
        stubUpdate.firstCall.args[0].should.equal('lowlasync.NotifyApnDevices$12345678');
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.true;
        upd.$set.lastfeedback.should.equal(tsFeedback * 1000);
        upd.$inc.registered.should.equal(1);
        upd.$inc.feedbacked.should.equal(1);
      });
    });

    it('feedback doesn\'t deregister if registered same time', function(){
      var ret = "nada";
      var ts = new Date(1427030958618000); //must end 000 since feedback deals in seconds
      var stubUpdate = sandbox.stub(datastore, "updateDocumentByOperations");
      stubUpdate.returns( Promise.resolve(ret));
      var stubGetDoc = sandbox.stub(datastore, 'getDocument');
      stubGetDoc.returns( Promise.resolve({_id:'12345678', status:'ok', enabled:'true', modified:ts, registered:9, feedback:2}) )
      var feedbackResult = [{time:toUnixEpochSeconds(ts.getTime()), device:new Device('12345678')}];
      return apn.fireEvent("feedback", 1, [feedbackResult]).then(function(){
        console.log(notifier._onFeedback.firstCall.args)
        notifier._onFeedback.firstCall.args[0].should.eql(feedbackResult);

        //result.should.eql(ret);
        //todo call count
        var args = stubUpdate.firstCall.args;
        console.log(args)
        stubUpdate.firstCall.args[0].should.equal('lowlasync.NotifyApnDevices$12345678');
        var upd = args[2];
        upd.$set.status.should.equal('ok');
        upd.$set.enabled.should.be.true;
        upd.$set.lastfeedback.should.equal(ts.getTime());
        upd.$inc.registered.should.equal(1);
        upd.$inc.feedbacked.should.equal(1);
      });
    });

  });  //feedback

//utility

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
      throw new Error("pushNotification not implemented");
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
