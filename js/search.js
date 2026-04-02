/**
 * Search Module
 *
 * Handles address search, parcel ID search, and geocoding.
 * Uses ESRI geocoder for address lookup and ParcelService for data.
 */

const SearchModule = (() => {
  let searchInput = null;
  let clearBtn = null;
  let dropdown = null;
  let debounceTimer = null;
  let onResultSelect = null;
  let activeIndex = -1;
  let currentResults = [];

  /**
   * Initialize the search module
   */
  function init(options = {}) {
    searchInput = document.getElementById('address-search');
    clearBtn = document.getElementById('search-clear');
    dropdown = document.getElementById('search-results');
    onResultSelect = options.onSelect || null;

    if (!searchInput) return;

    searchInput.addEventListener('input', onInput);
    searchInput.addEventListener('keydown', onKeyDown);
    searchInput.addEventListener('focus', () => {
      if (currentResults.length > 0) showDropdown();
    });

    clearBtn.addEventListener('click', clearSearch);

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-container')) hideDropdown();
    });
  }

  /**
   * Handle input changes (debounced)
   */
  function onInput(e) {
    const query = e.target.value.trim();
    clearBtn.classList.toggle('hidden', query.length === 0);

    clearTimeout(debounceTimer);

    if (query.length < 3) {
      hideDropdown();
      currentResults = [];
      return;
    }

    debounceTimer = setTimeout(() => performSearch(query), 350);
  }

  /**
   * Handle keyboard navigation
   */
  function onKeyDown(e) {
    const items = dropdown.querySelectorAll('.search-result-item');

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        updateActiveItem(items);
        break;
      case 'ArrowUp':
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, -1);
        updateActiveItem(items);
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < currentResults.length) {
          selectResult(currentResults[activeIndex]);
        } else if (currentResults.length > 0) {
          selectResult(currentResults[0]);
        }
        break;
      case 'Escape':
        hideDropdown();
        searchInput.blur();
        break;
    }
  }

  /**
   * Update the visually active item in dropdown
   */
  function updateActiveItem(items) {
    items.forEach((item, i) => {
      item.classList.toggle('active', i === activeIndex);
    });
  }

  /**
   * Perform search using multiple strategies
   */
  async function performSearch(query) {
    const results = [];

    // Get active county filter
    const countyFilter = document.getElementById('county-filter');
    const countyId = countyFilter ? countyFilter.value : 'all';
    const county = countyId !== 'all' ? CountyRegistry.get(countyId) : null;

    // Determine if query looks like a parcel ID
    const isParcelId = /^\d{2,3}-\d/.test(query) || /^\d{8,}$/.test(query);

    try {
      // Run geocoding and parcel searches in parallel
      const promises = [];

      // ESRI geocoding for address
      promises.push(geocodeAddress(query));

      // Parcel service searches
      if (isParcelId) {
        promises.push(ParcelService.searchByParcelId(query, county));
      } else {
        promises.push(ParcelService.searchByAddress(query, county));
      }

      const [geocodeResults, parcelResults] = await Promise.all(promises);

      // Add geocoded addresses
      if (geocodeResults) {
        geocodeResults.forEach(r => {
          results.push({
            type: 'geocode',
            label: r.text || r.address,
            secondary: r.secondaryText || '',
            lat: r.latlng ? r.latlng.lat : r.location?.y,
            lng: r.latlng ? r.latlng.lng : r.location?.x,
            data: r,
          });
        });
      }

      // Add parcel results
      if (parcelResults) {
        parcelResults.forEach(p => {
          results.push({
            type: 'parcel',
            label: p.address || p.parcelId || 'Unknown',
            secondary: [p.owner, p.county ? `${p.county} County` : ''].filter(Boolean).join(' - '),
            lat: p.centroid?.lat,
            lng: p.centroid?.lng,
            data: p,
          });
        });
      }
    } catch (err) {
      console.error('Search error:', err);
    }

    currentResults = results;
    activeIndex = -1;
    renderResults(results);
  }

  /**
   * Geocode an address using ESRI geocoder
   */
  async function geocodeAddress(query) {
    try {
      const params = new URLSearchParams({
        text: query,
        f: 'json',
        maxLocations: 5,
        location: '-94.25,35.85', // NWA center for bias
        distance: 100000, // 100km radius bias
        outFields: '*',
      });
      const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${params}`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (data.candidates) {
        return data.candidates
          .filter(c => c.score > 70)
          .slice(0, 5)
          .map(c => ({
            text: c.address,
            secondaryText: `Score: ${c.score}`,
            location: c.location,
            latlng: { lat: c.location.y, lng: c.location.x },
            attributes: c.attributes,
          }));
      }
    } catch (e) {
      console.warn('Geocoding failed:', e.message);
    }
    return [];
  }

  /**
   * Render search results in dropdown
   */
  function renderResults(results) {
    if (results.length === 0) {
      dropdown.innerHTML = '<div class="search-result-item"><span class="result-text"><span class="result-primary">No results found</span></span></div>';
      showDropdown();
      return;
    }

    dropdown.innerHTML = results.map((r, i) => `
      <div class="search-result-item" data-index="${i}">
        <span class="result-icon">
          ${r.type === 'parcel' ?
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/></svg>' :
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'
          }
        </span>
        <span class="result-text">
          <span class="result-primary">${escapeHtml(r.label)}</span>
          ${r.secondary ? `<div class="result-secondary">${escapeHtml(r.secondary)}</div>` : ''}
        </span>
      </div>
    `).join('');

    // Attach click handlers
    dropdown.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index);
        if (idx >= 0 && idx < results.length) selectResult(results[idx]);
      });
    });

    showDropdown();
  }

  /**
   * Handle result selection
   */
  function selectResult(result) {
    searchInput.value = result.label;
    hideDropdown();
    clearBtn.classList.remove('hidden');

    if (onResultSelect) {
      onResultSelect(result);
    }
  }

  /**
   * Clear search input
   */
  function clearSearch() {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    hideDropdown();
    currentResults = [];
    searchInput.focus();
  }

  function showDropdown() {
    dropdown.classList.remove('hidden');
  }

  function hideDropdown() {
    dropdown.classList.add('hidden');
    activeIndex = -1;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    init,
    clearSearch,
    geocodeAddress,
  };
})();
