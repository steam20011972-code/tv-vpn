// The app's only use of Homebrew Channel exec, which runs a command as root: elevate-service for the app's own Luna
// service, so that the service runs as root. Fixed text, no user data. Everything else goes to that service
// (service/service.js). Kept apart from app.js so that test/commands.test.cjs can check it.
(function (root) {
  'use strict';
  var SERVICE = 'io.github.steam20011972code.tvvpn.service';
  var ELEVATE = '/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service ' + SERVICE;
  var api = { SERVICE: SERVICE, ELEVATE: ELEVATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TVCommands = api;
})(this);
