angular.module('ridematch.mobile')
  .controller('LoginCtrl', ['Api', 'Auth', 'Toast', '$state', function (Api, Auth, Toast, $state) {
    var vm = this;
    vm.form = {};
    vm.register = false;
    vm.submit = function () {
      (vm.register ? Api.register(vm.form) : Api.login(vm.form)).then(function (session) {
        Auth.save(session);
        $state.go('tab.find');
      }, Toast.error);
    };
  }])

  .controller('FindCtrl', ['Api', 'Location', 'Toast', 'PLACES', function (Api, Location, Toast, PLACES) {
    var vm = this;
    var start = new Date(Date.now() + 30 * 60000);
    vm.places = PLACES;
    vm.form = { pickup: null, dropoff: null, earliest: start, latest: new Date(start.getTime() + 3600000), seats: 1 };

    vm.useMyLocation = function () {
      Location.current().then(function (pos) {
        vm.form.pickup = angular.extend({ name: 'My location' }, pos);
      }, function () { Toast.show('Could not get your location'); });
    };

    function request() {
      return { pickup: vm.form.pickup, dropoff: vm.form.dropoff, seats: vm.form.seats,
        earliest: new Date(vm.form.earliest).toISOString(), latest: new Date(vm.form.latest).toISOString() };
    }

    vm.search = function () {
      if (!vm.form.pickup || !vm.form.dropoff) { Toast.show('Choose pickup and drop-off'); return; }
      Api.search(request()).then(function (res) {
        vm.matches = res.matches;
        if (!res.count) { Toast.show('No rides yet, try a wider window'); }
      }, Toast.error);
    };

    vm.book = function (m) {
      Api.book(m.trip.id, request()).then(function () {
        m.requested = true;
        Toast.show('Request sent!');
      }, Toast.error);
    };
  }])

  .controller('OfferCtrl', ['Api', 'Location', 'Toast', 'PLACES', '$state', function (Api, Location, Toast, PLACES, $state) {
    var vm = this;
    vm.places = PLACES;
    vm.form = { origin: null, destination: null, departAt: new Date(Date.now() + 3600000), seats: 3, maxDetourKm: 5, flexMinutes: 15 };

    vm.useMyLocation = function () {
      Location.current().then(function (pos) { vm.form.origin = angular.extend({ name: 'My location' }, pos); });
    };

    vm.submit = function () {
      if (!vm.form.origin || !vm.form.destination) { Toast.show('Choose start and destination'); return; }
      Api.createTrip({
        origin: { lat: vm.form.origin.lat, lng: vm.form.origin.lng }, originLabel: vm.form.origin.name,
        destination: { lat: vm.form.destination.lat, lng: vm.form.destination.lng }, destinationLabel: vm.form.destination.name,
        departAt: new Date(vm.form.departAt).toISOString(), seats: vm.form.seats,
        maxDetourKm: vm.form.maxDetourKm, flexMinutes: vm.form.flexMinutes
      }).then(function () {
        Toast.show('Trip posted');
        $state.go('tab.rides');
      }, Toast.error);
    };
  }])

  .controller('RidesCtrl', ['Api', 'Auth', 'Toast', '$state', '$ionicPopup', function (Api, Auth, Toast, $state, $ionicPopup) {
    var vm = this;
    vm.refresh = function () {
      Api.me().then(function (me) { vm.me = me; }).finally(function () { vm.loaded = true; });
    };
    vm.cancel = function (b) {
      $ionicPopup.confirm({ title: 'Cancel ride?', template: 'The driver will be notified.' }).then(function (ok) {
        if (ok) { Api.bookingAction(b.id, 'cancel').then(vm.refresh, Toast.error); }
      });
    };
    vm.logout = function () {
      Auth.clear();
      $state.go('login');
    };
    vm.refresh();
  }]);
