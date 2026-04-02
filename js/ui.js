/**
 * UI Module
 *
 * Renders property detail panels, manages tab navigation,
 * and handles the detail panel open/close/drag behavior.
 */

const UIModule = (() => {
  let detailPanel = null;
  let currentParcel = null;
  let dragState = { active: false, startY: 0, startTranslate: 0 };

  /**
   * Initialize UI components
   */
  function init() {
    detailPanel = document.getElementById('detail-panel');
    initTabs();
    initDetailPanelDrag();
    initCloseButton();
  }

  /**
   * Tab navigation
   */
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
      });
    });
  }

  /**
   * Detail panel drag-to-dismiss (mobile)
   */
  function initDetailPanelDrag() {
    const handle = document.getElementById('detail-handle');
    if (!handle) return;

    handle.addEventListener('touchstart', (e) => {
      dragState.active = true;
      dragState.startY = e.touches[0].clientY;
      detailPanel.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!dragState.active) return;
      const dy = e.touches[0].clientY - dragState.startY;
      if (dy > 0) {
        detailPanel.style.transform = `translateY(${dy}px)`;
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!dragState.active) return;
      dragState.active = false;
      detailPanel.style.transition = '';
      const rect = detailPanel.getBoundingClientRect();
      const threshold = window.innerHeight * 0.5;
      if (rect.top > threshold) {
        closeDetail();
      } else {
        detailPanel.style.transform = '';
        detailPanel.classList.add('open');
      }
    });
  }

  /**
   * Close button
   */
  function initCloseButton() {
    const closeBtn = document.getElementById('detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDetail);
  }

  /**
   * Open the detail panel with property data
   */
  async function showPropertyDetail(parcel) {
    currentParcel = parcel;
    detailPanel.classList.remove('closed');
    detailPanel.classList.add('open');
    detailPanel.style.transform = '';

    // Set header
    document.getElementById('detail-address').textContent =
      parcel.address || parcel.parcelId || 'Unknown Property';
    document.getElementById('detail-subtitle').textContent =
      [parcel.city, parcel.county ? `${parcel.county} County` : '', 'AR', parcel.zip]
        .filter(Boolean).join(', ');

    // Render basic data immediately
    renderOverview(parcel);
    renderZoning(parcel);
    renderOwnership(parcel);
    renderImprovements(parcel);
    renderTransactions(parcel);
    renderUtilities(parcel);

    // Activate overview tab
    document.querySelector('.tab-btn[data-tab="overview"]').click();

    // Enrich with flood data and update
    try {
      const enriched = await ParcelService.getFullPropertyDetail(parcel);
      currentParcel = enriched;
      renderOverview(enriched);
      renderUtilities(enriched);
    } catch (e) {
      console.warn('Failed to enrich parcel data:', e);
    }
  }

  /**
   * Close the detail panel
   */
  function closeDetail() {
    detailPanel.classList.remove('open');
    detailPanel.classList.add('closed');
    currentParcel = null;
  }

  /**
   * Format currency
   */
  function fmtCurrency(val) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  /**
   * Format number
   */
  function fmtNum(val, decimals = 0) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return Number(val).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  /**
   * Display value or N/A
   */
  function display(val) {
    if (val === null || val === undefined || val === '') return 'N/A';
    return String(val);
  }

  /**
   * Create a data card HTML
   */
  function dataCard(title, rows) {
    const rowsHtml = rows
      .filter(([, val]) => val !== undefined)
      .map(([label, value, badgeClass]) => {
        const valHtml = badgeClass
          ? `<span class="badge ${badgeClass}">${value}</span>`
          : `<span class="data-value">${value}</span>`;
        return `<div class="data-row"><span class="data-label">${label}</span>${valHtml}</div>`;
      }).join('');

    return `<div class="data-card"><div class="data-card-title">${title}</div>${rowsHtml}</div>`;
  }

  /**
   * Create stat boxes
   */
  function statRow(stats) {
    return '<div class="stat-row">' + stats.map(([value, label]) =>
      `<div class="stat-box"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`
    ).join('') + '</div>';
  }

  // ---- TAB RENDERERS ----

  function renderOverview(p) {
    const el = document.getElementById('overview-content');
    const assessorUrl = ParcelService.getAssessorUrl(p);
    const assessorLink = assessorUrl
      ? `<a href="${assessorUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="margin-top:8px;display:inline-block;">View on County Assessor</a>`
      : '';

    // Determine property type badge
    const propType = p.landUseDesc || p.landUse || p.bldgType || 'Unknown';
    const propBadge = getPropertyBadge(propType);

    // Key stats based on property type
    const stats = [];
    if (p.acres) stats.push([fmtNum(p.acres, 2), 'Acres']);
    if (p.sqft) stats.push([fmtNum(p.sqft), 'Sq Ft']);
    if (p.yearBuilt) stats.push([p.yearBuilt, 'Year Built']);
    if (p.bedrooms) stats.push([p.bedrooms, 'Beds']);
    if (p.bathrooms) stats.push([p.bathrooms, 'Baths']);
    if (p.appraisedValue) stats.push([fmtCurrency(p.appraisedValue), 'Appraised']);
    if (stats.length === 0) {
      stats.push(['--', 'Acres'], ['--', 'Sq Ft'], ['--', 'Year Built']);
    }

    el.innerHTML = `
      <div style="margin-bottom:8px;">
        <span class="badge ${propBadge.cls}">${propBadge.label}</span>
        ${p.county ? `<span class="badge badge-gray" style="margin-left:4px;">${p.county} County</span>` : ''}
      </div>
      ${statRow(stats)}
      ${dataCard('Property Summary', [
        ['Parcel ID', display(p.parcelId)],
        ['Address', display(p.address)],
        ['City', display(p.city)],
        ['Zip', display(p.zip)],
        ['Land Use', display(p.landUseDesc || p.landUse)],
        ['Acreage', p.acres ? fmtNum(p.acres, 2) : 'N/A'],
      ])}
      ${dataCard('Valuation', [
        ['Appraised Value', fmtCurrency(p.appraisedValue)],
        ['Assessed Value', fmtCurrency(p.assessedValue)],
        ['Land Value', fmtCurrency(p.landValue)],
        ['Improvement Value', fmtCurrency(p.improvementValue)],
        ['Annual Tax', fmtCurrency(p.taxAmount)],
      ])}
      ${assessorLink}
    `;
  }

  function renderZoning(p) {
    const el = document.getElementById('zoning-content');
    el.innerHTML = `
      ${dataCard('Zoning Classification', [
        ['Zone Code', display(p.zoning), p.zoning ? 'badge-blue' : ''],
        ['Description', display(p.zoningDesc)],
        ['Land Use Code', display(p.landUse)],
        ['Land Use Description', display(p.landUseDesc)],
      ])}
      ${dataCard('Flood Zone', [
        ['FEMA Zone', display(p.floodZone?.zone), getFloodBadge(p.floodZone?.zone)],
        ['Floodway', display(p.floodZone?.floodway)],
        ['FIRM Panel', display(p.floodZone?.panelNumber)],
        ['Effective Date', display(p.floodZone?.effectiveDate)],
        ['Base Flood Elevation', display(p.floodZone?.staticBFE)],
      ])}
      ${dataCard('Development Notes', [
        ['County', display(p.county)],
        ['Parcel ID', display(p.parcelId)],
        ['Acreage', p.acres ? fmtNum(p.acres, 2) + ' ac' : 'N/A'],
      ])}
      <p style="font-size:12px;color:var(--text-light);margin-top:8px;">
        Zoning data sourced from county GIS. Verify current zoning with the local planning department before making development decisions.
      </p>
    `;
  }

  function renderOwnership(p) {
    const el = document.getElementById('ownership-content');
    const ownerAddr = [p.ownerAddress, p.ownerCity, p.ownerState, p.ownerZip].filter(Boolean).join(', ');
    el.innerHTML = `
      ${dataCard('Current Owner', [
        ['Owner Name', display(p.owner)],
        ['Mailing Address', display(ownerAddr || null)],
      ])}
      ${dataCard('Parcel Information', [
        ['Parcel ID', display(p.parcelId)],
        ['Property Address', display(p.address)],
        ['County', display(p.county)],
        ['Legal Description', display(p._raw?.LEGAL_DESC || p._raw?.LEGAL || p._raw?.LEGAL1)],
      ])}
    `;
  }

  function renderImprovements(p) {
    const el = document.getElementById('improvements-content');

    // Determine if residential or commercial and show appropriate fields
    const isResidential = isResidentialProperty(p);

    let improvementRows;
    if (isResidential) {
      improvementRows = [
        ['Building Type', display(p.bldgType)],
        ['Year Built', display(p.yearBuilt)],
        ['Living Area', p.sqft ? fmtNum(p.sqft) + ' sq ft' : 'N/A'],
        ['Bedrooms', display(p.bedrooms)],
        ['Full Baths', display(p.bathrooms)],
        ['Half Baths', display(p.halfBath)],
        ['Stories', display(p.stories)],
        ['Foundation', display(p.foundation)],
        ['Roof Type', display(p.roofType)],
        ['Heating', display(p.heating)],
        ['Cooling', display(p.cooling)],
        ['Garage', display(p.garage)],
        ['Pool', display(p.pool)],
      ];
    } else {
      improvementRows = [
        ['Building Type', display(p.bldgType)],
        ['Year Built', display(p.yearBuilt)],
        ['Total Area', p.sqft ? fmtNum(p.sqft) + ' sq ft' : 'N/A'],
        ['Stories', display(p.stories)],
        ['Units', display(p.units)],
        ['Foundation', display(p.foundation)],
        ['Roof Type', display(p.roofType)],
        ['Heating', display(p.heating)],
        ['Cooling', display(p.cooling)],
      ];
    }

    const stats = [];
    if (p.sqft) stats.push([fmtNum(p.sqft), 'Sq Ft']);
    if (p.yearBuilt) stats.push([p.yearBuilt, 'Year Built']);
    if (p.bedrooms) stats.push([p.bedrooms, 'Beds']);
    if (p.bathrooms) {
      const bathStr = p.halfBath ? `${p.bathrooms}/${p.halfBath}` : `${p.bathrooms}`;
      stats.push([bathStr, p.halfBath ? 'Full/Half Bath' : 'Baths']);
    }
    if (p.stories) stats.push([p.stories, 'Stories']);

    el.innerHTML = `
      ${stats.length > 0 ? statRow(stats) : ''}
      ${dataCard('Improvement Details', improvementRows)}
      ${dataCard('Improvement Value', [
        ['Improvement Value', fmtCurrency(p.improvementValue)],
        ['Land Value', fmtCurrency(p.landValue)],
        ['Total Appraised', fmtCurrency(p.appraisedValue)],
      ])}
    `;
  }

  function renderTransactions(p) {
    const el = document.getElementById('transactions-content');
    const hasTransaction = p.lastSaleDate || p.lastSalePrice;

    if (!hasTransaction) {
      el.innerHTML = `
        ${dataCard('Transaction History', [
          ['Last Sale Date', 'N/A'],
          ['Last Sale Price', 'N/A'],
        ])}
        <p style="font-size:12px;color:var(--text-light);margin-top:8px;">
          Full transaction history may be available through the county assessor's office or clerk's records.
        </p>
      `;
      return;
    }

    el.innerHTML = `
      <div class="transaction-list">
        <div class="transaction-item">
          <div class="tx-date">${display(p.lastSaleDate)}</div>
          <div class="tx-price">${fmtCurrency(p.lastSalePrice)}</div>
          <div class="tx-type">Most Recent Sale</div>
          ${p.deedBook ? `<div class="tx-parties">Deed Book: ${p.deedBook}, Page: ${display(p.deedPage)}</div>` : ''}
        </div>
      </div>
      ${dataCard('Sale Details', [
        ['Sale Date', display(p.lastSaleDate)],
        ['Sale Price', fmtCurrency(p.lastSalePrice)],
        ['Deed Book', display(p.deedBook)],
        ['Deed Page', display(p.deedPage)],
        ['Price Per Acre', p.lastSalePrice && p.acres ? fmtCurrency(p.lastSalePrice / p.acres) + '/ac' : 'N/A'],
        ['Price Per Sq Ft', p.lastSalePrice && p.sqft ? fmtCurrency(p.lastSalePrice / p.sqft) + '/sf' : 'N/A'],
      ])}
      <p style="font-size:12px;color:var(--text-light);margin-top:8px;">
        Additional transaction history available through the county clerk's records.
      </p>
    `;
  }

  function renderUtilities(p) {
    const el = document.getElementById('utilities-content');
    el.innerHTML = `
      ${dataCard('Flood Zone', [
        ['FEMA Zone', display(p.floodZone?.zone), getFloodBadge(p.floodZone?.zone)],
        ['Floodway', display(p.floodZone?.floodway)],
        ['Base Flood Elevation', display(p.floodZone?.staticBFE)],
      ])}
      ${dataCard('Utility Availability', [
        ['Water', 'Contact local utility provider'],
        ['Sewer', 'Contact local utility provider'],
        ['Electric', 'Contact local utility provider'],
        ['Gas', 'Contact local utility provider'],
      ])}
      ${dataCard('Infrastructure', [
        ['County', display(p.county)],
        ['Road Access', 'Verify with county'],
        ['Fire District', 'Verify with county'],
        ['School District', 'Verify with county'],
      ])}
      <p style="font-size:12px;color:var(--text-light);margin-top:8px;">
        Utility availability varies by location. Contact the local utility providers for service confirmation. Key providers in NWA include: SWEPCO/OGE (electric),
        Arkansas Oklahoma Gas (natural gas), Beaver Water District / local municipal systems (water), and various sewer districts.
      </p>
    `;
  }

  // ---- HELPERS ----

  function isResidentialProperty(p) {
    const type = (p.landUseDesc || p.landUse || p.bldgType || '').toUpperCase();
    return /RESID|SFR|SINGLE|DUPLEX|TRIPLEX|MULTI|HOME|HOUSE|CONDO|TOWNHOME/.test(type)
      || p.bedrooms != null;
  }

  function getPropertyBadge(type) {
    const upper = (type || '').toUpperCase();
    if (/RESID|SFR|SINGLE|HOME|HOUSE/.test(upper)) return { label: 'Residential', cls: 'badge-blue' };
    if (/COMMER|OFFICE|RETAIL/.test(upper)) return { label: 'Commercial', cls: 'badge-yellow' };
    if (/INDUST|WAREHOUSE/.test(upper)) return { label: 'Industrial', cls: 'badge-red' };
    if (/AGRI|FARM|RANCH/.test(upper)) return { label: 'Agricultural', cls: 'badge-green' };
    if (/VACANT|LAND/.test(upper)) return { label: 'Vacant Land', cls: 'badge-gray' };
    if (/MULTI|APART|DUPLEX/.test(upper)) return { label: 'Multi-Family', cls: 'badge-blue' };
    return { label: type || 'Unknown', cls: 'badge-gray' };
  }

  function getFloodBadge(zone) {
    if (!zone) return '';
    const z = zone.toUpperCase();
    if (/^A|^V/.test(z)) return 'badge-red';
    if (/^B|^X.*SHADED|^0\.2/.test(z)) return 'badge-yellow';
    if (/^C|^X$|MINIMAL/.test(z)) return 'badge-green';
    return 'badge-gray';
  }

  return {
    init,
    showPropertyDetail,
    closeDetail,
  };
})();
