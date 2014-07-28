angular.module('ridematch.mobile')
  .factory('Auth', ['$window', function ($window) {
    var KEY = 'ridematch.session';
    function read() {
      try { return JSON.parse($window.localStorage.getItem(KEY)); } catch (e) { return null; }
    }
    return {
      save: function (s) { $window.localStorage.setItem(KEY, JSON.stringify(s)); },
      clear: function () { $window.localStorage.removeItem(KEY); },
      token: function () { var s = read(); return s && s.token; },
      user: function () { var s = read(); return (s && s.user) || {}; },
      isLoggedIn: function () { return !!read(); }
    };
  }])

  .factory('authInterceptor', ['$q', '$injector', function ($q, $injector) {
    return {
      request: function (config) {
        var token = $injector.get('Auth').token();
        if (token && config.url.indexOf('/api/') >= 0) { config.headers.Authorization = 'Bearer ' + token; }
        return config;
      },
      responseError: function (res) {
        if (res.status === 401 && res.config.url.indexOf('/api/auth/') < 0) {
          $injector.get('Auth').clear();
          $injector.get('$state').go('login');
        }
        return $q.reject(res);
      }
    };
  }])

  .factory('Api', ['$http', 'API_BASE', function ($http, API_BASE) {
    function data(r) { return r.data; }
    function post(path, body) { return $http.post(API_BASE + path, body).then(data); }
    return {
      login: function (u) { return post('/api/auth/login', u); },
      register: function (u) { return post('/api/auth/register', u); },
      me: function () { return $http.get(API_BASE + '/api/me').then(data); },
      createTrip: function (t) { return post('/api/trips', t); },
      search: function (r) { return post('/api/matches/search', r); },
      book: function (tripId, r) { return post('/api/trips/' + tripId + '/bookings', r); },
      bookingAction: function (id, action) { return post('/api/bookings/' + id + '/' + action); }
    };
  }])

  /** Device GPS via cordova-plugin-geolocation (falls back to the browser API). */
  .factory('Location', ['$q', function ($q) {
    return {
      current: function () {
        return $q(function (resolve, reject) {
          if (!navigator.geolocation) { return reject(new Error('Location unavailable')); }
          navigator.geolocation.getCurrentPosition(function (pos) {
            resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          }, reject, { enableHighAccuracy: true, timeout: 10000 });
        });
      }
    };
  }])

  /** A few well-known campus/city places so riders don't need a map on a small screen. */
  .constant('PLACES', [
    { name: 'UH Main Campus', lat: 29.7199, lng: -95.3422 },
    { name: 'Downtown Houston', lat: 29.7604, lng: -95.3698 },
    { name: 'Midtown', lat: 29.7420, lng: -95.3780 },
    { name: 'Memorial City', lat: 29.7807, lng: -95.5440 },
    { name: 'Katy', lat: 29.7858, lng: -95.8245 },
    { name: 'Sugar Land', lat: 29.6197, lng: -95.6349 },
    { name: 'The Woodlands', lat: 30.1658, lng: -95.4613 }
  ])

  .factory('Toast', ['$ionicLoading', function ($ionicLoading) {
    return {
      show: function (text) { $ionicLoading.show({ template: text, noBackdrop: true, duration: 2500 }); },
      error: function (res) {
        var b = res && res.data;
        var msg = !b ? 'Network error' : b.reasons ? b.reasons.join(', ') : b.errors ? Object.keys(b.errors).map(function (k) { return b.errors[k]; }).join('; ') : b.error;
        $ionicLoading.show({ template: msg || 'Something went wrong', noBackdrop: true, duration: 3000 });
      }
    };
  }]);
