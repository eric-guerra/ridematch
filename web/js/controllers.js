angular.module('ridematch')
  .controller('NavCtrl', ['Auth', 'Flash', '$location', function (Auth, Flash, $location) {
    this.auth = Auth;
    this.flash = Flash.state;
    this.logout = function () { Auth.clear(); $location.path('/login'); };
  }])

  .controller('LoginCtrl', ['Api', 'Auth', 'Flash', '$location', function (Api, Auth, Flash, $location) {
    var vm = this;
    vm.mode = 'login';
    vm.form = {};
    vm.submit = function () {
      var call = vm.mode === 'login' ? Api.login(vm.form) : Api.register(vm.form);
      call.then(function (session) {
        Auth.save(session);
        $location.path('/find');
      }, Flash.error.bind(Flash));
    };
  }])

  /**
   * Shared helper: two-step point picking on the map (first click = from, second = to).
   * `points` is a stable array mutated in place so Angular bindings don't see a new object every digest.
   */
  .factory('PointPicker', function () {
    return function (labels) {
      var state = { from: null, to: null };
      var points = [];
      function sync() {
        points.length = 0;
        if (state.from) { points.push(angular.extend({ label: labels[0] }, state.from)); }
        if (state.to) { points.push(angular.extend({ label: labels[1] }, state.to)); }
      }
      return {
        state: state,
        points: points,
        pick: function (latlng) {
          if (!state.from || state.to) { state.from = latlng; state.to = null; } else { state.to = latlng; }
          sync();
        }
      };
    };
  })

  .controller('FindCtrl', ['Api', 'Flash', 'PointPicker', function (Api, Flash, PointPicker) {
    var vm = this;
    var picker = PointPicker(['Pickup', 'Drop-off']);
    var inAnHour = new Date(Date.now() + 3600000);
    vm.picker = picker.state;
    vm.form = { date: inAnHour, earliest: inAnHour, latest: new Date(inAnHour.getTime() + 3600000), seats: 1 };
    vm.pick = picker.pick;
    vm.points = picker.points;
    vm.lines = [];

    function at(date, time) {
      var d = new Date(date);
      d.setHours(time.getHours(), time.getMinutes(), 0, 0);
      return d.toISOString();
    }

    function request() {
      return { pickup: picker.state.from, dropoff: picker.state.to, seats: vm.form.seats,
        earliest: at(vm.form.date, vm.form.earliest), latest: at(vm.form.date, vm.form.latest) };
    }

    vm.search = function () {
      if (!picker.state.from || !picker.state.to) { Flash.show('Click the map to set pickup, then drop-off'); return; }
      Api.search(request()).then(function (res) {
        vm.results = res.matches;
        vm.lines = res.matches.slice(0, 3).map(function (m) { return [m.trip.origin, m.trip.destination]; });
        if (!res.count) { Flash.show('No rides match yet. Try widening your time window.'); }
      }, Flash.error.bind(Flash));
    };

    vm.book = function (match) {
      Api.book(match.trip.id, request()).then(function () {
        Flash.show('Request sent to ' + match.trip.driverName, 'success');
        match.requested = true;
      }, Flash.error.bind(Flash));
    };
  }])

  .controller('OfferCtrl', ['Api', 'Flash', 'PointPicker', '$location', function (Api, Flash, PointPicker, $location) {
    var vm = this;
    var picker = PointPicker(['Start', 'Destination']);
    vm.picker = picker.state;
    vm.points = picker.points;
    vm.lines = [];
    vm.pick = function (latlng) {
      picker.pick(latlng);
      vm.lines = picker.state.from && picker.state.to ? [[picker.state.from, picker.state.to]] : [];
    };
    vm.form = { departAt: new Date(Date.now() + 2 * 3600000), seats: 3, maxDetourKm: 5, flexMinutes: 15, price: 0 };

    vm.submit = function () {
      if (!picker.state.from || !picker.state.to) { Flash.show('Click the map to set your start and destination'); return; }
      Api.createTrip({
        origin: picker.state.from, destination: picker.state.to, departAt: new Date(vm.form.departAt).toISOString(),
        seats: vm.form.seats, maxDetourKm: vm.form.maxDetourKm, flexMinutes: vm.form.flexMinutes,
        priceCents: Math.round((vm.form.price || 0) * 100), originLabel: vm.form.originLabel, destinationLabel: vm.form.destinationLabel
      }).then(function () {
        Flash.show('Trip posted', 'success');
        $location.path('/dashboard');
      }, Flash.error.bind(Flash));
    };
  }])

  .controller('DashboardCtrl', ['Api', 'Flash', '$q', function (Api, Flash, $q) {
    var vm = this;
    vm.load = function () {
      Api.me().then(function (me) {
        vm.me = me;
        // Drivers see who requested each trip.
        return $q.all(me.trips.filter(function (t) { return t.status === 'open'; }).map(function (t) { return Api.trip(t.id); }));
      }).then(function (details) { vm.tripDetails = details; });
    };

    vm.act = function (booking, action) {
      Api.bookingAction(booking.id, action).then(vm.load, Flash.error.bind(Flash));
    };

    vm.cancelTrip = function (trip) {
      if (!window.confirm('Cancel this trip? Riders will be notified.')) { return; }
      Api.cancelTrip(trip.id).then(vm.load, Flash.error.bind(Flash));
    };

    vm.rate = function (booking, stars) {
      Api.rate(booking.id, stars).then(function () { booking.rated = true; Flash.show('Thanks for rating!', 'success'); }, Flash.error.bind(Flash));
    };

    vm.load();
  }]);
