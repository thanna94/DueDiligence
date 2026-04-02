/**
 * Map Module
 *
 * Handles Leaflet map, parcel polygon rendering, click-to-query,
 * and basemap switching.
 */

const MapModule = (() => {
  let map = null;
  let parcelLayer = null;
  let selectedParcelLayer = null;
  let basemapLayers = {};
  let activeBasemap = 'streets';
  let parcelLoadTimer = null;
  let onParcelSelect = null;
  let isLoading = false;
  let layerStates = {
    parcels: true,
    zoning: false,
    floodplain: false,
    utilities: false,
    masterPlan: false,
  };

  // Track what parcels we've loaded so we don't re-fetch
  let lastLoadedBounds = null;

  /**
   * Initialize the map
   */
  function init(elementId) {
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

    // Add the Arkansas statewide parcel MapServer as a dynamic tile overlay
    // This renders parcel boundaries server-side (fast, works at all zoom levels)
    try {
      const parcelTileLayer = L.esri.dynamicMapLayer({
        url: ARKANSAS_GIS.parcelMapService,
        layers: [6], // PARCEL_POLYGON_CAMP
        opacity: 0.5,
        minZoom: 14,
        maxZoom: 20,
        f: 'image',
      });
      parcelTileLayer.addTo(map);
    } catch (e) {
      console.warn('[Map] esri.dynamicMapLayer not available, using click-only mode');
    }

    // County boundary outlines
    addCountyBoundaries();

    // Layer for individually fetched parcel polygons (click results)
    parcelLayer = L.geoJSON(null, {
      style: {
        color: '#2563eb',
        weight: 1.5,
        opacity: 0.7,
        fillColor: '#2563eb',
        fillOpacity: 0.08,
      },
      onEachFeature: (feature, layer) => {
        // Tooltip on hover
        const props = feature.properties || {};
        const tip = [
          props.adrlabel || props.parcelid,
          props.ownername,
          props.gis_acres ? `${parseFloat(props.gis_acres).toFixed(2)} ac` : null,
        ].filter(Boolean).join('<br>');
        if (tip) layer.bindTooltip(tip, { sticky: true });

        layer.on('click', () => handleFeatureClick(feature));
        layer.on('mouseover', () => {
          layer.setStyle({ fillOpacity: 0.2, weight: 2.5 });
        });
        layer.on('mouseout', () => {
          layer.setStyle({ fillOpacity: 0.08, weight: 1.5 });
        });
      }
    }).addTo(map);

    // Selected parcel highlight
    selectedParcelLayer = L.geoJSON(null, {
      style: {
        color: '#f59e0b',
        weight: 4,
        opacity: 1,
        fillColor: '#f59e0b',
        fillOpacity: 0.25,
      }
    }).addTo(map);

    // Map click — query for parcel at click point
    map.on('click', onMapClick);

    // Load parcel polygons when zoomed in enough
    map.on('moveend', () => {
      if (layerStates.parcels && map.getZoom() >= 16) {
        clearTimeout(parcelLoadTimer);
        parcelLoadTimer = setTimeout(loadVisibleParcels, 400);
      } else if (map.getZoom() < 16) {
        parcelLayer.clearLayers();
        lastLoadedBounds = null;
      }
    });

    map.zoomControl.setPosition('topleft');

    return map;
  }

  /**
   * County boundary outlines
   */
  function addCountyBoundaries() {
    CountyRegistry.getAll().forEach(county => {
      if (county.bounds) {
        const rect = L.rectangle(county.bounds, {
          color: county.color,
          weight: 2,
          fillOpacity: 0.02,
          fillColor: county.color,
          dashArray: '8, 4',
          interactive: false,
        }).addTo(map);
        rect.bindTooltip(county.shortName + ' County', {
          permanent: false,
          direction: 'center',
          className: 'county-label',
        });
      }
    });
  }

  /**
   * Handle map click
   */
  async function onMapClick(e) {
    if (map.getZoom() < 12) return; // Too zoomed out

    const { lat, lng } = e.latlng;
    showLoading(true);

    const county = findCountyForPoint(lat, lng);

    try {
      const parcel = await ParcelService.getParcelAtPoint(lat, lng, county);
      if (parcel) {
        highlightParcel(parcel);
        if (onParcelSelect) onParcelSelect(parcel);
      } else {
        showLoading(false);
        console.log('[Map] No parcel found at', lat, lng);
      }
    } catch (err) {
      console.error('[Map] Parcel query error:', err);
      showLoading(false);
    }
  }

  /**
   * Handle click on a loaded GeoJSON feature
   */
  async function handleFeatureClick(feature) {
    const props = feature.properties || {};
    // We have basic display fields, but need full detail
    // Use centroid of the feature to query full attributes
    let lat, lng;
    if (feature.geometry.type === 'Polygon') {
      const ring = feature.geometry.coordinates[0];
      let cx = 0, cy = 0;
      ring.forEach(([x, y]) => { cx += x; cy += y; });
      lng = cx / ring.length;
      lat = cy / ring.length;
    } else if (feature.geometry.type === 'Point') {
      [lng, lat] = feature.geometry.coordinates;
    }

    if (lat && lng) {
      showLoading(true);
      const county = findCountyForPoint(lat, lng);
      const parcel = await ParcelService.getParcelAtPoint(lat, lng, county);
      if (parcel) {
        highlightParcel(parcel);
        if (onParcelSelect) onParcelSelect(parcel);
      }
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
   * Highlight a parcel on the map
   */
  function highlightParcel(parcel) {
    selectedParcelLayer.clearLayers();
    showLoading(false);

    if (parcel.geometry) {
      const geoJson = geojsonFromArcgis(parcel.geometry);
      if (geoJson) {
        selectedParcelLayer.addData({
          type: 'Feature',
          geometry: geoJson,
          properties: {},
        });
        // Fit map to the parcel bounds
        const bounds = selectedParcelLayer.getBounds();
        if (bounds.isValid()) {
          map.flyToBounds(bounds.pad(0.5), { duration: 0.8, maxZoom: 18 });
        }
      }
    } else if (parcel.centroid) {
      // No polygon geometry (centroid only) — just fly to point
      map.flyTo([parcel.centroid.lat, parcel.centroid.lng], Math.max(map.getZoom(), 17), {
        duration: 0.8,
      });
      // Add a marker
      L.circleMarker([parcel.centroid.lat, parcel.centroid.lng], {
        radius: 8,
        color: '#f59e0b',
        weight: 3,
        fillColor: '#f59e0b',
        fillOpacity: 0.3,
      }).addTo(selectedParcelLayer);
    }
  }

  /**
   * Convert ArcGIS geometry to GeoJSON
   */
  function geojsonFromArcgis(geom) {
    if (!geom) return null;
    if (geom.rings) {
      return { type: 'Polygon', coordinates: geom.rings };
    }
    if (geom.x !== undefined) {
      return { type: 'Point', coordinates: [geom.x, geom.y] };
    }
    return null;
  }

  /**
   * Load parcel polygons visible in current extent
   */
  async function loadVisibleParcels() {
    if (map.getZoom() < 16 || isLoading) return;

    const bounds = map.getBounds();

    // Don't reload if we're still within the last loaded area
    if (lastLoadedBounds && lastLoadedBounds.contains(bounds)) return;

    isLoading = true;
    showLoading(true);

    try {
      // Get the active county filter
      const countyFilter = document.getElementById('county-filter');
      const countyId = countyFilter ? countyFilter.value : 'all';
      const county = countyId !== 'all' ? CountyRegistry.get(countyId) : null;

      const data = await ParcelService.getParcelsInExtent(bounds, county);
      parcelLayer.clearLayers();

      if (data.features && data.features.length > 0) {
        console.log(`[Map] Loaded ${data.features.length} parcels`);
        data.features.forEach(feature => {
          const gj = geojsonFromArcgis(feature.geometry);
          if (gj) {
            parcelLayer.addData({
              type: 'Feature',
              geometry: gj,
              properties: feature.attributes || {},
            });
          }
        });
        lastLoadedBounds = bounds.pad(0.1);
      } else {
        console.log('[Map] No parcels in this extent');
      }
    } catch (err) {
      console.error('[Map] Error loading parcels:', err);
    } finally {
      isLoading = false;
      showLoading(false);
    }
  }

  function setBasemap(name) {
    if (!basemapLayers[name]) return;
    Object.values(basemapLayers).forEach(layer => map.removeLayer(layer));
    basemapLayers[name].addTo(map);
    activeBasemap = name;
  }

  function toggleLayer(name, enabled) {
    layerStates[name] = enabled;
    if (name === 'parcels') {
      if (enabled && map.getZoom() >= 16) {
        loadVisibleParcels();
      } else {
        parcelLayer.clearLayers();
      }
    }
  }

  function flyTo(lat, lng, zoom = 17) {
    map.flyTo([lat, lng], zoom, { duration: 1.0 });
  }

  function flyToCounty(countyId) {
    if (countyId === 'all') {
      map.flyToBounds(NWA_REGION.bounds, { duration: 1.0, padding: [20, 20] });
      return;
    }
    const county = CountyRegistry.get(countyId);
    if (county && county.bounds) {
      map.flyToBounds(county.bounds, { duration: 1.0, padding: [20, 20] });
    } else if (county) {
      map.flyTo(county.center, county.zoom || 11, { duration: 1.0 });
    }
  }

  function showLoading(show) {
    const el = document.getElementById('map-loading');
    if (el) el.classList.toggle('hidden', !show);
  }

  function onSelect(callback) {
    onParcelSelect = callback;
  }

  function getMap() { return map; }

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
