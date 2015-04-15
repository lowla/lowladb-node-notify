(function(module) {

  // Public APIs
  exports.Notifier = Notifier;
  Notifier.prototype.notify = notify;
  Notifier.prototype.register = register;
  Notifier.prototype.deregister = deregister;
  Notifier.prototype.registerDevice = registerDevice;
  Notifier.prototype.deregisterDevice = deregisterDevice;
  Notifier.prototype.configureRoutes = configureRoutes;
  Notifier.prototype.createNotifier = createNotifier;
  Notifier.prototype.onRegisterUse = onRegisterUse;

  // Internal APIs
  Notifier.prototype._updateDevice = _updateDevice;
  Notifier.prototype._configureFeedback = _configureFeedback;
  Notifier.prototype._configureApnEventListners = _configureApnEventListners;
  Notifier.prototype._onFeedback=_onFeedback;
  Notifier.prototype._onFeedbackError=_onFeedbackError;
  Notifier.prototype._onFeedbackConnectionError = _onFeedbackConnectionError;
  Notifier.prototype._notify = _notify;
  Notifier.prototype._getDocument = _getDocument;

  /////////////////

  var apn = require('apn');
  var Middleware = require('./middleware').Middleware;
  var Promise = require('bluebird');
  var util = require('util');

  Promise.longStackTraces();

  function Notifier(options){
    var notifier = this;
    notifier._registerMiddleware = new Middleware();
    notifier._options = options;

    logSetup(notifier._options.log || console);

    if(!options.datastore){
      throw new Error('Notifier: Datastore is required.');
    }

    notifier._apnConn = notifier._options.apnConnection || new apn.Connection(notifier._options.apn);
    notifier._configureApnEventListners();
    notifier._options.devicesPrefix = 'lowlasync.NotifyApnDevices';

    if(notifier._options.apnFeedback) {
      notifier._feedback = notifier._options.apnFeedback;
    }else{
      var options = {
        production: false,
        batchFeedback: true,
        interval: 3000,
        key: notifier._options.apn.key,
        cert: notifier._options.apn.cert
      };
      notifier.log.debug("registering feedback...");
      notifier._feedback = new apn.Feedback(options);
    }
    notifier._configureFeedback();

    function logSetup(log){
      notifier.log = {};
      ['debug', 'log', 'info', 'warn', 'error'].forEach(function(logLevel){
        if(log[logLevel]){
          this[logLevel]=log[logLevel].bind(log);
        }else{
          log.info('Notifier: ' + logLevel + ' not supported by logger, disabled')
          this[logLevel]=function(){};
        }
      }, notifier.log);
    }

  }

  function _configureApnEventListners(){
    var notifier = this;
    var l = notifier.log;
    notifier._apnConn.on( 'error', l.error.bind(l, "on error"));
    notifier._apnConn.on( 'socketError', l.error.bind(l, 'on socketError'));
    notifier._apnConn.on( 'transmitted', l.debug.bind(l, 'transmitted'));
    notifier._apnConn.on( 'completed', l.info.bind(l, 'completed') );
    notifier._apnConn.on( 'cacheTooSmall', l.warn.bind(l, 'cache too small by sizediff: '));
    notifier._apnConn.on( 'connected', l.warn.bind(l, 'connected: '));
    notifier._apnConn.on( 'disconnected', l.warn.bind(l, 'disconnected: ') );
    notifier._apnConn.on( 'timeout', l.warn.bind(l, 'timeout! ') );
    notifier._apnConn.on( 'transmissionError', l.error.bind(l, 'transmissionError: '));
  }

  function _configureFeedback(){
    var notifier = this;
    notifier._feedback.on("feedback", function(devices){ notifier._onFeedback(devices); }); //.bind(notifier));
    notifier._feedback.on("error", notifier._onFeedbackConnectionError.bind(notifier));
    notifier._feedback.on("feedbackError", notifier._onFeedbackError.bind(notifier));
    notifier.log.info("Feedback service initialized");
  }

  function _onFeedback(devices){
    var notifier = this;
    devices.forEach(function(item) {
      notifier.log.debug('Feedback device: ' + item.device.toString(), item);
      var feedbackTime = item.time * 1000;  //time is UNIX epoch in seconds, we deal in ms.
      notifier.deregisterDevice(item.device.toString(), 'ok', feedbackTime).then(function(result){
        notifier.log.debug('deregistered: ' + result);
      }, function(error){
        notifier.log.error('on feedback error', error);
      });
    });
  }

  function _onFeedbackError(error){
    var notifier = this;
    notifier.log.warn('feedback error');
    notifier.log.error(util.inspect(error));
  }

  function _onFeedbackConnectionError(error){
    var notifier = this;
    notifier.log.warn('feedback connection error');
    notifier.log.error(util.inspect(error));
  }

  function configureRoutes(expressApp){
    var notifier = this;
    expressApp.post('/_lowla/register', function(req, res, next){notifier.register(req, res, next);});
    expressApp.post('/_lowla/deregister', function(req, res, next){notifier.deregister(req, res, next);});
  }

  function createNotifier(){
    var notifier = this;
    return function (eventName, payload){
      notifier.notify(eventName, payload)
    }
  }

  function onRegisterUse(middleware){
    notifier = this;
    notifier._registerMiddleware.use(middleware)
  }

  function register(req, res){
    var notifier = this;
    try {
      var body = req.body;
      notifier.log.debug("registering device: ", body);
      Promise.resolve(true).then(function() {
        return notifier.registerDevice(body.apntoken, body.lastapntoken).then(function(doc){
          notifier.log.debug("registration doc: ", doc);
          return true;
        })

      }).then(function(){
        res.set('Content-Type', 'application/json');
        res.status(200).send({status: 'ok'});
      }).done();


    }catch(err){
      notifier.log.error(err);
      res.status(500).send(err.message)
    }
  }

  function deregister(req, res){
    var notifier = this;
    try {
      var body = req.body;
      notifier.log.debug("de-registering: ", body);
      notifier.deregisterDevice(body.apntoken, "ok").then(function(doc){
        notifier.log.debug("registration doc: ", doc);
      }).done();
      res.set('Content-Type', 'application/json');
      res.status(200).send({status: 'ok'});
    }catch(err){
      notifier.log.error(err);
      res.status(500).send(err.message)
    }
  }

  function registerDevice(apnToken, lastApnToken){
    var lastTokenOps;
    var notifier = this;
    var timestamp = new Date().getTime();
    var ops = {
      $set: {
        status:'ok',
        enabled:true,
        modified:timestamp
      },
      $inc: {
        registered:1
      }
    };

    return notifier._getDocument(apnToken).then(function(doc) {
      if (undefined === doc) {
        notifier.log.info('Registering new device token: ' + apnToken);
        ops.$set.created = timestamp;
      }
      if (undefined !== lastApnToken) {
        //TODO we have the last document, call middleware/hook with document to let app decide what to copy
        notifier.log.debug('Disabling previous registration for this device, newß/old tokens: ', apnToken, lastApnToken);
        return notifier._getDocument(lastApnToken).then(function(lastDoc) {
          if (undefined !== lastDoc) {
            lastTokenOps = {$set:{enabled:false, expired: true, replacedByToken: apnToken}};
          }
          return notifier._updateDevice(lastApnToken, lastTokenOps).then(function(result){
            notifier.log.warn("Decomissioned old device: " , result);   //TODO remove... or debug..
          }, function(error){
            notifier.log.warn("Failed to update previous device document: " + lastApnToken + "; Reason: ", error)
          });
        });
      }
      return true;  //existing document updated...
    }).then(function(){
      return notifier._registerMiddleware.execute(apnToken, ops);
    }).then(function(){
      return notifier._updateDevice(apnToken, ops);
    });
  }

  function deregisterDevice(apnToken, status, feedbackTimestamp){
    status = status || "ok";
    var notifier = this;

    var timestamp = new Date().getTime();
    var ops = {
      $set: {
        status:'ok',
        enabled:false,
        modified:timestamp
      }
    };

    if(undefined===feedbackTimestamp){  //simply disable device, not due to feedback (user initiated?)
      return notifier._updateDevice(apnToken, ops);
    }else{
      if(!ops.$inc){
        ops.$inc={};
      }
      ops.$inc.feedbacked = 1;
      ops.$set.lastfeedback = feedbackTimestamp;

      var fullId = notifier._options.datastore.idFromComponents(notifier._options.devicesPrefix, apnToken);

      return notifier._options.datastore.getDocument(fullId).then(function(doc){
        if ( undefined === doc || doc.isDeleted ){
          notifier.log.info('Received deregister request for device that is not currently registered', apnToken);
          return promise.resolve();
        }
        if (feedbackTimestamp <= doc.modified){
          //apn feedback timestamp is not later than last time app on device registered with us, assume still active:
          ops.$set.enabled = true;
          return notifier._updateDevice(apnToken, ops);
        }else{
          //apn feedback timestamp is more recent than the last registration, disable device:
          return notifier._updateDevice(apnToken, ops);
        }
      });
    }
  }

  function _getDocument(id){
    var notifier = this;
    var fullId = notifier._options.datastore.idFromComponents(notifier._options.devicesPrefix, id);
    return notifier._options.datastore.getDocument(fullId).then(function(doc){
      if ( undefined === doc || doc.isDeleted ){
        throw new Error('Unexpected result from datastore.getDocument: ', doc)
      }
      return doc;
    }, function(rejection){
      if(rejection.isDeleted){  //datastore.getDocument() always assumes the document is deleted if it can be located.
        return undefined;
      }
      throw rejection; //some other error
    });
  }

  function _updateDevice(id, ops) {
    if(undefined === ops.$set){
      ops.$set={};
    }
    if(undefined === ops.$set.modified){
      ops.$set.modified = new Date().getTime();
    }
    if(undefined === ops.$inc){
      ops.$inc={};
    }
    ops.$inc.registered = 1;
    var notifier = this;
    var fullId = notifier._options.datastore.idFromComponents(notifier._options.devicesPrefix, id);
    return Promise.resolve().then(function(){
      return notifier._options.datastore.updateDocumentByOperations(fullId, undefined, ops);
    });
  }

  function notify (eventName, payload) {
    var notifier = this;
    return notifier._notify(eventName, payload);
  }

  function _notify (eventName, payload, alert, sound, badge) {
    var notifier = this;
    return notifier._options.datastore.findAll(notifier._options.devicesPrefix, {enabled:true})
      .then(function(devices) {

        var note = new apn.Notification();
        var expireInHours = 36;
        note.expiry = Math.floor(Date.now() / 1000) + ( 3600 * expireInHours );
        note.contentAvailable = '1';

        if(payload===undefined){
          note.payload.LowlaDB = {};
        }else{
          note.payload.LowlaDB = payload;
        }

        if(alert===undefined && sound===undefined && badge===undefined){
          note.priority = 5;  //required priority if no alert/sound
        }else{
          note.priority=10;
          note.alert = alert || 'New content available!';
          note.alert = alert || 'New content available!';
          note.sound = sound || "default";
          note.badge = badge || 1;
        }

        for (i in devices) {
          notifier.log.debug("notifiying device: " + devices[i]._id)
          var apnDevice = new apn.Device(devices[i]._id);
          notifier._apnConn.pushNotification(note, apnDevice);
        }
        return true;
      });
  }

})(module);