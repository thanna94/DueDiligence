/**
 * Walkingstick Feasibility Assistant
 *
 * Main Application Module — wires together Map, Search, ParcelService, UI, and Counties.
 * Handles ATTOM API key management and error reporting.
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    // Load custom counties
    CountyRegistry.loadCustomCounties();

    // Initialize modules
    MapModule.init('map');
    UIModule.init();
    SearchModule.init({ onSelect: handleSearchResult });

    // Wire up UI
    initSidePanel();
    initCountyFilter();
    initCountyList();
    initBasemapButtons();
    initLayerToggles();
    initMapControls();
    initAddCountyModal();
    initAttomKeyPanel();

    // Parcel select callback
    MapModule.onSelect(handleParcelSelected);

    // County change listener
    CountyRegistry.onChange(() => {
      refreshCountyFilter();
      refreshCountyList();
    });

    // Show status if ATTOM key is already set
    updateAttomStatus();

    console.log('[Walkingstick] Initialized. ATTOM key:', localStorage.getItem('attom_api_key') ? 'SET' : 'NOT SET');
  });

  // ---- HANDLERS ----

  async function handleSearchResult(result) {
    if (result.type === 'parcel' && result.data) {
      MapModule.highlightParcel(result.data);
      UIModule.showPropertyDetail(result.data);
    } else if (result.lat && result.lng) {
      MapModule.flyTo(result.lat, result.lng, 18);
      // Query for parcel at the geocoded location
      setTimeout(async () => {
        try {
          const county = MapModule.findCountyForPoint(result.lat, result.lng);
          const parcel = await ParcelService.getParcelAtPoint(result.lat, result.lng, county);
          if (parcel) {
            MapModule.highlightParcel(parcel);
            UIModule.showPropertyDetail(parcel);
          }
        } catch (e) {
          console.error('[App] Error querying parcel at geocoded location:', e);
        }
      }, 1200);
    }
  }

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
    document.getElementById('county-filter').addEventListener('change', (e) => {
      MapModule.flyToCounty(e.target.value);
    });
  }

  function refreshCountyFilter() {
    const select = document.getElementById('county-filter');
    const current = select.value;
    select.innerHTML = '<option value="all">All Counties</option>' +
      CountyRegistry.getAll().map(c => `<option value="${c.id}">${c.shortName}</option>`).join('');
    if ([...select.options].some(o => o.value === current)) select.value = current;
  }

  function initCountyList() { refreshCountyList(); }

  function refreshCountyList() {
    document.getElementById('county-list').innerHTML = CountyRegistry.getAll().map(c => `
      <div class="county-item">
        <span class="county-dot" style="background:${c.color}"></span>
        <span class="county-name">${c.name}</span>
        <span class="county-fips">${c.fipsCode}</span>
      </div>
    `).join('');
  }

  // ---- BASEMAP ----

  function initBasemapButtons() {
    document.querySelectorAll('.basemap-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        MapModule.setBasemap(btn.dataset.basemap);
      });
    });
  }

  // ---- LAYERS ----

  function initLayerToggles() {
    const layers = {
      'layer-parcels': 'parcels',
      'layer-zoning': 'zoning',
      'layer-floodplain': 'floodplain',
      'layer-utilities': 'utilities',
      'layer-master-plan': 'masterPlan',
    };
    Object.entries(layers).forEach(([elId, name]) => {
      const cb = document.getElementById(elId);
      if (cb) cb.addEventListener('change', () => MapModule.toggleLayer(name, cb.checked));
    });
  }

  // ---- MAP CONTROLS ----

  function initMapControls() {
    const locateBtn = document.getElementById('locate-btn');
    if (locateBtn) locateBtn.addEventListener('click', () => MapModule.locateUser());

    const measureBtn = document.getElementById('measure-btn');
    if (measureBtn) measureBtn.addEventListener('click', () => measureBtn.classList.toggle('active'));
  }

  // ---- ATTOM API KEY ----

  function initAttomKeyPanel() {
    const input = document.getElementById('attom-api-key');
    const saveBtn = document.getElementById('save-attom-key');
    const status = document.getElementById('attom-key-status');

    // Populate if already set
    const existing = localStorage.getItem('attom_api_key');
    if (existing && input) {
      input.value = existing;
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const key = input.value.trim();
        if (key) {
          localStorage.setItem('attom_api_key', key);
          status.textContent = 'Key saved! Property lookups will now include ATTOM data.';
          status.style.color = 'var(--success)';
        } else {
          localStorage.removeItem('attom_api_key');
          status.textContent = 'Key removed.';
          status.style.color = 'var(--text-secondary)';
        }
        status.style.display = 'block';
        setTimeout(() => { status.style.display = 'none'; }, 4000);
        updateAttomStatus();
      });
    }
  }

  function updateAttomStatus() {
    const saveBtn = document.getElementById('save-attom-key');
    if (saveBtn && localStorage.getItem('attom_api_key')) {
      saveBtn.textContent = 'Update Key';
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

      if (!name || !stateFips || !countyFips || isNaN(lat) || isNaN(lng)) return;

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
