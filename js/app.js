/**
 * Main Application Module
 *
 * Wires together all modules: Map, Search, ParcelService, UI, and Counties.
 */

(function () {
  'use strict';

  // ---- INITIALIZATION ----
  document.addEventListener('DOMContentLoaded', () => {
    // Load any custom (user-added) counties from localStorage
    CountyRegistry.loadCustomCounties();

    // Initialize modules
    MapModule.init('map');
    UIModule.init();
    SearchModule.init({
      onSelect: handleSearchResult,
    });

    // Set up UI event handlers
    initSidePanel();
    initCountyFilter();
    initCountyList();
    initBasemapButtons();
    initLayerToggles();
    initMapControls();
    initAddCountyModal();

    // Register parcel select callback
    MapModule.onSelect(handleParcelSelected);

    // Watch for new counties
    CountyRegistry.onChange(() => {
      refreshCountyFilter();
      refreshCountyList();
    });
  });

  // ---- HANDLERS ----

  /**
   * Handle search result selection
   */
  async function handleSearchResult(result) {
    if (result.type === 'parcel' && result.data) {
      // Directly selected a parcel from search
      MapModule.highlightParcel(result.data);
      UIModule.showPropertyDetail(result.data);
    } else if (result.lat && result.lng) {
      // Geocoded address - fly to location and try to find parcel
      MapModule.flyTo(result.lat, result.lng, 18);

      // Wait a moment for the map to settle, then query parcel
      setTimeout(async () => {
        const county = MapModule.findCountyForPoint(result.lat, result.lng);
        const parcel = await ParcelService.getParcelAtPoint(result.lat, result.lng, county);
        if (parcel) {
          MapModule.highlightParcel(parcel);
          UIModule.showPropertyDetail(parcel);
        }
      }, 1200);
    }
  }

  /**
   * Handle parcel selected from map click
   */
  function handleParcelSelected(parcel) {
    UIModule.showPropertyDetail(parcel);
  }

  // ---- SIDE PANEL ----

  function initSidePanel() {
    const panel = document.getElementById('side-panel');
    const overlay = document.getElementById('side-panel-overlay');
    const menuBtn = document.getElementById('menu-toggle');
    const closeBtn = document.getElementById('side-panel-close');

    function openPanel() {
      panel.classList.add('open');
      overlay.classList.remove('hidden');
      overlay.classList.add('visible');
    }

    function closePanel() {
      panel.classList.remove('open');
      overlay.classList.remove('visible');
      setTimeout(() => overlay.classList.add('hidden'), 300);
    }

    menuBtn.addEventListener('click', openPanel);
    closeBtn.addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);
  }

  // ---- COUNTY FILTER ----

  function initCountyFilter() {
    refreshCountyFilter();
    const select = document.getElementById('county-filter');
    select.addEventListener('change', () => {
      MapModule.flyToCounty(select.value);
    });
  }

  function refreshCountyFilter() {
    const select = document.getElementById('county-filter');
    const current = select.value;
    const options = '<option value="all">All Counties</option>' +
      CountyRegistry.getAll().map(c =>
        `<option value="${c.id}">${c.shortName}</option>`
      ).join('');
    select.innerHTML = options;
    if ([...select.options].some(o => o.value === current)) {
      select.value = current;
    }
  }

  // ---- COUNTY LIST (side panel) ----

  function initCountyList() {
    refreshCountyList();
  }

  function refreshCountyList() {
    const container = document.getElementById('county-list');
    container.innerHTML = CountyRegistry.getAll().map(c => `
      <div class="county-item">
        <span class="county-dot" style="background:${c.color}"></span>
        <span class="county-name">${c.name}</span>
        <span class="county-fips">${c.fipsCode}</span>
      </div>
    `).join('');
  }

  // ---- BASEMAP BUTTONS ----

  function initBasemapButtons() {
    document.querySelectorAll('.basemap-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        MapModule.setBasemap(btn.dataset.basemap);
      });
    });
  }

  // ---- LAYER TOGGLES ----

  function initLayerToggles() {
    const layers = {
      'layer-parcels': 'parcels',
      'layer-zoning': 'zoning',
      'layer-floodplain': 'floodplain',
      'layer-utilities': 'utilities',
      'layer-master-plan': 'masterPlan',
    };

    Object.entries(layers).forEach(([elId, layerName]) => {
      const checkbox = document.getElementById(elId);
      if (checkbox) {
        checkbox.addEventListener('change', () => {
          MapModule.toggleLayer(layerName, checkbox.checked);
        });
      }
    });
  }

  // ---- MAP CONTROLS ----

  function initMapControls() {
    const locateBtn = document.getElementById('locate-btn');
    if (locateBtn) {
      locateBtn.addEventListener('click', () => MapModule.locateUser());
    }

    const measureBtn = document.getElementById('measure-btn');
    if (measureBtn) {
      measureBtn.addEventListener('click', () => {
        measureBtn.classList.toggle('active');
        // Measurement tool would be implemented here
      });
    }
  }

  // ---- ADD COUNTY MODAL ----

  function initAddCountyModal() {
    const modal = document.getElementById('add-county-modal');
    const openBtn = document.getElementById('add-county-btn');
    const cancelBtn = document.getElementById('cancel-add-county');
    const form = document.getElementById('add-county-form');
    const overlay = modal.querySelector('.modal-overlay');

    function openModal() { modal.classList.remove('hidden'); }
    function closeModal() { modal.classList.add('hidden'); }

    openBtn.addEventListener('click', openModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = document.getElementById('new-county-name').value.trim();
      const stateFips = document.getElementById('new-county-state').value.trim();
      const countyFips = document.getElementById('new-county-fips').value.trim();
      const lat = parseFloat(document.getElementById('new-county-center-lat').value);
      const lng = parseFloat(document.getElementById('new-county-center-lng').value);
      const assessorUrl = document.getElementById('new-county-assessor-url').value.trim();

      if (!name || !stateFips || !countyFips || isNaN(lat) || isNaN(lng)) {
        return;
      }

      CountyRegistry.register({
        shortName: name,
        name: `${name} County`,
        stateFips,
        countyFips,
        center: [lat, lng],
        bounds: [[lat - 0.2, lng - 0.3], [lat + 0.2, lng + 0.3]],
        assessorUrl: assessorUrl || undefined,
      });

      form.reset();
      document.getElementById('new-county-state').value = '05';
      closeModal();
    });
  }

})();
