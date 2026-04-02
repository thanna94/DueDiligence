/**
 * Map Module
 *
 * Handles Leaflet map initialization, basemap switching, parcel layer display,
 * click-to-select parcels, and map overlay layers.
 */

const MapModule = (() => {
  let map = null;
  let parcelLayer = null;
  let selectedParcelLayer = null;
  let hoverParcelLayer = null;
  let basemapLayers = {};
  let activeBasemap = 'streets';
  let parcelLoadTimer = null;
  let onParcelSelect = null;
  let layerStates = {
    parcels: true,
    zoning: false,
    floodplain: false,
    utilities: false,
    masterPlan: false,
  };

  // ArcGIS-backed overlay layers
  let overlayLayers = {};

  /**
   * Initialize the map
   */
  function init(elementId, options = {}) {
    map = L.map(elementId, {
      center: NWA_REGION.center,
      zoom: NWA_REGION.zoom,
      zoomControl: true,
      attributionControl: true,
      maxZoom: 20,
      minZoom: 7,
    });

    // Basemaps
    basemapLayers.streets = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }
    );

    basemapLayers.satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri, Maxar, Earthstar Geographics', maxZoom: 19 }
    );

    basemapLayers.topo = L.tileLayer(
      'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { attribution: '&copy; OpenTopoMap', maxZoom: 17 }
    );

    basemapLayers.streets.addTo(map);

    // County boundary outlines
    addCountyBoundaries();

    // Parcel layer (GeoJSON features added dynamically)
    parcelLayer = L.geoJSON(null, {
      style: {
        color: '#2563eb',
        weight: 1,
        opacity: 0.6,
        fillColor: '#2563eb',
        fillOpacity: 0.05,
      },
      onEachFeature: (feature, layer) => {
        layer.on('click', () => selectParcel(feature, layer));
        layer.on('mouseover', () => {
          if (layer !== selectedParcelLayer) {
            layer.setStyle({ fillOpacity: 0.15, weight: 2 });
          }
        });
        layer.on('mouseout', () => {
          if (layer !== selectedParcelLayer) {
            layer.setStyle({ fillOpacity: 0.05, weight: 1 });
          }
        });
      }
    }).addTo(map);

    // Selected parcel highlight layer
    selectedParcelLayer = L.geoJSON(null, {
      style: {
        color: '#2563eb',
        weight: 3,
        opacity: 1,
        fillColor: '#2563eb',
        fillOpacity: 0.2,
        dashArray: null,
      }
    }).addTo(map);

    // Map click handler for areas without parcels loaded
    map.on('click', onMapClick);

    // Load parcels when map moves (debounced)
    map.on('moveend', () => {
      if (layerStates.parcels && map.getZoom() >= 15) {
        clearTimeout(parcelLoadTimer);
        parcelLoadTimer = setTimeout(loadVisibleParcels, 300);
      } else if (map.getZoom() < 15) {
        parcelLayer.clearLayers();
      }
    });

    // Position zoom control
    map.zoomControl.setPosition('topleft');

    return map;
  }

  /**
   * Add county boundary outlines to the map
   */
  function addCountyBoundaries() {
    CountyRegistry.getAll().forEach(county => {
      if (county.bounds) {
        L.rectangle(county.bounds, {
          color: county.color,
          weight: 2,
          fillOpacity: 0,
          dashArray: '8, 4',
          interactive: false,
        }).addTo(map).bindTooltip(county.shortName, {
          permanent: false,
          direction: 'center',
          className: 'county-label'
        });
      }
    });
  }

  /**
   * Handle map click - query for parcel at click point
   */
  async function onMapClick(e) {
    if (map.getZoom() < 13) return; // Too zoomed out for parcel queries

    const { lat, lng } = e.latlng;
    showLoading(true);

    // Determine which county the click is in
    const county = findCountyForPoint(lat, lng);

    try {
      const parcel = await ParcelService.getParcelAtPoint(lat, lng, county);
      if (parcel && onParcelSelect) {
        highlightParcel(parcel);
        onParcelSelect(parcel);
      }
    } catch (err) {
      console.error('Parcel query error:', err);
    } finally {
      showLoading(false);
    }
  }

  /**
   * Determine which county a point falls in
   */
  function findCountyForPoint(lat, lng) {
    for (const county of CountyRegistry.getAll()) {
      if (!county.bounds) continue;
      const [[s, w], [n, e]] = county.bounds;
      if (lat >= s && lat <= n && lng >= w && lng <= e) {
        return county;
      }
    }
    return null;
  }

  /**
   * Select a parcel feature
   */
  function selectParcel(feature, layer) {
    const county = findCountyForPoint(
      feature.geometry.coordinates ? feature.geometry.coordinates[1] : 0,
      feature.geometry.coordinates ? feature.geometry.coordinates[0] : 0
    );
    const parcel = ParcelService.normalizeParcelData(
      { attributes: feature.properties, geometry: arcgisGeomFromGeoJSON(feature.geometry) },
      county
    );

    highlightParcel(parcel);
    if (onParcelSelect) onParcelSelect(parcel);
  }

  /**
   * Highlight a parcel on the map
   */
  function highlightParcel(parcel) {
    selectedParcelLayer.clearLayers();

    if (parcel.geometry) {
      const geoJson = geojsonFromArcgis(parcel.geometry);
      if (geoJson) {
        selectedParcelLayer.addData({
          type: 'Feature',
          geometry: geoJson,
          properties: {}
        });
      }
    }

    if (parcel.centroid) {
      map.flyTo([parcel.centroid.lat, parcel.centroid.lng], Math.max(map.getZoom(), 17), {
        duration: 0.8
      });
    }
  }

  /**
   * Convert ArcGIS geometry to GeoJSON geometry
   */
  function geojsonFromArcgis(geom) {
    if (!geom) return null;
    if (geom.rings) {
      return {
        type: 'Polygon',
        coordinates: geom.rings
      };
    }
    if (geom.x !== undefined) {
      return {
        type: 'Point',
        coordinates: [geom.x, geom.y]
      };
    }
    return null;
  }

  /**
   * Convert GeoJSON geometry back to ArcGIS geometry (basic)
   */
  function arcgisGeomFromGeoJSON(geom) {
    if (!geom) return null;
    if (geom.type === 'Polygon') {
      return { rings: geom.coordinates, spatialReference: { wkid: 4326 } };
    }
    if (geom.type === 'Point') {
      return { x: geom.coordinates[0], y: geom.coordinates[1], spatialReference: { wkid: 4326 } };
    }
    return null;
  }

  /**
   * Load parcels visible in the current map extent
   */
  async function loadVisibleParcels() {
    if (map.getZoom() < 15) return;

    showLoading(true);
    const bounds = map.getBounds();

    try {
      const data = await ParcelService.getParcelsInExtent(bounds);
      parcelLayer.clearLayers();

      if (data.features) {
        data.features.forEach(feature => {
          const geojson = geojsonFromArcgis(feature.geometry);
          if (geojson) {
            parcelLayer.addData({
              type: 'Feature',
              geometry: geojson,
              properties: feature.attributes || {}
            });
          }
        });
      }
    } catch (err) {
      console.error('Error loading parcels:', err);
    } finally {
      showLoading(false);
    }
  }

  /**
   * Switch basemap
   */
  function setBasemap(name) {
    if (!basemapLayers[name]) return;
    Object.values(basemapLayers).forEach(layer => map.removeLayer(layer));
    basemapLayers[name].addTo(map);
    activeBasemap = name;
  }

  /**
   * Toggle a layer on/off
   */
  function toggleLayer(name, enabled) {
    layerStates[name] = enabled;
    if (name === 'parcels') {
      if (enabled && map.getZoom() >= 15) {
        loadVisibleParcels();
      } else {
        parcelLayer.clearLayers();
      }
    }
    // Overlay layers would be added here when data sources are configured
  }

  /**
   * Fly to a specific location
   */
  function flyTo(lat, lng, zoom = 17) {
    map.flyTo([lat, lng], zoom, { duration: 1.0 });
  }

  /**
   * Fly to a county's default view
   */
  function flyToCounty(countyId) {
    if (countyId === 'all') {
      map.flyToBounds(NWA_REGION.bounds, { duration: 1.0, padding: [20, 20] });
      return;
    }
    const county = CountyRegistry.get(countyId);
    if (county) {
      if (county.bounds) {
        map.flyToBounds(county.bounds, { duration: 1.0, padding: [20, 20] });
      } else {
        map.flyTo(county.center, county.zoom || 11, { duration: 1.0 });
      }
    }
  }

  /**
   * Show/hide loading indicator
   */
  function showLoading(show) {
    const el = document.getElementById('map-loading');
    if (el) el.classList.toggle('hidden', !show);
  }

  /**
   * Register callback for parcel selection
   */
  function onSelect(callback) {
    onParcelSelect = callback;
  }

  /**
   * Get the Leaflet map instance
   */
  function getMap() {
    return map;
  }

  /**
   * Locate user via browser geolocation
   */
  function locateUser() {
    map.locate({ setView: true, maxZoom: 16 });
  }

  return {
    init,
    setBasemap,
    toggleLayer,
    flyTo,
    flyToCounty,
    highlightParcel,
    onSelect,
    getMap,
    locateUser,
    loadVisibleParcels,
    findCountyForPoint,
  };
})();
