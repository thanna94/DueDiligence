/**
 * UI Module
 *
 * Renders property detail panels with:
 * - Arkansas CAMP data (parcel, ownership, valuation)
 * - FEMA flood zone data
 * - ATTOM API data when available (beds, baths, sqft, year built, AVM, sales)
 * - Zillow deep link
 * - County assessor links
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

  async function showPropertyDetail(parcel) {
    currentParcel = parcel;
    detailPanel.classList.remove('closed');
    detailPanel.classList.add('open');
    detailPanel.style.transform = '';

    document.getElementById('detail-address').textContent =
      parcel.address || parcel.parcelId || 'Unknown Property';
    document.getElementById('detail-subtitle').textContent =
      [parcel.city, parcel.county ? `${parcel.county} County` : '', 'AR', parcel.zip]
        .filter(Boolean).join(', ');

    // Render immediately with what we have
    renderOverview(parcel);
    renderZoning(parcel);
    renderOwnership(parcel);
    renderImprovements(parcel);
    renderTransactions(parcel);
    renderUtilities(parcel);

    document.querySelector('.tab-btn[data-tab="overview"]').click();

    // Enrich with flood + ATTOM data
    try {
      const enriched = await ParcelService.getFullPropertyDetail(parcel);
      currentParcel = enriched;
      renderOverview(enriched);
      renderZoning(enriched);
      renderImprovements(enriched);
      renderTransactions(enriched);
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
  function $(val) { // fmtCurrency
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function num(val, dec = 0) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return Number(val).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function d(val) { // display
    if (val === null || val === undefined || val === '' || val === 'Null') return 'N/A';
    return String(val);
  }

  function fDate(val) {
    if (!val) return 'N/A';
    if (typeof val === 'number') return new Date(val).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    return String(val);
  }

  // ---- HTML Builders ----
  function card(title, rows) {
    const html = rows
      .filter(([, v]) => v !== undefined)
      .map(([label, value, badge]) => {
        const vh = badge ? `<span class="badge ${badge}">${value}</span>` : `<span class="data-value">${value}</span>`;
        return `<div class="data-row"><span class="data-label">${label}</span>${vh}</div>`;
      }).join('');
    return `<div class="data-card"><div class="data-card-title">${title}</div>${html}</div>`;
  }

  function stats(items) {
    return '<div class="stat-row">' + items.map(([v, l]) =>
      `<div class="stat-box"><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div>`
    ).join('') + '</div>';
  }

  function link(url, text) {
    if (!url) return '';
    return `<a href="${url}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="margin-top:6px;display:inline-flex;align-items:center;gap:4px;text-decoration:none;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      ${text}</a>`;
  }

  function hasAttom(p) { return p.attom && p.attom.detail; }

  // ---- Tab Renderers ----

  function renderOverview(p) {
    const el = document.getElementById('overview-content');
    const att = p.attom?.detail;
    const avm = p.attom?.avm;
    const assessorUrl = ParcelService.getAssessorUrl(p);
    const gisUrl = ParcelService.getGisViewerUrl(p);
    const zillowUrl = ParcelService.getZillowUrl(p);

    const typeLabel = att?.propertyType || getParcelTypeLabel(p.parcelType);
    const typeBadge = getParcelTypeBadge(p.parcelType);

    // Build key stats from best available source
    const st = [];
    if (p.acres) st.push([num(p.acres, 2), 'Acres']);
    if (att?.sqft) st.push([num(att.sqft), 'Sq Ft']);
    if (att?.yearBuilt) st.push([att.yearBuilt, 'Year Built']);
    if (att?.bedrooms) st.push([att.bedrooms, 'Beds']);
    if (att?.bathsTotal || att?.bathsFull) st.push([att.bathsTotal || att.bathsFull, 'Baths']);
    if (avm?.estimatedValue) st.push([$(avm.estimatedValue), 'AVM Est.']);
    else if (p.totalValue) st.push([$(p.totalValue), 'Total Value']);
    if (st.length < 3) {
      if (!st.find(s => s[1] === 'Acres')) st.push(['--', 'Acres']);
      if (!st.find(s => s[1] === 'Sq Ft')) st.push(['--', 'Sq Ft']);
      if (!st.find(s => s[1] === 'Year Built')) st.push(['--', 'Year Built']);
    }

    const attomKeySet = !!localStorage.getItem('attom_api_key');

    el.innerHTML = `
      <div style="margin-bottom:8px;">
        <span class="badge ${typeBadge}">${typeLabel}</span>
        ${p.county ? `<span class="badge badge-gray" style="margin-left:4px;">${p.county} County</span>` : ''}
        ${hasAttom(p) ? '<span class="badge badge-green" style="margin-left:4px;">ATTOM</span>' : ''}
      </div>
      ${stats(st)}
      ${hasAttom(p) ? card('Building Details (ATTOM)', [
        ['Bedrooms', d(att.bedrooms)],
        ['Full Baths', d(att.bathsFull)],
        ['Half Baths', d(att.bathsHalf)],
        ['Living Area', att.sqft ? num(att.sqft) + ' sq ft' : 'N/A'],
        ['Year Built', d(att.yearBuilt)],
        ['Stories', d(att.stories)],
        ['Building Type', d(att.bldgType)],
        ['Construction', d(att.construction)],
        ['Roof', d(att.roofType)],
        ['Heating', d(att.heating)],
        ['Cooling', d(att.cooling)],
        ['Garage', d(att.garage)],
        ['Garage Spaces', d(att.garageSpaces)],
        ['Pool', d(att.pool)],
        ['Fireplace Count', d(att.fireplace)],
      ]) : ''}
      ${avm ? card('Automated Valuation (ATTOM AVM)', [
        ['Estimated Value', $(avm.estimatedValue)],
        ['Low Estimate', $(avm.valueLow)],
        ['High Estimate', $(avm.valueHigh)],
        ['Confidence Score', d(avm.confidence)],
        ['As of Date', d(avm.asOfDate)],
      ]) : ''}
      ${card('Parcel Data (Arkansas GIS)', [
        ['Parcel ID', d(p.parcelId)],
        ['Address', d(p.address)],
        ['City', d(p.city)],
        ['Zip', d(p.zip)],
        ['Acreage', p.acres ? num(p.acres, 2) + ' ac' : 'N/A'],
        ['Parcel Type', d(getParcelTypeLabel(p.parcelType))],
        ['Subdivision', d(p.subdivision)],
        ['Neighborhood', d(p.neighborhood)],
      ])}
      ${card('County Valuation', [
        ['Total Value', $(p.totalValue)],
        ['Assessed Value', $(p.assessedValue)],
        ['Land Value', $(p.landValue)],
        ['Improvement Value', $(p.improvementValue)],
      ])}
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;">
        ${link(assessorUrl, 'County Assessor')}
        ${link(gisUrl, 'County GIS Viewer')}
        ${link(zillowUrl, 'View on Zillow')}
      </div>
      ${!attomKeySet ? `<p style="font-size:11px;color:var(--text-light);margin-top:12px;padding:8px;background:#fffbeb;border-radius:6px;border:1px solid #fde68a;">
        <strong>Tip:</strong> Add an ATTOM API key in the menu (top-left) to get beds, baths, sq ft, year built, AVM estimates, and full sales history for every parcel.
      </p>` : ''}
    `;
  }

  function renderZoning(p) {
    const el = document.getElementById('zoning-content');
    const fz = p.floodZone;
    const att = p.attom?.detail;

    el.innerHTML = `
      ${card('Parcel Classification', [
        ['Parcel Type', d(getParcelTypeLabel(p.parcelType)), getParcelTypeBadge(p.parcelType)],
        ['ATTOM Property Type', att ? d(att.propertyType) : undefined],
        ['ATTOM Sub-Type', att ? d(att.propertySubType) : undefined],
        ['Zoning (ATTOM)', att ? d(att.zoning) : undefined],
        ['Tax Code', d(p.taxCode)],
        ['Tax Area', d(p.taxArea)],
        ['Subdivision', d(p.subdivision)],
        ['Neighborhood', d(p.neighborhood)],
      ])}
      ${card('FEMA Flood Zone', [
        ['Flood Zone', d(fz?.zone), getFloodBadge(fz?.zone)],
        ['Floodway', d(fz?.floodway)],
        ['FIRM Panel', d(fz?.panelNumber)],
        ['Effective Date', d(fz?.effectiveDate)],
        ['Base Flood Elevation', d(fz?.staticBFE)],
      ])}
      ${fz?.description ? `<p style="font-size:12px;color:var(--text-secondary);margin-top:4px;padding:8px 12px;background:var(--bg);border-radius:6px;">${fz.description}</p>` : ''}
      ${card('Section / Township / Range', [
        ['Section', d(p.section)],
        ['Township', d(p.township)],
        ['Range', d(p.range)],
        ['STR', d(p.str)],
      ])}
      <p style="font-size:11px;color:var(--text-light);margin-top:12px;">
        Verify current zoning with the local planning department before making development decisions.
      </p>
    `;
  }

  function renderOwnership(p) {
    const el = document.getElementById('ownership-content');
    const assessorUrl = ParcelService.getAssessorUrl(p);

    el.innerHTML = `
      ${card('Current Owner', [
        ['Owner Name', d(p.owner)],
        ['County', d(p.county)],
      ])}
      ${card('Parcel Identification', [
        ['Parcel ID', d(p.parcelId)],
        ['CAMA Key', d(p.camaKey)],
        ['County ID', d(p.countyId)],
        ['County FIPS', d(p.countyFips)],
      ])}
      ${card('Legal Description', [
        ['Legal', d(p.attom?.detail?.legalDescription || p.legalDescription)],
        ['Subdivision', d(p.subdivision)],
        ['Section', d(p.section)],
        ['Township', d(p.township)],
        ['Range', d(p.range)],
      ])}
      <div style="margin-top:10px;">
        ${link(assessorUrl, 'Full Ownership & Deed History')}
      </div>
    `;
  }

  function renderImprovements(p) {
    const el = document.getElementById('improvements-content');
    const att = p.attom?.detail;
    const assessorUrl = ParcelService.getAssessorUrl(p);

    if (hasAttom(p)) {
      // Full ATTOM building data
      const st = [];
      if (att.sqft) st.push([num(att.sqft), 'Sq Ft']);
      if (att.yearBuilt) st.push([att.yearBuilt, 'Year Built']);
      if (att.bedrooms) st.push([att.bedrooms, 'Beds']);
      if (att.bathsFull) {
        const bStr = att.bathsHalf ? `${att.bathsFull}F/${att.bathsHalf}H` : String(att.bathsFull);
        st.push([bStr, 'Baths']);
      }
      if (att.stories) st.push([att.stories, 'Stories']);

      el.innerHTML = `
        ${st.length > 0 ? stats(st) : ''}
        ${card('Building Details', [
          ['Building Type', d(att.bldgType)],
          ['Year Built', d(att.yearBuilt)],
          ['Living Area', att.sqft ? num(att.sqft) + ' sq ft' : 'N/A'],
          ['Lot Size', att.lotSizeAcres ? num(att.lotSizeAcres, 2) + ' acres' : (att.lotSizeSqFt ? num(att.lotSizeSqFt) + ' sq ft' : 'N/A')],
          ['Bedrooms', d(att.bedrooms)],
          ['Full Baths', d(att.bathsFull)],
          ['Half Baths', d(att.bathsHalf)],
          ['Stories', d(att.stories)],
          ['Construction', d(att.construction)],
          ['Roof', d(att.roofType)],
          ['Foundation', 'See assessor record'],
        ])}
        ${card('Systems & Features', [
          ['Heating', d(att.heating)],
          ['Cooling', d(att.cooling)],
          ['Garage', d(att.garage)],
          ['Garage Spaces', d(att.garageSpaces)],
          ['Pool', d(att.pool)],
          ['Fireplace(s)', d(att.fireplace)],
        ])}
        ${card('Improvement Value', [
          ['Improvement Value', $(p.improvementValue)],
          ['Land Value', $(p.landValue)],
          ['Total', $(p.totalValue)],
        ])}
      `;
    } else {
      // No ATTOM — show what we have + prompt
      el.innerHTML = `
        ${card('Improvement Summary', [
          ['Improvement Value', $(p.improvementValue)],
          ['Land Value', $(p.landValue)],
          ['Total Value', $(p.totalValue)],
          ['Acreage', p.acres ? num(p.acres, 2) + ' ac' : 'N/A'],
          ['Parcel Type', d(getParcelTypeLabel(p.parcelType))],
        ])}
        <div class="data-card" style="background:#eff6ff;border-color:#bfdbfe;">
          <div class="data-card-title" style="color:#1d4ed8;">Detailed Building Data</div>
          <p style="font-size:13px;color:#1e40af;line-height:1.5;">
            Year built, sq ft, bedrooms, bathrooms, and construction details are available via:
          </p>
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
            ${link(assessorUrl, 'County Assessor Record')}
            ${link(ParcelService.getZillowUrl(p), 'View on Zillow')}
          </div>
          ${!localStorage.getItem('attom_api_key') ? `<p style="font-size:11px;color:#1e40af;margin-top:10px;">
            Or add an <strong>ATTOM API key</strong> in the menu to get this data automatically for every parcel.
          </p>` : '<p style="font-size:11px;color:#dc2626;margin-top:10px;">ATTOM API key is set but no data was returned for this property. The address may not be in ATTOM\'s database.</p>'}
        </div>
      `;
    }
  }

  function renderTransactions(p) {
    const el = document.getElementById('transactions-content');
    const sales = p.attom?.salesHistory;
    const assessorUrl = ParcelService.getAssessorUrl(p);

    let salesHtml = '';
    if (sales && sales.length > 0) {
      salesHtml = '<div class="transaction-list">' + sales.map(s => `
        <div class="transaction-item">
          <div class="tx-date">${d(s.date)}</div>
          <div class="tx-price">${$(s.price)}</div>
          <div class="tx-type">${d(s.type)}${s.deedType ? ` · ${s.deedType}` : ''}</div>
          ${s.buyer ? `<div class="tx-parties">Buyer: ${d(s.buyer)}</div>` : ''}
          ${s.seller ? `<div class="tx-parties">Seller: ${d(s.seller)}</div>` : ''}
        </div>
      `).join('') + '</div>';
    }

    el.innerHTML = `
      ${salesHtml || `
        <div class="data-card" style="background:#eff6ff;border-color:#bfdbfe;">
          <div class="data-card-title" style="color:#1d4ed8;">Transaction History</div>
          <p style="font-size:13px;color:#1e40af;line-height:1.5;">
            ${localStorage.getItem('attom_api_key')
              ? 'No sales history found in ATTOM for this property.'
              : 'Add an ATTOM API key in the menu to see full sales history, or click below to view on the county assessor site.'}
          </p>
          <div style="margin-top:8px;">
            ${link(assessorUrl, 'View Sales History')}
          </div>
        </div>
      `}
      ${card('Valuation Context', [
        ['Total Value', $(p.totalValue)],
        ['Land Value', $(p.landValue)],
        ['Improvement Value', $(p.improvementValue)],
        ['Assessed Value', $(p.assessedValue)],
        ['Acreage', p.acres ? num(p.acres, 2) + ' ac' : 'N/A'],
        ['Value Per Acre', p.totalValue && p.acres ? $(p.totalValue / p.acres) + '/ac' : 'N/A'],
      ])}
      ${card('Data Source', [
        ['Data Provider', d(p.dataProvider)],
        ['CAMA Provider', d(p.camaProvider)],
        ['CAMA Date', fDate(p.camaDate)],
        ['Published', fDate(p.pubDate)],
      ])}
    `;
  }

  function renderUtilities(p) {
    const el = document.getElementById('utilities-content');
    const fz = p.floodZone;

    el.innerHTML = `
      ${card('FEMA Flood Zone', [
        ['Flood Zone', d(fz?.zone), getFloodBadge(fz?.zone)],
        ['Floodway', d(fz?.floodway)],
        ['Base Flood Elevation', d(fz?.staticBFE)],
      ])}
      ${fz?.description ? `<p style="font-size:12px;color:var(--text-secondary);margin-top:4px;margin-bottom:12px;padding:8px 12px;background:var(--bg);border-radius:6px;">${fz.description}</p>` : ''}
      ${card('Utility Providers (NW Arkansas)', [
        ['Electric', 'SWEPCO, OG&E, Carroll Electric, Ozarks Electric'],
        ['Natural Gas', 'AOG, CenterPoint Energy, Black Hills Energy'],
        ['Water', 'Beaver Water District (wholesale), city systems vary'],
        ['Sewer', 'City municipal sewer or septic — verify with city'],
        ['Internet/Fiber', 'OzarksGo, AT&T Fiber, Cox Communications'],
      ])}
      ${card('Key Contacts', [
        ['Benton Co. Assessor', '(479) 271-1033'],
        ['Washington Co. Assessor', '(479) 444-1526'],
        ['Crawford Co. Assessor', '(479) 474-1321'],
        ['Sebastian Co. Assessor', '(479) 782-1046'],
        ['FEMA Flood Maps', 'msc.fema.gov'],
      ])}
    `;
  }

  // ---- Helpers ----

  function getParcelTypeLabel(code) {
    if (!code) return 'Unknown';
    const map = {
      'R': 'Residential', 'RE': 'Residential', 'C': 'Commercial', 'CO': 'Commercial',
      'I': 'Industrial', 'IN': 'Industrial', 'A': 'Agricultural', 'AG': 'Agricultural',
      'E': 'Exempt', 'EX': 'Exempt', 'T': 'Timber', 'TI': 'Timber',
      'M': 'Mineral', 'MI': 'Mineral', 'V': 'Vacant', 'VA': 'Vacant',
      'U': 'Utility', 'UT': 'Utility',
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
