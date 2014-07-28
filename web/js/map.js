/**
 * <rm-map points="vm.points" pick="vm.pick(latlng)" lines="vm.lines"></rm-map>
 * Leaflet wrapper: renders labeled markers and polylines; clicking the map calls `pick`.
 */
angular.module('ridematch').directive('rmMap', function () {
  var HOUSTON = [29.7604, -95.3698];
  return {
    restrict: 'E',
    scope: { points: '<', lines: '<', pick: '&' },
    template: '<div class="map"></div>',
    link: function (scope, element) {
      var map = L.map(element[0].firstChild).setView(HOUSTON, 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      var layer = L.layerGroup().addTo(map);

      map.on('click', function (e) {
        scope.$apply(function () { scope.pick({ latlng: { lat: e.latlng.lat, lng: e.latlng.lng } }); });
      });

      function redraw() {
        layer.clearLayers();
        var bounds = [];
        (scope.points || []).forEach(function (p) {
          if (!p || !p.lat) { return; }
          L.marker([p.lat, p.lng], { title: p.label }).bindTooltip(p.label || '', { permanent: true }).addTo(layer);
          bounds.push([p.lat, p.lng]);
        });
        (scope.lines || []).forEach(function (line) {
          L.polyline(line.map(function (p) { return [p.lat, p.lng]; }), { color: '#e4572e', weight: 4, opacity: 0.7 }).addTo(layer);
        });
        if (bounds.length > 1) { map.fitBounds(bounds, { padding: [40, 40] }); }
      }

      scope.$watch('points', redraw, true);
      scope.$watch('lines', redraw, true);
      scope.$on('$destroy', function () { map.remove(); });
    }
  };
});
