angular.module('ridematch', ['ngRoute'])
  .constant('API_BASE', '')
  .config(['$routeProvider', '$httpProvider', function ($routeProvider, $httpProvider) {
    function requireLogin(Auth, $location) {
      if (!Auth.isLoggedIn()) { $location.path('/login'); }
    }
    requireLogin.$inject = ['Auth', '$location'];

    $routeProvider
      .when('/login', { templateUrl: '/views/login.html', controller: 'LoginCtrl', controllerAs: 'vm' })
      .when('/find', { templateUrl: '/views/find.html', controller: 'FindCtrl', controllerAs: 'vm', resolve: { auth: requireLogin } })
      .when('/offer', { templateUrl: '/views/offer.html', controller: 'OfferCtrl', controllerAs: 'vm', resolve: { auth: requireLogin } })
      .when('/dashboard', { templateUrl: '/views/dashboard.html', controller: 'DashboardCtrl', controllerAs: 'vm', resolve: { auth: requireLogin } })
      .otherwise('/find');
    $httpProvider.interceptors.push('authInterceptor');
  }])

  .factory('Auth', ['$window', function ($window) {
    var KEY = 'ridematch.session';
    function read() {
      try { return JSON.parse($window.localStorage.getItem(KEY)) || null; } catch (e) { return null; }
    }
    return {
      save: function (session) { $window.localStorage.setItem(KEY, JSON.stringify(session)); },
      clear: function () { $window.localStorage.removeItem(KEY); },
      token: function () { var s = read(); return s && s.token; },
      user: function () { var s = read(); return (s && s.user) || {}; },
      isLoggedIn: function () { return !!read(); }
    };
  }])

  .factory('authInterceptor', ['$q', '$location', '$injector', function ($q, $location, $injector) {
    return {
      request: function (config) {
        var token = $injector.get('Auth').token();
        if (token && config.url.indexOf('/api/') >= 0) { config.headers.Authorization = 'Bearer ' + token; }
        return config;
      },
      responseError: function (res) {
        if (res.status === 401 && res.config.url.indexOf('/api/auth/') < 0) {
          $injector.get('Auth').clear();
          $location.path('/login');
        }
        return $q.reject(res);
      }
    };
  }])

  .factory('Api', ['$http', 'API_BASE', function ($http, API_BASE) {
    function data(r) { return r.data; }
    function post(path, body) { return $http.post(API_BASE + path, body).then(data); }
    return {
      register: function (u) { return post('/api/auth/register', u); },
      login: function (u) { return post('/api/auth/login', u); },
      me: function () { return $http.get(API_BASE + '/api/me').then(data); },
      createTrip: function (t) { return post('/api/trips', t); },
      trip: function (id) { return $http.get(API_BASE + '/api/trips/' + id).then(data); },
      cancelTrip: function (id) { return post('/api/trips/' + id + '/cancel'); },
      search: function (r) { return post('/api/matches/search', r); },
      book: function (tripId, r) { return post('/api/trips/' + tripId + '/bookings', r); },
      bookingAction: function (id, action) { return post('/api/bookings/' + id + '/' + action); },
      rate: function (id, stars) { return post('/api/bookings/' + id + '/rate', { stars: stars }); }
    };
  }])

  .factory('Flash', ['$rootScope', '$timeout', function ($rootScope, $timeout) {
    var state = { text: '', kind: 'info' };
    var timer;
    return {
      state: state,
      show: function (text, kind) {
        state.text = text;
        state.kind = kind || 'info';
        $timeout.cancel(timer);
        timer = $timeout(function () { state.text = ''; }, 4000);
      },
      error: function (res) {
        var b = res && res.data;
        var msg = !b ? 'Network error' : b.reasons ? b.error + ': ' + b.reasons.join(', ') :
          b.errors ? Object.keys(b.errors).map(function (k) { return b.errors[k]; }).join('; ') : b.error;
        this.show(msg || 'Something went wrong', 'error');
      }
    };
  }])

  .filter('money', function () {
    return function (cents) { return cents ? '$' + (cents / 100).toFixed(2) : 'Free'; };
  });
