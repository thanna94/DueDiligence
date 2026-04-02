/**
 * UI Module
 *
 * Renders property detail panels with data from Arkansas CAMP parcels.
 * Links to county assessor sites for detailed CAMA data (beds, baths, sqft, etc.)
 * that isn't available in the statewide GIS layer.
 */

const UIModule = (() => {
  let detailPanel = null;
  let currentParcel = null;
  let dragState = { active: false, startY: 0 };

  function init() {
    detailPanel = document.getElementById('detail-panel');
    initTabs();
    initDetailPanelDrag();
    initCloseButton();
  }

  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
      });
    });
  }

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
      if (dy > 0) detailPanel.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (!dragState.active) return;
      dragState.active = false;
      detailPanel.style.transition = '';
      const rect = detailPanel.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.5) {
        closeDetail();
      } else {
        detailPanel.style.transform = '';
        detailPanel.classList.add('open');
      }
    });
  }

  function initCloseButton() {
    const closeBtn = document.getElementById('detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDetail);
  }

  /**
   * Show property detail panel
   */
  async function showPropertyDetail(parcel) {
    currentParcel = parcel;
    detailPanel.classList.remove('closed');
    detailPanel.classList.add('open');
    detailPanel.style.transform = '';

    // Header
    document.getElementById('detail-address').textContent =
      parcel.address || parcel.parcelId || 'Unknown Property';
    document.getElementById('detail-subtitle').textContent =
      [parcel.city, parcel.county ? `${parcel.county} County` : '', 'AR', parcel.zip]
        .filter(Boolean).join(', ');

    // Render all tabs with what we have
    renderOverview(parcel);
    renderZoning(parcel);
    renderOwnership(parcel);
    renderImprovements(parcel);
    renderTransactions(parcel);
    renderUtilities(parcel);

    // Activate overview tab
    document.querySelector('.tab-btn[data-tab="overview"]').click();

    // Enrich with flood data
    try {
      const enriched = await ParcelService.getFullPropertyDetail(parcel);
      currentParcel = enriched;
      renderOverview(enriched);
      renderZoning(enriched);
      renderUtilities(enriched);
    } catch (e) {
      console.warn('[UI] Enrichment failed:', e);
    }
  }

  function closeDetail() {
    detailPanel.classList.remove('open');
    detailPanel.classList.add('closed');
    currentParcel = null;
  }

  // ---- Formatters ----
  function fmtCurrency(val) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtNum(val, dec = 0) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return Number(val).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function display(val) {
    if (val === null || val === undefined || val === '' || val === 'Null') return 'N/A';
    return String(val);
  }

  function fmtDate(val) {
    if (!val) return 'N/A';
    // ArcGIS dates come as epoch milliseconds
    if (typeof val === 'number') {
      return new Date(val).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return String(val);
  }

  // ---- HTML Builders ----
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

  function statRow(stats) {
    return '<div class="stat-row">' + stats.map(([value, label]) =>
      `<div class="stat-box"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`
    ).join('') + '</div>';
  }

  function linkButton(url, text, icon = '') {
    if (!url) return '';
    return `<a href="${url}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="margin-top:8px;display:inline-flex;align-items:center;gap:4px;text-decoration:none;">${icon}${text}</a>`;
  }

  // ---- Tab Renderers ----

  function renderOverview(p) {
    const el = document.getElementById('overview-content');
    const assessorUrl = ParcelService.getAssessorUrl(p);
    const gisUrl = ParcelService.getGisViewerUrl(p);

    const typeLabel = getParcelTypeLabel(p.parcelType);
    const typeBadge = getParcelTypeBadge(p.parcelType);

    // Key stats
    const stats = [];
    if (p.acres) stats.push([fmtNum(p.acres, 2), 'Acres']);
    if (p.totalValue) stats.push([fmtCurrency(p.totalValue), 'Total Value']);
    if (p.assessedValue) stats.push([fmtCurrency(p.assessedValue), 'Assessed']);
    if (p.landValue) stats.push([fmtCurrency(p.landValue), 'Land Value']);
    if (p.improvementValue) stats.push([fmtCurrency(p.improvementValue), 'Improvements']);
    if (stats.length === 0) {
      stats.push(['--', 'Acres'], ['--', 'Value'], ['--', 'Assessed']);
    }

    el.innerHTML = `
      <div style="margin-bottom:8px;">
        <span class="badge ${typeBadge}">${typeLabel}</span>
        ${p.county ? `<span class="badge badge-gray" style="margin-left:4px;">${p.county} County</span>` : ''}
      </div>
      ${statRow(stats)}
      ${dataCard('Property Summary', [
        ['Parcel ID', display(p.parcelId)],
        ['Address', display(p.address)],
        ['City', display(p.city)],
        ['Zip', display(p.zip)],
        ['Acreage', p.acres ? fmtNum(p.acres, 2) + ' ac' : 'N/A'],
        ['Parcel Type', display(typeLabel)],
        ['Subdivision', display(p.subdivision)],
        ['Neighborhood', display(p.neighborhood)],
      ])}
      ${dataCard('Valuation (from County CAMA)', [
        ['Total Value', fmtCurrency(p.totalValue)],
        ['Assessed Value', fmtCurrency(p.assessedValue)],
        ['Land Value', fmtCurrency(p.landValue)],
        ['Improvement Value', fmtCurrency(p.improvementValue)],
      ])}
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;">
        ${linkButton(assessorUrl, 'Full Assessor Record', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>')}
        ${linkButton(gisUrl, 'County GIS Viewer', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/></svg>')}
      </div>
      <p style="font-size:11px;color:var(--text-light);margin-top:12px;">
        For detailed building info (beds, baths, sq ft, year built), click "Full Assessor Record" above.
        The statewide GIS layer provides parcel boundaries and valuation; detailed CAMA building data
        is maintained by each county assessor.
      </p>
    `;
  }

  function renderZoning(p) {
    const el = document.getElementById('zoning-content');
    const floodZone = p.floodZone;

    el.innerHTML = `
      ${dataCard('Parcel Classification', [
        ['Parcel Type', display(getParcelTypeLabel(p.parcelType)), getParcelTypeBadge(p.parcelType)],
        ['Tax Code', display(p.taxCode)],
        ['Tax Area', display(p.taxArea)],
        ['Subdivision', display(p.subdivision)],
        ['Neighborhood', display(p.neighborhood)],
      ])}
      ${dataCard('FEMA Flood Zone', [
        ['Flood Zone', display(floodZone?.zone), getFloodBadge(floodZone?.zone)],
        ['Floodway', display(floodZone?.floodway)],
        ['FIRM Panel', display(floodZone?.panelNumber)],
        ['Effective Date', display(floodZone?.effectiveDate)],
        ['Base Flood Elevation', display(floodZone?.staticBFE)],
      ])}
      ${floodZone?.description ? `<p style="font-size:12px;color:var(--text-secondary);margin-top:4px;padding:8px 12px;background:var(--bg);border-radius:6px;">${floodZone.description}</p>` : ''}
      ${dataCard('Section / Township / Range', [
        ['Section', display(p.section)],
        ['Township', display(p.township)],
        ['Range', display(p.range)],
        ['STR', display(p.str)],
      ])}
      <p style="font-size:11px;color:var(--text-light);margin-top:12px;">
        Zoning classifications are maintained by city/county planning departments and may not be
        reflected in the statewide parcel data. Check with the local planning office for current zoning.
      </p>
    `;
  }

  function renderOwnership(p) {
    const el = document.getElementById('ownership-content');
    const assessorUrl = ParcelService.getAssessorUrl(p);

    el.innerHTML = `
      ${dataCard('Current Owner', [
        ['Owner Name', display(p.owner)],
        ['County', display(p.county)],
      ])}
      ${dataCard('Parcel Identification', [
        ['Parcel ID', display(p.parcelId)],
        ['CAMA Key', display(p.camaKey)],
        ['County ID', display(p.countyId)],
        ['County FIPS', display(p.countyFips)],
      ])}
      ${dataCard('Legal Description', [
        ['Legal', display(p.legalDescription)],
        ['Subdivision', display(p.subdivision)],
        ['Section', display(p.section)],
        ['Township', display(p.township)],
        ['Range', display(p.range)],
      ])}
      <div style="margin-top:12px;">
        ${linkButton(assessorUrl, 'View Ownership History on Assessor Site', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>')}
      </div>
    `;
  }

  function renderImprovements(p) {
    const el = document.getElementById('improvements-content');
    const assessorUrl = ParcelService.getAssessorUrl(p);

    el.innerHTML = `
      ${dataCard('Improvement Summary', [
        ['Improvement Value', fmtCurrency(p.improvementValue)],
        ['Land Value', fmtCurrency(p.landValue)],
        ['Total Value', fmtCurrency(p.totalValue)],
        ['Acreage', p.acres ? fmtNum(p.acres, 2) + ' ac' : 'N/A'],
        ['Parcel Type', display(getParcelTypeLabel(p.parcelType))],
      ])}
      <div class="data-card" style="background:#eff6ff;border-color:#bfdbfe;">
        <div class="data-card-title" style="color:#1d4ed8;">Detailed Building Data</div>
        <p style="font-size:13px;color:#1e40af;line-height:1.5;">
          Building details including <strong>year built, square footage, bedrooms, bathrooms,
          construction type, and other improvements</strong> are maintained in each county's
          CAMA (Computer Assisted Mass Appraisal) system. Click below to view the full
          property card on the county assessor's website.
        </p>
        <div style="margin-top:10px;">
          ${linkButton(assessorUrl, 'View Full Property Card', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>')}
        </div>
      </div>
      ${p.improvementValue && p.improvementValue > 0 ? `
        <div style="margin-top:8px;">
          ${statRow([
            [fmtCurrency(p.improvementValue), 'Improvement Value'],
            [p.acres ? fmtCurrency(p.totalValue / p.acres) : 'N/A', 'Value / Acre'],
          ])}
        </div>
      ` : ''}
    `;
  }

  function renderTransactions(p) {
    const el = document.getElementById('transactions-content');
    const assessorUrl = ParcelService.getAssessorUrl(p);

    el.innerHTML = `
      <div class="data-card" style="background:#eff6ff;border-color:#bfdbfe;">
        <div class="data-card-title" style="color:#1d4ed8;">Transaction History</div>
        <p style="font-size:13px;color:#1e40af;line-height:1.5;">
          Sale history, deed transfers, and transaction details are maintained by the
          county assessor and clerk. Click below to view the full transaction history.
        </p>
        <div style="margin-top:10px;">
          ${linkButton(assessorUrl, 'View Sales History', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>')}
        </div>
      </div>
      ${dataCard('Valuation Context', [
        ['Total Value', fmtCurrency(p.totalValue)],
        ['Land Value', fmtCurrency(p.landValue)],
        ['Improvement Value', fmtCurrency(p.improvementValue)],
        ['Assessed Value', fmtCurrency(p.assessedValue)],
        ['Acreage', p.acres ? fmtNum(p.acres, 2) + ' ac' : 'N/A'],
        ['Value Per Acre', p.totalValue && p.acres ? fmtCurrency(p.totalValue / p.acres) + '/ac' : 'N/A'],
      ])}
      ${dataCard('Data Source', [
        ['Data Provider', display(p.dataProvider)],
        ['CAMA Provider', display(p.camaProvider)],
        ['CAMA Date', fmtDate(p.camaDate)],
        ['Published', fmtDate(p.pubDate)],
        ['Source Reference', display(p.sourceRef)],
      ])}
    `;
  }

  function renderUtilities(p) {
    const el = document.getElementById('utilities-content');
    const floodZone = p.floodZone;

    el.innerHTML = `
      ${dataCard('FEMA Flood Zone', [
        ['Flood Zone', display(floodZone?.zone), getFloodBadge(floodZone?.zone)],
        ['Floodway', display(floodZone?.floodway)],
        ['Base Flood Elevation', display(floodZone?.staticBFE)],
      ])}
      ${floodZone?.description ? `<p style="font-size:12px;color:var(--text-secondary);margin-top:4px;margin-bottom:12px;padding:8px 12px;background:var(--bg);border-radius:6px;">${floodZone.description}</p>` : ''}
      ${dataCard('Utility Providers (NW Arkansas)', [
        ['Electric', 'SWEPCO, OG&E, Carroll Electric, Ozarks Electric'],
        ['Natural Gas', 'Arkansas Oklahoma Gas (AOG), CenterPoint Energy, Black Hills Energy'],
        ['Water', 'Beaver Water District (wholesale), Municipal systems vary by city'],
        ['Sewer', 'City municipal sewer or septic — verify with city'],
        ['Internet/Fiber', 'OzarksGo, AT&T Fiber, Cox Communications'],
        ['Telephone', 'AT&T, Windstream'],
      ])}
      ${dataCard('Key Contacts for Due Diligence', [
        ['Benton Co. Assessor', '(479) 271-1033'],
        ['Washington Co. Assessor', '(479) 444-1526'],
        ['Crawford Co. Assessor', '(479) 474-1321'],
        ['Sebastian Co. Assessor', '(479) 782-1046'],
        ['FEMA Map Service', 'msc.fema.gov'],
      ])}
      <p style="font-size:11px;color:var(--text-light);margin-top:12px;">
        Utility availability varies by exact location. Contact the provider or city planning
        department to confirm service availability before making development decisions.
      </p>
    `;
  }

  // ---- Helpers ----

  function getParcelTypeLabel(code) {
    if (!code) return 'Unknown';
    const map = {
      'R': 'Residential',
      'RE': 'Residential',
      'C': 'Commercial',
      'CO': 'Commercial',
      'I': 'Industrial',
      'IN': 'Industrial',
      'A': 'Agricultural',
      'AG': 'Agricultural',
      'E': 'Exempt',
      'EX': 'Exempt',
      'T': 'Timber',
      'TI': 'Timber',
      'M': 'Mineral',
      'MI': 'Mineral',
      'V': 'Vacant',
      'VA': 'Vacant',
      'U': 'Utility',
      'UT': 'Utility',
    };
    return map[code.toUpperCase()] || code;
  }

  function getParcelTypeBadge(code) {
    if (!code) return 'badge-gray';
    const c = code.toUpperCase();
    if (c.startsWith('R')) return 'badge-blue';
    if (c.startsWith('C')) return 'badge-yellow';
    if (c.startsWith('I')) return 'badge-red';
    if (c.startsWith('A') || c.startsWith('T')) return 'badge-green';
    return 'badge-gray';
  }

  function getFloodBadge(zone) {
    if (!zone) return '';
    const z = zone.toUpperCase();
    if (/^A|^V/.test(z)) return 'badge-red';
    if (/^B|SHADED|0\.2/.test(z)) return 'badge-yellow';
    if (/^C|^X|MINIMAL/.test(z)) return 'badge-green';
    return 'badge-gray';
  }

  return { init, showPropertyDetail, closeDetail };
})();
