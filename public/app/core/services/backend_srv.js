define([
  'angular',
  'lodash',
  '../core_module',
  'app/core/config',
],
function (angular, _, coreModule, config) {
  'use strict';

  coreModule.default.service('backendSrv', function($http, alertSrv, $timeout) {
    var self = this;

    this.get = function(url, params) {
      return this.request({ method: 'GET', url: url, params: params });
    };

    this.delete = function(url) {
      return this.request({ method: 'DELETE', url: url });
    };

    this.post = function(url, data) {
      return this.request({ method: 'POST', url: url, data: data });
    };

    this.patch = function(url, data) {
      return this.request({ method: 'PATCH', url: url, data: data });
    };

    this.put = function(url, data) {
      return this.request({ method: 'PUT', url: url, data: data });
    };

    this._handleError = function(err) {
      return function() {
        if (err.isHandled) {
          return;
        }

        var data = err.data || { message: 'Unexpected error' };
        if (_.isString(data)) {
          data = { message: data };
        }

        if (err.status === 422) {
          alertSrv.set("Validation failed", data.message, "warning", 4000);
          throw data;
        }

        data.severity = 'error';

        if (err.status < 500) {
          data.severity = "warning";
        }

        if (data.message) {
          alertSrv.set("Problem!", data.message, data.severity, 10000);
        }

        throw data;
      };
    };

    this.request = function(options) {
      options.retry = options.retry || 0;
      var requestIsLocal = options.url.indexOf('/') === 0;
      var firstAttempt = options.retry === 0;

      if (requestIsLocal && !options.hasSubUrl) {
        options.url = config.appSubUrl + options.url;
        options.hasSubUrl = true;
      }

      return $http(options).then(function(results) {
        if (options.method !== 'GET') {
          if (results && results.data.message) {
            alertSrv.set(results.data.message, '', 'success', 3000);
          }
        }
        return results.data;
      }, function(err) {
        // handle unauthorized
        if (err.status === 401 && firstAttempt) {
          return self.loginPing().then(function() {
            options.retry = 1;
            return self.request(options);
          });
        }

        $timeout(self._handleError(err), 50);
        throw err;
      });
    };

    this.datasourceRequest = function(options) {
      options.retry = options.retry || 0;
      var requestIsLocal = options.url.indexOf('/') === 0;
      var firstAttempt = options.retry === 0;

      return $http(options).then(null, function(err) {
        // handle unauthorized for backend requests
        if (requestIsLocal && firstAttempt  && err.status === 401) {
          return self.loginPing().then(function() {
            options.retry = 1;
            return self.datasourceRequest(options);
          });
        }

        // for Prometheus
        if (!err.data.message && _.isString(err.data.error)) {
          err.data.message = err.data.error;
        }

        throw err;
      });
    };

    this.loginPing = function() {
      return this.request({url: '/api/login/ping', method: 'GET', retry: 1 });
    };

    this.search = function(query) {
      return this.get('/api/search', query);
    };

    this.getDashboard = function(type, slug) {
      return this.get('/api/dashboards/' + type + '/' + slug);
    };

    this.removeOffsets = function(dash) {
      console.log("Remove offsets");

      dash.rows = dash.rows.map(function(row) {
        row.panels = row.panels.map(function(panel) {

          if(panel.type !== "graph"){
            return panel;
          }

          panel.targets = panel.targets.filter(function(line) {
            if(line.auto_created) {
              return !line.time_offset;
            }
            return true;
          });

          return panel;
        });

        return row;
      });
    };

    //returns new dashboard with
    this.updateOffsetGrafs = function(dash) {

      var offsetes = dash.offsets;

      this.removeOffsets(dash);

      if(dash.with_offset === true) {
        console.log("Do updating dashboard: create offsets", dash);
        dash.rows = dash.rows.map(function(row) {
          row.panels = row.panels.map(function(panel) {

            if(panel.type !== "graph"){
              return panel;
            }
            panel.targets.map(function(line) {

              if(!line.time_offset){
                offsetes.forEach(function(offset) {
                  var newLine = JSON.parse(JSON.stringify(line));
                  if(line.alias){
                    newLine.alias = line.alias + '-' + offset + '-offset';
                  }

                  newLine.time_offset = offset;
                  newLine.auto_created = true;

                  var possibleOffsets = panel.targets.filter(function(item) {

                    return item.query === newLine.query && item.time_offset === newLine.time_offset;
                  });

                  if(possibleOffsets.length > 0){
                    console.log("Skip adding line alias for alias ", newLine.alias);
                  }else{
                    panel.targets.push(newLine);
                  }

                });
              }

            });

            return panel;
          });

          return row;
        });
      }

    };

    this.saveDashboard = function(dash, options) {
      options = (options || {});

      console.log("Dashboard", dash, options);

      this.updateOffsetGrafs(dash);

      console.log("Updated dash", dash, options);
      return this.post('/api/dashboards/db/', {dashboard: dash, overwrite: options.overwrite === true});
    };

  });
});
