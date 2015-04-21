
# LowlaDB Push Notifications for Node

> Node.js Push Notifications module for LowlaDB Cordova applications

Currently supports notifications for iOS applications using the Apple Push Notification Service.  Future releases will offer support for Android and other platforms.


## Installation ##

```bash
$ npm install lowladb-node-notify --save
```


## Usage ##

This module provides server-side support for the [LowlaDB Node.js](https://github.com/lowla/lowladb-node) server implementation to notify iOS LowlaDB apps in the background when updates are available to sync.

The use of this feature requires a Cordova or iOS application using [lowladb-cordova](https://github.com/lowla/lowladb-cordova) or [liblowladb](https://github.com/lowla/liblowladb), respectively,  that:
* has been configured and registered to receive Push Notifications from the Apple Push Notification Service
* delegates the appropriate registration information and notification messages to the LowlaDB framework

Detailed information on configuring clients will be included in those projects. [TBD]

This module requires:
* a LowlaDB `Datastore` adapter to store the list of registered devices that should be notified
* the Apple Push Notification Service certificate/key to use when sending notifications

In general, usage of this module involves:
* creating an instance of the module passing `Datastore` and certificates
* calling `configureRoutes` to map end points in Express
* passing a callback function generated via `getNotifier` to the LowlaDB server

When used with a LowlaDB `Datastore` that is SQL/Table based, you will need to create a table for device token storage.  See [Device Collection Requirements](#dcr), below.

## Configuration ##

### Setup ###

The following is a minimal example of configuring LowlaDB to use this module:

```js
var lowladb = require('lowladb-node');
var lowlaNotifier = require('lowladb-node-notify');
var express = require('express');
var app = express();

var ds = new lowladb.NeDBDatastore({ dbDir: 'lowlanedb' });

var notifier = new lowlaNotifier(
  {
    datastore:ds,
    apn:{passphrase:<pwd>, cert:<cer.pem path>, key:<key.pem path>}
  }
);

notifier.configureRoutes(app);

lowladb.configureRoutes(app, {datastore:ds, notifier:notifier.createNotifier()});

app.listen(3000);

```

### Options ###

The constructor takes an options object with two parameters:
* `datastore`:  Required.  A LowlaDB `Datastore` implementation
* `apn`: Required.  Information needed to access the APN Service, minimally:
  * `cert`:  a certificate `.pem` file
  * `key`: the key `.pem` file for use with the certificate
  * `passphrase`:  the certificates password
  * `production`: boolean, specify false for APN sandbox servers

The apn properties are the same used by the [node-apn](https://www.npmjs.com/package/apn) module.  Information on how to prepare the certificates (.pem files) for APN is also available at [node-apn wiki](https://github.com/argon/node-apn/wiki/Preparing-Certificates).

The module also registers for APN feedback using the same apn options, except that `batchFeedback` and `interval` are set.

### Logging ###

Logging can be enabled by passing a logger in the constructor, or by calling `useLogger`.  Multiple loggers can be added via `useLogger`.  By default, this module does not log messages to the console, however this can be enabled by calling `useLogger(console)`.

The module logs at the following levels: `error`, `warn`, `info`, and `debug`.

Logger objects should support, at minimum: `error`, `warn`, and `info`.  If the logger has `log` but not `debug`, `debug` will map to `log`, and vice versa.

A minimum log level can be passed by name as a second parameter, for example,  `useLogger(logger, 'warn')` will only log messages at the levels `warn` and `error`.



### <a name="dcr"></a>Device Collection Requirements ###

Device registration is recorded in the collection `lowlaNotify` and by default contains the following fields:
* `_id`
* `status`
* `enabled`
* `service`
* `created`
* `modified`
* `lastfeedback`
* `feedbacked`

To use one of the Datastore implementations that is SQL/Table based, the appropriate table will need to be created.  For example, to use the PostgreSQL Datastore, the following DDL could be used to create an appropriate table:

```sql
CREATE TABLE "lowlaNotify"
(
  _id text NOT NULL,
  status text,
  service text,
  enabled boolean,
  modified bigint,
  created bigint,
  registered integer,
  feedbacked integer,
  lastfeedback bigint,
  CONSTRAINT "pk_lowlaNotify" PRIMARY KEY (_id)
)
WITH (
  OIDS=FALSE
);
ALTER TABLE "lowlaNotify"
  OWNER TO postgres;
```

### Adding custom data to Device Table ###

Handlers can be configured to add more columns on registration (and deregistration) of devices.  Handlers are written similarly to [`Express`](https://www.npmjs.com/package/express) middleware, and are called in the order registered.

* `onRegisterUse(function(token, update, context, next){...})`: called when a device registers, which should happen whenever client app is re-launched, to keep tokens up-to-date
* `onDeregisterUse(function(token, update, context, next){...})`: called when a device is disabled, usually because the APN Feedback service has indicated the app was uninstalled

Functions registered as middleware will receive:
* `token`: the device token
* `update`: the set of operations (`$set`, `$inc`) to apply to the device document being updated
* `context`: a set of objects that may be useful as context, described below
* `next`: function that must be called to indicate that processing is complete. Calling `next()` with a parameter/error will abort processing.

**Important:** `next()` *must* be called to allow processing to continue.

The `context` object may contain:
* `request`: the Express request that triggered the action
* `currentDeviceDocument`: the current record being updated, if not a new registration
* `previousDeviceDocument`: a previous record being superceded by a new registration, if the device's APN token has been changed
* `isNewDevice`: `true` if the an existing device record was not found for the token

Assuming an authentication middleware in `Express` was used to add a `username` property to the `request` object, the following middleware could be used to add the username and remote IP address to the device record:

```js

lowlaNotifier.onRegisterUse(function(token, update, context, next){
  update.$set.username = context.resquest.username;
  update.$set.setByMiddleware = context.request.ip;
  next();
});

```
Note that any additional fields added via middleware will also need to be added to table definitions for SQL/Table based `Datastore`.


## Authors

- Mark Dixon, mark_dixon@lowla.io
- Michael Hamilton, michael_hamilton@lowla.io
- Matt Vargish, matt_vargish@lowla.io

## License

liblowladb is available under the MIT license. See the LICENSE file for more info.