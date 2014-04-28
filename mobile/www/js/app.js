angular.module('ridematch.mobile', ['ionic'])
  // Point this at your deployed API (or the dev machine's LAN IP when testing on a phone).
  .constant('API_BASE', 'http://localhost:3000')

  .run(['$ionicPlatform', function ($ionicPlatform) {
    $ionicPlatform.ready(function () {
      if (window.StatusBar) { window.StatusBar.styleLightContent(); }
    });
  }])

  .config(['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {
    $stateProvider
      .state('login', { url: '/login', templateUrl: 'templates/login.html', controller: 'LoginCtrl as vm' })
      .state('tab', { url: '/tab', abstract: true, templateUrl: 'templates/tabs.html' })
      .state('tab.find', { url: '/find', views: { 'tab-find': { templateUrl: 'templates/find.html', controller: 'FindCtrl as vm' } } })
      .state('tab.offer', { url: '/offer', views: { 'tab-offer': { templateUrl: 'templates/offer.html', controller: 'OfferCtrl as vm' } } })
      .state('tab.rides', { url: '/rides', cache: false, views: { 'tab-rides': { templateUrl: 'templates/rides.html', controller: 'RidesCtrl as vm' } } });
    $urlRouterProvider.otherwise('/tab/find');
    $httpProvider.interceptors.push('authInterceptor');
  }])

  .run(['$rootScope', '$state', 'Auth', function ($rootScope, $state, Auth) {
    $rootScope.$on('$stateChangeStart', function (e, to) {
      if (to.name !== 'login' && !Auth.isLoggedIn()) {
        e.preventDefault();
        $state.go('login');
      }
    });
  }]);
